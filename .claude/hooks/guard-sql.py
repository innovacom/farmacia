#!/usr/bin/env python3
"""PreToolUse (Bash): pide confirmacion ante operaciones destructivas contra la BD.
DISMED tiene UNA sola base de datos y es produccion. No bloquea de forma dura: usa
'ask' para que el usuario confirme cuando el borrado es intencional (p.ej. wipe de pruebas)."""
import json, sys, re

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = (d.get("tool_input", d) or {}).get("command", "") or ""
low = cmd.lower()

reasons = []
if re.search(r"drop\s+(table|database)", low): reasons.append("DROP TABLE/DATABASE")
if "truncate" in low: reasons.append("TRUNCATE")
if re.search(r"delete\s+from", low) and " where " not in low: reasons.append("DELETE sin WHERE")
if "wipe_transaccional" in low: reasons.append("script wipe_transaccional")

# Solo si parece dirigido a la BD (evita falsos positivos en texto suelto).
context = any(k in low for k in ("mysql", "node ", "dismed_db", ".sql", "pool.query"))

if reasons and context:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "ask",
        "permissionDecisionReason": (
            "Operacion potencialmente destructiva contra la BD ("
            + ", ".join(reasons)
            + "). DISMED tiene UNA sola BD y es produccion. Confirma que es intencional y que existe respaldo."
        ),
    }}))
