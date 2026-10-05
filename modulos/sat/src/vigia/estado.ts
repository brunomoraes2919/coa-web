import type { TipoErroGnss } from '../api/gnssApi'
import type { FazendaGnss, Janela, PontoIono } from '../tipos'

export interface DadosCelula {
  /** Dia local de hoje (+3 h): medido até agora e previsão do resto. */
  serie: PontoIono[]
  janelas: Janela[]
}

/** O que o vigia sabe — é isto que vai para o localStorage e as outras abas leem. */
export interface EstadoVigia {
  fazendas: FazendaGnss[]
  celulas: Record<string, DadosCelula>
  /** Última vez que um ciclo inteiro deu certo. */
  ultimoSucesso: number | null
  falhasSeguidas: number
  erro: TipoErroGnss | null
}

export const ESTADO_INICIAL: EstadoVigia = {
  fazendas: [],
  celulas: {},
  ultimoSucesso: null,
  falhasSeguidas: 0,
  erro: null,
}
