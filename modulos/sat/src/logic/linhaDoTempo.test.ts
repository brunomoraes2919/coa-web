import { describe, expect, it } from 'vitest'
import { faixasDasJanelas, linhaDoDia } from './linhaDoTempo'

const local = (h: number, m: number, dia = 24) => new Date(2026, 8, dia, h, m).getTime()

describe('linhaDoDia', () => {
  it('144 fatias; medida e previsão no lugar; ontem fica de fora', () => {
    const linha = linhaDoDia([
      { instante: local(23, 50, 23), indice: 9, tec: 1, cintilacao: 90, previsto: false },
      { instante: local(21, 10), indice: 4, tec: 30, cintilacao: 45, previsto: false },
      { instante: local(22, 0), indice: 7, tec: 20, cintilacao: null, previsto: true },
    ], local(21, 15))
    expect(linha).toHaveLength(144)
    expect(linha[127]).toEqual({ minuto: 1270, cintilacao: 45, indice: 4, previsto: false })
    expect(linha[132]).toEqual({ minuto: 1320, cintilacao: null, indice: 7, previsto: true })
    expect(linha[143]).toEqual({ minuto: 1430, cintilacao: null, indice: null, previsto: false })
  })
})

describe('faixasDasJanelas', () => {
  it('janela normal é uma faixa; a que vira a meia-noite são duas', () => {
    expect(faixasDasJanelas([{ inicio: 1270, fim: 1330, dias: 3 }, { inicio: 1400, fim: 1470, dias: 4 }])).toEqual([
      { x1: 1270, x2: 1330 },
      { x1: 1400, x2: 1440 },
      { x1: 0, x2: 30 },
    ])
  })
})
