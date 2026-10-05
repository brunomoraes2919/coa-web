import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LimiteFazenda } from '../logic/limites'

const d = vi.hoisted(() => ({
  cliente: null as object | null,
  limitesDaSessao: vi.fn(),
}))
vi.mock('../dados/supabase', () => ({ clienteSupabase: () => d.cliente }))
vi.mock('../dados/cadastro', () => ({ limitesDaSessao: d.limitesDaSessao }))

const { useLimitesFazendas } = await import('./useLimitesFazendas')

type Limites = Record<string, LimiteFazenda>
const F1: Limites = { f1: { type: 'FeatureCollection', features: [] } }

function Sonda({ carregar }: { carregar?: () => Promise<Limites> }) {
  return <output>{JSON.stringify(useLimitesFazendas(carregar))}</output>
}

let container: HTMLDivElement
let root: Root
let erros: ReturnType<typeof vi.spyOn>

const mostrado = () => container.textContent

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  d.cliente = null
  d.limitesDaSessao.mockReset()
  erros = vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  erros.mockRestore()
})

describe('useLimitesFazendas', () => {
  it('começa vazio e passa a mostrar os contornos quando chegam', async () => {
    let entregar!: (l: Limites) => void
    const carregar = vi.fn(() => new Promise<Limites>((ok) => (entregar = ok)))
    await act(async () => root.render(<Sonda carregar={carregar} />))
    expect(mostrado()).toBe('{}')
    expect(carregar).toHaveBeenCalledTimes(1)

    await act(async () => entregar(F1))
    expect(mostrado()).toBe(JSON.stringify(F1))
  })

  it('falhou: fica sem contornos, sem erro no console', async () => {
    const carregar = vi.fn(() => Promise.reject(new Error('sem rede')))
    await act(async () => root.render(<Sonda carregar={carregar} />))
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 0))
    })
    expect(mostrado()).toBe('{}')
    expect(erros).not.toHaveBeenCalled()
  })

  it('resposta atrasada de um carregador que já saiu de cena não sobrescreve a do atual', async () => {
    const F2: Limites = { f2: { type: 'FeatureCollection', features: [] } }
    let entregarVelho!: (l: Limites) => void
    const velho = vi.fn(() => new Promise<Limites>((ok) => (entregarVelho = ok)))
    const novo = vi.fn(() => Promise.resolve(F2))
    await act(async () => root.render(<Sonda carregar={velho} />))
    await act(async () => root.render(<Sonda carregar={novo} />))
    expect(mostrado()).toBe(JSON.stringify(F2))

    await act(async () => entregarVelho(F1))
    expect(mostrado()).toBe(JSON.stringify(F2))
  })

  it('re-render com o mesmo carregador não pede de novo', async () => {
    const carregar = vi.fn(() => Promise.resolve(F1))
    await act(async () => root.render(<Sonda carregar={carregar} />))
    await act(async () => root.render(<Sonda carregar={carregar} />))
    expect(carregar).toHaveBeenCalledTimes(1)
  })

  it('padrão: pede os contornos da sessão com o cliente do Supabase, o localStorage e o relógio', async () => {
    d.cliente = { id: 'cliente-falso' }
    d.limitesDaSessao.mockResolvedValue(F1)
    await act(async () => root.render(<Sonda />))
    expect(d.limitesDaSessao).toHaveBeenCalledTimes(1)
    expect(d.limitesDaSessao).toHaveBeenCalledWith({ cliente: d.cliente, armazenamento: window.localStorage, agora: Date.now })
    expect(mostrado()).toBe(JSON.stringify(F1))
  })

  it('padrão sem Supabase configurado (build local): sem contornos e sem pedido', async () => {
    await act(async () => root.render(<Sonda />))
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 0))
    })
    expect(d.limitesDaSessao).not.toHaveBeenCalled()
    expect(mostrado()).toBe('{}')
  })
})
