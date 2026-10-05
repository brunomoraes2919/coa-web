import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AjudaGnss from './AjudaGnss'
import { AJUDA, type TemaAjuda } from './ajudaTextos'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('botão "?"', () => {
  it('abre com o que é, o que fazer e a fonte; Esc fecha', async () => {
    await act(async () => root.render(<AjudaGnss tema="cintilacao" />))
    const botao = container.querySelector<HTMLButtonElement>('button[aria-label="O que é Cintilação ionosférica?"]')!
    await act(async () => botao.click())
    const caixa = container.querySelector('[role="dialog"]')
    expect(caixa?.textContent).toContain('O que fazer.')
    expect(caixa?.textContent).toContain('Dado não oficial')
    await act(async () => {
      botao.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('clique fora fecha', async () => {
    await act(async () => root.render(<div><AjudaGnss tema="janela" /><p id="fora">fora</p></div>))
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => container.querySelector<HTMLElement>('#fora')!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('"?" — a caixa não sai da tela', () => {
  const LARGURA_CAIXA = 380

  /** O jsdom não calcula layout: aqui a caixa fica centrada no "?" (como no CSS)
      e anda na horizontal o quanto o --gnss-ajuda-desvio mandar. */
  function simularLayout(centroDoBotao: () => number, larguraDoDocumento: () => number) {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: larguraDoDocumento })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('gnss-ajuda-caixa')) return { left: 0, right: 0, width: 0 } as DOMRect
      const desvio = parseFloat(this.style.getPropertyValue('--gnss-ajuda-desvio')) || 0
      const left = centroDoBotao() - LARGURA_CAIXA / 2 + desvio
      return { left, right: left + LARGURA_CAIXA, width: LARGURA_CAIXA } as DOMRect
    })
  }

  async function abrir() {
    await act(async () => root.render(<AjudaGnss tema="cintilacao" />))
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    return container.querySelector<HTMLElement>('.gnss-ajuda-caixa')!
  }

  afterEach(() => {
    vi.restoreAllMocks()
    delete (document.documentElement as { clientWidth?: number }).clientWidth
  })

  it('"?" colado na borda esquerda: a caixa começa dentro do documento', async () => {
    simularLayout(() => 100, () => 1130)
    const caixa = await abrir()
    expect(caixa.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    expect(caixa.getBoundingClientRect().right).toBeLessThanOrEqual(1130)
  })

  it('"?" colado na borda direita: a caixa termina dentro do documento', async () => {
    simularLayout(() => 1100, () => 1130)
    const caixa = await abrir()
    expect(caixa.getBoundingClientRect().right).toBeLessThanOrEqual(1130)
    expect(caixa.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
  })

  it('"?" no meio da tela: a caixa continua centrada nele', async () => {
    simularLayout(() => 565, () => 1130)
    const caixa = await abrir()
    expect(caixa.getBoundingClientRect().left).toBe(565 - LARGURA_CAIXA / 2)
  })

  it('documento encolhe com a caixa aberta: ela volta para dentro', async () => {
    let largura = 1300
    simularLayout(() => 1000, () => largura)
    const caixa = await abrir()
    expect(caixa.getBoundingClientRect().right).toBe(1000 + LARGURA_CAIXA / 2)
    largura = 1130
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    expect(caixa.getBoundingClientRect().right).toBeLessThanOrEqual(1130)
  })
})

describe('"?" — na operação com RTK', () => {
  const TEMAS: TemaAjuda[] = ['cintilacao', 'indice', 'tec', 'janela']

  it.each(TEMAS)('%s: a caixa traz o efeito no RTK, depois de "Quando acontece." e antes de "O que fazer."', async (tema) => {
    await act(async () => root.render(<AjudaGnss tema={tema} />))
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    const texto = container.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(texto).toContain('Na operação com RTK.')
    expect(texto).toContain(AJUDA[tema].rtk)
    expect(texto.indexOf('Quando acontece.')).toBeLessThan(texto.indexOf('Na operação com RTK.'))
    expect(texto.indexOf('Na operação com RTK.')).toBeLessThan(texto.indexOf('O que fazer.'))
  })
})
