-- COA WEB — Controle Técnico: o acesso passa a ser POR EQUIPE do PIMS (o coordenador), não mais por depósito.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0009 (pode rodar de novo sem estragar nada).
--
-- controle_equipes        — a Equipe do PIMS (coordenador) de cada usuário do tipo Coordenador. É cadastrada
--                           na página Usuários. O usuário vê as ordens, os apontamentos, os boletins e o saldo
--                           do depósito vinculado àquela equipe (valid_vinculos) e nada além disso.
-- controle_minhas_equipes() / controle_dados_equipe() — o recorte continua sendo feito AQUI, no banco.
-- Sai o que o 0009 criou para o acesso por depósito (as duas funções e a tabela controle_depositos, que só é
-- apagada se estiver vazia).

begin;

set local lock_timeout = '5s';

create table if not exists public.controle_equipes (
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  -- unidade administrativa do PIMS e nome da Equipe (DE_EQUIPE), os mesmos de valid_pims e valid_vinculos
  unidade    text not null,
  equipe     text not null,
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  primary key (usuario_id, unidade, equipe),
  constraint controle_equipes_textos_check check (
    char_length(unidade) between 1 and 80 and char_length(equipe) between 1 and 120
  )
);

alter table public.controle_equipes enable row level security;
revoke all on table public.controle_equipes from anon, authenticated;
grant select, insert, delete on table public.controle_equipes to authenticated;

-- cada um lê a sua; o administrador lê todas. Grava quem pode gerenciar o usuário (a mesma regra das categorias):
-- o ADMINISTRADOR+ qualquer um; o administrador comum, só colaboradores.
drop policy if exists controle_equipes_select on public.controle_equipes;
create policy controle_equipes_select on public.controle_equipes
  for select to authenticated
  using (usuario_id = auth.uid() or (select public.mapas_eh_admin()));

drop policy if exists controle_equipes_insert on public.controle_equipes;
create policy controle_equipes_insert on public.controle_equipes
  for insert to authenticated
  with check (public.is_super() or (public.mapas_eh_admin() and public.eh_colaborador(usuario_id)));

drop policy if exists controle_equipes_delete on public.controle_equipes;
create policy controle_equipes_delete on public.controle_equipes
  for delete to authenticated
  using (public.is_super() or (public.mapas_eh_admin() and public.eh_colaborador(usuario_id)));

-- ---------- equipes que quem está logado pode abrir ----------
-- coordenador: a(s) dele; administrador com a categoria: todas as das unidades que ele pode ver.
create or replace function public.controle_minhas_equipes()
returns table (unidade text, equipe text, deposito text, deposito_nome text)
language sql
stable
security definer
set search_path = public
as $$
  with permitidas as (
    select c.unidade, c.equipe
    from public.controle_equipes c
    where c.usuario_id = auth.uid() and public.tem_categoria('controle')
    union
    select vp.unidade, co->>'eq'
    from public.valid_pims vp, jsonb_array_elements(vp.coordenadores) co
    where public.tem_categoria('controle') and public.mapas_eh_admin() and public.acomp_pode_ver_unidade(vp.unidade)
  )
  select p.unidade, p.equipe, v.deposito,
    (select d->>'n' from public.valid_pims vp, jsonb_array_elements(vp.depositos) d
     where vp.unidade = p.unidade and d->>'c' = v.deposito limit 1) as deposito_nome
  from permitidas p
  left join public.valid_vinculos v on v.unidade = p.unidade and v.equipe = p.equipe
  where p.equipe is not null
  order by 1, 2;
$$;

-- ---------- o recorte de uma equipe ----------
-- Devolve, no formato de uma linha de valid_pims, só o que é daquela Equipe: ordens (com os apontamentos), boletins
-- com falha, os dados das outras páginas e o saldo do depósito vinculado a ela (com a origem de cada produto).
create or replace function public.controle_dados_equipe(p_unidade text, p_equipe text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_deposito text;
  v_saida jsonb;
  v_filtro constant text[] := array[p_equipe];
begin
  if not public.tem_categoria('controle') then
    raise exception 'Sem acesso ao Controle Técnico.' using errcode = '42501';
  end if;
  if not (
    (public.mapas_eh_admin() and public.acomp_pode_ver_unidade(p_unidade))
    or exists (
      select 1 from public.controle_equipes c
      where c.usuario_id = auth.uid() and c.unidade = p_unidade and c.equipe = p_equipe)
  ) then
    raise exception 'Sem acesso a esta equipe.' using errcode = '42501';
  end if;

  select v.deposito into v_deposito from public.valid_vinculos v where v.unidade = p_unidade and v.equipe = p_equipe;

  select jsonb_build_object(
    'unidade', p.unidade,
    'gerado_em', p.gerado_em,
    'equipes', to_jsonb(v_filtro),
    'deposito', v_deposito,
    'ordens', coalesce((select jsonb_agg(o) from jsonb_array_elements(p.ordens) o where o->>'eq' = p_equipe), '[]'::jsonb),
    'coordenadores', coalesce((select jsonb_agg(c) from jsonb_array_elements(p.coordenadores) c where c->>'eq' = p_equipe), '[]'::jsonb),
    'depositos', coalesce((select jsonb_agg(d) from jsonb_array_elements(p.depositos) d where d->>'c' = v_deposito), '[]'::jsonb),
    'estoque', case when v_deposito is not null and p.estoque ? v_deposito then jsonb_build_object(v_deposito, p.estoque->v_deposito) else '{}'::jsonb end,
    'boletins', coalesce((select jsonb_agg(b) from jsonb_array_elements(p.boletins) b where b->>'eq' = p_equipe), '[]'::jsonb),
    'extras', jsonb_build_object(
      'ap', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'ap', '[]'::jsonb)) x where x->>'eq' = p_equipe), '[]'::jsonb),
      'nec', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'nec', '[]'::jsonb)) x where x->>'eq' = p_equipe), '[]'::jsonb),
      'dose', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'dose', '[]'::jsonb)) x where x->>'eq' = p_equipe), '[]'::jsonb),
      'col', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(p.extras->'col', '[]'::jsonb)) x where x->>'eq' = p_equipe), '[]'::jsonb)
    ),
    'avisos', p.avisos
  ) into v_saida
  from public.valid_pims p
  where p.unidade = p_unidade;

  return coalesce(v_saida, jsonb_build_object(
    'unidade', p_unidade, 'gerado_em', null, 'equipes', to_jsonb(v_filtro), 'deposito', v_deposito, 'ordens', '[]'::jsonb, 'coordenadores', '[]'::jsonb,
    'depositos', '[]'::jsonb, 'estoque', '{}'::jsonb, 'boletins', '[]'::jsonb, 'extras', '{}'::jsonb, 'avisos', '[]'::jsonb));
end;
$$;

revoke all on function public.controle_minhas_equipes() from public, anon;
revoke all on function public.controle_dados_equipe(text, text) from public, anon;
grant execute on function public.controle_minhas_equipes() to authenticated;
grant execute on function public.controle_dados_equipe(text, text) to authenticated;

-- ---------- sai o acesso por depósito do 0009 ----------
drop function if exists public.controle_meus_depositos();
drop function if exists public.controle_dados(text, text);
do $$
begin
  if to_regclass('public.controle_depositos') is not null then
    if not exists (select 1 from public.controle_depositos) then
      drop table public.controle_depositos;
    else
      raise notice 'controle_depositos tem linhas: a tabela foi mantida (não é mais usada).';
    end if;
  end if;
end;
$$;

commit;

-- Depois de rodar: Usuários → Novo usuário → Perfil "Coordenador" → escolha a fazenda e a Equipe do PIMS.
-- O depósito do coordenador continua sendo vinculado em Validação PIMS → Vínculo de depósitos.
