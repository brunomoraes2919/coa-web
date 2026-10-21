-- COA WEB — Mapas: Mapa de CAR e Matrícula (só ADMINISTRADOR+).
--
-- mapas_car_pedidos: o botão "Buscar nas bases" da aba grava um pedido (a fazenda de mapa). O servidor do Google
--   Cloud confere os pedidos pendentes a cada ~30 s (modulos/mapas/scripts/atender-pedidos.mjs, com a chave de
--   serviço), consulta as bases públicas (SICAR: perímetro do CAR e temas declarados; INCRA/SIGEF: parcelas
--   certificadas com a matrícula; IBGE e OpenStreetMap: estradas e hidrografia; PIMS: talhões de eucalipto) e
--   grava o resultado em mapas_car. O navegador nunca fala com essas bases.
-- mapas_car: o último resultado de cada fazenda de mapa (camadas em GeoJSON e a situação de cada fonte). Uma
--   linha por fazenda; a busca seguinte substitui a anterior.
--
-- Quem lê e pede: só o ADMINISTRADOR+ (is_super, script 0002) com a categoria Mapas. Quem grava a resposta: só o
-- servidor (service_role). Nada de anon.
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada). O SQL Editor pode pedir para
-- confirmar uma "destructive operation" por causa dos "drop policy if exists": eles só recriam as regras destas
-- tabelas.

begin;

set local lock_timeout = '5s';

create table if not exists public.mapas_car (
  fazenda_id     uuid primary key references public.mapas_fazendas (id) on delete cascade,
  atualizado_em  timestamptz not null default now(),
  -- { bbox, ufs, car, temas, matriculas, estradas, hidrografia, eucalipto } (FeatureCollections e listas)
  dados          jsonb not null,
  -- situação de cada fonte: { sicar: { ok, n, erro }, temas: ..., sigef: ..., ibge: ..., osm: ..., pims: ... }
  fontes         jsonb not null default '{}'::jsonb
);

create table if not exists public.mapas_car_pedidos (
  id          bigint generated always as identity primary key,
  pedido_em   timestamptz not null default now(),
  -- quem pediu (preenchido pelo banco com o usuário logado)
  pedido_por  uuid not null default auth.uid(),
  fazenda_id  uuid not null references public.mapas_fazendas (id) on delete cascade,
  -- preenchidos pelo servidor quando o pedido é atendido
  atendido_em timestamptz,
  -- 'ok' ou 'erro: <mensagem curta>' (sem segredos)
  resultado   text
);

-- o servidor procura só os pendentes
create index if not exists mapas_car_pedidos_pendentes_idx on public.mapas_car_pedidos (id) where atendido_em is null;

alter table public.mapas_car enable row level security;
alter table public.mapas_car_pedidos enable row level security;

revoke all on table public.mapas_car from anon, authenticated;
revoke all on table public.mapas_car_pedidos from anon, authenticated;
grant select on table public.mapas_car to authenticated;
grant select, insert on table public.mapas_car_pedidos to authenticated;
grant select, insert, update, delete on table public.mapas_car to service_role;
grant select, insert, update, delete on table public.mapas_car_pedidos to service_role;

-- lê o resultado: só o ADMINISTRADOR+
drop policy if exists mapas_car_select on public.mapas_car;
create policy mapas_car_select on public.mapas_car
  for select to authenticated using ((select public.is_super()));

-- vê os pedidos: o ADMINISTRADOR+, os próprios
drop policy if exists mapas_car_pedidos_select on public.mapas_car_pedidos;
create policy mapas_car_pedidos_select on public.mapas_car_pedidos
  for select to authenticated using ((select public.is_super()) and pedido_por = auth.uid());

-- pede: o ADMINISTRADOR+, em nome próprio e como pedido pendente (sem resposta)
drop policy if exists mapas_car_pedidos_insert on public.mapas_car_pedidos;
create policy mapas_car_pedidos_insert on public.mapas_car_pedidos
  for insert to authenticated
  with check ((select public.is_super()) and pedido_por = auth.uid() and atendido_em is null and resultado is null);

-- sem regra de update/delete: só o servidor (chave de serviço, que ignora o RLS) responde e limpa

-- restritiva por categoria (padrão do 0020): sem a categoria Mapas, nada
drop policy if exists mapas_car_categoria on public.mapas_car;
create policy mapas_car_categoria on public.mapas_car
  as restrictive for all to authenticated
  using ((select public.tem_alguma_categoria(array['mapas']::text[])))
  with check ((select public.tem_alguma_categoria(array['mapas']::text[])));

drop policy if exists mapas_car_pedidos_categoria on public.mapas_car_pedidos;
create policy mapas_car_pedidos_categoria on public.mapas_car_pedidos
  as restrictive for all to authenticated
  using ((select public.tem_alguma_categoria(array['mapas']::text[])))
  with check ((select public.tem_alguma_categoria(array['mapas']::text[])));

commit;

-- Conferência (rodar depois, opcional):
-- select tablename, policyname, permissive, cmd from pg_policies where tablename in ('mapas_car', 'mapas_car_pedidos') order by 1, 2;
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--  where table_name in ('mapas_car', 'mapas_car_pedidos') and grantee in ('anon', 'authenticated') order by 1, 2, 3;
