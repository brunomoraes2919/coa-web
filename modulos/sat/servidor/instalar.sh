#!/usr/bin/env bash
# Instala o serviço do WhatsApp do Locks SAT na VM. Pode rodar de novo sem estragar nada.
# Depois dele: gravar a chave em /home/locks-sat/.locks-sat-whatsapp.env e parear (ver LEIA-ME.md).
set -euo pipefail
BASE=https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/sat/servidor
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Precisa do Node 20 ou mais novo (este é $(node -v))."; exit 1; }
id locks-sat >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin locks-sat
sudo -u locks-sat mkdir -p /home/locks-sat/whatsapp/sessao
sudo chmod 700 /home/locks-sat /home/locks-sat/whatsapp/sessao
for f in locks-sat-whatsapp.mjs package.json package-lock.json atualizar.sh; do
  sudo -u locks-sat curl -fsS "$BASE/$f" -o "/home/locks-sat/whatsapp/$f"
done
sudo chmod 755 /home/locks-sat/whatsapp/atualizar.sh
( cd /home/locks-sat/whatsapp && sudo -u locks-sat npm ci --omit=dev --no-audit --no-fund )
if [ ! -f /home/locks-sat/.locks-sat-whatsapp.env ]; then
  printf 'SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=\n' | sudo -u locks-sat tee /home/locks-sat/.locks-sat-whatsapp.env >/dev/null
  sudo chmod 600 /home/locks-sat/.locks-sat-whatsapp.env
fi
for u in locks-sat-whatsapp.service locks-sat-whatsapp-atualizar.service locks-sat-whatsapp-atualizar.timer; do
  sudo curl -fsS "$BASE/$u" -o "/etc/systemd/system/$u"
done
sudo systemctl daemon-reload
echo "Instalado. Falta: gravar a chave, parear e ligar o serviço (LEIA-ME.md)."
