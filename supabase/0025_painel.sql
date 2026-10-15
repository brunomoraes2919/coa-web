-- COA WEB — Montagens de Painel (TV do COA): as montagens com nome e a montagem que está na TV
-- (especificação: modulos/painel/docs/2026-10-15-montagens-de-painel-design.md).
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0024 (pode rodar de novo sem estragar nada).
-- Depende de: 0002 (tem_categoria), 0020 (tem_alguma_categoria e a regra mapas_fazendas_categoria).
--
-- Muda duas coisas que já existem e cria duas tabelas:
--   1. a lista de categorias aceitas ganha 'painel' (Usuários → Categorias → "Montagens de Painel");
--   2. a regra restritiva de leitura de mapas_fazendas aceita também 'painel' (os atalhos do módulo listam as
--      fazendas que o usuário enxerga);
--   3. painel_montagens (uma linha por montagem) e painel_tv (uma linha só: a montagem que está na TV).
-- Quem lê e grava: logado com a categoria 'painel' (o ADMINISTRADOR+ tem todas). Ninguém sem login.
--
-- ANTES de rodar, confira que as duas listas abaixo são as de agora (o script reescreve as duas inteiras):
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'usuario_categorias_categoria_check';
--   select qual from pg_policies where tablename = 'mapas_fazendas' and policyname = 'mapas_fazendas_categoria';
-- (em 15/10/2026: a lista do 0015 e {mapas,acompanhamento,chuva,previsao,sat,validacao}). Se o CHECK novo não
-- couber nas linhas que já existem, o comando falha e NADA é gravado (está tudo num begin/commit).
--
-- Como desfazer:
--   drop table if exists public.painel_tv;
--   drop table if exists public.painel_montagens;
--   drop function if exists public.painel_tocar();
--   drop function if exists public.painel_tv_tocar();
--   e recriar o CHECK e a regra mapas_fazendas_categoria sem 'painel' (listas do 0015 e do 0020).

begin;

set local lock_timeout = '5s';

-- 1. categoria nova
alter table public.usuario_categorias drop constraint if exists usuario_categorias_categoria_check;
alter table public.usuario_categorias add constraint usuario_categorias_categoria_check
  check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat', 'previsao', 'validacao', 'controle', 'chuva', 'painel'));

-- 2. os atalhos do módulo leem as fazendas
drop policy if exists mapas_fazendas_categoria on public.mapas_fazendas;
create policy mapas_fazendas_categoria on public.mapas_fazendas as restrictive for select to authenticated
  using ((select public.tem_alguma_categoria(array['mapas', 'acompanhamento', 'chuva', 'previsao', 'sat', 'validacao', 'painel']::text[])));

-- 3. tabelas
create or replace function public.painel_tocar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create or replace function public.painel_tv_tocar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

-- uma linha por montagem; os 4 quadros (sites, tempos, recarga) vão num JSON que a tela confere ao ler e ao gravar
-- (painel/logica.js → normalizarMontagem). Aqui só o essencial: um array de 4.
create table if not exists public.painel_montagens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(btrim(nome)) between 1 and 60),
  divisao       text not null default '4' check (divisao in ('4', '3a', '3b', '3c', '2a', '2b', '1')),
  quadros       jsonb not null check (jsonb_typeof(quadros) = 'array' and jsonb_array_length(quadros) = 4),
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists painel_montagens_nome_idx on public.painel_montagens (lower(btrim(nome)));
drop trigger if exists painel_montagens_tocar on public.painel_montagens;
create trigger painel_montagens_tocar before update on public.painel_montagens
  for each row execute function public.painel_tocar();

-- a montagem que está na TV (null = nenhuma); a que está na TV não pode ser apagada (on delete restrict)
create table if not exists public.painel_tv (
  id             smallint primary key default 1 check (id = 1),
  montagem_id    uuid references public.painel_montagens (id) on delete restrict,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
insert into public.painel_tv (id) values (1) on conflict (id) do nothing;
drop trigger if exists painel_tv_tocar on public.painel_tv;
create trigger painel_tv_tocar before update on public.painel_tv
  for each row execute function public.painel_tv_tocar();

alter table public.painel_montagens enable row level security;
alter table public.painel_tv enable row level security;
revoke all on table public.painel_montagens, public.painel_tv from anon, authenticated;
grant select, insert, update, delete on table public.painel_montagens to authenticated;
grant select, update on table public.painel_tv to authenticated;
grant select, insert, update, delete on table public.painel_montagens, public.painel_tv to service_role;

drop policy if exists painel_montagens_ler on public.painel_montagens;
create policy painel_montagens_ler on public.painel_montagens for select to authenticated
  using ((select public.tem_categoria('painel')));
drop policy if exists painel_montagens_criar on public.painel_montagens;
create policy painel_montagens_criar on public.painel_montagens for insert to authenticated
  with check ((select public.tem_categoria('painel')));
drop policy if exists painel_montagens_alterar on public.painel_montagens;
create policy painel_montagens_alterar on public.painel_montagens for update to authenticated
  using ((select public.tem_categoria('painel'))) with check ((select public.tem_categoria('painel')));
drop policy if exists painel_montagens_apagar on public.painel_montagens;
create policy painel_montagens_apagar on public.painel_montagens for delete to authenticated
  using ((select public.tem_categoria('painel')));

drop policy if exists painel_tv_ler on public.painel_tv;
create policy painel_tv_ler on public.painel_tv for select to authenticated
  using ((select public.tem_categoria('painel')));
drop policy if exists painel_tv_alterar on public.painel_tv;
create policy painel_tv_alterar on public.painel_tv for update to authenticated
  using ((select public.tem_categoria('painel'))) with check ((select public.tem_categoria('painel')));

commit;

-- Conferência depois de rodar (só leitura):
--   select tablename, policyname, cmd, permissive from pg_policies where tablename in ('painel_montagens', 'painel_tv', 'mapas_fazendas') order by 1, 2;
--   select * from public.painel_tv;   -- uma linha: id 1, montagem_id null
