-- =================================================================================================
-- Módulo MAPAS do COA WEB — conferência das permissões do COA WEB
-- NÃO ALTERA NADA: é uma consulta só de leitura (select), pode rodar quantas vezes quiser.
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB, antes de publicar o módulo MAPAS.
-- É uma consulta só (o SQL Editor mostra apenas o resultado da última), com uma linha por item.
--
-- O que conferir no resultado (coluna "secao"):
--   1. regra (RLS) de perfis e usuario_fazendas: um colaborador NÃO pode conseguir inserir ou
--      alterar a própria linha de perfis trocando "perfil" (ex.: regra de insert/update em perfis só
--      com "id = auth.uid()", sem travar a coluna perfil), nem inserir linhas em usuario_fazendas
--      para si. Se puder, ele vira admin (ou ganha fazendas) no COA WEB e também no MAPAS: é uma
--      brecha do COA WEB — avise o dono; corrigir fica para ele decidir.
--   2. RLS da tabela: "RLS ligado" deve ser true em perfis, usuario_fazendas e fazendas.
--   3. privilégio: o que anon e authenticated podem fazer nessas tabelas (o RLS vale por cima).
--   4. gatilho em auth.users / 5. função do gatilho: se um gatilho cria linha em perfis para toda
--      conta nova, qualquer pessoa que se cadastre (o cadastro público está ligado) ganha perfil e,
--      no MAPAS, passa a ver as safras e a poder enviar arquivos. Leia o corpo da função.
--   6. papel das funções mapas_*: elas rodam como quem executou 0001_mapas.sql (security definer)
--      e precisam ler perfis e usuario_fazendas sem o RLS: esse papel deve ser o dono das tabelas
--      (seção 2, "dono") ou ter "ignora RLS" = true — e as tabelas não podem ter "RLS forçado".

with
tabelas (ordem_tabela, nome) as (
  values (1, 'perfis'), (2, 'usuario_fazendas'), (3, 'fazendas')
),
alvo as (
  select t.ordem_tabela, t.nome, c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relowner
  from tabelas t
  left join pg_catalog.pg_class c
    on c.relname = t.nome
   and c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
),
gatilhos as (
  select g.oid, g.tgname, g.tgfoid
  from pg_catalog.pg_trigger g
  where g.tgrelid = 'auth.users'::regclass
    and not g.tgisinternal
),
itens (ordem, secao, objeto, nome, detalhe) as (
  -- 1. regras de RLS das tabelas do COA WEB usadas pelo MAPAS
  select 1, '1. regra (RLS)', p.tablename::text, p.policyname::text,
         format('comando=%s | %s | papéis=%s | using: %s | with check: %s',
                p.cmd, lower(p.permissive), p.roles::text,
                coalesce(p.qual, '(nenhum)'), coalesce(p.with_check, '(nenhum)'))
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (select nome from tabelas)

  union all
  select 1, '1. regra (RLS)', a.nome, '(nenhuma)', 'nenhuma regra nesta tabela'
  from alvo a
  where a.oid is not null
    and not exists (
      select 1 from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = a.nome
    )

  -- 2. RLS ligado / forçado e dono de cada tabela
  union all
  select 2, '2. RLS da tabela', a.nome, 'public.' || a.nome,
         case
           when a.oid is null then 'tabela não encontrada no schema public'
           else format('RLS ligado=%s | RLS forçado=%s | dono=%s',
                       a.relrowsecurity, a.relforcerowsecurity, pg_catalog.pg_get_userbyid(a.relowner))
         end
  from alvo a

  -- 3. privilégios de anon e authenticated (tabela inteira ou só algumas colunas)
  union all
  select 3, '3. privilégio', a.nome, r.papel::text,
         coalesce(nullif(concat_ws(', ',
           case when pg_catalog.has_table_privilege(r.papel, a.oid, 'SELECT') then 'select' end,
           case when pg_catalog.has_table_privilege(r.papel, a.oid, 'INSERT') then 'insert'
                when pg_catalog.has_any_column_privilege(r.papel, a.oid, 'INSERT') then 'insert (algumas colunas)' end,
           case when pg_catalog.has_table_privilege(r.papel, a.oid, 'UPDATE') then 'update'
                when pg_catalog.has_any_column_privilege(r.papel, a.oid, 'UPDATE') then 'update (algumas colunas)' end,
           case when pg_catalog.has_table_privilege(r.papel, a.oid, 'DELETE') then 'delete' end
         ), ''), '(nenhum)')
  from alvo a
  cross join (values ('anon'::name), ('authenticated'::name)) r (papel)
  where a.oid is not null

  -- 4. gatilhos criados pelo usuário em auth.users (os internos ficam de fora)
  union all
  select 4, '4. gatilho em auth.users', 'auth.users', g.tgname::text, pg_catalog.pg_get_triggerdef(g.oid)
  from gatilhos g

  union all
  select 4, '4. gatilho em auth.users', 'auth.users', '(nenhum)', 'nenhum gatilho (não interno) em auth.users'
  where not exists (select 1 from gatilhos)

  -- 5. corpo das funções chamadas por esses gatilhos
  union all
  select 5, '5. função do gatilho', f.oid::regprocedure::text,
         case when f.prosecdef then 'security definer' else 'security invoker' end,
         pg_catalog.pg_get_functiondef(f.oid)
  from pg_catalog.pg_proc f
  where f.oid in (select g.tgfoid from gatilhos g)

  -- 6. papel que executa este SQL (e que será dono das funções mapas_*)
  union all
  select 6, '6. papel das funções mapas_*', r.rolname::text, 'quem executa o SQL Editor',
         format('superusuário=%s | ignora RLS (rolbypassrls)=%s', r.rolsuper, r.rolbypassrls)
  from pg_catalog.pg_roles r
  where r.rolname = current_user
)
select secao, objeto, nome, detalhe
from itens
order by ordem, objeto, nome;
