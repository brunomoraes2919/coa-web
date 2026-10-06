#!/usr/bin/env bash
# Procura uma versão nova do serviço do WhatsApp no main e, se houver, troca os arquivos.
# Roda como o usuário locks-sat, chamado pelo timer (a cada hora, no minuto 23).
# Se algo mudou, deixa o arquivo .mudou: quem reinicia o serviço é o locks-sat-whatsapp-atualizar.service (como root).
# Arquivo vazio, quebrado ou erro de rede: não troca nada.
set -euo pipefail
BASE=https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/sat/servidor
PASTA=/home/locks-sat/whatsapp
ARQUIVOS="locks-sat-whatsapp.mjs package.json package-lock.json"
cd "$PASTA"

# Tudo é baixado e conferido numa pasta à parte; só depois dela inteira boa é que algo é trocado.
NOVO="$PASTA/.novo"
rm -rf "$NOVO"
mkdir "$NOVO"
trap 'rm -rf "$NOVO"' EXIT

for f in $ARQUIVOS; do
  curl -fsS --max-time 120 "$BASE/$f" -o "$NOVO/$f"
  [ -s "$NOVO/$f" ] || { echo "Arquivo $f veio vazio; nada foi trocado."; exit 1; }
done
node --check "$NOVO/locks-sat-whatsapp.mjs"
node -e 'for (const f of ["package.json", "package-lock.json"]) JSON.parse(require("fs").readFileSync(process.argv[1] + "/" + f, "utf8"))' "$NOVO"

mudou=""
for f in $ARQUIVOS; do
  cmp -s "$NOVO/$f" "$PASTA/$f" || mudou="$mudou $f"
done
if [ -z "$mudou" ]; then
  echo "Sem mudança."
  exit 0
fi

# As bibliotecas novas são instaladas à parte: se o npm falhar, as que estão em uso continuam intactas.
case "$mudou" in
  *package-lock.json*)
    ( cd "$NOVO" && npm ci --omit=dev --no-audit --no-fund )
    [ -d "$NOVO/node_modules" ] || { echo "O npm não instalou as bibliotecas; nada foi trocado."; exit 1; }
    rm -rf "$PASTA/node_modules"
    mv "$NOVO/node_modules" "$PASTA/node_modules"
    ;;
esac
for f in $mudou; do
  mv -f "$NOVO/$f" "$PASTA/$f"
done
echo "mudou"
echo "mudou" > "$PASTA/.mudou"
