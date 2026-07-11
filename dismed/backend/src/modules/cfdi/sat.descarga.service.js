/**
 * sat.descarga.service.js — Orquesta la descarga masiva del SAT contra la BD.
 *
 * El SAT procesa las solicitudes de forma asíncrona (de segundos a horas), por
 * eso el flujo es resumible y se apoya en la bitácora `cfdi_descargas`. Cada job
 * tiene un `request_type`:
 *
 *   'xml'      → descarga los XML, los parsea y los guarda (cfdi_repositorio).
 *   'metadata' → descarga la metadata (que SÍ trae el Estatus vigente/cancelado)
 *                y reconcilia el estatus de los comprobantes ya guardados.
 *
 * Funciones:
 *   solicitarDescarga()  crea la bitácora + presenta la consulta (guarda requestId).
 *   procesarDescarga()   verifica; si terminó, descarga paquetes y procesa según tipo.
 *   procesarConEspera()  reanuda un job hasta terminar o agotar un tiempo (disparo manual).
 *   procesarPendientes() reanuda solicitudes no finalizadas (cron / botón).
 *   crearJobReconciliacion()  encola un job de metadata para corregir estatus.
 *   descargaMensualAutomatica()  descarga el mes anterior, emitidos y recibidos.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../config/db');
const client = require('./sat.client');
const { parseCfdi } = require('./cfdi.parser');
const { guardarComprobante } = require('./cfdi.repo');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xmlBaseDir = () => path.resolve(process.env.OUTPUT_DIR || './outputs', 'cfdi_xml');

// Estados terminales de una solicitud del SAT.
const TERMINALES = ['descargada', 'error', 'rechazada', 'vencida'];

/** Periodo (primer/último segundo) de un mes YYYY-MM. */
function periodoMes(anio, mes) {
  const last = new Date(anio, mes, 0).getDate();
  const p = (n) => String(n).padStart(2, '0');
  return {
    desde: `${anio}-${p(mes)}-01 00:00:00`,
    hasta: `${anio}-${p(mes)}-${p(last)} 23:59:59`,
  };
}

/**
 * Normaliza a 'YYYY-MM-DD'. mysql2 devuelve las columnas DATE como objeto Date
 * (con timezone -06:00 del pool); String(date) daría 'Mon Dec 01'. Tomamos los
 * componentes UTC (la fecha-only queda a las 06:00Z, así que el día es correcto).
 */
function ymd(v) {
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  return String(v).slice(0, 10);
}

async function actualizar(id, campos) {
  const cols = Object.keys(campos);
  if (!cols.length) return;
  await pool.query(
    `UPDATE cfdi_descargas SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => campos[c]), id]
  );
}

/** Crea la bitácora y presenta la consulta al SAT. */
async function solicitarDescarga({ tipo, desde, hasta, requestType = 'xml', origen = 'manual', usuarioId = null }) {
  const [r] = await pool.query(
    `INSERT INTO cfdi_descargas (tipo, request_type, fecha_desde, fecha_hasta, estado, origen, usuario_id)
     VALUES (?, ?, ?, ?, 'solicitada', ?, ?)`,
    [tipo, requestType, desde.slice(0, 10), hasta.slice(0, 10), origen, usuarioId]
  );
  const id = r.insertId;
  try {
    const sol = await client.solicitar({ tipo, desde, hasta, requestType });
    if (!sol.aceptada) {
      await actualizar(id, { estado: 'rechazada', estado_codigo: sol.codigo, mensaje: sol.mensaje });
      return { id, estado: 'rechazada', mensaje: sol.mensaje };
    }
    await actualizar(id, { estado: 'en_proceso', estado_codigo: sol.codigo, sat_id_solicitud: sol.requestId, mensaje: sol.mensaje });
    return { id, estado: 'en_proceso', requestId: sol.requestId };
  } catch (e) {
    await actualizar(id, { estado: 'error', mensaje: e.message });
    throw e;
  }
}

/** Procesa un paquete de XML: parsea, guarda en disco y en BD (idempotente por uuid). */
async function procesarPaquetesXml(job, paquetes) {
  const dir = path.join(xmlBaseDir(), job.tipo);
  fs.mkdirSync(dir, { recursive: true });
  let importados = 0, vistos = 0;
  for (const pid of paquetes) {
    const zip = await client.descargarPaquete(pid);
    for await (const { xml } of client.leerCfdisDeZip(zip)) {
      vistos++;
      try {
        const parsed = parseCfdi(xml);
        if (parsed.comprobante.tipo !== job.tipo) parsed.comprobante.tipo = job.tipo;
        const xmlPath = path.join(dir, `${parsed.comprobante.uuid}.xml`);
        fs.writeFileSync(xmlPath, xml, 'utf8');
        const rel = path.relative(path.resolve(process.env.OUTPUT_DIR || './outputs'), xmlPath).replace(/\\/g, '/');
        const res = await guardarComprobante(parsed, { origen: 'sat', xmlPath: rel });
        if (res.inserted) importados++;
      } catch (e) {
        console.error(`[cfdi] error guardando XML de descarga ${job.id}:`, e.message);
      }
    }
  }
  return { vistos, importados };
}

/**
 * Procesa un paquete de METADATA: actualiza el estatus (vigente/cancelado) de los
 * comprobantes ya guardados. La metadata es la ÚNICA fuente del estatus (el XML no
 * lo trae). Actualiza en ambos sentidos por si un comprobante cambió de estatus.
 */
async function procesarPaquetesMetadata(paquetes) {
  let vistos = 0, cancelados = 0, actualizados = 0;
  for (const pid of paquetes) {
    const zip = await client.descargarPaquete(pid);
    for await (const m of client.leerMetadataDeZip(zip)) {
      vistos++;
      if (m.estatus === 'cancelado') cancelados++;
      // UPPER(uuid) para tolerar mayúsculas/minúsculas entre metadata y repositorio.
      const [r] = await pool.query(
        'UPDATE cfdi_repositorio SET estatus = ? WHERE UPPER(uuid) = ? AND estatus <> ?',
        [m.estatus, m.uuid, m.estatus]
      );
      if (r.affectedRows) actualizados++;
    }
  }
  return { vistos, cancelados, actualizados };
}

/** Verifica una solicitud; si terminó, descarga y procesa según su request_type. */
async function procesarDescarga(jobId) {
  const [[job]] = await pool.query('SELECT * FROM cfdi_descargas WHERE id = ?', [jobId]);
  if (!job) throw new Error('Descarga no encontrada: ' + jobId);
  if (!job.sat_id_solicitud) { await actualizar(jobId, { estado: 'error', mensaje: 'Sin IdSolicitud' }); return { id: jobId, estado: 'error' }; }
  if (TERMINALES.includes(job.estado)) return { id: jobId, estado: job.estado };

  let v;
  try {
    v = await client.verificar(job.sat_id_solicitud);
  } catch (e) {
    // No se marca como terminal: puede ser una falla transitoria del SAT y el
    // cron horario debe seguir reintentando. Se persiste el mensaje para que
    // sea visible en la bitácora en vez de perderse en el catch silencioso de
    // procesarPendientes().
    await actualizar(jobId, { mensaje: `Error verificando con el SAT: ${e.message}` });
    throw e;
  }
  if (v.estado !== 'terminada') {
    await actualizar(jobId, { estado: v.estado, estado_codigo: v.codigoEstado, num_cfdis: v.numCfdis, mensaje: v.mensaje });
    return { id: jobId, estado: v.estado, numCfdis: v.numCfdis };
  }

  // Terminada: descargar paquetes y procesar según tipo de solicitud.
  await actualizar(jobId, { estado: 'terminada', num_cfdis: v.numCfdis, num_paquetes: v.paquetes.length });

  if (job.request_type === 'metadata') {
    const { vistos, cancelados, actualizados } = await procesarPaquetesMetadata(v.paquetes);
    await actualizar(jobId, {
      estado: 'descargada', num_cfdis: vistos, num_importados: actualizados,
      mensaje: `Estatus reconciliado: ${actualizados} actualizado(s), ${cancelados} cancelado(s) de ${vistos}.`,
    });
    return { id: jobId, estado: 'descargada', vistos, cancelados, actualizados };
  }

  // XML: parsear y guardar; al terminar, encolar la reconciliación de estatus.
  const { vistos, importados } = await procesarPaquetesXml(job, v.paquetes);
  await actualizar(jobId, { estado: 'descargada', num_cfdis: vistos, num_importados: importados });
  // Reconciliar estatus por metadata (job aparte, reanudable). Evita duplicar si ya hay uno.
  crearJobReconciliacion({
    tipo: job.tipo,
    desde: `${ymd(job.fecha_desde)} 00:00:00`,
    hasta: `${ymd(job.fecha_hasta)} 23:59:59`,
    usuarioId: job.usuario_id || null,
  }).catch((e) => console.error('[cfdi] no se pudo encolar reconciliación', jobId, e.message));
  return { id: jobId, estado: 'descargada', numCfdis: vistos, importados };
}

/**
 * Encola un job de metadata para reconciliar el estatus de un periodo y lo procesa
 * en segundo plano (con cron como red de seguridad si el SAT tarda).
 */
async function crearJobReconciliacion({ tipo, desde, hasta, origen = 'estatus', usuarioId = null }) {
  const job = await solicitarDescarga({ tipo, desde, hasta, requestType: 'metadata', origen, usuarioId });
  if (job.estado === 'en_proceso') {
    setImmediate(() => procesarConEspera(job.id).catch((e) => console.error('[cfdi] reconciliación bg', job.id, e.message)));
  }
  return job;
}

/** Reanuda un job (poll) hasta terminar o agotar el tiempo. Para el disparo manual. */
async function procesarConEspera(jobId, { maxWaitMs = 300000, intervalMs = 20000 } = {}) {
  const t0 = Date.now();
  let last = await procesarDescarga(jobId);
  while (!TERMINALES.includes(last.estado) && Date.now() - t0 < maxWaitMs) {
    await sleep(intervalMs);
    last = await procesarDescarga(jobId);
  }
  return last;
}

/** Reanuda solicitudes no finalizadas (cron / botón "actualizar"). */
async function procesarPendientes() {
  const [jobs] = await pool.query(
    `SELECT id FROM cfdi_descargas
     WHERE estado IN ('solicitada','en_proceso','terminada') AND sat_id_solicitud IS NOT NULL
     ORDER BY id ASC LIMIT 50`
  );
  const out = [];
  for (const j of jobs) {
    try { out.push(await procesarDescarga(j.id)); }
    catch (e) { out.push({ id: j.id, estado: 'error', mensaje: e.message }); }
  }
  return out;
}

/** Descarga del mes anterior, emitidos y recibidos (disparo automático del cron). */
async function descargaMensualAutomatica({ usuarioId = null } = {}) {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  const { desde, hasta } = periodoMes(d.getFullYear(), d.getMonth() + 1);
  const res = {};
  for (const tipo of ['emitido', 'recibido']) {
    try { res[tipo] = await solicitarDescarga({ tipo, desde, hasta, origen: 'automatico', usuarioId }); }
    catch (e) { res[tipo] = { estado: 'error', mensaje: e.message }; }
  }
  return { periodo: { desde, hasta }, ...res };
}

/** Elimina todo el repositorio CFDI (conceptos + comprobantes + bitácora). Irreversible. */
async function purgarRepositorio() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ conceptos }]]    = await conn.query('SELECT COUNT(*) AS conceptos FROM cfdi_repositorio_conceptos');
    const [[{ comprobantes }]] = await conn.query('SELECT COUNT(*) AS comprobantes FROM cfdi_repositorio');
    const [[{ descargas }]]    = await conn.query('SELECT COUNT(*) AS descargas FROM cfdi_descargas');
    await conn.query('DELETE FROM cfdi_repositorio_conceptos');
    await conn.query('DELETE FROM cfdi_repositorio');
    await conn.query('DELETE FROM cfdi_descargas');
    await conn.commit();
    console.log(`[cfdi-purgar] eliminados: ${conceptos} conceptos, ${comprobantes} comprobantes, ${descargas} descargas`);
    return { ok: true, eliminados: { conceptos, comprobantes, descargas } };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Envía al SAT solicitudes de descarga mes a mes (emitido + recibido) para un
 * rango histórico. Cada solicitud se registra en cfdi_descargas; el cron existente
 * las procesa conforme el SAT las completa.
 */
async function programarBatch({ desdeAnio = 2019, desMes = 3, hastaAnio, hastaMes, usuarioId = null } = {}) {
  const hoy  = new Date();
  const hAnio = hastaAnio || hoy.getFullYear();
  const hMes  = hastaMes  || (hoy.getMonth() + 1);

  const trabajos = [];
  let a = parseInt(desdeAnio, 10), m = parseInt(desMes, 10);
  while (a < hAnio || (a === hAnio && m <= hMes)) {
    trabajos.push({ anio: a, mes: m });
    m++;
    if (m > 12) { m = 1; a++; }
  }

  const total = trabajos.length * 2; // emitido + recibido
  console.log(`[cfdi-batch] iniciando: ${trabajos.length} meses × 2 tipos = ${total} solicitudes`);

  setImmediate(async () => {
    let ok = 0, err = 0;
    for (const { anio: ya, mes: ym } of trabajos) {
      let { desde, hasta } = periodoMes(ya, ym);
      // El mes en curso aún no ha terminado: pedir hasta fin de mes es una
      // fecha futura y el SAT la rechaza ("Fecha final invalida").
      if (ya === hoy.getFullYear() && ym === hoy.getMonth() + 1) {
        const p = (n) => String(n).padStart(2, '0');
        hasta = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())} 23:59:59`;
      }
      for (const tipo of ['emitido', 'recibido']) {
        try {
          await solicitarDescarga({ tipo, desde, hasta, origen: 'batch', usuarioId });
          ok++;
        } catch (e) {
          console.error(`[cfdi-batch] ✗ ${tipo} ${ya}-${String(ym).padStart(2, '0')}:`, e.message);
          err++;
        }
        await sleep(2000); // pausa entre solicitudes al SAT
      }
    }
    console.log(`[cfdi-batch] fin: ${ok} enviadas, ${err} errores`);
  });

  return { ok: true, total, meses: trabajos.length, mensaje: `Enviando ${total} solicitudes al SAT en segundo plano (${trabajos.length} meses × 2 tipos). Revisa la bitácora en unos minutos.` };
}

module.exports = {
  periodoMes, solicitarDescarga, procesarDescarga, procesarConEspera,
  crearJobReconciliacion, procesarPendientes, descargaMensualAutomatica,
  purgarRepositorio, programarBatch,
};
