# Acompanhamento Operacional (COA WEB)

Painel de acompanhamento do plantio e da colheita por fazenda e safra, com os dados do PIMS, e
cadastro das metas diárias por período e da data estimada de término.

No COA WEB: categoria **Operacional** → **Painel** e **Metas**. O módulo roda num iframe da mesma
origem (`acompanhamento/index.html?embed=1`) e usa a sessão do COA WEB.

## Exportar imagem (WhatsApp)

Botão **Exportar** no topo do painel: gera um PNG com as mesmas informações da página do relatório
Power BI: barra lateral (unidade, safra, início, último dia, data final planejada, previsão de
término e observação), indicadores (área, executada/à executar, dias decorridos, dias restantes
planejados e previstos, medidor de evolução, talhões, ritmo, % replantio), dano/replantio, rosca do
percentual realizado, área por equipe (últimos 7 dias e total), variedades, meta × realizado por dia,
mapa de evolução com rosa dos ventos e as barras de % por talhão. Formatos:
**Relatório** (a página 1920×1080 do Power BI, gravada em 2400×1350; no WhatsApp, envie em HD) e
**Celular** (os mesmos blocos empilhados, 1350 de largura, para rolar no celular). Fazenda alta ganha
o mapa em duas faixas, como a página de Guapirama do Power BI. Em "Todas", o mapa vira a lista das
fazendas e as barras mostram o % de cada fazenda. No celular, **Compartilhar** manda a imagem direto
para o WhatsApp.

Os mapas (painel, ampliado, Modo TV e imagem exportada) têm o mapa base **Esri Topo** clareado atrás
dos talhões (o mesmo "Topográfico claro" do Mapa de Chuva, com a fonte no canto) e os nomes dos
talhões com um contorno branco. As miniaturas da tela "Todas" ficam sem mapa base.

Variedades: "A DEFINIR" (variedade ainda não informada no PIMS) não entra na lista. A lista aparece
inteira, sem rolagem; na imagem, com muitas variedades o cartão cresce (o gráfico diário encolhe) e,
se ainda faltar espaço, vira duas colunas.

Comparativo com as safras anteriores: a rotina da VM grava em `acomp_pims`, como linhas sem talhão,
o total por dia das duas safras anteriores da mesma cultura (nomes casados por `culturaDaSafra`:
"SAFRINHA" = "2ª SAFRA", "1º" = "1ª", "MILHO SILAGEM" = "SILAGEM"). A página não as lista como safra;
usa-as em linhas claras nos gráficos "Realizado × meta por dia" (mesmos dias do ano) e "Evolução
acumulada" (acumulado da safra anterior até o mesmo dia do ano), no painel, no Modo TV e na imagem,
e no "Resumo do período" da imagem.

O fundo das faixas (painel, Modo TV e imagem) é a ilustração da cultura da safra em `assets/fundo_*.webp`
(soja, milho/silagem, sorgo/milheto, algodão).

A foto da máquina (barra lateral, faixa do painel e Modo TV) sai de `assets/`: `trator_8r.webp` no
plantio; na colheita, `colheitadeira_milho.webp` (milho), `colhedora_algodao.webp` (algodão) e
`colheitadeira_soja.webp` (soja e demais grãos). Sem o arquivo, a faixa fica sem foto.

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
