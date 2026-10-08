-- COA WEB — "Chuva por talhão" (página nova da categoria Mapas, pasta chuva/).
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS dos scripts de Mapas e do Acompanhamento (pode rodar de
-- novo sem estragar nada). Cria só a tabela deste módulo; não altera nem apaga nada que já exista.
--
-- chuva_talhao — retrato da ZEUS, gravado pelo servidor do Google Cloud (chave de serviço) a cada 30 minutos
--                (modulos/mapas/scripts/atender-pedidos.mjs → atualizarChuvaTalhao). Uma linha por fazenda.
--                A chuva do talhão segue a regra da visão vw_precipitacao_talhao da ZEUS: soma do dia de
--                cada pluviômetro ligado ao talhão, em média quando há mais de um. A tela faz essa conta.

begin;

set local lock_timeout = '5s';

create table if not exists public.chuva_talhao (
  -- fazenda da ZEUS com o nome da unidade do PIMS ('Faz_SM3' → 'SM3'), a mesma chave do Acompanhamento
  unidade        text primary key,
  gerado_em      timestamptz not null,
  -- primeiro dia da janela e quantos dias ela tem (o dia n de um pluviômetro é inicio + n)
  inicio         date not null,
  dias           integer not null,
  -- leitura mais recente entre os pluviômetros da fazenda ('aaaa-mm-ddThh:mm', hora da fazenda)
  ultima_leitura text,
  -- [{ id, n (nome), lat, lon, ul (última leitura), l (leituras por dia, o usual),
  --    d (dias com leitura, separados por vírgula: 'n' sem chuva ou 'n:mm'; 'xQ' no fim = Q leituras naquele dia) }]
  pics           jsonb not null default '[]'::jsonb,
  -- { "<código do talhão no formato do PIMS>": [índices em pics] } — o vínculo do cadastro da ZEUS
  vinculos       jsonb not null default '{}'::jsonb
);

alter table public.chuva_talhao enable row level security;
revoke all on table public.chuva_talhao from anon, authenticated;
grant select on table public.chuva_talhao to authenticated;
grant select, insert, update, delete on table public.chuva_talhao to service_role;

-- vê quem tem a categoria Mapas e pode ver a fazenda (administradores veem todas; os demais, as liberadas)
drop policy if exists chuva_talhao_select on public.chuva_talhao;
create policy chuva_talhao_select on public.chuva_talhao
  for select to authenticated
  using ((select public.tem_categoria('mapas')) and public.acomp_pode_ver_unidade(unidade));

commit;
