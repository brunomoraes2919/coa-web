-- COA WEB — Três ajustes de regra achados no levantamento da documentação técnica (13/10/2026).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: modulos/mapas/supabase/coa-web/0001_mapas.sql, supabase/0002_administrador_mais.sql (admin_ve_tudo),
-- 0010_controle_por_equipe.sql, 0011_senha_padrao.sql e 0019_seguranca_admin_restrito.sql.
-- ATENÇÃO: rodar de novo o 0001 do Mapas ou o 0019 depois deste desfaz o que está aqui (eles recriam as mesmas
-- regras na forma antiga). Se precisar rodar um deles, rode este em seguida.
--
-- O que muda:
--   1. mapas_safras — EXCLUIR uma safra passa a ser só do ADMINISTRADOR+ e do administrador sem restrição de
--      fazendas (admin_ve_tudo). Antes qualquer administrador excluía, e a exclusão leva junto, em cascata, os
--      plantios e as áreas de cultura da safra em TODAS as fazendas, inclusive as que ele não enxerga. Criar e
--      renomear safra continuam como estavam.
--   2. controle_equipes — tirar uma equipe de um coordenador passa a exigir a categoria Controle Técnico de quem
--      tira, como já era para dar (o 0019 pôs a exigência só no INSERT).
--   3. admin_redefinir_senha — a senha digitada pelo administrador passa a ter o limite de 72 caracteres, como
--      nas outras funções de senha (acima disso o bcrypt ignora o resto). O mínimo continua 6 caracteres
--      quaisquer, de propósito: é senha provisória, e quem a recebe cria a definitiva (com maiúscula, minúscula e
--      número) ao entrar.
--
-- O que pode deixar de funcionar (e como testar):
--   1. Administrador RESTRITO a algumas fazendas: em Mapas → Safras, excluir uma safra não exclui mais (o banco
--      devolve zero linhas, sem erro). Com o ADMINISTRADOR+ ou um administrador de todas as fazendas: como antes.
--   2. Administrador SEM a categoria Controle Técnico: em Administração → Usuários, tirar a equipe de um
--      coordenador não tira mais. Quem tem a categoria (e o ADMINISTRADOR+): como antes.
--   3. Redefinir a senha de alguém com mais de 72 caracteres: recusa com mensagem. Com 6 a 72: como antes.
--
-- Como desfazer:
--   rodar de novo o trecho "mapas_safras" de modulos/mapas/supabase/coa-web/0001_mapas.sql e os trechos
--   "controle_equipes" e "admin_redefinir_senha" de supabase/0019_seguranca_admin_restrito.sql.

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. mapas_safras: excluir é só de quem vê todas as fazendas
-- ------------------------------------------------------------------------------------------------
drop policy if exists mapas_safras_delete on public.mapas_safras;
create policy mapas_safras_delete on public.mapas_safras
  for delete to authenticated
  using ((select public.admin_ve_tudo()));

-- ------------------------------------------------------------------------------------------------
-- 2. controle_equipes: tirar a equipe pede a mesma categoria que dar
-- ------------------------------------------------------------------------------------------------
drop policy if exists controle_equipes_delete on public.controle_equipes;
create policy controle_equipes_delete on public.controle_equipes
  for delete to authenticated
  using (
    public.is_super()
    or (
      public.mapas_eh_admin()
      and public.eh_colaborador(usuario_id)
      and public.tem_categoria('controle')
      and public.acomp_pode_ver_unidade(unidade)
    )
  );

-- ------------------------------------------------------------------------------------------------
-- 3. admin_redefinir_senha: limite de 72 caracteres (o resto é o corpo do 0019, sem mudança)
-- ------------------------------------------------------------------------------------------------
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
  if length(p_senha) > 72 then
    raise exception 'A senha pode ter no máximo 72 caracteres.';
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
    perform public.auth_encerrar_sessoes(p_usuario);
  end if;
end;
$$;

revoke all on function public.admin_redefinir_senha(uuid, text) from public, anon;
grant execute on function public.admin_redefinir_senha(uuid, text) to authenticated;

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- 1) As duas regras no lugar (esperado: mapas_safras_delete com admin_ve_tudo; controle_equipes_delete com
--    tem_categoria('controle')):
-- select tablename, policyname, cmd, qual from pg_policies
-- where schemaname = 'public' and policyname in ('mapas_safras_delete', 'controle_equipes_delete') order by 1;
--
-- 2) A função com o limite novo (esperado: uma linha com tem_limite = true):
-- select proname, pg_get_functiondef(oid) like '%máximo 72 caracteres%' as tem_limite
-- from pg_proc where pronamespace = 'public'::regnamespace and proname = 'admin_redefinir_senha';
