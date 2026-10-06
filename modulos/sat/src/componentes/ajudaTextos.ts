/**
 * O que cada "?" explica — linguagem de campo, curta. Números conferidos na
 * página de efeitos ionosféricos da própria Trimble (1 TECU ≈ 0,162 m no L1;
 * dupla frequência não remove cintilação). Os textos de `rtk` e o GUIA_RTK são
 * guia prático de campo (ordem de grandeza do efeito no RTK), não dado da Trimble.
 */
import type { NivelCintilacao } from '../tipos'

export type TemaAjuda = 'cintilacao' | 'indice' | 'tec' | 'janela'

export interface TextoAjuda {
  titulo: string
  oQueE: string
  quando: string
  fazer: string
  /** O efeito na operação com RTK; `fazer` fica só com a ação. */
  rtk: string
}

export const AJUDA: Record<TemaAjuda, TextoAjuda> = {
  cintilacao: {
    titulo: 'Cintilação ionosférica',
    oQueE:
      'Oscilação rápida na força e na fase do sinal dos satélites quando ele atravessa bolhas de irregularidade na ionosfera. A Trimble mede isso na rede de estações dela e dá uma nota de 0 a 100: mínima (até 32), média (33 a 65) e forte (66 ou mais).',
    quando:
      'Perto do equador, logo depois do pôr do sol, por algumas horas — com mais força entre setembro e março. É o caso das fazendas do Mato Grosso.',
    fazer:
      'Média: acompanhe o status da correção no monitor e evite abrir linhas AB novas. Forte: adie o que precisa de precisão de centímetro — plantio, pulverização com corte de seção, voo de drone em RTK. Usar duas frequências (L1/L2) não resolve cintilação.',
    rtk:
      'Mínima: operação normal, RTK fixo estável. Média: o receptor perde alguns satélites e o RTK pode cair de fixo (cerca de 2 cm) para flutuante (decímetros) por alguns minutos, e demora mais para fixar de novo. Forte: perde o fixo com frequência; o piloto automático pode desarmar ou desviar da linha, deixando falha e sobreposição entre passadas.',
  },
  indice: {
    titulo: 'Índice ionosférico',
    oQueE:
      'Nota de 0 a 10 que a Trimble calcula para a atividade da ionosfera no ponto. Diferente da cintilação, ela vem com PREVISÃO para as próximas horas. Verde até 4, amarelo de 5 a 7, vermelho de 8 a 10.',
    quando: 'Sobe com o sol (pico no começo da tarde), nos anos de sol mais ativo e perto dos equinócios (março e setembro).',
    fazer:
      'Use a previsão para programar o turno: com amarelo, acompanhe o status da correção; com vermelho, deixe plantio, pulverização com corte de seção e voo em RTK para fora desse horário.',
    rtk:
      'Verde: sem efeito no RTK. Amarelo: o RTK demora mais para fixar e a precisão piora quanto mais longe estiver a base. Vermelho: quedas de fixo para flutuante ficam prováveis, principalmente com a base distante.',
  },
  tec: {
    titulo: 'TEC (conteúdo total de elétrons)',
    oQueE:
      'Quantidade de elétrons no caminho do sinal, em TECU. Cada 1 TECU atrasa o sinal L1 em cerca de 16 cm — é o erro que o receptor de duas frequências e o RTK corrigem.',
    quando: 'Maior no começo da tarde e na faixa equatorial.',
    fazer:
      'Use como contexto do índice ionosférico. Se o TEC estiver alto e a base for distante, confira o status da correção antes de começar.',
    rtk:
      'O RTK cancela quase todo esse atraso porque a base enxerga praticamente a mesma ionosfera que a máquina. Quanto mais longe a base (rádio ou rede via celular), mais erro sobra e mais o RTK demora para fixar com TEC alto. Com a base perto, TEC alto quase não muda a operação.',
  },
  janela: {
    titulo: 'Janela de risco pelo histórico',
    oQueE:
      'Horários de hoje em que, nos últimos 7 dias, houve cintilação média ou forte em pelo menos 3 dias naquela fazenda. É estimativa pelo que vem acontecendo — a Trimble não prevê cintilação. Horários a menos de 30 minutos um do outro contam como uma janela só.',
    quando: 'Costuma aparecer à noite, entre o pôr do sol e a madrugada.',
    fazer:
      'Use para programar: deixe fora dessa janela o que depende de RTK fixo (plantio, pulverização em faixa, voo). O resumo do dia chega de manhã, e um aviso 30 minutos antes da primeira janela da noite.',
    rtk:
      'É nesse horário que o RTK mais costuma cair de fixo para flutuante e o piloto automático desarmar. Plantio ou pulverização à noite dentro da janela tem mais chance de falha e sobreposição entre passadas.',
  },
}

/** O efeito na operação que acompanha cada aviso de janela de risco no WhatsApp: três redações, uma por aviso. */
export const EFEITO_DA_JANELA = {
  /** No resumo: a frase do "?" da janela (o mesmo texto da tela). */
  naOperacao: AJUDA.janela.rtk.charAt(0).toLowerCase() + AJUDA.janela.rtk.slice(1),
  oQueFazer: 'deixe fora dessa janela o que depende de RTK fixo: plantio, pulverização com corte de seção e voo de drone em RTK.',
  lembrete: 'Programe para antes ou depois o que depende de RTK fixo (plantio, pulverização com corte de seção, voo de drone).',
  antes: 'A partir de agora o RTK pode cair de fixo para flutuante e o piloto automático desarmar. Acompanhe o status da correção no monitor e evite abrir linhas AB novas.',
} as const

export const FONTE_AJUDA = 'Fonte: rede de monitoramento da Trimble (GNSS Planning). Dado não oficial.'

/**
 * Guia "Como isso afeta o RTK" (botão no cabeçalho de Hoje e do Mapa). Texto
 * nosso, de campo — não é dado da Trimble, por isso sem `FONTE_AJUDA`.
 */
export interface NivelGuiaRtk {
  nivel: Exclude<NivelCintilacao, 'sem-dado'>
  rotulo: string
  efeito: string
  fazer: string
}

export interface GuiaRtkTextos {
  titulo: string
  niveis: readonly NivelGuiaRtk[]
  tituloSensiveis: string
  sensiveis: readonly string[]
  notaFrequencia: string
  ressalva: string
}

export const GUIA_RTK: GuiaRtkTextos = {
  titulo: 'Como a ionosfera afeta o RTK',
  niveis: [
    {
      nivel: 'minima',
      rotulo: 'Cintilação mínima · índice verde',
      efeito: 'Operação normal, RTK fixo estável.',
      fazer: 'Nada a mudar.',
    },
    {
      nivel: 'media',
      rotulo: 'Cintilação média · índice amarelo',
      efeito:
        'Perde satélites; pode cair de fixo (~2 cm) para flutuante (decímetros) por alguns minutos e demora mais para fixar de novo.',
      fazer: 'Acompanhar o status da correção no monitor; evitar abrir linhas AB novas.',
    },
    {
      nivel: 'forte',
      rotulo: 'Cintilação forte · índice vermelho',
      efeito:
        'Perde o fixo com frequência; o piloto automático pode desarmar ou desviar, deixando falha e sobreposição entre passadas.',
      fazer: 'Adiar o que exige precisão de centímetro.',
    },
  ],
  tituloSensiveis: 'Operações mais sensíveis',
  sensiveis: [
    'Plantio no piloto automático (espaçamento entre passadas)',
    'Pulverização com corte de seção (falha e sobreposição)',
    'Voo de drone em RTK (mapeamento e aplicação)',
    'Abertura de linhas AB e levantamento topográfico',
  ],
  notaFrequencia:
    'Receptor de duas frequências (L1/L2) corrige o atraso da ionosfera (TEC), mas não a cintilação: com o sinal oscilando, ele perde os satélites do mesmo jeito.',
  ressalva: 'Guia prático: o efeito real depende do receptor, da distância até a base e de quantos satélites estão à vista.',
}
