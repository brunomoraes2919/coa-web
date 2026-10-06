// Testes da lógica do módulo Previsão do Tempo (previsao/logica.js).
// Rodar na raiz do repositório: node --test modulos/previsao/testes/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../previsao/logica.js')

const perto = (obtido, esperado, folga = 0.01) =>
  assert.ok(Math.abs(obtido - esperado) <= folga, `${obtido} deveria ser ~${esperado}`)

const TELA = { largura: 1000, altura: 600 }
const quadrado = (oeste, sul, leste, norte) => ({
  type: 'Polygon',
  coordinates: [[[oeste, norte], [leste, norte], [leste, sul], [oeste, sul], [oeste, norte]]],
})

test('paraTela: o centro da vista cai no meio da tela', () => {
  const p = L.paraTela({ lat: -13.5, lon: -56 }, { lat: -13.5, lon: -56, zoom: 8 }, TELA)
  perto(p.x, 500)
  perto(p.y, 300)
})

test('paraTela: um grau de longitude vale 256·2^zoom/360 pixels para a direita', () => {
  const p = L.paraTela({ lat: -13.5, lon: -55 }, { lat: -13.5, lon: -56, zoom: 8 }, TELA)
  perto(p.x, 500 + (256 * 2 ** 8) / 360)
  perto(p.y, 300)
})

test('paraTela: ponto ao norte do centro fica acima dele na tela', () => {
  const p = L.paraTela({ lat: -13, lon: -56 }, { lat: -13.5, lon: -56, zoom: 8 }, TELA)
  assert.ok(p.y < 300)
  // Mercator: meio grau de latitude perto de 13°S ≈ 93,6 px no zoom 8
  perto(p.y, 300 - 93.6, 0.5)
})

test('caixaDasGeometrias: envolve polígonos e multipolígonos', () => {
  const multi = { type: 'MultiPolygon', coordinates: [quadrado(-56.2, -13.7, -56.1, -13.6).coordinates, quadrado(-55.9, -13.2, -55.8, -13.1).coordinates] }
  assert.deepEqual(L.caixaDasGeometrias([quadrado(-56, -13.5, -55.95, -13.4), multi]), {
    oeste: -56.2, leste: -55.8, sul: -13.7, norte: -13.1,
  })
})

test('caixaDasGeometrias: sem vértice válido devolve null', () => {
  assert.equal(L.caixaDasGeometrias([]), null)
  assert.equal(L.caixaDasGeometrias([{ type: 'Polygon', coordinates: [[['x', null]]] }, null]), null)
})

test('vistaQueCabe: escolhe o maior zoom em que a caixa cabe com a margem', () => {
  // 0,2° de largura: 291 px no zoom 11 (cabe em 1000 − 2·60), 582 px no zoom 12 (acima do limite do Windy)
  const v = L.vistaQueCabe({ oeste: -56.1, leste: -55.9, sul: -13.6, norte: -13.4 }, TELA)
  assert.equal(v.zoom, 11)
  perto(v.lon, -56, 1e-6)
  perto(v.lat, -13.5, 0.001)
})

test('vistaQueCabe: caixa grande desce o zoom até caber na altura', () => {
  // 4° de latitude ≈ 749 px no zoom 8 (não cabe em 600 − 2·60) e ≈ 374 px no zoom 7
  const v = L.vistaQueCabe({ oeste: -57, leste: -55, sul: -15.5, norte: -11.5 }, TELA)
  assert.equal(v.zoom, 7)
})

test('vistaQueCabe: nunca sai dos zooms que o widget do Windy aceita (3 a 11)', () => {
  assert.equal(L.vistaQueCabe({ oeste: -56.001, leste: -56, sul: -13.501, norte: -13.5 }, TELA).zoom, 11)
  assert.equal(L.vistaQueCabe({ oeste: -170, leste: 170, sul: -80, norte: 80 }, TELA).zoom, 3)
})

test('urlWindy: monta o endereço do widget com camada, modelo e o aviso de posição ligado', () => {
  const u = new URL(L.urlWindy({ lat: -13.51234567, lon: -56.0, zoom: 9, camada: 'rainAccu', modelo: 'gfs' }))
  assert.equal(u.origin + u.pathname, 'https://embed.windy.com/embed2.html')
  const q = u.searchParams
  assert.equal(q.get('lat'), '-13.5123')
  assert.equal(q.get('lon'), '-56')
  assert.equal(q.get('zoom'), '9')
  assert.equal(q.get('overlay'), 'rainAccu')
  assert.equal(q.get('product'), 'gfs')
  assert.equal(q.get('embedMake'), 'true')
  assert.equal(q.get('metricWind'), 'km/h')
  assert.equal(q.get('metricTemp'), '°C')
  assert.equal(q.get('metricRain'), 'mm')
  // tabela de previsão e marcador começam fechados: quem abre é o botão "Previsão do ponto"
  assert.equal(q.get('detail'), '')
  assert.equal(q.get('marker'), '')
})

test('lerPosicaoWindy: aceita o aviso de posição do widget', () => {
  const dado = { type: 'updateValues', payload: { coordinates: { lat: -13.5, lon: -56 }, zoom: 8, overlay: 'rain', product: 'ecmwf', level: 'surface' } }
  assert.deepEqual(L.lerPosicaoWindy(dado), { lat: -13.5, lon: -56, zoom: 8, camada: 'rain', modelo: 'ecmwf' })
})

test('lerPosicaoWindy: recusa o que não for um aviso de posição inteiro', () => {
  assert.equal(L.lerPosicaoWindy(null), null)
  assert.equal(L.lerPosicaoWindy('updateValues'), null)
  assert.equal(L.lerPosicaoWindy({ type: 'updateDetail', payload: { showDetail: true } }), null)
  assert.equal(L.lerPosicaoWindy({ type: 'updateValues', payload: { coordinates: { lat: 'x', lon: -56 }, zoom: 8 } }), null)
  assert.equal(L.lerPosicaoWindy({ type: 'updateValues', payload: { coordinates: { lat: -13, lon: -56 }, zoom: NaN } }), null)
  assert.equal(L.lerPosicaoWindy({ type: 'updateValues', payload: { coordinates: { lat: -95, lon: -56 }, zoom: 8 } }), null)
})

test('caminhoSvg: desenha o polígono em pixels da tela e fecha o anel', () => {
  // 256·2^8/360 = 182,04 px por grau de longitude
  const d = L.caminhoSvg(quadrado(-56.5, -14, -55.5, -13), { lat: -13.5, lon: -56, zoom: 8 }, TELA)
  const m = d.match(/^M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)Z$/)
  assert.ok(m, `caminho inesperado: ${d}`)
  perto(+m[1], 500 - 91.02, 0.06)
  perto(+m[3], 500 + 91.02, 0.06)
  assert.ok(+m[2] < 300 && +m[6] > 300)
})

test('caminhoSvg: multipolígono vira um subcaminho por anel', () => {
  const multi = { type: 'MultiPolygon', coordinates: [quadrado(-56.5, -14, -56.2, -13.7).coordinates, quadrado(-55.8, -13.3, -55.5, -13).coordinates] }
  const d = L.caminhoSvg(multi, { lat: -13.5, lon: -56, zoom: 8 }, TELA)
  assert.equal((d.match(/M/g) || []).length, 2)
  assert.equal((d.match(/Z/g) || []).length, 2)
})

test('caminhoSvg: vértices a menos de meio pixel do anterior são pulados', () => {
  const anel = [[-56.5, -13], [-56.49999, -13], [-55.5, -13], [-55.5, -14], [-55.50001, -14.00001], [-56.5, -14], [-56.5, -13]]
  const d = L.caminhoSvg({ type: 'Polygon', coordinates: [anel] }, { lat: -13.5, lon: -56, zoom: 8 }, TELA)
  assert.equal((d.match(/L/g) || []).length, 3)
})

test('caminhoSvg: anel que some na escala (menos de 3 pontos distintos) não é desenhado', () => {
  const d = L.caminhoSvg(quadrado(-56.00001, -13.50001, -56, -13.5), { lat: -13.5, lon: -56, zoom: 5 }, TELA)
  assert.equal(d, '')
})

test('caminhoSvg: geometria inválida devolve caminho vazio', () => {
  assert.equal(L.caminhoSvg(null, { lat: 0, lon: 0, zoom: 5 }, TELA), '')
  assert.equal(L.caminhoSvg({ type: 'Point', coordinates: [-56, -13] }, { lat: 0, lon: 0, zoom: 5 }, TELA), '')
})

test('limitesPorFazenda: agrupa os talhões e calcula a caixa de cada fazenda', () => {
  const por = L.limitesPorFazenda([
    { fazenda_id: 'a', geom: quadrado(-56.2, -13.6, -56.1, -13.5) },
    { fazenda_id: 'a', geom: quadrado(-56.1, -13.5, -56, -13.4) },
    { fazenda_id: 'b', geom: quadrado(-54, -12, -53.9, -11.9) },
    { fazenda_id: 'c', geom: null },
  ])
  assert.deepEqual(Object.keys(por).sort(), ['a', 'b'])
  assert.equal(por.a.geometrias.length, 2)
  assert.deepEqual(por.a.caixa, { oeste: -56.2, leste: -56, sul: -13.6, norte: -13.4 })
})

test('juntarCaixas: envolve todas as caixas e ignora as vazias', () => {
  assert.deepEqual(
    L.juntarCaixas([{ oeste: -56.2, leste: -56, sul: -13.6, norte: -13.4 }, null, { oeste: -54, leste: -53.9, sul: -12, norte: -11.9 }]),
    { oeste: -56.2, leste: -53.9, sul: -13.6, norte: -11.9 },
  )
  assert.equal(L.juntarCaixas([null]), null)
})
