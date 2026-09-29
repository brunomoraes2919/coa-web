-- =================================================================================================
-- Módulo ACOMPANHAMENTO OPERACIONAL do COA WEB — banco (tabelas acomp_* e regras de acesso)
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB (pkaxbitsqxjxjlwnhjhd), DEPOIS do
-- 0001_mapas.sql do módulo MAPAS (usa as funções mapas_eh_admin, mapas_eh_usuario e mapas_pode_ver
-- e a tabela mapas_fazendas, que liga a unidade do PIMS à fazenda do COA WEB). Cole o arquivo
-- inteiro e execute.
--
-- O que este script faz:
--   * cria SÓ objetos novos com o prefixo "acomp_" (tabelas, função, gatilho e regras de RLS);
--   * NÃO altera nem apaga nada que já existe (fazendas, perfis, usuario_fazendas, mapas_*...);
--   * aplica as mesmas permissões do COA WEB, pela unidade do PIMS:
--       admin -> vê e altera tudo;
--       colaborador com a fazenda liberada (usuario_fazendas) e ligada a uma fazenda de mapa
--         daquela unidade do PIMS (mapas_fazendas.unidade_pims) -> vê os dados e cadastra as metas
--         dessa unidade;
--       qualquer outra conta -> não vê nada.
--   * acomp_pims não tem regra de escrita: só a rotina do PIMS (VM), com a chave de serviço, grava.
--   * toda alteração de meta fica registrada em acomp_metas_historico (gatilho; só admin lê).
--
-- Idempotente e atômico: pode ser executado de novo sem erro nem perda de dados, numa transação só.
-- O SQL Editor pede para confirmar uma "destructive operation" por causa dos "drop policy if exists"
-- e "drop trigger if exists": eles só apagam (para recriar em seguida) objetos deste próprio script.

begin;

set local lock_timeout = '5s';

-- =================================================================================================
-- Tabelas
-- =================================================================================================

-- Dados do PIMS por safra × unidade (talhões e apontamentos diários), gravados pela rotina da VM.
create table if not exists public.acomp_pims (
  safra        text not null,
  unidade      text not null,
  gerado_em    timestamptz not null,
  -- [{ setor, id, t, area, dano, variedade, enc }]
  talhoes      jsonb not null default '[]'::jsonb,
  -- [{ op: 'PLANTIO'|'COLHEITA', id, t, d, a, eq, e, rep }]
  apontamentos jsonb not null default '[]'::jsonb,
  primary key (safra, unidade)
);

-- Metas cadastradas pelos usuários: meta diária (ha/dia) por período e data estimada de término.
create table if not exists public.acomp_metas (
  unidade        text not null,
  safra          text not null,
  operacao       text not null,
  data_termino   date,
  -- [{ inicio: 'AAAA-MM-DD', fim: 'AAAA-MM-DD', meta: número }]
  periodos       jsonb not null default '[]'::jsonb,
  observacao     text,
  autor          text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  primary key (unidade, safra, operacao),
  constraint acomp_metas_operacao_check check (operacao in ('PLANTIO', 'COLHEITA')),
  constraint acomp_metas_periodos_check check (jsonb_typeof(periodos) = 'array'),
  constraint acomp_metas_textos_check check (
    coalesce(length(observacao), 0) <= 500 and coalesce(length(autor), 0) <= 80
  )
);

-- Histórico de alterações das metas (preenchido pelo gatilho; ninguém grava direto).
create table if not exists public.acomp_metas_historico (
  id       bigint generated always as identity primary key,
  quando   timestamptz not null default now(),
  acao     text not null,
  usuario  uuid,
  unidade  text not null,
  safra    text not null,
  operacao text not null,
  registro jsonb not null
);

create index if not exists acomp_metas_historico_chave_idx
  on public.acomp_metas_historico (unidade, safra, operacao, quando desc);

-- =================================================================================================
-- Funções
-- =================================================================================================

-- O usuário logado pode ver esta unidade do PIMS? Admin vê todas; os demais, se alguma fazenda de
-- mapa dessa unidade estiver ligada a uma fazenda do COA WEB liberada para ele (mesma regra de
-- mapas_plantio_pims).
create or replace function public.acomp_pode_ver_unidade(p_unidade text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mapas_eh_admin()
      or exists (
        select 1
        from public.mapas_fazendas f
        where upper(f.unidade_pims) = upper(p_unidade)
          and public.mapas_pode_ver(f.coa_fazenda_id)
      );
$$;

revoke all on function public.acomp_pode_ver_unidade(text) from public, anon;
grant execute on function public.acomp_pode_ver_unidade(text) to authenticated;

-- Gatilho: registra no histórico cada inclusão, alteração ou exclusão de meta.
create or replace function public.acomp_metas_registrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.acomp_metas;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.acomp_metas_historico (acao, usuario, unidade, safra, operacao, registro)
  values (
    case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end,
    auth.uid(), r.unidade, r.safra, r.operacao, to_jsonb(r)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.acomp_metas_registrar() from public, anon, authenticated;

drop trigger if exists acomp_metas_historico_trg on public.acomp_metas;
create trigger acomp_metas_historico_trg
  after insert or update or delete on public.acomp_metas
  for each row execute function public.acomp_metas_registrar();

-- Quem salva a meta fica registrado pelo banco (o cliente não escolhe).
create or replace function public.acomp_metas_carimbar()
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

revoke all on function public.acomp_metas_carimbar() from public, anon, authenticated;

drop trigger if exists acomp_metas_carimbo_trg on public.acomp_metas;
create trigger acomp_metas_carimbo_trg
  before insert or update on public.acomp_metas
  for each row execute function public.acomp_metas_carimbar();

-- =================================================================================================
-- RLS e privilégios
-- =================================================================================================

alter table public.acomp_pims            enable row level security;
alter table public.acomp_metas           enable row level security;
alter table public.acomp_metas_historico enable row level security;

revoke all on table public.acomp_pims            from anon, authenticated;
revoke all on table public.acomp_metas           from anon, authenticated;
revoke all on table public.acomp_metas_historico from anon, authenticated;

grant select                         on table public.acomp_pims            to authenticated;
grant select, insert, update, delete on table public.acomp_metas           to authenticated;
grant select                         on table public.acomp_metas_historico to authenticated;
-- a rotina do PIMS grava com a chave de serviço (upsert pela API REST)
grant select, insert, update, delete on table public.acomp_pims            to service_role;

-- ---- acomp_pims: vê quem pode ver a unidade; ninguém grava (só a chave de serviço) --------------

drop policy if exists acomp_pims_select on public.acomp_pims;
create policy acomp_pims_select on public.acomp_pims
  for select to authenticated
  using (public.acomp_pode_ver_unidade(unidade));

-- ---- acomp_metas: vê e cadastra quem pode ver a unidade -----------------------------------------

drop policy if exists acomp_metas_select on public.acomp_metas;
create policy acomp_metas_select on public.acomp_metas
  for select to authenticated
  using (public.acomp_pode_ver_unidade(unidade));

drop policy if exists acomp_metas_insert on public.acomp_metas;
create policy acomp_metas_insert on public.acomp_metas
  for insert to authenticated
  with check (public.acomp_pode_ver_unidade(unidade));

drop policy if exists acomp_metas_update on public.acomp_metas;
create policy acomp_metas_update on public.acomp_metas
  for update to authenticated
  using (public.acomp_pode_ver_unidade(unidade))
  with check (public.acomp_pode_ver_unidade(unidade));

drop policy if exists acomp_metas_delete on public.acomp_metas;
create policy acomp_metas_delete on public.acomp_metas
  for delete to authenticated
  using (public.acomp_pode_ver_unidade(unidade));

-- ---- acomp_metas_historico: só admin lê ---------------------------------------------------------

drop policy if exists acomp_metas_historico_select on public.acomp_metas_historico;
create policy acomp_metas_historico_select on public.acomp_metas_historico
  for select to authenticated
  using ((select public.mapas_eh_admin()));

commit;
