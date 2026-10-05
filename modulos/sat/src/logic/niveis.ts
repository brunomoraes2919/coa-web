/**
 * Como ler os números da Trimble. As faixas são as DELA: o tooltip do
 * gráfico do GNSS Planning classifica a cintilação por `parseInt(v / 33)` e
 * pinta o índice em zonas verde (até 4), amarela (até 7) e vermelha.
 */
import type { NivelCintilacao, PontoIono, Severidade } from '../tipos'
import { HORA_MS } from './tempo'

export const LIMITE_MEDIA = 33
export const LIMITE_FORTE = 66
export const INDICE_AVISO = 5
export const INDICE_CRITICO = 8
/** Medida mais velha que isto não diz nada sobre agora. */
export const IDADE_MAXIMA_MEDIDA_MS = 30 * 60_000
export const HORIZONTE_PREVISAO_MS = 3 * HORA_MS

export const ROTULO_NIVEL: Record<NivelCintilacao, string> = {
  minima: 'Mínima',
  media: 'Média',
  forte: 'Forte',
  'sem-dado': 'Sem dado',
}

export const COR_NIVEL: Record<NivelCintilacao, string> = {
  minima: '#2f7d5b',
  media: '#c98a06',
  forte: '#a8321f',
  'sem-dado': '#8b908a',
}

export const COR_INDICE = { verde: '#5fae4e', amarelo: '#d9b92b', vermelho: '#d9534f' } as const

export function nivelCintilacao(valor: number | null | undefined): NivelCintilacao {
  if (valor == null || !Number.isFinite(valor)) return 'sem-dado'
  if (valor >= LIMITE_FORTE) return 'forte'
  if (valor >= LIMITE_MEDIA) return 'media'
  return 'minima'
}

export function severidadeDoNivel(nivel: NivelCintilacao): Severidade | null {
  if (nivel === 'forte') return 'critico'
  if (nivel === 'media') return 'aviso'
  return null
}

export function severidadeDoIndice(indice: number): Severidade | null {
  if (indice >= INDICE_CRITICO) return 'critico'
  if (indice >= INDICE_AVISO) return 'aviso'
  return null
}

/** Última cintilação MEDIDA até `agora`, se tiver no máximo 30 min. */
export function ultimaMedida(serie: PontoIono[], agora: number): PontoIono | null {
  for (let i = serie.length - 1; i >= 0; i--) {
    const p = serie[i]
    if (p.previsto || p.cintilacao == null || p.instante > agora) continue
    return agora - p.instante <= IDADE_MAXIMA_MEDIDA_MS ? p : null
  }
  return null
}

/** Maior índice PREVISTO nas próximas 3 h (o primeiro, em caso de empate). */
export function picoPrevisto(serie: PontoIono[], agora: number): PontoIono | null {
  let pico: PontoIono | null = null
  for (const p of serie) {
    if (!p.previsto || p.instante <= agora || p.instante > agora + HORIZONTE_PREVISAO_MS) continue
    if (!pico || p.indice > pico.indice) pico = p
  }
  return pico
}

/** Mesma escala dos PNGs da Trimble: matiz 240° (azul, mínimo) → 0° (vermelho, máximo). */
export function corEscala(fracao: number): string {
  const f = Math.min(1, Math.max(0, fracao))
  return `hsl(${Math.round(240 * (1 - f))}, 100%, 50%)`
}

export function corDoIndice(indice: number): string {
  const s = severidadeDoIndice(indice)
  if (s === 'critico') return COR_INDICE.vermelho
  if (s === 'aviso') return COR_INDICE.amarelo
  return COR_INDICE.verde
}
