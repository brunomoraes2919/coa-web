/**
 * Relógio do módulo. A Trimble fala em UTC com passos de 10 min; a tela fala
 * no fuso do navegador (como o resto do COA WEB). Toda conversão passa
 * por aqui.
 */

export const PASSO_MS = 10 * 60_000
export const MINUTOS_DIA = 1440
export const FATIAS_DIA = 144
export const HORA_MS = 60 * 60_000
export const DIA_MS = 24 * HORA_MS

/** 00:00 local do dia de `ms`. */
export function inicioDoDiaLocal(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Passo de 10 min imediatamente anterior (ou igual) a `ms`. Os fusos do
 *  Brasil são horas cheias, então o passo UTC cai no mesmo minuto local. */
export function passoAnterior(ms: number): number {
  return Math.floor(ms / PASSO_MS) * PASSO_MS
}

/** Minutos desde a 00:00 local. */
export function minutoDoDia(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Fatia de 10 min do dia local, 0–143. */
export function fatiaDoDia(ms: number): number {
  return Math.floor(minutoDoDia(ms) / 10)
}

/** 'AAAA-MM-DD' do dia local — chave de cache e de "já avisado hoje". */
export function chaveData(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 'HH:MM' de um minuto do dia; aceita valores além de 1440 (dia seguinte). */
export function rotuloHora(minuto: number): string {
  const m = ((Math.round(minuto) % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** 'HH:MM' local de um instante. */
export function horaDe(ms: number): string {
  return rotuloHora(minutoDoDia(ms))
}

/** 'DD/MM' local de um instante. */
export function dataCurta(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 00:00 local do dia 'AAAA-MM-DD' (o formato de `chaveData` e do campo de data); `null` se não for uma data. */
export function diaDaChave(chave: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave)
  if (!m) return null
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return chaveData(ms) === chave ? ms : null
}
