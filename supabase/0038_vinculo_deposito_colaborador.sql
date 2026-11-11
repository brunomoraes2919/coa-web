-- COA WEB — Validação PIMS: o colaborador também vincula o depósito de cada coordenador (11/11/2026).
--
-- Até aqui só o administrador gravava em valid_vinculos (0019: mapas_eh_admin). Agora grava quem tem a categoria
-- Validação PIMS e vê a unidade (acomp_pode_ver_unidade: administrador que vê tudo, ou fazenda liberada ao usuário),
-- a mesma regra da leitura. Quem só tem o Controle Técnico continua sem poder mudar. O carimbo de quem mudou e quando
-- (valid_vinculos_carimbar) continua valendo.
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).

begin;

set local lock_timeout = '5s';

drop policy if exists valid_vinculos_insert on public.valid_vinculos;
create policy valid_vinculos_insert on public.valid_vinculos
  for insert to authenticated
  with check ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

drop policy if exists valid_vinculos_update on public.valid_vinculos;
create policy valid_vinculos_update on public.valid_vinculos
  for update to authenticated
  using ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade))
  with check ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

drop policy if exists valid_vinculos_delete on public.valid_vinculos;
create policy valid_vinculos_delete on public.valid_vinculos
  for delete to authenticated
  using ((select public.tem_categoria('validacao')) and public.acomp_pode_ver_unidade(unidade));

commit;

-- Conferência: as regras de valid_vinculos
select policyname, cmd, coalesce(qual, '') as usando, coalesce(with_check, '') as conferindo
from pg_policies
where schemaname = 'public' and tablename = 'valid_vinculos'
order by policyname;
