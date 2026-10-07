-- COA WEB — senha padrão (provisória) e senha definitiva.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0005 (pode rodar de novo sem estragar nada).
--
-- Como funciona:
--   1. O ADMINISTRADOR+ define a SENHA PADRÃO da plataforma. O banco guarda só o hash (bcrypt), nunca o texto.
--   2. Usuário novo, ou usuário cuja senha o administrador voltou para a padrão, fica com "senha provisória":
--      na próxima entrada o site abre uma janela que só fecha depois que ele cria a senha definitiva.
--   3. A senha definitiva é gravada por definir_minha_senha(), que confere as regras de segurança, recusa a
--      senha atual e a senha padrão, e tira a marca de provisória. O administrador nunca vê a senha definitiva.
--   4. Para trocar depois, o usuário pede ao administrador, que clica em "voltar à senha padrão" (passo 2).
--
-- Quem já existe continua como está (sem marca de provisória). Não altera a tabela perfis.

begin;

set local lock_timeout = '5s';

-- ---------- a senha padrão da plataforma (só o hash) ----------
create table if not exists public.senha_padrao (
  id           boolean primary key default true check (id),
  hash         text not null,
  definida_em  timestamptz not null default now(),
  definida_por uuid default auth.uid()
);
alter table public.senha_padrao enable row level security;
revoke all on table public.senha_padrao from anon, authenticated; -- ninguém lê pelo site: só as funções abaixo

-- ---------- quem está com senha provisória ----------
create table if not exists public.senha_provisoria (
  usuario_id uuid primary key references public.perfis(id) on delete cascade,
  desde      timestamptz not null default now(),
  marcada_por uuid default auth.uid()
);
alter table public.senha_provisoria enable row level security;
revoke all on table public.senha_provisoria from anon, authenticated;
grant select on table public.senha_provisoria to authenticated;

-- cada um vê a sua marca; o administrador vê todas. Gravar, só pelas funções.
drop policy if exists senha_provisoria_select on public.senha_provisoria;
create policy senha_provisoria_select on public.senha_provisoria
  for select to authenticated
  using (usuario_id = auth.uid() or (select public.mapas_eh_admin()));

-- todo perfil novo nasce com senha provisória
create or replace function public.senha_provisoria_ao_criar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.senha_provisoria (usuario_id) values (new.id) on conflict (usuario_id) do nothing;
  return new;
end;
$$;
revoke all on function public.senha_provisoria_ao_criar() from public, anon, authenticated;

drop trigger if exists senha_provisoria_ao_criar_trg on public.perfis;
create trigger senha_provisoria_ao_criar_trg
  after insert on public.perfis
  for each row execute function public.senha_provisoria_ao_criar();

-- ---------- regras da senha definitiva ----------
-- Devolve o que falta (texto) ou null quando a senha serve.
create or replace function public.senha_o_que_falta(p_senha text)
returns text
language sql
immutable
as $$
  select case
    when p_senha is null or length(p_senha) < 8 then 'A senha precisa ter pelo menos 8 caracteres.'
    when length(p_senha) > 72 then 'A senha pode ter no máximo 72 caracteres.'
    when p_senha !~ '[A-Z]' then 'A senha precisa ter pelo menos uma letra maiúscula.'
    when p_senha !~ '[a-z]' then 'A senha precisa ter pelo menos uma letra minúscula.'
    when p_senha !~ '[0-9]' then 'A senha precisa ter pelo menos um número.'
    when p_senha !~ '[^A-Za-z0-9]' then 'A senha precisa ter pelo menos um símbolo (por exemplo: ! @ # $ %).'
    else null
  end;
$$;

-- quem pode mexer na senha de quem (as mesmas regras do 0005)
create or replace function public.senha_confere_alvo(p_usuario uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  alvo record;
begin
  if not public.mapas_eh_admin() then
    raise exception 'Só administradores mexem na senha de outro usuário.';
  end if;
  if p_usuario is null then
    raise exception 'Usuário não informado.';
  end if;
  select p.perfil, p.super into alvo from public.perfis p where p.id = p_usuario;
  if not found then
    raise exception 'Usuário não encontrado no COA WEB.';
  end if;
  if alvo.super and p_usuario <> auth.uid() then
    raise exception 'A senha do ADMINISTRADOR+ só pode ser trocada por ele mesmo.';
  end if;
  if not public.is_super() and alvo.perfil <> 'colaborador' then
    raise exception 'Só o ADMINISTRADOR+ mexe na senha de administradores.';
  end if;
end;
$$;
revoke all on function public.senha_confere_alvo(uuid) from public, anon, authenticated;

-- ---------- o ADMINISTRADOR+ define a senha padrão ----------
create or replace function public.admin_definir_senha_padrao(p_senha text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_super() then
    raise exception 'Só o ADMINISTRADOR+ define a senha padrão.';
  end if;
  if p_senha is null or length(p_senha) < 8 or length(p_senha) > 72 then
    raise exception 'A senha padrão precisa ter de 8 a 72 caracteres.';
  end if;
  insert into public.senha_padrao (id, hash, definida_em, definida_por)
  values (true, extensions.crypt(p_senha, extensions.gen_salt('bf')), now(), auth.uid())
  on conflict (id) do update set hash = excluded.hash, definida_em = excluded.definida_em, definida_por = excluded.definida_por;
end;
$$;

-- já existe uma senha padrão definida? (para o site saber se mostra o botão)
create or replace function public.admin_tem_senha_padrao()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mapas_eh_admin() and exists (select 1 from public.senha_padrao);
$$;

-- ---------- o administrador volta a senha de um usuário para a padrão ----------
create or replace function public.admin_voltar_senha_padrao(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  perform public.senha_confere_alvo(p_usuario);
  select hash into v_hash from public.senha_padrao;
  if v_hash is null then
    raise exception 'A senha padrão ainda não foi definida pelo ADMINISTRADOR+.';
  end if;
  update auth.users set encrypted_password = v_hash, updated_at = now() where id = p_usuario;
  if not found then
    raise exception 'Login não encontrado em Authentication → Users.';
  end if;
  insert into public.senha_provisoria (usuario_id, desde, marcada_por) values (p_usuario, now(), auth.uid())
  on conflict (usuario_id) do update set desde = excluded.desde, marcada_por = excluded.marcada_por;
end;
$$;

-- ---------- a redefinição com senha digitada (0005) também passa a ser provisória ----------
create or replace function public.admin_redefinir_senha(p_usuario uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.senha_confere_alvo(p_usuario);
  if p_senha is null or length(p_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_usuario;
  if not found then
    raise exception 'Login não encontrado em Authentication → Users.';
  end if;
  -- senha escolhida pelo administrador para outra pessoa é provisória: ela cria a definitiva ao entrar
  if p_usuario <> auth.uid() then
    insert into public.senha_provisoria (usuario_id, desde, marcada_por) values (p_usuario, now(), auth.uid())
    on conflict (usuario_id) do update set desde = excluded.desde, marcada_por = excluded.marcada_por;
  end if;
end;
$$;

-- ---------- o próprio usuário cria a senha definitiva ----------
create or replace function public.definir_minha_senha(p_nova text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  eu uuid := auth.uid();
  v_atual text;
  v_padrao text;
  v_falta text;
begin
  if eu is null then
    raise exception 'Entre no COA WEB para trocar a senha.';
  end if;
  v_falta := public.senha_o_que_falta(p_nova);
  if v_falta is not null then
    raise exception '%', v_falta;
  end if;
  select encrypted_password into v_atual from auth.users where id = eu;
  if v_atual is null then
    raise exception 'Login não encontrado.';
  end if;
  if extensions.crypt(p_nova, v_atual) = v_atual then
    raise exception 'A senha nova precisa ser diferente da senha atual.';
  end if;
  select hash into v_padrao from public.senha_padrao;
  if v_padrao is not null and extensions.crypt(p_nova, v_padrao) = v_padrao then
    raise exception 'A senha nova não pode ser a senha padrão.';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_nova, extensions.gen_salt('bf')), updated_at = now() where id = eu;
  delete from public.senha_provisoria where usuario_id = eu;
end;
$$;

revoke all on function public.senha_o_que_falta(text) from public, anon;
revoke all on function public.admin_definir_senha_padrao(text) from public, anon;
revoke all on function public.admin_tem_senha_padrao() from public, anon;
revoke all on function public.admin_voltar_senha_padrao(uuid) from public, anon;
revoke all on function public.admin_redefinir_senha(uuid, text) from public, anon;
revoke all on function public.definir_minha_senha(text) from public, anon;
grant execute on function public.senha_o_que_falta(text) to authenticated;
grant execute on function public.admin_definir_senha_padrao(text) to authenticated;
grant execute on function public.admin_tem_senha_padrao() to authenticated;
grant execute on function public.admin_voltar_senha_padrao(uuid) to authenticated;
grant execute on function public.admin_redefinir_senha(uuid, text) to authenticated;
grant execute on function public.definir_minha_senha(text) to authenticated;

commit;

-- Depois de rodar: Usuários → "Senha padrão" (só o ADMINISTRADOR+) para definir a senha padrão da plataforma.
