-- =================================================================================================
-- Módulo MAPAS do COA WEB — até que dia e hora a ZEUS tem dados no banco (tabela mapas_zeus_situacao)
-- e pedido de chuva com hora (colunas de_hora e ate_hora em mapas_chuva_pedidos)
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB, DEPOIS do 0003_pedidos_chuva.sql.
--
-- Ao lado do botão "Inserir dados via integração" o Mapa de Chuva mostra o último dia com leitura de
-- chuva de cada fazenda no banco da ZEUS, para ninguém pedir um período que ainda não chegou. Quem
-- confere isso é o servidor do Google Cloud (scripts/atender-pedidos.mjs, com a chave de serviço), a
-- cada ~15 min, e grava uma linha por fazenda aqui. O navegador só lê.
--
-- A janela do botão também ganhou a opção de informar a hora inicial e a final do período: o pedido
-- grava as duas horas em mapas_chuva_pedidos (vazias = dias inteiros, como sempre foi).
--
-- O que este script faz: cria a tabela nova mapas_zeus_situacao, com suas regras (RLS), e acrescenta
-- duas colunas opcionais a mapas_chuva_pedidos. Não apaga nada e não muda os pedidos que já existem.
-- Idempotente e atômico (pode rodar de novo; se algo falhar, nada fica aplicado). O SQL Editor pode
-- pedir para confirmar uma "destructive operation" por causa do "drop policy if exists" e do "drop
-- constraint if exists": eles só recriam a regra e a conferência criadas aqui.

begin;

set local lock_timeout = '5s';

create table if not exists public.mapas_zeus_situacao (
  -- fazenda da ZEUS, com o nome normalizado como no pedido de chuva ('Faz_SM3' → 'SM3')
  fazenda      text primary key check (char_length(fazenda) between 1 and 80),
  -- último dia com leitura de chuva dos PICs da fazenda no banco
  ultimo_dia   date not null,
  -- data e hora da última leitura (hora da fazenda, sem fuso); null = o identificador da leitura não trouxe a hora
  ultima_leitura timestamp,
  -- quando o servidor conferiu isso pela última vez
  conferido_em timestamptz not null default now()
);

alter table public.mapas_zeus_situacao enable row level security;

revoke all on table public.mapas_zeus_situacao from anon, authenticated;
-- usuário do módulo: só lê (são só datas, sem dado de fazenda)
grant select on table public.mapas_zeus_situacao to authenticated;
-- o servidor (chave de serviço) grava
grant select, insert, update, delete on table public.mapas_zeus_situacao to service_role;

drop policy if exists mapas_zeus_situacao_select on public.mapas_zeus_situacao;
create policy mapas_zeus_situacao_select on public.mapas_zeus_situacao
  for select to authenticated
  using ((select public.mapas_eh_usuario()));

-- sem regra de insert/update/delete: só o servidor (chave de serviço, que ignora o RLS) grava

-- ---------- pedido de chuva com hora ----------
-- vazias = dias inteiros; preenchidas = só as leituras entre de + de_hora e ate + ate_hora (inclusive)
alter table public.mapas_chuva_pedidos
  add column if not exists de_hora  time,
  add column if not exists ate_hora time;

alter table public.mapas_chuva_pedidos drop constraint if exists mapas_chuva_pedidos_horas;
alter table public.mapas_chuva_pedidos add constraint mapas_chuva_pedidos_horas
  check ((de_hora is null) = (ate_hora is null) and (de_hora is null or ate > de or ate_hora >= de_hora));

commit;
