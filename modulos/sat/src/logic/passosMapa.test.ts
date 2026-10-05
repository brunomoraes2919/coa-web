import { describe, expect, it } from 'vitest'
import { DIAS_NO_MAPA, diaDentroDoMapa, diasDoMapa, FOLGA_ULTIMO_PASSO_MS, passosDoDia, passosDoDiaPassado } from './passosMapa'
import { inicioDoDiaLocal, PASSO_MS, passoAnterior } from './tempo'

describe('passosDoDia', () => {
  it('da 00:00 local até o último passo que já tem imagem, de 10 em 10 min', () => {
    const agora = new Date(2026, 8, 24, 20, 7).getTime()
    const passos = passosDoDia(agora)
    expect(passos[0]).toBe(inicioDoDiaLocal(agora))
    expect(passos[passos.length - 1]).toBe(passoAnterior(agora - FOLGA_ULTIMO_PASSO_MS))
    expect(passos.every((p, i) => i === 0 || p - passos[i - 1] === PASSO_MS)).toBe(true)
  })

  it('logo depois da meia-noite, fica no último passo de ontem', () => {
    const agora = new Date(2026, 8, 24, 0, 5).getTime()
    expect(passosDoDia(agora)).toEqual([passoAnterior(agora - FOLGA_ULTIMO_PASSO_MS)])
  })
})

describe('dia passado', () => {
  it('os 144 passos do dia local inteiro, qualquer que seja a hora informada', () => {
    const passos = passosDoDiaPassado(new Date(2026, 8, 25, 15, 37).getTime())
    expect(passos).toHaveLength(144)
    expect(passos[0]).toBe(new Date(2026, 8, 25, 0, 0).getTime())
    expect(passos[143]).toBe(new Date(2026, 8, 25, 23, 50).getTime())
    expect(passos.every((p, i) => i === 0 || p - passos[i - 1] === 600_000)).toBe(true)
  })
})

describe('janela de dias do mapa', () => {
  const AGORA = new Date(2026, 9, 5, 14, 30).getTime()
  const dia = (mes: number, d: number) => new Date(2026, mes, d).getTime()

  it('hoje, ontem e o mais antigo (29 dias atrás), todos 00:00 local', () => {
    expect(DIAS_NO_MAPA).toBe(30)
    expect(diasDoMapa(AGORA)).toEqual({ hoje: dia(9, 5), ontem: dia(9, 4), primeiro: dia(8, 6) })
  })

  it('cruza a virada de mês sem escorregar de dia (1º de março → 31 de janeiro)', () => {
    expect(diasDoMapa(new Date(2026, 2, 1, 0, 5).getTime()).primeiro).toBe(dia(0, 31))
  })

  it('diaDentroDoMapa: um dia passado dentro da janela fica como está', () => {
    expect(diaDentroDoMapa(dia(9, 4), AGORA)).toBe(dia(9, 4))
    expect(diaDentroDoMapa(dia(8, 6), AGORA)).toBe(dia(8, 6)) // o limite vale
  })

  it('diaDentroDoMapa: hoje, nulo, mais velho que a janela e o futuro viram hoje (null)', () => {
    expect(diaDentroDoMapa(null, AGORA)).toBeNull()
    expect(diaDentroDoMapa(dia(9, 5), AGORA)).toBeNull()
    expect(diaDentroDoMapa(dia(8, 5), AGORA)).toBeNull() // um dia antes do limite
    expect(diaDentroDoMapa(dia(9, 6), AGORA)).toBeNull()
    expect(diaDentroDoMapa(Number.NaN, AGORA)).toBeNull()
  })
})
