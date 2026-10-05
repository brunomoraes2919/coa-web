import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroGnss } from '../api/gnssApi'
import { chaveData, DIA_MS, inicioDoDiaLocal } from '../logic/tempo'
import type { PontoIono } from '../tipos'
import { aplicarCiclo, comJitter, executarCiclo, msAteProximoCiclo, PAUSA_ENTRE_CHAMADAS_MS } from './ciclo'
import { ESTADO_INICIAL } from './estado'

const AGORA = new Date(2026, 8, 24, 21, 35).getTime()
const HOJE = inicioDoDiaLocal(AGORA)
const C1 = { id: '-12.5_-50.5', lat: -12.5, lon: -50.5 }
const C2 = { id: '-13_-58', lat: -13, lon: -58 }

/** Cintilação forte às 21:10 em 3 dos últimos dias → janela 21:10–21:20. */
function historicoComJanela(): PontoIono[] {
  return [1, 2, 3].map((d) => ({
    instante: HOJE - d * DIA_MS + (21 * 60 + 10) * 60_000, indice: 3, tec: 20, cintilacao: 70, previsto: false,
  }))
}

function buscarFalso() {
  return vi.fn(async (_p: { lat: number; lon: number }, inicio: number): Promise<PontoIono[]> =>
    (inicio === HOJE ? [] : historicoComJanela()))
}

beforeEach(() => localStorage.clear())

describe('executarCiclo', () => {
  it('por quadrado: série de hoje (27 h) e histórico de 7 dias, em série com pausa', async () => {
    const buscar = buscarFalso()
    const esperar = vi.fn(async () => {})
    const r = await executarCiclo([C1, C2], AGORA, { buscarSerie: buscar, esperar, armazenamento: localStorage })
    expect(r.erro).toBeNull()
    expect(buscar.mock.calls).toEqual([
      [{ lat: -12.5, lon: -50.5 }, HOJE, 27],
      [{ lat: -12.5, lon: -50.5 }, HOJE - 7 * DIA_MS, 168],
      [{ lat: -13, lon: -58 }, HOJE, 27],
      [{ lat: -13, lon: -58 }, HOJE - 7 * DIA_MS, 168],
    ])
    expect(esperar).toHaveBeenCalledTimes(3)
    expect(esperar).toHaveBeenCalledWith(PAUSA_ENTRE_CHAMADAS_MS)
    expect(r.dados[C1.id].janelas).toEqual([{ inicio: 1270, fim: 1280, dias: 3 }])
  })

  it('mesmo dia: histórico sai do cache, só a série de hoje é pedida', async () => {
    const buscar = buscarFalso()
    const esperar = vi.fn(async () => {})
    await executarCiclo([C1], AGORA, { buscarSerie: buscar, esperar, armazenamento: localStorage })
    buscar.mockClear()
    const r = await executarCiclo([C1], AGORA + 10 * 60_000, { buscarSerie: buscar, esperar, armazenamento: localStorage })
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(r.dados[C1.id].janelas).toEqual([{ inicio: 1270, fim: 1280, dias: 3 }])
  })

  it('cache da v1 (janelas sem a junção de 30 min) não é reaproveitado', async () => {
    localStorage.setItem('locks_sat_historico_v1', JSON.stringify({
      [C1.id]: { data: chaveData(AGORA), janelas: [{ inicio: 60, fim: 70, dias: 3 }] },
    }))
    const buscar = buscarFalso()
    const r = await executarCiclo([C1], AGORA, { buscarSerie: buscar, esperar: vi.fn(async () => {}), armazenamento: localStorage })
    expect(buscar).toHaveBeenCalledTimes(2)
    expect(r.dados[C1.id].janelas).toEqual([{ inicio: 1270, fim: 1280, dias: 3 }])
  })

  it('histórico vazio: não cacheia, próximo ciclo pede de novo', async () => {
    const buscar = vi.fn(async (_p: { lat: number; lon: number }, inicio: number): Promise<PontoIono[]> =>
      (inicio === HOJE ? [] : []))
    const esperar = vi.fn(async () => {})
    const r = await executarCiclo([C1], AGORA, { buscarSerie: buscar, esperar, armazenamento: localStorage })
    expect(r.erro).toBeNull()
    expect(r.dados[C1.id].janelas).toEqual([])
    buscar.mockClear()
    const r2 = await executarCiclo([C1], AGORA + 10 * 60_000, { buscarSerie: buscar, esperar, armazenamento: localStorage })
    expect(buscar).toHaveBeenCalledTimes(2)
    expect(r2.dados[C1.id].janelas).toEqual([])
  })

  it('cache do histórico corrompido ("null", fora do formato) não derruba o ciclo: pede de novo', async () => {
    for (const bruto of ['null', '42', '[]', JSON.stringify({ [C1.id]: { data: chaveData(AGORA), janelas: 'x' } }),
      JSON.stringify({ [C1.id]: null })]) {
      localStorage.setItem('locks_sat_historico_v2', bruto)
      const buscar = buscarFalso()
      const r = await executarCiclo([C1], AGORA, { buscarSerie: buscar, esperar: vi.fn(async () => {}), armazenamento: localStorage })
      expect(r.erro, bruto).toBeNull()
      expect(buscar, bruto).toHaveBeenCalledTimes(2)
      expect(r.dados[C1.id].janelas, bruto).toEqual([{ inicio: 1270, fim: 1280, dias: 3 }])
    }
  })

  it('para no primeiro erro e diz o tipo; o que veio até ali vale', async () => {
    const buscar = vi.fn(async (p: { lat: number; lon: number }): Promise<PontoIono[]> => {
      if (p.lat === -13) throw new ErroGnss('bloqueio', 403, 'x')
      return []
    })
    const r = await executarCiclo([C1, C2], AGORA, {
      buscarSerie: buscar, esperar: vi.fn(async () => {}), armazenamento: localStorage,
    })
    expect(r.erro).toBe('bloqueio')
    expect(Object.keys(r.dados)).toEqual([C1.id])
  })
})

describe('aplicarCiclo', () => {
  it('sucesso zera falhas e marca a hora', () => {
    const e = aplicarCiclo(
      { ...ESTADO_INICIAL, falhasSeguidas: 2, erro: 'rede' },
      { dados: { a: { serie: [], janelas: [] } }, erro: null },
      AGORA,
    )
    expect(e).toMatchObject({ falhasSeguidas: 0, erro: null, ultimoSucesso: AGORA })
    expect(e.celulas.a).toEqual({ serie: [], janelas: [] })
  })

  it('falha soma e mantém o dado anterior dos outros quadrados', () => {
    const anterior = { ...ESTADO_INICIAL, ultimoSucesso: 1, celulas: { b: { serie: [], janelas: [] } } }
    const e = aplicarCiclo(anterior, { dados: {}, erro: 'bloqueio' }, AGORA)
    expect(e).toMatchObject({ falhasSeguidas: 1, erro: 'bloqueio', ultimoSucesso: 1 })
    expect(e.celulas.b).toBeDefined()
  })
})

describe('msAteProximoCiclo', () => {
  it('2 min depois de cada passo de 10 min', () => {
    expect(msAteProximoCiclo(Date.UTC(2026, 8, 24, 21, 31))).toBe(60_000)
    expect(msAteProximoCiclo(Date.UTC(2026, 8, 24, 21, 32))).toBe(10 * 60_000)
    expect(msAteProximoCiclo(Date.UTC(2026, 8, 24, 21, 33))).toBe(9 * 60_000)
  })
})

describe('comJitter', () => {
  it('soma de 0 a 90 s, para as máquinas da rede não baterem na Trimble no mesmo segundo', () => {
    expect(comJitter(60_000, () => 0)).toBe(60_000)
    expect(comJitter(60_000, () => 0.5)).toBe(105_000)
    expect(comJitter(60_000, () => 0.999_999)).toBe(149_999)
  })
})
