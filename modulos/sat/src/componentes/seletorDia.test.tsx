import { act } from 'react'
import { fireEvent } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SeletorDia, { DIAS_NO_MAPA } from './SeletorDia'

const AGORA = new Date(2026, 9, 5, 14, 30).getTime()
const ONTEM = new Date(2026, 9, 4).getTime()

let container: HTMLDivElement
let root: Root

async function montar(dia: number | null, aoMudar: (dia: number | null) => void = vi.fn()) {
  await act(async () => root.render(<SeletorDia dia={dia} agora={AGORA} aoMudar={aoMudar} />))
}

const botao = (rotulo: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === rotulo)!
const campo = () => container.querySelector<HTMLInputElement>('input[aria-label="Escolher o dia"]')!

async function escolher(valor: string) {
  await act(async () => {
    fireEvent.change(campo(), { target: { value: valor } })
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
})

describe('SeletorDia', () => {
  it('o mapa vai até 30 dias atrás (hoje e os 29 anteriores)', () => {
    expect(DIAS_NO_MAPA).toBe(30)
  })

  it('hoje (dia = null): Hoje pressionado, Ontem não; o campo mostra hoje, entre 29 dias atrás e hoje', async () => {
    await montar(null)
    expect(botao('Hoje').getAttribute('aria-pressed')).toBe('true')
    expect(botao('Ontem').getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[role="group"][aria-label="Dia do mapa"]')).not.toBeNull()
    expect(campo().value).toBe('2026-10-05')
    expect(campo().min).toBe('2026-09-06')
    expect(campo().max).toBe('2026-10-05')
  })

  it('clicar em Ontem avisa o dia de ontem; com ontem escolhido, ele fica pressionado e o campo mostra a data', async () => {
    const aoMudar = vi.fn()
    await montar(null, aoMudar)
    await act(async () => botao('Ontem').click())
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith(ONTEM)

    await montar(ONTEM, aoMudar)
    expect(botao('Ontem').getAttribute('aria-pressed')).toBe('true')
    expect(botao('Hoje').getAttribute('aria-pressed')).toBe('false')
    expect(campo().value).toBe('2026-10-04')
  })

  it('clicar em Hoje volta ao ao vivo (null)', async () => {
    const aoMudar = vi.fn()
    await montar(ONTEM, aoMudar)
    await act(async () => botao('Hoje').click())
    expect(aoMudar).toHaveBeenCalledWith(null)
  })

  it('escolher uma data no campo avisa 00:00 local daquele dia', async () => {
    const aoMudar = vi.fn()
    await montar(null, aoMudar)
    await escolher('2026-09-25')
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith(new Date(2026, 8, 25).getTime())
  })

  it('escolher a data de hoje volta ao ao vivo (null)', async () => {
    const aoMudar = vi.fn()
    await montar(ONTEM, aoMudar)
    await escolher('2026-10-05')
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith(null)
  })

  it('o limite (29 dias atrás) vale; um dia antes dele, amanhã e o campo vazio não avisam nada', async () => {
    const aoMudar = vi.fn()
    await montar(null, aoMudar)
    await escolher('2026-09-06')
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenLastCalledWith(new Date(2026, 8, 6).getTime())

    aoMudar.mockClear()
    await escolher('2026-09-05')
    await escolher('2026-10-06')
    await escolher('')
    expect(aoMudar).not.toHaveBeenCalled()
  })
})
