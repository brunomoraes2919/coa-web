-- COA WEB — Mapas: nome comercial das variedades.
-- mapas_variedades: o cadastro de variedades do PIMS (tabela VARIEDADE + grupo de maturação), gravado pela rotina
-- da VM a cada hora, com o nome comercial que o administrador digita na tela Mapas → Cadastros → Variedades.
--   chave         = nome da variedade limpo e em maiúsculas (a mesma chave de mapas_variedade_cores e dos mapas);
--                   códigos do PIMS com o mesmo nome limpo viram uma linha só, com todos eles em `pims`
--   em_uso        = algum talhão das safras atuais (as mesmas que a rotina lê) usa a variedade
--   visto_em      = primeira vez que a rotina viu a variedade (a tela destaca as novas sem nome comercial)
--   nome_comercial= digitado na tela; a rotina nunca grava nem apaga esta coluna (o upsert não a manda)
-- Lê: quem tem a categoria Mapas ou Operacional (o nome também sai na Revista). Grava o nome comercial: só o
-- administrador, e só as colunas do nome (o resto é do PIMS). Insere e apaga: só a rotina (service_role).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: modulos/mapas/supabase/coa-web/0001 (mapas_eh_admin) e 0020 (tem_alguma_categoria).

begin;

set local lock_timeout = '5s';

create table if not exists public.mapas_variedades (
  chave           text primary key check (char_length(btrim(chave)) between 1 and 160),
  nome_pims       text not null check (char_length(btrim(nome_pims)) between 1 and 160),
  grupo           text,
  pims            jsonb not null default '[]'::jsonb,
  em_uso          boolean not null default false,
  talhoes         integer not null default 0,
  ativo           boolean not null default true,
  visto_em        timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  nome_comercial  text check (nome_comercial is null or char_length(btrim(nome_comercial)) between 1 and 80),
  comercial_em    timestamptz,
  comercial_por   uuid
);
create index if not exists mapas_variedades_em_uso_idx on public.mapas_variedades (em_uso) where nome_comercial is null;

-- quem e quando mudou o nome comercial: sempre do lado do banco (não depende de quem chama)
create or replace function public.mapas_variedades_carimbo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.nome_comercial is distinct from old.nome_comercial then
    new.nome_comercial := nullif(btrim(new.nome_comercial), '');
    new.comercial_em := now();
    new.comercial_por := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists mapas_variedades_carimbo on public.mapas_variedades;
create trigger mapas_variedades_carimbo before update on public.mapas_variedades
  for each row execute function public.mapas_variedades_carimbo();

alter table public.mapas_variedades enable row level security;
revoke all on table public.mapas_variedades from anon, authenticated;
grant select on table public.mapas_variedades to authenticated;
-- o navegador só consegue mexer no nome comercial (as outras colunas vêm do PIMS)
grant update (nome_comercial) on table public.mapas_variedades to authenticated;
grant select, insert, update, delete on table public.mapas_variedades to service_role;

drop policy if exists mapas_variedades_select on public.mapas_variedades;
create policy mapas_variedades_select on public.mapas_variedades
  for select to authenticated using (true);

drop policy if exists mapas_variedades_update on public.mapas_variedades;
create policy mapas_variedades_update on public.mapas_variedades
  for update to authenticated using ((select public.mapas_eh_admin())) with check ((select public.mapas_eh_admin()));

-- restritiva por categoria (padrão do 0020): sem a categoria Mapas ou Operacional, nada
drop policy if exists mapas_variedades_categoria on public.mapas_variedades;
create policy mapas_variedades_categoria on public.mapas_variedades
  as restrictive for all to authenticated
  using ((select public.tem_alguma_categoria(array['mapas', 'acompanhamento']::text[])))
  with check ((select public.tem_alguma_categoria(array['mapas', 'acompanhamento']::text[])));

commit;
