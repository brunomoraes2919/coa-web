/**
 * A ionosfera como camada em GRADE: a imagem da Trimble é o tile (0, 0, 0) do Web Mercator,
 * então o tile (z, x, y) é um pedaço dela, ampliado. Funciona em qualquer zoom — esticar a
 * imagem inteira criaria um elemento de 256·2^z pixels.
 */
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { carregarIonosfera, type CamadaTrimble } from './imagemIonosfera'

/** O TEC vem opaco; a cintilação já sai recolorida com a transparência dela. */
const OPACIDADE_TEC = 0.55
/** Atenuada (de perto): metade da opacidade, para o satélite e o contorno da fazenda aparecerem por baixo/por cima. */
const FATOR_ATENUADA = 0.5

/** Recorte da imagem-fonte (256 px, o mundo) que cobre o tile (z, x, y). */
export function retanguloDaFonte(z: number, x: number, y: number): { sx: number; sy: number; lado: number } {
  const lado = 256 / 2 ** z
  return { sx: x * lado, sy: y * lado, lado }
}

/** Tiles vivos da grade: o mapa interno `_tiles` do Leaflet (chave → elemento e coordenadas). */
type TilesVivos = Record<string, { el: HTMLElement; coords: L.Coords }>

class GradeIonosfera extends L.GridLayer {
  fonte: HTMLCanvasElement | null = null

  /** Limpa o tile e, havendo imagem, desenha nele o recorte que cobre `coords`. */
  private pintar(tile: HTMLCanvasElement, coords: L.Coords): void {
    const ctx = tile.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, tile.width, tile.height)
    if (!this.fonte) return
    const { sx, sy, lado } = retanguloDaFonte(coords.z, coords.x, coords.y)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.fonte, sx, sy, lado, lado, 0, 0, tile.width, tile.height)
  }

  createTile(coords: L.Coords): HTMLElement {
    const tile = document.createElement('canvas')
    const tamanho = this.getTileSize()
    tile.width = tamanho.x
    tile.height = tamanho.y
    this.pintar(tile, coords)
    return tile
  }

  trocarFonte(fonte: HTMLCanvasElement | null): void {
    this.fonte = fonte
    // Repinta os tiles que já estão na tela (`_tiles` é o mapa interno do Leaflet): redesenhar a
    // grade inteira piscaria a cada passo do play.
    const tiles = (this as unknown as { _tiles?: TilesVivos })._tiles ?? {}
    for (const { el, coords } of Object.values(tiles)) {
      if (el instanceof HTMLCanvasElement) this.pintar(el, coords)
    }
  }
}

interface Props {
  camada: CamadaTrimble
  instante: number
  /** Mais transparente (opacidade × 0,5): de perto a mancha em força total esconde o fundo. */
  atenuada?: boolean
  aoCarregar: () => void
  aoFalhar: () => void
}

export default function CamadaIonosfera({ camada, instante, atenuada = false, aoCarregar, aoFalhar }: Props) {
  const mapa = useMap()
  const grade = useRef<GradeIonosfera | null>(null)
  const avisos = useRef({ aoCarregar, aoFalhar })
  const camadaMostrada = useRef<CamadaTrimble | null>(null)

  useEffect(() => {
    avisos.current = { aoCarregar, aoFalhar }
  })

  useEffect(() => {
    // zIndex 2: acima do fundo (1) e abaixo dos nomes do satélite (3).
    const g = new GradeIonosfera({ noWrap: true, zIndex: 2, updateWhenZooming: false })
    mapa.addLayer(g)
    grade.current = g
    return () => {
      mapa.removeLayer(g)
      grade.current = null
    }
  }, [mapa])

  // Atenuar ou não só mexe na opacidade: a imagem fica e nada é pedido de novo.
  useEffect(() => {
    grade.current?.setOpacity((camada === 'tec' ? OPACIDADE_TEC : 1) * (atenuada ? FATOR_ATENUADA : 1))
  }, [camada, atenuada])

  useEffect(() => {
    let vivo = true
    const g = grade.current
    // Trocou de camada: some a imagem da outra na hora (o novo passo pode demorar).
    if (g && camadaMostrada.current !== camada) g.trocarFonte(null)
    camadaMostrada.current = camada
    carregarIonosfera(camada, instante).then(
      (fonte) => {
        if (!vivo) return
        grade.current?.trocarFonte(fonte)
        avisos.current.aoCarregar()
      },
      () => {
        if (!vivo) return
        // Sem imagem do passo: nada na tela, para não parecer que a anterior é a deste horário.
        grade.current?.trocarFonte(null)
        avisos.current.aoFalhar()
      },
    )
    return () => {
      vivo = false
    }
  }, [camada, instante])

  return null
}
