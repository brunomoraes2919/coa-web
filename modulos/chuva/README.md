# Chuva por talhão

Página da categoria **Mapas** do COA WEB (`chuva/`, sem build: HTML, CSS e JS puros). Mostra a chuva da
ZEUS em cada talhão: mapa da fazenda pintado pela chuva do período, tabela por talhão ao lado (clicar no
talhão destaca a linha e aproxima o mapa; clicar na linha aproxima o talhão), detalhe dia a dia do talhão
escolhido, grade "Dia a dia" (talhão × dia) e a situação de cada pluviômetro.

## De onde vem o número

A regra é a da visão `vw_precipitacao_talhao` da ZEUS: a chuva do talhão é a soma do dia de cada
pluviômetro ligado a ele em `stg_zeus_picarea`; com mais de um pluviômetro, a média pesada pelo número de
leituras de cada um no dia. A visão em si não é consultada (não nomeia a Dourado nem a Nebraska e é pesada
sem filtro): a rotina lê as duas tabelas que ela usa. Conferido em 08/10/2026: valores idênticos aos da
visão em todos os talhões comparáveis de Globo, Guapirama, SM3, Siriema e Três Flechas.

Talhão sem vínculo no cadastro da ZEUS aparece como **estimado** (contorno tracejado e marca na tabela):

1. subdivisão herda do talhão de origem (`033A` usa o pluviômetro do `033`);
2. sem origem, usa o pluviômetro mais próximo do centro do talhão.

Os períodos terminam no último dia com leitura da fazenda, não em "hoje": a ZEUS chega com atraso.

## Peças

| O quê | Onde |
|---|---|
| Tela | `chuva/index.html`, `estilo.css`, `app.js` |
| Contas (sem DOM, com testes) | `chuva/logica.js` · `node --test modulos/chuva/testes/*.mjs` |
| Leitura da ZEUS | `modulos/mapas/scripts/sincronizar-plantio.mjs` (`sincronizarChuvaTalhao`) |
| Atualização a cada 30 min | `modulos/mapas/scripts/atender-pedidos.mjs` (`atualizarChuvaTalhao`), no servidor do Google Cloud |
| Tabela `chuva_talhao` | `supabase/0013_chuva_talhao.sql` (rodar uma vez no SQL Editor) |
| Limites dos talhões | cadastro do Mapas: `mapas_talhoes` (todos) e `mapas_areas_cultura` (por safra) |

A tabela guarda, por fazenda, a chuva diária de cada pluviômetro numa janela de 400 dias e o vínculo
talhão → pluviômetros; a conta por talhão é feita no navegador. Quem vê: quem tem a categoria Mapas e a
fazenda liberada (mesma regra das outras páginas).

## Testar no computador

```
node modulos/chuva/scripts/servidor-local.mjs
```

Abre http://localhost:8794/chuva/ com uma fazenda fictícia. Nenhum limite, pluviômetro ou chuva real entra
no repositório. O endereço aceita `?fazenda=`, `?periodo=` (1, 7, 15, 30, mes, safra), `?vista=`
(mapa, diario, pics), `?modo=seca` e `?talhao=`.
