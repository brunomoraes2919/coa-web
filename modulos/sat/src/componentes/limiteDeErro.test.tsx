import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import LimiteDeErro from './LimiteDeErro'

let container: HTMLDivElement
let root: Root
let erros: MockInstance<typeof console.error>

function Quebra({ quebra }: { quebra: boolean }) {
  if (quebra) throw new Error('quebrou ao desenhar')
  return <p>tela inteira</p>
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // O React registra no console o erro que o limite segura; aqui é esperado.
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

describe('LimiteDeErro', () => {
  it('sem erro, mostra os filhos e nada mais', async () => {
    await act(async () => root.render(<LimiteDeErro mensagem="Não foi possível abrir a tela."><Quebra quebra={false} /></LimiteDeErro>))
    expect(container.textContent).toBe('tela inteira')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('filho que lança: no lugar dele, o aviso com o botão Recarregar — e o que está fora do limite continua', async () => {
    await act(async () =>
      root.render(
        <>
          <header>topo</header>
          <LimiteDeErro mensagem="Não foi possível abrir a tela."><Quebra quebra /></LimiteDeErro>
        </>,
      ),
    )
    const aviso = container.querySelector('[role="alert"]')!
    expect(aviso.className).toBe('gnss-vazio')
    expect(aviso.textContent).toContain('Não foi possível abrir a tela.')
    const botao = aviso.querySelector('button')!
    expect(botao.textContent).toBe('Recarregar')
    expect(botao.getAttribute('type')).toBe('button')
    expect(botao.className).toBe('gnss-btn')
    expect(container.querySelector('header')?.textContent).toBe('topo')
    expect(container.textContent).not.toContain('tela inteira')
  })

  it('mostra a mensagem que o chamador pediu (cada tela diz o que não abriu)', async () => {
    await act(async () => root.render(<LimiteDeErro mensagem="Não foi possível abrir o mapa."><Quebra quebra /></LimiteDeErro>))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível abrir o mapa.')
    expect(container.textContent).not.toContain('abrir a tela')
  })

  it('registra o erro no console com o prefixo do módulo', async () => {
    await act(async () => root.render(<LimiteDeErro mensagem="Não foi possível abrir a tela."><Quebra quebra /></LimiteDeErro>))
    const chamada = erros.mock.calls.find(([mensagem]) => typeof mensagem === 'string' && mensagem.startsWith('[locks-sat]'))
    expect(chamada).toBeDefined()
    expect(chamada![1]).toBeInstanceOf(Error)
    expect((chamada![1] as Error).message).toBe('quebrou ao desenhar')
  })

  it('Recarregar chama a recarga da página', async () => {
    const recarregar = vi.fn()
    await act(async () => root.render(<LimiteDeErro mensagem="x" aoRecarregar={recarregar}><Quebra quebra /></LimiteDeErro>))
    await act(async () => container.querySelector('button')!.click())
    expect(recarregar).toHaveBeenCalledTimes(1)
  })

  it('o aviso fica enquanto o limite estiver montado: o erro não some sozinho', async () => {
    await act(async () => root.render(<LimiteDeErro mensagem="Não foi possível abrir a tela."><Quebra quebra /></LimiteDeErro>))
    await act(async () => root.render(<LimiteDeErro mensagem="Não foi possível abrir a tela."><Quebra quebra={false} /></LimiteDeErro>))
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })
})
