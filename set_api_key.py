#!/usr/bin/env python3
import sys, getpass
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import paramiko
except ImportError:
    print("ERROR: pip install paramiko")
    sys.exit(1)

HOST = "72.249.60.175"
USER = "root"
PASS = "GaPaPaRoEl1"
ENV  = "/var/www/dismed/backend/.env"

print("\n=== Configurar ANTHROPIC_API_KEY en produccion ===\n")
key = getpass.getpass("Pega tu API Key de Anthropic (sk-ant-...): ").strip()

if not key.startswith("sk-ant-"):
    print("\nERROR: La clave no tiene el formato correcto. Debe empezar con sk-ant-")
    sys.exit(1)

print("\nConectando al servidor...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd):
    _, o, e = ssh.exec_command(cmd)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

# Actualizar o agregar la variable en el .env
result = run(f"grep -q 'ANTHROPIC_API_KEY' {ENV} && "
             f"sed -i 's|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY={key}|' {ENV} || "
             f"echo 'ANTHROPIC_API_KEY={key}' >> {ENV}")

# Verificar que quedó bien
check = run(f"grep 'ANTHROPIC_API_KEY' {ENV}")
if key in check:
    print("OK   API Key guardada en el servidor")
else:
    print("ERROR al guardar. Revisa manualmente.")
    sys.exit(1)

# Reiniciar backend
run("pm2 restart dismed-api")
import time; time.sleep(3)
status = run("pm2 jlist")
if "online" in status:
    print("OK   Backend reiniciado correctamente")
else:
    print("WARN Verifica el estado con: pm2 status")

ssh.close()
print("\nListo. El parser de PDF con IA ya esta activo.")
print("Prueba el sistema en: http://72.249.60.175\n")
