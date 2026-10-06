#!/usr/bin/env bash
# Instala o serviço do WhatsApp do Locks SAT na VM. Roda como o usuário comum da VM (usa sudo).
# Pode rodar de novo sem estragar nada: o arquivo da chave e a sessão pareada, se já existem, não são tocados.
# O programa e as bibliotecas são baixados pelo atualizar.sh, o mesmo que o timer roda a cada hora.
# Depois dele, na primeira vez: gravar a chave, parear e ligar o serviço (ver LEIA-ME.md).
set -euo pipefail
BASE=https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/sat/servidor
CASA=/home/locks-sat
PASTA=$CASA/whatsapp
AMBIENTE=$CASA/.locks-sat-whatsapp.env
UNIDADES="locks-sat-whatsapp.service locks-sat-whatsapp-atualizar.service locks-sat-whatsapp-atualizar.timer"
TEMP=

# Tudo fica nesta função, chamada na última linha: se o download deste script for cortado no meio
# (curl | bash), o bash não acha a chamada e não executa nada, em vez de executar a metade.
principal() {
  local f primeira_vez=
  # A pasta de onde você chamou pode ser fechada para o usuário locks-sat; a raiz todo mundo enxerga.
  cd /

  # Só o usuário locks-sat entra em /home/locks-sat: tudo que mexe lá dentro roda como ele (ou como root).
  id locks-sat >/dev/null 2>&1 || sudo useradd --system --create-home --user-group --shell /usr/sbin/nologin locks-sat
  # O Node que conta é o que o usuário do serviço enxerga (um Node instalado só na sua conta não serve).
  sudo -H -u locks-sat node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
    || { echo "Precisa do Node 20 ou mais novo, instalado para todos os usuários da VM (o usuário locks-sat não achou um)."; exit 1; }
  sudo -H -u locks-sat mkdir -p "$PASTA/sessao"
  sudo chmod 700 "$CASA" "$PASTA/sessao"

  # Baixa para uma pasta temporária e só instala depois de conferir os quatro: download pela metade não troca nada.
  TEMP=$(mktemp -d)
  trap 'rm -rf "$TEMP"' EXIT
  for f in atualizar.sh $UNIDADES; do
    curl -fsS --max-time 120 "$BASE/$f" -o "$TEMP/$f"
    [ -s "$TEMP/$f" ] || { echo "Arquivo $f veio vazio; nada foi instalado."; exit 1; }
  done
  sudo install -o locks-sat -g locks-sat -m 755 "$TEMP/atualizar.sh" "$PASTA/atualizar.sh"
  for f in $UNIDADES; do
    sudo install -m 644 "$TEMP/$f" "/etc/systemd/system/$f"
  done
  rm -rf "$TEMP"

  # O arquivo da chave só é criado se não existir; um que já existe nunca é tocado. Quem responde se existe
  # é o locks-sat (você não enxerga lá dentro). umask 077: nasce com modo 600. set -C: o shell se recusa a escrever por cima.
  if ! sudo -u locks-sat test -f "$AMBIENTE"; then
    sudo -H -u locks-sat sh -c 'umask 077; set -C; printf "SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=\n" > "$1"' sh "$AMBIENTE"
    primeira_vez=sim
  fi

  # O programa e as bibliotecas vêm pelo mesmo caminho do timer (na primeira vez a pasta está vazia e ele baixa tudo).
  echo "Baixando o programa e as bibliotecas (pode levar alguns minutos)..."
  sudo -H -u locks-sat "$PASTA/atualizar.sh" \
    || { echo "Não consegui baixar o programa (o motivo está logo acima). Nada foi ligado nem reiniciado; rode de novo depois de resolver."; exit 1; }

  sudo systemctl daemon-reload
  # Se o serviço já estava ligado, reinicia para valer o que mudou; parado, continua parado.
  sudo systemctl try-restart locks-sat-whatsapp
  # O aviso que o atualizar.sh deixa para o timer reiniciar o serviço já foi atendido na linha acima.
  sudo rm -f "$PASTA/.mudou"

  if [ -n "$primeira_vez" ]; then
    echo "Instalado. Falta: gravar a chave, parear e ligar o serviço (LEIA-ME.md)."
  else
    # O arquivo pode ser o que este instalador criou vazio numa rodada anterior. Quem olha é o locks-sat, e o
    # grep -q só responde se a linha da chave tem algum valor: nada do arquivo vai para a tela.
    if ! sudo -u locks-sat grep -q '^SUPABASE_SERVICE_ROLE_KEY=.' "$AMBIENTE"; then
      echo "Instalado. O arquivo da chave existe mas ainda está vazio: faça o passo 2 do LEIA-ME."
    else
      echo "Instalado. O arquivo da chave já existia e não foi tocado."
    fi
  fi
}

principal "$@"
