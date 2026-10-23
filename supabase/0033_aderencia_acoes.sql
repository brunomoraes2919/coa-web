-- COA WEB — Aderência de utilização: cadastros e edições como sinal de uso (troca a função aderencia_dados do 0032).
--
-- Por que: o botão Sair do COA WEB encerra a sessão em todos os aparelhos (signOut com o alcance padrão, "global"), e o
-- Supabase apaga essas sessões e as renovações delas. Quem sai com frequência (o desenvolvedor, por exemplo) perdeu o
-- histórico de antes do rastreio (23/10/2026). Os cadastros e edições que cada pessoa grava noutras tabelas (com quem e
-- quando) recuperam parte desses dias: metas, sementes e população, cores e nomes comerciais das variedades, vínculos de
-- depósito, montagens de painel e TV, equipes do Controle Técnico, cadastros autorizados e senhas. Essas tabelas guardam
-- só a última alteração de cada linha, então a recuperação é parcial. Do rastreio em diante isso não importa: uso_eventos
-- não é apagado.
--
-- O que a função passa a entregar, além do que o 0032 já entregava:
--   acoes   [[dia, hora, usuário, quantidade]] (cadastros e edições nas tabelas acima)
--
-- Rodar UMA vez no SQL Editor do Supabase, depois do 0032 (pode rodar de novo sem estragar nada). Só troca a função.

begin;

set local lock_timeout = '5s';

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
    'acoes', (
      select coalesce(jsonb_agg(jsonb_build_array(x.dia, x.hora, x.usuario, x.n)), '[]'::jsonb)
      from (
        select to_char(q.em at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia,
               extract(hour from q.em at time zone 'America/Cuiaba')::int as hora, q.usuario, count(*) as n
          from (
            select atualizado_em as em, atualizado_por as usuario from public.acomp_metas
            union all select atualizado_em, atualizado_por from public.acomp_variedade_populacao
            union all select autorizado_em, autorizado_por from public.cadastros_autorizados
            union all select criado_em, criado_por from public.controle_equipes
            union all select atualizado_em, atualizado_por from public.mapas_variedade_cores
            union all select comercial_em, comercial_por from public.mapas_variedades
            union all select criado_em, criado_por from public.painel_montagens
            union all select atualizado_em, atualizado_por from public.painel_tv
            union all select definida_em, definida_por from public.senha_padrao
            union all select desde, marcada_por from public.senha_provisoria
            union all select atualizado_em, atualizado_por from public.valid_vinculos
          ) q
         where q.usuario is not null and q.em >= v_de and q.em < v_ate
         group by 1, 2, 3
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
