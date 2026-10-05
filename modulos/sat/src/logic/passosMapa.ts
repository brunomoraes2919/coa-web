import { DIA_MS, FATIAS_DIA, inicioDoDiaLocal, PASSO_MS, passoAnterior } from './tempo'

/** A Trimble publica o passo alguns minutos depois; 10 min de folga garante imagem. */
export const FOLGA_ULTIMO_PASSO_MS = 10 * 60_000

/** Passos de 10 min de hoje (local) até o último que já tem imagem. Futuro não
 *  entra: a Trimble responde 406 para cintilação que ainda não aconteceu. */
export function passosDoDia(agora: number): number[] {
  const fim = passoAnterior(agora - FOLGA_ULTIMO_PASSO_MS)
  const passos: number[] = []
  for (let t = inicioDoDiaLocal(agora); t <= fim; t += PASSO_MS) passos.push(t)
  return passos.length ? passos : [fim]
}

/** Os 144 passos de 10 min de um dia local inteiro (00:00–23:50): dia passado já tem
 *  imagem em todos. `dia` é qualquer instante do dia. */
export function passosDoDiaPassado(dia: number): number[] {
  const inicio = inicioDoDiaLocal(dia)
  return Array.from({ length: FATIAS_DIA }, (_, i) => inicio + i * PASSO_MS)
}

/** O mapa mostra hoje e os 29 dias anteriores. */
export const DIAS_NO_MAPA = 30

/** Os dias do mapa, sempre 00:00 local: hoje, ontem e o mais antigo permitido. */
export function diasDoMapa(agora: number): { hoje: number; ontem: number; primeiro: number } {
  const hoje = inicioDoDiaLocal(agora)
  // Meio-dia do dia alvo antes de zerar a hora: imune a horário de verão.
  const diasAtras = (n: number) => inicioDoDiaLocal(hoje - n * DIA_MS + DIA_MS / 2)
  return { hoje, ontem: diasAtras(1), primeiro: diasAtras(DIAS_NO_MAPA - 1) }
}

/** `dia` se ainda é um dia passado que o mapa mostra; senão `null` (= hoje). */
export function diaDentroDoMapa(dia: number | null, agora: number): number | null {
  if (dia == null || !Number.isFinite(dia)) return null
  const { hoje, primeiro } = diasDoMapa(agora)
  return dia >= primeiro && dia < hoje ? dia : null
}
