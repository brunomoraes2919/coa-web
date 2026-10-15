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
