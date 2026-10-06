import { beforeEach, describe, expect, it } from 'vitest'
import fonte from './memoriaDoMapa.ts?raw'
import { guardarMemoriaDoMapa, lerMemoriaDoMapa, limparMemoriaDoMapa } from './memoriaDoMapa'

const DIA = new Date(2026, 8, 23).getTime()

beforeEach(() => limparMemoriaDoMapa())

describe('memória do mapa', () => {
  it('começa em Cintilação, ao vivo (hoje, acompanhando o passo mais novo)', () => {
    expect(lerMemoriaDoMapa()).toEqual({ camada: 'sci', dia: null, escolhido: null, aoVivo: true, velocidade: 1 })
  })

  it('guardar mexe só no que veio: o resto fica', () => {
    guardarMemoriaDoMapa({ camada: 'tec' })
    guardarMemoriaDoMapa({ dia: DIA, escolhido: 5 })
    expect(lerMemoriaDoMapa()).toEqual({ camada: 'tec', dia: DIA, escolhido: 5, aoVivo: true, velocidade: 1 })
    guardarMemoriaDoMapa({ dia: null, escolhido: null, aoVivo: false, velocidade: 1 })
    expect(lerMemoriaDoMapa()).toEqual({ camada: 'tec', dia: null, escolhido: null, aoVivo: false, velocidade: 1 })
  })

  it('a velocidade do play começa em 1× e é guardada sem mexer no resto', () => {
    expect(lerMemoriaDoMapa().velocidade).toBe(1)
    guardarMemoriaDoMapa({ velocidade: 4 })
    expect(lerMemoriaDoMapa()).toEqual({ camada: 'sci', dia: null, escolhido: null, aoVivo: true, velocidade: 4 })
    guardarMemoriaDoMapa({ camada: 'tec' })
    expect(lerMemoriaDoMapa().velocidade).toBe(4)
  })

  it('quem lê recebe uma cópia: mexer nela não muda a memória', () => {
    const lida = lerMemoriaDoMapa()
    lida.camada = 'off'
    expect(lerMemoriaDoMapa().camada).toBe('sci')
  })

  it('limpar volta ao começo', () => {
    guardarMemoriaDoMapa({ camada: 'off', dia: DIA, escolhido: 9, aoVivo: false, velocidade: 8 })
    limparMemoriaDoMapa()
    expect(lerMemoriaDoMapa()).toEqual({ camada: 'sci', dia: null, escolhido: null, aoVivo: true, velocidade: 1 })
  })

  it('não importa nada (nem o Leaflet): o App a usa sem puxar o pacote do mapa', () => {
    expect(fonte).not.toMatch(/^\s*import\b/m)
    expect(fonte).not.toMatch(/from\s+['"]/)
  })
})
