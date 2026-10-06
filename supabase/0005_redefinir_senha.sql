-- COA WEB — redefinição de senha de um usuário pelo administrador (botão "redefinir senha" na página Usuários).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada). Requer o 0002 (perfis.super, is_super).
--
-- O site não tem a chave de serviço (e não deve ter), então a troca é feita dentro do banco: a função roda
-- como dono (security definer), confere quem está chamando e grava a nova senha em auth.users com o mesmo
-- bcrypt que o Supabase Auth usa (pgcrypto: crypt + gen_salt('bf')). Regras:
--   - só administrador chama; administrador comum só redefine senha de colaborador;
--   - o ADMINISTRADOR+ redefine a de qualquer um (inclusive a própria); a dele, só ele mesmo;
--   - mínimo de 6 caracteres (o mesmo limite do cadastro de usuário).
-- As sessões já abertas da pessoa continuam valendo até expirarem; a senha nova vale na próxima entrada.

create or replace function public.admin_redefinir_senha(p_usuario uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alvo record;
begin
  if not public.mapas_eh_admin() then
    raise exception 'Só administradores redefinem senhas.';
  end if;
  if p_usuario is null then
    raise exception 'Usuário não informado.';
  end if;
  if p_senha is null or length(p_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;

  select p.perfil, p.super into alvo from public.perfis p where p.id = p_usuario;
  if not found then
    raise exception 'Usuário não encontrado no COA WEB.';
  end if;
  if alvo.super and p_usuario <> auth.uid() then
    raise exception 'A senha do ADMINISTRADOR+ só pode ser trocada por ele mesmo.';
  end if;
  if not public.is_super() and alvo.perfil <> 'colaborador' then
    raise exception 'Só o ADMINISTRADOR+ redefine a senha de administradores.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_usuario;
  if not found then
    raise exception 'Login não encontrado em Authentication → Users.';
  end if;
end;
$$;

revoke all on function public.admin_redefinir_senha(uuid, text) from public, anon;
grant execute on function public.admin_redefinir_senha(uuid, text) to authenticated;
