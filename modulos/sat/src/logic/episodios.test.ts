import { describe, expect, it } from 'vitest'
import { avancarEpisodios, FIM_EPISODIO_MS, type MapaEpisodios } from './episodios'

const T0 = Date.UTC(2026, 8, 24, 22, 0)
const min = (n: number) => n * 60_000
const K = 'cintilacao:-12.5_-50.5'

describe('avancarEpisodios', () => {
  it('abre episódio e dispara ao entrar em aviso', () => {
    const r = avancarEpisodios({}, [{ chave: K, severidade: 'aviso' }], T0)
    expect(r.disparos).toEqual([{ chave: K, severidade: 'aviso' }])
    expect(r.episodios[K]).toEqual({ severidade: 'aviso', desde: T0, abaixoDesde: null })
  })

  it('não repete enquanto segue na mesma severidade', () => {
    const a = avancarEpisodios({}, [{ chave: K, severidade: 'aviso' }], T0)
    const b = avancarEpisodios(a.episodios, [{ chave: K, severidade: 'aviso' }], T0 + min(10))
    expect(b.disparos).toEqual([])
  })

  it('dispara de novo só quando SOBE para crítico', () => {
    const a = avancarEpisodios({}, [{ chave: K, severidade: 'aviso' }], T0)
    const b = avancarEpisodios(a.episodios, [{ chave: K, severidade: 'critico' }], T0 + min(10))
    expect(b.disparos).toEqual([{ chave: K, severidade: 'critico' }])
    const c = avancarEpisodios(b.episodios, [{ chave: K, severidade: 'aviso' }], T0 + min(20))
    expect(c.disparos).toEqual([])
    expect(c.episodios[K].severidade).toBe('critico')
  })

  it('volta antes de 30 min abaixo: mesmo episódio, sem disparo', () => {
    const a = avancarEpisodios({}, [{ chave: K, severidade: 'aviso' }], T0)
    const b = avancarEpisodios(a.episodios, [{ chave: K, severidade: null }], T0 + min(10))
    const c = avancarEpisodios(b.episodios, [{ chave: K, severidade: null }], T0 + min(30))
    const d = avancarEpisodios(c.episodios, [{ chave: K, severidade: 'aviso' }], T0 + min(35))
    expect(d.disparos).toEqual([])
    expect(d.episodios[K].abaixoDesde).toBeNull()
  })

  it('30 min seguidos abaixo encerram; voltar depois dispara de novo', () => {
    const a = avancarEpisodios({}, [{ chave: K, severidade: 'aviso' }], T0)
    const b = avancarEpisodios(a.episodios, [{ chave: K, severidade: null }], T0 + min(10))
    const c = avancarEpisodios(b.episodios, [{ chave: K, severidade: null }], T0 + min(10) + FIM_EPISODIO_MS)
    expect(c.episodios[K]).toBeUndefined()
    const d = avancarEpisodios(c.episodios, [{ chave: K, severidade: 'aviso' }], T0 + min(60))
    expect(d.disparos).toEqual([{ chave: K, severidade: 'aviso' }])
  })

  it('sem leitura (quadrado sem dado) nada muda', () => {
    const a = avancarEpisodios({}, [{ chave: K, severidade: 'critico' }], T0)
    const b = avancarEpisodios(a.episodios, [], T0 + min(120))
    expect(b.episodios).toEqual(a.episodios)
  })

  it('não altera o mapa recebido', () => {
    const anterior: MapaEpisodios = {}
    avancarEpisodios(anterior, [{ chave: K, severidade: 'aviso' }], T0)
    expect(anterior).toEqual({})
  })
})
