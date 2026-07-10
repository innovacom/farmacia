#!/usr/bin/env python3
import sys
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("72.249.60.175", username="root", password="GaPaPaRoEl1", timeout=15)

cmds = [
    "mysql --version",
    "cat /etc/mysql/debian.cnf 2>/dev/null || echo NO_DEBIAN_CNF",
    "mysql -e 'SELECT 1;' 2>&1 || echo MYSQL_NEEDS_PASS",
    "mysql -u root -pGaPaPaRoEl1 -e 'SELECT 1;' 2>&1 || echo WRONG_PASS",
]
for cmd in cmds:
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=10)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    print(f"CMD: {cmd}")
    if out: print(f"OUT: {out}")
    if err: print(f"ERR: {err}")
    print()

ssh.close()
