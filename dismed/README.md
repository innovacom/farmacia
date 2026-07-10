# DISMED — Sistema de Cotizaciones Médicas

Sistema web para distribución de insumos médicos en México.  
Stack: **React + Vite + TailwindCSS** / **Node.js + Express** / **MySQL 8.0**

---

## Requisitos previos

- Node.js 18 o superior
- npm 9 o superior
- MySQL 8.0 (acceso al VPS con cPanel)
- Una API Key de Anthropic (para el parser de PDF)

---

## 1. Base de datos

Ejecuta el script en tu MySQL (phpMyAdmin o cliente):

```bash
mysql -u root -p < dismed_schema_v2.sql
```

Esto crea: 15 tablas + 3 vistas + 2 stored procedures + tabla `folios` con series iniciales.

---

## 2. Backend

### Instalar dependencias

```bash
cd backend
npm install
```

> ⚠️ Puppeteer descarga Chromium (~170 MB) durante `npm install`. Asegúrate de tener conexión a internet.

### Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus datos reales:

```env
DB_HOST=IP_DE_TU_VPS
DB_USER=dismed_user
DB_PASSWORD=tu_password
DB_NAME=dismed_db
JWT_SECRET=una_clave_larga_y_aleatoria_minimo_32_caracteres
ANTHROPIC_API_KEY=sk-ant-...
EMPRESA_NOMBRE=Tu Distribuidora SA de CV
EMPRESA_RFC=XXXX000000XXX
```

### Crear usuario admin (solo una vez)

```bash
node src/modules/auth/seed.js
```

Crea: `admin@dismed.mx` / `Admin1234!`  
Cámbialo inmediatamente después del primer login.

### Iniciar el servidor

```bash
npm run dev        # desarrollo (con nodemon)
npm start          # producción
```

API disponible en: `http://localhost:3001`

---

## 3. Frontend

### Instalar dependencias

```bash
cd frontend
npm install
```

### Iniciar en desarrollo

```bash
npm run dev
```

App disponible en: `http://localhost:5173`

El proxy de Vite redirige `/api` → `http://localhost:3001` automáticamente.

---

## 4. Flujo completo del sistema

```
1. Login → admin@dismed.mx
2. Agregar clientes y proveedores en sus catálogos
3. Solicitudes → Nueva solicitud
   - Elige Excel/PDF/Manual
   - Arrastra el archivo del cliente
   - Revisa y corrige la tabla de partidas extraídas
   - Guarda la solicitud
4. En el detalle de la solicitud:
   - Selecciona los proveedores a consultar → "Iniciar cotización"
   - Copia el mensaje generado y envíalo a cada proveedor
5. Cuando los proveedores respondan:
   - Clic en "Registrar precios" por cada proveedor
   - Ingresa precios y SKU del proveedor
6. Comparador de precios → "Recalcular mejor precio"
   - Verde = mejor precio para esa partida
7. Crea cotización al cliente:
   - Ajusta margen global o por partida
   - Haz clic en "Crear cotización"
8. En el detalle de la cotización:
   - "Generar PDF" → descarga el PDF con membrete
   - "Marcar enviada" → "Aceptada" → "Convertir a pedido"
```

---

## 5. Estructura de carpetas

```
dismed/
├── backend/
│   ├── src/
│   │   ├── config/         db.js, env.js
│   │   ├── middleware/      auth.js (JWT), upload.js (Multer)
│   │   ├── modules/
│   │   │   ├── auth/        login, seed de usuario admin
│   │   │   ├── clientes/    CRUD + contactos + diccionario SKUs
│   │   │   ├── proveedores/ CRUD + categorías + diccionario SKUs
│   │   │   ├── productos/   CRUD + generación automática SKU (DM-00001)
│   │   │   ├── solicitudes/ parser.excel.js, parser.pdf.js (Anthropic API)
│   │   │   └── cotizaciones/
│   │   │       ├── proveedor/ comparador, registro precios
│   │   │       └── cliente/   generación PDF (Puppeteer)
│   │   └── app.js
│   ├── .env
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/layout/  Layout, Sidebar
│   │   ├── pages/
│   │   │   ├── Login, Dashboard
│   │   │   ├── Solicitudes/    Lista, Nueva (drag&drop), Detalle
│   │   │   ├── Proveedores/    Lista, Comparador, RegistrarPrecios
│   │   │   ├── Cotizaciones/   Lista, Nueva, Detalle
│   │   │   ├── Clientes/       Lista + modal CRUD
│   │   │   └── Productos/      Lista + modal CRUD
│   │   ├── services/api.js     Axios + interceptores JWT
│   │   └── store/authStore.js  Zustand (token persistido)
│   └── package.json
│
├── uploads/     Archivos subidos por el usuario (Excel, PDF)
├── outputs/     PDFs generados (cotizaciones)
└── dismed_schema_v2.sql
```

---

## 6. APIs principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login → retorna JWT |
| POST | `/api/solicitudes/parse-excel` | Extrae partidas de Excel |
| POST | `/api/solicitudes/parse-pdf` | Extrae partidas de PDF con IA |
| POST | `/api/solicitudes/:id/partidas/bulk` | Guarda partidas en bloque |
| GET | `/api/solicitudes/:id/comparador` | Vista comparador de precios |
| POST | `/api/cotizaciones-proveedor` | Inicia cotización a proveedores |
| PUT | `/api/cotizaciones-proveedor/:id/precios` | Registra precios recibidos |
| POST | `/api/cotizaciones-proveedor/solicitud/:id/calcular` | Marca mejor precio |
| POST | `/api/cotizaciones-cliente` | Crea cotización al cliente |
| GET | `/api/cotizaciones-cliente/:id/pdf` | Genera PDF (Puppeteer) |
| POST | `/api/cotizaciones-cliente/:id/convertir-pedido` | Convierte a pedido |

---

## 7. Variables de entorno completas

Ver `.env.example` en la carpeta `backend/`.

---

## 8. Notas de despliegue en VPS (cPanel)

1. Sube la carpeta `backend/` al VPS via FTP o Git
2. Ejecuta `npm install --production` en el VPS
3. Configura un proceso Node.js en cPanel (Node.js Selector)
4. Construye el frontend: `npm run build` → sube la carpeta `dist/` como sitio estático
5. Asegúrate de que el firewall permita el puerto 3001 internamente
6. Ajusta `BASE_URL` en `.env` con la URL pública del VPS

---

*Fase 1 completa — Mayo 2025*
