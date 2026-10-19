# Acompanhamento Operacional (COA WEB)

Painel de acompanhamento do plantio e da colheita por fazenda e safra, com os dados do PIMS, e
cadastro das metas diárias por período e da data estimada de término.

No COA WEB: categoria **Operacional**, com cinco abas: **Painel**, **Metas**, **Safras**,
**Relatórios** e **Revista**. O módulo roda num iframe da mesma origem (`acompanhamento/index.html?embed=1`) e usa
a sessão do COA WEB.

## Safras (comparativo por fazenda)

Aba **Safras** (COA WEB → Operacional → Safras): relatório de uma fazenda (sem "Todas") com a safra
atual e até 3 anteriores da mesma cultura. Cartões de resumo (início, fim, duração, área, média,
pico, chuva), um gráfico de hectares por dia por safra com a chuva do dia como uma **área azul**
translúcida no eixo da direita (mm) e o resuminho no título, todos no mesmo trecho do calendário (as
safras anteriores são deslocadas para o ano da atual), e o comparativo acumulado pela data do ano
(ha ou % da área). **Exportar** gera um PNG único ou um PDF A4 deitado (jsPDF do cdnjs, carregado só
ao exportar). Código em `acompanhamento/safras.js`.

Chuva: a rotina da VM lê a ZEUS (`stg_climatemonitoring2` + `stg_zeus_picarea`), soma o dia de cada
pluviômetro e tira a média entre os pluviômetros da fazenda, desde agosto de 3 anos-safra antes; grava
em `acomp_pims` com safra `CHUVA` (uma linha por unidade). Se a ZEUS falhar, o resto segue sem chuva.

## Relatórios (consolidado da operação)

Aba **Relatórios** (COA WEB → Operacional → Relatórios): a operação numa página, de uma fazenda ou
de "Todas". Leitura automática em frases, seis indicadores, a tabela "Esta safra × anteriores" na
mesma data do ano, hectares por dia com a meta e a chuva, evolução acumulada, percentual por talhão
(em "Todas", a tabela por fazenda), situação dos talhões, equipes e variedades. **Exportar** gera um
PNG único ou um PDF A4 em pé. Tela e exportação em `acompanhamento/relatorio.js`; a lógica sem tela
(chuva × operação, comparativo, frases, executado por talhão e por dia, meta parcial) fica em
`acompanhamento/relatorio-logica.js`, coberta pelos testes.

## Revista (relatório do plantio em páginas A4)

Aba **Revista** (COA WEB → Operacional → Revista; liberada para todos com a categoria Operacional desde 19/10/2026, anunciada pelo aviso de novidade da casca, `NOVIDADE` + `#dlg-novidade` no `index.html`, que aparece uma vez por usuário em cada navegador): o relatório consolidado do período de produção (por
enquanto só o plantio) diagramado como revista, em páginas A4 em pé, e exportado **só em PDF**. A fazenda
é a da aba escolhida; em **Todas**, a revista do grupo, que só o administrador gera (`mapas_eh_admin`; os
outros caem na primeira fazenda da lista). A tela mostra as mesmas páginas do PDF (capa sozinha, depois
em pares, como uma revista aberta).

Páginas da fazenda: capa (foto, marca da Locks, "Relatório de plantio", nome da fazenda, safra, a data
dos dados em números vazados e "COA"), editorial com sumário e o mapa da situação, **Em números**
(12 indicadores, esta safra × anteriores e a situação dos talhões pela área), **O ritmo do plantio**
(hectares por dia × meta e acumulado × planejado × safras anteriores), **O mapa do plantio** (situação
e semana do início de cada talhão), **A chuva e o plantio** (chuva diária da fazenda alinhada aos
hectares por dia, médias com e sem chuva, chuva acumulada por talhão e a chuva nos 10 dias depois do
plantio), **Mapas de chuva do período** (os salvos no módulo Mapas), **Variedades** (mapa com as cores
do Mapa de variedade, área e janela de plantio), **Equipes** (por dia, resumo e a equipe que mais
plantou em cada talhão), **Talhão a talhão** e **Os próximos dias** (a última previsão de cada fonte
da Previsão do Tempo), e a contracapa com as fontes. Na revista do grupo: as unidades (ranking e
quadro), o ritmo por unidade, o mosaico dos mapas, a chuva nas unidades e uma página por unidade.

Cada leitura além do PIMS depende da categoria de quem gera; sem ela o banco devolve vazio e a seção
sai da revista: `chuva_talhao` (Chuva por talhão), `mapas_chuva` + bucket `mapas-chuva` e
`mapas_variedade_cores` (Mapas), `prev_previsoes` (Previsão do Tempo). A chuva por talhão vem da
tabela da ZEUS carregada em lotes: a revista diz até que dia ela vai.

**Foto da capa por período:** os arquivos ficam em `acompanhamento/assets/capas/` e a escolha no
objeto `CAPAS` do `revista.js` (pela safra do PIMS, ex. `'SOJA 26/27'`, ou pela cultura, ex.
`'SOJA'`). Hoje há só `soja.webp` (foto real da lavoura de soja, recortada em pé), que também vale
para as safras sem foto própria. Só imagens sem dado da empresa: o repositório é público.
Na tela, **Trocar foto da capa** deixa cada pessoa usar uma foto dela: a imagem é reduzida (lado maior
2400 px, JPEG) e guardada só naquele navegador, por safra (`localStorage`, chave `acomp.revista.capa.<safra>`);
**Foto padrão** volta à do repositório. Um quadro "O que é a Revista" no topo da aba explica a página.

Código: `acompanhamento/revista.js` (páginas em canvas, tela e PDF com o jsPDF do cdnjs) e
`acompanhamento/revista-logica.js` (contas e textos, com testes); a chuva por talhão usa a lógica do
módulo Chuva por talhão (`chuva/logica.js`).

## Exportar imagem (WhatsApp)

Botão **Exportar** no topo do painel: gera um PNG com as mesmas informações da página do relatório
Power BI: barra lateral (unidade, safra, início, último dia, data final planejada, previsão de
término e observação), indicadores (área, executada/à executar, dias decorridos, dias restantes
planejados e previstos, medidor de evolução, talhões, ritmo, % replantio), dano/replantio, rosca do
percentual realizado, área por equipe (últimos 7 dias e total), variedades, meta × realizado por dia,
mapa de evolução com rosa dos ventos e as barras de % por talhão. Formatos:
**Relatório** (a página 1920×1080 do Power BI, gravada em 4800×2700; no WhatsApp, envie em HD) e
**Celular** (os mesmos blocos empilhados, 2700 de largura, para rolar no celular; no iPhone e no
iPad a imagem sai menor quando passa do limite de tamanho do aparelho). Fazenda alta ganha
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
cada fazenda), com relógio e a tela mantida ligada. Tudo é
proporcional ao tamanho da tela (TV HD, Full HD, 4K, ultrawide e TV na vertical) e o arranjo é o que
desenha o mapa maior naquela tela. Teclas: ← → trocam de fazenda, espaço pausa, Esc sai.

A TV se mantém sozinha, sem ninguém recarregar a página:

- **Dados**: a cada minuto a página faz uma consulta leve ao banco (a hora da última gravação do PIMS
  e as metas). Se mudou, recarrega os dados e redesenha a tela na hora, mesmo com uma fazenda só ou
  pausada. O painel aberto fora do Modo TV faz o mesmo. Na virada do dia a tela também é redesenhada.
- **Sem resposta do banco** por 3 conferências seguidas: o canto da faixa mostra "sem conexão" ao lado
  da hora do dado do PIMS; some quando o banco volta a responder.
- **Versão nova do site**: a cada 5 min a TV compara os arquivos versionados do `index.html` publicado
  com os que carregou; se mudaram e os novos já respondem, recarrega e volta ao Modo TV na mesma tela
  (uma vez por versão). A tela cheia do botão não sobrevive à recarga (regra do navegador): numa TV
  fixa, use a tela cheia do **F11**, que continua. Por isso, todo arquivo alterado em
  `acompanhamento/` precisa ter o `?v=` trocado no `acompanhamento/index.html` (padrão
  `AAAAMMDDHHMM`); sem isso, os navegadores e as TVs abertas seguem com o código antigo.

Para deixar uma TV fixa: entre no COA WEB no navegador da TV e abra (dá para favoritar)
`https://coa-web-teal.vercel.app/acompanhamento/index.html?tv=1`. Opções na URL:
`tempo=30` (segundos por tela), `fazendas=SM3,GLOBO` (só essas), `todas=0` (sem a tela Todas), e o
final `#painel/TODAS/SOJA%2026%2F27/PLANTIO` escolhe safra e operação.

## Onde está cada parte

| Parte | Arquivo |
|---|---|
| Página (JS puro, sem build) | `acompanhamento/` na raiz do repositório (`index.html`, `app.js`, `estilo.css`, `config.js`) |
| Aba Safras | `acompanhamento/safras.js` |
| Aba Relatórios (tela, exportação e lógica) | `acompanhamento/relatorio.js` e `acompanhamento/relatorio-logica.js` |
| Aba Revista (páginas, PDF e lógica) | `acompanhamento/revista.js`, `acompanhamento/revista-logica.js` e `acompanhamento/assets/capas/` |
| Testes da lógica | `modulos/acompanhamento/testes/relatorio.test.mjs` e `revista.test.mjs` |
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
   (`mapas_plantio_pedidos`); a VM atende em até ~45 s e atualiza os dois módulos. A página espera
   a resposta por até 2 minutos e meio.
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
- Executado por talhão = apontamentos sem replantio, limitados à área do talhão. O encerramento do
  plantio (DT_PLANT_ENC) só aparece como aviso no mapa: não completa a área do talhão.
- Ritmo = média dos dias com operação nos últimos 7 dias corridos até o último apontamento
  (sem operação no período, a média geral). Previsão de término = hoje − 1 + ⌈restante ÷ ritmo⌉.
- Último dia = hectares do último dia com apontamento, comparados com a meta daquele dia (se o
  último dia é hoje, o cartão diz "dia em andamento" e não compara). O "necessário para cumprir o
  prazo" (restante ÷ dias até a data de término) ficou só na leitura em frases do Relatório.
- Em "Todas", a meta e o término somados só valem se todas as fazendas têm meta cadastrada. Com meta
  só em parte delas, os cartões do Painel e do Modo TV e a aba Relatórios não comparam (mostram
  "meta em N de M fazendas") e a legenda dos gráficos avisa de quantas fazendas é a meta desenhada.
- Evolução acumulada: o realizado segue o critério do executado (o apontado conta até completar a
  área do talhão), para a linha terminar no número do cartão "Área plantada/colhida"; a projeção
  parte desse ponto.
- Layout do mapa (regra do Mapa de Chuva): altura/largura da fazenda > 1,25 → mapa em coluna
  (retrato); senão em faixa (paisagem). Grupos distantes (até 3) viram quadros separados quando
  aproveitam ao menos 1,5× melhor a área.

## Testes

Executor nativo do Node, sem dependências. Na raiz do repositório:

```
node --test modulos/acompanhamento/testes/*.mjs
```

(Com a pasta no lugar dos arquivos, `node --test modulos/acompanhamento/testes/`, o Node 24 falha.)
Cobrem a lógica de `acompanhamento/relatorio-logica.js` e `acompanhamento/revista-logica.js`; as contas do `app.js` (`calcula`) não têm
teste, porque dependem da tela.

## Testar localmente

O projeto `CLAUDE GERAL/acompanhamento-plantio` serve esta mesma página com a API local
(`node servidor.mjs` → http://localhost:8090; lê o PIMS pelo Agrovex desta máquina e usa `mapas.js`
local). O `config.js` é trocado por `{ modo: 'local' }` por esse servidor. Na aba Revista, o que no
COA WEB vem do Supabase (chuva por talhão, mapas salvos, cores e previsão) sai de `dados/revista.json`
desse projeto (rota `/api/revista`, imagens em `dados/revista-mapas/`), fora deste repositório.
