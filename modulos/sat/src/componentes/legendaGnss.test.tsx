import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COR_NIVEL } from '../logic/niveis'
import LegendaGnss from './LegendaGnss'

let container: HTMLDivElement
let root: Root

async function montar(camada: 'sci' | 'tec') {
  await act(async () => root.render(<LegendaGnss camada={camada} />))
}

/** O jsdom devolve a cor como `rgb(...)`: normaliza a esperada do mesmo jeito. */
function normalizada(cor: string): string {
  const el = document.createElement('i')
  el.style.background = cor
  return el.style.background
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

describe('LegendaGnss', () => {
  it('cintilação: três faixas (Forte, Média, Mínima) com os limites, e a nota de que a mínima fica sem cor', async () => {
    await montar('sci')
    expect(container.querySelector('.gnss-legenda strong')?.textContent).toBe('Cintilação')
    const itens = [...container.querySelectorAll('ul.gnss-legenda-faixas li')]
    expect(itens).toHaveLength(3)
    expect(itens[0].textContent).toContain('Forte')
    expect(itens[0].textContent).toContain('66–100')
    expect(itens[1].textContent).toContain('Média')
    expect(itens[1].textContent).toContain('33–65')
    expect(itens[2].textContent).toContain('Mínima')
    expect(itens[2].textContent).toContain('0–32')
    expect(container.querySelector('.gnss-legenda-nota')?.textContent).toBe('Mínima fica sem cor')
  })

  it('cintilação: Forte e Média levam a cor do nível; Mínima é só um quadrado vazado', async () => {
    await montar('sci')
    const quadrados = [...container.querySelectorAll<HTMLElement>('ul.gnss-legenda-faixas li i')]
    expect(quadrados).toHaveLength(3)
    expect(quadrados[0].style.background).toBe(normalizada(COR_NIVEL.forte))
    expect(quadrados[1].style.background).toBe(normalizada(COR_NIVEL.media))
    expect(quadrados[0].style.background).not.toBe('')
    expect(quadrados[1].style.background).not.toBe('')
    expect(quadrados[2].classList.contains('vazia')).toBe(true)
    expect(quadrados[2].style.background).toBe('')
  })

  it('cintilação: sem a barra em gradiente', async () => {
    await montar('sci')
    expect(container.querySelector('.gnss-legenda-barra')).toBeNull()
  })

  it('TEC: continua com a barra em gradiente e os rótulos 120, 60 e 0', async () => {
    await montar('tec')
    expect(container.querySelector('.gnss-legenda strong')?.textContent).toBe('TEC (TECU)')
    const barra = container.querySelector<HTMLElement>('.gnss-legenda-barra')
    expect(barra).not.toBeNull()
    expect(barra!.style.background).toContain('linear-gradient')
    expect([...container.querySelectorAll('.gnss-legenda-rotulos span')].map((s) => s.textContent)).toEqual(['120', '60', '0'])
    expect(container.querySelector('ul.gnss-legenda-faixas')).toBeNull()
  })
})
