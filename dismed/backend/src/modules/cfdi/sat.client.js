/**
 * sat.client.js — Cliente del Servicio Web de Descarga Masiva de Terceros del SAT.
 *
 * Envuelve a @nodecfdi/sat-ws-descarga-masiva (ESM puro) para poder usarlo desde
 * el backend CommonJS mediante import() dinámico. Expone el flujo en 3 pasos:
 *
 *   solicitar({tipo, desde, hasta})  → { requestId }            (presenta la consulta)
 *   verificar(requestId)             → { estado, paquetes[] }   (estatus + paquetes)
 *   descargarPaquete(packageId)      → Buffer (zip)             (descarga un paquete)
 *   leerCfdisDeZip(buffer)           → AsyncIterable<{name,xml}> (extrae los XML)
 *
 * El SAT procesa las solicitudes de forma asíncrona; entre solicitar y que los
 * paquetes estén listos pueden pasar de segundos a horas. Por eso verificar()
 * se consulta repetidamente (ver sat.descarga.service.js).
 */
const { cargarFiel } = require('./sat.fiel');

// Caché del módulo ESM y del servicio (la FIEL es válida ~4 años).
let _mod = null;
async function lib() {
  if (!_mod) _mod = await import('@nodecfdi/sat-ws-descarga-masiva');
  return _mod;
}

let _serviceCache = null;
async function getService() {
  if (_serviceCache) return _serviceCache;
  const { Fiel, HttpsWebClient, FielRequestBuilder, Service } = await lib();
  const { cerBinary, keyBinary, password } = cargarFiel();
  const fiel = Fiel.create(cerBinary, keyBinary, password);
  if (!fiel.isValid()) {
    throw new Error('La e.firma (FIEL) no es válida o está vencida. Verifica los archivos y la contraseña.');
  }
  const service = new Service(new FielRequestBuilder(fiel), new HttpsWebClient());
  _serviceCache = { service, fiel };
  return _serviceCache;
}

/** Valida la FIEL sin presentar consulta (para diagnósticos). */
async function validarFiel() {
  const { Fiel } = await lib();
  const { cerBinary, keyBinary, password } = cargarFiel();
  const fiel = Fiel.create(cerBinary, keyBinary, password);
  return {
    valida: fiel.isValid(),
    rfc: fiel.getRfc(),
    serie: fiel.getCertificateSerial(),
  };
}

/**
 * ValidaSat — punto de entrada nombrado para validar la e.firma (FIEL) ante el SAT.
 * Lo invoca la skill /descarga-sat por SSH antes de gastar una solicitud. Envuelve
 * validarFiel() (la misma validación que usa la ruta GET /api/cfdi/fiel).
 */
async function ValidaSat() {
  return validarFiel();
}

// Lee de forma segura un código numérico/string de un objeto del SAT.
const safeCode = (obj) => {
  try { return String(obj?.getCode?.() ?? ''); } catch { return ''; }
};

const norm = (s) => s.replace(' ', 'T'); // 'YYYY-MM-DD HH:mm:ss'

/**
 * Presenta una consulta de descarga. tipo: 'emitido' | 'recibido'.
 * requestType: 'xml' (archivos) | 'metadata' (CSV con Estatus vigente/cancelado).
 */
async function solicitar({ tipo, desde, hasta, requestType = 'xml' }) {
  const { service } = await getService();
  const { QueryParameters, DateTimePeriod, DownloadType, RequestType, DocumentStatus } = await lib();
  const period = DateTimePeriod.createFromValues(desde, hasta);
  const downloadType = new DownloadType(tipo === 'emitido' ? 'issued' : 'received');
  const params = QueryParameters.create(period)
    .withDownloadType(downloadType)
    .withRequestType(new RequestType(requestType));
  // Para RECIBIDOS + XML el SAT no permite descargar el XML de cancelados (no somos
  // el emisor): filtramos a vigentes. En metadatos NO filtramos: queremos ver el
  // estatus (vigente/cancelado) de todos.
  if (requestType === 'xml' && tipo !== 'emitido') {
    params.withDocumentStatus(new DocumentStatus('active'));
  }
  const query = await service.query(params);
  const status = query.getStatus();
  return {
    aceptada: status.isAccepted(),
    mensaje: status.getMessage(),
    codigo: safeCode(status),
    requestId: status.isAccepted() ? query.getRequestId() : null,
  };
}

/** Verifica el estatus de una solicitud previamente presentada. */
async function verificar(requestId) {
  const { service } = await getService();
  const verify = await service.verify(requestId);
  const status = verify.getStatus();
  if (!status.isAccepted()) {
    return { ok: false, estado: 'error', mensaje: status.getMessage(), paquetes: [] };
  }
  const sr = verify.getStatusRequest();
  let estado = 'en_proceso';
  if (sr.isTypeOf('Finished')) estado = 'terminada';
  else if (sr.isTypeOf('Expired')) estado = 'vencida';
  else if (sr.isTypeOf('Failure')) estado = 'error';
  else if (sr.isTypeOf('Rejected')) estado = 'rechazada';
  else if (sr.isTypeOf('InProgress') || sr.isTypeOf('Accepted')) estado = 'en_proceso';

  return {
    ok: true,
    estado,
    codigoEstado: safeCode(verify.getCodeRequest?.()),
    numCfdis: verify.getNumberCfdis?.() ?? null,
    paquetes: estado === 'terminada' ? verify.getPackageIds() : [],
    mensaje: status.getMessage(),
  };
}

/** Descarga un paquete (ZIP). Devuelve un Buffer. */
async function descargarPaquete(packageId) {
  const { service } = await getService();
  const download = await service.download(packageId);
  if (!download.getStatus().isAccepted()) {
    throw new Error(`No se pudo descargar el paquete ${packageId}: ${download.getStatus().getMessage()}`);
  }
  return Buffer.from(download.getPackageContent(), 'base64');
}

/** Itera los XML contenidos en un paquete CFDI (Buffer del ZIP). */
async function* leerCfdisDeZip(buffer) {
  const { CfdiPackageReader } = await lib();
  const reader = await CfdiPackageReader.createFromContents(buffer.toString('binary'));
  for await (const map of reader.cfdis()) {
    for (const [name, xml] of map) {
      yield { name, xml };
    }
  }
}

// El campo de estatus en la metadata del SAT: '1'/'Vigente' = vigente, '0'/'Cancelado'.
function estatusDesdeMetadata(item) {
  const raw = String(
    item.get('estatus') ?? item.get('estado') ?? item.get('Estatus') ?? ''
  ).trim().toLowerCase();
  const fechaCanc = String(item.get('fechaCancelacion') ?? item.get('FechaCancelacion') ?? '').trim();
  if (raw === '0' || raw === 'cancelado' || (fechaCanc && fechaCanc !== '0' && !/^0000/.test(fechaCanc))) return 'cancelado';
  if (raw === '1' || raw === 'vigente') return 'vigente';
  return 'vigente';
}

/** Itera la metadata (Buffer del ZIP) → { uuid, estatus, fechaCancelacion }. */
async function* leerMetadataDeZip(buffer) {
  const { MetadataPackageReader } = await lib();
  const reader = await MetadataPackageReader.createFromContents(buffer.toString('binary'));
  for await (const item of reader.metadata()) {
    const uuid = String(item.get('uuid') ?? item.get('Uuid') ?? '').toUpperCase();
    if (!uuid) continue;
    yield {
      uuid,
      estatus: estatusDesdeMetadata(item),
      fechaCancelacion: String(item.get('fechaCancelacion') ?? item.get('FechaCancelacion') ?? '').trim() || null,
    };
  }
}

module.exports = { validarFiel, ValidaSat, solicitar, verificar, descargarPaquete, leerCfdisDeZip, leerMetadataDeZip };
