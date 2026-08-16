const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/pdf',
    'text/xml',
    'application/xml',
  ];
  // application/octet-stream: fallback real que mandan varios sistemas
  // operativos/navegadores para .xml sin registrar — solo se acepta
  // combinado con la extensión, nunca solo. Antes CUALQUIER mimetype con
  // nombre *.xml pasaba (bastaba renombrar un .exe a factura.xml).
  const xmlOctetStream = file.mimetype === 'application/octet-stream' && /\.xml$/i.test(file.originalname);
  if (allowed.includes(file.mimetype) || xmlOctetStream) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls, .csv), PDF y XML'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

module.exports = upload;
