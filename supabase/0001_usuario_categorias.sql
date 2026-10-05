-- COA WEB — categorias (módulos) liberadas por usuário.
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- O administrador vê todas as categorias; o colaborador, só as que estiverem aqui.
-- A proteção dos dados continua sendo por fazenda (usuario_fazendas): esta tabela só decide
-- quais categorias o site mostra para cada usuário.

create table if not exists public.usuario_categorias (
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  categoria text not null check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat')),
  primary key (usuario_id, categoria)
);

alter table public.usuario_categorias enable row level security;

-- cada um lê as suas; o administrador lê e altera todas
drop policy if exists usuario_categorias_ler on public.usuario_categorias;
create policy usuario_categorias_ler on public.usuario_categorias
  for select to authenticated
  using (usuario_id = auth.uid() or public.mapas_eh_admin());

drop policy if exists usuario_categorias_inserir on public.usuario_categorias;
create policy usuario_categorias_inserir on public.usuario_categorias
  for insert to authenticated
  with check (public.mapas_eh_admin());

drop policy if exists usuario_categorias_apagar on public.usuario_categorias;
create policy usuario_categorias_apagar on public.usuario_categorias
  for delete to authenticated
  using (public.mapas_eh_admin());

grant select, insert, delete on public.usuario_categorias to authenticated;

-- quem já existe começa com todas as categorias (ninguém perde acesso ao rodar este script)
insert into public.usuario_categorias (usuario_id, categoria)
select p.id, c.categoria
from public.perfis p
cross join (values ('algodao'), ('mecanizadas'), ('mapas'), ('acompanhamento'), ('sat')) as c(categoria)
on conflict do nothing;

-- o site acompanha as mudanças na hora
do $$
begin
  alter publication supabase_realtime add table public.usuario_categorias;
exception
  when duplicate_object then null;
end $$;
