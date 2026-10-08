-- COA WEB — "Chuva por talhão" vira categoria própria (chave 'chuva'), em vez de página da categoria Mapas.
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0014 (pode rodar de novo sem estragar nada).
-- Muda só duas coisas: a lista de categorias aceitas ganha 'chuva', e a leitura de chuva_talhao passa a
-- pedir essa categoria (antes pedia 'mapas'). Administradores continuam vendo tudo; para os colaboradores,
-- a categoria é liberada na página Usuários.

begin;

set local lock_timeout = '5s';

alter table public.usuario_categorias drop constraint if exists usuario_categorias_categoria_check;
alter table public.usuario_categorias add constraint usuario_categorias_categoria_check
  check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat', 'previsao', 'validacao', 'controle', 'chuva'));

-- vê quem tem a categoria Chuva por talhão e pode ver a fazenda (administradores veem todas; os demais, as liberadas)
drop policy if exists chuva_talhao_select on public.chuva_talhao;
create policy chuva_talhao_select on public.chuva_talhao
  for select to authenticated
  using ((select public.tem_categoria('chuva')) and public.acomp_pode_ver_unidade(unidade));

commit;
