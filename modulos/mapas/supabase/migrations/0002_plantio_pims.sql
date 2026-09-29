-- Mapa de Chuva COA — plantio automático do PIMS + cadastro padrão (modo Supabase)
--
-- Rode DEPOIS da 0001_init.sql (SQL Editor do Supabase → cole e execute).
-- Idempotente: pode ser reexecutada sem erro ("add column if not exists", "create table/index
-- if not exists", policies recriadas via drop if exists + create). Os dados existentes são mantidos:
-- as colunas novas ficam nulas e os plantios antigos passam a valer como origem 'manual' e
-- status 'plantado' (defaults abaixo), exatamente como o app os lê.

-- =================================================================================
-- Colunas novas
-- =================================================================================

-- Unidade (fazenda) no PIMS, ex.: 'SIRIEMA', e coluna do shape com o código do talhão (CD_UPNIVEL3).
alter table public.fazendas
  add column if not exists unidade_pims text,
  add column if not exists campo_codigo text;

-- Código do talhão normalizado (ver src/lib/codigoTalhao.ts), ex.: '039B', '02PIVO'.
alter table public.talhoes
  add column if not exists codigo text;

-- Nome da safra no PIMS (PERIODOSAFRA.DE_PER_SAFRA), ex.: 'SOJA 26/27'; nulo = usa o nome.
alter table public.safras
  add column if not exists nome_pims text;

-- Situação do talhão na safra (origem manual ou PIMS) e dados do plantio.
alter table public.plantios
  add column if not exists origem        text not null default 'manual',
  add column if not exists status        text not null default 'plantado',
  add column if not exists area_prevista numeric,
  add column if not exists area_plantada numeric,
  add column if not exists inicio        date,
  add column if not exists fim           date,
  add column if not exists variedade     text;

-- Valores aceitos (recriados para manter a idempotência).
alter table public.plantios drop constraint if exists plantios_origem_check;
alter table public.plantios add constraint plantios_origem_check check (origem in ('manual', 'pims'));
alter table public.plantios drop constraint if exists plantios_status_check;
alter table public.plantios add constraint plantios_status_check check (status in ('plantado', 'plantando', 'a_plantar'));

-- =================================================================================
-- Áreas da cultura (shape da cultura por safra × fazenda, ex.: soja 26/27)
-- =================================================================================

create table if not exists public.areas_cultura (
  id         uuid primary key,
  safra_id   uuid not null references public.safras (id) on delete cascade,
  fazenda_id uuid not null references public.fazendas (id) on delete cascade,
  -- código normalizado do talhão ('' quando o shape não tem código)
  codigo     text not null default '',
  area_ha    double precision not null,
  -- GeoJSON (Polygon ou MultiPolygon) em WGS84 (lon, lat)
  geom       jsonb not null
);

create index if not exists areas_cultura_safra_fazenda_idx on public.areas_cultura (safra_id, fazenda_id);
create index if not exists areas_cultura_fazenda_id_idx on public.areas_cultura (fazenda_id);
create index if not exists talhoes_fazenda_codigo_idx on public.talhoes (fazenda_id, codigo);

-- =================================================================================
-- RLS e privilégios: iguais às demais tabelas (qualquer autenticado lê e escreve; anon nada).
-- =================================================================================

alter table public.areas_cultura enable row level security;

drop policy if exists areas_cultura_authenticated_all on public.areas_cultura;
create policy areas_cultura_authenticated_all on public.areas_cultura
  for all to authenticated using (true) with check (true);

revoke all on table public.areas_cultura from anon;
grant select, insert, update, delete on table public.areas_cultura to authenticated;
