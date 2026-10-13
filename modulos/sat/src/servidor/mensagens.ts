/**
 * O que cada pessoa lê. Os dados do resumo e do "começa em breve" (horários, fazendas, pior horário)
 * são os mesmos da tela: saem das funções de `logic/alertas` e `logic/janelaRisco`, só que em linhas
 * com emoji em vez de uma frase. A lista de fazendas é a única diferença: aqui vão todos os nomes
 * (`listarTodasAsFazendas`). O lembrete do meio-dia tem outras palavras de propósito
 * (duas mensagens iguais no mesmo dia parecem robô para o WhatsApp).
 */
import { AJUDA, EFEITO_DA_JANELA } from '../componentes/ajudaTextos'
import { DIAS_HISTORICO, janelaAindaPorVir, MINIMO_DIAS, textoJanela, TOLERANCIA_JUNCAO_MIN } from '../logic/janelaRisco'
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

/**
 * O convite que fecha cada aviso: a pessoa responde e o serviço explica (`textoDaEstimativa`,
 * `textoDoImpacto`). Uma redação por aviso, como o resto (o mesmo parágrafo repetido no dia parece robô).
 */
export const CONVITE_DETALHAR: Record<TipoEvento, string> = {
  'resumo-07': [
    '💬 *Quer saber mais?* Responda:',
    '• *DETALHAR ESTIMATIVA*: como esse horário foi calculado',
    '• *DETALHAR IMPACTO*: o que pode afetar na operação',
  ].join('\n'),
  'lembrete-12': '💬 Dúvida? Responda *DETALHAR ESTIMATIVA* para ver como o horário é calculado ou *DETALHAR IMPACTO* para ver o que pode afetar na operação.',
  antes: '💬 Responda *DETALHAR IMPACTO* (efeito na operação) ou *DETALHAR ESTIMATIVA* (como o horário foi calculado).',
}

export function fazendasDoContato(contato: ContatoWpp, fazendas: FazendaServidor[]): FazendaServidor[] {
  return fazendas.filter((f) => f.celulaId && (contato.todasFazendas || (f.coaId != null && contato.fazendas.includes(f.coaId))))
}

/**
 * As fazendas do aviso, todas pelo nome. A tela corta em três ("e mais 2", `listarFazendas`) porque o
 * aviso dela é curto; no WhatsApp quem recebe precisa saber quais são (pedido de 12/10/2026).
 */
export function listarTodasAsFazendas(nomes: string[]): string {
  const n = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return n.length === 1 ? n[0] : `${n.length} fazendas: ${n.join(', ')}`
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
      `📍 ${listarTodasAsFazendas(nomes)}`,
    ].join('\n')
  }

  const ocorrencias = celulas.flatMap((c) =>
    (porCelula[c] ?? []).filter((j) => janelaAindaPorVir(j, minuto)).map((j) => ({ celulaId: c, janela: j })))
  if (!ocorrencias.length) return null
  const nomes = nomesDe([...new Set(ocorrencias.map((o) => o.celulaId))])

  if (tipo === 'lembrete-12') {
    const inicio = Math.min(...ocorrencias.map((o) => o.janela.inicio))
    return [`⏰ A janela de risco de hoje começa às *${rotuloHora(inicio)}*`, `📍 ${listarTodasAsFazendas(nomes)}`].join('\n')
  }

  const inicio = Math.min(...ocorrencias.map((o) => o.janela.inicio))
  const fim = Math.max(...ocorrencias.map((o) => o.janela.fim))
  // Empate de dias: fica a primeira, como no texto da tela (`textoGrupo`).
  const pior = ocorrencias.reduce((a, b) => (b.janela.dias > a.janela.dias ? b : a)).janela
  return [
    '⚠️ *Hoje tem risco de cintilação*',
    `🕗 Das *${rotuloHora(inicio)}* às *${rotuloHora(fim)}*`,
    `📍 ${listarTodasAsFazendas(nomes)}`,
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

/** Blocos separados por uma linha em branco: título, saudação, dados, efeito, o convite para pedir explicação e (só se pedido) a linha do SAIR. */
export function montarMensagem(tipo: TipoEvento, contato: ContatoWpp, texto: string, agora: number, comSair: boolean): string {
  const blocos = [TITULOS[tipo], `${saudacao(agora)}, *${primeiroNome(contato)}*!`, texto, ...efeitoNaOperacao(tipo), CONVITE_DETALHAR[tipo]]
  if (comSair) blocos.push(LINHA_SAIR)
  return blocos.join('\n\n')
}

/** As janelas de hoje que ainda vêm, por fazenda da pessoa: fazendas com os mesmos horários saem juntas. `null` = sem o cálculo de hoje. */
function janelasDeHojeDoContato(contato: ContatoWpp, fazendas: FazendaServidor[], porCelula: Record<string, Janela[]> | null, agora: number): string | null {
  if (!porCelula) return null
  const minuto = minutoDoDia(agora)
  const grupos = new Map<string, { inicio: number; nomes: string[] }>()
  for (const f of fazendasDoContato(contato, fazendas)) {
    const janelas = (porCelula[f.celulaId as string] ?? []).filter((j) => janelaAindaPorVir(j, minuto)).sort((a, b) => a.inicio - b.inicio)
    if (!janelas.length) continue
    const horarios = janelas.map(janelaEmNegrito).join(' e ')
    const grupo = grupos.get(horarios) ?? { inicio: janelas[0].inicio, nomes: [] }
    if (!grupo.nomes.includes(f.nome)) grupo.nomes.push(f.nome)
    grupos.set(horarios, grupo)
  }
  const titulo = '📍 *Hoje nas suas fazendas*'
  if (!grupos.size) return `${titulo}\nNão há janela de risco pela frente hoje.`
  const linhas = [...grupos]
    .sort(([a, ga], [b, gb]) => ga.inicio - gb.inicio || a.localeCompare(b, 'pt-BR'))
    .map(([horarios, g]) => `• ${g.nomes.sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ')}: ${horarios}`)
  return [titulo, ...linhas].join('\n')
}

/**
 * Resposta ao DETALHAR ESTIMATIVA: de onde vem o horário do aviso, a conta (os números são os da regra,
 * `logic/janelaRisco`), as janelas de hoje das fazendas da pessoa e o aviso de que é estimativa.
 * `porCelula` = as janelas calculadas hoje (`null` se ainda não há cálculo de hoje: o bloco das fazendas não sai).
 */
export function textoDaEstimativa(contato: ContatoWpp, fazendas: FazendaServidor[], porCelula: Record<string, Janela[]> | null, agora: number): string {
  const blocos = [
    '🛰️ *LOCKS SAT · COMO A ESTIMATIVA É FEITA*',
    `📊 *De onde vem*\nA Trimble mede a cintilação de 10 em 10 minutos na região de cada fazenda, mas não faz previsão. O Locks SAT olha os *últimos ${DIAS_HISTORICO} dias* e marca os horários em que ela vem se repetindo.`,
    [
      '📐 *A conta*',
      `• Um horário entra na janela quando teve cintilação média ou forte em *${MINIMO_DIAS} ou mais* dos ${DIAS_HISTORICO} dias.`,
      `• Horários a menos de ${TOLERANCIA_JUNCAO_MIN} minutos um do outro viram uma janela só.`,
      `• "(5 de ${DIAS_HISTORICO} dias)" quer dizer que, no trecho que mais se repetiu, cintilou em 5 dos últimos ${DIAS_HISTORICO} dias.`,
    ].join('\n'),
  ]
  const hoje = janelasDeHojeDoContato(contato, fazendas, porCelula, agora)
  if (hoje) blocos.push(hoje)
  blocos.push(`⚠️ *É uma estimativa*\nVale pelo que vem acontecendo, não é previsão. Pode cintilar fora da janela e pode não cintilar dentro dela. Quanto mais dias (${DIAS_HISTORICO - 1} ou ${DIAS_HISTORICO} de ${DIAS_HISTORICO}), maior a chance.`)
  return blocos.join('\n\n')
}

const CORTE_DE_SECAO = 'o corte de seção liga e desliga no lugar errado, e sobra faixa sem produto ou com dose dobrada.'
const DRONE = '*Drone*: o voo em RTK perde a posição e pode pausar ou voltar.'

/**
 * O que está no campo em cada época, em Mato Grosso, para soja na safra e algodão e milho na segunda safra
 * (plantio da soja de 7 de setembro a 7 de janeiro; segunda safra plantada de janeiro ao começo de março;
 * colheita do milho e do algodão no meio do ano; soqueira do algodão destruída até o começo de outubro;
 * preparo de solo em algumas fazendas, da colheita até o plantio da soja). Pulverização e drone entram o
 * ano todo. Textos aprovados pelo usuário em 12/10/2026 a partir do período de setembro a dezembro.
 */
const EPOCAS: { meses: number[]; titulo: string; itens: string[] }[] = [
  {
    meses: [9, 10, 11, 12],
    titulo: 'plantio da soja',
    itens: [
      '*Plantio*: linhas fora do paralelo, falha ou sobreposição entre passadas. O erro fica na lavoura até a colheita, porque pulverizador e colhedora seguem essas linhas.',
      `*Dessecação e pulverizações*: ${CORTE_DE_SECAO}`,
      '*Preparo de solo e destruição de soqueira* (onde ainda não terminou): passadas desalinhadas e taxa variável aplicada fora do lugar.',
      DRONE,
    ],
  },
  {
    meses: [1, 2, 3],
    titulo: 'colheita da soja e plantio da segunda safra',
    itens: [
      '*Plantio do algodão e do milho*: linhas fora do paralelo, falha ou sobreposição entre passadas. No algodão pesa mais, porque a colhedora segue as linhas plantadas.',
      '*Colheita da soja*: a colhedora sai da linha, deixa faixa sem colher ou passa duas vezes, e o mapa de produtividade sai deslocado.',
      `*Pulverizações*: ${CORTE_DE_SECAO}`,
      DRONE,
    ],
  },
  {
    meses: [4, 5, 6],
    titulo: 'tratos do algodão e do milho',
    itens: [
      `*Pulverizações do algodão e do milho*: muitas são feitas à noite, no horário da cintilação. O pulverizador sai do rastro e amassa a lavoura, e o corte de seção erra o lugar de ligar e desligar.`,
      '*Adubação de cobertura*: faixa sem adubo ou com dose dobrada, e taxa variável aplicada fora do lugar.',
      '*Colheita do milho* (onde já começou): a colhedora sai da linha e o mapa de produtividade sai deslocado.',
      DRONE,
    ],
  },
  {
    meses: [7, 8],
    titulo: 'colheita do algodão e do milho e preparo de solo',
    itens: [
      '*Colheita do algodão e do milho*: a colhedora sai das linhas, perde produto, e o mapa de produtividade sai deslocado.',
      `*Desfolha e pulverizações*: ${CORTE_DE_SECAO}`,
      '*Destruição de soqueira*: passadas desalinhadas deixam faixa de soqueira viva.',
      '*Preparo de solo* (calagem, gessagem, subsolagem, gradagem): passadas desalinhadas e taxa variável aplicada fora do lugar.',
      DRONE,
    ],
  },
]

/** Resposta ao DETALHAR IMPACTO: o que a cintilação faz na máquina, o que pesa nas operações da época e o que fazer. */
export function textoDoImpacto(agora: number): string {
  const mes = new Date(agora).getMonth() + 1
  const epoca = EPOCAS.find((e) => e.meses.includes(mes)) ?? EPOCAS[0]
  return [
    '🚜 *LOCKS SAT · IMPACTO NA OPERAÇÃO*',
    '📡 *O que acontece na máquina*\nCom cintilação o RTK cai de fixo para flutuante. O piloto automático perde a linha ou desarma, e o erro sai dos 2 a 3 cm para dezenas de centímetros.',
    [`🌱 *Nesta época: ${epoca.titulo}*`, ...epoca.itens.map((i) => `• ${i}`)].join('\n'),
    '✅ *O que fazer*\nPrograme para antes ou depois da janela o que depende de RTK fixo. Se a máquina já estiver no talhão, acompanhe o status da correção e não abra linha AB nova.',
  ].join('\n\n')
}

export function textoAtivado(contato: ContatoWpp, nomesFazendas: string[]): string {
  const onde = nomesFazendas.length ? [...nomesFazendas].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ') : 'suas fazendas'
  return `✅ Pronto, ${primeiroNome(contato)}! Você vai receber aqui os alertas de janela de risco do Locks SAT de: ${onde}. Para parar, responda SAIR.`
}

export function textoSaiu(contato: ContatoWpp): string {
  return `👋 Certo, ${primeiroNome(contato)}. Você não vai mais receber os alertas. Para voltar, mande ATIVAR.`
}
