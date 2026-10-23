-- COA WEB — dados do PIMS, SAP e ZEUS atualizados só quando alguém clica em Atualizar (alívio do servidor do Agrovex).
--
-- Antes, o servidor (VM) consultava o Agrovex sozinho o dia todo: a rotina completa de hora em hora, a chuva por talhão a
-- cada 30 min e a situação da ZEUS a cada 15 min, relendo histórico que não muda. Nos picos (manhã, almoço, fim da
-- tarde) isso travava o Agrovex para as outras pessoas. Agora o servidor só consulta quando há pedido (o botão
-- Atualizar de cada tela; as TVs pedem sozinhas de hora em hora enquanto estão ligadas), e uma vez por dia, às 4h, o
-- benchmark da previsão e o cadastro de variedades.
--
-- Este script:
--   1. valid_pedidos.unidade: o Atualizar da Validação PIMS pede só a unidade que está na tela (vazio = todas);
--      o coordenador do Controle Técnico também pode pedir (sempre de uma unidade, a da equipe dele).
--   2. chuva_talhao_pedidos: o botão Atualizar da Chuva por talhão (antes ela era relida a cada 30 min).
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada). Depende de 0007, 0009, 0015, 0018 e 0032.

begin;

set local lock_timeout = '5s';

-- 1. Validação: a unidade do pedido ------------------------------------------------------------------------------
alter table public.valid_pedidos add column if not exists unidade text;
alter table public.valid_pedidos drop constraint if exists valid_pedidos_unidade_check;
alter table public.valid_pedidos add constraint valid_pedidos_unidade_check
  check (unidade is null or char_length(unidade) between 1 and 80);

drop policy if exists valid_pedidos_select on public.valid_pedidos;
create policy valid_pedidos_select on public.valid_pedidos
  for select to authenticated
  using (((select public.tem_categoria('validacao')) or (select public.tem_categoria('controle'))) and pedido_por = auth.uid());

drop policy if exists valid_pedidos_insert on public.valid_pedidos;
create policy valid_pedidos_insert on public.valid_pedidos
  for insert to authenticated
  with check (
    pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
    and ((select public.tem_categoria('validacao')) or ((select public.tem_categoria('controle')) and unidade is not null))
  );

-- 2. Chuva por talhão: pedidos do botão Atualizar -----------------------------------------------------------------
create table if not exists public.chuva_talhao_pedidos (
  id          bigint generated always as identity primary key,
  pedido_em   timestamptz not null default now(),
  pedido_por  uuid not null default auth.uid(),
  atendido_em timestamptz,
  -- 'ok' ou a mensagem de erro (sem segredos)
  resultado   text
);
create index if not exists chuva_talhao_pedidos_pendentes_idx
  on public.chuva_talhao_pedidos (id) where atendido_em is null;

alter table public.chuva_talhao_pedidos enable row level security;
revoke all on table public.chuva_talhao_pedidos from anon, authenticated;
grant select, insert on table public.chuva_talhao_pedidos to authenticated;
grant select, insert, update, delete on table public.chuva_talhao_pedidos to service_role;

drop policy if exists chuva_talhao_pedidos_select on public.chuva_talhao_pedidos;
create policy chuva_talhao_pedidos_select on public.chuva_talhao_pedidos
  for select to authenticated
  using ((select public.tem_categoria('chuva')) and pedido_por = auth.uid());

drop policy if exists chuva_talhao_pedidos_insert on public.chuva_talhao_pedidos;
create policy chuva_talhao_pedidos_insert on public.chuva_talhao_pedidos
  for insert to authenticated
  with check (
    (select public.tem_categoria('chuva'))
    and pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
  );

-- o mesmo freio das outras filas (0018: 30 pedidos por hora e 5 aguardando, por usuário) e o registro na Aderência (0032)
drop trigger if exists pedidos_limite_trg on public.chuva_talhao_pedidos;
create trigger pedidos_limite_trg before insert on public.chuva_talhao_pedidos
  for each row execute function public.pedidos_limitar();
drop trigger if exists uso_pedido on public.chuva_talhao_pedidos;
create trigger uso_pedido after insert on public.chuva_talhao_pedidos
  for each row execute function public.uso_registrar_pedido('chuva_talhao');

commit;

-- Conferência (opcional):
-- select column_name from information_schema.columns where table_name = 'valid_pedidos';                 -- com unidade
-- select policyname, cmd from pg_policies where tablename in ('valid_pedidos', 'chuva_talhao_pedidos');
