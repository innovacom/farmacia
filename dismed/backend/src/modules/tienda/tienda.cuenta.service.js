/**
 * tienda.cuenta.service.js — Cuenta de cliente de la tienda web (Entrega 2
 * del plan "cuentas de cliente unificadas"). Sin contraseña: acceso con un
 * código de 6 dígitos de un solo uso enviado por WhatsApp (plantilla
 * AUTHENTICATION "autenticacion", id 2004297164308188, aprobada por Meta) —
 * el backend no tiene ningún servicio de correo (nodemailer no está
 * instalado, ver migrate_v61.js), así que no hay forma de recuperar una
 * contraseña olvidada; el código reemplaza tanto el login como el "olvidé
 * mi contraseña".
 *
 * El registro maestro de cliente sigue siendo `pos_clientes_fidelidad`
 * (migrate_v47) — no se crea una tabla de "usuarios de tienda" aparte. Este
 * servicio SOLO agrega la capa de acceso encima; toda la lectura/escritura
 * de datos del cliente pasa por pos.clientesfidelidad.service.js.
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { getScoped } = require('../pos/pos.tenant.helpers');
const { ultimos10, aE164 } = require('../whatsapp/whatsapp.util');
const waConfig = require('../whatsapp/whatsapp.config');
const waClient = require('../whatsapp/whatsapp.client');
const fidelidad = require('../pos/pos.clientesfidelidad.service');
const ventasService = require('../pos/pos.ventas.service');
const whatsappPedidosService = require('../whatsapp/whatsapp.pedidos.service');
const tiendaPedidosService = require('./tienda.pedidos.service');

const CODIGO_VIGENCIA_MIN = 10; // igual al texto de la plantilla ("Vence en 10 minutos")
const CODIGO_MAX_INTENTOS = 5;
const CODIGO_MAX_POR_TELEFONO_15MIN = 3;

function badRequest(msg) { return Object.assign(new Error(msg), { status: 400 }); }
function noDisponible(msg) { return Object.assign(new Error(msg), { status: 503 }); }
function demasiadas(msg) { return Object.assign(new Error(msg), { status: 429 }); }
function notFound(msg = 'No encontrado') { return Object.assign(new Error(msg), { status: 404 }); }

function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function firmarTokenCliente(cliente) {
  return jwt.sign(
    { tipo: 'cliente_tienda', cliente_id: cliente.id, empresa_id: cliente.empresa_id, nombre: cliente.nombre },
    process.env.JWT_SECRET,
    { expiresIn: '30d', audience: 'tienda-cliente' }
  );
}

/**
 * solicitarCodigo() — nunca revela si el teléfono ya tiene cuenta: genera y
 * manda el código exactamente igual para un teléfono nuevo o existente (la
 * cuenta, si hace falta, se crea hasta verificarCodigo()). El único momento
 * en que la respuesta varía es por fallas genéricas (WhatsApp no
 * configurado, límite de envíos) que no dependen de si el cliente existe.
 */
async function solicitarCodigo(empresaId, telefono, ip) {
  const normalizado = ultimos10(telefono);
  if (normalizado.length !== 10) throw badRequest('Teléfono inválido (deben ser 10 dígitos, con o sin lada 52)');
  if (!waConfig.estaConfigurado()) throw noDisponible('El acceso por WhatsApp no está disponible por el momento');

  const [[{ recientes }]] = await pool.query(
    `SELECT COUNT(*) AS recientes FROM tienda_codigos_acceso
     WHERE empresa_id = ? AND telefono_normalizado = ? AND created_at > NOW() - INTERVAL 15 MINUTE`,
    [empresaId, normalizado]
  );
  if (recientes >= CODIGO_MAX_POR_TELEFONO_15MIN) {
    throw demasiadas('Ya enviamos varios códigos a este teléfono. Espera unos minutos e inténtalo de nuevo.');
  }

  const codigo = generarCodigo();
  const hash = await bcrypt.hash(codigo, 10);
  await pool.query(
    `INSERT INTO tienda_codigos_acceso (empresa_id, telefono_normalizado, codigo_hash, expira_en, ip)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
    [empresaId, normalizado, hash, CODIGO_VIGENCIA_MIN, ip || null]
  );

  const templateName = process.env.WHATSAPP_TEMPLATE_CODIGO || 'autenticacion';
  const templateLang = process.env.WHATSAPP_TEMPLATE_CODIGO_LANG || 'es';
  await waClient.enviarPlantillaGenerica({
    telefonoE164: aE164(normalizado),
    templateName,
    templateLang,
    // Forma fija de la plantilla "autenticacion": BODY con {{1}} = código, y
    // un botón URL de un solo tap cuyo enlace también lleva el código en
    // {{1}} (autocompletado nativo — solo funciona dentro de una app móvil
    // con el mismo signature_hash; en cualquier otro caso el botón
    // simplemente no hace nada útil, el cliente igual lee el código del
    // cuerpo del mensaje y lo teclea a mano).
    componentes: [
      { type: 'body', parameters: [{ type: 'text', text: codigo }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: codigo }] },
    ],
  });

  return { ok: true };
}

/**
 * verificarCodigo() — si el teléfono no tenía cliente, lo crea aquí (nunca
 * antes: un código sin verificar no debe ensuciar pos_clientes_fidelidad)
 * con origen_alta='web'. `nombre` solo se usa para ese alta nueva; si el
 * cliente ya existe se ignora por completo — cambiar el nombre de una
 * cuenta ya registrada es cosa de Mi cuenta, no del login.
 */
async function verificarCodigo(empresaId, { telefono, codigo, nombre }, ip) {
  const normalizado = ultimos10(telefono);
  if (normalizado.length !== 10) throw badRequest('Teléfono inválido');
  if (!codigo || !/^\d{6}$/.test(String(codigo).trim())) throw badRequest('Código inválido');

  const [[fila]] = await pool.query(
    `SELECT * FROM tienda_codigos_acceso
     WHERE empresa_id = ? AND telefono_normalizado = ? AND consumido_en IS NULL AND expira_en > NOW()
     ORDER BY id DESC LIMIT 1`,
    [empresaId, normalizado]
  );
  if (!fila || fila.intentos >= CODIGO_MAX_INTENTOS) {
    throw badRequest('Código inválido o expirado. Solicita uno nuevo.');
  }

  const coincide = await bcrypt.compare(String(codigo).trim(), fila.codigo_hash);
  if (!coincide) {
    await pool.query('UPDATE tienda_codigos_acceso SET intentos = intentos + 1 WHERE id = ?', [fila.id]);
    throw badRequest('Código incorrecto');
  }
  await pool.query('UPDATE tienda_codigos_acceso SET consumido_en = NOW() WHERE id = ?', [fila.id]);

  let cliente = await fidelidad.buscarPorTelefono(empresaId, normalizado);
  if (!cliente) {
    const { id } = await fidelidad.crear(
      empresaId,
      { nombre: (nombre || '').trim() || 'Cliente', telefono: normalizado },
      null,
      { origenAlta: 'web' }
    );
    cliente = await getScoped(pool, 'pos_clientes_fidelidad', id, empresaId);
  }

  await pool.query(
    `UPDATE pos_clientes_fidelidad
     SET telefono_verificado_en = COALESCE(telefono_verificado_en, NOW()), ultimo_acceso_web = NOW()
     WHERE id = ?`,
    [cliente.id]
  );

  const token = firmarTokenCliente({ id: cliente.id, empresa_id: empresaId, nombre: cliente.nombre });
  return { token, cliente: { id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono, correo: cliente.correo } };
}

async function perfil(empresaId, clienteId) {
  const cliente = await getScoped(pool, 'pos_clientes_fidelidad', clienteId, empresaId);
  return {
    id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono, correo: cliente.correo,
    direccion_entrega: cliente.direccion_entrega,
  };
}

// Actualización de perfil DESDE la propia cuenta del cliente — a propósito
// no reusa pos.clientesfidelidad.service#actualizar (esa es la edición de
// staff, expone tarjeta_adulto_mayor/programa_lealtad/activo, que un cliente
// no debe poder tocar sobre sí mismo).
async function actualizarPerfil(empresaId, clienteId, { nombre, correo, direccion_entrega }) {
  await getScoped(pool, 'pos_clientes_fidelidad', clienteId, empresaId);
  if (!nombre?.trim()) throw badRequest('El nombre es requerido');
  await pool.query(
    `UPDATE pos_clientes_fidelidad SET nombre = ?, correo = ?, direccion_entrega = ?
     WHERE id = ? AND empresa_id = ?`,
    [nombre.trim(), correo?.trim() || null, direccion_entrega?.trim() || null, clienteId, empresaId]
  );
  return perfil(empresaId, clienteId);
}

async function pedidos(empresaId, clienteId) {
  return fidelidad.historial(empresaId, clienteId);
}

// Detalle de UN pedido propio, verificando dueño además de tenant (un id de
// otro cliente da 404, igual que un id de otra empresa — nunca 403, para no
// confirmarle a nadie que ese pedido existe).
async function detallePedido(empresaId, clienteId, origen, pedidoId) {
  const cliente = await getScoped(pool, 'pos_clientes_fidelidad', clienteId, empresaId);
  const idCliente = Number(clienteId);

  if (origen === 'mostrador') {
    const venta = await ventasService.detalleVenta(empresaId, pedidoId);
    if (Number(venta.cliente_fidelidad_id) !== idCliente) throw notFound();
    return venta;
  }
  if (origen === 'tienda') {
    const pedido = await tiendaPedidosService.detalle(empresaId, pedidoId);
    if (Number(pedido.cliente_fidelidad_id) !== idCliente) throw notFound();
    return pedido;
  }
  if (origen === 'whatsapp') {
    if (!cliente.whatsapp_contacto_id) throw notFound();
    const pedido = await whatsappPedidosService.detalle(empresaId, pedidoId);
    if (Number(pedido.contacto_id) !== Number(cliente.whatsapp_contacto_id)) throw notFound();
    return pedido;
  }
  throw badRequest('Canal inválido');
}

module.exports = { solicitarCodigo, verificarCodigo, perfil, actualizarPerfil, pedidos, detallePedido };
