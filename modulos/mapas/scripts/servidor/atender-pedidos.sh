#!/usr/bin/env bash
# Botão "Atualizar plantio" do módulo MAPAS: confere os pedidos pendentes (mapas_plantio_pedidos) e,
# se houver, roda a rotina do PIMS na hora. Agendado pelo systemd (plantio-pims-pedidos.timer) a cada
# ~30 s. Sem pedido, sai sem escrever nada no log. Os scripts são atualizados pela rotina horária.
set -u
cd "$HOME/plantio-pims"
exec 9>"$HOME/plantio-pims/.trava"
flock -n 9 || exit 0   # a rotina horária está rodando: tenta de novo na próxima verificação
set -a; . "$HOME/.plantio-pims.env"; set +a
node scripts/atender-pedidos.mjs
