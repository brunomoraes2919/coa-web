-- COA WEB — sementes por metro e população: o cadastro passa para o módulo Mapas (mapa de variedade).
-- A tabela acomp_variedade_populacao (0028) era só da categoria Operacional. O cadastro agora fica na seção
-- "2. Variedades" do mapa de variedade e os valores saem na legenda do mapa e na Revista do Operacional, então a
-- regra restritiva por categoria passa a aceitar Mapas ou Operacional. O resto continua igual: lê e grava quem
-- enxerga a fazenda (acomp_pode_ver_unidade).
-- Rodar UMA vez no SQL Editor do Supabase, depois do 0028 (pode rodar de novo sem estragar nada).

begin;

set local lock_timeout = '5s';

drop policy if exists acomp_variedade_populacao_categoria on public.acomp_variedade_populacao;
create policy acomp_variedade_populacao_categoria on public.acomp_variedade_populacao
  as restrictive for all to authenticated
  using ((select public.tem_alguma_categoria(array['mapas', 'acompanhamento']::text[])))
  with check ((select public.tem_alguma_categoria(array['mapas', 'acompanhamento']::text[])));

commit;

-- Conferência (rodar depois, opcional):
-- select policyname, qual from pg_policies where tablename = 'acomp_variedade_populacao' and permissive = 'RESTRICTIVE';
