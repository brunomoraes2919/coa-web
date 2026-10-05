import { describe, expect, it } from 'vitest'
import { CHAVE_FUNDO, FUNDO_PADRAO, FUNDOS, gravarFundo, lerFundo, ORDEM_FUNDOS } from './fundos'

const guarda = (valor: string | null) => ({ getItem: () => valor })

describe('fundos do mapa', () => {
  it('quatro fundos, satélite por padrão e com os nomes por cima', () => {
    expect(ORDEM_FUNDOS).toEqual(['satelite', 'topo', 'claro', 'escuro'])
    expect(FUNDO_PADRAO).toBe('satelite')
    expect(FUNDOS.satelite.url).toContain('World_Imagery')
    expect(FUNDOS.satelite.rotulos).toContain('World_Boundaries_and_Places')
    expect(FUNDOS.topo.rotulos).toBeUndefined()
  })

  it('lê a escolha guardada; valor desconhecido ou sem armazenamento volta ao padrão', () => {
    expect(lerFundo(guarda('topo'))).toBe('topo')
    expect(lerFundo(guarda(null))).toBe('satelite')
    expect(lerFundo(guarda('toString'))).toBe('satelite')
    expect(lerFundo({ getItem: () => { throw new Error('bloqueado') } })).toBe('satelite')
  })

  it('grava a escolha e não quebra sem armazenamento', () => {
    const gravados: [string, string][] = []
    gravarFundo('escuro', { setItem: (k, v) => { gravados.push([k, v]) } })
    expect(gravados).toEqual([[CHAVE_FUNDO, 'escuro']])
    expect(() => gravarFundo('claro', { setItem: () => { throw new Error('cheio') } })).not.toThrow()
  })
})
