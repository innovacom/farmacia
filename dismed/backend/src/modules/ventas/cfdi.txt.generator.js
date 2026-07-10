/**
 * cfdi.txt.generator.js — Validación CFDI 4.0 + generación del TXT delimitado por comas.
 *
 * Genera el documento "del TXT hacia atrás". El timbrado ("del TXT hacia adelante")
 * queda pendiente de la API del PAC. Cuando llegue esa especificación, SOLO se reescribe
 * `construirTxt()` para ajustar el layout; la validación y la carga de datos se reaprovechan.
 *
 * Layout actual (autodescriptivo, una fila por bloque, CSV):
 *   COMPROBANTE,<folio>,<tipo>,<moneda>,<tipoCambio>,<metodoPago>,<formaPago>,<fecha>,<subtotal>,<iva>,<total>
 *   EMISOR,<rfc>,<nombre>,<regimenFiscal>,<cp>
 *   RECEPTOR,<rfc>,<razonSocial>,<cpFiscal>,<regimenFiscal>,<usoCFDI>
 *   CONCEPTO,<claveProdServ>,<claveUnidad>,<noIdentificacion>,<cantidad>,<descripcion>,<valorUnitario>,<importe>,<objetoImp>,<ivaTasa>,<ivaImporte>
 */
const { pool } = require('../../config/db');
const path = require('path');
const fs = require('fs');

const IVA_TASA = 0.16;

function empresaCfdi() {
  return {
    rfc:     (process.env.EMPRESA_RFC || '').trim().toUpperCase(),
    nombre:  (process.env.EMPRESA_NOMBRE || '').trim(),
    regimen: (process.env.EMPRESA_REGIMEN_FISCAL || '').trim(),
    cp:      (process.env.EMPRESA_CP || '').trim(),
  };
}

// Escapa un valor para CSV: entrecomilla si trae coma, comilla o salto de línea.
function csv(...vals) {
  return vals.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

const n2 = (n) => Number(n || 0).toFixed(2);

/**
 * Valida que estén capturados todos los datos obligatorios para emitir CFDI 4.0.
 * Devuelve { ok, faltantes: [] } — faltantes es la lista exacta para que el usuario los capture.
 */
function validarFactura({ entrega, cliente, partidas }) {
  const faltantes = [];
  const emp = empresaCfdi();

  // Emisor (variables de entorno de la empresa)
  if (!emp.rfc)     faltantes.push('Emisor: EMPRESA_RFC no configurado');
  if (!emp.regimen) faltantes.push('Emisor: EMPRESA_REGIMEN_FISCAL no configurado');
  if (!emp.cp)      faltantes.push('Emisor: EMPRESA_CP (lugar de expedición) no configurado');

  // Receptor (cliente)
  if (!cliente?.rfc)            faltantes.push('Receptor: RFC');
  if (!cliente?.razon_social)   faltantes.push('Receptor: razón social');
  if (!cliente?.codigo_postal)  faltantes.push('Receptor: código postal (domicilio fiscal)');
  if (!cliente?.regimen_fiscal) faltantes.push('Receptor: régimen fiscal (clave SAT)');
  const uso = entrega?.uso_cfdi || cliente?.uso_cfdi;
  if (!uso)                     faltantes.push('Receptor: uso de CFDI');

  // Comprobante
  if (!entrega?.forma_pago)  faltantes.push('Comprobante: forma de pago');
  if (!entrega?.metodo_pago) faltantes.push('Comprobante: método de pago (PUE/PPD)');
  if (!entrega?.moneda)      faltantes.push('Comprobante: moneda');

  // Conceptos
  if (!partidas?.length) {
    faltantes.push('No hay conceptos en la entrega');
  } else {
    for (const p of partidas) {
      const ref = p.sku_interno || p.descripcion || `partida ${p.id}`;
      if (!p.clave_sat)        faltantes.push(`Concepto ${ref}: clave producto/servicio SAT`);
      if (!p.clave_unidad_sat) faltantes.push(`Concepto ${ref}: clave unidad SAT`);
    }
  }

  return { ok: faltantes.length === 0, faltantes };
}

/** Carga la entrega con cliente y conceptos (incluye claves SAT del producto). */
async function cargarFactura(entregaId) {
  const [[entrega]] = await pool.query(
    `SELECT e.*, p.folio AS pedido_folio FROM entregas e
     JOIN pedidos_cliente p ON p.id = e.pedido_id WHERE e.id = ?`, [entregaId]
  );
  if (!entrega) return null;
  const [[cliente]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [entrega.cliente_id]);
  const [partidas] = await pool.query(
    `SELECT ep.*, pr.clave_sat, pr.clave_unidad_sat
     FROM entregas_partidas ep
     LEFT JOIN productos pr ON pr.id = ep.producto_id
     WHERE ep.entrega_id = ? ORDER BY ep.id`, [entregaId]
  );
  return { entrega, cliente, partidas };
}

/** Construye el contenido del TXT. Cambiar SOLO esto cuando llegue la spec del PAC. */
function construirTxt({ entrega, cliente, partidas }) {
  const emp = empresaCfdi();
  const tipo = 'I'; // Ingreso
  const fecha = new Date().toISOString().slice(0, 19);
  const uso = entrega.uso_cfdi || cliente.uso_cfdi || '';

  const lineas = [];
  lineas.push(csv('COMPROBANTE', entrega.folio, tipo, entrega.moneda || 'MXN', '1.00',
    entrega.metodo_pago, entrega.forma_pago, fecha,
    n2(entrega.subtotal), n2(entrega.iva), n2(entrega.total)));
  lineas.push(csv('EMISOR', emp.rfc, emp.nombre, emp.regimen, emp.cp));
  lineas.push(csv('RECEPTOR', (cliente.rfc || '').toUpperCase(), cliente.razon_social,
    cliente.codigo_postal, cliente.regimen_fiscal, uso));

  for (const p of partidas) {
    const cant = Number(p.cantidad || 0);
    const valorUnit = Number(p.precio_unitario || 0);
    const importe = cant * valorUnit;
    const objetoImp = p.iva_exento ? '01' : '02'; // 01 no objeto / 02 sí objeto de impuesto
    const ivaTasa = p.iva_exento ? 0 : IVA_TASA;
    const ivaImporte = importe * ivaTasa;
    lineas.push(csv('CONCEPTO', p.clave_sat, p.clave_unidad_sat, p.sku_interno,
      n2(cant), p.descripcion, n2(valorUnit), n2(importe), objetoImp,
      ivaTasa.toFixed(6), n2(ivaImporte)));
  }
  return lineas.join('\n') + '\n';
}

/**
 * Genera el TXT en /outputs/cfdi/<folio>.txt, marca estatus_cfdi='generado' y devuelve la ruta.
 * Lanza un error con .status=422 y .faltantes si la validación no pasa.
 */
async function generarCfdiTxt(entregaId) {
  const data = await cargarFactura(entregaId);
  if (!data) { const e = new Error('Entrega no encontrada'); e.status = 404; throw e; }
  if (data.entrega.tipo !== 'factura') {
    const e = new Error('La entrega no es de tipo factura'); e.status = 400; throw e;
  }

  const v = validarFactura(data);
  if (!v.ok) {
    const e = new Error('Faltan datos fiscales obligatorios para CFDI 4.0');
    e.status = 422; e.faltantes = v.faltantes; throw e;
  }

  const outDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'cfdi');
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${data.entrega.folio}.txt`;
  fs.writeFileSync(path.join(outDir, fileName), construirTxt(data), 'utf8');

  const relativePath = `/outputs/cfdi/${fileName}`;
  await pool.query(
    "UPDATE entregas SET cfdi_txt_path = ?, estatus_cfdi = 'generado' WHERE id = ?",
    [relativePath, entregaId]
  );
  return { relativePath, faltantes: [] };
}

module.exports = { validarFactura, cargarFactura, construirTxt, generarCfdiTxt, empresaCfdi };
