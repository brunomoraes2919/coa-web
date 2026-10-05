/**
 * Episódio = um período contínuo de problema num quadrado, para um tipo de
 * alerta. É o que impede o vigia de apitar a cada 10 min pela mesma
 * cintilação: dispara ao abrir, dispara de novo só se SUBIR de aviso para
 * crítico, e só termina depois de 30 min seguidos abaixo do limite.
 */
import type { Severidade } from '../tipos'

export const FIM_EPISODIO_MS = 30 * 60_000

export interface Episodio {
  severidade: Severidade
  desde: number
  /** Desde quando está abaixo do limite; `null` enquanto segue acima. */
  abaixoDesde: number | null
}

export type MapaEpisodios = Record<string, Episodio>

/** Leitura de um ciclo. `null` = abaixo do limite. Quadrado SEM dado não
 *  gera leitura: falta de dado não encerra episódio nem abre um novo. */
export interface Leitura {
  chave: string
  severidade: Severidade | null
}

export interface Disparo {
  chave: string
  severidade: Severidade
}

const PESO: Record<Severidade, number> = { aviso: 1, critico: 2 }

export function avancarEpisodios(
  anterior: MapaEpisodios,
  leituras: Leitura[],
  agora: number,
): { episodios: MapaEpisodios; disparos: Disparo[] } {
  const episodios: MapaEpisodios = { ...anterior }
  const disparos: Disparo[] = []
  for (const { chave, severidade } of leituras) {
    const atual = episodios[chave]
    if (severidade) {
      if (!atual) {
        episodios[chave] = { severidade, desde: agora, abaixoDesde: null }
        disparos.push({ chave, severidade })
      } else if (PESO[severidade] > PESO[atual.severidade]) {
        episodios[chave] = { ...atual, severidade, abaixoDesde: null }
        disparos.push({ chave, severidade })
      } else if (atual.abaixoDesde !== null) {
        episodios[chave] = { ...atual, abaixoDesde: null }
      }
    } else if (atual) {
      if (atual.abaixoDesde === null) {
        episodios[chave] = { ...atual, abaixoDesde: agora }
      } else if (agora - atual.abaixoDesde >= FIM_EPISODIO_MS) {
        delete episodios[chave]
      }
    }
  }
  return { episodios, disparos }
}
