/**
 * O que cada pessoa lê. Os dados do resumo e do "começa em breve" (horários, fazendas, pior horário)
 * são os mesmos da tela: saem das funções de `logic/alertas` e `logic/janelaRisco`, só que em linhas
 * com emoji em vez de uma frase. O lembrete do meio-dia tem outras palavras de propósito
 * (duas mensagens iguais no mesmo dia parecem robô para o WhatsApp).
 */
import { AJUDA, EFEITO_DA_JANELA } from '../componentes/ajudaTextos'
import { listarFazendas } from '../logic/alertas'
import { janelaAindaPorVir, textoJanela } from '../logic/janelaRisco'
import { minutoDoDia, rotuloHora } from '../logic/tempo'
import type { Janela } from '../tipos'
import { janelaDoAntes } from './agenda'
import type { ContatoWpp, FazendaServidor, TipoEvento } from './tipos'

export const TITULOS: Record<TipoEvento, string> = {
  'resumo-07': '🛰️ *LOCKS SAT · JANELA DE RISCO*',
  'lembrete-12': '🛰️ *LOCKS SAT · LEMBRETE*',
  antes: '🚨 *LOCKS SAT · COMEÇA EM BREVE*',
}

const LINHA_SAIR = '_Para parar de receber, responda SAIR._'

export function fazendasDoContato(contato: ContatoWpp, fazendas: FazendaServidor[]): FazendaServidor[] {
  return fazendas.filter((f) => f.celulaId && (contato.todasFazendas || (f.coaId != null && contato.fazendas.includes(f.coaId))))
}

/** O horário da janela como na tela (`textoJanela`), com o intervalo em negrito. */
function janelaEmNegrito(j: Janela): string {
  return textoJanela(j).replace(/^\S+/, '*$&*')
}

/** O bloco de dados da mensagem (entre a saudação e o efeito na operação); `null` quando não há o que avisar. */
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
  const nomesDe = (cs: string[]) => [...new Set(cs.flatMap((c) => nomesPorCelula[c]))]

  if (tipo === 'antes') {
    const primeira = janelaDoAntes(celulas.flatMap((c) => porCelula[c] ?? []), agora)
    if (!primeira) return null
    const nomes = nomesDe(celulas.filter((c) => (porCelula[c] ?? []).some((j) => j.inicio === primeira.inicio && j.fim === primeira.fim)))
    if (!nomes.length) return null
    return [
      '⚠️ *Janela de risco de cintilação*',
      `🕗 ${janelaEmNegrito(primeira)}`,
      `📍 ${listarFazendas(nomes)}`,
    ].join('\n')
  }

  const ocorrencias = celulas.flatMap((c) =>
    (porCelula[c] ?? []).filter((j) => janelaAindaPorVir(j, minuto)).map((j) => ({ celulaId: c, janela: j })))
  if (!ocorrencias.length) return null
  const nomes = nomesDe([...new Set(ocorrencias.map((o) => o.celulaId))])

  if (tipo === 'lembrete-12') {
    const inicio = Math.min(...ocorrencias.map((o) => o.janela.inicio))
    return [`⏰ A janela de risco de hoje começa às *${rotuloHora(inicio)}*`, `📍 ${listarFazendas(nomes)}`].join('\n')
  }

  const inicio = Math.min(...ocorrencias.map((o) => o.janela.inicio))
  const fim = Math.max(...ocorrencias.map((o) => o.janela.fim))
  // Empate de dias: fica a primeira, como no texto da tela (`textoGrupo`).
  const pior = ocorrencias.reduce((a, b) => (b.janela.dias > a.janela.dias ? b : a)).janela
  return [
    '⚠️ *Hoje tem risco de cintilação*',
    `🕗 Das *${rotuloHora(inicio)}* às *${rotuloHora(fim)}*`,
    `📍 ${listarFazendas(nomes)}`,
    `🔴 Pior horário: ${janelaEmNegrito(pior)}`,
  ].join('\n')
}

function primeiroNome(contato: ContatoWpp): string {
  return contato.nome.trim().split(/\s+/)[0]
}

function saudacao(agora: number): string {
  const h = new Date(agora).getHours()
  return h < 12 ? '☀️ Bom dia' : h < 18 ? '🌤️ Boa tarde' : '🌙 Boa noite'
}

/** O que o aviso afeta na operação, em blocos: cada tipo com as suas palavras (o mesmo texto repetido no dia parece robô). */
function efeitoNaOperacao(tipo: TipoEvento): string[] {
  if (tipo === 'resumo-07') {
    const { intro, itens } = EFEITO_DA_JANELA.oQueFazer
    return [
      `🚜 *Na operação*\n${AJUDA.janela.rtk}`,
      ['✅ *O que fazer*', intro, ...itens.map((i) => `• ${i}`)].join('\n'),
    ]
  }
  if (tipo === 'lembrete-12') return [`📋 ${EFEITO_DA_JANELA.lembrete}`]
  return [`📡 ${EFEITO_DA_JANELA.antes.efeito}\n👀 ${EFEITO_DA_JANELA.antes.acao}`]
}

/** Blocos separados por uma linha em branco: título, saudação, dados, efeito e (só se pedido) a linha do SAIR. */
export function montarMensagem(tipo: TipoEvento, contato: ContatoWpp, texto: string, agora: number, comSair: boolean): string {
  const blocos = [TITULOS[tipo], `${saudacao(agora)}, *${primeiroNome(contato)}*!`, texto, ...efeitoNaOperacao(tipo)]
  if (comSair) blocos.push(LINHA_SAIR)
  return blocos.join('\n\n')
}

export function textoAtivado(contato: ContatoWpp, nomesFazendas: string[]): string {
  const onde = nomesFazendas.length ? [...nomesFazendas].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ') : 'suas fazendas'
  return `✅ Pronto, ${primeiroNome(contato)}! Você vai receber aqui os alertas de janela de risco do Locks SAT de: ${onde}. Para parar, responda SAIR.`
}

export function textoSaiu(contato: ContatoWpp): string {
  return `👋 Certo, ${primeiroNome(contato)}. Você não vai mais receber os alertas. Para voltar, mande ATIVAR.`
}
