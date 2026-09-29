-- =================================================================================================
-- Módulo MAPAS do COA WEB — pedidos de "Atualizar plantio" (tabela mapas_plantio_pedidos)
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB, DEPOIS do 0001_mapas.sql.
--
-- O botão "Atualizar plantio" do módulo grava um pedido aqui; o servidor do Google Cloud confere os
-- pedidos pendentes a cada ~30 s (scripts/atender-pedidos.mjs, com a chave de serviço), roda a rotina do
-- PIMS na hora e marca os pedidos como atendidos. O navegador nunca fala com o Agrovex.
--
-- O que este script faz: cria SÓ a tabela nova mapas_plantio_pedidos, com suas regras (RLS) e índice.
-- Não altera nem apaga nada que já exista. Idempotente e atômico (pode rodar de novo; se algo falhar,
-- nada fica aplicado). O SQL Editor pode pedir para confirmar uma "destructive operation" por causa dos
-- "drop policy if exists": eles só recriam as regras desta tabela.

begin;

set local lock_timeout = '5s';

create table if not exists public.mapas_plantio_pedidos (
  id          bigint generated always as identity primary key,
  pedido_em   timestamptz not null default now(),
  -- quem pediu (preenchido pelo banco com o usuário logado)
  pedido_por  uuid not null default auth.uid(),
  -- preenchidos pelo servidor quando o pedido é atendido
  atendido_em timestamptz,
  -- 'ok' ou a mensagem de erro (sem segredos)
  resultado   text
);

-- o servidor procura só os pendentes
create index if not exists mapas_plantio_pedidos_pendentes_idx
  on public.mapas_plantio_pedidos (id) where atendido_em is null;

alter table public.mapas_plantio_pedidos enable row level security;

revoke all on table public.mapas_plantio_pedidos from anon, authenticated;
-- usuário do módulo: pede e acompanha; não altera nem apaga
grant select, insert on table public.mapas_plantio_pedidos to authenticated;
-- o servidor (chave de serviço) marca como atendido e limpa os antigos
grant select, insert, update, delete on table public.mapas_plantio_pedidos to service_role;

-- vê os pedidos quem usa o módulo (admin ou colaborador com fazenda liberada)
drop policy if exists mapas_plantio_pedidos_select on public.mapas_plantio_pedidos;
create policy mapas_plantio_pedidos_select on public.mapas_plantio_pedidos
  for select to authenticated
  using ((select public.mapas_eh_usuario()));

-- pede quem usa o módulo, sempre em nome próprio e como pedido pendente
drop policy if exists mapas_plantio_pedidos_insert on public.mapas_plantio_pedidos;
create policy mapas_plantio_pedidos_insert on public.mapas_plantio_pedidos
  for insert to authenticated
  with check (
    (select public.mapas_eh_usuario())
    and pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
  );

-- sem regra de update/delete: só o servidor (chave de serviço, que ignora o RLS) altera ou apaga

commit;
