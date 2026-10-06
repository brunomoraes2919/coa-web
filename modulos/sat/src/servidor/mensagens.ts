/**
 * O que cada pessoa lê. O texto do resumo e do "começa em breve" sai de `montarAlertas`, o mesmo
 * da tela, com as fazendas da pessoa; o lembrete do meio-dia tem outras palavras de propósito
 * (duas mensagens iguais no mesmo dia parecem robô para o WhatsApp).
 */
import { EFEITO_DA_JANELA } from '../componentes/ajudaTextos'
import { listarFazendas, montarAlertas, type Ocorrencia } from '../logic/alertas'
import { janelaAindaPorVir } from '../logic/janelaRisco'
import { minutoDoDia, rotuloHora } from '../logic/tempo'
import type { Janela } from '../tipos'
import { janelaDoAntes } from './agenda'
import type { ContatoWpp, FazendaServidor, TipoEvento } from './tipos'

export const TITULO = '*Locks SAT · Janela de risco*'

export function fazendasDoContato(contato: ContatoWpp, fazendas: FazendaServidor[]): FazendaServidor[] {
  return fazendas.filter((f) => f.celulaId && (contato.todasFazendas || (f.coaId != null && contato.fazendas.includes(f.coaId))))
}

export function textoDoEvento(
  tipo: TipoEvento,
  contato: ContatoWpp,
  fazendas: FazendaServidor[],
  porCelula: Record<string, Janela[]>,
  agora: number,
): string | null {
  const minhas = fazendasDoContato(contato, fazendas)
  const minuto = minutoDoDia(agora)
  const nomesPorCelula: Record<string, string[]> = {}
  for (const f of minhas) (nomesPorCelula[f.celulaId as string] ??= []).push(f.nome)
  const celulas = Object.keys(nomesPorCelula)
  const base = { tipo: 'janela' as const, severidade: 'aviso' as const, instante: agora }

  if (tipo === 'antes') {
    const primeira = janelaDoAntes(celulas.flatMap((c) => porCelula[c] ?? []), agora)
    if (!primeira) return null
    const ocorrencias: Ocorrencia[] = celulas
      .filter((c) => (porCelula[c] ?? []).some((j) => j.inicio === primeira.inicio && j.fim === primeira.fim))
      .map((c) => ({ ...base, celulaId: c, valor: primeira.dias, janela: primeira, momento: 'antes' as const }))
    return montarAlertas(ocorrencias, nomesPorCelula, agora)[0]?.texto ?? null
  }

  const ocorrencias: Ocorrencia[] = celulas.flatMap((c) =>
    (porCelula[c] ?? []).filter((j) => janelaAindaPorVir(j, minuto))
      .map((j) => ({ ...base, celulaId: c, valor: j.dias, janela: j, momento: 'dia' as const })))
  if (!ocorrencias.length) return null
  if (tipo === 'resumo-07') return montarAlertas(ocorrencias, nomesPorCelula, agora)[0]?.texto ?? null

  const inicio = Math.min(...ocorrencias.map((o) => o.janela?.inicio ?? 0))
  const nomes = [...new Set(ocorrencias.flatMap((o) => nomesPorCelula[o.celulaId]))]
  return `Lembrete: janela de risco de cintilação hoje a partir de ${rotuloHora(inicio)} em ${listarFazendas(nomes)}.`
}

function primeiroNome(contato: ContatoWpp): string {
  return contato.nome.trim().split(/\s+/)[0]
}

function saudacao(agora: number): string {
  const h = new Date(agora).getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/** O que o aviso afeta na operação: cada tipo com as suas palavras (o mesmo texto repetido no dia parece robô). */
function efeitoNaOperacao(tipo: TipoEvento): string[] {
  if (tipo === 'resumo-07') return ['', `*Na operação:* ${EFEITO_DA_JANELA.naOperacao}`, `*O que fazer:* ${EFEITO_DA_JANELA.oQueFazer}`]
  return [tipo === 'lembrete-12' ? EFEITO_DA_JANELA.lembrete : EFEITO_DA_JANELA.antes]
}

export function montarMensagem(tipo: TipoEvento, contato: ContatoWpp, texto: string, agora: number, comSair: boolean): string {
  const linhas = [TITULO, `${saudacao(agora)}, ${primeiroNome(contato)}.`, texto, ...efeitoNaOperacao(tipo)]
  if (comSair) linhas.push('Para parar de receber, responda SAIR.')
  return linhas.join('\n')
}

export function textoAtivado(contato: ContatoWpp, nomesFazendas: string[]): string {
  const onde = nomesFazendas.length ? [...nomesFazendas].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ') : 'suas fazendas'
  return `Pronto, ${primeiroNome(contato)}. Você vai receber aqui os alertas de janela de risco do Locks SAT de: ${onde}. Para parar, responda SAIR.`
}

export function textoSaiu(contato: ContatoWpp): string {
  return `Certo, ${primeiroNome(contato)}. Você não vai mais receber os alertas. Para voltar, mande ATIVAR.`
}
