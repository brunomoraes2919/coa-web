import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { definirFonteDoToken, urlOverlay } from '../api/gnssApi'
import { COR_NIVEL } from '../logic/niveis'
import { ALFA_NIVEL } from '../logic/recolorir'
import { carregarIonosfera, carregarIonosferaNoRitmo, INTERVALO_MINIMO_PEDIDO_MS, limparCacheIonosfera, precarregarIonosfera } from './imagemIonosfera'

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

describe('carregarIonosferaNoRitmo', () => {
  const PASSO = 600_000
  const INICIO = Date.UTC(2026, 8, 24, 21, 0)
  /** Os instantes (do relógio falso) em que cada pedido saiu para a ponte. */
  let saidas: number[]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(INICIO)
    limparCacheIonosfera()
    saidas = []
    fetchFalso.mockImplementation(async () => {
      saidas.push(Date.now() - INICIO)
      return new Response(new Blob(['x']), { status: 200 })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('o limite é de um pedido novo a cada 500 ms', () => {
    expect(INTERVALO_MINIMO_PEDIDO_MS).toBe(500)
  })

  it('imagem já no cache: devolve a mesma promessa na hora, sem timer e sem pedido novo', async () => {
    const primeira = carregarIonosfera('sci', T)
    await vi.advanceTimersByTimeAsync(0)
    const repetida = carregarIonosferaNoRitmo('sci', T)
    expect(repetida).toBe(primeira)
    expect(vi.getTimerCount()).toBe(0)
    await repetida
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('o primeiro pedido novo sai na hora', async () => {
    const pedido = carregarIonosferaNoRitmo('sci', T)
    await vi.advanceTimersByTimeAsync(0)
    expect(saidas).toEqual([0])
    await expect(pedido).resolves.toBeInstanceOf(HTMLCanvasElement)
  })

  it('pedidos novos seguidos saem a pelo menos 500 ms um do outro', async () => {
    const pedidos = [0, 1, 2].map((i) => carregarIonosferaNoRitmo('sci', T + i * PASSO))
    await vi.advanceTimersByTimeAsync(0)
    expect(saidas).toEqual([0])
    await vi.advanceTimersByTimeAsync(499)
    expect(saidas).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(saidas).toEqual([0, 500])
    await vi.advanceTimersByTimeAsync(500)
    expect(saidas).toEqual([0, 500, 1000])
    await Promise.all(pedidos)
  })

  it('depois de uma pausa maior que 500 ms o pedido novo sai na hora', async () => {
    await carregarIonosferaNoRitmo('sci', T)
    await vi.advanceTimersByTimeAsync(2_000)
    const pedido = carregarIonosferaNoRitmo('sci', T + PASSO)
    await vi.advanceTimersByTimeAsync(0)
    expect(saidas).toEqual([0, 2_000])
    await pedido
  })

  it('o mesmo passo pedido duas vezes enquanto espera é um pedido só', async () => {
    carregarIonosferaNoRitmo('sci', T)
    const a = carregarIonosferaNoRitmo('sci', T + PASSO)
    const b = carregarIonosferaNoRitmo('sci', T + PASSO)
    expect(b).toBe(a)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(saidas).toEqual([0, 500])
  })

  it('pedido em cache no meio da fila não conta nem espera', async () => {
    await carregarIonosfera('tec', T)
    carregarIonosferaNoRitmo('sci', T)
    const emCache = carregarIonosferaNoRitmo('tec', T)
    await vi.advanceTimersByTimeAsync(0)
    await emCache
    expect(saidas).toEqual([0, 0])
  })

  it('falha não trava o próximo: ele sai 500 ms depois e o passo que falhou pode ser pedido de novo', async () => {
    fetchFalso.mockImplementationOnce(async () => {
      saidas.push(Date.now() - INICIO)
      return new Response(null, { status: 406 })
    })
    const falho = carregarIonosferaNoRitmo('sci', T)
    const seguinte = carregarIonosferaNoRitmo('sci', T + PASSO)
    const falhou = expect(falho).rejects.toThrow(/406/)
    await vi.advanceTimersByTimeAsync(500)
    await falhou
    await expect(seguinte).resolves.toBeInstanceOf(HTMLCanvasElement)
    expect(saidas).toEqual([0, 500])

    const denovo = carregarIonosferaNoRitmo('sci', T)
    await vi.advanceTimersByTimeAsync(500)
    await expect(denovo).resolves.toBeInstanceOf(HTMLCanvasElement)
    expect(saidas).toEqual([0, 500, 1000])
  })

  it('limpar o cache (só de testes) também zera o relógio dos pedidos', async () => {
    carregarIonosferaNoRitmo('sci', T)
    await vi.advanceTimersByTimeAsync(0)
    limparCacheIonosfera()
    carregarIonosferaNoRitmo('sci', T + PASSO)
    await vi.advanceTimersByTimeAsync(0)
    expect(saidas).toEqual([0, 0])
  })
})
