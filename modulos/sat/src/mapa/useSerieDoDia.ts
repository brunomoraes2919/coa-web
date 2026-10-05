/**
 * Série de um dia PASSADO para o mapa, sob demanda: um pedido por quadrado, em série, com
 * 2 s entre o começo de um pedido e o do seguinte (a mesma regra do vigia) — também de um dia
 * para o outro, para segurar a seta do campo de data não virar rajada. Fica em memória enquanto
 * a página está aberta. Hoje não passa por aqui: a série de hoje é a do vigia.
 */
import { useEffect, useState } from 'react'
import { buscarSerie } from '../api/gnssApi'
import { chaveData, inicioDoDiaLocal } from '../logic/tempo'
import type { Celula, PontoIono } from '../tipos'
import { PAUSA_ENTRE_CHAMADAS_MS } from '../vigia/ciclo'

export interface DependenciasSerieDoDia {
  buscarSerie: (ponto: { lat: number; lon: number }, inicio: number, horas: number) => Promise<PontoIono[]>
  esperar: (ms: number) => Promise<void>
  agora: () => number
}

export interface SerieDoDia {
  /** Por id de quadrado; quadrado ainda não carregado (ou sem dado) não aparece. */
  series: Record<string, PontoIono[]>
  carregando: boolean
  /** Um pedido falhou; os quadrados que faltavam não foram pedidos. */
  erro: boolean
}

const PADRAO: DependenciasSerieDoDia = {
  buscarSerie: (ponto, inicio, horas) => buscarSerie(ponto, inicio, horas),
  esperar: (ms) => new Promise((pronto) => window.setTimeout(pronto, ms)),
  agora: () => Date.now(),
}

const VAZIO: SerieDoDia = { series: {}, carregando: false, erro: false }
const cache = new Map<string, PontoIono[]>()
/** Pedidos no ar, pela mesma chave do cache: quem precisa do mesmo quadrado e dia espera este, não pede outro. */
const emCurso = new Map<string, Promise<PontoIono[]>>()
/** Quando saiu o último pedido de qualquer laço. */
let ultimoPedido = -Infinity
const chave = (celulaId: string, dia: number) => `${celulaId}|${chaveData(dia)}`

/** Só para testes. */
export function limparCacheSerieDoDia(): void {
  cache.clear()
  emCurso.clear()
  ultimoPedido = -Infinity
}

/** O pedido de um quadrado num dia. O resultado vai para o cache mesmo que o laço que pediu já tenha saído. */
function pedir(deps: DependenciasSerieDoDia, k: string, c: Celula, dia: number): Promise<PontoIono[]> {
  ultimoPedido = deps.agora()
  const pedido = (async () => {
    const serie = await deps.buscarSerie({ lat: c.lat, lon: c.lon }, inicioDoDiaLocal(dia), 24)
    // Vazio não entra no cache: pode ser falha passageira, e a próxima visita confirma.
    if (serie.length) cache.set(k, serie)
    return serie
  })()
  emCurso.set(k, pedido)
  const sair = () => {
    if (emCurso.get(k) === pedido) emCurso.delete(k)
  }
  pedido.then(sair, sair)
  return pedido
}

export function useSerieDoDia(dia: number | null, celulas: Celula[], deps: DependenciasSerieDoDia = PADRAO): SerieDoDia {
  /** Consulta (dia + quadrados) que terminou ou falhou; o estado só muda dentro do laço assíncrono. */
  const [fim, setFim] = useState<{ consulta: string; erro: boolean } | null>(null)
  const [, setVersao] = useState(0)
  const consulta = dia == null ? null : `${chaveData(dia)}#${celulas.map((c) => c.id).join(',')}`

  useEffect(() => {
    if (dia == null || consulta == null) return
    const faltam = celulas.filter((c) => !cache.has(chave(c.id, dia)))
    if (!faltam.length) return
    let vivo = true
    void (async () => {
      for (const c of faltam) {
        const k = chave(c.id, dia)
        try {
          let pedido = emCurso.get(k)
          if (!pedido) {
            // Antes de TODO pedido novo, inclusive o primeiro do laço: outro dia pode ter acabado de pedir.
            const falta = Math.min(PAUSA_ENTRE_CHAMADAS_MS, PAUSA_ENTRE_CHAMADAS_MS - (deps.agora() - ultimoPedido))
            if (falta > 0) await deps.esperar(falta)
            if (!vivo) return
            pedido = emCurso.get(k) ?? pedir(deps, k, c, dia)
          }
          await pedido
        } catch {
          if (vivo) setFim({ consulta, erro: true })
          return
        }
        if (!vivo) return
        setVersao((v) => v + 1)
      }
      if (vivo) setFim({ consulta, erro: false })
    })()
    return () => {
      vivo = false
      // Sair da consulta esquece como ela terminou: voltar a ela refaz o que faltou, carregando.
      setFim(null)
    }
    // `consulta` resume `dia` e os ids dos quadrados: é a única dependência de propósito.
  }, [consulta])

  if (dia == null) return VAZIO
  const series: Record<string, PontoIono[]> = {}
  for (const c of celulas) {
    const s = cache.get(chave(c.id, dia))
    if (s) series[c.id] = s
  }
  const terminou = fim?.consulta === consulta
  return {
    series,
    carregando: !terminou && Object.keys(series).length < celulas.length,
    erro: terminou && fim?.erro === true,
  }
}
