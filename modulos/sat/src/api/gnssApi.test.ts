import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buscarSerie, cabecalhosDaPonte, converterSerieTrimble, definirFonteDoToken, ErroGnss, isoTrimble, TEMPO_LIMITE_MS, urlOverlay } from './gnssApi'

const fetchFalso = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchFalso)
})

afterEach(() => {
  definirFonteDoToken(async () => null)
  vi.unstubAllGlobals()
  fetchFalso.mockReset()
  vi.useRealTimers()
})

function responder(status: number, corpo: unknown) {
  fetchFalso.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => corpo })
}

describe('isoTrimble', () => {
  it('UTC sem o Z', () => {
    expect(isoTrimble(Date.UTC(2026, 8, 24, 3, 0))).toBe('2026-09-24T03:00:00')
  })
})

describe('buscarSerie', () => {
  it('monta a URL da ponte em graus e converte os itens', async () => {
    responder(200, [
      { value: 3, timeOfEstimation: '2026-09-24T03:00:00Z', lon: -0.98, lat: -0.25, tecValue: 12.5, scintiValue: 40.2, predicted: false },
      { value: 6, timeOfEstimation: '2026-09-24T03:10:00Z', lon: -0.98, lat: -0.25, tecValue: 30, scintiValue: null, predicted: true },
    ])
    const serie = await buscarSerie({ lat: -12.5, lon: -50.5 }, Date.UTC(2026, 8, 24, 3), 27)
    expect(fetchFalso).toHaveBeenCalledWith(
      `/api/gnss?p=${encodeURIComponent('ionoindex/-50.5/-12.5/2026-09-24T03:00:00/27/600')}`,
      { signal: expect.any(AbortSignal), headers: {} },
    )
    expect(serie).toEqual([
      { instante: Date.UTC(2026, 8, 24, 3, 0), indice: 3, tec: 12.5, cintilacao: 40.2, previsto: false },
      { instante: Date.UTC(2026, 8, 24, 3, 10), indice: 6, tec: 30, cintilacao: null, previsto: true },
    ])
  })

  it('403 e 429 são bloqueio', async () => {
    responder(403, {})
    await expect(buscarSerie({ lat: 0, lon: 0 }, 0, 1)).rejects.toMatchObject({ tipo: 'bloqueio', status: 403 })
    responder(429, {})
    await expect(buscarSerie({ lat: 0, lon: 0 }, 0, 1)).rejects.toMatchObject({ tipo: 'bloqueio' })
  })

  it('outro erro HTTP é indisponível', async () => {
    responder(500, {})
    await expect(buscarSerie({ lat: 0, lon: 0 }, 0, 1)).rejects.toMatchObject({ tipo: 'indisponivel', status: 500 })
  })

  it('falha de rede é "rede"', async () => {
    fetchFalso.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const erro = await buscarSerie({ lat: 0, lon: 0 }, 0, 1).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroGnss)
    expect((erro as ErroGnss).tipo).toBe('rede')
  })

  it('Trimble que não responde: desiste em 30 s com erro de rede', async () => {
    vi.useFakeTimers()
    // Como o fetch de verdade: só termina quando o sinal aborta.
    fetchFalso.mockImplementationOnce((_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolver, rejeitar) => {
        signal.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')))
      }))
    let fim: unknown = 'pendente'
    void buscarSerie({ lat: 0, lon: 0 }, 0, 1).then((v) => (fim = v), (e: unknown) => (fim = e))

    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_MS - 1)
    expect(fim).toBe('pendente')
    await vi.advanceTimersByTimeAsync(1)
    expect(fim).toBeInstanceOf(ErroGnss)
    expect(fim).toMatchObject({ tipo: 'rede', status: 0, message: 'A Trimble não respondeu em 30 s.' })
    expect(TEMPO_LIMITE_MS).toBe(30_000)
  })

  it('resposta a tempo desarma o relógio', async () => {
    vi.useFakeTimers()
    responder(200, [])
    await buscarSerie({ lat: 0, lon: 0 }, 0, 1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('corpo que não é lista é indisponível', async () => {
    responder(200, { erro: 'x' })
    await expect(buscarSerie({ lat: 0, lon: 0 }, 0, 1)).rejects.toMatchObject({ tipo: 'indisponivel' })
  })
})

describe('converterSerieTrimble', () => {
  it('converte a lista da Trimble em pontos', () => {
    const serie = converterSerieTrimble([
      { value: 3, timeOfEstimation: '2026-10-06T10:00:00Z', tecValue: 20, scintiValue: 40, predicted: false },
    ])
    expect(serie).toHaveLength(1)
    expect(serie[0].cintilacao).toBe(40)
  })

  it('o que não é lista é erro de indisponibilidade', () => {
    expect(() => converterSerieTrimble({})).toThrow(ErroGnss)
    expect(() => converterSerieTrimble({})).toThrow(expect.objectContaining({ tipo: 'indisponivel', status: 200 }))
  })
})

describe('urlOverlay', () => {
  it('um PNG por passo, cintilação ou TEC', () => {
    const t = Date.UTC(2026, 8, 24, 20, 10)
    expect(urlOverlay('sci', t)).toBe(`/api/gnss?p=${encodeURIComponent('overlay/sci/2026-09-24T20:10:00')}`)
    expect(urlOverlay('tec', t)).toBe(`/api/gnss?p=${encodeURIComponent('overlay/tec/2026-09-24T20:10:00')}`)
  })
})

describe('ponte do COA WEB', () => {
  it('a série vai por /api/gnss?p= com o caminho codificado e o token no cabeçalho', async () => {
    const pedidos: { url: string; headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      pedidos.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    })
    definirFonteDoToken(async () => 'token-da-sessao')
    await buscarSerie({ lat: -12.5, lon: -50.5 }, Date.parse('2026-10-05T04:00:00Z'), 27)
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].url).toBe(`/api/gnss?p=${encodeURIComponent('ionoindex/-50.5/-12.5/2026-10-05T04:00:00/27/600')}`)
    expect(pedidos[0].headers['X-Coa-Token']).toBe('token-da-sessao')
  })

  it('sem sessão não manda o cabeçalho', async () => {
    expect(await cabecalhosDaPonte()).toEqual({})
  })

  it('a imagem aponta para a mesma ponte', () => {
    expect(urlOverlay('sci', Date.parse('2026-09-25T03:00:00Z'))).toBe(
      `/api/gnss?p=${encodeURIComponent('overlay/sci/2026-09-25T03:00:00')}`,
    )
  })

  it('401 da ponte (sessão vencida) conta como falha de rede', async () => {
    vi.stubGlobal('fetch', async () => new Response('Entre no COA WEB.', { status: 401 }))
    await expect(buscarSerie({ lat: -12.5, lon: -50.5 }, Date.parse('2026-10-05T04:00:00Z'), 27)).rejects.toMatchObject({
      name: 'ErroGnss', tipo: 'rede', status: 401,
    })
  })
})
