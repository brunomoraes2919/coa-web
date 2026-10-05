import { beforeEach, describe, expect, it } from 'vitest'
import { carregarFazendasSat, CHAVE_CENTROS, limitesDaSessao, limparLimitesDaSessao, type DepsCadastro } from './cadastro'

const AGORA = new Date(2026, 9, 5, 10, 0).getTime()
const DIA = 24 * 3_600_000

const quadrado = (x: number, y: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]],
})

/** Cliente falso: `from(t).select(c).order(o).range(de, ate)` devolve a fatia pedida de `tabelas[t]`. */
function clienteFalso(tabelas: Record<string, unknown[]>, erro?: string) {
  const pedidos: { tabela: string; de?: number; ate?: number }[] = []
  const cliente = {
    from(tabela: string) {
      const consulta = {
        select: () => consulta,
        order: () => consulta,
        range: (de: number, ate: number) => {
          pedidos.push({ tabela, de, ate })
          return Promise.resolve(erro
            ? { data: null, error: { message: erro } }
            : { data: (tabelas[tabela] ?? []).slice(de, ate + 1), error: null })
        },
      }
      return consulta
    },
  }
  return { cliente, pedidos }
}

function memoria(inicial: Record<string, string> = {}) {
  const dados = { ...inicial }
  return {
    dados,
    getItem: (k: string) => dados[k] ?? null,
    setItem: (k: string, v: string) => { dados[k] = v },
  }
}

const FAZENDAS = [
  { id: 'f2', nome: 'Siriema' },
  { id: 'f1', nome: 'Dourado' },
  { id: 'f3', nome: 'Sem Talhão' },
]
const TALHOES = [
  { fazenda_id: 'f1', geom: quadrado(-51, -13) },
  { fazenda_id: 'f1', geom: quadrado(-50, -13) },
  { fazenda_id: 'f2', geom: quadrado(-59.5, -13.5) },
]

function deps(cliente: unknown, armazenamento = memoria()): DepsCadastro & { armazenamento: ReturnType<typeof memoria> } {
  return { cliente: cliente as DepsCadastro['cliente'], armazenamento, agora: () => AGORA }
}

beforeEach(() => limparLimitesDaSessao())

describe('cadastro do Mapas', () => {
  it('fazendas em ordem alfabética, com o centro dos talhões e o quadrado de 0,5°', async () => {
    const { cliente } = clienteFalso({ mapas_fazendas: FAZENDAS, mapas_talhoes: TALHOES })
    const d = deps(cliente)
    expect(await carregarFazendasSat(d)).toEqual([
      { id: 'f1', nome: 'Dourado', lat: -12.5, lon: -50, celulaId: '-12.5_-50' },
      { id: 'f3', nome: 'Sem Talhão', lat: null, lon: null, celulaId: null },
      { id: 'f2', nome: 'Siriema', lat: -13, lon: -59, celulaId: '-13_-59' },
    ])
    expect(JSON.parse(d.armazenamento.dados[CHAVE_CENTROS])).toEqual({
      em: AGORA,
      centros: { f1: { lat: -12.5, lon: -50 }, f2: { lat: -13, lon: -59 } },
      semLimite: ['f3'],
    })
  })

  it('fazenda sem talhão guardada como tal: o recarregamento não baixa os talhões de novo', async () => {
    const armazenamento = memoria()
    const primeira = clienteFalso({ mapas_fazendas: FAZENDAS, mapas_talhoes: TALHOES })
    const esperado = await carregarFazendasSat(deps(primeira.cliente, armazenamento))
    expect(primeira.pedidos.some((p) => p.tabela === 'mapas_talhoes')).toBe(true)

    limparLimitesDaSessao()
    const segunda = clienteFalso({ mapas_fazendas: FAZENDAS, mapas_talhoes: TALHOES })
    const fazendas = await carregarFazendasSat(deps(segunda.cliente, armazenamento))
    expect(segunda.pedidos.map((p) => p.tabela)).toEqual(['mapas_fazendas'])
    expect(fazendas).toEqual(esperado)
    expect(fazendas.find((f) => f.id === 'f3')).toMatchObject({ lat: null, lon: null, celulaId: null })
  })

  it('fazenda nova, que não está nem nos centros nem nos "sem talhão", baixa os talhões', async () => {
    const guardado = JSON.stringify({
      em: AGORA - DIA,
      centros: { f1: { lat: -12.5, lon: -50 }, f2: { lat: -13, lon: -59 } },
      semLimite: ['f3'],
    })
    const d = deps(
      clienteFalso({ mapas_fazendas: [...FAZENDAS, { id: 'f4', nome: 'Nova' }], mapas_talhoes: TALHOES }).cliente,
      memoria({ [CHAVE_CENTROS]: guardado }),
    )
    const fazendas = await carregarFazendasSat(d)
    expect(fazendas.find((f) => f.id === 'f4')).toMatchObject({ lat: null, celulaId: null })
    expect(JSON.parse(d.armazenamento.dados[CHAVE_CENTROS]).semLimite).toEqual(['f3', 'f4'])
  })

  it('"sem talhão" também vale só por 7 dias: depois disso baixa de novo', async () => {
    const guardado = JSON.stringify({
      em: AGORA - 8 * DIA,
      centros: { f1: { lat: 1, lon: 1 }, f2: { lat: 1, lon: 1 } },
      semLimite: ['f3'],
    })
    const { cliente, pedidos } = clienteFalso({ mapas_fazendas: FAZENDAS, mapas_talhoes: TALHOES })
    const fazendas = await carregarFazendasSat(deps(cliente, memoria({ [CHAVE_CENTROS]: guardado })))
    expect(pedidos.some((p) => p.tabela === 'mapas_talhoes')).toBe(true)
    expect(fazendas.find((f) => f.id === 'f1')?.lat).toBe(-12.5)
  })

  it('guardado de antes, sem "semLimite", ainda vale e é lido como lista vazia', async () => {
    const { cliente, pedidos } = clienteFalso({ mapas_fazendas: FAZENDAS.slice(0, 2), mapas_talhoes: TALHOES })
    const guardado = JSON.stringify({ em: AGORA - DIA, centros: { f1: { lat: -12.5, lon: -50 }, f2: { lat: -13, lon: -59 } } })
    await carregarFazendasSat(deps(cliente, memoria({ [CHAVE_CENTROS]: guardado })))
    expect(pedidos.map((p) => p.tabela)).toEqual(['mapas_fazendas'])

    // Uma terceira fazenda não coberta por nada baixa os talhões, como antes.
    limparLimitesDaSessao()
    const outra = clienteFalso({ mapas_fazendas: FAZENDAS, mapas_talhoes: TALHOES })
    await carregarFazendasSat(deps(outra.cliente, memoria({ [CHAVE_CENTROS]: guardado })))
    expect(outra.pedidos.some((p) => p.tabela === 'mapas_talhoes')).toBe(true)
  })

  it('"semLimite" estragado (não é lista de textos) vale como lista vazia', async () => {
    for (const semLimite of ['lixo', [1, 2], ['f3', 7], null, { f3: true }]) {
      limparLimitesDaSessao()
      const guardado = JSON.stringify({
        em: AGORA - DIA,
        centros: { f1: { lat: -12.5, lon: -50 }, f2: { lat: -13, lon: -59 } },
        semLimite,
      })
      const { cliente, pedidos } = clienteFalso({ mapas_fazendas: FAZENDAS, mapas_talhoes: TALHOES })
      const d = deps(cliente, memoria({ [CHAVE_CENTROS]: guardado }))
      await carregarFazendasSat(d)
      expect(pedidos.some((p) => p.tabela === 'mapas_talhoes')).toBe(true)
      expect(JSON.parse(d.armazenamento.dados[CHAVE_CENTROS]).semLimite).toEqual(['f3'])

      // Sem a lista das fazendas (o Mapa), o estragado também não passa para o que é gravado.
      limparLimitesDaSessao()
      const mapa = deps(clienteFalso({ mapas_talhoes: TALHOES }).cliente, memoria({ [CHAVE_CENTROS]: guardado }))
      await limitesDaSessao(mapa)
      expect(JSON.parse(mapa.armazenamento.dados[CHAVE_CENTROS]).semLimite).toEqual([])
    }
  })

  it('os limites da sessão mantêm o "semLimite" guardado, menos quem agora tem talhão', async () => {
    const guardado = JSON.stringify({ em: AGORA - DIA, centros: {}, semLimite: ['f1', 'x9'] })
    const d = deps(clienteFalso({ mapas_talhoes: TALHOES }).cliente, memoria({ [CHAVE_CENTROS]: guardado }))
    await limitesDaSessao(d)
    expect(JSON.parse(d.armazenamento.dados[CHAVE_CENTROS])).toEqual({
      em: AGORA,
      centros: { f1: { lat: -12.5, lon: -50 }, f2: { lat: -13, lon: -59 } },
      semLimite: ['x9'],
    })
  })

  it('os limites da sessão sem guardado válido gravam "semLimite" vazio', async () => {
    const d = deps(clienteFalso({ mapas_talhoes: TALHOES }).cliente)
    await limitesDaSessao(d)
    expect(JSON.parse(d.armazenamento.dados[CHAVE_CENTROS]).semLimite).toEqual([])
  })

  it('com os centros guardados e em dia, não baixa os talhões', async () => {
    const { cliente, pedidos } = clienteFalso({ mapas_fazendas: FAZENDAS.slice(0, 2), mapas_talhoes: TALHOES })
    const guardado = JSON.stringify({ em: AGORA - DIA, centros: { f1: { lat: -12.5, lon: -50 }, f2: { lat: -13, lon: -59 } } })
    const fazendas = await carregarFazendasSat(deps(cliente, memoria({ [CHAVE_CENTROS]: guardado })))
    expect(fazendas.map((f) => f.celulaId)).toEqual(['-12.5_-50', '-13_-59'])
    expect(pedidos.map((p) => p.tabela)).toEqual(['mapas_fazendas'])
  })

  it('centro que falta, centros velhos (mais de 7 dias) ou guardado estragado: baixa os talhões', async () => {
    for (const guardado of [
      JSON.stringify({ em: AGORA - DIA, centros: { f1: { lat: -12.5, lon: -50 } } }),
      JSON.stringify({ em: AGORA - 8 * DIA, centros: { f1: { lat: 1, lon: 1 }, f2: { lat: 1, lon: 1 } } }),
      '{não é json',
      'null',
    ]) {
      limparLimitesDaSessao()
      const { cliente, pedidos } = clienteFalso({ mapas_fazendas: FAZENDAS.slice(0, 2), mapas_talhoes: TALHOES })
      const fazendas = await carregarFazendasSat(deps(cliente, memoria({ [CHAVE_CENTROS]: guardado })))
      expect(pedidos.some((p) => p.tabela === 'mapas_talhoes')).toBe(true)
      expect(fazendas.map((f) => f.lat)).toEqual([-12.5, -13])
    }
  })

  it('os talhões vêm em páginas e a sessão guarda o resultado (um download só)', async () => {
    const muitos = Array.from({ length: 620 }, (_, i) => ({ fazenda_id: `f${i % 2}`, geom: quadrado(-57 + i / 1000, -15) }))
    const { cliente, pedidos } = clienteFalso({ mapas_talhoes: muitos })
    const d = deps(cliente)
    const [a, b] = await Promise.all([limitesDaSessao(d), limitesDaSessao(d)])
    expect(a).toBe(b)
    expect(a.f0.features.length + a.f1.features.length).toBe(620)
    expect(pedidos.filter((p) => p.tabela === 'mapas_talhoes').map((p) => [p.de, p.ate])).toEqual([[0, 249], [250, 499], [500, 749]])
  })

  it('falha do Supabase não fica guardada: a próxima tentativa pede de novo', async () => {
    const ruim = clienteFalso({}, 'fora do ar')
    await expect(limitesDaSessao(deps(ruim.cliente))).rejects.toThrow('fora do ar')
    const bom = clienteFalso({ mapas_talhoes: TALHOES })
    expect(Object.keys(await limitesDaSessao(deps(bom.cliente)))).toEqual(['f1', 'f2'])
  })
})
