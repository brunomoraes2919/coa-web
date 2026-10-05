import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstadoSessao } from './useSessao'

type Avisar = (evento: string, sessao: { user: { id: string } } | null) => void
let aoMudar: Avisar | null = null
const desassinar = vi.fn()
const assinar = vi.fn((cb: Avisar) => {
  aoMudar = cb
  return { data: { subscription: { unsubscribe: desassinar } } }
})
const getSession = vi.fn()
let cliente: unknown
vi.mock('./supabase', () => ({ clienteSupabase: () => cliente }))

const { useSessao } = await import('./useSessao')

let container: HTMLDivElement
let root: Root
let ultimo: EstadoSessao

function Sonda() {
  ultimo = useSessao()
  return <span>{ultimo.fase === 'com' ? `com:${ultimo.usuarioId}` : ultimo.fase}</span>
}

async function montar(estrito = false) {
  await act(async () => root.render(estrito ? <StrictMode><Sonda /></StrictMode> : <Sonda />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  aoMudar = null
  cliente = { auth: { getSession, onAuthStateChange: assinar } }
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('useSessao', () => {
  it('começa "carregando" e, com sessão, passa a "com" e o id do usuário', async () => {
    let resolver: (v: unknown) => void = () => {}
    getSession.mockReturnValue(new Promise((r) => (resolver = r)))
    await montar()
    expect(container.textContent).toBe('carregando')
    await act(async () => resolver({ data: { session: { user: { id: 'u7' } } } }))
    expect(container.textContent).toBe('com:u7')
  })

  it('sem sessão no site: "sem"', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    await montar()
    expect(container.textContent).toBe('sem')
  })

  it('getSession que falha: "sem", sem rejeição solta', async () => {
    getSession.mockRejectedValue(new Error('rede'))
    await montar()
    expect(container.textContent).toBe('sem')
  })

  it('build sem Supabase configurado: "sem" de cara', async () => {
    cliente = null
    await montar()
    expect(container.textContent).toBe('sem')
    expect(assinar).not.toHaveBeenCalled()
  })

  it('acompanha login, troca de usuário e logout feitos no site', async () => {
    await montar()
    expect(container.textContent).toBe('com:u1')
    await act(async () => aoMudar?.('SIGNED_IN', { user: { id: 'u2' } }))
    expect(container.textContent).toBe('com:u2')
    await act(async () => aoMudar?.('SIGNED_OUT', null))
    expect(container.textContent).toBe('sem')
    await act(async () => aoMudar?.('SIGNED_IN', { user: { id: 'u3' } }))
    expect(container.textContent).toBe('com:u3')
  })

  it('renovação de token do mesmo usuário não troca o estado (mesma referência)', async () => {
    await montar()
    const antes = ultimo
    await act(async () => aoMudar?.('TOKEN_REFRESHED', { user: { id: 'u1' } }))
    expect(ultimo).toBe(antes)
  })

  it('ao desmontar, cancela a assinatura uma vez só, e a resposta tardia do getSession passa sem erro', async () => {
    let resolver: (v: unknown) => void = () => {}
    getSession.mockReturnValue(new Promise((r) => (resolver = r)))
    await montar()
    await act(async () => root.render(<div />))
    expect(desassinar).toHaveBeenCalledTimes(1)
    await act(async () => resolver({ data: { session: { user: { id: 'u1' } } } }))
    expect(desassinar).toHaveBeenCalledTimes(1)
    expect(assinar).toHaveBeenCalledTimes(1)
  })

  it('em StrictMode (efeito rodado duas vezes) toda assinatura é cancelada e o estado final é certo', async () => {
    await montar(true)
    expect(container.textContent).toBe('com:u1')
    expect(assinar).toHaveBeenCalledTimes(2)
    expect(desassinar).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<div />))
    expect(desassinar).toHaveBeenCalledTimes(2)
  })
})
