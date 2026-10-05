import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
