# Plantio automático do PIMS + cadastro pré-carregado — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pintar no mapa de chuva os talhões plantados/plantando/a plantar lidos do PIMS (via Agrovex, publicados como `plantio.json` por uma rotina do GitHub Actions), amarrados ao código do shape, e entregar o sistema com as unidades e a safra SOJA 26/27 pré-cadastradas.

**Architecture:** Rotina Node (`scripts/sincronizar-plantio.mjs`) consulta o Agrovex e gera `public/dados/plantio.json`; o app (estático) lê o JSON e casa `(unidadePims, codigo)`. Seed em `public/dados/seed/` carregado no primeiro uso. O render ganha três estilos de situação.

**Tech Stack:** o existente (Vite 8, React 19, TS 7, Vitest 5, shpjs, idb, Supabase). Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-28-plantio-pims-design.md` (complementa `2026-09-28-mapa-chuva-coa-design.md`).

## Global Constraints

- UI em português do Brasil; cores da marca verde `#0C5A50`, laranja `#DB8A08`; plantando amarelo `#F2C200`; a plantar contorno tracejado cinza `#555`.
- Regra de status: plantado = `DT_PLANT_ENC` preenchida ou área apontada ≥ 99% da prevista; plantando = 0 < apontada < 99%; a_plantar = sem apontamento.
- Normalização de código (ambos os lados): maiúsculas sem acento; remove prefixo `TH`/`TALHAO`/`TALHÃO`; `PIVÔ 02`/`PIVO 2`/`PIV2` → `02PIVO`; `^\d+\s*[A-Z]*$` → número com 3 dígitos + sufixo (`39B`→`039B`, `TH 033A`→`033A`, `69`→`069`); demais sem espaços.
- Tipos compartilhados só em `src/lib/types.ts`. Arquivos < ~400 linhas. Nenhum token no repositório: o Agrovex usa `AGROVEX_TOKEN` (env / GitHub secret).
- Nenhum dado real além do seed (limites das unidades e áreas de soja, que o usuário pediu para pré-cadastrar) e do `plantio.json` gerado.
- Subagentes não fazem `git commit`.

## Mapa de arquivos

```
scripts/sincronizar-plantio.mjs      Task A   (Node puro; fetch nativo; testável via função exportada)
scripts/plantio.config.json          Task A   safras a sincronizar (padrão automático)
.github/workflows/plantio.yml        Task A
tests/sincronizar-plantio.test.ts    Task A   (importa o .mjs; fake fetch)
public/dados/plantio.json            Task A   (gerado; primeiro conteúdo real via npm run plantio)
src/lib/codigoTalhao.ts              Task B   normalizarCodigo(), sugerirColunaCodigo()
scripts/gerar-seed.mjs               Task B   dados-fonte/*.zip → public/dados/seed/{unidade}.geojson, soja-26-27/{unidade}.geojson, seed.json
public/dados/seed/**                 Task B   (gerado e commitado)
tests/codigoTalhao.test.ts, tests/gerar-seed.test.ts   Task B
src/lib/types.ts, src/data/repo.ts, localRepo.ts, supabaseRepo.ts, supabase/migrations/0002_plantio_pims.sql   Task C
src/lib/plantioPims.ts (leitura do JSON + casamento + resolução manual×PIMS)                                   Task C
src/lib/seed.ts (carregar seed no repo)                                                                       Task C
src/pages/FazendaNova.tsx, FazendaEditar.tsx, Safras.tsx, Plantio.tsx, Configuracoes.tsx, NovoMapa.tsx + components/editor/*  Task D
src/render/mapFrame.ts, legend.ts, patterns.ts, types.ts                                                      Task D
README.md                                                                                                     Task D
```

---

### Task A: Rotina de sincronização do plantio (Agrovex → plantio.json) + workflow

**Files:** Create `scripts/sincronizar-plantio.mjs`, `scripts/plantio.config.json`, `.github/workflows/plantio.yml`, `tests/sincronizar-plantio.test.ts`; Modify `package.json` (script `"plantio": "node scripts/sincronizar-plantio.mjs"`).

**Interfaces — Produces:**
```js
// scripts/sincronizar-plantio.mjs (ESM, Node ≥ 20, sem dependências)
export function normalizarCodigo(s)                       // MESMA regra da Task B (duplicada aqui de propósito: o script roda sem bundler; teste garante igualdade com src/lib/codigoTalhao.ts)
export function montarSql(nomeSafra)                       // SQL do spec com o nome escapado ('' → '''')
export function classificar({ areaPrevista, areaPlantada, plantioEncerrado })  // 'plantado' | 'plantando' | 'a_plantar'
export function safrasPadrao(hoje = new Date())            // ['%25/26','%26/27'] → nomes: todas as safras do PIMS terminadas em AA/AA do ano-safra corrente e seguinte (set→ago)
export async function sincronizar({ url, token, safras, fetchImpl = fetch, agora = new Date() })
  // 1) POST initialize (protocolVersion 2025-06-18) + notifications/initialized; guarda Mcp-Session-Id; User-Agent 'mapa-chuva-coa/1.0'
  // 2) tools/call execute_query {sql: montarSql(safra), source:'sqlserver', database:'PIMSMCPRD', schema:'dbo', full:true, original_question:'status de plantio por talhão <safra>'}
  //    resposta text/event-stream: pega a última linha 'data:' → JSON → result.content[0].text → JSON com columns/rows; status !== 'success' → Error com a mensagem
  // 3) monta { versao: 1, geradoEm: ISO, fonte: 'PIMS via Agrovex', safras: [{ nome, unidades: [{ unidade, talhoes: [{ codigo (normalizado), codigoPims (bruto), setor, status, areaPrevista, areaPlantada, inicio, fim, variedade }] }] }] }
  //    ordenado por unidade e código; unidades e safras em ordem alfabética
  // 4) devolve o objeto; o main grava public/dados/plantio.json (JSON com 1 espaço) e imprime resumo por unidade/status
```
`plantio.config.json`: `{ "safras": "auto" | ["SOJA 26/27", ...], "url": "https://mcp.agrovex.com.br/mcp" }`.
Safras `auto`: primeiro consulta `SELECT DE_PER_SAFRA FROM PIMSMCPRD.dbo.PERIODOSAFRA` e filtra por `safrasPadrao()`.
Workflow `plantio.yml`: `on: schedule: - cron: '0 * * * *'`, `workflow_dispatch`; `permissions: contents: write`; passos: checkout, setup-node 24, `npm ci`, `npm run plantio` com `AGROVEX_TOKEN: ${{ secrets.AGROVEX_TOKEN }}`, `git diff --quiet public/dados/plantio.json || (git config user.name 'plantio-bot' && git config user.email 'plantio-bot@users.noreply.github.com' && git add public/dados/plantio.json && git commit -m 'chore: plantio PIMS $(date -u +%Y-%m-%dT%H:%MZ)' && git push)`. O push dispara o deploy existente (`deploy.yml` roda em push na master). Sem o secret, o job termina com aviso e sem erro.
Testes: `normalizarCodigo` (casos do Global Constraints); `classificar` (3 casos + limites 0,99); `montarSql` escapa aspas; `sincronizar` com `fetchImpl` falso que devolve initialize (com header `mcp-session-id`) e uma resposta SSE com 3 linhas (uma por status) → JSON esperado; erro de status → lança com mensagem em português. Rodar de verdade uma vez com `AGROVEX_TOKEN` (o coordenador fornece pelo ambiente) e commitar o `plantio.json` gerado.

### Task B: Normalização de código + geração do seed

**Files:** Create `src/lib/codigoTalhao.ts`, `scripts/gerar-seed.mjs`, `tests/codigoTalhao.test.ts`, `tests/gerar-seed.test.ts`, `public/dados/seed/**`; Modify `package.json` (`"seed": "node scripts/gerar-seed.mjs"`).

**Interfaces — Produces:**
```ts
// src/lib/codigoTalhao.ts
export function normalizarCodigo(s: string | null | undefined): string   // '' quando vazio
export function sugerirColunaCodigo(colunas: string[]): string | null      // ordem: COD, CODIGO, TH CODE, THCODE, TALHAO, TALHÕES, CD_UPNIVEL3, NOME; senão null
```
`gerar-seed.mjs` (usa `shpjs` do node_modules e `@turf/area`): lê `dados-fonte/base/*.zip` e `dados-fonte/soja-26-27/*.zip`, reprojeta para WGS84 (shpjs faz pelo .prj; para DOURADO usar a pasta `WGS 84/`), escreve:
- `public/dados/seed/base/<UNIDADE>.geojson`: FeatureCollection com properties `{ codigo (normalizado), codigoBruto, nome (= codigo bruto, ou 'Talhão N' se vazio), setor }`; feições com o mesmo código viram um MultiPolygon (guarda `codigoBruto` da primeira). SIRIEMA = `SIRIEMA.zip` (setor 'SIRIEMA') + `SIRIEMA_SAO_MIGUEL.zip` (setor 'SÃO MIGUEL').
- `public/dados/seed/soja-26-27/<UNIDADE>.geojson`: properties `{ codigo, codigoBruto }`, mesma união por código; coluna de código = `TALHAO` (Siriema, Dourado, SM3, Nebraska), `TALHÃO` (Globo), a única coluna de texto do Guapirama (inspecionar; se não houver código utilizável, gerar o arquivo com `codigo: ''` e registrar no relatório).
- `public/dados/seed/seed.json`: `{ versao: 1, geradoEm, fazendas: [{ nome ('Dourado','Globo','Guapirama','Nebraska','Siriema','SM3','Três Flechas'), unidadePims ('DOURADO','GLOBO','GUAPIRAMA','NEBRASKA','SIRIEMA','SM3','TRES FLECHAS'), campoNome: 'nome', campoCodigo: 'codigo', campoSetor: 'setor' | null, arquivoBase: 'base/<U>.geojson' }], safras: [{ nome: 'SOJA 26/27', nomePims: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-08-31', areasCultura: [{ unidadePims, arquivo: 'soja-26-27/<U>.geojson' }] }] }`.
- Coordenadas com 7 casas; `areaHa` calculada no app (não no seed). Imprime resumo (feições, códigos vazios, duplicados unidos, sem .prj).
Testes: `normalizarCodigo` com os casos do Global Constraints + `sugerirColunaCodigo`; `gerar-seed`: teste de integração `skipIf(!existsSync('dados-fonte'))` que roda a geração num diretório temporário e confere: 7 fazendas, Siriema com 2 setores e 30 feições, Três Flechas com `039B`/`009A`, Guapirama sem duplicados `053`/`072` (unidos em MultiPolygon), soja Globo com `02PIVO`..`05PIVO`; e um teste unitário da função de união por código com um FeatureCollection sintético.

### Task C: Modelo de dados, repositórios, leitura do plantio e do seed

**Files:** Modify `src/lib/types.ts`, `src/data/repo.ts`, `src/data/localRepo.ts`, `src/data/supabaseRepo.ts` (+ `supabaseLinhas.ts`), `supabase/migrations/0001_init.sql` (não) → Create `supabase/migrations/0002_plantio_pims.sql`; Create `src/lib/plantioPims.ts`, `src/lib/seed.ts`; tests `tests/plantioPims.test.ts`, `tests/seed.test.ts`, atualizar `tests/localRepo.test.ts`, `tests/supabaseRepo*.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts (acréscimos)
Fazenda + { unidadePims: string | null; campoCodigo: string | null }
Talhao  + { codigo: string | null }                     // normalizado
Safra   + { nomePims: string | null }
export interface AreaCultura { id: string; safraId: string; fazendaId: string; codigo: string; areaHa: number; geom: Geometry }
export type StatusPlantio = 'plantado' | 'plantando' | 'a_plantar';
Plantio + { origem: 'manual' | 'pims'; status: StatusPlantio; areaPrevista: number | null; areaPlantada: number | null; inicio: string | null; fim: string | null; variedade: string | null }
   // compatibilidade: plantio antigo = { origem:'manual', status:'plantado', ... null }; dataPlantio mantido
export interface PlantioPimsArquivo { versao: 1; geradoEm: string; fonte: string; safras: { nome: string; unidades: { unidade: string; talhoes: PlantioPimsTalhao[] }[] }[] }
export interface PlantioPimsTalhao { codigo: string; codigoPims: string; setor: string | null; status: StatusPlantio; areaPrevista: number; areaPlantada: number; inicio: string | null; fim: string | null; variedade: string | null }
// repo.ts (acréscimos)
listarAreasCultura(safraId: string, fazendaId: string): Promise<AreaCultura[]>
salvarAreasCultura(safraId: string, fazendaId: string, areas: AreaCultura[]): Promise<void>   // substitui as da safra×fazenda
// exportarBackup/importarBackup incluem areasCultura e os novos campos
// plantioPims.ts
export async function carregarPlantioPims(fetchImpl = fetch): Promise<PlantioPimsArquivo | null>   // GET './dados/plantio.json' (cache: 'no-cache'); 404/erro → null
export function casarPlantio(arq: PlantioPimsArquivo, safra: Safra, fazenda: Fazenda, talhoes: Talhao[], areas: AreaCultura[]): { porCodigo: Map<string, PlantioPimsTalhao>; semPoligono: PlantioPimsTalhao[]; geradoEm: string } | null
   // safra: arq.safras.find(nome === (safra.nomePims ?? safra.nome)); unidade: fazenda.unidadePims; códigos existentes = talhoes ∪ areas
export function combinarPlantios(pims: Map<string, PlantioPimsTalhao> | null, manuais: Plantio[], talhoes: Talhao[]): Plantio[]
   // regra: PIMS prevalece; plantio manual permanece só para talhões sem registro no PIMS (origem 'manual')
// seed.ts
export async function carregarSeed(repo: Repositorio, fetchImpl = fetch): Promise<{ fazendas: number; talhoes: number; areas: number }>   // lê ./dados/seed/seed.json e os GeoJSON; upsert por nome de fazenda / nome de safra (ids determinísticos: uuid v5-like via hash simples do nome, para reimportar sem duplicar)
export async function seedJaCarregado(repo): Promise<boolean>   // existe fazenda com unidadePims
```
SQL 0002: `alter table fazendas add column if not exists unidade_pims text, add column if not exists campo_codigo text; alter table talhoes add column if not exists codigo text; alter table safras add column if not exists nome_pims text; alter table plantios add column ... (origem text default 'manual', status text default 'plantado', area_prevista numeric, area_plantada numeric, inicio date, fim date, variedade text); create table if not exists areas_cultura (...) com RLS/grants iguais às demais`.
Testes: mapeadores de linha (camel↔snake) novos campos; localRepo áreas da cultura (substituição por safra×fazenda, cascata ao excluir safra/fazenda); `casarPlantio` (normalização, unidade errada → null, semPoligono); `combinarPlantios`; `carregarSeed` com fetch falso e fake-indexeddb (idempotente: rodar 2× não duplica).

### Task D: Telas, render e README

**Files:** Modify `src/pages/FazendaNova.tsx`, `FazendaEditar.tsx`, `Safras.tsx`, `Plantio.tsx`, `Configuracoes.tsx`, `NovoMapa.tsx`, `src/components/editor/{hooks.ts,TabelaTalhoes.tsx,SecaoFazenda.tsx}`, `src/components/MapaLeaflet.tsx`, `src/render/{types.ts,mapFrame.ts,legend.ts,patterns.ts}`, `src/App.tsx` (seed no primeiro uso), `README.md`; Create `src/components/editor/SecaoPlantioPims.tsx`, `src/pages/AreasCultura.tsx` (rota `/safras/:safraId/areas/:fazendaId`).

- Cadastro/edição de fazenda: seletor "Coluna do código PIMS" (sugestão via `sugerirColunaCodigo`) e "Unidade no PIMS" (lista das unidades do `plantio.json`, com opção "outra…"). Ao salvar, `talhao.codigo = normalizarCodigo(props[campoCodigo])`; feições com o mesmo código unidas (usar a mesma função de união da Task B — exportar de `src/lib/codigoTalhao.ts` como `unirPorCodigo(feicoes, campo)`).
- Safras: campo "Nome no PIMS" (padrão = nome); botão por fazenda "Áreas da cultura" → página `AreasCultura`: upload do shape da cultura, escolha da coluna do código, prévia no mapa (áreas em laranja sobre o limite base), salvar (`salvarAreasCultura`).
- Plantio: cabeçalho "Plantio do PIMS de dd/MM/yyyy HH:mm" quando houver `plantio.json`; lista com situação (chip colorido), % plantado, datas, variedade; marcação manual continua para talhões sem PIMS; aviso listando talhões do PIMS sem polígono.
- Novo mapa: `RenderInput.plantados` vira `situacoes: Map<string, StatusPlantio>` (id do talhão OU id da área da cultura → status) e `areasCultura: AreaCultura[]`; hooks carregam áreas + plantio PIMS; `SecaoFazenda` mostra "X plantados · Y plantando · Z a plantar (PIMS dd/MM HH:mm)"; `TabelaTalhoes` ganha colunas Situação e % plantado; estatística "área plantada" = plantado + plantando.
- Render: pintar as **áreas da cultura** (se existirem para a safra×fazenda) em vez dos talhões base: plantado = padrão escolhido + contorno `#DB8A08` 0,7 mm; plantando = hachura diagonal amarela `#F2C200` + contorno `#F2C200`; a_plantar = contorno tracejado `#555` 0,45 mm sem preenchimento. Legenda: "Plantado – SOJA 26/27", "Plantando", "A plantar" (só as presentes) e linha pequena "Plantio: PIMS dd/MM/yyyy HH:mm". Sem áreas da cultura, comportamento atual (talhões base plantados).
- App: no modo local, na primeira abertura (`!await seedJaCarregado()` e nenhuma fazenda), chama `carregarSeed` e mostra aviso "Cadastro padrão do COA carregado (7 unidades, safra SOJA 26/27)". Configurações: botão "Recarregar cadastro padrão" (confirma).
- README: seção "Plantio automático do PIMS" (secret `AGROVEX_TOKEN`, workflow, `npm run plantio`), "Cadastro padrão".
- Verificar no navegador com o seed real: Siriema → mapa com plantado/plantando/a plantar e PNG.

### Task E: Verificação ponta a ponta (coordenador)
- `npm test`, `tsc`, `build`; abrir o app zerado → seed carregado → Novo mapa Siriema com CSV real → PNG com as três situações; conferir Três Flechas (sem área de soja) e Guapirama (código vazio).
