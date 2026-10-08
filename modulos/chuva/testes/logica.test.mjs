// Testes da lógica da "Chuva por talhão" (chuva/logica.js). Todos os dados daqui são FICTÍCIOS.
// Rodar na raiz do repositório: node --test modulos/chuva/testes/*.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../chuva/logica.js')

/**
 * Fazenda de mentira: janela de 20 dias (25/08 a 13/09/2026), mas a tabela da ZEUS só tem dado até o dia 14
 * (08/09) e ficou sem o dia 5. Três talhões e três pluviômetros.
 */
const LINHA = {
  unidade: 'TESTE', gerado_em: '2026-09-13T12:20:00.000Z', inicio: '2026-08-25', dias: 20, ultimo_dia: '2026-09-08', lidos: '0-4,6-14',
  talhoes: {
    '001': { de: 0, ate: 14, d: '1:2.4,4:10,5:99,7:0.6,13:30.25' },
    '002': { de: 0, ate: 14, d: '4:20,13:10' },
    P14: { de: 8, ate: 14, d: '' },
  },
  ciclos: [
    { s: 'SAFRA 2026/2027', p: 'SOJA 26/27', de: '2026-09-03', ate: '2027-08-31', t: ['001', '002'] },
    { s: 'SAFRA 2025/2026', p: 'MILHO 2ª SAFRA 25/26', de: '2026-02-01', ate: '2026-12-31', t: ['002'] },
    // ciclo que ainda não começou dentro do que a tabela tem: não aparece
    { s: 'SAFRA 2026/2027', p: 'MILHO 2ª SAFRA 26/27', de: '2027-01-20', ate: '2027-08-31', t: ['001'] },
    { s: 'sem ano', p: 'X', de: '2026-09-01', ate: '2026-09-02', t: [] },
  ],
  ultima_leitura: '2026-09-13T08:00',
  pics: [
    { id: '900', n: 'PIC_900-TESTE_SEDE', lat: -13.0, lon: -55.0, ul: '2026-09-13T08:00', d: '0,1:2.4,2,3,4:10.0,5,6,7:0.6,8,9,10,11,12,13:30.0,14,15,16,17,18,19' },
    { id: '901', n: 'PIC 07 (TH05,06) TESTE', lat: -13.0, lon: -55.1, ul: '2026-09-12T23:00', d: '13:9.0,14' },
    { id: '902', n: 'PIC 07 (TH33) TESTE', lat: null, lon: null, ul: null, d: '' },
  ],
  vinculos: { '001': [0], '002': [0, 1], '033': [1] },
}
const faz = L.prepararFazenda(LINHA)

test('prepararFazenda: a chuva de cada talhão vem pronta; dia fora da tabela é dia sem dado', () => {
  assert.deepEqual(faz.talhoes['001'], [0, 2.4, 0, 0, 10, null, 0, 0.6, 0, 0, 0, 0, 0, 30.25, 0, null, null, null, null, null])
  // o talhão só existe na tabela a partir do dia 8
  assert.deepEqual(faz.talhoes.P14.slice(6, 10), [null, null, 0, 0])
  // os períodos terminam no último dia com dado, não no fim da janela
  assert.equal(faz.fim, 14)
  assert.equal(faz.hoje, '2026-09-08')
  assert.equal(faz.temTalhoes, true)
  // texto estragado não derruba a tela
  const ruim = L.prepararFazenda({ ...LINHA, talhoes: { X: { de: 0, ate: 14, d: 'abc,3:xyz,99:1,-1:2,2:-5,4:1.5' }, Y: { de: 'a', ate: 3, d: '' } } })
  assert.deepEqual(ruim.talhoes.X.slice(0, 6), [0, 0, 0, 0, 1.5, null])
  assert.equal(ruim.talhoes.Y, undefined)
  // fazenda só com pluviômetro: os períodos vão até a última leitura deles
  const soPics = L.prepararFazenda({ ...LINHA, talhoes: {}, lidos: '' })
  assert.equal(soPics.temTalhoes, false)
  assert.equal(soPics.fim, 19)
})

test('pluviômetros: nome curto sem a fazenda; repetidos ficam com o trecho entre parênteses', () => {
  assert.deepEqual(faz.pics.map(p => p.nome), ['PIC 900 SEDE', 'PIC 07 (TH05,06)', 'PIC 07 (TH33)'])
  assert.deepEqual(faz.pics[1].mm.slice(12, 16), [null, 9, 0, null])
  assert.equal(L.nomeDoPic('PIC 14 (TH11,12,21,22) TESTE', 'TESTE'), 'PIC 14')
  assert.equal(L.nomeDoPic('PIC_45_TH02_TESTE_NORTE', 'TESTE NORTE'), 'PIC 45 TH02')
  assert.equal(L.nomeDoPic('PIC_Teste-TH1/07', 'TESTE'), 'PIC TH1/07')
  assert.equal(L.nomeDoPic('PIC 03_Testé', 'TESTE'), 'PIC 03')
  assert.equal(L.nomeDoPic('TESTE', 'TESTE'), 'TESTE') // não sobra nada: fica o nome como veio
})

test('ciclos: do plantio à colheita, cortados na safra deles (como no Power BI) e só os que já começaram', () => {
  assert.deepEqual(L.limitesDaSafra('SAFRA 2025/2026'), { de: '2025-09-01', ate: '2026-08-31' })
  assert.equal(L.limitesDaSafra('sem ano'), null)
  assert.deepEqual(faz.ciclos, [
    { i: 0, safra: 'SAFRA 2026/2027', periodo: 'SOJA 26/27', de: '2026-09-03', ate: '2027-08-31', talhoes: ['001', '002'] },
    // o período do PIMS vai até dezembro, mas a safra 2025/2026 acaba em 31/08
    { i: 1, safra: 'SAFRA 2025/2026', periodo: 'MILHO 2ª SAFRA 25/26', de: '2026-02-01', ate: '2026-08-31', talhoes: ['002'] },
  ])
  assert.deepEqual(faz.safras, [
    { ano: 2026, nome: 'Safra 2026/2027', de: '2026-09-01', ate: '2027-08-31' },
    { ano: 2025, nome: 'Safra 2025/2026', de: '2025-09-01', ate: '2026-08-31' },
  ])
})

test('resumoDaSerie: total, dias com chuva (1 mm ou mais), maior chuva e dias sem chuva', () => {
  const r = L.resumoDaSerie(faz.talhoes['001'], 0, 14, faz.ultimoDia)
  assert.equal(r.total, 43.25)
  assert.equal(r.diasChuva, 3) // 0,6 mm não é dia com chuva
  assert.deepEqual(r.maior, { i: 13, mm: 30.25 })
  assert.deepEqual(r.ultima, { i: 13, mm: 30.25 })
  assert.equal(r.diasSem, 1)
  assert.equal(r.semLeitura, 1) // o dia 5 não existe na tabela
  // período sem chuva: a última chuva é procurada antes dele
  const seco = L.resumoDaSerie(faz.talhoes['001'], 6, 12, faz.ultimoDia)
  assert.equal(seco.total, 0.6)
  assert.equal(seco.diasChuva, 0)
  assert.deepEqual(seco.ultima, { i: 4, mm: 10 })
  assert.equal(seco.diasSem, 8)
  // talhão que não está na tabela: não é zero, é sem valor
  const mudo = L.resumoDaSerie(null, 0, 14, faz.ultimoDia)
  assert.equal(mudo.total, null)
  assert.equal(mudo.semLeitura, 15)
  assert.equal(mudo.diasSem, null)
})

test('periodo: últimos dias, mês, safra, ciclo e datas livres, sempre até o último dia com dado', () => {
  assert.deepEqual(L.periodo('1', faz), { i0: 14, i1: 14, de: '2026-09-08', ate: '2026-09-08', dias: 1, talhoes: null })
  assert.deepEqual(L.periodo('7', faz), { i0: 8, i1: 14, de: '2026-09-02', ate: '2026-09-08', dias: 7, talhoes: null })
  assert.equal(L.periodo('30', faz).i0, 0) // a janela é menor
  assert.equal(L.periodo('mes', faz).de, '2026-09-01')
  // a safra 2026/2027 começou em 01/09 e a tabela só vai até 08/09
  assert.deepEqual(L.periodo('safra:2026', faz), { i0: 7, i1: 14, de: '2026-09-01', ate: '2026-09-08', dias: 8, talhoes: null })
  // a safra anterior acaba em 31/08; o começo dela é antes da janela
  assert.deepEqual(L.periodo('safra:2025', faz), { i0: 0, i1: 6, de: '2026-08-25', ate: '2026-08-31', dias: 7, talhoes: null })
  // o ciclo traz as datas e os talhões dele
  assert.deepEqual(L.periodo('ciclo:0', faz), { i0: 9, i1: 14, de: '2026-09-03', ate: '2026-09-08', dias: 6, talhoes: ['001', '002'] })
  assert.deepEqual(L.periodo('livre', faz, '2026-08-30', '2026-08-27'), { i0: 2, i1: 5, de: '2026-08-27', ate: '2026-08-30', dias: 4, talhoes: null })
  // valor que não existe (safra ou ciclo de outra fazenda): os últimos 7 dias
  assert.equal(L.periodo('safra:1999', faz).dias, 7)
  assert.equal(L.periodo('ciclo:9', faz).dias, 7)
})

test('opcoesDePeriodo: últimos dias, safras, ciclos do PIMS e datas livres', () => {
  const g = L.opcoesDePeriodo(faz)
  assert.deepEqual(g.map(x => x.grupo), ['Últimos dias com dado', 'Safra (setembro a agosto)', 'Ciclo da cultura (plantio à colheita)', 'Outro período'])
  assert.deepEqual(g[1].itens, [['safra:2026', 'Safra 2026/2027'], ['safra:2025', 'Safra 2025/2026']])
  assert.deepEqual(g[2].itens[0], ['ciclo:0', 'SOJA 26/27 · 03/09/2026 a 31/08/2027'])
  const semCiclo = L.opcoesDePeriodo(L.prepararFazenda({ ...LINHA, ciclos: [] }))
  assert.deepEqual(semCiclo.map(x => x.grupo), ['Últimos dias com dado', 'Safra (setembro a agosto)', 'Outro período'])
})

test('faixas de um dia: as do Power BI, com o limite de cima dentro da faixa', () => {
  assert.equal(L.FAIXAS_DIA.length, 13)
  assert.equal(L.corDoDia(null), L.COR_SEM_DADO)
  assert.equal(L.corDoDia(0), '#FFFFFF')
  assert.equal(L.corDoDia(0.01), '#C9E8FF')
  assert.equal(L.corDoDia(0.5), '#C9E8FF')
  assert.equal(L.corDoDia(0.51), '#A8D4F5')
  assert.equal(L.corDoDia(5), '#A8D4F5')
  assert.equal(L.corDoDia(5.01), '#7EBFEE')
  assert.equal(L.corDoDia(20), '#54A8E5')
  assert.equal(L.corDoDia(100), '#021443')
  assert.equal(L.corDoDia(100.01), '#010A2E')
  const dia = L.escalaDoPeriodo(1, [3, 40])
  assert.equal(dia.titulo, 'Chuva no dia (mm)')
  assert.equal(dia.cores.length, 14)
  assert.deepEqual(dia.rotulos.slice(0, 3), ['Sem chuva', '0,01 a 0,5', '0,51 a 5'])
  assert.equal(dia.cor(40), '#1677C4')
})

test('régua de vários dias: sai dos próprios valores, em passos redondos, com os azuis do Power BI', () => {
  assert.deepEqual(L.limitesChuva([40.6, 93.7, 74.9, null]), [1, 50, 60, 70, 80, 90, 100])
  assert.deepEqual(L.limitesChuva([8.8, 22.2, 16.4]), [1, 10, 15, 20, 25, 30, 35])
  assert.deepEqual(L.limitesChuva([310, 1480]), [1, 400, 600, 800, 1000, 1200, 1400])
  assert.deepEqual(L.limitesChuva([0, 0.2, null]), [1, 5, 10, 20, 30, 50, 75])
  const e = L.escalaDoPeriodo(7, [8.8, 22.2, 16.4])
  assert.equal(e.titulo, 'Chuva no período (mm)')
  assert.deepEqual(e.rotulos, ['< 1', '1 a 10', '10 a 15', '15 a 20', '20 a 25', '25 a 30', '30 a 35', '35 ou mais'])
  assert.equal(e.cores.length, e.rotulos.length)
  assert.equal(e.cor(0.4), '#FFFFFF')
  assert.equal(e.cor(8.8), '#C9E8FF')
  assert.equal(e.cor(22.2), '#54A8E5')
  assert.equal(e.cor(null), L.COR_SEM_DADO)
  assert.equal(L.CORES_SECA.length, L.LIMITES_SECA.length + 1)
  assert.deepEqual(L.rotulosClasses(L.LIMITES_SECA, true), ['0 a 2', '3 a 5', '6 a 10', '11 a 15', '16 a 20', '21 a 30', '31 ou mais'])
  assert.equal(L.tintaSobre('#C9E8FF'), '#17251F')
  assert.equal(L.tintaSobre('#052D6E'), '#FFFFFF')
})

const QUADRADO = { type: 'Polygon', coordinates: [[[-55.01, -13.01], [-55.0, -13.01], [-55.0, -13.0], [-55.01, -13.0], [-55.01, -13.01]]] }

test('geometria: caixa, centro, caminho e enquadramento', () => {
  assert.deepEqual(L.caixaGeom(QUADRADO), { oeste: -55.01, leste: -55.0, sul: -13.01, norte: -13.0 })
  const c = L.centroGeom(QUADRADO)
  assert.ok(Math.abs(c.lat + 13.005) < 1e-9 && Math.abs(c.lon + 55.005) < 1e-9)
  const multi = { type: 'MultiPolygon', coordinates: [QUADRADO.coordinates, [[[-54.0, -12.0], [-53.999, -12.0], [-53.999, -11.999], [-54.0, -12.0]]]] }
  assert.ok(Math.abs(L.centroGeom(multi).lon + 55.005) < 1e-9) // o centro é o do polígono maior
  const proj = L.projetor(L.caixaGeom(QUADRADO))
  assert.match(L.caminhoSvg(QUADRADO, proj), /^M-?\d+ -?\d+(L-?\d+ -?\d+){3,4}Z$/)
  const cx = L.caixaProjetada(L.caixaGeom(QUADRADO), proj)
  assert.ok(Math.abs(cx.w - 1085) < 3 && Math.abs(cx.h - 1106) < 3) // ~1,1 km de lado
  const v = L.vistaQueEnquadra(cx, { largura: 800, altura: 400 }, 0.1)
  assert.ok(Math.abs(v.w / v.h - 2) < 1e-9) // a vista tem a proporção da tela
  assert.ok(v.x < cx.x && v.y < cx.y && v.x + v.w > cx.x + cx.w && v.y + v.h > cx.y + cx.h)
  // com a legenda embaixo, a caixa cabe na parte de cima e a vista continua com a proporção da tela
  const comRodape = L.vistaQueEnquadra(cx, { largura: 800, altura: 400 }, 0.1, 1, 100)
  assert.ok(Math.abs(comRodape.w / comRodape.h - 2) < 1e-9)
  assert.ok(cx.y + cx.h < comRodape.y + comRodape.h * 0.75)
  assert.equal(L.caminhoSvg({ type: 'Point', coordinates: [0, 0] }, proj), '')
})

const TALHOES = [
  { codigo: '001', nome: '001', area: 100, centro: null },
  { codigo: '002', nome: '002', area: 300, centro: null },
  { codigo: 'P14', nome: 'P14', area: 50, centro: null },
  { codigo: '077', nome: '077', area: 50, centro: null }, // limite no mapa, mas fora da tabela da ZEUS
]

test('linhasDosTalhoes e resumoDaFazenda: a média pesa pela área; talhão fora da tabela fica sem valor', () => {
  const per = L.periodo('livre', faz, '2026-08-25', '2026-09-08')
  const linhas = L.linhasDosTalhoes(TALHOES, faz, per)
  assert.deepEqual(linhas.map(l => [l.codigo, l.total, l.semDado, l.foraDoCiclo]), [
    ['001', 43.25, false, false], ['002', 30, false, false], ['P14', 0, false, false], ['077', null, true, false],
  ])
  const r = L.resumoDaFazenda(linhas)
  assert.equal(r.media, 29.6) // (100×43,25 + 300×30 + 50×0) ÷ 450
  assert.equal(r.maior.codigo, '001')
  assert.equal(r.menor.codigo, 'P14')
  assert.equal(r.comValor, 3)
  assert.equal(r.semChuva, 1)
  assert.equal(r.semDado, 1)
  assert.equal(r.maisSeco.codigo, '001') // choveu no dia 13; o último dia com dado é o 14
  // período = ciclo: quem não é do ciclo fica marcado e sai das contas da fazenda
  const noCiclo = L.linhasDosTalhoes(TALHOES, faz, L.periodo('ciclo:0', faz))
  assert.deepEqual(noCiclo.map(l => [l.codigo, l.total, l.foraDoCiclo]), [['001', 30.25, false], ['002', 10, false], ['P14', 0, true], ['077', null, true]])
  assert.equal(L.resumoDaFazenda(noCiclo).n, 2)
  assert.equal(L.resumoDaFazenda(noCiclo).media, 15.1) // (100×30,25 + 300×10) ÷ 400
})

test('picsNoPeriodo: a chuva medida, o atraso da leitura e os talhões do cadastro da ZEUS', () => {
  const pics = L.picsNoPeriodo(faz, L.periodo('7', faz))
  assert.deepEqual(pics.map(p => [p.nome, p.total, p.situacao, p.atrasoH, p.talhoes]), [
    ['PIC 900 SEDE', 30, 'ok', 0, ['001', '002']],
    ['PIC 07 (TH05,06)', 9, 'atrasado', 9, ['002', '033']],
    ['PIC 07 (TH33)', null, 'sem-leitura', null, []],
  ])
  assert.equal(pics[1].semLeitura, 5)
})

test('ordenar: por coluna, com os talhões sem valor no fim', () => {
  const linhas = L.linhasDosTalhoes(TALHOES.concat([{ codigo: '010', nome: '010', area: 10, centro: null }]), faz, L.periodo('15', faz))
  assert.deepEqual(L.ordenar(linhas, 'total', true).map(l => l.codigo), ['001', '002', 'P14', '010', '077'])
  assert.deepEqual(L.ordenar(linhas, 'codigo', false).map(l => l.codigo), ['001', '002', '010', '077', 'P14'])
})

test('unidadeDaFazenda: casa a fazenda do COA WEB com a unidade, sem acento nem prefixo', () => {
  assert.equal(L.unidadeDaFazenda('Fazenda Três Flechas', ['GLOBO', 'TRES FLECHAS']), 'TRES FLECHAS')
  assert.equal(L.unidadeDaFazenda('Fazenda Inexistente', ['GLOBO']), null)
})
