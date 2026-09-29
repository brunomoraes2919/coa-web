# Módulo MAPAS no COA WEB — Design

Data: 28/09/2026 · Status: aprovado pelo usuário (respostas de 28/09: categoria "MAPAS" com a
subcategoria "Mapa de Chuva" e espaço para outras no futuro; permissões iguais às do COA WEB;
plantio do PIMS automático a cada hora).

## Objetivo

O Mapa de Chuva deixa de ser um site separado e vira a primeira subcategoria da nova categoria
**MAPAS** do COA WEB (repositório `brunomoraes2919/coa-web`, publicado pela Vercel em
`coa-web-teal.vercel.app` e pelo GitHub Pages, os dois a partir de `main`, sem etapa de build).
Usa o login, os perfis (`admin` / `colaborador`), a permissão por fazenda (`usuario_fazendas`)
e o Supabase do COA WEB. Os dados da Locks (limites, áreas de cultura, plantio) passam a
exigir login; nada disso fica em arquivo público do site.

## O COA WEB hoje (o que o módulo precisa respeitar)

- Um único `index.html` (HTML/CSS/JS puro, supabase-js v2 por CDN, cliente `sb` com a chave
  de sessão padrão `sb-<ref>-auth-token`).
- Fluxo: login → tela de categorias (Algodão, Mecanizadas, Administração) → casca do app com
  menu lateral (`#nav-<categoria>`, grupos com "eyebrow" e `.nav-btn[data-page]`) e páginas
  `section.page[data-page]`; `irPara(pagina)` troca a página; `.admin-only` some para quem não é
  admin; `#sb-fazenda` no topo do menu escolhe a fazenda.
- Tabelas do COA WEB: `fazendas (id integer, nome)`, `talhoes` (tabular, sem geometria),
  `safras`, `variedades`, `perfis (id uuid, nome, email, perfil 'admin'|'colaborador')`,
  `usuario_fazendas (usuario_id uuid, fazenda_id integer)`. A segurança é feita por RLS.
- O cadastro público de contas está ligado (o COA WEB cria usuários com `signUp`), então
  **"qualquer autenticado" não é uma regra segura**: toda regra do módulo exige perfil.
- As mesmas 7 fazendas existem nos dois lados (Dourado, Nebraska, Globo, Guapirama, Siriema,
  SM3, Tres Flechas).

## Estrutura no repositório coa-web

```
index.html                     COA WEB (ganha a categoria MAPAS)
.nojekyll                      o Pages não passa pelo Jekyll (pastas/arquivos com "_" funcionam)
mapas/                         build estático do módulo (gerado, commitado; Vercel/Pages servem direto)
modulos/mapas/                 código-fonte do módulo (o antigo mapa-chuva-coa, sem o histórico git
                               e sem dados da Locks: seed, plantio.json, dados-teste e dados-fonte
                               ficam fora do git)
modulos/mapas/supabase/coa-web/0001_mapas.sql   script único para o Supabase do COA WEB
.github/workflows/plantio-pims.yml              rotina horária do PIMS
```

`npm run publicar` (em `modulos/mapas`) roda testes, tipos e build com as variáveis do COA WEB
e grava o resultado em `../../mapas/`. O repositório antigo `mapa-chuva-coa` fica só local,
como arquivo.

## Categoria MAPAS no COA WEB

- Cartão **Mapas** na tela de categorias (todos com perfil).
- Menu lateral `#nav-mapas`:
  - eyebrow **Mapa de Chuva** → *Novo mapa*, *Mapas salvos*;
  - eyebrow **Cadastros** (`admin-only`) → *Fazendas e shapes*, *Safras e plantio*.
  Futuras subcategorias entram como novos eyebrows; os cadastros são compartilhados por elas.
- Uma página `section.page[data-page="mapas"]` com um `iframe` de
  `mapas/index.html?embed=1#/<rota>`, criado na primeira entrada e mantido depois (não recarrega
  a cada clique). Os botões do menu trocam o hash do iframe; o título do topo segue a rota.
- Mesma origem → o iframe usa a sessão que o COA WEB já abriu.
- Fazenda do topo do menu (`#sb-fazenda`) → `postMessage({ tipo: 'coa-fazenda', id, nome })`
  para o iframe; o *Novo mapa* pré-seleciona a fazenda de mapa ligada a esse id.
- O módulo avisa a rota atual ao COA WEB (`{ tipo: 'mapas-rota', rota, titulo }`) para
  destacar o botão certo e trocar o título.
- Mensagens só são aceitas da mesma origem (`event.origin === location.origin`).

## O módulo em modo embutido (`?embed=1`)

- Sem cabeçalho nem navegação próprios; ocupa a área de conteúdo do COA WEB.
- Sem tela de login: sem sessão → aviso "Entre pelo COA WEB" com link para `../index.html`.
- Sem tela de configuração do Supabase: o build de produção fixa a URL e a chave anon do COA
  WEB (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) e o modo Supabase. O modo local
  (IndexedDB) continua existindo para desenvolvimento e testes.
- Lê `perfis.perfil` do usuário: colaborador não vê os cadastros nem botões de editar/excluir
  (a garantia real é o RLS).
- Aberto fora do iframe (`mapas/` direto), funciona igual, com um link "← COA WEB".

## Banco (Supabase do COA WEB)

Script `0001_mapas.sql`, idempotente, que **só cria objetos novos com prefixo `mapas_`** e nunca
altera tabelas, funções ou regras que já existem.

| Tabela | Conteúdo |
|---|---|
| `mapas_fazendas` | as colunas atuais de `fazendas` do módulo + `coa_fazenda_id integer references public.fazendas(id) on delete set null` |
| `mapas_talhoes` | = `talhoes` do módulo (geometria GeoJSON em jsonb) |
| `mapas_safras` | = `safras` do módulo |
| `mapas_plantios` | = `plantios` (plantio marcado à mão) |
| `mapas_areas_cultura` | = `areas_cultura` |
| `mapas_chuva` | mapas de chuva salvos (= `mapas` do módulo) |
| `mapas_plantio_pims` | `(safra text, unidade text, gerado_em timestamptz, talhoes jsonb, pk (safra, unidade))` |

Bucket privado `mapas-chuva` (PNG/JPEG e miniatura dos mapas salvos).

Funções `mapas_eh_admin()` e `mapas_pode_ver(coa_fazenda_id integer)` (`security definer`,
`stable`, `search_path` fixo): admin = `perfis.perfil = 'admin'`; colaborador = existe
`usuario_fazendas (usuario_id = auth.uid(), fazenda_id = coa_fazenda_id)`. Fazenda de mapa sem
vínculo (`coa_fazenda_id` nulo) → só admin.

Regras (RLS):
- Cadastros (`mapas_fazendas`, `mapas_talhoes`, `mapas_areas_cultura`, `mapas_plantios`):
  leitura por `mapas_pode_ver` da fazenda; escrita só admin.
- `mapas_safras`: leitura por quem tem perfil; escrita só admin.
- `mapas_chuva`: leitura, gravação e exclusão por quem pode ver a fazenda do mapa.
- `mapas_plantio_pims`: leitura se o usuário pode ver alguma fazenda de mapa com essa
  `unidade_pims` (admin vê tudo); **sem regra de escrita** — só a rotina, com a chave de
  serviço, grava.
- Storage `mapas-chuva`: ler/excluir se o mapa dono do arquivo é visível; enviar para quem tem
  perfil.

Antes de publicar, uma consulta **só de leitura** confere as regras de `perfis` e
`usuario_fazendas`: se um colaborador puder alterar o próprio `perfil`, isso é avisado ao
usuário (é uma brecha do COA WEB; corrigir fica para ele decidir).

## Cadastro padrão (7 fazendas + áreas de soja 26/27)

- `cadastro-padrao-mapas.zip` (seed.json + GeoJSONs), gerado localmente e **nunca publicado**.
- Tela de admin *Importar cadastro padrão*: escolhe o zip e grava tudo pelo repositório
  Supabase (com a sessão do admin, respeitando o RLS). Cada fazenda é ligada à do COA WEB pelo
  nome normalizado (sem acento, caixa alta, espaços simples: `TRES FLECHAS` ↔ `Tres Flechas`);
  a tela da fazenda ganha um seletor "Fazenda no COA WEB" para ajustar à mão.
- O carregamento automático do seed continua só no modo local (desenvolvimento).

## Plantio do PIMS

- `sincronizar-plantio.mjs`: com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, faz upsert em
  `mapas_plantio_pims` (uma linha por safra × unidade) pela API REST; sem elas, grava o JSON
  local como hoje (desenvolvimento).
- Workflow horário no coa-web com os secrets `AGROVEX_TOKEN` e `SUPABASE_SERVICE_ROLE_KEY`;
  não faz commit nem deploy.
- O módulo, no modo Supabase, monta o mesmo `PlantioPimsArquivo` a partir das linhas visíveis
  (o RLS já filtra por fazenda); no modo local, lê o JSON.

## Mapas salvos

A cópia do histórico passa a ser **JPEG** 150 dpi, qualidade 0,9 (≈ 1 MB, antes PNG ≈ 4,4 MB):
o plano gratuito do Supabase tem 1 GB de storage. O download feito pelo editor continua PNG
no dpi escolhido; um mapa salvo pode ser reaberto e exportado de novo em PNG.

## Publicação

- Branch `modulo-mapas` no coa-web → a Vercel gera uma prévia → o usuário testa → merge em
  `main` só com o ok dele.
- Passos do usuário, guiados: (1) rodar o SQL no Supabase; (2) autorizar o envio para o GitHub
  (janela do Git Credential Manager); (3) importar o cadastro padrão (admin); (4) cadastrar os
  secrets no GitHub.

## Fora do escopo

Outras subcategorias de MAPAS; mudar permissões do COA WEB; migrar mapas salvos no modo local;
usar as tabelas `fazendas`/`talhoes` do COA WEB para geometria.

## Testes

- Vitest: detecção do modo embutido e mensagens (origem, formatos), nomes das tabelas no
  repositório Supabase (cliente simulado), montagem do plantio a partir das linhas, leitura do
  zip do cadastro padrão, ligação por nome, payload do upsert da rotina.
- SQL: revisão linha a linha (não há Postgres local) + teste real depois de rodado.
- Navegador: servir a raiz do coa-web localmente, entrar com o login do usuário (ele digita a
  senha), percorrer a categoria MAPAS e gerar um mapa com o cadastro importado.
