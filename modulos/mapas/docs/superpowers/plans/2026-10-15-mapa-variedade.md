# Mapa de variedade — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subdivisão "Mapa de variedade" no módulo Mapas: mapa por fazenda e safra com cada talhão pintado na cor fixa da sua variedade (PIMS), legenda com área e %, mesmo layout e exportações do mapa de chuva, mapas salvos próprios e um cadastro de cores para o administrador.

**Architecture:** Regras puras em `src/lib/variedades.ts` (limpeza do nome, feições, cores, resumo, CSV, textos). O repositório ganha as cores (`mapas_variedade_cores`) e o tipo dos mapas salvos (`mapas_chuva.tipo`). O desenho ganha um modo variedade opcional no `RenderInput` (`variedades`): cor sólida nas feições, legenda de variedades, pares do painel e assinatura próprios; com `variedades` ausente, o mapa de chuva desenha exatamente como hoje. Uma tela nova (`NovoMapaVariedade`) reaproveita as seções do editor; "Mapas salvos" e o menu ganham o tipo.

**Tech Stack:** React 18 + TypeScript + Vite (módulo `modulos/mapas`), Vitest (`node`, canvas falso), Supabase (Postgres + RLS), IndexedDB (`idb`, modo local), casca `index.html` (JS puro).

**Spec:** `modulos/mapas/docs/superpowers/specs/2026-10-15-mapa-variedade-design.md`

## Global Constraints

- O mapa de chuva não muda de resultado: todos os testes atuais continuam passando; `RenderInput.variedades` ausente = desenho de hoje.
- Variedade: do plantio do PIMS (`efetivos`/`pims` do `useTalhoesEPlantio`); limpeza igual à do Operacional; vazio e "A DEFINIR" → "Sem variedade", cor `#B5B5B5`.
- Chave da cor: nome limpo em maiúsculas com um espaço só (sem tirar acento).
- Cores fixas: `mapas_variedade_cores`; quem usa o Mapas lê e cria (só INSERT); troca e apaga só administrador (`mapas_eh_admin()`); restritiva por categoria `mapas`.
- Mapas salvos: mesma tabela `mapas_chuva` com `tipo` ('chuva' | 'variedade', padrão 'chuva'); bucket e `mapas_pode_ver_arquivo` sem mudança; o mapa salvo guarda as cores usadas (`config.coresVariedade`).
- Rótulo do talhão: o mesmo do mapa de chuva (nome do shape); sem situação do plantio no mapa de variedade.
- Exportações: PNG 150/300/600 dpi (`gerarPng`), cópia JPEG 150 dpi + miniatura (`gerarCopiaHistorico`), CSV `;` com vírgula decimal e BOM; arquivo `MAPA_VARIEDADE_…`.
- Modo local (IndexedDB) com paridade: store `coresVariedade`, `VERSAO_DB` 3.
- `tests/migracao.test.ts` confere os scripts do banco contra o código (tabelas de `TABELAS`, colunas gravadas, RLS e `grant`): ele passa a ler também `supabase/0026_mapa_variedade.sql` (Tarefa 3).
- Textos em português do Brasil, no tom dos existentes. Repositório público: dados de teste fictícios.
- Fim de linha: índice sempre LF (`core.autocrlf=true`); conferir com `git ls-files --eol` e `git diff --stat`; nunca `sed -i`.
- A pasta `mapas/` (build) entra no commit da publicação (`npm run publicar`), como hoje.
- Commits locais no branch `mapa-variedade`; publicação só com "pode publicar"; script `0026` só com autorização.

## Review Focus

- **Mesma variedade escrita diferente** (maiúsculas/minúsculas, espaços duplicados, prefixo "SEMENTE DE SOJA", "A DEFINIR SOJA"): vira uma variedade só, ou "Sem variedade" → testes na Tarefa 2.
- **Duas pessoas gerando mapa com a mesma variedade nova ao mesmo tempo:** a segunda recebe a cor que a primeira gravou (sem erro e sem trocar a cor) → teste na Tarefa 3.
- **Safra com áreas da cultura (pedaços de pivô) e filtro de setor:** as feições pintadas e somadas são as áreas (com a variedade do PIMS pelo código e o setor do talhão base) → testes na Tarefa 2.
- **Mapa salvo reaberto depois de a cor da variedade mudar no cadastro:** mostra as cores do dia em que foi salvo → teste de `juntarCores` na Tarefa 2.
- **Mapa de chuva intacto:** a lista de chuva não mostra os de variedade e um id de variedade aberto em `/mapas/:id` vai para `/variedades/:id` → teste na Tarefa 3 e conferência na Tarefa 7.

---

### Task 1: Banco — script `0026_mapa_variedade.sql`

**Files:**
- Create: `supabase/0026_mapa_variedade.sql` (LF)

**Interfaces:**
- Produces: coluna `public.mapas_chuva.tipo text not null default 'chuva'` (check 'chuva' | 'variedade'); tabela `public.mapas_variedade_cores(variedade text pk, cor text, criado_em timestamptz, atualizado_em timestamptz, atualizado_por uuid)`. A Tarefa 3 faz `tests/migracao.test.ts` ler este arquivo: manter `create table if not exists public.<nome> (` … `\n);`, `alter table public.<t> add column if not exists <col> …` numa linha só e as linhas `alter table … enable row level security;`, `revoke all on table … from anon, authenticated;` e `grant select, insert, update, delete on table … to authenticated;` exatamente nesse formato.

- [ ] **Step 1: Escrever o script**

```sql
-- COA WEB — Mapas: "Mapa de variedade" (especificação: modulos/mapas/docs/superpowers/specs/2026-10-15-mapa-variedade-design.md).
-- 1) mapas_chuva ganha `tipo` ('chuva' | 'variedade'); os mapas existentes ficam 'chuva'. Regras de acesso e o
--    bucket mapas-chuva não mudam (mapas_pode_ver_arquivo continua cobrindo os arquivos).
-- 2) mapas_variedade_cores: a cor fixa de cada variedade (chave = nome limpo em maiúsculas, um espaço só).
--    Lê e cria (cor automática da primeira vez): quem usa o Mapas. Troca e apaga: administrador.
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: modulos/mapas/supabase/coa-web/0001 (mapas_eh_usuario, mapas_eh_admin) e 0020 (tem_alguma_categoria).

begin;

set local lock_timeout = '5s';

alter table public.mapas_chuva add column if not exists tipo text not null default 'chuva';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mapas_chuva_tipo_valido') then
    alter table public.mapas_chuva add constraint mapas_chuva_tipo_valido check (tipo in ('chuva', 'variedade'));
  end if;
end;
$$;
create index if not exists mapas_chuva_fazenda_tipo_idx on public.mapas_chuva (fazenda_id, tipo, criado_em desc);

create table if not exists public.mapas_variedade_cores (
  variedade      text primary key check (char_length(btrim(variedade)) between 1 and 120),
  cor            text not null check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz,
  atualizado_por uuid default auth.uid()
);

alter table public.mapas_variedade_cores enable row level security;
revoke all on table public.mapas_variedade_cores from anon, authenticated;
grant select, insert, update, delete on table public.mapas_variedade_cores to authenticated;
grant select, insert, update, delete on table public.mapas_variedade_cores to service_role;

drop policy if exists mapas_variedade_cores_select on public.mapas_variedade_cores;
create policy mapas_variedade_cores_select on public.mapas_variedade_cores
  for select to authenticated using ((select public.mapas_eh_usuario()));

-- cor automática da primeira vez: qualquer usuário do Mapas cria; ninguém além do administrador troca
drop policy if exists mapas_variedade_cores_insert on public.mapas_variedade_cores;
create policy mapas_variedade_cores_insert on public.mapas_variedade_cores
  for insert to authenticated with check ((select public.mapas_eh_usuario()));

drop policy if exists mapas_variedade_cores_update on public.mapas_variedade_cores;
create policy mapas_variedade_cores_update on public.mapas_variedade_cores
  for update to authenticated using ((select public.mapas_eh_admin())) with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_variedade_cores_delete on public.mapas_variedade_cores;
create policy mapas_variedade_cores_delete on public.mapas_variedade_cores
  for delete to authenticated using ((select public.mapas_eh_admin()));

-- restritiva por categoria (padrão do 0020): sem a categoria Mapas, nada
drop policy if exists mapas_variedade_cores_categoria on public.mapas_variedade_cores;
create policy mapas_variedade_cores_categoria on public.mapas_variedade_cores
  as restrictive for all to authenticated
  using ((select public.tem_alguma_categoria(array['mapas']::text[])))
  with check ((select public.tem_alguma_categoria(array['mapas']::text[])));

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- select column_name, data_type, column_default from information_schema.columns where table_name = 'mapas_chuva' and column_name = 'tipo';
-- select tipo, count(*) from public.mapas_chuva group by 1;                       (esperado: só 'chuva')
-- select policyname, permissive, cmd from pg_policies where tablename = 'mapas_variedade_cores' order by 1;
-- (esperado: 5 regras — _categoria RESTRICTIVE ALL; _select, _insert, _update, _delete PERMISSIVE)
```

- [ ] **Step 2: Conferir as funções usadas**

Run (na raiz do repositório): `grep -n "function public.mapas_eh_usuario\|function public.mapas_eh_admin\|function public.tem_alguma_categoria" modulos/mapas/supabase/coa-web/*.sql supabase/*.sql`
Expected: ao menos uma definição de cada uma das três.

- [ ] **Step 3: Commit (local)**

```bash
git add supabase/0026_mapa_variedade.sql
git commit -m "Banco: script 0026 do mapa de variedade (tipo dos mapas salvos e cores das variedades)"
```

---

### Task 2: Domínio — regras do mapa de variedade

**Files:**
- Modify: `modulos/mapas/src/lib/types.ts` (tipos novos)
- Create: `modulos/mapas/src/lib/variedades.ts`
- Test: `modulos/mapas/tests/variedades.test.ts`

**Interfaces:**
- Produces (types.ts): `TipoMapa = 'chuva' | 'variedade'`; `ItemVariedade { chave; nome; cor; areaHa; pct; talhoes }`; `ResumoVariedades { totalHa; itens: ItemVariedade[] }`; `CorVariedade { variedade; cor; criadoEm }`; `LayoutConfig.coresVariedade?: Record<string, string>`; `ResumoChuva.variedades?: ResumoVariedades`; `MapaSalvo.tipo?: TipoMapa`.
- Produces (variedades.ts): `SEM_VARIEDADE`, `COR_SEM_VARIEDADE`, `TITULO_VARIEDADES`, `TITULO_MAPA_VARIEDADE`, `PALETA_VARIEDADES`, `limparVariedade(v)`, `chaveVariedade(nome)`, `FeicaoVariedade { id; nome; setor; areaHa; variedade }`, `feicoesDoMapa(talhoes, areas, efetivos, pims)`, `juntarCores(cadastro, fixas)`, `variedadesSemCor(feicoes, cores)`, `corAutomatica(usadas)`, `coresNovas(novas, existentes)`, `resumoVariedades(feicoes, cores)`, `coresDasFeicoes(feicoes, resumo)`, `fmtAreaHa(v)`, `textoItemVariedade(item)`, `textosAutomaticosVariedade(e)`, `resumoDoMapaVariedade(r)`, `csvVariedadePorTalhao(feicoes)`.

- [ ] **Step 1: Tipos novos** em `src/lib/types.ts`

1. Depois de `export type MapaBase = …;`, acrescentar:
```ts
/** Tipo do mapa salvo: 'chuva' (padrão; mapas antigos não têm o campo) ou 'variedade'. */
export type TipoMapa = 'chuva' | 'variedade';

/** Uma variedade no mapa de variedade (legenda, tabela e mapa salvo). */
export interface ItemVariedade {
  /** chave da cor (nome limpo em maiúsculas); '' = "Sem variedade" */
  chave: string;
  /** nome mostrado (limpo) */
  nome: string;
  cor: string;
  areaHa: number;
  /** % da área total pintada */
  pct: number;
  /** nº de feições (talhões ou áreas da cultura) */
  talhoes: number;
}

/** Resumo do mapa de variedade: da maior área para a menor, com "Sem variedade" por último. */
export interface ResumoVariedades {
  totalHa: number;
  itens: ItemVariedade[];
}

/** Linha do cadastro de cores (mapas_variedade_cores): a cor fixa de uma variedade. */
export interface CorVariedade {
  /** chave (nome limpo em maiúsculas) */
  variedade: string;
  cor: string;
  criadoEm: string;
}
```
2. Em `ResumoChuva`, depois de `mediaPicsComChuva?`, acrescentar:
```ts
  /** só nos mapas de variedade salvos (tipo 'variedade'): o resumo das variedades; os campos de chuva ficam zerados */
  variedades?: ResumoVariedades;
```
3. Em `LayoutConfig`, depois de `quadros?`, acrescentar:
```ts
  /** mapa de variedade: cores usadas (chave da variedade → cor), guardadas com o mapa salvo */
  coresVariedade?: Record<string, string>;
```
4. Em `MapaSalvo`, depois de `criadoEm: string;`, acrescentar:
```ts
  /** 'variedade' nos mapas de variedade; ausente = chuva */
  tipo?: TipoMapa;
```

- [ ] **Step 2: Escrever os testes (falham)** — `tests/variedades.test.ts`

```ts
// Regras do mapa de variedade (src/lib/variedades.ts). Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import {
  chaveVariedade, COR_SEM_VARIEDADE, corAutomatica, coresDasFeicoes, coresNovas, csvVariedadePorTalhao, feicoesDoMapa, juntarCores,
  limparVariedade, PALETA_VARIEDADES, resumoDoMapaVariedade, resumoVariedades, SEM_VARIEDADE, textoItemVariedade, textosAutomaticosVariedade,
  variedadesSemCor, type FeicaoVariedade,
} from '../src/lib/variedades';
import type { AreaCultura, Plantio, PlantioPimsTalhao, Talhao } from '../src/lib/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (id: string, codigo: string | null, areaHa: number, setor: string | null = 'S1'): Talhao =>
  ({ id, fazendaId: 'f', nome: codigo ?? id, setor, areaHa, geom, atributos: {}, codigo });
const area = (id: string, codigo: string, areaHa: number): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo, areaHa, geom });
const pims = (codigo: string, variedade: string | null): PlantioPimsTalhao =>
  ({ codigo, codigoPims: codigo, setor: null, status: 'plantado', areaPrevista: 1, areaPlantada: 1, inicio: null, fim: null, variedade });
const efetivo = (talhaoId: string, variedade: string | null): Plantio =>
  ({ safraId: 's', talhaoId, dataPlantio: null, origem: 'pims', status: 'plantado', areaPrevista: null, areaPlantada: null, inicio: null, fim: null, variedade });
const feicao = (id: string, variedade: string | null, areaHa: number, nome = id): FeicaoVariedade => ({ id, nome, setor: null, areaHa, variedade });

describe('limparVariedade e chaveVariedade', () => {
  it('tira o prefixo da semente e o sufixo da cultura, como o Operacional', () => {
    expect(limparVariedade('SEMENTE DE SOJA 84KA92 CE')).toBe('84KA92 CE');
    expect(limparVariedade('SEMENTE MILHO  DKB  360 ')).toBe('DKB 360');
    expect(limparVariedade('TMG 2383 SOJA')).toBe('TMG 2383');
  });
  it('vazio e "A DEFINIR" (com ou sem a cultura) viram null', () => {
    for (const v of [null, undefined, '', '   ', 'A DEFINIR', 'A DEFINIR SOJA', 'a definir']) expect(limparVariedade(v)).toBeNull();
  });
  it('a chave junta grafias com maiúsculas/minúsculas e espaços diferentes', () => {
    expect(chaveVariedade(' 84ka92  ce')).toBe('84KA92 CE');
    expect(chaveVariedade('84KA92 CE')).toBe(chaveVariedade('84ka92 ce'));
  });
});

describe('feicoesDoMapa', () => {
  it('sem áreas da cultura: os talhões base, com a variedade do plantio efetivo ou do PIMS pelo código', () => {
    const talhoes = [talhao('t1', '001', 10), talhao('t2', '002', 5), talhao('t3', null, 2)];
    const porCodigo = new Map([['002', pims('002', 'SEMENTE DE SOJA 84KA92 CE')]]);
    const f = feicoesDoMapa(talhoes, [], [efetivo('t1', 'TMG 2383 SOJA'), efetivo('t2', null)], porCodigo);
    expect(f.map((x) => [x.id, x.variedade, x.areaHa])).toEqual([['t1', 'TMG 2383', 10], ['t2', '84KA92 CE', 5], ['t3', null, 2]]);
  });
  it('com áreas da cultura: as áreas, com a variedade do PIMS pelo código e o nome e setor do talhão base', () => {
    const talhoes = [talhao('t1', '01PIVO', 100, 'NORTE')];
    const areas = [area('a1', '01PIVO', 40), area('a2', '099', 3)];
    const f = feicoesDoMapa(talhoes, areas, [], new Map([['01PIVO', pims('01PIVO', 'A DEFINIR SOJA')], ['099', pims('099', 'NEO 790')]]));
    expect(f).toEqual([
      { id: 'a1', nome: '01PIVO', setor: 'NORTE', areaHa: 40, variedade: null },
      { id: 'a2', nome: '099', setor: null, areaHa: 3, variedade: 'NEO 790' },
    ]);
  });
});

describe('cores', () => {
  it('corAutomatica: a primeira da paleta que ninguém usa; esgotada, volta ao começo; nunca o cinza', () => {
    expect(corAutomatica([])).toBe(PALETA_VARIEDADES[0]);
    expect(corAutomatica([PALETA_VARIEDADES[0].toLowerCase(), PALETA_VARIEDADES[2]])).toBe(PALETA_VARIEDADES[1]);
    expect(corAutomatica(PALETA_VARIEDADES)).toBe(PALETA_VARIEDADES[0]);
    expect(PALETA_VARIEDADES).not.toContain(COR_SEM_VARIEDADE);
    expect(new Set(PALETA_VARIEDADES).size).toBe(20);
  });
  it('coresNovas: uma cor diferente para cada variedade nova, contando as que acabou de dar', () => {
    const existentes = new Map([['A', PALETA_VARIEDADES[0]]]);
    expect([...coresNovas(['B', 'C'], existentes)]).toEqual([['B', PALETA_VARIEDADES[1]], ['C', PALETA_VARIEDADES[2]]]);
  });
  it('variedadesSemCor: chaves sem cor, da maior área para a menor, sem "Sem variedade"', () => {
    const f = [feicao('1', 'B', 1), feicao('2', 'C', 5), feicao('3', null, 9), feicao('4', 'A', 7), feicao('5', 'b', 3)];
    expect(variedadesSemCor(f, new Map([['A', '#000000']]))).toEqual(['C', 'B']);
  });
  it('juntarCores: as cores do mapa salvo prevalecem sobre o cadastro (mapa reaberto depois de a cor mudar)', () => {
    const cadastro = new Map([['A', '#111111'], ['B', '#222222']]);
    expect([...juntarCores(cadastro, { A: '#999999' })]).toEqual([['A', '#999999'], ['B', '#222222']]);
    expect([...juntarCores(cadastro, null)]).toEqual([...cadastro]);
  });
});

describe('resumoVariedades', () => {
  it('soma por variedade, ordena pela área, "Sem variedade" por último em cinza, e calcula o %', () => {
    const f = [feicao('1', 'TMG 2383', 30), feicao('2', '84KA92 CE', 50), feicao('3', null, 20), feicao('4', '84ka92 ce', 0)];
    const r = resumoVariedades(f, new Map([['TMG 2383', '#1F77B4'], ['84KA92 CE', '#FF7F0E']]));
    expect(r.totalHa).toBe(100);
    expect(r.itens.map((i) => [i.chave, i.nome, i.cor, i.areaHa, i.pct, i.talhoes])).toEqual([
      ['84KA92 CE', '84KA92 CE', '#FF7F0E', 50, 50, 2],
      ['TMG 2383', 'TMG 2383', '#1F77B4', 30, 30, 1],
      ['', SEM_VARIEDADE, COR_SEM_VARIEDADE, 20, 20, 1],
    ]);
    expect([...coresDasFeicoes(f, r)]).toEqual([['1', '#1F77B4'], ['2', '#FF7F0E'], ['3', COR_SEM_VARIEDADE], ['4', '#FF7F0E']]);
  });
  it('texto da legenda com milhar e % (fração abaixo de 1%)', () => {
    expect(textoItemVariedade({ chave: 'X', nome: '84KA92 CE', cor: '#000000', areaHa: 1234.4, pct: 32.4, talhoes: 3 })).toBe('84KA92 CE — 1.234 ha (32%)');
    expect(textoItemVariedade({ chave: 'Y', nome: 'NEO 790', cor: '#000000', areaHa: 12.34, pct: 0.42, talhoes: 1 })).toBe('NEO 790 — 12,3 ha (0,4%)');
  });
});

describe('textos, resumo salvo e CSV', () => {
  it('textos automáticos: título de variedades, fonte PIMS, sem período', () => {
    const t = textosAutomaticosVariedade({ fazenda: 'Globo', safra: { id: 's', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '', fim: '', nomePims: null }, setores: ['S2', 'S1'], hoje: new Date(2026, 9, 15) });
    expect(t).toEqual({ titulo: 'MAPA DE VARIEDADES', fazenda: 'GLOBO', safra: 'SOJA 26/27', periodo: '', fonte: 'PIMS', talhoes: 'TODOS', setor: 'S2, S1', observacao: '', data: '15/10/2026' });
  });
  it('resumo do mapa salvo: campos de chuva zerados e as variedades junto', () => {
    const r = { totalHa: 5, itens: [] };
    expect(resumoDoMapaVariedade(r)).toEqual({ geral: { media: 0, min: 0, max: 0, areaHa: 5 }, plantado: null, talhoes: [], variedades: r });
  });
  it('CSV dos talhões: ordem pelo nome (numérica), ";" e vírgula decimal', () => {
    const csv = csvVariedadePorTalhao([feicao('b', null, 2.5, '010'), feicao('a', 'TMG; 2383', 10, '002')]);
    expect(csv).toBe('Talhão;Setor;Variedade;Área (ha)\r\n002;;"TMG; 2383";10,00\r\n010;;Sem variedade;2,50');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run (em `modulos/mapas`): `npx vitest run tests/variedades.test.ts`
Expected: FAIL (o módulo `src/lib/variedades` não existe).

- [ ] **Step 4: Implementar** `src/lib/variedades.ts`

```ts
/**
 * Regras do mapa de variedade, sem tela: limpeza do nome que vem do PIMS, a variedade de cada feição pintada
 * (talhão base, ou área da cultura quando a safra tem áreas), a cor fixa por variedade, o resumo da legenda,
 * os textos automáticos e o CSV dos talhões.
 */
import { normalizarCodigo } from './codigoTalhao';
import { fmtData } from './format';
import type { AreaCultura, ItemVariedade, LayoutTextos, Plantio, PlantioPimsTalhao, ResumoChuva, ResumoVariedades, Safra, Talhao } from './types';

export const SEM_VARIEDADE = 'Sem variedade';
export const COR_SEM_VARIEDADE = '#B5B5B5';
export const TITULO_VARIEDADES = 'Variedades';
export const TITULO_MAPA_VARIEDADE = 'MAPA DE VARIEDADES';

/**
 * 20 cores bem diferentes entre si (Tableau 20 sem os cinzas, que ficam para "Sem variedade"): as 10 primeiras
 * fortes, as outras 10 claras. A variedade nova pega a primeira que nenhuma outra usa.
 */
export const PALETA_VARIEDADES: readonly string[] = [
  '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#17BECF', '#BCBD22', '#393B79',
  '#AEC7E8', '#FFBB78', '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94', '#F7B6D2', '#9EDAE5', '#DBDB8D', '#637939',
];

/**
 * Mesma limpeza do Operacional (scripts/sincronizar-plantio.mjs → limparVariedade): tira "SEMENTE [DE] <cultura>"
 * do começo e a cultura do fim. Vazio e "A DEFINIR" (marcador do PIMS para variedade não informada) → null.
 */
export function limparVariedade(v: string | null | undefined): string | null {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const limpo = t
    .replace(/^SEMENTE\s+(DE\s+)?(SOJA|MILHO|ALGODAO|SORGO|MILHETO)\s+/i, '')
    .replace(/\s+(SOJA|MILHO|ALGODAO)$/i, '')
    .trim();
  if (!limpo || /^A\s*DEFINIR$/i.test(limpo)) return null;
  return limpo;
}

/** Chave da cor: maiúsculas, um espaço só. */
export function chaveVariedade(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Uma feição pintada no mapa de variedade: talhão base, ou área da cultura quando a safra tem áreas. */
export interface FeicaoVariedade {
  /** id do talhão base ou da área da cultura (o mesmo id que o desenho pinta) */
  id: string;
  /** rótulo do talhão (nome do shape; na área da cultura, o do talhão base de mesmo código, ou o código) */
  nome: string;
  setor: string | null;
  areaHa: number;
  /** variedade limpa; null = sem variedade */
  variedade: string | null;
}

/**
 * Variedade de cada feição. Sem áreas da cultura: os talhões base, pela variedade do plantio efetivo (o PIMS
 * prevalece sobre o manual) ou do PIMS pelo código. Com áreas: as áreas, pela variedade do PIMS de mesmo código
 * (ou a do talhão base), com o nome e o setor do talhão base — a mesma regra de `situacaoDoMapa`.
 */
export function feicoesDoMapa(
  talhoes: Talhao[],
  areas: AreaCultura[],
  efetivos: Plantio[],
  pims: Map<string, PlantioPimsTalhao> | null,
): FeicaoVariedade[] {
  const doEfetivo = new Map(efetivos.map((p) => [p.talhaoId, p.variedade]));
  if (areas.length === 0) {
    return talhoes.map((t) => {
      const codigo = normalizarCodigo(t.codigo);
      const bruta = doEfetivo.get(t.id) ?? (codigo ? pims?.get(codigo)?.variedade : null) ?? null;
      return { id: t.id, nome: t.nome, setor: t.setor, areaHa: t.areaHa, variedade: limparVariedade(bruta) };
    });
  }
  const basePorCodigo = new Map<string, Talhao>();
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    if (codigo && !basePorCodigo.has(codigo)) basePorCodigo.set(codigo, t);
  }
  return areas.map((a) => {
    const codigo = normalizarCodigo(a.codigo);
    const base = codigo ? basePorCodigo.get(codigo) : undefined;
    const bruta = (codigo ? pims?.get(codigo)?.variedade : null) ?? (base ? doEfetivo.get(base.id) : null) ?? null;
    return { id: a.id, nome: base?.nome ?? a.codigo, setor: base?.setor ?? null, areaHa: a.areaHa, variedade: limparVariedade(bruta) };
  });
}

/** Cores do cadastro com as de um mapa salvo por cima (o mapa reaberto mostra as cores do dia em que foi salvo). */
export function juntarCores(cadastro: ReadonlyMap<string, string>, fixas: Record<string, string> | null | undefined): Map<string, string> {
  const out = new Map(cadastro);
  for (const [k, cor] of Object.entries(fixas ?? {})) out.set(k, cor);
  return out;
}

/** Chaves das variedades das feições sem cor, da maior área para a menor ("Sem variedade" fica de fora). */
export function variedadesSemCor(feicoes: FeicaoVariedade[], cores: ReadonlyMap<string, string>): string[] {
  const area = new Map<string, number>();
  for (const f of feicoes) {
    if (!f.variedade) continue;
    const k = chaveVariedade(f.variedade);
    if (!cores.has(k)) area.set(k, (area.get(k) ?? 0) + f.areaHa);
  }
  return [...area].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([k]) => k);
}

/** A primeira cor da paleta que nenhuma variedade usa; esgotada a paleta, volta ao começo. */
export function corAutomatica(usadas: Iterable<string>): string {
  const em = new Set([...usadas].map((c) => c.toUpperCase()));
  return PALETA_VARIEDADES.find((c) => !em.has(c)) ?? PALETA_VARIEDADES[em.size % PALETA_VARIEDADES.length];
}

/** Cores para as variedades novas, uma depois da outra (a cor que acabou de dar conta como usada). */
export function coresNovas(novas: string[], existentes: ReadonlyMap<string, string>): Map<string, string> {
  const usadas = [...existentes.values()];
  const out = new Map<string, string>();
  for (const k of novas) {
    const cor = corAutomatica(usadas);
    out.set(k, cor);
    usadas.push(cor);
  }
  return out;
}

/** Resumo da legenda: área e % por variedade, da maior para a menor, com "Sem variedade" (cinza) por último. */
export function resumoVariedades(feicoes: FeicaoVariedade[], cores: ReadonlyMap<string, string>): ResumoVariedades {
  const grupos = new Map<string, ItemVariedade>();
  let totalHa = 0;
  for (const f of feicoes) {
    totalHa += f.areaHa;
    const chave = f.variedade ? chaveVariedade(f.variedade) : '';
    const g = grupos.get(chave) ?? {
      chave,
      nome: f.variedade ?? SEM_VARIEDADE,
      cor: chave ? (cores.get(chave) ?? COR_SEM_VARIEDADE) : COR_SEM_VARIEDADE,
      areaHa: 0,
      pct: 0,
      talhoes: 0,
    };
    g.areaHa += f.areaHa;
    g.talhoes += 1;
    grupos.set(chave, g);
  }
  const itens = [...grupos.values()]
    .map((g) => ({ ...g, pct: totalHa > 0 ? (100 * g.areaHa) / totalHa : 0 }))
    .sort((a, b) => Number(a.chave === '') - Number(b.chave === '') || b.areaHa - a.areaHa || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { totalHa, itens };
}

/** Cor de cada feição (id → cor), para o desenho. */
export function coresDasFeicoes(feicoes: FeicaoVariedade[], resumo: ResumoVariedades): Map<string, string> {
  const porChave = new Map(resumo.itens.map((i) => [i.chave, i.cor]));
  return new Map(feicoes.map((f) => [f.id, porChave.get(f.variedade ? chaveVariedade(f.variedade) : '') ?? COR_SEM_VARIEDADE]));
}

/** "1.234" (sem casa acima de 100 ha) ou "12,3". */
export function fmtAreaHa(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: v < 100 ? 1 : 0 });
}

/** "84KA92 CE — 1.234 ha (32%)"; abaixo de 1%, uma casa ("0,4%"). */
export function textoItemVariedade(i: ItemVariedade): string {
  const pct = i.pct > 0 && i.pct < 1 ? i.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : String(Math.round(i.pct));
  return `${i.nome} — ${fmtAreaHa(i.areaHa)} ha (${pct}%)`;
}

export interface EntradaTextosVariedade {
  fazenda: string;
  safra: Safra | null;
  /** null = todos os setores */
  setores: string[] | null;
  hoje: Date;
}

/** Textos automáticos do mapa de variedade (sem período; fonte PIMS). */
export function textosAutomaticosVariedade(e: EntradaTextosVariedade): LayoutTextos {
  return {
    titulo: TITULO_MAPA_VARIEDADE,
    fazenda: e.fazenda.toUpperCase(),
    safra: e.safra?.nome ?? '',
    periodo: '',
    fonte: 'PIMS',
    talhoes: 'TODOS',
    setor: e.setores && e.setores.length ? e.setores.join(', ') : 'TODOS',
    observacao: '',
    data: fmtData(e.hoje),
  };
}

/** Resumo gravado no mapa de variedade salvo (a coluna resumo não aceita nulo): chuva zerada, variedades junto. */
export function resumoDoMapaVariedade(r: ResumoVariedades): ResumoChuva {
  return { geral: { media: 0, min: 0, max: 0, areaHa: r.totalHa }, plantado: null, talhoes: [], variedades: r };
}

/** CSV para o Excel em português: Talhão;Setor;Variedade;Área (ha), pela ordem do nome do talhão. */
export function csvVariedadePorTalhao(feicoes: FeicaoVariedade[]): string {
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = [...feicoes]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map((f) => [esc(f.nome), esc(f.setor ?? ''), esc(f.variedade ?? SEM_VARIEDADE), f.areaHa.toFixed(2).replace('.', ',')].join(';'));
  return ['Talhão;Setor;Variedade;Área (ha)', ...linhas].join('\r\n');
}
```

- [ ] **Step 5: Rodar e ver passar**

Run (em `modulos/mapas`): `npx vitest run tests/variedades.test.ts && npx tsc --noEmit -p .`
Expected: PASS; sem erro de tipos.

- [ ] **Step 6: Commit (local)**

```bash
git add modulos/mapas/src/lib/types.ts modulos/mapas/src/lib/variedades.ts modulos/mapas/tests/variedades.test.ts
git commit -m "Mapas: regras do mapa de variedade (limpeza, cores fixas, resumo e CSV)"
```

---

### Task 3: Repositório — cores das variedades e tipo dos mapas salvos

**Files:**
- Modify: `modulos/mapas/src/data/repo.ts`, `supabaseLinhas.ts`, `supabaseRepo.ts`, `localRepo.ts`
- Modify: `modulos/mapas/tests/helpers/supabaseFalso.ts` (chave e conflito de insert)
- Modify: `modulos/mapas/tests/supabaseRepo-coa.test.ts` (nomes de TABELAS e as tabelas usadas)
- Modify: `modulos/mapas/tests/migracao.test.ts` (lê também o script 0026)
- Test: `modulos/mapas/tests/variedades-repo.test.ts` (novo)

**Interfaces:**
- Consumes: `TipoMapa`, `CorVariedade` (Tarefa 2); `supabase/0026_mapa_variedade.sql` (Tarefa 1).
- Produces (Repositorio): `listarMapas(tipo?: TipoMapa)` (padrão 'chuva'); `listarCoresVariedade(): Promise<CorVariedade[]>`; `criarCorVariedade(variedade, cor): Promise<CorVariedade>`; `trocarCorVariedade(variedade, cor): Promise<void>`; `excluirCorVariedade(variedade): Promise<void>`. `TABELAS.coresVariedade = 'mapas_variedade_cores'`.

- [ ] **Step 1: Ajudante de teste** (`tests/helpers/supabaseFalso.ts`)

1. Em `CHAVES`, acrescentar `mapas_variedade_cores: ['variedade'],`.
2. Em `PADROES`, acrescentar:
```ts
  mapas_variedade_cores: () => ({ criado_em: '2026-10-15T00:00:00.000Z', atualizado_em: null, atualizado_por: null }),
```
3. No `executar()`, dentro do bloco `if (this.op === 'insert') {`, entre `const novas = …;` e `tabela.push(...novas);`, acrescentar a recusa de chave repetida (como o Postgres):
```ts
      const chave = CHAVES[this.tabela];
      if (chave && novas.some((n) => tabela.some((l) => chave.every((k) => l[k] === n[k])))) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' }, count: null };
      }
```

- [ ] **Step 2: Escrever os testes (falham)** — `tests/variedades-repo.test.ts`

```ts
// Repositório: cores das variedades e tipo dos mapas salvos, no Supabase falso e no IndexedDB falso. Dados FICTÍCIOS.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { mapaParaRow, TABELAS } from '../src/data/supabaseLinhas';
import type { Repositorio } from '../src/data/repo';
import { mapa } from './helpers/dominio';
import { BancoFalso } from './helpers/supabaseFalso';

let n = 0;
const repos: [string, () => Repositorio][] = [
  ['supabase', () => criarSupabaseRepo(new BancoFalso().cliente())],
  ['local', () => criarLocalRepo(`coa-chuva-variedade-${++n}`)],
];

describe.each(repos)('cores das variedades (%s)', (_nome, novo) => {
  it('cria, lista pela variedade, troca e apaga', async () => {
    const r = novo();
    await r.criarCorVariedade('TMG 2383', '#1F77B4');
    await r.criarCorVariedade('84KA92 CE', '#FF7F0E');
    expect((await r.listarCoresVariedade()).map((c) => [c.variedade, c.cor])).toEqual([['84KA92 CE', '#FF7F0E'], ['TMG 2383', '#1F77B4']]);
    await r.trocarCorVariedade('TMG 2383', '#000000');
    await r.excluirCorVariedade('84KA92 CE');
    expect((await r.listarCoresVariedade()).map((c) => [c.variedade, c.cor])).toEqual([['TMG 2383', '#000000']]);
  });
  it('criar de novo uma variedade que já tem cor devolve a cor que está gravada (sem trocar)', async () => {
    const r = novo();
    await r.criarCorVariedade('NEO 790', '#2CA02C');
    const segunda = await r.criarCorVariedade('NEO 790', '#D62728');
    expect(segunda.cor).toBe('#2CA02C');
    expect((await r.listarCoresVariedade()).map((c) => c.cor)).toEqual(['#2CA02C']);
  });
});

describe('mapas salvos com tipo', () => {
  it('Supabase: a lista de chuva não traz os de variedade e vice-versa; o tipo vai e volta', async () => {
    const banco = new BancoFalso();
    banco.inserir(TABELAS.mapas, [mapaParaRow(mapa(1)), mapaParaRow({ ...mapa(2), tipo: 'variedade' })]);
    const r = criarSupabaseRepo(banco.cliente());
    expect((await r.listarMapas()).map((m) => m.titulo)).toEqual(['Mapa 1']);
    const variedade = await r.listarMapas('variedade');
    expect(variedade.map((m) => [m.titulo, m.tipo])).toEqual([['Mapa 2', 'variedade']]);
    expect((await r.obterMapa(mapa(1).id))?.tipo).toBeUndefined();
    expect(banco.tabelas[TABELAS.mapas].map((l) => l.tipo)).toEqual(['chuva', 'variedade']);
  });
  it('local: mapas antigos (sem tipo) contam como chuva', async () => {
    const r = criarLocalRepo(`coa-chuva-variedade-${++n}`);
    await r.salvarMapa(mapa(1), new Blob(['x'], { type: 'image/jpeg' }), new Blob(['y'], { type: 'image/png' }));
    await r.salvarMapa({ ...mapa(2), tipo: 'variedade' }, new Blob(['x'], { type: 'image/jpeg' }), new Blob(['y'], { type: 'image/png' }));
    expect((await r.listarMapas()).map((m) => m.titulo)).toEqual(['Mapa 1']);
    expect((await r.listarMapas('variedade')).map((m) => m.titulo)).toEqual(['Mapa 2']);
  });
});
```

Em `tests/supabaseRepo-coa.test.ts`:
1. No `expect(TABELAS).toEqual({ … })`, acrescentar `coresVariedade: 'mapas_variedade_cores',` depois de `situacaoZeus: 'mapas_zeus_situacao',`.
2. No teste "usa só as tabelas mapas_* e o bucket mapas-chuva…" (ele chama todos os métodos e confere que cada tabela de `TABELAS` foi usada), depois de `await repo.situacaoZeus();`, acrescentar:
```ts
    await repo.criarCorVariedade('TMG 2383', '#1F77B4');
    await repo.listarCoresVariedade();
    await repo.trocarCorVariedade('TMG 2383', '#000000');
    await repo.excluirCorVariedade('TMG 2383');
```

Em `tests/migracao.test.ts` (confere os scripts do banco contra `TABELAS` e os mapeadores):
1. Trocar o comentário e a constante `SCRIPTS` por:
```ts
/**
 * Os scripts do módulo, na ordem em que rodam (0002: pedidos de "Atualizar plantio"; 0003: pedidos de chuva da ZEUS;
 * 0026, na pasta supabase/ do COA WEB: mapa de variedade).
 */
const SCRIPTS = [
  'supabase/coa-web/0001_mapas.sql',
  'supabase/coa-web/0002_pedidos_plantio.sql',
  'supabase/coa-web/0003_pedidos_chuva.sql',
  'supabase/coa-web/0004_situacao_zeus.sql',
  '../../supabase/0026_mapa_variedade.sql',
];
```
2. Em `colunasDasTabelas()`, trocar o comentário por `/** Colunas de cada "create table if not exists public.<nome> ( ... );" do script, mais as de "add column if not exists". */` e, antes de `return tabelas;`, acrescentar:
```ts
  for (const [, nome, coluna] of sql.matchAll(/alter table public\.(\w+) add column if not exists (\w+)\s/g)) tabelas.get(nome)?.add(coluna);
```
3. No título do `describe`, trocar `0004_situacao_zeus.sql × repositório` por `0004_situacao_zeus.sql + supabase/0026_mapa_variedade.sql × repositório`.
4. No teste "todas as colunas gravadas pelos mapeadores existem na tabela certa", depois da linha da situação da ZEUS (`for (const coluna of ['fazenda', 'ultimo_dia', …`), acrescentar:
```ts
    // cores das variedades: o repositório insere variedade e cor, troca cor e atualizado_em, e lê criado_em
    for (const coluna of ['variedade', 'cor', 'criado_em', 'atualizado_em']) expect(tabelas.get(TABELAS.coresVariedade)?.has(coluna), coluna).toBe(true);
```
(`mapaParaRow` passa a gravar `tipo`; a coluna entra no 0026 por `add column if not exists`, que o item 2 passa a ler.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/variedades-repo.test.ts tests/supabaseRepo-coa.test.ts tests/migracao.test.ts`
Expected: FAIL (métodos e `TABELAS.coresVariedade` não existem; o migracao falha na tabela nova).

- [ ] **Step 4: Implementar**

`src/data/repo.ts`:
1. No import de tipos, acrescentar `CorVariedade` e `TipoMapa`.
2. Trocar a declaração de `listarMapas` e o comentário acima dela (`/** Mais recente primeiro. */`) por:
```ts
  /** Mais recente primeiro, só do tipo pedido ('chuva' por padrão; mapas antigos sem tipo são de chuva). */
  listarMapas(tipo?: TipoMapa): Promise<MapaSalvo[]>;
```
3. Antes de `exportarBackup(): Promise<BackupJson>;`, acrescentar:
```ts
  /** Cadastro de cores das variedades (mapas_variedade_cores), pela variedade. */
  listarCoresVariedade(): Promise<CorVariedade[]>;
  /**
   * Grava a cor de uma variedade nova (só cria; nunca troca). Se a variedade já tem cor (gravada por outra
   * pessoa no meio tempo), devolve a que está gravada.
   */
  criarCorVariedade(variedade: string, cor: string): Promise<CorVariedade>;
  /** Troca a cor de uma variedade (administrador; no Supabase, a regra de acesso barra os demais). */
  trocarCorVariedade(variedade: string, cor: string): Promise<void>;
  /** Apaga a variedade do cadastro (administrador); se ela aparecer de novo num mapa, ganha cor automática. */
  excluirCorVariedade(variedade: string): Promise<void>;
```

`src/data/supabaseLinhas.ts`:
1. No import de tipos, acrescentar `CorVariedade`.
2. Em `TABELAS`, depois de `situacaoZeus: 'mapas_zeus_situacao',`, acrescentar:
```ts
  /** cor fixa de cada variedade (supabase/0026_mapa_variedade.sql) */
  coresVariedade: 'mapas_variedade_cores',
```
3. Em `MapaRow`, depois de `criado_em: string;`, acrescentar `/** 'chuva' | 'variedade' (supabase/0026); ausente em linhas antigas */ tipo?: string;`.
4. Em `mapaParaRow`, depois de `criado_em: m.criadoEm,`, acrescentar `tipo: m.tipo ?? 'chuva',`.
5. Em `rowParaMapa` (não em `rowParaFazenda`, que também tem `criadoEm: r.criado_em,`), depois de `criadoEm: r.criado_em,`, acrescentar `...(r.tipo === 'variedade' ? { tipo: 'variedade' as const } : {}),`.
6. No fim do arquivo:
```ts
/** Linha de mapas_variedade_cores. */
export interface CorVariedadeRow {
  variedade: string;
  cor: string;
  criado_em: string;
}

export function rowParaCorVariedade(r: CorVariedadeRow): CorVariedade {
  return { variedade: r.variedade, cor: r.cor, criadoEm: r.criado_em };
}
```

`src/data/supabaseRepo.ts`:
1. No import de `./supabaseLinhas`, acrescentar `rowParaCorVariedade,` e `type CorVariedadeRow,`.
2. Trocar `async listarMapas() {` e a consulta por:
```ts
    async listarMapas(tipo = 'chuva') {
      const linhas = await lerTodas<MapaRow>('Não foi possível listar os mapas', (de, ate) =>
        client
          .from(TABELAS.mapas)
          .select('*', { count: 'exact' })
          .eq('tipo', tipo)
          .order('criado_em', { ascending: false })
          .order('id')
          .range(de, ate),
      );
      return linhas.map(rowParaMapa);
    },
```
3. Depois de `async excluirMapa(m) { … },`, acrescentar:
```ts
    async listarCoresVariedade() {
      const linhas = await lerTodas<CorVariedadeRow>('Não foi possível ler as cores das variedades', (de, ate) =>
        client.from(TABELAS.coresVariedade).select('*', { count: 'exact' }).order('variedade').range(de, ate),
      );
      return linhas.map(rowParaCorVariedade);
    },

    async criarCorVariedade(variedade, cor) {
      const { data, error } = await client.from(TABELAS.coresVariedade).insert({ variedade, cor }).select('*').single();
      if (!error) return rowParaCorVariedade(data as CorVariedadeRow);
      // chave repetida: outra pessoa gravou a cor desta variedade antes; vale a dela
      if (error.code !== '23505') falha('Não foi possível gravar a cor da variedade', error);
      const { data: atual, error: erroLeitura } = await client.from(TABELAS.coresVariedade).select('*').eq('variedade', variedade).maybeSingle();
      if (erroLeitura) falha('Não foi possível ler a cor da variedade', erroLeitura);
      if (!atual) falha('Não foi possível gravar a cor da variedade', error);
      return rowParaCorVariedade(atual as CorVariedadeRow);
    },

    async trocarCorVariedade(variedade, cor) {
      const { error } = await client.from(TABELAS.coresVariedade).update({ cor, atualizado_em: new Date().toISOString() }).eq('variedade', variedade);
      if (error) falha('Não foi possível trocar a cor da variedade', error);
    },

    async excluirCorVariedade(variedade) {
      const { error } = await client.from(TABELAS.coresVariedade).delete().eq('variedade', variedade);
      if (error) falha('Não foi possível apagar a variedade', error);
    },
```

`src/data/localRepo.ts`:
1. No import de tipos, acrescentar `CorVariedade`.
2. Em `CoaChuvaDB`, depois de `areasCultura: { … };`, acrescentar `coresVariedade: { key: string; value: CorVariedade };`.
3. Trocar `const VERSAO_DB = 2;` por `const VERSAO_DB = 3;`.
4. No fim de `atualizarEsquema`, acrescentar:
```ts
  if (versaoAntiga < 3) {
    // v3 (mapa de variedade): cor fixa de cada variedade
    db.createObjectStore('coresVariedade', { keyPath: 'variedade' });
  }
```
5. Trocar `listarMapas` por:
```ts
    async listarMapas(tipo = 'chuva') {
      const db = await dbPromise;
      const mapas = await db.getAll('mapas');
      return mapas.filter((m) => (m.tipo ?? 'chuva') === tipo).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    },
```
6. Depois de `async excluirMapa(m) { … },`, acrescentar:
```ts
    async listarCoresVariedade() {
      const db = await dbPromise;
      return (await db.getAll('coresVariedade')).sort((a, b) => a.variedade.localeCompare(b.variedade));
    },

    async criarCorVariedade(variedade, cor) {
      const db = await dbPromise;
      const tx = db.transaction('coresVariedade', 'readwrite');
      const atual = await tx.store.get(variedade);
      const salvo = atual ?? { variedade, cor, criadoEm: new Date().toISOString() };
      if (!atual) await tx.store.put(salvo);
      await tx.done;
      return salvo;
    },

    async trocarCorVariedade(variedade, cor) {
      const db = await dbPromise;
      const atual = await db.get('coresVariedade', variedade);
      if (!atual) throw new Error('Variedade não encontrada no cadastro de cores.');
      await db.put('coresVariedade', { ...atual, cor });
    },

    async excluirCorVariedade(variedade) {
      const db = await dbPromise;
      await db.delete('coresVariedade', variedade);
    },
```

- [ ] **Step 5: Rodar e ver passar; suíte inteira**

Run: `npx vitest run tests/variedades-repo.test.ts && npx tsc --noEmit -p . && npx vitest run`
Expected: tudo PASS (os testes de mapas salvos antigos continuam passando: linhas sem tipo contam como chuva).

- [ ] **Step 6: Commit (local)**

```bash
git add modulos/mapas/src/data modulos/mapas/tests/helpers/supabaseFalso.ts modulos/mapas/tests/supabaseRepo-coa.test.ts modulos/mapas/tests/migracao.test.ts modulos/mapas/tests/variedades-repo.test.ts
git commit -m "Mapas: cores das variedades e tipo dos mapas salvos no repositório (Supabase e local)"
```

---

### Task 4: Desenho — modo variedade

**Files:**
- Modify: `modulos/mapas/src/render/types.ts` (`RenderInput.variedades`)
- Modify: `modulos/mapas/src/render/mapFrame.ts` (`desenharVariedades`; desvio em `desenharTalhoes`)
- Modify: `modulos/mapas/src/render/legend.ts` (`itensLegenda`)
- Modify: `modulos/mapas/src/render/painel.ts` (`itensInformacao`, assinatura)
- Modify: `modulos/mapas/src/lib/exportar.ts` (`nomeArquivoMapa` com prefixo)
- Test: `modulos/mapas/tests/render-variedade.test.ts` (novo)

**Interfaces:**
- Consumes: `ResumoVariedades`, `TITULO_VARIEDADES`, `textoItemVariedade`, `fmtAreaHa` (Tarefa 2).
- Produces: `RenderInput.variedades?: { cores: Map<string, string>; resumo: ResumoVariedades } | null`; `desenharVariedades(ctx, v, geoms, areas, cores)`; `nomeArquivoMapa(fazenda, periodo, ext = 'png', prefixo = 'MAPA_CHUVA')`; `ASSINATURA_VARIEDADE`.

- [ ] **Step 1: Escrever os testes (falham)** — `tests/render-variedade.test.ts`

```ts
// Desenho do mapa de variedade: legenda, painel, cor sólida nas feições e nome do arquivo. Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import { nomeArquivoMapa } from '../src/lib/exportar';
import { IDW_PADRAO, type LayoutConfig, type ResumoVariedades, type Talhao } from '../src/lib/types';
import { itensLegenda } from '../src/render/legend';
import { desenharTalhoes, type FeicaoPx } from '../src/render/mapFrame';
import type { TalhaoPx } from '../src/render/rotulosMapa';
import { itensInformacao } from '../src/render/painel';
import type { RenderInput, Vista } from '../src/render/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (id: string): Talhao => ({ id, fazendaId: 'f', nome: id, setor: null, areaHa: 1, geom, atributos: {}, codigo: id });
const resumo: ResumoVariedades = {
  totalHa: 100,
  itens: [
    { chave: '84KA92 CE', nome: '84KA92 CE', cor: '#FF7F0E', areaHa: 60, pct: 60, talhoes: 2 },
    { chave: '', nome: 'Sem variedade', cor: '#B5B5B5', areaHa: 40, pct: 40, talhoes: 1 },
  ],
};
const config: LayoutConfig = {
  pagina: 'A3',
  textos: { titulo: 'MAPA DE VARIEDADES', fazenda: 'GLOBO', safra: 'SOJA 26/27', periodo: '', fonte: 'PIMS', talhoes: 'TODOS', setor: 'TODOS', observacao: '', data: '15/10/2026' },
  paletaId: 'auto', estiloPlantado: 'quadriculado', mapaBase: 'nenhum', mostrarRotulosTalhoes: true, mostrarValoresPics: false,
  mostrarGrade: false, legendaCompacta: false, extent: null, idw: IDW_PADRAO,
};
const entrada = (p: Partial<RenderInput> = {}): RenderInput => ({
  config, palette: { id: 'variedade', nome: 'Variedade', classes: [] }, grid: null, talhoes: [talhao('t1'), talhao('t2')],
  situacoes: new Map(), areasCultura: [], plantioGeradoEm: '2026-10-15T10:17:00.000Z', resumo: null, nomeSafra: 'SOJA 26/27',
  pics: [], logo: null, tiles: null,
  variedades: { cores: new Map([['t1', '#FF7F0E'], ['t2', '#B5B5B5']]), resumo },
  ...p,
});

describe('legenda e painel do mapa de variedade', () => {
  it('legenda: título "Variedades" e uma linha por variedade, na ordem do resumo', () => {
    expect(itensLegenda(entrada(), null)).toEqual([
      { tipo: 'titulo', texto: 'Variedades' },
      { tipo: 'classe', texto: '84KA92 CE — 60 ha (60%)', cor: '#FF7F0E' },
      { tipo: 'classe', texto: 'Sem variedade — 40 ha (40%)', cor: '#B5B5B5' },
    ]);
  });
  it('painel: safra, fonte, área total, nº de variedades (sem contar "Sem variedade"), talhões, setor, plantio e data', () => {
    expect(itensInformacao(entrada()).map((p) => [p.rotulo, p.valor])).toEqual([
      ['Safra', 'SOJA 26/27'],
      ['Fonte', 'PIMS'],
      ['Área total', '100 ha'],
      ['Variedades', '1'],
      ['Talhões', 'TODOS'],
      ['Setor', 'TODOS'],
      ['Plantio', expect.stringMatching(/^PIMS \d{2}\/\d{2} \d{2}:\d{2}$/)],
      ['Data', '15/10/2026'],
    ]);
  });
  it('sem `variedades`, a legenda e o painel são os do mapa de chuva (nada muda)', () => {
    expect(itensLegenda(entrada({ variedades: null }), null)).toEqual([]);
    expect(itensInformacao(entrada({ variedades: null })).map((p) => p.rotulo)).not.toContain('Variedades');
  });
});

describe('cor sólida nas feições', () => {
  const vista: Vista = { s: 1, x: 0, y: 0, w: 300, h: 200, ext: { cx: 0, cy: 0, mPorMm: 1 }, mPorPx: 1, latCentro: 0, paraPx: (x, y) => [x, y], paraMerc: (x, y) => [x, y] };
  const quadrado = (x: number): TalhaoPx['xy'] => [[[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]]]];
  function gravador() {
    const preenchidos: string[] = [];
    let clips = 0;
    let estilo = '';
    const ctx = {
      save: () => undefined, restore: () => undefined, beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
      closePath: () => undefined, stroke: () => undefined, setLineDash: () => undefined,
      clip: () => { clips += 1; },
      fill: () => { preenchidos.push(estilo); },
      set fillStyle(v: string) { estilo = v; },
      get fillStyle() { return estilo; },
      lineWidth: 1, strokeStyle: '', lineJoin: 'miter',
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, preenchidos, clips: () => clips };
  }
  it('talhões base: cada um com a cor da variedade, sem os padrões da situação do plantio', () => {
    const g = gravador();
    const inp = entrada();
    const geoms: TalhaoPx[] = inp.talhoes.map((t, i) => ({ t, xy: quadrado(i * 20) }));
    desenharTalhoes(g.ctx, vista, geoms, inp);
    expect(g.preenchidos).toEqual(['#FF7F0E', '#B5B5B5']);
    expect(g.clips()).toBe(0);
  });
  it('com áreas da cultura: pinta as áreas (pelo id delas), não os talhões base', () => {
    const g = gravador();
    const inp = entrada({ variedades: { cores: new Map([['a1', '#2CA02C']]), resumo } });
    const geoms: TalhaoPx[] = inp.talhoes.map((t, i) => ({ t, xy: quadrado(i * 20) }));
    const areas: FeicaoPx[] = [{ id: 'a1', xy: quadrado(50) }];
    desenharTalhoes(g.ctx, vista, geoms, inp, areas);
    expect(g.preenchidos).toEqual(['#2CA02C']);
  });
});

describe('nome do arquivo', () => {
  it('prefixo do mapa de variedade', () => {
    expect(nomeArquivoMapa('Três Flechas', 'SOJA 26/27', 'png', 'MAPA_VARIEDADE')).toBe('MAPA_VARIEDADE_TRES_FLECHAS_SOJA_26-27.png');
    expect(nomeArquivoMapa('Globo', '01/02/2025 a 15/02/2025')).toBe('MAPA_CHUVA_GLOBO_01-02-2025_A_15-02-2025.png');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/render-variedade.test.ts`
Expected: FAIL (`variedades` não existe no `RenderInput`; legenda, painel e arquivo sem o modo variedade).

- [ ] **Step 3: Implementar**

`src/render/types.ts`:
1. No import de `../lib/types`, acrescentar `ResumoVariedades`.
2. Em `RenderInput`, depois de `tiles: TileSource | null;`, acrescentar:
```ts
  /**
   * Mapa de variedade: cor sólida de cada feição (id do talhão base ou da área da cultura → cor) e o resumo da
   * legenda. Ausente/null = mapa de chuva (desenho de sempre).
   */
  variedades?: { cores: Map<string, string>; resumo: ResumoVariedades } | null;
```

`src/render/mapFrame.ts`:
1. Antes de `export function desenharTalhoes`, acrescentar:
```ts
/**
 * Mapa de variedade: cada feição pintada (as áreas da cultura, ou os talhões base sem elas) com a cor sólida da
 * variedade e, por cima, o contorno preto fino de todas. Sem padrões de situação do plantio.
 */
export function desenharVariedades(ctx: CanvasRenderingContext2D, v: Vista, geoms: TalhaoPx[], areas: FeicaoPx[], cores: Map<string, string>): void {
  const pintados = areas.length ? areas.map((a) => ({ xy: a.xy, cor: cores.get(a.id) })) : geoms.map((g) => ({ xy: g.xy, cor: cores.get(g.t.id) }));
  ctx.save();
  ctx.lineJoin = 'round';
  for (const p of pintados) {
    if (!p.cor) continue;
    ctx.beginPath();
    tracar(ctx, p.xy);
    ctx.fillStyle = p.cor;
    ctx.fill('evenodd');
  }
  ctx.beginPath();
  geoms.forEach((g) => tracar(ctx, g.xy));
  areas.forEach((a) => tracar(ctx, a.xy));
  ctx.lineWidth = 0.3 * v.s;
  ctx.strokeStyle = '#1A1A1A';
  ctx.stroke();
  ctx.restore();
}
```
2. Na primeira linha de `desenharTalhoes` (antes de `const s = v.s;`), acrescentar:
```ts
  if (inp.variedades) return desenharVariedades(ctx, v, geoms, areas, inp.variedades.cores);
```

`src/render/legend.ts`:
1. Acrescentar o import `import { textoItemVariedade, TITULO_VARIEDADES } from '../lib/variedades';`.
2. Na primeira linha de `itensLegenda` (antes de `const itens: ItemLegenda[] = [];`), acrescentar:
```ts
  if (inp.variedades) {
    // mapa de variedade: só as variedades (sem PICs, situação do plantio ou classes de chuva)
    return [
      { tipo: 'titulo', texto: TITULO_VARIEDADES },
      ...inp.variedades.resumo.itens.map((i): ItemLegenda => ({ tipo: 'classe', texto: textoItemVariedade(i), cor: i.cor })),
    ];
  }
```

`src/render/painel.ts`:
1. Acrescentar o import `import { fmtAreaHa } from '../lib/variedades';`.
2. Em `itensInformacao`, trocar a criação de `pares` por:
```ts
  const r = inp.variedades?.resumo;
  const pares: ParInfo[] = r
    ? [
        { rotulo: 'Safra', valor: t.safra },
        { rotulo: 'Fonte', valor: t.fonte },
        { rotulo: 'Área total', valor: `${fmtAreaHa(r.totalHa)} ha` },
        { rotulo: 'Variedades', valor: String(r.itens.filter((i) => i.chave).length) },
        { rotulo: 'Talhões', valor: t.talhoes },
        { rotulo: 'Setor', valor: t.setor },
        { rotulo: 'Plantio', valor: pims ? `PIMS ${pims}` : '' },
        { rotulo: 'Data', valor: t.data },
        { rotulo: 'Observação', valor: t.observacao },
      ]
    : [
        { rotulo: 'Safra', valor: t.safra },
        { rotulo: 'Período', valor: t.periodo },
        { rotulo: 'Fonte', valor: t.fonte },
        { rotulo: 'Talhões', valor: t.talhoes },
        { rotulo: 'Setor', valor: t.setor },
        { rotulo: 'Média da fazenda', valor: media(inp.resumo?.geral.media) },
        { rotulo: 'Média dos PICs com chuva', valor: inp.resumo?.mediaPicsComChuva === null ? 'sem chuva' : media(inp.resumo?.mediaPicsComChuva) },
        { rotulo: 'Plantio', valor: pims ? `PIMS ${pims}` : '' },
        { rotulo: 'Data', valor: t.data },
        { rotulo: 'Observação', valor: t.observacao },
      ];
```
3. Depois de `const ASSINATURA = 'Mapa de Chuva COA · Locks';`, acrescentar `const ASSINATURA_VARIEDADE = 'Mapa de Variedade COA · Locks';`.
4. Em `rodape`, acrescentar o parâmetro `assinatura: string` no fim da assinatura da função e trocar `ctx.fillText(ASSINATURA, r.x * s, base);` por `ctx.fillText(assinatura, r.x * s, base);`.
5. Em `desenharPainel`, trocar `rodape(ctx, sec.rodape, s, lateral, atribuicao);` por `rodape(ctx, sec.rodape, s, lateral, atribuicao, inp.variedades ? ASSINATURA_VARIEDADE : ASSINATURA);`.

`src/lib/exportar.ts`, em `nomeArquivoMapa` (o resto da função, com a limpeza dos acentos, fica como está):
1. Trocar o comentário e a assinatura por:
```ts
/** "MAPA_CHUVA_GUAPIRAMA_01-02-2025_a_15-02-2025.png"; mapa de variedade: prefixo "MAPA_VARIEDADE". */
export function nomeArquivoMapa(fazenda: string, periodo: string, ext = 'png', prefixo = 'MAPA_CHUVA'): string {
```
2. Trocar `const partes = ['MAPA_CHUVA', limpo(fazenda), limpo(periodo)].filter(Boolean);` por `const partes = [prefixo, limpo(fazenda), limpo(periodo)].filter(Boolean);`.

- [ ] **Step 4: Rodar e ver passar; suíte inteira**

Run: `npx vitest run tests/render-variedade.test.ts && npx tsc --noEmit -p . && npx vitest run`
Expected: tudo PASS (os testes de desenho do mapa de chuva sem mudança).

- [ ] **Step 5: Commit (local)**

```bash
git add modulos/mapas/src/render modulos/mapas/src/lib/exportar.ts modulos/mapas/tests/render-variedade.test.ts
git commit -m "Mapas: modo variedade no desenho (cor sólida, legenda, painel e nome do arquivo)"
```

---

### Task 5: Telas — novo mapa de variedade, mapas salvos e cadastro de cores

**Files:**
- Create: `modulos/mapas/src/components/editor/useCoresVariedade.ts`
- Create: `modulos/mapas/src/components/editor/TabelaVariedades.tsx`
- Create: `modulos/mapas/src/pages/NovoMapaVariedade.tsx`
- Create: `modulos/mapas/src/pages/CoresVariedades.tsx`
- Modify: `modulos/mapas/src/components/editor/SecaoAparencia.tsx` (prop `modo`)
- Modify: `modulos/mapas/src/pages/Mapas.tsx` (prop `tipo`)
- Modify: `modulos/mapas/src/pages/NovoMapa.tsx` (mapa de variedade aberto em `/mapas/:id` vai para `/variedades/:id`)
- Modify: `modulos/mapas/src/App.tsx` (rotas), `src/lib/embed.ts` (títulos), `src/components/Shell.tsx` (menu fora da casca)
- Test: `modulos/mapas/tests/embed.test.ts` (títulos novos)

**Interfaces:**
- Consumes: Tarefas 2, 3 e 4.
- Produces: rotas `/variedades`, `/variedades/novo`, `/variedades/cores`, `/variedades/:id`; `useCoresVariedade(feicoes, fixas)`; `Mapas` com `tipo?: TipoMapa`; `SecaoAparencia` com `modo?: 'chuva' | 'variedade'`.

- [ ] **Step 1: Títulos das rotas (teste primeiro)**

Em `tests/embed.test.ts`, no teste de `tituloDaRota`, acrescentar:
```ts
    expect(tituloDaRota('/variedades/novo')).toBe('Novo mapa de variedade');
    expect(tituloDaRota('/variedades')).toBe('Mapas de variedade');
    expect(tituloDaRota('/variedades/cores')).toBe('Cores das variedades');
    expect(tituloDaRota('/variedades/abc-123')).toBe('Mapa de variedade salvo');
```
Run: `npx vitest run tests/embed.test.ts` → FAIL. Em `src/lib/embed.ts`, na função `tituloDaRota`, antes de `if (r === '/mapas/novo') return 'Novo mapa de chuva';`, acrescentar:
```ts
  if (r === '/variedades/novo') return 'Novo mapa de variedade';
  if (r === '/variedades') return 'Mapas de variedade';
  if (r === '/variedades/cores') return 'Cores das variedades';
  if (r.startsWith('/variedades/')) return 'Mapa de variedade salvo';
```
Run de novo → PASS.

- [ ] **Step 2: `useCoresVariedade.ts`**

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { repo } from '../../data';
import { coresNovas, juntarCores, variedadesSemCor, type FeicaoVariedade } from '../../lib/variedades';
import { mensagemDeErro } from '../Aviso';

/**
 * Cores das variedades do mapa: lê o cadastro (mapas_variedade_cores) uma vez e, para as variedades do mapa sem
 * cor, calcula a cor automática e grava (só cria; se outra pessoa gravou antes, vale a dela). `fixas` = cores de
 * um mapa salvo (prevalecem). Sem o cadastro (erro de leitura ou de gravação), as cores calculadas valem só neste
 * mapa e `aviso` explica. `cores` null = ainda lendo o cadastro.
 */
export function useCoresVariedade(feicoes: FeicaoVariedade[], fixas: Record<string, string> | null): { cores: Map<string, string> | null; aviso: string | null } {
  const [cadastro, setCadastro] = useState<Map<string, string> | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** chaves já pedidas ao banco nesta tela (não pede duas vezes) */
  const pedidas = useRef(new Set<string>());

  useEffect(() => {
    let ativo = true;
    repo()
      .listarCoresVariedade()
      .then((lista) => ativo && setCadastro(new Map(lista.map((c) => [c.variedade, c.cor]))))
      .catch((e) => {
        if (!ativo) return;
        setCadastro(new Map());
        setAviso(`Não foi possível ler as cores das variedades (${mensagemDeErro(e)}): as cores deste mapa são provisórias.`);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const cores = useMemo(() => (cadastro ? juntarCores(cadastro, fixas) : null), [cadastro, fixas]);

  useEffect(() => {
    if (!cores) return;
    const faltam = variedadesSemCor(feicoes, cores).filter((k) => !pedidas.current.has(k));
    if (!faltam.length) return;
    const novas = coresNovas(faltam, cores);
    faltam.forEach((k) => pedidas.current.add(k));
    // a cor calculada vale na hora; a gravada (ou a de quem gravou antes) substitui quando o banco responder
    setCadastro((c) => new Map([...(c ?? []), ...novas]));
    for (const [variedade, cor] of novas) {
      repo()
        .criarCorVariedade(variedade, cor)
        .then((salva) => {
          if (salva.cor !== cor) setCadastro((c) => new Map(c ?? []).set(variedade, salva.cor));
        })
        .catch((e) => setAviso(`Não foi possível gravar a cor de ${variedade} (${mensagemDeErro(e)}): a cor vale só neste mapa.`));
    }
  }, [cores, feicoes]);

  return { cores, aviso };
}
```

- [ ] **Step 3: `TabelaVariedades.tsx`**

```tsx
import { csvVariedadePorTalhao, fmtAreaHa, type FeicaoVariedade } from '../../lib/variedades';
import { baixarArquivo } from '../../lib/exportar';
import { fmtDataHora } from '../../lib/situacaoPlantio';
import type { ResumoVariedades } from '../../lib/types';

interface Props {
  resumo: ResumoVariedades;
  feicoes: FeicaoVariedade[];
  nomeArquivo: string;
  /** ISO da última atualização do plantio do PIMS; null = sem PIMS para a safra */
  geradoEm: string | null;
}

/** Seção "2. Variedades": cor, nome, área, % e talhões, e o CSV dos talhões. */
export default function TabelaVariedades({ resumo, feicoes, nomeArquivo, geradoEm }: Props) {
  const exportar = () => {
    const blob = new Blob(['﻿' + csvVariedadePorTalhao(feicoes)], { type: 'text/csv;charset=utf-8' });
    baixarArquivo(blob, nomeArquivo);
  };
  const pims = fmtDataHora(geradoEm, true);
  return (
    <div className="pilha">
      <p className="suave">{pims ? `Plantio do PIMS atualizado em ${pims}.` : 'Sem plantio do PIMS para esta fazenda e safra: os talhões saem como "Sem variedade".'}</p>
      <table className="tabela">
        <thead>
          <tr>
            <th aria-label="Cor" />
            <th>Variedade</th>
            <th className="num">Área (ha)</th>
            <th className="num">%</th>
            <th className="num">Talhões</th>
          </tr>
        </thead>
        <tbody>
          {resumo.itens.map((i) => (
            <tr key={i.chave || 'sem'}>
              <td><span className="amostra-cor" style={{ background: i.cor }} /></td>
              <td>{i.nome}</td>
              <td className="num">{fmtAreaHa(i.areaHa)}</td>
              <td className="num">{i.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
              <td className="num">{i.talhoes}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <th>Total</th>
            <th className="num">{fmtAreaHa(resumo.totalHa)}</th>
            <th className="num">100</th>
            <th className="num">{feicoes.length}</th>
          </tr>
        </tfoot>
      </table>
      <div>
        <button type="button" className="botao botao-pequeno" onClick={exportar} disabled={!feicoes.length}>
          Baixar CSV dos talhões
        </button>
      </div>
    </div>
  );
}
```
Em `src/components/editor/editor.css`, acrescentar no fim:
```css
/* amostra da cor da variedade (tabela do mapa de variedade e cadastro de cores) */
.amostra-cor { display: inline-block; width: 18px; height: 12px; border-radius: 2px; border: 1px solid #8a8a8a; vertical-align: middle; }
```

- [ ] **Step 4: `SecaoAparencia` com `modo`**

1. Em `interface Props`, acrescentar `/** 'variedade' esconde as opções que só valem para a chuva (escala de cores, plantados, PICs, legenda compacta) */ modo?: 'chuva' | 'variedade';`.
2. Trocar `export function SecaoAparencia({ config, onChange, paletaAutomatica }: Props) {` por `export function SecaoAparencia({ config, onChange, paletaAutomatica, modo = 'chuva' }: Props) {` e, logo abaixo, `const chuva = modo === 'chuva';`.
3. Envolver os três `<label className="campo">` de "Escala de cores", "Talhões plantados" e "Destaque do valor dos PICs" em `{chuva && (<>…</>)}`.
4. Trocar as linhas de `marca('mostrarValoresPics', …)` e `marca('legendaCompacta', …)` por `{chuva && marca('mostrarValoresPics', 'Mostrar chuva de cada PIC')}` e `{chuva && marca('legendaCompacta', 'Legenda só com as classes presentes no mapa')}`.

- [ ] **Step 5: `NovoMapaVariedade.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import AtualizarPlantio from '../components/AtualizarPlantio';
import Carregando from '../components/Carregando';
import PreviaLayout from '../components/editor/PreviaLayout';
import PainelTextos from '../components/editor/PainelTextos';
import SecaoFazenda from '../components/editor/SecaoFazenda';
import TabelaVariedades from '../components/editor/TabelaVariedades';
import { SecaoAparencia } from '../components/editor/SecaoAparencia';
import { useCadastros, useLogo } from '../components/editor/hooks';
import { useCoresVariedade } from '../components/editor/useCoresVariedade';
import { useMapaPlantio, useTalhoesEPlantio } from '../components/editor/usePlantioMapa';
import { usePreSelecaoCoa } from '../components/editor/usePreSelecaoCoa';
import '../components/editor/editor.css';
import { aparenciaDoMapaSalvo, layoutPadrao } from '../lib/editor';
import { editarTexto } from '../lib/editorRegras';
import { fazendasDoCoa } from '../lib/embed';
import { baixarArquivo, DPI_OPCOES, DPI_PADRAO, gerarCopiaHistorico, gerarPng, nomeArquivoMapa } from '../lib/exportar';
import { DPI_HISTORICO, identidadeMapa, type ModoSalvar } from '../lib/historico';
import type { LayoutConfig, LayoutTextos, MapaSalvo, Palette } from '../lib/types';
import { coresDasFeicoes, feicoesDoMapa, resumoDoMapaVariedade, resumoVariedades, textosAutomaticosVariedade } from '../lib/variedades';
import { composicaoDe, extentsDosQuadros, TILES, type RenderInput } from '../render';

type Aparencia = Omit<LayoutConfig, 'textos'>;
/** o mapa de variedade não usa escala de cores de chuva */
const PALETA_VAZIA: Palette = { id: 'variedade', nome: 'Variedade', classes: [] };
const SEM_SITUACAO = new Map();

/** Novo mapa de variedade (e mapa de variedade salvo, em /variedades/:id). */
export default function NovoMapaVariedade() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fazendas, safras, erro: erroCadastros } = useCadastros();
  const [fazendaId, setFazendaId] = useState('');
  const [safraId, setSafraId] = useState('');
  const [setores, setSetores] = useState<string[] | null>(null);
  const [aparencia, setAparencia] = useState<Aparencia>(() => {
    const { textos: _t, ...resto } = layoutPadrao();
    return { ...resto, mostrarValoresPics: false };
  });
  const [editados, setEditados] = useState<Partial<LayoutTextos>>({});
  const [dpi, setDpi] = useState<number>(DPI_PADRAO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>((location.state as { msg?: string } | null)?.msg ?? null);
  const [avisosRender, setAvisosRender] = useState<string[]>([]);
  const [mapaAtual, setMapaAtual] = useState<MapaSalvo | null>(null);
  const abertoRef = useRef<string | null>(null);
  const logo = useLogo();

  const fazenda = fazendas?.find((f) => f.id === fazendaId) ?? null;
  const safra = safras.find((s) => s.id === safraId) ?? null;
  const plantio = useTalhoesEPlantio(fazendaId, safraId, fazenda, safra);
  const { talhoes, carregando, erro: erroTalhoes } = plantio;
  const { setoresDisponiveis, talhoesUsados, areasUsadas, situacao: sitPlantio } = useMapaPlantio(plantio, setores);

  // Reabrir um mapa de variedade salvo (/variedades/:id); um de chuva vai para /mapas/:id
  useEffect(() => {
    if (!id || abertoRef.current === id) return;
    let ativo = true;
    repo()
      .obterMapa(id)
      .then((m) => {
        if (!ativo) return;
        if (!m) return setErro('Mapa não encontrado no histórico.');
        if (m.tipo !== 'variedade') return navigate(`/mapas/${m.id}`, { replace: true });
        abertoRef.current = m.id;
        setMapaAtual(m);
        setFazendaId(m.fazendaId);
        setSafraId(m.safraId ?? '');
        setSetores(m.config.setores ?? null);
        setAparencia(aparenciaDoMapaSalvo(m.config));
        setEditados(m.config.textosEditados ?? m.config.textos);
      })
      .catch((e) => ativo && setErro(`Não foi possível abrir o mapa: ${mensagemDeErro(e)}`));
    return () => {
      ativo = false;
    };
  }, [id, navigate]);

  const feicoes = useMemo(() => feicoesDoMapa(talhoesUsados, areasUsadas, plantio.efetivos, plantio.pims), [talhoesUsados, areasUsadas, plantio.efetivos, plantio.pims]);
  const fixas = mapaAtual?.config.coresVariedade ?? null;
  const { cores, aviso: avisoCores } = useCoresVariedade(feicoes, fixas);
  const resumo = useMemo(() => (cores ? resumoVariedades(feicoes, cores) : null), [feicoes, cores]);

  const automaticos = useMemo(
    () => textosAutomaticosVariedade({ fazenda: fazenda?.nome ?? '', safra, setores, hoje: new Date() }),
    [fazenda, safra, setores],
  );
  const textos: LayoutTextos = { ...automaticos, ...editados };

  const renderInput: RenderInput | null = useMemo(() => {
    if (!talhoesUsados.length || !resumo) return null;
    const usadas = Object.fromEntries(resumo.itens.filter((i) => i.chave).map((i) => [i.chave, i.cor]));
    return {
      config: { ...aparencia, textos, setores, textosEditados: editados, coresVariedade: usadas },
      palette: PALETA_VAZIA,
      grid: null,
      talhoes: talhoesUsados,
      situacoes: SEM_SITUACAO,
      areasCultura: areasUsadas,
      plantioGeradoEm: plantio.geradoEm,
      resumo: null,
      nomeSafra: safra?.nome ?? '',
      pics: [],
      logo,
      tiles: aparencia.mapaBase === 'nenhum' ? null : TILES[aparencia.mapaBase],
      variedades: { cores: coresDasFeicoes(feicoes, resumo), resumo },
    };
    // textos é derivado de automaticos + editados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aparencia, automaticos, editados, setores, talhoesUsados, areasUsadas, plantio.geradoEm, safra, logo, feicoes, resumo]);

  const extentEfetivo = useMemo(() => {
    if (!renderInput) return null;
    const comp = composicaoDe(renderInput);
    return comp.quadros.length === 1 ? extentsDosQuadros(renderInput, comp)[0] : null;
  }, [renderInput]);

  const trocarFazenda = (idF: string) => {
    setFazendaId(idF);
    setSetores(null);
    setAparencia((a) => ({ ...a, extent: null }));
  };
  const coa = usePreSelecaoCoa(fazendas, fazendaId, !id, trocarFazenda);
  const trocarSetores = (novos: string[] | null) => {
    setSetores(novos);
    setAparencia((a) => ({ ...a, extent: null }));
  };

  const nomeArquivo = nomeArquivoMapa(textos.fazenda || 'fazenda', textos.safra, 'png', 'MAPA_VARIEDADE');

  const baixar = async () => {
    if (!renderInput) return;
    setErro(null);
    setOcupado(`Gerando PNG em ${dpi} dpi…`);
    try {
      const { blob, avisos } = await gerarPng(renderInput, dpi);
      setAvisosRender(avisos);
      baixarArquivo(blob, nomeArquivo);
    } catch (e) {
      setErro(`Falha ao gerar o PNG: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async (modo: ModoSalvar) => {
    if (!renderInput || !resumo || !fazenda) return;
    setErro(null);
    setOcupado('Salvando no histórico…');
    try {
      const { imagem, miniatura, avisos } = await gerarCopiaHistorico(renderInput, DPI_HISTORICO);
      setAvisosRender(avisos);
      const m: MapaSalvo = {
        ...identidadeMapa(modo, mapaAtual, new Date(), () => crypto.randomUUID()),
        tipo: 'variedade',
        fazendaId: fazenda.id,
        safraId: safra?.id ?? null,
        titulo: `${fazenda.nome} · ${textos.safra || 'sem safra'}`,
        periodoInicio: null,
        periodoFim: null,
        config: renderInput.config,
        pics: [],
        resumo: resumoDoMapaVariedade(resumo),
        pngPath: null,
        thumbPath: null,
      };
      const salvo = await repo().salvarMapa(m, imagem, miniatura);
      const copia = !!mapaAtual && salvo.id !== mapaAtual.id;
      abertoRef.current = salvo.id;
      setMapaAtual(salvo);
      const msg = copia ? 'Salvo como um novo mapa no histórico (o anterior continua lá).' : mapaAtual ? 'Mapa atualizado no histórico.' : 'Mapa salvo no histórico.';
      setSucesso(msg);
      if (!id) navigate(`/variedades/${salvo.id}`, { replace: true, state: { msg } });
      else if (copia) navigate(`/variedades/${salvo.id}`);
    } catch (e) {
      setErro(`Não foi possível salvar: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  if (!fazendas) return <Carregando texto="Carregando cadastros…" />;

  const pronto = !!renderInput && !ocupado;
  const dicaBotoes = pronto ? undefined : ocupado ? 'Aguarde terminar' : 'Escolha a fazenda e a safra';
  const avisos = [...(avisoCores ? [avisoCores] : []), ...avisosRender];

  return (
    <div className="pagina pagina-editor">
      <AtualizarPlantio />
      <div className="pagina-cabecalho">
        <div>
          <h1>{id ? 'Editar mapa de variedade' : 'Novo mapa de variedade'}</h1>
          <p className="subtitulo">Plantio do PIMS → cada talhão na cor da sua variedade → layout COA em PNG</p>
        </div>
        <div className="linha">
          <label className="linha" title={`Resolução do PNG baixado (a cópia do histórico é sempre JPEG em ${DPI_HISTORICO} dpi)`}>
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="Resolução do PNG baixado">
              {DPI_OPCOES.map((d) => (
                <option key={d} value={d}>
                  {d} dpi{d === DPI_PADRAO ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          </label>
          {id ? (
            <>
              <button type="button" className="botao" disabled={!pronto || !mapaAtual} title={dicaBotoes ?? 'Regrava este mapa no histórico (mantém a data de criação)'} onClick={() => void salvar('atualizar')}>
                Atualizar este mapa
              </button>
              <button type="button" className="botao" disabled={!pronto} title={dicaBotoes ?? 'Guarda como outro mapa; este continua no histórico como está'} onClick={() => void salvar('novo')}>
                Salvar como novo
              </button>
            </>
          ) : (
            <button type="button" className="botao" disabled={!pronto} title={dicaBotoes} onClick={() => void salvar('novo')}>
              Salvar no histórico
            </button>
          )}
          <button type="button" className="botao botao-primario" disabled={!pronto} title={dicaBotoes} onClick={() => void baixar()}>
            Baixar PNG
          </button>
        </div>
      </div>

      {[erroCadastros, erroTalhoes, erro].filter(Boolean).map((m, i) => (
        <Aviso key={i} tipo="erro">
          {m}
        </Aviso>
      ))}
      {sucesso && (
        <Aviso tipo="sucesso" onFechar={() => setSucesso(null)}>
          {sucesso}
        </Aviso>
      )}
      {avisos.length > 0 && (
        <Aviso tipo="alerta" titulo="Atenção">
          <ul>
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Aviso>
      )}

      <div className="editor">
        <div className="editor-lado">
          <SecaoFazenda
            fazendas={fazendasDoCoa(fazendas, coa, fazendaId)}
            coa={coa}
            safras={safras}
            fazendaId={fazendaId}
            safraId={safraId}
            onFazenda={trocarFazenda}
            onSafra={setSafraId}
            carregando={carregando}
            totalTalhoes={talhoes.length}
            plantio={{ ...plantio, contagem: sitPlantio.contagem, usaAreas: areasUsadas.length > 0 }}
            setoresDisponiveis={setoresDisponiveis}
            setores={setores}
            onSetores={trocarSetores}
          />

          <section className="cartao pilha">
            <h2>2. Variedades</h2>
            {resumo ? (
              <TabelaVariedades resumo={resumo} feicoes={feicoes} nomeArquivo={nomeArquivo.replace(/\.png$/, '_TALHOES.csv')} geradoEm={plantio.geradoEm} />
            ) : (
              <p className="suave">{fazendaId && safraId ? 'Lendo as cores das variedades…' : 'Escolha a fazenda e a safra.'}</p>
            )}
          </section>

          <section className="cartao pilha">
            <h2>3. Textos do layout</h2>
            <PainelTextos
              textos={textos}
              editados={editados}
              onChange={(campo, valor) => setEditados((e) => editarTexto(e, automaticos, campo, valor))}
              onRestaurar={() => setEditados({})}
            />
          </section>

          <section className="cartao pilha">
            <h2>4. Aparência</h2>
            <SecaoAparencia modo="variedade" config={aparencia} onChange={(p) => setAparencia((a) => ({ ...a, ...p }))} paletaAutomatica={null} />
          </section>
        </div>

        <div className="editor-principal">
          <section className="cartao">
            <PreviaLayout
              input={renderInput}
              extent={extentEfetivo}
              automatico={aparencia.extent === null}
              onExtentChange={(ext) => setAparencia((a) => ({ ...a, extent: ext }))}
              ocupado={ocupado}
              onAvisos={setAvisosRender}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `CoresVariedades.tsx`** (cadastro, administrador)

```tsx
import { useEffect, useState } from 'react';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import '../components/editor/editor.css';
import type { CorVariedade } from '../lib/types';

/** Cadastro de cores das variedades: trocar a cor ou apagar uma variedade (administrador). */
export default function CoresVariedades() {
  const [lista, setLista] = useState<CorVariedade[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  const carregar = () =>
    repo()
      .listarCoresVariedade()
      .then(setLista)
      .catch((e) => {
        setErro(`Não foi possível ler as cores: ${mensagemDeErro(e)}`);
        setLista([]);
      });
  useEffect(() => {
    void carregar();
  }, []);

  const trocar = async (variedade: string, cor: string) => {
    setErro(null);
    try {
      await repo().trocarCorVariedade(variedade, cor.toUpperCase());
    } catch (e) {
      setErro(`Não foi possível trocar a cor de ${variedade}: ${mensagemDeErro(e)}`);
    }
    await carregar();
  };
  const apagar = async (variedade: string) => {
    if (!window.confirm(`Apagar ${variedade} do cadastro de cores? Se ela aparecer de novo num mapa, ganha uma cor automática.`)) return;
    setErro(null);
    try {
      await repo().excluirCorVariedade(variedade);
    } catch (e) {
      setErro(`Não foi possível apagar ${variedade}: ${mensagemDeErro(e)}`);
    }
    await carregar();
  };

  const t = filtro.trim().toUpperCase();
  const visiveis = (lista ?? []).filter((c) => !t || c.variedade.includes(t));

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>Cores das variedades</h1>
          <p className="subtitulo">A mesma variedade sai com a mesma cor em todos os mapas de variedade. Troque a cor aqui.</p>
        </div>
      </div>
      {erro && (
        <Aviso tipo="erro" onFechar={() => setErro(null)}>
          {erro}
        </Aviso>
      )}
      {!lista ? (
        <Carregando texto="Carregando cores…" />
      ) : lista.length === 0 ? (
        <div className="cartao vazio">
          <p>Nenhuma variedade ainda. As cores são criadas sozinhas no primeiro mapa de variedade de cada uma.</p>
        </div>
      ) : (
        <section className="cartao pilha">
          <input type="search" placeholder="Filtrar pela variedade…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar variedades" />
          <table className="tabela">
            <thead>
              <tr>
                <th>Cor</th>
                <th>Variedade</th>
                <th>Criada em</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.variedade}>
                  <td>
                    <input type="color" value={c.cor} aria-label={`Cor de ${c.variedade}`} onChange={(e) => void trocar(c.variedade, e.target.value)} />
                  </td>
                  <td>{c.variedade}</td>
                  <td>{new Date(c.criadoEm).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void apagar(c.variedade)}>
                      Apagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 7: `Mapas.tsx` com `tipo`**

1. Imports: acrescentar `TipoMapa` ao import de `../lib/types` e `import { fmtAreaHa } from '../lib/variedades';`.
2. Antes de `/** Histórico de mapas gerados. */`, acrescentar:
```tsx
const TEXTOS: Record<TipoMapa, { titulo: string; base: string; vazio: string; prefixo: string }> = {
  chuva: { titulo: 'Mapas de chuva', base: '/mapas', vazio: 'com o CSV da ZEUS', prefixo: 'MAPA_CHUVA' },
  variedade: { titulo: 'Mapas de variedade', base: '/variedades', vazio: 'de uma fazenda e safra', prefixo: 'MAPA_VARIEDADE' },
};
```
3. Trocar `/** Histórico de mapas gerados. */` e a linha `export default function Mapas() {` por:
```tsx
/** Histórico de mapas gerados (de chuva ou de variedade). */
export default function Mapas({ tipo = 'chuva' }: { tipo?: TipoMapa }) {
  const tx = TEXTOS[tipo];
```
4. Trocar `r.listarMapas(), r.listarFazendas()` por `r.listarMapas(tipo), r.listarFazendas()` e, no fim do primeiro `useEffect` (o que revoga as `urls`), `}, []);` por `}, [tipo]);`.
5. Em `baixar`, trocar `nomeArquivoMapa(fazenda, m.config.textos.periodo, extensaoImagem(blob.type))` por `nomeArquivoMapa(fazenda, tipo === 'variedade' ? m.config.textos.safra : m.config.textos.periodo, extensaoImagem(blob.type), tx.prefixo)`.
6. Trocar `<h1>Mapas de chuva</h1>` por `<h1>{tx.titulo}</h1>` e `<Link to="/mapas/novo" className="botao botao-primario">` por ``<Link to={`${tx.base}/novo`} className="botao botao-primario">``.
7. Na lista vazia, trocar as duas frases (a primeira está quebrada em duas linhas):
```tsx
              Comece cadastrando uma <Link to="/fazendas/nova">fazenda</Link>, depois crie um <Link to="/mapas/novo">novo mapa</Link> com o CSV
              da ZEUS.
```
por
```tsx
              Comece cadastrando uma <Link to="/fazendas/nova">fazenda</Link>, depois crie um <Link to={`${tx.base}/novo`}>novo mapa</Link> {tx.vazio}.
```
e `Crie um <Link to="/mapas/novo">novo mapa</Link> com o CSV da ZEUS.` por ``Crie um <Link to={`${tx.base}/novo`}>novo mapa</Link> {tx.vazio}.``
8. Trocar as duas ocorrências de ``<Link to={`/mapas/${mapa.id}`}`` (miniatura e botão "Abrir") por ``<Link to={`${tx.base}/${mapa.id}`}``.
9. No primeiro `<span className="suave">` do cartão, trocar as duas linhas do período:
```tsx
                    {fmtPeriodo(parseIsoData(mapa.periodoInicio), parseIsoData(mapa.periodoFim)) || 'sem período'}
                    {nomeSafra(mapa.safraId) ? ` · ${nomeSafra(mapa.safraId)}` : ''}
```
por (variedade: só a safra)
```tsx
                    {tipo === 'variedade'
                      ? nomeSafra(mapa.safraId) || 'sem safra'
                      : `${fmtPeriodo(parseIsoData(mapa.periodoInicio), parseIsoData(mapa.periodoFim)) || 'sem período'}${nomeSafra(mapa.safraId) ? ` · ${nomeSafra(mapa.safraId)}` : ''}`}
```
10. Trocar o segundo `<span className="suave">` do cartão (o da média):
```tsx
                  <span className="suave">
                    Média {mm(mapa.resumo.geral.media)} mm
                    {mapa.resumo.plantado ? ` · plantado ${mm(mapa.resumo.plantado.media)} mm` : ''} · criado em {dataCurta(mapa.criadoEm)}
                  </span>
```
pela versão por tipo:
```tsx
                  <span className="suave">
                    {tipo === 'variedade'
                      ? `${mapa.resumo.variedades?.itens.filter((i) => i.chave).length ?? 0} variedades · ${fmtAreaHa(mapa.resumo.variedades?.totalHa ?? 0)} ha`
                      : `Média ${mm(mapa.resumo.geral.media)} mm${mapa.resumo.plantado ? ` · plantado ${mm(mapa.resumo.plantado.media)} mm` : ''}`}
                    {` · criado em ${dataCurta(mapa.criadoEm)}`}
                  </span>
```

- [ ] **Step 8: `NovoMapa.tsx`** — no `then` do `obterMapa`, depois de `if (!m) return setErro('Mapa não encontrado no histórico.');`, acrescentar:
```tsx
        // um mapa de variedade aberto pelo endereço do de chuva vai para a tela dele
        if (m.tipo === 'variedade') return navigate(`/variedades/${m.id}`, { replace: true });
```
e trocar o array de dependências `}, [id]);` desse `useEffect` por `}, [id, navigate]);`.

- [ ] **Step 9: Rotas e menu fora da casca**

`src/App.tsx`:
1. Depois de `const NovoMapa = lazy(() => import('./pages/NovoMapa'));`, acrescentar:
```tsx
const NovoMapaVariedade = lazy(() => import('./pages/NovoMapaVariedade'));
const CoresVariedades = lazy(() => import('./pages/CoresVariedades'));
```
2. Trocar `<Route path="/mapas" element={<Tela><Mapas /></Tela>} />` por `<Route path="/mapas" element={<Tela><Mapas key="chuva" tipo="chuva" /></Tela>} />` e, depois de `<Route path="/mapas/:id" … />`, acrescentar:
```tsx
              <Route path="/variedades" element={<Tela><Mapas key="variedade" tipo="variedade" /></Tela>} />
              <Route path="/variedades/novo" element={<Tela><NovoMapaVariedade key="novo" /></Tela>} />
              <Route path="/variedades/:id" element={<Tela><NovoMapaVariedade key="salvo" /></Tela>} />
```
3. Dentro do `<Route element={<SomenteAdmin />}>`, depois da rota de `/safras/:safraId/areas/:fazendaId`, acrescentar `<Route path="/variedades/cores" element={<Tela><CoresVariedades /></Tela>} />`. (Rota fixa ganha da `/variedades/:id` no React Router.)

`src/components/Shell.tsx`, em `ITENS`, depois do item `'/mapas/novo'`, acrescentar:
```tsx
  {
    para: '/variedades',
    texto: 'Mapas de variedade',
    icone: svg(
      <>
        <path d="M12 21v-9" />
        <path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z" />
        <path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z" />
      </>,
    ),
    ativo: (c) => c === '/variedades' || (c.startsWith('/variedades/') && c !== '/variedades/novo' && c !== '/variedades/cores'),
  },
  {
    para: '/variedades/novo',
    texto: 'Novo mapa de variedade',
    icone: svg(
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </>,
    ),
    ativo: (c) => c === '/variedades/novo',
  },
  {
    para: '/variedades/cores',
    texto: 'Cores das variedades',
    icone: svg(
      <>
        <circle cx="13.5" cy="6.5" r="1.5" />
        <circle cx="17.5" cy="10.5" r="1.5" />
        <circle cx="8.5" cy="7.5" r="1.5" />
        <path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 10c0-4.4-4.5-8-10-8Z" />
      </>,
    ),
    ativo: (c) => c === '/variedades/cores',
    admin: true,
  },
```

- [ ] **Step 10: Rodar tudo**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: tudo PASS, sem erro de tipos.

- [ ] **Step 11: Commit (local)**

```bash
git add modulos/mapas/src modulos/mapas/tests/embed.test.ts
git commit -m "Mapas: telas do mapa de variedade (novo mapa, mapas salvos e cores das variedades)"
```

---

### Task 6: Casca — menu do Mapas

**Files:**
- Modify: `index.html` (raiz; `#nav-mapas` e o subtítulo dos cadastros)

- [ ] **Step 1: Menu**

No bloco `<div id="nav-mapas" …>`, depois do `</nav>` da seção "Mapa de Chuva" e antes de `<div class="nav-eyebrow admin-only">Cadastros</div>`, acrescentar:
```html
      <div class="nav-eyebrow">Mapa de Variedade</div>
      <nav>
        <button class="nav-btn" data-page="mapas" data-rota="/variedades/novo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>Novo mapa</button>
        <button class="nav-btn" data-page="mapas" data-rota="/variedades"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13.5M15 6.5V20"/></svg>Mapas salvos</button>
      </nav>
```
E, dentro do `<nav class="admin-only">` de "Cadastros", depois do botão de `/safras`, acrescentar:
```html
        <button class="nav-btn admin-only" data-page="mapas" data-rota="/variedades/cores"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 10c0-4.4-4.5-8-10-8Z"/></svg>Cores das variedades</button>
```

- [ ] **Step 2: Subtítulo** — trocar `/^\/(fazendas|safras)(\/|$)/` por `/^\/(fazendas|safras|variedades\/cores)(\/|$)/` na linha do `subtitulo = 'Cadastros dos mapas'`.

- [ ] **Step 3: Conferir** — `node -e "const fs=require('fs');const vm=require('vm');const h=fs.readFileSync('index.html','utf8');let n=0;for(const m of h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)){new vm.Script(m[1]);n++}console.log(n+' bloco ok')"` → `1 bloco ok`; `git ls-files --eol index.html` → `i/lf`; `git diff --stat -- index.html` só com as linhas esperadas.

- [ ] **Step 4: Commit (local)**

```bash
git add index.html
git commit -m "Casca: seção Mapa de Variedade e Cores das variedades no menu do Mapas"
```

---

### Task 7: Conferência local e build

**Files:** nenhum novo (build em `mapas/` na Tarefa 8).

- [ ] **Step 1: Modo local** — subir `coa-mapas-dev` (porta 5175) e abrir `http://localhost:5175/#/variedades/novo`. Conferir, com o cadastro padrão do modo local:
  1. escolher fazenda e safra; a seção "2. Variedades" lista as variedades com cor, área, % e talhões, e "Sem variedade" por último;
  2. a prévia pinta cada talhão na cor da variedade, com o rótulo, a legenda "Variedades" e o painel (área total, nº de variedades, plantio PIMS); sem situação do plantio;
  3. filtro de setor recalcula a tabela e a prévia;
  4. "Baixar PNG" (300 dpi), "Baixar CSV dos talhões" e "Salvar no histórico" funcionam; o mapa aparece em `#/variedades` e não em `#/mapas`;
  5. reabrir o mapa salvo, trocar a cor da variedade em `#/variedades/cores` e reabrir: o mapa salvo mantém a cor antiga; um mapa novo usa a nova;
  6. abrir `#/mapas/<id do mapa de variedade>` vai para `#/variedades/<id>`;
  7. o mapa de chuva (`#/mapas/novo`) continua igual;
  8. console sem erro.
- [ ] **Step 2: Imagens com o plantio real desta máquina** (modo local com `public/dados/plantio.json` gerado por `node scripts/sincronizar-plantio.mjs --local`, fora do repositório): PNG de uma fazenda com várias variedades, mostrado ao dono antes de publicar.
- [ ] **Step 3: Build** — `npm run publicar` (testes, tipos, build em `../../mapas`, verificação da publicação). Expected: tudo verde e `mapas/` atualizado.
- [ ] **Step 4: Commit (local)** — `git add mapas && git commit -m "Mapas: build com o mapa de variedade"`.

---

### Task 8: Entrada no ar

- [ ] **Step 1: Autorização e script `0026`** no SQL Editor; conferir com as consultas do fim do script.
- [ ] **Step 2: "pode publicar"** — levar o branch ao `main` (fast-forward), rodar as suítes no `main`, `git push origin main`, apagar o branch; conferir que o site serve o `mapas/index.html` novo e o menu da casca.
- [ ] **Step 3: Teste do dono com login:** um mapa de variedade de uma fazenda, a troca de uma cor em "Cores das variedades" e um mapa salvo.
- [ ] **Step 4: Memória do projeto** (`mapa-chuva-coa.md`): mapa de variedade no ar, commit e o SQL 0026.
