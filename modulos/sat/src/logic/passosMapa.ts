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

/** O laço do ao vivo mostra as últimas 3 h: 18 passos de 10 min. */
export const PASSOS_AO_VIVO = 18
/** No passo mais novo o laço segura antes de recomeçar. */
export const PAUSA_NO_ULTIMO_MS = 3000

/** Índice do primeiro passo da janela do ao vivo (dia com menos de 18 passos: o dia todo). */
export function inicioDaJanelaAoVivo(total: number): number {
  return Math.max(0, total - PASSOS_AO_VIVO)
}

/**
 * Próximo passo do laço do ao vivo, a partir de `atual`: um a mais dentro da janela; depois do
 * último, volta ao início DELA. `segurar` diz que `atual` é o último — fica nele
 * `PAUSA_NO_ULTIMO_MS` antes de ir. Índice antes da janela (ela deslizou) segue do início dela.
 */
export function proximoPassoAoVivo(total: number, atual: number): { indice: number; segurar: boolean } {
  const inicio = inicioDaJanelaAoVivo(total)
  if (atual >= total - 1) return { indice: inicio, segurar: true }
  if (atual < inicio) return { indice: inicio, segurar: false }
  return { indice: atual + 1, segurar: false }
}

/** Um passo por segundo na velocidade 1×: dá tempo de a imagem chegar e segura o ritmo dos pedidos. */
export const INTERVALO_PLAY_MS = 1000
/** Passado isto sem a imagem do próximo passo chegar, o play avança assim mesmo. */
export const ESPERA_MAXIMA_IMAGEM_MS = 3000

export const VELOCIDADES = [1, 2, 4, 8] as const
export type Velocidade = (typeof VELOCIDADES)[number]

/** A velocidade seguinte do botão; depois da última (ou com valor desconhecido) volta a 1×. */
export function proximaVelocidade(atual: Velocidade): Velocidade {
  const i = VELOCIDADES.indexOf(atual)
  return i < 0 ? VELOCIDADES[0] : VELOCIDADES[(i + 1) % VELOCIDADES.length]
}

/** Quanto o play espera num passo: a base dividida pela velocidade. */
export function intervaloDoPlay(velocidade: Velocidade): number {
  return INTERVALO_PLAY_MS / velocidade
}

/** Próximo passo do play num dia normal (hoje à mão ou dia passado): um a mais; depois do último, o primeiro. */
export function proximoPassoDoDia(total: number, atual: number): number {
  return atual >= total - 1 ? 0 : atual + 1
}
