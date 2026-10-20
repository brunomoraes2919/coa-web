-- COA WEB — Operacional: sementes por metro e população de cada variedade, por fazenda e safra.
-- acomp_variedade_populacao: cadastro manual feito na aba Revista do Operacional (botão "Sementes e população"),
-- que sai na página Variedades da revista daquela fazenda.
--   unidade        = unidade do PIMS (a mesma de acomp_pims e acomp_metas), em maiúsculas
--   safra          = safra do Operacional (a mesma de acomp_pims e acomp_metas)
--   variedade      = chave da variedade: nome do PIMS limpo e em maiúsculas (a mesma de mapas_variedades)
--   sementes_metro = sementes por metro linear (ex.: 12,2)
--   populacao      = plantas por hectare (ex.: 244000)
-- Quem lê e grava: as mesmas regras das metas do Operacional (acomp_metas): quem tem a categoria Operacional e
-- enxerga a fazenda (acomp_pode_ver_unidade). Quem e quando gravou: sempre do lado do banco (gatilho).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: acompanhamento 0001 (acomp_pode_ver_unidade), 0002 (versão atual dela) e 0020 (tem_alguma_categoria).

begin;

set local lock_timeout = '5s';

create table if not exists public.acomp_variedade_populacao (
  unidade         text not null check (char_length(btrim(unidade)) between 1 and 60),
  safra           text not null check (char_length(btrim(safra)) between 1 and 60),
  variedade       text not null check (char_length(btrim(variedade)) between 1 and 160),
  sementes_metro  numeric(5,2) check (sementes_metro is null or (sementes_metro > 0 and sementes_metro < 100)),
  populacao       integer check (populacao is null or populacao between 1000 and 2000000),
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid,
  primary key (unidade, safra, variedade),
  -- linha sem nenhum dos dois não tem por que existir (a tela apaga em vez de gravar vazio)
  check (sementes_metro is not null or populacao is not null)
);

create or replace function public.acomp_variedade_populacao_carimbo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.unidade := upper(btrim(new.unidade));
  new.variedade := upper(btrim(new.variedade));
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;
revoke all on function public.acomp_variedade_populacao_carimbo() from public, anon, authenticated;
drop trigger if exists acomp_variedade_populacao_carimbo on public.acomp_variedade_populacao;
create trigger acomp_variedade_populacao_carimbo before insert or update on public.acomp_variedade_populacao
  for each row execute function public.acomp_variedade_populacao_carimbo();

alter table public.acomp_variedade_populacao enable row level security;
revoke all on table public.acomp_variedade_populacao from anon, authenticated;
grant select, insert, update, delete on table public.acomp_variedade_populacao to authenticated;
grant select, insert, update, delete on table public.acomp_variedade_populacao to service_role;

drop policy if exists acomp_variedade_populacao_select on public.acomp_variedade_populacao;
create policy acomp_variedade_populacao_select on public.acomp_variedade_populacao
  for select to authenticated using (public.acomp_pode_ver_unidade(unidade));

drop policy if exists acomp_variedade_populacao_insert on public.acomp_variedade_populacao;
create policy acomp_variedade_populacao_insert on public.acomp_variedade_populacao
  for insert to authenticated with check (public.acomp_pode_ver_unidade(unidade));

drop policy if exists acomp_variedade_populacao_update on public.acomp_variedade_populacao;
create policy acomp_variedade_populacao_update on public.acomp_variedade_populacao
  for update to authenticated
  using (public.acomp_pode_ver_unidade(unidade))
  with check (public.acomp_pode_ver_unidade(unidade));

drop policy if exists acomp_variedade_populacao_delete on public.acomp_variedade_populacao;
create policy acomp_variedade_populacao_delete on public.acomp_variedade_populacao
  for delete to authenticated using (public.acomp_pode_ver_unidade(unidade));

-- restritiva por categoria (padrão do 0020): sem a categoria Operacional, nada
drop policy if exists acomp_variedade_populacao_categoria on public.acomp_variedade_populacao;
create policy acomp_variedade_populacao_categoria on public.acomp_variedade_populacao
  as restrictive for all to authenticated
  using ((select public.tem_alguma_categoria(array['acompanhamento']::text[])))
  with check ((select public.tem_alguma_categoria(array['acompanhamento']::text[])));

commit;

-- Conferência (rodar depois, opcional):
-- select relrowsecurity from pg_class where oid = 'public.acomp_variedade_populacao'::regclass;           -- true
-- select policyname, permissive, cmd from pg_policies where tablename = 'acomp_variedade_populacao';    -- 5 regras
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'acomp_variedade_populacao' order by 1, 2;                                       -- sem anon
