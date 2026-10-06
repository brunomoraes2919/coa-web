// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { describe, expect, it } from 'vitest'
import { fazendasDoContato, montarMensagem, textoAtivado, textoDoEvento, textoSaiu } from './mensagens'
import type { ContatoWpp, FazendaServidor } from './tipos'

const em = (h: number, m = 0) => new Date(2026, 9, 6, h, m).getTime()
const fazenda = (id: string, coaId: number, nome: string, celulaId: string | null): FazendaServidor =>
  ({ id, coaId, nome, celulaId, lat: celulaId ? -12.26 : null, lon: celulaId ? -50.31 : null })
const FAZENDAS = [fazenda('a', 1, 'Globo', 'c1'), fazenda('b', 2, 'Nebraska', 'c2'), fazenda('c', 3, 'Três Flechas', 'c2'), fazenda('d', 4, 'Sem Talhão', null)]
const contato = (extra: Partial<ContatoWpp> = {}): ContatoWpp => ({
  id: 'x', nome: 'João da Silva', telefone: '5565999990001', todasFazendas: false, fazendas: [2], alertaJanela: true,
  ativo: true, confirmadoEm: '2026-10-01T00:00:00Z', confirmadoPor: 'mensagem', jid: null, ...extra,
})
const NOITE = { inicio: 19 * 60, fim: 21 * 60 + 30, dias: 5 }
const TARDE = { inicio: 21 * 60 + 50, fim: 22 * 60, dias: 3 }
const POR_CELULA = { c1: [TARDE], c2: [NOITE] }

describe('mensagens', () => {
  it('o contato acompanha as fazendas dele que têm quadrado; "todas" pega todas', () => {
    expect(fazendasDoContato(contato(), FAZENDAS).map((f) => f.nome)).toEqual(['Nebraska'])
    expect(fazendasDoContato(contato({ todasFazendas: true, fazendas: [] }), FAZENDAS).map((f) => f.nome)).toEqual(['Globo', 'Nebraska', 'Três Flechas'])
  })
  it('resumo: o mesmo texto da tela, só com as fazendas da pessoa', () => {
    expect(textoDoEvento('resumo-07', contato(), FAZENDAS, POR_CELULA, em(7)))
      .toBe('Janelas de risco de cintilação hoje entre 19:00 e 21:30 em Nebraska. Pior horário: 19:00–21:30 (5 de 7 dias).')
    expect(textoDoEvento('resumo-07', contato({ todasFazendas: true }), FAZENDAS, POR_CELULA, em(7)))
      .toBe('Janelas de risco de cintilação hoje entre 19:00 e 22:00 em 3 fazendas: Globo, Nebraska, Três Flechas. Pior horário: 19:00–21:30 (5 de 7 dias).')
  })
  it('sem janela nas fazendas da pessoa, não há texto', () => {
    expect(textoDoEvento('resumo-07', contato({ fazendas: [4] }), FAZENDAS, POR_CELULA, em(7))).toBeNull()
    expect(textoDoEvento('resumo-07', contato(), FAZENDAS, { c1: [TARDE], c2: [] }, em(7))).toBeNull()
  })
  it('janela que já acabou não entra no resumo nem no lembrete', () => {
    expect(textoDoEvento('lembrete-12', contato(), FAZENDAS, { c2: [{ inicio: 60, fim: 120, dias: 4 }] }, em(12))).toBeNull()
  })
  it('lembrete do meio-dia: curto e com outras palavras', () => {
    expect(textoDoEvento('lembrete-12', contato(), FAZENDAS, POR_CELULA, em(12)))
      .toBe('Lembrete: janela de risco de cintilação hoje a partir de 19:00 em Nebraska.')
    expect(textoDoEvento('lembrete-12', contato({ todasFazendas: true }), FAZENDAS, POR_CELULA, em(12)))
      .toBe('Lembrete: janela de risco de cintilação hoje a partir de 19:00 em 3 fazendas: Globo, Nebraska, Três Flechas.')
  })
  it('"começa em breve": só a janela que começa primeiro, com as fazendas dela', () => {
    const todas = contato({ todasFazendas: true })
    expect(textoDoEvento('antes', todas, FAZENDAS, POR_CELULA, em(18, 29))).toBeNull()
    expect(textoDoEvento('antes', todas, FAZENDAS, POR_CELULA, em(18, 30)))
      .toBe('Janela de risco de cintilação começa em breve: 19:00–21:30 (5 de 7 dias) em 2 fazendas: Nebraska, Três Flechas.')
  })
  it('mensagem inteira: título, saudação pela hora com o primeiro nome, texto e SAIR só quando pedido', () => {
    expect(montarMensagem(contato(), 'Texto.', em(7), true))
      .toBe('*Locks SAT · Janela de risco*\nBom dia, João.\nTexto.\nPara parar de receber, responda SAIR.')
    expect(montarMensagem(contato(), 'Texto.', em(12), false)).toBe('*Locks SAT · Janela de risco*\nBoa tarde, João.\nTexto.')
    expect(montarMensagem(contato(), 'Texto.', em(18, 30), false)).toContain('Boa noite, João.')
  })
  it('respostas de ATIVAR e SAIR', () => {
    expect(textoAtivado(contato(), ['Nebraska']))
      .toBe('Pronto, João. Você vai receber aqui os alertas de janela de risco do Locks SAT de: Nebraska. Para parar, responda SAIR.')
    expect(textoSaiu(contato())).toBe('Certo, João. Você não vai mais receber os alertas. Para voltar, mande ATIVAR.')
  })
})
