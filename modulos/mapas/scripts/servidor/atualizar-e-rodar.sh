#!/usr/bin/env bash
# Rotina do plantio do PIMS -> Supabase (módulo MAPAS do COA WEB), no servidor (VM do Google Cloud).
# Baixa a versão atual do script do repositório e roda com as chaves de ~/.plantio-pims.env.
# Agendada pelo systemd (plantio-pims.timer), a cada hora no minuto 17.
set -u
cd "$HOME/plantio-pims"
BASE=https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/mapas/scripts
for f in sincronizar-plantio.mjs plantio.config.json; do
  if curl -fsS "$BASE/$f" -o "scripts/$f.novo" && [ -s "scripts/$f.novo" ]; then mv "scripts/$f.novo" "scripts/$f"; else rm -f "scripts/$f.novo"; fi
done
set -a; . "$HOME/.plantio-pims.env"; set +a
echo "== $(date -Is)"
node scripts/sincronizar-plantio.mjs
