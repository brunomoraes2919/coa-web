// Testes das contas do relatório em PDF (previsao/relatorio-logica.js). Dados FICTÍCIOS.
// Rodar na raiz do repositório: node --test modulos/previsao/testes/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const R = createRequire(import.meta.url)('../../../previsao/relatorio-logica.js')
const foto = (fonte, unidade, emitida_em, dias, capturada_em = emitida_em + 'T10:20:00Z') => ({ fonte, unidade, emitida_em, capturada_em, dias })
const dia = (d, mm, p = null, tx, tn) => (tx === undefined ? { d, mm, p } : { d, mm, p, tx, tn })
const so = (previsoes, hoje = '2026-10-15') => R.montarRelatorio(previsoes, [{ nome: 'Globo', unidade: 'GLOBO' }], hoje).fazendas[0]

test('período: de hoje até o último dia com dado; a foto da véspera não traz dias passados', () => {
  const f = so([foto('zeus', 'GLOBO', '2026-10-14', [dia('2026-10-14', 9, 80), dia('2026-10-15', 2, 40), dia('2026-10-16', 0, 5)])])
  assert.deepEqual(f.dias, ['2026-10-15', '2026-10-16'])
  assert.deepEqual(f.mm, [2, 0])
  assert.deepEqual(f.p, [40, 5])
  assert.equal(f.total, 2)
  assert.equal(f.fotos.chuva, '2026-10-14T10:20:00Z')
  assert.equal(f.semDados, false)
})

test('temperatura: Visual Crossing quando a foto dele tem temperatura; senão MET Norway; senão nenhuma', () => {
  const zeus = foto('zeus', 'GLOBO', '2026-10-15', [dia('2026-10-15', 1, 10), dia('2026-10-16', 2, 20)])
  const vcSem = foto('visualcrossing', 'GLOBO', '2026-10-15', [dia('2026-10-15', 0, 0)]) // foto de antes da temperatura
  const vc = foto('visualcrossing', 'GLOBO', '2026-10-15', [dia('2026-10-15', 0, 0, 34, 22), dia('2026-10-16', 0, 0, 35, 23)])
  const met = foto('metno', 'GLOBO', '2026-10-15', [dia('2026-10-16', 0, null, 33.5, 21)], '2026-10-15T10:21:00Z')
  const comVc = so([zeus, vc, met])
  assert.equal(comVc.fonteTemperatura, 'visualcrossing')
  assert.deepEqual(comVc.tx, [34, 35])
  assert.deepEqual(comVc.tn, [22, 23])
  const r = R.montarRelatorio([zeus, vcSem, met], [{ nome: 'Globo', unidade: 'GLOBO' }], '2026-10-15')
  assert.equal(r.fazendas[0].fonteTemperatura, 'metno')
  assert.deepEqual(r.fazendas[0].tx, [null, 33.5])
  assert.deepEqual(r.fontesTemperatura, ['metno'])
  assert.equal(r.fotoMaisRecente, '2026-10-15T10:21:00Z')
  const nenhuma = so([zeus])
  assert.equal(nenhuma.fonteTemperatura, null)
  assert.deepEqual(nenhuma.tn, [null, null])
  assert.equal(nenhuma.fotos.temperatura, null)
})

test('foto com mais de 3 dias não entra; fazenda sem unidade do PIMS fica fora', () => {
  const r = R.montarRelatorio([foto('zeus', 'GLOBO', '2026-10-12', [dia('2026-10-15', 5, 50)])],
    [{ nome: 'Globo', unidade: 'GLOBO' }, { nome: 'Sem PIMS', unidade: null }], '2026-10-15')
  assert.equal(r.fazendas.length, 1)
  assert.equal(r.fazendas[0].semDados, true)
  assert.deepEqual(r.fazendas[0].dias, [])
  assert.equal(r.fazendas[0].total, null)
  assert.equal(r.fotoMaisRecente, null)
})

test('no máximo 15 dias; sem chuva, total null', () => {
  const dias = Array.from({ length: 20 }, (_, i) => dia(R.somarDias('2026-10-15', i), null, null, 30, 20))
  const f = so([foto('visualcrossing', 'GLOBO', '2026-10-15', dias)])
  assert.equal(f.dias.length, 15)
  assert.equal(f.dias[14], '2026-10-29')
  assert.equal(f.total, null)
})

test('fazendas em ordem alfabética (com acento) e foto mais recente entre todas', () => {
  const previsoes = [foto('zeus', 'TRES FLECHAS', '2026-10-15', [dia('2026-10-15', 1, 10)], '2026-10-15T10:25:00Z'), foto('zeus', 'GLOBO', '2026-10-15', [dia('2026-10-15', 3, 30)])]
  const r = R.montarRelatorio(previsoes, [{ nome: 'Três Flechas', unidade: 'TRES FLECHAS' }, { nome: 'Globo', unidade: 'GLOBO' }, { nome: 'Dourado', unidade: 'DOURADO' }], '2026-10-15')
  assert.deepEqual(r.fazendas.map((f) => f.nome), ['Dourado', 'Globo', 'Três Flechas'])
  assert.equal(r.fotoMaisRecente, '2026-10-15T10:25:00Z')
})

test('paraPdf mantém acentos, travessão, ponto e grau; troca o que a fonte do PDF não tem', () => {
  assert.equal(R.paraPdf('Três Flechas — 15/10 · 33 °C'), 'Três Flechas — 15/10 · 33 °C')
  assert.equal(R.paraPdf('≥ 10 mm'), '>= 10 mm')
  assert.equal(R.paraPdf('chuva → 🌧'), 'chuva ? ?')
  assert.equal(R.nomeArquivo('2026-10-15'), 'previsao-fazendas-2026-10-15.pdf')
})

test('temperatura: dia que falta na foto mais recente vem da foto anterior da mesma fonte (o hoje do MET Norway)', () => {
  const zeus = foto('zeus', 'GLOBO', '2026-10-15', [dia('2026-10-15', 1, 10), dia('2026-10-16', 2, 20), dia('2026-10-17', 0, 5)])
  // a foto de hoje do MET começa amanhã; a de ontem tem o dia de hoje inteiro (e um 16/10 mais velho, que perde para o de hoje)
  const metHoje = foto('metno', 'GLOBO', '2026-10-15', [dia('2026-10-16', 0, null, 33, 22), dia('2026-10-17', 0, null, 34, 23)], '2026-10-15T10:17:00Z')
  const metOntem = foto('metno', 'GLOBO', '2026-10-14', [dia('2026-10-15', 0, null, 31, 20), dia('2026-10-16', 0, null, 30, 19)], '2026-10-14T10:17:00Z')
  const f = so([zeus, metOntem, metHoje])
  assert.deepEqual(f.tx, [31, 33, 34])
  assert.deepEqual(f.tn, [20, 22, 23])
  assert.equal(f.fonteTemperatura, 'metno')
  assert.equal(f.fotos.temperatura, '2026-10-15T10:17:00Z')
  assert.equal(f.fotos.temperaturaAnterior, '2026-10-14T10:17:00Z')
  // nada a completar: sem foto anterior
  const g = so([zeus, metHoje, foto('metno', 'GLOBO', '2026-10-14', [], '2026-10-14T10:17:00Z')])
  assert.deepEqual(g.tx, [null, 33, 34])
  assert.equal(g.fotos.temperaturaAnterior, null)
})

test('faixa de temperatura: altura da faixa entre a mínima e a máxima de cada dia; sem um dos dois, sem faixa', () => {
  assert.deepEqual(R.faixaDeTemperatura([31.7, 33, null, 30], [22.2, null, 21, 19.9]), [9.5, null, null, 10.1])
})
