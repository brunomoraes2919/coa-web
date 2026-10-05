import L from 'leaflet'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { carregarIonosfera } from './imagemIonosfera'
import CamadaIonosfera, { retanguloDaFonte } from './CamadaIonosfera'

const { mapaFalso } = vi.hoisted(() => ({ mapaFalso: { addLayer: vi.fn(), removeLayer: vi.fn() } }))

vi.mock('react-leaflet', () => ({ useMap: () => mapaFalso }))
vi.mock('./imagemIonosfera', () => ({ carregarIonosfera: vi.fn() }))

const carregar = vi.mocked(carregarIonosfera)
const T = Date.UTC(2026, 8, 24, 21, 30)

/** Promessa que o teste resolve ou rejeita quando quiser. */
function pendente() {
  let resolver!: (canvas: HTMLCanvasElement) => void
  let rejeitar!: (erro: Error) => void
  const promessa = new Promise<HTMLCanvasElement>((res, rej) => {
    resolver = res
    rejeitar = rej
  })
  return { promessa, resolver, rejeitar }
}

/** A grade que a camada entregou ao mapa. */
type Grade = L.GridLayer & {
  options: L.GridLayerOptions
  fonte: HTMLCanvasElement | null
  createTile(coords: L.Coords): HTMLCanvasElement
  trocarFonte(fonte: HTMLCanvasElement | null): void
}
const gradeDoMapa = () => mapaFalso.addLayer.mock.calls[0][0] as Grade

/** Como o Leaflet guarda os tiles vivos de uma grade (mapa interno `_tiles`). */
type TilesVivos = Record<string, { el: HTMLElement; coords: L.Coords }>
const semearTiles = (grade: Grade, tiles: TilesVivos) => {
  ;(grade as unknown as { _tiles?: TilesVivos })._tiles = tiles
}

function ctxFalso() {
  return { clearRect: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false }
}

/** Um tile já na tela: canvas 256×256 de verdade, com o contexto 2D trocado por um falso. */
function tileFalso(x: number, y: number, z: number) {
  const el = document.createElement('canvas')
  el.width = 256
  el.height = 256
  const ctx = ctxFalso()
  el.getContext = vi.fn(() => ctx) as never
  return { el, ctx, entrada: { el, coords: { x, y, z } as L.Coords } }
}

interface Props {
  camada: 'sci' | 'tec'
  instante: number
  atenuada?: boolean
  aoCarregar: () => void
  aoFalhar: () => void
}
const props = (): Props => ({ camada: 'sci', instante: T, aoCarregar: vi.fn(), aoFalhar: vi.fn() })

let container: HTMLDivElement
let root: Root | null

async function montar(p: Props) {
  await act(async () => root!.render(<CamadaIonosfera {...p} />))
}

async function desmontar() {
  await act(async () => root!.unmount())
  root = null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mapaFalso.addLayer.mockReset()
  mapaFalso.removeLayer.mockReset()
  carregar.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('retanguloDaFonte', () => {
  it('o tile (z, x, y) é um pedaço da imagem de 256 px do mundo', () => {
    expect(retanguloDaFonte(0, 0, 0)).toEqual({ sx: 0, sy: 0, lado: 256 })
    expect(retanguloDaFonte(1, 1, 0)).toEqual({ sx: 128, sy: 0, lado: 128 })
    expect(retanguloDaFonte(3, 5, 2)).toEqual({ sx: 160, sy: 64, lado: 32 })
  })
})

describe('CamadaIonosfera', () => {
  it('entra no mapa como uma grade ao montar e sai a mesma ao desmontar', async () => {
    carregar.mockReturnValue(pendente().promessa)
    await montar(props())
    expect(mapaFalso.addLayer).toHaveBeenCalledTimes(1)
    const grade = gradeDoMapa()
    expect(grade).toBeInstanceOf(L.GridLayer)
    expect(mapaFalso.removeLayer).not.toHaveBeenCalled()

    await desmontar()
    expect(mapaFalso.removeLayer).toHaveBeenCalledTimes(1)
    expect(mapaFalso.removeLayer).toHaveBeenCalledWith(grade)
  })

  it('pede a imagem da camada e do passo', async () => {
    carregar.mockReturnValue(pendente().promessa)
    await montar({ ...props(), camada: 'tec' })
    expect(carregar).toHaveBeenCalledWith('tec', T)
  })

  it('imagem carregada: avisa aoCarregar, e cada tile é o recorte dela', async () => {
    const imagem = pendente()
    carregar.mockReturnValue(imagem.promessa)
    const p = props()
    await montar(p)
    expect(p.aoCarregar).not.toHaveBeenCalled()

    const fonte = document.createElement('canvas')
    await act(async () => {
      imagem.resolver(fonte)
    })
    expect(p.aoCarregar).toHaveBeenCalledTimes(1)
    expect(p.aoFalhar).not.toHaveBeenCalled()

    const grade = gradeDoMapa()
    expect(grade.fonte).toBe(fonte)
    const ctx = ctxFalso()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
    const tile = grade.createTile({ x: 5, y: 2, z: 3 } as L.Coords)
    expect(tile).toBeInstanceOf(HTMLCanvasElement)
    expect(tile.width).toBe(256)
    expect(tile.height).toBe(256)
    expect(ctx.imageSmoothingEnabled).toBe(true)
    expect(ctx.drawImage).toHaveBeenCalledWith(fonte, 160, 64, 32, 32, 0, 0, 256, 256)
  })

  it('imagem que falha: avisa aoFalhar, e a grade fica vazia', async () => {
    const imagem = pendente()
    carregar.mockReturnValue(imagem.promessa)
    const p = props()
    await montar(p)

    await act(async () => {
      imagem.rejeitar(new Error('406'))
    })
    expect(p.aoFalhar).toHaveBeenCalledTimes(1)
    expect(p.aoCarregar).not.toHaveBeenCalled()

    const grade = gradeDoMapa()
    expect(grade.fonte).toBeNull()
    const ctx = ctxFalso()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
    grade.createTile({ x: 0, y: 0, z: 0 } as L.Coords)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('se o instante muda antes de a primeira imagem chegar, o resultado atrasado dela é ignorado', async () => {
    const primeira = pendente()
    const segunda = pendente()
    carregar.mockReturnValueOnce(primeira.promessa).mockReturnValueOnce(segunda.promessa)
    const p = props()
    await montar(p)
    await montar({ ...p, instante: T + 600_000 })
    expect(carregar).toHaveBeenCalledTimes(2)

    await act(async () => {
      primeira.resolver(document.createElement('canvas'))
    })
    expect(p.aoCarregar).not.toHaveBeenCalled()
    expect(p.aoFalhar).not.toHaveBeenCalled()
    expect(gradeDoMapa().fonte).toBeNull()

    const fonteDaSegunda = document.createElement('canvas')
    await act(async () => {
      segunda.resolver(fonteDaSegunda)
    })
    expect(p.aoCarregar).toHaveBeenCalledTimes(1)
    expect(gradeDoMapa().fonte).toBe(fonteDaSegunda)
  })

  it('a falha atrasada de um passo antigo também é ignorada', async () => {
    const primeira = pendente()
    carregar.mockReturnValueOnce(primeira.promessa).mockReturnValueOnce(pendente().promessa)
    const p = props()
    await montar(p)
    await montar({ ...p, instante: T + 600_000 })

    await act(async () => {
      primeira.rejeitar(new Error('406'))
    })
    expect(p.aoFalhar).not.toHaveBeenCalled()
  })

  it('desmontada antes de a imagem chegar, não avisa ninguém', async () => {
    const imagem = pendente()
    carregar.mockReturnValue(imagem.promessa)
    const p = props()
    await montar(p)
    await desmontar()

    await act(async () => {
      imagem.resolver(document.createElement('canvas'))
    })
    expect(p.aoCarregar).not.toHaveBeenCalled()
    expect(p.aoFalhar).not.toHaveBeenCalled()
  })

  it('trocar de camada esvazia a grade na hora e põe a opacidade da camada nova', async () => {
    const fonte = document.createElement('canvas')
    carregar.mockReturnValueOnce(Promise.resolve(fonte)).mockReturnValueOnce(pendente().promessa)
    const p = props()
    await montar(p)
    const grade = gradeDoMapa()
    expect(grade.fonte).toBe(fonte)
    expect(grade.options.opacity).toBe(1)

    await montar({ ...p, camada: 'tec' })
    expect(grade.fonte).toBeNull()
    expect(grade.options.opacity).toBe(0.55)
  })

  it.each([
    ['sci', false, 1],
    ['sci', true, 0.5],
    ['tec', false, 0.55],
    ['tec', true, 0.275],
  ] as const)('opacidade da camada %s com atenuada=%s: %s', async (camada, atenuada, esperada) => {
    carregar.mockReturnValue(pendente().promessa)
    await montar({ ...props(), camada, atenuada })
    expect(gradeDoMapa().options.opacity).toBe(esperada)
  })

  it('atenuada omitida vale como não atenuada', async () => {
    carregar.mockReturnValue(pendente().promessa)
    await montar(props())
    expect(gradeDoMapa().options.opacity).toBe(1)
  })

  it('atenuar e desatenuar com a camada montada só muda a opacidade: a imagem fica e nada é pedido de novo', async () => {
    const fonte = document.createElement('canvas')
    carregar.mockReturnValue(Promise.resolve(fonte))
    const p = props()
    await montar(p)
    const grade = gradeDoMapa()
    expect(grade.options.opacity).toBe(1)
    expect(carregar).toHaveBeenCalledTimes(1)

    await montar({ ...p, atenuada: true })
    expect(grade.options.opacity).toBe(0.5)
    expect(grade.fonte).toBe(fonte)
    expect(carregar).toHaveBeenCalledTimes(1)

    await montar({ ...p, atenuada: false })
    expect(grade.options.opacity).toBe(1)
    expect(carregar).toHaveBeenCalledTimes(1)
  })

  it('trocar de camada atenuada mantém a atenuação (TEC atenuada = 0,275)', async () => {
    carregar.mockReturnValue(pendente().promessa)
    const p = { ...props(), atenuada: true }
    await montar(p)
    expect(gradeDoMapa().options.opacity).toBe(0.5)
    await montar({ ...p, camada: 'tec' })
    expect(gradeDoMapa().options.opacity).toBe(0.275)
  })

  it('só o passo muda (mesma camada): a imagem anterior fica até a nova chegar', async () => {
    const fonte = document.createElement('canvas')
    carregar.mockReturnValueOnce(Promise.resolve(fonte)).mockReturnValueOnce(pendente().promessa)
    const p = props()
    await montar(p)
    const grade = gradeDoMapa()

    await montar({ ...p, instante: T + 600_000 })
    expect(grade.fonte).toBe(fonte)
  })

  it('imagem nova pinta os tiles que já estão na tela, no lugar: limpa e desenha o recorte de CADA um, sem redesenhar a grade', async () => {
    const imagem = pendente()
    carregar.mockReturnValue(imagem.promessa)
    await montar(props())
    const grade = gradeDoMapa()
    const redraw = vi.spyOn(grade, 'redraw')
    const a = tileFalso(1, 0, 1)
    const b = tileFalso(5, 2, 3)
    semearTiles(grade, { '1:0:1': a.entrada, '5:2:3': b.entrada })

    const fonte = document.createElement('canvas')
    await act(async () => {
      imagem.resolver(fonte)
    })

    expect(a.ctx.clearRect).toHaveBeenCalledWith(0, 0, 256, 256)
    expect(a.ctx.drawImage).toHaveBeenCalledWith(fonte, 128, 0, 128, 128, 0, 0, 256, 256)
    expect(b.ctx.clearRect).toHaveBeenCalledWith(0, 0, 256, 256)
    expect(b.ctx.drawImage).toHaveBeenCalledWith(fonte, 160, 64, 32, 32, 0, 0, 256, 256)
    expect(a.ctx.clearRect.mock.invocationCallOrder[0]).toBeLessThan(a.ctx.drawImage.mock.invocationCallOrder[0])
    expect(b.ctx.clearRect.mock.invocationCallOrder[0]).toBeLessThan(b.ctx.drawImage.mock.invocationCallOrder[0])
    expect(redraw).not.toHaveBeenCalled()
  })

  it('imagem que falha limpa os tiles que já estão na tela e não desenha nada', async () => {
    const imagem = pendente()
    carregar.mockReturnValue(imagem.promessa)
    await montar(props())
    const grade = gradeDoMapa()
    const redraw = vi.spyOn(grade, 'redraw')
    const a = tileFalso(1, 0, 1)
    const b = tileFalso(5, 2, 3)
    semearTiles(grade, { '1:0:1': a.entrada, '5:2:3': b.entrada })

    await act(async () => {
      imagem.rejeitar(new Error('406'))
    })

    for (const t of [a, b]) {
      expect(t.ctx.clearRect).toHaveBeenCalledWith(0, 0, 256, 256)
      expect(t.ctx.drawImage).not.toHaveBeenCalled()
    }
    expect(redraw).not.toHaveBeenCalled()
  })

  it('trocar de camada limpa os tiles que já estão na tela, sem redesenhar a grade', async () => {
    const fonte = document.createElement('canvas')
    carregar.mockReturnValueOnce(Promise.resolve(fonte)).mockReturnValueOnce(pendente().promessa)
    const p = props()
    await montar(p)
    const grade = gradeDoMapa()
    const redraw = vi.spyOn(grade, 'redraw')
    const a = tileFalso(1, 0, 1)
    semearTiles(grade, { '1:0:1': a.entrada })

    await montar({ ...p, camada: 'tec' })

    expect(a.ctx.clearRect).toHaveBeenCalledWith(0, 0, 256, 256)
    expect(a.ctx.drawImage).not.toHaveBeenCalled()
    expect(redraw).not.toHaveBeenCalled()
  })

  it('grade ainda sem tiles (fora de um mapa de verdade): trocar a fonte não quebra', async () => {
    carregar.mockReturnValue(pendente().promessa)
    await montar(props())
    const grade = gradeDoMapa()
    expect((grade as unknown as { _tiles?: unknown })._tiles).toBeUndefined()
    expect(() => grade.trocarFonte(document.createElement('canvas'))).not.toThrow()
    expect(() => grade.trocarFonte(null)).not.toThrow()
  })

  it('entrada do mapa de tiles que não é canvas é ignorada', async () => {
    carregar.mockReturnValue(pendente().promessa)
    await montar(props())
    const grade = gradeDoMapa()
    const canvas = tileFalso(0, 0, 0)
    semearTiles(grade, {
      '0:0:0': canvas.entrada,
      '1:1:1': { el: document.createElement('div'), coords: { x: 1, y: 1, z: 1 } as L.Coords },
    })
    expect(() => grade.trocarFonte(document.createElement('canvas'))).not.toThrow()
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(1)
  })
})
