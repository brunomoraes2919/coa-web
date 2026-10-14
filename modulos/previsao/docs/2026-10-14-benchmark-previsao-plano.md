# Benchmark de previsão de chuva — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Benchmark" no módulo Previsão do Tempo que mostra a previsão de chuva de 15 dias da ZEUS, do Visual Crossing e do MET Norway lado a lado, por fazenda, e um ranking de acerto contra a chuva medida pelos pluviômetros da ZEUS.

**Architecture:** A rotina de hora em hora da VM (`modulos/mapas/scripts/sincronizar-plantio.mjs`) ganha a etapa `rodarBenchmarkPrevisao`: registra quando a ZEUS muda a previsão, tira uma foto diária (a partir das 6 h de MT) das três fontes por fazenda, grava a chuva medida de ontem e anteontem e recalcula as métricas uma vez por dia. Tudo vai para quatro tabelas novas do Supabase (script `0024`). A tela (`previsao/`, JS puro) só lê essas tabelas; as contas da tela ficam em `previsao/benchmark-logica.js` (UMD, testado) e o desenho em `previsao/benchmark.js` (ECharts). A casca ganha o botão "Benchmark" no menu da Previsão.

**Tech Stack:** Node ≥ 18 sem dependências (VM), Vitest + TypeScript nos testes do servidor (`modulos/mapas`), JS puro + ECharts 5.5.1 + supabase-js 2.117.3 na tela, `node --test` nos testes da tela, Postgres/Supabase (RLS).

**Spec:** `modulos/previsao/docs/2026-10-14-benchmark-previsao-design.md`

## Global Constraints

- Fontes desta etapa: **só** `zeus`, `visualcrossing`, `metno` (nessa ordem em toda parte). Nada de copiar páginas de sites.
- Dia sempre no fuso de Mato Grosso, **UTC−4 fixo**, calculado no código (nunca pelo fuso da máquina).
- Foto diária a partir das **6 h de MT**; antecedências do ranking **1, 3, 7, 13** e **0 = todos os pares de 1 a 7**; mínimo de **10 pares** para mostrar número.
- Comparação justa: um par (fazenda, dia, antecedência) só conta se **todas** as fontes que já alcançaram aquela antecedência têm previsão para ele; D0 nunca entra.
- Erro médio = média de |previsto − medido| (mm, 1 casa); viés = média de (previsto − medido) (1 casa); acerto = % de pares com (previsto ≥ 1 mm) = (medido ≥ 1 mm) (inteiro).
- Programas da VM: **sem dependência nova** (só Node e `fetch`; `node:crypto` é do Node). Tudo novo do servidor fica em `sincronizar-plantio.mjs` (a VM só baixa três arquivos).
- `VISUALCROSSING_KEY` opcional: sem ela a fonte é pulada. **Nenhuma chave, token ou endereço com chave vai para o log**; o log não leva nome de fazenda (só totais).
- MET Norway: `User-Agent: coa-web-locks/1.0 (https://coa-web-teal.vercel.app)`, coordenadas com 4 casas, 30 s de prazo, parar a fonte na rodada ao receber 403 ou 429.
- Créditos obrigatórios na tela: "Dados de Visual Crossing" e "MET Norway, CC BY 4.0".
- Repositório público: dados de teste e do servidor local sempre **fictícios**.
- Fim de linha: no índice do git tudo é **LF** (`core.autocrlf=true`). Na pasta de trabalho, `previsao/`, `modulos/previsao/`, o `index.html` da raiz e o README do servidor estão em **CRLF**; `sincronizar-plantio.mjs`, `.d.mts`, os testes de `modulos/mapas/tests/` e os scripts de `supabase/` estão em **LF** (`eol=lf`). Não misturar os dois num arquivo; conferir com `git ls-files --eol <arquivo>` (esperado `i/lf`) e com `git diff --stat` (sem o arquivo inteiro trocado). Nunca `sed -i`. Heredoc do Bash come contrabarras: scripts auxiliares vão em arquivo, fora do repositório.
- Toda mudança em arquivo de `previsao/` troca o `?v=` dele em `previsao/index.html`.
- Textos de tela e comentários em português do Brasil, no tom dos existentes. Texto do banco em `innerHTML` sempre por `esc()`.
- Nada de commit no `main` remoto sem autorização: os commits são locais; push só na Tarefa 9, com "pode publicar".

## Review Focus

- **VM rodando em outro fuso ou perto da meia-noite UTC** (00:00–04:00 UTC é o dia anterior em MT): dia e hora de MT têm de sair certos → teste em `diaMT`/`horaMT` com instantes de borda (Tarefa 2) e foto pulada às 05:59 de MT mesmo sendo 09:59 UTC (Tarefa 4).
- **Chave do Visual Crossing ausente, inválida (401) ou estourada (429)**: as outras fontes continuam sendo gravadas, a etapa não falha e a chave (que vai no endereço) não aparece em nenhuma linha de log → teste na Tarefa 4.
- **Fazenda da ZEUS fora do cadastro** ("Semi Confinamento") **e fazenda do cadastro sem pluviômetro**: ficam fora sem quebrar a rodada → teste na Tarefa 2 (`pontosDasFazendas`) e na Tarefa 4.
- **Fonte devolvendo dias incompletos** (último dia do MET Norway cortado, Visual Crossing com menos de 15 dias, ZEUS só até D+13): só dias completos ficam, e o ranking não penaliza ninguém por isso → testes nas Tarefas 2 e 3.
- **Tela sem nenhuma foto ainda, só com a foto de hoje, ou usuário que vê só algumas fazendas**: mensagem clara, sem gráfico vazio quebrado, e sem a opção "Todas" no ranking quando não houver linhas `TODAS` → testes na Tarefa 6 e conferência na Tarefa 7.

---

### Task 1: Banco — script `0024_previsao_benchmark.sql`

**Files:**
- Create: `supabase/0024_previsao_benchmark.sql` (LF, como o 0023)

**Interfaces:**
- Produces: tabelas `prev_previsoes(fonte, unidade, emitida_em, capturada_em, dias jsonb)` PK (fonte, unidade, emitida_em); `prev_observado(unidade, dia, mm, pluviometros)` PK (unidade, dia); `prev_metricas(unidade, periodo, fonte, antecedencia, n, erro_medio, vies, acerto, calculado_em)` PK (unidade, periodo, fonte, antecedencia); `prev_zeus_atualizacoes(capturada_em, assinatura)` PK (capturada_em); função `prev_ve_todas_as_fazendas() returns boolean`.

- [ ] **Step 1: Escrever o script**

```sql
-- COA WEB — Previsão do Tempo, aba "Benchmark": fotos diárias da previsão de chuva de várias fontes, chuva medida
-- pelos pluviômetros da ZEUS e as métricas de acerto (especificação: modulos/previsao/docs/2026-10-14-benchmark-previsao-design.md).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada). Só cria; não altera nada que exista.
-- Depende de: 0002 (tem_categoria), 0004 (categoria 'previsao'), 0020 (tem_alguma_categoria) e de
-- acomp_pode_ver_unidade (modulos/acompanhamento/supabase/0001).
-- Regras no padrão do 0019/0020: uma permissiva por fazenda (com a categoria junto, como a da chuva_talhao) e uma
-- restritiva "<tabela>_categoria". Como desfazer: drop table das quatro e drop function prev_ve_todas_as_fazendas().
-- Quem grava: só a rotina da VM (chave de serviço), em sincronizar-plantio.mjs → rodarBenchmarkPrevisao.
-- Quem lê: logado com a categoria Previsão do Tempo, só das fazendas (unidades do PIMS) que pode ver.

begin;

set local lock_timeout = '5s';

-- uma linha por fonte × fazenda × dia da foto; os até 15 dias previstos vão no JSON (padrão dos retratos)
create table if not exists public.prev_previsoes (
  fonte        text not null check (fonte in ('zeus', 'visualcrossing', 'metno')),
  unidade      text not null,
  emitida_em   date not null,
  capturada_em timestamptz not null,
  -- [{ d: 'AAAA-MM-DD', mm: número, p: probabilidade de chuva (%) ou null }]
  dias         jsonb not null default '[]'::jsonb,
  primary key (fonte, unidade, emitida_em)
);
create index if not exists prev_previsoes_emitida_idx on public.prev_previsoes (emitida_em);

-- chuva medida: média dos pluviômetros da fazenda que leram no dia
create table if not exists public.prev_observado (
  unidade      text not null,
  dia          date not null,
  mm           numeric not null,
  pluviometros int not null,
  primary key (unidade, dia)
);
create index if not exists prev_observado_dia_idx on public.prev_observado (dia);

-- métricas prontas (unidade 'TODAS' = todas as fazendas juntas); recalculadas uma vez por dia
create table if not exists public.prev_metricas (
  unidade      text not null,
  periodo      text not null check (periodo in ('30d', '60d', '90d', 'safra')),
  fonte        text not null check (fonte in ('zeus', 'visualcrossing', 'metno')),
  antecedencia int not null check (antecedencia in (0, 1, 3, 7, 13)),
  n            int not null,
  erro_medio   numeric,
  vies         numeric,
  acerto       numeric,
  calculado_em timestamptz not null,
  primary key (unidade, periodo, fonte, antecedencia)
);

-- quando a ZEUS mudou a previsão (para descobrir a hora em que ela publica)
create table if not exists public.prev_zeus_atualizacoes (
  capturada_em timestamptz primary key,
  assinatura   text not null
);

-- o usuário vê todas as unidades do cadastro do Mapas? (libera as linhas 'TODAS' de prev_metricas)
-- security definer: pela RLS o usuário nem enxerga as fazendas que não pode ver, então a conta não pode ser feita com os olhos dele
create or replace function public.prev_ve_todas_as_fazendas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.mapas_fazendas f
    where f.unidade_pims is not null and not public.acomp_pode_ver_unidade(f.unidade_pims)
  );
$$;
revoke all on function public.prev_ve_todas_as_fazendas() from public, anon;
grant execute on function public.prev_ve_todas_as_fazendas() to authenticated;

alter table public.prev_previsoes enable row level security;
alter table public.prev_observado enable row level security;
alter table public.prev_metricas enable row level security;
alter table public.prev_zeus_atualizacoes enable row level security;
revoke all on table public.prev_previsoes, public.prev_observado, public.prev_metricas, public.prev_zeus_atualizacoes from anon, authenticated;
grant select on table public.prev_previsoes, public.prev_observado, public.prev_metricas, public.prev_zeus_atualizacoes to authenticated;
grant select, insert, update, delete on table public.prev_previsoes, public.prev_observado, public.prev_metricas, public.prev_zeus_atualizacoes to service_role;

drop policy if exists prev_previsoes_select on public.prev_previsoes;
create policy prev_previsoes_select on public.prev_previsoes
  for select to authenticated
  using ((select public.tem_categoria('previsao')) and public.acomp_pode_ver_unidade(unidade));

drop policy if exists prev_observado_select on public.prev_observado;
create policy prev_observado_select on public.prev_observado
  for select to authenticated
  using ((select public.tem_categoria('previsao')) and public.acomp_pode_ver_unidade(unidade));

drop policy if exists prev_metricas_select on public.prev_metricas;
create policy prev_metricas_select on public.prev_metricas
  for select to authenticated
  using (
    (select public.tem_categoria('previsao'))
    and case when unidade = 'TODAS' then (select public.prev_ve_todas_as_fazendas()) else public.acomp_pode_ver_unidade(unidade) end
  );

drop policy if exists prev_zeus_atualizacoes_select on public.prev_zeus_atualizacoes;
create policy prev_zeus_atualizacoes_select on public.prev_zeus_atualizacoes
  for select to authenticated
  using ((select public.tem_categoria('previsao')));

-- restritivas por categoria (padrão do 0020): sem a categoria Previsão do Tempo, nenhuma linha
do $$
declare t text;
begin
  foreach t in array array['prev_previsoes', 'prev_observado', 'prev_metricas', 'prev_zeus_atualizacoes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_categoria', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated
         using ((select public.tem_alguma_categoria(%L::text[])))',
      t || '_categoria', t, array['previsao']);
  end loop;
end;
$$;

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- select tablename, policyname, permissive, cmd from pg_policies where schemaname = 'public' and tablename like 'prev\_%' order by 1, 2;
-- (esperado: 8 regras de SELECT, duas por tabela: "<tabela>_categoria" RESTRICTIVE e "<tabela>_select" PERMISSIVE)
-- select proname, prosecdef from pg_proc where proname = 'prev_ve_todas_as_fazendas';  (esperado: prosecdef = true)
```

- [ ] **Step 2: Conferir o script por leitura**

Conferir, sem rodar no banco: os nomes de função usados existem nos scripts do repositório.

Run: `grep -n "function public.tem_categoria\|function public.tem_alguma_categoria\|function public.acomp_pode_ver_unidade" supabase/*.sql modulos/acompanhamento/supabase/*.sql`
Expected: pelo menos uma definição de cada uma das três (0002, 0020 e acompanhamento/0001).

- [ ] **Step 3: Commit (local)**

```bash
git add supabase/0024_previsao_benchmark.sql
git commit -m "Banco: script 0024 do benchmark de previsão (tabelas prev_*, leitura pela categoria)"
```

---

### Task 2: Rotina — conversão das fontes e da chuva medida

**Files:**
- Modify: `modulos/mapas/scripts/sincronizar-plantio.mjs` (seção nova antes de `// ---------- execução` / da função `modoDeExecucao`; import novo no topo)
- Modify: `modulos/mapas/scripts/sincronizar-plantio.d.mts` (declarações)
- Test: `modulos/mapas/tests/previsao-benchmark-servidor.test.ts` (novo)

**Interfaces:**
- Consumes: `objetosDe`, `txt`, `unidadeDaFazendaZeus`, `fimDaConsulta`, `paginaSqlZeus`, `PAGINA_CONSULTA`, `SQL_PICS_ZEUS` (já existem no arquivo).
- Produces (exportados): `PREV_FONTES: string[]`, `PREV_HORA_FOTO = 6`, `PREV_ANTECEDENCIAS = [0, 1, 3, 7, 13]`, `PREV_MINIMO_PARES = 10`, `PREV_USER_AGENT: string`, `diaMT(instante): string`, `horaMT(instante): number`, `somarDias(dia, n): string`, `diasEntre(a, b): number`, `inicioSafraMT(hoje): string`, `pontosDasFazendas(res, unidades): { pontos: Map<string,{lat,lon}>, fazendaDoPic: Map<string,string> }`, `montarSqlPrevisaoZeus(desde, pular?, tamanho?): string`, `previsaoZeusPorFazenda(res, fazendaDoPic): Map<string, Dia[]>`, `urlVisualCrossing(ponto, chave): string`, `previsaoVisualCrossing(json): Dia[]`, `urlMetNo(ponto): string`, `previsaoMetNo(json): Dia[]`, `montarSqlObservadoZeus(de, ate): string`, `observadoPorFazenda(res, fazendaDoPic): Observado[]`, `assinaturaDaPrevisao(map): string`. Tipos: `Dia = { d: string; mm: number; p: number | null }`, `Observado = { unidade: string; dia: string; mm: number; pluviometros: number }`.

- [ ] **Step 1: Conferir que os nomes novos não existem**

Run: `grep -n -E "function (diaMT|horaMT|somarDias|diasEntre|inicioSafraMT|pontosDasFazendas)\b|PREV_" modulos/mapas/scripts/sincronizar-plantio.mjs`
Expected: nenhuma linha.

- [ ] **Step 2: Escrever os testes (falham)**

Criar `modulos/mapas/tests/previsao-benchmark-servidor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  diaMT, horaMT, somarDias, diasEntre, inicioSafraMT, pontosDasFazendas, previsaoZeusPorFazenda, previsaoVisualCrossing,
  previsaoMetNo, observadoPorFazenda, montarSqlPrevisaoZeus, montarSqlObservadoZeus, urlVisualCrossing, urlMetNo, assinaturaDaPrevisao,
} from '../scripts/sincronizar-plantio.mjs';

// Todos os dados daqui são FICTÍCIOS.
const res = (columns: string[], rows: unknown[][]) => ({ columns, rows });

describe('benchmark de previsão: dia e hora de Mato Grosso', () => {
  it('UTC−4 fixo, inclusive perto da meia-noite UTC', () => {
    expect(diaMT('2026-10-15T03:59:00Z')).toBe('2026-10-14');
    expect(horaMT('2026-10-15T03:59:00Z')).toBe(23);
    expect(diaMT('2026-10-15T04:00:00Z')).toBe('2026-10-15');
    expect(horaMT('2026-10-15T10:17:00Z')).toBe(6);
    expect(horaMT(new Date('2026-10-15T09:59:00Z'))).toBe(5);
  });
  it('soma e diferença de dias, e início da safra (setembro)', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(diasEntre('2026-10-14', '2026-10-27')).toBe(13);
    expect(inicioSafraMT('2026-10-14')).toBe('2026-09-01');
    expect(inicioSafraMT('2027-08-31')).toBe('2026-09-01');
    expect(inicioSafraMT('2026-09-01')).toBe('2026-09-01');
  });
});

describe('benchmark de previsão: fazendas e pontos', () => {
  const PICS = res(['picid', 'picname', 'farm', 'lat', 'lon'], [
    ['10', 'PIC 1', 'Faz. Globo', -13.00001, -56.00004],
    ['11', 'PIC 2', 'Faz. Globo', -13.10001, -56.20004],
    ['12', 'PIC 3', 'Faz. Globo', null, null],
    ['20', 'PIC 9', 'Semi Confinamento', -14, -55],
    ['30', 'PIC 5', 'Fazenda Dourado', -15, -57],
  ]);
  it('ponto = média das coordenadas com 4 casas; fazenda fora do cadastro fica de fora', () => {
    const { pontos, fazendaDoPic } = pontosDasFazendas(PICS, ['GLOBO', 'NEBRASKA']);
    expect([...pontos.keys()]).toEqual(['GLOBO']);
    expect(pontos.get('GLOBO')).toEqual({ lat: -13.05, lon: -56.1 });
    // o pluviômetro sem coordenada não entra no ponto, mas a previsão dele conta para a fazenda
    expect(fazendaDoPic.get('12')).toBe('GLOBO');
    expect(fazendaDoPic.has('20')).toBe(false);
    expect(fazendaDoPic.has('30')).toBe(false);
  });
});

describe('benchmark de previsão: conversão de cada fonte', () => {
  const doPic = new Map([['10', 'GLOBO'], ['11', 'GLOBO']]);
  it('ZEUS: média dos pluviômetros por dia; probabilidade só de quem tem', () => {
    const z = previsaoZeusPorFazenda(res(['picid', 'dia', 'mm', 'prob'], [
      ['10', '2026-10-14', 4, 80], ['11', '2026-10-14', 6, null], ['10', '2026-10-15', 0, 10], ['99', '2026-10-15', 50, 99],
    ]), doPic);
    expect(z.get('GLOBO')).toEqual([{ d: '2026-10-14', mm: 5, p: 80 }, { d: '2026-10-15', mm: 0, p: 10 }]);
    expect(z.size).toBe(1);
  });
  it('SQL da ZEUS: só de hoje em diante, paginável', () => {
    expect(montarSqlPrevisaoZeus('2026-10-14')).toContain(`day::date >= DATE '2026-10-14'`);
    expect(montarSqlPrevisaoZeus('2026-10-14', 0, 4000)).toMatch(/ORDER BY 1, 2\s+OFFSET 0 LIMIT 4000$/);
  });
  it('Visual Crossing: mm com 1 casa e probabilidade inteira; dia inválido sai', () => {
    expect(previsaoVisualCrossing({ days: [
      { datetime: '2026-10-14', precip: 2.34, precipprob: 55.4 },
      { datetime: '2026-10-15', precip: 0, precipprob: null },
      { datetime: 'amanhã', precip: 3 },
      { datetime: '2026-10-17', precip: 'x' },
    ] })).toEqual([{ d: '2026-10-14', mm: 2.3, p: 55 }, { d: '2026-10-15', mm: 0, p: null }]);
    expect(previsaoVisualCrossing(null)).toEqual([]);
  });
  it('Visual Crossing e MET Norway: endereços (a chave vai codificada; coordenadas com 4 casas)', () => {
    expect(urlVisualCrossing({ lat: -13.05, lon: -56.1 }, 'a b')).toBe(
      'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/-13.05,-56.1?unitGroup=metric&include=days&contentType=json&key=a%20b');
    expect(urlMetNo({ lat: -13.05, lon: -56.1 })).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-13.05&lon=-56.1');
  });
  it('MET Norway: blocos de 6 h repartidos pela meia-noite de MT; só dias com 24 h', () => {
    const bloco = (time: string, mm: number) => ({ time, data: { next_6_hours: { details: { precipitation_amount: mm } } } });
    const serie = [];
    for (const dia of ['16', '17', '18']) for (const h of ['00', '06', '12', '18']) {
      serie.push(bloco(`2026-10-${dia}T${h}:00:00Z`, dia === '17' && h === '00' ? 12 : 6));
    }
    // 00Z do dia 16 = 20 h do dia 15 em MT: o dia 15 (4 h) e o dia 18 (20 h) ficam de fora
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 28, p: null }, { d: '2026-10-17', mm: 26, p: null }]);
  });
  it('MET Norway: no trecho de hora em hora usa o bloco de 1 h e não soma o de 6 h junto', () => {
    const serie = [];
    for (let h = 0; h < 24; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, 4 + h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3 } } } });
    }
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 12, p: null }]);
  });
  it('MET Norway: na passagem de 1 h para 6 h o último horário usa o bloco de 6 h (sem buraco no dia)', () => {
    const serie = [];
    // de hora em hora das 04Z às 18Z do dia 16 (meia-noite de MT às 14 h de MT), depois de 6 em 6 h
    for (let h = 4; h <= 18; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3 } } } });
    }
    serie.push({ time: '2026-10-17T00:00:00Z', data: { next_6_hours: { details: { precipitation_amount: 6 } } } });
    // 14 h × 0,5 (04Z–17Z) + o bloco das 18Z inteiro (3) + 4 h do bloco das 00Z (4 × 1) = 14; o dia 17 fica incompleto
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 14, p: null }]);
  });
  it('chuva medida: média dos pluviômetros que leram; quem não leu não conta como zero', () => {
    const obs = observadoPorFazenda(res(['picid', 'dia', 'mm'], [['10', '2026-10-13', 1], ['11', '2026-10-13', 3], ['99', '2026-10-13', 80]]), doPic);
    expect(obs).toEqual([{ unidade: 'GLOBO', dia: '2026-10-13', mm: 2, pluviometros: 2 }]);
    expect(montarSqlObservadoZeus('2026-10-12', '2026-10-13')).toContain('SELECT DISTINCT idprecipitation');
  });
  it('assinatura muda quando um valor muda e não depende da ordem do mapa', () => {
    const a = new Map([['GLOBO', [{ d: '2026-10-14', mm: 5, p: 80 }]], ['DOURADO', [{ d: '2026-10-14', mm: 1, p: null }]]]);
    const b = new Map([['DOURADO', [{ d: '2026-10-14', mm: 1, p: null }]], ['GLOBO', [{ d: '2026-10-14', mm: 5, p: 80 }]]]);
    const c = new Map([['GLOBO', [{ d: '2026-10-14', mm: 5.1, p: 80 }]], ['DOURADO', [{ d: '2026-10-14', mm: 1, p: null }]]]);
    expect(assinaturaDaPrevisao(a)).toBe(assinaturaDaPrevisao(b));
    expect(assinaturaDaPrevisao(a)).not.toBe(assinaturaDaPrevisao(c));
    expect(assinaturaDaPrevisao(a)).toMatch(/^[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run (em `modulos/mapas`): `npx vitest run tests/previsao-benchmark-servidor.test.ts`
Expected: FAIL (as funções não existem).

- [ ] **Step 4: Implementar**

No topo de `sincronizar-plantio.mjs`, junto dos imports:

```js
import { createHash } from 'node:crypto';
```

Seção nova (antes de `export function modoDeExecucao`):

```js
// ---------- benchmark de previsão (aba "Benchmark" da Previsão do Tempo) ----------
// Foto diária da previsão de chuva de cada fonte por fazenda, chuva medida pelos pluviômetros da ZEUS e as métricas
// de acerto (especificação: modulos/previsao/docs/2026-10-14-benchmark-previsao-design.md). Tabelas: supabase/0024.

/** Fontes do benchmark, na ordem em que aparecem na tela. */
export const PREV_FONTES = ['zeus', 'visualcrossing', 'metno'];
/** Hora de MT a partir da qual sai a foto do dia. */
export const PREV_HORA_FOTO = 6;
/** Antecedências do ranking (0 = todos os pares de 1 a 7 dias). A ZEUS chega a D+13. */
export const PREV_ANTECEDENCIAS = [0, 1, 3, 7, 13];
/** Abaixo disso a tela mostra "histórico insuficiente". */
export const PREV_MINIMO_PARES = 10;
/** Identificação exigida pelo MET Norway (nome do serviço e onde nos achar). */
export const PREV_USER_AGENT = 'coa-web-locks/1.0 (https://coa-web-teal.vercel.app)';
const PREV_PRAZO_MS = 30_000;
/** Mato Grosso: UTC−4 o ano inteiro (sem horário de verão). */
const MT_DESLOCAMENTO_MS = -4 * 3_600_000;
const arred1 = (x) => Math.round(x * 10) / 10;

/** Dia (AAAA-MM-DD) em Mato Grosso de um instante. */
export function diaMT(instante) {
  return new Date(new Date(instante).getTime() + MT_DESLOCAMENTO_MS).toISOString().slice(0, 10);
}
/** Hora (0 a 23) em Mato Grosso de um instante. */
export function horaMT(instante) {
  return new Date(new Date(instante).getTime() + MT_DESLOCAMENTO_MS).getUTCHours();
}
/** Dia AAAA-MM-DD mais `n` dias. */
export function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Quantos dias de `a` até `b` (AAAA-MM-DD). */
export function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
/** 1º de setembro do ano-safra de `hoje`. */
export function inicioSafraMT(hoje) {
  const [ano, mes] = String(hoje).split('-').map(Number);
  return `${mes >= 9 ? ano : ano - 1}-09-01`;
}

/**
 * Fazendas do benchmark a partir dos pluviômetros da ZEUS (SQL_PICS_ZEUS): só as que estão no cadastro do Mapas
 * (`unidades`, nomes de unidade do PIMS). `pontos`: média das coordenadas dos pluviômetros, com 4 casas (onde as
 * fontes de fora são consultadas). `fazendaDoPic`: todo pluviômetro da fazenda, com ou sem coordenada.
 */
export function pontosDasFazendas(res, unidades) {
  const conhecidas = new Set(unidades.map((u) => String(u).trim().toUpperCase()));
  const fazendaDoPic = new Map();
  const soma = new Map();
  for (const r of objetosDe(res)) {
    const unidade = unidadeDaFazendaZeus(r.farm);
    if (!conhecidas.has(unidade) || r.picid === null) continue;
    fazendaDoPic.set(String(r.picid), unidade);
    const lat = Number(r.lat), lon = Number(r.lon);
    if (r.lat === null || r.lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const s = soma.get(unidade) ?? { lat: 0, lon: 0, n: 0 };
    s.lat += lat; s.lon += lon; s.n += 1;
    soma.set(unidade, s);
  }
  const quatro = (x) => Math.round(x * 1e4) / 1e4;
  const pontos = new Map([...soma].sort(([a], [b]) => a.localeCompare(b)).map(([u, s]) => [u, { lat: quatro(s.lat / s.n), lon: quatro(s.lon / s.n) }]));
  return { pontos, fazendaDoPic };
}

/**
 * Previsão diária da ZEUS por pluviômetro (stg_short_forecast guarda só a mais recente), de `desde` em diante.
 * Paginável: a ordem (pluviômetro, dia) não empata.
 */
export function montarSqlPrevisaoZeus(desde, pular = null, tamanho = PAGINA_CONSULTA) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  return `SELECT picid::text AS picid, to_char(day::date, 'YYYY-MM-DD') AS dia, forecast AS mm, rainprobability AS prob
FROM "DATABASE".stg_short_forecast
WHERE day::date >= DATE '${d}' AND forecast IS NOT NULL${fimDaConsulta(pular, tamanho, '1, 2', '1, 2', paginaSqlZeus)}`;
}

/** Média dos valores de um dia que não são nulos (ou null). */
function mediaDe(lista) {
  const ok = lista.filter((v) => v !== null && Number.isFinite(v));
  return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
}

/** Previsão da ZEUS por fazenda: média, por dia, dos pluviômetros da fazenda. → Map<unidade, [{ d, mm, p }]> */
export function previsaoZeusPorFazenda(res, fazendaDoPic) {
  const porFazenda = new Map();
  for (const r of objetosDe(res)) {
    const unidade = fazendaDoPic.get(String(r.picid));
    const d = txt(r.dia);
    const mm = Number(r.mm);
    if (!unidade || !d || r.mm === null || !Number.isFinite(mm)) continue;
    const dias = porFazenda.get(unidade) ?? new Map();
    porFazenda.set(unidade, dias);
    const x = dias.get(d) ?? { mm: [], p: [] };
    dias.set(d, x);
    x.mm.push(mm);
    x.p.push(r.prob === null ? null : Number(r.prob));
  }
  return new Map([...porFazenda].sort(([a], [b]) => a.localeCompare(b)).map(([u, dias]) => [u, [...dias]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, x]) => { const p = mediaDe(x.p); return { d, mm: arred1(mediaDe(x.mm)), p: p === null ? null : Math.round(p) }; })]));
}

/** Endereço do Visual Crossing (15 dias, só o resumo diário, unidades métricas). A chave vai no endereço: nunca logar. */
export function urlVisualCrossing({ lat, lon }, chave) {
  return `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?unitGroup=metric&include=days&contentType=json&key=${encodeURIComponent(chave)}`;
}

/** Resposta do Visual Crossing → [{ d, mm, p }] (os dias já vêm no fuso do ponto, que em MT é UTC−4). */
export function previsaoVisualCrossing(json) {
  const dias = Array.isArray(json?.days) ? json.days : [];
  const saida = [];
  for (const x of dias) {
    const d = txt(x?.datetime);
    const mm = typeof x?.precip === 'number' ? x.precip : Number.NaN;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(mm) || mm < 0) continue;
    const p = typeof x?.precipprob === 'number' && Number.isFinite(x.precipprob) ? Math.round(x.precipprob) : null;
    saida.push({ d, mm: arred1(mm), p });
  }
  return saida;
}

/** Endereço do MET Norway (Locationforecast 2.0, compacto). */
export function urlMetNo({ lat, lon }) {
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
}

/**
 * Resposta do MET Norway → [{ d, mm, p: null }] por dia de MT. Usa o bloco de 1 h enquanto o próximo horário vem
 * 1 h depois e o de 6 h quando o passo abre (o último horário de hora em hora já é seguido por um de 6 h depois),
 * sem somar blocos que se sobrepõem; cada bloco é repartido pelas horas de cada dia local que ele cobre.
 * Só ficam os dias com as 24 horas cobertas (o de hoje, a partir da hora da consulta, e o último, cortado, saem).
 */
export function previsaoMetNo(json) {
  const serie = Array.isArray(json?.properties?.timeseries) ? json.properties.timeseries : [];
  const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const mm = new Map();
  const horas = new Map();
  let cobertoAte = -Infinity;
  for (let i = 0; i < serie.length; i++) {
    const item = serie[i];
    const inicio = Date.parse(item?.time);
    if (!Number.isFinite(inicio) || inicio < cobertoAte) continue;
    const proximo = i + 1 < serie.length ? Date.parse(serie[i + 1]?.time) : Number.NaN;
    const passoDeUmaHora = Number.isFinite(proximo) && proximo - inicio <= 3_600_000;
    const um = numero(item?.data?.next_1_hours?.details?.precipitation_amount);
    const seis = numero(item?.data?.next_6_hours?.details?.precipitation_amount);
    let duracao, total;
    if (um !== null && (passoDeUmaHora || seis === null)) { duracao = 1; total = um; }
    else if (seis !== null) { duracao = 6; total = seis; }
    else continue;
    for (let h = 0; h < duracao; h++) {
      const dia = diaMT(inicio + h * 3_600_000);
      mm.set(dia, (mm.get(dia) ?? 0) + total / duracao);
      horas.set(dia, (horas.get(dia) ?? 0) + 1);
    }
    cobertoAte = inicio + duracao * 3_600_000;
  }
  return [...mm].filter(([d]) => horas.get(d) >= 24).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, mm: arred1(v), p: null }));
}

/**
 * Chuva medida por pluviômetro e dia (`data` da telemetria vem só com o dia), de `de` a `ate`, sem leitura repetida
 * (mesmo idprecipitation). ~150 pluviômetros × 2 dias: cabe numa consulta.
 */
export function montarSqlObservadoZeus(de, ate) {
  const a = String(de).replace(/[^0-9-]/g, '');
  const b = String(ate).replace(/[^0-9-]/g, '');
  return `WITH leituras AS (
  SELECT DISTINCT idprecipitation, picid, data, pluviometria FROM "DATABASE".stg_climatemonitoring2
  WHERE data >= DATE '${a}' AND data < DATE '${b}' + 1 AND pluviometria IS NOT NULL)
SELECT picid::text AS picid, to_char(data::date, 'YYYY-MM-DD') AS dia, round(sum(pluviometria)::numeric, 1) AS mm
FROM leituras
GROUP BY 1, 2
ORDER BY 1, 2`;
}

/** Chuva medida por fazenda: média dos pluviômetros que leram no dia (quem não leu não entra como zero). */
export function observadoPorFazenda(res, fazendaDoPic) {
  const acc = new Map();
  for (const r of objetosDe(res)) {
    const unidade = fazendaDoPic.get(String(r.picid));
    const dia = txt(r.dia);
    const mm = Number(r.mm);
    if (!unidade || !dia || r.mm === null || !Number.isFinite(mm)) continue;
    const chave = `${unidade}|${dia}`;
    const x = acc.get(chave) ?? { unidade, dia, soma: 0, n: 0 };
    x.soma += mm; x.n += 1;
    acc.set(chave, x);
  }
  return [...acc.values()].sort((a, b) => a.unidade.localeCompare(b.unidade) || a.dia.localeCompare(b.dia))
    .map((x) => ({ unidade: x.unidade, dia: x.dia, mm: arred1(x.soma / x.n), pluviometros: x.n }));
}

/** Impressão digital da previsão da ZEUS por fazenda (muda quando qualquer valor muda; não depende da ordem). */
export function assinaturaDaPrevisao(porFazenda) {
  const ordenado = [...porFazenda].sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha1').update(JSON.stringify(ordenado)).digest('hex');
}
```

Em `sincronizar-plantio.d.mts`, acrescentar no fim:

```ts
export interface PrevDia { d: string; mm: number; p: number | null }
export interface PrevObservado { unidade: string; dia: string; mm: number; pluviometros: number }
export const PREV_FONTES: string[];
export const PREV_HORA_FOTO: number;
export const PREV_ANTECEDENCIAS: number[];
export const PREV_MINIMO_PARES: number;
export const PREV_USER_AGENT: string;
export function diaMT(instante: string | number | Date): string;
export function horaMT(instante: string | number | Date): number;
export function somarDias(dia: string, n: number): string;
export function diasEntre(a: string, b: string): number;
export function inicioSafraMT(hoje: string): string;
export function pontosDasFazendas(res: { columns: string[]; rows: unknown[][] }, unidades: string[]): {
  pontos: Map<string, { lat: number; lon: number }>;
  fazendaDoPic: Map<string, string>;
};
export function montarSqlPrevisaoZeus(desde: string, pular?: number | null, tamanho?: number): string;
export function previsaoZeusPorFazenda(res: { columns: string[]; rows: unknown[][] }, fazendaDoPic: Map<string, string>): Map<string, PrevDia[]>;
export function urlVisualCrossing(ponto: { lat: number; lon: number }, chave: string): string;
export function previsaoVisualCrossing(json: unknown): PrevDia[];
export function urlMetNo(ponto: { lat: number; lon: number }): string;
export function previsaoMetNo(json: unknown): PrevDia[];
export function montarSqlObservadoZeus(de: string, ate: string): string;
export function observadoPorFazenda(res: { columns: string[]; rows: unknown[][] }, fazendaDoPic: Map<string, string>): PrevObservado[];
export function assinaturaDaPrevisao(porFazenda: Map<string, PrevDia[]>): string;
```

- [ ] **Step 5: Rodar e ver passar**

Run (em `modulos/mapas`): `npx vitest run tests/previsao-benchmark-servidor.test.ts && node --check scripts/sincronizar-plantio.mjs && npx tsc --noEmit -p .`
Expected: todos os testes PASS; sem erro de sintaxe nem de tipos.

- [ ] **Step 6: Commit (local)**

```bash
git add modulos/mapas/scripts/sincronizar-plantio.mjs modulos/mapas/scripts/sincronizar-plantio.d.mts modulos/mapas/tests/previsao-benchmark-servidor.test.ts
git commit -m "Benchmark de previsão: leitura da ZEUS, do Visual Crossing, do MET Norway e da chuva medida"
```

---

### Task 3: Rotina — pares e métricas

**Files:**
- Modify: `modulos/mapas/scripts/sincronizar-plantio.mjs` (continuação da seção da Tarefa 2)
- Modify: `modulos/mapas/scripts/sincronizar-plantio.d.mts`
- Test: `modulos/mapas/tests/previsao-benchmark-servidor.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `diasEntre`, `somarDias`, `inicioSafraMT`, `PREV_FONTES`, `PREV_ANTECEDENCIAS` (Tarefa 2).
- Produces: `paresDoBenchmark(previsoes: { fonte, unidade, emitida_em, dias: PrevDia[] }[], observado: PrevObservado[]): Par[]` com `Par = { fonte, unidade, dia, k, previsto, medido }`; `metricasDoBenchmark(pares: Par[], hoje: string): Metrica[]` com `Metrica = { unidade, periodo, fonte, antecedencia, n, erro_medio, vies, acerto }`.

- [ ] **Step 1: Escrever os testes (falham)**

Acrescentar `paresDoBenchmark` e `metricasDoBenchmark` ao import de `../scripts/sincronizar-plantio.mjs` no topo do arquivo de teste e, no fim dele:

```ts
describe('benchmark de previsão: pares e métricas', () => {
  const foto = (fonte: string, unidade: string, emitida_em: string, dias: [string, number][]) =>
    ({ fonte, unidade, emitida_em, dias: dias.map(([d, mm]) => ({ d, mm, p: null })) });
  const medido = (unidade: string, dia: string, mm: number) => ({ unidade, dia, mm, pluviometros: 3 });

  it('comparação justa: dia em que uma fonte faltou sai para todas; D0 nunca entra', () => {
    const previsoes = [
      foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-01', 9], ['2026-10-02', 5], ['2026-10-03', 1]]),
      foto('metno', 'GLOBO', '2026-10-01', [['2026-10-02', 4]]), // o MET não tem o dia 3 nesta foto...
      foto('metno', 'GLOBO', '2026-10-02', [['2026-10-04', 1]]), // ...mas alcança k = 2 em outra: o dia 3 (k = 2) sai para a ZEUS também
    ];
    const pares = paresDoBenchmark(previsoes, [medido('GLOBO', '2026-10-01', 9), medido('GLOBO', '2026-10-02', 2), medido('GLOBO', '2026-10-03', 0)]);
    expect(pares.map((p) => `${p.fonte} ${p.dia} k${p.k}`).sort()).toEqual(['metno 2026-10-02 k1', 'zeus 2026-10-02 k1']);
  });

  it('antecedência que uma fonte nunca alcança não tira as outras', () => {
    const previsoes = [
      foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-10', 2], ['2026-10-14', 3]]), // k = 9 e k = 13
      foto('metno', 'GLOBO', '2026-10-01', [['2026-10-10', 1]]), // o MET chega só a k = 9
    ];
    const pares = paresDoBenchmark(previsoes, [medido('GLOBO', '2026-10-14', 2), medido('GLOBO', '2026-10-10', 1)]);
    // k = 9: as duas fontes; k = 13: só a ZEUS alcança, e o par dela fica
    expect(pares.map((p) => `${p.fonte} k${p.k}`).sort()).toEqual(['metno k9', 'zeus k13', 'zeus k9']);
  });

  it('dia sem chuva medida (sem pluviômetro lido) não entra', () => {
    const pares = paresDoBenchmark([foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-02', 5]])], [{ unidade: 'GLOBO', dia: '2026-10-02', mm: 0, pluviometros: 0 }]);
    expect(pares).toEqual([]);
  });

  it('erro médio, viés e acerto conferidos à mão; TODAS junta as fazendas', () => {
    const pares = [
      { fonte: 'zeus', unidade: 'GLOBO', dia: '2026-10-10', k: 1, previsto: 0, medido: 0 },
      { fonte: 'zeus', unidade: 'GLOBO', dia: '2026-10-11', k: 1, previsto: 5, medido: 2 },
      { fonte: 'zeus', unidade: 'GLOBO', dia: '2026-10-12', k: 1, previsto: 12, medido: 20 },
      { fonte: 'zeus', unidade: 'DOURADO', dia: '2026-10-12', k: 1, previsto: 0, medido: 4 },
    ];
    const m = metricasDoBenchmark(pares, '2026-10-14');
    const de = (unidade: string, periodo: string, antecedencia: number) => m.find((x) => x.unidade === unidade && x.periodo === periodo && x.fonte === 'zeus' && x.antecedencia === antecedencia);
    // GLOBO: |0−0|, |5−2|, |12−20| → 11/3 = 3,7; (0 + 3 − 8)/3 = −1,7; os três acertam chuva/sem chuva
    expect(de('GLOBO', '30d', 1)).toEqual({ unidade: 'GLOBO', periodo: '30d', fonte: 'zeus', antecedencia: 1, n: 3, erro_medio: 3.7, vies: -1.7, acerto: 100 });
    // a média de 1 a 7 junta os mesmos pares
    expect(de('GLOBO', '30d', 0)?.n).toBe(3);
    // TODAS: os 4 pares; DOURADO errou (0 previsto, 4 medido) → acerto 75
    expect(de('TODAS', 'safra', 1)).toMatchObject({ n: 4, erro_medio: 3.8, acerto: 75 });
    // sem par na antecedência 3: não há linha
    expect(de('GLOBO', '30d', 3)).toBeUndefined();
  });

  it('janelas de período contam até ontem', () => {
    const p = (dia: string) => ({ fonte: 'zeus', unidade: 'GLOBO', dia, k: 1, previsto: 1, medido: 1 });
    const m = metricasDoBenchmark([p('2026-09-13'), p('2026-09-14'), p('2026-10-13'), p('2026-10-14')], '2026-10-14');
    const n = (periodo: string) => m.find((x) => x.unidade === 'GLOBO' && x.periodo === periodo && x.antecedencia === 1)?.n;
    expect(n('30d')).toBe(2); // 14/09 a 13/10, 30 dias (o dia de hoje não conta)
    expect(n('60d')).toBe(3); // 15/08 a 13/10
    expect(n('safra')).toBe(3); // desde 01/09
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/previsao-benchmark-servidor.test.ts`
Expected: FAIL nos testes novos (funções não existem).

- [ ] **Step 3: Implementar** (logo depois de `assinaturaDaPrevisao`)

```js
/**
 * Pares previsto × medido por fonte, fazenda, dia e antecedência k (dia previsto − dia da foto, de 1 em diante).
 * Comparação justa: um (fazenda, dia, k) só entra se todas as fontes que já alcançaram k em alguma foto têm
 * previsão para ele, e se houve chuva medida (pelo menos um pluviômetro lido) na fazenda naquele dia.
 */
export function paresDoBenchmark(previsoes, observado) {
  const medido = new Map(observado.filter((o) => Number(o.pluviometros) > 0).map((o) => [`${o.unidade}|${o.dia}`, Number(o.mm)]));
  const previsto = new Map();
  const alcance = new Map();
  for (const f of previsoes) {
    for (const x of Array.isArray(f.dias) ? f.dias : []) {
      const k = diasEntre(f.emitida_em, x.d);
      const mm = Number(x.mm);
      if (k < 1 || !Number.isFinite(mm)) continue;
      alcance.set(f.fonte, Math.max(alcance.get(f.fonte) ?? 0, k));
      const chave = `${f.unidade}|${x.d}|${k}`;
      if (!previsto.has(chave)) previsto.set(chave, new Map());
      previsto.get(chave).set(f.fonte, mm);
    }
  }
  const pares = [];
  for (const [chave, porFonte] of previsto) {
    const [unidade, dia, kTexto] = chave.split('|');
    const k = Number(kTexto);
    const real = medido.get(`${unidade}|${dia}`);
    if (real === undefined) continue;
    const elegiveis = [...alcance].filter(([, maximo]) => maximo >= k).map(([fonte]) => fonte);
    if (!elegiveis.every((fonte) => porFonte.has(fonte))) continue;
    for (const [fonte, mm] of porFonte) pares.push({ fonte, unidade, dia, k, previsto: mm, medido: real });
  }
  return pares;
}

/**
 * Métricas por período (30, 60, 90 dias até ontem e a safra), fazenda (e 'TODAS'), fonte e antecedência
 * (0 = todos os pares de 1 a 7). Só sai linha com pelo menos um par; a tela decide o mínimo para mostrar.
 */
export function metricasDoBenchmark(pares, hoje) {
  const ontem = somarDias(hoje, -1);
  const periodos = [['30d', somarDias(ontem, -29)], ['60d', somarDias(ontem, -59)], ['90d', somarDias(ontem, -89)], ['safra', inicioSafraMT(hoje)]];
  const unidades = [...new Set(pares.map((p) => p.unidade))].sort();
  const fontes = PREV_FONTES.filter((f) => pares.some((p) => p.fonte === f));
  const linhas = [];
  for (const [periodo, de] of periodos) {
    const doPeriodo = pares.filter((p) => p.dia >= de && p.dia <= ontem);
    for (const unidade of [...unidades, 'TODAS']) {
      const daUnidade = unidade === 'TODAS' ? doPeriodo : doPeriodo.filter((p) => p.unidade === unidade);
      for (const fonte of fontes) {
        const daFonte = daUnidade.filter((p) => p.fonte === fonte);
        for (const antecedencia of PREV_ANTECEDENCIAS) {
          const sel = daFonte.filter((p) => (antecedencia === 0 ? p.k >= 1 && p.k <= 7 : p.k === antecedencia));
          if (!sel.length) continue;
          const n = sel.length;
          linhas.push({
            unidade, periodo, fonte, antecedencia, n,
            erro_medio: arred1(sel.reduce((s, p) => s + Math.abs(p.previsto - p.medido), 0) / n),
            vies: arred1(sel.reduce((s, p) => s + (p.previsto - p.medido), 0) / n),
            acerto: Math.round((100 * sel.filter((p) => (p.previsto >= 1) === (p.medido >= 1)).length) / n),
          });
        }
      }
    }
  }
  return linhas;
}
```

Em `.d.mts`:

```ts
export interface PrevFoto { fonte: string; unidade: string; emitida_em: string; dias: PrevDia[] }
export interface PrevPar { fonte: string; unidade: string; dia: string; k: number; previsto: number; medido: number }
export interface PrevMetrica { unidade: string; periodo: string; fonte: string; antecedencia: number; n: number; erro_medio: number; vies: number; acerto: number }
export function paresDoBenchmark(previsoes: PrevFoto[], observado: PrevObservado[]): PrevPar[];
export function metricasDoBenchmark(pares: PrevPar[], hoje: string): PrevMetrica[];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/previsao-benchmark-servidor.test.ts && npx tsc --noEmit -p .`
Expected: PASS, sem erro de tipos.

- [ ] **Step 5: Commit (local)**

```bash
git add modulos/mapas/scripts/sincronizar-plantio.mjs modulos/mapas/scripts/sincronizar-plantio.d.mts modulos/mapas/tests/previsao-benchmark-servidor.test.ts
git commit -m "Benchmark de previsão: pares com comparação justa e métricas de acerto"
```

---

### Task 4: Rotina — etapa `rodarBenchmarkPrevisao` na rodada de hora em hora

**Files:**
- Modify: `modulos/mapas/scripts/sincronizar-plantio.mjs` (funções de apoio ao Supabase, `lerFonteExterna`, `rodarBenchmarkPrevisao`; chamada em `main()` depois da Validação)
- Modify: `modulos/mapas/scripts/sincronizar-plantio.d.mts`
- Modify: `modulos/mapas/scripts/servidor/README.md` (variável nova e comando para gravar a chave)
- Test: `modulos/mapas/tests/previsao-benchmark-servidor.test.ts` (novo `describe`, com `servidoresFalsos`)

**Interfaces:**
- Consumes: Tarefas 2 e 3; `abrirSessao`, `consultarPaginas`, `FONTES`, `SQL_PICS_ZEUS`, `chamarSupabase`, `cabecalhosSupabase`, `erroSupabase`, `semChave` (existentes).
- Produces: `rodarBenchmarkPrevisao({ agrovex: { url, token }, supabase: { url, chave }, visualCrossingChave?: string, fetchImpl?, agora?: Date }): Promise<string | null>` — `null` = ok; texto = erro já registrado no log (como `rodarAcompanhamento`).

- [ ] **Step 1: Escrever os testes (falham)**

No topo do arquivo de teste: trocar o import do Vitest por `import { afterEach, describe, expect, it, vi } from 'vitest';`, acrescentar `PREV_USER_AGENT` e `rodarBenchmarkPrevisao` ao import de `../scripts/sincronizar-plantio.mjs` e acrescentar:

```ts
import { servidoresFalsos, URL_SB, URL_AGROVEX, CHAVE, TOKEN } from './helpers/servidoresFalsos';
```

No fim do arquivo:

```ts
describe('benchmark de previsão: etapa da rotina', () => {
  const PICS = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['10', 'PIC 1', 'Faz. Globo', -13, -56], ['11', 'PIC 2', 'Faz. Globo', -13.2, -56.2]] };
  const ZEUS = { columns: ['picid', 'dia', 'mm', 'prob'], rows: [['10', '2026-10-15', 4, 80], ['11', '2026-10-15', 6, 90], ['10', '2026-10-16', 0, 5], ['11', '2026-10-16', 0, 5]] };
  const ZEUS_GLOBO = [{ d: '2026-10-15', mm: 5, p: 85 }, { d: '2026-10-16', mm: 0, p: 5 }];
  const OBS = { columns: ['picid', 'dia', 'mm'], rows: [['10', '2026-10-14', 2], ['11', '2026-10-14', 4]] };
  const CHAVE_VC = ['chave', 'visual', 'inventada'].join('-');
  const VC = { days: [{ datetime: '2026-10-15', precip: 3.2, precipprob: 70 }, { datetime: '2026-10-16', precip: 0, precipprob: 10 }] };
  // 6 em 6 h: cobre o dia 16 de MT inteiro (16T04Z a 17T04Z)
  const MET = { properties: { timeseries: [0, 6, 12, 18, 24].map((h) => ({ time: new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', ''), data: { next_6_hours: { details: { precipitation_amount: 1.2 } } } })) } };
  const tabelas = () => ({
    mapas_fazendas: [{ unidade_pims: 'GLOBO' }, { unidade_pims: 'NEBRASKA' }],
    prev_zeus_atualizacoes: [], prev_previsoes: [], prev_observado: [], prev_metricas: [],
  });
  // o fetch da rotina: Supabase e Agrovex falsos, e respostas prontas para as duas fontes de fora
  function montar(opcoes: { vc?: number; met?: number } = {}, extras: Record<string, Record<string, unknown>[]> = {}) {
    const s = servidoresFalsos({ ...tabelas(), ...extras }, [PICS, ZEUS, OBS]);
    const externas: { url: string; ua: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const ua = String((init?.headers as Record<string, string> | undefined)?.['User-Agent'] ?? '');
      if (url.startsWith('https://weather.visualcrossing.com/')) { externas.push({ url, ua }); return new Response(JSON.stringify(VC), { status: opcoes.vc ?? 200 }); }
      if (url.startsWith('https://api.met.no/')) { externas.push({ url, ua }); return new Response(JSON.stringify(MET), { status: opcoes.met ?? 200 }); }
      return s.impl(url, init);
    };
    const gravado = (tabela: string) => s.chamadas
      .filter((c) => c.url.startsWith(`${URL_SB}/rest/v1/${tabela}?`) && c.init?.method === 'POST')
      .flatMap((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>[]);
    return { s, fetchImpl, externas, gravado };
  }
  const rodar = (m: ReturnType<typeof montar>, agora: string, chave = CHAVE_VC) =>
    rodarBenchmarkPrevisao({ agrovex: { url: URL_AGROVEX, token: TOKEN }, supabase: { url: URL_SB, chave: CHAVE }, visualCrossingChave: chave, fetchImpl: m.fetchImpl as typeof fetch, agora: new Date(agora) });
  const fontes = (linhas: Record<string, unknown>[]) => linhas.map((f) => String(f.fonte)).sort();
  afterEach(() => vi.restoreAllMocks());

  it('às 6 h de MT tira a foto das três fontes, grava a chuva medida e a mudança da ZEUS', async () => {
    const m = montar();
    expect(await rodar(m, '2026-10-15T10:17:00Z')).toBeNull();
    const fotos = m.gravado('prev_previsoes');
    expect(fontes(fotos)).toEqual(['metno', 'visualcrossing', 'zeus']);
    expect(fotos.every((f) => f.unidade === 'GLOBO' && f.emitida_em === '2026-10-15')).toBe(true);
    expect(fotos.find((f) => f.fonte === 'zeus')?.dias).toEqual(ZEUS_GLOBO);
    expect(fotos.find((f) => f.fonte === 'metno')?.dias).toEqual([{ d: '2026-10-16', mm: 4.8, p: null }]);
    expect(m.gravado('prev_observado')).toEqual([{ unidade: 'GLOBO', dia: '2026-10-14', mm: 3, pluviometros: 2 }]);
    expect(m.gravado('prev_zeus_atualizacoes')).toHaveLength(1);
    // MET Norway: ponto = média dos pluviômetros, e a identificação exigida
    const met = m.externas.find((e) => e.url.startsWith('https://api.met.no/'));
    expect(met?.url).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-13.1&lon=-56.1');
    expect(met?.ua).toBe(PREV_USER_AGENT);
  });

  it('antes das 6 h de MT (mesmo sendo 9 h em UTC) não tira foto, mas grava a chuva medida', async () => {
    const m = montar();
    expect(await rodar(m, '2026-10-15T09:59:00Z')).toBeNull();
    expect(m.gravado('prev_previsoes')).toEqual([]);
    expect(m.externas).toEqual([]);
    expect(m.gravado('prev_observado')).toHaveLength(1);
  });

  it('rodada seguinte do mesmo dia: busca só o que faltou, não recalcula as métricas e não regrava a ZEUS sem mudança', async () => {
    const m = montar({}, {
      prev_previsoes: [{ fonte: 'zeus', unidade: 'GLOBO', emitida_em: '2026-10-15' }, { fonte: 'metno', unidade: 'GLOBO', emitida_em: '2026-10-15' }],
      prev_metricas: [{ calculado_em: '2026-10-15T10:17:00Z' }],
      prev_zeus_atualizacoes: [{ capturada_em: '2026-10-15T10:17:00Z', assinatura: assinaturaDaPrevisao(new Map([['GLOBO', ZEUS_GLOBO]])) }],
    });
    expect(await rodar(m, '2026-10-15T11:17:00Z')).toBeNull();
    expect(m.externas.map((e) => new URL(e.url).hostname)).toEqual(['weather.visualcrossing.com']);
    expect(fontes(m.gravado('prev_previsoes'))).toEqual(['visualcrossing']);
    expect(m.gravado('prev_zeus_atualizacoes')).toEqual([]);
    // só a leitura das fotos de hoje: sem a leitura da safra inteira para as métricas, e sem limpeza
    expect(m.s.leituras('prev_previsoes')).toHaveLength(1);
    expect(m.s.chamadas.filter((c) => c.url.startsWith(URL_SB) && c.init?.method === 'DELETE')).toEqual([]);
  });

  it('sem chave do Visual Crossing, ou com ela recusada, as outras fontes continuam; chave, token e fazenda fora do log', async () => {
    const logs: string[] = [];
    for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    const semChave = montar();
    expect(await rodar(semChave, '2026-10-15T10:17:00Z', '')).toBeNull();
    expect(fontes(semChave.gravado('prev_previsoes'))).toEqual(['metno', 'zeus']);
    expect(semChave.externas.some((e) => e.url.includes('visualcrossing'))).toBe(false);
    const recusada = montar({ vc: 401 });
    expect(await rodar(recusada, '2026-10-15T10:17:00Z')).toBeNull();
    expect(fontes(recusada.gravado('prev_previsoes'))).toEqual(['metno', 'zeus']);
    const tudo = logs.join('\n');
    expect(tudo).toContain('Visual Crossing: HTTP 401');
    expect(tudo).not.toContain(CHAVE_VC);
    expect(tudo).not.toContain(TOKEN);
    expect(tudo).not.toContain(CHAVE);
    expect(tudo).not.toContain('GLOBO');
  });

  it('MET Norway com 429 para a fonte na rodada, sem falhar a etapa', async () => {
    const m = montar({ met: 429 });
    expect(await rodar(m, '2026-10-15T10:17:00Z')).toBeNull();
    expect(fontes(m.gravado('prev_previsoes'))).toEqual(['visualcrossing', 'zeus']);
  });

  it('Agrovex fora do ar: a etapa devolve o erro, não lança e não grava nada no Supabase', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = servidoresFalsos(tabelas(), [], { agrovexStatus: 503 });
    const r = await rodarBenchmarkPrevisao({ agrovex: { url: URL_AGROVEX, token: TOKEN }, supabase: { url: URL_SB, chave: CHAVE }, fetchImpl: s.impl as typeof fetch, agora: new Date('2026-10-15T10:17:00Z') });
    expect(typeof r).toBe('string');
    expect(r).not.toContain(TOKEN);
    expect(s.chamadas.filter((c) => c.url.startsWith(URL_SB) && c.init?.method && c.init.method !== 'GET')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/previsao-benchmark-servidor.test.ts`
Expected: FAIL (`rodarBenchmarkPrevisao` não existe).

- [ ] **Step 3: Implementar** (fim da seção do benchmark)

```js
/** GET no Supabase que devolve a lista (erro do PostgREST sem a chave). */
async function sbLer({ url, chave }, caminho, acao, fetchImpl) {
  const resp = await chamarSupabase(fetchImpl, `${url}/rest/v1/${caminho}`, { headers: cabecalhosSupabase(chave) }, acao);
  if (!resp.ok) await erroSupabase(resp, chave, acao);
  return resp.json();
}
/** Todas as páginas (1.000 linhas cada) de um GET. A consulta precisa de uma ordem sem empate. */
async function sbLerTudo(supabase, caminho, acao, fetchImpl) {
  const saida = [];
  for (let de = 0; ; de += 1000) {
    const linhas = await sbLer(supabase, `${caminho}&limit=1000&offset=${de}`, acao, fetchImpl);
    saida.push(...linhas);
    if (linhas.length < 1000) return saida;
  }
}
/** Upsert (merge) de linhas numa tabela; lista vazia não faz chamada. */
async function sbUpsert({ url, chave }, tabela, conflito, linhas, fetchImpl) {
  if (!linhas.length) return;
  const acao = `a gravação em ${tabela}`;
  const resp = await chamarSupabase(fetchImpl, `${url}/rest/v1/${tabela}?on_conflict=${conflito}`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  }, acao);
  if (!resp.ok) await erroSupabase(resp, chave, acao);
}

/** GET numa fonte de fora, com prazo e identificação. O erro nunca traz o endereço (o do Visual Crossing tem a chave). */
async function lerFonteExterna(fetchImpl, url, nome) {
  let resp;
  try {
    resp = await fetchImpl(url, { headers: { 'User-Agent': PREV_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(PREV_PRAZO_MS) });
  } catch (e) {
    const prazo = e !== null && typeof e === 'object' && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw Object.assign(new Error(`${nome}: ${prazo ? `sem resposta em ${PREV_PRAZO_MS / 1000} s` : 'falha de rede'}`), { status: 0 });
  }
  if (!resp.ok) throw Object.assign(new Error(`${nome}: HTTP ${resp.status}`), { status: resp.status });
  return resp.json();
}

/**
 * Etapa do benchmark de previsão dentro da rotina de hora em hora. Não lança: devolve null (ok) ou a mensagem de erro
 * já registrada (como rodarAcompanhamento). Em toda rodada: registra a mudança da previsão da ZEUS e grava a chuva
 * medida de anteontem e ontem. A partir das 6 h de MT: a foto de hoje do que ainda falta (fonte × fazenda) e, uma
 * vez por dia, as métricas. Uma fonte que falha não impede as outras (só aviso no log, sem nome de fazenda).
 */
export async function rodarBenchmarkPrevisao({ agrovex, supabase, visualCrossingChave = '', fetchImpl = globalThis.fetch, agora = new Date() }) {
  const limpar = (texto) => {
    let t = semChave(semChave(String(texto), supabase.chave), agrovex.token);
    if (visualCrossingChave) t = semChave(semChave(t, visualCrossingChave), encodeURIComponent(visualCrossingChave));
    return t;
  };
  try {
    const hoje = diaMT(agora);
    const capturada = agora.toISOString();
    const unidades = (await sbLer(supabase, 'mapas_fazendas?select=unidade_pims&unidade_pims=not.is.null', 'a leitura das fazendas', fetchImpl))
      .map((f) => String(f.unidade_pims ?? '').trim().toUpperCase()).filter(Boolean);
    const cliente = await abrirSessao(agrovex.url, agrovex.token, fetchImpl);
    let pontos, zeus, observado;
    try {
      const fazendas = pontosDasFazendas(await cliente.consultar(SQL_PICS_ZEUS, 'pluviômetros da ZEUS e suas fazendas (benchmark de previsão)', 'pluviômetros', FONTES.zeus), unidades);
      pontos = fazendas.pontos;
      zeus = previsaoZeusPorFazenda(await consultarPaginas(cliente, (pular, tamanho) => montarSqlPrevisaoZeus(hoje, pular, tamanho),
        'previsão de chuva da ZEUS por pluviômetro (benchmark de previsão)', 'previsão da ZEUS', { fonte: FONTES.zeus }), fazendas.fazendaDoPic);
      observado = observadoPorFazenda(await cliente.consultar(montarSqlObservadoZeus(somarDias(hoje, -2), somarDias(hoje, -1)),
        'chuva medida pelos pluviômetros da ZEUS (benchmark de previsão)', 'chuva medida', FONTES.zeus), fazendas.fazendaDoPic);
    } finally {
      await cliente.fechar();
    }

    // 1. a ZEUS mudou a previsão? (para saber a hora em que ela publica)
    const assinatura = assinaturaDaPrevisao(zeus);
    const ultima = await sbLer(supabase, 'prev_zeus_atualizacoes?select=assinatura&order=capturada_em.desc&limit=1', 'a leitura das atualizações da ZEUS', fetchImpl);
    if (zeus.size && (!ultima.length || ultima[0].assinatura !== assinatura)) {
      await sbUpsert(supabase, 'prev_zeus_atualizacoes', 'capturada_em', [{ capturada_em: capturada, assinatura }], fetchImpl);
    }
    // 2. chuva medida, em toda rodada (carga atrasada da telemetria entra na rodada seguinte)
    await sbUpsert(supabase, 'prev_observado', 'unidade,dia', observado, fetchImpl);
    if (horaMT(agora) < PREV_HORA_FOTO) return null;

    // 3. a foto de hoje, só do que ainda falta (fonte × fazenda)
    const feitas = new Set((await sbLer(supabase, `prev_previsoes?select=fonte,unidade&emitida_em=eq.${hoje}`, 'a leitura das fotos de hoje', fetchImpl))
      .map((r) => `${r.fonte}|${r.unidade}`));
    const falta = (fonte, unidade) => !feitas.has(`${fonte}|${unidade}`);
    const dentro = (dias) => dias.filter((x) => { const k = diasEntre(hoje, x.d); return k >= 0 && k <= 14; });
    const fotos = [];
    const guardar = (fonte, unidade, dias) => { const d = dentro(dias); if (d.length) fotos.push({ fonte, unidade, emitida_em: hoje, capturada_em: capturada, dias: d }); };
    for (const [unidade, dias] of zeus) if (falta('zeus', unidade)) guardar('zeus', unidade, dias);
    const externas = [
      ['visualcrossing', 'Visual Crossing', visualCrossingChave ? (p) => urlVisualCrossing(p, visualCrossingChave) : null, previsaoVisualCrossing],
      ['metno', 'MET Norway', urlMetNo, previsaoMetNo],
    ];
    for (const [fonte, nome, endereco, converter] of externas) {
      if (!endereco) { console.warn(`Benchmark de previsão: ${nome} sem chave no ambiente (VISUALCROSSING_KEY); fonte pulada.`); continue; }
      let falhas = 0;
      for (const [unidade, ponto] of pontos) {
        if (!falta(fonte, unidade)) continue;
        try {
          guardar(fonte, unidade, converter(await lerFonteExterna(fetchImpl, endereco(ponto), nome)));
        } catch (e) {
          falhas += 1;
          // recusa de acesso ou limite estourado vale para todas as fazendas: não insiste nesta rodada
          if (e && (e.status === 401 || e.status === 403 || e.status === 429)) { console.warn(`Benchmark de previsão: ${limpar(e.message)}; fonte parada nesta rodada.`); break; }
        }
      }
      if (falhas) console.warn(`Benchmark de previsão: ${nome} falhou em ${falhas} fazenda(s); tenta de novo na próxima rodada.`);
    }
    await sbUpsert(supabase, 'prev_previsoes', 'fonte,unidade,emitida_em', fotos, fetchImpl);

    // 4. métricas, uma vez por dia (e de novo enquanto não houver nenhuma)
    const conta = await sbLer(supabase, 'prev_metricas?select=calculado_em&order=calculado_em.desc&limit=1', 'a leitura das métricas', fetchImpl);
    let metricas = [];
    if (!conta.length || diaMT(conta[0].calculado_em) !== hoje) {
      const desde = inicioSafraMT(hoje);
      const previsoes = await sbLerTudo(supabase, `prev_previsoes?select=fonte,unidade,emitida_em,dias&emitida_em=gte.${somarDias(desde, -14)}&order=emitida_em,fonte,unidade`, 'a leitura das fotos', fetchImpl);
      const medidos = await sbLerTudo(supabase, `prev_observado?select=unidade,dia,mm,pluviometros&dia=gte.${desde}&order=dia,unidade`, 'a leitura da chuva medida', fetchImpl);
      metricas = metricasDoBenchmark(paresDoBenchmark(previsoes, medidos), hoje).map((m) => ({ ...m, calculado_em: capturada }));
      if (metricas.length) {
        await sbUpsert(supabase, 'prev_metricas', 'unidade,periodo,fonte,antecedencia', metricas, fetchImpl);
        // combinação que não saiu agora (fonte parada, janela que andou) não fica com número velho
        const resp = await chamarSupabase(fetchImpl, `${supabase.url}/rest/v1/prev_metricas?calculado_em=lt.${encodeURIComponent(capturada)}`,
          { method: 'DELETE', headers: cabecalhosSupabase(supabase.chave) }, 'a limpeza de prev_metricas');
        if (!resp.ok) await erroSupabase(resp, supabase.chave, 'a limpeza de prev_metricas');
      }
    }
    console.log(`Benchmark de previsão: ${fotos.length} foto(s) nova(s), chuva medida de ${observado.length} fazenda×dia, ${metricas.length} métrica(s).`);
    return null;
  } catch (e) {
    const msg = limpar(e instanceof Error ? e.message : String(e));
    console.error(`Benchmark de previsão: erro (o resto da rotina não foi afetado): ${msg}`);
    return msg;
  }
}
```

Em `main()`, logo depois do bloco da Validação (`if (config.validacao !== false) { … }`):

```js
    // Benchmark de previsão (aba da Previsão do Tempo): um erro nele não desfaz o resto
    if (config.previsao !== false) {
      const erro = await rodarBenchmarkPrevisao({
        agrovex: { url: urlAgrovex, token },
        supabase,
        visualCrossingChave: (process.env.VISUALCROSSING_KEY || '').trim(),
      });
      if (erro) process.exitCode = 1;
    }
```

Em `.d.mts`:

```ts
export function rodarBenchmarkPrevisao(opcoes: {
  agrovex: { url: string; token: string };
  supabase: { url: string; chave: string };
  visualCrossingChave?: string;
  fetchImpl?: typeof fetch;
  agora?: Date;
}): Promise<string | null>;
```

Em `modulos/mapas/scripts/servidor/README.md` (CRLF), seção nova logo antes de `## Como levar esta versão para a VM`:

````markdown
## Chave do Visual Crossing (benchmark de previsão)

A aba "Benchmark" da Previsão do Tempo compara a previsão de chuva da ZEUS com a do Visual Crossing e a do MET Norway. O MET Norway não precisa de chave. O Visual Crossing precisa de uma chave da conta grátis (criada por quem administra o COA WEB em visualcrossing.com). Sem ela, a rotina segue normalmente e só escreve no registro, a cada hora, `Visual Crossing sem chave no ambiente (VISUALCROSSING_KEY); fonte pulada.`

Para gravar a chave **sem ela aparecer na tela** (o comando pede a chave; cole e aperte Enter; nada é mostrado):

```bash
read -rsp 'Chave do Visual Crossing: ' K && echo && [ ${#K} -ge 20 ] && printf 'VISUALCROSSING_KEY=%s\n' "$K" >> ~/.plantio-pims.env && echo 'Gravada.'; unset K
```

Para conferir (mostra só o **nome**; deve aparecer uma linha só):

```bash
grep -oE '^VISUALCROSSING_KEY=' ~/.plantio-pims.env
```

Se aparecer duas vezes, a chave foi gravada duas vezes: avise antes de seguir. A partir das 6 h de Mato Grosso, o registro passa a trazer `Benchmark de previsão: N foto(s) nova(s), …`; se aparecer `Visual Crossing: HTTP 401`, a chave foi recusada (conferir a conta).
````

- [ ] **Step 4: Rodar e ver passar; rodar a suíte inteira do módulo**

Run (em `modulos/mapas`): `npx vitest run tests/previsao-benchmark-servidor.test.ts && npx tsc --noEmit -p . && node --check scripts/sincronizar-plantio.mjs && npx vitest run`
Expected: tudo PASS (a suíte inteira continua com os 1.024 testes anteriores mais os novos).

- [ ] **Step 5: Commit (local)**

```bash
git add modulos/mapas/scripts/sincronizar-plantio.mjs modulos/mapas/scripts/sincronizar-plantio.d.mts modulos/mapas/scripts/servidor/README.md modulos/mapas/tests/previsao-benchmark-servidor.test.ts
git commit -m "Benchmark de previsão: etapa na rotina de hora em hora (foto diária, chuva medida e métricas)"
```

---

### Task 5: Conferência real, só leitura

**Files:**
- Create (fora do repositório): `doc-coa-web/_trabalho/conferir_benchmark.mjs`

**Interfaces:**
- Consumes: funções exportadas das Tarefas 2 e 3; `lerToken` de `acompanhamento-plantio/lib/agrovex.mjs` (token do Agrovex desta máquina; nunca imprimir).

- [ ] **Step 1: Escrever o script de conferência** (não grava nada no banco; imprime contagens e totais por fazenda só neste terminal; com `--json`, salva o que seria gravado em `doc-coa-web/_trabalho/benchmark-real.json`, também fora do repositório, para as imagens da Tarefa 9)

```js
// SÓ LEITURA: roda a etapa do benchmark contra as fontes reais (ZEUS pelo Agrovex, MET Norway e, com a chave no
// ambiente, Visual Crossing) com um "Supabase" de mentira que responde listas vazias e guarda as gravações.
// Fica fora do repositório (imprime nomes de fazenda). Uso: node conferir_benchmark.mjs [--json]
import { readFileSync, writeFileSync } from 'node:fs';
import { lerToken } from 'file:///C:/Users/bruno.moraes/Documents/CLAUDE%20GERAL/acompanhamento-plantio/lib/agrovex.mjs';
import * as S from 'file:///C:/Users/bruno.moraes/Documents/CLAUDE%20GERAL/coa-web/modulos/mapas/scripts/sincronizar-plantio.mjs';

const CONFIG = 'C:/Users/bruno.moraes/Documents/CLAUDE GERAL/coa-web/modulos/mapas/scripts/plantio.config.json';
const SAIDA = 'C:/Users/bruno.moraes/Documents/CLAUDE GERAL/doc-coa-web/_trabalho/benchmark-real.json';
const token = lerToken();
const vc = (process.env.VISUALCROSSING_KEY || '').trim();
// as unidades do cadastro do Mapas (mapas_fazendas.unidade_pims): os nomes das fazendas da ZEUS já convertidos
const unidades = ['TRES FLECHAS', 'GLOBO', 'SM3', 'DOURADO', 'NEBRASKA', 'GUAPIRAMA', 'SIRIEMA'];
const gravado = {};
const fetchImpl = async (url, init) => {
  if (url.startsWith('https://sb.local/')) {
    const tabela = /rest\/v1\/([a-z_]+)/.exec(url)[1];
    if (init?.method === 'POST') { (gravado[tabela] ??= []).push(...JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    const corpo = tabela === 'mapas_fazendas' ? unidades.map((u) => ({ unidade_pims: u })) : [];
    return new Response(JSON.stringify(corpo), { status: 200 });
  }
  return fetch(url, init);
};
// antes das 6 h de MT a etapa não tira foto: a conferência finge que já são 6 h (o dia de MT continua o mesmo)
const agora = new Date();
if (S.horaMT(agora) < S.PREV_HORA_FOTO) agora.setTime(agora.getTime() + (S.PREV_HORA_FOTO - S.horaMT(agora)) * 3_600_000);
const r = await S.rodarBenchmarkPrevisao({
  agrovex: { url: JSON.parse(readFileSync(CONFIG, 'utf8')).url, token },
  supabase: { url: 'https://sb.local', chave: 'x' },
  visualCrossingChave: vc, fetchImpl, agora,
});
console.log('resultado:', r, '| dia da foto:', S.diaMT(agora), '| Visual Crossing:', vc ? 'com chave' : 'sem chave');
for (const f of gravado.prev_previsoes ?? []) {
  console.log(f.fonte.padEnd(15), f.unidade.padEnd(13), `${String(f.dias.length).padStart(2)} dias`, `${f.dias[0]?.d} a ${f.dias.at(-1)?.d}`, `total ${f.dias.reduce((s, x) => s + x.mm, 0).toFixed(1)} mm`);
}
for (const o of gravado.prev_observado ?? []) console.log('medido', o.unidade.padEnd(13), o.dia, `${o.mm} mm`, `${o.pluviometros} pluviômetros`);
if (process.argv.includes('--json')) {
  writeFileSync(SAIDA, JSON.stringify({ previsoes: gravado.prev_previsoes ?? [], observado: gravado.prev_observado ?? [], metricas: gravado.prev_metricas ?? [] }));
  console.log('salvo em', SAIDA);
}
```

- [ ] **Step 2: Rodar** (com `VISUALCROSSING_KEY` no ambiente só se a conta já existir; a chave nunca vai para a linha de comando nem para arquivo do repositório)

Run: `node "C:/Users/bruno.moraes/Documents/CLAUDE GERAL/doc-coa-web/_trabalho/conferir_benchmark.mjs"`
Expected: `resultado: null`; 7 linhas `zeus` com 14 dias (hoje a D+13); 7 linhas `metno` com cerca de 9 dias, começando amanhã; 7 linhas `visualcrossing` com 15 dias se houver chave; chuva medida de até 14 linhas (7 fazendas × 2 dias, menos as sem leitura). Conferir a olho que os totais são plausíveis entre as fontes e que nenhuma linha traz dia fora de hoje a D+14.

- [ ] **Step 3: Guardar o script** (fica em `doc-coa-web/_trabalho`, fora do repositório, como os de validação de 14/10; a Tarefa 9 reaproveita com `--json`). Nada a commitar.

---

### Task 6: Tela — contas da aba (`previsao/benchmark-logica.js`)

**Files:**
- Create: `previsao/benchmark-logica.js` (CRLF, UMD como `previsao/logica.js`)
- Test: `modulos/previsao/testes/benchmark.test.mjs` (CRLF)

**Interfaces:**
- Produces (`window.PrevisaoBenchmark` / `require`): `FONTES: {id,nome,cor}[]`, `ANTECEDENCIAS = [1,3,7,13]`, `MINIMO_PARES = 10`, `TODAS = 'TODAS'`, `hojeMT(agora?: Date): string`, `somarDias(dia, n)`, `proximosDias(linhas, unidade, hoje) → { dias: string[], series: { fonte, nome, cor, mm: (number|null)[], p: (number|null)[], total: number|null, capturadaEm: string|null }[], divergentes: number[] }`, `divergente(valores: (number|null)[]): boolean`, `ranking(metricas, unidade, periodo) → { fonte, nome, cor, geral: Valor|null, porAntecedencia: { k, valor: Valor|null }[] }[]` com `Valor = { n, erro, vies, acerto, suficiente }`, `textoVies(v: number|null): string`, `previstoMedido(linhas, observado, unidade, k, hoje) → { dias, medido: (number|null)[], series: { fonte, nome, cor, mm: (number|null)[] }[] }`, `diasDeFoto(linhas): number`, `temTodas(metricas): boolean`.

- [ ] **Step 1: Escrever os testes (falham)**

```js
// Testes das contas da aba Benchmark (previsao/benchmark-logica.js). Dados FICTÍCIOS.
// Rodar na raiz do repositório: node --test modulos/previsao/testes/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const B = createRequire(import.meta.url)('../../../previsao/benchmark-logica.js')
const foto = (fonte, unidade, emitida_em, dias, capturada_em = emitida_em + 'T10:20:00Z') =>
  ({ fonte, unidade, emitida_em, capturada_em, dias: dias.map(([d, mm, p = null]) => ({ d, mm, p })) })

test('hojeMT: UTC−4, independente do fuso do aparelho', () => {
  assert.equal(B.hojeMT(new Date('2026-10-15T03:59:00Z')), '2026-10-14')
  assert.equal(B.hojeMT(new Date('2026-10-15T04:00:00Z')), '2026-10-15')
})

test('proximosDias: 15 dias, a foto mais recente de cada fonte, total e divergência', () => {
  const linhas = [
    foto('zeus', 'GLOBO', '2026-10-14', [['2026-10-15', 99]]), // foto velha: não vale
    foto('zeus', 'GLOBO', '2026-10-15', [['2026-10-15', 12, 80], ['2026-10-16', 0, 5]]),
    foto('metno', 'GLOBO', '2026-10-15', [['2026-10-15', 0.4], ['2026-10-16', 1]]),
  ]
  const r = B.proximosDias(linhas, 'GLOBO', '2026-10-15')
  assert.equal(r.dias.length, 15)
  assert.equal(r.dias[14], '2026-10-29')
  assert.deepEqual(r.series.map((s) => s.fonte), ['zeus', 'metno']) // sem Visual Crossing: a fonte não aparece
  assert.deepEqual(r.series[0].mm.slice(0, 3), [12, 0, null])
  assert.deepEqual(r.series[0].p.slice(0, 2), [80, 5])
  assert.equal(r.series[0].total, 12)
  assert.deepEqual(r.divergentes, [0]) // 12 mm × 0,4 mm no primeiro dia
})

test('proximosDias: "Todas" é a média das fazendas que a fonte tem no dia', () => {
  const linhas = [foto('zeus', 'GLOBO', '2026-10-15', [['2026-10-15', 10]]), foto('zeus', 'DOURADO', '2026-10-15', [['2026-10-15', 4]])]
  assert.equal(B.proximosDias(linhas, B.TODAS, '2026-10-15').series[0].mm[0], 7)
})

test('proximosDias: sem nenhuma foto, sem séries (a tela mostra o aviso)', () => {
  assert.deepEqual(B.proximosDias([], 'GLOBO', '2026-10-15').series, [])
})

test('divergente: precisa de ≥ 10 mm numa fonte e < 1 mm em outra', () => {
  assert.equal(B.divergente([10, 0.9]), true)
  assert.equal(B.divergente([9.9, 0]), false)
  assert.equal(B.divergente([10, null]), false)
})

test('ranking: ordena pelo erro de 1 a 7 dias; quem tem menos de 10 pares vai para o fim', () => {
  const m = (fonte, antecedencia, n, erro_medio, vies = 0, acerto = 80) => ({ unidade: 'GLOBO', periodo: '30d', fonte, antecedencia, n, erro_medio, vies, acerto })
  const metricas = [m('zeus', 0, 30, 4.2), m('zeus', 1, 10, 3.1), m('visualcrossing', 0, 30, 3.5), m('metno', 0, 6, 1.0), { ...m('zeus', 0, 30, 9), periodo: '60d' }]
  const r = B.ranking(metricas, 'GLOBO', '30d')
  assert.deepEqual(r.map((x) => x.fonte), ['visualcrossing', 'zeus', 'metno'])
  assert.equal(r[2].geral.suficiente, false)
  assert.deepEqual(r[1].porAntecedencia.map((x) => x.k), [1, 3, 7, 13])
  assert.equal(r[1].porAntecedencia[0].valor.erro, 3.1)
  assert.equal(r[1].porAntecedencia[1].valor, null)
})

test('textoVies e temTodas', () => {
  assert.equal(B.textoVies(1.5), 'prevê chuva demais (+1,5 mm)')
  assert.equal(B.textoVies(-2), 'prevê chuva de menos (-2 mm)')
  assert.equal(B.textoVies(0.3), 'sem tendência')
  assert.equal(B.textoVies(null), '—')
  assert.equal(B.temTodas([{ unidade: 'GLOBO' }]), false)
  assert.equal(B.temTodas([{ unidade: 'TODAS' }]), true)
})

test('previstoMedido: 30 dias até ontem; a previsão de k dias antes', () => {
  const linhas = [foto('zeus', 'GLOBO', '2026-10-11', [['2026-10-14', 6]]), foto('zeus', 'GLOBO', '2026-10-13', [['2026-10-14', 9]])]
  const r = B.previstoMedido(linhas, [{ unidade: 'GLOBO', dia: '2026-10-14', mm: 7, pluviometros: 2 }], 'GLOBO', 3, '2026-10-15')
  assert.equal(r.dias.length, 30)
  assert.equal(r.dias[29], '2026-10-14')
  assert.equal(r.medido[29], 7)
  assert.equal(r.series[0].mm[29], 6) // emitida 3 dias antes (11/10), não a de 13/10
  assert.equal(B.diasDeFoto(linhas), 2)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test modulos/previsao/testes/*.test.mjs`
Expected: FAIL (arquivo `benchmark-logica.js` não existe); os 18 testes antigos continuam passando.

- [ ] **Step 3: Implementar `previsao/benchmark-logica.js`**

```js
/* Previsão do Tempo — contas da aba "Benchmark", sem tela: os próximos 15 dias de cada fonte, o ranking de acerto e
   o previsto × medido. Os dados vêm de prev_previsoes, prev_observado e prev_metricas (rotina da VM).
   Serve ao navegador (window.PrevisaoBenchmark) e aos testes (node --test "modulos/previsao/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PrevisaoBenchmark = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* a ordem e as cores das fontes em toda a aba */
  const FONTES = [
    { id: 'zeus', nome: 'ZEUS (Locks)', cor: '#0f9484' }, // verde-azulado mais claro que o da marca: o #0c5a50 reprova no validador de paleta
    { id: 'visualcrossing', nome: 'Visual Crossing', cor: '#db8a08' },
    { id: 'metno', nome: 'MET Norway', cor: '#5470c6' },
  ];
  const ANTECEDENCIAS = [1, 3, 7, 13];
  const MINIMO_PARES = 10;
  const TODAS = 'TODAS';
  const DIAS = 15;

  const arred1 = (x) => Math.round(x * 10) / 10;
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  function somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  /** Hoje em Mato Grosso (UTC−4), independente do fuso do aparelho. */
  function hojeMT(agora) {
    return new Date((agora ? agora.getTime() : Date.now()) - 4 * 3600000).toISOString().slice(0, 10);
  }
  function media(valores) {
    const ok = valores.filter((v) => v !== null);
    return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
  }
  function valorDoDia(linha, dia, campo) {
    const x = (Array.isArray(linha.dias) ? linha.dias : []).find((y) => y.d === dia);
    return x ? num(x[campo]) : null;
  }
  const daUnidade = (unidade) => (l) => unidade === TODAS || l.unidade === unidade;

  /** A foto mais recente de cada fonte × fazenda. */
  function fotosMaisRecentes(linhas) {
    const m = new Map();
    linhas.forEach((l) => {
      const k = l.fonte + '|' + l.unidade;
      const a = m.get(k);
      if (!a || l.emitida_em > a.emitida_em) m.set(k, l);
    });
    return Array.from(m.values());
  }

  /** Dia de divergência: uma fonte prevê 10 mm ou mais e outra menos de 1 mm. */
  function divergente(valores) {
    const ok = valores.filter((v) => v !== null);
    return ok.some((v) => v >= 10) && ok.some((v) => v < 1);
  }

  /** Bloco 1: os 15 dias a partir de hoje, por fonte (em "Todas", média das fazendas que a fonte tem no dia). */
  function proximosDias(linhas, unidade, hoje) {
    const dias = Array.from({ length: DIAS }, (_, i) => somarDias(hoje, i));
    const fotos = fotosMaisRecentes(linhas).filter(daUnidade(unidade));
    const series = FONTES.map((f) => {
      const minhas = fotos.filter((l) => l.fonte === f.id);
      const mm = dias.map((d) => { const v = media(minhas.map((l) => valorDoDia(l, d, 'mm'))); return v === null ? null : arred1(v); });
      const p = dias.map((d) => { const v = media(minhas.map((l) => valorDoDia(l, d, 'p'))); return v === null ? null : Math.round(v); });
      const comValor = mm.filter((v) => v !== null);
      const capturadas = minhas.map((l) => l.capturada_em).filter(Boolean).sort();
      return {
        fonte: f.id, nome: f.nome, cor: f.cor, mm, p,
        total: comValor.length ? arred1(comValor.reduce((s, v) => s + v, 0)) : null,
        capturadaEm: capturadas.length ? capturadas[capturadas.length - 1] : null,
      };
    }).filter((s) => s.mm.some((v) => v !== null));
    const divergentes = dias.map((_, i) => i).filter((i) => divergente(series.map((s) => s.mm[i])));
    return { dias, series, divergentes };
  }

  /** Bloco 2: o ranking de um período; ordem pelo erro de 1 a 7 dias, com quem não tem pares suficientes no fim. */
  function ranking(metricas, unidade, periodo) {
    const minhas = metricas.filter((m) => m.unidade === unidade && m.periodo === periodo);
    const linhas = FONTES.map((f) => {
      const daFonte = minhas.filter((m) => m.fonte === f.id);
      if (!daFonte.length) return null;
      const de = (k) => {
        const m = daFonte.find((x) => Number(x.antecedencia) === k);
        return m ? { n: Number(m.n), erro: num(m.erro_medio), vies: num(m.vies), acerto: num(m.acerto), suficiente: Number(m.n) >= MINIMO_PARES } : null;
      };
      return { fonte: f.id, nome: f.nome, cor: f.cor, geral: de(0), porAntecedencia: ANTECEDENCIAS.map((k) => ({ k, valor: de(k) })) };
    }).filter(Boolean);
    return linhas.sort((a, b) => {
      const sa = !!(a.geral && a.geral.suficiente), sb = !!(b.geral && b.geral.suficiente);
      if (sa !== sb) return sa ? -1 : 1;
      return sa ? a.geral.erro - b.geral.erro : 0;
    });
  }

  const virgula = (v) => String(v).replace('.', ',');
  /** Viés em palavras: positivo = prevê chuva demais. */
  function textoVies(v) {
    if (v === null || v === undefined) return '—';
    if (v > 0.5) return 'prevê chuva demais (+' + virgula(v) + ' mm)';
    if (v < -0.5) return 'prevê chuva de menos (' + virgula(v) + ' mm)';
    return 'sem tendência';
  }
  /** Há linhas de "Todas as fazendas" (o usuário vê todas)? */
  function temTodas(metricas) {
    return metricas.some((m) => m.unidade === TODAS);
  }

  /** Bloco 3: chuva medida × previsão feita k dias antes, nos 30 dias até ontem. */
  function previstoMedido(linhas, observado, unidade, k, hoje) {
    const ontem = somarDias(hoje, -1);
    const dias = Array.from({ length: 30 }, (_, i) => somarDias(ontem, i - 29));
    const sel = daUnidade(unidade);
    const medido = dias.map((d) => { const v = media(observado.filter((o) => sel(o) && o.dia === d && Number(o.pluviometros) > 0).map((o) => num(o.mm))); return v === null ? null : arred1(v); });
    const series = FONTES.map((f) => ({
      fonte: f.id, nome: f.nome, cor: f.cor,
      mm: dias.map((d) => {
        const emitida = somarDias(d, -k);
        const v = media(linhas.filter((l) => sel(l) && l.fonte === f.id && l.emitida_em === emitida).map((l) => valorDoDia(l, d, 'mm')));
        return v === null ? null : arred1(v);
      }),
    })).filter((s) => s.mm.some((v) => v !== null));
    return { dias, medido, series };
  }

  /** Quantos dias de foto existem nas linhas carregadas. */
  function diasDeFoto(linhas) {
    return new Set(linhas.map((l) => l.emitida_em)).size;
  }

  return { FONTES, ANTECEDENCIAS, MINIMO_PARES, TODAS, hojeMT, somarDias, proximosDias, divergente, ranking, textoVies, temTodas, previstoMedido, diasDeFoto };
});
```

- [ ] **Step 4: Rodar e ver passar; conferir a paleta**

Run: `node --test modulos/previsao/testes/*.test.mjs`
Expected: PASS (18 antigos + 8 novos).

Conferir as três cores com o validador da skill `dataviz` (`node <skill>/scripts/validate_palette.js "#0f9484,#db8a08,#5470c6" --mode light`). Esperado (conferido ao escrever o plano): `ALL CHECKS PASS`, com um WARN de contraste do âmbar (`#db8a08`), coberto pelas tabelas com os números ao lado dos gráficos.

- [ ] **Step 5: Commit (local)**

```bash
git add previsao/benchmark-logica.js modulos/previsao/testes/benchmark.test.mjs
git commit -m "Previsão do Tempo: contas da aba Benchmark (15 dias, ranking, previsto × medido)"
```

---

### Task 7: Tela — a aba no módulo (`previsao/`)

**Files:**
- Create: `previsao/benchmark.js` (CRLF)
- Modify: `previsao/index.html` (contêiner, ids nos campos da barra, scripts e `?v=`)
- Modify: `previsao/app.js` (vista, mensagens, dados do benchmark, `unidade_pims`)
- Modify: `previsao/estilo.css` (estilos da aba)
- Modify: `modulos/previsao/scripts/servidor-local.mjs` (`unidade_pims` fictícia e `/api/previsao-benchmark-teste`)

**Interfaces:**
- Consumes: `window.PrevisaoBenchmark` (Tarefa 6); `paresDoBenchmark`, `metricasDoBenchmark` (Tarefa 3, só no servidor local).
- Produces: `window.PrevisaoBenchmarkTela = { abrir(ctx), atualizar() }` com `ctx = { carregar(hoje): Promise<{ previsoes, observado, metricas }>, unidade(): string | null, nomeFazenda(): string }`; mensagens `previsao-vista` (recebe `{ vista: 'mapa' | 'benchmark' }`) e `previsao-rota` (envia `{ vista }`).

- [ ] **Step 1: `index.html`**

1. Trocar `<span class="marca-sub">Mapa do Windy com os limites das fazendas</span>` por `<span class="marca-sub" id="marca-sub">Mapa do Windy com os limites das fazendas</span>`.
2. Dar `id="campo-camada"` e `id="campo-modelo"` aos dois `<label class="campo-select">` de Camada e Modelo, e `id="acoes-mapa"` ao `<div class="barra-acoes">`.
3. Depois de `</main>` do mapa, acrescentar:
```html
  <!-- ============================ BENCHMARK ============================ -->
  <!-- a previsão de chuva das fontes lado a lado e quem acerta mais (benchmark.js) -->
  <main class="benchmark" id="benchmark" hidden></main>
```
4. Antes de `<script src="app.js?…">`, acrescentar (a linha do ECharts é a mesma de `acompanhamento/index.html`):
```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js" integrity="sha384-Mx5lkUEQPM1pOJCwFtUICyX45KNojXbkWdYhkKUKsbv391mavbfoAmONbzkgYPzR" crossorigin="anonymous"></script>
<script src="benchmark-logica.js?v=202610141800"></script>
<script src="benchmark.js?v=202610141800"></script>
```
5. Trocar o `?v=` de `app.js` e `estilo.css` para `202610141800`.

- [ ] **Step 2: `app.js`**

1. Cabeçalho: acrescentar às mensagens `- COA → módulo: { tipo:'previsao-vista', vista:'mapa'|'benchmark' }` e `- módulo → COA: { tipo:'previsao-rota', vista }`.
2. Em `estado`, acrescentar a vista inicial: `const estado = { fazenda: TODAS, camada: 'rain', modelo: 'ecmwf', ponto: false, vista: vistaInicial() };` e, acima dele:
```js
  /* aba aberta: #benchmark no endereço ou ?vista=benchmark (a casca abre assim); senão o mapa. O Modo TV (?tv=1)
     é só do mapa. Lê a URL direto: a constante PARAMS só é criada mais abaixo no arquivo. */
  function vistaInicial() {
    const q = new URLSearchParams(location.search);
    if (q.get('tv') === '1') return 'mapa';
    const pedida = (location.hash || '').slice(1) || q.get('vista') || '';
    return pedida === 'benchmark' ? 'benchmark' : 'mapa';
  }
  let fonte = null;        // fonte dos dados (Supabase ou servidor local), definida ao iniciar
  let windyFazenda = null; // fazenda para a qual o Windy foi carregado por último (null = ainda não carregou)
```
3. Em `fonteSupabase().cadastro`, trocar `select('id,nome,coa_fazenda_id')` por `select('id,nome,coa_fazenda_id,unidade_pims')` e acrescentar o método:
```js
      // aba Benchmark: as fotos dos últimos 40 dias (bloco 1 e previsto × medido), a chuva medida e as métricas
      benchmark: async function (hoje) {
        const B = window.PrevisaoBenchmark;
        const r = await Promise.all([
          tudo(() => sb.from('prev_previsoes').select('fonte,unidade,emitida_em,capturada_em,dias').gte('emitida_em', B.somarDias(hoje, -40)).order('emitida_em').order('fonte').order('unidade'), 1000),
          tudo(() => sb.from('prev_observado').select('unidade,dia,mm,pluviometros').gte('dia', B.somarDias(hoje, -31)).order('dia').order('unidade'), 1000),
          tudo(() => sb.from('prev_metricas').select('unidade,periodo,fonte,antecedencia,n,erro_medio,vies,acerto,calculado_em').order('unidade').order('periodo').order('fonte').order('antecedencia'), 1000),
        ]);
        return { previsoes: r[0], observado: r[1], metricas: r[2] };
      },
```
4. Em `fonteLocal()`, acrescentar:
```js
      benchmark: async function () {
        const r = await fetch('/api/previsao-benchmark-teste');
        if (!r.ok) throw new Error('servidor local sem dados de teste do benchmark');
        return r.json();
      },
```
5. Em `carregarWindy`, primeira linha: `windyFazenda = estado.fazenda;`.
6. Trocar `escolherFazenda` por:
```js
  function escolherFazenda(id) {
    estado.fazenda = id;
    preencherFazendas();
    if (estado.vista === 'benchmark') window.PrevisaoBenchmarkTela.atualizar();
    else carregarWindy(vistaDaEscolha());
  }
```
7. Acrescentar, antes de `$('sel-fazenda').addEventListener(...)`:
```js
  /* ------------------------------ abas ------------------------------ */
  function contextoBenchmark() {
    return {
      carregar: (hoje) => fonte.benchmark(hoje),
      unidade: () => { const f = fazendaEscolhida(); return f ? f.unidade : window.PrevisaoBenchmark.TODAS; },
      nomeFazenda: () => { const f = fazendaEscolhida(); return f ? f.nome : 'Todas as fazendas'; },
    };
  }
  /* Mapa do Windy ou Benchmark: a barra esconde camada, modelo e ações no benchmark; a casca acompanha a aba. */
  function mostrarVista(v) {
    estado.vista = v === 'benchmark' ? 'benchmark' : 'mapa';
    const bench = estado.vista === 'benchmark';
    $('mapa').hidden = bench;
    $('benchmark').hidden = !bench;
    ['campo-camada', 'campo-modelo', 'acoes-mapa'].forEach((id) => { $(id).hidden = bench; });
    $('marca-sub').textContent = bench ? 'Previsão de chuva das fontes lado a lado e quem acerta mais' : 'Mapa do Windy com os limites das fazendas';
    history.replaceState(null, '', location.pathname + location.search + '#' + estado.vista);
    if (EMBED) window.parent.postMessage({ tipo: 'previsao-rota', vista: estado.vista }, location.origin);
    if (!fonte) return; // ainda carregando: o início aplica
    if (bench) window.PrevisaoBenchmarkTela.abrir(contextoBenchmark());
    else if (windyFazenda !== estado.fazenda) carregarWindy(vistaDaEscolha()); // nunca carregou, ou a fazenda mudou no benchmark
    else desenhar();
  }
```
8. No `window.addEventListener('message', …)`, trocar o trecho depois de `if (ev.origin !== location.origin || ev.source !== window.parent) return;` por:
```js
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.tipo === 'previsao-vista') { mostrarVista(d.vista); return; }
    if (d.tipo !== 'coa-fazenda') return;
    coaFazenda = typeof d.id === 'number' ? d.id : null;
    aplicarFazendaCoa();
```
9. Em `iniciar()`: trocar `const fonte = CFG.modo === 'local' ? fonteLocal() : fonteSupabase();` por `fonte = CFG.modo === 'local' ? fonteLocal() : fonteSupabase();`; no `.map` das fazendas acrescentar `unidade: f.unidade_pims ? String(f.unidade_pims).trim().toUpperCase() : null,`; e trocar a linha `carregarWindy(vistaDaEscolha());` (a do início, antes do Modo TV) por `mostrarVista(estado.vista);`.

- [ ] **Step 3: `benchmark.js`**

```js
/* =====================================================================
   Previsão do Tempo — aba "Benchmark": a previsão de chuva de cada fonte lado a lado (próximos 15 dias), quem
   acerta mais (ranking) e o previsto × medido dos últimos 30 dias. Dados: prev_previsoes, prev_observado e
   prev_metricas, gravados pela rotina da VM; contas em benchmark-logica.js. Créditos exigidos pelas fontes no rodapé.
===================================================================== */
(function () {
  'use strict';

  const B = window.PrevisaoBenchmark;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PERIODOS = [['30d', 'Últimos 30 dias'], ['60d', 'Últimos 60 dias'], ['90d', 'Últimos 90 dias'], ['safra', 'Safra']];
  const fmtMm = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  const fmtDia = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const fmtSemana = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  const fmtHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  const RECARGA_MS = 30 * 60 * 1000; // a rotina grava de hora em hora: dados com mais de 30 min são lidos de novo ao voltar à aba
  let ctx = null;
  let dados = null;
  let carregadoEm = 0;
  let erroLeitura = '';
  let periodo = '30d';
  let antecedencia = 1;
  const graficos = {};

  function grafico(id) {
    if (!graficos[id]) graficos[id] = window.echarts.init($(id));
    return graficos[id];
  }
  function montarEstrutura() {
    $('benchmark').innerHTML =
      '<p class="bm-aviso" id="bm-aviso" hidden></p>' +
      '<div class="bm-blocos" id="bm-blocos">' +
      '<section class="bm-cartao"><div class="bm-cab"><h2>Próximos 15 dias</h2><span class="bm-sub" id="bm-sub-proximos"></span></div>' +
      '<div class="bm-grafico" id="bm-g-proximos"></div><div class="bm-tabela-rolagem"><table class="bm-tabela" id="bm-t-proximos"></table></div>' +
      '<p class="bm-rodape" id="bm-rodape"></p></section>' +
      '<section class="bm-cartao"><div class="bm-cab"><h2>Quem acerta mais</h2><label class="campo-select"><span>Período</span><select id="bm-periodo"></select></label></div>' +
      '<p class="bm-sub" id="bm-sub-ranking"></p><div class="bm-tabela-rolagem"><table class="bm-tabela" id="bm-t-ranking"></table></div></section>' +
      '<section class="bm-cartao"><div class="bm-cab"><h2>Previsto × medido</h2><label class="campo-select"><span>Antecedência</span><select id="bm-antecedencia"></select></label></div>' +
      '<p class="bm-sub">Últimos 30 dias: colunas = chuva medida pelos pluviômetros; linhas = o que cada fonte previa com essa antecedência.</p>' +
      '<p class="bm-sub" id="bm-vazio-historico" hidden>Ainda não há chuva medida nem previsão com essa antecedência nos últimos 30 dias.</p>' +
      '<div class="bm-grafico" id="bm-g-historico"></div></section>' +
      '</div>';
    $('bm-periodo').innerHTML = PERIODOS.map((p) => '<option value="' + p[0] + '">' + esc(p[1]) + '</option>').join('');
    $('bm-antecedencia').innerHTML = [1, 3, 7].map((k) => '<option value="' + k + '">' + k + (k === 1 ? ' dia antes' : ' dias antes') + '</option>').join('');
    $('bm-periodo').addEventListener('change', (e) => { periodo = e.target.value; desenharRanking(); });
    $('bm-antecedencia').addEventListener('change', (e) => { antecedencia = Number(e.target.value); desenharHistorico(); });
    // cada gráfico se ajusta quando muda de tamanho (janela, celular girado, ou quando volta a aparecer)
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => Object.values(graficos).forEach((g) => g.resize()));
      ['bm-g-proximos', 'bm-g-historico'].forEach((id) => ro.observe($(id)));
    }
  }
  function aviso(texto) {
    $('bm-aviso').textContent = texto || '';
    $('bm-aviso').hidden = !texto;
  }

  async function abrir(contexto) {
    ctx = contexto;
    if (!$('bm-blocos')) montarEstrutura();
    if (!dados || Date.now() - carregadoEm > RECARGA_MS) {
      try {
        dados = await ctx.carregar(B.hojeMT());
        erroLeitura = '';
      } catch (e) {
        if (!dados) dados = { previsoes: [], observado: [], metricas: [] };
        erroLeitura = 'Não foi possível ler o benchmark: ' + (e && e.message ? e.message : e);
      }
      carregadoEm = Date.now();
    }
    desenhar();
  }
  function atualizar() { if (dados) desenhar(); }

  /* Sem fazenda ligada ao PIMS ou sem nenhuma foto ainda: só o aviso, sem blocos vazios. */
  function desenhar() {
    const unidade = ctx.unidade();
    const temFoto = B.diasDeFoto(dados.previsoes) > 0;
    let texto = erroLeitura;
    if (!texto && unidade === null) texto = 'Esta fazenda não está ligada a uma unidade do PIMS no cadastro do Mapas: não há benchmark para ela.';
    if (!texto && !temFoto) texto = 'Ainda não há fotos da previsão. A primeira sai às 6 h (horário de Mato Grosso) do dia seguinte à publicação; o ranking passa a ter números cerca de 11 dias depois.';
    aviso(texto);
    const semBlocos = unidade === null || !temFoto;
    $('bm-blocos').hidden = semBlocos;
    if (semBlocos) return;
    desenharProximos();
    desenharRanking();
    desenharHistorico();
  }

  function desenharProximos() {
    const r = B.proximosDias(dados.previsoes, ctx.unidade(), B.hojeMT());
    $('bm-sub-proximos').textContent = ctx.nomeFazenda() + ' · mm por dia' + (r.divergentes.length ? ' · em destaque, os dias em que as fontes discordam' : '');
    $('bm-g-proximos').hidden = !r.series.length;
    grafico('bm-g-proximos').setOption({
      animation: false,
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMm(v) + ' mm' },
      legend: { top: 0 },
      grid: { left: 40, right: 12, top: 32, bottom: 28 },
      xAxis: { type: 'category', data: r.dias.map((d, i) => (i === 0 ? 'Hoje' : fmtSemana(d) + ' ' + fmtDia(d))) },
      yAxis: { type: 'value', name: 'mm' },
      series: r.series.map((s) => ({
        name: s.nome, type: 'bar', data: s.mm, itemStyle: { color: s.cor, borderRadius: [3, 3, 0, 0] },
        markArea: s === r.series[0] && r.divergentes.length ? { silent: true, itemStyle: { color: 'rgba(219,138,8,0.12)' }, data: r.divergentes.map((i) => [{ xAxis: i }, { xAxis: i }]) } : undefined,
      })),
    }, true);
    const cab = '<thead><tr><th>Fonte</th>' + r.dias.map((d, i) => '<th class="' + (r.divergentes.indexOf(i) >= 0 ? 'bm-diverge' : '') + '">' + (i === 0 ? 'Hoje' : fmtDia(d)) + '</th>').join('') + '<th>15 dias</th></tr></thead>';
    const corpo = r.series.map((s) => '<tr><th><i class="bm-cor" style="background:' + esc(s.cor) + '"></i>' + esc(s.nome) + '</th>' +
      s.mm.map((v, i) => '<td class="' + (r.divergentes.indexOf(i) >= 0 ? 'bm-diverge' : '') + '">' + fmtMm(v) + (s.p[i] !== null ? '<small>' + s.p[i] + '%</small>' : '') + '</td>').join('') +
      '<td><b>' + fmtMm(s.total) + '</b></td></tr>').join('');
    $('bm-t-proximos').innerHTML = r.series.length ? cab + '<tbody>' + corpo + '</tbody>' : '<tbody><tr><td>Sem previsão para esta escolha.</td></tr></tbody>';
    $('bm-rodape').innerHTML = r.series.map((s) => esc(s.nome) + ': foto de ' + esc(fmtHora(s.capturadaEm))).join(' · ') +
      '<br>Dados de Visual Crossing (visualcrossing.com) · MET Norway, CC BY 4.0 · ZEUS (Locks). Em "Hoje", a previsão da manhã; o MET Norway começa em amanhã.';
  }

  function desenharRanking() {
    const unidade = ctx.unidade();
    // há métricas, mas nenhuma de "Todas": o usuário não vê todas as fazendas (a RLS não entrega essas linhas)
    if (unidade === B.TODAS && dados.metricas.length && !B.temTodas(dados.metricas)) {
      $('bm-sub-ranking').textContent = 'O ranking de todas as fazendas juntas só aparece para quem vê todas elas. Escolha uma fazenda no seletor.';
      $('bm-t-ranking').innerHTML = '';
      return;
    }
    const linhas = B.ranking(dados.metricas, unidade, periodo);
    const fotos = B.diasDeFoto(dados.previsoes);
    $('bm-sub-ranking').textContent = (linhas.length ? 'Ordem: menor erro médio nas previsões feitas de 1 a 7 dias antes. ' : 'Ainda sem dias avaliados. ') +
      'Com menos de ' + B.MINIMO_PARES + ' dias avaliados aparece "histórico insuficiente". ' + (fotos ? fotos + ' dia(s) de foto até agora.' : '');
    const celula = (v) => (!v ? '<td>—</td>' : v.suficiente ? '<td>' + fmtMm(v.erro) + ' mm<small>' + v.n + ' dias</small></td>' : '<td class="bm-poucos">histórico insuficiente<small>' + v.n + ' dias</small></td>');
    const cab = '<thead><tr><th>#</th><th>Fonte</th><th>Erro médio (1 a 7 dias)</th>' + B.ANTECEDENCIAS.map((k) => '<th>' + k + (k === 1 ? ' dia' : ' dias') + '</th>').join('') + '<th>Acerto chove/não chove</th><th>Tendência</th></tr></thead>';
    const corpo = linhas.map((l, i) => '<tr><td>' + (l.geral && l.geral.suficiente ? i + 1 : '—') + '</td><th><i class="bm-cor" style="background:' + esc(l.cor) + '"></i>' + esc(l.nome) + '</th>' +
      celula(l.geral) + l.porAntecedencia.map((x) => celula(x.valor)).join('') +
      '<td>' + (l.geral && l.geral.suficiente ? fmtMm(l.geral.acerto) + '%' : '—') + '</td>' +
      '<td>' + esc(l.geral && l.geral.suficiente ? B.textoVies(l.geral.vies) : '—') + '</td></tr>').join('');
    $('bm-t-ranking').innerHTML = linhas.length ? cab + '<tbody>' + corpo + '</tbody>' : '';
  }

  function desenharHistorico() {
    const r = B.previstoMedido(dados.previsoes, dados.observado, ctx.unidade(), antecedencia, B.hojeMT());
    const vazio = !r.series.length && r.medido.every((v) => v === null);
    $('bm-vazio-historico').hidden = !vazio;
    $('bm-g-historico').hidden = vazio;
    if (vazio) return;
    grafico('bm-g-historico').setOption({
      animation: false,
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMm(v) + ' mm' },
      legend: { top: 0 },
      grid: { left: 40, right: 12, top: 32, bottom: 28 },
      xAxis: { type: 'category', data: r.dias.map(fmtDia) },
      yAxis: { type: 'value', name: 'mm' },
      series: [{ name: 'Chuva medida', type: 'bar', data: r.medido, itemStyle: { color: '#9aa7a0' } }].concat(r.series.map((s) => ({
        name: s.nome, type: 'line', data: s.mm, connectNulls: false, symbolSize: 5, lineStyle: { width: 2, color: s.cor }, itemStyle: { color: s.cor },
      }))),
    }, true);
  }

  window.PrevisaoBenchmarkTela = { abrir, atualizar };
})();
```

- [ ] **Step 4: `estilo.css`** (acrescentar no fim)

```css
/* ------------------------------ aba Benchmark ------------------------------ */
.benchmark { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; background: var(--fundo); }
.bm-blocos { display: flex; flex-direction: column; gap: 16px; }
.bm-cartao { background: #fff; border: 1px solid var(--linha); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.bm-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.bm-cab h2 { margin: 0; font-size: 16px; color: var(--verde-teal); }
.bm-sub { font-size: 12.5px; color: var(--texto-suave); margin: 0 0 8px; }
.bm-grafico { width: 100%; height: 280px; }
.bm-tabela-rolagem { overflow-x: auto; }
.bm-tabela { border-collapse: collapse; font-size: 12.5px; width: 100%; color: var(--texto); }
.bm-tabela th, .bm-tabela td { padding: 6px 8px; border-bottom: 1px solid var(--linha-suave); text-align: right; white-space: nowrap; }
.bm-tabela th:first-child, .bm-tabela tbody th { text-align: left; }
.bm-tabela thead th { color: var(--texto-suave); font-weight: 600; }
.bm-tabela small { display: block; color: var(--texto-fraco); font-size: 11px; }
.bm-tabela .bm-diverge { background: #fbefd9; }
.bm-tabela .bm-poucos { color: var(--texto-fraco); font-style: italic; }
.bm-cor { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.bm-rodape { font-size: 11.5px; color: var(--texto-suave); margin: 8px 0 0; }
.bm-aviso { margin: 0; padding: 10px 14px; border-radius: 8px; background: #fbefd9; color: #7a5200; font-size: 13px; }
@media (max-width: 600px) { .benchmark { padding: 12px; } .bm-cartao { padding: 12px; } .bm-grafico { height: 240px; } }
```

- [ ] **Step 5: Servidor local com dados fictícios**

Em `modulos/previsao/scripts/servidor-local.mjs`:
1. `unidade_pims` fictícia nas fazendas de teste: a assinatura passa a ser `function fazendaTeste(id, nome, coaId, unidade, norte, oeste, colunas, linhas)`, o retorno passa a ser `return { fazenda: { id, nome, coa_fazenda_id: coaId, unidade_pims: unidade }, talhoes };` e as três chamadas ficam:
```js
  fazendaTeste('teste-1', 'Fazenda Teste Norte', 1, 'TESTE NORTE', -12.9, -56.3, 5, 4),
  fazendaTeste('teste-2', 'Fazenda Teste Centro', 2, 'TESTE CENTRO', -13.6, -55.7, 6, 3),
  fazendaTeste('teste-3', 'Fazenda Teste Sul', 3, 'TESTE SUL', -14.6, -56.9, 4, 5),
```
2. No comentário do topo, acrescentar que o servidor responde também `/api/previsao-benchmark-teste` (fictício, ou o arquivo de `PREVISAO_BENCHMARK_DADOS`). Trocar o import de `node:fs` por `import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';` e, depois dos imports, acrescentar a geração do benchmark (determinística, fictícia) usando as contas reais do servidor:
```js
import { paresDoBenchmark, metricasDoBenchmark, somarDias, diaMT } from '../../mapas/scripts/sincronizar-plantio.mjs';

// Dados reais da conferência (Tarefa 5, --json): só nesta máquina, nunca no repositório. Sem a variável, fictícios.
const BENCHMARK_DADOS = process.env.PREVISAO_BENCHMARK_DADOS || '';

/** Benchmark FICTÍCIO: 30 dias de fotos e de chuva medida para as fazendas de teste, com as métricas calculadas pelas contas reais. */
function benchmarkTeste() {
  const hoje = diaMT(new Date());
  const unidades = ['TESTE NORTE', 'TESTE CENTRO', 'TESTE SUL'];
  let semente = 7;
  const sorteio = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  const chuva = () => (sorteio() < 0.45 ? Math.round(sorteio() * 300) / 10 : 0);
  const observado = [];
  const real = new Map();
  for (let i = -31; i < 15; i++) for (const u of unidades) real.set(`${u}|${somarDias(hoje, i)}`, chuva());
  for (let i = -31; i < 0; i++) for (const u of unidades) observado.push({ unidade: u, dia: somarDias(hoje, i), mm: real.get(`${u}|${somarDias(hoje, i)}`), pluviometros: 5 });
  const erro = { zeus: 3, visualcrossing: 5, metno: 7 };
  const alcance = { zeus: 13, visualcrossing: 14, metno: 9 };
  const previsoes = [];
  for (let e = -30; e <= 0; e++) {
    const emitida = somarDias(hoje, e);
    for (const u of unidades) for (const fonte of ['zeus', 'visualcrossing', 'metno']) {
      const dias = [];
      for (let k = fonte === 'metno' ? 1 : 0; k <= alcance[fonte]; k++) {
        const d = somarDias(emitida, k);
        const base = real.get(`${u}|${d}`) ?? 0;
        dias.push({ d, mm: Math.max(0, Math.round((base + (sorteio() - 0.5) * erro[fonte] * (1 + k / 5)) * 10) / 10), p: fonte === 'metno' ? null : Math.round(sorteio() * 100) });
      }
      previsoes.push({ fonte, unidade: u, emitida_em: emitida, capturada_em: `${emitida}T10:20:00Z`, dias });
    }
  }
  const metricas = metricasDoBenchmark(paresDoBenchmark(previsoes, observado), hoje);
  return JSON.stringify({ previsoes, observado, metricas });
}
```
3. Logo depois do bloco de `/api/previsao-teste`:
```js
  if (caminho === '/api/previsao-benchmark-teste') {
    responder(res, 200, TIPOS['.json'], BENCHMARK_DADOS ? readFileSync(BENCHMARK_DADOS, 'utf8') : benchmarkTeste());
    return;
  }
```

- [ ] **Step 6: Verificar no navegador local**

Run: `node --check previsao/app.js && node --check previsao/benchmark.js && node --test modulos/previsao/testes/*.test.mjs`, depois subir `node modulos/previsao/scripts/servidor-local.mjs` (porta 8791) e abrir `http://localhost:8791/previsao/#benchmark`.
Expected: os três blocos com dados fictícios; trocar fazenda (seletor) atualiza os blocos; "Todas as fazendas" mostra o ranking `TODAS`; trocar período e antecedência redesenha; voltar para `#mapa` (ou mensagem `previsao-vista`) mostra o Windy, e o Windy não é carregado enquanto só o benchmark foi aberto; `?tv=1#benchmark` abre o mapa; console sem erro. Conferir em largura de celular (375 px) que a tabela rola na horizontal sem estourar a página. Conferir as mensagens sem dados: no console do navegador, `window.PrevisaoBenchmarkTela.abrir({ carregar: async () => ({ previsoes: [], observado: [], metricas: [] }), unidade: () => 'TESTE NORTE', nomeFazenda: () => 'Teste' })` só funciona na primeira abertura (os dados ficam guardados por 30 min), então fazer isso numa página recém-carregada em `#mapa`: deve aparecer só o aviso "Ainda não há fotos…", sem blocos; repetir (página recarregada) com `unidade: () => null` → o aviso da fazenda sem unidade. Conferir o fim de linha com `git ls-files --eol`.

- [ ] **Step 7: Commit (local)**

```bash
git add previsao/ modulos/previsao/scripts/servidor-local.mjs
git commit -m "Previsão do Tempo: aba Benchmark (próximos 15 dias, ranking e previsto × medido)"
```

---

### Task 8: Casca — botão "Benchmark" e mensagens

**Files:**
- Modify: `index.html` (raiz; CRLF; menu `nav-previsao`, clique dos botões, `irParaPrevisao`, ouvinte de mensagens)

**Interfaces:**
- Consumes: mensagens da Tarefa 7.
- Produces: `PREVISAO_VISTAS = ['mapa', 'benchmark']`, `irParaPrevisao(vista?)`, `destacarBotaoPrevisao()`.

- [ ] **Step 1: Menu**

Trocar a linha do botão da Previsão (`<button class="nav-btn" data-page="previsao">…Mapa de previsão</button>`) por ela mesma com `data-previsao="mapa"` e acrescentar logo abaixo:
```html
        <button class="nav-btn" data-page="previsao" data-previsao="benchmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Benchmark</button>
```

- [ ] **Step 2: Clique**

No `forEach` dos `.nav-btn`, trocar `else if(btn.dataset.page === 'previsao') irParaPrevisao();` por `else if(btn.dataset.previsao) irParaPrevisao(btn.dataset.previsao);`.

- [ ] **Step 3: Abrir na aba pedida**

1. No comentário da seção PREVISÃO DO TEMPO, acrescentar `{ tipo:'previsao-vista', vista }` (COA → módulo) e `{ tipo:'previsao-rota', vista }` (módulo → COA).
2. Depois de `let previsaoCarregado = false;`:
```js
const PREVISAO_VISTAS = ['mapa','benchmark'];
let previsaoVista = 'mapa';
function destacarBotaoPrevisao(){
  document.querySelectorAll('#nav-previsao .nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.previsao===previsaoVista));
}
```
3. Trocar `function irParaPrevisao(){` e o corpo por:
```js
function irParaPrevisao(vista){
  if(vista && PREVISAO_VISTAS.includes(vista)) previsaoVista = vista;
  irPara('previsao');
  if(previsaoFrame){
    if(vista && previsaoCarregado && previsaoFrame.contentWindow){
      try{ previsaoFrame.contentWindow.postMessage({ tipo:'previsao-vista', vista:previsaoVista }, location.origin); }
      catch(e){ console.warn('PREVISÃO: não foi possível trocar a aba', e); }
    }
    destacarBotaoPrevisao();
    return;
  }
  const frame = document.createElement('iframe');
  frame.id = 'previsao-frame';
  frame.allow = 'fullscreen; screen-wake-lock'; // Modo TV
  frame.title = 'Previsão do Tempo';
  frame.addEventListener('load', ()=>{
    if(frame !== previsaoFrame) return;
    coaLoader.esconder();
    previsaoCarregado = true;
    enviarFazendaPrevisao();
    // um clique no outro botão enquanto o quadro carregava: a aba pedida por último vale
    try{ frame.contentWindow.postMessage({ tipo:'previsao-vista', vista:previsaoVista }, location.origin); }
    catch(e){ console.warn('PREVISÃO: não foi possível trocar a aba', e); }
  });
  coaLoader.mostrar('Abrindo a Previsão do Tempo', true);
  frame.src = 'previsao/index.html?embed=1&vista=' + previsaoVista;
  previsaoFrame = frame;
  previsaoCarregado = false;
  document.querySelector('.page[data-page="previsao"]').appendChild(frame);
  destacarBotaoPrevisao();
}
```
4. No ouvinte de mensagens da Previsão (o que trata `previsao-fazenda`), trocar a linha `if(!d || typeof d !== 'object' || d.tipo !== 'previsao-fazenda') return;` por:
```js
  if(!d || typeof d !== 'object') return;
  if(d.tipo === 'previsao-rota'){
    if(PREVISAO_VISTAS.includes(d.vista)){ previsaoVista = d.vista; destacarBotaoPrevisao(); }
    return;
  }
  if(d.tipo !== 'previsao-fazenda') return;
```

- [ ] **Step 4: Verificar**

Conferir a sintaxe do bloco `<script>` da casca (a raiz tem um só bloco sem `src`):

Run: `node -e "const fs=require('fs');const vm=require('vm');const h=fs.readFileSync('index.html','utf8');let n=0;for(const m of h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)){new vm.Script(m[1]);n++}console.log(n+' blocos ok')"`
Expected: `1 blocos ok`.

Conferir `git ls-files --eol index.html` e `git diff --stat -- index.html` (só as linhas esperadas, não o arquivo inteiro). Teste de tela: só depois de publicado (a casca exige login): os dois botões aparecem no menu da Previsão, cada um destaca a sua aba, e a troca não recarrega o quadro.

- [ ] **Step 5: Commit (local)**

```bash
git add index.html
git commit -m "Casca: botão Benchmark no menu da Previsão do Tempo"
```

---

### Task 9: Entrada no ar

**Files:** nenhum novo.

- [ ] **Step 1: Suítes completas**

Run: `cd modulos/mapas && npx vitest run && npx tsc --noEmit -p . && cd ../.. && node --test modulos/previsao/testes/*.test.mjs`
Expected: tudo PASS.

- [ ] **Step 2: Imagens com dados reais antes de publicar**

Rodar `node "C:/Users/bruno.moraes/Documents/CLAUDE GERAL/doc-coa-web/_trabalho/conferir_benchmark.mjs" --json`, subir o servidor local com `PREVISAO_BENCHMARK_DADOS` apontando para `doc-coa-web/_trabalho/benchmark-real.json` e abrir `http://localhost:8791/previsao/#benchmark` em "Todas as fazendas" (as fazendas do seletor local são as de teste; os dados reais aparecem na média de "Todas"). Só haverá o bloco dos próximos 15 dias e a chuva medida de 2 dias: o ranking só ganha números depois das primeiras fotos. Capturas mostradas ao dono antes de publicar; o JSON fica fora do repositório.

- [ ] **Step 3: Pedir autorização e aplicar o script 0024** (SQL Editor, com a sessão do dono; conferir com as consultas do fim do script).

- [ ] **Step 4: Chave do Visual Crossing** — o dono cria a conta grátis em visualcrossing.com e grava a chave na VM com o comando do README do servidor (eu não crio a conta nem vejo a chave).

- [ ] **Step 5: Pedir "pode publicar" e publicar** (`git push origin main`); conferir que o site serve `previsao/benchmark.js?v=202610141800` e que o `raw.githubusercontent.com` já tem `rodarBenchmarkPrevisao` em `sincronizar-plantio.mjs`.

- [ ] **Step 6: Conferir a primeira foto** no dia seguinte, depois das 6:17 de MT, por leitura no SQL Editor:

```sql
select fonte, count(*) as fazendas, min(jsonb_array_length(dias)) as dias_min, max(jsonb_array_length(dias)) as dias_max
from public.prev_previsoes where emitida_em = (now() at time zone 'America/Cuiaba')::date group by 1 order by 1;
select count(*) from public.prev_observado;
select capturada_em from public.prev_zeus_atualizacoes order by 1 desc limit 5;
```
Expected: 3 fontes (2 se a chave do Visual Crossing não estiver na VM) × 7 fazendas; ZEUS 14 dias, Visual Crossing 15, MET Norway ~9.

- [ ] **Step 7: Atualizar a memória do projeto** (`previsao-tempo-coa.md`): aba Benchmark no ar, data, commit e a hora em que a ZEUS publica (de `prev_zeus_atualizacoes`, depois de alguns dias).
