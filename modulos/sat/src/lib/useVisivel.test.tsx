import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisivel } from './useVisivel'

const larguraDeVerdade = window.innerWidth
const alturaDeVerdade = window.innerHeight

function tamanho(largura: number, altura = 768) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: altura })
}

function Sonda() {
  return <span>{useVisivel() ? 'visivel' : 'escondido'}</span>
}

let container: HTMLDivElement
let root: Root

async function redimensionar(largura: number, altura = 768) {
  await act(async () => {
    tamanho(largura, altura)
    window.dispatchEvent(new Event('resize'))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: larguraDeVerdade })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: alturaDeVerdade })
})

describe('useVisivel', () => {
  it('janela sem largura (iframe escondido) é "escondido"; ao ganhar tamanho vira "visivel"', async () => {
    tamanho(0, 0)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('escondido')

    await redimensionar(1024)
    expect(container.textContent).toBe('visivel')
  })

  it('janela com tamanho começa "visivel" e volta a "escondido" quando perde o tamanho', async () => {
    tamanho(1024)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('visivel')

    await redimensionar(0, 0)
    expect(container.textContent).toBe('escondido')
  })

  it('largura sem altura (ou o contrário) ainda é "escondido"', async () => {
    tamanho(1024, 0)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('escondido')
  })

  it('ao desmontar, tira o ouvinte de resize', async () => {
    const adicionou = vi.spyOn(window, 'addEventListener')
    const tirou = vi.spyOn(window, 'removeEventListener')
    tamanho(1024)
    await act(async () => root.render(<Sonda />))
    const ouvinte = adicionou.mock.calls.find(([tipo]) => tipo === 'resize')?.[1]
    expect(ouvinte).toBeTypeOf('function')
    await act(async () => root.render(<div />))
    expect(tirou).toHaveBeenCalledWith('resize', ouvinte)
    adicionou.mockRestore()
    tirou.mockRestore()
  })
})

/** Iframe de verdade (mesma origem): o COA WEB o esconde com `display:none` num ancestral, e aí a janela
 *  dele NÃO perde o tamanho nem dispara `resize` — quem sabe é o elemento do iframe, no documento de fora. */
describe('useVisivel dentro de um iframe', () => {
  /** Observador de redimensionamento falso, no lugar do da janela de fora (aqui `window.parent` é a própria janela). */
  class ObservadorFalso {
    static todos: ObservadorFalso[] = []
    observados: unknown[] = []
    desconectado = false
    constructor(public avisar: () => void) {
      ObservadorFalso.todos.push(this)
    }
    observe(el: unknown) {
      this.observados.push(el)
    }
    disconnect() {
      this.desconectado = true
    }
    unobserve() {}
  }

  const rects = { quantos: 1 }
  const elementoDoIframe = { getClientRects: () => ({ length: rects.quantos }) }
  const pai = window.parent as unknown as { ResizeObserver?: unknown }
  const descritorDoQuadro = Object.getOwnPropertyDescriptor(window, 'frameElement')
  const observadorDeVerdade = pai.ResizeObserver

  function definirQuadro(leitura: () => unknown) {
    Object.defineProperty(window, 'frameElement', { configurable: true, get: leitura })
  }

  async function avisarObservador() {
    await act(async () => {
      for (const o of ObservadorFalso.todos) o.avisar()
    })
  }

  beforeEach(() => {
    rects.quantos = 1
    ObservadorFalso.todos = []
    pai.ResizeObserver = ObservadorFalso
    definirQuadro(() => elementoDoIframe)
  })

  afterEach(() => {
    if (descritorDoQuadro) Object.defineProperty(window, 'frameElement', descritorDoQuadro)
    else delete (window as { frameElement?: unknown }).frameElement
    if (observadorDeVerdade === undefined) delete pai.ResizeObserver
    else pai.ResizeObserver = observadorDeVerdade
  })

  it('o iframe aparecendo (tem caixa) é "visivel", mesmo que a janela dele ainda diga 0×0', async () => {
    tamanho(0, 0)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('visivel')
  })

  it('escondido de novo pelo COA WEB: a janela mantém o tamanho e não há resize, mas o observador do iframe avisa', async () => {
    tamanho(1024)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('visivel')

    rects.quantos = 0 // display:none num ancestral: o iframe fica sem caixa, a janela dele segue com 1024×768
    await avisarObservador()
    expect(container.textContent).toBe('escondido')

    rects.quantos = 1
    await avisarObservador()
    expect(container.textContent).toBe('visivel')
  })

  it('começa escondido quando o iframe ainda não tem caixa, e mostra quando ganha', async () => {
    rects.quantos = 0
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('escondido')
    rects.quantos = 1
    await avisarObservador()
    expect(container.textContent).toBe('visivel')
  })

  it('observa o elemento do iframe e, ao desmontar, desconecta o observador e tira o ouvinte de resize', async () => {
    const tirou = vi.spyOn(window, 'removeEventListener')
    await act(async () => root.render(<Sonda />))
    expect(ObservadorFalso.todos).toHaveLength(1)
    expect(ObservadorFalso.todos[0].observados).toEqual([elementoDoIframe])
    expect(ObservadorFalso.todos[0].desconectado).toBe(false)

    await act(async () => root.render(<div />))
    expect(ObservadorFalso.todos[0].desconectado).toBe(true)
    expect(tirou).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(tirou).toHaveBeenCalledWith('pagehide', expect.any(Function))
    tirou.mockRestore()
  })

  it('pagehide na janela do iframe (o COA WEB remove o iframe): desconecta o observador do pai', async () => {
    await act(async () => root.render(<Sonda />))
    expect(ObservadorFalso.todos).toHaveLength(1)
    expect(ObservadorFalso.todos[0].desconectado).toBe(false)

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(ObservadorFalso.todos[0].desconectado).toBe(true)
  })

  it('desmontar depois do pagehide (ou o contrário) não quebra nem desconecta de novo', async () => {
    await act(async () => root.render(<Sonda />))
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await act(async () => root.render(<div />))
    expect(ObservadorFalso.todos).toHaveLength(1)
    expect(ObservadorFalso.todos[0].desconectado).toBe(true)
  })

  it('o resize da janela continua valendo como aviso (relê o iframe)', async () => {
    await act(async () => root.render(<Sonda />))
    rects.quantos = 0
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(container.textContent).toBe('escondido')
  })

  it('o ResizeObserver da janela de fora ausente: sem erro, e o resize segue valendo', async () => {
    delete pai.ResizeObserver
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('visivel')
    rects.quantos = 0
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(container.textContent).toBe('escondido')
  })

  it('o observador que não consegue observar não derruba o hook', async () => {
    pai.ResizeObserver = class {
      constructor() {
        throw new Error('sem observador')
      }
    }
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('visivel')
  })

  it('iframe de outra origem (frameElement lança): cai no tamanho da janela, sem lançar nem observar', async () => {
    definirQuadro(() => {
      throw new DOMException('Blocked a frame', 'SecurityError')
    })
    tamanho(1024)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('visivel')
    expect(ObservadorFalso.todos).toHaveLength(0)

    await redimensionar(0, 0)
    expect(container.textContent).toBe('escondido')
  })

  it('janela de nível superior (frameElement nulo): vale o tamanho da janela e nada é observado', async () => {
    definirQuadro(() => null)
    tamanho(0, 0)
    await act(async () => root.render(<Sonda />))
    expect(container.textContent).toBe('escondido')
    expect(ObservadorFalso.todos).toHaveLength(0)
    await redimensionar(1024)
    expect(container.textContent).toBe('visivel')
  })
})
