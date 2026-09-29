-- Mapa de Chuva COA — schema inicial (modo Supabase)
--
-- ATENÇÃO (segurança) — faça isto logo depois de rodar o script:
--   Authentication → Sign In / Providers → desative "Allow new users to sign up"
--   (em painéis mais antigos: Authentication → Providers → Email).
-- As regras abaixo liberam os dados para QUALQUER usuário autenticado. Com o cadastro público
-- ligado, qualquer pessoa com a URL e a chave anon (que ficam no site publicado) poderia criar uma
-- conta e ler, alterar ou apagar tudo. Com ele desligado, só entram os usuários que o administrador
-- criar em Authentication → Users → Add user.
--
-- Idempotente: pode ser reexecutada sem erro (create table/index "if not exists",
-- policies recriadas via drop if exists + create). Os ids são gerados no cliente
-- (uuid em texto), por isso não precisamos de gen_random_uuid()/pgcrypto aqui.

-- =================================================================================
-- Tabelas
-- =================================================================================

-- Fazendas cadastradas (uma por talhão-shape importado).
create table if not exists public.fazendas (
  id          uuid primary key,
  nome        text not null,
  -- coluna do shapefile usada como nome (rótulo) do talhão
  campo_nome  text not null,
  -- coluna do shapefile usada como setor (opcional)
  campo_setor text,
  -- colunas de atributos disponíveis no shape original
  colunas     jsonb not null default '[]'::jsonb,
  criado_em   timestamptz not null default now()
);

-- Talhões de cada fazenda (geometria em GeoJSON WGS84).
create table if not exists public.talhoes (
  id         uuid primary key,
  fazenda_id uuid not null references public.fazendas (id) on delete cascade,
  nome       text not null,
  setor      text,
  area_ha    double precision not null,
  -- GeoJSON (Polygon ou MultiPolygon) em WGS84 (lon, lat)
  geom       jsonb not null,
  -- demais atributos do shapefile (não estruturados)
  atributos  jsonb not null default '{}'::jsonb
);

-- Safras (períodos de cultivo), ex.: "SOJA 26/27".
create table if not exists public.safras (
  id        uuid primary key,
  nome      text not null,
  cultura   text not null,
  -- ex.: "26/27"
  ano_safra text not null,
  inicio    date not null,
  fim       date not null
);

-- Talhões marcados como plantados em uma safra (PK composta = não duplica).
create table if not exists public.plantios (
  safra_id     uuid not null references public.safras (id) on delete cascade,
  talhao_id    uuid not null references public.talhoes (id) on delete cascade,
  data_plantio date,
  primary key (safra_id, talhao_id)
);

-- Mapas de chuva gerados e salvos (PNG/miniatura ficam no storage, bucket "mapas").
create table if not exists public.mapas (
  id             uuid primary key,
  fazenda_id     uuid not null references public.fazendas (id) on delete cascade,
  -- a safra pode ser excluída sem apagar o histórico do mapa
  safra_id       uuid references public.safras (id) on delete set null,
  titulo         text not null,
  periodo_inicio date,
  periodo_fim    date,
  -- campos do layout, paleta e parâmetros do IDW
  config         jsonb not null,
  -- PICs usados na geração (datas Date -> string ISO; ver src/data/supabaseRepo.ts)
  pics           jsonb not null default '[]'::jsonb,
  -- estatísticas (geral, plantado, por talhão)
  resumo         jsonb not null,
  png_path       text,
  thumb_path     text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid()
);

-- =================================================================================
-- Índices (consultas mais comuns do app: por fazenda e por safra)
-- =================================================================================

create index if not exists talhoes_fazenda_id_idx on public.talhoes (fazenda_id);
create index if not exists plantios_safra_id_idx on public.plantios (safra_id);
create index if not exists plantios_talhao_id_idx on public.plantios (talhao_id);
create index if not exists mapas_fazenda_id_idx on public.mapas (fazenda_id);
create index if not exists mapas_safra_id_idx on public.mapas (safra_id);
create index if not exists mapas_criado_em_idx on public.mapas (criado_em desc);

-- =================================================================================
-- RLS: qualquer usuário autenticado lê e escreve tudo; anônimo não acessa nada.
-- (app de uso interno da equipe do COA, sem permissões por fazenda por enquanto)
-- =================================================================================

alter table public.fazendas enable row level security;
alter table public.talhoes  enable row level security;
alter table public.safras   enable row level security;
alter table public.plantios enable row level security;
alter table public.mapas    enable row level security;

drop policy if exists fazendas_authenticated_all on public.fazendas;
create policy fazendas_authenticated_all on public.fazendas
  for all to authenticated using (true) with check (true);

drop policy if exists talhoes_authenticated_all on public.talhoes;
create policy talhoes_authenticated_all on public.talhoes
  for all to authenticated using (true) with check (true);

drop policy if exists safras_authenticated_all on public.safras;
create policy safras_authenticated_all on public.safras
  for all to authenticated using (true) with check (true);

drop policy if exists plantios_authenticated_all on public.plantios;
create policy plantios_authenticated_all on public.plantios
  for all to authenticated using (true) with check (true);

drop policy if exists mapas_authenticated_all on public.mapas;
create policy mapas_authenticated_all on public.mapas
  for all to authenticated using (true) with check (true);

-- Endurecimento: o papel anon (visitante sem login) não tem nenhum privilégio nas tabelas, e o
-- authenticated recebe só o que o app usa. O RLS acima continua valendo por cima disso.
revoke all on table public.fazendas from anon;
revoke all on table public.talhoes  from anon;
revoke all on table public.safras   from anon;
revoke all on table public.plantios from anon;
revoke all on table public.mapas    from anon;

grant select, insert, update, delete on table public.fazendas to authenticated;
grant select, insert, update, delete on table public.talhoes to authenticated;
grant select, insert, update, delete on table public.safras to authenticated;
grant select, insert, update, delete on table public.plantios to authenticated;
grant select, insert, update, delete on table public.mapas to authenticated;

-- =================================================================================
-- Storage: bucket privado "mapas" (PNG e miniatura), acessível só a autenticados.
-- =================================================================================

insert into storage.buckets (id, name, public)
values ('mapas', 'mapas', false)
on conflict (id) do nothing;

drop policy if exists mapas_storage_authenticated_all on storage.objects;
create policy mapas_storage_authenticated_all on storage.objects
  for all to authenticated
  using (bucket_id = 'mapas')
  with check (bucket_id = 'mapas');
