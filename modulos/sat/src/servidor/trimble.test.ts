// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { describe, expect, it } from 'vitest'
import { criarTrimble, janelasDeHoje } from './trimble'

describe('trimble', () => {
  it('pede 168 h a partir de 7 dias antes da 00:00 de hoje, direto no site, como navegador', async () => {
    const chamadas: { url: string; headers: Record<string, string> }[] = []
    const fetchFalso = (async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url, headers: init.headers as Record<string, string> })
      return new Response(JSON.stringify([{ value: 3, timeOfEstimation: '2026-10-05T23:00:00Z', tecValue: 20, scintiValue: 40, predicted: false }]), { status: 200 })
    }) as unknown as typeof fetch
    const agora = new Date(2026, 9, 6, 7).getTime()
    const pontos = await criarTrimble({ fetch: fetchFalso }).historico({ lat: -12.5, lon: -50.5 }, agora)
    // 00:00 de 29/09 em Cuiabá = 04:00 UTC
    expect(chamadas[0].url).toBe('https://www.gnssplanning.com/api/ionoindex/-50.5/-12.5/2026-09-29T04:00:00/168/600')
    expect(chamadas[0].headers['User-Agent']).toMatch(/Mozilla/)
    expect(pontos).toHaveLength(1)
  })
  it('403 e 429 são bloqueio; outro status é indisponível', async () => {
    const com = (status: number) => criarTrimble({ fetch: (async () => new Response('', { status })) as unknown as typeof fetch })
    await expect(com(403).historico({ lat: 0, lon: 0 }, Date.now())).rejects.toMatchObject({ tipo: 'bloqueio' })
    await expect(com(500).historico({ lat: 0, lon: 0 }, Date.now())).rejects.toMatchObject({ tipo: 'indisponivel' })
  })
  it('janelas de hoje: a mesma conta da tela (3 de 7 dias)', () => {
    const ponto = (dia: number, h: number, m: number, cintilacao: number) => ({ instante: new Date(2026, 8, dia, h, m).getTime(), indice: 3, tec: 20, cintilacao, previsto: false })
    const historico = [29, 30].flatMap((d) => [ponto(d, 20, 0, 50), ponto(d, 20, 10, 50)]).concat([ponto(28, 20, 0, 50), ponto(28, 20, 10, 10)])
    expect(janelasDeHoje(historico)).toEqual([{ inicio: 20 * 60, fim: 20 * 60 + 10, dias: 3 }])
  })
})
