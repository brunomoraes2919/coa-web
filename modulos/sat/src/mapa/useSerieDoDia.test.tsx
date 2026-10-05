import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Celula, PontoIono } from '../tipos'
import { limparCacheSerieDoDia, useSerieDoDia, type DependenciasSerieDoDia, type SerieDoDia } from './useSerieDoDia'

const DIA = new Date(2026, 8, 25).getTime()
const OUTRO_DIA = new Date(2026, 8, 24).getTime()
const TERCEIRO_DIA = new Date(2026, 8, 23).getTime()
const QUARTO_DIA = new Date(2026, 8, 22).getTime()
const CELULAS: Celula[] = [
  { id: 'a', lat: -14.5, lon: -56.5 },
  { id: 'b', lat: -13, lon: -59 },
]
const PONTO: PontoIono = { instante: DIA, indice: 2, tec: 10, cintilacao: 20, previsto: false }

const buscarSerie = vi.fn<DependenciasSerieDoDia['buscarSerie']>()
const esperar = vi.fn<DependenciasSerieDoDia['esperar']>()
const agora = vi.fn<DependenciasSerieDoDia['agora']>()
const deps: DependenciasSerieDoDia = { buscarSerie, esperar, agora }

/** Relógio falso: só anda quando o teste manda (ou quando uma espera "passa"). */
let relogio = 0

/** Promessa que o teste resolve ou rejeita quando quiser. */
function adiavel<T>() {
  let resolver!: (v: T) => void
  let rejeitar!: (e: unknown) => void
  const promessa = new Promise<T>((ok, erro) => {
    resolver = ok
    rejeitar = erro
  })
  return { promessa, resolver, rejeitar }
}

function Sonda({ dia, celulas }: { dia: number | null; celulas: Celula[] }) {
  return <output>{JSON.stringify(useSerieDoDia(dia, celulas, deps))}</output>
}

let container: HTMLDivElement
let root: Root

const resultado = () => JSON.parse(container.textContent!) as SerieDoDia
const chamadas = () => buscarSerie.mock.calls.map(([ponto, inicio, horas]) => ({ ponto, inicio, horas }))

/** Deixa as promessas dos mocks andarem (cada volta do laço é alguns microtasks). */
async function assentar() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((pronto) => setTimeout(pronto, 0)) })
}

async function montar(dia: number | null, celulas: Celula[] = CELULAS) {
  await act(async () => root.render(<Sonda dia={dia} celulas={celulas} />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  limparCacheSerieDoDia()
  relogio = 0
  agora.mockReset().mockImplementation(() => relogio)
  buscarSerie.mockReset().mockResolvedValue([PONTO])
  // Esperar de verdade deixa o tempo passar: o relógio falso anda o que foi esperado.
  esperar.mockReset().mockImplementation(async (ms) => {
    relogio += ms
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('useSerieDoDia', () => {
  it('hoje (dia = null): nada a buscar — a série de hoje é a do vigia', async () => {
    await montar(null)
    await assentar()
    expect(resultado()).toEqual({ series: {}, carregando: false, erro: false })
    expect(buscarSerie).not.toHaveBeenCalled()
  })

  it('dia passado: um pedido por quadrado, em ordem; o primeiro sai direto e o segundo espera 2 s; carregando até o fim', async () => {
    const primeira = adiavel<PontoIono[]>()
    buscarSerie.mockReturnValueOnce(primeira.promessa)
    await montar(DIA)
    expect(resultado()).toMatchObject({ series: {}, carregando: true, erro: false })
    expect(chamadas()).toEqual([{ ponto: { lat: -14.5, lon: -56.5 }, inicio: DIA, horas: 24 }])
    expect(esperar).not.toHaveBeenCalled()

    await act(async () => primeira.resolver([PONTO]))
    await assentar()
    expect(chamadas()).toEqual([
      { ponto: { lat: -14.5, lon: -56.5 }, inicio: DIA, horas: 24 },
      { ponto: { lat: -13, lon: -59 }, inicio: DIA, horas: 24 },
    ])
    expect(esperar).toHaveBeenCalledTimes(1)
    expect(esperar).toHaveBeenCalledWith(2000)
    // A espera vem DEPOIS da primeira chamada e ANTES da segunda.
    const [antes, espera, depois] = [buscarSerie.mock.invocationCallOrder[0], esperar.mock.invocationCallOrder[0], buscarSerie.mock.invocationCallOrder[1]]
    expect(antes).toBeLessThan(espera)
    expect(espera).toBeLessThan(depois)
    expect(resultado()).toEqual({ series: { a: [PONTO], b: [PONTO] }, carregando: false, erro: false })
  })

  it('o quadrado que chega primeiro já aparece, enquanto o outro ainda carrega', async () => {
    const segunda = adiavel<PontoIono[]>()
    buscarSerie.mockResolvedValueOnce([PONTO]).mockReturnValueOnce(segunda.promessa)
    await montar(DIA)
    await assentar()
    expect(resultado()).toEqual({ series: { a: [PONTO] }, carregando: true, erro: false })

    await act(async () => segunda.resolver([PONTO]))
    await assentar()
    expect(resultado()).toMatchObject({ carregando: false })
    expect(Object.keys(resultado().series)).toEqual(['a', 'b'])
  })

  it('remontar no mesmo dia usa o que ficou em memória: não pede de novo', async () => {
    await montar(DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    root = createRoot(container)
    await montar(DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(2)
    expect(resultado()).toEqual({ series: { a: [PONTO], b: [PONTO] }, carregando: false, erro: false })
  })

  it('a primeira chamada falha: erro, sem carregando, e o segundo quadrado NÃO é pedido', async () => {
    buscarSerie.mockReset().mockRejectedValue(new Error('rede'))
    await montar(DIA)
    await assentar()
    expect(resultado()).toEqual({ series: {}, carregando: false, erro: true })
    expect(buscarSerie).toHaveBeenCalledTimes(1)
    expect(esperar).not.toHaveBeenCalled()
  })

  it('a segunda chamada falha: o que já chegou fica, e há erro', async () => {
    buscarSerie.mockReset().mockResolvedValueOnce([PONTO]).mockRejectedValueOnce(new Error('rede'))
    await montar(DIA)
    await assentar()
    expect(resultado()).toEqual({ series: { a: [PONTO] }, carregando: false, erro: true })
  })

  it('trocar de dia no meio: o laço do dia antigo para (o quadrado b dele não é pedido)', async () => {
    const pausa = adiavel<void>()
    esperar.mockReturnValueOnce(pausa.promessa)
    await montar(DIA)
    await assentar()
    // a do dia antigo saiu; a espera antes de b está pendente.
    expect(chamadas()).toEqual([{ ponto: { lat: -14.5, lon: -56.5 }, inicio: DIA, horas: 24 }])

    await montar(OUTRO_DIA)
    await assentar()
    await act(async () => pausa.resolver())
    await assentar()

    const doDiaAntigo = chamadas().filter((c) => c.inicio === DIA)
    expect(doDiaAntigo).toEqual([{ ponto: { lat: -14.5, lon: -56.5 }, inicio: DIA, horas: 24 }])
    // O dia novo foi pedido por inteiro.
    expect(chamadas().filter((c) => c.inicio === OUTRO_DIA).map((c) => c.ponto)).toEqual([
      { lat: -14.5, lon: -56.5 },
      { lat: -13, lon: -59 },
    ])
    expect(resultado()).toMatchObject({ carregando: false, erro: false })
  })

  it('voltar a hoje no meio: o laço para e o resultado volta ao vazio', async () => {
    const pausa = adiavel<void>()
    esperar.mockReturnValueOnce(pausa.promessa)
    await montar(DIA)
    await assentar()
    await montar(null)
    await act(async () => pausa.resolver())
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(1)
    expect(resultado()).toEqual({ series: {}, carregando: false, erro: false })
  })

  it('série vazia: termina sem carregando, sem a célula em series, e não entra no cache', async () => {
    buscarSerie.mockReset().mockResolvedValue([])
    await montar(DIA)
    await assentar()
    expect(resultado()).toEqual({ series: {}, carregando: false, erro: false })
    expect(buscarSerie).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    root = createRoot(container)
    await montar(DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(4)
  })

  it('o tempo que já passou desde o último pedido desconta da espera (500 ms passados → espera 1500)', async () => {
    buscarSerie.mockImplementation(async () => {
      relogio += 500 // o pedido levou 500 ms
      return [PONTO]
    })
    await montar(DIA)
    await assentar()
    expect(esperar).toHaveBeenCalledTimes(1)
    expect(esperar).toHaveBeenCalledWith(1500)
  })

  it('se já passaram 2 s ou mais desde o último pedido, não espera', async () => {
    buscarSerie.mockImplementation(async () => {
      relogio += 2500
      return [PONTO]
    })
    await montar(DIA)
    await assentar()
    expect(esperar).not.toHaveBeenCalled()
    expect(buscarSerie).toHaveBeenCalledTimes(2)
  })

  it('relógio que anda para trás (ajuste do sistema) nunca faz esperar mais que 2 s', async () => {
    buscarSerie.mockImplementation(async () => {
      relogio -= 60_000
      return [PONTO]
    })
    await montar(DIA)
    await assentar()
    expect(esperar).toHaveBeenCalledWith(2000)
  })

  it('um laço NOVO logo depois do pedido de outro também espera, já antes do primeiro pedido dele', async () => {
    const primeiraEspera = adiavel<void>()
    const segundaEspera = adiavel<void>()
    esperar.mockReturnValueOnce(primeiraEspera.promessa).mockReturnValueOnce(segundaEspera.promessa)
    await montar(DIA)
    await assentar()
    // a (dia antigo) saiu; o laço dele espera antes de b.
    expect(buscarSerie).toHaveBeenCalledTimes(1)
    expect(esperar).toHaveBeenCalledTimes(1)

    await montar(OUTRO_DIA)
    await assentar()
    // O laço novo não pede de cara: o último pedido foi há 0 ms.
    expect(esperar).toHaveBeenCalledTimes(2)
    expect(esperar).toHaveBeenLastCalledWith(2000)
    expect(buscarSerie).toHaveBeenCalledTimes(1)

    await act(async () => segundaEspera.resolver())
    await assentar()
    expect(chamadas().filter((c) => c.inicio === OUTRO_DIA)).toHaveLength(2)
    await act(async () => primeiraEspera.resolver())
    await assentar()
    expect(chamadas().filter((c) => c.inicio === DIA)).toHaveLength(1)
  })

  it('segurar a seta do campo de data (vários dias seguidos): só o último dia chega a pedir', async () => {
    const esperas: { resolver: (v: void) => void }[] = []
    esperar.mockImplementation(() => {
      const e = adiavel<void>()
      esperas.push(e)
      return e.promessa
    })
    await montar(DIA) // primeiro pedido do módulo: sai direto
    await montar(OUTRO_DIA)
    await montar(TERCEIRO_DIA)
    await montar(QUARTO_DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const e of esperas) e.resolver()
    })
    await assentar()
    // Os laços dos dias do meio já tinham morrido: nenhum deles pediu.
    expect(chamadas().filter((c) => [OUTRO_DIA, TERCEIRO_DIA].includes(c.inicio))).toEqual([])
    expect(chamadas().filter((c) => c.inicio === QUARTO_DIA).length).toBeGreaterThan(0)
  })

  it('voltar a um dia cujo pedido ainda está no ar não pede de novo: espera o mesmo e termina com o dado', async () => {
    const emVoo = adiavel<PontoIono[]>()
    buscarSerie.mockReturnValueOnce(emVoo.promessa)
    await montar(DIA)
    await assentar()
    await montar(null) // sai: o laço morre, o pedido continua no ar
    await montar(DIA) // volta
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(1)
    // Esperar o pedido do outro não é pedido novo: sem pausa antes.
    expect(esperar).not.toHaveBeenCalled()
    expect(resultado()).toMatchObject({ series: {}, carregando: true, erro: false })

    await act(async () => emVoo.resolver([PONTO]))
    await assentar()
    // a veio do mesmo pedido; só b foi pedido (uma vez), e ao todo são 2 chamadas.
    expect(chamadas().map((c) => c.ponto.lon)).toEqual([-56.5, -59])
    expect(resultado()).toEqual({ series: { a: [PONTO], b: [PONTO] }, carregando: false, erro: false })
  })

  it('pedido em andamento que falha: o laço que o esperava também termina com erro', async () => {
    const emVoo = adiavel<PontoIono[]>()
    buscarSerie.mockReturnValueOnce(emVoo.promessa)
    await montar(DIA)
    await montar(null)
    await montar(DIA)
    await act(async () => emVoo.rejeitar(new Error('rede')))
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(1)
    expect(resultado()).toEqual({ series: {}, carregando: false, erro: true })
  })

  it('o pedido que terminou sai da lista de pedidos no ar: depois do vazio, voltar pede de novo', async () => {
    buscarSerie.mockReset().mockResolvedValue([])
    await montar(DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(2)
    await montar(null)
    await montar(DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(4)
  })

  it('voltar a um dia que falhou refaz o pedido e mostra "carregando", não o erro de antes', async () => {
    buscarSerie.mockRejectedValueOnce(new Error('rede'))
    await montar(DIA)
    await assentar()
    expect(resultado()).toEqual({ series: {}, carregando: false, erro: true })

    await montar(null)
    const refeito = adiavel<PontoIono[]>()
    buscarSerie.mockReturnValueOnce(refeito.promessa)
    await montar(DIA)
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(2)
    expect(resultado()).toEqual({ series: {}, carregando: true, erro: false })

    await act(async () => refeito.resolver([PONTO]))
    await assentar()
    expect(resultado()).toMatchObject({ series: { a: [PONTO] }, erro: false })
  })

  it('desmontar no meio do pedido não atualiza estado nem pede o resto (sem aviso de act)', async () => {
    const primeira = adiavel<PontoIono[]>()
    buscarSerie.mockReturnValueOnce(primeira.promessa)
    await montar(DIA)
    await act(async () => root.unmount())
    await act(async () => primeira.resolver([PONTO]))
    await assentar()
    expect(buscarSerie).toHaveBeenCalledTimes(1)
    // Remonta só para o afterEach desmontar algo.
    root = createRoot(container)
  })
})
