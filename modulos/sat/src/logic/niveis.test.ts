import { describe, expect, it } from 'vitest'
import type { PontoIono } from '../tipos'
import {
  COR_INDICE, corDoIndice, corEscala, nivelCintilacao, picoPrevisto, severidadeDoIndice,
  severidadeDoNivel, ultimaMedida,
} from './niveis'

const AGORA = Date.UTC(2026, 8, 24, 23, 0)
const min = (n: number) => n * 60_000
function ponto(deltaMin: number, extra: Partial<PontoIono> = {}): PontoIono {
  return { instante: AGORA + min(deltaMin), indice: 2, tec: 10, cintilacao: 0, previsto: false, ...extra }
}

describe('nível da cintilação (faixas da Trimble)', () => {
  it('limites exatos', () => {
    expect(nivelCintilacao(0)).toBe('minima')
    expect(nivelCintilacao(32.99)).toBe('minima')
    expect(nivelCintilacao(33)).toBe('media')
    expect(nivelCintilacao(65.9)).toBe('media')
    expect(nivelCintilacao(66)).toBe('forte')
    expect(nivelCintilacao(100)).toBe('forte')
  })

  it('sem número é "sem dado", nunca "mínima"', () => {
    expect(nivelCintilacao(null)).toBe('sem-dado')
    expect(nivelCintilacao(undefined)).toBe('sem-dado')
    expect(nivelCintilacao(Number.NaN)).toBe('sem-dado')
  })

  it('severidade: média é aviso, forte é crítico', () => {
    expect(severidadeDoNivel('minima')).toBeNull()
    expect(severidadeDoNivel('sem-dado')).toBeNull()
    expect(severidadeDoNivel('media')).toBe('aviso')
    expect(severidadeDoNivel('forte')).toBe('critico')
  })
})

describe('índice ionosférico (zonas do gráfico da Trimble)', () => {
  it('verde até 4, amarelo 5–7, vermelho 8+', () => {
    expect(severidadeDoIndice(4)).toBeNull()
    expect(severidadeDoIndice(5)).toBe('aviso')
    expect(severidadeDoIndice(7)).toBe('aviso')
    expect(severidadeDoIndice(8)).toBe('critico')
    expect(corDoIndice(3)).toBe(COR_INDICE.verde)
    expect(corDoIndice(6)).toBe(COR_INDICE.amarelo)
    expect(corDoIndice(9)).toBe(COR_INDICE.vermelho)
  })
})

describe('última medida', () => {
  it('pega a medida mais recente, ignorando previsão e passo sem valor', () => {
    const serie = [
      ponto(-40, { cintilacao: 10 }),
      ponto(-20, { cintilacao: 50 }),
      ponto(-10, { cintilacao: null }),
      ponto(10, { previsto: true, cintilacao: null }),
    ]
    expect(ultimaMedida(serie, AGORA)?.cintilacao).toBe(50)
  })

  it('medida com mais de 30 min não vale', () => {
    expect(ultimaMedida([ponto(-31, { cintilacao: 50 })], AGORA)).toBeNull()
    expect(ultimaMedida([ponto(-30, { cintilacao: 50 })], AGORA)?.cintilacao).toBe(50)
  })

  it('não olha para o futuro', () => {
    expect(ultimaMedida([ponto(5, { cintilacao: 80 })], AGORA)).toBeNull()
  })
})

describe('pico previsto nas próximas 3 h', () => {
  it('maior índice previsto dentro do horizonte; o primeiro no empate', () => {
    const serie = [
      ponto(-10, { indice: 9 }), // medido: não conta
      ponto(60, { previsto: true, indice: 5 }),
      ponto(120, { previsto: true, indice: 8 }),
      ponto(150, { previsto: true, indice: 8 }),
      ponto(240, { previsto: true, indice: 10 }), // fora das 3 h
    ]
    const pico = picoPrevisto(serie, AGORA)
    expect(pico?.indice).toBe(8)
    expect(pico?.instante).toBe(AGORA + min(120))
  })

  it('sem previsão no horizonte: null', () => {
    expect(picoPrevisto([ponto(-10)], AGORA)).toBeNull()
  })
})

describe('escala de cor (a mesma dos PNGs da Trimble)', () => {
  it('azul no mínimo, vermelho no máximo, com trava nas pontas', () => {
    expect(corEscala(0)).toBe('hsl(240, 100%, 50%)')
    expect(corEscala(1)).toBe('hsl(0, 100%, 50%)')
    expect(corEscala(2)).toBe('hsl(0, 100%, 50%)')
    expect(corEscala(-1)).toBe('hsl(240, 100%, 50%)')
  })
})
