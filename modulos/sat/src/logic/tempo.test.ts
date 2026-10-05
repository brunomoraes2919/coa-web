import { describe, expect, it } from 'vitest'
import {
  chaveData, dataCurta, diaDaChave, fatiaDoDia, horaDe, inicioDoDiaLocal, minutoDoDia, passoAnterior, rotuloHora,
} from './tempo'

/* Horas LOCAIS (`new Date(a, m, d, h, min)`): valem em qualquer fuso da
   máquina que rodar o teste. Só `passoAnterior` é UTC por definição. */
const local = (h: number, min: number, dia = 24) => new Date(2026, 8, dia, h, min).getTime()

describe('relógio do módulo', () => {
  it('início do dia local zera hora e minuto', () => {
    expect(inicioDoDiaLocal(local(21, 37))).toBe(local(0, 0))
  })

  it('passo anterior cai no múltiplo de 10 min (UTC), igual quando já é múltiplo', () => {
    expect(passoAnterior(Date.UTC(2026, 8, 24, 21, 37, 12))).toBe(Date.UTC(2026, 8, 24, 21, 30))
    expect(passoAnterior(Date.UTC(2026, 8, 24, 21, 30))).toBe(Date.UTC(2026, 8, 24, 21, 30))
  })

  it('minuto e fatia do dia local', () => {
    expect(minutoDoDia(local(21, 37))).toBe(1297)
    expect(fatiaDoDia(local(21, 37))).toBe(129)
    expect(fatiaDoDia(local(0, 0))).toBe(0)
    expect(fatiaDoDia(local(23, 59))).toBe(143)
  })

  it('chave de data é o dia LOCAL', () => {
    expect(chaveData(local(0, 5))).toBe('2026-09-24')
    expect(chaveData(local(23, 55))).toBe('2026-09-24')
  })

  it('rótulo de hora aceita a volta da meia-noite e valores negativos', () => {
    expect(rotuloHora(1270)).toBe('21:10')
    expect(rotuloHora(1470)).toBe('00:30')
    expect(rotuloHora(1440)).toBe('00:00')
    expect(rotuloHora(-10)).toBe('23:50')
    expect(horaDe(local(7, 5))).toBe('07:05')
  })
})

describe('datas do mapa', () => {
  it('dataCurta é DD/MM', () => {
    expect(dataCurta(new Date(2026, 8, 5, 21, 40).getTime())).toBe('05/09')
  })

  it('diaDaChave devolve a 00:00 local do dia e recusa o que não é data', () => {
    expect(diaDaChave('2026-09-25')).toBe(new Date(2026, 8, 25).getTime())
    expect(diaDaChave(chaveData(new Date(2026, 0, 1, 13).getTime()))).toBe(new Date(2026, 0, 1).getTime())
    expect(diaDaChave('2026-02-30')).toBeNull()
    expect(diaDaChave('25/09/2026')).toBeNull()
    expect(diaDaChave('')).toBeNull()
  })
})
