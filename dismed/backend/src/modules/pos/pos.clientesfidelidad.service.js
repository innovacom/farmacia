/**
 * pos.clientesfidelidad.service.js — Clientes de fidelidad del mostrador
 * (migrate_v47). Alta rápida con solo nombre + teléfono; correo, fecha de
 * nacimiento y enfermedad crónica son opcionales. Dos casillas: tarjeta de
 * descuento para adultos mayores, y asociado a un programa de lealtad de la
 * farmacia.
 *
 * DISTINTA de la tabla `clientes` (B2B: razón social, RFC, hospital/clínica/
 * laboratorio — no aplica a un paciente de mostrador).
 *
 * Dos usos:
 *  1. Descuentos permanentes: pos.promociones.service.js#descuentosPara lee
 *     `tarjeta_adulto_mayor`/`programa_lealtad` de esta tabla (vía
 *     pos.ventas.service.js#crearVenta) para promociones con
 *     `requiere_cliente` distinto de 'nadie'.
 *  2. Envíos masivos de WhatsApp: cada alta/edición se sincroniza "mejor
 *     esfuerzo" a whatsapp_contactos (ya existente) con las etiquetas
 *     "fidelidad"/"adulto-mayor" — el selector de segmento de Envío masivo
 *     ya filtra por etiqueta, cero cambios en el módulo de WhatsApp. Si la
 *     sincronización falla (WhatsApp no configurado, etc.) no se rompe el
 *     alta del cliente — es best-effort, mismo criterio que el resto de la
 *     integración de WhatsApp en este proyecto.
 */
const { pool } = require('../../config/db');
const { getScoped } = require('./pos.tenant.helpers');
const { ultimos10, aE164 } = require('../whatsapp/whatsapp.util');
const waContactos = require('../whatsapp/whatsapp.contactos.service');

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}
function conflict(msg) {
  const err = new Error(msg);
  err.status = 409;
  return err;
}

function validar({ nombre, telefono }) {
  if (!nombre?.trim()) throw badRequest('nombre requerido');
  if (!telefono?.trim()) throw badRequest('teléfono requerido');
}

function normalizarTelefonoOFallar(telefono) {
  const normalizado = ultimos10(telefono);
  if (normalizado.length !== 10) throw badRequest('Teléfono inválido (deben ser 10 dígitos, con o sin lada 52)');
  return normalizado;
}

// Envuelve syncWhatsapp con el mismo "best-effort" en crear() y actualizar():
// si falla, no rompe el alta/edición del cliente (ver comentario del módulo)
// y conserva el whatsapp_contacto_id anterior (`actualId`, null en alta).
async function sincronizarWhatsappSeguro(empresaId, data, actualId = null) {
  try {
    return await syncWhatsapp(empresaId, {
      telefono: data.telefono, nombre: data.nombre, tarjeta_adulto_mayor: !!data.tarjeta_adulto_mayor,
    });
  } catch (e) {
    console.warn('[pos.clientesfidelidad] no se pudo sincronizar a WhatsApp:', e.message);
    return actualId;
  }
}

// Reconcilia SOLO las dos etiquetas que este módulo administra
// ("fidelidad", "adulto-mayor") sin tocar ninguna otra etiqueta que el admin
// haya puesto a mano desde Configuración → WhatsApp → Contactos.
async function syncWhatsapp(empresaId, { telefono, nombre, tarjeta_adulto_mayor }) {
  const waId = await waContactos.upsertContacto(empresaId, telefono, { nombre });
  const [[row]] = await pool.query('SELECT etiquetas FROM whatsapp_contactos WHERE id = ?', [waId]);
  let tags = String(row?.etiquetas || '').split(',').map((e) => e.trim()).filter(Boolean);
  if (!tags.includes('fidelidad')) tags.push('fidelidad');
  const tieneAM = tags.includes('adulto-mayor');
  if (tarjeta_adulto_mayor && !tieneAM) tags.push('adulto-mayor');
  if (!tarjeta_adulto_mayor && tieneAM) tags = tags.filter((t) => t !== 'adulto-mayor');
  await pool.query('UPDATE whatsapp_contactos SET etiquetas = ? WHERE id = ?', [tags.join(', '), waId]);
  return waId;
}

function serializar(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    telefono: row.telefono,
    correo: row.correo,
    fecha_nacimiento: row.fecha_nacimiento,
    enfermedad_cronica: row.enfermedad_cronica,
    tarjeta_adulto_mayor: !!row.tarjeta_adulto_mayor,
    programa_lealtad: !!row.programa_lealtad,
    activo: !!row.activo,
    origen_alta: row.origen_alta,
    direccion_entrega: row.direccion_entrega,
    created_at: row.created_at,
  };
}

async function listar(empresaId, { q } = {}) {
  const params = [empresaId];
  let where = 'empresa_id = ?';
  if (q?.trim()) {
    where += ' AND (nombre LIKE ? OR telefono_normalizado LIKE ?)';
    params.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }
  const [rows] = await pool.query(
    `SELECT * FROM pos_clientes_fidelidad WHERE ${where} ORDER BY activo DESC, nombre LIMIT 300`,
    params
  );
  return rows.map(serializar);
}

// Typeahead para el selector de venta (VentaMostrador.jsx): solo activos,
// solo lo necesario para elegir y mostrar el badge de descuento. Si el texto
// es puramente numérico también compara contra el id (el "número de
// cliente" que el cajero puede pedir directamente en vez de buscar por
// nombre/teléfono).
async function buscar(empresaId, q) {
  const texto = (q || '').trim();
  if (!texto) return [];
  const esNumerico = /^\d+$/.test(texto);
  const [rows] = await pool.query(
    `SELECT id, nombre, telefono, tarjeta_adulto_mayor, programa_lealtad
     FROM pos_clientes_fidelidad
     WHERE empresa_id = ? AND activo = 1
       AND (nombre LIKE ? OR telefono_normalizado LIKE ?${esNumerico ? ' OR id = ?' : ''})
     ORDER BY nombre LIMIT 10`,
    esNumerico
      ? [empresaId, `%${texto}%`, `%${texto}%`, texto]
      : [empresaId, `%${texto}%`, `%${texto}%`]
  );
  return rows.map((r) => ({
    id: r.id, nombre: r.nombre, telefono: r.telefono,
    tarjeta_adulto_mayor: !!r.tarjeta_adulto_mayor, programa_lealtad: !!r.programa_lealtad,
  }));
}

// `usuarioId` es NULL cuando el alta la dispara el propio cliente (Entrega 2
// tienda web, ver tienda.cuenta.service.js), no un cajero — la columna
// `creado_por` ya es nullable para ese caso. `origenAlta` idem: 'web' solo
// lo pasa ese flujo; el resto del sistema (alta desde el mostrador) sigue
// usando el default 'mostrador' de la columna.
// Busca un cliente de fidelidad activo por teléfono, sin crear nada. Usado
// por la verificación de código de la tienda web (tienda.cuenta.service.js)
// para decidir si el teléfono ya tiene cuenta o hay que dar de alta una.
async function buscarPorTelefono(empresaId, telefono) {
  const normalizado = ultimos10(telefono || '');
  if (normalizado.length !== 10) return null;
  const [[row]] = await pool.query(
    'SELECT * FROM pos_clientes_fidelidad WHERE empresa_id = ? AND telefono_normalizado = ? AND activo = 1',
    [empresaId, normalizado]
  );
  return row || null;
}

async function crear(empresaId, data, usuarioId = null, { origenAlta } = {}) {
  validar(data);
  const normalizado = normalizarTelefonoOFallar(data.telefono);
  const waContactoId = await sincronizarWhatsappSeguro(empresaId, data);

  try {
    const [r] = await pool.query(
      `INSERT INTO pos_clientes_fidelidad
         (empresa_id, nombre, telefono, telefono_normalizado, correo, fecha_nacimiento,
          enfermedad_cronica, tarjeta_adulto_mayor, programa_lealtad, whatsapp_contacto_id, creado_por, origen_alta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, data.nombre.trim(), aE164(normalizado), normalizado, data.correo?.trim() || null,
       data.fecha_nacimiento || null, data.enfermedad_cronica?.trim() || null,
       data.tarjeta_adulto_mayor ? 1 : 0, data.programa_lealtad ? 1 : 0, waContactoId, usuarioId,
       origenAlta === 'web' ? 'web' : 'mostrador']
    );
    return { id: r.insertId };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('Ya existe un cliente de fidelidad con ese teléfono');
    throw err;
  }
}

async function actualizar(empresaId, id, data) {
  const actual = await getScoped(pool, 'pos_clientes_fidelidad', id, empresaId);
  validar(data);
  const normalizado = normalizarTelefonoOFallar(data.telefono);
  const waContactoId = await sincronizarWhatsappSeguro(empresaId, data, actual.whatsapp_contacto_id);

  try {
    await pool.query(
      `UPDATE pos_clientes_fidelidad
       SET nombre = ?, telefono = ?, telefono_normalizado = ?, correo = ?, fecha_nacimiento = ?,
           enfermedad_cronica = ?, tarjeta_adulto_mayor = ?, programa_lealtad = ?,
           whatsapp_contacto_id = ?, activo = ?
       WHERE id = ? AND empresa_id = ?`,
      [data.nombre.trim(), aE164(normalizado), normalizado, data.correo?.trim() || null,
       data.fecha_nacimiento || null, data.enfermedad_cronica?.trim() || null,
       data.tarjeta_adulto_mayor ? 1 : 0, data.programa_lealtad ? 1 : 0, waContactoId,
       data.activo === false ? 0 : 1, id, empresaId]
    );
    return { ok: true };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict('Ya existe otro cliente de fidelidad con ese teléfono');
    throw err;
  }
}

async function eliminar(empresaId, id) {
  await getScoped(pool, 'pos_clientes_fidelidad', id, empresaId);
  await pool.query('UPDATE pos_clientes_fidelidad SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  return { ok: true };
}

// Historial unificado de compras del cliente en los tres canales de venta.
// getScoped primero es el candado de tenant: un id de otra empresa da 404,
// nunca datos. Cada canal se consulta por separado (esquemas distintos, sin
// vista común) y se combina en memoria — son listas de a lo más unos
// cientos de filas por cliente, no vale la pena un UNION en SQL. El detalle
// de cada pedido se resuelve aparte con las funciones que ya existen por
// canal (pos.ventas.service#detalleVenta, whatsapp.pedidos.service#detalle,
// tienda.pedidos.service#detalle) — aquí solo va la lista + el resumen.
async function historial(empresaId, id) {
  const cliente = await getScoped(pool, 'pos_clientes_fidelidad', id, empresaId);

  const [mostrador] = await pool.query(
    `SELECT id, folio, total, estatus, created_at
     FROM pos_ventas WHERE empresa_id = ? AND cliente_fidelidad_id = ?
     ORDER BY created_at DESC LIMIT 200`,
    [empresaId, id]
  );

  let whatsapp = [];
  if (cliente.whatsapp_contacto_id) {
    [whatsapp] = await pool.query(
      `SELECT id, folio, total, estatus, created_at
       FROM pedidos_whatsapp WHERE empresa_id = ? AND contacto_id = ?
       ORDER BY created_at DESC LIMIT 200`,
      [empresaId, cliente.whatsapp_contacto_id]
    );
  }

  const [tienda] = await pool.query(
    `SELECT id, folio, total, estatus, created_at
     FROM pedidos_tienda WHERE empresa_id = ? AND cliente_fidelidad_id = ?
     ORDER BY created_at DESC LIMIT 200`,
    [empresaId, id]
  );

  const pedidos = [
    ...mostrador.map((r) => ({ ...r, origen: 'mostrador' })),
    ...whatsapp.map((r) => ({ ...r, origen: 'whatsapp' })),
    ...tienda.map((r) => ({ ...r, origen: 'tienda' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const activos = pedidos.filter((p) => p.estatus !== 'cancelado');
  return {
    pedidos,
    resumen: {
      total_pedidos: activos.length,
      importe_total: activos.reduce((sum, p) => sum + Number(p.total), 0),
      ultima_compra: pedidos[0]?.created_at || null,
    },
  };
}

module.exports = { listar, buscar, buscarPorTelefono, crear, actualizar, eliminar, historial };
