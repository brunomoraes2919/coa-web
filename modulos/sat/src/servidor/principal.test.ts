// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensaio, fusoCerto, horariosDoEnsaio, lerAmbiente, lerArgumentos, linhaDeRegistro } from './principal'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lerArgumentos', () => {
  it('sem argumento é o serviço', () => {
    expect(lerArgumentos([])).toEqual({ modo: 'servico' })
  })

  it('--parear, com ou sem número', () => {
    expect(lerArgumentos(['--parear'])).toEqual({ modo: 'parear' })
    expect(lerArgumentos(['--parear', '5565999990001'])).toEqual({ modo: 'parear', numero: '5565999990001' })
  })

  it('--ensaio', () => {
    expect(lerArgumentos(['--ensaio'])).toEqual({ modo: 'ensaio' })
  })

  it('--teste exige o número', () => {
    expect(lerArgumentos(['--teste', '5565999990001'])).toEqual({ modo: 'teste', numero: '5565999990001' })
    expect(() => lerArgumentos(['--teste'])).toThrow('--teste')
  })

  it('argumento desconhecido lança com a lista dos aceitos', () => {
    expect(() => lerArgumentos(['--parar'])).toThrow(/--parear.*--ensaio.*--teste/)
    expect(() => lerArgumentos(['--parear', '5565999990001', 'sobra'])).toThrow(/--parear.*--ensaio.*--teste/)
    expect(() => lerArgumentos(['--ensaio', '5565999990001'])).toThrow(/--parear.*--ensaio.*--teste/)
  })
})

describe('lerAmbiente', () => {
  const completo = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste-que-nao-pode-vazar' }

  it('lê a url, a chave e a pasta da sessão', () => {
    expect(lerAmbiente({ ...completo, LOCKS_SAT_SESSAO: '/dados/sessao' })).toEqual({
      url: 'https://exemplo.supabase.co', chave: 'chave-de-teste-que-nao-pode-vazar', pastaSessao: '/dados/sessao',
    })
  })

  it('sem LOCKS_SAT_SESSAO a pasta é ./sessao', () => {
    expect(lerAmbiente(completo).pastaSessao).toBe('./sessao')
  })

  it('sem a chave lança citando só o nome da variável', () => {
    const erro = (() => { try { lerAmbiente({ SUPABASE_URL: completo.SUPABASE_URL }) } catch (e) { return e as Error } })()
    expect(erro?.message).toContain('Falta SUPABASE_SERVICE_ROLE_KEY')
    expect(erro?.message).not.toContain(completo.SUPABASE_URL)
  })

  it('sem a url lança citando só o nome, sem repetir a chave', () => {
    const erro = (() => { try { lerAmbiente({ SUPABASE_SERVICE_ROLE_KEY: completo.SUPABASE_SERVICE_ROLE_KEY }) } catch (e) { return e as Error } })()
    expect(erro?.message).toContain('Falta SUPABASE_URL')
    expect(erro?.message).not.toContain(completo.SUPABASE_SERVICE_ROLE_KEY)
  })

  it('variável vazia (como o arquivo recém-criado) conta como faltando', () => {
    expect(() => lerAmbiente({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: 'x' })).toThrow('Falta SUPABASE_URL')
    expect(() => lerAmbiente({ SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  ' })).toThrow('Falta SUPABASE_SERVICE_ROLE_KEY')
  })
})

describe('linhaDeRegistro', () => {
  it('põe a hora local antes da linha, sem fuso', () => {
    expect(linhaDeRegistro(new Date(2026, 9, 6, 7, 5, 9).getTime(), 'WhatsApp conectado')).toBe('2026-10-06T07:05:09 WhatsApp conectado')
  })
})

describe('fusoCerto', () => {
  it('só vale America/Cuiaba', () => {
    expect(fusoCerto('America/Cuiaba')).toBe(true)
    expect(fusoCerto('UTC')).toBe(false)
    expect(fusoCerto(undefined)).toBe(false)
  })
})

describe('horariosDoEnsaio', () => {
  it('07:00, 12:00 e 30 min antes de cada janela, em ordem e sem repetir', () => {
    const porCelula = {
      c1: [{ inicio: 9 * 60 + 30, fim: 10 * 60, dias: 3 }, { inicio: 15 * 60, fim: 16 * 60, dias: 4 }],
      c2: [{ inicio: 9 * 60 + 30, fim: 11 * 60, dias: 5 }],
    }
    expect(horariosDoEnsaio(porCelula)).toEqual([7 * 60, 9 * 60, 12 * 60, 14 * 60 + 30])
  })

  it('sem janelas sobram os dois horários fixos', () => {
    expect(horariosDoEnsaio({})).toEqual([420, 720])
  })

  it('janela logo depois da meia-noite não gera horário negativo', () => {
    expect(horariosDoEnsaio({ c1: [{ inicio: 10, fim: 60, dias: 3 }] })).toEqual([0, 420, 720])
  })
})

describe('ensaio (rede simulada)', () => {
  const ambiente = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste-que-nao-pode-vazar' }
  const quadrado = { type: 'Polygon', coordinates: [[[-50.4, -12.6], [-50.2, -12.6], [-50.2, -12.4], [-50.4, -12.4], [-50.4, -12.6]]] }
  const contato = { id: 'c1', nome: 'Ana Souza', telefone: '5565999990001', todas_fazendas: true, alerta_janela: true, ativo: true, confirmado_em: '2026-10-01T00:00:00Z', confirmado_por: 'mensagem', jid: null }
  // 4 dos 7 dias com cintilação às 20:00 e 20:10 (hora de Cuiabá): uma janela de hoje, 20:00–20:10
  const serie = [29, 30, 31, 32].flatMap((d) => [0, 10].map((min) => ({
    value: 3, timeOfEstimation: new Date(2026, 8, d, 20, min).toISOString(), tecValue: 20, scintiValue: 50, predicted: false,
  })))

  function simular() {
    const chamadas: { url: string; method: string }[] = []
    const corpo = (url: string): unknown => {
      if (url.includes('gnssplanning.com')) return serie
      if (url.includes('whatsapp_contato_fazendas')) return []
      if (url.includes('whatsapp_contatos')) return [contato]
      if (url.includes('mapas_fazendas')) return [{ id: 'f1', nome: 'Fazenda Exemplo', coa_fazenda_id: 2 }]
      if (url.includes('mapas_talhoes')) return [{ fazenda_id: 'f1', geom: quadrado }]
      return []
    }
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url, method: init.method ?? 'GET' })
      return new Response(JSON.stringify(corpo(url)), { status: 200 })
    })
    return chamadas
  }

  it('percorre 07:00, 12:00 e o "antes", mostra o que enviaria e não grava nem envia nada', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 6, 10, 0) })
    const chamadas = simular()
    const linhas: string[] = []
    vi.spyOn(console, 'log').mockImplementation((l: string) => { linhas.push(l) })

    expect(await ensaio(ambiente)).toBe(0)

    const texto = linhas.join('\n')
    expect(texto).toContain('ensaio: enviaria resumo-07 a …0001')
    expect(texto).toContain('ensaio: enviaria lembrete-12 a …0001')
    expect(texto).toContain('ensaio: enviaria antes a …0001')
    expect(texto).toContain('ensaio: 19:30')
    expect(texto).toContain('ensaio: fim')
    expect(texto).not.toContain('5565999990001')
    expect(texto).not.toContain(ambiente.SUPABASE_SERVICE_ROLE_KEY)
    // só leituras no banco, e uma consulta só à Trimble para o dia inteiro
    expect(chamadas.filter((c) => c.method !== 'GET')).toEqual([])
    expect(chamadas.filter((c) => c.url.includes('gnssplanning.com'))).toHaveLength(1)
  })

  it('sem o fuso certo não faz nada', async () => {
    const chamadas = simular()
    await expect(ensaio(ambiente, 'UTC')).rejects.toThrow('America/Cuiaba')
    expect(chamadas).toEqual([])
  })
})
