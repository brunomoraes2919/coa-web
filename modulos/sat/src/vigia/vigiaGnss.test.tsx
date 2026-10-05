/**
 * O vigia montado de verdade, com a Trimble e o cadastro simulados. Prova a
 * fiação que a lógica pura não pega: só a aba líder consulta, o alerta vira
 * toast com bipe, a aba seguidora mostra o toast sem bipe, o vigia inativo
 * não dispara nada, e dentro do COA WEB o aviso vai para o site em vez de
 * ser desenhado pelo módulo.
 */
import { act, StrictMode, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bipe = vi.fn()
vi.mock('../ui/alertaSonoro', () => ({ tocarAlertaSonoro: () => bipe() }))
const notificar = vi.fn()
vi.mock('./notificacaoWindows', () => ({ notificarWindows: (...a: unknown[]) => notificar(...a) }))

const carregarFazendas = vi.fn()

/** `dentro`: o módulo está num iframe do COA WEB (o aviso vai para o site); `embed`: só tem ?embed=1 na URL. */
let embed = false
let dentro = false
const avisarAlerta = vi.fn()
const avisarResumo = vi.fn()
vi.mock('../lib/embed', async () => {
  const real = await vi.importActual<typeof import('../lib/embed')>('../lib/embed')
  return {
    ...real,
    emEmbed: () => embed,
    dentroDoCoa: () => dentro,
    avisarAlerta: (...a: unknown[]) => avisarAlerta(...a),
    avisarResumo: (...a: unknown[]) => avisarResumo(...a),
  }
})

const executar = vi.fn()
vi.mock('./ciclo', async () => {
  const real = await vi.importActual<typeof import('./ciclo')>('./ciclo')
  return { ...real, executarCiclo: (...a: unknown[]) => executar(...a) }
})

const { default: VigiaGnssProvider } = await import('./VigiaGnss')
const { useVigiaGnss } = await import('./vigiaContexto')
const { CHAVE_LIDER } = await import('../logic/liderAba')
const { CHAVE_ALERTAS, CHAVE_ESTADO, CHAVE_MEMORIA } = await import('./persistencia')

const FAZENDAS = [{ id: 'f1', nome: 'Dourado', lat: -12.26, lon: -50.31, celulaId: '-12.5_-50.5' }]

let container: HTMLDivElement
let root: Root

async function esvaziar() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

async function montar(filhos: ReactNode = <div>tela</div>, ativo = true, estrito = false) {
  const vigia = (
    <MemoryRouter>
      <VigiaGnssProvider ativo={ativo} carregarFazendas={carregarFazendas}>{filhos}</VigiaGnssProvider>
    </MemoryRouter>
  )
  await act(async () => {
    root.render(estrito ? <StrictMode>{vigia}</StrictMode> : vigia)
  })
  // Deixa a cadeia liderança → fazendas → ciclo → juízo terminar.
  await esvaziar()
}

/** Pega o `atualizar` do contexto, como o botão da página Hoje. */
let atualizarDoContexto: () => void = () => {}
function Sonda() {
  const { atualizar } = useVigiaGnss()
  useEffect(() => {
    atualizarDoContexto = atualizar
  }, [atualizar])
  return <div>tela</div>
}

/** O que a aba gravou num ciclo que deu certo há `minutos`. */
function estadoGravado(minutos: number, celulas: Record<string, unknown> = { '-12.5_-50.5': { serie: [], janelas: [] } }) {
  return { fazendas: FAZENDAS, celulas, ultimoSucesso: Date.now() - minutos * 60_000, falhasSeguidas: 0, erro: null }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  embed = false
  dentro = false
  carregarFazendas.mockResolvedValue(FAZENDAS)
  executar.mockImplementation(async () => ({
    dados: {
      '-12.5_-50.5': {
        serie: [{ instante: Date.now() - 5 * 60_000, indice: 3, tec: 20, cintilacao: 75, previsto: false }],
        janelas: [],
      },
    },
    erro: null,
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('VigiaGnssProvider', () => {
  it('aba líder: carrega as fazendas, consulta e mostra o alerta com bipe', async () => {
    await montar()
    expect(executar).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Cintilação forte agora em Dourado')
    expect(bipe).toHaveBeenCalledTimes(1)
    const gravados = JSON.parse(localStorage.getItem(CHAVE_ALERTAS) ?? '[]')
    expect(gravados).toHaveLength(1)
    // Tag pelo id do alerta: dois alertas de mesmo título não se substituem.
    expect(notificar).toHaveBeenCalledWith('Cintilação forte', gravados[0].texto, gravados[0].id)
  })

  it('vigia inativo (ativo = false) não consulta nada', async () => {
    await montar(<div>tela</div>, false)
    expect(carregarFazendas).not.toHaveBeenCalled()
    expect(executar).not.toHaveBeenCalled()
  })

  it('aba seguidora não consulta; recebe o alerta pelo storage e mostra sem bipe', async () => {
    localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba: 'outra', expira: Date.now() + 60_000 }))
    await montar()
    expect(executar).not.toHaveBeenCalled()
    const alerta = {
      id: 'x1', instante: Date.now(), tipo: 'cintilacao', severidade: 'critico',
      fazendas: ['Dourado'], texto: 'Cintilação forte agora em Dourado (até 80 de 100).',
    }
    localStorage.setItem(CHAVE_ALERTAS, JSON.stringify([alerta]))
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_ALERTAS }))
    })
    expect(container.textContent).toContain('até 80 de 100')
    expect(bipe).not.toHaveBeenCalled()
  })

  it('aba seguidora mostra o aviso de sem dados quando a líder grava a terceira falha, sem bipe', async () => {
    localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba: 'outra', expira: Date.now() + 60_000 }))
    await montar()
    const estado = {
      fazendas: FAZENDAS, celulas: {}, ultimoSucesso: Date.now() - 60 * 60_000, falhasSeguidas: 3, erro: 'rede',
    }
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estado))
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_ESTADO }))
    })
    expect(container.textContent).toContain('sem dados da Trimble')
    expect(bipe).not.toHaveBeenCalled()
  })

  it('localStorage com "null" em todas as chaves: o módulo abre e o vigia segue alertando', async () => {
    for (const chave of [CHAVE_ESTADO, CHAVE_ALERTAS, CHAVE_MEMORIA, 'locks_sat_historico_v2']) {
      localStorage.setItem(chave, 'null')
    }
    await montar()
    expect(container.textContent).toContain('tela')
    expect(executar).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Cintilação forte agora em Dourado')
    expect(JSON.parse(localStorage.getItem(CHAVE_ALERTAS) ?? '[]')).toHaveLength(1)
  })

  it('aba seguidora: "null" chegando pelo storage não derruba a tela', async () => {
    localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba: 'outra', expira: Date.now() + 60_000 }))
    await montar()
    for (const chave of [CHAVE_ESTADO, CHAVE_ALERTAS]) {
      localStorage.setItem(chave, 'null')
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', { key: chave }))
      })
    }
    expect(container.textContent).toContain('tela')
  })

  it('falha inesperada no ciclo não é silenciosa: o estado passa a mostrar erro', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    executar.mockRejectedValue(new Error('inesperado'))
    await montar()
    expect(consoleErro).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(CHAVE_ESTADO) ?? 'null')).toMatchObject({ erro: 'rede', falhasSeguidas: 1 })
    consoleErro.mockRestore()
  })

  it('F5 com dado fresco (< 10 min) de todos os quadrados não consulta de novo: agenda', async () => {
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estadoGravado(3)))
    await montar()
    expect(executar).not.toHaveBeenCalled()
  })

  it('dado fresco mas com quadrado novo sem dado: consulta já', async () => {
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estadoGravado(3, {})))
    await montar()
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('dado de mais de 10 min: consulta já', async () => {
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estadoGravado(11)))
    await montar()
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('reagenda com jitter de até 90 s depois do próximo passo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 24, 21, 31))
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const agendar = vi.spyOn(window, 'setTimeout')
    await montar()
    expect(executar).toHaveBeenCalledTimes(1)
    // 1 min até 21:32 (passo + 2 min) + 45 s de jitter.
    expect(agendar.mock.calls.map((c) => c[1])).toContain(105_000)
  })

  it('Atualizar: nada se o último ciclo começou há menos de 60 s; depois, consulta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 21, 35))
    await montar(<Sonda />)
    expect(executar).toHaveBeenCalledTimes(1)

    await act(async () => atualizarDoContexto())
    await esvaziar()
    expect(executar).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date(2026, 8, 24, 21, 36, 1))
    await act(async () => atualizarDoContexto())
    await esvaziar()
    expect(executar).toHaveBeenCalledTimes(2)
  })

  it('Atualizar que falha não vira rejeição solta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 21, 35))
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    await montar(<Sonda />)
    // Falha fora do try do ciclo (no juízo, por exemplo) — aqui simulada no executar.
    executar.mockRejectedValueOnce(new Error('inesperado'))
    vi.setSystemTime(new Date(2026, 8, 24, 21, 36, 1))
    await act(async () => atualizarDoContexto())
    await esvaziar()
    expect(executar).toHaveBeenCalledTimes(2)
    expect(consoleErro).toHaveBeenCalledWith(expect.stringContaining('[locks-sat]'), expect.any(Error))
  })

  it('dentro do COA WEB: o alerta novo vai para o site e o módulo não desenha o aviso', async () => {
    dentro = true
    await montar()
    const gravados = JSON.parse(localStorage.getItem(CHAVE_ALERTAS) ?? '[]')
    expect(gravados).toHaveLength(1)
    expect(avisarAlerta).toHaveBeenCalledTimes(1)
    expect(avisarAlerta).toHaveBeenCalledWith({
      id: gravados[0].id,
      titulo: 'Cintilação forte',
      texto: gravados[0].texto,
      severidade: 'critico',
    })
    expect(container.querySelector('.gnss-aviso')).toBeNull()
    expect(container.textContent).not.toContain('Cintilação forte agora em Dourado')
    // O bipe e a notificação do Windows seguem na aba líder: quem some é só o toast.
    expect(bipe).toHaveBeenCalledTimes(1)
  })

  it('fora do COA WEB: o mesmo alerta desenha o aviso do próprio módulo', async () => {
    await montar()
    const aviso = container.querySelector('.gnss-aviso')
    expect(aviso).not.toBeNull()
    expect(aviso?.textContent).toContain('Cintilação forte agora em Dourado')
  })

  it('aba seguidora também avisa o site, uma vez só por alerta, e sem bipe', async () => {
    dentro = true
    localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba: 'outra', expira: Date.now() + 60_000 }))
    await montar()
    const alerta = {
      id: 'x1', instante: Date.now(), tipo: 'cintilacao', severidade: 'critico',
      fazendas: ['Dourado'], texto: 'Cintilação forte agora em Dourado (até 80 de 100).',
    }
    localStorage.setItem(CHAVE_ALERTAS, JSON.stringify([alerta]))
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_ALERTAS }))
      })
    }
    expect(avisarAlerta).toHaveBeenCalledTimes(1)
    expect(avisarAlerta).toHaveBeenCalledWith({
      id: 'x1', titulo: 'Cintilação forte', texto: alerta.texto, severidade: 'critico',
    })
    expect(container.querySelector('.gnss-aviso')).toBeNull()
    expect(bipe).not.toHaveBeenCalled()
  })

  it('o aviso de sem dados também chega ao site, como aviso, na aba seguidora', async () => {
    dentro = true
    localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba: 'outra', expira: Date.now() + 60_000 }))
    await montar()
    const ultimoSucesso = Date.now() - 60 * 60_000
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify({
      fazendas: FAZENDAS, celulas: {}, ultimoSucesso, falhasSeguidas: 3, erro: 'rede',
    }))
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_ESTADO }))
    })
    expect(avisarAlerta).toHaveBeenCalledTimes(1)
    expect(avisarAlerta).toHaveBeenCalledWith({
      id: `sem-dados:${ultimoSucesso}`,
      titulo: 'Locks SAT',
      texto: expect.stringContaining('sem dados da Trimble'),
      severidade: 'aviso',
    })
  })

  it('resumo: avisa o site a cada mudança do estado, com o texto de agora', async () => {
    await montar()
    expect(avisarResumo).toHaveBeenCalled()
    expect(avisarResumo).toHaveBeenLastCalledWith('Agora: forte em 1 fazenda')
  })

  it('em StrictMode (efeitos rodados duas vezes): uma consulta, um alerta, um bipe, um aviso ao site', async () => {
    dentro = true
    await montar(<div>tela</div>, true, true)
    expect(executar).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(CHAVE_ALERTAS) ?? '[]')).toHaveLength(1)
    expect(bipe).toHaveBeenCalledTimes(1)
    expect(avisarAlerta).toHaveBeenCalledTimes(1)
    // A liderança segue com esta aba depois do remonte simulado.
    expect(JSON.parse(localStorage.getItem(CHAVE_LIDER) ?? 'null')).not.toBeNull()
  })

  it('pagehide (o COA WEB tira o iframe no logout e beforeunload não dispara): solta a liderança', async () => {
    await montar()
    const antes = JSON.parse(localStorage.getItem(CHAVE_LIDER) ?? 'null')
    expect(antes).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(localStorage.getItem(CHAVE_LIDER)).toBeNull()
  })

  it('pagehide de aba que não é a líder não mexe na liderança de outra', async () => {
    localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba: 'outra', expira: Date.now() + 60_000 }))
    await montar()
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(JSON.parse(localStorage.getItem(CHAVE_LIDER) ?? 'null')?.aba).toBe('outra')
  })

  it('ao sair de cena, tira os ouvintes de beforeunload e de pagehide', async () => {
    const tirou = vi.spyOn(window, 'removeEventListener')
    await montar()
    await act(async () => root.unmount())
    const tipos = tirou.mock.calls.map(([tipo]) => tipo)
    expect(tipos).toContain('beforeunload')
    expect(tipos).toContain('pagehide')
    tirou.mockRestore()
  })

  it('aberto direto com ?embed=1 e sem iframe: sem site para avisar, o módulo desenha o próprio aviso', async () => {
    embed = true
    dentro = false
    await montar()
    expect(container.querySelector('.gnss-aviso')).not.toBeNull()
  })

  it('ciclo em andamento quando o vigia sai de cena (logout ou troca de usuário): o resultado é descartado', async () => {
    let resolver: (v: unknown) => void = () => {}
    executar.mockImplementation(() => new Promise((r) => (resolver = r)))
    dentro = true
    await montar()
    expect(executar).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    await act(async () =>
      resolver({
        dados: {
          '-12.5_-50.5': {
            serie: [{ instante: Date.now() - 5 * 60_000, indice: 3, tec: 20, cintilacao: 75, previsto: false }],
            janelas: [],
          },
        },
        erro: null,
      }),
    )
    await esvaziar()

    expect(localStorage.getItem(CHAVE_ALERTAS)).toBeNull()
    expect(localStorage.getItem(CHAVE_MEMORIA)).toBeNull()
    // O estado guardado é o de antes do ciclo (só as fazendas): nada do resultado dele.
    expect(JSON.parse(localStorage.getItem(CHAVE_ESTADO) ?? 'null')).toMatchObject({ ultimoSucesso: null, celulas: {} })
    expect(avisarAlerta).not.toHaveBeenCalled()
    expect(bipe).not.toHaveBeenCalled()
    expect(notificar).not.toHaveBeenCalled()
  })

  it('falha inesperada depois que o vigia saiu de cena não grava erro no estado', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejeitar: (e: unknown) => void = () => {}
    executar.mockImplementation(() => new Promise((_, r) => (rejeitar = r)))
    await montar()
    const antes = localStorage.getItem(CHAVE_ESTADO)
    expect(JSON.parse(antes ?? 'null')).toMatchObject({ erro: null, falhasSeguidas: 0 })

    await act(async () => root.unmount())
    await act(async () => rejeitar(new Error('inesperado')))
    await esvaziar()

    expect(localStorage.getItem(CHAVE_ESTADO)).toBe(antes)
    consoleErro.mockRestore()
  })

  it('vigia inativo não avisa o site de nada', async () => {
    await montar(<div>tela</div>, false)
    expect(avisarResumo).not.toHaveBeenCalled()
    expect(avisarAlerta).not.toHaveBeenCalled()
  })
})
