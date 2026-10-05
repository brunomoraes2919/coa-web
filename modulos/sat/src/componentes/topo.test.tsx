import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESTADO_INICIAL, type EstadoVigia } from '../vigia/estado'
import type { ValorVigia } from '../vigia/vigiaContexto'

let valor: ValorVigia
vi.mock('../vigia/vigiaContexto', () => ({ useVigiaGnss: () => valor }))
let embed = false
vi.mock('../lib/embed', () => ({ emEmbed: () => embed }))

const { default: Topo } = await import('./Topo')

const ULTIMO_SUCESSO = new Date(2026, 8, 24, 19, 40).getTime()

function comEstado(extra: Partial<EstadoVigia>): ValorVigia {
  return { ativo: true, estado: { ...ESTADO_INICIAL, ...extra }, alertas: [], lider: true, atualizar: () => {} }
}

let container: HTMLDivElement
let root: Root

async function montar(rota = '/hoje') {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[rota]}>
        <Topo />
      </MemoryRouter>,
    ),
  )
}

const selo = () => container.querySelector('.gnss-selo-conexao') as HTMLElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  embed = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('Topo', () => {
  it('com dado e sem erro: "ATUALIZADO hh:mm" no selo verde', async () => {
    valor = comEstado({ ultimoSucesso: ULTIMO_SUCESSO })
    await montar()
    expect(selo().textContent).toBe('ATUALIZADO 19:40')
    expect(selo().classList.contains('ok')).toBe(true)
    expect(selo().classList.contains('erro')).toBe(false)
  })

  it('com erro e último dado às 19:40: "SEM DADOS DA TRIMBLE DESDE 19:40" no selo de erro', async () => {
    valor = comEstado({ ultimoSucesso: ULTIMO_SUCESSO, erro: 'rede' })
    await montar()
    expect(selo().textContent).toBe('SEM DADOS DA TRIMBLE DESDE 19:40')
    expect(selo().classList.contains('erro')).toBe(true)
    expect(selo().classList.contains('ok')).toBe(false)
  })

  it('com erro e nenhum sucesso ainda: "SEM DADOS DA TRIMBLE"', async () => {
    valor = comEstado({ erro: 'rede' })
    await montar()
    expect(selo().textContent).toBe('SEM DADOS DA TRIMBLE')
    expect(selo().classList.contains('erro')).toBe(true)
  })

  it('sem sucesso nenhum e sem erro: "AGUARDANDO DADOS", sem cor de estado', async () => {
    valor = comEstado({})
    await montar()
    expect(selo().textContent).toBe('AGUARDANDO DADOS')
    expect(selo().classList.contains('ok')).toBe(false)
    expect(selo().classList.contains('erro')).toBe(false)
  })

  it('a logo tem o texto alternativo "Locks SAT"', async () => {
    valor = comEstado({})
    await montar()
    const logo = container.querySelector('img') as HTMLImageElement
    expect(logo.alt).toBe('Locks SAT')
  })

  it('fora do COA WEB: três links de navegação (Hoje, Mapa, Alertas), o da rota atual destacado', async () => {
    valor = comEstado({})
    await montar('/alertas')
    const links = [...container.querySelectorAll('nav a')] as HTMLAnchorElement[]
    expect(links.map((a) => a.textContent)).toEqual(['Hoje', 'Mapa', 'Alertas'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/hoje', '/mapa', '/alertas'])
    expect(links.filter((a) => a.classList.contains('ativo')).map((a) => a.textContent)).toEqual(['Alertas'])
  })

  it('dentro do COA WEB: nenhum link (o menu é o do site), mas o selo continua', async () => {
    embed = true
    valor = comEstado({ ultimoSucesso: ULTIMO_SUCESSO })
    await montar()
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelector('nav')).toBeNull()
    expect(selo().textContent).toBe('ATUALIZADO 19:40')
  })
})
