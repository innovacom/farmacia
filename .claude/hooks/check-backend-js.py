#!/usr/bin/env python3
"""PostToolUse (Edit|Write): corre `node --check` sobre archivos .js del backend.
DISMED se despliega sin pipeline; un error de sintaxis tumba PM2 en el VPS. Si el
check falla, devuelve el error como contexto para corregirlo ANTES de desplegar."""
import json, sys, subprocess

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

t = d.get("tool_input", d) or {}
fp = str(t.get("file_path") or "")
norm = fp.replace("\\", "/")

if norm.endswith(".js") and "/dismed/backend" in norm and "node_modules" not in norm:
    try:
        r = subprocess.run(["node", "--check", fp], capture_output=True, text=True)
    except Exception:
        sys.exit(0)
    if r.returncode != 0:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "node --check FALLO en " + fp + ":\n" + (r.stderr or "")[:600],
        }}))
