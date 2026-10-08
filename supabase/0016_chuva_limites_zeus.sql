-- COA WEB — "Chuva por talhão": opção "Talhões da ZEUS" no campo Limites.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0015 (pode rodar de novo sem estragar nada).
-- Cria só a tabela deste recurso; não altera nem apaga nada que já exista.
--
-- chuva_limites_zeus — o contorno dos talhões cadastrados na ZEUS (datalake, soils_database_database.stg_fields),
--                      das fazendas que têm chuva por talhão. Gravado pelo servidor do Google Cloud uma vez por
--                      dia (modulos/mapas/scripts/atender-pedidos.mjs → atualizarLimitesZeus). Uma linha por fazenda.

begin;

set local lock_timeout = '5s';

create table if not exists public.chuva_limites_zeus (
  -- fazenda com o nome da unidade do PIMS, a mesma chave de chuva_talhao
  unidade   text primary key,
  gerado_em timestamptz not null,
  -- [{ codigo (do talhão, como no PIMS), nome, id (do talhão na ZEUS), area_ha, geom (GeoJSON MultiPolygon em lon/lat) }]
  talhoes   jsonb not null default '[]'::jsonb
);

alter table public.chuva_limites_zeus enable row level security;
revoke all on table public.chuva_limites_zeus from anon, authenticated;
grant select on table public.chuva_limites_zeus to authenticated;
grant select, insert, update, delete on table public.chuva_limites_zeus to service_role;

-- vê quem tem a categoria Chuva por talhão e pode ver a fazenda (a mesma regra de chuva_talhao)
drop policy if exists chuva_limites_zeus_select on public.chuva_limites_zeus;
create policy chuva_limites_zeus_select on public.chuva_limites_zeus
  for select to authenticated
  using ((select public.tem_categoria('chuva')) and public.acomp_pode_ver_unidade(unidade));

commit;
