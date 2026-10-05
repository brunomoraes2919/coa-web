import { describe, expect, it } from 'vitest'
import type { PontoIono } from '../tipos'
import { contarDiasPorFatia, janelaAindaPorVir, janelasDeRisco, textoJanela } from './janelaRisco'

const local = (dia: number, h: number, min: number) => new Date(2026, 8, dia, h, min).getTime()
const medida = (instante: number, cintilacao: number | null, previsto = false): PontoIono => ({
  instante, indice: 2, tec: 10, cintilacao, previsto,
})

function contagemCom(fatias: number[], dias: number): number[] {
  const c = new Array<number>(144).fill(0)
  for (const f of fatias) c[f] = dias
  return c
}

describe('contarDiasPorFatia', () => {
  it('conta DIAS distintos com cintilação média ou forte em cada fatia', () => {
    const c = contarDiasPorFatia([
      medida(local(18, 21, 10), 40),
      medida(local(19, 21, 12), 70),
      medida(local(20, 21, 15), 33),
      medida(local(20, 21, 18), 90), // mesmo dia e fatia: conta uma vez
      medida(local(21, 21, 10), 32), // abaixo de média
      medida(local(22, 21, 10), null),
      medida(local(23, 21, 10), 80, true), // previsto não conta
    ])
    expect(c).toHaveLength(144)
    expect(c[127]).toBe(3)
    expect(c.reduce((a, b) => a + b, 0)).toBe(3)
  })
})

describe('janelasDeRisco', () => {
  it('junta fatias vizinhas com pelo menos 3 dias', () => {
    const c = contagemCom([127, 128, 129], 3)
    c[128] = 5
    expect(janelasDeRisco(c)).toEqual([{ inicio: 1270, fim: 1300, dias: 5 }])
  })

  it('abaixo do mínimo não vira janela; buraco de até 30 min junta', () => {
    const c = contagemCom([10, 11, 13], 3)
    c[20] = 2
    expect(janelasDeRisco(c)).toEqual([{ inicio: 100, fim: 140, dias: 3 }])
  })

  it('buraco de 40 min não junta', () => {
    expect(janelasDeRisco(contagemCom([10, 11, 16], 3))).toEqual([
      { inicio: 100, fim: 120, dias: 3 },
      { inicio: 160, fim: 170, dias: 3 },
    ])
  })

  it('tolerância 0 mantém o comportamento antigo: o buraco separa', () => {
    expect(janelasDeRisco(contagemCom([10, 11, 13], 3), 3, 0)).toEqual([
      { inicio: 100, fim: 120, dias: 3 },
      { inicio: 130, fim: 140, dias: 3 },
    ])
  })

  it('ao juntar, guarda o maior número de dias', () => {
    const c = contagemCom([10, 11, 13], 3)
    c[13] = 6
    expect(janelasDeRisco(c)).toEqual([{ inicio: 100, fim: 140, dias: 6 }])
  })

  it('vira a meia-noite como uma janela só', () => {
    const c = contagemCom([140, 141, 142, 143, 0, 1, 2], 4)
    expect(janelasDeRisco(c)).toEqual([{ inicio: 1400, fim: 1470, dias: 4 }])
  })

  it('volta da meia-noite com buraco pequeno junta (20 min)', () => {
    const c = contagemCom([141, 142, 1, 2], 3)
    expect(janelasDeRisco(c)).toEqual([{ inicio: 1410, fim: 1470, dias: 3 }])
  })

  it('volta da meia-noite com buraco grande não junta (50 min)', () => {
    const c = contagemCom([138, 139, 1, 2], 3)
    expect(janelasDeRisco(c)).toEqual([
      { inicio: 10, fim: 30, dias: 3 },
      { inicio: 1380, fim: 1400, dias: 3 },
    ])
  })

  it('dia inteiro de risco é uma janela 00:00–24:00', () => {
    expect(janelasDeRisco(new Array<number>(144).fill(7))).toEqual([{ inicio: 0, fim: 1440, dias: 7 }])
  })
})

describe('texto e validade da janela', () => {
  it('texto com a volta da meia-noite', () => {
    expect(textoJanela({ inicio: 1270, fim: 1470, dias: 5 })).toBe('21:10–00:30 (5 de 7 dias)')
  })

  it('ainda por vir enquanto não acabou', () => {
    expect(janelaAindaPorVir({ inicio: 1270, fim: 1330, dias: 3 }, 720)).toBe(true)
    expect(janelaAindaPorVir({ inicio: 1270, fim: 1330, dias: 3 }, 1300)).toBe(true)
    expect(janelaAindaPorVir({ inicio: 60, fim: 120, dias: 3 }, 720)).toBe(false)
    expect(janelaAindaPorVir({ inicio: 1270, fim: 1470, dias: 3 }, 10)).toBe(true)
  })
})
