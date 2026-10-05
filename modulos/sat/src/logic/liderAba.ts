/**
 * Só UMA aba consulta a Trimble — com três abas abertas seriam três vezes as
 * chamadas, e ela bloqueia rajada. As outras recebem o resultado pelo
 * `localStorage` (evento `storage`).
 *
 * Arrendamento simples em vez de Web Locks: `navigator.locks` exige contexto
 * seguro (https ou localhost) e some em contexto inseguro; o `localStorage`
 * funciona em qualquer um, inclusive ao abrir o módulo por http comum em teste.
 */
export const CHAVE_LIDER = 'locks_sat_lider_v1'
export const DURACAO_ARRENDAMENTO_MS = 90_000
export const RENOVACAO_MS = 30_000

export interface Arrendamento {
  aba: string
  expira: number
}

export function lerArrendamento(armazenamento: Storage): Arrendamento | null {
  try {
    const bruto = armazenamento.getItem(CHAVE_LIDER)
    if (!bruto) return null
    const a = JSON.parse(bruto) as Partial<Arrendamento>
    return typeof a.aba === 'string' && typeof a.expira === 'number' ? { aba: a.aba, expira: a.expira } : null
  } catch {
    return null
  }
}

/** Assume (ou renova) a liderança se ninguém a tiver ou se o dono sumiu. */
export function tentarLiderar(armazenamento: Storage, aba: string, agora: number): boolean {
  const atual = lerArrendamento(armazenamento)
  if (atual && atual.aba !== aba && atual.expira > agora) return false
  try {
    armazenamento.setItem(CHAVE_LIDER, JSON.stringify({ aba, expira: agora + DURACAO_ARRENDAMENTO_MS }))
  } catch {
    return true // sem armazenamento não há outras abas para coordenar
  }
  // Duas abas podem ter escrito juntas: vale a que ficou gravada.
  return lerArrendamento(armazenamento)?.aba === aba
}

export function soltarLideranca(armazenamento: Storage, aba: string): void {
  try {
    if (lerArrendamento(armazenamento)?.aba === aba) armazenamento.removeItem(CHAVE_LIDER)
  } catch {
    /* nada a soltar */
  }
}

/** Id da aba. `crypto.randomUUID` só existe em contexto seguro; este id funciona em qualquer um. */
export function novaIdAba(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
