-- COA WEB — categoria nova "Controle Técnico" (chave 'controle') e as páginas novas da Validação PIMS.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0008 (pode rodar de novo sem estragar nada).
-- Cria só o que é novo; não altera nem apaga nada que já exista, fora a lista de categorias aceitas
-- (que ganha 'controle').
--
-- valid_pims.extras     — dados das páginas novas da validação, gravados pelo servidor:
--                         { ap [apontamentos recentes], nec [necessidade de produto das ordens abertas],
--                           dose [dose real x programada], col [boletins do coletor que não entraram] }
-- controle_depositos    — NÍVEL DE ACESSO DO CONTROLE TÉCNICO: quais depósitos cada usuário pode abrir.
--                         O usuário vê as ordens, os apontamentos e o saldo dos coordenadores vinculados
--                         àquele depósito (valid_vinculos) e nada além disso.
-- controle_meus_depositos() / controle_dados() — o recorte é feito AQUI, no banco: o coordenador não lê
--                         valid_pims (não tem a categoria 'validacao'); recebe só o pedaço dele.

begin;

set local lock_timeout = '5s';

-- ---------- categoria ----------
alter table public.usuario_categorias drop constraint if exists usuario_categorias_categoria_check;
alter table public.usuario_categorias add constraint usuario_categorias_categoria_check
  check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat', 'previsao', 'validacao', 'controle'));

-- ---------- páginas novas da validação ----------
alter table public.valid_pims add column if not exists extras jsonb not null default '{}'::jsonb;

-- ---------- acesso por depósito ----------
create table if not exists public.controle_depositos (
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  -- unidade administrativa do PIMS e código do depósito no SAP (os mesmos de valid_vinculos)
  unidade    text not null,
  deposito   text not null,
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  primary key (usuario_id, unidade, deposito),
  constraint controle_depositos_textos_check check (
    char_length(unidade) between 1 and 80 and deposito ~ '^[A-Za-z0-9_.-]{1,20}$'
  )
);

alter table public.controle_depositos enable row level security;
revoke all on table public.controle_depositos from anon, authenticated;
grant select, insert, delete on table public.controle_depositos to authenticated;

-- cada um lê os seus; o administrador lê todos e é o único que libera ou retira um depósito
drop policy if exists controle_depositos_select on public.controle_depositos;
create policy controle_depositos_select on public.controle_depositos
  for select to authenticated
  using (usuario_id = auth.uid() or (select public.mapas_eh_admin()));

drop policy if exists controle_depositos_insert on public.controle_depositos;
create policy controle_depositos_insert on public.controle_depositos
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists controle_depositos_delete on public.controle_depositos;
create policy controle_depositos_delete on public.controle_depositos
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---------- depósitos que quem está logado pode abrir ----------
-- colaborador: os liberados para ele; administrador com a categoria: todos os vinculados a coordenador
-- (das unidades que ele pode ver).
create or replace function public.controle_meus_depositos()
returns table (unidade text, deposito text, nome text, equipes text[])
language sql
stable
security definer
set search_path = public
as $$
  with permitidos as (
    select c.unidade, c.deposito
    from public.controle_depositos c
    where c.usuario_id = auth.uid() and public.tem_categoria('controle')
    union
    select v.unidade, v.deposito
    from public.valid_vinculos v
    where v.deposito is not null and public.tem_categoria('controle')
      and public.mapas_eh_admin() and public.acomp_pode_ver_unidade(v.unidade)
  )
  select p.unidade, p.deposito,
    coalesce((
      select d->>'n' from public.valid_pims vp, jsonb_array_elements(vp.depositos) d
      where vp.unidade = p.unidade and d->>'c' = p.deposito limit 1), p.deposito) as nome,
    coalesce((
      select array_agg(vv.equipe order by vv.equipe) from public.valid_vinculos vv
      where vv.unidade = p.unidade and vv.deposito = p.deposito), '{}'::text[]) as equipes
  from permitidos p
  order by 1, 2;
$$;

-- ---------- o recorte de um depósito ----------
-- Devolve, no formato de uma linha de valid_pims, só o que é dos coordenadores vinculados ao depósito:
-- ordens (com os apontamentos), saldo do depósito (com a origem de cada produto), boletins com falha e
-- os dados das páginas novas. Quem não tem a categoria ou o depósito recebe erro de permissão.
create or replace function public.controle_dados(p_unidade text, p_deposito text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_equipes text[];
  v_saida jsonb;
begin
  if not public.tem_categoria('controle') then
    raise exception 'Sem acesso ao Controle Técnico.' using errcode = '42501';
  end if;
  if not (
    (public.mapas_eh_admin() and public.acomp_pode_ver_unidade(p_unidade))
    or exists (
      select 1 from public.controle_depositos c
      where c.usuario_id = auth.uid() and c.unidade = p_unidade and c.deposito = p_deposito)
  ) then
    raise exception 'Sem acesso a este depósito.' using errcode = '42501';
  end if;

  select coalesce(array_agg(v.equipe), '{}'::text[]) into v_equipes
  from public.valid_vinculos v
  where v.unidade = p_unidade and v.deposito = p_deposito;

  select jsonb_build_object(
    'unidade', p.unidade,
    'gerado_em', p.gerado_em,
    'equipes', to_jsonb(v_equipes),
    'ordens', coalesce((select jsonb_agg(o) from jsonb_array_elements(p.ordens) o where o->>'eq' = any(v_equipes)), '[]'::jsonb),
    'coordenadores', coalesce((select jsonb_agg(c) from jsonb_array_elements(p.coordenadores) c where c->>'eq' = any(v_equipes)), '[]'::jsonb),
    'depositos', coalesce((select jsonb_agg(d) from jsonb_array_elements(p.depositos) d where d->>'c' = p_deposito), '[]'::jsonb),
    'estoque', case when p.estoque ? p_deposito then jsonb_build_object(p_deposito, p.estoque->p_deposito) else '{}'::jsonb end,
    'boletins', coalesce((select jsonb_agg(b) from jsonb_array_elements(p.boletins) b where b->>'eq' = any(v_equipes)), '[]'::jsonb),
    'extras', jsonb_build_object(
      'ap', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'ap', '[]'::jsonb)) x where x->>'eq' = any(v_equipes)), '[]'::jsonb),
      'nec', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'nec', '[]'::jsonb)) x where x->>'eq' = any(v_equipes)), '[]'::jsonb),
      'dose', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'dose', '[]'::jsonb)) x where x->>'eq' = any(v_equipes)), '[]'::jsonb)
    ),
    'avisos', p.avisos
  ) into v_saida
  from public.valid_pims p
  where p.unidade = p_unidade;

  return coalesce(v_saida, jsonb_build_object(
    'unidade', p_unidade, 'gerado_em', null, 'equipes', to_jsonb(v_equipes), 'ordens', '[]'::jsonb, 'coordenadores', '[]'::jsonb,
    'depositos', '[]'::jsonb, 'estoque', '{}'::jsonb, 'boletins', '[]'::jsonb, 'extras', '{}'::jsonb, 'avisos', '[]'::jsonb));
end;
$$;

revoke all on function public.controle_meus_depositos() from public, anon;
revoke all on function public.controle_dados(text, text) from public, anon;
grant execute on function public.controle_meus_depositos() to authenticated;
grant execute on function public.controle_dados(text, text) to authenticated;

commit;

-- Depois de rodar:
--  1. Usuários → crie o usuário do coordenador e marque a categoria "Controle Técnico".
--  2. Validação PIMS → Vínculo de depósitos → "Acesso ao Controle Técnico": escolha o(s) depósito(s) dele.
