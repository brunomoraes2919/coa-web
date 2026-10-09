#!/usr/bin/env bash
# Rotina do plantio do PIMS -> Supabase (módulo MAPAS do COA WEB), no servidor (VM do Google Cloud).
# Baixa os scripts do repositório e roda com as chaves de ~/.plantio-pims.env.
# Agendada pelo systemd (plantio-pims.timer), a cada hora no minuto 17.
#
# CÓPIA DE REFERÊNCIA: a VM usa a cópia que está em ~/plantio-pims; este arquivo não é baixado sozinho.
# Como levar esta versão para a VM: README.md desta pasta.
#
# De onde baixa: do main (padrão, como sempre foi). OPCIONAL: se existir o arquivo ~/plantio-pims/versao com o
# código de 40 caracteres de um commit conferido, baixa daquele commit e de nenhum outro (README.md).
#
# Os três arquivos são baixados para uma pasta à parte, conferidos e só então trocados, os três juntos:
# download pela metade, arquivo vazio ou script com erro não troca nada, e a rotina roda com o que já estava.
set -u
PASTA="$HOME/plantio-pims"
ARQUIVOS="sincronizar-plantio.mjs atender-pedidos.mjs plantio.config.json"
cd "$PASTA" || exit 1
exec 9>"$PASTA/.trava"
flock 9   # espera o atendimento de pedidos (atender-pedidos.sh) terminar, se estiver rodando

REF=main
if [ -e "$PASTA/versao" ]; then
  REF=$(tr -d '[:space:]' < "$PASTA/versao")
  # só vale o código inteiro do commit: 40 caracteres de 0-9 e a-f. Qualquer outra coisa: não baixa nada.
  if ! [[ "$REF" =~ ^[0-9a-f]{40}$ ]]; then
    echo "== $(date -Is) o arquivo versao não tem um código de commit de 40 caracteres: nada foi baixado (README.md da pasta servidor)."
    REF=
  fi
fi

# Baixa, confere e troca. Devolve 0 só se os três arquivos foram trocados.
baixar() {
  local base="https://raw.githubusercontent.com/brunomoraes2919/coa-web/$REF/modulos/mapas/scripts"
  local novo="$PASTA/scripts/.novo" f
  rm -rf "$novo"
  mkdir -p "$novo" || return 1
  for f in $ARQUIVOS; do
    # só https com TLS 1.2 ou mais novo, sem seguir redirecionamento, e com prazo: download pendurado não segura a trava
    curl -fsS --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 120 "$base/$f" -o "$novo/$f" || { echo "Não consegui baixar $f."; return 1; }
    [ -s "$novo/$f" ] || { echo "O arquivo $f veio vazio."; return 1; }
  done
  node --check "$novo/sincronizar-plantio.mjs" || { echo "sincronizar-plantio.mjs veio com erro."; return 1; }
  node --check "$novo/atender-pedidos.mjs" || { echo "atender-pedidos.mjs veio com erro."; return 1; }
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$novo/plantio.config.json" || { echo "plantio.config.json veio com erro."; return 1; }
  # A troca é feita com a trava na mão: o atendimento de pedidos nunca roda com metade dos arquivos novos.
  for f in $ARQUIVOS; do
    mv -f "$novo/$f" "$PASTA/scripts/$f" || { echo "Não consegui trocar $f."; return 1; }
  done
}

if [ -n "$REF" ]; then
  if baixar; then
    echo "== $(date -Is) scripts: $REF"
  else
    echo "== $(date -Is) scripts: nada foi trocado; rodando a versão que já estava na VM."
  fi
  rm -rf "$PASTA/scripts/.novo"
fi

set -a; . "$HOME/.plantio-pims.env"; set +a
echo "== $(date -Is)"
node scripts/sincronizar-plantio.mjs
