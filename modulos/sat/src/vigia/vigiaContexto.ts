/**
 * Só o contexto e o hook, sem componente — separado do provider para não
 * quebrar o Fast Refresh.
 *
 * Sem provider acima (nos testes, por exemplo) o hook devolve o valor
 * inativo em vez de lançar.
 */
import { createContext, useContext } from 'react'
import type { AlertaGnss } from '../tipos'
import { ESTADO_INICIAL, type EstadoVigia } from './estado'

export interface ValorVigia {
  /** Há usuário logado e o vigia está rodando nesta aba. */
  ativo: boolean
  estado: EstadoVigia
  /** Últimos 7 dias, mais novo primeiro. */
  alertas: AlertaGnss[]
  /** Esta aba é quem consulta a Trimble. */
  lider: boolean
  /** Força um ciclo agora. Só a aba líder consulta; nas outras não faz nada. */
  atualizar: () => void
}

export const VALOR_INATIVO: ValorVigia = {
  ativo: false,
  estado: ESTADO_INICIAL,
  alertas: [],
  lider: false,
  atualizar: () => {},
}

export const VigiaContexto = createContext<ValorVigia>(VALOR_INATIVO)

export function useVigiaGnss(): ValorVigia {
  return useContext(VigiaContexto)
}
