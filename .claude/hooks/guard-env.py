#!/usr/bin/env python3
"""PreToolUse (Edit|Write): bloquea la escritura sobre secretos y credenciales.
DISMED guarda en .env el GEMINI_API_KEY, JWT_SECRET y contraseñas de BD, y en
*.cer/*.key/*.pem los certificados CFDI del SAT. Un sobrescrito accidental rompe
producción o filtra llaves. Edición manual fuera de Claude sigue siendo posible."""
import json, sys, os

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

t = d.get("tool_input", d) or {}
fp = str(t.get("file_path") or "")
base = os.path.basename(fp.replace("\\", "/")).lower()

# .env y variantes (.env, .env.production, .env.local) + credenciales CFDI
blocked = base.startswith(".env") or base.endswith((".cer", ".key", ".pem"))

if blocked:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "Bloqueado: '" + base + "' contiene secretos (claves API/JWT/BD o "
            "certificados CFDI del SAT). Edítalo manualmente, no desde Claude. "
            "Si de verdad necesitas cambiarlo, pídeselo al usuario."
        ),
    }}))
    sys.exit(0)
