// Testes da lógica da aba "Revista" do Acompanhamento Operacional (acompanhamento/revista-logica.js).
// Rodar na raiz do repositório: node --test modulos/acompanhamento/testes/*.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../acompanhamento/revista-logica.js')

const d = s => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]) }

/** Uma fazenda com 3 talhões: 001 plantado em dois dias, 002 em andamento, 003 não iniciado. */
function indicadores () {
  const ops = [
    { u: 'GLOBO', t: '001', d: '2026-09-10', a: 60, e: 'Ana' },
    { u: 'GLOBO', t: '001', d: '2026-09-11', a: 40, e: 'Beto' },
    { u: 'GLOBO', t: '002', d: '2026-09-11', a: 30, e: 'Ana' },
    { u: 'GLOBO', t: '002', d: '2026-09-14', a: 20, e: 'Ana' }
  ]
  const porDia = {}
  ops.forEach(a => { porDia[a.d] = (porDia[a.d] || 0) + a.a })
  return {
    unidades: ['GLOBO'], s: 'SOJA 26/27', o: 'PLANTIO', ops, porDia,
    ini: d('2026-09-10'), ult: d('2026-09-14'), diasDec: 5,
    talhoes: [
      { u: 'GLOBO', t: '001', setor: 'A', base: 120, efetivo: 100, perc: 0.83, k: 2, variedade: 'SEMENTE DE SOJA 80I82 IPRO' },
      { u: 'GLOBO', t: '002', setor: 'A', base: 100, efetivo: 50, perc: 0.5, k: 1, variedade: '23311 I2X' },
      { u: 'GLOBO', t: '003', setor: 'B', base: 80, efetivo: 0, perc: 0, k: 0, variedade: 'A DEFINIR' }
    ]
  }
}

// ------------------------------------------------------------- variedades
test('limparVariedade: tira "SEMENTE DE <cultura>" e a cultura do fim; vazio e A DEFINIR viram null', () => {
  assert.equal(L.limparVariedade('SEMENTE DE SOJA 80I82 IPRO'), '80I82 IPRO')
  assert.equal(L.limparVariedade('NEO771 I2X SOJA'), 'NEO771 I2X')
  assert.equal(L.limparVariedade(' a definir '), null)
  assert.equal(L.limparVariedade(''), null)
  assert.equal(L.limparVariedade(null), null)
})

test('coresDasVariedades: usa a cor cadastrada (pela chave) e, sem cadastro, a cor da paleta menos usada', () => {
  const cores = L.coresDasVariedades(['80I82 IPRO', 'X', 'Y'], [{ chave: '80i82  ipro', cor: '#1f77b4' }])
  assert.equal(cores['80I82 IPRO'], '#1F77B4')
  assert.equal(cores.X, L.PALETA_VARIEDADES[1]) // a 1ª da paleta já está em uso
  assert.equal(cores.Y, L.PALETA_VARIEDADES[2])
})

test('nomeExibido e comerciaisDe: "Nome comercial (nome do PIMS)", pela chave da variedade', () => {
  const c = L.comerciaisDe([{ chave: '80i82  ipro', nome: ' Bônus ' }, { chave: 'X', nome: '' }, { chave: 'Y', nome: null }])
  assert.deepEqual(c, { '80I82 IPRO': 'Bônus' })
  assert.equal(L.nomeExibido('80I82 IPRO', c[L.chaveVariedade('80I82 IPRO')]), 'Bônus (80I82 IPRO)')
  assert.equal(L.nomeExibido('23311 I2X', undefined), '23311 I2X')
})

test('editorial: a maior variedade sai com o nome de exibição quando ele existe', () => {
  const m = Object.assign(indicadores(), { pct: 0.5, exec: 150, areaTotal: 300, restante: 150, media: 50 })
  const vs = L.variedadesDoPlantio(m, L.talhoesDoPlantio(m))
  vs[0].nome = 'Bônus (80I82 IPRO)'
  const p = L.editorial({ m, nome: 'Fazenda Globo', rel: { concluida: false, difPrevisao: null, corr: null }, destaques: L.destaquesDoRitmo(m), variedades: vs })
  assert.ok(p.some((t) => t.includes('a **Bônus (80I82 IPRO)** é a maior')))
})

// ------------------------------------------------------------- talhões e ritmo
test('talhoesDoPlantio: primeiro e último dia, dias com boletim, equipes da que mais fez e variedade limpa', () => {
  const t = L.talhoesDoPlantio(indicadores())
  assert.deepEqual(t.map(x => [x.t, x.ini, x.fim, x.diasOp]), [['001', '2026-09-10', '2026-09-11', 2], ['002', '2026-09-11', '2026-09-14', 2], ['003', null, null, 0]])
  assert.deepEqual(t[0].equipes, ['Ana', 'Beto'])
  assert.equal(t[0].variedade, '80I82 IPRO')
  assert.equal(t[2].variedade, null)
})

test('destaquesDoRitmo: melhor dia, dias parados e maior sequência no período (do 1º ao último boletim)', () => {
  const r = L.destaquesDoRitmo(indicadores())
  assert.deepEqual(r.melhorDia, { d: '2026-09-11', a: 70 })
  assert.equal(r.diasComOperacao, 3)
  assert.equal(r.diasParados, 2) // 12 e 13/09
  assert.deepEqual(r.maiorSequencia, { de: '2026-09-10', ate: '2026-09-11', dias: 2 })
  // menos de 7 dias de operação: a "melhor semana" é o período todo
  assert.deepEqual(r.melhorSemana, { de: '2026-09-10', ate: '2026-09-14', ha: 150 })
})

test('destaquesDoRitmo: sem boletins não quebra', () => {
  const r = L.destaquesDoRitmo({ ini: null, ult: null })
  assert.equal(r.melhorDia, null)
  assert.equal(r.diasParados, 0)
})

test('variedadesDoPlantio: prevista, plantada, janela e "Sem variedade" por último', () => {
  const m = indicadores()
  const v = L.variedadesDoPlantio(m, L.talhoesDoPlantio(m))
  assert.deepEqual(v.map(x => x.v), ['80I82 IPRO', '23311 I2X', 'Sem variedade'])
  assert.equal(v[0].ini, '2026-09-10')
  assert.equal(v[0].fim, '2026-09-11')
  assert.equal(v[1].pct, 0.5)
  assert.deepEqual(v[1].porDia, { '2026-09-11': 30, '2026-09-14': 20 })
  assert.equal(v[2].exec, 0)
})

test('equipesDoPlantio: total, dias, média por dia trabalhado e talhões', () => {
  const e = L.equipesDoPlantio(indicadores())
  assert.equal(e[0].nome, 'Ana')
  assert.equal(e[0].total, 110)
  assert.equal(e[0].dias, 3)
  assert.equal(Math.round(e[0].media), 37)
  assert.equal(e[0].talhoes, 2)
  assert.deepEqual(e[0].melhor, { d: '2026-09-10', a: 60 })
})

test('semanasDePlantio: semana do início de cada talhão contada do 1º dia da fazenda', () => {
  const tal = [
    { u: 'G', t: '1', ini: '2026-09-10', base: 10 }, { u: 'G', t: '2', ini: '2026-09-16', base: 20 },
    { u: 'G', t: '3', ini: '2026-09-17', base: 30 }, { u: 'G', t: '4', ini: null, base: 40 }
  ]
  const s = L.semanasDePlantio(tal, '2026-09-10')
  assert.deepEqual(s.de, { 'G|1': 1, 'G|2': 1, 'G|3': 2 })
  assert.equal(s.classes.length, 2)
  assert.equal(s.classes[0].ha, 30)
  assert.equal(s.classes[1].rotulo, '2ª semana · 17/09 a 23/09')
})

test('semanasDePlantio: depois da 8ª semana tudo vai para a última classe', () => {
  const s = L.semanasDePlantio([{ u: 'G', t: '1', ini: '2026-12-31', base: 1 }], '2026-09-01')
  assert.equal(s.de['G|1'], 8)
  assert.match(s.classes[7].rotulo, /em diante$/)
})

// ------------------------------------------------------------- chuva
test('chuvaDosTalhoes: antes, depois (janela de 10 dias) e desde o plantio; janela incompleta fica null', () => {
  const serie = new Array(40).fill(0)
  serie[2] = 8 // 03/09: antes do plantio do talhão 1 (10/09)
  serie[9] = 5 // 10/09: dia do plantio entra no "depois"
  serie[18] = 12 // 19/09: último dia da janela de 10 dias
  serie[19] = 30 // 20/09: fora da janela, dentro do "desde"
  const chuva = { inicio: '2026-09-01', fim: 25, serieDe: c => c === 'SEM' ? null : serie }
  const tal = [{ u: 'G', t: '1', ini: '2026-09-10' }, { u: 'G', t: '2', ini: '2026-09-20' }, { u: 'G', t: 'SEM', ini: '2026-09-10' }]
  const r = L.chuvaDosTalhoes(tal, chuva, '2026-09-10')
  assert.equal(r[0].antes, 8)
  assert.equal(r[0].depois, 17)
  assert.equal(r[0].desde, 47)
  assert.equal(r[0].periodo, 47)
  assert.equal(r[1].depois, null) // 20/09 + 9 = 29/09, depois do último dia com dado (26/09)
  assert.equal(r[2].temDado, false)
  const p = L.resumoPosPlantio(r)
  assert.equal(p.talhoes, 1)
  assert.equal(p.media, 17)
  assert.equal(p.poucaChuva.length, 0)
  assert.equal(p.aguardando, 1)
})

test('serieChuva e resumoChuva: total, dias com chuva, maior chuva e maior seca', () => {
  const s = L.serieChuva({ '2026-09-02': 12, '2026-09-03': 0.4, '2026-09-06': 3 }, '2026-09-01', '2026-09-06')
  assert.equal(s.length, 6)
  const r = L.resumoChuva(s)
  assert.equal(r.mm, 15.4)
  assert.equal(r.dias, 2)
  assert.deepEqual(r.maior, { d: '2026-09-02', mm: 12 })
  assert.deepEqual(r.maiorSeca, { de: '2026-09-03', ate: '2026-09-05', dias: 3 })
})

// ------------------------------------------------------------- mapas salvos
test('mapasDoPeriodo: só os que cruzam o período, do mais antigo ao mais novo', () => {
  const l = L.mapasDoPeriodo([
    { id: 'c', inicio: '2026-09-20', fim: '2026-09-25', criadoEm: '2026-09-26' },
    { id: 'a', inicio: '2026-08-01', fim: '2026-08-31', criadoEm: '2026-09-01' },
    { id: 'b', inicio: '2026-09-05', fim: '2026-09-12', criadoEm: '2026-09-13' }
  ], '2026-09-10', '2026-10-01')
  assert.deepEqual(l.map(x => x.id), ['b', 'c'])
})

// ------------------------------------------------------------- textos
test('editorial: situação, ritmo, chuva e variedades em parágrafos com negrito', () => {
  const m = Object.assign(indicadores(), { pct: 0.54, exec: 150, areaTotal: 280, restante: 130, media7: 50, previsao: d('2026-09-17'), media: 50 })
  const tal = L.talhoesDoPlantio(m)
  const p = L.editorial({
    m, nome: 'Fazenda Globo', rel: { concluida: false, difPrevisao: -2, corr: null },
    destaques: L.destaquesDoRitmo(m), variedades: L.variedadesDoPlantio(m, tal),
    chuva: { mm: 20, dias: 2 }, posPlantio: null, previsao: { mm: 12, dias: 7, de: '2026-09-15', ate: '2026-09-21' }
  })
  assert.match(p[0], /^Na Fazenda Globo, o plantio chegou a \*\*54%\*\*/)
  assert.match(p[1], /2 dias antes do planejado/)
  assert.match(p[2], /Choveu \*\*20 mm\*\* em 2 dias/)
  assert.match(p[3], /a \*\*80I82 IPRO\*\* é a maior/)
  assert.match(p[4], /\*\*12 mm\*\* entre 15\/09 e 21\/09/)
})

test('editorial: a chuva pós-plantio diz até que dia vai a chuva por talhão', () => {
  const m = Object.assign(indicadores(), { pct: 0.5, exec: 150, areaTotal: 300, restante: 150, media: 50 })
  const p = L.editorial({
    m, nome: 'Fazenda Globo', rel: { concluida: false, difPrevisao: null, corr: null }, destaques: L.destaquesDoRitmo(m), variedades: [],
    chuva: { mm: 20, dias: 2 }, posPlantio: { talhoes: 3, media: 12, poucaChuva: [{}], aguardando: 0 }, ateChuvaTalhao: '2026-10-07'
  })
  assert.match(p[2], /\(chuva por talhão da ZEUS, que vai até 07\/10\), os talhões receberam em média 12 mm; 1 talhão teve menos de 10 mm\./)
})

test('editorial e manchete sem boletins', () => {
  assert.equal(L.manchete({ ini: null }), 'O plantio ainda não começou')
  assert.match(L.editorial({ m: { ini: null }, rel: {} })[0], /Ainda não há boletins/)
})
