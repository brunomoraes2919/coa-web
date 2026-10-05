import { describe, expect, it } from 'vitest'
import type { FazendaGnss, Janela, PontoIono } from '../tipos'
import { avaliar, MEMORIA_INICIAL, nivelAtual, resumoDoVigia } from './avaliar'
import { ESTADO_INICIAL, type EstadoVigia } from './estado'

const local = (h: number, m: number, dia = 24) => new Date(2026, 8, dia, h, m).getTime()
const min = (n: number) => n * 60_000
const FAZENDAS: FazendaGnss[] = [
  { id: 'f1', nome: 'Dourado', lat: -12.26, lon: -50.31, celulaId: 'a' },
  { id: 'f2', nome: 'Siriema', lat: -12.3, lon: -50.4, celulaId: 'a' },
  { id: 'f3', nome: 'São Miguel', lat: null, lon: null, celulaId: null },
]

function p(instante: number, extra: Partial<PontoIono> = {}): PontoIono {
  return { instante, indice: 2, tec: 10, cintilacao: 0, previsto: false, ...extra }
}

function estado(serie: PontoIono[], janelas: Janela[] = []): EstadoVigia {
  return { ...ESTADO_INICIAL, fazendas: FAZENDAS, celulas: { a: { serie, janelas } }, ultimoSucesso: 1 }
}

describe('avaliar', () => {
  it('cintilação forte medida agora vira um alerta crítico com as fazendas do quadrado', () => {
    const agora = local(22, 0)
    const r = avaliar(estado([p(agora - min(5), { cintilacao: 72 })]), MEMORIA_INICIAL, agora)
    expect(r.alertas).toHaveLength(1)
    expect(r.alertas[0]).toMatchObject({ tipo: 'cintilacao', severidade: 'critico', fazendas: ['Dourado', 'Siriema'] })
  })

  it('o ciclo seguinte, igual, não repete o alerta', () => {
    const agora = local(22, 0)
    const e = estado([p(agora - min(5), { cintilacao: 72 })])
    const r1 = avaliar(e, MEMORIA_INICIAL, agora)
    expect(r1.memoria.ultimaAvaliacao).toBe(agora)
    expect(avaliar(e, r1.memoria, agora + min(10)).alertas).toEqual([])
  })

  it('memória de outra sessão (navegador fechado à noite) não cala a cintilação do dia seguinte', () => {
    const ontem = local(23, 0, 24)
    const r1 = avaliar(estado([p(ontem - min(5), { cintilacao: 72 })]), MEMORIA_INICIAL, ontem)
    expect(r1.alertas.map((a) => a.severidade)).toEqual(['critico'])

    const hoje = local(20, 0, 25)
    const r2 = avaliar(estado([p(hoje - min(5), { cintilacao: 40 })]), r1.memoria, hoje)
    expect(r2.alertas.map((a) => [a.tipo, a.severidade])).toEqual([['cintilacao', 'aviso']])
    expect(r2.memoria.ultimaAvaliacao).toBe(hoje)
  })

  it('previsão de índice 8 nas próximas 3 h vira alerta crítico de previsão', () => {
    const agora = local(18, 0)
    const r = avaliar(
      estado([p(agora - min(5)), p(agora + min(60), { previsto: true, cintilacao: null, indice: 8 })]),
      MEMORIA_INICIAL,
      agora,
    )
    expect(r.alertas.map((a) => [a.tipo, a.severidade])).toEqual([['previsao', 'critico']])
    expect(r.alertas[0].texto).toContain('índice ionosférico 8 a partir de 19:00')
  })

  it('janela do histórico avisa de manhã e 30 min antes, uma vez cada', () => {
    const janelas = [{ inicio: 1270, fim: 1330, dias: 5 }]
    const manha = avaliar(estado([], janelas), MEMORIA_INICIAL, local(8, 0))
    expect(manha.alertas.map((a) => a.tipo)).toEqual(['janela'])
    expect(avaliar(estado([], janelas), manha.memoria, local(9, 0)).alertas).toEqual([])
    const antes = avaliar(estado([], janelas), manha.memoria, local(20, 45))
    expect(antes.alertas[0].texto).toContain('começa em breve')
  })

  it('no dia seguinte a janela avisa de novo', () => {
    const janelas = [{ inicio: 1270, fim: 1330, dias: 5 }]
    const hoje = avaliar(estado([], janelas), MEMORIA_INICIAL, local(8, 0))
    const amanha = avaliar(estado([], janelas), hoje.memoria, local(8, 0, 25))
    expect(amanha.alertas.map((a) => a.tipo)).toEqual(['janela'])
  })

  it('medida velha não gera alerta', () => {
    const agora = local(22, 0)
    expect(avaliar(estado([p(agora - min(45), { cintilacao: 90 })]), MEMORIA_INICIAL, agora).alertas).toEqual([])
  })
})

describe('nivelAtual e resumo', () => {
  it('nível da fazenda pelo quadrado; sem localização é sem dado', () => {
    const agora = local(22, 0)
    const e = estado([p(agora - min(5), { cintilacao: 40 })])
    expect(nivelAtual(e, 'a', agora)).toEqual({ nivel: 'media', valor: 40, instante: agora - min(5) })
    expect(nivelAtual(e, null, agora).nivel).toBe('sem-dado')
    expect(resumoDoVigia(e, agora)).toBe('Agora: média em 2 fazendas')
  })

  it('sem nenhuma fazenda para acompanhar: resumo vazio', () => {
    const e: EstadoVigia = { ...estado([]), fazendas: [] }
    expect(resumoDoVigia(e, local(22, 0))).toBe('')
  })

  it('três falhas seguidas: sem dados', () => {
    const e: EstadoVigia = { ...estado([]), falhasSeguidas: 3, erro: 'rede' }
    expect(resumoDoVigia(e, local(22, 0))).toBe('Sem dados da Trimble')
  })
})
