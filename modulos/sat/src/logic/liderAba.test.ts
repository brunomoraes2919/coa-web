import { beforeEach, describe, expect, it } from 'vitest'
import { CHAVE_LIDER, DURACAO_ARRENDAMENTO_MS, lerArrendamento, soltarLideranca, tentarLiderar } from './liderAba'

const T = 1_000_000

beforeEach(() => localStorage.clear())

describe('liderança entre abas', () => {
  it('a primeira aba assume', () => {
    expect(tentarLiderar(localStorage, 'A', T)).toBe(true)
    expect(lerArrendamento(localStorage)).toEqual({ aba: 'A', expira: T + DURACAO_ARRENDAMENTO_MS })
  })

  it('outra aba não assume enquanto o arrendamento vale', () => {
    tentarLiderar(localStorage, 'A', T)
    expect(tentarLiderar(localStorage, 'B', T + 1000)).toBe(false)
  })

  it('o dono renova', () => {
    tentarLiderar(localStorage, 'A', T)
    expect(tentarLiderar(localStorage, 'A', T + 30_000)).toBe(true)
    expect(lerArrendamento(localStorage)?.expira).toBe(T + 30_000 + DURACAO_ARRENDAMENTO_MS)
  })

  it('vencido, outra aba assume', () => {
    tentarLiderar(localStorage, 'A', T)
    expect(tentarLiderar(localStorage, 'B', T + DURACAO_ARRENDAMENTO_MS)).toBe(true)
  })

  it('soltar só remove o próprio', () => {
    tentarLiderar(localStorage, 'A', T)
    soltarLideranca(localStorage, 'B')
    expect(lerArrendamento(localStorage)?.aba).toBe('A')
    soltarLideranca(localStorage, 'A')
    expect(lerArrendamento(localStorage)).toBeNull()
  })

  it('valor corrompido conta como vazio', () => {
    localStorage.setItem(CHAVE_LIDER, '{quebrado')
    expect(lerArrendamento(localStorage)).toBeNull()
    expect(tentarLiderar(localStorage, 'B', T)).toBe(true)
  })
})
