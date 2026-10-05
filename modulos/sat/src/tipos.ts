/**
 * Tipos do Locks SAT — cintilação ionosférica sobre as fazendas do cliente.
 *
 * Instantes são sempre `number` (ms desde a época, UTC) e nunca `Date`: tudo
 * aqui passa pelo `localStorage` (estado entre abas, histórico, alertas), e
 * `Date` não sobrevive ao `JSON.stringify`.
 */

/** Um passo de 10 min da série da Trimble, já convertido. */
export interface PontoIono {
  instante: number
  /** Índice ionosférico da Trimble, inteiro 0–10 (medido ou previsto). */
  indice: number
  /** Conteúdo total de elétrons, em TECU. */
  tec: number
  /** Cintilação 0–100. `null` nos passos previstos: a Trimble não prevê cintilação. */
  cintilacao: number | null
  previsto: boolean
}

export type NivelCintilacao = 'minima' | 'media' | 'forte' | 'sem-dado'
export type Severidade = 'aviso' | 'critico'
export type TipoAlerta = 'cintilacao' | 'previsao' | 'janela'

/** Quadrado de 0,5° — a unidade de consulta à Trimble. */
export interface Celula {
  id: string
  lat: number
  lon: number
}

export interface FazendaGnss {
  id: string
  nome: string
  /** Posição usada no mapa (ponto do talhão ou cadastro). */
  lat: number | null
  lon: number | null
  /** `null` = fazenda sem localização nenhuma: não é vigiada. */
  celulaId: string | null
}

/** Janela de risco em minutos do dia local. `fim` é exclusivo e passa de
 *  1440 quando a janela vira a meia-noite (21:10–00:30 → 1270–1470). */
export interface Janela {
  inicio: number
  fim: number
  /** Maior número de dias (de 7) com cintilação numa fatia da janela. */
  dias: number
}

export interface AlertaGnss {
  id: string
  instante: number
  tipo: TipoAlerta
  severidade: Severidade
  /** Nomes das fazendas atingidas, em ordem alfabética. */
  fazendas: string[]
  texto: string
}
