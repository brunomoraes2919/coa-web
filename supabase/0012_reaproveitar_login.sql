-- COA WEB — cadastrar de novo um e-mail cujo perfil foi removido.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0011 (pode rodar de novo sem estragar nada).
--
-- "Remover perfil" na página Usuários apaga o perfil do COA WEB, mas o login continua existindo em
-- Authentication. Ao cadastrar o mesmo e-mail de novo, o Supabase respondia "User already registered" e o
-- cadastro parava. Esta função deixa o administrador reaproveitar esse login SEM perfil: troca a senha dele
-- pela informada no cadastro (ou pela senha padrão) e devolve o id, para o site criar o perfil como em
-- qualquer cadastro novo. Login que já tem perfil no COA WEB é recusado.

begin;

set local lock_timeout = '5s';

create or replace function public.admin_reaproveitar_login(p_email text, p_senha text default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_hash text;
begin
  if not public.mapas_eh_admin() then
    raise exception 'Só administradores cadastram usuários.';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'E-mail não informado.';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_id is null then
    raise exception 'Não existe login com este e-mail.';
  end if;
  if exists (select 1 from public.perfis p where p.id = v_id) then
    raise exception 'Este e-mail já tem usuário no COA WEB: veja na lista de usuários cadastrados.';
  end if;

  if p_senha is not null and p_senha <> '' then
    if length(p_senha) < 6 or length(p_senha) > 72 then
      raise exception 'A senha precisa ter de 6 a 72 caracteres.';
    end if;
    v_hash := extensions.crypt(p_senha, extensions.gen_salt('bf'));
  else
    select hash into v_hash from public.senha_padrao;
    if v_hash is null then
      raise exception 'Informe a senha do primeiro acesso, ou peça ao ADMINISTRADOR+ para definir a senha padrão.';
    end if;
  end if;

  -- a senha antiga do login deixa de valer; o perfil (e a marca de senha provisória) o site cria em seguida
  update auth.users
     set encrypted_password = v_hash,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_reaproveitar_login(text, text) from public, anon;
grant execute on function public.admin_reaproveitar_login(text, text) to authenticated;

commit;
