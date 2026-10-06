/**
 * A VM fala direto com a Trimble (a ponte do COA WEB só atende quem está logado no site).
 * São três consultas por quadrado por dia; a Trimble recusa quem não parece navegador.
 */
import { converterSerieTrimble, ErroGnss, isoTrimble } from '../api/gnssApi'
import { contarDiasPorFatia, DIAS_HISTORICO, janelasDeRisco } from '../logic/janelaRisco'
import { DIA_MS, inicioDoDiaLocal } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'

const BASE = 'https://www.gnssplanning.com/api'
const NAVEGADOR = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const PRAZO_MS = 30_000

export function criarTrimble(opcoes: { fetch?: typeof fetch } = {}) {
  const buscar = opcoes.fetch ?? globalThis.fetch
  return {
    /** Os 7 dias inteiros antes de hoje, como o vigia da tela. */
    async historico(celula: { lat: number; lon: number }, agora: number): Promise<PontoIono[]> {
      const inicio = inicioDoDiaLocal(agora) - DIAS_HISTORICO * DIA_MS
      const url = `${BASE}/ionoindex/${celula.lon}/${celula.lat}/${isoTrimble(inicio)}/${DIAS_HISTORICO * 24}/600`
      let resposta: Response
      try {
        resposta = await buscar(url, { headers: { 'User-Agent': NAVEGADOR, Accept: 'application/json' }, signal: AbortSignal.timeout(PRAZO_MS) })
      } catch {
        throw new ErroGnss('rede', 0, 'Sem resposta da Trimble.')
      }
      if (resposta.status === 403 || resposta.status === 429) throw new ErroGnss('bloqueio', resposta.status, 'A Trimble recusou a consulta.')
      if (!resposta.ok) throw new ErroGnss('indisponivel', resposta.status, `A Trimble respondeu ${resposta.status}.`)
      let dados: unknown
      try {
        dados = await resposta.json()
      } catch {
        throw new ErroGnss('indisponivel', resposta.status, 'Resposta da Trimble fora do formato esperado.')
      }
      return converterSerieTrimble(dados)
    },
  }
}

export function janelasDeHoje(historico: PontoIono[]): Janela[] {
  return janelasDeRisco(contarDiasPorFatia(historico))
}
