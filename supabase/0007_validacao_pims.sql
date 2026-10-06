-- COA WEB — categoria nova "Validação PIMS" (chave 'validacao'): ordens de serviço do PIMS por
-- coordenador, ordens fechadas com diferença de área e o saldo do SAP no depósito de cada coordenador.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS dos scripts 0001 a 0006 (pode rodar de novo sem
-- estragar nada). Cria só o que é deste módulo; não altera nem apaga nada que já exista, fora a lista de
-- categorias aceitas (que ganha 'validacao').
--
-- valid_pims     — retrato do PIMS/SAP, gravado pelo servidor do Google Cloud (chave de serviço) a cada
--                  hora e quando alguém clica em "Atualizar" (modulos/mapas/scripts/sincronizar-plantio.mjs).
-- valid_vinculos — depósito do SAP de cada coordenador e o depósito de origem; cadastrado na tela pelos
--                  administradores.
-- valid_pedidos  — pedidos do botão "Atualizar" (o servidor confere a cada ~30 s).

begin;

set local lock_timeout = '5s';

-- ---------- categoria ----------
alter table public.usuario_categorias drop constraint if exists usuario_categorias_categoria_check;
alter table public.usuario_categorias add constraint usuario_categorias_categoria_check
  check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat', 'previsao', 'validacao'));

-- ---------- retrato do PIMS e do SAP ----------
create table if not exists public.valid_pims (
  -- unidade administrativa do PIMS (DE_UNI_ADM), a mesma chave do Acompanhamento
  unidade       text primary key,
  gerado_em     timestamptz not null,
  -- [{ os, eq (coordenador), op, opn, s 'A'|'F', ab, enc, pl (ha planejado), ex (ha apontado), nt, ult, ev [[dia, ha]],
  --    sa (1 = operação que não aponta área), tl [[talhão, ha planejado]],
  --    ap [[dia, boletim, talhão, ha, lançado em, lançado por]] }]
  ordens        jsonb not null default '[]'::jsonb,
  -- [{ eq, ab (ordens abertas), n (ordens na safra) }]
  coordenadores jsonb not null default '[]'::jsonb,
  -- [{ c (código do SAP), n (nome), i (1 = inativo no SAP) }]
  depositos     jsonb not null default '[]'::jsonb,
  -- { "<código do depósito>": [{ c (item), n (nome), q (saldo), u (unidade),
  --     o (depósito de origem pela última transferência do SAP), on (nome), oq (saldo na origem), od (data) }] }
  -- só dos depósitos vinculados aos coordenadores
  estoque       jsonb not null default '{}'::jsonb,
  -- ex.: ["sap:SBOAGROPECUARIALOCKS"] quando o saldo do SAP não pôde ser lido nesta rodada
  avisos        jsonb not null default '[]'::jsonb
);

alter table public.valid_pims enable row level security;
revoke all on table public.valid_pims from anon, authenticated;
grant select on table public.valid_pims to authenticated;
grant select, insert, update, delete on table public.valid_pims to service_role;

-- vê quem tem a categoria e pode ver a unidade (administradores veem todas; os demais, as das fazendas liberadas)
drop policy if exists valid_pims_select on public.valid_pims;
create policy valid_pims_select on public.valid_pims
  for select to authenticated
  using ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

-- ---------- vínculo coordenador ↔ depósito ----------
create table if not exists public.valid_vinculos (
  unidade         text not null,
  -- coordenador = Equipe da ordem de serviço no PIMS (DE_EQUIPE)
  equipe          text not null,
  -- código do depósito no SAP (WhsCode) do coordenador. deposito_origem não é mais usado: a origem de cada
  -- produto vem das transferências de estoque do SAP (fica a coluna para não mexer no banco)
  deposito        text,
  deposito_origem text,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid default auth.uid(),
  primary key (unidade, equipe),
  constraint valid_vinculos_textos_check check (
    char_length(unidade) between 1 and 80 and char_length(equipe) between 1 and 120
    and (deposito is null or deposito ~ '^[A-Za-z0-9_.-]{1,20}$')
    and (deposito_origem is null or deposito_origem ~ '^[A-Za-z0-9_.-]{1,20}$')
  )
);

create or replace function public.valid_vinculos_carimbar()
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
revoke all on function public.valid_vinculos_carimbar() from public, anon, authenticated;

drop trigger if exists valid_vinculos_carimbo_trg on public.valid_vinculos;
create trigger valid_vinculos_carimbo_trg
  before insert or update on public.valid_vinculos
  for each row execute function public.valid_vinculos_carimbar();

alter table public.valid_vinculos enable row level security;
revoke all on table public.valid_vinculos from anon, authenticated;
grant select, insert, update, delete on table public.valid_vinculos to authenticated;
grant select on table public.valid_vinculos to service_role;

drop policy if exists valid_vinculos_select on public.valid_vinculos;
create policy valid_vinculos_select on public.valid_vinculos
  for select to authenticated
  using ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

-- só administradores cadastram, trocam ou removem um vínculo
drop policy if exists valid_vinculos_insert on public.valid_vinculos;
create policy valid_vinculos_insert on public.valid_vinculos
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists valid_vinculos_update on public.valid_vinculos;
create policy valid_vinculos_update on public.valid_vinculos
  for update to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

drop policy if exists valid_vinculos_delete on public.valid_vinculos;
create policy valid_vinculos_delete on public.valid_vinculos
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---------- pedidos do botão "Atualizar" ----------
create table if not exists public.valid_pedidos (
  id          bigint generated always as identity primary key,
  pedido_em   timestamptz not null default now(),
  pedido_por  uuid not null default auth.uid(),
  atendido_em timestamptz,
  -- 'ok' ou a mensagem de erro (sem segredos)
  resultado   text
);

create index if not exists valid_pedidos_pendentes_idx
  on public.valid_pedidos (id) where atendido_em is null;

alter table public.valid_pedidos enable row level security;
revoke all on table public.valid_pedidos from anon, authenticated;
grant select, insert on table public.valid_pedidos to authenticated;
grant select, insert, update, delete on table public.valid_pedidos to service_role;

drop policy if exists valid_pedidos_select on public.valid_pedidos;
create policy valid_pedidos_select on public.valid_pedidos
  for select to authenticated
  using ((select public.tem_categoria('validacao')) and pedido_por = auth.uid());

drop policy if exists valid_pedidos_insert on public.valid_pedidos;
create policy valid_pedidos_insert on public.valid_pedidos
  for insert to authenticated
  with check (
    (select public.tem_categoria('validacao'))
    and pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
  );

commit;

-- Ninguém ganha a categoria sozinho: o ADMINISTRADOR+ marca "Validação PIMS" na página Usuários.
