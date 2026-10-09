-- COA WEB — segurança, parte 2 de 5: pedidos ao servidor (PIMS e ZEUS).
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0017 (pode rodar de novo sem estragar nada).
-- Depende de: 0002 (tem_categoria, tem_acesso_fazenda), scripts do Mapas (mapas_eh_usuario, mapas_pode_ver,
-- mapas_plantio_pedidos, mapas_chuva_pedidos), modulos/mecanizadas/supabase/0001 (mec_pims_pedidos) e 0007
-- (valid_pedidos).
--
-- As tabelas de pedido são o único caminho pelo qual um usuário faz o servidor do Google Cloud consultar o
-- PIMS e a ZEUS. Quem decide o que pode ser pedido é a regra de inserção daqui; o servidor repete a mesma
-- conferência antes de consultar (modulos/mapas/scripts/atender-pedidos.mjs: decidirPermissao), como segunda
-- barreira. Se a regra mudar aqui, tem de mudar lá.
--
-- Achados que este script fecha (auditoria de 09/10/2026):
--   * A1 — mec_pims_pedidos: qualquer usuário com UMA fazenda pedia os boletins de atividades mecanizadas (com
--          nome de funcionário) de QUALQUER unidade. Agora: precisa da categoria Mecanizadas e a unidade pedida
--          tem que ser a de uma fazenda liberada para ele.
--   * A2 — mapas_chuva_pedidos: o mesmo com a chuva da ZEUS de qualquer fazenda. Agora: precisa da categoria
--          Mapas e a fazenda pedida tem que ser uma fazenda de mapa que ele vê.
--   * B2 — mapas_plantio_pedidos: todo usuário via os pedidos de todos. Agora cada um vê os seus. (As telas só
--          acompanham o próprio pedido, pelo id: acompanhamento/app.js "atualizar" e
--          modulos/mapas/src/data/supabasePedidos.ts "situacaoPedidoPlantio".)
--   * B2 — nenhuma das quatro filas tinha limite: um usuário podia gravar milhares de pedidos e travar a fila
--          de todos. Agora: no máximo 30 pedidos por hora e 5 aguardando resposta, por usuário e por tabela.
--
-- Como a unidade do PIMS é conferida (A1) — e por que não pelo cadastro do Mapas:
--   O pedido de Mecanizadas usa o nome CURTO da unidade no PIMS (DA_UNI_ADM: 'T. FLECHAS'), o mesmo do
--   relatório exportado. mapas_fazendas.unidade_pims guarda o nome LONGO (DE_UNI_ADM: 'TRES FLECHAS') e só
--   existe para fazenda que tem mapa cadastrado; os scripts não têm a tabela que liga um nome ao outro. Por
--   isso a regra repete, no banco, exatamente a função unidadePimsDaFazenda() do index.html, aplicada ao nome
--   da fazenda do COA WEB (tabela fazendas): o site só consegue montar pedidos que essa mesma regra aceita.
--   ATENÇÃO: unidade nova tem que entrar nos DOIS lugares (index.html e mec_unidade_da_fazenda, abaixo).
--
-- O que pode deixar de funcionar (e como testar):
--   1. Mecanizadas → Importar Boletim → "Buscar direto no PIMS": testar com um colaborador de cada fazenda.
--      Quem não tem a categoria Mecanizadas marcada em Usuários passa a receber "Sem permissão para buscar no
--      PIMS" (a tela já mostra essa mensagem para recusa do banco).
--   2. Mapas → Novo mapa → "Inserir dados via integração": testar com um colaborador. Exige a categoria Mapas e
--      que o nome enviado seja o da fazenda de mapa (é o que a tela envia: NovoMapa.tsx → fazenda.nome).
--   3. "Atualizar" do Operacional, do Mapas e da Validação: clicar e conferir que termina. Quem clicar mais de
--      30 vezes em uma hora, ou tiver 5 pedidos ainda sem resposta (servidor parado), recebe a mensagem de
--      limite. Nas telas de Mecanizadas, Mapas e Validação essa mensagem aparece como "Não foi possível …
--      (código P0001). Tente de novo em instantes."; no Operacional aparece o texto inteiro.
--
-- Como desfazer:
--   rodar de novo modulos/mecanizadas/supabase/0001_pedidos_mecanizadas.sql, modulos/mapas/supabase/coa-web/
--   0002_pedidos_plantio.sql e 0003_pedidos_chuva.sql (recriam as regras antigas), e:
--   drop trigger if exists pedidos_limite_trg on public.mapas_plantio_pedidos;   -- idem nas outras três
--   drop function if exists public.pedidos_limitar();
--   drop function if exists public.mec_pode_pedir(text);
--   drop function if exists public.mec_unidade_da_fazenda(text);

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. Mecanizadas (A1)
-- ------------------------------------------------------------------------------------------------

-- Nome da fazenda do COA WEB → unidade do PIMS como aparece no relatório. Cópia fiel de
-- unidadePimsDaFazenda() + normalizarTextoMec() do index.html: maiúsculas, sem acento, "°ºª" viram "O",
-- espaços repetidos viram um, e a mesma ordem de testes.
create or replace function public.mec_unidade_da_fazenda(p_nome text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when strpos(x.n, 'NEBRASKA')  > 0 then 'NEBRASKA'
    when strpos(x.n, 'GLOBO')     > 0 then 'GLOBO'
    when strpos(x.n, 'GUAPIRAMA') > 0 then 'GUAPIRAMA'
    when strpos(x.n, 'SIRIEMA')   > 0 then 'SIRIEMA'
    when strpos(x.n, 'DOURADO')   > 0 then 'DOURADO'
    when strpos(x.n, 'SM3')       > 0 then 'SM3'
    when strpos(x.n, 'TRES FLECHAS') > 0 or strpos(x.n, 'T. FLECHAS') > 0 then 'T. FLECHAS'
    else null
  end
  from (
    select btrim(regexp_replace(
      upper(translate(coalesce(p_nome, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ°ºª',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUCOOO')),
      '\s+', ' ', 'g')) as n
  ) x;
$$;

-- Quem está logado pode pedir os boletins desta unidade? Categoria Mecanizadas + alguma fazenda liberada para
-- ele (tem_acesso_fazenda: administrador sem restrição vê todas) cujo nome leva a esta unidade.
create or replace function public.mec_pode_pedir(p_unidade text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tem_categoria('mecanizadas')
     and exists (
       select 1
       from public.fazendas f
       where public.tem_acesso_fazenda(f.id)
         and public.mec_unidade_da_fazenda(f.nome::text) = p_unidade
     );
$$;

revoke all on function public.mec_unidade_da_fazenda(text) from public, anon;
revoke all on function public.mec_pode_pedir(text) from public, anon;
grant execute on function public.mec_unidade_da_fazenda(text) to authenticated;
grant execute on function public.mec_pode_pedir(text) to authenticated;

drop policy if exists mec_pims_pedidos_insert on public.mec_pims_pedidos;
create policy mec_pims_pedidos_insert on public.mec_pims_pedidos
  for insert to authenticated
  with check (
    (select public.mapas_eh_usuario())
    and pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
    and dados is null
    and public.mec_pode_pedir(unidade)
  );

-- ------------------------------------------------------------------------------------------------
-- 2. Chuva da ZEUS por PIC (A2)
-- ------------------------------------------------------------------------------------------------
-- O site envia o nome da fazenda de mapa, aparado e cortado em 80 caracteres (supabasePedidos.ts:
-- fazenda.trim().slice(0, 80)); o servidor acha a fazenda da ZEUS por esse nome. A regra exige que exista uma
-- fazenda de mapa com esse nome que o usuário possa ver.
drop policy if exists mapas_chuva_pedidos_insert on public.mapas_chuva_pedidos;
create policy mapas_chuva_pedidos_insert on public.mapas_chuva_pedidos
  for insert to authenticated
  with check (
    (select public.mapas_eh_usuario())
    and (select public.tem_categoria('mapas'))
    and pedido_por = auth.uid()
    and atendido_em is null
    and resultado is null
    and dados is null
    and exists (
      select 1
      from public.mapas_fazendas f
      where left(regexp_replace(f.nome, '^\s+|\s+$', '', 'g'), 80) = mapas_chuva_pedidos.fazenda
        and public.mapas_pode_ver(f.coa_fazenda_id)
    )
  );

-- ------------------------------------------------------------------------------------------------
-- 3. Pedidos de "Atualizar plantio": cada um vê os seus (B2)
-- ------------------------------------------------------------------------------------------------
drop policy if exists mapas_plantio_pedidos_select on public.mapas_plantio_pedidos;
create policy mapas_plantio_pedidos_select on public.mapas_plantio_pedidos
  for select to authenticated
  using ((select public.mapas_eh_usuario()) and pedido_por = auth.uid());

-- ------------------------------------------------------------------------------------------------
-- 4. Limite de pedidos por usuário, nas quatro filas (B2)
-- ------------------------------------------------------------------------------------------------
-- As telas gravam UM pedido por clique e desligam o botão até a resposta (1 a 2,5 minutos de espera no
-- máximo), então o uso normal fica muito abaixo de 30 por hora. O gatilho roda antes da regra de inserção.
--   * chave de serviço e SQL Editor (sem usuário logado) não têm limite;
--   * pedido_em é sempre a hora do banco (o cliente não escolhe, senão escaparia da contagem por hora);
--   * pedido pendente há mais de um dia não conta (servidor parado não deixa ninguém travado para sempre).
create or replace function public.pedidos_limitar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eu uuid := auth.uid();
  v_na_hora integer;
  v_pendentes integer;
  c_max_por_hora constant integer := 30;
  c_max_pendentes constant integer := 5;
begin
  if eu is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  new.pedido_em := now();

  execute format(
    'select count(*) filter (where pedido_em > now() - interval ''1 hour''),
            count(*) filter (where atendido_em is null and pedido_em > now() - interval ''1 day'')
       from public.%I where pedido_por = $1', tg_table_name)
    into v_na_hora, v_pendentes
    using eu;

  if v_pendentes >= c_max_pendentes then
    raise exception 'Você já tem % pedidos aguardando o servidor. Espere a resposta antes de pedir de novo.', v_pendentes;
  end if;
  if v_na_hora >= c_max_por_hora then
    raise exception 'Muitos pedidos na última hora (o limite é %). Tente de novo mais tarde.', c_max_por_hora;
  end if;
  return new;
end;
$$;

revoke all on function public.pedidos_limitar() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['mapas_plantio_pedidos', 'mapas_chuva_pedidos', 'mec_pims_pedidos', 'valid_pedidos'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabela % não existe neste banco: sem limite de pedidos nela.', t;
    else
      execute format('drop trigger if exists pedidos_limite_trg on public.%I', t);
      execute format(
        'create trigger pedidos_limite_trg before insert on public.%I for each row execute function public.pedidos_limitar()', t);
    end if;
  end loop;
end;
$$;

commit;

-- =================================================================================================
-- Conferência (só leitura): rodar depois.
-- =================================================================================================
-- 1) Toda fazenda do COA WEB e a unidade do PIMS que o banco entende para ela. Fazenda de onde se pede
--    boletim tem que aparecer com a unidade certa (a mesma que o site mostra); null = "ainda não ligada".
-- select f.id, f.nome, public.mec_unidade_da_fazenda(f.nome::text) as unidade_pims from public.fazendas f order by f.nome;
--
-- 2) Fazendas de mapa com o mesmo nome (o pedido de chuva é pelo nome; o esperado é não voltar nada):
-- select left(regexp_replace(nome, '^\s+|\s+$', '', 'g'), 80) as nome, count(*) from public.mapas_fazendas group by 1 having count(*) > 1;
--
-- 3) Regras e gatilhos no lugar:
-- select 'regra' as item, tablename || ' / ' || policyname as objeto, cmd || ' | ' || coalesce(qual, with_check) as detalhe
-- from pg_policies
-- where schemaname = 'public' and tablename in ('mec_pims_pedidos', 'mapas_chuva_pedidos', 'mapas_plantio_pedidos', 'valid_pedidos')
-- union all
-- select 'gatilho', tgrelid::regclass::text || ' / ' || tgname, pg_get_triggerdef(oid)
-- from pg_trigger where tgname = 'pedidos_limite_trg' and not tgisinternal
-- order by 1, 2;
--
-- 4) Uso real das filas (para conferir que 30 por hora está longe do uso normal):
-- select 'mapas_plantio_pedidos' as fila, pedido_por, date_trunc('hour', pedido_em) as hora, count(*) from public.mapas_plantio_pedidos group by 1, 2, 3 having count(*) > 5
-- union all select 'mapas_chuva_pedidos', pedido_por, date_trunc('hour', pedido_em), count(*) from public.mapas_chuva_pedidos group by 1, 2, 3 having count(*) > 5
-- union all select 'mec_pims_pedidos', pedido_por, date_trunc('hour', pedido_em), count(*) from public.mec_pims_pedidos group by 1, 2, 3 having count(*) > 5
-- union all select 'valid_pedidos', pedido_por, date_trunc('hour', pedido_em), count(*) from public.valid_pedidos group by 1, 2, 3 having count(*) > 5;
