# Chuva por talhão

Página da categoria **Mapas** do COA WEB (`chuva/`, sem build: HTML, CSS e JS puros). Mostra a chuva da
ZEUS em cada talhão: mapa da fazenda pintado pela chuva do período, tabela por talhão ao lado (clicar no
talhão destaca a linha e aproxima o mapa; clicar na linha aproxima o talhão), detalhe dia a dia do talhão
escolhido, grade "Dia a dia" (talhão × dia) e a chuva medida em cada pluviômetro.

## De onde vem o número

A base é a do relatório Power BI de chuva:

- **Chuva de cada talhão**: tabela `stg_field_data` da ZEUS (unidade + código do talhão no PIMS + dia +
  mm, com duas casas). O valor já vem pronto por talhão; nada é calculado aqui além de somar os dias.
- **Ciclos**: PIMS, com o filtro do relatório — safras da janela, só ALGODAO, SOJA e MILHO, talhões com
  mais de 1 ha. O ciclo vai do primeiro plantio à última colheita encerrada do período de safra (sem
  plantio ou colheita, valem as datas do período) e fica dentro da safra dele (setembro a agosto).
- **Faixas de cor de um dia**: as 13 do relatório (0,01 a 0,5 … acima de 100 mm), usadas no "Dia a dia" e
  quando o período é um dia só. Para vários dias somados, a régua sai dos próprios valores, nos mesmos azuis.

Conferido em 08/10/2026 rodando o script do relatório no datalake: a soma por talhão e período de safra
é idêntica em 1.060 linhas das safras 2025/2026 e 2026/2027. Os únicos três casos diferentes são talhões
que o relatório perde porque o nome está escrito de outro jeito na ZEUS (`007a` × `007A`); aqui o código é
normalizado dos dois lados e o talhão aparece.

Os períodos terminam no **último dia que a tabela tem**, não em "hoje". Quando ela fica mais de dois dias
sem receber dado, a página avisa no topo desde quando. Dia que a tabela não tem aparece como "sem dado"
(listrado no "Dia a dia"), não como zero. Talhão com limite no mapa mas fora da tabela fica em cinza.

A aba **Pluviômetros** e os pontos no mapa mostram a chuva medida em cada estação (telemetria da ZEUS),
só para comparar: a chuva dos talhões não sai dali.

## Peças

| O quê | Onde |
|---|---|
| Tela | `chuva/index.html`, `estilo.css`, `app.js` |
| Contas (sem DOM, com testes) | `chuva/logica.js` · `node --test modulos/chuva/testes/*.mjs` |
| Leitura da ZEUS e do PIMS | `modulos/mapas/scripts/sincronizar-plantio.mjs` (`sincronizarChuvaTalhao`) |
| Atualização a cada 30 min | `modulos/mapas/scripts/atender-pedidos.mjs` (`atualizarChuvaTalhao`), no servidor do Google Cloud |
| Tabela `chuva_talhao` | `supabase/0013_chuva_talhao.sql` e `supabase/0014_chuva_talhao_field_data.sql` |
| Limites dos talhões | cadastro do Mapas: `mapas_talhoes` (todos) e `mapas_areas_cultura` (por safra) |

A tabela guarda, por fazenda, a chuva diária de cada talhão desde 1º de setembro de duas safras atrás, os
dias que a ZEUS tem, os ciclos e a chuva dos pluviômetros; as somas são feitas no navegador. Quem vê: quem
tem a categoria Mapas e a fazenda liberada (mesma regra das outras páginas).

## Testar no computador

```
node modulos/chuva/scripts/servidor-local.mjs
```

Abre http://localhost:8794/chuva/ com uma fazenda fictícia. Nenhum limite, pluviômetro ou chuva real entra
no repositório. O endereço aceita `?fazenda=`, `?periodo=` (1, 7, 15, 30, mes, safra:2025, ciclo:0),
`?vista=` (mapa, diario, pics), `?modo=seca` e `?talhao=`.
