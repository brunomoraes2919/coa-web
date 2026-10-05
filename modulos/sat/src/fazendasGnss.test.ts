import { describe, expect, it } from 'vitest'
import { celulaDe, celulasDasFazendas } from './fazendasGnss'

describe('celulaDe', () => {
  it('arredonda para o quadrado de 0,5° mais próximo', () => {
    expect(celulaDe(-12.26, -50.31)).toEqual({ id: '-12.5_-50.5', lat: -12.5, lon: -50.5 })
    expect(celulaDe(-12.2, -55.9)).toEqual({ id: '-12_-56', lat: -12, lon: -56 })
  })
})

describe('celulasDasFazendas', () => {
  it('um quadrado por posição distinta, sem os não localizados', () => {
    expect(celulasDasFazendas([
      { id: '1', nome: 'A', lat: -12.26, lon: -50.31, celulaId: '-12.5_-50.5' },
      { id: '2', nome: 'B', lat: -12.3, lon: -50.4, celulaId: '-12.5_-50.5' },
      { id: '3', nome: 'C', lat: null, lon: null, celulaId: null },
    ])).toEqual([{ id: '-12.5_-50.5', lat: -12.5, lon: -50.5 }])
  })
})
