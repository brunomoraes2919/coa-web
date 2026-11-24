-- COA WEB — Validação PIMS: vínculo coordenador ↔ depósito (11/11/2026).
--
--   1. O colaborador também vincula. Até aqui só o administrador gravava em valid_vinculos (0019: mapas_eh_admin).
--      Agora grava quem tem a categoria Validação PIMS e vê a unidade (acomp_pode_ver_unidade), a mesma regra da
--      leitura. Quem só tem o Controle Técnico continua sem poder mudar.
--   2. Até 4 depósitos por coordenador. valid_vinculos ganha `depositos` (a lista, na ordem; o primeiro é o principal).
--      A coluna `deposito` continua existindo e passa a ser sempre o primeiro da lista (gatilho), para nada que lê só
--      ela quebrar. Os vínculos de hoje viram uma lista de um depósito só.
--   3. Controle Técnico: o coordenador passa a ver o saldo de todos os depósitos dele (controle_minhas_equipes devolve
--      também a lista; controle_dados_equipe recorta o saldo de todos eles).
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).

begin;

set local lock_timeout = '5s';

-- 1. quem grava ------------------------------------------------------------------------------------------------------
drop policy if exists valid_vinculos_insert on public.valid_vinculos;
create policy valid_vinculos_insert on public.valid_vinculos
  for insert to authenticated
  with check ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

drop policy if exists valid_vinculos_update on public.valid_vinculos;
create policy valid_vinculos_update on public.valid_vinculos
  for update to authenticated
  using ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade))
  with check ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

drop policy if exists valid_vinculos_delete on public.valid_vinculos;
create policy valid_vinculos_delete on public.valid_vinculos
  for delete to authenticated
  using ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

-- 2. a lista de depósitos ----------------------------------------------------------------------------------------------
alter table public.valid_vinculos add column if not exists depositos text[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'valid_vinculos_depositos_check') then
    alter table public.valid_vinculos add constraint valid_vinculos_depositos_check check (
      depositos is null or cardinality(depositos) = 0 or (
        cardinality(depositos) <= 4
        and array_to_string(depositos, ',') ~ '^[A-Za-z0-9_.-]{1,20}(,[A-Za-z0-9_.-]{1,20})*$'
      )
    );
  end if;
end;
$$;

-- a lista sem repetir e sem vazios; `deposito` = o primeiro. Uma tela antiga (em cache) que muda só `deposito` troca a
-- lista inteira por esse depósito, como antes.
create or replace function public.valid_vinculos_normalizar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_fonte text[];
  v_lista text[] := '{}';
  v_c text;
begin
  if tg_op = 'UPDATE' and new.deposito is distinct from old.deposito and new.depositos is not distinct from old.depositos then
    v_fonte := array[new.deposito]::text[];
  elsif coalesce(cardinality(new.depositos), 0) > 0 then
    v_fonte := new.depositos;
  else
    v_fonte := array[new.deposito]::text[];
  end if;
  foreach v_c in array v_fonte loop
    v_c := btrim(coalesce(v_c, ''));
    if v_c <> '' and not (v_c = any (v_lista)) then
      v_lista := v_lista || v_c;
    end if;
  end loop;
  if cardinality(v_lista) > 4 then
    raise exception 'No máximo 4 depósitos por coordenador.' using errcode = '22023';
  end if;
  new.depositos := v_lista;
  new.deposito := v_lista[1];
  return new;
end;
$$;

drop trigger if exists valid_vinculos_normalizar_trg on public.valid_vinculos;
create trigger valid_vinculos_normalizar_trg
  before insert or update on public.valid_vinculos
  for each row execute function public.valid_vinculos_normalizar();

-- os vínculos de hoje: lista de um depósito só
update public.valid_vinculos set depositos = array[deposito]::text[] where deposito is not null and coalesce(cardinality(depositos), 0) = 0;

-- 3. Controle Técnico --------------------------------------------------------------------------------------------------
-- o tipo de retorno muda (a coluna depositos entra): a função é recriada
drop function if exists public.controle_minhas_equipes();
create function public.controle_minhas_equipes()
returns table (unidade text, equipe text, deposito text, deposito_nome text, depositos text[])
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
     where vp.unidade = p.unidade and d->>'c' = v.deposito limit 1) as deposito_nome,
    case when v.deposito is null then '{}'::text[] else coalesce(nullif(v.depositos, '{}'::text[]), array[v.deposito]::text[]) end as depositos
  from permitidas p
  left join public.valid_vinculos v on v.unidade = p.unidade and v.equipe = p.equipe
  where p.equipe is not null
  order by 1, 2;
$$;

create or replace function public.controle_dados_equipe(p_unidade text, p_equipe text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_depositos text[] := '{}';
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

  select case when v.deposito is null then '{}'::text[] else coalesce(nullif(v.depositos, '{}'::text[]), array[v.deposito]::text[]) end
    into v_depositos
  from public.valid_vinculos v where v.unidade = p_unidade and v.equipe = p_equipe;
  v_depositos := coalesce(v_depositos, '{}'::text[]);

  select jsonb_build_object(
    'unidade', p.unidade,
    'gerado_em', p.gerado_em,
    'equipes', to_jsonb(v_filtro),
    'deposito', v_depositos[1],
    'ordens', coalesce((select jsonb_agg(o) from jsonb_array_elements(p.ordens) o where o->>'eq' = p_equipe), '[]'::jsonb),
    'coordenadores', coalesce((select jsonb_agg(c) from jsonb_array_elements(p.coordenadores) c where c->>'eq' = p_equipe), '[]'::jsonb),
    'depositos', coalesce((select jsonb_agg(d) from jsonb_array_elements(p.depositos) d where d->>'c' = any (v_depositos)), '[]'::jsonb),
    'estoque', coalesce((select jsonb_object_agg(k, p.estoque->k) from unnest(v_depositos) k where p.estoque ? k), '{}'::jsonb),
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
    'unidade', p_unidade, 'gerado_em', null, 'equipes', to_jsonb(v_filtro), 'deposito', v_depositos[1], 'ordens', '[]'::jsonb, 'coordenadores', '[]'::jsonb,
    'depositos', '[]'::jsonb, 'estoque', '{}'::jsonb, 'boletins', '[]'::jsonb, 'extras', '{}'::jsonb, 'avisos', '[]'::jsonb));
end;
$$;

revoke all on function public.controle_minhas_equipes() from public, anon;
revoke all on function public.controle_dados_equipe(text, text) from public, anon;
grant execute on function public.controle_minhas_equipes() to authenticated;
grant execute on function public.controle_dados_equipe(text, text) to authenticated;

commit;

-- Conferência: as regras de valid_vinculos e os vínculos com a lista
select 'regra' as o_que, policyname || ' (' || cmd || ')' as detalhe
from pg_policies where schemaname = 'public' and tablename = 'valid_vinculos'
union all
select 'vínculos', count(*) || ' coordenadores, ' || count(*) filter (where cardinality(depositos) > 1) || ' com mais de um depósito'
from public.valid_vinculos
order by 1, 2;
