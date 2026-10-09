-- COA WEB — segurança, parte 3 de 5: administrador com fazendas restritas, senhas e remoção de perfil.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0018 (pode rodar de novo sem estragar nada).
-- Depende de: 0002 (is_super, admin_ve_tudo, eh_colaborador, tem_categoria, tem_acesso_fazenda), 0007
-- (valid_vinculos), 0010 (controle_equipes), 0011 e 0012 (funções de senha), scripts do Mapas e do
-- Acompanhamento.
--
-- O 0002 criou o administrador que só vê as fazendas liberadas para ele. A LEITURA passou a respeitar isso,
-- mas várias regras de ESCRITA continuaram valendo para "qualquer administrador". Este script fecha os
-- caminhos pelos quais um administrador restrito (ou sem certa categoria) alcançava dados de outra fazenda.
--
-- Achados que este script fecha (auditoria de 09/10/2026):
--   * M1 — mapas_fazendas: um administrador restrito criava uma fazenda de mapa com a unidade do PIMS de OUTRA
--          fazenda, ligada a uma fazenda dele, e com isso passava a ler os dados daquela unidade (Operacional,
--          plantio, Validação, chuva). Agora só o administrador sem restrição (ou o ADMINISTRADOR+) grava em
--          mapas_fazendas; talhões, áreas de cultura e plantio só são gravados nas fazendas que o
--          administrador vê.
--   * M2 — controle_equipes: o administrador vinculava a um colaborador a equipe de qualquer unidade. Agora só
--          de unidade que ele vê, e só se ele mesmo tem a categoria Controle Técnico.
--   * M3 — valid_vinculos: qualquer administrador gravava vínculo de depósito de qualquer unidade (o servidor
--          consulta no SAP o depósito vinculado). Agora só com a categoria Validação PIMS e na unidade que vê.
--   * M4 — senha de outro usuário: o administrador comum redefinia a senha de um colaborador com MAIS acesso
--          que ele (outra fazenda, outra categoria) e entrava como ele. Agora o alvo não pode ter fazenda,
--          categoria nem equipe que o administrador não tenha; nesses casos só o ADMINISTRADOR+.
--   * M4 — ao trocar a senha de alguém, as sessões abertas dessa pessoa continuavam valendo. Agora são
--          encerradas (ela precisa entrar de novo com a senha nova).
--   * M5 — definir_minha_senha respondia "não pode ser a senha padrão" só quando o palpite acertava: qualquer
--          conta logada conseguia testar qual é a senha padrão. A conferência saiu. Quem ESTÁ com a senha padrão
--          continua sem poder repeti-la (a senha nova tem que ser diferente da atual).
--   * B1 — histórico de metas e equipes do Controle Técnico: o administrador restrito lia os de todas as unidades.
--   * M7 — "remover perfil" deixava as fazendas liberadas e as sessões da pessoa. Agora as duas saem junto.
--
-- Sobre encerrar sessões: é um "delete from auth.sessions" (os refresh tokens saem junto, pela chave
-- estrangeira do próprio Supabase Auth). As funções rodam como o dono (o papel do SQL Editor), que nos projetos
-- Supabase tem esse privilégio; como não dá para garantir daqui, o delete fica protegido: se o banco recusar,
-- a troca de senha acontece do mesmo jeito e sai só um aviso no log (confira com a consulta do fim do arquivo).
-- O token de acesso que a pessoa já tem no navegador ainda vale até vencer (1 hora, no padrão); o que acaba é
-- a renovação.
--
-- O que pode deixar de funcionar (e como testar):
--   1. Administrador RESTRITO (perfis.todas_fazendas = false) não cria, edita nem exclui mais fazenda de mapa
--      (Mapas → Fazendas): recebe erro de permissão ao salvar. Se existir alguém assim que cuida do cadastro de
--      mapas, avise antes. Administrador sem restrição e ADMINISTRADOR+: nada muda — teste editar uma fazenda
--      de mapa e reimportar os talhões.
--   2. Usuários → "voltar à senha padrão" / "redefinir senha": administrador comum deixa de conseguir quando o
--      colaborador tem categoria ou fazenda que ele não tem (mensagem: "só o ADMINISTRADOR+ mexe na senha
--      dele"). Teste com um administrador comum em um colaborador simples (deve funcionar).
--   3. Quem tiver a senha trocada pelo administrador cai para a tela de login em até 1 hora (antes continuava
--      dentro). É o esperado.
--   4. Validação PIMS → Vínculo de depósitos: o administrador precisa ter a categoria Validação PIMS (sem ela
--      ele nem abre a tela). Teste salvar e remover um vínculo.
--   5. Usuários → perfil Coordenador: o administrador precisa ter a categoria Controle Técnico e ver a unidade
--      da equipe. Teste criar um coordenador de teste e remover.
--   6. Um administrador restrito deixa de ver, na lista de Usuários, a equipe dos coordenadores de unidades que
--      ele não vê (aparecem como colaborador comum).
--   7. Senha definitiva: um usuário que NÃO está com a senha padrão passa a poder escolher, como definitiva, um
--      texto igual à senha padrão (desde que cumpra as regras). É o preço de tirar o "adivinhador".
--
-- Como desfazer:
--   regras de mapas_*: rodar de novo modulos/mapas/supabase/coa-web/0001_mapas.sql e, EM SEGUIDA, o
--     supabase/0002_administrador_mais.sql (o 0001 do Mapas redefine funções que o 0002 corrige);
--   histórico das metas: o trecho da regra acomp_metas_historico_select do 0001 do Acompanhamento;
--   controle_equipes: rodar o trecho das regras do 0010; valid_vinculos: o trecho das regras do 0007;
--   funções de senha: rodar de novo 0011 e 0012;
--   drop trigger if exists perfis_ao_remover_trg on public.perfis;
--   drop function if exists public.perfis_ao_remover();
--   drop function if exists public.auth_encerrar_sessoes(uuid);   -- só depois de voltar as funções de senha

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. M1 — quem grava no cadastro do Mapas
-- ------------------------------------------------------------------------------------------------

-- mapas_fazendas guarda a ligação "unidade do PIMS ↔ fazenda do COA WEB", que é o que decide quem vê os dados
-- de cada unidade (acomp_pode_ver_unidade). Só quem já vê todas as fazendas pode mexer nela.
drop policy if exists mapas_fazendas_insert on public.mapas_fazendas;
create policy mapas_fazendas_insert on public.mapas_fazendas
  for insert to authenticated
  with check ((select public.admin_ve_tudo()));

drop policy if exists mapas_fazendas_update on public.mapas_fazendas;
create policy mapas_fazendas_update on public.mapas_fazendas
  for update to authenticated
  using ((select public.admin_ve_tudo()))
  with check ((select public.admin_ve_tudo()));

drop policy if exists mapas_fazendas_delete on public.mapas_fazendas;
create policy mapas_fazendas_delete on public.mapas_fazendas
  for delete to authenticated
  using ((select public.admin_ve_tudo()));

-- mapas_talhoes e mapas_areas_cultura: administrador, e só nas fazendas de mapa que ele vê
do $$
declare
  t text;
begin
  foreach t in array array['mapas_talhoes', 'mapas_areas_cultura'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check ((select public.mapas_eh_admin()) and public.mapas_pode_ver_fazenda(fazenda_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using ((select public.mapas_eh_admin()) and public.mapas_pode_ver_fazenda(fazenda_id))
         with check ((select public.mapas_eh_admin()) and public.mapas_pode_ver_fazenda(fazenda_id))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using ((select public.mapas_eh_admin()) and public.mapas_pode_ver_fazenda(fazenda_id))', t || '_delete', t);
  end loop;
end;
$$;

-- mapas_plantios: pela fazenda do talhão
drop policy if exists mapas_plantios_insert on public.mapas_plantios;
create policy mapas_plantios_insert on public.mapas_plantios
  for insert to authenticated
  with check (
    (select public.mapas_eh_admin())
    and exists (
      select 1 from public.mapas_talhoes t
      where t.id = mapas_plantios.talhao_id and public.mapas_pode_ver_fazenda(t.fazenda_id)
    )
  );

drop policy if exists mapas_plantios_update on public.mapas_plantios;
create policy mapas_plantios_update on public.mapas_plantios
  for update to authenticated
  using (
    (select public.mapas_eh_admin())
    and exists (
      select 1 from public.mapas_talhoes t
      where t.id = mapas_plantios.talhao_id and public.mapas_pode_ver_fazenda(t.fazenda_id)
    )
  )
  with check (
    (select public.mapas_eh_admin())
    and exists (
      select 1 from public.mapas_talhoes t
      where t.id = mapas_plantios.talhao_id and public.mapas_pode_ver_fazenda(t.fazenda_id)
    )
  );

drop policy if exists mapas_plantios_delete on public.mapas_plantios;
create policy mapas_plantios_delete on public.mapas_plantios
  for delete to authenticated
  using (
    (select public.mapas_eh_admin())
    and exists (
      select 1 from public.mapas_talhoes t
      where t.id = mapas_plantios.talhao_id and public.mapas_pode_ver_fazenda(t.fazenda_id)
    )
  );

-- ------------------------------------------------------------------------------------------------
-- 2. M2 e B1 — controle_equipes: unidade que o administrador vê, e categoria de quem concede
-- ------------------------------------------------------------------------------------------------
drop policy if exists controle_equipes_select on public.controle_equipes;
create policy controle_equipes_select on public.controle_equipes
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or ((select public.mapas_eh_admin()) and public.acomp_pode_ver_unidade(unidade))
  );

drop policy if exists controle_equipes_insert on public.controle_equipes;
create policy controle_equipes_insert on public.controle_equipes
  for insert to authenticated
  with check (
    public.is_super()
    or (
      public.mapas_eh_admin()
      and public.eh_colaborador(usuario_id)
      and public.tem_categoria('controle')
      and public.acomp_pode_ver_unidade(unidade)
    )
  );

drop policy if exists controle_equipes_delete on public.controle_equipes;
create policy controle_equipes_delete on public.controle_equipes
  for delete to authenticated
  using (
    public.is_super()
    or (
      public.mapas_eh_admin()
      and public.eh_colaborador(usuario_id)
      and public.acomp_pode_ver_unidade(unidade)
    )
  );

-- ------------------------------------------------------------------------------------------------
-- 3. M3 — valid_vinculos: categoria Validação PIMS + unidade que o administrador vê
-- ------------------------------------------------------------------------------------------------
drop policy if exists valid_vinculos_insert on public.valid_vinculos;
create policy valid_vinculos_insert on public.valid_vinculos
  for insert to authenticated
  with check (
    (select public.mapas_eh_admin())
    and (select public.tem_categoria('validacao'))
    and public.acomp_pode_ver_unidade(unidade)
  );

drop policy if exists valid_vinculos_update on public.valid_vinculos;
create policy valid_vinculos_update on public.valid_vinculos
  for update to authenticated
  using (
    (select public.mapas_eh_admin())
    and (select public.tem_categoria('validacao'))
    and public.acomp_pode_ver_unidade(unidade)
  )
  with check (
    (select public.mapas_eh_admin())
    and (select public.tem_categoria('validacao'))
    and public.acomp_pode_ver_unidade(unidade)
  );

drop policy if exists valid_vinculos_delete on public.valid_vinculos;
create policy valid_vinculos_delete on public.valid_vinculos
  for delete to authenticated
  using (
    (select public.mapas_eh_admin())
    and (select public.tem_categoria('validacao'))
    and public.acomp_pode_ver_unidade(unidade)
  );

-- ------------------------------------------------------------------------------------------------
-- 4. B1 — histórico das metas: administrador, e só das unidades que ele vê
-- ------------------------------------------------------------------------------------------------
drop policy if exists acomp_metas_historico_select on public.acomp_metas_historico;
create policy acomp_metas_historico_select on public.acomp_metas_historico
  for select to authenticated
  using ((select public.mapas_eh_admin()) and public.acomp_pode_ver_unidade(unidade));

-- ------------------------------------------------------------------------------------------------
-- 5. Encerrar as sessões de um usuário (só as funções deste arquivo chamam)
-- ------------------------------------------------------------------------------------------------
create or replace function public.auth_encerrar_sessoes(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_usuario is null then
    return;
  end if;
  begin
    delete from auth.sessions where user_id = p_usuario;
  exception
    when insufficient_privilege or undefined_table or undefined_column then
      -- sem privilégio (ou outra versão do Supabase Auth): a operação principal segue; fica o aviso no log
      raise warning 'COA WEB: não foi possível encerrar as sessões do usuário % (%).', p_usuario, sqlerrm;
  end;
end;
$$;

revoke all on function public.auth_encerrar_sessoes(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- 6. M4 — quem pode mexer na senha de quem
-- ------------------------------------------------------------------------------------------------
-- Igual à do 0011, mais uma conferência para o administrador comum: o alvo não pode ter fazenda, categoria
-- nem equipe do Controle Técnico que o próprio administrador não tenha.
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
  if not public.is_super() then
    if exists (
         select 1 from public.usuario_fazendas uf
         where uf.usuario_id = p_usuario and not public.tem_acesso_fazenda(uf.fazenda_id))
       or exists (
         select 1 from public.usuario_categorias uc
         where uc.usuario_id = p_usuario and not public.tem_categoria(uc.categoria))
       or exists (
         select 1 from public.controle_equipes ce
         where ce.usuario_id = p_usuario and not public.acomp_pode_ver_unidade(ce.unidade))
    then
      raise exception 'Este usuário tem acessos que você não tem: só o ADMINISTRADOR+ mexe na senha dele.';
    end if;
  end if;
end;
$$;
revoke all on function public.senha_confere_alvo(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- 7. M4 — as três funções que trocam a senha de OUTRA pessoa passam a encerrar as sessões dela
-- ------------------------------------------------------------------------------------------------
-- Corpos iguais aos do 0011 e do 0012; a única linha nova de cada um está marcada com "-- NOVO".

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
  if p_usuario <> auth.uid() then
    perform public.auth_encerrar_sessoes(p_usuario); -- NOVO
  end if;
end;
$$;

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
    perform public.auth_encerrar_sessoes(p_usuario); -- NOVO
  end if;
end;
$$;

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
  perform public.auth_encerrar_sessoes(v_id); -- NOVO: quem ainda estava logado com a senha antiga sai
  return v_id;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 8. M5 — senha definitiva sem a conferência que revelava a senha padrão
-- ------------------------------------------------------------------------------------------------
-- Igual à do 0011, sem o trecho "A senha nova não pode ser a senha padrão.".
create or replace function public.definir_minha_senha(p_nova text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  eu uuid := auth.uid();
  v_atual text;
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
  update auth.users set encrypted_password = extensions.crypt(p_nova, extensions.gen_salt('bf')), updated_at = now() where id = eu;
  delete from public.senha_provisoria where usuario_id = eu;
end;
$$;

revoke all on function public.admin_voltar_senha_padrao(uuid) from public, anon;
revoke all on function public.admin_redefinir_senha(uuid, text) from public, anon;
revoke all on function public.admin_reaproveitar_login(text, text) from public, anon;
revoke all on function public.definir_minha_senha(text) from public, anon;
grant execute on function public.admin_voltar_senha_padrao(uuid) to authenticated;
grant execute on function public.admin_redefinir_senha(uuid, text) to authenticated;
grant execute on function public.admin_reaproveitar_login(text, text) to authenticated;
grant execute on function public.definir_minha_senha(text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 9. M7 — perfil removido: saem também as fazendas liberadas e as sessões
-- ------------------------------------------------------------------------------------------------
-- "Remover perfil" (página Usuários) apaga só a linha de perfis; o login continua em Authentication. As
-- categorias, as equipes e a marca de senha provisória já saíam sozinhas (on delete cascade). Aqui saem também
-- as linhas de usuario_fazendas (se a chave estrangeira já apagava, este delete não acha nada) e as sessões.
create or replace function public.perfis_ao_remover()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.usuario_fazendas where usuario_id = old.id;
  perform public.auth_encerrar_sessoes(old.id);
  return old;
end;
$$;

revoke all on function public.perfis_ao_remover() from public, anon, authenticated;

drop trigger if exists perfis_ao_remover_trg on public.perfis;
create trigger perfis_ao_remover_trg
  after delete on public.perfis
  for each row execute function public.perfis_ao_remover();

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- 1) O dono das funções consegue encerrar sessões? (esperado: true. Se vier false, as trocas de senha
--    continuam funcionando, mas as sessões antigas não são encerradas — me avise.)
-- select p.proname, pg_get_userbyid(p.proowner) as dono,
--        has_table_privilege(p.proowner, 'auth.sessions', 'DELETE') as apaga_sessoes
-- from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'auth_encerrar_sessoes';
--
-- 2) Regras novas no lugar (mapas_fazendas com admin_ve_tudo; as outras com a unidade ou a fazenda):
-- select tablename, policyname, cmd, coalesce(qual, '-') as using_, coalesce(with_check, '-') as with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('mapas_fazendas', 'mapas_talhoes', 'mapas_areas_cultura', 'mapas_plantios',
--                     'controle_equipes', 'valid_vinculos', 'acomp_metas_historico')
-- order by 1, 3, 2;
--
-- 3) Administradores restritos que existem hoje (são os afetados pelo item 1 do cabeçalho):
-- select id, nome, email from public.perfis where perfil = 'admin' and not super and not todas_fazendas;
--
-- 4) Funções de senha e o gatilho de remoção:
-- select p.oid::regprocedure::text as funcao, p.prosecdef as definer, p.proconfig::text as config,
--        has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('senha_confere_alvo', 'admin_voltar_senha_padrao', 'admin_redefinir_senha',
--                     'admin_reaproveitar_login', 'definir_minha_senha', 'auth_encerrar_sessoes', 'perfis_ao_remover')
-- union all
-- select tgrelid::regclass::text || ' / ' || tgname, null, pg_get_triggerdef(oid), null, null
-- from pg_trigger where tgname = 'perfis_ao_remover_trg' and not tgisinternal;
