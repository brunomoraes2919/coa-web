import { beforeEach, describe, expect, it } from 'vitest'
import type { AlertaGnss } from '../tipos'
import { MEMORIA_INICIAL } from './avaliar'
import { ESTADO_INICIAL } from './estado'
import {
  CHAVE_ALERTAS, CHAVE_ESTADO, CHAVE_MEMORIA, gravar, ler, lerAlertas, lerEstado, lerMemoria, podarAlertas,
  RETENCAO_ALERTAS_MS,
} from './persistencia'

const AGORA = Date.UTC(2026, 8, 24, 22, 0)
const alerta = (id: string, instante: number): AlertaGnss => ({
  id, instante, tipo: 'cintilacao', severidade: 'aviso', fazendas: ['Dourado'], texto: id,
})

/** O que uma extensão, uma versão antiga ou a mão de alguém pode deixar lá. */
const LIXO = ['null', '{}', '[]', '42', '"texto"', '{x']

beforeEach(() => localStorage.clear())

describe('persistência', () => {
  it('grava e lê de volta; chave vazia ou corrompida devolve o padrão', () => {
    gravar('k', { a: 1 })
    expect(ler('k', null)).toEqual({ a: 1 })
    expect(ler('nada', 7)).toBe(7)
    localStorage.setItem('ruim', '{x')
    expect(ler('ruim', 'padrao')).toBe('padrao')
  })

  it('poda: 7 dias, mais novo primeiro', () => {
    const lista = podarAlertas([
      alerta('velho', AGORA - RETENCAO_ALERTAS_MS - 1),
      alerta('ontem', AGORA - 86_400_000),
      alerta('agora', AGORA),
    ], AGORA)
    expect(lista.map((a) => a.id)).toEqual(['agora', 'ontem'])
  })
})

describe('leitores com validação', () => {
  it('estado: o que foi gravado volta igual', () => {
    const estado = {
      fazendas: [{ id: 'f1', nome: 'Dourado', lat: -12.26, lon: -50.31, celulaId: '-12.5_-50.5' }],
      celulas: { '-12.5_-50.5': { serie: [], janelas: [] } },
      ultimoSucesso: AGORA,
      falhasSeguidas: 2,
      erro: 'rede' as const,
    }
    gravar(CHAVE_ESTADO, estado)
    expect(lerEstado()).toEqual(estado)
  })

  it('estado: ausente, "null", tipos errados → estado inicial (cópia nova)', () => {
    expect(lerEstado()).toEqual(ESTADO_INICIAL)
    for (const bruto of LIXO) {
      localStorage.setItem(CHAVE_ESTADO, bruto)
      expect(lerEstado(), bruto).toEqual(ESTADO_INICIAL)
    }
    const errados = [
      { ...ESTADO_INICIAL, fazendas: null },
      { ...ESTADO_INICIAL, fazendas: {} },
      { ...ESTADO_INICIAL, celulas: null },
      { ...ESTADO_INICIAL, celulas: [] },
      { ...ESTADO_INICIAL, ultimoSucesso: '12:00' },
      { ...ESTADO_INICIAL, falhasSeguidas: null },
      { ...ESTADO_INICIAL, erro: 3 },
    ]
    for (const e of errados) {
      gravar(CHAVE_ESTADO, e)
      expect(lerEstado(), JSON.stringify(e)).toEqual(ESTADO_INICIAL)
    }
    const a = lerEstado()
    a.fazendas.push({ id: 'x', nome: 'x', lat: null, lon: null, celulaId: null })
    a.celulas.x = { serie: [], janelas: [] }
    expect(ESTADO_INICIAL.fazendas).toEqual([])
    expect(ESTADO_INICIAL.celulas).toEqual({})
  })

  it('alertas: lista válida volta igual; itens malformados saem; o resto → []', () => {
    gravar(CHAVE_ALERTAS, [alerta('a1', AGORA)])
    expect(lerAlertas()).toEqual([alerta('a1', AGORA)])

    gravar(CHAVE_ALERTAS, [
      alerta('ok', AGORA), null, 7, { id: 1, instante: AGORA, texto: 'x' },
      { id: 'sem-instante', texto: 'x', fazendas: [] }, { id: 'sem-texto', instante: AGORA, fazendas: [] },
      { id: 'sem-fazendas', instante: AGORA, texto: 'x' },
    ])
    expect(lerAlertas().map((a) => a.id)).toEqual(['ok'])

    expect(lerAlertas()).not.toBe(lerAlertas())
    for (const bruto of LIXO) {
      localStorage.setItem(CHAVE_ALERTAS, bruto)
      expect(lerAlertas(), bruto).toEqual([])
    }
  })

  it('memória: a gravada volta igual; ausente, "null", tipos errados → memória inicial', () => {
    const memoria = {
      episodios: { 'cintilacao:a': { severidade: 'critico' as const, desde: AGORA, abaixoDesde: null } },
      data: '2026-09-24',
      janelasAvisadas: ['a:1270:dia'],
      ultimaAvaliacao: AGORA,
    }
    gravar(CHAVE_MEMORIA, memoria)
    expect(lerMemoria()).toEqual(memoria)

    localStorage.removeItem(CHAVE_MEMORIA)
    expect(lerMemoria()).toEqual(MEMORIA_INICIAL)
    for (const bruto of LIXO) {
      localStorage.setItem(CHAVE_MEMORIA, bruto)
      expect(lerMemoria(), bruto).toEqual(MEMORIA_INICIAL)
    }
    for (const m of [{ ...memoria, episodios: null }, { ...memoria, janelasAvisadas: 'a' }, { ...memoria, episodios: [] }]) {
      gravar(CHAVE_MEMORIA, m)
      expect(lerMemoria(), JSON.stringify(m)).toEqual(MEMORIA_INICIAL)
    }
  })
})
