/**
 * Catálogo de cuentas auxiliares — tercer nivel del catálogo de cuentas
 * (cuenta_padre.consecutivo, ej. 105.01.01), donde de verdad reciben
 * movimientos las pólizas. sat_cuentas_agrupador solo llega a nivel 2
 * (mayor.subcuenta, cuentas de acumulación). Regla de negocio (2026-08-25):
 * NINGUNA póliza debe quedar contabilizada arriba de nivel 3 — toda subcuenta
 * usada en un movimiento debe resolverse a un auxiliar.
 *
 * `resolverAuxiliar` es la asignación automática por ENTIDAD (cliente/
 * proveedor, identificados por RFC): la usa polizas.generator.js para que, la
 * primera vez que una entidad genera un movimiento bajo una subcuenta, se le
 * fije un consecutivo (01, 02, ... — no se reasigna después).
 *
 * `resolverDefault` es el auxiliar GENÉRICO de una subcuenta (consecutivo
 * reservado 0 → sufijo ".00", mismo nombre que la subcuenta): lo usa
 * polizas.generator.js para cualquier movimiento sin entidad específica (IVA,
 * ingresos, gastos, banco, etc.) — así ese movimiento también aterriza en
 * nivel 3 en vez de quedarse en la subcuenta (nivel 2).
 *
 * El resto de funciones son el CRUD del catálogo (altas manuales, listado,
 * activar/desactivar) para cualquier subcuenta.
 */
const { pool } = require('../../config/db');

function formatCodigo(padre, consecutivo) {
  return `${padre}.${String(consecutivo).padStart(2, '0')}`;
}

async function siguienteConsecutivo(db, cuentaPadre) {
  const [[row]] = await db.query(
    'SELECT COALESCE(MAX(consecutivo),0) mx FROM cuentas_auxiliares WHERE cuenta_padre=?',
    [cuentaPadre]);
  return Number(row.mx) + 1;
}

/**
 * Obtiene (o crea) el auxiliar de una entidad bajo una subcuenta.
 *   cuentaPadre: subcuenta del agrupador SAT (ej. '105.01')
 *   entidadTipo: 'cliente' | 'proveedor'
 *   rfc:         RFC de la entidad — es la llave real de identidad (siempre
 *                viene en el CFDI, exista o no un catálogo de clientes/
 *                proveedores con ese RFC dado de alta)
 *   entidadId:   id en clientes/proveedores si hubo match por RFC (opcional,
 *                solo referencia — NO es la llave, ver migrate_v65)
 *   nombre:      nombre a usar si hay que crear el auxiliar
 * `cache` (opcional, Map) evita repetir consultas dentro de una misma corrida
 * de generarPeriodo. Sin cuentaPadre/entidadTipo/rfc devuelve cuentaPadre tal
 * cual (no todo movimiento tiene una entidad — IVA, ingresos, gastos
 * genéricos, banco...).
 */
async function resolverAuxiliar(db, { cuentaPadre, entidadTipo, entidadId, rfc, nombre }, cache) {
  const rfcNorm = rfc ? String(rfc).toUpperCase().trim() : null;
  if (!cuentaPadre || !entidadTipo || !rfcNorm) return cuentaPadre;
  const key = `${entidadTipo}:${rfcNorm}:${cuentaPadre}`;
  if (cache && cache.has(key)) return cache.get(key);

  const [existe] = await db.query(
    'SELECT codigo FROM cuentas_auxiliares WHERE entidad_tipo=? AND rfc=? AND cuenta_padre=? LIMIT 1',
    [entidadTipo, rfcNorm, cuentaPadre]);
  if (existe.length) {
    if (cache) cache.set(key, existe[0].codigo);
    return existe[0].codigo;
  }

  // Reintenta unas pocas veces por si dos corridas chocan en el mismo consecutivo
  // (poco probable: la generación la dispara un admin a la vez).
  for (let intento = 0; intento < 3; intento++) {
    const consecutivo = await siguienteConsecutivo(db, cuentaPadre);
    const codigo = formatCodigo(cuentaPadre, consecutivo);
    try {
      await db.query(
        `INSERT INTO cuentas_auxiliares (cuenta_padre, consecutivo, codigo, nombre, entidad_tipo, entidad_id, rfc)
         VALUES (?,?,?,?,?,?,?)`,
        [cuentaPadre, consecutivo, codigo, (nombre || rfcNorm).slice(0, 150), entidadTipo, entidadId || null, rfcNorm]);
      if (cache) cache.set(key, codigo);
      return codigo;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      // Alguien más lo creó justo ahora: si fue este mismo RFC, reúsalo.
      const [row] = await db.query(
        'SELECT codigo FROM cuentas_auxiliares WHERE entidad_tipo=? AND rfc=? AND cuenta_padre=? LIMIT 1',
        [entidadTipo, rfcNorm, cuentaPadre]);
      if (row.length) { if (cache) cache.set(key, row[0].codigo); return row[0].codigo; }
      // Si no fue este RFC, era choque de consecutivo: reintenta con el siguiente.
    }
  }
  const e = new Error(`No se pudo asignar auxiliar bajo ${cuentaPadre} tras varios intentos`);
  throw e;
}

/**
 * Auxiliar genérico ".00" de una subcuenta (mismo nombre que la subcuenta) —
 * el destino de cualquier movimiento sin entidad específica. Idempotente por
 * `codigo` (consecutivo 0 es un valor reservado, nunca lo asigna
 * siguienteConsecutivo porque empieza en 1).
 */
async function resolverDefault(db, cuentaPadre, nombre, cache) {
  if (!cuentaPadre) return cuentaPadre;
  const codigo = formatCodigo(cuentaPadre, 0);
  if (cache && cache.has(codigo)) return cache.get(codigo);

  const [existe] = await db.query('SELECT codigo FROM cuentas_auxiliares WHERE codigo=? LIMIT 1', [codigo]);
  if (existe.length) { if (cache) cache.set(codigo, codigo); return codigo; }

  try {
    await db.query(
      `INSERT INTO cuentas_auxiliares (cuenta_padre, consecutivo, codigo, nombre, entidad_tipo)
       VALUES (?,0,?,?,'manual')`,
      [cuentaPadre, codigo, (nombre || codigo).slice(0, 150)]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e; // ya existe (otra corrida lo creó primero) — se ignora
  }
  if (cache) cache.set(codigo, codigo);
  return codigo;
}

async function listar({ q, cuenta_padre, entidad_tipo, activo } = {}) {
  const where = [], vals = [];
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(a.codigo LIKE ? OR a.nombre LIKE ?)'); vals.push(like, like);
  }
  if (cuenta_padre) { where.push('a.cuenta_padre = ?'); vals.push(cuenta_padre); }
  if (entidad_tipo) { where.push('a.entidad_tipo = ?'); vals.push(entidad_tipo); }
  if (activo === '1' || activo === '0') { where.push('a.activo = ?'); vals.push(activo); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT a.id, a.cuenta_padre, a.consecutivo, a.codigo, a.nombre, a.entidad_tipo,
            a.entidad_id, a.rfc, a.activo, a.created_at,
            s.nombre AS subcuenta_nombre, s.rubro
       FROM cuentas_auxiliares a
       LEFT JOIN sat_cuentas_agrupador s ON s.codigo = a.cuenta_padre COLLATE utf8mb4_general_ci
       ${w}
      ORDER BY a.cuenta_padre, a.consecutivo`, vals);
  return rows;
}

async function crearManual({ cuenta_padre, nombre }) {
  const padre = String(cuenta_padre || '').trim();
  const nom = String(nombre || '').trim();
  if (!padre || !nom) { const e = new Error('cuenta_padre y nombre son obligatorios'); e.status = 400; throw e; }
  const [[cat]] = await pool.query('SELECT nivel FROM sat_cuentas_agrupador WHERE codigo=?', [padre]);
  if (!cat) { const e = new Error('cuenta_padre no existe en el catálogo agrupador'); e.status = 400; throw e; }
  if (cat.nivel !== 2) { const e = new Error('cuenta_padre debe ser una subcuenta (nivel 2), no un mayor'); e.status = 400; throw e; }

  for (let intento = 0; intento < 3; intento++) {
    const consecutivo = await siguienteConsecutivo(pool, padre);
    const codigo = formatCodigo(padre, consecutivo);
    try {
      const [r] = await pool.query(
        `INSERT INTO cuentas_auxiliares (cuenta_padre, consecutivo, codigo, nombre, entidad_tipo)
         VALUES (?,?,?,?,'manual')`,
        [padre, consecutivo, codigo, nom.slice(0, 150)]);
      return { id: r.insertId, cuenta_padre: padre, consecutivo, codigo, nombre: nom };
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  const e = new Error(`No se pudo asignar auxiliar bajo ${padre} tras varios intentos`);
  throw e;
}

async function actualizarManual(id, { nombre, activo }) {
  const [[row]] = await pool.query('SELECT * FROM cuentas_auxiliares WHERE id=?', [id]);
  if (!row) { const e = new Error('Auxiliar no encontrado'); e.status = 404; throw e; }
  const sets = [], vals = [];
  if (nombre !== undefined) {
    const nom = String(nombre || '').trim();
    if (!nom) { const e = new Error('nombre no puede quedar vacío'); e.status = 400; throw e; }
    sets.push('nombre=?'); vals.push(nom.slice(0, 150));
  }
  if (activo !== undefined) { sets.push('activo=?'); vals.push(activo ? 1 : 0); }
  if (!sets.length) return { ok: true };
  await pool.query(`UPDATE cuentas_auxiliares SET ${sets.join(', ')} WHERE id=?`, [...vals, id]);
  return { ok: true };
}

module.exports = { resolverAuxiliar, resolverDefault, listar, crearManual, actualizarManual };
