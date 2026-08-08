# WhatsApp Cloud API — puesta en marcha (número dedicado)

Se usa un número de teléfono **nuevo, que nunca ha tenido WhatsApp instalado**
(ni la app normal ni WhatsApp Business), dedicado solo al envío/recepción de
recordatorios de citas. Esto evita por completo la complejidad de
"Coexistence" (mantener un número funcionando a la vez en la app del celular
y en la API) — con un número nuevo, el alta es directa en la propia
interfaz de Meta, sin pasos de vinculación especiales ni código adicional.

> Nota: una versión anterior de este README explicaba un flujo de
> "Coexistence" con Embedded Signup para reusar el número que ya está en la
> app del celular. Se descartó esa vía a petición explícita: es más simple
> y confiable dar de alta un número aparte, exclusivo para esto.

## 1. Requisitos

- Un número de teléfono (SIM o VoIP) que **nunca** se haya usado con
  WhatsApp ni WhatsApp Business — puede ser una línea nueva, o un número
  fijo/VoIP que reciba el SMS o llamada de verificación (Meta permite ambas
  opciones al verificar).
- Cuenta de Meta Business Manager ya verificada (ya la tienen).

## 2. Crear la App en Meta for Developers

1. Entrar a https://developers.facebook.com/apps con la cuenta de Facebook
   que administra el Business Manager ya verificado.
2. Crear App → tipo "Negocio" (Business).
3. Agregar el producto **WhatsApp**.

## 3. Dar de alta el número

Dentro de la App → **WhatsApp → Configuración de la API** (o "API Setup" /
"Primeros pasos"):
1. Elegir el WABA (WhatsApp Business Account) que se va a usar — Meta puede
   crear uno nuevo ahí mismo si no existe.
2. **Agregar número de teléfono** → escribir el número nuevo (código de país
   + número) y el nombre para mostrar (display name) del negocio.
3. Verificar por SMS o llamada — Meta manda un código de 6 dígitos, se
   captura ahí mismo.
4. Listo: la misma pantalla muestra el **WABA ID** y el **Phone Number ID**.

El nombre para mostrar pasa por una revisión aparte de Meta (puede tardar
horas/días); mientras tanto el número ya funciona para enviar/recibir, solo
se ve con el nombre pendiente de aprobar.

## 4. Generar el token permanente (System User)

1. business.facebook.com → Configuración del negocio → Usuarios → **Usuarios
   del sistema** → Agregar.
2. Asignar ese usuario del sistema al WABA con rol de administrador.
3. Generar token → permisos `whatsapp_business_messaging` y
   `whatsapp_business_management` → sin expiración.
4. Copiar el token (solo se muestra una vez).

## 5. Variables de entorno (`.env` del backend)

```
META_APP_SECRET=...            # de la App, para validar la firma del webhook
WHATSAPP_WABA_ID=...           # del paso 3
WHATSAPP_PHONE_NUMBER_ID=...   # del paso 3
WHATSAPP_ACCESS_TOKEN=...      # el token permanente del paso 4
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...   # inventar un valor propio, cualquier cadena larga
WHATSAPP_TEMPLATE_RECORDATORIO=recordatorio_cita   # nombre exacto de la plantilla aprobada
WHATSAPP_TEMPLATE_RECORDATORIO_LANG=es_MX
```

Reiniciar el backend después de guardar el `.env`.

## 6. Configurar el webhook en la App de Meta

En developers.facebook.com → la App → WhatsApp → Configuration → Webhook:
- **Callback URL**: `https://sistema.innovacom.mx/api/whatsapp/webhook`
- **Verify token**: el mismo valor que `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Suscribirse solo al campo **`messages`**.

## 7. Suscribir la app al WABA (una sola vez)

```
node whatsapp_suscribir.js
```

## 8. Crear y aprobar la plantilla de recordatorio

En WhatsApp Manager → Message Templates → Crear plantilla:
- Categoría: **Utility**
- Variables **con nombre** (no posicionales `{{1}}`) — así quedó armada la
  plantilla real:
  - **Encabezado (header)**: `{{nombre}}` = nombre del paciente.
  - **Cuerpo (body)**, en este orden: `{{fecha}}`, `{{hora}}`, `{{servicio}}`.

  Ejemplo:

  > **{{nombre}}** _(header)_
  > Le recordamos su cita el {{fecha}} a las {{hora}} ({{servicio}}).
  > ¿Confirma que asistirá? _(body)_

- Meta exige que cada parámetro enviado incluya `parameter_name` con el
  nombre EXACTO (mayúsculas/minúsculas) definido en la plantilla — si no,
  tira `(#100) Parameter name is missing or empty`. Si se cambian los
  nombres o el orden de las variables, ajustar
  `whatsapp.service.js#enviarRecordatorioCita` (arma el `header`/`body` que
  manda `whatsapp.client.js#enviarPlantillaRecordatorio`) para que coincida
  exacto.

- 3 botones de respuesta rápida. En WhatsApp Manager el "payload" que Meta
  manda de vuelta en el webhook (`button.payload`) es, por defecto, el texto
  literal del botón (no hay que inventar un código aparte). Los que quedaron
  dados de alta en la plantilla real, y que usa
  `whatsapp.service.js#PAYLOAD_ACCION` para decidir qué hacer:
  - Botón "Asistiré" → payload `Asistire` → confirma la cita.
  - Botón "Cancelaré" → payload `Cancelare` → cancela la cita.
  - Botón "Reprogramaré" → payload `Reprogamar` (así quedó escrito en la
    plantilla real, con typo) → pide nueva fecha/hora.

  Si se edita la plantilla y cambia el texto de los botones, hay que
  actualizar `PAYLOAD_ACCION` en `whatsapp.service.js` para que coincida
  exacto con el nuevo payload (revisar `whatsapp_eventos` con tipo
  `mensaje_no_ligado` si un botón deja de reconocerse).

Meta suele aprobar plantillas de categoría "utility" en minutos u horas.

## Cómo probarlo antes de gastar en el número real

La misma App de Meta trae, apenas se agrega el producto WhatsApp, un
**número de prueba gratuito** (Test Number, en la pantalla de "Configuración
de la API") que ya puede enviar/recibir sin pasar por el paso 3. Se le
agrega un celular propio como "destinatario de prueba" y con eso ya se
puede probar plantilla + webhook + botones de punta a punta, sin haber dado
de alta el número definitivo todavía.

## Qué queda automático después de esto

- Botón "Enviar recordatorio" en Citas/Venta mostrador dispara la plantilla
  vía API (en vez del enlace manual `wa.me`).
- Si el paciente responde con un botón, el webhook (`POST /api/whatsapp/webhook`)
  liga la respuesta a la cita (por `context.id`, guardado en `whatsapp_mensajes`
  al enviar el recordatorio) y aplica la acción, igual que si el empleado lo
  hiciera a mano en `pos_citas`, y además le contesta al paciente:
  - **Confirmar** → `confirmarCita` + mensaje de agradecimiento.
  - **Cancelar** → `cancelarCita` (mismo cancelado "suave" que usa el
    empleado: libera el horario, guarda motivo/auditoría, no borra la fila)
    + aviso de que quedó cancelada.
  - **Reprogramar** → marca `reprogramar_solicitado` + le pregunta la nueva
    fecha/hora. Cuando el paciente contesta con texto libre en el formato
    `DD/MM/AAAA HH:MM` (ver `whatsapp.service.js#intentarReprogramarPorTexto`),
    se busca su solicitud pendiente por teléfono y se reagenda con
    `updateCita` (mismas validaciones de horario/disponibilidad que usa el
    empleado); si el formato no se entiende o el horario no sirve, se le pide
    reintentar sin tocar la cita.
- Cualquier otro texto libre que no corresponda a una reprogramación
  pendiente se guarda en `whatsapp_eventos` para revisar manualmente.
