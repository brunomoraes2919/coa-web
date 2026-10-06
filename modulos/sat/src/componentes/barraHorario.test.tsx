import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Velocidade } from '../logic/passosMapa'
import BarraHorario from './BarraHorario'

const PASSO = new Date(2026, 8, 25, 21, 40).getTime()

let container: HTMLDivElement
let root: Root

async function montar(
  extra: { comData?: boolean; aoVivo?: boolean; indisponivel?: boolean; velocidade?: Velocidade; aoMudarVelocidade?: () => void } = {},
) {
  await act(async () =>
    root.render(
      <BarraHorario
        passos={[PASSO]}
        indice={0}
        tocando={false}
        velocidade={1}
        indisponivel={false}
        aoMudar={vi.fn()}
        aoAlternar={vi.fn()}
        aoMudarVelocidade={vi.fn()}
        {...extra}
      />,
    ),
  )
}

const botaoVelocidade = () => container.querySelector<HTMLButtonElement>('button.gnss-velocidade')!

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

  it('ao vivo: a marca "AO VIVO" vem antes da hora, e o aria-valuetext diz "ao vivo"', async () => {
    await montar({ aoVivo: true })
    expect(hora()).toBe('AO VIVO · 21:40')
    const marca = container.querySelector('.gnss-barra-hora .gnss-ao-vivo')!
    expect(marca.tagName).toBe('SPAN')
    expect(marca.textContent).toBe('AO VIVO')
    expect(barra().getAttribute('aria-valuetext')).toBe('ao vivo · 21:40')
  })

  it('sem ao vivo não há marca; dia passado segue com a data', async () => {
    await montar()
    expect(container.querySelector('.gnss-ao-vivo')).toBeNull()
    await montar({ comData: true })
    expect(container.querySelector('.gnss-ao-vivo')).toBeNull()
    expect(hora()).toBe('25/09 · 21:40')
  })

  it('ao vivo com imagem indisponível: o aviso vem depois da hora', async () => {
    await montar({ aoVivo: true, indisponivel: true })
    expect(hora()).toBe('AO VIVO · 21:40 · imagem indisponível')
  })

  it('o botão de velocidade vem logo depois do play e mostra a velocidade com o sinal ×', async () => {
    await montar({ velocidade: 4 })
    const botoes = [...container.querySelectorAll('button')]
    expect(botoes[1]).toBe(botaoVelocidade())
    expect(botaoVelocidade().className).toBe('gnss-btn gnss-velocidade')
    expect(botaoVelocidade().type).toBe('button')
    expect(botaoVelocidade().textContent).toBe('4×')
    expect(botaoVelocidade().getAttribute('aria-label')).toBe('Velocidade da reprodução: 4×')
    expect(botaoVelocidade().title).toBe('Mudar a velocidade da reprodução')
  })

  it('cada velocidade aparece no texto e no aria-label', async () => {
    for (const v of [1, 2, 4, 8] as const) {
      await montar({ velocidade: v })
      expect(botaoVelocidade().textContent).toBe(`${v}×`)
      expect(botaoVelocidade().getAttribute('aria-label')).toBe(`Velocidade da reprodução: ${v}×`)
    }
  })

  it('clicar no botão chama aoMudarVelocidade, uma vez, sem mexer no play', async () => {
    const aoMudarVelocidade = vi.fn()
    const aoAlternar = vi.fn()
    await act(async () =>
      root.render(
        <BarraHorario passos={[PASSO]} indice={0} tocando={false} velocidade={2} indisponivel={false}
          aoMudar={vi.fn()} aoAlternar={aoAlternar} aoMudarVelocidade={aoMudarVelocidade} />,
      ),
    )
    await act(async () => botaoVelocidade().click())
    expect(aoMudarVelocidade).toHaveBeenCalledTimes(1)
    expect(aoAlternar).not.toHaveBeenCalled()
  })
})
