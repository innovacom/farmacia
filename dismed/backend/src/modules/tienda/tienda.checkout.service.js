/**
 * tienda.checkout.service.js — Cobro en línea con Stripe Checkout (hospedado
 * en checkout.stripe.com, sin formulario de tarjeta propio). Ver migrate_v59
 * para el porqué de `tienda_checkout_sesiones` como mesa de armado y por qué
 * `pedidos_tienda` SOLO nace dentro del webhook, nunca aquí.
 *
 * Reglas duras (decididas con el usuario, no configurables):
 *  - Solo productos SIN receta (clasificacion_cofepris IN CLASIF_LIBRES)
 *    pueden pagarse en línea — lo controlado se sigue pidiendo por WhatsApp.
 *  - El precio SIEMPRE se recalcula aquí con el mismo resolver que usan
 *    POS/WhatsApp/el catálogo (pos.promociones.service#descuentosPara);
 *    cualquier precio que mande el cliente se ignora por completo.
 *  - Cantidad siempre entera (Stripe cobra por `quantity` entera).
 *  - El IVA se calcula "hacia atrás" desde un precio que YA lo incluye,
 *    exactamente como whatsapp.carrito.service#confirmarPedidoFinal — mismo
 *    carrito comprado por WhatsApp o por la tienda debe dar el mismo
 *    subtotal/iva en el libro. A Stripe se le manda un solo unit_amount con
 *    impuesto incluido; NO se activa Stripe Tax.
 */
const { pool } = require('../../config/db');
const inv = require('../inventario/movimientos.service');
const promociones = require('../pos/pos.promociones.service');
const branding = require('../../services/branding.service');
const stripeConfig = require('./tienda.stripe.config');

const CLASIF_LIBRES = ['libre', 'venta_farmacia'];
const IVA_TASA_GRAVADO = 0.16;
const MONTO_MINIMO_MXN = 10; // mínimo de cobro de Stripe para MXN
const EMAIL_PATRON = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

function centavos(monto) {
  return Math.round(Number(monto) * 100);
}

/**
 * iniciar() — valida el carrito completo contra la BD, arma la sesión de
 * Stripe Checkout y deja el rastro en tienda_checkout_sesiones. No toca
 * inventario ni crea pedido — eso solo pasa en confirmarPago(), desde el
 * webhook.
 */
async function iniciar(empresaId, payload, { ip } = {}) {
  const stripe = stripeConfig.cliente();
  if (!stripe) throw Object.assign(new Error('El pago en línea no está disponible por el momento'), { status: 503 });

  const {
    items, sucursal_id, forma_entrega, direccion_entrega,
    nombre_recibe, telefono, correo,
  } = payload || {};

  if (!Array.isArray(items) || !items.length) throw badRequest('El carrito está vacío');
  if (!['pickup', 'domicilio'].includes(forma_entrega)) throw badRequest('Forma de entrega inválida');
  if (forma_entrega === 'domicilio' && !direccion_entrega?.trim()) throw badRequest('Falta la dirección de entrega');
  if (!nombre_recibe?.trim()) throw badRequest('Falta el nombre de quien recibe');
  if (!telefono?.trim()) throw badRequest('Falta un teléfono de contacto');
  if (!EMAIL_PATRON.test(correo || '')) throw badRequest('Correo inválido');

  const carrito = items.map((it) => ({
    producto_id: Number(it?.producto_id),
    cantidad: Number(it?.cantidad),
  }));
  if (carrito.some((it) => !Number.isInteger(it.producto_id) || it.producto_id <= 0)) {
    throw badRequest('Carrito inválido');
  }
  if (carrito.some((it) => !Number.isInteger(it.cantidad) || it.cantidad < 1 || it.cantidad > 99)) {
    throw badRequest('Cantidad inválida (1 a 99 piezas por producto)');
  }

  const [[suc]] = await pool.query(
    'SELECT id, almacen_id FROM sucursales WHERE id = ? AND empresa_id = ? AND activo = 1 AND publicar_web = 1',
    [sucursal_id, empresaId]
  );
  if (!suc) throw badRequest('Sucursal inválida');

  const productoIds = carrito.map((it) => it.producto_id);
  const [prodRows] = await pool.query(
    `SELECT p.id, p.descripcion, p.precio_lista, p.iva_exento, p.clasificacion_cofepris,
            COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l
                       WHERE l.producto_id = p.id AND l.almacen_id = ?), 0) AS existencia
       FROM productos p
      WHERE p.id IN (?) AND p.activo = 1 AND p.publicar_web = 1`,
    [suc.almacen_id, productoIds]
  );
  const productosPorId = new Map(prodRows.map((p) => [p.id, p]));

  for (const it of carrito) {
    const prod = productosPorId.get(it.producto_id);
    if (!prod) throw badRequest('Uno o más productos ya no están disponibles');
    if (!CLASIF_LIBRES.includes(prod.clasificacion_cofepris)) {
      throw badRequest(`"${prod.descripcion}" requiere receta médica — pídelo por WhatsApp`);
    }
    if (Number(prod.existencia) < it.cantidad) {
      throw badRequest(`Sin existencia suficiente de "${prod.descripcion}"`);
    }
  }

  // Mismo resolver que POS/WhatsApp/catálogo — nunca se confía en un precio
  // que mande el cliente.
  const promos = await promociones.descuentosPara(pool, empresaId, productoIds);

  let subtotal = 0; let iva = 0;
  const itemsProcesados = carrito.map((it) => {
    const prod = productosPorId.get(it.producto_id);
    const promo = promos.get(it.producto_id);
    const precioUnitario = promo
      ? Math.round(Number(prod.precio_lista) * (1 - promo.pct / 100) * 100) / 100
      : Number(prod.precio_lista);
    const ivaTasa = prod.iva_exento ? 0 : IVA_TASA_GRAVADO;
    const importe = Math.round(it.cantidad * precioUnitario * 100) / 100;
    const importeSinIva = Math.round((importe / (1 + ivaTasa)) * 100) / 100;
    subtotal += importeSinIva;
    iva += importe - importeSinIva;
    return {
      producto_id: it.producto_id, descripcion: prod.descripcion, cantidad: it.cantidad,
      precio_unitario: precioUnitario, iva_tasa: ivaTasa, importe,
    };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  iva = Math.round(iva * 100) / 100;

  // Envío: tarifa fija, tax-inclusive igual que todo lo demás.
  let costoEnvio = 0;
  if (forma_entrega === 'domicilio') {
    const b = await branding.getBranding(empresaId);
    costoEnvio = Number(b.config.tienda_envio_domicilio_costo || 0);
    if (costoEnvio > 0) {
      const envioSinIva = Math.round((costoEnvio / (1 + IVA_TASA_GRAVADO)) * 100) / 100;
      subtotal = Math.round((subtotal + envioSinIva) * 100) / 100;
      iva = Math.round((iva + (costoEnvio - envioSinIva)) * 100) / 100;
    }
  }
  const total = Math.round((subtotal + iva) * 100) / 100;

  if (total < MONTO_MINIMO_MXN) {
    throw badRequest(`El monto mínimo para pagar en línea es $${MONTO_MINIMO_MXN.toFixed(2)} MXN; para importes menores, pídelo por WhatsApp`);
  }

  const [ins] = await pool.query(
    `INSERT INTO tienda_checkout_sesiones
       (empresa_id, sucursal_id, nombre_recibe, telefono, correo, forma_entrega, direccion_entrega,
        costo_envio, subtotal, iva, total, items_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, suc.id, nombre_recibe.trim(), telefono.trim(), correo.trim().toLowerCase(),
     forma_entrega, direccion_entrega?.trim() || null, costoEnvio, subtotal, iva, total,
     JSON.stringify(itemsProcesados), ip || null]
  );
  const checkoutId = ins.insertId;

  let session;
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: itemsProcesados.map((it) => ({
        price_data: {
          currency: 'mxn',
          product_data: { name: it.descripcion },
          unit_amount: centavos(it.precio_unitario),
        },
        quantity: it.cantidad,
      })),
      shipping_options: forma_entrega === 'domicilio' && costoEnvio > 0 ? [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: centavos(costoEnvio), currency: 'mxn' },
          display_name: 'Envío a domicilio',
        },
      }] : undefined,
      customer_email: correo.trim().toLowerCase(),
      metadata: { checkout_id: String(checkoutId) },
      success_url: `${frontendUrl}/tienda/pedido/exito?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/tienda/carrito`,
    });
  } catch (err) {
    console.error('[tienda-checkout] error creando sesión de Stripe:', err.message);
    throw Object.assign(new Error('No se pudo iniciar el pago; intenta de nuevo en unos minutos'), { status: 502 });
  }

  await pool.query('UPDATE tienda_checkout_sesiones SET stripe_session_id = ? WHERE id = ?', [session.id, checkoutId]);

  return { url: session.url };
}

/**
 * confirmarPago() — llamada SOLO por el webhook, con el `session` de Stripe
 * ya verificado (firma correcta) y con payment_status === 'paid'. Tres capas
 * de idempotencia (ver migrate_v59): pre-check aquí, UNIQUE stripe_session_id
 * en la segunda sentencia de la transacción (antes del FEFO), y el catch de
 * ER_DUP_ENTRY como respaldo de una carrera real entre dos entregas del
 * mismo evento.
 */
async function confirmarPago(session) {
  if (session.payment_status !== 'paid') return { ignorado: true };

  const [[ya]] = await pool.query('SELECT id FROM pedidos_tienda WHERE stripe_session_id = ?', [session.id]);
  if (ya) return { yaProcesado: true };

  const checkoutId = Number(session.metadata?.checkout_id);
  // Sin checkout_id válido no hay nada que consultar (ej. eventos sintéticos
  // de `stripe trigger`, que no traen el metadata de iniciar() — NaN como
  // parámetro rompe la consulta en vez de simplemente no encontrar nada).
  const chk = Number.isInteger(checkoutId)
    ? (await pool.query('SELECT * FROM tienda_checkout_sesiones WHERE id = ?', [checkoutId]))[0][0]
    : null;
  if (!chk) {
    console.error('[tienda-checkout] webhook sin checkout_id válido en metadata, session:', session.id);
    return { error: 'checkout no encontrado' };
  }
  const [[suc]] = await pool.query('SELECT id, almacen_id FROM sucursales WHERE id = ?', [chk.sucursal_id]);
  const items = JSON.parse(chk.items_json);
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

  const conn = await pool.getConnection();
  let pedidoId = null; let folio = null; let faltante = null;
  try {
    await conn.beginTransaction();
    folio = await inv.genFolio(conn, 'WEB');

    let ins;
    try {
      [ins] = await conn.query(
        `INSERT INTO pedidos_tienda
           (empresa_id, folio, checkout_id, sucursal_id, nombre_recibe, telefono, correo,
            forma_entrega, direccion_entrega, stripe_session_id, stripe_payment_intent_id,
            costo_envio, subtotal, iva, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [chk.empresa_id, folio, checkoutId, chk.sucursal_id, chk.nombre_recibe, chk.telefono, chk.correo,
         chk.forma_entrega, chk.direccion_entrega, session.id, paymentIntentId,
         chk.costo_envio, chk.subtotal, chk.iva, chk.total]
      );
    } catch (err) {
      await conn.rollback();
      // Carrera sobre el mismo stripe_session_id: el UNIQUE es el respaldo,
      // igual que pos_ventas.client_uuid. El WHERE calza exacto con el
      // índice — nada de "AND empresa_id" que podría no encontrar nada.
      if (err.code === 'ER_DUP_ENTRY') {
        const [[ya2]] = await pool.query('SELECT id FROM pedidos_tienda WHERE stripe_session_id = ?', [session.id]);
        if (ya2) return { yaProcesado: true };
      }
      throw err;
    }
    pedidoId = ins.insertId;

    const partidas = [];
    for (const it of items) {
      try {
        const salida = await inv.registrarSalidaFEFO(conn, {
          producto_id: it.producto_id, cantidad: it.cantidad, motivo: 'pedido_tienda',
          referencia: folio, usuario_id: null, almacen_id: suc.almacen_id,
        });
        partidas.push({ ...it, lotes_json: JSON.stringify(salida.lotes) });
      } catch (e) {
        faltante = it;
        break;
      }
    }

    if (faltante) {
      await conn.rollback();
    } else {
      for (const p of partidas) {
        await conn.query(
          `INSERT INTO pedidos_tienda_partidas
             (pedido_id, producto_id, descripcion, cantidad, precio_unitario, iva_tasa, importe, lotes_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [pedidoId, p.producto_id, p.descripcion, p.cantidad, p.precio_unitario, p.iva_tasa, p.importe, p.lotes_json]
        );
      }
      await conn.query(`UPDATE tienda_checkout_sesiones SET estatus = 'pagado', pedido_id = ? WHERE id = ?`, [pedidoId, checkoutId]);
      await conn.commit();
      return { pedidoId, folio, cancelado: false };
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Llegamos aquí solo si faltó existencia: se cobró pero no se puede surtir.
  // Se cancela y reembolsa FUERA de la transacción que se acaba de deshacer.
  return await crearPedidoCanceladoYReembolsar({ chk, checkoutId, session, paymentIntentId, faltante });
}

async function crearPedidoCanceladoYReembolsar({ chk, checkoutId, session, paymentIntentId, faltante }) {
  const conn = await pool.getConnection();
  let pedidoId; let folio;
  try {
    await conn.beginTransaction();
    folio = await inv.genFolio(conn, 'WEB');
    const motivo = `Sin existencia de "${faltante?.descripcion || 'un producto'}" al confirmarse el pago — se reembolsó automáticamente`;
    const [ins] = await conn.query(
      `INSERT INTO pedidos_tienda
         (empresa_id, folio, checkout_id, sucursal_id, nombre_recibe, telefono, correo,
          forma_entrega, direccion_entrega, estatus, stripe_session_id, stripe_payment_intent_id,
          costo_envio, subtotal, iva, total, motivo_cancelacion, cancelado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cancelado', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [chk.empresa_id, folio, checkoutId, chk.sucursal_id, chk.nombre_recibe, chk.telefono, chk.correo,
       chk.forma_entrega, chk.direccion_entrega, session.id, paymentIntentId,
       chk.costo_envio, chk.subtotal, chk.iva, chk.total, motivo]
    );
    pedidoId = ins.insertId;
    await conn.query(`UPDATE tienda_checkout_sesiones SET estatus = 'cancelado', pedido_id = ? WHERE id = ?`, [pedidoId, checkoutId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const stripe = stripeConfig.cliente();
  try {
    if (paymentIntentId && stripe) {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId },
        { idempotencyKey: 'refund_' + session.id }
      );
      await pool.query('UPDATE pedidos_tienda SET reembolsado_en = NOW() WHERE id = ?', [pedidoId]);
    }
  } catch (err) {
    console.error('[tienda-checkout] reembolso automático falló, requiere acción manual:', session.id, err.message);
    await pool.query('UPDATE pedidos_tienda SET reembolso_error = ? WHERE id = ?', [err.message.slice(0, 255), pedidoId]);
  }

  return { pedidoId, folio, cancelado: true };
}

/** Para la página de confirmación post-redirect (?session_id=...). */
async function buscarPorSession(stripeSessionId) {
  if (!stripeSessionId) return { estatus: 'invalido' };
  const [[pedido]] = await pool.query(
    `SELECT folio, total, forma_entrega, estatus FROM pedidos_tienda WHERE stripe_session_id = ?`,
    [stripeSessionId]
  );
  if (pedido) return { estatus: 'confirmado', pedido };
  const [[chk]] = await pool.query(
    `SELECT estatus FROM tienda_checkout_sesiones WHERE stripe_session_id = ?`,
    [stripeSessionId]
  );
  // El webhook puede tardar unos segundos más que el redirect del navegador.
  return { estatus: chk ? 'procesando' : 'no_encontrado' };
}

module.exports = { iniciar, confirmarPago, buscarPorSession };
