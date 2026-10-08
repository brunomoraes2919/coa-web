// Testes da lógica da aba "Relatórios" do Acompanhamento Operacional (acompanhamento/relatorio-logica.js).
// Rodar na raiz do repositório: node --test modulos/acompanhamento/testes/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../acompanhamento/relatorio-logica.js')

const d = s => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]) }
const HOJE = d('2026-09-12')

/** Indicadores como `calcula()` do app.js devolve (fazenda com 6 dias de plantio, meta e uma safra anterior). */
function indicadores(extra) {
  const porDiaAnt = { '2025-09-05': 100, '2025-09-10': 100, '2025-09-20': 300 }
  const dias = Object.keys(porDiaAnt).sort()
  const anterior = {
    nome: 'SOJA 25/26', anos: 1, porDia: porDiaAnt,
    acumAte(data) { const k = data.toISOString().slice(0, 10); return dias.filter(x => x <= k).reduce((s, x) => s + porDiaAnt[x], 0) }
  }
  return Object.assign({
    unidades: ['GLOBO'], s: 'SOJA 26/27', o: 'PLANTIO',
    areaTotal: 1000, exec: 460, restante: 540, pct: 0.46, apontado: 450, replantio: 10,
    ini: d('2026-09-07'), ult: d('2026-09-12'), diasDec: 6, media: 75, media7: 90, ritmo: 90,
    previsao: d('2026-09-18'), diasPrev: 6, termino: d('2026-09-25'), diasPlan: 13, necessario: 41.5, metaHoje: 60,
    porDia: { '2026-09-07': 100, '2026-09-08': 150, '2026-09-10': 200 },
    porClasse: [{ k: 0, n: 5, ha: 500 }, { k: 1, n: 0, ha: 0 }, { k: 2, n: 1, ha: 40 }, { k: 3, n: 4, ha: 460 }],
    talhoes: new Array(10).fill(0).map((_, i) => ({ t: String(i + 1), base: 100, perc: i < 4 ? 1 : i === 4 ? 0.6 : 0, k: i < 4 ? 3 : i === 4 ? 2 : 0 })),
    equipes: [{ nome: 'Ernani', total: 300, ult7: 300, dias7: 3 }, { nome: 'Augusto', total: 150, ult7: 150, dias7: 2 }],
    variedades: [{ v: 'A', prev: 600, exec: 400 }, { v: 'B', prev: 400, exec: 60 }],
    planos: [{}], comparativos: [anterior]
  }, extra || {})
}
// chuva da fazenda (mm por dia): 08 e 09 com mais de 5 mm (no dia 09 não se plantou); 20/09 fica fora do período
const CHUVA = { '2026-09-07': 0.5, '2026-09-08': 12, '2026-09-09': 6, '2026-09-10': 2, '2026-09-11': 0, '2026-09-12': 0, '2026-09-20': 30, '2025-09-06': 10, '2025-09-15': 8 }

// ------------------------------------------------------------- chuva × operação
test('correlacaoChuva: soma a chuva e conta os dias com chuva só dentro do período da operação', () => {
  const c = L.correlacaoChuva(indicadores(), CHUVA)
  assert.equal(c.temChuva, true)
  assert.equal(c.mm, 20.5)
  assert.equal(c.diasChuva, 3)        // 08 (12 mm), 09 (6 mm) e 10 (2 mm); 0,5 mm não conta
  assert.equal(c.diasPeriodo, 6)
})

test('correlacaoChuva: separa a média de ha/dia entre dias com mais de 5 mm e os demais, e conta os dias parados pela chuva', () => {
  const c = L.correlacaoChuva(indicadores(), CHUVA)
  assert.equal(c.comChuva.dias, 2)    // 08 e 09
  assert.equal(c.comChuva.media, 75)  // (150 + 0) / 2
  assert.equal(c.semChuva.dias, 4)    // 07, 10, 11, 12
  assert.equal(c.semChuva.media, 75)  // (100 + 200 + 0 + 0) / 4
  assert.equal(c.parados, 1)          // 09: 6 mm e nada plantado
})

test('correlacaoChuva: sem dados de chuva da fazenda, avisa em vez de inventar zeros', () => {
  const c = L.correlacaoChuva(indicadores(), {})
  assert.equal(c.temChuva, false)
  assert.equal(c.mm, 0)
})

// ------------------------------------------------------------- safra atual × anteriores
test('comparativoSafras: a primeira linha é a safra atual, com o que já foi feito e a duração até agora', () => {
  const l = L.comparativoSafras(indicadores(), CHUVA, HOJE)
  assert.equal(l[0].nome, 'SOJA 26/27')
  assert.equal(l[0].atual, true)
  assert.equal(l[0].ateData, 450)
  assert.equal(l[0].total, 1000)
  assert.equal(l[0].pctNaData, 0.45)
  assert.equal(l[0].duracao, 6)
  assert.equal(l[0].emAndamento, true)
  assert.equal(l[0].chuva.mm, 20.5)
})

test('comparativoSafras: a safra anterior mostra quanto tinha plantado na mesma data do ano, a safra inteira e a chuva dela', () => {
  const l = L.comparativoSafras(indicadores(), CHUVA, HOJE)
  assert.equal(l.length, 2)
  const a = l[1]
  assert.equal(a.nome, 'SOJA 25/26')
  assert.equal(a.ateData, 200)              // até 12/09/2025: 05/09 e 10/09
  assert.equal(a.total, 500)
  assert.equal(a.pctNaData, 0.4)
  assert.equal(a.ini.getTime(), d('2025-09-05').getTime())
  assert.equal(a.fim.getTime(), d('2025-09-20').getTime())
  assert.equal(a.duracao, 16)
  assert.equal(a.diasOp, 3)
  assert.equal(a.chuva.mm, 18)              // 06/09 e 15/09 de 2025
  assert.equal(a.chuva.dias, 2)
  assert.equal(Math.round(a.difAtual * 100), 125) // 450 / 200 - 1
})

// ------------------------------------------------------------- leitura (frases)
test('frases: operação em andamento acima da meta diz o ritmo, a diferença para a meta e a antecipação do término', () => {
  const r = L.consolidar(indicadores(), CHUVA, HOJE, { fazenda: 'Globo' })
  const t = L.frases(r).join(' ')
  assert.match(t, /46% concluído/)
  assert.match(t, /90 ha\/dia/)
  assert.match(t, /50% acima da meta de 60 ha\/dia/)
  assert.match(t, /termina em \*\*18\/09\*\*, 7 dias antes da data planejada \(25\/09\)/)
  assert.match(t, /bastariam 42 ha\/dia/)
})

test('frases: compara com a safra anterior na mesma data e resume a chuva', () => {
  const r = L.consolidar(indicadores(), CHUVA, HOJE, { fazenda: 'Globo' })
  const t = L.frases(r).join(' ')
  assert.match(t, /Soja 25\/26\*\* tinha 200 ha plantados/)
  assert.match(t, /2,3× maior/)
  assert.match(t, /21 mm em 3 dias/)
  assert.match(t, /1 dia parado pela chuva/)
})

test('frases: operação concluída não fala de meta, previsão nem do que falta', () => {
  const m = indicadores({ exec: 1000, restante: 0, pct: 1, apontado: 1000, diasPrev: 0, previsao: d('2026-09-12'), diasPlan: 0, necessario: null })
  const t = L.frases(L.consolidar(m, CHUVA, HOJE, { fazenda: 'Globo' })).join(' ')
  assert.match(t, /concluído/)
  assert.doesNotMatch(t, /faltam/)
  assert.doesNotMatch(t, /meta/)
})

test('frases: sem meta cadastrada e sem safra anterior, fala só do ritmo e da previsão', () => {
  const m = indicadores({ planos: [], metaHoje: null, termino: null, diasPlan: null, necessario: null, comparativos: [] })
  const t = L.frases(L.consolidar(m, {}, HOJE, { fazenda: 'Globo' })).join(' ')
  assert.match(t, /90 ha\/dia/)
  assert.match(t, /termina em \*\*18\/09\*\*\./)
  assert.match(t, /sem meta cadastrada/)
  assert.doesNotMatch(t, /mesma data/)
  assert.doesNotMatch(t, /mm/)
})

test('frases: sem apontamentos, uma frase só', () => {
  const m = indicadores({ ini: null, ult: null, diasDec: null, exec: 0, pct: 0, apontado: 0, media: null, media7: null, ritmo: null, previsao: null, diasPrev: null, porDia: {}, comparativos: [] })
  const f = L.frases(L.consolidar(m, CHUVA, HOJE, { fazenda: 'Globo' }))
  assert.equal(f.length, 1)
  assert.match(f[0], /Ainda não há apontamentos de plantio/)
})

test('frases: safra anterior que ainda não tinha começado na data não vira "0 ha plantados"', () => {
  const tarde = { nome: 'SOJA 24/25', anos: 2, porDia: { '2024-10-01': 300, '2024-10-02': 200 }, acumAte() { return 0 } }
  const m = indicadores({ comparativos: [tarde] })
  const t = L.frases(L.consolidar(m, {}, HOJE, { fazenda: 'Globo' })).join(' ')
  assert.match(t, /a \*\*Soja 24\/25\*\* ainda não tinha começado \(começou em 01\/10\)/)
  assert.doesNotMatch(t, /0 ha plantados/)
})

test('frases: com duas safras anteriores, a segunda oração começa em minúscula depois do ponto e vírgula', () => {
  const outra = { nome: 'SOJA 24/25', anos: 2, porDia: { '2024-09-01': 300, '2024-09-02': 200 }, acumAte() { return 500 } }
  const m = indicadores({ comparativos: indicadores().comparativos.concat([outra]) })
  const t = L.frases(L.consolidar(m, CHUVA, HOJE, { fazenda: 'Globo' })).join(' ')
  assert.match(t, /\(05\/09 a 20\/09\); a Soja 24\/25 levou 2 dias/)
})

// ------------------------------------------------------------- "Todas as fazendas"
test('consolidar: no geral, com meta cadastrada só em parte das fazendas, não compara ritmo nem previsão com a meta somada', () => {
  const geral = indicadores({ unidades: ['GLOBO', 'SM3', 'DOURADO'], planos: [{}] })
  const r = L.consolidar(geral, {}, HOJE, { todas: true, linhas: [] })
  assert.equal(r.metaParcial, true)
  assert.equal(r.difMeta, null)
  assert.equal(r.difPrevisao, null)
  const t = L.frases(r).join(' ')
  assert.doesNotMatch(t, /acima da meta/)
  assert.match(t, /meta cadastrada em 1 das 3 fazendas/)
})

test('consolidar: no geral, com meta em todas as fazendas, compara normalmente', () => {
  const geral = indicadores({ unidades: ['GLOBO', 'SM3'], planos: [{}, {}] })
  const r = L.consolidar(geral, {}, HOJE, { todas: true, linhas: [] })
  assert.equal(r.metaParcial, false)
  assert.equal(Math.round(r.difMeta * 100), 50)
})

test('linhaFazenda: resume uma fazenda para a tabela do relatório geral', () => {
  const l = L.linhaFazenda('GLOBO', indicadores(), CHUVA, HOJE)
  assert.equal(l.u, 'GLOBO')
  assert.equal(l.pct, 0.46)
  assert.equal(l.media7, 90)
  assert.equal(l.metaHoje, 60)
  assert.equal(l.difPrevisao, -7)           // previsão 7 dias antes do planejado
  assert.equal(l.anterior.nome, 'SOJA 25/26')
  assert.equal(Math.round(l.anterior.dif * 100), 125)
  assert.equal(l.chuvaMm, 20.5)
})

test('frases: no geral, cita o número de fazendas e a mais adiantada e a mais atrasada', () => {
  const geral = indicadores({ unidades: ['GLOBO', 'SM3'] })
  const linhas = [L.linhaFazenda('GLOBO', indicadores(), CHUVA, HOJE), L.linhaFazenda('SM3', indicadores({ pct: 0.8, exec: 800, restante: 200 }), {}, HOJE)]
  const t = L.frases(L.consolidar(geral, {}, HOJE, { todas: true, linhas })).join(' ')
  assert.match(t, /nas 2 fazendas/)
  assert.match(t, /SM3 \(80%\)/)
  assert.match(t, /Globo \(46%\)/)
})

test('execucaoDoTalhao: a área feita é só a apontada nos boletins, limitada à área do talhão', () => {
  // talhão de 179 ha com 165 ha apontados: conta 165, mesmo que o plantio esteja encerrado no PIMS
  const parcial = L.execucaoDoTalhao(179, 165)
  assert.equal(parcial.efetivo, 165)
  assert.equal(Math.round(parcial.perc * 1000), 922)
  assert.deepEqual(L.execucaoDoTalhao(200, 200), { perc: 1, efetivo: 200 })
  assert.deepEqual(L.execucaoDoTalhao(200, 230), { perc: 1, efetivo: 200 }) // apontado a mais não passa da área
  assert.deepEqual(L.execucaoDoTalhao(200, 0), { perc: 0, efetivo: 0 })
  assert.deepEqual(L.execucaoDoTalhao(0, 12), { perc: 1, efetivo: 0 }) // talhão todo em dano
})
