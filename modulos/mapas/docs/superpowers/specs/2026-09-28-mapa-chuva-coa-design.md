# Mapa de Chuva COA — Design

Data: 28/09/2026 · Status: aprovado por delegação (o usuário autorizou todas as decisões restantes)

## Objetivo

Substituir o fluxo manual "CSV da ZEUS → QGIS → modelo `MAPA_CHUVA_V3_ATUAL.model3` → layout"
por um site que:

1. cadastra os shapes de talhões de cada fazenda, escolhendo qual coluna é o nome do talhão;
2. cadastra safras (cultura + ano + período de produção, ex.: `SOJA 26/27`) e, por fazenda,
   quais talhões já estão plantados;
3. recebe o CSV exportado da ZEUS, interpola a chuva com **o mesmo modelo do QGIS**
   e mostra os talhões plantados com hachura quadriculada sobre a interpolação;
4. monta o layout pronto na identidade visual do COA, com campos editáveis;
5. exporta PNG em alta definição e guarda o histórico.

Os dados de chuva vêm **só do CSV**: a sincronização ZEUS do Agrovex está defasada
(`stg_field_data` parou em 13/09/2026).

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Hospedagem | Site estático (Vite + React + TypeScript) no GitHub Pages, publicado por GitHub Actions | Pedido do usuário; sem servidor para manter |
| Backend | Supabase: Auth (e-mail e senha), Postgres (tabelas + RLS) e Storage (PNGs) | Pedido do usuário |
| Modo sem Supabase | O mesmo app funciona em **modo local** (IndexedDB do navegador) quando o Supabase não está configurado | Testável agora; a conta Supabase ainda não existe nesta máquina |
| Processamento | 100% no navegador, com interpolação num Web Worker | GitHub Pages não roda código de servidor; o IDW de uma fazenda leva segundos |
| Interpolação | IDW idêntico ao `grass7:v.surf.idw` do modelo: potência 4, 12 vizinhos, pixel 5 m, em UTM SIRGAS 2000 | Mesmo resultado do QGIS (validado contra um raster real) |
| Máscara | Talhões unidos + buffer de 10 m (equivale a `native:buffer` + `gdal:cliprasterbymasklayer`) | Mesmo recorte do modelo |
| Zona UTM | Automática pelo centróide da fazenda (EPSG 31978–31985, SIRGAS 2000 / UTM xxS) | Hoje fixo em 21S, que atende as fazendas atuais; a zona automática cobre fazendas novas |
| PICs | Por padrão exclui `Pic Inativa = Sim` e linhas sem precipitação; a tela permite ligar e desligar cada PIC | Evita zero falso de PIC parado; o usuário decide |
| Shapes aceitos | Shapefile zipado, arquivos .shp/.dbf/.prj/.cpg soltos, KML e GeoJSON; tudo convertido para GeoJSON WGS84 | Formatos que já estão nas pastas do COA |
| Plantado | Registro por (safra, talhão), com data opcional; a safra tem cultura, ano e período | Resposta do usuário: "Safra com período de produção, ex.: SOJA 26/27" |
| Visual plantado | Padrão **quadriculado** (padrão); opções: hachura diagonal, pontilhado ou só contorno | Pedido do usuário |
| Paletas | Extraídas dos `.qml` do COA; modo "Automática" escolhe pela chuva máxima | Mantém as cores atuais |
| Layout | A3 paisagem (420×297 mm, como o `.qpt` atual) ou A4 (mesmo desenho em escala) | Fiel ao layout atual |
| Exportação | PNG em 150, 300 ou 600 dpi (padrão 300 dpi, A3 = 4961×3508 px) | "Alta definição" |
| Mapa base | Esri World Topo (padrão, clareado), Esri Satélite ou nenhum | Parecido com o fundo atual; aceita CORS para exportar |

## Arquitetura

```
src/
  lib/                 lógica pura, testada com Vitest
    zeusCsv.ts         parse do CSV da ZEUS (vírgula decimal, aspas, BOM, acentos)
    shapes.ts          import de shapefile/KML/GeoJSON → FeatureCollection WGS84
    projection.ts      zona UTM automática, transformações (proj4)
    raster.ts          grade, rasterização de polígonos, dilatação (buffer)
    idw.ts             IDW (p, k vizinhos) sobre a grade mascarada
    stats.ts           chuva média, mínima e máxima por talhão e na área plantada
    palettes.ts        paletas discretas (JSON gerado dos .qml) + escolha automática
    format.ts          datas e números
  worker/interpolate.worker.ts   roda raster + idw + stats fora da thread da UI
  render/              desenho do layout em Canvas 2D (prévia = exportação)
    layout.ts          página, moldura, painel lateral, textos
    mapFrame.ts        mapa base, raster, talhões, hachura, PICs, rótulos, grade
    legend.ts, scalebar.ts, northArrow.ts, labels.ts (anticolisão)
    tiles.ts           tiles Web Mercator com cache
  data/
    repo.ts            interface Repositorio
    localRepo.ts       IndexedDB
    supabaseRepo.ts    Supabase
  pages/               Mapas (histórico), NovoMapa (editor), Fazendas, Safras, Configurações, Login
supabase/migrations/0001_init.sql
.github/workflows/deploy.yml
```

As unidades conversam por tipos simples (`Pic`, `Talhao`, `Grid`, `LayoutSpec`) definidos em `src/lib/types.ts`.
A renderização recebe um `LayoutSpec` já calculado e não conhece o banco; o banco não conhece o
render. Isso permite testar `lib/` sem navegador e trocar o repositório sem mexer nas telas.

## Modelo de dados

```
fazendas  (id, nome, campo_nome, campo_setor?, colunas[], criado_em)
talhoes   (id, fazenda_id, nome, setor?, area_ha, geom GeoJSON WGS84, atributos jsonb)
safras    (id, nome "SOJA 26/27", cultura, ano_safra "26/27", inicio date, fim date)
plantios  (safra_id, talhao_id, data_plantio?)  PK(safra_id, talhao_id)
mapas     (id, fazenda_id, safra_id?, titulo, periodo_inicio, periodo_fim,
           config jsonb (campos do layout, paleta, parâmetros), pics jsonb,
           resumo jsonb (estatísticas), png_path, criado_em, criado_por)
storage:  bucket privado "mapas" (PNG e miniatura)
RLS:      usuário autenticado lê e escreve tudo; anônimo não acessa nada
```

## Pipeline (espelho do modelo QGIS)

| Modelo QGIS | Plataforma |
|---|---|
| `refactorfields` + `createpointslayerfromtable` (lat/lon → pontos) | `zeusCsv.parse` → `Pic[]` (lat, lon, chuva, ativo) |
| `reprojectlayer` → EPSG:31981 | `projection.toUtm` (zona automática; 21S para as fazendas atuais) |
| `native:buffer` 10 m, dissolvido | máscara: rasteriza os talhões e dilata 10 m (disco de raio 2 células) |
| `v.surf.idw` power=4, npoints=12, cellsize=5, região = extensão do buffer | `idw.run` com os mesmos parâmetros, centro da célula, d=0 → valor do PIC |
| `gdal:cliprasterbymasklayer` | células fora da máscara ficam sem dado |
| `setlayerstyle` (Precipitacao_*.qml) | `palettes.classify` com as mesmas classes discretas |

Os parâmetros ficam editáveis em "Avançado", com os valores do modelo como padrão.

## Telas

1. **Mapas**: histórico com miniatura, fazenda, safra e período; abrir, baixar PNG, excluir; botão "Novo mapa".
2. **Novo mapa** (editor em uma tela): a coluna esquerda tem os passos
   1) fazenda e safra, 2) CSV da ZEUS (arrastar e soltar) e tabela de PICs, 3) interpolação,
   4) textos do layout, 5) aparência (paleta, estilo do plantado, mapa base, rótulos) e
   6) exportação. A direita mostra a prévia do layout, com arrastar e zoom no quadro do mapa,
   e abaixo dela a tabela "Chuva por talhão", com destaque para os plantados e exportação em CSV.
3. **Fazendas**: lista; cadastrar (upload → prévia no mapa satélite → escolher a coluna do nome
   e, se houver, do setor → nome da fazenda → salvar); editar a coluna do rótulo; renomear; excluir.
4. **Safras**: criar e editar safras; para cada fazenda, um mapa clicável e uma lista com caixas de
   seleção (e data) para marcar os plantados, com "marcar todos" e "limpar".
5. **Configurações**: modo (Local ou Supabase), URL e chave anon, testar conexão, exportar e importar
   backup JSON (serve também para migrar do modo local para o Supabase).
6. **Login** (só no modo Supabase): e-mail e senha.

## Layout (A3 paisagem, medidas em mm; o A4 usa a mesma escala × 0,7071)

- Fundo verde `#0C5A50` na página inteira; quadro do mapa branco em (5; 4,4) com 333×288;
  painel lateral branco em (343,5; 4,4) com 71,4×288.
- Painel: rosa dos ventos (N, S, L, O); título "MAPA DE PRECIPITAÇÃO" em negrito centralizado;
  caixa com borda contendo FAZENDA, SAFRA, PERÍODO, FONTE DE INFORMAÇÃO, TALHÕES, SETOR e
  observação opcional; no rodapé, logo horizontal do COA e a data.
- Mapa: mapa base clareado, raster classificado, contorno dos talhões em preto de 0,4 mm,
  rótulos dos talhões (Open Sans 6 pt, halo branco), talhões plantados com o padrão escolhido e
  contorno laranja `#DB8A08`, PICs como gota azul com o valor em branco negrito e halo escuro,
  legenda no canto inferior esquerdo (PICs, área plantada e classes), barra de escala
  (0 – x – 2x m) no canto inferior direito, marcas de coordenadas nas bordas e atribuição do mapa base.
- Todos os textos do painel são editáveis e preenchidos automaticamente: a fazenda pelo cadastro,
  a safra pela safra escolhida, o período pelo início e fim do CSV, a fonte com "ZEUS",
  talhões e setor com "TODOS" (ou a seleção feita) e a data de hoje.

## Erros e validações

- CSV sem as colunas `lat`, `lon` ou `precipitação [mm]` → erro indicando qual coluna falta.
- Menos de 3 PICs válidos → erro "mínimo de 3 PICs para interpolar".
- PICs longe da fazenda (a mais de 20 km da borda) → aviso, sem bloquear.
- Período do CSV fora do período da safra → aviso.
- Shape sem `.prj` → assume WGS84 se as coordenadas parecerem graus; senão pede a zona UTM.
- Tiles que falham ao carregar → exporta sem mapa base e avisa.
- Supabase fora do ar ou sem login → mensagem e redireciona para o login.

## Testes

- Vitest para tudo em `lib/`: parse de CSV real (fixture sintética no mesmo formato), rasterização
  com buracos e multipolígonos, dilatação, IDW (casos analíticos: 1 ponto, d=0, simetria, k<n),
  estatísticas, classificação das paletas e zona UTM.
- Validação contra o GRASS: um script compara o IDW da plataforma com o `precipitação.tif` gerado
  pelo QGIS (Três Flechas), usando o PICS.shp de entrada. Os dados reais ficam fora do git (`dados-teste/`).
- Ponta a ponta no navegador: cadastrar Guapirama_V2, criar SOJA 26/27, marcar plantados,
  gerar com o CSV de fevereiro de 2025 e exportar PNG a 300 dpi.

## Fora de escopo (por enquanto)

Integração direta com a API da ZEUS ou com o Agrovex, PDF, edição de geometria dos talhões,
paletas personalizadas pelo usuário, permissões por fazenda e mapas de temperatura ou umidade.
