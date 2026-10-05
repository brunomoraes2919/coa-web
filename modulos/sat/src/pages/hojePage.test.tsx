import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESTADO_INICIAL, type EstadoVigia } from '../vigia/estado'
import type { ValorVigia } from '../vigia/vigiaContexto'

let valor: ValorVigia
vi.mock('../vigia/vigiaContexto', () => ({ useVigiaGnss: () => valor }))
/* recharts em jsdom não tem tamanho para desenhar; o gráfico é conferido no navegador. */
vi.mock('../componentes/LinhaDoTempo', () => ({ default: () => <div data-linha /> }))

const { default: HojePage } = await import('./HojePage')

const AGORA = new Date(2026, 8, 24, 20, 0).getTime()
const min = (n: number) => n * 60_000

function estadoCom(extra: Partial<EstadoVigia> = {}): EstadoVigia {
  return {
    ...ESTADO_INICIAL,
    ultimoSucesso: AGORA - min(3),
    fazendas: [
      { id: 'f1', nome: 'Aurora', lat: -13.1, lon: -58.2, celulaId: 'b' },
      { id: 'f2', nome: 'Dourado', lat: -12.26, lon: -50.31, celulaId: 'a' },
      { id: 'f3', nome: 'São Miguel', lat: null, lon: null, celulaId: null },
    ],
    celulas: {
      a: { serie: [{ instante: AGORA - min(5), indice: 3, tec: 20, cintilacao: 80, previsto: false }], janelas: [] },
      b: { serie: [{ instante: AGORA - min(5), indice: 2, tec: 10, cintilacao: 5, previsto: false }], janelas: [] },
    },
    ...extra,
  }
}

function comEstado(estado: EstadoVigia, atualizar = vi.fn()): ValorVigia {
  return { ativo: true, estado, alertas: [], lider: true, atualizar }
}

let container: HTMLDivElement
let root: Root

async function montar() {
  await act(async () => root.render(<HojePage />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AGORA)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('página Hoje', () => {
  it('um card por fazenda, a mais grave primeiro e a sem localização no fim', async () => {
    valor = comEstado(estadoCom())
    await montar()
    const titulos = [...container.querySelectorAll('.gnss-card h2')].map((h) => h.textContent)
    expect(titulos).toEqual(['Dourado', 'Aurora', 'São Miguel'])
    expect(container.textContent).toContain('Forte')
    expect(container.textContent).toContain('80 de 100 · 19:55')
    expect(container.textContent).toContain('Cadastre os talhões desta fazenda em Mapas › Fazendas e shapes')
  })

  it('mostra a janela de risco que ainda vem hoje e esconde a que passou', async () => {
    const e = estadoCom()
    e.celulas.a.janelas = [{ inicio: 1270, fim: 1470, dias: 5 }, { inicio: 60, fim: 120, dias: 3 }]
    valor = comEstado(e)
    await montar()
    expect(container.textContent).toContain('21:10–00:30 (5 de 7 dias)')
    expect(container.textContent).not.toContain('01:00–02:00')
  })

  it('falha da Trimble aparece em faixa, com a hora do último dado', async () => {
    valor = comEstado(estadoCom({ erro: 'bloqueio', falhasSeguidas: 1, ultimoSucesso: new Date(2026, 8, 24, 19, 40).getTime() }))
    await montar()
    const faixa = container.querySelector('[role="status"]')?.textContent ?? ''
    expect(faixa).toContain('Sem dados da Trimble desde 19:40 — sem medida nova até a conexão voltar.')
    expect(faixa).toContain('Nova tentativa em alguns minutos.')
    // O vigia segue avaliando (janelas, previsão já baixada): "pausados" não é verdade.
    expect(faixa).not.toContain('pausados')
  })

  it('falha antes de qualquer dado: "ainda"', async () => {
    valor = comEstado(estadoCom({ erro: 'rede', falhasSeguidas: 1, ultimoSucesso: null }))
    await montar()
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Sem dados da Trimble ainda — sem medida nova até a conexão voltar.',
    )
  })

  it('sem fazendas: diz o que conferir se não aparecerem', async () => {
    valor = comEstado(estadoCom({ fazendas: [] }))
    await montar()
    expect(container.querySelector('.gnss-vazio')?.textContent).toBe(
      'Carregando as fazendas… Se não aparecerem, confira se há fazendas liberadas para o seu usuário no COA WEB.',
    )
  })

  it('cada item do card tem o seu "?" e o cabeçalho tem o guia do RTK', async () => {
    valor = comEstado(estadoCom())
    await montar()
    const cards = container.querySelectorAll('.gnss-card')
    // O card sem localização (São Miguel) não tem os itens.
    const comLocalizacao = [...cards].filter((c) => c.querySelector('dl'))
    expect(comLocalizacao).toHaveLength(2)
    for (const card of comLocalizacao) {
      const rotulos = [...card.querySelectorAll('dt')].map((dt) => ({
        item: dt.textContent?.trim(),
        ajuda: dt.querySelector('button')?.getAttribute('aria-label'),
      }))
      expect(rotulos).toEqual([
        { item: 'Cintilação agora', ajuda: 'O que é Cintilação ionosférica?' },
        { item: 'Índice previsto (3 h)', ajuda: 'O que é Índice ionosférico?' },
        { item: 'Janela de risco hoje', ajuda: 'O que é Janela de risco pelo histórico?' },
      ])
    }

    const guia = container.querySelector<HTMLButtonElement>('.gnss-cabecalho button.gnss-guia-rtk-botao')
    expect(guia?.textContent).toBe('Como isso afeta o RTK')
    // Antes do botão de notificação, dentro das ações do cabeçalho.
    expect(container.querySelector('.gnss-acoes')?.firstElementChild?.contains(guia ?? null)).toBe(true)
  })

  it('o "?" de um item abre a caixa com o efeito no RTK', async () => {
    valor = comEstado(estadoCom())
    await montar()
    const dt = container.querySelector('.gnss-card dt')!
    await act(async () => dt.querySelector<HTMLButtonElement>('button')!.click())
    expect(dt.querySelector('[role="dialog"]')?.textContent).toContain('Na operação com RTK.')
  })

  it('Atualizar pede um ciclo', async () => {
    const atualizar = vi.fn()
    valor = comEstado(estadoCom(), atualizar)
    await montar()
    await act(async () => container.querySelector<HTMLButtonElement>('button.gnss-atualizar')!.click())
    expect(atualizar).toHaveBeenCalled()
  })
})
