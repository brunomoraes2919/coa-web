import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COR_NIVEL } from '../logic/niveis'
import { GUIA_RTK } from './ajudaTextos'
import GuiaRtk from './GuiaRtk'

let container: HTMLDivElement
let root: Root

/** A cor como o navegador a guarda no `style` (o jsdom normaliza #hex para rgb()). */
function cssNormalizado(cor: string): string {
  const el = document.createElement('i')
  el.style.background = cor
  return el.style.background
}

function botao(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button.gnss-guia-rtk-botao')!
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
})

describe('botão "Como isso afeta o RTK"', () => {
  it('começa fechado', async () => {
    await act(async () => root.render(<GuiaRtk />))
    expect(botao().textContent).toBe('Como isso afeta o RTK')
    expect(botao().getAttribute('aria-expanded')).toBe('false')
    expect(botao().getAttribute('aria-haspopup')).toBe('dialog')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('abre com uma linha por nível, as operações sensíveis e a nota da dupla frequência', async () => {
    await act(async () => root.render(<GuiaRtk />))
    await act(async () => botao().click())
    expect(botao().getAttribute('aria-expanded')).toBe('true')

    const caixa = container.querySelector('[role="dialog"]')!
    expect(caixa.getAttribute('aria-label')).toBe('Como a ionosfera afeta o RTK')
    const cabecalho = [...caixa.querySelectorAll('thead th')]
    expect(cabecalho.map((th) => th.textContent)).toEqual(['Nível', 'Efeito no RTK', 'O que fazer'])
    expect(cabecalho.every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    const linhas = [...caixa.querySelectorAll('tbody tr')]
    expect(linhas).toHaveLength(3)
    GUIA_RTK.niveis.forEach((n, i) => {
      const celulas = [...linhas[i].querySelectorAll('td')].map((td) => td.textContent)
      expect(celulas).toEqual([n.rotulo, n.efeito, n.fazer])
    })

    const itens = [...caixa.querySelectorAll('li')].map((li) => li.textContent)
    expect(itens).toHaveLength(4)
    expect(itens).toEqual([...GUIA_RTK.sensiveis])
    expect(caixa.textContent).toContain('Operações mais sensíveis')
    expect(caixa.textContent).toContain('não a cintilação')
    expect(caixa.textContent).toContain(GUIA_RTK.ressalva)
    // O guia é nosso, não dado da Trimble: sem a fonte "Dado não oficial".
    expect(caixa.textContent).not.toContain('Dado não oficial')
  })

  it('a bolinha de cada nível leva a cor dele', async () => {
    await act(async () => root.render(<GuiaRtk />))
    await act(async () => botao().click())
    const bolinhas = [...container.querySelectorAll<HTMLElement>('tbody .gnss-bolinha')]
    expect(bolinhas.map((b) => b.style.background)).toEqual(
      GUIA_RTK.niveis.map((n) => cssNormalizado(COR_NIVEL[n.nivel])),
    )
    // Normalizar não pode virar vazio (cor inválida): as 3 bolinhas têm cor.
    expect(bolinhas.every((b) => b.style.background !== '')).toBe(true)
  })

  it('clicar de novo no botão fecha', async () => {
    await act(async () => root.render(<GuiaRtk />))
    await act(async () => botao().click())
    await act(async () => botao().click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Esc fecha', async () => {
    await act(async () => root.render(<GuiaRtk />))
    await act(async () => botao().click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => {
      botao().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('clique fora fecha', async () => {
    await act(async () => root.render(<div><GuiaRtk /><p id="fora">fora</p></div>))
    await act(async () => botao().click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => container.querySelector<HTMLElement>('#fora')!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
