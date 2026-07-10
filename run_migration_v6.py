#!/usr/bin/env python3
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

HOST = "72.249.60.175"; USER = "root"; PASS = "GaPaPaRoEl1"; DB = "dismed_db"
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd):
    _, o, e = ssh.exec_command(cmd)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

# 1. Agregar factor_ganancia a solicitudes
out = run(f"""mysql -u root -p'{PASS}' {DB} -e \
"ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS factor_ganancia DECIMAL(5,4) NULL AFTER referencia_cliente" 2>&1""")
print("OK  solicitudes.factor_ganancia" if "error" not in out.lower() else f"FAIL {out}")

# 2. Recrear la vista con observaciones incluidas
vista_sql = """
CREATE OR REPLACE VIEW v_comparador_precios AS
SELECT
  s.id                          AS solicitud_id,
  s.folio                       AS folio_solicitud,
  sp.id                         AS partida_id,
  sp.linea,
  sp.descripcion_original,
  sp.codigo_cliente,
  sp.cantidad,
  sp.unidad_medida,
  sp.observaciones,
  p.nombre_empresa              AS proveedor,
  cpp.sku_proveedor,
  cpp.observaciones_proveedor,
  cpp.precio_unitario,
  cpp.disponible,
  cpp.es_mejor_precio,
  (cpp.precio_unitario * sp.cantidad) AS importe_compra
FROM solicitudes s
JOIN solicitudes_partidas sp       ON sp.solicitud_id = s.id
JOIN cotizaciones_proveedor cp     ON cp.solicitud_id = s.id
JOIN proveedores p                 ON p.id = cp.proveedor_id
LEFT JOIN cotizaciones_proveedor_precios cpp
                                   ON cpp.cotizacion_proveedor_id = cp.id
                                  AND cpp.partida_id = sp.id
ORDER BY s.id, sp.linea, cpp.precio_unitario
"""
out = run(f"mysql -u root -p'{PASS}' {DB} -e \"{vista_sql.strip()}\" 2>&1")
print("OK  v_comparador_precios actualizada (+ observaciones)" if "error" not in out.lower() else f"FAIL {out}")

ssh.close()
