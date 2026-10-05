/**
 * A imagem de cintilação da Trimble pinta o valor 0–100 numa matiz de 240° (azul, 0) a 0°
 * (vermelho, 100), linear. Aqui cada pixel volta a valor e ganha a cor da NOSSA paleta — a
 * mesma das fazendas e da tela Hoje: mínima some, média e forte ficam semitransparentes.
 */
import type { NivelCintilacao } from '../tipos'
import { COR_NIVEL, nivelCintilacao } from './niveis'

/** Alfa (0–255) dos níveis pintados; os outros ficam transparentes. */
export const ALFA_NIVEL = { media: 140, forte: 170 } as const

/** Abaixo disto o pixel é cinza ou preto (borda, fundo), não valor da escala. */
const SATURACAO_MINIMA = 0.25
const ALFA_MINIMO = 8

/** Matiz em graus (0–360) de um RGB 0–255. */
export function matiz(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** Valor 0–100 de um pixel da imagem de cintilação; `null` = pixel sem informação. */
export function valorDoPixel(r: number, g: number, b: number, a: number): number | null {
  if (a < ALFA_MINIMO) return null
  const max = Math.max(r, g, b)
  if (max === 0 || (max - Math.min(r, g, b)) / max < SATURACAO_MINIMA) return null
  // Matiz acima de 240° (roxo) não existe na escala: conta como o começo dela.
  return 100 * (1 - Math.min(matiz(r, g, b), 240) / 240)
}

function rgbDoHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const TRANSPARENTE: [number, number, number, number] = [0, 0, 0, 0]
const COR_PINTADA: Partial<Record<NivelCintilacao, [number, number, number, number]>> = {
  media: [...rgbDoHex(COR_NIVEL.media), ALFA_NIVEL.media],
  forte: [...rgbDoHex(COR_NIVEL.forte), ALFA_NIVEL.forte],
}

/** Cor RGBA (0–255) da nossa paleta para um valor da escala. */
export function corDoValor(valor: number | null): [number, number, number, number] {
  return COR_PINTADA[nivelCintilacao(valor)] ?? TRANSPARENTE
}

/** Recolore NO LUGAR os pixels RGBA (o `data` de um ImageData) da imagem de cintilação. */
export function recolorirCintilacao(dados: Uint8ClampedArray): void {
  for (let i = 0; i < dados.length; i += 4) {
    const [r, g, b, a] = corDoValor(valorDoPixel(dados[i], dados[i + 1], dados[i + 2], dados[i + 3]))
    dados[i] = r
    dados[i + 1] = g
    dados[i + 2] = b
    dados[i + 3] = a
  }
}
