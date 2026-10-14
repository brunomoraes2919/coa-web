# Benchmark de previsão de chuva (aba nova da Previsão do Tempo) — especificação

Data: 14/10/2026. Situação: aprovada em 14/10/2026 ("pode seguir para o plano de implementação"). Ajustada no mesmo dia, ao escrever o plano: previsões guardadas em JSON por foto, antecedência máxima 13 (alcance da ZEUS), função para as linhas "Todas", assinatura da ZEUS tirada da própria leitura da previsão e botão do menu com `data-previsao` (padrão da Chuva).

## 1. Objetivo

Uma aba nova no módulo Previsão do Tempo que:

1. mostra, por fazenda, a previsão de chuva dos próximos 15 dias de várias fontes lado a lado (ZEUS da Locks e fontes do mercado);
2. mede, ao longo do tempo, qual fonte acerta mais a chuva de cada fazenda, comparando a previsão com o que os pluviômetros da ZEUS mediram.

Decisões do dono do sistema (14/10/2026):
- "Comparar e medir o acerto" (não só comparar).
- **Só fontes gratuitas** nesta etapa: ZEUS, Visual Crossing e MET Norway. Fontes pagas (Open-Meteo comercial, AccuWeather, Weather.com, Climatempo, OpenWeather) ficam para depois, sem refazer nada: cada fonte é uma linha a mais na mesma tabela.
- Nada de copiar dados de páginas de sites (os termos de uso proíbem); só APIs oficiais.

Fora do escopo: temperatura no ranking (a ZEUS só prevê chuva), alertas, exportação, Modo TV da aba nova.

## 2. Fontes

| Fonte | Como | Alcance | Campos | Condições |
|---|---|---|---|---|
| ZEUS | Agrovex, `zeus` / `LKS_DATABASE_ZEUS` / `"DATABASE".stg_short_forecast` (`picid`, `day`, `forecast` mm, `rainprobability` %) | 14 dias (hoje a D+13), 153 pluviômetros das 7 fazendas | mm, probabilidade | Só guarda a previsão mais recente (sem data de emissão) |
| Visual Crossing | `GET https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/{lat},{lon}?key=…&unitGroup=metric&include=days` | 15 dias, dia no fuso local do ponto | `days[].precip` (mm), `days[].precipprob` (%) | Plano grátis: uso comercial permitido, crédito obrigatório; ~1.000 registros/dia (usaremos ~105) |
| MET Norway | `GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=…&lon=…` | ~10 dias (modelo global ECMWF): 1 h no início, depois 6 h | `next_1_hours`/`next_6_hours.details.precipitation_amount` | Grátis, uso comercial com crédito (CC BY 4.0); `User-Agent` identificado com contato; coordenadas com até 4 casas; respeitar `Expires` (uma chamada por fazenda por dia, repetida só na rodada seguinte se falhar, já fica bem acima do prazo); sem probabilidade fora da região nórdica |

**Ponto de cada fazenda:** média das coordenadas dos pluviômetros da fazenda na ZEUS (os mesmos que medem a chuva usada no ranking), com 4 casas decimais. A fazenda da ZEUS casa com a do COA pela regra que já existe (`unidadeDaFazendaZeus`). Pluviômetros sem fazenda reconhecida (por exemplo "Semi Confinamento") ficam fora.

**Dia:** sempre no fuso de Mato Grosso (UTC−4, sem horário de verão), calculado no código, sem depender do fuso da VM. No MET Norway, as horas são somadas por dia local; um bloco de 6 h que atravessa a meia-noite local é repartido pela fração de horas de cada dia.

## 3. Dados (script `supabase/0024_previsao_benchmark.sql`)

| Tabela | Colunas | Chave | Grava | Lê |
|---|---|---|---|---|
| `prev_previsoes` | `fonte` text, `unidade` text, `emitida_em` date (dia da foto), `capturada_em` timestamptz, `dias` jsonb (`[{ d: 'AAAA-MM-DD', mm, p }]`, um item por dia previsto) | (`fonte`, `unidade`, `emitida_em`) | VM | categoria `previsao` + `acomp_pode_ver_unidade(unidade)` |
| `prev_observado` | `unidade`, `dia`, `mm` numeric, `pluviometros` int (quantos leram) | (`unidade`, `dia`) | VM | idem |
| `prev_metricas` | `unidade` (ou `'TODAS'`), `periodo` text (`30d`, `60d`, `90d`, `safra`), `fonte`, `antecedencia` int (1, 3, 7, 13; e 0 = todos os pares de 1 a 7), `n` int, `erro_medio` numeric, `vies` numeric, `acerto` numeric, `calculado_em` | (`unidade`, `periodo`, `fonte`, `antecedencia`) | VM | idem; as linhas `'TODAS'` só para quem vê todas as fazendas (quem vê só algumas não tem a opção "Todas" no ranking, para não ver números de fazendas que não são dele) |
| `prev_zeus_atualizacoes` | `capturada_em`, `assinatura` text | `capturada_em` | VM | categoria `previsao` |

`fonte` aceita `zeus`, `visualcrossing`, `metno` (check). Nada é gravado pela tela. A RLS segue o padrão dos scripts 0019/0020 (permissiva por unidade + restritiva por categoria). As fotos não são apagadas: uma linha por fonte × fazenda × dia de foto (~21 linhas/dia, ~7.700 por ano), com os 15 dias num JSON, no mesmo padrão dos retratos (`acomp_pims`, `chuva_talhao`): a rotina lê uma safra inteira em poucas páginas para recalcular as métricas. As linhas `'TODAS'` de `prev_metricas` são liberadas por uma função `security definer` nova, `prev_ve_todas_as_fazendas()`, que confere se o usuário vê todas as unidades do cadastro do Mapas.

## 4. Rotina na VM (em `modulos/mapas/scripts/sincronizar-plantio.mjs`, chamada pela rotina de hora em hora)

A cada rodada (minuto 17), em hora local de MT:

1. **Mudança da ZEUS:** lê a previsão da `stg_short_forecast` de hoje em diante (~2.100 linhas, uma consulta), tira dela uma assinatura (SHA-1 da previsão por fazenda) e grava em `prev_zeus_atualizacoes` só quando ela muda. A mesma leitura serve à foto. Serve para descobrir a hora em que a ZEUS publica (se for depois das 6 h, o horário da foto muda).
2. **Foto do dia** (na primeira rodada a partir das 6 h local em que ainda não há foto de hoje para a fonte; tenta de novo nas rodadas seguintes se falhar): para cada fonte e fazenda, D0 a D14 (o que a fonte tiver) → `prev_previsoes` com `emitida_em = hoje`. Uma fonte que falha não impede as outras; o erro vai para o log (sem chave).
3. **Chuva medida** de ontem (e de anteontem, para cobrir carga atrasada): média, por fazenda, da chuva diária dos pluviômetros que leram no dia (`stg_climatemonitoring2.pluviometria`, deduplicada por `idprecipitation`; a coluna `data` vem só com o dia, 00:00) → `prev_observado`. Roda em toda rodada (consulta pequena).
4. **Métricas** (uma vez por dia, na rodada da foto, depois do passo 3): recalcula `prev_metricas` para os quatro períodos, por fazenda e para `'TODAS'`, e apaga as linhas de cálculos anteriores (uma combinação que deixou de ter pares não fica com número velho).

Variável de ambiente nova: `VISUALCROSSING_KEY` (opcional: sem ela, a fonte é pulada com aviso no log). MET Norway: `User-Agent: coa-web-locks/1.0 (https://coa-web-teal.vercel.app)`, chamadas espaçadas, sem repetição em caso de 429 na mesma rodada. Prazos: 30 s por chamada externa.

## 5. Regras do ranking

Para a fonte *f*, a fazenda *u* e a antecedência *k* (dia previsto − dia da foto):

- **Par avaliado:** existe previsão de *f* para (*u*, dia) emitida *k* dias antes **e** existe `prev_observado` (*u*, dia) com pelo menos 1 pluviômetro. **Comparação justa:** só entram os pares (*u*, dia, *k*) em que **todas** as fontes que alcançam *k* têm previsão. A ZEUS alcança D+13 e o MET Norway cerca de D+9: na coluna de 13 dias, o MET Norway não entra. D0 (*k* = 0 do dia da foto) nunca entra.
- **Erro médio** = média de |previsto − medido| (mm). **Viés** = média de (previsto − medido): positivo = prevê chuva demais. **Acerto** = % dos pares em que (previsto ≥ 1 mm) = (medido ≥ 1 mm).
- **"Todas as fazendas":** junta os pares de todas as fazendas.
- **Mínimo:** com menos de 10 pares, `n` é gravado e a tela mostra "histórico insuficiente".
- **Ordem do ranking:** erro médio na média das antecedências 1 a 7 (`antecedencia = 0` na tabela).
- **Períodos:** últimos 30, 60 e 90 dias (pelo dia previsto) e a safra corrente (setembro a agosto).

## 6. Tela (aba "Benchmark")

- **Navegação:** o menu lateral da Previsão ganha o botão "Benchmark" (`data-previsao="benchmark"`, como o `data-chuva` da Chuva); o mapa do Windy continua como "Mapa" (`data-previsao="mapa"`). Módulo: rota por hash (`#mapa` / `#benchmark`); mensagens novas no padrão dos outros módulos: `previsao-vista` (casca → módulo) e `previsao-rota` (módulo → casca). A fazenda continua vindo do seletor lateral (`coa-fazenda`); a aba aceita também "Todas as fazendas".
- **Bloco 1 — Próximos 15 dias** (foto mais recente): gráfico de colunas por dia (hoje a D+14), uma cor por fonte; tabela fontes × dias com mm e probabilidade; total de 15 dias por fonte; dia destacado quando uma fonte prevê ≥ 10 mm e outra < 1 mm; rodapé com a hora da foto de cada fonte e os créditos ("Dados de Visual Crossing", "MET Norway, CC BY 4.0"). Em "Todas", média das fazendas.
- **Bloco 2 — Quem acerta mais:** seletor de período; tabela por fonte com erro médio em 1, 3, 7 e 13 dias, viés ("prevê demais/de menos"), acerto de chuva e nº de dias; ordenada pela regra da seção 5; aviso de quantos dias de foto existem enquanto o histórico é curto.
- **Bloco 3 — Previsto × medido:** últimos 30 dias, colunas = chuva medida, linhas = previsão de cada fonte para a antecedência escolhida (1, 3 ou 7 dias).
- Gráficos com ECharts 5.5.1 (CDN já liberado na CSP). Texto do banco sempre por `esc()`. Sem dados ainda: mensagem explicando que a primeira foto sai às 6 h do dia seguinte à publicação.

## 7. Permissões

- Ver a aba: categoria `previsao` (a mesma da aba do mapa) e as fazendas liberadas. Nenhuma ação de gravação na tela.
- A VM grava com a chave de serviço, como as demais rotinas. A chave do Visual Crossing fica só no arquivo de ambiente da VM.

## 8. Testes

- **Rotina (Vitest, `modulos/mapas/tests/previsao-benchmark-servidor.test.ts`, com simuladores de Agrovex, Supabase, Visual Crossing e MET Norway):** conversão de cada fonte para (dia local, mm, prob); repartição dos blocos de 6 h na meia-noite local; ponto da fazenda; foto só uma vez por dia e retentativa após falha; fonte com erro não derruba as outras; chuva medida com deduplicação e pluviômetro sem leitura fora da média; regra de comparação justa; métricas (erro, viés, acerto) com exemplo calculado à mão; mínimo de 10 pares; fuso de MT independente do fuso da máquina; nenhuma chave no log.
- **Tela (`node --test`, `modulos/previsao/testes/`):** preparo do gráfico e da tabela dos 15 dias, detecção de divergência, ordenação do ranking, "histórico insuficiente", média de "Todas".
- **Conferência real, só leitura, antes de publicar:** rodar a coleta das três fontes contra as APIs reais para as 7 fazendas e conferir valores e dias.

## 9. Como entra no ar

1. Script `0024` revisado e aplicado no SQL Editor (com autorização).
2. O dono cria a conta grátis no Visual Crossing e grava `VISUALCROSSING_KEY` no arquivo de ambiente da VM (comando com leitura oculta, como no README do Mapas). Sem a chave, o resto funciona.
3. Publicação no `main` (com autorização), após imagens da aba com dados reais.
4. Primeira foto às 6 h do dia seguinte; o ranking passa a ter números com 10 dias de pares (cerca de 11 dias depois da primeira foto para 1 dia de antecedência; 23 dias para 13 dias de antecedência).

## 10. Riscos

- **Hora de publicação da ZEUS desconhecida:** coberto pelo registro de mudanças (passo 4.1).
- **Mudança de termos ou limites das APIs grátis:** a fonte falha isolada; a tela mostra a hora da última foto de cada uma.
- **Ponto único por fazenda:** fazendas grandes têm variação interna; a ZEUS entra como média dos seus pluviômetros e as outras fontes num ponto central, o que é a comparação possível com fontes de ponto.
- **Chuva medida depende da telemetria da ZEUS:** pluviômetro parado sai da média; dia sem nenhuma leitura não entra no ranking.
