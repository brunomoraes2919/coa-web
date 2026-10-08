// Testes da lógica da "Chuva por talhão" (chuva/logica.js). Todos os dados daqui são FICTÍCIOS.
// Rodar na raiz do repositório: node --test modulos/chuva/testes/*.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../chuva/logica.js')

/** Fazenda de mentira: janela de 10 dias (01/10 a 10/10/2026) e três pluviômetros. */
const LINHA = {
  unidade: 'TESTE', gerado_em: '2026-10-10T12:20:00.000Z', inicio: '2026-10-01', dias: 10, ultima_leitura: '2026-10-10T08:00',
  pics: [
    { id: '900', n: 'PIC_900-TESTE_SEDE', lat: -13.0, lon: -55.0, ul: '2026-10-10T08:00', d: '0,1:2.4,2,3,4:10.0,5,6,7:0.6,8:30.0,9' },
    { id: '901', n: 'PIC_901-TESTE_TL20', lat: -13.0, lon: -55.1, ul: '2026-10-09T23:00', d: '0,1:0.4,2,3,4:20.0,5,6,7,8:10.0' },
    { id: '902', n: 'Estacao Norte', lat: null, lon: null, ul: null, d: '' },
  ],
  vinculos: { '001': [0], '002': [0, 1], '033': [1] },
}
const faz = L.prepararFazenda(LINHA)

test('prepararFazenda: abre a chuva diária de cada pluviômetro; dia fora da lista é dia sem leitura', () => {
  assert.equal(faz.hoje, '2026-10-10')
  assert.equal(faz.ultimoDia, 9)
  assert.equal(faz.fim, 9)
  // a ZEUS chega com atraso: os períodos terminam no último dia com leitura, não no fim da janela
  const atrasada = L.prepararFazenda({ ...LINHA, pics: [{ id: 'z', n: 'z', l: 24, d: '0,1:3.0,2,3,4,5,6,7' }] })
  assert.equal(atrasada.fim, 7)
  assert.equal(atrasada.hoje, '2026-10-08')
  assert.deepEqual(L.periodo('7', atrasada), { i0: 1, i1: 7, de: '2026-10-02', ate: '2026-10-08', dias: 7 })
  assert.deepEqual(faz.pics[0].mm, [0, 2.4, 0, 0, 10, 0, 0, 0.6, 30, 0])
  assert.deepEqual(faz.pics[1].mm, [0, 0.4, 0, 0, 20, 0, 0, 0, 10, null])
  assert.deepEqual(faz.pics[2].mm, new Array(10).fill(null))
  // nome curto: sem a fazenda, sem parênteses e sem separadores
  assert.equal(faz.pics[0].nome, 'PIC 900 SEDE')
  assert.equal(faz.pics[2].nome, 'Estacao Norte')
  assert.equal(L.nomeDoPic('PIC 14 (TH11,12,21,22) TESTE', 'TESTE'), 'PIC 14')
  assert.equal(L.nomeDoPic('PIC 04 TESTE', 'TESTE'), 'PIC 04')
  assert.equal(L.nomeDoPic('PIC_45_TH02_TESTE_NORTE', 'TESTE NORTE'), 'PIC 45 TH02')
  assert.equal(L.nomeDoPic('PIC_Teste-TH1/07', 'TESTE'), 'PIC TH1/07')
  assert.equal(L.nomeDoPic('PIC 03_Testé', 'TESTE'), 'PIC 03')
  assert.equal(L.nomeDoPic('TESTE', 'TESTE'), 'TESTE') // não sobra nada: fica o nome como veio
  // dois pluviômetros com o mesmo número: o que está entre parênteses é o que os distingue
  const iguais = L.prepararFazenda({ ...LINHA, pics: [{ id: '1', n: 'PIC 07 (TH05,06) TESTE', d: '' }, { id: '2', n: 'PIC 07 (TH33,23) TESTE', d: '' }, { id: '3', n: 'PIC 09 (TH40) TESTE', d: '' }] })
  assert.deepEqual(iguais.pics.map(p => p.nome), ['PIC 07 (TH05,06)', 'PIC 07 (TH33,23)', 'PIC 09'])
  // texto estragado não derruba a tela
  const ruim = L.prepararFazenda({ ...LINHA, pics: [{ id: 'x', n: 'x', d: 'abc,3:xyz,99:1.0,-1:2.0,x5,4:1.5' }] })
  assert.deepEqual(ruim.pics[0].mm, [null, null, null, null, 1.5, null, null, null, null, null])
  // leituras no dia: a usual do pluviômetro (l), ou a do dia quando vem 'xQ'
  const pesos = L.prepararFazenda({ ...LINHA, pics: [{ id: 'y', n: 'y', l: 24, d: '0,1:2.0x12,2x20' }] })
  assert.deepEqual(pesos.pics[0].mm.slice(0, 4), [0, 2, 0, null])
  assert.deepEqual(pesos.pics[0].n.slice(0, 4), [24, 12, 20, 0])
})

test('paisDoCodigo: subdivisão aponta para o talhão de origem; pivô e código sem número não têm origem', () => {
  assert.deepEqual(L.paisDoCodigo('033A'), ['033'])
  assert.deepEqual(L.paisDoCodigo('068A1'), ['068A', '068'])
  assert.deepEqual(L.paisDoCodigo('019PESQ'), ['019'])
  assert.deepEqual(L.paisDoCodigo('M1A'), ['M1'])
  assert.deepEqual(L.paisDoCodigo('033'), [])
  assert.deepEqual(L.paisDoCodigo('P14'), [])
  assert.deepEqual(L.paisDoCodigo('03PIVO'), [])
})

test('vinculoDoTalhao: vínculo da ZEUS, herança do talhão de origem ou pluviômetro mais próximo', () => {
  assert.deepEqual(L.vinculoDoTalhao('002', null, faz), { tipo: 'zeus', pics: [0, 1] })
  assert.deepEqual(L.vinculoDoTalhao('033A', { lat: -13, lon: -55 }, faz), { tipo: 'pai', pics: [1], pai: '033' })
  // sem vínculo e sem origem: o mais próximo do centro (o 901 fica a ~10,8 km a oeste do 900)
  const perto = L.vinculoDoTalhao('P14', { lat: -13.0, lon: -55.09 }, faz)
  assert.equal(perto.tipo, 'proximo')
  assert.deepEqual(perto.pics, [1])
  assert.equal(perto.km, 1.1)
  // pluviômetro sem coordenada nunca é "o mais próximo"
  const soSemLugar = L.prepararFazenda({ ...LINHA, pics: [LINHA.pics[2]], vinculos: {} })
  assert.deepEqual(L.vinculoDoTalhao('P14', { lat: -13, lon: -55 }, soSemLugar), { tipo: null, pics: [] })
})

test('serieDoTalhao: com mais de um pluviômetro é a média dos que têm leitura no dia (regra da visão da ZEUS)', () => {
  assert.deepEqual(L.serieDoTalhao([0, 1], faz), [0, 1.4, 0, 0, 15, 0, 0, 0.3, 20, 0])
  assert.deepEqual(L.serieDoTalhao([1], faz)[9], null)
  assert.deepEqual(L.serieDoTalhao([], faz), new Array(10).fill(null))
  // pluviômetro com menos leituras no dia pesa menos: (24 × 10 + 8 × 2) ÷ 32 = 8
  const desigual = L.prepararFazenda({ ...LINHA, dias: 1, pics: [{ id: 'a', n: 'a', l: 24, d: '0:10.0' }, { id: 'b', n: 'b', l: 24, d: '0:2.0x8' }] })
  assert.deepEqual(L.serieDoTalhao([0, 1], desigual), [8])
})

test('resumoDaSerie: total, dias com chuva (1 mm ou mais), maior chuva e dias sem chuva', () => {
  const r = L.resumoDaSerie(L.serieDoTalhao([0], faz), 0, 9, faz.ultimoDia)
  assert.equal(r.total, 43)
  assert.equal(r.diasChuva, 3) // 0,6 mm não é dia com chuva
  assert.deepEqual(r.maior, { i: 8, mm: 30 })
  assert.deepEqual(r.ultima, { i: 8, mm: 30 })
  assert.equal(r.diasSem, 1)
  assert.equal(r.semLeitura, 0)
  // período sem chuva: a última chuva é procurada antes dele
  const seco = L.resumoDaSerie(L.serieDoTalhao([0], faz), 5, 7, faz.ultimoDia)
  assert.equal(seco.total, 0.6)
  assert.equal(seco.diasChuva, 0)
  assert.deepEqual(seco.ultima, { i: 4, mm: 10 })
  assert.equal(seco.diasSem, 3)
  // sem nenhuma leitura no período: não é zero, é sem valor
  const mudo = L.resumoDaSerie(L.serieDoTalhao([2], faz), 0, 9, faz.ultimoDia)
  assert.equal(mudo.total, null)
  assert.equal(mudo.semLeitura, 10)
  assert.equal(mudo.diasSem, null)
})

test('periodo: sempre dentro da janela, terminando no último dia com leitura', () => {
  assert.deepEqual(L.periodo('1', faz), { i0: 9, i1: 9, de: '2026-10-10', ate: '2026-10-10', dias: 1 })
  assert.deepEqual(L.periodo('7', faz), { i0: 3, i1: 9, de: '2026-10-04', ate: '2026-10-10', dias: 7 })
  assert.equal(L.periodo('30', faz).i0, 0) // a janela só tem 10 dias
  assert.equal(L.periodo('mes', faz).de, '2026-10-01')
  assert.equal(L.periodo('safra', faz).de, '2026-10-01') // 1º de setembro cai antes da janela
  assert.deepEqual(L.periodo('livre', faz, '2026-10-06', '2026-10-03'), { i0: 2, i1: 5, de: '2026-10-03', ate: '2026-10-06', dias: 4 })
  const longa = L.prepararFazenda({ ...LINHA, inicio: '2025-09-04', dias: 400, pics: [] })
  assert.equal(longa.hoje, '2026-10-08')
  assert.equal(L.periodo('safra', longa).de, '2026-09-01')
  assert.equal(L.periodo('mes', longa).dias, 8)
})

test('classes: a régua sai dos próprios valores, em passos redondos, e 1 mm já é chuva', () => {
  // do menor ao maior valor em seis passos: a diferença entre os talhões aparece
  assert.deepEqual(L.limitesChuva([40.6, 93.7, 74.9, null]), [1, 50, 60, 70, 80, 90, 100])
  assert.deepEqual(L.limitesChuva([8.8, 22.2, 16.4]), [1, 10, 15, 20, 25, 30, 35])
  assert.deepEqual(L.limitesChuva([0, 0.4, 2.6, 3]), [1, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(L.limitesChuva([310, 1480]), [1, 400, 600, 800, 1000, 1200, 1400])
  assert.deepEqual(L.limitesChuva([12, 12]), [1, 13, 14, 15, 16, 17, 18])
  // sem chuva em nenhum talhão: a régua de um dia
  assert.deepEqual(L.limitesChuva([0, 0.2, null]), [1, 5, 10, 20, 30, 50, 75])
  assert.deepEqual(L.LIMITES_DIA, [1, 5, 10, 20, 30, 50, 75])
  const lim = [1, 10, 20, 40, 60, 80, 120]
  assert.equal(L.classeDe(0.9, lim), 0)
  assert.equal(L.classeDe(1, lim), 1)
  assert.equal(L.classeDe(119.9, lim), 6)
  assert.equal(L.classeDe(120, lim), 7)
  assert.equal(L.classeDe(null, lim), -1)
  assert.equal(L.CORES_CHUVA.length, lim.length + 1)
  assert.equal(L.CORES_SECA.length, L.LIMITES_SECA.length + 1)
  assert.deepEqual(L.rotulosClasses(lim), ['< 1', '1 a 10', '10 a 20', '20 a 40', '40 a 60', '60 a 80', '80 a 120', '120 ou mais'])
  assert.deepEqual(L.rotulosClasses(L.LIMITES_SECA, true), ['0 a 2', '3 a 5', '6 a 10', '11 a 15', '16 a 20', '21 a 30', '31 ou mais'])
  assert.equal(L.tintaSobre('#EFEDE6'), '#17251F')
  assert.equal(L.tintaSobre('#12396A'), '#FFFFFF')
})

const QUADRADO = { type: 'Polygon', coordinates: [[[-55.01, -13.01], [-55.0, -13.01], [-55.0, -13.0], [-55.01, -13.0], [-55.01, -13.01]]] }

test('geometria: caixa, centro, caminho e enquadramento', () => {
  assert.deepEqual(L.caixaGeom(QUADRADO), { oeste: -55.01, leste: -55.0, sul: -13.01, norte: -13.0 })
  const c = L.centroGeom(QUADRADO)
  assert.ok(Math.abs(c.lat + 13.005) < 1e-9 && Math.abs(c.lon + 55.005) < 1e-9)
  const multi = { type: 'MultiPolygon', coordinates: [QUADRADO.coordinates, [[[-54.0, -12.0], [-53.999, -12.0], [-53.999, -11.999], [-54.0, -12.0]]]] }
  assert.ok(Math.abs(L.centroGeom(multi).lon + 55.005) < 1e-9) // o centro é o do polígono maior
  const proj = L.projetor(L.caixaGeom(QUADRADO))
  const d = L.caminhoSvg(QUADRADO, proj)
  assert.match(d, /^M-?\d+ -?\d+(L-?\d+ -?\d+){3,4}Z$/)
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
  { codigo: '001', nome: '001', area: 100, centro: { lat: -13, lon: -55 } },
  { codigo: '002', nome: '002', area: 300, centro: { lat: -13, lon: -55.05 } },
  { codigo: '033A', nome: '033A', area: 50, centro: { lat: -13, lon: -55.1 } },
  { codigo: 'P14', nome: 'P14', area: 50, centro: { lat: -13, lon: -55.02 } },
]

test('linhasDosTalhoes e resumoDaFazenda: a média da fazenda pesa pela área e os estimados ficam marcados', () => {
  const per = L.periodo('livre', faz, '2026-10-01', '2026-10-10')
  const linhas = L.linhasDosTalhoes(TALHOES, faz, per)
  assert.deepEqual(linhas.map(l => [l.codigo, l.total, l.estimado, l.vinculo.tipo]), [
    ['001', 43, false, 'zeus'], ['002', 36.7, false, 'zeus'], ['033A', 30.4, true, 'pai'], ['P14', 43, true, 'proximo'],
  ])
  assert.deepEqual(linhas[1].pics, ['PIC 900 SEDE', 'PIC 901 TL20'])
  assert.equal(L.textoDoVinculo(linhas[0].vinculo), '')
  assert.match(L.textoDoVinculo(linhas[2].vinculo), /usa o pluviômetro do talhão 033/)
  assert.match(L.textoDoVinculo(linhas[3].vinculo), /mais próximo \(2,2 km\)/)
  const r = L.resumoDaFazenda(linhas)
  assert.equal(r.media, 38) // (100×43 + 300×36,7 + 50×30,4 + 50×43) ÷ 500
  assert.equal(r.maior.codigo, '001')
  assert.equal(r.menor.codigo, '033A')
  assert.equal(r.estimados, 2)
  assert.equal(r.semChuva, 0)
  assert.equal(r.maisSeco.diasSem, 1)
})

test('picsNoPeriodo: chuva, atraso da leitura e talhões atendidos de cada pluviômetro', () => {
  const per = L.periodo('7', faz)
  const linhas = L.linhasDosTalhoes(TALHOES, faz, per)
  const pics = L.picsNoPeriodo(faz, per, linhas)
  assert.deepEqual(pics.map(p => [p.nome, p.total, p.situacao, p.atrasoH]), [
    ['PIC 900 SEDE', 40.6, 'ok', 0], ['PIC 901 TL20', 30, 'atrasado', 9], ['Estacao Norte', null, 'sem-leitura', null],
  ])
  assert.deepEqual(pics[0].talhoes, ['001', '002'])
  assert.deepEqual(pics[0].estimados, ['P14'])
  assert.deepEqual(pics[1].estimados, ['033A'])
  assert.equal(pics[1].semLeitura, 1)
})

test('ordenar: por coluna, com os talhões sem valor no fim', () => {
  const per = L.periodo('7', faz)
  const linhas = L.linhasDosTalhoes(TALHOES.concat([{ codigo: '010', nome: '010', area: 10, centro: null }]), L.prepararFazenda({ ...LINHA, pics: LINHA.pics.slice(0, 2).map(p => ({ ...p, lat: null, lon: null })) }), per)
  assert.deepEqual(L.ordenar(linhas, 'total', true).map(l => l.codigo), ['001', '002', '033A', '010', 'P14'])
  assert.deepEqual(L.ordenar(linhas, 'codigo', false).map(l => l.codigo), ['001', '002', '010', '033A', 'P14'])
})

test('unidadeDaFazenda: casa a fazenda do COA WEB com a unidade, sem acento nem prefixo', () => {
  assert.equal(L.unidadeDaFazenda('Fazenda Três Flechas', ['GLOBO', 'TRES FLECHAS']), 'TRES FLECHAS')
  assert.equal(L.unidadeDaFazenda('Fazenda Inexistente', ['GLOBO']), null)
})
