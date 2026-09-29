# Módulo MAPAS no COA WEB — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Mapa de Chuva vira a subcategoria "Mapa de Chuva" da nova categoria MAPAS do COA WEB, usando o login, os perfis, a permissão por fazenda e o Supabase do COA WEB.

**Architecture:** O código do módulo fica em `modulos/mapas/` (Vite + React), o build estático em `mapas/` (commitado; Vercel e Pages servem sem build). O `index.html` do COA WEB ganha a categoria MAPAS, que mostra o módulo num `iframe` da mesma origem (`mapas/index.html?embed=1#/<rota>`), com sessão compartilhada e mensagens `postMessage`. Os dados vão para tabelas novas `mapas_*` no Supabase do COA WEB, com RLS pelas regras de perfil/fazenda do COA WEB.

**Tech Stack:** o existente (Vite 8, React 19, TS 7, Vitest, supabase-js 2). Dependência nova: `fflate` (zip do cadastro padrão). COA WEB: HTML/JS puro.

**Spec:** `modulos/mapas/docs/superpowers/specs/2026-09-28-modulo-mapas-coa-web-design.md` (leia antes de qualquer task).

## Global Constraints

- Repositório: `C:\Users\bruno.moraes\Documents\CLAUDE GERAL\coa-web`, branch `modulo-mapas`. Nunca `git push`, nunca mexer em `main`.
- Comandos do módulo rodam em `modulos/mapas`: `npx vitest run`, `npx tsc --noEmit -p .`. Linha de base: 516 testes passando.
- O repositório é **público**: nada de dados da Locks no git (seed, plantio.json, dados-teste, dados-fonte, zips) e nenhuma chave além da anon do COA WEB (que já é pública no `index.html`). Nunca escreva/imprima `service_role`, `AGROVEX_TOKEN` ou senhas.
- Supabase do COA WEB: URL `https://pkaxbitsqxjxjlwnhjhd.supabase.co`; a chave anon está em `index.html` (constante `SUPABASE_ANON_KEY`).
- Tabelas do COA WEB são **somente leitura** para este trabalho: `fazendas (id integer, nome)`, `perfis (id uuid, nome, email, perfil 'admin'|'colaborador')`, `usuario_fazendas (usuario_id uuid, fazenda_id integer)`. Nada de alterar tabelas, regras ou funções existentes.
- Objetos novos no banco: prefixo `mapas_`; bucket `mapas-chuva`.
- Nomes de tabela do módulo: `fazendas→mapas_fazendas`, `talhoes→mapas_talhoes`, `safras→mapas_safras`, `plantios→mapas_plantios`, `areas_cultura→mapas_areas_cultura`, `mapas→mapas_chuva`, novo `mapas_plantio_pims`.
- Mensagens entre COA WEB e módulo: `{ tipo: 'coa-fazenda', id: number | null, nome: string | null }` (COA → módulo) e `{ tipo: 'mapas-rota', rota: string, titulo: string }` (módulo → COA); sempre `targetOrigin = location.origin` e checagem `event.origin === location.origin`.
- Textos de interface em português; tipos compartilhados só em `src/lib/types.ts`; arquivos < ~400 linhas; LF nos arquivos do módulo (o `index.html` da raiz é CRLF — preserve).
- Subagentes não fazem commit (o controlador commita).

## Mapa de arquivos

```
modulos/mapas/supabase/coa-web/0001_mapas.sql            Task 1 (novo)
modulos/mapas/supabase/coa-web/verificar-permissoes.sql  Task 1 (novo, só leitura)
modulos/mapas/supabase/migrations/                       Task 1 (removida: era do site avulso)
src/lib/types.ts, src/data/{repo,supabaseRepo,supabaseLinhas,localRepo,config}.ts,
src/lib/plantioPims.ts, src/components/usePlantioPims.ts, src/lib/exportar.ts,
src/pages/NovoMapa.tsx, src/pages/Mapas.tsx              Task 2
src/lib/embed.ts (novo), src/App.tsx, src/components/Shell.tsx, src/data/{config,auth}.ts,
src/pages/NovoMapa.tsx, vite.config.ts, package.json, .env.coa-web (novo),
scripts/verificar-publicacao.mjs (novo), .gitignore       Task 3
src/lib/seed.ts, src/pages/Fazendas.tsx, src/pages/FazendaEditar.tsx,
scripts/pacote-seed.mjs (novo), package.json             Task 4
scripts/sincronizar-plantio.mjs (+ .d.mts), ../../.github/workflows/plantio-pims.yml (novo) Task 5
../../index.html, ../../.nojekyll (novo), ../../mapas/ (build)   Task 6
README.md, docs/decisoes.md                              Tasks 3–6 (seções respectivas)
```

---

### Task 1: Script do banco (Supabase do COA WEB)

**Files:** Create `supabase/coa-web/0001_mapas.sql`, `supabase/coa-web/verificar-permissoes.sql`; Delete `supabase/migrations/` (0001_init.sql e 0002_plantio_pims.sql — use-as como fonte das colunas antes de apagar).

**Produces:** as tabelas/funções que as Tasks 2, 4 e 5 usam.

- `0001_mapas.sql`, dentro de `begin; … commit;`, idempotente (`create table if not exists`, `add column if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` + `create policy`, bucket com `on conflict (id) do nothing`). Cabeçalho explicando: rodar no SQL Editor do Supabase do COA WEB; só cria objetos `mapas_*`; não mexe no que existe.
- Tabelas com **exatamente** as colunas das antigas 0001+0002 (já com as colunas da 0002 incluídas, defaults e checks de `origem`/`status`), renomeadas; FKs entre as tabelas novas; `mapas_chuva` = antiga `mapas` (mantém `criado_por uuid default auth.uid()`). Extras:
  - `mapas_fazendas.coa_fazenda_id integer references public.fazendas(id) on delete set null` + índice.
  - `mapas_plantio_pims (safra text not null, unidade text not null, gerado_em timestamptz not null, talhoes jsonb not null default '[]', primary key (safra, unidade))`.
- Índices equivalentes aos antigos, com nomes `mapas_*`.
- Funções (`language sql stable security definer set search_path = public`), com `grant execute … to authenticated` e `revoke … from anon, public`:
  - `mapas_tem_perfil()` → existe `perfis` com `id = auth.uid()`.
  - `mapas_eh_admin()` → existe `perfis` com `id = auth.uid() and perfil = 'admin'`.
  - `mapas_pode_ver(p_coa_fazenda_id integer)` → `mapas_eh_admin() or (p_coa_fazenda_id is not null and exists usuario_fazendas(usuario_id = auth.uid(), fazenda_id = p_coa_fazenda_id))`.
  - `mapas_pode_ver_fazenda(p_fazenda_id uuid)` → `mapas_pode_ver((select coa_fazenda_id from mapas_fazendas where id = p_fazenda_id))`; fazenda inexistente → só admin.
- RLS ligado em todas; `revoke all … from anon`; `grant select, insert, update, delete … to authenticated` (em `mapas_plantio_pims` só `select`). Regras (uma por comando, nomes `mapas_<tabela>_<cmd>`):
  - `mapas_fazendas`: select `mapas_pode_ver(coa_fazenda_id)`; insert/update/delete `mapas_eh_admin()`.
  - `mapas_talhoes`, `mapas_areas_cultura`: select `mapas_pode_ver_fazenda(fazenda_id)`; escrita `mapas_eh_admin()`.
  - `mapas_plantios`: select se o talhão (`mapas_talhoes.id = talhao_id`) é de fazenda visível; escrita `mapas_eh_admin()`.
  - `mapas_safras`: select `mapas_tem_perfil()`; escrita `mapas_eh_admin()`.
  - `mapas_chuva`: select/insert/update/delete `mapas_pode_ver_fazenda(fazenda_id)` (insert/update no `with check`).
  - `mapas_plantio_pims`: select `mapas_eh_admin() or exists (mapas_fazendas f where upper(f.unidade_pims) = upper(unidade) and mapas_pode_ver(f.coa_fazenda_id))`; **nenhuma** regra de escrita (só a chave de serviço grava).
  - `storage.objects` (bucket privado `mapas-chuva`, regras `mapas_chuva_storage_<cmd>` que só valem com `bucket_id = 'mapas-chuva'`): select/update/delete se existe `mapas_chuva m` com `name in (m.png_path, m.thumb_path)` e `mapas_pode_ver_fazenda(m.fazenda_id)`, **ou** se nenhum `mapas_chuva` referencia o arquivo e `mapas_tem_perfil()` (arquivo órfão de um salvamento que falhou / upload antes da linha); insert `mapas_tem_perfil()`.
- `verificar-permissoes.sql` (só `select`): regras de `pg_policies` para `perfis`, `usuario_fazendas`, `fazendas`; `relrowsecurity` dessas tabelas; gatilhos não internos em `auth.users` com `pg_get_triggerdef`; corpo das funções chamadas por esses gatilhos. Comentário no topo: "não altera nada".
- Verificação: não há Postgres local — revise o SQL linha a linha contra as colunas usadas em `src/data/supabaseLinhas.ts` e `supabaseRepo.ts` (liste no relatório cada tabela × colunas × onde o código usa). Rode `npx vitest run` (nada deve quebrar).

### Task 2: Camada de dados no Supabase do COA WEB

**Files:** Modify `src/lib/types.ts`, `src/data/repo.ts`, `src/data/supabaseLinhas.ts`, `src/data/supabaseRepo.ts`, `src/data/localRepo.ts`, `src/data/config.ts` (`testarConexao` usa `mapas_safras`), `src/lib/plantioPims.ts`, `src/components/usePlantioPims.ts`, `src/lib/exportar.ts`, `src/pages/NovoMapa.tsx`, `src/pages/Mapas.tsx`, testes em `tests/`.

**Interfaces (Produces):**
```ts
// types.ts
interface Fazenda { /* …existente… */ coaFazendaId: number | null } // null = sem vínculo (no Supabase: só admin vê)
type PerfilUsuario = 'admin' | 'colaborador';
interface FazendaCoa { id: number; nome: string }
interface LinhaPlantioPims { safra: string; unidade: string; geradoEm: string; talhoes: PlantioPimsTalhao[] }
// repo.ts (Repositorio)
perfil(): Promise<PerfilUsuario | null>;          // local → 'admin'; supabase → perfis.perfil de auth.uid(); sem sessão/sem linha → null; valor desconhecido → 'colaborador'
listarFazendasCoa(): Promise<FazendaCoa[]>;       // local → []; supabase → from('fazendas').select('id, nome').order('nome')
lerPlantioPims(): Promise<PlantioPimsArquivo | null>; // local → carregarPlantioPims() (JSON); supabase → linhas de mapas_plantio_pims (paginado) → montarPlantioPims
// plantioPims.ts
export function montarPlantioPims(linhas: LinhaPlantioPims[]): PlantioPimsArquivo | null
// vazio → null; versao 1; geradoEm = maior geradoEm (ISO); fonte 'PIMS via Agrovex';
// safras agrupadas por nome (ordem alfabética), unidades em ordem alfabética; talhões inválidos descartados com a mesma validação de pareceTalhao
```
- Uma constante `TABELAS` (em `supabaseLinhas.ts`) com os nomes do Global Constraints; nenhum literal de tabela antigo sobra em `src/` (verifique com grep). Bucket `mapas-chuva`.
- `coa_fazenda_id` ↔ `coaFazendaId` nas linhas; registros antigos (IndexedDB/backup) sem o campo → `null`; backup exporta/importa o campo.
- `usePlantioPims.lerPlantioPims()` passa a chamar `repo().lerPlantioPims()` (mantém o cache de 5 min).
- Histórico em JPEG: a cópia salva do mapa é JPEG qualidade 0,9 no dpi de histórico (150), gerada do mesmo desenho; caminhos no storage `<id>.jpg` e `<id>-thumb.png` (a miniatura continua PNG); `contentType` pelo tipo do blob. Mapas antigos com `.png` continuam abrindo. O download pelo editor continua PNG com pHYs no dpi escolhido. Onde o app baixa a cópia do histórico (tela Mapas), a extensão do arquivo segue o tipo do blob.
- Testes: `montarPlantioPims` (agrupamento, ordem, maior data, vazio, inválidos); `supabaseRepo` com cliente simulado registrando `from(nome)`/`storage.from(nome)` (todos os nomes novos, `perfil()` com as 4 situações, `listarFazendasCoa`); linhas ↔ objetos com `coaFazendaId`; localRepo lendo fazenda antiga sem o campo.

### Task 3: Modo embutido, perfil e publicação

**Files:** Create `src/lib/embed.ts`, `.env.coa-web`, `scripts/verificar-publicacao.mjs`, `tests/embed.test.ts`; Modify `src/data/config.ts`, `src/data/auth.ts`, `src/App.tsx`, `src/components/Shell.tsx`, `src/pages/NovoMapa.tsx` (e o que for preciso para esconder ações de admin), `vite.config.ts`, `package.json`, `.gitignore`, `index.html` (título "Mapas · COA WEB"), `README.md`.

**Interfaces (Produces):**
```ts
// embed.ts
export function emEmbed(loc?: Pick<Location, 'search'>): boolean;          // ?embed=1
export function avisarRota(rota: string): void;                             // posta { tipo:'mapas-rota', rota, titulo: tituloDaRota(rota) } ao pai (só em embed e se parent !== window)
export function tituloDaRota(rota: string): string;                         // '/mapas/novo'→'Novo mapa de chuva', '/mapas'→'Mapas salvos', '/mapas/<id>'→'Mapa salvo', '/fazendas…'→'Fazendas e shapes', '/safras…'→'Safras e plantio', outras→'Mapas'
export function ouvirFazendaCoa(cb: (f: { id: number | null; nome: string | null }) => void): () => void; // valida origem e formato
export function useFazendaCoa(): { id: number | null; nome: string | null } | null; // último valor recebido (módulo guarda o último mesmo antes de a tela montar)
// hook de perfil (ex.: src/components/usePerfil.ts): usePerfil(): PerfilUsuario | null | undefined (undefined = carregando)
```
- **Modo fixo**: `VITE_MODO_FIXO=supabase` → `lerConfig()` ignora o localStorage e usa as variáveis do build. `.env.coa-web` (commitado; ajuste o `.gitignore` do módulo com `!.env.coa-web`) contém `VITE_MODO_FIXO=supabase`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do COA WEB (copie a anon de `../../index.html`). Sem `VITE_MODO_FIXO` tudo funciona como hoje (dev e testes em modo local).
- `auth.ts`: em embed, `createClient(url, key, { auth: { autoRefreshToken: false } })` — quem renova o token é o COA WEB (mesma chave de sessão; o supabase-js coordena por `navigator.locks`); fora de embed, como hoje.
- `App.tsx` no modo fixo: `/login` vira a tela "Entre pelo COA WEB" (texto curto + link `../index.html` com `target="_top"`); `/config` redireciona para `/mapas`; seed automático não roda; a cada mudança de rota chama `avisarRota(pathname)`. Colaborador (perfil) que abre `/fazendas…` ou `/safras…` volta para `/mapas` com aviso "Somente administradores".
- `Shell.tsx`: em embed não desenha cabeçalho/navegação (só o conteúdo, com o respiro da área de conteúdo do COA WEB e fundo `#EEF2EE`); fora de embed no modo fixo, cabeçalho atual com link "← COA WEB" (`../index.html`) e sem os itens de cadastro para colaborador; sem botão "Sair" no modo fixo (a sessão é do COA WEB).
- Colaborador não vê botões de editar/excluir cadastros onde eles aparecem fora das telas de cadastro (ex.: links para Fazendas/Safras dentro do editor) — o RLS garante o resto.
- `NovoMapa`: quando `useFazendaCoa()` traz um `id` e o editor ainda está "limpo" (nenhum CSV carregado e nenhuma fazenda escolhida à mão), seleciona a primeira fazenda de mapa com `coaFazendaId === id`; sem correspondente, não faz nada.
- Publicação: `vite build --mode coa-web` grava em `../../mapas` (`emptyOutDir: true`) e **não** leva `public/dados/` (plugin de build que remove `dados/` da saída no modo `coa-web`). Script `"publicar": "vitest run && tsc --noEmit -p . && vite build --mode coa-web && node scripts/verificar-publicacao.mjs"`. `verificar-publicacao.mjs` falha se `../../mapas/index.html` não existe, se existe `../../mapas/dados`, ou se algum arquivo da saída contém `service_role`.
- Testes (`tests/embed.test.ts`): `emEmbed`, `tituloDaRota`, `ouvirFazendaCoa` ignora outra origem e formato inválido, `avisarRota` não posta fora de embed; `lerConfig` no modo fixo ignora o localStorage.
- README: seção "Módulo MAPAS no COA WEB" (como rodar em dev, `npm run publicar`, o que é o modo embutido).

### Task 4: Importar o cadastro padrão e ligar às fazendas do COA WEB

**Files:** Modify `src/lib/seed.ts`, `src/pages/Fazendas.tsx`, `src/pages/FazendaEditar.tsx` (e componentes que usar), `package.json` (+ `fflate`); Create `scripts/pacote-seed.mjs`, testes.

**Interfaces (Produces):**
```ts
// seed.ts
export type LeitorSeed = (caminho: string) => Promise<string>;   // caminho relativo à pasta do seed, ex.: 'seed.json', 'base/SM3.geojson'
export function leitorHttp(pasta?: string): LeitorSeed;           // o comportamento atual (fetch de ./dados/seed/ com tempo limite)
export async function leitorDeZip(arquivo: Blob): Promise<LeitorSeed>; // fflate.unzipSync; aceita o zip com os arquivos na raiz ou dentro de uma pasta única
export function nomeComparavel(s: string): string;                // sem acento, maiúsculas, espaços simples, sem pontas
export async function carregarSeed(r: Repositorio, ler?: LeitorSeed): Promise<ResultadoSeed>; // ResultadoSeed ganha: ligadas: number; semVinculo: string[] (nomes)
```
- `carregarSeed` liga cada fazenda à do COA WEB (`r.listarFazendasCoa()`) por `nomeComparavel` (`Três Flechas` ↔ `Tres Flechas`), **sem apagar** um `coaFazendaId` que já exista (recarregar não desfaz o ajuste manual). Modo local: lista vazia → tudo sem vínculo, sem erro.
- `Fazendas.tsx` (admin, modo Supabase): botão "Importar cadastro padrão" → escolher `.zip` → andamento → aviso com o resultado ("7 unidades importadas, 7 ligadas ao COA WEB" / lista das sem vínculo). No modo local o botão também funciona (útil para testes).
- `FazendaEditar.tsx`: campo "Fazenda no COA WEB" (select com as `listarFazendasCoa()` + "Sem vínculo — só administradores veem"), gravado com a fazenda; escondido quando a lista vier vazia.
- `scripts/pacote-seed.mjs` + npm `"pacote-seed"`: compacta `public/dados/seed/` em `cadastro-padrao-mapas.zip` na raiz do módulo (fora do git pelo `*.zip`).
- Testes: `leitorDeZip` (zip montado no teste com `fflate.zipSync`, raiz e pasta única), `nomeComparavel`, ligação por nome e preservação do vínculo existente (repo local com `listarFazendasCoa` simulado).

### Task 5: Rotina do plantio grava no Supabase

**Files:** Modify `scripts/sincronizar-plantio.mjs`, `scripts/sincronizar-plantio.d.mts`, `tests/sincronizar-plantio.test.ts`, `README.md`; Create `../../.github/workflows/plantio-pims.yml`.

**Interfaces (Produces):**
```js
export function linhasSupabase(arquivo) // PlantioPimsArquivo → [{ safra, unidade, gerado_em, talhoes }] (uma por safra × unidade, só unidades com talhões)
export async function gravarSupabase(arquivo, { url, chave, fetch }) // upsert + limpeza
```
- Com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente: `POST {url}/rest/v1/mapas_plantio_pims?on_conflict=safra,unidade` (cabeçalhos `apikey`, `Authorization: Bearer`, `Content-Type: application/json`, `Prefer: resolution=merge-duplicates,return=minimal`); depois do sucesso, `DELETE {url}/rest/v1/mapas_plantio_pims?gerado_em=lt.<geradoEm>` (linhas que sumiram do PIMS). Resposta não-2xx → erro com status e corpo (nunca a chave). Sem as variáveis → grava o JSON local como hoje.
- Workflow na raiz do coa-web: `schedule: cron '17 * * * *'` + `workflow_dispatch`; `permissions: contents: read`; checkout com `persist-credentials: false`; `actions/setup-node` 22; roda `node modulos/mapas/scripts/sincronizar-plantio.mjs` com `AGROVEX_TOKEN: ${{ secrets.AGROVEX_TOKEN }}`, `SUPABASE_URL: https://pkaxbitsqxjxjlwnhjhd.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`; sem `npm ci`, sem commit. Falta de secret → passo falha com mensagem clara.
- Testes com `fetch` simulado: `linhasSupabase`; `gravarSupabase` (URL, cabeçalhos, corpo, ordem upsert→delete, erro não vaza a chave).
- README: seção do plantio automático reescrita (secrets `AGROVEX_TOKEN` e `SUPABASE_SERVICE_ROLE_KEY` no coa-web; onde achar a chave de serviço no Supabase).

### Task 6: Categoria MAPAS no COA WEB

**Files:** Modify `../../index.html`; Create `../../.nojekyll` (vazio); gerar `../../mapas/` com `npm run publicar`.

- Tela de categorias: cartão `#card-mapas` "Mapas" (ícone de mapa em SVG no mesmo estilo), visível para todos com perfil.
- `entrarMapas()` no padrão das outras `entrar…`; todas as `entrar…` passam a esconder/mostrar também `#nav-mapas`; `categoriaAtual = 'mapas'`.
- Menu `#nav-mapas`: eyebrow "Mapa de Chuva" → "Novo mapa" (`/mapas/novo`), "Mapas salvos" (`/mapas`); eyebrow "Cadastros" → "Fazendas e shapes" (`/fazendas`), "Safras e plantio" (`/safras`) com `admin-only`. Botões `class="nav-btn"` + `data-page="mapas"` + `data-rota`; o destaque (`active`) fica só no botão da rota atual (ajuste depois do `irPara`, sem quebrar os outros menus).
- `section.page[data-page="mapas"]` com `<iframe id="mapas-frame" title="Mapas">` ocupando toda a área de conteúdo (sem borda, altura = viewport menos o topo), criado/`src` definido só na primeira entrada: `mapas/index.html?embed=1#<rota>`; depois, trocar de botão só muda `location.hash` do iframe.
- `titulos['mapas']` e atualização do topo pela mensagem `mapas-rota`; o botão ativo segue a rota recebida (prefixo).
- Fazenda do topo (`#sb-fazenda`): ao entrar em MAPAS, no `load` do iframe e a cada mudança → `postMessage({ tipo: 'coa-fazenda', id, nome }, location.origin)`.
- `sair()`: descarrega o iframe (`src = 'about:blank'` e marca para recriar na próxima entrada).
- Mensagens recebidas só com `event.origin === location.origin` e `event.source === iframe.contentWindow`.
- `.nojekyll` vazio na raiz.
- Verificação no navegador: servir a raiz do coa-web localmente (servidor estático simples em Node), abrir o `index.html`, conferir que a tela de login e as categorias antigas continuam iguais e que o cartão Mapas aparece; o teste com login real é feito com o usuário (ele digita a senha).
