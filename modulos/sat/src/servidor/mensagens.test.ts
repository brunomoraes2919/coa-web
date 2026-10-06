// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { describe, expect, it } from 'vitest'
import { listarFazendas, montarAlertas, type Ocorrencia } from '../logic/alertas'
import type { Janela } from '../tipos'
import { fazendasDoContato, montarMensagem, textoAtivado, textoDoEvento, textoSaiu } from './mensagens'
import type { ContatoWpp, FazendaServidor, TipoEvento } from './tipos'

const em = (h: number, m = 0) => new Date(2026, 9, 6, h, m).getTime()
const fazenda = (id: string, coaId: number, nome: string, celulaId: string | null): FazendaServidor =>
  ({ id, coaId, nome, celulaId, lat: celulaId ? -12.26 : null, lon: celulaId ? -50.31 : null })
const FAZENDAS = [
  fazenda('a', 1, 'Fazenda A', 'c1'), fazenda('b', 2, 'Fazenda B', 'c2'),
  fazenda('c', 3, 'Fazenda C', 'c2'), fazenda('d', 4, 'Fazenda D', null),
]
const contato = (extra: Partial<ContatoWpp> = {}): ContatoWpp => ({
  id: 'x', nome: 'Bruno da Silva', telefone: '5565999990001', todasFazendas: false, fazendas: [2], alertaJanela: true,
  ativo: true, confirmadoEm: '2026-10-01T00:00:00Z', confirmadoPor: 'mensagem', jid: null, atualizadoEm: null, ...extra,
})
const A_E_B = contato({ fazendas: [1, 2] })
const TODAS = contato({ todasFazendas: true, fazendas: [] })

const NOITE: Janela = { inicio: 19 * 60, fim: 21 * 60 + 30, dias: 5 }
const TARDE: Janela = { inicio: 21 * 60 + 50, fim: 22 * 60, dias: 3 }
const POR_CELULA = { c1: [TARDE], c2: [NOITE] }
// Duas células com janelas diferentes: das 20:00 à 01:30 (passa da meia-noite) e a pior, das 21:00 às 23:30.
const LONGA: Janela = { inicio: 20 * 60, fim: 24 * 60 + 90, dias: 3 }
const PIOR: Janela = { inicio: 21 * 60, fim: 23 * 60 + 30, dias: 5 }
const DUAS_JANELAS = { c1: [LONGA], c2: [PIOR] }
// Duas células na mesma janela.
const MESMA: Janela = { inicio: 20 * 60, fim: 24 * 60 + 90, dias: 5 }
const MESMA_JANELA = { c1: [MESMA], c2: [MESMA] }

const SAIR = '_Para parar de receber, responda SAIR._'
const RTK = 'É nesse horário que o RTK mais costuma cair de fixo para flutuante e o piloto automático desarmar. Plantio ou pulverização à noite dentro da janela tem mais chance de falha e sobreposição entre passadas.'

function mensagem(tipo: TipoEvento, c: ContatoWpp, porCelula: Record<string, Janela[]>, agora: number, comSair: boolean): string {
  return montarMensagem(tipo, c, textoDoEvento(tipo, c, FAZENDAS, porCelula, agora) as string, agora, comSair)
}

const RESUMO = [
  '🛰️ *LOCKS SAT · JANELA DE RISCO*',
  '☀️ Bom dia, *Bruno*!',
  [
    '⚠️ *Hoje tem risco de cintilação*',
    '🕗 Das *20:00* às *01:30*',
    '📍 2 fazendas: Fazenda A, Fazenda B',
    '🔴 Pior horário: *21:00–23:30* (5 de 7 dias)',
  ].join('\n'),
  `🚜 *Na operação*\n${RTK}`,
  [
    '✅ *O que fazer*',
    'Deixe fora dessa janela o que depende de RTK fixo:',
    '• Plantio',
    '• Pulverização com corte de seção',
    '• Voo de drone em RTK',
  ].join('\n'),
]
const LEMBRETE = [
  '🛰️ *LOCKS SAT · LEMBRETE*',
  '🌤️ Boa tarde, *Bruno*!',
  ['⏰ A janela de risco de hoje começa às *20:00*', '📍 2 fazendas: Fazenda A, Fazenda B'].join('\n'),
  '📋 Programe para antes ou depois o que depende de RTK fixo: plantio, pulverização com corte de seção e voo de drone.',
]
const ANTES = [
  '🚨 *LOCKS SAT · COMEÇA EM BREVE*',
  '🌙 Boa noite, *Bruno*!',
  [
    '⚠️ *Janela de risco de cintilação*',
    '🕗 *20:00–01:30* (5 de 7 dias)',
    '📍 2 fazendas: Fazenda A, Fazenda B',
  ].join('\n'),
  [
    '📡 A partir de agora o RTK pode cair de fixo para flutuante e o piloto automático desarmar.',
    '👀 Acompanhe o status da correção no monitor e evite abrir linhas AB novas.',
  ].join('\n'),
]
const junta = (blocos: string[]) => blocos.join('\n\n')

describe('mensagens', () => {
  it('o contato acompanha as fazendas dele que têm quadrado; "todas" pega todas', () => {
    expect(fazendasDoContato(contato(), FAZENDAS).map((f) => f.nome)).toEqual(['Fazenda B'])
    expect(fazendasDoContato(TODAS, FAZENDAS).map((f) => f.nome)).toEqual(['Fazenda A', 'Fazenda B', 'Fazenda C'])
  })

  describe('mensagem inteira (textos aprovados)', () => {
    it('resumo das 07:00, sem a linha do SAIR', () => {
      expect(mensagem('resumo-07', A_E_B, DUAS_JANELAS, em(7), false)).toBe(junta(RESUMO))
    })
    it('resumo das 07:00, com a linha do SAIR no fim', () => {
      expect(mensagem('resumo-07', A_E_B, DUAS_JANELAS, em(7), true)).toBe(junta([...RESUMO, SAIR]))
    })
    it('lembrete das 12:00', () => {
      expect(mensagem('lembrete-12', A_E_B, DUAS_JANELAS, em(12), false)).toBe(junta(LEMBRETE))
    })
    it('"começa em breve"', () => {
      expect(mensagem('antes', A_E_B, MESMA_JANELA, em(19, 30), false)).toBe(junta(ANTES))
    })
    it('o SAIR, quando pedido, é o último bloco, nos três avisos', () => {
      const comSair = [
        mensagem('resumo-07', A_E_B, DUAS_JANELAS, em(7), true),
        mensagem('lembrete-12', A_E_B, DUAS_JANELAS, em(12), true),
        mensagem('antes', A_E_B, MESMA_JANELA, em(19, 30), true),
      ]
      for (const m of comSair) expect(m.endsWith(`\n\n${SAIR}`)).toBe(true)
      expect(comSair[1]).toBe(junta([...LEMBRETE, SAIR]))
      expect(comSair[2]).toBe(junta([...ANTES, SAIR]))
    })
    it('sem linha em branco no fim e sem espaço no fim de linha', () => {
      for (const sair of [false, true]) {
        for (const m of [
          mensagem('resumo-07', A_E_B, DUAS_JANELAS, em(7), sair),
          mensagem('lembrete-12', A_E_B, DUAS_JANELAS, em(12), sair),
          mensagem('antes', A_E_B, MESMA_JANELA, em(19, 30), sair),
        ]) {
          expect(m.endsWith('\n')).toBe(false)
          expect(m).not.toMatch(/[ \t]\n|[ \t]$|\n\n\n/)
        }
      }
    })
    it('as três mensagens não repetem nenhum parágrafo entre si', () => {
      const partes = [
        mensagem('resumo-07', A_E_B, DUAS_JANELAS, em(7), true),
        mensagem('lembrete-12', A_E_B, DUAS_JANELAS, em(12), true),
        mensagem('antes', A_E_B, MESMA_JANELA, em(19, 30), true),
      ].flatMap((m) => m.split('\n\n').filter((p) => p !== SAIR))
      expect(new Set(partes).size).toBe(partes.length)
    })
  })

  describe('saudação', () => {
    it('muda com a hora, com o primeiro nome do contato em negrito', () => {
      expect(montarMensagem('resumo-07', contato(), 'Dados.', em(7), false)).toContain('\n\n☀️ Bom dia, *Bruno*!\n\n')
      expect(montarMensagem('lembrete-12', contato(), 'Dados.', em(12), false)).toContain('\n\n🌤️ Boa tarde, *Bruno*!\n\n')
      expect(montarMensagem('antes', contato(), 'Dados.', em(18, 30), false)).toContain('\n\n🌙 Boa noite, *Bruno*!\n\n')
    })
    it('os limites são 12 h e 18 h', () => {
      expect(montarMensagem('antes', contato(), 'Dados.', em(11, 59), false)).toContain('☀️ Bom dia, ')
      expect(montarMensagem('antes', contato(), 'Dados.', em(12), false)).toContain('🌤️ Boa tarde, ')
      expect(montarMensagem('antes', contato(), 'Dados.', em(17, 59), false)).toContain('🌤️ Boa tarde, ')
      expect(montarMensagem('antes', contato(), 'Dados.', em(18), false)).toContain('🌙 Boa noite, ')
    })
  })

  describe('resumo', () => {
    it('duas células com janelas diferentes: início é o menor, fim o maior, pior a de mais dias', () => {
      expect(textoDoEvento('resumo-07', A_E_B, FAZENDAS, DUAS_JANELAS, em(7))).toBe([
        '⚠️ *Hoje tem risco de cintilação*',
        '🕗 Das *20:00* às *01:30*',
        '📍 2 fazendas: Fazenda A, Fazenda B',
        '🔴 Pior horário: *21:00–23:30* (5 de 7 dias)',
      ].join('\n'))
    })
    it('só as fazendas da pessoa; uma fazenda aparece só com o nome', () => {
      expect(textoDoEvento('resumo-07', contato(), FAZENDAS, POR_CELULA, em(7))).toBe([
        '⚠️ *Hoje tem risco de cintilação*',
        '🕗 Das *19:00* às *21:30*',
        '📍 Fazenda B',
        '🔴 Pior horário: *19:00–21:30* (5 de 7 dias)',
      ].join('\n'))
      expect(textoDoEvento('resumo-07', TODAS, FAZENDAS, POR_CELULA, em(7)))
        .toContain('📍 3 fazendas: Fazenda A, Fazenda B, Fazenda C\n')
    })
    it('só entra o que ainda vem hoje', () => {
      const texto = textoDoEvento('resumo-07', A_E_B, FAZENDAS, { c1: [{ inicio: 60, fim: 120, dias: 9 }], c2: [NOITE] }, em(7)) as string
      expect(texto).toContain('🕗 Das *19:00* às *21:30*')
      expect(texto).toContain('📍 Fazenda B\n')
    })

    // Os dados são os mesmos do texto da tela (montarAlertas): início, fim, fazendas e pior horário,
    // inclusive no empate de dias entre duas janelas.
    const daTela = (c: ContatoWpp, porCelula: Record<string, Janela[]>, agora: number) => {
      const minhas = fazendasDoContato(c, FAZENDAS)
      const nomesPorCelula: Record<string, string[]> = {}
      for (const f of minhas) (nomesPorCelula[f.celulaId as string] ??= []).push(f.nome)
      const ocorrencias: Ocorrencia[] = Object.keys(nomesPorCelula).flatMap((celulaId) =>
        (porCelula[celulaId] ?? []).map((j) => ({
          tipo: 'janela' as const, severidade: 'aviso' as const, celulaId, instante: agora, valor: j.dias, janela: j, momento: 'dia' as const,
        })))
      const texto = montarAlertas(ocorrencias, nomesPorCelula, agora)[0].texto
      const [, inicio, fim, onde, pior] = texto.match(/^Janelas de risco de cintilação hoje entre (\S+) e (\S+) em (.+)\. Pior horário: (.+)\.$/) as RegExpMatchArray
      return { inicio, fim, onde, pior }
    }
    const dadosDoZap = (texto: string) => {
      const [, inicio, fim] = texto.match(/Das \*(\S+)\* às \*(\S+)\*/) as RegExpMatchArray
      const onde = (texto.match(/📍 (.+)/) as RegExpMatchArray)[1]
      const pior = ((texto.match(/Pior horário: (.+)/) as RegExpMatchArray)[1]).replace(/\*/g, '')
      return { inicio, fim, onde, pior }
    }
    const EMPATE = { c1: [{ inicio: 22 * 60, fim: 23 * 60, dias: 4 }], c2: [{ inicio: 20 * 60, fim: 21 * 60, dias: 4 }, { inicio: 23 * 60 + 30, fim: 24 * 60, dias: 4 }] }
    it.each([
      ['janelas diferentes', A_E_B, DUAS_JANELAS],
      ['uma fazenda', contato(), POR_CELULA],
      ['todas as fazendas', TODAS, POR_CELULA],
      ['empate de dias entre janelas', TODAS, EMPATE],
    ])('bate com o texto da tela: %s', (_nome, c, porCelula) => {
      const zap = dadosDoZap(textoDoEvento('resumo-07', c, FAZENDAS, porCelula, em(7)) as string)
      expect(zap).toEqual(daTela(c, porCelula, em(7)))
    })
    it('empate: o pior é o primeiro na ordem das fazendas, como na tela', () => {
      expect(textoDoEvento('resumo-07', TODAS, FAZENDAS, EMPATE, em(7))).toContain('Pior horário: *22:00–23:00* (4 de 7 dias)')
    })
    it('mais de três fazendas: a mesma lista curta da tela', () => {
      const muitas = [...FAZENDAS.slice(0, 3), fazenda('e', 5, 'Fazenda E', 'c2'), fazenda('f', 6, 'Fazenda F', 'c1')]
      const todas = contato({ todasFazendas: true, fazendas: [] })
      const texto = textoDoEvento('resumo-07', todas, muitas, DUAS_JANELAS, em(7)) as string
      expect(texto).toContain(`📍 ${listarFazendas(['Fazenda A', 'Fazenda B', 'Fazenda C', 'Fazenda E', 'Fazenda F'])}\n`)
      expect(texto).toContain('📍 5 fazendas: Fazenda A, Fazenda B, Fazenda C e mais 2\n')
    })
  })

  describe('lembrete', () => {
    it('hora de início = a menor das janelas que ainda vêm, com as fazendas da pessoa', () => {
      expect(textoDoEvento('lembrete-12', contato(), FAZENDAS, POR_CELULA, em(12)))
        .toBe('⏰ A janela de risco de hoje começa às *19:00*\n📍 Fazenda B')
      expect(textoDoEvento('lembrete-12', TODAS, FAZENDAS, POR_CELULA, em(12)))
        .toBe('⏰ A janela de risco de hoje começa às *19:00*\n📍 3 fazendas: Fazenda A, Fazenda B, Fazenda C')
    })
  })

  describe('"começa em breve"', () => {
    it('mesma janela em duas fazendas: as duas aparecem', () => {
      expect(textoDoEvento('antes', A_E_B, FAZENDAS, MESMA_JANELA, em(19, 30))).toBe([
        '⚠️ *Janela de risco de cintilação*',
        '🕗 *20:00–01:30* (5 de 7 dias)',
        '📍 2 fazendas: Fazenda A, Fazenda B',
      ].join('\n'))
    })
    it('janelas diferentes: só a que começa primeiro, com as fazendas dela', () => {
      const texto = textoDoEvento('antes', TODAS, FAZENDAS, POR_CELULA, em(18, 30)) as string
      expect(texto).toBe([
        '⚠️ *Janela de risco de cintilação*',
        '🕗 *19:00–21:30* (5 de 7 dias)',
        '📍 2 fazendas: Fazenda B, Fazenda C',
      ].join('\n'))
      expect(texto).not.toContain('Fazenda A')
    })
  })

  describe('sem texto (null)', () => {
    it('sem janela nas fazendas da pessoa ou nenhuma por vir', () => {
      for (const tipo of ['resumo-07', 'lembrete-12'] as const) {
        expect(textoDoEvento(tipo, contato({ fazendas: [4] }), FAZENDAS, POR_CELULA, em(12))).toBeNull()
        expect(textoDoEvento(tipo, contato(), FAZENDAS, { c1: [TARDE], c2: [] }, em(12))).toBeNull()
        expect(textoDoEvento(tipo, contato(), FAZENDAS, { c2: [{ inicio: 60, fim: 120, dias: 4 }] }, em(12))).toBeNull()
      }
    })
    it('"antes": nenhuma janela começa nos próximos 30 minutos, ou não há janela', () => {
      expect(textoDoEvento('antes', TODAS, FAZENDAS, POR_CELULA, em(18, 29))).toBeNull()
      expect(textoDoEvento('antes', TODAS, FAZENDAS, { c1: [], c2: [] }, em(18, 30))).toBeNull()
      expect(textoDoEvento('antes', contato({ fazendas: [4] }), FAZENDAS, POR_CELULA, em(18, 30))).toBeNull()
    })
  })

  describe('respostas aos comandos', () => {
    it('ATIVAR, com as fazendas em ordem alfabética', () => {
      expect(textoAtivado(contato(), ['Fazenda B', 'Fazenda A']))
        .toBe('✅ Pronto, Bruno! Você vai receber aqui os alertas de janela de risco do Locks SAT de: Fazenda A, Fazenda B. Para parar, responda SAIR.')
    })
    it('ATIVAR, sem fazendas', () => {
      expect(textoAtivado(contato(), []))
        .toBe('✅ Pronto, Bruno! Você vai receber aqui os alertas de janela de risco do Locks SAT de: suas fazendas. Para parar, responda SAIR.')
    })
    it('SAIR', () => {
      expect(textoSaiu(contato())).toBe('👋 Certo, Bruno. Você não vai mais receber os alertas. Para voltar, mande ATIVAR.')
    })
  })
})
