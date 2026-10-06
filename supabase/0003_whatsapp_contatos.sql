-- COA WEB — contatos que vão receber alertas pelo WhatsApp (com ou sem login no site).
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: supabase/0002_administrador_mais.sql (função is_super) e da tabela fazendas do COA WEB.
--
-- Por enquanto é só o cadastro: nada aqui envia mensagem. Quando o envio existir, o serviço que
-- manda as mensagens lê estas tabelas com a chave de serviço (que não passa pelas regras abaixo).
--
-- Número de telefone é dado pessoal: só o ADMINISTRADOR+ lê e altera. Nenhum outro usuário do site
-- (administrador comum ou colaborador) enxerga as linhas, nem as próprias.

create table if not exists public.whatsapp_contatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  -- só dígitos, com o 55 na frente: 55 + DDD + número (8 ou 9 dígitos)
  telefone text not null unique check (telefone ~ '^55[1-9][1-9][0-9]{8,9}$'),
  -- true: recebe o alerta de qualquer fazenda; false: só das que estiverem em whatsapp_contato_fazendas
  todas_fazendas boolean not null default false,
  -- tipos de alerta (um por coluna; hoje só a janela de risco do Locks SAT)
  alerta_janela boolean not null default true,
  -- false = pausado: continua na lista, mas não recebe nada
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.whatsapp_contato_fazendas (
  contato_id uuid not null references public.whatsapp_contatos(id) on delete cascade,
  fazenda_id bigint not null references public.fazendas(id) on delete cascade,
  primary key (contato_id, fazenda_id)
);

alter table public.whatsapp_contatos enable row level security;
alter table public.whatsapp_contato_fazendas enable row level security;

drop policy if exists whatsapp_contatos_super on public.whatsapp_contatos;
create policy whatsapp_contatos_super on public.whatsapp_contatos
  for all to authenticated
  using (public.is_super())
  with check (public.is_super());

drop policy if exists whatsapp_contato_fazendas_super on public.whatsapp_contato_fazendas;
create policy whatsapp_contato_fazendas_super on public.whatsapp_contato_fazendas
  for all to authenticated
  using (public.is_super())
  with check (public.is_super());

-- o Supabase dá tudo a anon e authenticated em tabela nova: aqui fica só o que o site usa
revoke all on public.whatsapp_contatos from anon, authenticated;
revoke all on public.whatsapp_contato_fazendas from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_contatos to authenticated;
grant select, insert, update, delete on public.whatsapp_contato_fazendas to authenticated;
