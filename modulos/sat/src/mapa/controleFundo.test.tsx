import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChaveFundo } from './fundos'
import ControleFundo from './ControleFundo'

let container: HTMLDivElement
let root: Root

async function montar(valor: ChaveFundo, aoMudar: (c: ChaveFundo) => void = vi.fn()) {
  await act(async () => root.render(<ControleFundo valor={valor} aoMudar={aoMudar} />))
}

const grupo = () => container.querySelector('[role="group"][aria-label="Fundo do mapa"]') as HTMLElement
const botoes = () => [...grupo().querySelectorAll('button')]

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

describe('ControleFundo', () => {
  it('um grupo "Fundo do mapa" com os quatro fundos; só o escolhido fica pressionado', async () => {
    await montar('satelite')
    expect(grupo()).not.toBeNull()
    expect(botoes().map((b) => b.textContent)).toEqual(['Satélite', 'Topográfico', 'Claro', 'Escuro'])
    expect(botoes().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
  })

  it('clicar num fundo avisa a chave dele', async () => {
    const aoMudar = vi.fn()
    await montar('satelite', aoMudar)
    const topo = botoes().find((b) => b.textContent === 'Topográfico')!
    await act(async () => {
      topo.click()
    })
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith('topo')
  })

  it('acompanha o valor recebido', async () => {
    await montar('escuro')
    expect(botoes().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true'])
    expect(botoes()[3].classList.contains('ativo')).toBe(true)
  })
})
