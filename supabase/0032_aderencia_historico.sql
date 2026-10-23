-- COA WEB — Aderência de utilização: histórico de uso pelas sessões do Supabase (troca a função aderencia_dados do 0031).
--
-- Por que: o "último login" (auth.users.last_sign_in_at) só muda quando a pessoa digita a senha, e a sessão fica
-- salva por semanas; quem usa todo dia aparecia parado. O rastreio da plataforma (uso_eventos) só existe desde a
-- publicação do 0031. Já o Supabase guarda cada renovação de sessão (auth.refresh_tokens: uma por hora com o COA
-- WEB aberto e visível, e ao abrir depois de uma hora parado) e cada entrada com senha (auth.sessions), desde o
-- começo do projeto. Isso dá dias, acessos e horas de uso para trás, com a mesma regra de antes e depois do rastreio.
-- Limite: quando alguém clica em Sair, o Supabase apaga aquela sessão e as renovações dela (o histórico dessa
-- pessoa antes do rastreio fica incompleto). Relatórios baixados antes do rastreio não deixaram rastro em lugar
-- nenhum (os arquivos são montados no navegador).
--
-- O que a função passa a entregar, além do que o 0031 já entregava:
--   usuarios[].ultimo_uso   o último sinal de uso da pessoa, em qualquer data (renovação, entrada, evento, pedido, mapa)
--   historico_desde         a renovação de sessão mais antiga guardada
--   renovacoes              [[dia, hora, usuário, dispositivo, quantidade]] (auth.refresh_tokens, pelo navegador da sessão)
--   logins                  [[dia, hora, usuário, dispositivo, quantidade]] (auth.sessions: entradas com senha)
--   pedidos                 [[dia, usuário, tipo, quantidade, hora]] (ganhou a hora no fim; ver abaixo)
--   mapas                   [[dia, usuário, tipo, fazenda do COA WEB, quantidade, hora]] (ganhou a hora no fim)
-- Do navegador só sai o tipo de aparelho (computador, celular, tablet); IP e navegador não saem do banco.
--
-- Pedidos de atualização: as tabelas de pedidos são limpas pelo servidor (7 a 30 dias). A partir deste script, cada
-- pedido novo também vira um evento 'pedido' em uso_eventos (gatilho nas cinco tabelas), que fica guardado; a função
-- usa as tabelas só para os pedidos de antes do primeiro evento 'pedido'. O gatilho nunca impede o pedido: sem
-- usuário logado (servidor) ele não registra, e qualquer erro no registro é ignorado.
--
-- Rodar UMA vez no SQL Editor do Supabase, depois do 0031 (pode rodar de novo sem estragar nada).

begin;

set local lock_timeout = '5s';

-- o tipo novo de evento
alter table public.uso_eventos drop constraint if exists uso_eventos_tipo_check;
alter table public.uso_eventos add constraint uso_eventos_tipo_check
  check (tipo in ('acesso', 'entrada', 'modulo', 'pagina', 'fazenda', 'relatorio', 'ativo', 'pedido'));

create or replace function public.uso_registrar_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    begin
      insert into public.uso_eventos (tipo, detalhe) values ('pedido', tg_argv[0]);
    exception when others then
      null; -- o rastreio nunca impede o pedido
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.uso_registrar_pedido() from public, anon, authenticated;
drop trigger if exists uso_pedido on public.mapas_plantio_pedidos;
create trigger uso_pedido after insert on public.mapas_plantio_pedidos for each row execute function public.uso_registrar_pedido('plantio');
drop trigger if exists uso_pedido on public.mapas_chuva_pedidos;
create trigger uso_pedido after insert on public.mapas_chuva_pedidos for each row execute function public.uso_registrar_pedido('chuva');
drop trigger if exists uso_pedido on public.mec_pims_pedidos;
create trigger uso_pedido after insert on public.mec_pims_pedidos for each row execute function public.uso_registrar_pedido('boletins');
drop trigger if exists uso_pedido on public.valid_pedidos;
create trigger uso_pedido after insert on public.valid_pedidos for each row execute function public.uso_registrar_pedido('validacao');
drop trigger if exists uso_pedido on public.mapas_car_pedidos;
create trigger uso_pedido after insert on public.mapas_car_pedidos for each row execute function public.uso_registrar_pedido('car');

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
  v_corte timestamptz; -- primeiro pedido registrado em uso_eventos: antes dele, os pedidos vêm das tabelas
begin
  if not public.mapas_eh_admin() then
    raise exception 'Só administradores veem a aderência.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then
    raise exception 'Período inválido (no máximo 400 dias).' using errcode = '22023';
  end if;
  v_de := p_de::timestamp at time zone 'America/Cuiaba';
  v_ate := (p_ate + 1)::timestamp at time zone 'America/Cuiaba';
  v_corte := (select min(e.em) from public.uso_eventos e where e.tipo = 'pedido');
  return jsonb_build_object(
    'gerado_em', now(),
    'rastreio_desde', (select min(e.em) from public.uso_eventos e),
    'historico_desde', (select min(rt.created_at) from auth.refresh_tokens rt),
    'usuarios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'email', p.email, 'perfil', p.perfil, 'super', coalesce(p.super, false),
        'todas_fazendas', p.perfil = 'admin' and (coalesce(p.super, false) or coalesce(p.todas_fazendas, false)),
        'criado_em', u.created_at, 'ultimo_login', u.last_sign_in_at,
        'ultimo_uso', greatest(
          u.last_sign_in_at,
          (select max(rt.created_at) from auth.refresh_tokens rt where rt.user_id = p.id::text),
          (select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC')) from auth.sessions s where s.user_id = p.id),
          (select max(e.em) from public.uso_eventos e where e.usuario_id = p.id)
        ),
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
         where e.em >= v_de and e.em < v_ate and e.tipo <> 'pedido'
         group by 1, 2, 3, 4, 5, 6, 7, 8
      ) x
    ),
    'renovacoes', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.hora, x.usuario, x.dispositivo, x.n)), '[]'::jsonb)
      from (
        select to_char(rt.created_at at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia,
               extract(hour from rt.created_at at time zone 'America/Cuiaba')::int as hora,
               rt.user_id as usuario,
               case when s.user_agent ~* 'ipad|tablet' then 'tablet'
                    when s.user_agent ~* 'mobi|iphone|android' then 'celular'
                    when s.user_agent is null then null
                    else 'computador' end as dispositivo,
               count(*) as n
          from auth.refresh_tokens rt
          left join auth.sessions s on s.id = rt.session_id
         where rt.created_at >= v_de and rt.created_at < v_ate and rt.user_id is not null
         group by 1, 2, 3, 4
      ) x
    ),
    'logins', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.hora, x.usuario, x.dispositivo, x.n)), '[]'::jsonb)
      from (
        select to_char(s.created_at at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia,
               extract(hour from s.created_at at time zone 'America/Cuiaba')::int as hora,
               s.user_id as usuario,
               case when s.user_agent ~* 'ipad|tablet' then 'tablet'
                    when s.user_agent ~* 'mobi|iphone|android' then 'celular'
                    when s.user_agent is null then null
                    else 'computador' end as dispositivo,
               count(*) as n
          from auth.sessions s
         where s.created_at >= v_de and s.created_at < v_ate
         group by 1, 2, 3, 4
      ) x
    ),
    'pedidos', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.usuario, x.tipo, x.n, x.hora)), '[]'::jsonb)
      from (
        select to_char(q.em at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia, q.usuario, q.tipo, count(*) as n,
               extract(hour from q.em at time zone 'America/Cuiaba')::int as hora
          from (
            select t.em, t.usuario, t.tipo
              from (
                select pedido_em as em, pedido_por as usuario, 'plantio' as tipo from public.mapas_plantio_pedidos
                union all select pedido_em, pedido_por, 'chuva' from public.mapas_chuva_pedidos
                union all select pedido_em, pedido_por, 'boletins' from public.mec_pims_pedidos
                union all select pedido_em, pedido_por, 'validacao' from public.valid_pedidos
                union all select pedido_em, pedido_por, 'car' from public.mapas_car_pedidos
              ) t
             where v_corte is null or t.em < v_corte
            union all
            select e.em, e.usuario_id, e.detalhe from public.uso_eventos e where e.tipo = 'pedido'
          ) q
         where q.usuario is not null and q.em >= v_de and q.em < v_ate
         group by 1, 2, 3, 5
      ) x
    ),
    'mapas', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.criado_por, x.tipo, x.coa_fazenda_id, x.n, x.hora)), '[]'::jsonb)
      from (
        select to_char(c.criado_em at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia, c.criado_por,
               coalesce(c.tipo, 'chuva') as tipo, mf.coa_fazenda_id, count(*) as n,
               extract(hour from c.criado_em at time zone 'America/Cuiaba')::int as hora
          from public.mapas_chuva c
          left join public.mapas_fazendas mf on mf.id = c.fazenda_id
         where c.criado_por is not null and c.criado_em >= v_de and c.criado_em < v_ate
         group by 1, 2, 3, 4, 6
      ) x
    )
  );
end;
$$;
revoke all on function public.aderencia_dados(date, date) from public, anon;
grant execute on function public.aderencia_dados(date, date) to authenticated;

commit;
