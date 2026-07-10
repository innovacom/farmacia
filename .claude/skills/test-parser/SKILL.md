---
name: test-parser
description: Prueba los parsers de solicitudes de DISMED (Excel/PDF/matcher/buscador web) contra un archivo real subido, sin escribir scripts desechables ni tocar la BD. Invocar con /test-parser.
disable-model-invocation: true
---

# /test-parser — Probar parsers de DISMED contra un archivo real

Ejecuta el extractor de productos sobre un archivo de solicitud (Excel o PDF) e imprime el resultado estructurado para validarlo, **sin** crear la solicitud ni escribir en la BD. Sustituye los scripts desechables (`inspect_xlsx.js`, `test_parser.js`, `test_buscador.js`, `test_matcher.js`) que antes se escribían a mano.

## Entrada
El usuario pasa una ruta de archivo (`.xlsx`/`.xls` o `.pdf`). Si no la da, lista los más recientes en `dismed/backend/uploads/` y pregunta cuál usar.

## Módulos a ejercitar (en `dismed/backend/src/modules/solicitudes/`)
- `parser.excel.js` — extracción de partidas desde Excel (SheetJS).
- `parser.pdf.js` — extracción vía Anthropic API (requiere `ANTHROPIC_API_KEY` en `.env`).
- `matcher.ia.js` / `matcher.js` — mapeo a SKU interno.
- `buscador.web.js` — búsqueda/enriquecimiento web (si aplica al caso).

## Pasos
1. **Detectar la firma real** del parser elegido: ábrelo y mira qué exporta y qué recibe (ruta de archivo vs. buffer, sync vs. async). No asumas la firma — léela. (Si hay `graphify-out/graph.json`, usa `graphify query "como se invoca parser.excel"` primero.)
2. **Escribir el arnés** en un temporal **fuera del árbol del repo** (p. ej. `$TEMP`/`/tmp`), no dentro de `dismed/`, para no ensuciar el deploy ni el graph. Carga `dotenv`, hace `require` del parser con ruta relativa al backend, lo corre sobre el archivo y hace `console.log(JSON.stringify(resultado, null, 2))`.
3. **Ejecutar** con `cwd` en `dismed/backend` para que resuelvan los `require` y el `.env`:
   ```bash
   cd dismed/backend && node "<ruta-temporal-del-arnes>" "<ruta-del-archivo>"
   ```
4. **Reportar:** número de partidas extraídas, una muestra (descripción original, código cliente, cantidad, unidad, precio si lo hay) y cualquier fila que el parser haya descartado o no haya podido leer.
5. **Limpiar** el arnés temporal al terminar.

## Reglas
- **Solo lectura de datos:** nunca insertes la solicitud ni escribas en MySQL/MariaDB. Esto es validación de extracción, no creación.
- No guardes el arnés dentro de `dismed/` (rompería el build/scp y el graph). Bórralo al final.
- Respeta `RN-001` (partidas) y `RN-002` (NO COTIZO) al interpretar el resultado: marca si el parser las respeta.
- Si `parser.pdf.js` falla por falta de `ANTHROPIC_API_KEY`, dilo claramente en vez de seguir.
- Puede correr en local; no requiere VPS.
