-- COA WEB — Contatos do WhatsApp: o ADMINISTRADOR também vê e cuida da lista (não só o ADMINISTRADOR+).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: supabase/0002_administrador_mais.sql (admin_ve_tudo), 0003_whatsapp_contatos.sql e
-- 0006_whatsapp_envio.sql. Não depende dos scripts 0017 a 0021.
--
-- O que muda (pedido de 09/10/2026):
--   * whatsapp_contatos e whatsapp_contato_fazendas: quem lê e grava passa de "só o ADMINISTRADOR+" para
--     "ADMINISTRADOR+ e ADMINISTRADOR sem restrição de fazendas" (função admin_ve_tudo, a mesma que decide quem vê
--     todas as fazendas). O administrador RESTRITO a algumas fazendas continua de fora: a lista tem contatos de
--     todas as fazendas, e ele não vê todas.
--   * whatsapp_estado (o aviso "WhatsApp conectado. Último envio…") e whatsapp_envios: a mesma regra, só leitura.
--   * colaborador e coordenador continuam sem ver nada daqui (telefone é dado pessoal).
--
-- Proteção nova, já que mais gente passa a gravar na lista:
--   * o endereço do WhatsApp (coluna jid) é preenchido só pelo serviço da VM, quando a pessoa manda ATIVAR. Pelo
--     site ninguém consegue escrever um endereço ali — só apagar (é o que a tela faz ao trocar o número ou tirar a
--     autorização). Sem isso, quem grava na lista poderia apontar o envio para outro número ou para um grupo.
--
-- O que pode deixar de funcionar (e como testar):
--   1. Entrar com um ADMINISTRADOR (não o +): em Administração → Usuários, a seção "Contatos do WhatsApp" aparece
--      com a lista; adicionar um contato de teste, editar e remover. (A seção só aparece para ele com a versão do
--      site publicada junto com este script.)
--   2. ADMINISTRADOR+: tudo como antes. Editar um contato confirmado e trocar o número: a autorização zera.
--   3. Serviço da VM: não muda (usa a chave de serviço, que não passa por estas regras). O ATIVAR e o SAIR
--      continuam gravando normalmente.
--
-- Como desfazer (volta a ser só o ADMINISTRADOR+):
--   rodar de novo o trecho das regras de supabase/0003_whatsapp_contatos.sql e de 0006_whatsapp_envio.sql, e
--   drop policy if exists whatsapp_contatos_admin on public.whatsapp_contatos;           -- idem nas outras três
--   drop trigger if exists whatsapp_contato_jid_trg on public.whatsapp_contatos;
--   drop function if exists public.whatsapp_contato_protege_jid();

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. Quem lê e grava a lista de contatos
-- ------------------------------------------------------------------------------------------------
drop policy if exists whatsapp_contatos_super on public.whatsapp_contatos;
drop policy if exists whatsapp_contatos_admin on public.whatsapp_contatos;
create policy whatsapp_contatos_admin on public.whatsapp_contatos
  for all to authenticated
  using ((select public.admin_ve_tudo()))
  with check ((select public.admin_ve_tudo()));

drop policy if exists whatsapp_contato_fazendas_super on public.whatsapp_contato_fazendas;
drop policy if exists whatsapp_contato_fazendas_admin on public.whatsapp_contato_fazendas;
create policy whatsapp_contato_fazendas_admin on public.whatsapp_contato_fazendas
  for all to authenticated
  using ((select public.admin_ve_tudo()))
  with check ((select public.admin_ve_tudo()));

-- ------------------------------------------------------------------------------------------------
-- 2. Situação do serviço e registro dos envios: leitura para os mesmos
-- ------------------------------------------------------------------------------------------------
drop policy if exists whatsapp_envios_super on public.whatsapp_envios;
drop policy if exists whatsapp_envios_admin on public.whatsapp_envios;
create policy whatsapp_envios_admin on public.whatsapp_envios
  for select to authenticated
  using ((select public.admin_ve_tudo()));

drop policy if exists whatsapp_estado_super on public.whatsapp_estado;
drop policy if exists whatsapp_estado_admin on public.whatsapp_estado;
create policy whatsapp_estado_admin on public.whatsapp_estado
  for select to authenticated
  using ((select public.admin_ve_tudo()));

-- ------------------------------------------------------------------------------------------------
-- 3. O endereço do WhatsApp (jid) só é escrito pelo serviço da VM
-- ------------------------------------------------------------------------------------------------
-- Pelo site (usuário logado) o jid só pode ser apagado. O serviço usa a chave de serviço: sem usuário logado,
-- passa direto. O SQL Editor também.
create or replace function public.whatsapp_contato_protege_jid()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or new.jid is null then
    return new;
  end if;
  if tg_op = 'INSERT' or new.jid is distinct from old.jid then
    raise exception 'O endereço do WhatsApp é preenchido pelo serviço quando a pessoa manda ATIVAR; pelo site ele só pode ser apagado.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.whatsapp_contato_protege_jid() from public, anon, authenticated;

drop trigger if exists whatsapp_contato_jid_trg on public.whatsapp_contatos;
create trigger whatsapp_contato_jid_trg
  before insert or update on public.whatsapp_contatos
  for each row execute function public.whatsapp_contato_protege_jid();

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- 1) Regras e gatilhos no lugar (esperado: quatro regras "*_admin" com admin_ve_tudo e nenhuma "*_super";
--    gatilhos whatsapp_contato_jid_trg e whatsapp_contato_troca_numero em whatsapp_contatos):
-- select 'regra' as item, tablename || ' / ' || policyname as objeto, cmd || ' | ' || coalesce(qual, with_check) as detalhe
-- from pg_policies where schemaname = 'public' and tablename like 'whatsapp\_%'
-- union all
-- select 'gatilho', tgrelid::regclass::text || ' / ' || tgname, pg_get_triggerdef(oid)
-- from pg_trigger where tgrelid = 'public.whatsapp_contatos'::regclass and not tgisinternal
-- order by 1, 2;
--
-- 2) Quem passa a ver a lista (ADMINISTRADOR+ e administradores sem restrição de fazendas):
-- select nome, perfil, super, todas_fazendas from public.perfis where perfil = 'admin' and (super or todas_fazendas) order by super desc, nome;
