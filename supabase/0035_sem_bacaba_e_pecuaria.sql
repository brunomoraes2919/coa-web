-- COA WEB — a Bacaba sai da plataforma e as três unidades de pecuária entram no menu de fazendas (28/10/2026).
--
-- A Fazenda Bacaba não faz mais parte da empresa: o servidor (VM) deixou de ler qualquer dado dela no PIMS e no SAP
-- (UNIDADES_FORA_DO_COA em modulos/mapas/scripts/sincronizar-plantio.mjs). Este script apaga o que já estava gravado.
-- As unidades de pecuária (PECUARIA LOCKS - DOURADO, - GLOBO e - GUAPIRAMA) têm base no PIMS e depósitos no SAP
-- (empresa SBOPECUARIALOCKS): entram no cadastro de fazendas do COA WEB, e a Validação PIMS casa "Pecuária Dourado"
-- com "PECUARIA LOCKS - DOURADO" pelo nome.
--
-- Este script:
--   1. apaga as linhas da Bacaba nos retratos do PIMS/SAP/ZEUS, nos pedidos, nas metas, nos vínculos e na previsão;
--   2. apaga a fazenda Bacaba do módulo Mapas (os talhões, áreas, mapas de chuva e CAR dela saem junto: ON DELETE
--      CASCADE) e do cadastro do COA WEB (com os talhões do cadastro antigo e o acesso dos usuários a ela);
--   3. cadastra as fazendas "Pecuária Dourado", "Pecuária Globo" e "Pecuária Guapirama" (se ainda não existirem).
-- O histórico de uso (uso_eventos) fica como está: é registro de quem usou o quê.
-- As imagens de mapas de chuva da Bacaba no Storage (bucket mapas-chuva) não são apagadas por SQL.
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada). No fim, a consulta mostra o que
-- sobrou da Bacaba (tudo zero) e as fazendas de pecuária cadastradas.

begin;

set local lock_timeout = '5s';

-- 1. retratos, pedidos e cadastros que guardam a unidade pelo nome -------------------------------------------------
delete from public.acomp_pims               where unidade ilike '%bacaba%';
delete from public.acomp_metas              where unidade ilike '%bacaba%';
delete from public.acomp_metas_historico    where unidade ilike '%bacaba%';
delete from public.acomp_variedade_populacao where unidade ilike '%bacaba%';
delete from public.valid_pims               where unidade ilike '%bacaba%';
delete from public.valid_pedidos            where unidade ilike '%bacaba%';
delete from public.valid_vinculos           where unidade ilike '%bacaba%';
delete from public.controle_equipes         where unidade ilike '%bacaba%';
delete from public.mapas_plantio_pims       where unidade ilike '%bacaba%';
delete from public.chuva_talhao             where unidade ilike '%bacaba%';
delete from public.chuva_limites_zeus       where unidade ilike '%bacaba%';
delete from public.mec_pims_pedidos         where unidade ilike '%bacaba%';
delete from public.mapas_zeus_situacao      where fazenda ilike '%bacaba%';
delete from public.mapas_chuva_pedidos      where fazenda ilike '%bacaba%';
delete from public.prev_previsoes           where unidade ilike '%bacaba%';
delete from public.prev_observado           where unidade ilike '%bacaba%';
delete from public.prev_metricas            where unidade ilike '%bacaba%';

-- 2. a fazenda no módulo Mapas e no cadastro do COA WEB ---------------------------------------------------------------
delete from public.mapas_fazendas where nome ilike '%bacaba%' or unidade_pims ilike '%bacaba%';
delete from public.talhoes where fazenda_id in (select id from public.fazendas where nome ilike '%bacaba%');
delete from public.fazendas where nome ilike '%bacaba%';

-- 3. as unidades de pecuária no menu de fazendas -------------------------------------------------------------------
insert into public.fazendas (nome)
select n from (values ('Pecuária Dourado'), ('Pecuária Globo'), ('Pecuária Guapirama')) as v(n)
where not exists (select 1 from public.fazendas f where lower(f.nome) = lower(v.n));

commit;

-- conferência ---------------------------------------------------------------------------------------------------------
select 'bacaba: linhas que sobraram' as conferencia,
  (select count(*) from public.acomp_pims where unidade ilike '%bacaba%') +
  (select count(*) from public.valid_pims where unidade ilike '%bacaba%') +
  (select count(*) from public.mapas_plantio_pims where unidade ilike '%bacaba%') +
  (select count(*) from public.chuva_talhao where unidade ilike '%bacaba%') +
  (select count(*) from public.mapas_fazendas where nome ilike '%bacaba%' or unidade_pims ilike '%bacaba%') +
  (select count(*) from public.fazendas where nome ilike '%bacaba%') as total
union all
select 'fazendas de pecuária no COA WEB', count(*) from public.fazendas where nome ilike 'pecu%ria %';
