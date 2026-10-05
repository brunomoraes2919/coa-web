-- COA WEB — ADMINISTRADOR+ e administradores com fazendas e categorias restritas.
-- Rodar UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar nada).
-- Depende de: tabelas do COA WEB (perfis, usuario_fazendas, fazendas), supabase/0001_usuario_categorias.sql
-- e dos scripts 0001 do Mapas e do Acompanhamento (funções mapas_* e acomp_*).
--
-- O que muda:
--   * perfis.super          -> o ADMINISTRADOR+ (continua com perfil 'admin'; a marca só é dada aqui,
--                              pelo SQL Editor — nenhuma chamada do site consegue dar nem tirar);
--   * perfis.todas_fazendas -> administrador comum vê todas as fazendas (padrão) ou só as que o
--                              ADMINISTRADOR+ liberar em usuario_fazendas;
--   * o administrador comum só gerencia COLABORADORES e só libera a eles as fazendas e categorias
--     que ele mesmo tem; quem mexe em administradores é o ADMINISTRADOR+.
--
-- ATENÇÃO: este script redefine mapas_pode_ver, acomp_pode_ver_unidade e a regra de leitura de
-- mapas_plantio_pims. Se os scripts 0001 do Mapas ou do Acompanhamento forem rodados de novo,
-- rode este em seguida.

-- ------------------------------------------------------------------------------------------------
-- 1. Colunas
-- ------------------------------------------------------------------------------------------------
-- Só na PRIMEIRA vez (enquanto a coluna super ainda não existe): todo administrador começa com as
-- cinco categorias. Até aqui o site não olhava as categorias de administrador (e apagava as linhas
-- ao salvar um), então podia haver administrador sem nenhuma. Rodar o script de novo não devolve
-- o que o ADMINISTRADOR+ tiver tirado depois.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'perfis' and column_name = 'super'
  ) then
    insert into public.usuario_categorias (usuario_id, categoria)
    select p.id, c.categoria
    from public.perfis p
    cross join (values ('algodao'), ('mecanizadas'), ('mapas'), ('acompanhamento'), ('sat')) as c(categoria)
    where p.perfil = 'admin'
    on conflict do nothing;
  end if;
end $$;

alter table public.perfis add column if not exists super boolean not null default false;
alter table public.perfis add column if not exists todas_fazendas boolean not null default true;

-- ------------------------------------------------------------------------------------------------
-- 2. Funções de apoio (security definer: leem perfis sem depender das regras de quem chama)
-- ------------------------------------------------------------------------------------------------

-- quem está logado é o ADMINISTRADOR+?
create or replace function public.is_super()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p where p.id = auth.uid() and p.perfil = 'admin' and p.super
  );
$$;

-- quem está logado é administrador SEM restrição de fazendas (ou o ADMINISTRADOR+)?
create or replace function public.admin_ve_tudo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid() and p.perfil = 'admin' and (p.super or p.todas_fazendas)
  );
$$;

-- o usuário alvo é um colaborador (nunca um administrador)?
create or replace function public.eh_colaborador(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis p where p.id = p_usuario and p.perfil = 'colaborador' and not p.super
  );
$$;

-- quem está logado tem esta categoria liberada?
create or replace function public.tem_categoria(p_categoria text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super() or exists (
    select 1 from public.usuario_categorias uc
    where uc.usuario_id = auth.uid() and uc.categoria = p_categoria
  );
$$;

revoke all on function public.is_super() from public, anon;
revoke all on function public.admin_ve_tudo() from public, anon;
revoke all on function public.eh_colaborador(uuid) from public, anon;
revoke all on function public.tem_categoria(text) from public, anon;
grant execute on function public.is_super() to authenticated;
grant execute on function public.admin_ve_tudo() to authenticated;
grant execute on function public.eh_colaborador(uuid) to authenticated;
grant execute on function public.tem_categoria(text) to authenticated;

-- ------------------------------------------------------------------------------------------------
-- 3. Quem vê qual fazenda: "admin vê todas" passa a ser "admin sem restrição vê todas"
-- ------------------------------------------------------------------------------------------------

-- COA WEB (fazendas, talhoes)
create or replace function public.tem_acesso_fazenda(fid bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_ve_tudo() or exists (
    select 1 from public.usuario_fazendas where usuario_id = auth.uid() and fazenda_id = fid
  );
$$;

-- Mapas (e Locks SAT, que lê o cadastro do Mapas)
create or replace function public.mapas_pode_ver(p_coa_fazenda_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_ve_tudo()
      or (
        p_coa_fazenda_id is not null
        and exists (
          select 1 from public.perfis p where p.id = auth.uid()
        )
        and exists (
          select 1
          from public.usuario_fazendas uf
          where uf.usuario_id = auth.uid()
            and uf.fazenda_id = p_coa_fazenda_id
        )
      );
$$;

-- Acompanhamento Operacional
create or replace function public.acomp_pode_ver_unidade(p_unidade text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_ve_tudo()
      or exists (
        select 1
        from public.mapas_fazendas f
        where upper(f.unidade_pims) = upper(p_unidade)
          and public.mapas_pode_ver(f.coa_fazenda_id)
      );
$$;

drop policy if exists mapas_plantio_pims_select on public.mapas_plantio_pims;
create policy mapas_plantio_pims_select on public.mapas_plantio_pims
  for select to authenticated
  using (
    (select public.admin_ve_tudo())
    or exists (
      select 1
      from public.mapas_fazendas f
      where upper(f.unidade_pims) = upper(mapas_plantio_pims.unidade)
        and public.mapas_pode_ver(f.coa_fazenda_id)
    )
  );

-- cadastro de fazendas do COA WEB: alterar e remover só as que o administrador vê; criar, só sem restrição
alter policy "admin atualiza fazendas" on public.fazendas
  using (public.is_admin() and public.tem_acesso_fazenda(id));
alter policy "admin remove fazendas" on public.fazendas
  using (public.is_admin() and public.tem_acesso_fazenda(id));
alter policy "admin gerencia fazendas" on public.fazendas
  with check (public.admin_ve_tudo());

-- ------------------------------------------------------------------------------------------------
-- 4. perfis: só o ADMINISTRADOR+ mexe em administradores; a marca não muda pelo site
-- ------------------------------------------------------------------------------------------------
create or replace function public.perfis_protege_admins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eu uuid := auth.uid();
  eu_super boolean;
begin
  -- SQL Editor, chave de serviço e o cadastro automático do login (sem usuário logado): livre
  if eu is null then
    return coalesce(new, old);
  end if;

  -- a marca ADMINISTRADOR+ nunca muda por uma chamada do site, nem pelo próprio
  if tg_op = 'INSERT' and new.super then
    raise exception 'A marca ADMINISTRADOR+ só pode ser dada pelo SQL Editor.';
  end if;
  if tg_op = 'UPDATE' and (new.super is distinct from old.super or (old.super and new.perfil <> 'admin')) then
    raise exception 'A marca ADMINISTRADOR+ só pode ser alterada pelo SQL Editor.';
  end if;
  if tg_op = 'DELETE' and old.super then
    raise exception 'O perfil ADMINISTRADOR+ não pode ser removido pelo site.';
  end if;

  select exists (
    select 1 from public.perfis p where p.id = eu and p.perfil = 'admin' and p.super
  ) into eu_super;
  if eu_super then
    return coalesce(new, old);
  end if;

  -- administrador comum: só colaboradores
  if tg_op in ('UPDATE', 'DELETE') and old.perfil <> 'colaborador' then
    raise exception 'Só o ADMINISTRADOR+ altera ou remove administradores.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.perfil <> 'colaborador' then
    raise exception 'Só o ADMINISTRADOR+ cria ou promove administradores.';
  end if;
  if tg_op = 'UPDATE' and new.todas_fazendas is distinct from old.todas_fazendas then
    raise exception 'Só o ADMINISTRADOR+ altera a restrição de fazendas.';
  end if;
  if tg_op = 'INSERT' then
    new.todas_fazendas := true;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists perfis_protege_admins on public.perfis;
create trigger perfis_protege_admins
  before insert or update or delete on public.perfis
  for each row execute function public.perfis_protege_admins();

-- ------------------------------------------------------------------------------------------------
-- 5. Quem grava as fazendas e as categorias de outro usuário
-- ------------------------------------------------------------------------------------------------
-- ADMINISTRADOR+: qualquer usuário. Administrador comum: só colaboradores, e só o que ele mesmo tem.
drop policy if exists "admin gerencia permissoes" on public.usuario_fazendas;
create policy "admin gerencia permissoes" on public.usuario_fazendas
  for all
  using (
    public.is_super()
    or (public.is_admin() and public.eh_colaborador(usuario_id) and public.tem_acesso_fazenda(fazenda_id))
  )
  with check (
    public.is_super()
    or (public.is_admin() and public.eh_colaborador(usuario_id) and public.tem_acesso_fazenda(fazenda_id))
  );

drop policy if exists usuario_categorias_inserir on public.usuario_categorias;
create policy usuario_categorias_inserir on public.usuario_categorias
  for insert to authenticated
  with check (
    public.is_super()
    or (public.mapas_eh_admin() and public.eh_colaborador(usuario_id) and public.tem_categoria(categoria))
  );

drop policy if exists usuario_categorias_apagar on public.usuario_categorias;
create policy usuario_categorias_apagar on public.usuario_categorias
  for delete to authenticated
  using (
    public.is_super()
    or (public.mapas_eh_admin() and public.eh_colaborador(usuario_id) and public.tem_categoria(categoria))
  );

-- ------------------------------------------------------------------------------------------------
-- 6. Dar a marca ADMINISTRADOR+ (rodar à parte, no SQL Editor, com o e-mail de quem será)
-- ------------------------------------------------------------------------------------------------
-- update public.perfis set super = true, todas_fazendas = true
--  where email = '<e-mail do ADMINISTRADOR+>' and perfil = 'admin';
