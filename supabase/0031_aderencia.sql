-- COA WEB — Aderência de utilização da plataforma (módulo só dos administradores).
--
-- uso_eventos: o que cada usuário faz na plataforma, gravado pela própria tela (assets/uso.js e index.html):
--   acesso     abriu o COA WEB logado (cada aba aberta ou recarregada conta um)
--   entrada    entrou com e-mail e senha
--   modulo     abriu um módulo pela tela inicial (Mapas, Operacional, Validação PIMS...)
--   pagina     abriu uma tela dentro do módulo
--   fazenda    trocou a fazenda do menu lateral
--   relatorio  baixou um arquivo (PNG, PDF, CSV, XLSX, ZIP, KML...)
--   ativo      a cada 5 minutos com a plataforma aberta e em foco (estimativa do tempo de uso)
-- Quem grava: o próprio usuário logado, só em nome dele (o banco põe o usuário e a hora; a tela não escolhe).
-- No máximo 60 eventos por minuto por usuário. Ninguém altera nem apaga eventos.
-- Quem lê: só administradores, pela função aderencia_dados (resumo por dia e hora, mais o que já existia antes do
-- rastreio: último login de cada usuário, mapas salvos e pedidos dos botões das telas).
--
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: mapas_eh_admin() (modulos/mapas/supabase/coa-web/0001_mapas.sql).

begin;

set local lock_timeout = '5s';

create table if not exists public.uso_eventos (
  id           bigserial primary key,
  em           timestamptz not null default now(),
  usuario_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo         text not null check (tipo in ('acesso', 'entrada', 'modulo', 'pagina', 'fazenda', 'relatorio', 'ativo')),
  modulo       text check (modulo is null or char_length(modulo) between 1 and 40),
  detalhe      text check (detalhe is null or char_length(detalhe) <= 160),
  fazenda_id   bigint,
  sessao       text check (sessao is null or char_length(sessao) <= 40),
  dispositivo  text check (dispositivo is null or dispositivo in ('computador', 'celular', 'tablet'))
);
create index if not exists uso_eventos_em on public.uso_eventos (em);
create index if not exists uso_eventos_usuario_em on public.uso_eventos (usuario_id, em);

-- o usuário e a hora são sempre os do banco; freio de 60 eventos por minuto por usuário
create or replace function public.uso_eventos_carimbo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.usuario_id := auth.uid();
  new.em := now();
  if new.usuario_id is null then
    raise exception 'Evento sem usuário logado.' using errcode = '42501';
  end if;
  if (select count(*) from public.uso_eventos e where e.usuario_id = new.usuario_id and e.em > now() - interval '1 minute') >= 60 then
    raise exception 'Muitos eventos em pouco tempo.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.uso_eventos_carimbo() from public, anon, authenticated;
drop trigger if exists uso_eventos_carimbo on public.uso_eventos;
create trigger uso_eventos_carimbo before insert on public.uso_eventos
  for each row execute function public.uso_eventos_carimbo();

alter table public.uso_eventos enable row level security;
revoke all on table public.uso_eventos from anon, authenticated;
grant insert, select on table public.uso_eventos to authenticated;
grant usage on sequence public.uso_eventos_id_seq to authenticated;
grant all on table public.uso_eventos to service_role;

drop policy if exists uso_eventos_insert on public.uso_eventos;
create policy uso_eventos_insert on public.uso_eventos
  for insert to authenticated with check (usuario_id = auth.uid());

drop policy if exists uso_eventos_select on public.uso_eventos;
create policy uso_eventos_select on public.uso_eventos
  for select to authenticated using (public.mapas_eh_admin());

-- Tudo o que o painel da aderência mostra, de p_de a p_ate (datas de Cuiabá, no máximo 400 dias), só para administradores:
--   usuarios  cadastro (nome, e-mail, perfil, fazendas e módulos liberados), criação e último login
--   fazendas  [{ id, nome }] do COA WEB
--   eventos   [[dia, hora, usuário, tipo, módulo, fazenda, detalhe, dispositivo, quantidade, sessões]] (resumo por hora)
--   pedidos   [[dia, usuário, tipo do pedido, quantidade]] (botões Atualizar, Buscar no PIMS, Buscar nas bases...)
--   mapas     [[dia, usuário, tipo do mapa, fazenda do COA WEB, quantidade]] (mapas salvos no módulo Mapas)
create or replace function public.aderencia_dados(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_de timestamptz;
  v_ate timestamptz;
begin
  if not public.mapas_eh_admin() then
    raise exception 'Só administradores veem a aderência.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then
    raise exception 'Período inválido (no máximo 400 dias).' using errcode = '22023';
  end if;
  v_de := p_de::timestamp at time zone 'America/Cuiaba';
  v_ate := (p_ate + 1)::timestamp at time zone 'America/Cuiaba';
  return jsonb_build_object(
    'gerado_em', now(),
    'rastreio_desde', (select min(e.em) from public.uso_eventos e),
    'usuarios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', p.email, 'perfil', p.perfil, 'super', coalesce(p.super, false),
        'todas_fazendas', p.perfil = 'admin' and (coalesce(p.super, false) or coalesce(p.todas_fazendas, false)),
        'criado_em', u.created_at, 'ultimo_login', u.last_sign_in_at,
        'fazendas', (select coalesce(jsonb_agg(uf.fazenda_id order by uf.fazenda_id), '[]'::jsonb) from public.usuario_fazendas uf where uf.usuario_id = p.id),
        'categorias', (select coalesce(jsonb_agg(uc.categoria order by uc.categoria), '[]'::jsonb) from public.usuario_categorias uc where uc.usuario_id = p.id)
      ) order by p.nome), '[]'::jsonb)
      from public.perfis p left join auth.users u on u.id = p.id
    ),
    'fazendas', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome) order by f.nome), '[]'::jsonb) from public.fazendas f),
    'eventos', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.hora, x.usuario_id, x.tipo, x.modulo, x.fazenda_id, x.detalhe, x.dispositivo, x.n, x.s)), '[]'::jsonb)
      from (
        select to_char(e.em at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia,
               extract(hour from e.em at time zone 'America/Cuiaba')::int as hora,
               e.usuario_id, e.tipo, e.modulo, e.fazenda_id,
               case when e.tipo in ('relatorio', 'pagina') then e.detalhe end as detalhe,
               e.dispositivo, count(*) as n, count(distinct e.sessao) as s
          from public.uso_eventos e
         where e.em >= v_de and e.em < v_ate
         group by 1, 2, 3, 4, 5, 6, 7, 8
      ) x
    ),
    'pedidos', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.pedido_por, x.tipo, x.n)), '[]'::jsonb)
      from (
        select to_char(q.pedido_em at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia, q.pedido_por, q.tipo, count(*) as n
          from (
            select pedido_em, pedido_por, 'plantio' as tipo from public.mapas_plantio_pedidos
            union all select pedido_em, pedido_por, 'chuva' from public.mapas_chuva_pedidos
            union all select pedido_em, pedido_por, 'boletins' from public.mec_pims_pedidos
            union all select pedido_em, pedido_por, 'validacao' from public.valid_pedidos
            union all select pedido_em, pedido_por, 'car' from public.mapas_car_pedidos
          ) q
         where q.pedido_por is not null and q.pedido_em >= v_de and q.pedido_em < v_ate
         group by 1, 2, 3
      ) x
    ),
    'mapas', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.criado_por, x.tipo, x.coa_fazenda_id, x.n)), '[]'::jsonb)
      from (
        select to_char(c.criado_em at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia, c.criado_por,
               coalesce(c.tipo, 'chuva') as tipo, mf.coa_fazenda_id, count(*) as n
          from public.mapas_chuva c
          left join public.mapas_fazendas mf on mf.id = c.fazenda_id
         where c.criado_por is not null and c.criado_em >= v_de and c.criado_em < v_ate
         group by 1, 2, 3, 4
      ) x
    )
  );
end;
$$;
revoke all on function public.aderencia_dados(date, date) from public, anon;
grant execute on function public.aderencia_dados(date, date) to authenticated;

commit;

-- Conferência (rodar depois, opcional):
-- select relrowsecurity from pg_class where oid = 'public.uso_eventos'::regclass;              -- true
-- select policyname, cmd from pg_policies where tablename = 'uso_eventos';                     -- insert e select
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'uso_eventos' order by 1, 2;                                            -- sem anon
