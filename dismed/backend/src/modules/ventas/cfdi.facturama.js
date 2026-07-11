/**
 * cfdi.facturama.js — Timbrado, cancelación y descarga de CFDI 4.0 con el PAC Facturama (API Web).
 *
 * Reaprovecha la validación y carga de datos de cfdi.txt.generator.js (NO se reescriben).
 * El emisor (RFC, régimen, CSD) NO se manda en el body: Facturama lo toma del perfil de la cuenta.
 *
 * Variables de entorno:
 *   FACTURAMA_URL    — base, ej sandbox https://apisandbox.facturama.mx
 *   FACTURAMA_TOKEN  — token ya codificado para el header Authorization: Basic <token>
 *   FACTURAMA_SERIE  — serie opcional para el comprobante (si no existe, se omite)
 *   EMPRESA_CP       — lugar de expedición (ExpeditionPlace)
 *   OUTPUT_DIR       — base de salida de archivos (default ./outputs)
 */
const { pool } = require('../../config/db');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { validarFactura, cargarFactura, empresaCfdi } = require('./cfdi.txt.generator');
const { generarFacturaCfdiPdf } = require('./ventas.pdf');

const IVA_TASA = 0.16;
const n2 = (n) => Number(n || 0).toFixed(2);

// ── Cliente HTTP de Facturama (fetch global de Node v24, sin axios) ────────────
function facturamaBase() {
  return (process.env.FACTURAMA_URL || '').replace(/\/+$/, '');
}
function authHeader() {
  return 'Basic ' + (process.env.FACTURAMA_TOKEN || '');
}

/** Construye un Error de negocio con mensaje del PAC y status HTTP (default 422). */
async function errorDeRespuesta(res, statusFallback = 422) {
  let msg = `Facturama respondió ${res.status}`;
  try {
    const body = await res.json();
    if (body?.Message) {
      msg = body.Message;
    } else if (body?.ModelState) {
      // ModelState: { campo: ["error1","error2"], ... } → aplanar a un solo mensaje.
      const partes = [];
      for (const [k, v] of Object.entries(body.ModelState)) {
        partes.push(`${k}: ${Array.isArray(v) ? v.join(' ') : v}`);
      }
      msg = partes.join(' | ') || msg;
    }
  } catch (_) { /* el cuerpo no era JSON; se queda el mensaje genérico */ }
  const e = new Error(msg);
  e.status = statusFallback;
  return e;
}

async function fGet(ruta) {
  const res = await fetch(facturamaBase() + ruta, {
    method: 'GET',
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw await errorDeRespuesta(res);
  return res.json();
}

async function fPost(ruta, body) {
  const res = await fetch(facturamaBase() + ruta, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorDeRespuesta(res);
  return res.json();
}

async function fDelete(ruta) {
  const res = await fetch(facturamaBase() + ruta, {
    method: 'DELETE',
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw await errorDeRespuesta(res);
  // El acuse de cancelación puede venir como JSON; si no, devolvemos texto crudo.
  try { return await res.json(); } catch (_) { return { acuse: await res.text() }; }
}

// ── Construcción del body CFDI 4.0 para POST /3/cfdis ──────────────────────────
function construirCfdiFacturama({ entrega, cliente, partidas }) {
  const emp = empresaCfdi();
  const uso = entrega.uso_cfdi || cliente.uso_cfdi || '';

  const items = partidas.map((p) => {
    const cant = Number(p.cantidad || 0);
    const valorUnit = Number(p.precio_unitario || 0);
    const importe = cant * valorUnit;
    const grava = !p.iva_exento;
    const ivaImporte = grava ? importe * IVA_TASA : 0;
    const total = importe + ivaImporte;

    const item = {
      Quantity: n2(cant),
      ProductCode: p.clave_sat,
      UnitCode: p.clave_unidad_sat,
      Unit: p.unidad_medida || 'Pieza',
      Description: p.descripcion,
      IdentificationNumber: p.sku_interno,
      UnitPrice: n2(valorUnit),
      Subtotal: n2(importe),
      Discount: '0.00',
      TaxObject: grava ? '02' : '01',
      Total: n2(total),
    };
    // Sólo se manda el arreglo de impuestos cuando la partida grava IVA.
    if (grava) {
      item.Taxes = [{
        Name: 'IVA',
        Rate: '0.160000',
        Total: n2(ivaImporte),
        Base: n2(importe),
        IsRetention: false,
        IsFederalTax: true,
      }];
    }
    return item;
  });

  const body = {
    Receiver: {
      Name: cliente.razon_social,
      CfdiUse: uso,
      Rfc: (cliente.rfc || '').toUpperCase(),
      FiscalRegime: cliente.regimen_fiscal,
      TaxZipCode: cliente.codigo_postal,
    },
    CfdiType: 'I',
    ExpeditionPlace: emp.cp,
    PaymentForm: entrega.forma_pago,
    PaymentMethod: entrega.metodo_pago,
    Currency: entrega.moneda || 'MXN',
    Exportation: '01',
    Items: items,
  };
  // Serie opcional: sólo si está configurada en el entorno.
  if (process.env.FACTURAMA_SERIE) body.Serie = process.env.FACTURAMA_SERIE;
  return body;
}

// ── Descarga del XML timbrado desde Facturama ─────────────────────────────────
/** Devuelve el XML decodificado (string) a partir del Id de Facturama. */
async function descargarXmlFacturama(facturamaId) {
  const r = await fGet(`/cfdi/xml/issued/${facturamaId}`);
  return Buffer.from(r.Content || '', 'base64').toString('utf8');
}

// ── Derivados a partir de la respuesta del timbre ─────────────────────────────
function cadenaOriginalTfd(tfd, rfcProvCertif) {
  // ||1.1|UUID|FechaTimbrado|RfcProvCertif|SelloCFDI|NoCertificadoSAT||
  return `||1.1|${tfd.Uuid}|${tfd.Date}|${rfcProvCertif}|${tfd.CfdiSign}|${tfd.SatCertNumber}||`;
}

function urlQrSat({ uuid, rfcEmisor, rfcReceptor, total, selloCfdi }) {
  const fe = (selloCfdi || '').slice(-8); // últimos 8 caracteres del sello del CFDI
  return 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx' +
    `?id=${uuid}&re=${rfcEmisor}&rr=${rfcReceptor}&tt=${total}&fe=${fe}`;
}

// ── Núcleo componible del timbrado (lo usan entregas Y el POS) ────────────────
/**
 * Manda el body CFDI a Facturama, deriva UUID/cadenas/QR y descarga el XML
 * timbrado a /outputs/cfdi/<año>/<folioArchivo>.xml. NO toca la base de datos:
 * el llamador persiste con insertarComprobante() dentro de su propia transacción.
 */
async function timbrarComprobante(body, { folioArchivo }) {
  const resp = await fPost('/3/cfdis', body);

  const tfd = resp.Complement?.TaxStamp || {};
  const uuid = tfd.Uuid;
  if (!uuid) {
    const e = new Error('Facturama no devolvió UUID en el timbre'); e.status = 422; throw e;
  }
  const rfcEmisor = (resp.Issuer?.Rfc || '').toUpperCase();
  const rfcReceptor = (resp.Receiver?.Rfc || '').toUpperCase();
  const total = String(resp.Total);
  const cadenaTfd = cadenaOriginalTfd(tfd, tfd.RfcProvCertif);
  const qrUrl = urlQrSat({ uuid, rfcEmisor, rfcReceptor, total, selloCfdi: tfd.CfdiSign });
  const qrDataUrl = await QRCode.toDataURL(qrUrl);

  const anioActual = new Date().getFullYear();
  const xmlDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'cfdi', String(anioActual));
  fs.mkdirSync(xmlDir, { recursive: true });
  const xmlContent = await descargarXmlFacturama(resp.Id);
  const xmlFileName = `${folioArchivo}.xml`;
  fs.writeFileSync(path.join(xmlDir, xmlFileName), xmlContent, 'utf8');
  const xmlPath = `/outputs/cfdi/${anioActual}/${xmlFileName}`;

  const cfdiData = {
    uuid,
    folio: resp.Folio || null,
    serie: resp.Serie || null,
    fecha_timbrado: tfd.Date || null,
    sello_cfdi: tfd.CfdiSign || null,
    sello_sat: tfd.SatSign || null,
    cert_emisor: resp.CertNumber || null,
    cert_sat: tfd.SatCertNumber || null,
    rfc_prov_certif: tfd.RfcProvCertif || null,
    cadena_original_tfd: cadenaTfd,
    cadena_original_comprobante: resp.OriginalString || null,
    qr_url: qrUrl,
    qr_dataurl: qrDataUrl,
    emisor_nombre: resp.Issuer?.TaxName || empresaCfdi().nombre,
    emisor_rfc: rfcEmisor,
    total,
  };
  return { resp, cfdiData, xmlPath, qrUrl };
}

/**
 * INSERT en cfdi_comprobantes con el origen correcto (entrega | pos_venta |
 * pos_global). Recibe la conexión del llamador para componer su transacción.
 */
async function insertarComprobante(conn, {
  origen = 'entrega', entrega_id = null, pos_venta_id = null, pos_factura_global_id = null,
  resp, cfdiData, xmlPath, pdfPath = null, qrUrl,
}) {
  const [r] = await conn.query(
    `INSERT INTO cfdi_comprobantes
       (entrega_id, origen, pos_venta_id, pos_factura_global_id,
        facturama_id, uuid, serie, folio, fecha_timbrado,
        sello_cfdi, sello_sat, cert_emisor, cert_sat, rfc_prov_certif,
        cadena_original_tfd, cadena_original_comprobante, qr_url,
        xml_path, pdf_path, total, status, raw_response)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'vigente',?)`,
    [
      entrega_id, origen, pos_venta_id, pos_factura_global_id,
      resp.Id, cfdiData.uuid, cfdiData.serie, cfdiData.folio, cfdiData.fecha_timbrado,
      cfdiData.sello_cfdi, cfdiData.sello_sat, cfdiData.cert_emisor, cfdiData.cert_sat, cfdiData.rfc_prov_certif,
      cfdiData.cadena_original_tfd, cfdiData.cadena_original_comprobante, qrUrl,
      xmlPath, pdfPath, resp.Total != null ? Number(resp.Total) : null, JSON.stringify(resp),
    ]
  );
  return r.insertId;
}

// ── Timbrado de una entrega tipo factura ──────────────────────────────────────
async function timbrarEntrega(entregaId) {
  // 1) Cargar la entrega con cliente y conceptos.
  const data = await cargarFactura(entregaId);
  if (!data) { const e = new Error('Entrega no encontrada'); e.status = 404; throw e; }
  if (data.entrega.tipo !== 'factura') {
    const e = new Error('La entrega no es de tipo factura'); e.status = 400; throw e;
  }

  // 2) Evitar doble timbrado vigente.
  const [[existente]] = await pool.query(
    "SELECT id FROM cfdi_comprobantes WHERE entrega_id = ? AND status = 'vigente' LIMIT 1",
    [entregaId]
  );
  if (existente) { const e = new Error('La entrega ya tiene un CFDI vigente'); e.status = 409; throw e; }

  // 3) Validar datos fiscales obligatorios.
  const v = validarFactura(data);
  if (!v.ok) {
    const e = new Error('Faltan datos fiscales obligatorios para CFDI 4.0');
    e.status = 422; e.faltantes = v.faltantes; throw e;
  }

  // 4-6) Timbrar, derivar y descargar el XML (núcleo compartido con el POS).
  const body = construirCfdiFacturama(data);
  const { resp, cfdiData, xmlPath, qrUrl } = await timbrarComprobante(body, {
    folioArchivo: data.entrega.folio,
  });

  // 7) Generar el PDF (representación impresa) con nuestro generador.
  const entregaFull = await cargarEntregaCfdi(entregaId);
  let pdfPath = null;
  try {
    const out = await generarFacturaCfdiPdf(entregaFull, cfdiData);
    pdfPath = out.relativePath;
  } catch (e) { /* el PDF es regenerable; no se aborta el timbre ya emitido */ }

  // 8) Persistir comprobante + marcar la entrega como timbrada (transacción).
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await insertarComprobante(conn, {
      origen: 'entrega', entrega_id: entregaId,
      resp, cfdiData, xmlPath, pdfPath, qrUrl,
    });
    await conn.query("UPDATE entregas SET estatus_cfdi = 'timbrado' WHERE id = ?", [entregaId]);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }

  return { uuid: cfdiData.uuid, facturama_id: resp.Id, xml_url: xmlPath, pdf_url: pdfPath, qr_url: qrUrl };
}

// ── Cancelación de un CFDI vigente ────────────────────────────────────────────
const MOTIVOS_VALIDOS = ['01', '02', '03', '04'];

async function cancelarCfdi(entregaId, { motivo, uuidSustituye } = {}) {
  if (!MOTIVOS_VALIDOS.includes(motivo)) {
    const e = new Error('Motivo de cancelación inválido (use 01, 02, 03 o 04)'); e.status = 400; throw e;
  }
  if (motivo === '01' && !uuidSustituye) {
    const e = new Error('El motivo 01 requiere el UUID que sustituye'); e.status = 400; throw e;
  }

  const [[comp]] = await pool.query(
    "SELECT * FROM cfdi_comprobantes WHERE entrega_id = ? AND status = 'vigente' ORDER BY id DESC LIMIT 1",
    [entregaId]
  );
  if (!comp) { const e = new Error('No hay un CFDI vigente para esta entrega'); e.status = 404; throw e; }

  // DELETE a Facturama: /cfdi/{Id}?type=issued&motive={motivo}[&uuidReplacement={uuid}]
  let ruta = `/cfdi/${comp.facturama_id}?type=issued&motive=${motivo}`;
  if (motivo === '01') ruta += `&uuidReplacement=${uuidSustituye}`;
  const acuse = await fDelete(ruta);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE cfdi_comprobantes
         SET status = 'cancelado', motivo_cancelacion = ?, uuid_sustituye = ?, acuse_cancelacion = ?
       WHERE id = ?`,
      [motivo, uuidSustituye || null, JSON.stringify(acuse), comp.id]
    );
    await conn.query("UPDATE entregas SET estatus_cfdi = 'cancelado' WHERE id = ?", [entregaId]);
    await conn.commit();
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }

  return { uuid: comp.uuid, status: 'cancelado', motivo, acuse };
}

// ── Carga de la entrega para el PDF (mismo shape que cargarEntrega del controller) ─
async function cargarEntregaCfdi(id) {
  const [[ent]] = await pool.query(
    `SELECT e.*, c.razon_social AS cliente_nombre, c.rfc AS cliente_rfc, p.folio AS pedido_folio
     FROM entregas e
     JOIN clientes c ON c.id = e.cliente_id
     JOIN pedidos_cliente p ON p.id = e.pedido_id
     WHERE e.id = ?`, [id]
  );
  if (!ent) return null;
  const [partidas] = await pool.query('SELECT * FROM entregas_partidas WHERE entrega_id = ? ORDER BY id', [id]);
  return { ...ent, partidas };
}

module.exports = {
  timbrarEntrega, cancelarCfdi, descargarXmlFacturama,
  timbrarComprobante, insertarComprobante,
};
