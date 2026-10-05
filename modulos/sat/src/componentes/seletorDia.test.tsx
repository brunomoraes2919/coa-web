import { act } from 'react'
import { fireEvent } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SeletorDia, { DIAS_NO_MAPA, type ModoDia } from './SeletorDia'

const AGORA = new Date(2026, 9, 5, 14, 30).getTime()
const ONTEM = new Date(2026, 9, 4).getTime()

let container: HTMLDivElement
let root: Root

async function montar(modo: ModoDia, aoMudar: (modo: ModoDia) => void = vi.fn()) {
  await act(async () => root.render(<SeletorDia modo={modo} agora={AGORA} aoMudar={aoMudar} />))
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

  const pressionados = () =>
    [...container.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)

  it('três botões na ordem Ao vivo, Hoje, Ontem e depois o campo de data', async () => {
    await montar('ao-vivo')
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Ao vivo', 'Hoje', 'Ontem'])
    const grupo = container.querySelector('[role="group"][aria-label="Dia do mapa"]')!
    expect(grupo.lastElementChild).toBe(campo())
  })

  it('ao vivo: só Ao vivo pressionado; o campo mostra hoje, entre 29 dias atrás e hoje', async () => {
    await montar('ao-vivo')
    expect(pressionados()).toEqual(['Ao vivo'])
    expect(campo().value).toBe('2026-10-05')
    expect(campo().min).toBe('2026-09-06')
    expect(campo().max).toBe('2026-10-05')
  })

  it('hoje (à mão): só Hoje pressionado, e o campo mostra hoje', async () => {
    await montar('hoje')
    expect(pressionados()).toEqual(['Hoje'])
    expect(campo().value).toBe('2026-10-05')
  })

  it('ontem: só Ontem pressionado, e o campo mostra a data dele', async () => {
    await montar(ONTEM)
    expect(pressionados()).toEqual(['Ontem'])
    expect(campo().value).toBe('2026-10-04')
  })

  it('data personalizada: nenhum botão pressionado, e o campo mostra o dia visto', async () => {
    await montar(new Date(2026, 8, 25).getTime())
    expect(pressionados()).toEqual([])
    expect(campo().value).toBe('2026-09-25')
  })

  it('cada botão avisa o seu modo', async () => {
    const aoMudar = vi.fn()
    await montar('hoje', aoMudar)
    await act(async () => botao('Ao vivo').click())
    expect(aoMudar).toHaveBeenLastCalledWith('ao-vivo')
    await act(async () => botao('Hoje').click())
    expect(aoMudar).toHaveBeenLastCalledWith('hoje')
    await act(async () => botao('Ontem').click())
    expect(aoMudar).toHaveBeenLastCalledWith(ONTEM)
    expect(aoMudar).toHaveBeenCalledTimes(3)
  })

  it('escolher uma data no campo avisa 00:00 local daquele dia', async () => {
    const aoMudar = vi.fn()
    await montar('ao-vivo', aoMudar)
    await escolher('2026-09-25')
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith(new Date(2026, 8, 25).getTime())
  })

  it('escolher a data de hoje avisa Hoje (à mão), não ao vivo', async () => {
    const aoMudar = vi.fn()
    await montar(ONTEM, aoMudar)
    await escolher('2026-10-05')
    expect(aoMudar).toHaveBeenCalledTimes(1)
    expect(aoMudar).toHaveBeenCalledWith('hoje')
  })

  it('o limite (29 dias atrás) vale; um dia antes dele, amanhã e o campo vazio não avisam nada', async () => {
    const aoMudar = vi.fn()
    await montar('ao-vivo', aoMudar)
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
