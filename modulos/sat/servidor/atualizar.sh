#!/usr/bin/env bash
# Procura uma versão nova do serviço do WhatsApp no main e, se houver, troca os arquivos.
# Roda como o usuário locks-sat: pelo timer (a cada hora, no minuto 23) e pelo instalar.sh, que o usa
# também na primeira instalação (pasta ainda vazia: baixa tudo e instala as bibliotecas).
# Se algo mudou, deixa o arquivo .mudou: quem reinicia o serviço é o locks-sat-whatsapp-atualizar.service (como root).
# Arquivo vazio, quebrado ou erro de rede: não troca nada.
set -euo pipefail
BASE=https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/sat/servidor
PASTA=/home/locks-sat/whatsapp
# A trava (package-lock.json) fica por último: é nesta ordem que os arquivos são trocados.
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
# As bibliotecas são instaladas de novo se a trava mudou ou se a pasta delas não existe
# (primeira vez, ou uma troca anterior que morreu no meio).
bibliotecas=""
case "$mudou" in
  *package-lock.json*) bibliotecas=sim ;;
esac
[ -d "$PASTA/node_modules" ] || bibliotecas=sim
if [ -z "$mudou" ] && [ -z "$bibliotecas" ]; then
  echo "Sem mudança."
  exit 0
fi

if [ -n "$bibliotecas" ]; then
  # Instaladas à parte: se o npm falhar, as que estão em uso continuam intactas.
  # --ignore-scripts: nenhum script de instalação de pacote roda na VM (a biblioteca do WhatsApp carrega sem eles).
  ( cd "$NOVO" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund )
  [ -d "$NOVO/node_modules" ] || { echo "O npm não instalou as bibliotecas; nada foi trocado."; exit 1; }
fi

# O aviso é gravado ANTES das trocas: se o script morrer no meio delas, o reinício ainda acontece
# (na próxima rodada que terminar bem, o serviço de atualização acha o aviso e reinicia).
echo "mudou" > "$PASTA/.mudou"

if [ -n "$bibliotecas" ]; then
  # A pasta antiga sai do caminho, a nova entra e só então a antiga é apagada: são duas trocas de nome,
  # instantâneas, em vez de o serviço ficar sem bibliotecas enquanto a pasta antiga inteira é apagada.
  rm -rf "$PASTA/node_modules.velho"
  if [ -d "$PASTA/node_modules" ]; then mv "$PASTA/node_modules" "$PASTA/node_modules.velho"; fi
  mv "$NOVO/node_modules" "$PASTA/node_modules"
  rm -rf "$PASTA/node_modules.velho"
fi
# Os arquivos vêm depois das bibliotecas, e a trava por último: se morrer antes dela, a próxima rodada
# vê a diferença e refaz tudo.
for f in $mudou; do
  mv -f "$NOVO/$f" "$PASTA/$f"
done
echo "mudou"
