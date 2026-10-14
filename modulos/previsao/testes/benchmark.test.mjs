// Testes das contas da aba Benchmark (previsao/benchmark-logica.js). Dados FICTÍCIOS.
// Rodar na raiz do repositório: node --test modulos/previsao/testes/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const B = createRequire(import.meta.url)('../../../previsao/benchmark-logica.js')
const foto = (fonte, unidade, emitida_em, dias, capturada_em = emitida_em + 'T10:20:00Z') =>
  ({ fonte, unidade, emitida_em, capturada_em, dias: dias.map(([d, mm, p = null]) => ({ d, mm, p })) })

test('hojeMT: UTC−4, independente do fuso do aparelho', () => {
  assert.equal(B.hojeMT(new Date('2026-10-15T03:59:00Z')), '2026-10-14')
  assert.equal(B.hojeMT(new Date('2026-10-15T04:00:00Z')), '2026-10-15')
})

test('proximosDias: 15 dias, a foto mais recente de cada fonte, total e divergência', () => {
  const linhas = [
    foto('zeus', 'GLOBO', '2026-10-14', [['2026-10-15', 99]]), // foto velha: não vale
    foto('zeus', 'GLOBO', '2026-10-15', [['2026-10-15', 12, 80], ['2026-10-16', 0, 5]]),
    foto('metno', 'GLOBO', '2026-10-15', [['2026-10-15', 0.4], ['2026-10-16', 1]]),
  ]
  const r = B.proximosDias(linhas, 'GLOBO', '2026-10-15')
  assert.equal(r.dias.length, 15)
  assert.equal(r.dias[14], '2026-10-29')
  assert.deepEqual(r.series.map((s) => s.fonte), ['zeus', 'metno']) // sem Visual Crossing: a fonte não aparece
  assert.deepEqual(r.series[0].mm.slice(0, 3), [12, 0, null])
  assert.deepEqual(r.series[0].p.slice(0, 2), [80, 5])
  assert.equal(r.series[0].total, 12)
  assert.deepEqual(r.divergentes, [0]) // 12 mm × 0,4 mm no primeiro dia
})

test('proximosDias: "Todas" é a média das fazendas que a fonte tem no dia', () => {
  const linhas = [foto('zeus', 'GLOBO', '2026-10-15', [['2026-10-15', 10]]), foto('zeus', 'DOURADO', '2026-10-15', [['2026-10-15', 4]])]
  assert.equal(B.proximosDias(linhas, B.TODAS, '2026-10-15').series[0].mm[0], 7)
})

test('proximosDias: sem nenhuma foto, sem séries (a tela mostra o aviso)', () => {
  assert.deepEqual(B.proximosDias([], 'GLOBO', '2026-10-15').series, [])
})

test('divergente: precisa de ≥ 10 mm numa fonte e < 1 mm em outra', () => {
  assert.equal(B.divergente([10, 0.9]), true)
  assert.equal(B.divergente([9.9, 0]), false)
  assert.equal(B.divergente([10, null]), false)
})

test('ranking: ordena pelo erro de 1 a 7 dias; quem tem menos de 10 pares vai para o fim', () => {
  const m = (fonte, antecedencia, n, erro_medio, vies = 0, acerto = 80) => ({ unidade: 'GLOBO', periodo: '30d', fonte, antecedencia, n, erro_medio, vies, acerto })
  const metricas = [m('zeus', 0, 30, 4.2), m('zeus', 1, 10, 3.1), m('visualcrossing', 0, 30, 3.5), m('metno', 0, 6, 1.0), { ...m('zeus', 0, 30, 9), periodo: '60d' }]
  const r = B.ranking(metricas, 'GLOBO', '30d')
  assert.deepEqual(r.map((x) => x.fonte), ['visualcrossing', 'zeus', 'metno'])
  assert.equal(r[2].geral.suficiente, false)
  assert.deepEqual(r[1].porAntecedencia.map((x) => x.k), [1, 3, 7, 13])
  assert.equal(r[1].porAntecedencia[0].valor.erro, 3.1)
  assert.equal(r[1].porAntecedencia[1].valor, null)
})

test('textoVies e temTodas', () => {
  assert.equal(B.textoVies(1.5), 'prevê chuva demais (+1,5 mm)')
  assert.equal(B.textoVies(-2), 'prevê chuva de menos (-2 mm)')
  assert.equal(B.textoVies(0.3), 'sem tendência')
  assert.equal(B.textoVies(null), '—')
  assert.equal(B.temTodas([{ unidade: 'GLOBO' }]), false)
  assert.equal(B.temTodas([{ unidade: 'TODAS' }]), true)
})

test('previstoMedido: 30 dias até ontem; a previsão de k dias antes', () => {
  const linhas = [foto('zeus', 'GLOBO', '2026-10-11', [['2026-10-14', 6]]), foto('zeus', 'GLOBO', '2026-10-13', [['2026-10-14', 9]])]
  const r = B.previstoMedido(linhas, [{ unidade: 'GLOBO', dia: '2026-10-14', mm: 7, pluviometros: 2 }], 'GLOBO', 3, '2026-10-15')
  assert.equal(r.dias.length, 30)
  assert.equal(r.dias[29], '2026-10-14')
  assert.equal(r.medido[29], 7)
  assert.equal(r.series[0].mm[29], 6) // emitida 3 dias antes (11/10), não a de 13/10
  assert.equal(B.diasDeFoto(linhas), 2)
})
