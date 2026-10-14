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
