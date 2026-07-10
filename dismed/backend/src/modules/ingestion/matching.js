/**
 * Emparejamiento de la factura extraída contra el catálogo y las Órdenes de Compra abiertas.
 * Mismo principio que DISEÑO_VINCULACION_PRODUCTO.md: SOLO códigos exactos auto-vinculan
 * (sku_proveedor, sku_interno, ean, o proveedores_catalogo ya confirmado). La similitud de
 * descripción NUNCA auto-vincula aquí: si no hay código exacto, se manda a revisión manual.
 *
 * Si la partida de la OC no tiene producto_id (la cotización/pedido que la generó nunca la
 * vinculó a catálogo), y el código de la factura resuelve un producto sin ambigüedad, el
 * emparejamiento la marca (`vincular_oc: true`) y el llamador completa el vínculo en
 * ordenes_compra_partidas/pedidos_cliente_partidas antes de recibir — así la automatización no
 * exige que el usuario vincule la OC a mano además del catálogo del proveedor.
 */

// Varios proveedores nombran el PDF empezando con el RFC del emisor (p.ej. "PNM8604219NAFVP46736.pdf").
// Fallback cuando el RFC no se pudo leer del texto (PDF con el RFC como imagen/escaneo).
// Se valida el formato real (moral=12, física=13) en vez de asumir un largo fijo.
function extraerRfcDeNombreArchivo(nombreArchivo) {
  if (!nombreArchivo) return null;
  const base = nombreArchivo.replace(/\.[^.]+$/, '').toUpperCase();
  const fisica = base.match(/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}/);
  if (fisica) return fisica[0];
  const moral = base.match(/^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}/);
  if (moral) return moral[0];
  return null;
}

async function buscarProveedorPorRfc(conn, rfc) {
  if (!rfc) return null;
  const [[prov]] = await conn.query(
    'SELECT id, nombre_empresa FROM proveedores WHERE rfc = ? AND activo = 1',
    [rfc.trim().toUpperCase()]
  );
  return prov || null;
}

async function buscarOcAbiertasDeProveedor(conn, proveedor_id) {
  const [ocs] = await conn.query(
    `SELECT id, folio, estatus FROM ordenes_compra
     WHERE proveedor_id = ? AND estatus IN ('abierta','parcial')
     ORDER BY created_at DESC`,
    [proveedor_id]
  );
  return ocs;
}

async function partidasPendientes(conn, oc_id) {
  const [rows] = await conn.query(
    `SELECT id, pedido_partida_id, producto_id, sku_interno, descripcion, cantidad, cantidad_recibida
     FROM ordenes_compra_partidas WHERE oc_id = ? AND cantidad > cantidad_recibida`,
    [oc_id]
  );
  return rows;
}

// Resuelve producto_id para un código del proveedor, SOLO por coincidencia exacta.
// Prueba proveedores_skus, sku_interno/ean propios, y proveedores_catalogo (por sku_proveedor
// O referencia_fabricante — ambos son únicos por proveedor-producto, y solo se confía en el
// catálogo si ya está 'confirmado', nunca en un match_estado 'sugerido' sin revisar por humano).
async function resolverProductoPorCodigo(conn, proveedor_id, codigo) {
  if (!codigo) return null;
  const c = codigo.toString().trim();
  if (!c) return null;

  const [[porSku]] = await conn.query(
    'SELECT producto_id FROM proveedores_skus WHERE proveedor_id = ? AND sku_proveedor = ?',
    [proveedor_id, c]
  );
  if (porSku && porSku.producto_id) return porSku.producto_id;

  const [[porInterno]] = await conn.query('SELECT id FROM productos WHERE sku_interno = ?', [c]);
  if (porInterno) return porInterno.id;

  const [[porEan]] = await conn.query('SELECT id FROM productos WHERE ean = ?', [c]);
  if (porEan) return porEan.id;

  const [[porCatalogo]] = await conn.query(
    `SELECT producto_id FROM proveedores_catalogo
     WHERE proveedor_id = ? AND (sku_proveedor = ? OR referencia_fabricante = ?)
       AND match_estado = 'confirmado' AND producto_id IS NOT NULL`,
    [proveedor_id, c, c]
  );
  if (porCatalogo) return porCatalogo.producto_id;

  return null;
}

/**
 * Empareja TODAS las partidas del PDF contra las partidas pendientes de UNA sola OC.
 * Devuelve { ok: true, emparejadas: [{oc_partida_id, cantidad, numero_lote, fecha_caducidad}] }
 * o { ok: false, motivo } — nunca empareja parcialmente.
 */
async function emparejarPartidasConOc(conn, { proveedor_id, oc, partidasPdf }) {
  const pendientes = await partidasPendientes(conn, oc.id);
  if (!pendientes.length) return { ok: false, motivo: `OC ${oc.folio} no tiene partidas pendientes` };

  const usados = new Set();
  const emparejadas = [];
  for (const item of partidasPdf) {
    const productoId = (await resolverProductoPorCodigo(conn, proveedor_id, item.codigo_proveedor))
      || (await resolverProductoPorCodigo(conn, proveedor_id, item.referencia_fabricante));
    if (!productoId) {
      return { ok: false, motivo: `Sin código exacto de proveedor para "${item.descripcion}"` };
    }
    // Candidatas: partidas de la OC ya vinculadas a este producto, O partidas de la OC que aún
    // no tienen producto_id (la cotización/pedido que las generó nunca las vinculó a catálogo).
    // El código del proveedor en la factura YA es exacto y confirmado (resolverProductoPorCodigo),
    // así que si la partida sin vincular es la ÚNICA candidata, se completa el vínculo aquí mismo
    // en vez de exigirle al usuario que lo haga a mano — pero solo cuando no hay ambigüedad.
    const candidatas = pendientes.filter((p) =>
      !usados.has(p.id) && (p.producto_id === productoId || p.producto_id === null)
    );
    if (candidatas.length !== 1) {
      return {
        ok: false,
        motivo: `${candidatas.length === 0 ? 'Sin' : 'Varias'} partida(s) pendiente(s) en ${oc.folio} para "${item.descripcion}"`,
      };
    }
    const ocp = candidatas[0];
    const pendiente = Number(ocp.cantidad) - Number(ocp.cantidad_recibida);
    if (Number(item.cantidad) > pendiente + 0.0001) {
      return { ok: false, motivo: `Cantidad del PDF (${item.cantidad}) excede lo pendiente (${pendiente}) en ${ocp.sku_interno}` };
    }
    usados.add(ocp.id);
    emparejadas.push({
      oc_partida_id: ocp.id,
      pedido_partida_id: ocp.pedido_partida_id,
      producto_id: productoId,
      vincular_oc: ocp.producto_id === null,
      cantidad: item.cantidad,
      numero_lote: item.numero_lote || null,
      fecha_caducidad: item.fecha_caducidad || null,
    });
  }
  return { ok: true, emparejadas };
}

/**
 * Prueba el emparejamiento contra cada OC candidata y solo acepta si EXACTAMENTE UNA
 * calza al 100% (nunca se elige arbitrariamente entre varias que casen).
 */
async function resolverOcYPartidas(conn, { proveedor_id, ocsCandidatas, partidasPdf }) {
  const exitosas = [];
  for (const oc of ocsCandidatas) {
    const r = await emparejarPartidasConOc(conn, { proveedor_id, oc, partidasPdf });
    if (r.ok) exitosas.push({ oc, emparejadas: r.emparejadas });
  }
  if (exitosas.length === 1) return { ok: true, ...exitosas[0] };
  if (exitosas.length === 0) return { ok: false, motivo: 'Ninguna OC abierta del proveedor calza al 100% con las partidas de la factura' };
  return { ok: false, motivo: `${exitosas.length} Órdenes de Compra calzan con la factura, no se puede elegir automáticamente` };
}

async function buscarCfdiPorUuidOFolio(conn, { uuid, rfc_emisor, folio }) {
  if (uuid) {
    const [[c]] = await conn.query('SELECT id FROM cfdi_repositorio WHERE uuid = ?', [uuid]);
    if (c) return c;
  }
  if (rfc_emisor && folio) {
    const [[c]] = await conn.query(
      'SELECT id FROM cfdi_repositorio WHERE rfc_emisor = ? AND folio = ? ORDER BY created_at DESC LIMIT 1',
      [rfc_emisor, folio]
    );
    if (c) return c;
  }
  return null;
}

module.exports = {
  buscarProveedorPorRfc, buscarOcAbiertasDeProveedor, partidasPendientes,
  resolverProductoPorCodigo, emparejarPartidasConOc, resolverOcYPartidas, buscarCfdiPorUuidOFolio,
  extraerRfcDeNombreArchivo,
};
