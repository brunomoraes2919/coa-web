-- COA WEB — segurança, parte 1 de 5: higiene da base (tabelas antigas, funções e gatilhos).
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS dos scripts 0001 a 0016 e dos scripts dos módulos
-- (pode rodar de novo sem estragar nada). Não cria tela nova e não muda o que um usuário legítimo vê.
--
-- Achados que este script fecha (auditoria de 09/10/2026):
--   * B5  — as sete tabelas antigas (perfis, fazendas, talhoes, safras, variedades, usuario_fazendas,
--           usuario_categorias) ainda davam SELECT/INSERT/UPDATE/DELETE ao visitante sem login (anon). As regras
--           (RLS) já barravam, mas era a única barreira. Agora o visitante não tem privilégio nenhum nelas.
--   * is_admin() sem search_path fixo e executável por anon; tem_acesso_fazenda() executável por anon.
--   * funções de gatilho (criar_perfil_automatico, perfis_protege_admins, whatsapp_contato_troca_numero)
--           executáveis por qualquer um pela API.
--   * B3  — perfis_protege_admins liberava tudo quando não havia usuário logado, o que incluía o visitante
--           sem login. Agora só libera o SQL Editor, a chave de serviço e o cadastro automático do login.
--   * safras e variedades eram lidas por QUALQUER conta logada (inclusive a de quem se cadastrou sozinho).
--           Agora só por quem usa o COA WEB: administrador, ou colaborador com pelo menos uma fazenda.
--   * A4 (parte do banco) — nomes sem "<" nem ">" em perfis, fazendas, variedades,
--           safras, talhoes e mapas_fazendas. Não substitui o escape na tela; é a segunda barreira.
--
-- O que NÃO muda:
--   * authenticated continua com os mesmos privilégios nas sete tabelas;
--   * as regras antigas (com os nomes que já têm) continuam como estão. As de UPDATE sem "with check" ganham
--     o "with check" escrito, igual ao "using". Isso é só clareza: quando a regra de UPDATE não tem
--     "with check", o Postgres JÁ usa o "using" para conferir a linha nova (documentação de CREATE POLICY),
--     então mover um talhão para uma fazenda sem acesso já era recusado.
--
-- Sobre revogar EXECUTE de função de gatilho: o Postgres só confere EXECUTE da função quando o gatilho é
-- CRIADO (quem cria precisa ter); quando o gatilho DISPARA ele não confere o privilégio de quem fez o
-- insert/update. Este banco já prova isso: acomp_metas_registrar() e senha_provisoria_ao_criar() estão
-- revogadas de authenticated desde os scripts do Acompanhamento e 0011 e disparam normalmente. Por garantia,
-- o papel que o Supabase Auth usa (supabase_auth_admin) recebe EXECUTE explícito em criar_perfil_automatico().
--
-- O que pode deixar de funcionar (e como testar):
--   1. Login e tela inicial: entrar com um colaborador e com um administrador. Devem ver fazendas, talhões,
--      variedades e safras como antes.
--   2. Criar usuário (Usuários → Novo usuário) e editar/remover um colaborador de teste: passa pelos dois
--      gatilhos de perfis (criar_perfil_automatico e perfis_protege_admins).
--   3. Coordenador (só Controle Técnico, sem fazenda): deixa de receber a lista de safras e variedades. A tela
--      dele não usa essas listas (index.html carrega com "|| []"), então não deve notar nada.
--   4. Nome com "<" ou ">": passa a ser recusado ao salvar. Linha antiga que já tenha esses caracteres não é
--      conferida agora, mas qualquer alteração nela passa a falhar até o nome ser corrigido. Rode ANTES a
--      consulta "linhas antigas fora da regra" do fim deste arquivo; o esperado é voltar vazia.
--   5. Se is_admin() no banco não devolver boolean (ou não for do mesmo dono), o script para com erro e nada
--      fica aplicado (é uma transação só).
--
-- Como desfazer:
--   grant select, insert, update, delete on public.perfis, public.fazendas, public.talhoes, public.safras,
--     public.variedades, public.usuario_fazendas, public.usuario_categorias to anon;        -- (não recomendado)
--   grant execute on function public.is_admin(), public.tem_acesso_fazenda(bigint) to anon;  -- (não recomendado)
--   drop policy if exists safras_so_usuario_do_coa on public.safras;
--   drop policy if exists variedades_so_usuario_do_coa on public.variedades;
--   alter table public.<tabela> drop constraint if exists <tabela>_texto_sem_html;   -- as seis tabelas do item 8
--   perfis_protege_admins: rodar de novo o trecho 4 do supabase/0002_administrador_mais.sql.

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. Visitante sem login (anon): nenhum privilégio nas tabelas antigas
-- ------------------------------------------------------------------------------------------------
-- O site só consulta essas tabelas depois do login (index.html: carregarSessaoEDados confere a sessão antes).
revoke all on table public.perfis             from anon;
revoke all on table public.fazendas           from anon;
revoke all on table public.talhoes            from anon;
revoke all on table public.safras             from anon;
revoke all on table public.variedades         from anon;
revoke all on table public.usuario_fazendas   from anon;
revoke all on table public.usuario_categorias from anon;

-- ------------------------------------------------------------------------------------------------
-- 2. is_admin(): mesmo resultado, com search_path fixo e nome da tabela com o schema
-- ------------------------------------------------------------------------------------------------
-- "create or replace" mantém o dono e as regras que usam a função.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p where p.id = auth.uid() and p.perfil = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ------------------------------------------------------------------------------------------------
-- 3. tem_acesso_fazenda(): só quem está logado executa (o corpo é o do 0002, não muda)
-- ------------------------------------------------------------------------------------------------
revoke all on function public.tem_acesso_fazenda(bigint) from public, anon;
grant execute on function public.tem_acesso_fazenda(bigint) to authenticated, service_role;

-- ------------------------------------------------------------------------------------------------
-- 4. Funções que só existem para gatilho: ninguém chama pela API
-- ------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.criar_perfil_automatico()',
    'public.perfis_protege_admins()',
    'public.whatsapp_contato_troca_numero()'
  ] loop
    if to_regprocedure(f) is null then
      raise notice 'Função % não existe neste banco: pulada.', f;
    else
      execute format('revoke all on function %s from public, anon, authenticated', f);
      -- search_path fixo (essas funções só usam tabelas de public e funções do próprio Postgres)
      execute format('alter function %s set search_path = public', f);
    end if;
  end loop;

  -- o gatilho de auth.users dispara dentro do Supabase Auth: EXECUTE explícito para o papel dele, por garantia
  if to_regprocedure('public.criar_perfil_automatico()') is not null
     and exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.criar_perfil_automatico() to supabase_auth_admin';
  end if;

  -- função de apoio do 0011 (só texto, sem tabela): search_path fixo também
  if to_regprocedure('public.senha_o_que_falta(text)') is not null then
    execute 'alter function public.senha_o_que_falta(text) set search_path = public';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 5. perfis_protege_admins: "sem usuário logado" só é livre fora da API pública
-- ------------------------------------------------------------------------------------------------
-- Como saber de onde vem a chamada, dentro de um gatilho security definer:
--   * current_user não serve: dentro da função é sempre o dono dela;
--   * auth.role() lê o papel do token que a API (PostgREST) recebeu:
--       SQL Editor ............................ null (não passa pela API)
--       cadastro do login (Supabase Auth) ..... null (o Auth fala direto com o banco)
--       chave de serviço pela API ............. 'service_role'
--       visitante sem login pela API .......... 'anon'
--       usuário logado pela API ............... 'authenticated' (e auth.uid() preenchido)
-- Então: auth.uid() nulo E papel 'anon' ou 'authenticated' = chamada pública sem usuário → recusa.
-- O resto da função é igual ao do 0002.
create or replace function public.perfis_protege_admins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eu uuid := auth.uid();
  eu_super boolean;
begin
  if eu is null then
    if coalesce(auth.role(), '') in ('anon', 'authenticated') then
      raise exception 'Entre no COA WEB para alterar perfis.' using errcode = '42501';
    end if;
    -- SQL Editor, chave de serviço e o cadastro automático do login: livre
    return coalesce(new, old);
  end if;

  -- a marca ADMINISTRADOR+ nunca muda por uma chamada do site, nem pelo próprio
  if tg_op = 'INSERT' and new.super then
    raise exception 'A marca ADMINISTRADOR+ só pode ser dada pelo SQL Editor.';
  end if;
  if tg_op = 'UPDATE' and (new.super is distinct from old.super or (old.super and new.perfil <> 'admin')) then
    raise exception 'A marca ADMINISTRADOR+ só pode ser alterada pelo SQL Editor.';
  end if;
  if tg_op = 'DELETE' and old.super then
    raise exception 'O perfil ADMINISTRADOR+ não pode ser removido pelo site.';
  end if;

  select exists (
    select 1 from public.perfis p where p.id = eu and p.perfil = 'admin' and p.super
  ) into eu_super;
  if eu_super then
    return coalesce(new, old);
  end if;

  -- administrador comum: só colaboradores
  if tg_op in ('UPDATE', 'DELETE') and old.perfil <> 'colaborador' then
    raise exception 'Só o ADMINISTRADOR+ altera ou remove administradores.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.perfil <> 'colaborador' then
    raise exception 'Só o ADMINISTRADOR+ cria ou promove administradores.';
  end if;
  if tg_op = 'UPDATE' and new.todas_fazendas is distinct from old.todas_fazendas then
    raise exception 'Só o ADMINISTRADOR+ altera a restrição de fazendas.';
  end if;
  if tg_op = 'INSERT' then
    new.todas_fazendas := true;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.perfis_protege_admins() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6. Regras de UPDATE sem "with check": escreve o "with check" igual ao "using" (só clareza)
-- ------------------------------------------------------------------------------------------------
-- Pega as regras pelo catálogo, sem depender do nome delas (as de safras, variedades e talhoes foram criadas
-- à mão). Não muda o efeito: sem "with check", o Postgres já aplicava o "using" à linha nova.
do $$
declare
  r record;
begin
  for r in
    select c.relname as tabela, p.polname as regra, pg_catalog.pg_get_expr(p.polqual, p.polrelid) as condicao
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('fazendas', 'safras', 'variedades', 'talhoes')
      and p.polcmd = 'w'
      and p.polqual is not null
      and p.polwithcheck is null
  loop
    execute format('alter policy %I on public.%I with check (%s)', r.regra, r.tabela, r.condicao);
    raise notice 'Regra "%" de %: with check escrito igual ao using.', r.regra, r.tabela;
  end loop;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 7. safras e variedades: só quem usa o COA WEB lê (administrador, ou colaborador com fazenda)
-- ------------------------------------------------------------------------------------------------
-- Regra RESTRITIVA: soma-se (com "E") às regras antigas, sem precisar apagar nenhuma. A regra antiga de leitura
-- continua sendo "auth.uid() is not null"; com esta, o resultado passa a ser "logado E usuário do COA WEB".
-- Quem se cadastrou sozinho (perfil automático, sem fazenda) deixa de ler os dois catálogos.
drop policy if exists safras_so_usuario_do_coa on public.safras;
create policy safras_so_usuario_do_coa on public.safras
  as restrictive
  for select to authenticated
  using ((select public.mapas_eh_usuario()));

drop policy if exists variedades_so_usuario_do_coa on public.variedades;
create policy variedades_so_usuario_do_coa on public.variedades
  as restrictive
  for select to authenticated
  using ((select public.mapas_eh_usuario()));

-- ------------------------------------------------------------------------------------------------
-- 8. Nomes sem "<" nem ">"
-- ------------------------------------------------------------------------------------------------
-- "not valid": as linhas que já existem não são conferidas agora (o script não falha por causa delas); toda
-- linha nova ou alterada é conferida. Colunas vazias (null) passam. O "::text" deixa a regra valer para
-- qualquer tipo de coluna de texto.
alter table public.perfis drop constraint if exists perfis_texto_sem_html;
alter table public.perfis add constraint perfis_texto_sem_html
  check (nome::text !~ '[<>]' and email::text !~ '[<>]') not valid;

alter table public.fazendas drop constraint if exists fazendas_texto_sem_html;
alter table public.fazendas add constraint fazendas_texto_sem_html
  check (nome::text !~ '[<>]') not valid;

alter table public.variedades drop constraint if exists variedades_texto_sem_html;
alter table public.variedades add constraint variedades_texto_sem_html
  check (nome::text !~ '[<>]') not valid;

alter table public.safras drop constraint if exists safras_texto_sem_html;
alter table public.safras add constraint safras_texto_sem_html
  check (nome::text !~ '[<>]') not valid;

-- talhoes: o nome do talhão e as cópias do nome da variedade e da safra (index.html: talhaoParaBanco)
alter table public.talhoes drop constraint if exists talhoes_texto_sem_html;
alter table public.talhoes add constraint talhoes_texto_sem_html
  check (
    talhao::text !~ '[<>]'
    and variedade::text !~ '[<>]'
    and safra::text !~ '[<>]'
  ) not valid;

alter table public.mapas_fazendas drop constraint if exists mapas_fazendas_texto_sem_html;
alter table public.mapas_fazendas add constraint mapas_fazendas_texto_sem_html
  check (nome::text !~ '[<>]') not valid;

-- ------------------------------------------------------------------------------------------------
-- 9. whatsapp_contatos.jid — NÃO aplicado (ver o relatório)
-- ------------------------------------------------------------------------------------------------
-- A regra sugerida ('^55[0-9]{10,11}@s\.whatsapp\.net$') pode recusar um endereço que o serviço grava hoje:
-- modulos/sat/src/servidor/whatsapp.ts (lerRecebida) guarda o remoteJidAlt da mensagem do jeito que vem, e
-- comandos.ts (chaveDoNumero) aceita endereço com o aparelho junto ('55…:12@s.whatsapp.net'). Uma recusa do
-- banco faria o ATIVAR do contato falhar. O serviço nunca grava '@lid' (chaveDoNumero recusa). Se quiser a
-- conferência, esta versão aceita as duas formas — só rode depois de confirmar com os jids que já estão no banco
-- (consulta no fim do arquivo):
--
--   alter table public.whatsapp_contatos drop constraint if exists whatsapp_contatos_jid_check;
--   alter table public.whatsapp_contatos add constraint whatsapp_contatos_jid_check
--     check (jid is null or jid ~ '^55[0-9]{10,11}(:[0-9]{1,3})?@s\.whatsapp\.net$') not valid;

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois. Uma linha por item, com o esperado na última coluna.
-- =================================================================================================
-- select 'anon nas tabelas antigas' as item, c.relname as objeto,
--        concat_ws(',', case when has_table_privilege('anon', c.oid, 'SELECT') then 'select' end,
--                       case when has_table_privilege('anon', c.oid, 'INSERT') then 'insert' end,
--                       case when has_table_privilege('anon', c.oid, 'UPDATE') then 'update' end,
--                       case when has_table_privilege('anon', c.oid, 'DELETE') then 'delete' end) as valor,
--        'vazio' as esperado
-- from pg_class c
-- where c.relnamespace = 'public'::regnamespace
--   and c.relname in ('perfis','fazendas','talhoes','safras','variedades','usuario_fazendas','usuario_categorias')
-- union all
-- select 'função', p.oid::regprocedure::text,
--        format('definer=%s | config=%s | anon=%s | authenticated=%s', p.prosecdef, coalesce(p.proconfig::text, '(nenhuma)'),
--               has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')),
--        'config com search_path=public; anon=false; authenticated=true só em is_admin e tem_acesso_fazenda'
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('is_admin','tem_acesso_fazenda','criar_perfil_automatico','perfis_protege_admins',
--                     'whatsapp_contato_troca_numero','senha_o_que_falta')
-- union all
-- select 'regra', pol.tablename || ' / ' || pol.policyname,
--        format('%s | %s | using: %s | with check: %s', pol.cmd, lower(pol.permissive), coalesce(pol.qual, '-'), coalesce(pol.with_check, '-')),
--        'UPDATE com with check; safras e variedades com a regra restrictive *_so_usuario_do_coa'
-- from pg_policies pol
-- where pol.schemaname = 'public' and pol.tablename in ('fazendas','safras','variedades','talhoes','perfis')
-- union all
-- select 'restrição de texto', con.conrelid::regclass::text || ' / ' || con.conname,
--        format('validada=%s | %s', con.convalidated, pg_get_constraintdef(con.oid)), 'seis linhas, validada=false'
-- from pg_constraint con
-- where con.conname like '%\_texto\_sem\_html'
-- order by 1, 2;
--
-- Linhas antigas fora da regra dos nomes (rodar ANTES; o esperado é não voltar nada):
-- select 'perfis' as tabela, id::text as id, nome::text as texto from public.perfis where nome::text ~ '[<>]' or email::text ~ '[<>]'
-- union all select 'fazendas', id::text, nome::text from public.fazendas where nome::text ~ '[<>]'
-- union all select 'variedades', id::text, nome::text from public.variedades where nome::text ~ '[<>]'
-- union all select 'safras', id::text, nome::text from public.safras where nome::text ~ '[<>]'
-- union all select 'talhoes', id::text, talhao::text from public.talhoes
--            where talhao::text ~ '[<>]' or variedade::text ~ '[<>]' or safra::text ~ '[<>]'
-- union all select 'mapas_fazendas', id::text, nome::text from public.mapas_fazendas where nome::text ~ '[<>]';
--
-- Formas de jid que o serviço já gravou (para decidir o item 9; não mostra o número):
-- select regexp_replace(jid, '[0-9]', '9', 'g') as forma, count(*) from public.whatsapp_contatos where jid is not null group by 1;
