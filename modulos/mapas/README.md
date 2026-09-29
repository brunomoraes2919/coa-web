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
- Histórico dos mapas gerados (cópia em PNG de 150 dpi, que pode ser reaberta, atualizada ou salva como novo mapa).

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
- O backup em JSON não leva as imagens PNG do histórico: depois de importar, o cartão do mapa mostra
  "PNG não disponível"; abra o mapa e use **Atualizar este mapa** para gerar a imagem de novo.

## Modo Supabase (dados compartilhados entre usuários)

1. Crie um projeto em [supabase.com](https://supabase.com) (o plano gratuito atende).
2. No projeto, abra **SQL Editor**, cole o conteúdo de `supabase/migrations/0001_init.sql` e execute.
   O script cria as tabelas (`fazendas`, `talhoes`, `safras`, `plantios`, `mapas`), as regras de acesso
   (RLS: só usuário logado lê e grava) e o bucket privado `mapas`, onde ficam os PNGs. **Depois rode
   também `supabase/migrations/0002_plantio_pims.sql`** (obrigatória: colunas do PIMS e tabela
   `areas_cultura`; pode ser reexecutada sem erro, e bancos criados antes dela mantêm os dados).
3. Em **Authentication → Sign In / Providers** (em painéis mais antigos: **Authentication → Providers →
   Email**), mantenha o e-mail habilitado e **desative "Allow new users to sign up"**. Isso é obrigatório:
   as regras do banco liberam os dados para qualquer usuário com login, e a URL e a chave anon ficam no
   site publicado; com o cadastro aberto, qualquer pessoa poderia criar uma conta e ver ou alterar os dados.
   Cadastre os usuários do COA em **Authentication → Users → Add user**.
4. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
5. No app, abra **Configurações**, escolha *Supabase*, cole a URL e a chave, clique em
   **Testar conexão** e salve. Ou, para já publicar configurado, use os secrets do GitHub (abaixo).

Para levar o que foi cadastrado no modo local: em **Configurações → Exportar backup** (no modo local),
depois troque para o Supabase, faça login e use **Importar backup**. Para começar do cadastro padrão,
faça login e use **Configurações → Importar cadastro padrão**.

**Espaço no plano gratuito:** o histórico guarda cada mapa como PNG de 150 dpi (≈ 4 MB por mapa A3, mais a
miniatura). O Storage gratuito tem 1 GB, o que dá **cerca de 250 mapas**; exclua mapas antigos do histórico
quando precisar de espaço. Para um PNG em 300 ou 600 dpi, abra o mapa e use **Baixar PNG** (o arquivo vai
para o seu computador, não para o histórico).

### Atualizando uma instalação existente

Quem já usa o app com o Supabase precisa **rodar `supabase/migrations/0002_plantio_pims.sql` no SQL
Editor antes de publicar esta versão** (antes do push que dispara o deploy). Sem ela, o app avisa "Banco
desatualizado: rode a migração supabase/migrations/0002_plantio_pims.sql" ao abrir o plantio ou as áreas
da cultura; o plantio manual continua aparecendo no editor, mas as áreas da cultura e as colunas do PIMS
não. A migração pode ser reexecutada sem erro e mantém os dados.

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
token exposto. Por isso uma rotina do GitHub Actions consulta o PIMS e publica o resultado como um
arquivo do site:

```
GitHub Actions (1×/h) ──AGROVEX_TOKEN──▶ Agrovex (PIMS) ──▶ public/dados/plantio.json ──▶ deploy do site
```

1. **Secret**: em **Settings → Secrets and variables → Actions**, crie `AGROVEX_TOKEN` com o token do
   Agrovex. Ele nunca vai para o código nem para o site; sem ele a rotina só avisa e termina.
2. **Workflow** `.github/workflows/plantio.yml`: roda a cada hora (`0 * * * *`) e também sob demanda
   (**Actions → Sincronizar plantio → Run workflow**). Gera o `plantio.json`, faz commit só se mudou e
   dispara o deploy do site.
3. **No seu computador**: `AGROVEX_TOKEN=... npm run plantio` (no PowerShell:
   `$env:AGROVEX_TOKEN='...'; npm run plantio`) atualiza `public/dados/plantio.json`. As safras
   consultadas ficam em `scripts/plantio.config.json` (padrão: as do ano-safra atual e do seguinte, sem as
   administrativas).
4. **Modo Supabase**: rode antes a migração `supabase/migrations/0002_plantio_pims.sql` (veja acima).
5. **Rotina parada**: o GitHub **desativa os workflows agendados depois de 60 dias sem atividade no
   repositório** (vale para repositórios públicos; confira na aba Actions). Se o plantio parar de
   atualizar, abra **Actions → Sincronizar plantio** e clique em **Enable workflow**.
6. **Histórico**: cada mudança do `plantio.json` vira um commit, então o histórico do repositório cresce
   ao longo da safra (dezenas de commits por dia no auge do plantio). É esperado; o arquivo em si é pequeno.

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
supabase/      scripts SQL do banco (0001_init, 0002_plantio_pims)
scripts/       sincronizar-plantio.mjs (PIMS → plantio.json), gerar-seed.mjs, gerar-paletas.mjs
public/dados/  plantio.json (gerado pela rotina) e seed/ (cadastro padrão)
docs/          design e plano de implementação
```

Paletas: `npm run paletas` regenera `src/lib/palettes.data.json` a partir da pasta
`09.COA/Estilos/Estilos mapa de chuva` do OneDrive.
