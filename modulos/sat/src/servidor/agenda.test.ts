// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { describe, expect, it } from 'vitest'
import { chaveDoAntes, chaveEvento, eventosFixosNaHora, janelaDoAntes, precisaCalcular } from './agenda'

const em = (h: number, m = 0, dia = 6) => new Date(2026, 9, dia, h, m).getTime()

describe('agenda', () => {
  it('chave do evento leva o dia local', () => {
    expect(chaveEvento(em(7), 'resumo-07')).toBe('2026-10-06:resumo-07')
    expect(chaveEvento(em(23, 59), 'antes')).toBe('2026-10-06:antes')
  })
  it('o "antes" conta por noite: de madrugada é a chave da noite que começou no dia anterior', () => {
    expect(chaveDoAntes(em(18, 30))).toBe('2026-10-06:antes')
    expect(chaveDoAntes(em(0, 10, 7))).toBe('2026-10-06:antes')
    expect(chaveDoAntes(em(12, 0, 7))).toBe('2026-10-07:antes')
  })
  it('resumo vale das 07:00 às 08:00; lembrete das 12:00 às 13:00', () => {
    expect(eventosFixosNaHora(em(6, 59))).toEqual([])
    expect(eventosFixosNaHora(em(7))).toEqual(['resumo-07'])
    expect(eventosFixosNaHora(em(8))).toEqual(['resumo-07'])
    expect(eventosFixosNaHora(em(8, 1))).toEqual([])
    expect(eventosFixosNaHora(em(12, 30))).toEqual(['lembrete-12'])
    expect(eventosFixosNaHora(em(13, 1))).toEqual([])
  })
  it('precisa calcular quando passou de 00:05, 07:00 ou 12:00 desde o último cálculo', () => {
    expect(precisaCalcular(em(6), null)).toBe(true)
    expect(precisaCalcular(em(6, 59), em(0, 5))).toBe(false)
    expect(precisaCalcular(em(7), em(0, 5))).toBe(true)
    expect(precisaCalcular(em(7, 30), em(7, 1))).toBe(false)
    expect(precisaCalcular(em(12), em(7, 1))).toBe(true)
    expect(precisaCalcular(em(0, 4, 7), em(12, 1))).toBe(false)
    expect(precisaCalcular(em(0, 5, 7), em(12, 1))).toBe(true)
  })
  it('o "antes" é a janela que começa primeiro, dentro dos próximos 30 min', () => {
    const a = { inicio: 19 * 60, fim: 21 * 60 + 30, dias: 5 }
    const b = { inicio: 21 * 60 + 50, fim: 22 * 60, dias: 3 }
    expect(janelaDoAntes([b, a], em(18, 29))).toBeNull()
    expect(janelaDoAntes([b, a], em(18, 30))).toEqual(a)
    expect(janelaDoAntes([b, a], em(19))).toEqual(a)
    expect(janelaDoAntes([b, a], em(19, 1))).toBeNull()
    expect(janelaDoAntes([b, a], em(21, 30))).toEqual(b)
    expect(janelaDoAntes([], em(19))).toBeNull()
  })
})
