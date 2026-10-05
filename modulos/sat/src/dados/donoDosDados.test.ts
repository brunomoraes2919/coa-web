import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHAVE_DONO, garantirDonoDosDados } from './donoDosDados'

const DO_VIGIA = [
  'locks_sat_estado_v1',
  'locks_sat_alertas_v1',
  'locks_sat_memoria_v1',
  'locks_sat_centros_v1',
  'locks_sat_historico_v2',
  'locks_sat_lider_v1',
]

function guardarDadosDoVigia() {
  for (const chave of DO_VIGIA) localStorage.setItem(chave, '{"x":1}')
}

beforeEach(() => localStorage.clear())

// jsdom guarda `localStorage` na janela ou no protótipo: guarda o descritor para devolver como estava.
const proprio = Object.getOwnPropertyDescriptor(window, 'localStorage')
afterEach(() => {
  if (proprio) Object.defineProperty(window, 'localStorage', proprio)
  else delete (window as { localStorage?: Storage }).localStorage
})

describe('garantirDonoDosDados', () => {
  it('mesmo usuário: nada é apagado e devolve false', () => {
    localStorage.setItem(CHAVE_DONO, 'u1')
    guardarDadosDoVigia()
    expect(garantirDonoDosDados('u1')).toBe(false)
    for (const chave of DO_VIGIA) expect(localStorage.getItem(chave)).toBe('{"x":1}')
    expect(localStorage.getItem(CHAVE_DONO)).toBe('u1')
  })

  it('outro usuário: apaga o que era do anterior, mantém o fundo e as chaves de fora, registra o novo dono', () => {
    localStorage.setItem(CHAVE_DONO, 'u1')
    guardarDadosDoVigia()
    localStorage.setItem('locks_sat_fundo_v1', 'mapa')
    localStorage.setItem('coa.menuRecolhido', '1')
    localStorage.setItem('sb-xyz-auth-token', '{"access_token":"t"}')

    expect(garantirDonoDosDados('u2')).toBe(true)

    for (const chave of DO_VIGIA) expect(localStorage.getItem(chave)).toBeNull()
    expect(localStorage.getItem('locks_sat_fundo_v1')).toBe('mapa')
    expect(localStorage.getItem('coa.menuRecolhido')).toBe('1')
    expect(localStorage.getItem('sb-xyz-auth-token')).toBe('{"access_token":"t"}')
    expect(localStorage.getItem(CHAVE_DONO)).toBe('u2')
  })

  it('sem dono registrado e com dados guardados: apaga e registra', () => {
    guardarDadosDoVigia()
    expect(garantirDonoDosDados('u1')).toBe(true)
    for (const chave of DO_VIGIA) expect(localStorage.getItem(chave)).toBeNull()
    expect(localStorage.getItem(CHAVE_DONO)).toBe('u1')
  })

  it('sem dono registrado e sem nada guardado: só registra e devolve false', () => {
    expect(garantirDonoDosDados('u1')).toBe(false)
    expect(localStorage.getItem(CHAVE_DONO)).toBe('u1')
  })

  it('outro usuário, mas sem dado nenhum guardado: só troca o dono e devolve false', () => {
    localStorage.setItem(CHAVE_DONO, 'u1')
    expect(garantirDonoDosDados('u2')).toBe(false)
    expect(localStorage.getItem(CHAVE_DONO)).toBe('u2')
  })

  it('armazenamento que lança em getItem: devolve false sem lançar', () => {
    const quebrado = {
      getItem() {
        throw new Error('bloqueado')
      },
    } as unknown as Storage
    expect(garantirDonoDosDados('u1', quebrado)).toBe(false)
  })

  it('navegador que nega o acesso ao localStorage (SecurityError): sem o 2º argumento, devolve false sem lançar', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('negado', 'SecurityError')
      },
    })
    expect(() => garantirDonoDosDados('u1')).not.toThrow()
    expect(garantirDonoDosDados('u1')).toBe(false)
  })

  it('armazenamento que lança ao apagar ou gravar: devolve false sem lançar', () => {
    const cheio = {
      locks_sat_estado_v1: '{"x":1}',
      getItem: () => 'u1',
      removeItem() {
        throw new Error('bloqueado')
      },
      setItem() {
        throw new Error('cheio')
      },
    } as unknown as Storage
    expect(garantirDonoDosDados('u2', cheio)).toBe(false)
  })
})
