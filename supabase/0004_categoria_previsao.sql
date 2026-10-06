-- COA WEB — categoria nova "Previsão do Tempo" (chave 'previsao') nas categorias por usuário.
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
--
-- A tabela usuario_categorias só aceita as chaves da lista abaixo. Sem este script o ADMINISTRADOR+
-- já vê a categoria (ele vê todas), mas a página Usuários não consegue liberá-la para mais ninguém.
-- O módulo não tem tabela própria: lê as fazendas e os limites do cadastro do Mapas
-- (mapas_fazendas, mapas_talhoes), com a mesma proteção por fazenda de sempre.

alter table public.usuario_categorias drop constraint if exists usuario_categorias_categoria_check;
alter table public.usuario_categorias add constraint usuario_categorias_categoria_check
  check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat', 'previsao'));

-- Ninguém ganha a categoria sozinho: o ADMINISTRADOR+ marca "Previsão do Tempo" na página Usuários.
-- Para liberar de uma vez para todos os usuários que existem hoje, rode também (opcional):
--
--   insert into public.usuario_categorias (usuario_id, categoria)
--   select p.id, 'previsao' from public.perfis p
--   on conflict do nothing;
