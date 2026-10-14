# Relatório de previsão por fazenda (PDF) — especificação

Data: 14/10/2026. Situação: desenho aprovado em 3 partes em 14/10/2026; aguardando a revisão desta especificação.

## 1. Objetivo

Um botão no módulo Previsão do Tempo que gera, na hora, um PDF com a previsão dos próximos dias de cada fazenda, no esquema do relatório "Previsões Climáticas" que a Rural Clima entrega à Bayer (capa e uma página por local, com chuva por dia e temperaturas máxima e mínima). Público: a equipe interna (COA e coordenadores) planejando as operações.

Decisões do dono do sistema (14/10/2026):
- Para a equipe interna; uma página por fazenda; botão na tela (sem geração automática).
- Chuva da ZEUS e temperatura do Visual Crossing (o MET Norway entra no lugar do Visual Crossing enquanto a chave dele não estiver na VM).
- Temperatura gravada na foto diária da VM; PDF montado no navegador.
- Gráfico em dois painéis colados (temperatura em cima, chuva embaixo), em vez de um gráfico só com duas escalas.
- Faixa com os números de cada dia abaixo do gráfico.

Limites combinados:
- Só a estrutura do modelo é repetida: nenhuma marca, nome ou texto da Rural Clima ou da Bayer. O PDF recebido é licenciado à Bayer e não é fonte de dados.
- Horizonte: o das fontes grátis, cerca de 15 dias (ZEUS até hoje + 13, Visual Crossing até hoje + 14, MET Norway cerca de 9 dias), não os 46 dias do modelo.

Fora do escopo: geração automática, envio pelo WhatsApp, páginas por município, horizonte maior que o das fontes, exportação em outro formato.

## 2. Dados (rotina da VM, `modulos/mapas/scripts/sincronizar-plantio.mjs`)

Sem tabela nova e sem script de banco. Cada dia previsto em `prev_previsoes.dias` passa de `{ d, mm, p }` para `{ d, mm, p, tx, tn }`: máxima e mínima em °C, com 1 casa, ou `null` quando a fonte não tem.

| Fonte | Temperatura |
|---|---|
| Visual Crossing | `days[].tempmax` e `days[].tempmin` da mesma resposta (sem consulta a mais) |
| MET Norway | Passa a ler o formato completo (`/locationforecast/2.0/complete`, mesma chuva). Por dia de MT: máxima e mínima entre os blocos usados para a chuva. No trecho de 6 h, `next_6_hours.details.air_temperature_max/min`; no trecho de hora em hora, a temperatura do instante (`instant.details.air_temperature`). Só para os dias completos, como a chuva. |
| ZEUS | Não prevê temperatura: os dias da ZEUS não ganham `tx` e `tn` (a tela lê a falta como sem temperatura) |

- **Benchmark sem mudança:** ele ignora os campos novos, e as regras da comparação e das métricas continuam as mesmas.
- **Falha só na temperatura:** um dia sem temperatura válida grava `null` e não tira a chuva da foto.
- **Sem dado retroativo:** a temperatura começa na primeira foto depois da publicação, e o relatório só usa a foto mais recente.

## 3. Tela

### Botão
- "Relatório (PDF)" na barra do módulo (`previsao/index.html`), fora das ações do mapa: visível nas abas Mapa e Benchmark.
- Aparece para quem abre o módulo (categoria `previsao`). Os dados respeitam a mesma regra de acesso do Benchmark: cada um só recebe as fazendas que pode ver.
- Enquanto o PDF é montado, o botão fica desativado e mostra "Gerando…". Um erro aparece no aviso da barra e não fecha a tela.

### Dados usados
- Leitura de `prev_previsoes` das fotos dos últimos 3 dias (a foto mais recente de cada fonte e fazenda) e do cadastro que o módulo já tem (nome da fazenda e `unidade_pims`).
- **Fazendas:** todas as do cadastro que a pessoa vê e que têm `unidade_pims`, em ordem alfabética.
- **Período:** de hoje (MT) até o último dia com chuva ou temperatura na foto usada, no máximo hoje + 14. Dias anteriores a hoje não entram (caso de foto da véspera).
- **Temperatura:** a do Visual Crossing; se a fazenda não tiver foto dele nos últimos 3 dias, a do MET Norway. A fonte usada é escrita na página.

### PDF (A4 deitado, jsPDF 2.5.1 do cdnjs, carregado só ao clicar, como no Operacional)
- **Capa:**
  - "Previsão do Tempo — Fazendas", data de hoje e a lista das fazendas;
  - data e hora da foto mais recente usada;
  - de onde vêm os dados: "Chuva: ZEUS (Locks)" e "Temperatura: Visual Crossing" ou "MET Norway (CC BY 4.0)", com os créditos exigidos;
  - nome de quem gerou e a hora;
  - logos do COA (`assets/logo-coa-relatorio.png`) e da Locks (`assets/locks-agtech-lab.png`).
- **Página de cada fazenda:**
  - título com o nome da fazenda e o período ("15/10 a 29/10"), e uma linha com a foto usada de cada fonte (data e hora);
  - gráfico (ECharts, desenhado fora da tela e colocado como imagem em alta resolução). Painel de cima: máxima (laranja) e mínima (azul) em linhas com pontos, escala em °C. Painel de baixo: barras de chuva da ZEUS, escala em mm, com as mesmas datas embaixo. Cores conferidas no validador de paleta;
  - faixa de números: uma coluna por dia, com mm, probabilidade de chuva (%), máxima e mínima, e o total de chuva do período;
  - rodapé com "COA WEB · Previsão do Tempo" e o número da página (as fontes de cada página ficam na linha abaixo do título).
- **Sem dado:**
  - fazenda sem nenhuma foto nos últimos 3 dias: página com o aviso "Sem previsão recente para esta fazenda";
  - sem temperatura: só o painel da chuva, com a nota "Temperatura indisponível";
  - sem chuva da ZEUS: só o painel da temperatura, com a nota.
- **Arquivo:** `previsao-fazendas-AAAA-MM-DD.pdf`.

### Arquivos
- `previsao/relatorio-logica.js`: contas sem tela (UMD, como `benchmark-logica.js`). Monta, por fazenda, os dias, a chuva, a probabilidade, as temperaturas, a fonte da temperatura, as fotos usadas e o total. Testado.
- `previsao/relatorio.js`: o botão, os gráficos e o PDF.
- `previsao/app.js`: liga o botão e a leitura (Supabase e servidor local).
- O servidor local ganha temperatura nos dados fictícios.

## 4. Testes

- **Rotina (Vitest):**
  - temperatura do Visual Crossing (arredondamento, valor ausente ou inválido vira `null`);
  - MET Norway completo: máxima e mínima por dia de MT com blocos de 1 h e de 6 h, a meia-noite de MT, dia incompleto fora e a mesma chuva de antes;
  - endereço do MET no formato completo;
  - os testes do Benchmark continuam passando.
- **Tela (`node --test`):**
  - período (hoje até o último dia, sem dias passados, foto da véspera);
  - escolha da temperatura (Visual Crossing, ou MET Norway na falta dele);
  - fazenda sem foto e total do período;
  - ordem das fazendas.
- **Conferência antes de publicar:** gerar o PDF no servidor local com dados fictícios e com os dados reais desta máquina (fora do repositório) e conferir as páginas.

## 5. Como entra no ar

1. Publicação no `main` com "pode publicar" (sem script de banco).
2. A VM baixa a rotina nova e grava a temperatura a partir da foto das 6:17 do dia seguinte. Até lá, o PDF sai só com a chuva e a nota.
3. Com a chave do Visual Crossing na VM, a temperatura passa a vir dele, com 15 dias.

## 6. Riscos

- **Chave do Visual Crossing ausente:** temperatura do MET Norway, com cerca de 9 dias. A página diz a fonte.
- **Mudança no formato completo do MET Norway:** a temperatura fica `null` e a chuva continua; tem teste com os campos usados.
- **Muitas fazendas no futuro:** o PDF é montado no navegador, uma página por fazenda; com algumas dezenas continua leve.
