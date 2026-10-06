import { act, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EstadoSessao } from './dados/useSessao'

let sessao: EstadoSessao = { fase: 'sem' }
vi.mock('./dados/useSessao', () => ({ useSessao: () => sessao }))

/** O provider de mentira registra o que o localStorage tinha no PRIMEIRO render de cada instância
 *  (o de verdade lê o estado guardado nesse momento) e quantas instâncias nasceram. */
const instancias = vi.fn()
/** Vezes que um provider de verdade saiu da tela (desmontou): num erro de tela, nenhuma. */
const desmontou = vi.fn()
const primeirosRenders: { usuario: string | null; alertas: string | null }[] = []
const propsDoProvider: { ativo: boolean; carregarFazendas: unknown }[] = []
vi.mock('./vigia/VigiaGnss', () => ({
  default: ({ ativo, carregarFazendas, children }: { ativo: boolean; carregarFazendas: unknown; children: ReactNode }) => {
    useState(() => {
      instancias()
      primeirosRenders.push({
        usuario: localStorage.getItem('locks_sat_usuario_v1'),
        alertas: localStorage.getItem('locks_sat_alertas_v1'),
      })
    })
    propsDoProvider.push({ ativo, carregarFazendas })
    useEffect(
      () => () => {
        desmontou()
      },
      [],
    )
    return <>{children}</>
  },
}))

/** Os contornos em memória (cadastro) têm de ser esquecidos a cada usuário que entra. */
const limparLimites = vi.fn()
vi.mock('./dados/cadastro', async () => {
  const real = await vi.importActual<typeof import('./dados/cadastro')>('./dados/cadastro')
  return {
    ...real,
    limparLimitesDaSessao: () => {
      limparLimites()
      real.limparLimitesDaSessao()
    },
  }
})

/** A vista do mapa (dia, camada, passo) é de quem estava logado: tem de ser esquecida a cada usuário. */
const limparMemoria = vi.fn()
vi.mock('./mapa/memoriaDoMapa', async () => {
  const real = await vi.importActual<typeof import('./mapa/memoriaDoMapa')>('./mapa/memoriaDoMapa')
  return {
    ...real,
    limparMemoriaDoMapa: () => {
      limparMemoria()
      real.limparMemoriaDoMapa()
    },
  }
})

const avisarRota = vi.fn()
vi.mock('./lib/embed', async () => {
  const real = await vi.importActual<typeof import('./lib/embed')>('./lib/embed')
  return { ...real, avisarRota: (...a: unknown[]) => avisarRota(...a) }
})

/** A tela do mapa é carregada sob demanda (o Leaflet só desce quando ela abre); aqui basta um título. */
const mapa = vi.hoisted(() => ({ quebra: false }))
vi.mock('./pages/MapaPage', () => ({
  default: () => {
    if (mapa.quebra) throw new Error('o mapa quebrou ao desenhar')
    return <h1>Mapa da ionosfera</h1>
  },
}))

/** Hoje e Alertas também são carregadas sob demanda (a Hoje traz o recharts): a tela de verdade, a menos que o teste a quebre. */
const telas = vi.hoisted(() => ({ quebraHoje: false, quebraAlertas: false }))
vi.mock('./pages/HojePage', async () => {
  const real = await vi.importActual<typeof import('./pages/HojePage')>('./pages/HojePage')
  return {
    default: () => {
      if (telas.quebraHoje) throw new Error('a tela Hoje quebrou ao desenhar')
      return <real.default />
    },
  }
})
vi.mock('./pages/AlertasPage', async () => {
  const real = await vi.importActual<typeof import('./pages/AlertasPage')>('./pages/AlertasPage')
  return {
    default: () => {
      if (telas.quebraAlertas) throw new Error('a tela Alertas quebrou ao desenhar')
      return <real.default />
    },
  }
})

// Aquece as telas de verdade (o primeiro import traz o recharts): os testes só esperam o Suspense, não a compilação.
await import('./pages/HojePage')
await import('./pages/AlertasPage')
const { default: App } = await import('./App')
const { guardarMemoriaDoMapa, lerMemoriaDoMapa } = await import('./mapa/memoriaDoMapa')

const larguraDeVerdade = window.innerWidth
const alturaDeVerdade = window.innerHeight
function tamanho(largura: number, altura: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: altura })
}
async function redimensionar(largura: number, altura: number) {
  await act(async () => {
    tamanho(largura, altura)
    window.dispatchEvent(new Event('resize'))
  })
}

let container: HTMLDivElement
let root: Root

/** Telas carregadas por import dinâmico: espera (com folga) o título aparecer. */
async function esperarTitulo(texto: string) {
  for (let i = 0; i < 100 && container.querySelector('h1')?.textContent !== texto; i++) {
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10))
    })
  }
  expect(container.querySelector('h1')?.textContent).toBe(texto)
}

async function montar(estrito = false) {
  await act(async () => root.render(estrito ? <StrictMode><App /></StrictMode> : <App />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  mapa.quebra = false
  telas.quebraHoje = false
  telas.quebraAlertas = false
  sessao = { fase: 'com', usuarioId: 'u1' }
  primeirosRenders.length = 0
  propsDoProvider.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  tamanho(larguraDeVerdade, alturaDeVerdade)
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
})

describe('App', () => {
  it('sem sessão: pede para entrar pelo COA WEB (link para o topo) e não monta o vigia', async () => {
    sessao = { fase: 'sem' }
    await montar()
    expect(container.textContent).toContain('Entre pelo COA WEB')
    const link = container.querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('target')).toBe('_top')
    expect(container.querySelector('img')).toBeNull()
    expect(instancias).not.toHaveBeenCalled()
  })

  it('sessão ainda carregando: não desenha nada nem monta o vigia', async () => {
    sessao = { fase: 'carregando' }
    await montar()
    expect(container.textContent).toBe('')
    expect(instancias).not.toHaveBeenCalled()
  })

  it('com sessão: mostra a logo Locks SAT e a tela Hoje, com o vigia ativo', async () => {
    await montar()
    expect((container.querySelector('img') as HTMLImageElement).alt).toBe('Locks SAT')
    await esperarTitulo('Hoje')
    expect(propsDoProvider.at(-1)).toMatchObject({ ativo: true, carregarFazendas: expect.any(Function) })
  })

  it('#/alertas abre Alertas e rota desconhecida cai em Hoje — e o COA WEB é avisado da rota', async () => {
    window.history.replaceState(null, '', '/#/alertas')
    await montar()
    await esperarTitulo('Alertas')
    expect(avisarRota).toHaveBeenCalledWith('/alertas')

    await act(async () => root.unmount())
    root = createRoot(container)
    window.history.replaceState(null, '', '/#/qualquer-coisa')
    await montar()
    await esperarTitulo('Hoje')
    expect(avisarRota).toHaveBeenLastCalledWith('/hoje')
  })

  it('#/mapa abre o Mapa da ionosfera (carregado sob demanda) e o COA WEB é avisado da rota', async () => {
    window.history.replaceState(null, '', '/#/mapa')
    await montar()
    // A tela do mapa vem por import dinâmico: dá a volta de uma tarefa para o Suspense resolver.
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 0))
    })
    expect(container.querySelector('h1')?.textContent).toBe('Mapa da ionosfera')
    expect(avisarRota).toHaveBeenCalledWith('/mapa')
  })

  it('mapa que quebra (pacote que não carrega ou erro ao desenhar): o aviso toma o lugar da tela; o Topo e o vigia seguem de pé', async () => {
    mapa.quebra = true
    // O React registra o erro que o limite segura: esperado aqui.
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      window.history.replaceState(null, '', '/#/mapa')
      await montar()
      await act(async () => {
        await new Promise((pronto) => setTimeout(pronto, 0))
      })
      const aviso = container.querySelector('[role="alert"]')
      expect(aviso?.textContent).toContain('Não foi possível abrir o mapa.')
      expect(aviso?.querySelector('button')?.textContent).toBe('Recarregar')
      expect(container.querySelector('h1')).toBeNull()
      expect((container.querySelector('img') as HTMLImageElement).alt).toBe('Locks SAT') // o Topo
      expect(desmontou).not.toHaveBeenCalled() // o provider do vigia nunca saiu da tela
      expect(erros.mock.calls.some(([mensagem]) => typeof mensagem === 'string' && mensagem.startsWith('[locks-sat]'))).toBe(true)

      // Sair do mapa tira o aviso, e as outras telas seguem funcionando.
      await act(async () => {
        window.location.hash = '#/alertas'
      })
      await esperarTitulo('Alertas')
      expect(desmontou).not.toHaveBeenCalled()
    } finally {
      erros.mockRestore()
    }
  })

  it.each([
    ['Hoje', '#/hoje', 'quebraHoje'],
    ['Alertas', '#/alertas', 'quebraAlertas'],
  ] as const)('tela %s que quebra (pacote que não carrega ou erro ao desenhar): aviso no lugar da tela, o Topo e o vigia seguem de pé', async (_nome, rota, quebra) => {
    telas[quebra] = true
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      window.history.replaceState(null, '', `/${rota}`)
      await montar()
      await act(async () => {
        await new Promise((pronto) => setTimeout(pronto, 50))
      })
      const aviso = container.querySelector('[role="alert"]')
      expect(aviso?.textContent).toContain('Não foi possível abrir a tela.')
      expect(aviso?.querySelector('button')?.textContent).toBe('Recarregar')
      expect(container.querySelector('h1')).toBeNull()
      expect((container.querySelector('img') as HTMLImageElement).alt).toBe('Locks SAT')
      expect(desmontou).not.toHaveBeenCalled()
    } finally {
      erros.mockRestore()
    }
  })

  it('escondido (janela sem tamanho): mostra o Topo mas não a tela; ao aparecer a tela monta e, escondida de novo, continua montada', async () => {
    tamanho(0, 0)
    await montar()
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('h1')).toBeNull()

    await redimensionar(1024, 768)
    await esperarTitulo('Hoje')

    await redimensionar(0, 0)
    expect(container.querySelector('h1')?.textContent).toBe('Hoje')
  })

  it('o vigia monta mesmo com o módulo escondido (ele roda em segundo plano)', async () => {
    tamanho(0, 0)
    await montar()
    expect(instancias).toHaveBeenCalledTimes(1)
  })

  describe('dono dos dados', () => {
    it('outro usuário: o que era do anterior some ANTES de o vigia montar, e o novo dono é registrado', async () => {
      localStorage.setItem('locks_sat_usuario_v1', 'u1')
      localStorage.setItem('locks_sat_alertas_v1', '[{"id":"velho"}]')
      localStorage.setItem('locks_sat_fundo_v1', 'satelite')
      sessao = { fase: 'com', usuarioId: 'u2' }
      await montar()
      expect(primeirosRenders).toEqual([{ usuario: 'u2', alertas: null }])
      expect(localStorage.getItem('locks_sat_alertas_v1')).toBeNull()
      expect(localStorage.getItem('locks_sat_usuario_v1')).toBe('u2')
      expect(localStorage.getItem('locks_sat_fundo_v1')).toBe('satelite')
    })

    it('mesmo usuário: o que estava guardado fica para o vigia ler', async () => {
      localStorage.setItem('locks_sat_usuario_v1', 'u1')
      localStorage.setItem('locks_sat_alertas_v1', '[{"id":"meu"}]')
      await montar()
      expect(primeirosRenders).toEqual([{ usuario: 'u1', alertas: '[{"id":"meu"}]' }])
    })

    it('troca de usuário com o módulo aberto: o vigia remonta, depois de limpar o que era do anterior', async () => {
      await montar()
      localStorage.setItem('locks_sat_alertas_v1', '[{"id":"de-u1"}]')
      expect(instancias).toHaveBeenCalledTimes(1)

      sessao = { fase: 'com', usuarioId: 'u2' }
      await montar()
      expect(instancias).toHaveBeenCalledTimes(2)
      expect(primeirosRenders[1]).toEqual({ usuario: 'u2', alertas: null })
    })

    it('mesmo usuário renderizando de novo (renovação de token): o vigia não remonta', async () => {
      await montar()
      sessao = { fase: 'com', usuarioId: 'u1' }
      await montar()
      expect(instancias).toHaveBeenCalledTimes(1)
    })

    it('contornos em memória: esquecidos ao montar e quando o usuário muda; não quando só o token renova', async () => {
      await montar()
      expect(limparLimites).toHaveBeenCalledTimes(1)

      sessao = { fase: 'com', usuarioId: 'u1' }
      await montar()
      expect(limparLimites).toHaveBeenCalledTimes(1)

      sessao = { fase: 'com', usuarioId: 'u2' }
      await montar()
      expect(limparLimites).toHaveBeenCalledTimes(2)
    })

    it('vista do mapa: esquecida ao montar e quando o usuário muda; não quando só o token renova', async () => {
      await montar()
      expect(limparMemoria).toHaveBeenCalledTimes(1)

      sessao = { fase: 'com', usuarioId: 'u1' }
      await montar()
      expect(limparMemoria).toHaveBeenCalledTimes(1)

      sessao = { fase: 'com', usuarioId: 'u2' }
      await montar()
      expect(limparMemoria).toHaveBeenCalledTimes(2)
    })

    it('outro usuário não herda o dia e a camada do mapa do anterior; o mesmo usuário (token renovado) mantém', async () => {
      await montar()
      guardarMemoriaDoMapa({ camada: 'tec', dia: new Date(2026, 8, 23).getTime(), escolhido: 5, aoVivo: false, velocidade: 4 })

      sessao = { fase: 'com', usuarioId: 'u1' }
      await montar()
      expect(lerMemoriaDoMapa()).toEqual({ camada: 'tec', dia: new Date(2026, 8, 23).getTime(), escolhido: 5, aoVivo: false, velocidade: 4 })

      sessao = { fase: 'com', usuarioId: 'u2' }
      await montar()
      expect(lerMemoriaDoMapa()).toEqual({ camada: 'sci', dia: null, escolhido: null, aoVivo: true, velocidade: 1 })
    })

    it('sem sessão não limpa nada (nada foi montado)', async () => {
      sessao = { fase: 'sem' }
      await montar()
      expect(limparLimites).not.toHaveBeenCalled()
      expect(limparMemoria).not.toHaveBeenCalled()
    })

    it('em StrictMode (render duplo): a limpeza continua antes do vigia e o dono fica registrado', async () => {
      localStorage.setItem('locks_sat_usuario_v1', 'u1')
      localStorage.setItem('locks_sat_alertas_v1', '[{"id":"velho"}]')
      sessao = { fase: 'com', usuarioId: 'u2' }
      await montar(true)
      expect(primeirosRenders.length).toBeGreaterThan(0)
      expect(primeirosRenders.every((r) => r.alertas === null && r.usuario === 'u2')).toBe(true)
      expect(localStorage.getItem('locks_sat_usuario_v1')).toBe('u2')
      await esperarTitulo('Hoje')
    })
  })
})
