-- COA WEB — Mapas: "Mapa de dias sem chuva" (03/11/2026).
--
-- A tela nova (Mapas → Mapa de dias sem chuva) pede ao servidor (VM) a chuva diária de cada talhão da fazenda só no
-- período filtrado, e só quando o usuário clica em Atualizar. O pedido usa a mesma fila do "Inserir dados via
-- integração" (mapas_chuva_pedidos), com as mesmas regras de acesso e o mesmo limite de pedidos por hora; muda só o tipo:
--   1. mapas_chuva_pedidos ganha `tipo`: 'pics' (o de sempre: chuva por PIC) ou 'talhoes' (chuva por talhão do período);
--      os pedidos que já existem ficam 'pics';
--   2. mapas_chuva (o histórico) passa a aceitar o tipo 'seca' (mapa de dias sem chuva salvo).
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).

begin;

set local lock_timeout = '5s';

alter table public.mapas_chuva_pedidos add column if not exists tipo text not null default 'pics';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mapas_chuva_pedidos_tipo_valido') then
    alter table public.mapas_chuva_pedidos add constraint mapas_chuva_pedidos_tipo_valido check (tipo in ('pics', 'talhoes'));
  end if;
end;
$$;

alter table public.mapas_chuva drop constraint if exists mapas_chuva_tipo_valido;
alter table public.mapas_chuva add constraint mapas_chuva_tipo_valido check (tipo in ('chuva', 'variedade', 'seca'));

commit;

-- Conferência: as duas regras novas
select conname, pg_get_constraintdef(oid) as regra
from pg_constraint
where conname in ('mapas_chuva_pedidos_tipo_valido', 'mapas_chuva_tipo_valido')
order by conname;
