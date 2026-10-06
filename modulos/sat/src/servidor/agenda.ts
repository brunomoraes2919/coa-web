/**
 * Relógio do serviço: que evento está na hora. Tudo no fuso do processo (a VM roda com
 * TZ=America/Cuiaba), como a tela usa o fuso do navegador.
 */
import { ANTECEDENCIA_JANELA_MIN } from '../logic/alertas'
import { chaveData, DIA_MS, inicioDoDiaLocal, minutoDoDia } from '../logic/tempo'
import type { Janela } from '../tipos'
import type { TipoEvento } from './tipos'

export const MINUTO_RESUMO = 7 * 60
export const MINUTO_LEMBRETE = 12 * 60
/** 00:05, 07:00 e 12:00: três consultas por quadrado por dia à Trimble. */
export const MINUTOS_DE_CALCULO = [5, 7 * 60, 12 * 60]
/** VM desligada na hora: o evento ainda sai até isto depois; passado, é pulado. */
export const TOLERANCIA_ATRASO_MIN = 60

export function chaveEvento(agora: number, tipo: TipoEvento): string {
  return `${chaveData(agora)}:${tipo}`
}

export function eventosFixosNaHora(agora: number): ('resumo-07' | 'lembrete-12')[] {
  const m = minutoDoDia(agora)
  const naHora = (inicio: number) => m >= inicio && m <= inicio + TOLERANCIA_ATRASO_MIN
  const eventos: ('resumo-07' | 'lembrete-12')[] = []
  if (naHora(MINUTO_RESUMO)) eventos.push('resumo-07')
  if (naHora(MINUTO_LEMBRETE)) eventos.push('lembrete-12')
  return eventos
}

/** Já passou de algum horário de cálculo desde o último? (`null` = nunca calculou.) */
export function precisaCalcular(agora: number, calculadoEm: number | null): boolean {
  if (calculadoEm == null) return true
  const dia = inicioDoDiaLocal(agora)
  // Os horários de hoje e o último de ontem: cobre a virada do dia.
  const marcos = [dia - DIA_MS + MINUTOS_DE_CALCULO[MINUTOS_DE_CALCULO.length - 1] * 60_000,
    ...MINUTOS_DE_CALCULO.map((m) => dia + m * 60_000)]
  return marcos.some((marco) => marco <= agora && marco > calculadoEm)
}

/** A janela que começa primeiro dentro dos próximos 30 min (ou agora); `null` se nenhuma. */
export function janelaDoAntes(janelas: Janela[], agora: number): Janela | null {
  const m = minutoDoDia(agora)
  const perto = janelas.filter((j) => j.inicio - m >= 0 && j.inicio - m <= ANTECEDENCIA_JANELA_MIN)
  return perto.length ? perto.reduce((a, b) => (b.inicio < a.inicio ? b : a)) : null
}
