import { describe, expect, it } from 'vitest'
import { COR_NIVEL } from './niveis'
import { ALFA_NIVEL, corDoValor, matiz, recolorirCintilacao, valorDoPixel } from './recolorir'

/** RGB da escala da Trimble para um valor 0–100: hsl(240·(1 − v/100), 100%, 50%). */
function pixelDaTrimble(valor: number): [number, number, number] {
  const h = (240 * (1 - valor / 100)) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : [x, 0, 1]
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

describe('escala da Trimble', () => {
  it('matiz das cores puras', () => {
    expect(matiz(255, 0, 0)).toBe(0)
    expect(matiz(0, 255, 0)).toBe(120)
    expect(matiz(0, 0, 255)).toBe(240)
  })

  it('o pixel conferido contra a série: (0, 255, 185) vale perto de 32', () => {
    expect(valorDoPixel(0, 255, 185, 255)).toBeCloseTo(31.9, 0)
  })

  it('azul puro é 0 e vermelho puro é 100', () => {
    expect(valorDoPixel(0, 0, 255, 255)).toBe(0)
    expect(valorDoPixel(255, 0, 0, 255)).toBe(100)
  })

  it('transparente, cinza e preto não são valor', () => {
    expect(valorDoPixel(255, 0, 0, 0)).toBeNull()
    expect(valorDoPixel(128, 128, 128, 255)).toBeNull()
    expect(valorDoPixel(0, 0, 0, 255)).toBeNull()
  })

  it('ida e volta: o valor sobrevive à cor da Trimble', () => {
    for (const v of [10, 32.5, 33.5, 50, 65.5, 66.5, 90]) {
      const [r, g, b] = pixelDaTrimble(v)
      expect(valorDoPixel(r, g, b, 255)).toBeCloseTo(v, 0)
    }
  })
})

describe('nossa paleta', () => {
  it('mínima some; média e forte ficam nas cores do módulo', () => {
    expect(corDoValor(32.5)).toEqual([0, 0, 0, 0])
    expect(corDoValor(33.5)).toEqual([...rgb(COR_NIVEL.media), ALFA_NIVEL.media])
    expect(corDoValor(65.5)).toEqual([...rgb(COR_NIVEL.media), ALFA_NIVEL.media])
    expect(corDoValor(66.5)).toEqual([...rgb(COR_NIVEL.forte), ALFA_NIVEL.forte])
    expect(corDoValor(null)).toEqual([0, 0, 0, 0])
  })

  it('recolore os pixels no lugar', () => {
    const dados = new Uint8ClampedArray([
      ...pixelDaTrimble(20), 255,
      ...pixelDaTrimble(50), 255,
      ...pixelDaTrimble(80), 255,
      128, 128, 128, 255,
    ])
    recolorirCintilacao(dados)
    expect([...dados]).toEqual([
      0, 0, 0, 0,
      ...rgb(COR_NIVEL.media), ALFA_NIVEL.media,
      ...rgb(COR_NIVEL.forte), ALFA_NIVEL.forte,
      0, 0, 0, 0,
    ])
  })
})
