/**
 * Janela de risco: a única forma de ANTECIPAR cintilação, já que a Trimble só
 * a mede (nos passos previstos ela vem `null`). Olha os últimos 7 dias de
 * cada quadrado e marca os horários em que ela costuma aparecer.
 */
import type { Janela, PontoIono } from '../tipos'
import { LIMITE_MEDIA } from './niveis'
import { FATIAS_DIA, MINUTOS_DIA, chaveData, fatiaDoDia, rotuloHora } from './tempo'

export const DIAS_HISTORICO = 7
export const MINIMO_DIAS = 3

/** Em quantos dias distintos cada fatia de 10 min teve cintilação ≥ média. */
export function contarDiasPorFatia(historico: PontoIono[]): number[] {
  const dias = Array.from({ length: FATIAS_DIA }, () => new Set<string>())
  for (const p of historico) {
    if (p.previsto || p.cintilacao == null || p.cintilacao < LIMITE_MEDIA) continue
    dias[fatiaDoDia(p.instante)].add(chaveData(p.instante))
  }
  return dias.map((s) => s.size)
}

/** Janelas separadas por até 30 min são a mesma noite de risco. Com dado real
 *  (01/10/2026) a regra "3 de 7 dias" picava a noite em pedaços de 10–20 min,
 *  e cada pedaço virava um alerta. */
export const TOLERANCIA_JUNCAO_MIN = 30

/** Fatias com risco em ≥ `minimoDias` dias, juntas em janelas — inclusive
 *  através da meia-noite (a noite é justamente quando a cintilação acontece).
 *  Buracos de até `toleranciaMin` entre duas janelas não as separam. */
export function janelasDeRisco(
  contagem: number[],
  minimoDias = MINIMO_DIAS,
  toleranciaMin = TOLERANCIA_JUNCAO_MIN,
): Janela[] {
  const contiguas: Janela[] = []
  let atual: Janela | null = null
  for (let f = 0; f < contagem.length; f++) {
    if (contagem[f] >= minimoDias) {
      if (atual) {
        atual.fim = (f + 1) * 10
        atual.dias = Math.max(atual.dias, contagem[f])
      } else {
        atual = { inicio: f * 10, fim: (f + 1) * 10, dias: contagem[f] }
      }
    } else if (atual) {
      contiguas.push(atual)
      atual = null
    }
  }
  if (atual) contiguas.push(atual)

  // Vizinhas com buraco pequeno: o pico de dias é o da janela junta.
  const janelas: Janela[] = []
  for (const proxima of contiguas) {
    const anterior = janelas[janelas.length - 1]
    if (anterior && proxima.inicio - anterior.fim <= toleranciaMin) {
      anterior.fim = proxima.fim
      anterior.dias = Math.max(anterior.dias, proxima.dias)
    } else {
      janelas.push(proxima)
    }
  }

  // A que termina perto da meia-noite e a que começa depois dela são a mesma
  // noite — mesma tolerância, contada através da virada do dia.
  if (janelas.length > 1) {
    const primeira = janelas[0]
    const ultima = janelas[janelas.length - 1]
    if (primeira.inicio + MINUTOS_DIA - ultima.fim <= toleranciaMin) {
      ultima.fim = MINUTOS_DIA + primeira.fim
      ultima.dias = Math.max(ultima.dias, primeira.dias)
      janelas.shift()
    }
  }
  return janelas
}

export function textoJanela(j: Janela): string {
  return `${rotuloHora(j.inicio)}–${rotuloHora(j.fim)} (${j.dias} de ${DIAS_HISTORICO} dias)`
}

/** A janela ainda tem algum pedaço por vir hoje (a partir de `minutoAgora`). */
export function janelaAindaPorVir(j: Janela, minutoAgora: number): boolean {
  return j.fim > minutoAgora
}
