/**
 * O juízo de cada ciclo: do estado (séries e janelas por quadrado) para os
 * alertas que saem agora. Puro — quem chama guarda a memória (episódios e
 * janelas já avisadas) entre um ciclo e outro.
 */
import { avisosDeJanela, montarAlertas, resumoAgora, type Ocorrencia } from '../logic/alertas'
import { avancarEpisodios, FIM_EPISODIO_MS, type Leitura, type MapaEpisodios } from '../logic/episodios'
import { nivelCintilacao, picoPrevisto, severidadeDoIndice, severidadeDoNivel, ultimaMedida } from '../logic/niveis'
import { chaveData } from '../logic/tempo'
import type { AlertaGnss, NivelCintilacao } from '../tipos'
import type { EstadoVigia } from './estado'

export interface MemoriaAlertas {
  episodios: MapaEpisodios
  /** Dia local a que `janelasAvisadas` se refere — mudou o dia, zera. */
  data: string
  janelasAvisadas: string[]
  /** Quando o juízo rodou pela última vez — diz se os episódios ainda valem. */
  ultimaAvaliacao: number
}

export const MEMORIA_INICIAL: MemoriaAlertas = { episodios: {}, data: '', janelasAvisadas: [], ultimaAvaliacao: 0 }

/** Três ciclos seguidos sem a Trimble: o alerta está pausado e isso aparece. */
export const FALHAS_PARA_SEM_DADOS = 3

export function fazendasPorCelula(estado: EstadoVigia): Record<string, string[]> {
  const mapa: Record<string, string[]> = {}
  for (const f of estado.fazendas) {
    if (f.celulaId) (mapa[f.celulaId] ??= []).push(f.nome)
  }
  return mapa
}

export interface NivelAtual {
  nivel: NivelCintilacao
  valor: number | null
  instante: number | null
}

export function nivelAtual(estado: EstadoVigia, celulaId: string | null, agora: number): NivelAtual {
  const serie = celulaId ? estado.celulas[celulaId]?.serie : undefined
  const medida = serie ? ultimaMedida(serie, agora) : null
  return {
    nivel: nivelCintilacao(medida?.cintilacao),
    valor: medida?.cintilacao ?? null,
    instante: medida?.instante ?? null,
  }
}

export function avaliar(
  estado: EstadoVigia,
  memoria: MemoriaAlertas,
  agora: number,
): { alertas: AlertaGnss[]; memoria: MemoriaAlertas } {
  const data = chaveData(agora)
  const avisadas = new Set(memoria.data === data ? memoria.janelasAvisadas : [])
  const leituras: Leitura[] = []
  const candidatas = new Map<string, Omit<Ocorrencia, 'severidade'>>()
  const ocorrencias: Ocorrencia[] = []

  for (const [celulaId, dados] of Object.entries(estado.celulas)) {
    const medida = ultimaMedida(dados.serie, agora)
    if (medida?.cintilacao != null) {
      const chave = `cintilacao:${celulaId}`
      leituras.push({ chave, severidade: severidadeDoNivel(nivelCintilacao(medida.cintilacao)) })
      candidatas.set(chave, { tipo: 'cintilacao', celulaId, valor: medida.cintilacao, instante: medida.instante })
    }
    const pico = picoPrevisto(dados.serie, agora)
    if (pico) {
      const chave = `previsao:${celulaId}`
      leituras.push({ chave, severidade: severidadeDoIndice(pico.indice) })
      candidatas.set(chave, { tipo: 'previsao', celulaId, valor: pico.indice, instante: pico.instante })
    }
    const janela = avisosDeJanela(celulaId, dados.janelas, agora, avisadas)
    for (const k of janela.novasChaves) avisadas.add(k)
    ocorrencias.push(...janela.ocorrencias)
  }

  // Episódio só fecha vendo 30 min abaixo do limite — e com o COA WEB
  // fechado (ou a máquina dormindo) ninguém viu. Memória mais velha que isso
  // não segura nada: sem este corte, o "crítico" de ontem calaria a média de
  // hoje (só dispara se SUBIR). Recarga de página (segundos) e Trimble fora
  // (o juízo roda nos ciclos com falha também) mantêm os episódios. Escrito
  // como "recente ? mantém : zera" para que memória sem o campo (NaN) zere.
  const recente = agora - memoria.ultimaAvaliacao <= FIM_EPISODIO_MS
  const { episodios, disparos } = avancarEpisodios(recente ? memoria.episodios : {}, leituras, agora)
  for (const d of disparos) {
    const c = candidatas.get(d.chave)
    if (c) ocorrencias.push({ ...c, severidade: d.severidade })
  }

  return {
    alertas: montarAlertas(ocorrencias, fazendasPorCelula(estado), agora),
    memoria: { episodios, data, janelasAvisadas: [...avisadas], ultimaAvaliacao: agora },
  }
}

export function resumoDoVigia(estado: EstadoVigia, agora: number): string {
  const niveis = estado.fazendas
    .filter((f) => f.celulaId)
    .map((f) => nivelAtual(estado, f.celulaId, agora).nivel)
  return resumoAgora(niveis, estado.falhasSeguidas >= FALHAS_PARA_SEM_DADOS)
}
