import type { Janela } from '../tipos'

export interface ContatoWpp {
  id: string
  nome: string
  /** Só dígitos, com 55 na frente. */
  telefone: string
  todasFazendas: boolean
  /** Ids de `fazendas` do COA WEB (bigint). */
  fazendas: number[]
  alertaJanela: boolean
  ativo: boolean
  confirmadoEm: string | null
  confirmadoPor: 'mensagem' | 'manual' | null
  jid: string | null
  /** Última alteração do contato (ISO); um ATIVAR mais velho que isto não desfaz o que foi feito depois. */
  atualizadoEm: string | null
}

export interface FazendaServidor {
  /** `mapas_fazendas.id` */
  id: string
  /** `mapas_fazendas.coa_fazenda_id` — o que liga ao contato. */
  coaId: number | null
  nome: string
  /** Quadrado de 0,5° da consulta; `null` = sem talhões. */
  celulaId: string | null
  lat: number | null
  lon: number | null
}

export type TipoEvento = 'resumo-07' | 'lembrete-12' | 'antes'

/** Janelas de hoje por quadrado, e quando foram calculadas. */
export interface JanelasCalculadas {
  calculadoEm: number
  porCelula: Record<string, Janela[]>
}

export type SituacaoEnvio = 'enviando' | 'enviado' | 'falhou' | 'pulado'
