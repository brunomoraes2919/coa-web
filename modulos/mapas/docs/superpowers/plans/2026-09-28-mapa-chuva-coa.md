# Mapa de Chuva COA — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Site estático (GitHub Pages + Supabase opcional) que interpola a chuva do CSV da ZEUS com o mesmo IDW do QGIS, marca os talhões plantados e exporta o layout COA em PNG de alta definição.

**Architecture:** React + TypeScript (Vite). Lógica pura em `src/lib` (testada com Vitest), interpolação num Web Worker, renderização do layout em Canvas 2D (a mesma função gera a prévia e o PNG), persistência atrás da interface `Repositorio`, com implementação IndexedDB (modo local) e Supabase.

**Tech Stack:** Vite 6, React 18, TypeScript 5, react-router-dom 6 (HashRouter), proj4, shpjs, @tmcw/togeojson, @turf/area, polylabel, leaflet, idb, @supabase/supabase-js, @fontsource/open-sans, Vitest + jsdom + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-09-28-mapa-chuva-coa-design.md`

## Global Constraints

- Idioma da interface: português do Brasil.
- Cores da marca: verde `#0C5A50`, laranja `#DB8A08`.
- IDW padrão: potência 4, 12 vizinhos, pixel 5 m, buffer 10 m, UTM SIRGAS 2000 com zona automática.
- Página padrão: A3 paisagem 420×297 mm; A4 = mesmo desenho × (297/420).
- PNG: 150, 300 ou 600 dpi; padrão 300.
- Nenhum dado real da Locks no git: dados de teste reais ficam em `dados-teste/` (no .gitignore).
- Tipos compartilhados só em `src/lib/types.ts`; ninguém redefine tipos locais equivalentes.
- Subagentes **não** fazem `git commit`: o coordenador revisa e faz o commit.
- Nenhum arquivo passa de ~400 linhas; se passar, divida por responsabilidade.

## Mapa de arquivos

```
package.json, vite.config.ts, tsconfig*.json, index.html, .gitignore, README.md, iniciar.bat
scripts/gerar-paletas.mjs          .qml → src/lib/palettes.data.json
scripts/validar-grass.mjs          compara o IDW com precipitação.tif (dados-teste)
supabase/migrations/0001_init.sql
.github/workflows/deploy.yml
public/logo-coa.png
src/
  main.tsx, App.tsx, styles.css
  lib/types.ts            contratos compartilhados (Task 1)
  lib/format.ts           números e datas (Task 1)
  lib/palettes.ts         paletas + classificação (Task 1)
  lib/zeusCsv.ts          (Task 2)
  lib/projection.ts       (Task 1)
  lib/raster.ts           (Task 3)
  lib/idw.ts              (Task 3)
  lib/stats.ts            (Task 3)
  lib/pipeline.ts         (Task 3)
  lib/shapes.ts           (Task 4)
  data/config.ts, data/repo.ts, data/localRepo.ts, data/supabaseRepo.ts, data/auth.ts, data/index.ts (Task 5)
  render/*.ts             (Task 6)
  worker/interpolate.worker.ts, worker/client.ts (Task 7)
  components/*.tsx, pages/*.tsx (Tasks 7 e 8)
tests/*.test.ts
```

---

### Task 1: Scaffold, tipos, formatos e paletas (coordenador)

**Files:**
- Create: projeto Vite, `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/palettes.ts`, `scripts/gerar-paletas.mjs`, `src/lib/palettes.data.json`, `tests/format.test.ts`, `tests/palettes.test.ts`, `public/logo-coa.png`

**Interfaces — Produces (`src/lib/types.ts`):**

```ts
import type { Polygon, MultiPolygon } from 'geojson';
export type Geometry = Polygon | MultiPolygon;

export interface Pic {
  id: string; nome: string; lat: number; lon: number;
  chuva: number | null;          // mm; null = vazio no CSV
  inativo: boolean;              // coluna "Pic Inativa" = "Sim"
  inicio: Date | null; fim: Date | null;
  incluir: boolean;              // padrão: !inativo && chuva !== null
}
export interface ZeusCsvResult { pics: Pic[]; periodoInicio: Date | null; periodoFim: Date | null; avisos: string[] }

export interface Fazenda { id: string; nome: string; campoNome: string; campoSetor: string | null; colunas: string[]; criadoEm: string }
export interface Talhao { id: string; fazendaId: string; nome: string; setor: string | null; areaHa: number; geom: Geometry; atributos: Record<string, unknown> }
export interface Safra { id: string; nome: string; cultura: string; anoSafra: string; inicio: string; fim: string } // datas ISO yyyy-mm-dd
export interface Plantio { safraId: string; talhaoId: string; dataPlantio: string | null }

export interface IdwParams { potencia: number; vizinhos: number; pixel: number; buffer: number }
export const IDW_PADRAO: IdwParams = { potencia: 4, vizinhos: 12, pixel: 5, buffer: 10 };

export interface GridSpec { x0: number; y0: number; res: number; cols: number; rows: number } // x0 = minX, y0 = maxY (canto superior esquerdo), em metros UTM
export interface Grid extends GridSpec { epsg: number; values: Float32Array } // NaN = sem dado; linha 0 = norte

export interface Estat { media: number; min: number; max: number; areaHa: number }
export interface TalhaoStats extends Estat { talhaoId: string; nome: string; setor: string | null; plantado: boolean }
export interface ResumoChuva { geral: Estat; plantado: Estat | null; talhoes: TalhaoStats[] }

export interface PaletteClass { max: number; color: string; label: string } // valor <= max cai nesta classe
export interface Palette { id: string; nome: string; classes: PaletteClass[] }

export type EstiloPlantado = 'quadriculado' | 'diagonal' | 'pontilhado' | 'contorno';
export type MapaBase = 'topo' | 'satelite' | 'nenhum';
export interface LayoutTextos { titulo: string; fazenda: string; safra: string; periodo: string; fonte: string; talhoes: string; setor: string; observacao: string; data: string }
export interface MapExtent { cx: number; cy: number; mPorMm: number } // centro em Web Mercator (m) e metros Mercator por mm de papel
export interface LayoutConfig {
  pagina: 'A3' | 'A4';
  textos: LayoutTextos;
  paletaId: string;              // 'auto' ou id de PALETTES
  estiloPlantado: EstiloPlantado;
  mapaBase: MapaBase;
  mostrarRotulosTalhoes: boolean;
  mostrarValoresPics: boolean;
  mostrarGrade: boolean;
  legendaCompacta: boolean;
  extent: MapExtent | null;      // null = enquadrar a fazenda
  idw: IdwParams;
}
export interface MapaSalvo {
  id: string; fazendaId: string; safraId: string | null; titulo: string;
  periodoInicio: string | null; periodoFim: string | null;   // ISO
  config: LayoutConfig; pics: Pic[]; resumo: ResumoChuva;
  pngPath: string | null; thumbPath: string | null; criadoEm: string;
}
```

**`src/lib/format.ts`:**
```ts
fmtChuva(v: number): string          // 1 casa, ponto, sem ".0": 317.8 → "317.8", 332 → "332", 0.04 → "0"
fmtMilhar(v: number): string         // 2500 → "2.500"
fmtData(d: Date): string             // dd/MM/yyyy
parseDataBr(s: string): Date | null  // "20/08/2025 00:00" ou "20/08/2025"
fmtPeriodo(ini: Date | null, fim: Date | null): string
  // mesmo dia → "15/02/2025"; mesmo mês → "01 a 15/02/2025"; mesmo ano → "01/01 a 15/02/2025"; senão "01/12/2024 a 15/01/2025"; nulos → ""
```

**`src/lib/palettes.ts`:**
```ts
export const PALETTES: Palette[];                 // do JSON gerado
export function getPalette(id: string): Palette;  // lança se não existir
export function autoPalette(max: number): Palette; // max <= 160 → 'locks_0_160'; <= 2000 → 'acum_atual'; senão 'acum_anual'
export function resolvePalette(id: string, max: number): Palette; // 'auto' → autoPalette(max)
export function classify(v: number, p: Palette): number; // NaN → -1; primeira classe com v <= max; acima da última → última
export function buildClassIndex(values: Float32Array, p: Palette): Uint8Array; // 255 = sem dado
export function hexToRgb(hex: string): [number, number, number];
```

- [ ] Criar o projeto Vite, instalar dependências e configurar Vitest (environment `node`; testes de DOM usam `// @vitest-environment jsdom`).
- [ ] Escrever `types.ts`, `format.ts`, `palettes.ts` e o gerador de paletas a partir dos `.qml` em `09.COA/Estilos/Estilos mapa de chuva` (itens `<item label value color>` do `colorrampshader`).
- [ ] Testes: `fmtPeriodo` nos 5 casos; `fmtChuva` (317.8, 332, 0.04, 1234.56 → "1234.6"); `classify` com a paleta 1–160 (0 → 0, 1 → 0, 1.01 → 1, 160 → última, 999 → última, NaN → -1); `autoPalette`.
- [ ] `npm test` verde; commit.

### Task 2: Parser do CSV da ZEUS (subagente)

**Files:** Create `src/lib/zeusCsv.ts`, `tests/zeusCsv.test.ts`, `tests/fixtures/zeus-exemplo.csv` (sintético, mesmo formato)

**Interfaces:** Consumes `Pic`, `ZeusCsvResult` (types.ts), `parseDataBr` (format.ts). Produces:
```ts
export class ZeusCsvError extends Error {}
export function decodeCsvBuffer(buf: ArrayBuffer): string; // UTF-8 (remove BOM); se houver bytes UTF-8 inválidos, decodifica como windows-1252
export function parseZeusCsv(text: string): ZeusCsvResult;
```

Formato do arquivo da ZEUS (UTF-8, CRLF, separador vírgula, decimal com vírgula entre aspas, colunas extras vazias no fim; a linha de exemplo tem valores fictícios):
```
id,nome,lat,lon,início do periodo [GMT-3],final do periodo [GMT-3],Pic Inativa,precipitação [mm],temperatura mínima [ºC],...,,,,
9105,"PIC 01 (TH1,2) FAZENDA","-20,123456","-45,654321",20/08/2025 00:00,20/08/2025 00:00,Não,0,"19,7",27,...
```
Regras:
- Aceitar separador `,` ou `;` (detectar pela linha de cabeçalho).
- Localizar colunas por nome normalizado (minúsculas, sem acento, sem espaços extras): `lat`, `lon`, `id`, `nome`, prefixo `inicio do periodo`, prefixo `final do periodo`, `pic inativa`, prefixo `precipitacao` (aceitar também `chuva`). Faltando lat, lon ou precipitação → `ZeusCsvError('Coluna "precipitação [mm]" não encontrada no CSV')` (nome da coluna na mensagem).
- Números: remover espaços, trocar `,` por `.`; vazio → null. Lat/lon inválidos → linha ignorada com aviso `Linha N ignorada: coordenada inválida`.
- `inativo` = valor normalizado `sim`/`true`/`1`.
- `incluir = !inativo && chuva !== null`.
- `periodoInicio` = menor `inicio`; `periodoFim` = maior `fim`.
- Linhas totalmente vazias são ignoradas silenciosamente.
- Aviso quando houver PICs inativos: `3 PICs inativos foram desmarcados`; quando houver chuva vazia: `2 PICs sem precipitação foram desmarcados`.

Testes (mínimo): fixture com 5 linhas (1 inativa, 1 sem chuva, nomes com vírgula entre aspas) → 5 pics, valores `-20.123456`, chuva `2.3`, `incluir` corretos, período correto, 2 avisos; separador `;`; BOM; coluna faltando lança `ZeusCsvError` com o nome da coluna; `decodeCsvBuffer` com bytes latin1 (`precipita\xe7\xe3o`) retorna texto com "ç".

- [ ] Escrever os testes, ver falharem, implementar, ver passarem (`npx vitest run tests/zeusCsv.test.ts`).

### Task 3: Motor de interpolação (subagente)

**Files:** Create `src/lib/raster.ts`, `src/lib/idw.ts`, `src/lib/stats.ts`, `src/lib/pipeline.ts` e os testes correspondentes

**Interfaces — Produces:**
```ts
// projection.ts — JÁ IMPLEMENTADO pelo coordenador (commit 8336eb9, tests/projection.test.ts). Apenas consuma:
export function utmEpsgFor(lon: number, lat: number): number; // zona = floor((lon+180)/6)+1; sul: 31960+zona (21S → 31981); norte: 31954+zona
export interface Projetor { epsg: number; forward(lon: number, lat: number): [number, number]; inverse(x: number, y: number): [number, number] }
export function projetorUtm(epsg: number): Projetor; // "+proj=utm +zone=Z [+south] +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
export function lonLatToMerc(lon: number, lat: number): [number, number]; // EPSG:3857, fórmula direta (sem proj4)
export function mercToLonLat(x: number, y: number): [number, number];
export type Ring = [number, number][]; export type PolyXY = Ring[]; export type MultiPolyXY = PolyXY[];
export function geomToXY(g: Geometry, f: (lon: number, lat: number) => [number, number]): MultiPolyXY;

// raster.ts
export function gridSpecFromBounds(minX: number, minY: number, maxX: number, maxY: number, res: number): GridSpec; // x0=minX, y0=maxY, cols=ceil((maxX-minX)/res), rows=ceil((maxY-minY)/res)
export function cellCenter(s: GridSpec, col: number, row: number): [number, number]; // [x0+(col+.5)res, y0-(row+.5)res]
export function rasterizeZones(s: GridSpec, zonas: MultiPolyXY[]): Int32Array; // centro da célula dentro (par-ímpar, buracos) → índice da zona; -1 fora; zonas posteriores sobrescrevem
export function dilate(mask: Uint8Array, s: GridSpec, raioCelulas: number): Uint8Array; // disco: dx²+dy² <= r²

// idw.ts — fiel ao GRASS v.surf.idw
export interface IdwPoint { x: number; y: number; v: number }
export function idwAt(x: number, y: number, pts: IdwPoint[], potencia: number, k: number): number; // k vizinhos mais próximos; d == 0 → v do ponto; peso 1/d^p
export function idwGrid(s: GridSpec, mask: Uint8Array, pts: IdwPoint[], potencia: number, k: number, onProgress?: (f: number) => void): Float32Array; // NaN fora da máscara

// stats.ts
export function statsZonas(values: Float32Array, zonas: Int32Array, nZonas: number, areaCelulaM2: number): Estat[]; // zona sem célula válida → NaN/NaN/NaN, areaHa 0
export function statsMascara(values: Float32Array, incluir: (i: number) => boolean, areaCelulaM2: number): Estat;

// pipeline.ts
export interface PipelineInput { talhoes: Pick<Talhao, 'id' | 'nome' | 'setor' | 'geom'>[]; pics: Pick<Pic, 'lat' | 'lon' | 'chuva'>[]; params: IdwParams; plantados: string[] }
export interface PipelineOutput { grid: Grid; resumo: ResumoChuva }
export function runPipeline(inp: PipelineInput, onProgress?: (f: number) => void): PipelineOutput;
```

`runPipeline`:
1. `epsg = utmEpsgFor(centróide do bbox dos talhões)`; projeta talhões e PICs para UTM.
2. bbox dos talhões expandido por `params.buffer` → `gridSpecFromBounds(..., params.pixel)`.
3. `zonas = rasterizeZones(spec, talhõesXY)`; `mask = zonas >= 0`; `mask = dilate(mask, spec, round(buffer/pixel))`.
4. `values = idwGrid(spec, mask, picsXY (chuva != null), potencia, vizinhos)`.
5. Resumo: por talhão (`statsZonas`, área da célula `pixel²`); geral = máscara sem buffer (zonas >= 0); plantado = zonas cujo id está em `plantados` (null se vazio). `TalhaoStats` preserva a ordem dos talhões.
6. Lança `Error('Mínimo de 3 PICs com precipitação para interpolar')` se houver menos de 3.

Testes (projection já testado): `rasterizeZones` com quadrado de 10×10 células (100 dentro), quadrado com buraco (buraco fica -1) e multipolígono; `dilate` de um pixel com raio 2 → 13 células; `idwAt` com 1 ponto = valor; com d=0 = valor exato; 2 pontos simétricos = média; k=1 = vizinho mais próximo; `idwGrid` respeita a máscara (NaN fora); `runPipeline` com 4 PICs de valores iguais (10) → todas as células = 10 e resumo geral = 10; menos de 3 PICs lança erro.

- [ ] TDD de cada arquivo; `npx vitest run tests/idw.test.ts tests/raster.test.ts tests/stats.test.ts tests/pipeline.test.ts`.

### Task 4: Importação de shapes (subagente)

**Files:** Create `src/lib/shapes.ts`, `tests/shapes.test.ts`

**Interfaces — Produces:**
```ts
export interface FeicaoImportada { geom: Geometry; props: Record<string, unknown> }
export interface ShapeImport { feicoes: FeicaoImportada[]; colunas: string[]; avisos: string[]; nomeSugerido: string }
export class ShapeError extends Error {}
export async function importarShape(files: File[]): Promise<ShapeImport>;
  // .zip → shpjs; .shp (+.dbf/.prj/.cpg soltos) → shpjs parseShp/parseDbf/combine; .kml → @tmcw/togeojson; .geojson/.json → JSON
  // só Polygon/MultiPolygon (outros tipos ignorados com aviso); sem polígonos → ShapeError('Nenhum polígono encontrado no arquivo')
  // .shp sem .prj: se |x|<=180 e |y|<=90 assume WGS84 com aviso; senão ShapeError('Arquivo .prj ausente: não foi possível identificar o sistema de coordenadas')
  // nomeSugerido = nome do arquivo sem extensão
export function sugerirColunaNome(colunas: string[], feicoes: FeicaoImportada[]): string;
  // preferência (normalizado): nome, talhao, talhoes, name, th, campo; senão a primeira coluna de texto com valores únicos
export function sugerirColunaSetor(colunas: string[]): string | null; // setor, sector, bloco, modulo
export function areaHa(g: Geometry): number; // @turf/area / 10000
```
Testes: GeoJSON com 2 polígonos + 1 ponto (aviso, 2 feições); KML com 1 Placemark (jsdom); sugestões de coluna; `areaHa` de um quadrado de 0,01° no equador ≈ 123,6 ha (±1%); arquivo sem polígonos lança `ShapeError`. Shapefile: teste de integração opcional com `dados-teste/Guapirama_V2.zip` (skip se ausente) → 111 feições, coluna `NOME`.

- [ ] TDD; `npx vitest run tests/shapes.test.ts`.

### Task 5: Camada de dados (subagente)

**Files:** Create `src/data/config.ts`, `src/data/repo.ts`, `src/data/localRepo.ts`, `src/data/supabaseRepo.ts`, `src/data/auth.ts`, `src/data/index.ts`, `supabase/migrations/0001_init.sql`, `tests/localRepo.test.ts`

**Interfaces — Produces:**
```ts
// config.ts
export interface AppConfig { modo: 'local' | 'supabase'; supabaseUrl: string; supabaseKey: string }
export function lerConfig(): AppConfig;   // localStorage 'coa-chuva-config' sobrepõe import.meta.env.VITE_SUPABASE_URL/KEY; modo 'supabase' só se url e key existirem
export function salvarConfig(c: AppConfig): void;

// repo.ts
export interface BackupJson { versao: 1; fazendas: Fazenda[]; talhoes: Talhao[]; safras: Safra[]; plantios: Plantio[]; mapas: MapaSalvo[] }
export interface Repositorio {
  modo: 'local' | 'supabase';
  listarFazendas(): Promise<Fazenda[]>;
  obterTalhoes(fazendaId: string): Promise<Talhao[]>;
  salvarFazenda(f: Fazenda, talhoes: Talhao[]): Promise<void>;       // upsert fazenda + substitui todos os talhões dela
  atualizarFazenda(f: Fazenda, talhoes: Talhao[]): Promise<void>;    // atualiza nome/campos e nome/setor dos talhões (mesmos ids)
  excluirFazenda(id: string): Promise<void>;                          // em cascata: talhões, plantios dos talhões e mapas
  listarSafras(): Promise<Safra[]>;
  salvarSafra(s: Safra): Promise<void>;
  excluirSafra(id: string): Promise<void>;                            // em cascata: plantios
  listarPlantios(safraId: string): Promise<Plantio[]>;
  salvarPlantios(safraId: string, fazendaId: string, plantios: Plantio[]): Promise<void>; // substitui os plantios desta safra nos talhões desta fazenda
  listarMapas(): Promise<MapaSalvo[]>;                                // mais recente primeiro
  salvarMapa(m: MapaSalvo, png: Blob, thumb: Blob): Promise<MapaSalvo>; // define pngPath/thumbPath
  urlArquivo(path: string): Promise<string>;                          // object URL (local) ou signed URL de 1 h (supabase)
  excluirMapa(m: MapaSalvo): Promise<void>;
  exportarBackup(): Promise<BackupJson>;                              // sem os PNGs
  importarBackup(b: BackupJson): Promise<void>;                       // upsert de tudo
}
// localRepo.ts: export function criarLocalRepo(dbName = 'coa-chuva'): Repositorio   (idb; stores: fazendas, talhoes[index fazendaId], safras, plantios[key safraId|talhaoId], mapas, arquivos)
// supabaseRepo.ts: export function criarSupabaseRepo(client: SupabaseClient): Repositorio
// auth.ts: export function clienteSupabase(): SupabaseClient | null; sessaoAtual(); entrar(email, senha); sair(); onAuthChange(cb)
// index.ts: export function repo(): Repositorio  (singleton conforme lerConfig())
```
Tabelas em snake_case (fazendas, talhoes, safras, plantios, mapas) exatamente como no spec; `geom`, `atributos`, `colunas`, `config`, `pics`, `resumo` como jsonb; RLS `to authenticated using (true) with check (true)`; bucket privado `mapas` com políticas para authenticated. Conversão camelCase ↔ snake_case centralizada em `supabaseRepo.ts`. Datas `Date` em `Pic` viram string ISO no JSON; ao ler, reconverter.

Testes (fake-indexeddb): salvar/ler fazenda com talhões; excluir fazenda remove talhões, plantios e mapas; `salvarPlantios` substitui só os talhões daquela fazenda; `salvarMapa` + `urlArquivo` (no Node, retornar `data:` URL quando `URL.createObjectURL` não existir); backup ida e volta.

- [ ] TDD do localRepo; o supabaseRepo é verificado por tipo (`tsc --noEmit`) e revisão.

### Task 6: Renderização do layout (subagente)

**Files:** Create `src/render/types.ts`, `src/render/layout.ts`, `src/render/mapFrame.ts`, `src/render/legend.ts`, `src/render/scalebar.ts`, `src/render/northArrow.ts`, `src/render/labels.ts`, `src/render/patterns.ts`, `src/render/tiles.ts`, `src/render/geometry.ts`, `tests/render-geometry.test.ts`, `tests/labels.test.ts`

**Interfaces:** Consumes `types.ts`, `palettes.ts` (buildClassIndex, hexToRgb), `projection.ts` (projetorUtm, lonLatToMerc, mercToLonLat), `format.ts`. Produces:
```ts
// render/types.ts
export interface RenderInput {
  config: LayoutConfig; palette: Palette;
  grid: Grid | null;
  talhoes: Talhao[]; plantados: Set<string>; nomeSafra: string;
  pics: Pic[];                    // só os incluídos
  logo: CanvasImageSource | null;
  tiles: TileSource | null;       // null = sem mapa base
}
export interface TileSource { url(z: number, x: number, y: number): string; maxZoom: number; atribuicao: string; clarear: number } // clarear 0..1 = véu branco
export const TILES: Record<'topo' | 'satelite', TileSource>;
export const PAGINA_MM = { A3: { w: 420, h: 297 }, A4: { w: 297, h: 210 } };
// layout.ts
export async function renderLayout(ctx: CanvasRenderingContext2D, inp: RenderInput, pxPorMm: number): Promise<{ avisos: string[] }>;
  // desenha em coordenadas A3 (mm) com ctx.scale(pxPorMm * fator), fator = 1 (A3) ou 297/420 (A4)
export function mapFrameRectMm(): { x: number; y: number; w: number; h: number }; // {x:5, y:4.4, w:333, h:288}
export function autoExtent(talhoes: Talhao[]): MapExtent;  // enquadra o bbox Mercator com 6% de margem
// geometry.ts (puro, testável)
export function mercToFramePx(ext: MapExtent, frameW: number, frameH: number, pxPorMm: number): (mx: number, my: number) => [number, number];
export function niceScaleBar(metrosPorMm: number, alvoMm = 40): { segmentoM: number; segmentoMm: number }; // segmento em {100,200,250,500,1000,2000,2500,5000,10000,20000}; 2 segmentos ≈ alvo
export function graticuleStep(spanGraus: number): number; // entre 2 e 5 marcas: 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1
export function tileZoomFor(metrosPorPx: number, lat: number, maxZoom: number): number;
// labels.ts
export interface Rect { x: number; y: number; w: number; h: number }
export class LabelPlacer { tenta(cands: Rect[]): Rect | null }  // primeira candidata sem colisão com as já aceitas
```
Desenho (medidas A3 em mm, ver spec "Layout"): fundo `#0C5A50`; quadro do mapa branco; painel branco em (343.5, 4.4, 71.4, 288); rosa dos ventos centrada em (379, 50) com raio 17; título em 2 linhas (Open Sans 700, 7 mm) centrado em y 88–97; caixa das informações (348, 108, 62, 118, borda 0,35 mm) com linhas "RÓTULO: valor" em Open Sans 700 4,2 mm e quebra automática; logo (proporção preservada, largura 60 mm) em y ≈ 245; data centralizada em y 283. No quadro do mapa, com clip: tiles (Mercator) + véu branco (`clarear`); raster classificado desenhado por amostragem (para cada pixel: Mercator → lon/lat → UTM → célula; lattice exato a cada 8 px com interpolação bilinear); talhões (contorno preto 0,4 mm); plantados = padrão escolhido (quadriculado: linhas pretas 0,25 mm a cada 2,5 mm, alfa 0,55; diagonal: 45°; pontilhado: pontos de 0,5 mm a cada 1,8 mm) + contorno `#DB8A08` 0,7 mm; rótulos dos talhões (Open Sans 400 2,1 mm, halo branco 0,6 mm, posição polylabel, evitando colisão); PICs (gota azul `#1E88E5`→`#0D5FA8`, altura 5,5 mm, ponta no ponto) com valor (Open Sans 700 3,5 mm branco, halo `#393939` 0,8 mm, à direita e acima, com candidatas alternativas); legenda (caixa branca alfa 0,88 no canto inferior esquerdo: "PICS" + gota, "Área plantada – {nomeSafra}" + amostra do padrão quando houver plantados, depois as classes com amostra 7×4,2 mm de borda cinza; `legendaCompacta` = só classes presentes no grid); barra de escala no canto inferior direito (preto/branco, rótulos "0", "2.500", "5.000 m" com fmtMilhar, metros **no terreno** = mPorMm × cos(lat)); grade (marcas de lat/lon nas bordas internas, texto 2,4 mm "-14.000"); atribuição do mapa base em 1,8 mm no canto inferior direito, acima da escala.

Tiles: carregar com `Image` + `crossOrigin='anonymous'`, cache em memória por URL, `Promise.allSettled`; falhas → aviso `Mapa base indisponível` e segue sem ele. Máximo de 400 tiles (reduzir o zoom até caber).

Testes: `niceScaleBar`, `graticuleStep`, `tileZoomFor`, `mercToFramePx` (centro → centro do quadro), `LabelPlacer` (sobreposição rejeitada, adjacência aceita).

- [ ] TDD das partes puras; a renderização completa é verificada no navegador (Task 9).

### Task 7: Shell do app, Fazendas, Safras, Configurações e Login (subagente)

**Files:** Create `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/components/{Shell,MapaLeaflet,Carregando,Aviso,Modal}.tsx`, `src/pages/{Fazendas,FazendaNova,FazendaEditar,Safras,Plantio,Configuracoes,Login}.tsx`

**Interfaces:** Consumes `repo()` (data/index.ts), `importarShape`, `sugerirColunaNome`, `sugerirColunaSetor`, `areaHa` (shapes.ts), auth.ts, types.ts. Produces rotas (HashRouter): `/mapas`, `/mapas/novo`, `/mapas/:id`, `/fazendas`, `/fazendas/nova`, `/fazendas/:id`, `/safras`, `/safras/:safraId/plantio/:fazendaId`, `/config`, `/login`. `MapaLeaflet` props: `{ talhoes: Talhao[] | FeicaoImportada[]; selecionados?: Set<string>; onClickTalhao?(id: string): void; rotulo?(i: number): string; altura?: number }` com satélite Esri e `fitBounds`.

UX: barra lateral verde `#0C5A50` com logo e itens (Mapas, Novo mapa, Fazendas, Safras, Configurações); indicador do modo ("Modo local" ou e-mail do usuário); mensagens de erro em português; botões primários laranja `#DB8A08`. Cadastro de fazenda: arrastar arquivos → `importarShape` → prévia no mapa, tabela das primeiras 8 feições, seletor de coluna do nome (com exemplos de valores) e do setor (opcional) → nome da fazenda → Salvar (gera ids com `crypto.randomUUID()`, calcula `areaHa`). Plantio: mapa clicável (plantado em laranja) + lista com caixa e data por talhão, busca, "Marcar todos", "Limpar", Salvar. No modo Supabase sem sessão, redirecionar para `/login`.

- [ ] Implementar; `npx tsc --noEmit` limpo; conferir no navegador.

### Task 8: Editor "Novo mapa" e histórico (coordenador)

**Files:** Create `src/worker/interpolate.worker.ts`, `src/worker/client.ts`, `src/pages/NovoMapa.tsx`, `src/pages/Mapas.tsx`, `src/components/{PreviaLayout,TabelaPics,TabelaTalhoes,PainelTextos}.tsx`, `src/lib/exportar.ts`

**Interfaces:** `client.ts`: `interpolar(inp: PipelineInput, onProgress): Promise<PipelineOutput>` (Worker com `new URL('./interpolate.worker.ts', import.meta.url)`, transferindo `values.buffer`). `exportar.ts`: `gerarPng(inp: RenderInput, dpi: number): Promise<Blob>` e `gerarMiniatura(inp): Promise<Blob>` (largura 480 px).

Fluxo: fazenda + safra → CSV (drop) → tabela de PICs com caixas → Interpolar (barra de progresso) → prévia (renderLayout em canvas do tamanho do contêiner; arrastar = pan do `extent`, roda = zoom, botão "Reenquadrar") → textos editáveis (preenchidos automaticamente) → aparência → "Baixar PNG" (dpi) e "Salvar no histórico". `/mapas/:id` reabre um mapa salvo (reinterpola com os PICs e parâmetros guardados). Tabela "Chuva por talhão": nome, setor, plantado, área, média, mínima e máxima; ordenável; exportar CSV; resumo "Área plantada: X ha · chuva média Y mm".

- [ ] Implementar; verificar no navegador com dados reais.

### Task 9: Validação, deploy e verificação ponta a ponta (coordenador)

- [ ] `scripts/validar-grass.mjs`: lê `dados-teste/tres-flechas/precipitação.tif` (geotiff) e `PICS.shp` (shpjs), roda `idwGrid` na mesma grade e informa o erro médio absoluto e o máximo nas células válidas. Critério: MAE < 0,1 mm.
- [ ] `.github/workflows/deploy.yml` (Pages, com `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` dos secrets), `vite.config.ts` com `base: './'`, `README.md` (uso, Supabase passo a passo, publicação), `iniciar.bat`.
- [ ] Ponta a ponta no navegador: cadastrar Guapirama_V2 → safra SOJA 26/27 → plantados → CSV de fevereiro de 2025 → interpolar → conferir os valores dos PICs na prévia → exportar 300 dpi → abrir o PNG e comparar com `MAPA_CHUVA 13-02 a 14-02.png`.
- [ ] `npm run build` e `npm test` verdes; revisão final; commit.
