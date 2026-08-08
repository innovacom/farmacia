/**
 * pos.promociones.service.js — Promociones automáticas del mostrador
 * (migrate_v46). El admin configura reglas de % de descuento por alcance
 * (todos los productos, familia, categoría, subcategoría, o un conjunto de
 * productos elegidos a mano) con vigencia por día de la semana y/o rango de
 * fechas. `descuentosPara()` es el resolver que usa pos.ventas.service.js
 * (crearVenta/buscarProductos/favoritos) para aplicarlas SOLAS, sin que el
 * cajero haga nada — el backend es la fuente de verdad, la UI solo refleja
 * lo que el resolver ya calculó.
 *
 * Reglas duras (no configurables, decididas con el usuario):
 *  - Alcance 'todos' NUNCA toca la familia MEDICO (consultas) — el médico
 *    se sigue quedando con su costo completo (ver repartoMedicoFarmacia en
 *    pos.turnos.service.js); si se quiere promocionar consultas, se crea
 *    una promoción explícita de alcance 'familia' = MEDICO.
 *  - Ningún producto que requiera receta (clasificacion_cofepris fuera de
 *    libre/venta_farmacia) recibe descuento automático nunca.
 *
 * `requiere_cliente` (migrate_v47, sistema de fidelidad): además del
 * alcance por producto, una promoción puede exigir que la venta esté ligada
 * a un cliente de fidelidad con tarjeta de adulto mayor o programa de
 * lealtad (pos_clientes_fidelidad) — descuentos permanentes por cliente, no
 * por fecha. Si no hay cliente ligado a la venta, esas promociones
 * simplemente no aplican (mismo criterio que "sin promoción" normal).
 */
const { pool } = require('../../config/db');
const { getScoped } = require('./pos.tenant.helpers');

const TZ = 'America/Mexico_City';

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

// Fecha 'YYYY-MM-DD' + bit del día (1=lunes bit0..7=domingo bit6) en hora de
// negocio, independiente del tz del servidor MySQL/Node — db.js `timezone:
// '-06:00'` es solo marshalling de fechas en el cliente mysql2, NO cambia
// la sesión del servidor (NOW()/WEEKDAY() ahí pueden estar en otro huso).
function hoyLocal() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => partes.find((p) => p.type === t)?.value;
  const fecha = `${get('year')}-${get('month')}-${get('day')}`;
  const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dia = DOW[get('weekday')];
  return { fecha, bit: 1 << (dia - 1) };
}

function bitmaskFromDias(dias) {
  if (!Array.isArray(dias) || !dias.length) return 0;
  return dias.reduce((m, d) => {
    const n = Number(d);
    return n >= 1 && n <= 7 ? m | (1 << (n - 1)) : m;
  }, 0);
}

function diasFromBitmask(mask) {
  const dias = [];
  for (let d = 1; d <= 7; d++) if (mask & (1 << (d - 1))) dias.push(d);
  return dias;
}

/**
 * % más alto vigente ahora mismo por producto, entre las promociones activas
 * de la empresa. Una sola consulta (evita N+1 al recorrer partidas/resultados
 * de búsqueda). `productoIds` vacío devuelve un Map vacío sin consultar.
 * Excluye SIEMPRE productos controlados (requieren receta); el alcance
 * 'todos' excluye SIEMPRE la familia MEDICO — ver comentario del módulo.
 */
async function descuentosPara(
  conn, empresaId, productoIds, { fecha, bit } = hoyLocal(),
  clienteFlags = { adultoMayor: false, lealtad: false }
) {
  const ids = [...new Set((productoIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const [rows] = await conn.query(
    `SELECT p.id AS producto_id, pr.id AS promocion_id, pr.nombre, pr.porcentaje
     FROM productos p
     LEFT JOIN familias f ON f.id = p.familia_id
     JOIN pos_promociones pr
       ON pr.empresa_id = ? AND pr.activo = 1
      AND (pr.dias_semana = 0 OR (pr.dias_semana & ?) <> 0)
      AND (pr.vigencia_desde IS NULL OR pr.vigencia_desde <= ?)
      AND (pr.vigencia_hasta IS NULL OR pr.vigencia_hasta >= ?)
      AND (
           pr.requiere_cliente = 'nadie'
        OR (pr.requiere_cliente = 'adulto_mayor' AND ? = 1)
        OR (pr.requiere_cliente = 'programa_lealtad' AND ? = 1)
      )
      AND (
           (pr.tipo_alcance = 'todos' AND (f.nombre IS NULL OR f.nombre NOT IN ('MEDICO', 'MÉDICO')))
        OR (pr.tipo_alcance = 'familia'      AND p.familia_id      = pr.alcance_id)
        OR (pr.tipo_alcance = 'categoria'    AND p.categoria_id    = pr.alcance_id)
        OR (pr.tipo_alcance = 'subcategoria' AND p.subcategoria_id = pr.alcance_id)
        OR (pr.tipo_alcance = 'productos' AND EXISTS (
              SELECT 1 FROM pos_promocion_productos x
              WHERE x.promocion_id = pr.id AND x.producto_id = p.id))
      )
     WHERE p.id IN (?)
       AND p.clasificacion_cofepris IN ('libre', 'venta_farmacia')
     ORDER BY p.id, pr.porcentaje DESC, pr.id ASC`,
    [empresaId, bit, fecha, fecha, clienteFlags.adultoMayor ? 1 : 0, clienteFlags.lealtad ? 1 : 0, ids]
  );

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.producto_id)) {
      map.set(r.producto_id, { pct: Number(r.porcentaje), promocion_id: r.promocion_id, nombre: r.nombre });
    }
  }
  return map;
}

function serializar(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    porcentaje: Number(row.porcentaje),
    tipo_alcance: row.tipo_alcance,
    alcance_id: row.alcance_id,
    requiere_cliente: row.requiere_cliente,
    dias_semana: diasFromBitmask(row.dias_semana),
    vigencia_desde: row.vigencia_desde,
    vigencia_hasta: row.vigencia_hasta,
    activo: !!row.activo,
    created_at: row.created_at,
  };
}

const TABLA_ALCANCE = { familia: 'familias', categoria: 'categorias_prod', subcategoria: 'subcategorias_prod' };

async function listar(empresaId) {
  const [rows] = await pool.query(
    `SELECT * FROM pos_promociones WHERE empresa_id = ? ORDER BY activo DESC, nombre`,
    [empresaId]
  );
  const promos = rows.map(serializar);
  const porId = new Map(promos.map((p) => [p.id, p]));

  // Nombre legible del alcance (familia/categoría/subcategoría) para la
  // pantalla — 3 consultas puntuales en vez de un JOIN a 3 tablas distintas
  // según tipo_alcance (alcance_id es polimórfico, ver migrate_v46). Las 3
  // son independientes entre sí, así que se disparan en paralelo.
  await Promise.all(Object.entries(TABLA_ALCANCE).map(async ([tipo, tabla]) => {
    const ids = [...new Set(rows.filter((r) => r.tipo_alcance === tipo).map((r) => r.alcance_id))];
    if (!ids.length) return;
    const [nombres] = await pool.query(`SELECT id, nombre FROM ${tabla} WHERE id IN (?)`, [ids]);
    const porNombreId = new Map(nombres.map((n) => [n.id, n.nombre]));
    for (const r of rows) {
      if (r.tipo_alcance === tipo) porId.get(r.id).alcance_nombre = porNombreId.get(r.alcance_id) || null;
    }
  }));

  const idsProductos = rows.filter((r) => r.tipo_alcance === 'productos').map((r) => r.id);
  if (idsProductos.length) {
    const [prods] = await pool.query(
      `SELECT pp.promocion_id, p.id AS producto_id, p.sku_interno, p.descripcion
       FROM pos_promocion_productos pp JOIN productos p ON p.id = pp.producto_id
       WHERE pp.promocion_id IN (?)`,
      [idsProductos]
    );
    const porPromo = new Map();
    for (const p of prods) {
      if (!porPromo.has(p.promocion_id)) porPromo.set(p.promocion_id, []);
      porPromo.get(p.promocion_id).push({ producto_id: p.producto_id, sku_interno: p.sku_interno, descripcion: p.descripcion });
    }
    for (const promo of promos) promo.productos = porPromo.get(promo.id) || [];
  }
  return promos;
}

const REQUIERE_CLIENTE = ['nadie', 'adulto_mayor', 'programa_lealtad'];

function validar({ nombre, porcentaje, tipo_alcance, alcance_id, producto_ids, requiere_cliente }) {
  if (!nombre?.trim()) throw badRequest('nombre requerido');
  const pct = Number(porcentaje);
  if (!(pct > 0) || pct > 100) throw badRequest('porcentaje debe ser mayor a 0 y máximo 100');
  const alcances = ['todos', 'familia', 'categoria', 'subcategoria', 'productos'];
  if (!alcances.includes(tipo_alcance)) throw badRequest('tipo_alcance inválido');
  if (['familia', 'categoria', 'subcategoria'].includes(tipo_alcance) && !alcance_id) {
    throw badRequest('alcance_id requerido para este tipo de alcance');
  }
  // Falla en silencio si no: la promoción se guardaría pero nunca aplicaría a
  // nada (el EXISTS contra pos_promocion_productos nunca matchea), sin que
  // el admin se entere de por qué no funcionó.
  if (tipo_alcance === 'productos' && !(Array.isArray(producto_ids) && producto_ids.length)) {
    throw badRequest('Selecciona al menos un producto para este tipo de alcance');
  }
  if (requiere_cliente !== undefined && !REQUIERE_CLIENTE.includes(requiere_cliente)) {
    throw badRequest('requiere_cliente inválido');
  }
}

// Columnas comunes a INSERT y UPDATE, en el mismo orden en ambos — evita que
// crear()/actualizar() diverjan en cómo normalizan cada campo.
function camposPromocion(data) {
  return [
    data.nombre.trim(), Number(data.porcentaje), data.tipo_alcance, data.requiere_cliente || 'nadie',
    ['familia', 'categoria', 'subcategoria'].includes(data.tipo_alcance) ? data.alcance_id : null,
    bitmaskFromDias(data.dias_semana), data.vigencia_desde || null, data.vigencia_hasta || null,
    data.activo === false ? 0 : 1,
  ];
}

async function crear(empresaId, data, usuarioId) {
  validar(data);
  const [r] = await pool.query(
    `INSERT INTO pos_promociones
       (empresa_id, nombre, porcentaje, tipo_alcance, requiere_cliente, alcance_id, dias_semana,
        vigencia_desde, vigencia_hasta, activo, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, ...camposPromocion(data), usuarioId]
  );
  if (data.tipo_alcance === 'productos' && Array.isArray(data.producto_ids)) {
    await reemplazarProductos(empresaId, r.insertId, data.producto_ids);
  }
  return { id: r.insertId };
}

async function actualizar(empresaId, id, data) {
  await getScoped(pool, 'pos_promociones', id, empresaId);
  validar(data);
  await pool.query(
    `UPDATE pos_promociones
     SET nombre = ?, porcentaje = ?, tipo_alcance = ?, requiere_cliente = ?, alcance_id = ?, dias_semana = ?,
         vigencia_desde = ?, vigencia_hasta = ?, activo = ?
     WHERE id = ? AND empresa_id = ?`,
    [...camposPromocion(data), id, empresaId]
  );
  if (data.tipo_alcance === 'productos' && Array.isArray(data.producto_ids)) {
    await reemplazarProductos(empresaId, id, data.producto_ids);
  }
  return { ok: true };
}

// Reemplazo total de la lista de productos de una promoción (no diff), mismo
// criterio que PUT /pos/sucursales/:id/horarios (reemplazo total de semana).
async function reemplazarProductos(empresaId, promocionId, productoIds) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM pos_promocion_productos WHERE promocion_id = ? AND empresa_id = ?', [promocionId, empresaId]);
    const ids = [...new Set(productoIds.filter(Boolean).map(Number))];
    if (ids.length) {
      await conn.query(
        'INSERT INTO pos_promocion_productos (empresa_id, promocion_id, producto_id) VALUES ?',
        [ids.map((productoId) => [empresaId, promocionId, productoId])]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function eliminar(empresaId, id) {
  await getScoped(pool, 'pos_promociones', id, empresaId);
  await pool.query('UPDATE pos_promociones SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  return { ok: true };
}

module.exports = { hoyLocal, descuentosPara, listar, crear, actualizar, eliminar };
