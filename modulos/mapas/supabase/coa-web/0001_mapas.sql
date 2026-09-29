-- =================================================================================================
-- Módulo MAPAS do COA WEB — banco (tabelas mapas_*, regras de acesso e bucket "mapas-chuva")
-- =================================================================================================
--
-- Onde rodar: no SQL Editor do projeto Supabase do COA WEB (pkaxbitsqxjxjlwnhjhd). Cole o arquivo
-- inteiro e execute. Antes de publicar o módulo, rode também verificar-permissoes.sql (só leitura).
--
-- O que este script faz:
--   * cria SÓ objetos novos com o prefixo "mapas_" (tabelas, índices, funções e regras de RLS),
--     o bucket privado "mapas-chuva" e as regras "mapas_chuva_storage_*" em storage.objects, que só
--     valem para esse bucket (não mudam o acesso a nenhum outro bucket);
--   * NÃO altera nem apaga tabelas, funções, regras ou dados que já existem (fazendas, talhoes,
--     safras, variedades, perfis, usuario_fazendas...). A única ligação com elas é a chave
--     estrangeira mapas_fazendas.coa_fazenda_id -> fazendas.id (on delete set null): apagar uma
--     fazenda do COA WEB só desliga dela a fazenda de mapa; nada é apagado;
--   * só LÊ perfis e usuario_fazendas, para aplicar as mesmas permissões do COA WEB:
--       admin (perfis.perfil = 'admin') -> vê e altera tudo;
--       colaborador (tem linha em perfis) -> vê as fazendas liberadas em usuario_fazendas, e nelas
--                                            salva/exclui mapas de chuva; cadastros só o admin altera;
--       sem linha em perfis -> não vê nada (o cadastro público de contas está ligado no COA WEB,
--                              então "estar logado" não basta).
--   * mapas_plantio_pims não tem regra de escrita: só a rotina do PIMS, com a chave de serviço
--     (que ignora o RLS), grava nela.
--
-- Idempotente e atômico: pode ser executado de novo sem erro nem perda de dados (create ... if not
-- exists, create or replace function, drop policy if exists + create policy, bucket com on conflict
-- do nothing) e roda numa transação só: se algo falhar, nada fica aplicado.

begin;

-- =================================================================================================
-- Tabelas (mesmas colunas do Mapa de Chuva avulso; os ids uuid são gerados no cliente)
-- =================================================================================================

-- Fazendas de mapa (uma por shape de talhões importado), ligadas à fazenda do COA WEB.
create table if not exists public.mapas_fazendas (
  id             uuid primary key,
  nome           text not null,
  -- coluna do shapefile usada como nome (rótulo) do talhão
  campo_nome     text not null,
  -- coluna do shapefile usada como setor (opcional)
  campo_setor    text,
  -- colunas de atributos disponíveis no shape original
  colunas        jsonb not null default '[]'::jsonb,
  criado_em      timestamptz not null default now(),
  -- unidade (fazenda) no PIMS, ex.: 'SIRIEMA'
  unidade_pims   text,
  -- coluna do shape com o código do talhão (ex.: CD_UPNIVEL3)
  campo_codigo   text,
  -- fazenda do COA WEB que define quem vê esta fazenda de mapa (nula = só admin)
  coa_fazenda_id integer references public.fazendas (id) on delete set null
);

-- Talhões de cada fazenda de mapa (geometria em GeoJSON WGS84).
create table if not exists public.mapas_talhoes (
  id         uuid primary key,
  fazenda_id uuid not null references public.mapas_fazendas (id) on delete cascade,
  nome       text not null,
  setor      text,
  area_ha    double precision not null,
  -- GeoJSON (Polygon ou MultiPolygon) em WGS84 (lon, lat)
  geom       jsonb not null,
  -- demais atributos do shapefile (não estruturados)
  atributos  jsonb not null default '{}'::jsonb,
  -- código do talhão normalizado (ver src/lib/codigoTalhao.ts), ex.: '039B', '02PIVO'
  codigo     text
);

-- Safras (períodos de cultivo), ex.: "SOJA 26/27".
create table if not exists public.mapas_safras (
  id        uuid primary key,
  nome      text not null,
  cultura   text not null,
  -- ex.: "26/27"
  ano_safra text not null,
  inicio    date not null,
  fim       date not null,
  -- nome da safra no PIMS (PERIODOSAFRA.DE_PER_SAFRA), ex.: 'SOJA 26/27'; nulo = usa o nome
  nome_pims text
);

-- Situação de cada talhão numa safra (marcada à mão ou vinda do PIMS). PK composta = não duplica.
create table if not exists public.mapas_plantios (
  safra_id      uuid not null references public.mapas_safras (id) on delete cascade,
  talhao_id     uuid not null references public.mapas_talhoes (id) on delete cascade,
  data_plantio  date,
  origem        text not null default 'manual',
  status        text not null default 'plantado',
  area_prevista numeric,
  area_plantada numeric,
  inicio        date,
  fim           date,
  variedade     text,
  primary key (safra_id, talhao_id),
  constraint mapas_plantios_origem_check check (origem in ('manual', 'pims')),
  constraint mapas_plantios_status_check check (status in ('plantado', 'plantando', 'a_plantar'))
);

-- Áreas da cultura (shape da cultura por safra × fazenda, ex.: soja 26/27).
create table if not exists public.mapas_areas_cultura (
  id         uuid primary key,
  safra_id   uuid not null references public.mapas_safras (id) on delete cascade,
  fazenda_id uuid not null references public.mapas_fazendas (id) on delete cascade,
  -- código normalizado do talhão ('' quando o shape não tem código)
  codigo     text not null default '',
  area_ha    double precision not null,
  -- GeoJSON (Polygon ou MultiPolygon) em WGS84 (lon, lat)
  geom       jsonb not null
);

-- Mapas de chuva salvos (a imagem e a miniatura ficam no bucket "mapas-chuva").
create table if not exists public.mapas_chuva (
  id             uuid primary key,
  fazenda_id     uuid not null references public.mapas_fazendas (id) on delete cascade,
  -- a safra pode ser excluída sem apagar o histórico do mapa
  safra_id       uuid references public.mapas_safras (id) on delete set null,
  titulo         text not null,
  periodo_inicio date,
  periodo_fim    date,
  -- campos do layout, paleta e parâmetros do IDW
  config         jsonb not null,
  -- PICs usados na geração (datas Date -> string ISO; ver src/data/supabaseLinhas.ts)
  pics           jsonb not null default '[]'::jsonb,
  -- estatísticas (geral, plantado, por talhão)
  resumo         jsonb not null,
  png_path       text,
  thumb_path     text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid(),
  -- Os arquivos de um mapa se chamam "<id do mapa>..." (ex.: <id>.jpg, <id>-thumb.png). Como as
  -- regras do storage liberam cada arquivo pelo mapa que aponta para ele, isto impede que alguém
  -- crie um mapa numa fazenda sua apontando para o arquivo de um mapa de outra fazenda.
  constraint mapas_chuva_arquivos_do_mapa check (
    (png_path is null or starts_with(lower(png_path), id::text))
    and (thumb_path is null or starts_with(lower(thumb_path), id::text))
  )
);

-- Plantio do PIMS: uma linha por safra × unidade, gravada pela rotina horária (chave de serviço).
create table if not exists public.mapas_plantio_pims (
  safra     text not null,
  unidade   text not null,
  gerado_em timestamptz not null,
  talhoes   jsonb not null default '[]'::jsonb,
  primary key (safra, unidade)
);

-- =================================================================================================
-- Índices (consultas mais comuns do app: por fazenda e por safra)
-- =================================================================================================

create index if not exists mapas_fazendas_coa_fazenda_id_idx on public.mapas_fazendas (coa_fazenda_id);
create index if not exists mapas_talhoes_fazenda_id_idx on public.mapas_talhoes (fazenda_id);
create index if not exists mapas_talhoes_fazenda_codigo_idx on public.mapas_talhoes (fazenda_id, codigo);
create index if not exists mapas_plantios_safra_id_idx on public.mapas_plantios (safra_id);
create index if not exists mapas_plantios_talhao_id_idx on public.mapas_plantios (talhao_id);
create index if not exists mapas_areas_cultura_safra_fazenda_idx on public.mapas_areas_cultura (safra_id, fazenda_id);
create index if not exists mapas_areas_cultura_fazenda_id_idx on public.mapas_areas_cultura (fazenda_id);
create index if not exists mapas_chuva_fazenda_id_idx on public.mapas_chuva (fazenda_id);
create index if not exists mapas_chuva_safra_id_idx on public.mapas_chuva (safra_id);
create index if not exists mapas_chuva_criado_em_idx on public.mapas_chuva (criado_em desc);

-- =================================================================================================
-- Funções de permissão
-- =================================================================================================
-- security definer: rodam como o dono (quem executa este script), então leem perfis,
-- usuario_fazendas, mapas_fazendas e mapas_chuva sem passar pelo RLS dessas tabelas. Isso evita
-- regras que se chamam em círculo e não depende das regras do COA WEB. Nomes sempre com schema e
-- search_path fixo. Só o papel authenticated pode executá-las (anon e public não).

-- O usuário logado tem perfil no COA WEB (admin ou colaborador)?
create or replace function public.mapas_tem_perfil()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p where p.id = auth.uid()
  );
$$;

-- O usuário logado é admin do COA WEB?
create or replace function public.mapas_eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p where p.id = auth.uid() and p.perfil = 'admin'
  );
$$;

-- O usuário logado pode ver esta fazenda do COA WEB? Admin vê todas; colaborador (com perfil) vê as
-- liberadas em usuario_fazendas; fazenda nula (fazenda de mapa sem vínculo) -> só admin.
create or replace function public.mapas_pode_ver(p_coa_fazenda_id integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mapas_eh_admin()
      or (
        p_coa_fazenda_id is not null
        and public.mapas_tem_perfil()
        and exists (
          select 1
          from public.usuario_fazendas uf
          where uf.usuario_id = auth.uid()
            and uf.fazenda_id = p_coa_fazenda_id
        )
      );
$$;

-- O usuário logado pode ver esta fazenda de mapa? Fazenda inexistente ou sem vínculo -> só admin.
create or replace function public.mapas_pode_ver_fazenda(p_fazenda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mapas_pode_ver(
    (select f.coa_fazenda_id from public.mapas_fazendas f where f.id = p_fazenda_id)
  );
$$;

-- O usuário logado pode usar este arquivo do bucket "mapas-chuva"?
--   * arquivo de algum mapa salvo -> sim, se ele pode ver a fazenda de um desses mapas;
--   * arquivo que nenhum mapa usa (enviado antes de gravar a linha do mapa, ou sobra de um
--     salvamento que falhou) -> sim, se ele tem perfil.
-- Precisa ser security definer: com o RLS, um mapa de outra fazenda seria invisível e o arquivo
-- dele pareceria "sem mapa", liberando-o para qualquer perfil.
create or replace function public.mapas_pode_ver_arquivo(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.mapas_chuva m where p_nome in (m.png_path, m.thumb_path)
    )
    then exists (
      select 1
      from public.mapas_chuva m
      where p_nome in (m.png_path, m.thumb_path)
        and public.mapas_pode_ver_fazenda(m.fazenda_id)
    )
    else public.mapas_tem_perfil()
  end;
$$;

revoke all on function public.mapas_tem_perfil() from public, anon;
revoke all on function public.mapas_eh_admin() from public, anon;
revoke all on function public.mapas_pode_ver(integer) from public, anon;
revoke all on function public.mapas_pode_ver_fazenda(uuid) from public, anon;
revoke all on function public.mapas_pode_ver_arquivo(text) from public, anon;

grant execute on function public.mapas_tem_perfil() to authenticated;
grant execute on function public.mapas_eh_admin() to authenticated;
grant execute on function public.mapas_pode_ver(integer) to authenticated;
grant execute on function public.mapas_pode_ver_fazenda(uuid) to authenticated;
grant execute on function public.mapas_pode_ver_arquivo(text) to authenticated;

-- =================================================================================================
-- RLS e privilégios
-- =================================================================================================
-- anon (visitante sem login) não tem nenhum privilégio; authenticated recebe só o que o app usa
-- (o padrão do Supabase daria também truncate/references/trigger). As regras abaixo valem por cima.
-- Chamadas sem argumento vão como "(select função())": o Postgres calcula uma vez por consulta,
-- não uma vez por linha (mesmo resultado).

alter table public.mapas_fazendas      enable row level security;
alter table public.mapas_talhoes       enable row level security;
alter table public.mapas_safras        enable row level security;
alter table public.mapas_plantios      enable row level security;
alter table public.mapas_areas_cultura enable row level security;
alter table public.mapas_chuva         enable row level security;
alter table public.mapas_plantio_pims  enable row level security;

revoke all on table public.mapas_fazendas      from anon, authenticated;
revoke all on table public.mapas_talhoes       from anon, authenticated;
revoke all on table public.mapas_safras        from anon, authenticated;
revoke all on table public.mapas_plantios      from anon, authenticated;
revoke all on table public.mapas_areas_cultura from anon, authenticated;
revoke all on table public.mapas_chuva         from anon, authenticated;
revoke all on table public.mapas_plantio_pims  from anon, authenticated;

grant select, insert, update, delete on table public.mapas_fazendas      to authenticated;
grant select, insert, update, delete on table public.mapas_talhoes       to authenticated;
grant select, insert, update, delete on table public.mapas_safras        to authenticated;
grant select, insert, update, delete on table public.mapas_plantios      to authenticated;
grant select, insert, update, delete on table public.mapas_areas_cultura to authenticated;
grant select, insert, update, delete on table public.mapas_chuva         to authenticated;
grant select                         on table public.mapas_plantio_pims  to authenticated;
-- a rotina do PIMS grava com a chave de serviço (upsert pela API REST)
grant select, insert, update, delete on table public.mapas_plantio_pims  to service_role;

-- ---- mapas_fazendas: vê quem pode ver a fazenda do COA WEB; só admin altera ---------------------

drop policy if exists mapas_fazendas_select on public.mapas_fazendas;
create policy mapas_fazendas_select on public.mapas_fazendas
  for select to authenticated
  using (public.mapas_pode_ver(coa_fazenda_id));

drop policy if exists mapas_fazendas_insert on public.mapas_fazendas;
create policy mapas_fazendas_insert on public.mapas_fazendas
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_fazendas_update on public.mapas_fazendas;
create policy mapas_fazendas_update on public.mapas_fazendas
  for update to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_fazendas_delete on public.mapas_fazendas;
create policy mapas_fazendas_delete on public.mapas_fazendas
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---- mapas_talhoes: vê quem pode ver a fazenda de mapa; só admin altera -------------------------

drop policy if exists mapas_talhoes_select on public.mapas_talhoes;
create policy mapas_talhoes_select on public.mapas_talhoes
  for select to authenticated
  using (public.mapas_pode_ver_fazenda(fazenda_id));

drop policy if exists mapas_talhoes_insert on public.mapas_talhoes;
create policy mapas_talhoes_insert on public.mapas_talhoes
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_talhoes_update on public.mapas_talhoes;
create policy mapas_talhoes_update on public.mapas_talhoes
  for update to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_talhoes_delete on public.mapas_talhoes;
create policy mapas_talhoes_delete on public.mapas_talhoes
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---- mapas_areas_cultura: vê quem pode ver a fazenda de mapa; só admin altera -------------------

drop policy if exists mapas_areas_cultura_select on public.mapas_areas_cultura;
create policy mapas_areas_cultura_select on public.mapas_areas_cultura
  for select to authenticated
  using (public.mapas_pode_ver_fazenda(fazenda_id));

drop policy if exists mapas_areas_cultura_insert on public.mapas_areas_cultura;
create policy mapas_areas_cultura_insert on public.mapas_areas_cultura
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_areas_cultura_update on public.mapas_areas_cultura;
create policy mapas_areas_cultura_update on public.mapas_areas_cultura
  for update to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_areas_cultura_delete on public.mapas_areas_cultura;
create policy mapas_areas_cultura_delete on public.mapas_areas_cultura
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---- mapas_plantios: vê quem pode ver a fazenda do talhão; só admin altera ----------------------

drop policy if exists mapas_plantios_select on public.mapas_plantios;
create policy mapas_plantios_select on public.mapas_plantios
  for select to authenticated
  using (
    exists (
      select 1
      from public.mapas_talhoes t
      where t.id = mapas_plantios.talhao_id
        and public.mapas_pode_ver_fazenda(t.fazenda_id)
    )
  );

drop policy if exists mapas_plantios_insert on public.mapas_plantios;
create policy mapas_plantios_insert on public.mapas_plantios
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_plantios_update on public.mapas_plantios;
create policy mapas_plantios_update on public.mapas_plantios
  for update to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_plantios_delete on public.mapas_plantios;
create policy mapas_plantios_delete on public.mapas_plantios
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---- mapas_safras: vê quem tem perfil; só admin altera ------------------------------------------

drop policy if exists mapas_safras_select on public.mapas_safras;
create policy mapas_safras_select on public.mapas_safras
  for select to authenticated
  using ((select public.mapas_tem_perfil()));

drop policy if exists mapas_safras_insert on public.mapas_safras;
create policy mapas_safras_insert on public.mapas_safras
  for insert to authenticated
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_safras_update on public.mapas_safras;
create policy mapas_safras_update on public.mapas_safras
  for update to authenticated
  using ((select public.mapas_eh_admin()))
  with check ((select public.mapas_eh_admin()));

drop policy if exists mapas_safras_delete on public.mapas_safras;
create policy mapas_safras_delete on public.mapas_safras
  for delete to authenticated
  using ((select public.mapas_eh_admin()));

-- ---- mapas_chuva: vê, grava e exclui quem pode ver a fazenda do mapa -----------------------------

drop policy if exists mapas_chuva_select on public.mapas_chuva;
create policy mapas_chuva_select on public.mapas_chuva
  for select to authenticated
  using (public.mapas_pode_ver_fazenda(fazenda_id));

drop policy if exists mapas_chuva_insert on public.mapas_chuva;
create policy mapas_chuva_insert on public.mapas_chuva
  for insert to authenticated
  with check (public.mapas_pode_ver_fazenda(fazenda_id));

drop policy if exists mapas_chuva_update on public.mapas_chuva;
create policy mapas_chuva_update on public.mapas_chuva
  for update to authenticated
  using (public.mapas_pode_ver_fazenda(fazenda_id))
  with check (public.mapas_pode_ver_fazenda(fazenda_id));

drop policy if exists mapas_chuva_delete on public.mapas_chuva;
create policy mapas_chuva_delete on public.mapas_chuva
  for delete to authenticated
  using (public.mapas_pode_ver_fazenda(fazenda_id));

-- ---- mapas_plantio_pims: vê quem pode ver alguma fazenda de mapa dessa unidade do PIMS ----------
-- Sem regra de insert/update/delete: nenhum usuário grava; só a chave de serviço (ignora o RLS).

drop policy if exists mapas_plantio_pims_select on public.mapas_plantio_pims;
create policy mapas_plantio_pims_select on public.mapas_plantio_pims
  for select to authenticated
  using (
    (select public.mapas_eh_admin())
    or exists (
      select 1
      from public.mapas_fazendas f
      where upper(f.unidade_pims) = upper(mapas_plantio_pims.unidade)
        and public.mapas_pode_ver(f.coa_fazenda_id)
    )
  );

-- =================================================================================================
-- Storage: bucket privado "mapas-chuva" (imagem e miniatura dos mapas salvos)
-- =================================================================================================
-- Toda regra começa por bucket_id = 'mapas-chuva': nenhuma delas libera arquivo de outro bucket.
-- O app envia com upsert (insert + select + update) e exclui arquivos (delete).

insert into storage.buckets (id, name, public)
values ('mapas-chuva', 'mapas-chuva', false)
on conflict (id) do nothing;

drop policy if exists mapas_chuva_storage_select on storage.objects;
create policy mapas_chuva_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mapas-chuva' and public.mapas_pode_ver_arquivo(name));

drop policy if exists mapas_chuva_storage_insert on storage.objects;
create policy mapas_chuva_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mapas-chuva' and public.mapas_pode_ver_arquivo(name));

drop policy if exists mapas_chuva_storage_update on storage.objects;
create policy mapas_chuva_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'mapas-chuva' and public.mapas_pode_ver_arquivo(name))
  with check (bucket_id = 'mapas-chuva' and public.mapas_pode_ver_arquivo(name));

drop policy if exists mapas_chuva_storage_delete on storage.objects;
create policy mapas_chuva_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mapas-chuva' and public.mapas_pode_ver_arquivo(name));

commit;
