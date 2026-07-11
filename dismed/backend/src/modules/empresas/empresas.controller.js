/**
 * empresas.controller.js — Administración de empresas (tenants) y su branding.
 * - `mi-branding`: cualquier usuario autenticado; devuelve SOLO la empresa de su
 *   token (via middleware/tenant.js) — nunca expone otros tenants.
 * - CRUD / config / logo: solo admin (guard en empresas.routes.js).
 * El branding cacheado se invalida en cada edición (branding.service.js).
 */
const path = require('path');
const fs = require('fs');
const { pool } = require('../../config/db');
const branding = require('../../services/branding.service');

const HEX = /^#[0-9a-fA-F]{6}$/;

async function miBranding(req, res, next) {
  try {
    res.json(await branding.getBranding(req.empresaId));
  } catch (err) { next(err); }
}

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM sucursales s WHERE s.empresa_id = e.id AND s.activo = 1) AS sucursales,
              (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id = e.id AND u.activo = 1)   AS usuarios
       FROM empresas e ORDER BY e.id`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

function validarCampos(body) {
  const campos = {};
  if (body.nombre !== undefined) {
    if (!body.nombre?.trim()) return { error: 'nombre no puede quedar vacío' };
    campos.nombre = body.nombre.trim();
  }
  ['nombre_comercial', 'rfc', 'regimen_fiscal', 'codigo_postal'].forEach((f) => {
    if (body[f] !== undefined) campos[f] = body[f]?.trim() || null;
  });
  ['color_primario', 'color_secundario'].forEach((f) => {
    if (body[f] === undefined) return;
    if (body[f] === null || body[f] === '') { campos[f] = null; return; }
    if (!HEX.test(body[f])) return { error: `${f} debe ser un color hex #RRGGBB` };
    campos[f] = body[f].toLowerCase();
  });
  if (body.tema !== undefined) {
    if (!['claro', 'oscuro'].includes(body.tema)) return { error: "tema debe ser 'claro' u 'oscuro'" };
    campos.tema = body.tema;
  }
  if (body.activo !== undefined) campos.activo = body.activo ? 1 : 0;
  return { campos };
}

async function create(req, res, next) {
  try {
    if (!req.body.nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    const { campos, error } = validarCampos(req.body);
    if (error) return res.status(400).json({ error });
    // color_primario NOT NULL con default: si no vino, no se incluye
    const cols = Object.keys(campos);
    const [r] = await pool.query(
      `INSERT INTO empresas (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => campos[c])
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const { campos, error } = validarCampos(req.body);
    if (error) return res.status(400).json({ error });
    const cols = Object.keys(campos);
    if (!cols.length) return res.status(400).json({ error: 'Sin campos' });
    const [r] = await pool.query(
      `UPDATE empresas SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => campos[c]), req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Empresa no encontrada' });
    branding.invalidar(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** GET /api/empresas/:id/config — valores efectivos (guardado o default) + metadata. */
async function getConfig(req, res, next) {
  try {
    const [[empresa]] = await pool.query('SELECT id FROM empresas WHERE id = ?', [req.params.id]);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const [rows] = await pool.query(
      'SELECT clave, valor FROM empresas_config WHERE empresa_id = ?', [req.params.id]
    );
    const guardado = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
    const config = {};
    for (const [clave, meta] of Object.entries(branding.CONFIG_META)) {
      config[clave] = {
        valor: clave in guardado ? guardado[clave] : meta.default,
        label: meta.label,
        valores: meta.valores || null,
        default: meta.default,
      };
    }
    res.json(config);
  } catch (err) { next(err); }
}

/** PUT /api/empresas/:id/config — clave-valor validado contra CONFIG_META. */
async function setConfig(req, res, next) {
  try {
    const updates = {};
    for (const [clave, meta] of Object.entries(branding.CONFIG_META)) {
      if (req.body[clave] === undefined) continue;
      const valor = String(req.body[clave]);
      if (meta.valores && !meta.valores.includes(valor)) {
        return res.status(400).json({ error: `${meta.label}: valores permitidos ${meta.valores.join(', ')}` });
      }
      if (meta.maxLen && valor.length > meta.maxLen) {
        return res.status(400).json({ error: `${meta.label}: máximo ${meta.maxLen} caracteres` });
      }
      updates[clave] = valor;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No se enviaron claves válidas' });
    }
    const [[empresa]] = await pool.query('SELECT id FROM empresas WHERE id = ?', [req.params.id]);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [clave, valor] of Object.entries(updates)) {
        await conn.query(
          `INSERT INTO empresas_config (empresa_id, clave, valor, descripcion)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
          [req.params.id, clave, valor, branding.CONFIG_META[clave].label]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    branding.invalidar(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/**
 * POST /api/empresas/:id/logo?tipo=principal|ticket — multipart 'archivo'.
 * El nombre del archivo lo genera multer (nunca el original); solo png/jpg/webp
 * (SVG excluido a propósito: puede llevar scripts). Ver upload en empresas.routes.js.
 */
async function subirLogo(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'archivo requerido (png, jpg o webp)' });
    const tipo = req.query.tipo === 'ticket' ? 'ticket' : 'principal';
    const columna = tipo === 'ticket' ? 'logo_ticket_path' : 'logo_path';

    const [[empresa]] = await pool.query(
      `SELECT id, ${columna} AS anterior FROM empresas WHERE id = ?`, [req.params.id]
    );
    if (!empresa) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // Ruta relativa a /uploads/branding (la sirve app.js como estático)
    const rel = path.join(`empresa_${empresa.id}`, req.file.filename).replace(/\\/g, '/');
    await pool.query(`UPDATE empresas SET ${columna} = ? WHERE id = ?`, [rel, empresa.id]);

    // Limpieza best-effort del logo anterior
    if (empresa.anterior && empresa.anterior !== rel) {
      fs.unlink(path.join(req.file.destination, '..', empresa.anterior), () => {});
    }
    branding.invalidar(empresa.id);
    res.status(201).json({ url: `/uploads/branding/${rel}` });
  } catch (err) { next(err); }
}

module.exports = { miBranding, list, create, update, getConfig, setConfig, subirLogo };
