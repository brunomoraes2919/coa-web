# Montagens de Painel (TV do COA) — especificação

Data: 15/10/2026. Situação: aprovada pelo usuário em 15/10/2026 ("Revisei a especificação, está aprovada"). Ajustada no mesmo dia, ao escrever o plano (`2026-10-15-montagens-de-painel-plano.md`): função de conferência por `GET ?url=`, com os resultados `invalido` e `sem-acesso`; ações Duplicar/Apagar na cabeça da montagem (no lugar do menu "⋯"); cobertura sobre os sites da TV com a tecla I para mexer neles; arquivos `fonte.js` e `tv.css`.

## 1. Objetivo

Hoje a TV da sala do COA mostra quatro janelas de navegador arrumadas à mão (Acompanhamento em modo TV, John Deere Operations Center, radar, portal da ZEUS). O módulo novo **"Montagens de Painel"** do COA WEB substitui esse arranjo por uma página só, com a moldura e a identidade do COA:

1. você monta, em qualquer computador logado, **montagens com nome** (ex.: "Plantio", "Chuva e radar", "Colheita"), cada uma com uma divisão da tela e os sites de cada quadro;
2. escolhe **qual montagem vai para a TV naquele dia**;
3. a TV (`/painel/?tv=1`) mostra essa montagem numa **moldura única** (faixa no topo e separação entre quadros), com **rotação independente por quadro** e tempo próprio por site, e pega as mudanças sozinha, sem F5.

Decisões do usuário (15/10/2026):
- Divisões: **todas as 7** (4; 3A, 3B, 3C; 2A, 2B; tela cheia).
- Rotação: **tempo por site**, já preenchido com o tempo padrão do quadro.
- Mora **dentro do COA WEB** (categoria nova, login, configuração no banco).
- **Várias montagens com nome**, num módulo chamado "Montagens de Painel"; escolhe-se a do dia e os sites de cada quadro.
- Caminho para sites que bloqueiam: **só web** (nada instalado no Linux da TV). Esses sites ficam de fora.
- Moldura: **opção 1, faixa no topo**.
- Pedido explícito: visual de designer profissional.

## 2. Limite conhecido: sites que não abrem dentro do painel

O dono de cada site decide se ele pode aparecer dentro de outra página (cabeçalhos `X-Frame-Options` e `Content-Security-Policy: frame-ancestors`). Conferido em 15/10/2026:

| Site | Cabeçalho | Abre no painel? |
|---|---|---|
| COA WEB (Acompanhamento, Previsão…) | mesma origem | Sim |
| `embed.windy.com` (widget do Windy) | nenhum | Sim |
| `rainviewer.com/map.html` (radar) | `frame-ancestors *` | Sim |
| `operationscenter.deere.com` | `X-Frame-Options: DENY` + `frame-ancestors` só Deere | Não |
| `portal.zeusagro.com` | `X-Frame-Options: SAMEORIGIN` | Não |
| `www.windy.com` | `frame-ancestors 'self' *.windy.com` | Não |
| `zoom.earth` | `X-Frame-Options: SAMEORIGIN` | Não |

Na escolha "só web", John Deere, ZEUS e windy.com não entram nos quadros. Para isso não virar surpresa na TV, o módulo confere o site no momento em que ele é adicionado (seção 7). Se no futuro esses sites forem necessários, o caminho é uma extensão do Chrome no Linux da TV ou um navegador próprio (caminhos A e B da conversa), sem refazer esta página.

Outro limite: um site que deixa ser exibido mas exige login pode pedir o login dentro do quadro, porque o navegador trata os cookies dele como "de terceiros". A conferência não detecta isso; vale testar o site no quadro antes de deixá-lo na TV.

## 3. Visão geral

| Peça | Onde | O que faz |
|---|---|---|
| Módulo "Montagens de Painel" | `painel/index.html?embed=1` dentro da casca (`index.html`) | Lista, cria e edita montagens; põe uma na TV |
| Tela da TV | `painel/index.html?tv=1` (aba própria, tela cheia) | Mostra a montagem da TV com moldura e rotação |
| Lógica sem tela | `painel/logica.js` | Divisões, normalização da montagem, agenda da rotação, atalhos, data por extenso — testada com `node --test` |
| Conferência de site | `api/conferir-site.js` (função da Vercel) | Diz se um endereço abre dentro do painel |
| Banco | `supabase/0025_painel.sql` | Montagens, montagem da TV, categoria `painel` |

Arquivos novos (JS puro, sem build, no padrão de `previsao/` e `acompanhamento/`): `painel/index.html`, `painel/estilo.css`, `painel/tv.css`, `painel/config.js`, `painel/logica.js`, `painel/fonte.js` (dados: Supabase ou servidor local), `painel/editor.js`, `painel/tv.js`; testes em `modulos/painel/testes/*.test.mjs`; servidor local com dados fictícios em `modulos/painel/scripts/servidor-local.mjs` (com os cabeçalhos do `vercel.json`, lidos por `modulos/painel/scripts/vercel-cabecalhos.mjs`); `modulos/painel/README.md` com o passo a passo da TV (seção 11).

## 4. Divisões

Sete divisões, identificadas no banco por um código curto. Os quadros são numerados na ordem de leitura (esquerda→direita, cima→baixo).

| Código | Nome na tela | Quadros | Grade (CSS grid) |
|---|---|---|---|
| `4` | 4 · grade 2×2 | 4 | `1fr 1fr / 1fr 1fr` |
| `3a` | 3 · destaque + 2 | 3 | colunas `2fr 1fr`; Q1 ocupa as duas linhas à esquerda; Q2 em cima e Q3 embaixo, à direita |
| `3b` | 3 · três colunas | 3 | `1fr / 1fr 1fr 1fr` |
| `3c` | 3 · 2 em cima + 1 embaixo | 3 | `1fr 1fr / 1fr 1fr`; Q3 ocupa a linha de baixo inteira |
| `2a` | 2 · lado a lado | 2 | `1fr / 1fr 1fr` |
| `2b` | 2 · destaque + lateral | 2 | `1fr / 2fr 1fr` |
| `1` | Tela cheia | 1 | `1fr / 1fr` |

Toda montagem guarda **sempre 4 quadros**. A divisão só decide quantos aparecem (os primeiros N). Ao trocar de 4 para 2, os quadros 3 e 4 continuam guardados e voltam se a divisão voltar a 4; o editor mostra "Guardados fora da tela: Quadro 3 (2 sites), Quadro 4 (1 site)".

## 5. A TV: moldura e comportamento

### 5.1 Moldura (opção 1, faixa no topo)

Tudo dimensionado em `vh`/`vmin` com `clamp()`, para ficar proporcional de 1366×768 a 3840×2160 (lição do usuário: telas grandes; conferir em 1920 e 2560/4K). Fonte IBM Plex Sans; números com `tabular-nums`.

- **Fundo da moldura**: `--verde-escuro` #103632, liso, sem degradê. Margem externa ≈ 0,8 vmin; separação entre quadros ≈ 0,6 vmin, da mesma cor: a moldura é uma peça só.
- **Faixa do topo** (≈ 6,5 vh), em três partes:
  - esquerda: logo branca do COA (a mesma usada nos relatórios do Acompanhamento; ela já traz "Centro de Operações Agrícolas" e a marca da Locks, então não vai texto ao lado);
  - centro: ponto dourado (#F0B24A) e o nome da montagem (ex.: "Plantio · safra 26/27");
  - direita: relógio HH:MM grande, em branco, e embaixo a data por extenso ("Quinta-feira, 15 de outubro"), com a primeira letra maiúscula. Hora do computador da TV.
  - Linha dourada (#DB8A08) de 2 px separando a faixa dos quadros.
- **Etiqueta de cada quadro**: faixa fina (≈ 2,6 vh) da própria moldura, em cima do quadro, sem cobrir o site. À esquerda o nome do site; à direita "1/3" quando há rotação (dourado claro). Embaixo da etiqueta, uma linha dourada de 2 px que corre da esquerda para a direita até a próxima troca. Site fixo: sem contador e sem linha.
- **Quadros**: cantos de 4 px; o site ocupa o quadro inteiro.
- **Movimento**: troca de site com esmaecimento cruzado de 600 ms; nada de animação decorativa. Com `prefers-reduced-motion`, troca seca.
- O cursor some depois de 3 s parado.
- **A TV é para assistir**: uma cobertura transparente fica por cima dos sites (pega o mouse e o clique, que pede tela cheia). A tecla **I** (ou o botão "Mexer nos sites" da pílula que aparece ao mexer o mouse) tira a cobertura por 2 min, para fechar um aviso de cookies ou entrar num site; **F** pede tela cheia.

### 5.2 Telas de estado (no lugar de um quadro ou da tela toda, sempre com a moldura)

| Situação | O que aparece |
|---|---|
| Quadro sem site | No quadro: marca d'água da logo do COA e "Quadro vazio. Adicione sites em Montagens de Painel." |
| Nenhuma montagem na TV | Tela toda: "Nenhuma montagem na TV. Escolha uma em Montagens de Painel." |
| Sem login no computador | Tela toda: "Entre no COA WEB neste computador" e botão "Entrar", que abre o login (`/`) numa janela à parte (a aba da TV não sai do painel); a TV se recarrega a cada minuto e volta sozinha quando houver sessão. Recomendação no README: um login só da TV (o "Sair" do COA WEB encerra as sessões do usuário em todos os computadores) |
| Login sem a categoria | Tela toda: "Este login não tem acesso a Montagens de Painel." |
| Sem conexão (3 falhas seguidas) | Selo na faixa do topo: "Sem conexão desde 07:42". Os quadros seguem com o que tinham; o selo some na próxima consulta que der certo |

### 5.3 Rotação (cada quadro com seu relógio)

- A lista do quadro é percorrida em ordem e volta ao começo. Cada site fica o tempo dele (seção 6.3).
- **Pré-carregamento**: 8 s antes da troca, o próximo site começa a carregar num `iframe` escondido; na hora da troca entra com o esmaecimento, e o `iframe` antigo é removido. Se o site tem menos de 20 s, o próximo carrega logo depois da troca anterior. Se o próximo ainda não disparou `load` na hora da troca, a troca espera até 10 s e então acontece mesmo assim.
- Um site que volta na rotação abre de novo, com dados novos.
- **Site fixo** (sozinho no quadro): fica parado. Se o quadro tiver "recarregar a cada X", a recarga usa o mesmo pré-carregamento, sem tela branca.
- No máximo 2 `iframes` por quadro ao mesmo tempo (atual e próximo).
- `iframe` de todos os quadros: `sandbox="allow-scripts allow-same-origin allow-forms"` (o site não consegue tirar a TV do painel nem abrir janelas), `referrerpolicy="no-referrer"`, sem `allow` de permissões.

### 5.4 Atualização sem F5

- **Montagem**: a cada 60 s, uma consulta leve (`painel_tv` + `atualizado_em` da montagem). Se mudou, a TV relê a montagem e aplica:
  - divisão diferente: remonta a grade;
  - quadro com a lista igual (comparada pelo conteúdo): continua rodando, sem recarregar;
  - quadro com a lista diferente: recomeça no primeiro site.
- **Código do painel**: a cada 5 min, a TV relê `painel/index.html` (sem cache) e compara os `?v=` dos arquivos. Se mudaram, recarrega a página (mesmo padrão do Modo TV do Acompanhamento). Ao publicar mudança em `painel/`, trocar o `?v=` do arquivo alterado.
- **Tela cheia e tela acesa**: o primeiro clique pede tela cheia; Screen Wake Lock pedido e renovado quando a aba volta a ficar visível. No Linux da TV, o modo quiosque do Chrome dispensa o clique (seção 11).

## 6. O módulo "Montagens de Painel" (editor)

### 6.1 Casca

- Categoria nova `painel`, nome "Montagens de Painel", cartão na tela de categorias com ícone no tile dourado e a descrição "O que a TV do COA mostra, quadro por quadro".
- `CATEGORIAS` ganha `{ chave:'painel', nome:'Montagens de Painel', card:'card-painel' }`; `nav-painel` entra em todas as listas de `nav-*` do `index.html`; `entrarPainel()` segue o padrão de `entrarPrevisao()`; a página Usuários ganha a caixa da categoria.
- O módulo traz o próprio cabeçalho (título, descrição e ações numa barra só) e a casca esconde `.topbar` em `modo-painel`, como na Previsão e no Acompanhamento.
- O seletor de fazenda do menu lateral não tem efeito neste módulo, e o módulo não cria outro (regra do COA WEB: fazenda só no lateral).

### 6.2 Tela

- **Cabeçalho**: "Montagens de Painel" + "O que a TV do COA mostra, quadro por quadro". Ações: "Nova montagem" (secundário) e "Abrir na TV" (verde-escuro, o único botão cheio da tela), que abre `painel/index.html?tv=1` numa aba nova.
- **Coluna da esquerda — montagens**: a da TV primeiro, depois por nome. Cada item: nome, "4 quadros · 7 sites", e o selo dourado "Na TV hoje" ou o botão "Pôr na TV" (aparece ao passar o mouse e no item aberto).
- **Cabeça da montagem aberta**: o nome (editável ali mesmo, é o "renomear"), o selo "Na TV hoje" ou o botão "Pôr na TV", e os botões "Duplicar" e "Apagar". A montagem da TV não pode ser apagada ("Ponha outra montagem na TV antes de apagar esta"). Apagar pede confirmação num diálogo.
- "Nova montagem" cria "Nova montagem" (ou "Nova montagem 2", 3…) com a divisão `4` e quadros vazios; "Duplicar" cria "<nome> (cópia)". Os nomes não se repetem. Se nenhuma montagem estiver na TV, a primeira criada vai para a TV sozinha.
- **Área principal — montagem selecionada**:
  - nome editável no próprio título;
  - **Divisão**: 7 botões com o desenho em miniatura (dica com o nome); o atual com borda dourada;
  - **Prévia 16:9**: a moldura verde com os quadros da divisão. Cada quadro mostra o primeiro site, o tempo e "+N em rotação", "fixo" ou "vazio · clique para adicionar". Clicar seleciona o quadro (contorno dourado). A prévia é um desenho e não carrega os sites, para ficar leve;
  - "Guardados fora da tela" quando houver (seção 4).
- **Painel do quadro selecionado** ("Quadro 2 · rotação"):
  - "Tempo padrão do quadro" (seletor), usado em cada site novo;
  - lista de sites: alça de arrastar (muda a ordem), nome (editável), origem (host, ou "COA WEB · modo TV"), seletor de tempo, selo da conferência (✓ abre no painel / "não conferido"), remover ×;
  - com 1 site só: no lugar do tempo, "Fixo · recarregar a cada [seletor]";
  - botões "+ Do COA WEB" e "+ Endereço".
- **Salvamento automático**: 800 ms depois da última mudança. Situação no rodapé do painel: "Salvando…", "Salvo · a TV atualiza em até 1 min" ou "Não salvou · tentar de novo". Duas pessoas editando a mesma montagem: vale a última gravação.
- No celular a tela empilha (lista, prévia, quadro).

### 6.3 Tempos

- Tempo de um site (e tempo padrão do quadro): 15 s, 30 s, 45 s, 1 min, 2 min, 3 min, 5 min, 10 min, 15 min, 30 min. Padrão de quadro novo: 1 min.
- Recarregar site fixo: não recarrega (padrão), 5 min, 15 min, 30 min, 1 h.
- Valores fora dessas listas, vindos do banco, são trocados pelo mais próximo da lista ao normalizar.

### 6.4 "+ Do COA WEB" (atalhos)

Diálogo com os módulos que têm Modo TV próprio, montando o endereço com os parâmetros que eles já aceitam:

| Atalho | Opções no diálogo | Endereço |
|---|---|---|
| Acompanhamento (modo TV) | "Todas as fazendas, girando" ou fazendas escolhidas; tempo interno da troca entre fazendas | `acompanhamento/index.html?tv=1&tempo=…&fazendas=…&todas=0\|1` |
| Previsão do Tempo (modo TV) | camada (chuva, vento, temperatura…); fazendas; tempo interno | `previsao/index.html?tv=1&tempo=…&camadas=…&fazendas=…&todas=0\|1` |

- O nome sugerido já vem pronto (ex.: "Acompanhamento · Guapirama").
- A lista de fazendas é a que o usuário enxerga em `mapas_fazendas`. O script 0025 inclui `painel` na regra de categoria dessa tabela (regra do 0020: módulo novo que lê `mapas_fazendas` precisa entrar na lista). O plano confere qual campo cada módulo espera em `fazendas=` (código da unidade no Acompanhamento, id na Previsão).
- Atalhos do COA WEB não passam pela conferência: são da mesma origem.
- Para aparecer, o módulo exige que o login da TV tenha também a categoria dele; se não tiver, o próprio módulo mostra o aviso de acesso dentro do quadro.
- Outras páginas do COA WEB podem entrar por "+ Endereço".

### 6.5 "+ Endereço"

- Campos: endereço e nome (o nome vem preenchido com o host, ex.: "rainviewer.com", e pode ser trocado).
- Só `https://`. `http://` é recusado na hora ("Só endereços https abrem no painel"), porque a página é https.
- Ao confirmar: "Conferindo…" e então:
  - **abre**: entra na lista com ✓;
  - **bloqueado**: não entra. Mensagem: "Este site não deixa ser exibido dentro de outra página, então não aparece na TV." e a dica "Sites com login, como John Deere e ZEUS, costumam bloquear.";
  - **não deu para conferir** (fora do ar, recusou o servidor, demorou): entra com o selo "não conferido" e a nota "Confira na TV se ele aparece".

## 7. Conferência de site (`api/conferir-site.js`)

Função Node comum da Vercel, no padrão de `api/gnss.js`.

- **Quem pode**: `GET /api/conferir-site?url=<endereço>` com o cabeçalho `X-Coa-Token` (token da sessão do Supabase), como a `api/gnss.js`. Confere a sessão e a categoria `painel` em paralelo, com prazo de 3 s. Sem isso: 401/403 (`sem-acesso`); Supabase fora: 503.
- **Endereço aceito**: `https:`, porta 443 (ou omitida), sem usuário/senha no endereço, até 2.000 caracteres. O host não pode ser `localhost`, IP literal privado, nem resolver (DNS, todos os endereços) para faixas internas: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 224/4 e acima; `::1`, `fc00::/7`, `fe80::/10` e IPv4 mapeado em IPv6 dessas faixas.
- **Consulta**: `GET` com `redirect: 'manual'`, até 5 redirecionamentos (cada destino passa pela mesma validação), prazo total de 6 s, `User-Agent` de navegador comum. Só os cabeçalhos são lidos; o corpo é descartado.
- **Decisão** (`decidirEmbutir(cabecalhos)`, função pura exportada para teste), na ordem que o Chrome usa:
  1. Se algum `Content-Security-Policy` (não o `-Report-Only`) tem `frame-ancestors`: abre se as fontes incluem `*`, `https:` ou um host que case com `coa-web-teal.vercel.app` (inclusive curinga como `*.vercel.app`); senão, bloqueado (`'none'`, `'self'` ou só outros hosts). Nesse caso o `X-Frame-Options` é ignorado.
  2. Sem `frame-ancestors`: `X-Frame-Options` `DENY` ou `SAMEORIGIN` → bloqueado; `ALLOWALL`, `ALLOW-FROM` ou ausente → abre.
  3. Resposta final com status ≥ 400, erro de rede ou prazo estourado → "não deu para conferir".
- **Resposta**: JSON `{ resultado: 'abre' | 'bloqueado' | 'incerto' | 'invalido' | 'sem-acesso', motivo }`, com o motivo em português simples. `invalido` = endereço que não é https da internet (inclusive o que resolve para rede interna, mesmo no meio de um redirecionamento): 400.
- Risco aceito: troca de DNS entre a validação e a consulta (DNS rebinding). A função só lê cabeçalhos, exige login com categoria e tem prazo curto.

## 8. Dados (`supabase/0025_painel.sql`)

- **Categoria**: o `CHECK` de `usuario_categorias` passa a aceitar `painel`. O script reescreve a lista inteira; o plano lê a lista atual no banco antes (a última conhecida, do 0015, é `algodao, mecanizadas, mapas, acompanhamento, sat, previsao, validacao, controle, chuva`).
- **`painel_montagens`**: `id uuid` (pk, `gen_random_uuid()`), `nome text` (1 a 60 caracteres), `divisao text` (check com os 7 códigos), `quadros jsonb` (array de 4 itens), `criado_por uuid` (padrão `auth.uid()`), `criado_em`, `atualizado_em timestamptz` (gatilho atualiza a cada `update`). Índice único em `lower(nome)`.
- **`painel_tv`**: uma linha só (`id smallint` pk, check `id = 1`, criada pelo script), `montagem_id uuid` nulo enquanto nenhuma montagem estiver na TV (referência a `painel_montagens`, `on delete restrict`), `atualizado_em`, `atualizado_por`.
- **Formato de `quadros`**:
  ```json
  [
    { "padrao": 60, "recarregar": 0,
      "sites": [ { "id": "k3f9", "nome": "Acompanhamento · Guapirama", "url": "acompanhamento/index.html?tv=1&fazendas=GUAPIRAMA&todas=0",
                   "segundos": 120, "origem": "coa", "conferencia": "abre" } ] },
    { "padrao": 60, "recarregar": 0, "sites": [] },
    { "padrao": 60, "recarregar": 0, "sites": [] },
    { "padrao": 60, "recarregar": 0, "sites": [] }
  ]
  ```
  `origem` é `coa` (endereço relativo, mesma origem) ou `externo` (`https://…`); `conferencia` é `abre` ou `incerto`; `recarregar` em segundos (0 = não recarrega); no máximo 12 sites por quadro. A tela normaliza ao ler e ao gravar (`normalizarMontagem` em `logica.js`); o banco confere só o essencial (array de 4).
- **RLS**: ligada nas duas tabelas. `select/insert/update/delete` para `authenticated` com `tem_alguma_categoria(array['painel'])`. Sem acesso para `anon`.
- `painel` entra na regra restritiva de categoria de `mapas_fazendas` (para os atalhos).
- O script segue o costume dos anteriores: comentário de cabeçalho, comandos idempotentes e o trecho de desfazer comentado. Aplicação no SQL Editor só com autorização do usuário.

## 9. Segurança e cabeçalhos (`vercel.json`)

- A regra geral passa a valer para tudo **menos** `/painel/`: `source` com exclusão (`/((?!painel(?:/|$)).*)`).
- Regra nova para `/painel` e `/painel/(.*)` com os mesmos cabeçalhos, mudando só `frame-src 'self' https:`. O resto do COA WEB continua com `frame-src 'self' https://embed.windy.com`.
- O plano confere no deploy de teste da Vercel que as duas regras não se somam no mesmo caminho (o `/painel/` não pode receber dois CSP).
- Todo texto vindo do banco que vai para a tela passa por `escHtml()` (ou `textContent`), como no resto do COA WEB.

## 10. Testes e conferência

- `node --test "modulos/painel/testes/*.test.mjs"`:
  - `logica`: quadros visíveis por divisão; normalização (4 quadros sempre, tempos trocados pelo mais próximo da lista, só https/relativo, limite de 12 sites, ids); agenda da rotação (próximo índice, instante do pré-carregamento, regra dos 20 s, espera de até 10 s); comparação de quadros para atualizar sem recarregar; endereços dos atalhos; data por extenso em pt-BR;
  - `conferir-site`: validação do endereço e das faixas internas (IPv4 e IPv6); `decidirEmbutir` com os cabeçalhos reais da seção 2 (Deere, ZEUS, windy.com, zoom.earth → bloqueado; RainViewer, embed.windy.com → abre) e casos de curinga e `Report-Only`.
- Servidor local com dados fictícios (`modulos/painel/scripts/servidor-local.mjs`, sem login real, no padrão do da Previsão) para fotos de tela da TV em 1920×1080 e 3840×2160 e do editor em 1920, 1366 e celular.
- Antes de publicar: mostrar as imagens ao usuário (TV com sites reais que abrem e editor) e esperar o "pode publicar".
- Depois de publicar: o usuário confere logado e deixa a TV rodando um dia com uma montagem real.

## 11. A TV abrindo sozinha (README, sem instalar nada)

`modulos/painel/README.md` explica, para o Linux da TV:
- entrar uma vez no COA WEB no Chrome/Chromium da TV com um login que tenha a categoria `painel` e as categorias dos módulos que aparecem nos quadros;
- abrir em modo quiosque: `chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://coa-web-teal.vercel.app/painel/?tv=1` (ou `google-chrome`);
- colocar esse comando no início automático da sessão (`~/.config/autostart/painel-coa.desktop`);
- desligar a proteção de tela e o desligamento do monitor do sistema.

## 12. Fora do escopo

- John Deere Operations Center, portal da ZEUS, windy.com e outros sites que bloqueiam (caminhos A/B da conversa ficam para depois).
- Agendar montagem por horário ou dia da semana (a do dia é escolhida à mão).
- Mais de uma TV com montagens diferentes ao mesmo tempo.
- Usar a TV para trabalhar nos sites (zoom no mapa etc.): a TV é para assistir; a tecla I só libera mexer por 2 min, para o necessário (cookies, login).
- Prévia ao vivo dos sites no editor.
