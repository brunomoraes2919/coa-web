# Mapa de variedade — especificação

Data: 15/10/2026. Situação: desenho aprovado em 4 partes em 15/10/2026; aguardando a revisão desta especificação.

## 1. Objetivo

Uma subdivisão nova no módulo Mapas do COA WEB, "Mapa de variedade", com o mesmo princípio e os mesmos cadastros do mapa de chuva: um mapa por fazenda e safra em que cada talhão é pintado com a cor da sua variedade da cultura, com legenda, no mesmo layout (A3/A4, painel, quadros) e com as mesmas exportações do mapa de chuva.

Decisões do dono do sistema (15/10/2026):
- Abordagem: tela própria que reaproveita as peças do mapa de chuva (o mapa de chuva fica praticamente intocado).
- Cores **fixas por variedade e editáveis**: a variedade ganha uma cor automática na primeira vez e guarda essa cor, a mesma em todas as fazendas e mapas; o administrador troca a cor num cadastro.
- Rótulo do talhão: **só o código**; a variedade fica pela cor e pela legenda.
- Situação do plantio: **não aparece**; todo talhão com variedade no PIMS (planejada ou plantada) sai com a cor dela.
- Legenda: **cor, nome, área e %**; painel com área total, nº de variedades e a fonte.
- Mapas salvos: **lista própria** na seção de variedade.

Fora do escopo: situação do plantio no mapa de variedade, rótulo com o nome da variedade, cor por mapa, comparação entre safras, variedade de outra fonte que não o PIMS.

## 2. Navegação

- **Casca (`index.html`, `#nav-mapas`):** seção nova "Mapa de Variedade" entre "Mapa de Chuva" e "Cadastros", com "Novo mapa" (`data-rota="/variedades/novo"`) e "Mapas salvos" (`data-rota="/variedades"`). Em "Cadastros" (só administrador), item novo "Cores das variedades" (`data-rota="/variedades/cores"`, `admin-only`).
- **Mapas (`modulos/mapas/src/App.tsx`):**
  - rotas `/variedades/novo` (tela nova), `/variedades` (lista de salvos de variedade), `/variedades/cores` (cadastro de cores, dentro de `SomenteAdmin`) e `/variedades/:id` (mapa de variedade salvo);
  - `/variedades/cores` declarada antes de `/variedades/:id`;
  - `tituloDaRota` (`lib/embed.ts`) ganha "Novo mapa de variedade", "Mapas de variedade", "Cores das variedades" e "Mapa de variedade salvo";
  - o menu do modo fora da casca (`Shell.tsx`, `ITENS`) ganha os mesmos itens;
  - o subtítulo da casca para `/variedades/cores` é o dos cadastros.
- Mesma categoria de acesso do Mapas (`mapas`).

## 3. Dados

### Variedade de cada talhão
- **Fonte:** o plantio do PIMS que o mapa de chuva já lê (`mapas_plantio_pims`, gravado de hora em hora pela VM), casado pelo código do talhão com `casarPlantio`, como no mapa de chuva (`PlantioPimsTalhao.variedade`).
- **Limpeza:** a mesma do Operacional (`limparVariedade` de `scripts/sincronizar-plantio.mjs`), portada para `src/lib`:
  - tira o prefixo "SEMENTE [DE] SOJA/MILHO/ALGODAO/SORGO/MILHETO";
  - tira o sufixo de cultura "SOJA/MILHO/ALGODAO".
- **Sem variedade:** vazio e "A DEFINIR" (depois da limpeza) viram a classe **"Sem variedade"**, sempre cinza (`#B5B5B5`).
- **Chave da cor:** o nome limpo em maiúsculas, sem espaços duplicados.
- **Áreas da cultura:** quando a safra tem "áreas da cultura" para a fazenda (pedaços de pivô), são elas que são pintadas e somadas, cada uma com a variedade do registro do PIMS de mesmo código, como `situacaoDoMapa` faz para a situação. Sem elas, os talhões.
- **Área:** `area_ha` do desenho (shape) do talhão ou da área da cultura; % sobre a área total colorida (incluindo "Sem variedade").
- **Filtro de setor:** o mesmo do mapa de chuva; as contas usam só o que está no mapa.

### Cores (script `supabase/0026_mapa_variedade.sql`)
- **Tabela nova `public.mapas_variedade_cores`:**
  - `variedade text primary key` (a chave limpa);
  - `cor text not null check (cor ~ '^#[0-9A-Fa-f]{6}$')`;
  - `criado_em timestamptz default now()`, `atualizado_em timestamptz`, `atualizado_por uuid default auth.uid()`.
- **RLS:**
  - SELECT para quem tem a categoria `mapas` (`mapas_eh_usuario()`);
  - INSERT para quem tem a categoria `mapas` (a cor automática da primeira vez; não existe "upsert" para usuário comum);
  - UPDATE e DELETE só para administrador (`mapas_eh_admin()`);
  - restritiva por categoria no padrão do script 0020.
- **Cor automática:**
  - paleta `PALETA_VARIEDADES` de 20 cores distintas, sem cinza;
  - a variedade nova recebe a primeira cor da paleta que nenhuma variedade da tabela usa; esgotada a paleta, volta ao começo;
  - a cor é gravada na hora (INSERT). Se outra pessoa gravou a mesma variedade antes (conflito de chave), vale a cor dela, relida;
  - sem conexão com a tabela, o mapa usa a cor calculada sem gravar e avisa.
- **Cadastro "Cores das variedades" (administrador):**
  - lista das variedades da tabela (nome, cor, quando foi criada), com troca da cor (seletor de cor) e busca pelo nome;
  - o administrador pode apagar uma variedade (por exemplo, uma grafia duplicada); se ela aparecer de novo num mapa, recebe uma cor automática como se fosse nova.

### Mapas salvos
- **Mesma tabela `mapas_chuva`,** com a coluna nova `tipo text not null default 'chuva' check (tipo in ('chuva','variedade'))` e índice (`fazenda_id`, `tipo`, `criado_em`). Os mapas existentes ficam "chuva". Regras de acesso e bucket `mapas-chuva` sem mudança (`mapas_pode_ver_arquivo` continua cobrindo os arquivos).
- **Mapa de variedade salvo:**
  - `config` traz o layout e as cores usadas no dia (`coresVariedade`); `periodo_inicio`/`periodo_fim` ficam nulos;
  - `resumo` guarda o resumo de variedades: lista com variedade, cor, área, %, nº de talhões e o total;
  - reabrir mostra as cores salvas, mesmo que o cadastro tenha mudado depois.
- **Listas:** "Mapas salvos" do mapa de chuva lista só `tipo = 'chuva'`; "Mapas salvos" da variedade, só `tipo = 'variedade'`.
- **Modo local (IndexedDB):** `MapaSalvo` ganha `tipo` (ausente = chuva) e as cores ganham um store novo (`coresVariedade`), com `VERSAO_DB` 3.

## 4. Tela "Novo mapa de variedade"

No padrão visual do "Novo mapa" de chuva:
1. **Fazenda e safra:** a mesma seção, que segue a fazenda do menu lateral, com filtro de setor.
2. **Variedades:**
   - tabela das variedades da fazenda e safra: cor, nome, área (ha), % e nº de talhões, da maior área para a menor, com "Sem variedade" por último;
   - data e hora da última atualização do plantio do PIMS;
   - sem plantio do PIMS para a safra: aviso, e o mapa sai todo "Sem variedade".
3. **Textos:**
   - os mesmos campos do mapa de chuva;
   - título padrão "MAPA DE VARIEDADES";
   - subtítulo com a safra e a cultura.
4. **Aparência:**
   - página A3/A4, orientação, quadros e mapa de fundo;
   - sem paleta de chuva, PICs e situação do plantio.
5. **Prévia:** o mesmo componente do mapa de chuva.
6. **Exportar:** PNG em 150/300/600 dpi, "Salvar" (atualizar / salvar como novo, como no de chuva) e CSV dos talhões.

## 5. A folha (desenho)

- **Composição:** a mesma do mapa de chuva (`compor`, quadros, painel ao lado ou faixa embaixo, moldura, rosa dos ventos, escala, grade, mapa de fundo).
- **Talhões:**
  - cor sólida da variedade, sem a chuva interpolada;
  - contorno escuro fino;
  - código do talhão com halo branco, pelo `LabelPlacer` (omitido onde não cabe, como hoje).
- **Painel:**
  - cabeçalho com logo, título e fazenda;
  - informações: safra e cultura, área total, nº de variedades, setores (se houver filtro) e "Fonte: PIMS, atualizado em dd/mm hh:mm";
  - legenda "Variedades": quadrado da cor + "NOME — 1.234 ha (32%)", na ordem da tabela, em colunas como as classes de chuva;
  - rodapé "Mapa de Variedade COA · Locks" e "Gerado em".
- **Arquivos:**
  - PNG `MAPA_VARIEDADE_<fazenda>_<safra>…png`, com o dpi gravado (pHYs);
  - CSV `…_TALHOES.csv` com talhão; setor; variedade; área (ha), separado por `;`, com vírgula decimal e BOM.

## 6. Testes (Vitest, `modulos/mapas/tests`)

- limpeza da variedade e "A DEFINIR";
- chave da cor;
- cor automática: primeira livre, paleta sem cinza, volta ao começo, sem mudar depois de gravada, conflito de gravação;
- resumo por variedade: áreas, %, ordem, "Sem variedade", com e sem áreas da cultura, filtro de setor;
- itens da legenda e do painel do modo variedade;
- talhão com cor sólida (contexto de canvas falso);
- CSV;
- rotas e títulos (`embed`);
- repositório: cores e tipo dos mapas no Supabase falso e no IndexedDB falso;
- os testes do mapa de chuva continuam passando sem mudança de resultado.

## 7. Como entra no ar

1. Script `0026` revisado e aplicado no SQL Editor (com autorização).
2. Conferência no modo local com dados fictícios e com o plantio real desta máquina (fora do repositório), com imagens para o dono.
3. `npm run publicar` (testes, tipos, build para `mapas/` e verificação da publicação) e publicação no `main` com "pode publicar".
4. O dono testa com login: um mapa de variedade de uma fazenda, a troca de uma cor no cadastro e um mapa salvo.

## 8. Riscos

- **Muitas variedades num mapa:** com mais de cerca de 12, algumas cores ficam parecidas; a legenda com nome, área e % resolve a leitura.
- **Variedade escrita diferente no PIMS** (ex.: com e sem espaço): vira duas variedades, cada uma com sua cor. A limpeza cobre os padrões conhecidos; o cadastro de cores mostra as duplicadas.
- **Plantio do PIMS atrasado:** o mapa mostra a hora da última atualização.
