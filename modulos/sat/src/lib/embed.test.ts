import { afterEach, describe, expect, it, vi } from 'vitest'
import { avisarAlerta, avisarResumo, avisarRota, dentroDoCoa, emEmbed, tituloDaRota } from './embed'

const paiDeVerdade = window.parent

/** Põe o módulo "dentro" de uma janela pai falsa, com ou sem ?embed=1 na URL. */
function comPai(search: string, postMessage = vi.fn()) {
  window.history.replaceState(null, '', `/${search}`)
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } })
  return postMessage
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
  Object.defineProperty(window, 'parent', { configurable: true, value: paiDeVerdade })
})

describe('modo embutido', () => {
  it('?embed=1 liga', () => {
    expect(emEmbed({ search: '?embed=1' })).toBe(true)
    expect(emEmbed({ search: '' })).toBe(false)
    expect(emEmbed({ search: '?embed=0' })).toBe(false)
  })

  it('título de cada rota', () => {
    expect(tituloDaRota('/hoje')).toBe('Hoje')
    expect(tituloDaRota('/mapa')).toBe('Mapa da ionosfera')
    expect(tituloDaRota('/alertas')).toBe('Alertas')
    expect(tituloDaRota('/outra')).toBe('Locks SAT')
  })

  it('avisa o COA WEB da rota, do alerta e do resumo, sempre para a mesma origem', () => {
    const postMessage = comPai('?embed=1')
    avisarRota('/mapa')
    avisarAlerta({ id: 'a1', titulo: 'Cintilação forte', texto: 'em Dourado', severidade: 'critico' })
    avisarResumo('Tudo tranquilo agora')
    expect(postMessage.mock.calls).toEqual([
      [{ tipo: 'sat-rota', rota: '/mapa', titulo: 'Mapa da ionosfera' }, window.location.origin],
      [{ tipo: 'sat-alerta', id: 'a1', titulo: 'Cintilação forte', texto: 'em Dourado', severidade: 'critico' }, window.location.origin],
      [{ tipo: 'sat-resumo', texto: 'Tudo tranquilo agora' }, window.location.origin],
    ])
  })

  it('fora de embed não manda nada', () => {
    const postMessage = comPai('')
    avisarRota('/mapa')
    avisarResumo('x')
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('em embed mas sem iframe (a janela é o topo) não manda nada nem lança', () => {
    window.history.replaceState(null, '', '/?embed=1')
    expect(window.parent).toBe(window)
    const espiao = vi.spyOn(window, 'postMessage')
    avisarRota('/hoje')
    avisarResumo('x')
    expect(espiao).not.toHaveBeenCalled()
    espiao.mockRestore()
  })

  it('postMessage que lança não escapa de avisarAlerta, avisarRota nem avisarResumo', () => {
    comPai('?embed=1', vi.fn(() => {
      throw new DOMException('fechado', 'DataCloneError')
    }))
    expect(() => avisarAlerta({ id: 'a1', titulo: 't', texto: 'x', severidade: 'aviso' })).not.toThrow()
    expect(() => avisarRota('/hoje')).not.toThrow()
    expect(() => avisarResumo('x')).not.toThrow()
  })
})

describe('dentroDoCoa', () => {
  it('embed + iframe: dentro do COA WEB', () => {
    comPai('?embed=1')
    expect(dentroDoCoa()).toBe(true)
  })

  it('embed sem iframe (aberto direto com ?embed=1): fora', () => {
    window.history.replaceState(null, '', '/?embed=1')
    expect(window.parent).toBe(window)
    expect(dentroDoCoa()).toBe(false)
  })

  it('iframe sem embed: fora', () => {
    comPai('')
    expect(dentroDoCoa()).toBe(false)
  })

  it('nem embed nem iframe: fora', () => {
    expect(dentroDoCoa()).toBe(false)
  })
})
