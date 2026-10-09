-- COA WEB — segurança, parte 5 de 5: só entra login novo que um administrador autorizou.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0020 e SÓ DEPOIS de publicar a versão do site que grava
-- a autorização antes de criar o login (pode rodar de novo sem estragar nada).
-- Depende de: scripts do Mapas (função mapas_eh_admin).
--
-- Por que: o site cria usuários com o "cadastro público" do Supabase (index.html: auth.signUp com a chave
-- pública), e a confirmação de e-mail está desligada. Então o cadastro público precisa ficar ligado — e, com
-- ele ligado, QUALQUER pessoa da internet criava uma conta e ganhava um perfil de colaborador (gatilho
-- ao_criar_usuario → criar_perfil_automatico). Essa conta não via fazenda nenhuma, mas já era um "usuário
-- logado" para tudo o que só confere isso.
--
-- Achado que este script fecha (auditoria de 09/10/2026):
--   * A3 — cadastro público aberto. Agora um login só é criado se o e-mail tiver sido autorizado por um
--          administrador nos últimos 15 minutos. O cadastro público continua "ligado" no painel, mas quem
--          não foi autorizado recebe erro.
--
-- Como funciona:
--   1. Na página Usuários, antes de criar o login, o site grava o e-mail em cadastros_autorizados (só
--      administrador consegue gravar; o banco carimba quem e quando).
--   2. O Supabase Auth tenta inserir o login em auth.users; o gatilho cadastro_autorizado_trg procura a
--      autorização daquele e-mail. Achou (e tem menos de 15 minutos): consome a autorização e deixa passar.
--      Não achou: recusa. O Supabase devolve ao navegador o erro genérico "Database error saving new user".
--   3. O e-mail é comparado em minúsculas e sem espaços nas pontas — é assim que o Supabase Auth grava
--      auth.users.email. A tabela guarda o e-mail já nessa forma, não importa como o site enviou.
--
-- ATENÇÃO — criar usuário pelo painel do Supabase (Authentication → Users → Add user / Invite) e pela API de
-- administração passa pelo MESMO caminho no banco (o Supabase Auth insere em auth.users com o mesmo papel, e o
-- banco não tem como saber de onde veio o pedido). Então também exige a autorização. Antes de criar um usuário
-- pelo painel, rode no SQL Editor (vale por 15 minutos):
--
--   insert into public.cadastros_autorizados (email) values ('pessoa@empresa.com.br')
--   on conflict (email) do update set autorizado_em = now();
--
-- O que pode deixar de funcionar (e como testar):
--   1. Usuários → Novo usuário: se o site publicado ainda NÃO grava a autorização, a criação de usuários PARA
--      ("Não foi possível criar o login: Database error saving new user"). Por isso este script é o último e só
--      deve rodar com o site novo no ar. Teste logo depois de rodar: criar um usuário de teste e removê-lo.
--   2. Reaproveitar um e-mail cujo perfil foi removido (0012) não cria login novo: não depende da autorização.
--      A autorização gravada nesse caso fica sem uso e vence sozinha em 15 minutos.
--   3. Teste de fora: numa janela anônima, tentar criar uma conta pela API pública (ou pedir a quem testa a
--      segurança) — tem que falhar.
--   4. Login por telefone, anônimo ou por provedor externo (Google etc.), se um dia forem ligados, também ficam
--      barrados para conta nova (sem e-mail autorizado não entra).
--
-- Como desfazer (o cadastro público volta a ficar aberto):
--   drop trigger if exists cadastro_autorizado_trg on auth.users;
--   drop function if exists public.auth_so_cadastro_autorizado();
--   -- a tabela pode ficar (o site tolera as duas situações); para tirar: drop table public.cadastros_autorizados;

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. E-mails que um administrador autorizou a cadastrar
-- ------------------------------------------------------------------------------------------------
create table if not exists public.cadastros_autorizados (
  -- sempre em minúsculas e sem espaços nas pontas (o gatilho abaixo garante)
  email          text primary key check (char_length(email) between 3 and 320),
  -- quem autorizou (nulo = SQL Editor) e quando; preenchidos pelo banco, o cliente não escolhe
  autorizado_por uuid,
  autorizado_em  timestamptz not null default now()
);

-- Normaliza o e-mail e carimba quem/quando em toda gravação. Autorização vencida do mesmo e-mail é apagada
-- antes, para que gravar de novo sempre renove o prazo — seja com "upsert" que atualiza, seja com o que ignora
-- a linha repetida.
create or replace function public.cadastros_autorizados_carimbar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := lower(btrim(new.email));
  new.autorizado_por := auth.uid();
  new.autorizado_em := now();
  if tg_op = 'INSERT' then
    delete from public.cadastros_autorizados c
     where c.email = new.email and c.autorizado_em < now() - interval '15 minutes';
  end if;
  return new;
end;
$$;

revoke all on function public.cadastros_autorizados_carimbar() from public, anon, authenticated;

drop trigger if exists cadastros_autorizados_carimbo_trg on public.cadastros_autorizados;
create trigger cadastros_autorizados_carimbo_trg
  before insert or update on public.cadastros_autorizados
  for each row execute function public.cadastros_autorizados_carimbar();

alter table public.cadastros_autorizados enable row level security;
revoke all on table public.cadastros_autorizados from anon, authenticated;
grant select, insert, update, delete on table public.cadastros_autorizados to authenticated;

-- só administradores leem e gravam (os mesmos que criam usuários na página Usuários)
drop policy if exists cadastros_autorizados_admin on public.cadastros_autorizados;
create policy cadastros_autorizados_admin on public.cadastros_autorizados
  for all to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

-- ------------------------------------------------------------------------------------------------
-- 2. O gatilho em auth.users
-- ------------------------------------------------------------------------------------------------
-- Dispara ANTES de inserir o login, dentro do Supabase Auth. Vale para toda inserção, de qualquer origem
-- (não há como distinguir, no banco, o cadastro público do painel: ver ATENÇÃO no cabeçalho). Se algo aqui
-- falhar, nenhum login novo é criado — o erro fica do lado seguro.
create or replace function public.auth_so_cadastro_autorizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cadastros_autorizados c
   where c.email = lower(btrim(coalesce(new.email, '')))
     and c.autorizado_em >= now() - interval '15 minutes';
  if not found then
    raise exception 'Cadastro não autorizado: o login do COA WEB é criado pelo administrador, na página Usuários.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.auth_so_cadastro_autorizado() from public, anon, authenticated;

-- o gatilho dispara dentro do Supabase Auth: EXECUTE explícito para o papel dele, por garantia (o Postgres
-- não confere esse privilégio no disparo, só na criação do gatilho)
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.auth_so_cadastro_autorizado() to supabase_auth_admin';
  end if;
end;
$$;

drop trigger if exists cadastro_autorizado_trg on auth.users;
create trigger cadastro_autorizado_trg
  before insert on auth.users
  for each row execute function public.auth_so_cadastro_autorizado();

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- 1) Os gatilhos de auth.users (esperado: ao_criar_usuario, que já existia, e cadastro_autorizado_trg):
-- select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1;
--
-- 2) A tabela: RLS ligado, visitante sem privilégio, uma regra só para administradores:
-- select 'rls' as item, relrowsecurity::text as valor from pg_class where oid = 'public.cadastros_autorizados'::regclass
-- union all select 'anon select', has_table_privilege('anon', 'public.cadastros_autorizados', 'SELECT')::text
-- union all select 'anon insert', has_table_privilege('anon', 'public.cadastros_autorizados', 'INSERT')::text
-- union all select 'regra ' || policyname, cmd || ' | ' || qual from pg_policies where schemaname = 'public' and tablename = 'cadastros_autorizados';
--
-- 3) Autorizações pendentes (normalmente vazio; linha com mais de 15 minutos = cadastro que não se completou):
-- select email, autorizado_por, autorizado_em, now() - autorizado_em as idade from public.cadastros_autorizados order by autorizado_em desc;
--
-- 4) Contas criadas depois de rodar este script (todas devem ser de pessoas cadastradas pelo administrador):
-- select u.email, u.created_at, p.perfil from auth.users u left join public.perfis p on p.id = u.id order by u.created_at desc limit 20;
