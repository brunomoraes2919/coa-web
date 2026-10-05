import L from 'leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nivelNativoNoPonto, servicoComZoomVariavel, tileDoPonto, trocarMaxNativeZoom } from './zoomNativoEsri'

const FAZENDA = { lat: -12.26, lng: -50.31 }

describe('tileDoPonto', () => {
  it('converte o ponto no tile do esquema XYZ (Web Mercator)', () => {
    // Valores calculados à parte pela fórmula padrão do esquema de tiles (ponto fictício, não é fazenda de verdade).
    expect(tileDoPonto(FAZENDA.lat, FAZENDA.lng, 17)).toEqual({ x: 47218, y: 70034 })
    expect(tileDoPonto(FAZENDA.lat, FAZENDA.lng, 19)).toEqual({ x: 188874, y: 280136 })
  })
})

describe('servicoComZoomVariavel', () => {
  it('só a imagem de satélite tem o nível variando por lugar', () => {
    const base = 'https://server.arcgisonline.com/ArcGIS/rest/services'
    expect(servicoComZoomVariavel(`${base}/World_Imagery/MapServer/tile/{z}/{y}/{x}`)).toBe(`${base}/World_Imagery/MapServer`)
    expect(servicoComZoomVariavel(`${base}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`)).toBeNull()
    expect(servicoComZoomVariavel(`${base}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`)).toBeNull()
    expect(servicoComZoomVariavel('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg')).toBeNull()
  })
})

describe('nivelNativoNoPonto', () => {
  it('fazenda com imagem só até o 17: desce 19 → 18 → 17', async () => {
    const consultar = vi.fn(async (_s: string, z: number) => z <= 17)
    const nivel = await nivelNativoNoPonto('svc', FAZENDA.lat, FAZENDA.lng, 19, 13, consultar)
    expect(nivel).toBe(17)
    expect(consultar.mock.calls.map((c) => c[1])).toEqual([19, 18, 17])
  })

  it('cidade com imagem no 19: uma consulta só', async () => {
    const consultar = vi.fn(async () => true)
    expect(await nivelNativoNoPonto('svc', -15.6, -56.1, 19, 13, consultar)).toBe(19)
    expect(consultar).toHaveBeenCalledTimes(1)
  })

  it('cache: a mesma região não é perguntada de novo', async () => {
    const consultar = vi.fn(async (_s: string, z: number) => z <= 17)
    const cache = new Map<string, boolean>()
    await nivelNativoNoPonto('svc', FAZENDA.lat, FAZENDA.lng, 19, 13, consultar, cache)
    await nivelNativoNoPonto('svc', FAZENDA.lat, FAZENDA.lng, 19, 13, consultar, cache)
    expect(consultar).toHaveBeenCalledTimes(3)
  })

  it('nada disponível acima do mínimo: fica no mínimo', async () => {
    const consultar = vi.fn(async () => false)
    expect(await nivelNativoNoPonto('svc', FAZENDA.lat, FAZENDA.lng, 19, 13, consultar)).toBe(13)
  })
})

describe('trocarMaxNativeZoom', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Níveis dos tiles que a camada tem agora. */
  const niveis = (camada: L.TileLayer) =>
    [...new Set(Object.values((camada as unknown as { _tiles: Record<string, { coords: L.Coords }> })._tiles).map((t) => t.coords.z))]

  function montar() {
    const div = document.createElement('div')
    document.body.appendChild(div)
    // jsdom não mede elemento: sem tamanho o Leaflet não pede tile nenhum.
    vi.spyOn(L.Map.prototype, 'getSize').mockReturnValue(L.point(512, 512))
    const mapa = L.map(div, { zoomAnimation: false, fadeAnimation: false }).setView([FAZENDA.lat, FAZENDA.lng], 19)
    const camada = L.tileLayer('https://exemplo/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 17 }).addTo(mapa)
    return { mapa, camada }
  }

  it('volta ao 19 com tiles do 19 (o redraw() deixava a camada vazia)', () => {
    const { mapa, camada } = montar()
    expect(niveis(camada)).toEqual([17])
    trocarMaxNativeZoom(mapa, camada, undefined)
    expect(niveis(camada)).toEqual([19])
    mapa.remove()
  })

  it('desce ao 17 com tiles do 17', () => {
    const { mapa, camada } = montar()
    trocarMaxNativeZoom(mapa, camada, undefined)
    trocarMaxNativeZoom(mapa, camada, 17)
    expect(niveis(camada)).toEqual([17])
    mapa.remove()
  })
})
