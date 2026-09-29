# Acompanhamento Operacional (COA WEB)

Painel de acompanhamento do plantio e da colheita por fazenda e safra, com os dados do PIMS, e
cadastro das metas diárias por período e da data estimada de término.

No COA WEB: categoria **Operacional** → **Painel** e **Metas**. O módulo roda num iframe da mesma
origem (`acompanhamento/index.html?embed=1`) e usa a sessão do COA WEB.

## Exportar imagem (WhatsApp)

Botão **Exportar** no topo do painel: gera um PNG da fazenda (ou de todas) com o cabeçalho, os 6
indicadores, o mapa e o gráfico diário, com letras grandes para ler no celular. Formatos:
**Quadrado** 1440×1440 (padrão; aparece inteiro na conversa), **Paisagem** 1920×1080 e **Celular**
1080×1920. Como no painel, a forma da fazenda decide o arranjo (mapa em coluna ou em faixa). No
celular, **Compartilhar** manda a imagem direto para o WhatsApp.

## Modo TV

Botão **Modo TV**: tela única, sem rolagem, em tela cheia, que troca de fazenda sozinha (Todas e
cada fazenda), com relógio, atualização dos dados a cada 5 min e a tela mantida ligada. Tudo é
proporcional ao tamanho da tela (TV HD, Full HD, 4K, ultrawide e TV na vertical) e o arranjo é o que
desenha o mapa maior naquela tela. Teclas: ← → trocam de fazenda, espaço pausa, Esc sai.

Para deixar uma TV fixa: entre no COA WEB no navegador da TV e abra (dá para favoritar)
`https://coa-web-teal.vercel.app/acompanhamento/index.html?tv=1`. Opções na URL:
`tempo=30` (segundos por tela), `fazendas=SM3,GLOBO` (só essas), `todas=0` (sem a tela Todas), e o
final `#painel/TODAS/SOJA%2026%2F27/PLANTIO` escolhe safra e operação.

## Onde está cada parte

| Parte | Arquivo |
|---|---|
| Página (JS puro, sem build) | `acompanhamento/` na raiz do repositório (`index.html`, `app.js`, `estilo.css`, `config.js`) |
| Banco (tabelas `acomp_*` e regras de acesso) | `modulos/acompanhamento/supabase/0001_acompanhamento.sql` |
| Leitura do PIMS | etapa "Acompanhamento" de `modulos/mapas/scripts/sincronizar-plantio.mjs` |
| Integração no COA WEB | `index.html` da raiz, seção "ACOMPANHAMENTO OPERACIONAL" |

## Como os dados chegam

1. A rotina do PIMS da VM do Google Cloud (a mesma do Mapa de Chuva, a cada hora no minuto 17) baixa
   `sincronizar-plantio.mjs` do `main`. Depois de gravar o plantio dos mapas, ela lê os talhões e os
   apontamentos de plantio (APPLANTIO) e colheita (APATIVPROD, operações 16 e 114) das safras
   agrícolas do ano-safra e grava em `acomp_pims` (uma linha por safra × unidade).
   Desligar: `"acompanhamento": false` em `modulos/mapas/scripts/plantio.config.json`.
2. O botão **Atualizar** do painel usa o mesmo pedido do "Atualizar plantio" dos mapas
   (`mapas_plantio_pedidos`); a VM atende em até ~45 s e atualiza os dois módulos.
3. A página calcula os indicadores no navegador (mesmas regras do relatório Power BI).
4. Os limites dos talhões vêm das tabelas do módulo MAPAS (`mapas_areas_cultura` da safra e
   `mapas_talhoes`); a página usa o conjunto que cobre mais talhões da safra escolhida.

Nenhum dado do PIMS nem limite de talhão fica no repositório (ele é público).

## Primeira instalação

1. No SQL Editor do Supabase do COA WEB, rode `modulos/acompanhamento/supabase/0001_acompanhamento.sql`
   (depois do `0001_mapas.sql`, que já está aplicado). Confirme o aviso de "destructive operation":
   os `drop ... if exists` só recriam objetos do próprio script.
2. Pronto: na próxima rodada da VM (ou num clique em **Atualizar**) a tabela `acomp_pims` é preenchida.
   Enquanto o script não for aplicado, a rotina só registra um aviso e o Mapa de Chuva segue normal.

## Permissões

Iguais às do COA WEB, pela unidade do PIMS ligada à fazenda (`mapas_fazendas.unidade_pims` +
`coa_fazenda_id`): o admin vê e edita tudo; o colaborador vê e cadastra metas das fazendas liberadas
para ele. Toda alteração de meta fica em `acomp_metas_historico` (só o admin lê).

## Regras de cálculo

- Área da operação = área produtiva (UPNIVEL3.QT_AREA_PROD) − área de dano.
- Executado por talhão = apontamentos sem replantio, limitados à área do talhão; talhão com plantio
  encerrado (DT_PLANT_ENC) conta como 100%.
- Ritmo = média dos dias com operação nos últimos 7 dias corridos até o último apontamento
  (sem operação no período, a média geral). Previsão de término = hoje − 1 + ⌈restante ÷ ritmo⌉.
- Necessário p/ meta = restante ÷ dias até a data estimada de término.
- Layout do mapa (regra do Mapa de Chuva): altura/largura da fazenda > 1,25 → mapa em coluna
  (retrato); senão em faixa (paisagem). Grupos distantes (até 3) viram quadros separados quando
  aproveitam ao menos 1,5× melhor a área.

## Testar localmente

O projeto `CLAUDE GERAL/acompanhamento-plantio` serve esta mesma página com a API local
(`node servidor.mjs` → http://localhost:8090; lê o PIMS pelo Agrovex desta máquina e usa `mapas.js`
local). O `config.js` é trocado por `{ modo: 'local' }` por esse servidor.
