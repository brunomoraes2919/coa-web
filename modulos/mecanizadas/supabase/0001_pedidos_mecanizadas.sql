-- =================================================================================================
-- COA WEB · Mecanizadas — pedidos de "Buscar direto no PIMS" (tabela mec_pims_pedidos)
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB, DEPOIS dos scripts do módulo MAPAS
-- (usa a função public.mapas_eh_usuario(), criada em modulos/mapas/supabase/coa-web/0001_mapas.sql).
--
-- O botão "Buscar direto no PIMS" da tela Importar Boletim grava um pedido aqui (unidade e período); o
-- servidor do Google Cloud confere os pedidos pendentes a cada ~30 s (modulos/mapas/scripts/
-- atender-pedidos.mjs, com a chave de serviço), busca no PIMS os boletins de atividades mecanizadas da
-- unidade no período e grava a resposta no próprio pedido (coluna dados), no formato do relatório
-- exportado do PIMS. O navegador nunca fala com o servidor de dados.
--
-- O que este script faz: cria SÓ a tabela nova mec_pims_pedidos, com suas regras (RLS) e índice. Não
-- altera nem apaga nada que já exista. Idempotente e atômico (pode rodar de novo; se algo falhar, nada
-- fica aplicado). O SQL Editor pode pedir para confirmar uma "destructive operation" por causa dos
-- "drop policy if exists": eles só recriam as regras desta tabela.

begin;

set local lock_timeout = '5s';

create table if not exists public.mec_pims_pedidos (
  id          bigint generated always as identity primary key,
  pedido_em   timestamptz not null default now(),
  -- quem pediu (preenchido pelo banco com o usuário logado)
  pedido_por  uuid not null default auth.uid(),
  -- unidade administrativa como o PIMS escreve no relatório (ex.: 'T. FLECHAS', 'GLOBO')
  unidade     text not null check (char_length(unidade) between 2 and 30),
  -- período pedido, as duas datas inclusive
  de          date not null,
  ate         date not null,
  -- preenchidos pelo servidor quando o pedido é atendido
  atendido_em timestamptz,
  -- 'ok' ou a mensagem de erro (sem segredos)
  resultado   text,
  -- resposta: { unidade, de, ate, cabecalho: [22 colunas], linhas: [[...], ...] }
  dados       jsonb,
  constraint mec_pims_pedidos_periodo check (ate >= de and ate - de <= 62)
);

-- o servidor procura só os pendentes
create index if not exists mec_pims_pedidos_pendentes_idx
  on public.mec_pims_pedidos (id) where atendido_em is null;

alter table public.mec_pims_pedidos enable row level security;

revoke all on table public.mec_pims_pedidos from anon, authenticated;
-- usuário do COA WEB: pede e acompanha; não altera nem apaga
grant select, insert on table public.mec_pims_pedidos to authenticated;
-- o servidor (chave de serviço) responde e limpa os antigos
grant select, insert, update, delete on table public.mec_pims_pedidos to service_role;

-- cada usuário vê só os próprios pedidos
drop policy if exists mec_pims_pedidos_select on public.mec_pims_pedidos;
create policy mec_pims_pedidos_select on public.mec_pims_pedidos
  for select to authenticated
  using ((select public.mapas_eh_usuario()) and pedido_por = auth.uid());

-- pede quem usa o COA WEB (admin ou colaborador com fazenda liberada), em nome próprio e como pendente
drop policy if exists mec_pims_pedidos_insert on public.mec_pims_pedidos;
create policy mec_pims_pedidos_insert on public.mec_pims_pedidos
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
