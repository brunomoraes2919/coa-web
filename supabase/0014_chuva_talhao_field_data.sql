-- COA WEB — "Chuva por talhão": a chuva passa a vir da tabela stg_field_data da ZEUS (a base do relatório
-- Power BI), que já traz o valor de cada talhão, com os ciclos do PIMS (do plantio à colheita).
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0013 (pode rodar de novo sem estragar nada).
-- Só acrescenta colunas à tabela chuva_talhao; não apaga nem altera o que já existe. As colunas pics e
-- vinculos continuam: a chuva medida nos pluviômetros fica como referência.

begin;

set local lock_timeout = '5s';

alter table public.chuva_talhao
  -- { "<código do talhão>": { de, ate (primeiro e último dia com registro, contados de inicio),
  --                           d (só os dias com chuva: 'n:mm', separados por vírgula) } }
  add column if not exists talhoes    jsonb not null default '{}'::jsonb,
  -- os dias que a stg_field_data tem para a fazenda, em faixas contadas de inicio ('0-268,270-742')
  add column if not exists lidos      text  not null default '',
  -- o último dia com chuva por talhão na stg_field_data
  add column if not exists ultimo_dia date,
  -- [{ s (safra), p (período de safra), de, ate (do primeiro plantio à última colheita), t [códigos dos talhões] }]
  add column if not exists ciclos     jsonb not null default '[]'::jsonb;

commit;
