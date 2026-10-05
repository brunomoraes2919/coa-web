-- =================================================================================================
-- Módulo MAPAS do COA WEB — pedidos de "Inserir dados via integração" (tabela mapas_chuva_pedidos)
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB, DEPOIS do 0002_pedidos_plantio.sql.
--
-- O botão "Inserir dados via integração" do Mapa de Chuva grava um pedido aqui (fazenda e período); o
-- servidor do Google Cloud confere os pedidos pendentes a cada ~30 s (scripts/atender-pedidos.mjs, com
-- a chave de serviço), busca na ZEUS a chuva de cada PIC da fazenda no período e grava a resposta no
-- próprio pedido (coluna dados). O navegador nunca fala com o servidor de dados.
--
-- O que este script faz: cria SÓ a tabela nova mapas_chuva_pedidos, com suas regras (RLS) e índice.
-- Não altera nem apaga nada que já exista. Idempotente e atômico (pode rodar de novo; se algo falhar,
-- nada fica aplicado). O SQL Editor pode pedir para confirmar uma "destructive operation" por causa dos
-- "drop policy if exists": eles só recriam as regras desta tabela.

begin;

set local lock_timeout = '5s';

create table if not exists public.mapas_chuva_pedidos (
  id          bigint generated always as identity primary key,
  pedido_em   timestamptz not null default now(),
  -- quem pediu (preenchido pelo banco com o usuário logado)
  pedido_por  uuid not null default auth.uid(),
  -- nome da fazenda do mapa (o servidor acha a fazenda da ZEUS pelo nome, sem acento nem prefixo)
  fazenda     text not null check (char_length(fazenda) between 1 and 80),
  -- período pedido, as duas datas inclusive
  de          date not null,
  ate         date not null,
  -- preenchidos pelo servidor quando o pedido é atendido
  atendido_em timestamptz,
  -- 'ok' ou a mensagem de erro (sem segredos)
  resultado   text,
  -- resposta: { fazenda, de, ate, ultimoDia, pics: [{ id, nome, lat, lon, chuva, leituras }] }
  dados       jsonb,
  constraint mapas_chuva_pedidos_periodo check (ate >= de and ate - de <= 366)
);

-- o servidor procura só os pendentes
create index if not exists mapas_chuva_pedidos_pendentes_idx
  on public.mapas_chuva_pedidos (id) where atendido_em is null;

alter table public.mapas_chuva_pedidos enable row level security;

revoke all on table public.mapas_chuva_pedidos from anon, authenticated;
-- usuário do módulo: pede e acompanha; não altera nem apaga
grant select, insert on table public.mapas_chuva_pedidos to authenticated;
-- o servidor (chave de serviço) responde e limpa os antigos
grant select, insert, update, delete on table public.mapas_chuva_pedidos to service_role;

-- cada usuário do módulo vê só os próprios pedidos
drop policy if exists mapas_chuva_pedidos_select on public.mapas_chuva_pedidos;
create policy mapas_chuva_pedidos_select on public.mapas_chuva_pedidos
  for select to authenticated
  using ((select public.mapas_eh_usuario()) and pedido_por = auth.uid());

-- pede quem usa o módulo, sempre em nome próprio e como pedido pendente (sem resposta)
drop policy if exists mapas_chuva_pedidos_insert on public.mapas_chuva_pedidos;
create policy mapas_chuva_pedidos_insert on public.mapas_chuva_pedidos
  for insert to authenticated
  with check (
    (select public.mapas_eh_usuario())
    and pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
    and dados is null
  );

-- sem regra de update/delete: só o servidor (chave de serviço, que ignora o RLS) altera ou apaga

commit;
