-- COA WEB — segurança, parte 4 de 5: a categoria passa a valer também no banco.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0019 (pode rodar de novo sem estragar nada).
-- Depende de: 0001 e 0002 (usuario_categorias, is_super, tem_categoria), scripts do Mapas e do Acompanhamento.
--
-- Até aqui a categoria (Usuários → Categorias) só decidia quais cartões o site mostrava: quem tinha a fazenda
-- liberada lia os dados de qualquer módulo pelo navegador (DevTools), com ou sem a categoria. Só a Validação
-- PIMS, a Chuva por talhão e o Controle Técnico conferiam a categoria no banco.
--
-- Achado que este script fecha (auditoria de 09/10/2026):
--   * M6 — Operacional (acomp_*), Mapas (mapas_*) e Algodão (talhoes, variedades, safras) passam a exigir a
--          categoria, além da fazenda. (Mecanizadas e o pedido de chuva já exigem desde o 0018.)
--
-- Como foi feito: regras RESTRITIVAS, com nome "<tabela>_categoria". Regra restritiva soma-se com "E" às
-- regras que já existem: nada do que já é exigido (fazenda, administrador...) muda; só entra mais uma
-- condição. Por isso não foi preciso mexer em nenhuma regra antiga, e desfazer é só apagar as novas.
--
-- Quem tem a categoria, para o banco (função tem_categoria, do 0002): o ADMINISTRADOR+ tem todas; todos os
-- outros — INCLUSIVE o administrador comum — só as marcadas em Usuários (tabela usuario_categorias). É a mesma
-- regra que o site já usa para mostrar os cartões (index.html: podeCategoria).
--
-- Chaves das categorias (index.html: CATEGORIAS; e a lista aceita pela tabela, 0015):
--   algodao, mecanizadas, mapas, acompanhamento (Operacional), sat, previsao, chuva, validacao, controle.
--
-- Quem lê cada tabela (levantado nos arquivos do site em 09/10/2026) → categorias aceitas:
--   acomp_pims, acomp_metas, acomp_metas_historico .... acompanhamento   (acompanhamento/app.js)
--   mapas_fazendas .... mapas, acompanhamento, chuva, previsao, sat, validacao
--                       (módulo Mapas; acompanhamento/app.js; chuva/app.js; previsao/app.js;
--                        modulos/sat/src/dados/cadastro.ts; validacao/app.js)
--   mapas_talhoes ..... mapas, acompanhamento, chuva, previsao, sat
--   mapas_safras ...... mapas, acompanhamento, chuva
--   mapas_areas_cultura mapas, acompanhamento, chuva
--   mapas_plantios, mapas_chuva, mapas_plantio_pims, mapas_chuva_pedidos, mapas_zeus_situacao .... mapas
--   mapas_plantio_pedidos .... mapas, acompanhamento   (o botão "Atualizar" dos dois módulos)
--   arquivos do bucket mapas-chuva .... mapas
--   talhoes, variedades, safras .... algodao   (index.html: só as telas do Algodão usam essas listas)
--   fazendas, perfis, usuario_fazendas, usuario_categorias .... SEM categoria (o menu lateral e a página
--                       Usuários usam em qualquer categoria)
-- Nas tabelas de cadastro lidas por vários módulos a regra vale só para LEITURA (quem grava continua sendo o
-- administrador, pelas regras do 0019). Nas tabelas de um módulo só, vale para ler e gravar.
--
-- O que pode deixar de funcionar (e como testar):
--   1. Usuário que usava um módulo SEM ter a categoria marcada não existe pelo site (o cartão não aparece), mas
--      se alguém abria uma tela por endereço direto, passa a ver a tela vazia.
--   2. A tela inicial carrega fazendas, variedades, safras e talhões para TODO usuário (index.html,
--      recarregarTudoDoSupabase). Quem não tem a categoria Algodão passa a receber as três listas VAZIAS — sem
--      erro: o banco apenas não devolve linhas, e a tela já trata lista vazia ("|| []"). Teste: entrar com um
--      usuário sem Algodão (por exemplo um coordenador) e abrir a categoria dele.
--   3. Administrador comum sem a categoria Operacional/Mapas/Algodão marcada deixa de ler esses dados. Antes de
--      rodar, veja a consulta 2 do fim do arquivo: ela lista quem tem fazenda mas não tem a categoria.
--   4. Teste rápido por módulo, com um colaborador que tem a categoria: Operacional (painel e salvar uma meta),
--      Mapas (abrir um mapa salvo e a imagem dele), Chuva por talhão, Previsão do Tempo, Locks SAT (mapa com os
--      limites) e Algodão (lista de talhões e alterar um campo).
--
-- Como desfazer (uma linha por regra; ou só as do módulo que deu problema):
--   drop policy if exists acomp_pims_categoria on public.acomp_pims;      -- e assim por diante: o nome é sempre
--   "<tabela>_categoria". No bucket: drop policy if exists mapas_chuva_storage_categoria on storage.objects;
--   drop function if exists public.tem_alguma_categoria(text[]);          -- só depois de apagar as regras

begin;

set local lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------
-- 1. Quem está logado tem pelo menos uma destas categorias?
-- ------------------------------------------------------------------------------------------------
create or replace function public.tem_alguma_categoria(p_categorias text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super() or exists (
    select 1 from public.usuario_categorias uc
    where uc.usuario_id = auth.uid() and uc.categoria = any (p_categorias)
  );
$$;

revoke all on function public.tem_alguma_categoria(text[]) from public, anon;
grant execute on function public.tem_alguma_categoria(text[]) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 2. Uma regra restritiva por tabela
-- ------------------------------------------------------------------------------------------------
-- comando 'select' = só leitura (tabela lida por vários módulos); 'all' = ler e gravar (tabela de um módulo).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- Operacional
      ('acomp_pims',            'all',    array['acompanhamento']),
      ('acomp_metas',           'all',    array['acompanhamento']),
      ('acomp_metas_historico', 'all',    array['acompanhamento']),
      -- cadastro do Mapas, lido por vários módulos
      ('mapas_fazendas',        'select', array['mapas', 'acompanhamento', 'chuva', 'previsao', 'sat', 'validacao']),
      ('mapas_talhoes',         'select', array['mapas', 'acompanhamento', 'chuva', 'previsao', 'sat']),
      ('mapas_safras',          'select', array['mapas', 'acompanhamento', 'chuva']),
      ('mapas_areas_cultura',   'select', array['mapas', 'acompanhamento', 'chuva']),
      -- só o módulo Mapas
      ('mapas_plantios',        'all',    array['mapas']),
      ('mapas_chuva',           'all',    array['mapas']),
      ('mapas_plantio_pims',    'all',    array['mapas']),
      ('mapas_chuva_pedidos',   'all',    array['mapas']),
      ('mapas_zeus_situacao',   'all',    array['mapas']),
      -- botão "Atualizar" do Mapas e do Operacional
      ('mapas_plantio_pedidos', 'all',    array['mapas', 'acompanhamento']),
      -- Algodão
      ('talhoes',               'all',    array['algodao']),
      ('variedades',            'all',    array['algodao']),
      ('safras',                'all',    array['algodao'])
    ) as t (tabela, comando, categorias)
  loop
    if to_regclass('public.' || r.tabela) is null then
      raise notice 'Tabela % não existe neste banco: pulada.', r.tabela;
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', r.tabela || '_categoria', r.tabela);
    execute format(
      'create policy %I on public.%I as restrictive for %s to authenticated
         using ((select public.tem_alguma_categoria(%L::text[])))',
      r.tabela || '_categoria', r.tabela, r.comando, r.categorias);
  end loop;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- 3. Imagens dos mapas salvos (bucket mapas-chuva): categoria Mapas
-- ------------------------------------------------------------------------------------------------
-- storage.objects é uma tabela só para todos os buckets: a condição "bucket_id <> 'mapas-chuva' or ..." faz a
-- regra não valer para nenhum outro bucket que venha a existir.
drop policy if exists mapas_chuva_storage_categoria on storage.objects;
create policy mapas_chuva_storage_categoria on storage.objects
  as restrictive
  for all to authenticated
  using (bucket_id <> 'mapas-chuva' or (select public.tem_categoria('mapas')))
  with check (bucket_id <> 'mapas-chuva' or (select public.tem_categoria('mapas')));

commit;

-- =================================================================================================
-- Conferência (só leitura).
-- =================================================================================================
-- 1) Depois de rodar: as regras restritivas no lugar (esperado: 16 linhas "<tabela>_categoria" em public,
--    1 em storage e as 2 "*_so_usuario_do_coa" do 0017).
-- select schemaname, tablename, policyname, cmd, qual
-- from pg_policies
-- where permissive = 'RESTRICTIVE' and (policyname like '%\_categoria' or policyname like '%\_so\_usuario\_do\_coa')
-- order by 1, 2, 3;
--
-- 2) ANTES de rodar: quem usa o COA WEB (administrador, ou colaborador com fazenda) e NÃO tem a categoria.
--    Cada linha é alguém que deixa de ler aquele módulo pelo banco. Pelo site essa pessoa já não vê o cartão;
--    se alguma delas deveria ver, marque a categoria em Usuários antes de rodar.
-- select p.nome, p.email, p.perfil, c.categoria as categoria_que_falta
-- from public.perfis p
-- cross join (values ('algodao'), ('mapas'), ('acompanhamento')) as c (categoria)
-- where not p.super
--   and (p.perfil = 'admin' or exists (select 1 from public.usuario_fazendas uf where uf.usuario_id = p.id))
--   and not exists (select 1 from public.usuario_categorias uc where uc.usuario_id = p.id and uc.categoria = c.categoria)
-- order by 4, 1;
--
-- 3) Categorias gravadas que o site não conhece (esperado: nenhuma):
-- select categoria, count(*) from public.usuario_categorias
-- where categoria not in ('algodao','mecanizadas','mapas','acompanhamento','sat','previsao','chuva','validacao','controle')
-- group by 1;
