/**
 * pos.cfdi.service.js — CFDI del mostrador (Entrega 4 del MVP POS).
 *
 * - Factura INDIVIDUAL: el cliente da su RFC en caja; receptor capturado,
 *   conceptos con las claves SAT del producto. El precio público YA incluye
 *   IVA → se desglosa (UnitPrice sin IVA).
 * - Factura GLOBAL: agrupa tickets sin factura del periodo al RFC genérico
 *   XAXX010101000 con GlobalInformation (Periodicity/Months/Year), un
 *   concepto por ticket (regla SAT: ProductCode 01010101, IdentificationNumber
 *   = folio del ticket). Dos pasos con candados: borrador (marca los tickets
 *   transaccionalmente) → timbrar (cerrojo por estatus). Nada se timbra sin
 *   confirmación del usuario; liberar tickets de una global fallida es una
 *   acción manual explícita.
 *
 * Regla de FormaPago en pago mixto: el método con mayor monto (criterio
 * aceptado para PUE). 01 = efectivo, 04 = tarjeta de crédito.
 *
 * NOTA multiemisor: el timbre sale con el perfil Facturama de la cuenta (un
 * RFC). Timbrar con el RFC de cada farmacia cliente requiere cuenta/perfil
 * propio del PAC — Fase 3 (los datos fiscales por empresa ya existen).
 */
const { pool } = require('../../config/db');
const { timbrarComprobante, insertarComprobante } = require('../ventas/cfdi.facturama');
const { empresaCfdi } = require('../ventas/cfdi.txt.generator');
const { getScoped } = require('./pos.tenant.helpers');

const n2 = (n) => Number(n || 0).toFixed(2);
const n6 = (n) => Number(n || 0).toFixed(6);

function formaPago(venta) {
  const ef = Number(venta.pago_efectivo); const tj = Number(venta.pago_tarjeta);
  return tj > ef ? '04' : '01';
}

// ── Factura individual ────────────────────────────────────────────────

async function facturarVenta(empresaId, ventaId, receptor = {}, usuarioId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const venta = await getScoped(conn, 'pos_ventas', ventaId, empresaId, { forUpdate: true });
    if (venta.estatus !== 'completada') {
      throw Object.assign(new Error('La venta está cancelada'), { status: 409 });
    }
    if (venta.factura_estado !== 'sin_factura') {
      throw Object.assign(new Error(
        venta.factura_estado === 'global'
          ? 'La venta ya entró a una factura global; habría que cancelar la global primero (proceso manual)'
          : 'La venta ya tiene factura individual'
      ), { status: 409 });
    }

    // Receptor obligatorio (CFDI 4.0)
    const faltantes = [];
    for (const [campo, valor] of Object.entries({
      rfc: receptor.rfc, razon_social: receptor.razon_social,
      codigo_postal: receptor.codigo_postal, regimen_fiscal: receptor.regimen_fiscal,
      uso_cfdi: receptor.uso_cfdi,
    })) if (!String(valor || '').trim()) faltantes.push(`receptor.${campo}`);

    // Conceptos con claves SAT del producto
    const [partidas] = await conn.query(
      `SELECT pp.*, p.clave_sat, p.clave_unidad_sat, p.unidad_medida, p.sku_interno
       FROM pos_ventas_partidas pp JOIN productos p ON p.id = pp.producto_id
       WHERE pp.venta_id = ?`, [ventaId]
    );
    for (const p of partidas) {
      if (!p.clave_sat) faltantes.push(`clave_sat de "${p.descripcion}"`);
      if (!p.clave_unidad_sat) faltantes.push(`clave_unidad_sat de "${p.descripcion}"`);
    }
    if (faltantes.length) {
      throw Object.assign(new Error('Faltan datos fiscales para CFDI 4.0'), { status: 422, faltantes });
    }

    const items = partidas.map((p) => {
      // precio público con IVA → base sin IVA para el CFDI. La tasa viene del
      // snapshot de la venta (iva_tasa): medicamentos TASA 0, resto 0.16.
      // Ambos son TaxObject 02 (sí objeto) — tasa 0 NO es exento (01).
      const importeConIva = Number(p.importe);
      const tasa = Number(p.iva_tasa);
      const base = importeConIva / (1 + tasa);
      const cant = Number(p.cantidad);
      return {
        Quantity: n2(cant),
        ProductCode: p.clave_sat,
        UnitCode: p.clave_unidad_sat,
        Unit: p.unidad_medida || 'Pieza',
        Description: p.descripcion,
        IdentificationNumber: p.sku_interno,
        UnitPrice: n6(base / cant),
        Subtotal: n2(base),
        Discount: '0.00',
        TaxObject: '02',
        Taxes: [{
          Name: 'IVA', Rate: n6(tasa), Total: n2(importeConIva - base),
          Base: n2(base), IsRetention: false, IsFederalTax: true,
        }],
        Total: n2(importeConIva),
      };
    });

    const body = {
      Receiver: {
        Name: receptor.razon_social.trim().toUpperCase(),
        CfdiUse: receptor.uso_cfdi,
        Rfc: receptor.rfc.trim().toUpperCase(),
        FiscalRegime: receptor.regimen_fiscal,
        TaxZipCode: receptor.codigo_postal,
      },
      CfdiType: 'I',
      ExpeditionPlace: empresaCfdi().cp,
      PaymentForm: formaPago(venta),
      PaymentMethod: 'PUE',
      Currency: 'MXN',
      Exportation: '01',
      Items: items,
    };
    if (process.env.FACTURAMA_SERIE) body.Serie = process.env.FACTURAMA_SERIE;

    const { resp, cfdiData, xmlPath, qrUrl } = await timbrarComprobante(body, {
      folioArchivo: venta.folio,
    });
    const cfdiId = await insertarComprobante(conn, {
      origen: 'pos_venta', pos_venta_id: ventaId,
      resp, cfdiData, xmlPath, qrUrl,
    });
    await conn.query(
      `UPDATE pos_ventas SET factura_estado = 'individual', cfdi_id = ?,
        receptor_rfc = ?, receptor_razon = ?, receptor_cp = ?, receptor_regimen = ?, receptor_uso = ?
       WHERE id = ?`,
      [cfdiId, receptor.rfc.trim().toUpperCase(), receptor.razon_social.trim(),
       receptor.codigo_postal, receptor.regimen_fiscal, receptor.uso_cfdi, ventaId]
    );
    await conn.commit();
    return { uuid: cfdiData.uuid, cfdi_id: cfdiId, xml_url: xmlPath, qr_url: qrUrl };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Factura global (dos pasos) ────────────────────────────────────────

/** Paso 1: borrador que MARCA los tickets del periodo (candado transaccional). */
async function crearFacturaGlobal(empresaId, { periodicidad, desde, hasta, sucursal_id = null, usuario_id }) {
  if (!['01', '02', '03', '04', '05'].includes(periodicidad)) {
    throw Object.assign(new Error('Periodicidad inválida (c_Periodicidad: 01 diaria … 04 mensual)'), { status: 400 });
  }
  if (!desde || !hasta) {
    throw Object.assign(new Error('desde y hasta requeridos'), { status: 400 });
  }
  const fin = new Date(hasta);
  const meses = String(fin.getMonth() + 1).padStart(2, '0');
  const anio = fin.getFullYear();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (sucursal_id) await getScoped(conn, 'sucursales', sucursal_id, empresaId);
    const [rg] = await conn.query(
      `INSERT INTO pos_facturas_globales
         (empresa_id, sucursal_id, periodicidad, meses, anio, desde, hasta, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, sucursal_id, periodicidad, meses, anio, desde, hasta, usuario_id]
    );
    const globalId = rg.insertId;

    // El UPDATE condicionado es el candado: dos globales simultáneas no
    // pueden tomar el mismo ticket (factura_global_id IS NULL).
    const params = [globalId, empresaId, desde, hasta];
    let filtroSuc = '';
    if (sucursal_id) { filtroSuc = ' AND sucursal_id = ?'; params.push(sucursal_id); }
    const [ru] = await conn.query(
      `UPDATE pos_ventas SET factura_global_id = ?
       WHERE empresa_id = ? AND estatus = 'completada'
         AND factura_estado = 'sin_factura' AND cfdi_id IS NULL AND factura_global_id IS NULL
         AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)${filtroSuc}`,
      params
    );
    if (!ru.affectedRows) {
      throw Object.assign(new Error('No hay tickets por facturar en ese periodo'), { status: 422 });
    }
    const [[tot]] = await conn.query(
      'SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM pos_ventas WHERE factura_global_id = ?',
      [globalId]
    );
    await conn.query(
      'UPDATE pos_facturas_globales SET num_tickets = ?, total = ? WHERE id = ?',
      [tot.n, tot.total, globalId]
    );
    await conn.commit();
    return { id: globalId, num_tickets: tot.n, total: Number(tot.total), periodicidad, meses, anio, desde, hasta };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Paso 2: timbrar el borrador (cerrojo por estatus con affectedRows). */
async function timbrarFacturaGlobal(empresaId, globalId) {
  // Cerrojo: solo procede desde borrador|error; una segunda llamada simultánea no pasa.
  const [lock] = await pool.query(
    `UPDATE pos_facturas_globales SET estatus = 'borrador'
     WHERE id = ? AND empresa_id = ? AND estatus IN ('borrador', 'error')`,
    [globalId, empresaId]
  );
  if (!lock.affectedRows) {
    throw Object.assign(new Error('La factura global ya fue timbrada o cancelada'), { status: 409 });
  }
  const [[global]] = await pool.query(
    'SELECT * FROM pos_facturas_globales WHERE id = ? AND empresa_id = ?', [globalId, empresaId]
  );
  const [tickets] = await pool.query(
    "SELECT * FROM pos_ventas WHERE factura_global_id = ? AND estatus = 'completada' ORDER BY id",
    [globalId]
  );
  if (!tickets.length) {
    throw Object.assign(new Error('La global no tiene tickets vigentes (¿se cancelaron?)'), { status: 422 });
  }

  // Un concepto por ticket (regla SAT de factura global); si el ticket mezcla
  // tasas (medicamento TASA 0 + gravado 16%), se parte en un concepto por tasa
  // con el mismo folio en IdentificationNumber. Siempre TaxObject 02.
  const [grupos] = await pool.query(
    `SELECT pp.venta_id, pp.iva_tasa, SUM(pp.importe) AS importe
     FROM pos_ventas_partidas pp
     JOIN pos_ventas v ON v.id = pp.venta_id
     WHERE v.factura_global_id = ? AND v.estatus = 'completada'
     GROUP BY pp.venta_id, pp.iva_tasa`,
    [globalId]
  );
  const porTicket = new Map();
  for (const g of grupos) {
    if (!porTicket.has(g.venta_id)) porTicket.set(g.venta_id, []);
    porTicket.get(g.venta_id).push(g);
  }
  const items = tickets.flatMap((t) =>
    (porTicket.get(t.id) || []).map((g) => {
      const conIva = Number(g.importe);
      const tasa = Number(g.iva_tasa);
      const base = conIva / (1 + tasa);
      return {
        Quantity: '1.00',
        ProductCode: '01010101',
        UnitCode: 'ACT',
        Unit: 'Actividad',
        Description: 'Venta',
        IdentificationNumber: t.folio,
        UnitPrice: n6(base),
        Subtotal: n2(base),
        Discount: '0.00',
        TaxObject: '02',
        Taxes: [{
          Name: 'IVA', Rate: n6(tasa), Total: n2(conIva - base),
          Base: n2(base), IsRetention: false, IsFederalTax: true,
        }],
        Total: n2(conIva),
      };
    })
  );

  const body = {
    Receiver: {
      Name: 'PUBLICO EN GENERAL',
      CfdiUse: 'S01',
      Rfc: 'XAXX010101000',
      FiscalRegime: '616',
      TaxZipCode: empresaCfdi().cp,
    },
    CfdiType: 'I',
    ExpeditionPlace: empresaCfdi().cp,
    PaymentForm: '01',
    PaymentMethod: 'PUE',
    Currency: 'MXN',
    Exportation: '01',
    GlobalInformation: {
      Periodicity: global.periodicidad,
      Months: global.meses,
      Year: global.anio,
    },
    Items: items,
  };
  if (process.env.FACTURAMA_SERIE) body.Serie = process.env.FACTURAMA_SERIE;

  try {
    const { resp, cfdiData, xmlPath, qrUrl } = await timbrarComprobante(body, {
      folioArchivo: `GLOBAL-${global.anio}-${String(globalId).padStart(4, '0')}`,
    });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const cfdiId = await insertarComprobante(conn, {
        origen: 'pos_global', pos_factura_global_id: globalId,
        resp, cfdiData, xmlPath, qrUrl,
      });
      await conn.query(
        "UPDATE pos_facturas_globales SET estatus = 'timbrada', cfdi_id = ?, error_msg = NULL WHERE id = ?",
        [cfdiId, globalId]
      );
      await conn.query(
        "UPDATE pos_ventas SET factura_estado = 'global' WHERE factura_global_id = ?",
        [globalId]
      );
      await conn.commit();
      return { uuid: cfdiData.uuid, cfdi_id: cfdiId, xml_url: xmlPath };
    } catch (err) {
      await conn.rollback(); throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    // El timbre falló: queda en 'error' re-timbrable; los tickets siguen
    // marcados (liberarlos es decisión explícita del usuario, nunca automática).
    await pool.query(
      "UPDATE pos_facturas_globales SET estatus = 'error', error_msg = ? WHERE id = ?",
      [err.message, globalId]
    );
    throw err;
  }
}

/** Acción manual: soltar los tickets de una global en borrador/error. */
async function liberarTickets(empresaId, globalId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [lock] = await conn.query(
      `UPDATE pos_facturas_globales SET estatus = 'cancelada'
       WHERE id = ? AND empresa_id = ? AND estatus IN ('borrador', 'error')`,
      [globalId, empresaId]
    );
    if (!lock.affectedRows) {
      throw Object.assign(new Error('Solo se pueden liberar globales en borrador o error'), { status: 409 });
    }
    await conn.query('UPDATE pos_ventas SET factura_global_id = NULL WHERE factura_global_id = ?', [globalId]);
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listarGlobales(empresaId) {
  const [rows] = await pool.query(
    `SELECT g.*, u.nombre AS creado_por_nombre, s.nombre AS sucursal,
            c.uuid, c.xml_path, c.pdf_path
     FROM pos_facturas_globales g
     JOIN usuarios u ON u.id = g.creado_por
     LEFT JOIN sucursales s ON s.id = g.sucursal_id
     LEFT JOIN cfdi_comprobantes c ON c.id = g.cfdi_id
     WHERE g.empresa_id = ?
     ORDER BY g.id DESC LIMIT 100`,
    [empresaId]
  );
  return rows;
}

module.exports = { facturarVenta, crearFacturaGlobal, timbrarFacturaGlobal, liberarTickets, listarGlobales };
