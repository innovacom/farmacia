# Memoria de proyecto: Automatización de facturas/comprobantes → Dismed

> Cargar este documento como contexto/memoria en el proyecto Dismed para continuar la implementación de forma nativa.

## 1. Memoria (contexto y decisiones)

**Objetivo:** automatizar la lectura de facturas y comprobantes de pago recibidos en PDF (por correo o depositados en una carpeta) y su integración directa al sistema Dismed, sin captura manual.

**Alcance real de la integración (aclarado 1 de julio de 2026):**
- **Facturas (CFDI) en PDF:** no basta con guardarlas. El dato clave a extraer con IA es **lote y fecha de caducidad** por partida, ya que el XML del CFDI normalmente NO incluye esos campos (son datos logísticos, no fiscales). Estos valores deben integrarse tanto a la base de datos de CFDI de Dismed como al módulo de inventarios (lotes/caducidad), de modo que se acepten automáticamente sin que el usuario tenga que capturarlos manualmente.
- **Comprobantes de pago:** no requieren integración adicional de datos. Solo se guardan (el PDF) y se relacionan con la factura que están pagando.

**Sobre Dismed:**
- Es una aplicación web propia, con base de datos.
- No tiene API expuesta actualmente.
- Sí se tiene acceso directo a la base de datos.
- La intención es que esta automatización termine integrada de forma nativa al propio sistema Dismed (no como un proceso externo permanente).

**Stack decidido (tras investigación de opciones gratuitas, julio 2026):**
- **Orquestación/automatización diaria:** n8n autohospedado (gratis, sin límite de ejecuciones en modalidad self-hosted, con nodos nativos para Gmail, Google Drive/carpeta, y bases de datos SQL).
- **Extracción de datos (OCR):** modelo de IA vía API (Gemini o Mistral OCR) en lugar de Tesseract puro, porque identifica campos semánticamente en cualquier formato de factura/comprobante sin necesitar plantilla por proveedor.
- **Conector hacia Dismed:**
  - Corto plazo: escritura directa a la base de datos de Dismed mediante nodo SQL en n8n.
  - Mediano plazo (más robusto): exponer un endpoint/webhook propio dentro de Dismed que reciba los datos ya estructurados en JSON, para desacoplar la automatización del esquema interno de la BD.

**Estado actual:** fase de diseño. No hay código implementado todavía; este documento define el flujo a implementar.

**Pendientes a definir antes de implementar:**
- Motor exacto de base de datos de Dismed (MySQL, PostgreSQL, SQL Server, etc.) y credenciales de acceso.
- Esquema real de las tablas donde deben insertarse facturas y comprobantes de pago (nombres de columnas, tipos, relaciones con proveedores/órdenes).
- Cuenta de correo y/o carpeta específica que se va a monitorear.
- Dónde se va a hospedar n8n (servidor propio, VPS, contenedor Docker).
- Campos obligatorios que Dismed requiere por cada factura/comprobante (RFC, folio fiscal, forma de pago, referencia, etc.).

---

## 2. Flujo de automatización, paso a paso

1. **Preparar las entradas.** Definir la carpeta compartida (Google Drive, Dropbox o carpeta de red) y/o la cuenta de correo dedicada (Gmail/Outlook) donde llegarán las facturas y comprobantes en PDF.

2. **Hospedar n8n.** Instalar n8n self-hosted (gratis) en un servidor propio o VPS económico, vía Docker. Esto evita límites de ejecuciones y permite conexión directa a la base de datos de Dismed sin exponer nada a internet innecesariamente.

3. **Disparador (trigger).** Configurar un nodo Gmail Trigger / IMAP (filtrando correos con adjunto PDF) y/o un nodo de carpeta (Google Drive Trigger o Local File Trigger) que se active cuando llegue un archivo nuevo.

4. **Descarga y normalización.** Nodo que toma el archivo (adjunto o depositado) y lo prepara (base64 o guardado temporal) para enviarlo al motor de extracción.

5. **Extracción con IA (OCR).** Nodo HTTP Request hacia la API de Gemini o Mistral OCR, enviando el PDF junto con un prompt que pida como respuesta un JSON estructurado con los campos necesarios: proveedor, RFC, folio/serie, fecha, subtotal, IVA, total, forma de pago, referencia de pago, etc.

6. **Validación de datos.** Nodo de validación (Code/IF) que confirme que los campos obligatorios existen y que los montos cuadran (ej. subtotal + IVA = total). Si algo falla, el documento se enruta a una carpeta o correo de "revisión manual" en vez de pasar a Dismed.

7. **Mapeo al esquema de Dismed.** Nodo que transforma el JSON extraído al formato exacto de las columnas/tablas reales de Dismed (este paso depende de los pendientes de la sección 1).

8. **Escritura en Dismed.**
   - Opción A (corto plazo): nodo SQL (MySQL/Postgres/etc.) que inserta el registro directo en la tabla correspondiente de la base de datos de Dismed.
   - Opción B (cuando exista): nodo HTTP Request al endpoint/webhook propio de Dismed.

9. **Trazabilidad.** Mover el PDF original a una carpeta "procesados" y registrar un log de éxito/error (tabla de auditoría o control) para poder rastrear qué se cargó y cuándo.

10. **Notificación diaria.** Mensaje de resumen (correo, Slack o Telegram) indicando cuántos documentos se procesaron correctamente y cuáles quedaron pendientes de revisión.

11. **Manejo de fallidos.** Trigger adicional tipo Schedule (una vez al día) que revise la carpeta de "revisión manual" y reintente o avise si hay documentos acumulados sin procesar.

12. **Pruebas.** Correr el flujo completo con un lote real de facturas y comprobantes de distintos proveedores y formatos antes de activarlo en producción.

13. **Puesta en producción.** Activar el workflow en n8n, asegurar respaldo de credenciales/BD, y dejar planeada la migración a un endpoint API propio de Dismed cuando el equipo lo desarrolle, para mayor robustez a largo plazo.

---

*Documento generado el 1 de julio de 2026 como continuación de la investigación de herramientas (n8n, Gemini/Mistral OCR, conexión directa a BD) para la automatización de captura de facturas y comprobantes de pago en Dismed.*
