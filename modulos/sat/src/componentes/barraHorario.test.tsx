import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BarraHorario from './BarraHorario'

const PASSO = new Date(2026, 8, 25, 21, 40).getTime()

let container: HTMLDivElement
let root: Root

async function montar(extra: { comData?: boolean; indisponivel?: boolean } = {}) {
  await act(async () =>
    root.render(
      <BarraHorario passos={[PASSO]} indice={0} tocando={false} indisponivel={false} aoMudar={vi.fn()} aoAlternar={vi.fn()} {...extra} />,
    ),
  )
}

const hora = () => container.querySelector('.gnss-barra-hora')!.textContent
const barra = () => container.querySelector<HTMLInputElement>('input[aria-label="Horário do mapa"]')!

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

describe('BarraHorario', () => {
  it('sem data (hoje): só a hora, no texto e no aria-valuetext', async () => {
    await montar()
    expect(hora()).toBe('21:40')
    expect(barra().getAttribute('aria-valuetext')).toBe('21:40')
  })

  it('com data (dia passado): "25/09 · 21:40", no texto e no aria-valuetext', async () => {
    await montar({ comData: true })
    expect(hora()).toBe('25/09 · 21:40')
    expect(barra().getAttribute('aria-valuetext')).toBe('25/09 · 21:40')
  })

  it('imagem indisponível aparece depois do horário, com ou sem data', async () => {
    await montar({ comData: true, indisponivel: true })
    expect(hora()).toBe('25/09 · 21:40 · imagem indisponível')
    // O aviso é só do texto: o valor lido pelo leitor de tela continua sendo o horário.
    expect(barra().getAttribute('aria-valuetext')).toBe('25/09 · 21:40')
  })
})
