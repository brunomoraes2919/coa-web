# Decisões tomadas durante a implementação (28/09/2026)

Registro das decisões que o assistente tomou por delegação do usuário, extraídas dos ledgers de execução. Cada linha diz o que foi decidido, por quê e o que custa se estiver errado.

## 2026-09-28-layout-adaptativo

- Task 1: DONE_WITH_CONCERNS (37 testes). Ruling: limiar de retrato 1,15 → 1,25 (Guapirama 1,17 fica paisagem) — custo: fazendas entre 1,15 e 1,25 em paisagem. Fix round 1 dispatched.
- Task 1: review ❌ Important: 'setor' com ≥4 setores → alturas negativas. Ruling: máximo 3 quadros em todos os modos; setores excedentes vão para o quadro mais próximo; fracoes com mínimo min(0,3; 1/n) — custo: fazendas com 4+ setores mostram 3 quadros. Fix round 2 dispatched.
- Task 2: review ✅ spec; Important: teto de 400 tiles por quadro (3 quadros → 1200). Ruling: orçamento 400 por render dividido por área (mín. 60/quadro). Minors incluídos: clip da legenda, 'PIMS dd/MM HH:mm', reticências em textos longos, áreas da cultura filtradas por grupo, save/restore. Fix round 1 dispatched.
- Ruling: vínculo área↔talhão base pelo centróide (helper espacial único) e estatísticas próprias das áreas no pipeline — custo: segunda rasterização (leve)

## 2026-09-28-mapa-chuva-coa

- Ruling: executar T2–T7 em PARALELO (arquivos disjuntos), contrariando "never parallel" da skill — o usuário está dormindo e quer tudo pronto ao acordar; arquivos são disjuntos e contratos fixos em types.ts — custo se errado: conflitos de integração que eu corrijo na T8.
- Ruling: implementadores NÃO fazem commit; o coordenador comita os arquivos de cada tarefa ao receber DONE e gera o review package a partir desse commit — evita corrida no índice do git — custo: nenhum relevante.
- Ruling: trabalhar direto no branch master de um repo novo, sem worktree — repo criado nesta sessão, usuário autorizou tudo — custo: nenhum (sem remoto).
- Ruling: projection.ts implementado pelo coordenador na T1 — contrato consumido por T3 e T6 em paralelo — custo: nenhum.
- Ruling: autoPalette: <=160 → locks_0_160; <=2000 → acum_atual; senão acum_anual — acum_atual reproduz a legenda do mapa de referência (≤50 … 1000–2000 mm) e os estilos "NÃO USAR AINDA" ficam só como opção manual — custo: usuário troca a paleta no seletor.
- Ruling: validação contra o QGIS feita como teste Vitest (tests/validacao-grass.test.ts, npm run validar-grass) em vez de scripts/validar-grass.mjs — o Node não importa os módulos TS do app sem bundler — custo: nenhum. O raster disponível (Três Flechas, dez/2023) está em WGS84 com pixel ~11 m, então a comparação é por amostragem nos centros de pixel.
- Ruling: GeometryCollection com polígonos vira UMA feição MultiPolygon (membros não-poligonais ignorados com aviso) — um placemark = um talhão — custo se errado: usuário com KML de talhões multiparte vê um talhão só (o esperado).
- Ruling: pipeline deve ignorar PICs fora da região (grid) como o GRASS sem -n (newpoint: row/col por truncamento; fora → ignorado) — verificado no código-fonte do GRASS (vector/v.surf.idw/main.c:403-434) — custo se errado: nenhum, é o comportamento do modelo atual. Entra na rodada de correção da Task 3.
- Task 3: minor (deferred/parked): parâmetros do IDW não validados no pipeline — Ruling: a UI (SecaoAvancado) só aceita valores dentro de limites — custo: chamada direta com NaN gera mensagem ruim
- Task 3: minor (parked): buffer por dilatação de disco ≈ buffer vetorial (diferença de até ~1 célula no anel de 10 m; não afeta estatísticas) — Ruling: mantém — custo: anel do buffer levemente mais fino que no QGIS
- Ruling: incluir na rodada 1 da Task 6 os minors #2 (cache do índice de classes), #3 (reuso de ImageData) e #4 (rótulos de coordenada reservados no LabelPlacer) — afetam a prévia interativa da Task 8 — custo: nenhum
- Ruling: incluir na rodada 1 da Task 8 os minors 3-12, 14-18 (arquivo task-8-achados.md) — são visíveis ao usuário ou afetam memória a 600 dpi — custo: rodada maior
- Task 8: minor (parked): passos "interpolação" e "exportação" como selo de progresso e botões no cabeçalho — Ruling: UX mais direta (interpola sozinho) — custo: nenhum
- Ruling: I3 sem allowlist de membros — com cadastro público desativado só há usuários criados pelo admin; configuração fica simples — custo se errado: se alguém esquecer de desativar o cadastro, qualquer pessoa com a URL cria conta e acessa os dados (mitigado pelo alerta no app e no SQL)
- Ruling: I2 edição mostra "Atualizar este mapa" e "Salvar como novo" — evita sobrescrita silenciosa — custo: um botão a mais
- Ruling: I5 cópia do histórico sempre em 150 dpi (~4 MB) — cabe ~250 mapas/GB no plano gratuito; alta resolução é regenerável pelo editor — custo: baixar do histórico dá 150 dpi
- Ruling: adiados da revisão final: M4, M5, M7, M9, M13, M17 (ver final-achados.md) — custo: polimento/volume no modo Supabase
- Ruling: integração Agrovex via GitHub Actions gerando plantio.json (CORS bloqueia navegador; token fica em secret) — custo: dado com até 1 h de atraso. Superado pela Task 5 do módulo MAPAS: no coa-web a rotina grava direto em `mapas_plantio_pims` via API REST do Supabase (chave de serviço), sem commit; o `plantio.json` local continua existindo só para uso sem as variáveis do Supabase (desenvolvimento).
- Ruling: Siriema + São Miguel = uma fazenda com setores (PIMS trata como unidade SIRIEMA).
- Ruling: status plantado = DT_PLANT_ENC ou área apontada >= 99% da prevista; plantando = parcial; a_plantar = sem apontamento.
- Ruling: PIMS prevalece sobre o plantio manual; manual só para talhões sem registro no PIMS.
- Ruling: seed (limites das unidades e áreas de soja) commitado em public/dados/seed — o usuário pediu pré-cadastro; repositório público expõe os limites (avisar).

## 2026-09-28-plantio-pims

- Ruling: A e B em paralelo (arquivos disjuntos); C depois (tipos); D depois de C.
- Ruling: hífen conta como separador na normalização ('001-A' → '001A') — Guapirama soja usa hífen — custo: nenhum (aplicado nos 3 lugares)
- Ruling: '19PESQ' → '019PESQ' dos dois lados (consistente) — custo: nenhum
- Ruling: seed mantém geometria completa (7,9 MB; ~2,2 MB gzip) — fidelidade > tamanho
- Ruling: máscara da interpolação = talhões base ∪ áreas da cultura (setor filtrado) — nenhuma área pintada fica sem chuva — custo: estatística das áreas extras aparece como linha com o código.

## Pendências deixadas de propósito (revisões finais)

- Modo Supabase: rodar `supabase/coa-web/0001_mapas.sql` no Supabase do COA WEB antes de usar esta versão (o app avisa).
- Tela de Safras carrega geometrias completas; trocar por listagem leve se ficar lenta no Supabase.
- Centróide da área da cultura = média dos vértices; áreas côncavas podem ser ligadas ao talhão vizinho (usar ponto interno se aparecer).
- Ao concluir o cadastro padrão na primeira abertura, as telas são recarregadas (edições não salvas se perdem).
- Três Flechas está sem shape de soja 26/27 (o zip enviado veio vazio); importar em Safras → Importar áreas.
- 'Manter manual' não existe: o PIMS prevalece; o plantio manual vale só onde o PIMS não tem registro.
- Repositório ainda sem remoto: criar no GitHub, configurar Pages (GitHub Actions) e o secret `AGROVEX_TOKEN`.
