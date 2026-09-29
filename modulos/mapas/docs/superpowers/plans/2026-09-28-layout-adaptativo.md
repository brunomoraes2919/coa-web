# Layout adaptativo e redesign — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orientação e número de quadros escolhidos pela forma da fazenda, rótulos proporcionais e um layout mais profissional na identidade do COA, sem mudar interpolação nem exportação.

**Architecture:** Uma camada pura `src/render/composicao.ts` decide a composição (orientação, quadros, retângulos em mm) a partir dos talhões; `layout.ts` passa a desenhar N quadros e o painel na posição decidida; os componentes visuais (painel, legenda, escala, rosa) são reescritos com o novo desenho. `LayoutConfig` ganha `orientacao` e `quadros`.

**Tech Stack:** o existente. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-28-layout-adaptativo-design.md` (+ os dois specs anteriores).

## Global Constraints

- Prévia = exportação (mesmo `renderLayout`); A3 base, A4 = ×(297/420); PNG 150/300/600 dpi com pHYs.
- Cores: verde `#0C5A50`, laranja `#DB8A08`, cinza texto `#5D6D69`, separador `#DBE2E0`.
- Retrato: página 297×420 mm; moldura 6 mm; faixa do painel inferior 68 mm. Paisagem: 420×297; painel lateral 71,4 mm.
- Regras numéricas do spec: orientação retrato se altura/largura do bbox > 1,25; quadros separados se aproveitamento ≥ 1,5× e 2–3 grupos; folga de agrupamento 8%; rótulo = clamp(2,1 × √(áreaMédiaMm²/40), 1,6, 3,2) mm.
- Tipos compartilhados só em `src/lib/types.ts`; arquivos < ~400 linhas; sem `git commit` pelos subagentes; LF.

## Mapa de arquivos

```
src/lib/types.ts                 + orientacao: 'auto'|'paisagem'|'retrato'; quadros: 'auto'|1|'setor'   (Task 1)
src/render/composicao.ts         Task 1  (puro: agrupar, aproveitamento, decidir orientação/quadros, retângulos)
tests/composicao.test.ts         Task 1
src/render/layout.ts, types.ts   Task 2  (N quadros; painel lateral ou inferior; PAGINA_MM por orientação)
src/render/painel.ts             Task 2  (novo desenho do painel: logo, título, pares rótulo/valor, rodapé)
src/render/legend.ts, scalebar.ts, northArrow.ts, mapFrame.ts   Task 2 (redesign + título do quadro + rótulos proporcionais)
src/lib/exportar.ts, src/components/editor/PreviaLayout.tsx, SecaoAparencia.tsx, src/lib/editor.ts   Task 3 (tamanho da página por orientação; seletores)
tests/render-*.test.ts           Tasks 2–3
```

---

### Task 1: Composição (pura)

**Files:** Modify `src/lib/types.ts`; Create `src/render/composicao.ts`, `tests/composicao.test.ts`.

```ts
export interface Grupo { ids: string[]; bbox: [number, number, number, number]; setor: string | null } // Mercator
export function agruparTalhoes(talhoes: Talhao[], folga = 0.08): Grupo[]   // união de bboxes que se tocam com folga × maior lado do conjunto; ordem: norte→sul, depois oeste→leste
export function aproveitamento(bboxes: [number,number,number,number][], quadros: Rect[]): number // soma das áreas dos bboxes em mm² / área da folha ocupada pelos quadros, com cada bbox ajustado ao seu quadro (margem 6%)
export interface Composicao { orientacao: 'paisagem' | 'retrato'; pagina: { w: number; h: number }; quadros: { rect: Rect; grupo: Grupo; titulo: string | null }[]; painel: Rect; painelPosicao: 'lateral' | 'inferior' }
export function compor(talhoes: Talhao[], config: Pick<LayoutConfig, 'orientacao' | 'quadros' | 'pagina'>): Composicao
```
Regras do spec. Quadros empilhados dividem a altura útil proporcionalmente à altura dos bboxes (mínimo 30% cada), separados por 4 mm. Testes: fazenda quadrada → paisagem 1 quadro; alongada vertical → retrato; dois blocos afastados → 2 quadros; dois blocos próximos → 1; `quadros: 1` força um; `quadros: 'setor'` com 2 setores → 2; título = setor quando homogêneo.

### Task 2: Render com N quadros e redesign

**Files:** Modify `src/render/layout.ts`, `types.ts`, `legend.ts`, `scalebar.ts`, `northArrow.ts`, `mapFrame.ts`; Create `src/render/painel.ts`; tests `tests/render-composicao.test.ts` (funções puras de posicionamento do painel/legenda).

- `renderLayout` chama `compor()`; para cada quadro: `extent` próprio (auto pelo bbox do grupo; o `config.extent` manual só vale quando há 1 quadro), mapa base, raster, talhões do grupo (os outros em cinza claro 30% se cortarem o quadro), rótulos proporcionais (`tamanhoRotulo(areaMediaMm2)`), PICs dentro do quadro, título do quadro no canto superior esquerdo (Open Sans 700 4,5 mm sobre fundo branco 85%), rosa 14 mm no canto superior direito, escala no inferior direito.
- `painel.ts`: `desenharPainel(ctx, comp, inp, s)` — lateral (coluna) ou inferior (faixa em 3 colunas: logo+título | informações | legenda). Pares rótulo/valor conforme spec; "Média da fazenda" e "Média na área plantada" a partir de `inp.resumo` (adicionar `resumo: ResumoChuva | null` ao `RenderInput`); "Plantio" a partir de `inp.plantioPims?.geradoEm` (adicionar campo opcional).
- Legenda redesenhada (título, amostras 6×4 mm arredondadas, situação de plantio acima); escala com "km" ≥ 1 km; rosa simplificada; grade 2,2 mm; rodapé.
- Verificação no navegador com Três Flechas (retrato) e Siriema (2 quadros) usando o seed, e Guapirama (paisagem, 1 quadro): exportar 150 dpi e conferir.

### Task 3: Editor e exportação

**Files:** Modify `src/lib/exportar.ts` (tamanho por `compor()`), `src/components/editor/PreviaLayout.tsx` (proporção da prévia pela composição; pan/zoom só com 1 quadro; senão dica "com vários quadros o enquadramento é automático"), `SecaoAparencia.tsx` (seletores Orientação e Quadros), `src/lib/editor.ts` (padrões `auto`), `src/lib/historico.ts` (miniatura pela orientação); tests `tests/editorRegras.test.ts` (padrões), `tests/pngDpi.test.ts` inalterado.
