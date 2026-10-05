import type { Janela, PontoIono } from '../tipos'
import { DIA_MS, FATIAS_DIA, MINUTOS_DIA, inicioDoDiaLocal, minutoDoDia } from './tempo'

export interface PontoLinha {
  minuto: number
  cintilacao: number | null
  indice: number | null
  previsto: boolean
}

/** As 144 fatias de hoje (local) com o que a série tem para cada uma. */
export function linhaDoDia(serie: PontoIono[], agora: number): PontoLinha[] {
  const inicio = inicioDoDiaLocal(agora)
  const linha: PontoLinha[] = Array.from({ length: FATIAS_DIA }, (_, f) => ({
    minuto: f * 10, cintilacao: null, indice: null, previsto: false,
  }))
  for (const p of serie) {
    if (p.instante < inicio || p.instante >= inicio + DIA_MS) continue
    const f = Math.floor(minutoDoDia(p.instante) / 10)
    linha[f] = { minuto: f * 10, cintilacao: p.previsto ? null : p.cintilacao, indice: p.indice, previsto: p.previsto }
  }
  return linha
}

/** Faixas do gráfico: a janela que vira a meia-noite vira duas (fim da noite e começo do dia). */
export function faixasDasJanelas(janelas: Janela[]): { x1: number; x2: number }[] {
  return janelas.flatMap((j) =>
    j.fim > MINUTOS_DIA
      ? [{ x1: j.inicio, x2: MINUTOS_DIA }, { x1: 0, x2: j.fim - MINUTOS_DIA }]
      : [{ x1: j.inicio, x2: j.fim }],
  )
}
