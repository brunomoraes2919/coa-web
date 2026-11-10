-- COA WEB — quem tem a fazenda liberada vê a unidade do PIMS dela, mesmo sem fazenda de mapa (10/11/2026).
--
-- O problema: acomp_pode_ver_unidade (a regra de leitura da Validação PIMS, do Acompanhamento e dos outros retratos
-- do PIMS por unidade) só achava a unidade pela fazenda de MAPA (mapas_fazendas.unidade_pims). As fazendas de pecuária
-- (0035) estão só no cadastro do COA WEB, sem fazenda de mapa: o administrador que vê tudo via a "PECUARIA LOCKS -
-- DOURADO", mas o colaborador com a "Pecuária Dourado" liberada não via nenhuma linha dela (nem os depósitos).
--
-- A correção: a regra passa a aceitar também a fazenda do COA WEB liberada ao usuário cujo nome é o da unidade, pela
-- mesma comparação que a tela já usa (validacao/logica.js, unidadeDaFazenda): sem acento, maiúsculas, sem "FAZENDA"
-- na frente, sem a palavra LOCKS e sem traços ("Pecuária Dourado" = "PECUARIA LOCKS - DOURADO"). O caminho pela fazenda
-- de mapa continua igual. Ninguém passa a ver uma unidade de fazenda que não tem liberada.
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).

begin;

set local lock_timeout = '5s';

create or replace function public.nome_de_unidade(p_nome text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    upper(translate(coalesce(p_nome, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
    '^\s*(FAZENDA|FAZ\.?)\s+', ''),
    '\mLOCKS\M', ' ', 'g'),
    '[-–]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

create or replace function public.acomp_pode_ver_unidade(p_unidade text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_ve_tudo()
      or exists (
        select 1
        from public.mapas_fazendas f
        where upper(f.unidade_pims) = upper(p_unidade)
          and public.mapas_pode_ver(f.coa_fazenda_id)
      )
      or exists (
        select 1
        from public.fazendas c
        where public.nome_de_unidade(c.nome) = public.nome_de_unidade(p_unidade)
          and public.nome_de_unidade(p_unidade) <> ''
          and public.mapas_pode_ver(c.id)
      );
$$;

commit;

-- Conferência: cada unidade da Validação PIMS e a fazenda do COA WEB que agora casa com ela pelo nome
select v.unidade, string_agg(c.nome, ', ') as fazenda_do_coa
from public.valid_pims v
left join public.fazendas c on public.nome_de_unidade(c.nome) = public.nome_de_unidade(v.unidade)
group by v.unidade
order by v.unidade;
