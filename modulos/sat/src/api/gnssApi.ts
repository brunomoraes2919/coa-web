/**
 * Única ponte com a Trimble GNSS Planning (gnssplanning.com).
 *
 * O serviço não aceita pedido direto do navegador, então tudo passa pela função
 * `/api/gnss` do COA WEB (api/gnss.js), que só atende quem está logado. Trocar a
 * fonte é mexer só aqui e lá.
 *
 *  - `ionoindex` devolve lon/lat em RADIANOS e `timeOfEstimation` em UTC;
 *  - `scintiValue` vem `null` nos passos previstos (não há previsão de cintilação).
 */
import type { PontoIono } from '../tipos'

const BASE = '/api/gnss?p='

type FonteDoToken = () => Promise<string | null>
let fonteDoToken: FonteDoToken = async () => null

/** Quem sabe o token da sessão do COA WEB (o Supabase) se registra aqui na largada. */
export function definirFonteDoToken(fonte: FonteDoToken): void {
  fonteDoToken = fonte
}

/** Cabeçalho que a ponte exige; vazio sem sessão (a ponte responde 401). */
export async function cabecalhosDaPonte(): Promise<Record<string, string>> {
  const token = await fonteDoToken()
  return token ? { 'X-Coa-Token': token } : {}
}

export type TipoErroGnss = 'bloqueio' | 'indisponivel' | 'rede'

export class ErroGnss extends Error {
  tipo: TipoErroGnss
  status: number
  constructor(tipo: TipoErroGnss, status: number, mensagem: string) {
    super(mensagem)
    this.name = 'ErroGnss'
    this.tipo = tipo
    this.status = status
  }
}

interface ItemTrimble {
  value: number
  timeOfEstimation: string
  tecValue: number | null
  scintiValue: number | null
  predicted: boolean
}

/** 'AAAA-MM-DDTHH:MM:SS' em UTC, sem o 'Z' — o formato que a Trimble aceita. */
export function isoTrimble(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19)
}

function numeroOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function converterItem(item: ItemTrimble): PontoIono {
  return {
    instante: Date.parse(item.timeOfEstimation),
    indice: numeroOuNull(item.value) ?? 0,
    tec: numeroOuNull(item.tecValue) ?? 0,
    cintilacao: item.predicted ? null : numeroOuNull(item.scintiValue),
    previsto: Boolean(item.predicted),
  }
}

/** Sem prazo, um pedido pendurado (o fetch não desiste sozinho) seguraria o
 *  ciclo — e com ele o vigia inteiro — sem erro nenhum na tela. */
export const TEMPO_LIMITE_MS = 30_000

async function buscarJson(caminho: string): Promise<unknown> {
  const controle = new AbortController()
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS)
  const estourou = () => new ErroGnss('rede', 0, 'A Trimble não respondeu em 30 s.')
  try {
    const cabecalhos = await cabecalhosDaPonte()
    let resposta: Response
    try {
      resposta = await fetch(`${BASE}${encodeURIComponent(caminho)}`, { signal: controle.signal, headers: cabecalhos })
    } catch {
      if (controle.signal.aborted) throw estourou()
      throw new ErroGnss('rede', 0, 'Sem conexão com a Trimble GNSS Planning.')
    }
    if (resposta.status === 403 || resposta.status === 429) {
      throw new ErroGnss('bloqueio', resposta.status, 'A Trimble recusou a consulta por excesso de pedidos.')
    }
    if (resposta.status === 401) {
      throw new ErroGnss('rede', 401, 'Sessão do COA WEB vencida.')
    }
    if (!resposta.ok) {
      throw new ErroGnss('indisponivel', resposta.status, `A Trimble respondeu ${resposta.status}.`)
    }
    try {
      return await resposta.json()
    } catch {
      // O prazo vale também para o corpo: cabeçalho a tempo e corpo parado é a mesma espera.
      if (controle.signal.aborted) throw estourou()
      throw new ErroGnss('indisponivel', resposta.status, 'Resposta da Trimble fora do formato esperado.')
    }
  } finally {
    clearTimeout(relogio)
  }
}

/** Série de `horas` horas a partir de `inicio`, no ponto (lat, lon) em graus. */
export async function buscarSerie(
  ponto: { lat: number; lon: number },
  inicio: number,
  horas: number,
  passoSeg = 600,
): Promise<PontoIono[]> {
  const dados = await buscarJson(`ionoindex/${ponto.lon}/${ponto.lat}/${isoTrimble(inicio)}/${horas}/${passoSeg}`)
  if (!Array.isArray(dados)) {
    throw new ErroGnss('indisponivel', 200, 'Resposta da Trimble fora do formato esperado.')
  }
  return (dados as ItemTrimble[]).map(converterItem).filter((p) => Number.isFinite(p.instante))
}

/** PNG 256×256 do mundo — um tile Web Mercator de zoom 0 — num passo de 10 min. */
export function urlOverlay(camada: 'sci' | 'tec', instante: number): string {
  return `${BASE}${encodeURIComponent(`overlay/${camada}/${isoTrimble(instante)}`)}`
}
