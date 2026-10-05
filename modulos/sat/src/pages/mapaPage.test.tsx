/**
 * O Leaflet de verdade em jsdom só traria instabilidade de layout. Aqui os componentes do
 * mapa são simulados e o que chega a eles É a asserção: a URL que a camada da ionosfera recebe
 * prova que a camada e o horário escolhidos pedem a imagem certa à Trimble; o que o contorno e a
 * bolinha recebem prova a cor e o texto de cada fazenda.
 */
import { act, type ReactNode } from 'react'
import { fireEvent } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarMemoriaDoMapa, lerMemoriaDoMapa, limparMemoriaDoMapa } from '../mapa/memoriaDoMapa'
import { ESTADO_INICIAL } from '../vigia/estado'
import type { ValorVigia } from '../vigia/vigiaContexto'

const m = vi.hoisted(() => ({
  pedidas: [] as string[],
  chamadasSerie: [] as { dia: number | null; celulas: string[] }[],
  /** A lista de quadrados (a referência) de cada chamada: tem de ser a mesma entre renders. */
  listasDeCelulas: [] as unknown[],
  serie: { series: {}, carregando: false, erro: false } as { series: Record<string, unknown[]>; carregando: boolean; erro: boolean },
  limites: {} as Record<string, unknown>,
  eventos: {} as { zoomend?: () => void },
  mapa: { fitBounds: vi.fn(), getZoom: vi.fn(() => 5), invalidateSize: vi.fn(), getContainer: () => document.createElement('div') },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, maxZoom }: { children?: ReactNode; maxZoom?: number }) => (
    <div data-mapa data-max-zoom={maxZoom}>{children}</div>
  ),
  CircleMarker: ({ children, pathOptions }: { children?: ReactNode; pathOptions?: { fillColor?: string } }) => (
    <div data-fazenda data-cor={pathOptions?.fillColor}>{children}</div>
  ),
  GeoJSON: ({ children, style }: { children?: ReactNode; style?: { color?: string } }) => (
    <div data-contorno data-cor={style?.color}>{children}</div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useMap: () => m.mapa,
  useMapEvents: (h: { zoomend?: () => void }) => {
    m.eventos = h
    return m.mapa
  },
}))
vi.mock('../mapa/TileLayerEsri', () => ({ default: ({ url }: { url: string }) => <i data-fundo={url} /> }))
vi.mock('../mapa/CamadaIonosfera', async () => {
  const { urlOverlay } = await import('../api/gnssApi')
  return {
    default: ({ camada, instante, atenuada, aoFalhar, aoCarregar }: { camada: 'sci' | 'tec'; instante: number; atenuada?: boolean; aoFalhar: () => void; aoCarregar: () => void }) => (
      <img data-overlay={urlOverlay(camada, instante)} data-atenuada={String(atenuada === true)} onError={aoFalhar} onLoad={aoCarregar} />
    ),
  }
})
vi.mock('../mapa/imagemIonosfera', async () => {
  const { urlOverlay } = await import('../api/gnssApi')
  return { precarregarIonosfera: (camada: 'sci' | 'tec', instante: number) => m.pedidas.push(urlOverlay(camada, instante)) }
})
vi.mock('../mapa/useSerieDoDia', () => ({
  useSerieDoDia: (dia: number | null, celulas: { id: string }[]) => {
    m.chamadasSerie.push({ dia, celulas: celulas.map((c) => c.id) })
    m.listasDeCelulas.push(celulas)
    return m.serie
  },
}))
vi.mock('../mapa/useLimitesFazendas', () => ({ useLimitesFazendas: () => m.limites }))

let valor: ValorVigia
vi.mock('../vigia/vigiaContexto', () => ({ useVigiaGnss: () => valor }))

const { default: MapaPage } = await import('./MapaPage')
const { urlOverlay } = await import('../api/gnssApi')
const { passosDoDia, passosDoDiaPassado } = await import('../logic/passosMapa')
const { COR_NIVEL } = await import('../logic/niveis')
const { dataCurta, horaDe } = await import('../logic/tempo')

const AGORA = new Date(2026, 8, 24, 20, 7).getTime()
const PASSOS = passosDoDia(AGORA)
const ULTIMO = PASSOS[PASSOS.length - 1]
const ONTEM = new Date(2026, 8, 23).getTime()
/** Quadrado de 0,5° da fazenda do teste (coordenada fictícia). */
const CELULA = '-12.5_-50.5'

const larguraDeVerdade = window.innerWidth
const alturaDeVerdade = window.innerHeight

let container: HTMLDivElement
let root: Root

function overlay(): string | null {
  return container.querySelector('[data-overlay]')?.getAttribute('data-overlay') ?? null
}

function hora(): string {
  return container.querySelector('.gnss-barra-hora')?.textContent ?? ''
}

function chip(rotulo: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('.gnss-camadas button')].find((b) => b.textContent === rotulo)!
}

const botaoDia = (rotulo: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('.gnss-seletor-dia button')].find((b) => b.textContent === rotulo)!

function barra(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[aria-label="Horário do mapa"]')!
}

function play(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Reproduzir o dia"]')!
}

function pausa(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Pausar a animação do dia"]')
}

/** Remonta com relógio falso também nos timers: a espera da imagem e o play
 *  são medidos em ms. Desmonta ANTES de trocar os timers — a limpeza dos
 *  timers reais tem de usar o clearTimeout real. */
async function remontarComTimersFalsos() {
  await act(async () => root.unmount())
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(AGORA)
  root = createRoot(container)
  await act(async () => root.render(<MapaPage />))
}

function tamanho(largura: number, altura: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: largura })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: altura })
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AGORA)
  localStorage.clear()
  limparMemoriaDoMapa()
  m.mapa.fitBounds.mockClear()
  m.mapa.getZoom.mockReturnValue(5)
  m.pedidas.length = 0
  m.chamadasSerie.length = 0
  m.listasDeCelulas.length = 0
  m.serie = { series: {}, carregando: false, erro: false }
  m.limites = {}
  valor = {
    ativo: true,
    lider: true,
    alertas: [],
    atualizar: vi.fn(),
    estado: {
      ...ESTADO_INICIAL,
      fazendas: [{ id: 'f1', nome: 'Dourado', lat: -12.26, lon: -50.31, celulaId: CELULA }],
      celulas: { [CELULA]: { serie: [{ instante: ULTIMO, indice: 4, tec: 31.2, cintilacao: 80, previsto: false }], janelas: [] } },
    },
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<MapaPage />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  tamanho(larguraDeVerdade, alturaDeVerdade)
})

describe('mapa da ionosfera', () => {
  it('abre em Cintilação no último passo, com a fazenda na cor e os valores do horário', () => {
    expect(overlay()).toBe(urlOverlay('sci', ULTIMO))
    expect(container.querySelector('[data-fazenda]')?.textContent).toContain('80 de 100 (Forte)')
    expect(container.querySelector('[data-fazenda]')?.textContent).toContain('31.2 TECU')
  })

  it('o cabeçalho tem o guia do RTK, fora do grupo das camadas', () => {
    const guia = container.querySelector<HTMLButtonElement>('.gnss-cabecalho button.gnss-guia-rtk-botao')
    expect(guia?.textContent).toBe('Como isso afeta o RTK')
    expect(guia?.closest('[role="group"][aria-label="Camada do mapa"]')).toBeNull()
    // O grupo das camadas segue só com as camadas e o "?" delas.
    expect(container.querySelector('[role="group"][aria-label="Camada do mapa"]')).not.toBeNull()
  })

  it('TEC troca a camada; Off tira a imagem', async () => {
    await act(async () => chip('TEC').click())
    expect(overlay()).toBe(urlOverlay('tec', ULTIMO))
    await act(async () => chip('Off').click())
    expect(overlay()).toBeNull()
  })

  it('arrastando a barra, o horário muda na hora e o PNG só depois de 250 ms parado', async () => {
    await remontarComTimersFalsos()
    await act(async () => {
      fireEvent.change(barra(), { target: { value: '0' } })
    })
    expect(hora()).toContain(horaDe(PASSOS[0]))
    expect(overlay()).toBe(urlOverlay('sci', ULTIMO))

    await act(async () => vi.advanceTimersByTime(200))
    await act(async () => {
      fireEvent.change(barra(), { target: { value: '1' } })
    })
    await act(async () => vi.advanceTimersByTime(249))
    expect(hora()).toContain(horaDe(PASSOS[1]))
    expect(overlay()).toBe(urlOverlay('sci', ULTIMO))

    await act(async () => vi.advanceTimersByTime(1))
    expect(overlay()).toBe(urlOverlay('sci', PASSOS[1]))
  })

  it('play: um passo por segundo, e a imagem acompanha sem a espera da barra', async () => {
    await remontarComTimersFalsos()
    await act(async () => {
      fireEvent.change(barra(), { target: { value: '0' } })
    })
    await act(async () => vi.advanceTimersByTime(250))
    await act(async () => play().click())
    await act(async () => vi.advanceTimersByTime(999))
    expect(hora()).toContain(horaDe(PASSOS[0]))
    await act(async () => vi.advanceTimersByTime(1))
    expect(hora()).toContain(horaDe(PASSOS[1]))
    expect(overlay()).toBe(urlOverlay('sci', PASSOS[1]))

    // Pausar logo depois de um passo não volta a imagem ao passo anterior.
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Pausar a animação do dia"]')!.click())
    expect(overlay()).toBe(urlOverlay('sci', PASSOS[1]))
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(overlay()).toBe(urlOverlay('sci', PASSOS[1]))
  })

  it('pré-carrega os 3 passos seguintes do horário parado — não durante o arraste nem no play', async () => {
    await remontarComTimersFalsos()
    expect(m.pedidas).toEqual([]) // último passo: não há seguintes

    await act(async () => {
      fireEvent.change(barra(), { target: { value: '0' } })
    })
    expect(m.pedidas).toEqual([])
    await act(async () => vi.advanceTimersByTime(250))
    expect(m.pedidas).toEqual([1, 2, 3].map((i) => urlOverlay('sci', PASSOS[i])))

    m.pedidas.length = 0
    await act(async () => play().click())
    await act(async () => vi.advanceTimersByTime(3_000))
    expect(m.pedidas).toEqual([])
  })

  it('zoom máximo 17: a camada em grade não tem teto, o limite é enxergar o talhão', () => {
    expect(container.querySelector('[data-mapa]')?.getAttribute('data-max-zoom')).toBe('17')
  })

  it('enquadra as fazendas uma vez só, com folga e zoom máximo', () => {
    expect(m.mapa.fitBounds).toHaveBeenCalledTimes(1)
    expect(m.mapa.fitBounds.mock.calls[0][1]).toEqual({ padding: [24, 24], maxZoom: 8 })
  })

  it('enquadra quando as fazendas chegam depois do mapa, e não de novo', async () => {
    await act(async () => root.unmount())
    m.mapa.fitBounds.mockClear()
    const { fazendas, ...resto } = valor.estado
    valor = { ...valor, estado: { ...resto, fazendas: [] } }
    root = createRoot(container)
    await act(async () => root.render(<MapaPage />))
    expect(m.mapa.fitBounds).not.toHaveBeenCalled()

    valor = { ...valor, estado: { ...valor.estado, fazendas } }
    await act(async () => root.render(<MapaPage />))
    expect(m.mapa.fitBounds).toHaveBeenCalledTimes(1)

    valor = { ...valor, estado: { ...valor.estado, fazendas: [...fazendas] } }
    await act(async () => root.render(<MapaPage />))
    expect(m.mapa.fitBounds).toHaveBeenCalledTimes(1)
  })

  it('imagem que falha marca só aquela camada e horário, e some quando carrega', async () => {
    expect(hora()).not.toContain('imagem indisponível')
    await act(async () => {
      fireEvent.error(container.querySelector('[data-overlay]')!)
    })
    expect(hora()).toContain('imagem indisponível')

    await act(async () => chip('TEC').click())
    expect(hora()).not.toContain('imagem indisponível')

    await act(async () => chip('Cintilação').click())
    expect(hora()).toContain('imagem indisponível')
    await act(async () => {
      fireEvent.load(container.querySelector('[data-overlay]')!)
    })
    expect(hora()).not.toContain('imagem indisponível')
  })

  it('fundo: abre no Satélite com os nomes por cima; trocar guarda a escolha', async () => {
    const fundos = () => [...container.querySelectorAll('[data-fundo]')].map((e) => e.getAttribute('data-fundo')!)
    expect(fundos()).toHaveLength(2)
    expect(fundos()[0]).toContain('World_Imagery')
    expect(fundos()[1]).toContain('World_Boundaries_and_Places')
    const topo = [...container.querySelectorAll<HTMLButtonElement>('.gnss-fundo button')].find((b) => b.textContent === 'Topográfico')!
    await act(async () => topo.click())
    expect(fundos()).toHaveLength(1)
    expect(fundos()[0]).toContain('World_Topo_Map')
    expect(localStorage.getItem('locks_sat_fundo_v1')).toBe('topo')
  })

  it('Ontem: o dia inteiro a partir de 00:00, com a data no horário e a série pedida por quadrado', async () => {
    await remontarComTimersFalsos()
    await act(async () => botaoDia('Ontem').click())
    expect(barra().max).toBe('143')
    expect(hora()).toContain(`${dataCurta(ONTEM)} · 00:00`)
    await act(async () => vi.advanceTimersByTime(250))
    expect(overlay()).toBe(urlOverlay('sci', ONTEM))
    expect(m.chamadasSerie.at(-1)).toEqual({ dia: ONTEM, celulas: [CELULA] })
  })

  it('dia passado: a fazenda usa a série daquele dia', async () => {
    m.serie = { series: { [CELULA]: [{ instante: ONTEM, indice: 3, tec: 20, cintilacao: 50, previsto: false }] }, carregando: false, erro: false }
    await act(async () => botaoDia('Ontem').click())
    const fazenda = container.querySelector('[data-fazenda]')!
    expect(fazenda.textContent).toContain('50 de 100 (Média)')
    expect(fazenda.textContent).toContain(`${dataCurta(ONTEM)} · 00:00`)
    expect(fazenda.getAttribute('data-cor')).toBe(COR_NIVEL.media)
  })

  it('dia passado carregando: fazenda em cinza com "Carregando…"; falha: aviso no mapa', async () => {
    m.serie = { series: {}, carregando: true, erro: false }
    await act(async () => botaoDia('Ontem').click())
    expect(container.querySelector('[data-fazenda]')!.textContent).toContain('Carregando…')
    expect(container.querySelector('[data-fazenda]')!.getAttribute('data-cor')).toBe(COR_NIVEL['sem-dado'])
    m.serie = { series: {}, carregando: false, erro: true }
    await act(async () => botaoDia('Hoje').click())
    await act(async () => botaoDia('Ontem').click())
    expect(container.querySelector('.gnss-mapa-aviso')?.textContent).toContain(`Sem dados da Trimble para ${dataCurta(ONTEM)}`)
  })

  it('Hoje volta ao vivo: último passo, sem data', async () => {
    await act(async () => botaoDia('Ontem').click())
    await act(async () => botaoDia('Hoje').click())
    expect(barra().max).toBe(String(PASSOS.length - 1))
    expect(hora()).toBe(horaDe(ULTIMO))
  })

  it('de perto, a bolinha dá lugar ao contorno na cor do nível', async () => {
    await act(async () => root.unmount())
    m.limites = { f1: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }] } }
    root = createRoot(container)
    await act(async () => root.render(<MapaPage />))
    expect(container.querySelector('[data-fazenda]')).not.toBeNull()
    expect(container.querySelector('[data-contorno]')).toBeNull()
    m.mapa.getZoom.mockReturnValue(10)
    await act(async () => m.eventos.zoomend!())
    expect(container.querySelector('[data-fazenda]')).toBeNull()
    expect(container.querySelector('[data-contorno]')!.getAttribute('data-cor')).toBe(COR_NIVEL.forte)
    expect(container.querySelector('[data-contorno]')!.textContent).toContain('80 de 100 (Forte)')
  })

  it('fazenda sem contorno continua com a bolinha de perto', async () => {
    m.mapa.getZoom.mockReturnValue(10)
    await act(async () => m.eventos.zoomend!())
    expect(container.querySelector('[data-fazenda]')).not.toBeNull()
    expect(container.querySelector('[data-contorno]')).toBeNull()
  })

  describe('além do desenho do plano', () => {
    it('o contorno muda de cor com o horário sem ser refeito (o popup aberto não fecha)', async () => {
      const PASSOS_ONTEM = passosDoDiaPassado(ONTEM)
      m.limites = { f1: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }] } }
      m.serie = {
        series: {
          [CELULA]: [
            { instante: PASSOS_ONTEM[0], indice: 5, tec: 20, cintilacao: 80, previsto: false },
            { instante: PASSOS_ONTEM[1], indice: 3, tec: 20, cintilacao: 50, previsto: false },
          ],
        },
        carregando: false,
        erro: false,
      }
      await act(async () => botaoDia('Ontem').click())
      m.mapa.getZoom.mockReturnValue(10)
      await act(async () => m.eventos.zoomend!())
      const contorno = container.querySelector('[data-contorno]')!
      expect(contorno.getAttribute('data-cor')).toBe(COR_NIVEL.forte)

      await act(async () => {
        fireEvent.change(barra(), { target: { value: '1' } })
      })
      const depois = container.querySelector('[data-contorno]')!
      expect(depois.getAttribute('data-cor')).toBe(COR_NIVEL.media)
      expect(depois).toBe(contorno) // o mesmo elemento: o estilo foi trocado, não o contorno
    })

    it('o contorno começa no zoom 9: no 8 ainda é bolinha', async () => {
      await act(async () => root.unmount())
      m.limites = { f1: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }] } }
      root = createRoot(container)
      await act(async () => root.render(<MapaPage />))
      m.mapa.getZoom.mockReturnValue(8)
      await act(async () => m.eventos.zoomend!())
      expect(container.querySelector('[data-contorno]')).toBeNull()
      m.mapa.getZoom.mockReturnValue(9)
      await act(async () => m.eventos.zoomend!())
      expect(container.querySelector('[data-contorno]')).not.toBeNull()
      expect(container.querySelector('[data-fazenda]')).toBeNull()
    })

    it('a lista de quadrados que vai para a série do dia é a mesma entre renders (senão ela reiniciaria a cada um)', async () => {
      await act(async () => chip('TEC').click())
      await act(async () => chip('Off').click())
      await act(async () => botaoDia('Ontem').click())
      expect(m.listasDeCelulas.length).toBeGreaterThan(3)
      expect(new Set(m.listasDeCelulas).size).toBe(1)
    })

    it('escolher outro dia para o play e volta o botão a "Reproduzir"', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      expect(pausa()).not.toBeNull()
      await act(async () => botaoDia('Ontem').click())
      expect(pausa()).toBeNull()
      expect(play()).not.toBeNull()
      // E o dia passado abre em 00:00, parado.
      await act(async () => vi.advanceTimersByTime(3_000))
      expect(hora()).toContain(`${dataCurta(ONTEM)} · 00:00`)
    })

    it('escondido (outra categoria do COA WEB) o play não avança; ao voltar, continua', async () => {
      await remontarComTimersFalsos()
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '0' } })
      })
      await act(async () => play().click())
      await act(async () => vi.advanceTimersByTime(1_000))
      expect(hora()).toContain(horaDe(PASSOS[1]))

      await act(async () => {
        tamanho(0, 0)
        window.dispatchEvent(new Event('resize'))
      })
      await act(async () => vi.advanceTimersByTime(5_000))
      expect(hora()).toContain(horaDe(PASSOS[1]))

      await act(async () => {
        tamanho(larguraDeVerdade, alturaDeVerdade)
        window.dispatchEvent(new Event('resize'))
      })
      await act(async () => vi.advanceTimersByTime(1_000))
      expect(hora()).toContain(horaDe(PASSOS[2]))
    })

    it('de perto (zoom 9 ou mais) a camada da ionosfera é atenuada, para não esconder o satélite nem o contorno', async () => {
      const atenuada = () => container.querySelector('[data-overlay]')!.getAttribute('data-atenuada')
      expect(atenuada()).toBe('false')
      m.mapa.getZoom.mockReturnValue(8)
      await act(async () => m.eventos.zoomend!())
      expect(atenuada()).toBe('false')
      m.mapa.getZoom.mockReturnValue(9)
      await act(async () => m.eventos.zoomend!())
      expect(atenuada()).toBe('true')
      m.mapa.getZoom.mockReturnValue(5)
      await act(async () => m.eventos.zoomend!())
      expect(atenuada()).toBe('false')
    })

    it('a atenuação vale também para o TEC', async () => {
      await act(async () => chip('TEC').click())
      m.mapa.getZoom.mockReturnValue(12)
      await act(async () => m.eventos.zoomend!())
      expect(container.querySelector('[data-overlay]')!.getAttribute('data-atenuada')).toBe('true')
    })

    it('a série do dia é pedida só com o dia passado escolhido; hoje passa null', async () => {
      expect(m.chamadasSerie.at(-1)).toEqual({ dia: null, celulas: [CELULA] })
      await act(async () => botaoDia('Ontem').click())
      expect(m.chamadasSerie.at(-1)).toEqual({ dia: ONTEM, celulas: [CELULA] })
    })

    it('o aviso de falha só aparece com dia passado escolhido', async () => {
      m.serie = { series: {}, carregando: false, erro: true }
      await act(async () => botaoDia('Hoje').click())
      expect(container.querySelector('.gnss-mapa-aviso')).toBeNull()
    })
  })

  describe('memória da vista (a tela desmonta ao trocar de rota)', () => {
    const PASSOS_ONTEM = passosDoDiaPassado(ONTEM)
    const pressionado = (rotulo: string) => chip(rotulo).getAttribute('aria-pressed') === 'true'

    async function sairEVoltar() {
      await act(async () => root.unmount())
      root = createRoot(container)
      await act(async () => root.render(<MapaPage />))
    }

    it('volta no mesmo dia, na mesma camada e no mesmo passo', async () => {
      await act(async () => chip('TEC').click())
      await act(async () => botaoDia('Ontem').click())
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '5' } })
      })

      await sairEVoltar()
      expect(botaoDia('Ontem').getAttribute('aria-pressed')).toBe('true')
      expect(botaoDia('Hoje').getAttribute('aria-pressed')).toBe('false')
      expect(pressionado('TEC')).toBe(true)
      expect(barra().value).toBe('5')
      expect(hora()).toContain(`${dataCurta(ONTEM)} · ${horaDe(PASSOS_ONTEM[5])}`)
      // A imagem já abre no passo lembrado, sem esperar os 250 ms da barra.
      expect(overlay()).toBe(urlOverlay('tec', PASSOS_ONTEM[5]))
      expect(m.chamadasSerie.at(-1)).toEqual({ dia: ONTEM, celulas: [CELULA] })
    })

    it('hoje com a camada Off e um passo escolhido também volta como estava', async () => {
      await act(async () => chip('Off').click())
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '3' } })
      })
      await sairEVoltar()
      expect(pressionado('Off')).toBe(true)
      expect(overlay()).toBeNull()
      expect(barra().value).toBe('3')
      expect(botaoDia('Hoje').getAttribute('aria-pressed')).toBe('true')
    })

    it('voltar a Hoje também fica lembrado (Hoje à mão, no passo mais novo)', async () => {
      await act(async () => botaoDia('Ontem').click())
      await act(async () => botaoDia('Hoje').click())
      await sairEVoltar()
      expect(botaoDia('Hoje').getAttribute('aria-pressed')).toBe('true')
      expect(barra().value).toBe(String(PASSOS.length - 1))
      expect(hora()).toBe(horaDe(ULTIMO))
    })

    it('o play não volta tocando', async () => {
      await act(async () => play().click())
      expect(pausa()).not.toBeNull()
      await sairEVoltar()
      expect(pausa()).toBeNull()
      expect(play()).not.toBeNull()
    })

    it('pausar guarda o passo onde o play chegou', async () => {
      await remontarComTimersFalsos()
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '0' } })
      })
      await act(async () => play().click())
      await act(async () => vi.advanceTimersByTime(2_000))
      expect(hora()).toContain(horaDe(PASSOS[2]))
      await act(async () => pausa()!.click())

      await sairEVoltar()
      expect(barra().value).toBe('2')
    })

    it('limpar a memória (outro usuário) volta ao padrão: ao vivo, Cintilação, último passo', async () => {
      await act(async () => chip('TEC').click())
      await act(async () => botaoDia('Ontem').click())
      limparMemoriaDoMapa()
      await sairEVoltar()
      expect(pressionado('Cintilação')).toBe(true)
      expect(botaoDia('Ao vivo').getAttribute('aria-pressed')).toBe('true')
      expect(barra().value).toBe(String(PASSOS.length - 1))
    })

    it('dia lembrado que saiu da janela de 30 dias: abre ao vivo, no último passo', async () => {
      // 01/08 é mais velho que 24/09 − 29 dias (26/08).
      guardarMemoriaDoMapa({ dia: new Date(2026, 7, 1).getTime(), escolhido: 7, camada: 'tec', aoVivo: false })
      await sairEVoltar()
      expect(botaoDia('Ao vivo').getAttribute('aria-pressed')).toBe('true')
      expect(barra().value).toBe(String(PASSOS.length - 1))
      expect(m.chamadasSerie.at(-1)!.dia).toBeNull()
      // A camada não depende do dia: segue a lembrada.
      expect(pressionado('TEC')).toBe(true)
    })

    it('o dia mais antigo permitido (hoje − 29 dias) ainda vale', async () => {
      const limite = new Date(2026, 7, 26).getTime()
      guardarMemoriaDoMapa({ dia: limite, escolhido: 4 })
      await sairEVoltar()
      expect(m.chamadasSerie.at(-1)!.dia).toBe(limite)
      expect(barra().value).toBe('4')
    })

    it('escolhido além dos passos do dia (dia de hoje tem menos) não quebra: vai para o último', async () => {
      guardarMemoriaDoMapa({ dia: null, escolhido: 140 })
      await sairEVoltar()
      expect(barra().value).toBe(String(PASSOS.length - 1))
    })

    it('a memória é gravada nas mudanças: camada, dia e passo', async () => {
      await act(async () => chip('Off').click())
      expect(lerMemoriaDoMapa()).toEqual({ camada: 'off', dia: null, escolhido: null, aoVivo: true })
      await act(async () => botaoDia('Ontem').click())
      expect(lerMemoriaDoMapa()).toEqual({ camada: 'off', dia: ONTEM, escolhido: 0, aoVivo: false })
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '9' } })
      })
      expect(lerMemoriaDoMapa()).toEqual({ camada: 'off', dia: ONTEM, escolhido: 9, aoVivo: false })
    })
  })

  describe('ao vivo', () => {
    const pressionados = () =>
      [...container.querySelectorAll<HTMLButtonElement>('.gnss-seletor-dia button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
    const rotuloVivo = (passo: number) => `AO VIVO · ${horaDe(passo)}`
    const N = PASSOS.length
    const INICIO_JANELA = N - 18
    const passoTocando = (i: number) => PASSOS[i]

    async function sairEVoltar() {
      await act(async () => root.unmount())
      root = createRoot(container)
      await act(async () => root.render(<MapaPage />))
    }
    /** O laço do ao vivo agenda o passo seguinte a cada render: avança em fatias de 1 s para o React renderizar entre elas. */
    async function avancar(ms: number) {
      for (let restante = ms; restante > 0; restante -= 1_000) {
        await act(async () => vi.advanceTimersByTime(Math.min(1_000, restante)))
      }
    }

    it('abre ao vivo: Ao vivo pressionado, rótulo "AO VIVO · hora", aria-valuetext e o passo mais novo', () => {
      expect(pressionados()).toEqual(['Ao vivo'])
      expect(hora()).toBe(rotuloVivo(ULTIMO))
      expect(barra().getAttribute('aria-valuetext')).toBe(`ao vivo · ${horaDe(ULTIMO)}`)
      expect(container.querySelector('.gnss-barra-hora .gnss-ao-vivo')?.textContent).toBe('AO VIVO')
      expect(overlay()).toBe(urlOverlay('sci', ULTIMO))
      expect(barra().value).toBe(String(N - 1))
    })

    it('ao vivo, um passo novo publicado leva a barra, o rótulo e a imagem para ele', async () => {
      await remontarComTimersFalsos()
      await avancar(11 * 60_000)
      const novos = passosDoDia(AGORA + 11 * 60_000)
      expect(novos.length).toBe(N + 1)
      const novo = novos.at(-1)!
      expect(barra().max).toBe(String(N))
      expect(barra().value).toBe(String(N))
      expect(hora()).toBe(rotuloVivo(novo))
      await avancar(250)
      expect(overlay()).toBe(urlOverlay('sci', novo))
    })

    it('em Hoje (à mão) o passo novo NÃO leva a tela: a barra cresce e fica onde estava', async () => {
      await remontarComTimersFalsos()
      await act(async () => botaoDia('Hoje').click())
      expect(pressionados()).toEqual(['Hoje'])
      expect(hora()).toBe(horaDe(ULTIMO))
      await avancar(11 * 60_000)
      expect(barra().max).toBe(String(N))
      expect(barra().value).toBe(String(N - 1))
      expect(hora()).toBe(horaDe(ULTIMO))
      expect(overlay()).toBe(urlOverlay('sci', ULTIMO))
    })

    it('arrastar a barra ao vivo vira Hoje no passo escolhido: play parado, rótulo sem "AO VIVO"', async () => {
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '10' } })
      })
      expect(pressionados()).toEqual(['Hoje'])
      expect(hora()).toBe(horaDe(PASSOS[10]))
      expect(container.querySelector('.gnss-ao-vivo')).toBeNull()
      expect(play()).not.toBeNull()
    })

    it('Hoje a partir do ao vivo fica no passo que está na tela e para o play', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      await avancar(3_000)
      expect(hora()).toBe(rotuloVivo(passoTocando(INICIO_JANELA + 3)))
      await act(async () => botaoDia('Hoje').click())
      expect(pressionados()).toEqual(['Hoje'])
      expect(hora()).toBe(horaDe(PASSOS[INICIO_JANELA + 3]))
      expect(play()).not.toBeNull()
      await avancar(5_000)
      expect(hora()).toBe(horaDe(PASSOS[INICIO_JANELA + 3]))
    })

    it('Hoje a partir do ao vivo parado fica no passo mais novo', async () => {
      await act(async () => botaoDia('Hoje').click())
      expect(hora()).toBe(horaDe(ULTIMO))
      expect(barra().value).toBe(String(N - 1))
    })

    it('Ao vivo a partir de um dia passado volta para hoje, no passo mais novo, parado', async () => {
      await act(async () => botaoDia('Ontem').click())
      await act(async () => play().click())
      expect(pausa()).not.toBeNull()
      await act(async () => botaoDia('Ao vivo').click())
      expect(pressionados()).toEqual(['Ao vivo'])
      expect(barra().max).toBe(String(N - 1))
      expect(hora()).toBe(rotuloVivo(ULTIMO))
      expect(pausa()).toBeNull()
      expect(m.chamadasSerie.at(-1)!.dia).toBeNull()
    })

    it('Ao vivo a partir de Hoje (em outro passo) volta ao mais novo', async () => {
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '4' } })
      })
      await act(async () => botaoDia('Ao vivo').click())
      expect(hora()).toBe(rotuloVivo(ULTIMO))
    })

    it('Ontem e data personalizada: dia passado a partir de 00:00; nenhum botão de modo fica pressionado na data', async () => {
      await act(async () => botaoDia('Ontem').click())
      expect(pressionados()).toEqual(['Ontem'])
      expect(hora()).toBe(`${dataCurta(ONTEM)} · 00:00`)
      const outro = new Date(2026, 8, 10).getTime()
      await act(async () => {
        fireEvent.change(container.querySelector('input[aria-label="Escolher o dia"]')!, { target: { value: '2026-09-10' } })
      })
      expect(pressionados()).toEqual([])
      expect(hora()).toBe(`${dataCurta(outro)} · 00:00`)
      expect(m.chamadasSerie.at(-1)!.dia).toBe(outro)
    })

    it('o campo de data mostra o dia que está sendo visto', async () => {
      const campo = () => container.querySelector<HTMLInputElement>('input[aria-label="Escolher o dia"]')!
      expect(campo().value).toBe('2026-09-24')
      await act(async () => botaoDia('Ontem').click())
      expect(campo().value).toBe('2026-09-23')
    })

    it('play ao vivo: laço das últimas 18 passos — um por segundo, 3 s no mais novo, recomeça no início da janela', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      // Começa no início da janela (3 h atrás), ainda ao vivo.
      expect(hora()).toBe(rotuloVivo(PASSOS[INICIO_JANELA]))
      expect(overlay()).toBe(urlOverlay('sci', PASSOS[INICIO_JANELA]))
      expect(pressionados()).toEqual(['Ao vivo'])

      const vistos: string[] = [hora()]
      for (let s = 1; s <= 17; s++) {
        await avancar(1_000)
        vistos.push(hora())
        expect(overlay()).toBe(urlOverlay('sci', PASSOS[INICIO_JANELA + s])) // sem a espera da barra
      }
      expect(vistos).toEqual(Array.from({ length: 18 }, (_, k) => rotuloVivo(PASSOS[INICIO_JANELA + k])))
      expect(vistos.at(-1)).toBe(rotuloVivo(ULTIMO))

      // No mais novo: segura 3 s.
      await avancar(2_999)
      expect(hora()).toBe(rotuloVivo(ULTIMO))
      await avancar(1)
      expect(hora()).toBe(rotuloVivo(PASSOS[INICIO_JANELA]))
      await avancar(1_000)
      expect(hora()).toBe(rotuloVivo(PASSOS[INICIO_JANELA + 1]))
    })

    it('play ao vivo nunca mostra um passo anterior à janela, volta após volta', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      const janela = new Set(PASSOS.slice(INICIO_JANELA).map(rotuloVivo))
      for (let s = 0; s < 60; s++) {
        await avancar(1_000)
        expect(janela.has(hora())).toBe(true)
      }
    })

    it('play ao vivo: com um passo novo publicado a janela desliza e o passo novo entra na volta seguinte', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      const todos = passosDoDia(AGORA + 11 * 60_000)
      const novo = todos.at(-1)!
      const janelaNova = new Set(todos.slice(todos.length - 18).map(rotuloVivo))
      let depois = false
      const vistosDepois: string[] = []
      // Um salto até pouco antes do passo novo (o laço só dá um passo nele); dali, em fatias de 1 s.
      await act(async () => vi.advanceTimersByTime(9 * 60_000))
      for (let s = 0; s < 200; s++) {
        await avancar(1_000)
        if (barra().max === String(N)) depois = true
        if (depois) vistosDepois.push(hora())
      }
      expect(depois).toBe(true)
      expect(vistosDepois.length).toBeGreaterThan(40)
      // Depois do deslize só passos da janela nova (a amostra do instante do deslize pode ser o passo que
      // estava na tela e saiu dela: o laço o larga no tick seguinte); o passo novo aparece, e o que saiu não volta.
      expect(vistosDepois.slice(1).every((h) => janelaNova.has(h))).toBe(true)
      expect(vistosDepois).toContain(rotuloVivo(novo))
      expect(vistosDepois.slice(1)).not.toContain(rotuloVivo(PASSOS[INICIO_JANELA]))
    }, 20_000)

    it('play ao vivo não pré-carrega imagens: cada passo pede a sua; parado ao vivo não há o que pré-carregar', async () => {
      await remontarComTimersFalsos()
      expect(m.pedidas).toEqual([])
      await act(async () => play().click())
      await avancar(25_000)
      expect(m.pedidas).toEqual([])
    })

    it('pausar o laço ao vivo no passo mais novo continua ao vivo', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      await avancar(17_000)
      expect(hora()).toBe(rotuloVivo(ULTIMO))
      await act(async () => pausa()!.click())
      expect(pressionados()).toEqual(['Ao vivo'])
      expect(hora()).toBe(rotuloVivo(ULTIMO))
      expect(play()).not.toBeNull()
    })

    it('pausar o laço ao vivo em outro passo vira Hoje nesse passo', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      await avancar(5_000)
      await act(async () => pausa()!.click())
      expect(pressionados()).toEqual(['Hoje'])
      expect(hora()).toBe(horaDe(PASSOS[INICIO_JANELA + 5]))
      await avancar(5_000)
      expect(hora()).toBe(horaDe(PASSOS[INICIO_JANELA + 5]))
    })

    it('escondido (outra categoria do COA WEB) o laço ao vivo para; ao voltar mostra o passo mais novo e segue', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      await avancar(4_000)
      expect(hora()).toBe(rotuloVivo(PASSOS[INICIO_JANELA + 4]))

      await act(async () => {
        tamanho(0, 0)
        window.dispatchEvent(new Event('resize'))
      })
      await avancar(10_000)
      const parado = hora()
      await avancar(10_000)
      expect(hora()).toBe(parado)
      expect(m.pedidas).toEqual([])

      await act(async () => {
        tamanho(larguraDeVerdade, alturaDeVerdade)
        window.dispatchEvent(new Event('resize'))
      })
      expect(hora()).toBe(rotuloVivo(ULTIMO))
      // E o laço segue: 3 s no mais novo, depois volta ao início da janela.
      await avancar(3_000)
      expect(hora()).toBe(rotuloVivo(PASSOS[INICIO_JANELA]))
    })

    it('trocar para Ontem com o laço ao vivo tocando para o play', async () => {
      await remontarComTimersFalsos()
      await act(async () => play().click())
      await avancar(2_000)
      await act(async () => botaoDia('Ontem').click())
      expect(pausa()).toBeNull()
      expect(hora()).toBe(`${dataCurta(ONTEM)} · 00:00`)
    })

    it('memória: o ao vivo volta ao vivo, e o Hoje à mão volta no mesmo passo', async () => {
      await sairEVoltar()
      expect(pressionados()).toEqual(['Ao vivo'])
      await act(async () => {
        fireEvent.change(barra(), { target: { value: '12' } })
      })
      await sairEVoltar()
      expect(pressionados()).toEqual(['Hoje'])
      expect(barra().value).toBe('12')
      expect(container.querySelector('.gnss-ao-vivo')).toBeNull()
      await act(async () => botaoDia('Ao vivo').click())
      await sairEVoltar()
      expect(pressionados()).toEqual(['Ao vivo'])
      expect(lerMemoriaDoMapa()).toMatchObject({ aoVivo: true, dia: null, escolhido: null })
    })

    it('memória: dia passado volta como dia passado (nunca ao vivo); limpar volta ao vivo', async () => {
      await act(async () => botaoDia('Ontem').click())
      expect(lerMemoriaDoMapa()).toMatchObject({ aoVivo: false, dia: ONTEM })
      await sairEVoltar()
      expect(pressionados()).toEqual(['Ontem'])
      limparMemoriaDoMapa()
      await sairEVoltar()
      expect(pressionados()).toEqual(['Ao vivo'])
    })

    it('memória: o play ao vivo não volta tocando', async () => {
      await act(async () => play().click())
      await sairEVoltar()
      expect(pausa()).toBeNull()
      expect(pressionados()).toEqual(['Ao vivo'])
      expect(hora()).toBe(rotuloVivo(ULTIMO))
    })
  })
})
