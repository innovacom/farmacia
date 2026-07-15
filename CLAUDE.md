# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DISMED** — Sistema de Cotizaciones Médicas (Medical Distribution Quotation System) is a full-stack web application for managing medical supply distribution in Mexico. The system automates the quote comparison workflow across multiple suppliers and generates professional PDF quotations.

**Core Business Problem:** Medical supply distributors receive requests from hospitals/clinics in various formats (Excel, PDF, email). The system extracts products, consults multiple suppliers for pricing, compares quotes, applies margins, and generates customer quotations in PDF format.

**Tech Stack:**
- **Frontend:** React 18 + Vite + TailwindCSS + React Router
- **Backend:** Node.js + Express + MySQL 8.0
- **State Management:** Zustand (frontend), JWT (backend)
- **PDF Generation:** Puppeteer
- **AI Parser:** Google Gemini (free tier, via `config/ai.provider.js`) for extracting data from PDF solicitations, SKU matching, and web price search
- **Excel Parsing:** SheetJS (xlsx)
- **Email:** Nodemailer
- **Process Management:** PM2 (production)
- **Server:** Apache reverse proxy on Debian/Linux

## Development Commands

### Backend

```bash
cd dismed/backend
npm install
npm run dev        # Development with nodemon
npm start          # Production
node src/modules/auth/seed.js  # Create initial admin (one-time)
# Output: admin@dismed.mx / Admin1234! (change on first login)
```

### Frontend

```bash
cd dismed/frontend
npm install
npm run dev        # Development server on port 5173
npm run build      # Production build
npm run preview    # Preview build locally
```

### Database

```bash
mysql -u dismed_user -p dismed_db < dismed_schema_v2.sql
```

### Full Stack Local Development

Terminal 1: cd dismed/backend && npm run dev
Terminal 2: cd dismed/frontend && npm run dev
Visit http://localhost:5173

## Architecture Overview

### Directory Structure

Backend structure: src/app.js (entry), config/ (db, env), middleware/ (auth, upload), modules/ (organized by feature with routes.js, controller.js, and specialized files like parser.excel.js, pdf.generator.js)

Frontend structure: main.jsx (React entry), App.jsx (routes), components/ (layout, ui, shared), pages/ (Dashboard, Solicitudes, Proveedores, Cotizaciones, Clientes, Productos), services/api.js (Axios + JWT interceptor), store/authStore.js (Zustand persistent auth state)

Key files: ecosystem.config.js (PM2 config), deploy.sh (Debian 12 automated setup), dismed_schema_v2.sql (15 tables + 3 views + 2 stored procedures)

### Core Application Flow

1. **Login** (auth module) - JWT issued, persisted in Zustand + localStorage, Axios interceptor adds Bearer token

2. **Solicitation Creation** (solicitudes module) - Upload Excel/PDF → SheetJS parses Excel or Gemini (ai.provider) parses PDF → Backend extracts products → User validates in editable table → Save with line items

3. **Supplier Consultation** (cotizaciones/proveedor module) - User selects suppliers → Generate quotation message → Create cotizaciones_proveedor records → Register prices as suppliers respond

4. **Price Comparison** (ComparadorPrecios page) - Matrix view: products × suppliers → Highlights best price → Auto-learns SKU mapping on first supplier price entry

5. **Customer Quote** (cotizaciones/cliente module) - Create from solicitation → Apply margin (global % or per-line) → Generate PDF with Puppeteer (letterhead, folio COT-2025-0001, customer details, line items, totals) → Serve from /outputs/

### Data Model Highlights

**Core Tables:** clientes, clientes_skus, proveedores, proveedores_skus, productos (SKU_INTERNO auto-generated DM-00001), solicitudes (folio SOL-2025-0001), solicitudes_partidas, cotizaciones_proveedor, cotizaciones_proveedor_precios, cotizaciones_cliente (folio COT-2025-0001), cotizaciones_cliente_partidas

**Key Views:** v_comparador_precios (solicitations + partidas + all supplier prices), v_inventario (Phase 2), v_cuentas_por_cobrar (Phase 3)

**Stored Procedures:** sp_generar_folio(serie) for SOL/COT/PED folios, sp_generar_sku() for DM-##### SKUs

### Module Organization (Backend)

Pattern: module.routes.js → module.controller.js → async handlers (list, create, getById, etc.) + specialized logic (parser.excel.js, parser.pdf.js, pdf.generator.js)

Key Controllers:
- auth.controller.js: login, JWT, /me endpoint
- solicitudes.controller.js: CRUD + parseExcel + parsePdf + updatePartida
- cotprov.controller.js: initiate supplier quotes, register prices, calculate best price
- cotcli.controller.js: generate customer quote, generate PDF, change status
- Standard CRUD in clientes, proveedores, productos

### Frontend Route Structure

/login → / (authenticated, Layout wrapper) → /dashboard, /solicitudes, /cotizaciones, /clientes, /proveedores, /productos
Detailed routes: /solicitudes/nueva, /solicitudes/:id, /solicitudes/:id/comparador, /solicitudes/:id/proveedores/:cpId, /cotizaciones/nueva/:solicitudId, /cotizaciones/:id

## Required Environment Variables

Backend (.env in dismed/backend/):
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (MySQL 8.0)
- JWT_SECRET (min 32 chars), JWT_EXPIRES_IN (8h)
- GEMINI_API_KEY (required for PDF parsing, SKU matching, and web price search), GEMINI_MODEL (default gemini-2.5-flash)
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (email relay)
- UPLOAD_DIR (./uploads), OUTPUT_DIR (./outputs), BASE_URL (http://localhost:3001)
- PORT (3001)
- EMPRESA_NOMBRE, EMPRESA_RFC, EMPRESA_TELEFONO, EMPRESA_EMAIL, EMPRESA_DIRECCION (PDF letterhead)

Frontend: vite.config.js already proxies /api and /outputs to http://localhost:3001. Ensure backend is running.

## Important Notes for Development

### AI Provider (Gemini)

PDF parser (solicitudes/parser.pdf.js), SKU matcher (solicitudes/matcher.ia.js), and web price search (solicitudes/buscador.web.js) all go through `config/ai.provider.js`, which calls Google Gemini (free tier, GEMINI_API_KEY must be set). No paid AI provider is used — if Gemini's free-tier quota is exhausted after retries, a clear 503 error is returned instead of falling back to a paid API. Users can manually enter items if PDF parsing fails. Always present parsed results in editable table for user validation.

### Database Connections

MySQL connection pool (config/db.js) with 10 limit, timezone -06:00 (Mexico City). Always use parameterized queries. Transactions in create operations (solicitudes.controller.js example).

### File Handling

Multer: uploads in ./uploads/, parsed immediately, originals kept. PDFs: generated to ./outputs/, served by backend static middleware at /outputs/*.

### PDF Generation

Puppeteer (cotizaciones/cliente/pdf.generator.js): renders HTML to PDF server-side, uses company letterhead env vars, folio from sp_generar_folio(), output COT-YEAR-NUMBER.pdf, downloadable via /outputs/COT-2025-0001.pdf.

### Authentication Flow

Token issued on login, stored in Zustand (localStorage), Axios interceptor attaches Bearer token. On 401 response: logout and redirect to /login. Token expires after 8h.

## Production Deployment

deploy.sh: Complete Debian 12 + Apache2 setup. Installs Node.js 20, PM2, Apache modules, creates MySQL user, builds frontend (npm run build → dist/), starts backend under PM2, configures Apache VirtualHost with /api and /outputs proxies. Requires root or sudo.

Key points: Frontend served from dist/, backend on port 3001, Apache proxy on 80, no SSL (add certbot manually), admin created via seed.js.

## Testing & Validation

No test suite configured. Manual: Backend (curl/Postman /api endpoints), Frontend (DevTools Network/Application tabs for tokens and requests), Database (phpMyAdmin/MySQL Workbench for data + view/SP outputs).

## Phase Roadmap

Phase 1 (MVP, current): Auth, Solicitation (Excel/PDF parsing), Price comparison, Customer quotes + PDF
Phase 2: Inventory (lotes, caducidad, FIFO)
Phase 3: CFDI timbrado + cobranza
Phase 4: Data migration + go-live

## Key Design Decisions

1. **SKU Learning** — Auto-map customer ↔ internal ↔ supplier codes. First occurrence requires user confirmation, then automatic.

2. **Preserve Original Data** — codigo_cliente and descripcion_original never modified, preserving reference history.

3. **Two-Level Margins** — Global % + per-line override, both persisted for analytics.

4. **Folio Traceability** — SOL → COT → PED → FAC linked through supply chain.

5. **IA as Assistant** — Gemini parses PDFs, but user validates results in editable table before save.

## Troubleshooting

- GEMINI_API_KEY missing: Set in .env before backend startup
- MySQL connection refused: Verify DB_HOST, DB_USER, DB_PASSWORD
- Puppeteer crashes: ~170 MB Chromium download during npm install. Ensure disk space and internet.
- JWT 401 errors: Token expired (8h) or cleared. Re-login.
- PDF not downloading: Backend running? /outputs folder exists with write permissions?

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
