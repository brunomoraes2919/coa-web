import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertaGnss } from '../tipos'
import { ESTADO_INICIAL } from '../vigia/estado'
import type { ValorVigia } from '../vigia/vigiaContexto'

let valor: ValorVigia
vi.mock('../vigia/vigiaContexto', () => ({ useVigiaGnss: () => valor }))

const { default: AlertasPage } = await import('./AlertasPage')

const T = new Date(2026, 8, 24, 21, 30).getTime()
const ALERTAS: AlertaGnss[] = [
  { id: '1', instante: T, tipo: 'cintilacao', severidade: 'critico', fazendas: ['Dourado'], texto: 'forte em Dourado' },
  { id: '2', instante: T - 3_600_000, tipo: 'janela', severidade: 'aviso', fazendas: ['Siriema'], texto: 'janela em Siriema' },
]

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

function linhas() {
  return [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
}

describe('página Alertas', () => {
  it('lista todos e filtra por severidade', async () => {
    valor = { ativo: true, estado: ESTADO_INICIAL, alertas: ALERTAS, lider: true, atualizar: vi.fn() }
    await act(async () => root.render(<AlertasPage />))
    expect(linhas()).toHaveLength(2)
    const botao = (rotulo: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('.gnss-filtros button')].find((b) => b.textContent === rotulo)!
    await act(async () => botao('Críticos').click())
    expect(linhas()).toHaveLength(1)
    expect(linhas()[0]).toContain('forte em Dourado')
    await act(async () => botao('Avisos').click())
    expect(linhas()[0]).toContain('Janela de risco')
  })

  it('vazio diz que não houve alerta', async () => {
    valor = { ativo: true, estado: ESTADO_INICIAL, alertas: [], lider: true, atualizar: vi.fn() }
    await act(async () => root.render(<AlertasPage />))
    expect(container.textContent).toContain('Nenhum alerta nos últimos 7 dias.')
  })
})
