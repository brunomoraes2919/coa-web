-- COA WEB — envio dos alertas de janela de risco pelo WhatsApp.
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: supabase/0003_whatsapp_contatos.sql e supabase/0002_administrador_mais.sql (is_super).
--
-- Quem grava aqui é o serviço da VM, com a chave de serviço (que não passa pelas regras abaixo).
-- Pelo site, só o ADMINISTRADOR+ lê; e só ele confirma um contato à mão.

-- 1. Autorização de cada contato: só recebe quem mandou ATIVAR (ou foi confirmado à mão)
alter table public.whatsapp_contatos add column if not exists confirmado_em timestamptz;
alter table public.whatsapp_contatos add column if not exists confirmado_por text
  check (confirmado_por is null or confirmado_por in ('mensagem', 'manual'));
-- endereço do WhatsApp já resolvido (o serviço preenche; evita consultar o número a cada envio)
alter table public.whatsapp_contatos add column if not exists jid text;

-- 2. Um registro por pessoa e por evento: é o que impede mandar duas vezes
create table if not exists public.whatsapp_envios (
  contato_id uuid not null references public.whatsapp_contatos(id) on delete cascade,
  -- 'AAAA-MM-DD:resumo-07', 'AAAA-MM-DD:lembrete-12' ou 'AAAA-MM-DD:antes'
  chave text not null,
  tipo text not null check (tipo in ('resumo-07', 'lembrete-12', 'antes')),
  situacao text not null default 'enviando' check (situacao in ('enviando', 'enviado', 'falhou', 'pulado')),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  erro text,
  primary key (contato_id, chave)
);
create index if not exists whatsapp_envios_criado_em on public.whatsapp_envios (criado_em);

-- 3. Estado do serviço (uma linha só): o site mostra se o WhatsApp está conectado
create table if not exists public.whatsapp_estado (
  id smallint primary key default 1 check (id = 1),
  conectado boolean not null default false,
  desde timestamptz,
  batimento_em timestamptz,
  ultimo_envio_em timestamptz,
  ultimo_erro text
);
insert into public.whatsapp_estado (id) values (1) on conflict do nothing;

alter table public.whatsapp_envios enable row level security;
alter table public.whatsapp_estado enable row level security;

drop policy if exists whatsapp_envios_super on public.whatsapp_envios;
create policy whatsapp_envios_super on public.whatsapp_envios
  for select to authenticated using (public.is_super());

drop policy if exists whatsapp_estado_super on public.whatsapp_estado;
create policy whatsapp_estado_super on public.whatsapp_estado
  for select to authenticated using (public.is_super());

-- o Supabase dá tudo a anon e authenticated em tabela nova: aqui fica só a leitura
revoke all on public.whatsapp_envios from anon, authenticated;
revoke all on public.whatsapp_estado from anon, authenticated;
grant select on public.whatsapp_envios to authenticated;
grant select on public.whatsapp_estado to authenticated;

-- 4. Trocar o número de um contato não passa a autorização adiante: o número novo não mandou ATIVAR
create or replace function public.whatsapp_contato_troca_numero() returns trigger
language plpgsql as $$
begin
  if new.telefone is distinct from old.telefone then
    new.confirmado_em := null;
    new.confirmado_por := null;
    new.jid := null;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_contato_troca_numero on public.whatsapp_contatos;
create trigger whatsapp_contato_troca_numero
  before update of telefone on public.whatsapp_contatos
  for each row execute function public.whatsapp_contato_troca_numero();
