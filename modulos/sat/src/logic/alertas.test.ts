import { describe, expect, it } from 'vitest'
import type { AlertaGnss } from '../tipos'
import { avisosDeJanela, limitarAvisos, listarFazendas, montarAlertas, resumoAgora, tituloAlerta, type Ocorrencia } from './alertas'

const local = (h: number, m: number) => new Date(2026, 8, 24, h, m).getTime()
const AGORA = local(22, 0)
const POR_CELULA: Record<string, string[]> = { a: ['Siriema', 'Fazenda Globo'], b: ['Dourado'], c: [] }

function oc(extra: Partial<Ocorrencia>): Ocorrencia {
  return { tipo: 'cintilacao', severidade: 'critico', celulaId: 'a', valor: 70, instante: AGORA, ...extra }
}

describe('listarFazendas', () => {
  it('uma fazenda pelo nome; várias com a contagem; mais de 3 resumidas', () => {
    expect(listarFazendas(['Dourado'])).toBe('Dourado')
    expect(listarFazendas(['Siriema', 'Dourado'])).toBe('2 fazendas: Dourado, Siriema')
    expect(listarFazendas(['E', 'D', 'C', 'B', 'A'])).toBe('5 fazendas: A, B, C e mais 2')
  })
})

describe('montarAlertas', () => {
  it('agrupa o mesmo tipo e severidade num alerta só, com o pico', () => {
    const alertas = montarAlertas([oc({ celulaId: 'a', valor: 70 }), oc({ celulaId: 'b', valor: 81.6 })], POR_CELULA, AGORA)
    expect(alertas).toHaveLength(1)
    expect(alertas[0]).toMatchObject({
      tipo: 'cintilacao', severidade: 'critico', fazendas: ['Dourado', 'Fazenda Globo', 'Siriema'],
    })
    expect(alertas[0].texto).toBe(
      'Cintilação forte agora em 3 fazendas: Dourado, Fazenda Globo, Siriema (até 82 de 100).',
    )
  })

  it('severidades diferentes viram alertas diferentes, crítico primeiro', () => {
    const alertas = montarAlertas([oc({ celulaId: 'b', severidade: 'aviso', valor: 40 }), oc({ celulaId: 'a' })], POR_CELULA, AGORA)
    expect(alertas.map((a) => a.severidade)).toEqual(['critico', 'aviso'])
    expect(alertas[1].texto).toBe('Cintilação média agora em Dourado (até 40 de 100).')
  })

  it('previsão diz o índice de pico e a primeira hora', () => {
    const [a] = montarAlertas([
      oc({ tipo: 'previsao', celulaId: 'b', valor: 8, instante: local(23, 10) }),
      oc({ tipo: 'previsao', celulaId: 'a', valor: 9, instante: local(23, 40) }),
    ], POR_CELULA, AGORA)
    expect(a.texto).toBe(
      'Previsão: índice ionosférico 9 a partir de 23:10 em 3 fazendas: Dourado, Fazenda Globo, Siriema.',
    )
  })

  it('janela traz o horário e quantos dias', () => {
    const [a] = montarAlertas([oc({
      tipo: 'janela', severidade: 'aviso', celulaId: 'b', valor: 5,
      janela: { inicio: 1270, fim: 1470, dias: 5 }, momento: 'dia',
    })], POR_CELULA, AGORA)
    expect(a.texto).toBe(
      'Janelas de risco de cintilação hoje entre 21:10 e 00:30 em Dourado. Pior horário: 21:10–00:30 (5 de 7 dias).',
    )
  })

  it('resumo do dia: janelas de todos os quadrados num alerta só, com o pior horário', () => {
    const alertas = montarAlertas([
      oc({ tipo: 'janela', severidade: 'aviso', celulaId: 'a', valor: 4, janela: { inicio: 1170, fim: 1290, dias: 4 }, momento: 'dia' }),
      oc({ tipo: 'janela', severidade: 'aviso', celulaId: 'b', valor: 5, janela: { inicio: 1310, fim: 1350, dias: 5 }, momento: 'dia' }),
    ], POR_CELULA, AGORA)
    expect(alertas).toHaveLength(1)
    expect(alertas[0].fazendas).toEqual(['Dourado', 'Fazenda Globo', 'Siriema'])
    expect(alertas[0].texto).toBe(
      'Janelas de risco de cintilação hoje entre 19:30 e 22:30 em 3 fazendas: Dourado, Fazenda Globo, Siriema. Pior horário: 21:50–22:30 (5 de 7 dias).',
    )
  })

  it('"começa em breve" continua um alerta por janela, com o texto próprio', () => {
    const alertas = montarAlertas([
      oc({ tipo: 'janela', severidade: 'aviso', celulaId: 'b', valor: 4, janela: { inicio: 1270, fim: 1330, dias: 4 }, momento: 'antes' }),
      oc({ tipo: 'janela', severidade: 'aviso', celulaId: 'a', valor: 4, janela: { inicio: 1270, fim: 1330, dias: 4 }, momento: 'antes' }),
      oc({ tipo: 'janela', severidade: 'aviso', celulaId: 'b', valor: 3, janela: { inicio: 1360, fim: 1400, dias: 3 }, momento: 'antes' }),
    ], POR_CELULA, AGORA)
    expect(alertas.map((a) => a.texto)).toEqual([
      'Janela de risco de cintilação começa em breve: 21:10–22:10 (4 de 7 dias) em 3 fazendas: Dourado, Fazenda Globo, Siriema.',
      'Janela de risco de cintilação começa em breve: 22:40–23:20 (3 de 7 dias) em Dourado.',
    ])
  })

  it('quadrado sem fazenda não gera alerta', () => {
    expect(montarAlertas([oc({ celulaId: 'c' })], POR_CELULA, AGORA)).toEqual([])
  })
})

describe('limitarAvisos', () => {
  const alerta = (id: string, severidade: AlertaGnss['severidade']): AlertaGnss => (
    { id, instante: AGORA, tipo: 'cintilacao', severidade, fazendas: ['Dourado'], texto: '' }
  )

  it('passou do limite: saem os avisos mais antigos, os críticos ficam', () => {
    const lista = [alerta('c1', 'critico'), alerta('c2', 'critico'), alerta('a1', 'aviso'), alerta('a2', 'aviso')]
    expect(limitarAvisos(lista, 3).map((a) => a.id)).toEqual(['c1', 'c2', 'a2'])
  })

  it('fila só de críticos: sai o mais antigo', () => {
    const lista = [alerta('c1', 'critico'), alerta('c2', 'critico'), alerta('c3', 'critico'), alerta('c4', 'critico')]
    expect(limitarAvisos(lista, 3).map((a) => a.id)).toEqual(['c2', 'c3', 'c4'])
  })

  it('dentro do limite: devolve igual, sem mexer na lista original', () => {
    const lista = [alerta('a1', 'aviso'), alerta('c1', 'critico')]
    const r = limitarAvisos(lista, 3)
    expect(r.map((a) => a.id)).toEqual(['a1', 'c1'])
    expect(r).not.toBe(lista)
  })
})

describe('avisosDeJanela', () => {
  const j = { inicio: 1270, fim: 1330, dias: 4 }
  const j2 = { inicio: 1360, fim: 1400, dias: 3 }

  it('de manhã: aviso do dia, uma vez', () => {
    const r = avisosDeJanela('b', [j], local(8, 0), new Set())
    expect(r.ocorrencias.map((o) => o.momento)).toEqual(['dia'])
    expect(avisosDeJanela('b', [j], local(8, 10), new Set(r.novasChaves)).ocorrencias).toEqual([])
  })

  it('30 min antes: aviso de começo, mesmo já avisado de manhã', () => {
    const r = avisosDeJanela('b', [j], local(20, 45), new Set(['b:dia']))
    expect(r.ocorrencias.map((o) => o.momento)).toEqual(['antes'])
  })

  it('duas janelas no mesmo quadrado: o resumo leva as duas, com uma chave só por dia', () => {
    const r = avisosDeJanela('b', [j, j2], local(8, 0), new Set())
    expect(r.ocorrencias.map((o) => [o.momento, o.janela, o.valor])).toEqual([
      ['dia', j, 4],
      ['dia', j2, 3],
    ])
    expect(r.novasChaves).toEqual(['b:dia'])
    const repetida = avisosDeJanela('b', [j, j2], local(8, 10), new Set(r.novasChaves))
    expect(repetida).toEqual({ novasChaves: [], ocorrencias: [] })
  })

  it('"começa em breve" só uma vez por noite por quadrado, para a primeira janela', () => {
    const r = avisosDeJanela('b', [j, j2], local(20, 45), new Set(['b:dia']))
    expect(r.ocorrencias.map((o) => [o.momento, o.janela])).toEqual([['antes', j]])
    expect(r.novasChaves).toEqual(['b:antes'])
    // 22:20: a segunda janela começa em 20 min, mas a noite já foi avisada.
    const depois = avisosDeJanela('b', [j, j2], local(22, 20), new Set(['b:dia', 'b:antes']))
    expect(depois).toEqual({ novasChaves: [], ocorrencias: [] })
  })

  it('primeira abertura do dia perto da janela: resumo e "começa em breve", independentes', () => {
    const r = avisosDeJanela('b', [j, j2], local(20, 45), new Set())
    expect(r.ocorrencias.map((o) => [o.momento, o.janela])).toEqual([['dia', j], ['dia', j2], ['antes', j]])
    expect(r.novasChaves).toEqual(['b:dia', 'b:antes'])
  })

  it('janela que já passou não avisa', () => {
    expect(avisosDeJanela('b', [{ inicio: 60, fim: 120, dias: 3 }], local(8, 0), new Set()).ocorrencias).toEqual([])
  })

  it('janela que já passou fica fora do resumo; só as que ainda vêm entram', () => {
    const r = avisosDeJanela('b', [{ inicio: 60, fim: 120, dias: 3 }, j], local(8, 0), new Set())
    expect(r.ocorrencias.map((o) => o.janela)).toEqual([j])
  })
})

describe('título e resumo', () => {
  const base: AlertaGnss = { id: '1', instante: AGORA, tipo: 'cintilacao', severidade: 'critico', fazendas: ['Dourado'], texto: '' }

  it('título por tipo', () => {
    expect(tituloAlerta(base)).toBe('Cintilação forte')
    expect(tituloAlerta({ ...base, severidade: 'aviso' })).toBe('Cintilação média')
    expect(tituloAlerta({ ...base, tipo: 'previsao' })).toBe('Previsão ionosférica — crítico')
    expect(tituloAlerta({ ...base, tipo: 'janela', severidade: 'aviso' })).toBe('Janela de risco de cintilação')
    expect(tituloAlerta({ ...base, fazendas: [] })).toBe('Locks SAT')
  })

  it('resumo para o card do COA WEB', () => {
    expect(resumoAgora(['forte', 'forte', 'media'], false)).toBe('Agora: forte em 2 fazendas')
    expect(resumoAgora(['media', 'minima'], false)).toBe('Agora: média em 1 fazenda')
    expect(resumoAgora(['minima'], false)).toBe('Tudo tranquilo agora')
    expect(resumoAgora(['sem-dado'], false)).toBe('Aguardando dados')
    expect(resumoAgora(['forte'], true)).toBe('Sem dados da Trimble')
  })

  it('usuário sem nenhuma fazenda com talhões: resumo vazio (o card do COA WEB fica sem linha), não "Aguardando dados" para sempre', () => {
    expect(resumoAgora([], false)).toBe('')
    // Falha da Trimble continua sendo dita, mesmo sem fazenda na conta.
    expect(resumoAgora([], true)).toBe('Sem dados da Trimble')
  })

  it('falta de medida nunca vira "Tudo tranquilo"', () => {
    expect(resumoAgora(['minima', 'sem-dado'], false)).toBe('Sem medida recente em 1 fazenda')
    expect(resumoAgora(['sem-dado', 'minima', 'sem-dado'], false)).toBe('Sem medida recente em 2 fazendas')
    expect(resumoAgora(['sem-dado', 'sem-dado'], false)).toBe('Aguardando dados')
    expect(resumoAgora(['media', 'sem-dado'], false)).toBe('Agora: média em 1 fazenda')
  })
})
