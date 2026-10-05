/**
 * O localStorage do vigia. É também o canal entre abas: a líder grava, as
 * outras ouvem o evento `storage` destas chaves.
 */
import { DIA_MS } from '../logic/tempo'
import type { AlertaGnss } from '../tipos'
import { MEMORIA_INICIAL, type MemoriaAlertas } from './avaliar'
import { ESTADO_INICIAL, type EstadoVigia } from './estado'

export const CHAVE_ESTADO = 'locks_sat_estado_v1'
export const CHAVE_ALERTAS = 'locks_sat_alertas_v1'
export const CHAVE_MEMORIA = 'locks_sat_memoria_v1'
export const RETENCAO_ALERTAS_MS = 7 * DIA_MS
const MAXIMO_ALERTAS = 500

export function ler<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave)
    return bruto ? (JSON.parse(bruto) as T) : padrao
  } catch {
    return padrao
  }
}

export function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    /* armazenamento cheio/indisponível: segue só em memória */
  }
}

/* Leitores com validação. O guardado pode ser "null", de outra versão ou
   mexido à mão — e o vigia roda o tempo todo, no iframe do COA WEB: um valor
   fora do formato derrubaria o módulo (tela branca a cada abertura) ou calaria os
   alertas para sempre. Fora do formato, vale o inicial. */

/** Objeto de verdade — `null` e lista também são `typeof 'object'`. */
function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function ehEstado(v: unknown): v is EstadoVigia {
  return (
    objeto(v) &&
    Array.isArray(v.fazendas) &&
    objeto(v.celulas) &&
    (v.ultimoSucesso === null || typeof v.ultimoSucesso === 'number') &&
    typeof v.falhasSeguidas === 'number' &&
    (v.erro === null || typeof v.erro === 'string')
  )
}

/** `fazendas` também: a página Alertas e o título do toast a percorrem. */
function ehAlerta(v: unknown): v is AlertaGnss {
  return (
    objeto(v) &&
    typeof v.id === 'string' &&
    typeof v.instante === 'number' &&
    typeof v.texto === 'string' &&
    Array.isArray(v.fazendas)
  )
}

function ehMemoria(v: unknown): v is MemoriaAlertas {
  return objeto(v) && objeto(v.episodios) && Array.isArray(v.janelasAvisadas)
}

export function lerEstado(): EstadoVigia {
  const e = ler<unknown>(CHAVE_ESTADO, null)
  // Cópia nova: quem recebe pode mexer sem sujar o ESTADO_INICIAL compartilhado.
  return ehEstado(e) ? e : { ...ESTADO_INICIAL, fazendas: [], celulas: {} }
}

export function lerAlertas(): AlertaGnss[] {
  const lista = ler<unknown>(CHAVE_ALERTAS, null)
  return Array.isArray(lista) ? lista.filter(ehAlerta) : []
}

export function lerMemoria(): MemoriaAlertas {
  const m = ler<unknown>(CHAVE_MEMORIA, null)
  return ehMemoria(m) ? m : { ...MEMORIA_INICIAL, episodios: {}, janelasAvisadas: [] }
}

/** 7 dias, mais novo primeiro, com teto. */
export function podarAlertas(alertas: AlertaGnss[], agora: number): AlertaGnss[] {
  return alertas
    .filter((a) => agora - a.instante <= RETENCAO_ALERTAS_MS)
    .sort((a, b) => b.instante - a.instante)
    .slice(0, MAXIMO_ALERTAS)
}
