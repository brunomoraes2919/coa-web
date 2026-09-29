# Mapa de Chuva COA

Plataforma web do **Centro de Operações Agrícolas (COA) – Locks** para gerar mapas de precipitação
a partir do CSV exportado da ZEUS, sem precisar do QGIS.

- Cadastro dos shapes de talhões de cada fazenda, com escolha da coluna que dá nome ao talhão.
- Cadastro de safras (ex.: **SOJA 26/27**, com período de produção) e marcação dos talhões plantados.
- **Plantio automático do PIMS**: plantado, plantando e a plantar lidos do PIMS a cada hora e pintados
  no mapa (sem digitação), casados pelo código do talhão.
- **Cadastro padrão**: o app já vem com as sete unidades do COA, a safra SOJA 26/27 e as áreas de soja.
- Interpolação da chuva com **o mesmo modelo do QGIS** (`MAPA_CHUVA_V3_ATUAL.model3`): IDW do GRASS
  com potência 4, 12 vizinhos e pixel de 5 m, em UTM SIRGAS 2000, recortado pelos talhões com buffer de 10 m.
- Talhões plantados aparecem **quadriculados** (contorno laranja) sobre a interpolação, os que estão
  plantando com **hachura amarela** e os a plantar com **contorno tracejado cinza**.
- Tabela de chuva média, mínima e máxima por talhão, exportável para o Excel.
- Layout pronto na identidade visual do COA, com textos editáveis, e **PNG em 150, 300 ou 600 dpi**.
- Histórico dos mapas gerados (cópia em JPEG de 150 dpi, que pode ser reaberta, atualizada ou salva como novo
  mapa; para o PNG, reabra o mapa e baixe no dpi desejado).

## Módulo MAPAS no COA WEB

Este código fica em `modulos/mapas/` do repositório do COA WEB e é a subcategoria **Mapa de Chuva** da
categoria **MAPAS**. O COA WEB mostra o módulo num `iframe` da mesma origem
(`mapas/index.html?embed=1#/<rota>`), com o login, os perfis e o Supabase do COA WEB.

- **Desenvolvimento**: em `modulos/mapas`, `npm install` e `npm run dev` (modo local, dados no navegador,
  como antes). Para ver o modo embutido, abra `http://localhost:5173/?embed=1#/mapas/novo`.
- **Publicar**: `npm run publicar` roda os testes e o `tsc`, gera o build com `.env.coa-web` (modo
  Supabase fixo, com a URL e a chave anon do COA WEB) direto em `mapas/`, na raiz do repositório, e
  confere a saída com `scripts/verificar-publicacao.mjs` (tem `index.html`, não leva `public/dados/` e
  nenhum arquivo cita `service_role`). Depois, a pasta `mapas/` vai para o commit junto com o código.
- **Modo fixo** (`VITE_MODO_FIXO=supabase`, só no build publicado): ignora a configuração salva no
  navegador, não tem tela de Configurações (`/config` volta para os mapas) nem login próprio (sem sessão,
  a tela manda entrar pelo COA WEB) e não mostra "Sair" (a sessão é do COA WEB). Aberto fora do iframe
  (`mapas/` direto), mostra o menu do módulo com o link "← COA WEB".
- **Modo embutido** (`?embed=1`): sem cabeçalho nem menu próprios (o menu é o do COA WEB), com o fundo e
  o espaçamento do COA WEB. As mensagens `postMessage` só valem entre janelas da mesma origem: o COA WEB
  envia a fazenda do topo do menu (`{ tipo: 'coa-fazenda', id, nome }`) e o **Novo mapa** pré-seleciona
  a fazenda de mapa ligada a ela enquanto o editor está limpo (sem CSV e sem fazenda escolhida à mão); o
  módulo avisa a rota aberta (`{ tipo: 'mapas-rota', rota, titulo }`) para o COA WEB destacar o botão e
  trocar o título. Quem renova o token da sessão é o COA WEB.
- **Perfis** (`perfis.perfil` do COA WEB): o colaborador não vê os cadastros (Fazendas e Safras; se abrir
  o endereço de um deles, volta para os mapas com o aviso "Somente administradores…") nem os links para
  eles dentro do editor. Quem garante o acesso é o RLS do banco.
- **Cadastro padrão no COA WEB**: a publicação não leva `public/dados/`. Em `modulos/mapas`,
  `npm run pacote-seed` gera `cadastro-padrao-mapas.zip` (seed.json + GeoJSONs; dados da Locks, nunca vai
  para o git nem para a publicação); o admin usa **Fazendas → Importar cadastro padrão** e escolhe o zip.
  Cada unidade é ligada à fazenda do COA WEB de mesmo nome (sem acento e sem diferença de maiúsculas:
  `Três Flechas` ↔ `Tres Flechas`); o aviso final lista as que ficaram sem vínculo (só administradores as
  veem). Na tela da fazenda, o campo **Fazenda no COA WEB** ajusta o vínculo à mão; importar de novo não
  desfaz esse ajuste.

## Como testar agora (no seu computador)

Instale antes o **Node.js** (versão LTS, em [nodejs.org](https://nodejs.org/pt)): o `iniciar.bat` usa o
`npm` para instalar as dependências e gerar o site. Depois, dê dois cliques em **`iniciar.bat`**. Ele
instala o que falta, gera o site e abre `http://localhost:4173` no navegador.

Sem configurar nada, o app roda em **modo local**: os dados ficam salvos no próprio navegador
(IndexedDB). Para testar:

Na primeira abertura em modo local, o app carrega sozinho o **cadastro padrão** (as sete unidades, a
safra SOJA 26/27 e as áreas de soja; veja [Cadastro padrão](#cadastro-padrão)): dá para ir direto ao
passo 3. Para cadastrar outras fazendas:

1. **Fazendas → Cadastrar fazenda**: arraste o shape zipado (ex.: `Limites/Guapirama_V2.zip`) ou os
   arquivos `.shp`, `.dbf`, `.prj` e `.cpg` juntos. Também aceita KML e GeoJSON. Escolha a coluna do
   nome do talhão (ex.: `NOME`), a **coluna do código PIMS** (ex.: `COD`, `TH CODE`) e a **unidade no
   PIMS** (ex.: `SIRIEMA`), e salve.
2. **Safras → Nova safra**: crie `SOJA 26/27` com o período de produção. Clique na fazenda para abrir o
   mapa de plantio e marque os talhões plantados.
3. **Novo mapa**: escolha a fazenda e a safra, arraste o CSV da ZEUS, confira os PICs (inativos e sem
   leitura já vêm desmarcados), ajuste os textos e clique em **Baixar PNG**.

Para desenvolvimento: `npm install`, depois `npm run dev` (abre em `http://localhost:5173`). Os testes rodam
com `npm test`.

### Cuidados com o modo local

- **Cada endereço tem o seu próprio banco local.** `http://localhost:5173` (`npm run dev`),
  `http://localhost:4173` (`iniciar.bat`) e o site no GitHub Pages não enxergam os dados uns dos outros,
  mesmo no mesmo navegador. Para levar os dados de um para outro, use **Configurações → Exportar backup** e
  **Importar backup**.
- **O navegador pode apagar os dados** do site (limpeza de dados de navegação, falta de espaço em disco,
  modo anônimo). O app pede ao navegador para guardar os dados de forma persistente, mas isso não é
  garantido: **exporte o backup com frequência** (ex.: toda semana) e guarde o arquivo JSON numa pasta
  com cópia de segurança.
- O backup em JSON não leva as imagens do histórico: depois de importar, o cartão do mapa mostra
  "Imagem não disponível"; abra o mapa e use **Atualizar este mapa** para gerar a imagem de novo.

## Modo Supabase (Supabase do COA WEB)

Os dados ficam no mesmo projeto Supabase do COA WEB, em tabelas próprias do módulo, com o login e as
permissões do COA WEB.

1. No projeto Supabase do COA WEB, abra **SQL Editor**, cole o conteúdo de
   `supabase/coa-web/0001_mapas.sql` e execute. O script só cria objetos novos: as tabelas
   `mapas_fazendas`, `mapas_talhoes`, `mapas_safras`, `mapas_plantios`, `mapas_areas_cultura`,
   `mapas_chuva` (mapas salvos) e `mapas_plantio_pims` (plantio do PIMS), as regras de acesso (RLS) e o
   bucket privado `mapas-chuva`, onde ficam as imagens do histórico. Não altera nem apaga nada do COA
   WEB e pode ser executado de novo sem erro, mantendo os dados. Antes de publicar, rode também
   `supabase/coa-web/verificar-permissoes.sql` (só leitura) para conferir as regras do COA WEB.
2. **Quem vê o quê** (tabelas `perfis` e `usuario_fazendas` do COA WEB): o admin vê e altera tudo; o
   colaborador vê as fazendas liberadas para ele e nelas salva e exclui mapas de chuva; fazendas, talhões,
   safras e plantio só o admin altera. Cada fazenda de mapa é ligada a uma fazenda do COA WEB; sem esse
   vínculo, só o admin a vê.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. No app, abra **Configurações**, escolha *Supabase*, cole a URL e a chave, salve e entre com o e-mail
   e a senha do COA WEB.

Para levar o que foi cadastrado no modo local: em **Configurações → Exportar backup** (no modo local),
depois troque para o Supabase, faça login como admin e use **Importar backup**. Para começar do cadastro
padrão, faça login como admin e use **Configurações → Importar cadastro padrão**.

**Espaço no plano gratuito:** o histórico guarda cada mapa como JPEG de 150 dpi (≈ 1 MB por mapa A3, mais
a miniatura PNG). O Storage gratuito tem 1 GB, o que dá **cerca de 1000 mapas**; exclua mapas antigos do
histórico quando precisar de espaço. Para um PNG em 150, 300 ou 600 dpi, abra o mapa e use **Baixar PNG**
(o arquivo vai para o seu computador, não para o histórico). Mapas salvos antes em PNG continuam abrindo;
ao atualizar um deles, a cópia passa a ser JPEG e o PNG antigo é apagado.

**Projeto pausado:** no plano gratuito, o Supabase pausa o projeto depois de um período sem uso (cerca de
uma semana). Se o app parar de conectar, entre em [supabase.com](https://supabase.com), abra o projeto e
clique em **Restore project**; os dados continuam lá.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `mapa-chuva-coa`) e envie este projeto:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/mapa-chuva-coa.git
   git push -u origin master
   ```
2. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. (Opcional) **Settings → Secrets and variables → Actions**: crie `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` para o site já abrir conectado ao Supabase.
4. Cada `push` roda os testes, gera o site e publica em `https://SEU-USUARIO.github.io/mapa-chuva-coa/`.

GitHub Pages em repositório **privado** exige plano pago (Pro, Team ou Enterprise). Os únicos dados da
Locks no repositório (e no site publicado) são o **cadastro padrão** (`public/dados/seed/`: limites das
unidades e áreas de soja) e o **plantio do PIMS** (`public/dados/plantio.json`); CSVs e mapas ficam no
navegador ou no Supabase. Se o repositório for público, esses dois também ficam públicos.

## Plantio automático do PIMS

O site é estático e o Agrovex (que dá acesso ao PIMS) não aceita chamadas do navegador nem pode ter o
token exposto. Por isso uma rotina do GitHub Actions, na raiz do coa-web, consulta o PIMS e grava o
resultado direto no Supabase (sem commit no repositório):

```
GitHub Actions (1×/h) ──AGROVEX_TOKEN──▶ Agrovex (PIMS) ──▶ upsert em mapas_plantio_pims (Supabase)
```

1. **Secrets** (no coa-web, **Settings → Secrets and variables → Actions**):
   - `AGROVEX_TOKEN`: o token do Agrovex. Nunca vai para o código nem para o site; sem ele a rotina só
     avisa e termina.
   - `SUPABASE_SERVICE_ROLE_KEY`: a chave de serviço (`service_role`) do Supabase do COA WEB — **não** é
     a chave anon. Em **supabase.com → o projeto do COA WEB → Project Settings → API**, seção
     "Project API keys": copie a chave marcada `service_role` (rótulo pode aparecer como "secret"
     também, formato novo `sb_secret_…`). Nunca use essa chave no app nem a exponha no site: ela ignora
     o RLS.
   - `SUPABASE_URL` **não** é secret: já vai fixo no workflow (é a mesma URL pública usada no
     `index.html`).
2. **Workflow** `.github/workflows/plantio-pims.yml` (raiz do repositório): roda a cada hora
   (`17 * * * *`) e também sob demanda (**Actions → Sincronizar plantio PIMS → Run workflow**). Falha com
   mensagem clara se algum dos dois secrets não estiver configurado. Não roda `npm ci` (o script não tem
   dependências) e não faz commit — só grava no Supabase.
3. **No seu computador**: sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` no ambiente, `AGROVEX_TOKEN=...
   npm run plantio` (no PowerShell: `$env:AGROVEX_TOKEN='...'; npm run plantio`) grava
   `public/dados/plantio.json` como antes (uso local/desenvolvimento). As safras consultadas ficam em
   `scripts/plantio.config.json` (padrão: as do ano-safra atual e do seguinte, sem as administrativas).
4. **Modo Supabase**: o app lê o plantio da tabela `mapas_plantio_pims` (criada por
   `supabase/coa-web/0001_mapas.sql`; veja acima), e não do `plantio.json`. A rotina faz upsert (uma
   linha por safra × unidade) e, depois, apaga as linhas que sumiram do PIMS (que não foram atualizadas
   nesta rodada).
5. **Rotina parada**: o GitHub **desativa os workflows agendados depois de 60 dias sem atividade no
   repositório** (vale para repositórios públicos; confira na aba Actions). Se o plantio parar de
   atualizar, abra **Actions → Sincronizar plantio PIMS** e clique em **Enable workflow**.

Regra da situação (por talhão × safra): **plantado** = plantio encerrado no PIMS ou área apontada ≥ 99% da
prevista; **plantando** = área apontada entre 0 e 99%; **a plantar** = sem apontamento.

Como o app usa o arquivo:

- O talhão do shape é casado com o PIMS pelo par **unidade no PIMS** (cadastro da fazenda) + **código do
  talhão** (coluna do código PIMS; normalizado dos dois lados: `TH 33A` → `033A`, `PIVÔ 02` → `02PIVO`).
  A safra é encontrada pelo **Nome no PIMS** (em Safras; vazio = o próprio nome, ex.: `SOJA 26/27`).
- **Safras → Plantio**: mostra "Plantio do PIMS de dd/mm/aaaa hh:mm", a situação, o % plantado, as datas e
  a variedade de cada talhão. Talhões sem registro no PIMS continuam com a marcação manual. Talhões
  plantados no PIMS sem polígono no shape aparecem num aviso.
- **Safras → Áreas da cultura**: importe o shape da cultura (ex.: soja 26/27) da fazenda; no mapa, essas
  áreas são pintadas no lugar dos talhões base (área sem registro no PIMS = a plantar).
- **Novo mapa**: "X plantados · Y plantando · Z a plantar (PIMS dd/mm hh:mm)", colunas Situação e % na
  tabela, e a legenda com as situações presentes e a data do plantio do PIMS. A estatística "área
  plantada" (plantado + plantando) usa as **áreas da cultura** quando a safra tem áreas importadas (cada
  área é medida no próprio polígono, inclusive subáreas como `032A` dentro do talhão `032`) e os talhões
  base quando não tem. Na tabela "Chuva por talhão", as áreas sem talhão base do mesmo código aparecem
  como linhas próprias, marcadas "(área da cultura)", com a chuva da própria área.
- Cada área da cultura pertence ao **talhão base que a contém** (pela posição, não pelo código): é isso
  que define o setor dela no filtro de setores e em qual quadro do mapa ela aparece.
- Sem `plantio.json` (ou sem internet), o app segue só com o plantio manual.

## Cadastro padrão

`public/dados/seed/` traz as sete unidades do COA (Dourado, Globo, Guapirama, Nebraska, Siriema com São
Miguel, SM3 e Três Flechas) com os limites dos talhões e a coluna do código PIMS já escolhida, a safra
**SOJA 26/27** (01/09/2026 a 31/08/2027) e as áreas de soja 26/27 de cada unidade (Três Flechas ainda sem
área de soja). É gerado por `npm run seed` a partir dos shapes originais.

- **Modo local**: carregado sozinho na primeira abertura (sem nenhuma fazenda), com o aviso "Cadastro
  padrão do COA carregado (7 unidades, safra SOJA 26/27)".
- **Configurações → Recarregar cadastro padrão** (local) ou **Importar cadastro padrão** (Supabase, com
  login): atualiza unidades, talhões e a safra sem apagar dados — nomes editados e plantios marcados são
  mantidos — e substitui as áreas da cultura dessas unidades na SOJA 26/27.

## Como a interpolação reproduz o QGIS

| Modelo QGIS (`MAPA_CHUVA_V3_ATUAL.model3`) | Plataforma |
|---|---|
| Tabela → pontos (`lat`, `lon`) | leitura do CSV da ZEUS (vírgula decimal, acentos, `;` ou `,`) |
| Reprojeção para SIRGAS 2000 / UTM 21S (EPSG:31981) | UTM SIRGAS 2000 com zona automática (21S nas fazendas atuais) |
| `native:buffer` 10 m dissolvido | talhões rasterizados e dilatados em 10 m |
| `grass7:v.surf.idw` potência 4, 12 pontos, célula 5 m | mesmo IDW: peso 1/d⁴ nos 12 PICs mais próximos, centro da célula |
| `gdal:cliprasterbymasklayer` | pixels fora da máscara ficam sem cor |
| Estilos `Precipitacao_*.qml` | as mesmas classes e cores, extraídas dos `.qml` do COA |

Os parâmetros (potência, vizinhos, pixel e buffer) podem ser alterados em **Avançado**, no editor.

## Layout: orientação, quadros e destaque dos PICs

Em **4. Aparência**, no editor:

- **Orientação**: *Automática* (padrão) escolhe retrato quando os talhões usados são bem mais altos que
  largos (altura/largura acima de 1,25) e paisagem nos demais casos; *Paisagem* e *Retrato* fixam a folha.
  Em paisagem o painel (legenda, textos e logo) fica ao lado do mapa; em retrato, numa faixa embaixo.
- **Quadros**: *Automático* (padrão) separa a fazenda em até 3 quadros quando os talhões formam blocos
  distantes e isso aproveita bem melhor a folha (ex.: Siriema e São Miguel); *Um quadro* força um mapa
  só; *Um por setor* faz um quadro para cada setor. Com vários quadros cada um é enquadrado sozinho e
  ganha um título; o arraste/zoom da prévia só funciona com um quadro.
- **Destaque do valor dos PICs**: contorno escuro (padrão), contorno vermelho, contorno verde COA ou
  etiqueta escura. Compare na prévia: o contorno escuro lê bem sobre qualquer cor; o vermelho destaca mais
  em mapas azuis e verdes.

Mapas salvos antes desta versão reabrem com orientação e quadros automáticos e o enquadramento refeito.

**Validação:** `npm run validar-grass` compara o IDW da plataforma com um raster real gerado no QGIS
(Três Flechas, dez/2023). Os dados de validação ficam em `dados-teste/`, fora do git.

## Estrutura

```
src/lib/       lógica pura e testada (CSV, shapes, projeção, raster, IDW, estatísticas, paletas)
src/worker/    interpolação em Web Worker
src/render/    desenho do layout em Canvas (a prévia e o PNG usam o mesmo código)
src/data/      persistência: IndexedDB (modo local) ou Supabase
src/pages/     telas
supabase/      scripts SQL do Supabase do COA WEB (coa-web/0001_mapas.sql, coa-web/verificar-permissoes.sql)
scripts/       sincronizar-plantio.mjs (PIMS → plantio.json), gerar-seed.mjs, gerar-paletas.mjs
public/dados/  plantio.json (gerado pela rotina) e seed/ (cadastro padrão)
docs/          design e plano de implementação
```

Paletas: `npm run paletas` regenera `src/lib/palettes.data.json` a partir da pasta
`09.COA/Estilos/Estilos mapa de chuva` do OneDrive.
