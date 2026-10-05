/**
 * Um ciclo do vigia: para cada quadrado, a série de hoje (sempre) e as
 * janelas de risco (uma vez por dia; o resto do dia sai do cache).
 *
 * Em série, com pausa de 2 s entre chamadas: a Trimble bloqueia rajada (~30
 * chamadas seguidas → 403). No primeiro erro o ciclo para — o que veio até
 * ali vale, os outros quadrados ficam com o dado anterior.
 */
import { buscarSerie, ErroGnss, type TipoErroGnss } from '../api/gnssApi'
import { contarDiasPorFatia, DIAS_HISTORICO, janelasDeRisco } from '../logic/janelaRisco'
import { chaveData, DIA_MS, inicioDoDiaLocal, PASSO_MS, passoAnterior } from '../logic/tempo'
import type { Celula, Janela, PontoIono } from '../tipos'
import type { DadosCelula, EstadoVigia } from './estado'

export const PAUSA_ENTRE_CHAMADAS_MS = 2_000
/** Hoje inteiro + 3 h: a previsão das "próximas 3 h" perto da meia-noite. */
export const HORAS_SERIE_HOJE = 27
/** A Trimble publica o passo alguns minutos depois; 2 min de folga. */
export const ATRASO_APOS_PASSO_MS = 2 * 60_000
/** v2: as janelas em cache da v1 foram calculadas sem a junção de 30 min e
 *  não podem ser reaproveitadas. */
const CHAVE_HISTORICO = 'locks_sat_historico_v2'

type CacheHistorico = Record<string, { data: string; janelas: Janela[] }>

export interface DependenciasCiclo {
  buscarSerie: (ponto: { lat: number; lon: number }, inicio: number, horas: number) => Promise<PontoIono[]>
  esperar: (ms: number) => Promise<void>
  armazenamento: Storage
}

export function dependenciasPadrao(): DependenciasCiclo {
  return {
    buscarSerie: (ponto, inicio, horas) => buscarSerie(ponto, inicio, horas),
    esperar: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    armazenamento: window.localStorage,
  }
}

/** Só entradas no formato: cache estragado ("null", mexido à mão) lançaria
 *  antes do try do ciclo. Entrada descartada só custa pedir o histórico de novo. */
function lerCache(armazenamento: Storage): CacheHistorico {
  let bruto: unknown
  try {
    bruto = JSON.parse(armazenamento.getItem(CHAVE_HISTORICO) ?? '{}')
  } catch {
    return {}
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return {}
  const cache: CacheHistorico = {}
  for (const [id, item] of Object.entries(bruto)) {
    if (
      typeof item === 'object' && item !== null &&
      typeof (item as { data?: unknown }).data === 'string' &&
      Array.isArray((item as { janelas?: unknown }).janelas)
    ) {
      cache[id] = item as CacheHistorico[string]
    }
  }
  return cache
}

function gravarCache(armazenamento: Storage, cache: CacheHistorico): void {
  try {
    armazenamento.setItem(CHAVE_HISTORICO, JSON.stringify(cache))
  } catch {
    /* falha de escrita: a chamada de 168 h repetirá em cada ciclo */
  }
}

export interface ResultadoCiclo {
  dados: Record<string, DadosCelula>
  erro: TipoErroGnss | null
}

export async function executarCiclo(celulas: Celula[], agora: number, deps: DependenciasCiclo): Promise<ResultadoCiclo> {
  const hoje = inicioDoDiaLocal(agora)
  const data = chaveData(agora)
  const cache = lerCache(deps.armazenamento)
  for (const id of Object.keys(cache)) if (cache[id].data !== data) delete cache[id]

  const dados: Record<string, DadosCelula> = {}
  let chamadas = 0
  const chamar = async (c: Celula, inicio: number, horas: number) => {
    if (chamadas++ > 0) await deps.esperar(PAUSA_ENTRE_CHAMADAS_MS)
    return deps.buscarSerie({ lat: c.lat, lon: c.lon }, inicio, horas)
  }

  try {
    for (const c of celulas) {
      const serie = await chamar(c, hoje, HORAS_SERIE_HOJE)
      let janelas = cache[c.id]?.janelas
      if (!janelas) {
        const historico = await chamar(c, hoje - DIAS_HISTORICO * DIA_MS, DIAS_HISTORICO * 24)
        janelas = janelasDeRisco(contarDiasPorFatia(historico))
        // Resposta vazia é degradada (real tem ~1009 pontos); não pode valer o dia inteiro.
        // Próximo ciclo pede de novo para confirmar.
        if (historico.length > 0) {
          cache[c.id] = { data, janelas }
          gravarCache(deps.armazenamento, cache)
        }
      }
      dados[c.id] = { serie, janelas }
    }
  } catch (e) {
    return { dados, erro: e instanceof ErroGnss ? e.tipo : 'rede' }
  }
  return { dados, erro: null }
}

export function aplicarCiclo(anterior: EstadoVigia, resultado: ResultadoCiclo, agora: number): EstadoVigia {
  const celulas = { ...anterior.celulas, ...resultado.dados }
  if (resultado.erro) {
    return { ...anterior, celulas, erro: resultado.erro, falhasSeguidas: anterior.falhasSeguidas + 1 }
  }
  return { ...anterior, celulas, erro: null, falhasSeguidas: 0, ultimoSucesso: agora }
}

/** Quanto falta para o próximo ciclo: 2 min depois do próximo passo de 10 min. */
export function msAteProximoCiclo(agora: number): number {
  const alvo = passoAnterior(agora) + ATRASO_APOS_PASSO_MS
  return (alvo > agora ? alvo : alvo + PASSO_MS) - agora
}

/** Até 90 s a mais, sorteados. As consultas de todos os usuários saem pela
 *  ponte do COA WEB (um servidor só, para a Trimble) e, alinhadas no mesmo
 *  :x2:00, somariam as chamadas numa rajada só (a Trimble bloqueia ~30 seguidas). */
export function comJitter(ms: number, aleatorio: () => number = Math.random): number {
  return ms + Math.floor(aleatorio() * 90_000)
}
