import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { definirFonteDoToken, urlOverlay } from '../api/gnssApi'
import { COR_NIVEL } from '../logic/niveis'
import { ALFA_NIVEL } from '../logic/recolorir'
import { carregarIonosfera, limparCacheIonosfera, precarregarIonosfera } from './imagemIonosfera'

const T = Date.UTC(2026, 8, 24, 21, 30)

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Canvas 2D de mentira: o jsdom não desenha. Um pixel vermelho puro (100 na escala da Trimble). */
const ctx = {
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) })),
  putImageData: vi.fn(),
}

const fetchFalso = vi.fn()

beforeEach(() => {
  ctx.drawImage.mockClear()
  ctx.getImageData.mockClear()
  ctx.putImageData.mockClear()
  fetchFalso.mockReset()
  fetchFalso.mockImplementation(async () => new Response(new Blob(['x']), { status: 200 }))
  vi.stubGlobal('fetch', fetchFalso)
  vi.stubGlobal('createImageBitmap', async () => ({ close: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
  definirFonteDoToken(async () => 'tok')
  limparCacheIonosfera()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  definirFonteDoToken(async () => null)
  limparCacheIonosfera()
})

describe('carregarIonosfera', () => {
  it('um pedido só por passo: a segunda chamada devolve a mesma promessa, com o token na ponte', async () => {
    const a = carregarIonosfera('sci', T)
    const b = carregarIonosfera('sci', T)
    expect(b).toBe(a)
    const canvas = await a
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(256)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFalso.mock.calls[0]
    expect(url).toBe(urlOverlay('sci', T))
    expect(init.headers).toEqual({ 'X-Coa-Token': 'tok' })
  })

  it('camadas e passos diferentes são pedidos diferentes', async () => {
    await carregarIonosfera('sci', T)
    await carregarIonosfera('tec', T)
    await carregarIonosfera('sci', T + 600_000)
    expect(fetchFalso).toHaveBeenCalledTimes(3)
  })

  it('sci é recolorida na nossa paleta; tec fica como veio', async () => {
    await carregarIonosfera('sci', T)
    expect(ctx.putImageData).toHaveBeenCalledTimes(1)
    const pixels = ctx.putImageData.mock.calls[0][0] as { data: Uint8ClampedArray }
    expect([...pixels.data]).toEqual([...rgb(COR_NIVEL.forte), ALFA_NIVEL.forte])

    ctx.getImageData.mockClear()
    ctx.putImageData.mockClear()
    await carregarIonosfera('tec', T)
    expect(ctx.drawImage).toHaveBeenCalled()
    expect(ctx.getImageData).not.toHaveBeenCalled()
    expect(ctx.putImageData).not.toHaveBeenCalled()
  })

  it('resposta 406 rejeita, e a falha não fica no cache: a próxima chamada pede de novo', async () => {
    fetchFalso.mockImplementationOnce(async () => new Response(null, { status: 406 }))
    await expect(carregarIonosfera('sci', T)).rejects.toThrow(/406/)
    expect(fetchFalso).toHaveBeenCalledTimes(1)

    await expect(carregarIonosfera('sci', T)).resolves.toBeInstanceOf(HTMLCanvasElement)
    expect(fetchFalso).toHaveBeenCalledTimes(2)
  })

  it('sem contexto 2D do canvas, rejeita', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    await expect(carregarIonosfera('tec', T)).rejects.toThrow(/Canvas/)
  })
})

describe('precarregarIonosfera', () => {
  it('com falha não gera rejeição não tratada e deixa o cache limpo', async () => {
    const naoTratadas: unknown[] = []
    const aoRejeitar = (motivo: unknown) => naoTratadas.push(motivo)
    process.on('unhandledRejection', aoRejeitar)
    try {
      fetchFalso.mockImplementationOnce(async () => new Response(null, { status: 406 }))
      precarregarIonosfera('sci', T)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(naoTratadas).toEqual([])
    } finally {
      process.off('unhandledRejection', aoRejeitar)
    }

    await carregarIonosfera('sci', T)
    expect(fetchFalso).toHaveBeenCalledTimes(2)
  })

  it('com sucesso aquece o cache: carregar depois não pede de novo', async () => {
    precarregarIonosfera('tec', T)
    await carregarIonosfera('tec', T)
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })
})
