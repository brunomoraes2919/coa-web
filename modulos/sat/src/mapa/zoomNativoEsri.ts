/**
 * Zoom nativo das camadas da Esri conforme o LUGAR.
 *
 * A imagem de satélite (World_Imagery) não tem a mesma resolução no mundo
 * todo: em cidade chega ao zoom 19, em fazenda no interior do MT para no 17.
 * Acima do que existe, o servidor não dá erro — devolve HTTP 200 com a
 * figura "Map data not yet available", e o Leaflet a mostra como se fosse o
 * mapa. Um `maxNativeZoom` fixo não resolve: baixo demais estraga a cidade,
 * alto demais apaga a fazenda.
 *
 * O próprio serviço responde até onde há imagem: o recurso `tilemap` diz, por
 * tile, se existe dado naquele nível (`data: [1]`) ou não (`[0]`). Aqui ele é
 * consultado para o CENTRO do mapa a cada movimento, e o `maxNativeZoom` da
 * camada passa a ser o maior nível com imagem — acima dele o Leaflet amplia
 * o último tile bom em vez de pedir o carimbo. Mesmo critério do esri-leaflet
 * (centro da tela), sem trazer a biblioteca.
 */
import L from 'leaflet'

export const SERVICO_IMAGEM_ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'

/** URL do MapServer quando o tile é do World_Imagery; `null` para os demais
 *  (topográfico tem 19 no mundo todo, Canvas para no 16 — limite fixo). */
export function servicoComZoomVariavel(url: string): string | null {
  return url.startsWith(`${SERVICO_IMAGEM_ESRI}/tile/`) ? SERVICO_IMAGEM_ESRI : null
}

/** Tile XYZ (Web Mercator) que contém o ponto no nível `z`. */
export function tileDoPonto(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n)
  return { x: Math.min(Math.max(x, 0), n - 1), y: Math.min(Math.max(y, 0), n - 1) }
}

export type ConsultaTilemap = (servico: string, z: number, y: number, x: number) => Promise<boolean>

/** `true` quando o serviço tem dado naquele tile. Falha de rede = "não sei",
 *  tratada como disponível para não rebaixar a camada à toa. */
export const consultarTilemap: ConsultaTilemap = async (servico, z, y, x) => {
  try {
    const r = await fetch(`${servico}/tilemap/${z}/${y}/${x}/1/1`)
    if (!r.ok) return true
    const corpo = (await r.json()) as { data?: number[] }
    return corpo.data?.[0] !== 0
  } catch {
    return true
  }
}

/**
 * Maior nível entre `minimo` e `maximo` com imagem no ponto. Desce do topo e
 * para no primeiro que existe — em cidade é uma consulta só. `cache` evita
 * repetir a mesma pergunta ao arrastar o mapa pela mesma região.
 */
export async function nivelNativoNoPonto(
  servico: string,
  lat: number,
  lng: number,
  maximo: number,
  minimo: number,
  consultar: ConsultaTilemap = consultarTilemap,
  cache: Map<string, boolean> = new Map(),
): Promise<number> {
  for (let z = maximo; z > minimo; z--) {
    const { x, y } = tileDoPonto(lat, lng, z)
    const chave = `${z}/${y}/${x}`
    let tem = cache.get(chave)
    if (tem === undefined) {
      tem = await consultar(servico, z, y, x)
      cache.set(chave, tem)
    }
    if (tem) return z
  }
  return minimo
}

/**
 * Troca o `maxNativeZoom` de uma camada. `redraw()` não serve: ele muda o
 * nível dos tiles mas não recalcula a faixa de tiles válida do nível novo —
 * ao voltar de 17 para 19 (fazenda → cidade) todo tile do 19 era descartado
 * como "fora do mundo" e o fundo sumia. O `viewreset` da própria camada refaz
 * nível, faixa e tiles, como numa troca de zoom.
 */
export function trocarMaxNativeZoom(mapa: L.Map, camada: L.TileLayer, novo: number | undefined): void {
  camada.options.maxNativeZoom = novo
  if (!mapa.hasLayer(camada)) return
  camada.getEvents?.().viewreset?.call(camada, { type: 'viewreset', target: mapa } as L.LeafletEvent)
}

/**
 * Liga o ajuste a uma camada já no mapa. `servico` é a URL do MapServer (sem
 * `/tile/...`). Abaixo de `minimo` nada é consultado — todo serviço da Esri
 * tem imagem até lá. Devolve a função que desliga.
 */
export function acompanharZoomNativoEsri(
  mapa: L.Map,
  camada: L.TileLayer,
  servico: string,
  { maximo = 19, minimo = 13 }: { maximo?: number; minimo?: number } = {},
): () => void {
  const cache = new Map<string, boolean>()
  let rodada = 0

  async function ajustar() {
    const zoom = mapa.getZoom()
    const atual = camada.options.maxNativeZoom
    if (zoom <= minimo) return
    const minha = ++rodada
    const { lat, lng } = mapa.getCenter()
    const nivel = await nivelNativoNoPonto(servico, lat, lng, Math.min(maximo, Math.ceil(zoom)), minimo, consultarTilemap, cache)
    // Só vale a resposta mais recente; e só abaixa se o zoom pedido passa do que existe.
    if (minha !== rodada) return
    const novo = nivel >= Math.min(maximo, Math.ceil(zoom)) ? undefined : nivel
    if (novo === atual) return
    trocarMaxNativeZoom(mapa, camada, novo)
  }

  const aoMover = () => void ajustar()
  mapa.on('moveend', aoMover)
  void ajustar()
  return () => {
    rodada++
    mapa.off('moveend', aoMover)
  }
}
