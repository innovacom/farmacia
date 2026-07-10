# Manual de usuario — Skill `/descarga-sat`

Descarga masiva de CFDI del SAT **a demanda** (emitidos y recibidos), para cualquier
mes o rango de fechas. Es la versión manual del proceso automático que ya corre el
día 3 de cada mes (`sat.cron.js`).

> **Solo la disparas tú.** La skill toca la e.firma y la base de datos de producción,
> por eso está marcada para no ejecutarse de forma automática.

---

## 1. Qué hace

Cuando escribes `/descarga-sat`, Claude Code se conecta por SSH al servidor y corre
el script `scripts/descarga_sat.js`, que en orden:

1. **Valida la e.firma (FIEL)** con la función `ValidaSat`. Si está vencida o la
   contraseña no coincide, se detiene sin gastar una solicitud ante el SAT.
2. **Solicita la descarga** al SAT por cada tipo (emitidos / recibidos).
3. **Espera** a que el SAT procese la solicitud (es asíncrono: de segundos a horas)
   y descarga los XML, guardándolos en `cfdi_repositorio`.
4. **Reconcilia el estatus** (vigente / cancelado) automáticamente al terminar.

El detalle de lo descargado queda consultable en la página **`/cfdi`** del sistema.

---

## 2. Requisitos (ya cumplidos)

- La e.firma (`.cer` / `.key` / clave) debe estar en el servidor — ya configurada.
- El backend desplegado debe incluir `ValidaSat` y `scripts/descarga_sat.js` — ya
  desplegado. Si en el futuro cambias ese código, vuelve a desplegar con `/deploy`
  o `python deploy.py --solo-backend`.

---

## 3. Cómo usarla

En la línea de Claude Code escribe la skill seguida del periodo:

| Comando | Qué descarga |
|---|---|
| `/descarga-sat 2026-05` | Todo mayo 2026, **emitidos y recibidos** |
| `/descarga-sat 2026-05 emitido` | Solo **emitidos** de mayo 2026 |
| `/descarga-sat 2026-05 recibido` | Solo **recibidos** de mayo 2026 |
| `/descarga-sat 2026-05-01 2026-05-15` | Rango de fechas (1 al 15 de mayo), ambos tipos |
| `/descarga-sat 2026-05-01 2026-05-15 emitido` | Ese rango, solo emitidos |

Si la invocas sin periodo (`/descarga-sat`), Claude te preguntará el mes o rango
antes de continuar.

**Formatos válidos del periodo:**
- Mes completo: `YYYY-MM` (ej. `2026-05`)
- Rango de fechas: `YYYY-MM-DD YYYY-MM-DD` (ej. `2026-05-01 2026-05-15`)

---

## 4. Cómo leer el resultado

El script imprime el avance y termina con una línea `RESUMEN:`. Lo importante:

- **`FIEL: {"valida":true, ...}`** → la e.firma se validó correctamente.
- **`[emitido] final: {... "estado":"descargada" ...}`** → ese tipo se descargó.
- **`num_cfdis`** → cuántos comprobantes vio el SAT en el periodo.
- **`num_importados`** → cuántos se guardaron nuevos (no duplica los que ya tenías).

Después puedes revisar todo en la página **`/cfdi`**.

---

## 5. Casos comunes

**La e.firma está vencida / mala contraseña**
El script se detiene de inmediato con `valida:false` y código de error. No se gasta
ninguna solicitud. Renueva la e.firma en el servidor y vuelve a intentar.

**El SAT tarda y un tipo queda "en proceso"**
Es normal: el SAT puede tardar horas. La skill te lo indica y ofrece **reanudar más
tarde**: vuelve a invocar `/descarga-sat <mismo periodo>` o pídele a Claude que corra
`procesarPendientes` (reanuda las solicitudes no terminadas sin volver a pedirlas).

**Repetir un mes ya descargado**
No pasa nada: la descarga es **idempotente por UUID**. Re-descargar no duplica
comprobantes; solo agrega los que falten y actualiza estatus.

---

## 6. Notas técnicas (referencia)

- **Script:** `dismed/backend/scripts/descarga_sat.js`
- **Skill:** `.claude/skills/descarga-sat/SKILL.md`
- **Validación FIEL:** `ValidaSat()` en `dismed/backend/src/modules/cfdi/sat.client.js`
- **Servicio reutilizado:** `sat.descarga.service.js`
  (`solicitarDescarga`, `procesarConEspera`, `procesarPendientes`, `periodoMes`)
- **Bitácora de descargas:** tabla `cfdi_descargas` (permite reanudar)
- **Comprobantes:** tabla `cfdi_repositorio`
- Nunca se toca el `.env` ni la e.firma desde la skill; viven solo en el servidor.
