// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PontoIono } from '../tipos'
import type { Banco } from './banco'
import {
  ensaio, fusoCerto, horariosDoEnsaio, lerAmbiente, lerArgumentos, ligarServico, linhaDeRegistro, rodandoComoPrograma, sessaoPareada,
} from './principal'
import type { ContatoWpp, FazendaServidor, SituacaoEnvio } from './tipos'
import type { OpcoesWhatsapp, Whatsapp } from './whatsapp'

const pastas: string[] = []
function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'locks-sat-'))
  pastas.push(pasta)
  return pasta
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

// Passa na conferência de formato e não existe: nenhum número brasileiro começa com 0 depois do DDD.
const NUMERO_VALIDO = '5565099990001'

describe('lerArgumentos', () => {
  it('sem argumento é o serviço', () => {
    expect(lerArgumentos([])).toEqual({ modo: 'servico' })
  })

  it('--parear, com ou sem número', () => {
    expect(lerArgumentos(['--parear'])).toEqual({ modo: 'parear' })
    expect(lerArgumentos(['--parear', NUMERO_VALIDO])).toEqual({ modo: 'parear', numero: NUMERO_VALIDO })
  })

  it('--ensaio', () => {
    expect(lerArgumentos(['--ensaio'])).toEqual({ modo: 'ensaio' })
  })

  it('--teste exige o número', () => {
    expect(lerArgumentos(['--teste', NUMERO_VALIDO])).toEqual({ modo: 'teste', numero: NUMERO_VALIDO })
    expect(() => lerArgumentos(['--teste'])).toThrow('--teste')
  })

  it('aceita número de 12 dígitos (sem o nono)', () => {
    expect(lerArgumentos(['--teste', '556509999001'])).toEqual({ modo: 'teste', numero: '556509999001' })
  })

  it('recusa a faixa de exemplo do guia, no teste e no pareamento', () => {
    const exemplo = 'Esse é o número de exemplo: troque pelo número de verdade.'
    for (const numero of ['5565999990000', '5565999990001', '5565999990009']) {
      expect(() => lerArgumentos(['--teste', numero]), numero).toThrow(exemplo)
      expect(() => lerArgumentos(['--parear', numero]), numero).toThrow(exemplo)
    }
  })

  it('recusa o que não é 55 + DDD + número, só com dígitos', () => {
    const errados = ['SEU_NUMERO', 'NUMERO_DO_COA', '+5565099990001', '55 65 09999-0001', '65099990001', '5505099990001', '5560099990001', '55650999900', '55650999900012']
    for (const numero of errados) {
      const erro = (() => { try { lerArgumentos(['--teste', numero]) } catch (e) { return e as Error } })()
      expect(erro?.message, numero).toContain('55 e DDD')
      expect(erro?.message, numero).not.toContain(numero)
      expect(() => lerArgumentos(['--parear', numero]), numero).toThrow('55 e DDD')
    }
  })

  it('argumento desconhecido lança com a lista dos aceitos', () => {
    expect(() => lerArgumentos(['--parar'])).toThrow(/--parear.*--ensaio.*--teste/)
    expect(() => lerArgumentos(['--parear', NUMERO_VALIDO, 'sobra'])).toThrow(/--parear.*--ensaio.*--teste/)
    expect(() => lerArgumentos(['--ensaio', NUMERO_VALIDO])).toThrow(/--parear.*--ensaio.*--teste/)
  })
})

describe('lerAmbiente', () => {
  const completo = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste-que-nao-pode-vazar' }
  const erroDe = (env: Record<string, string | undefined>) => (() => { try { lerAmbiente(env) } catch (e) { return e as Error } })()

  it('lê a url, a chave e a pasta da sessão', () => {
    expect(lerAmbiente({ ...completo, LOCKS_SAT_SESSAO: '/dados/sessao' })).toEqual({
      url: 'https://exemplo.supabase.co', chave: 'chave-de-teste-que-nao-pode-vazar', pastaSessao: '/dados/sessao',
    })
  })

  it('sem LOCKS_SAT_SESSAO a pasta é ./sessao', () => {
    expect(lerAmbiente(completo).pastaSessao).toBe('./sessao')
  })

  it('sem a chave lança citando só o nome da variável', () => {
    const erro = erroDe({ SUPABASE_URL: completo.SUPABASE_URL })
    expect(erro?.message).toContain('Falta SUPABASE_SERVICE_ROLE_KEY')
    expect(erro?.message).not.toContain(completo.SUPABASE_URL)
  })

  it('sem a url lança citando só o nome, sem repetir a chave', () => {
    const erro = erroDe({ SUPABASE_SERVICE_ROLE_KEY: completo.SUPABASE_SERVICE_ROLE_KEY })
    expect(erro?.message).toContain('Falta SUPABASE_URL')
    expect(erro?.message).not.toContain(completo.SUPABASE_SERVICE_ROLE_KEY)
  })

  it('variável vazia (como o arquivo recém-criado) conta como faltando', () => {
    expect(() => lerAmbiente({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: 'x' })).toThrow('Falta SUPABASE_URL')
    expect(() => lerAmbiente({ SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  ' })).toThrow('Falta SUPABASE_SERVICE_ROLE_KEY')
    expect(() => lerAmbiente({ SUPABASE_URL: '""', SUPABASE_SERVICE_ROLE_KEY: completo.SUPABASE_SERVICE_ROLE_KEY })).toThrow('Falta SUPABASE_URL')
  })

  it('tira espaços e aspas em volta dos dois valores', () => {
    expect(lerAmbiente({ SUPABASE_URL: ' "https://exemplo.supabase.co" ', SUPABASE_SERVICE_ROLE_KEY: "'chave-de-teste-que-nao-pode-vazar'\r" })).toEqual({
      url: 'https://exemplo.supabase.co', chave: 'chave-de-teste-que-nao-pode-vazar', pastaSessao: './sessao',
    })
  })

  it('a chave colada na linha da url não aparece no erro', () => {
    const erro = erroDe({ SUPABASE_URL: completo.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY: completo.SUPABASE_SERVICE_ROLE_KEY })
    expect(erro?.message).toBe('SUPABASE_URL não parece um endereço https://… do Supabase')
    expect(erro?.message).not.toContain(completo.SUPABASE_SERVICE_ROLE_KEY)
  })

  it('url com caminho, com http ou com maiúscula é recusada sem ser citada', () => {
    for (const url of ['https://exemplo.supabase.co/rest/v1', 'http://exemplo.supabase.co', 'https://Exemplo.supabase.co', 'https://exemplo.supabase.co?x=1']) {
      const erro = erroDe({ ...completo, SUPABASE_URL: url })
      expect(erro?.message, url).toBe('SUPABASE_URL não parece um endereço https://… do Supabase')
    }
  })

  it('chave com caractere estranho, com espaço no meio ou curta demais é recusada sem ser citada', () => {
    for (const chave of ['chave de teste com espaco no meio', 'chave-de-teste=com-sinal-de-igual', 'https://exemplo.supabase.co', 'curta-demais']) {
      const erro = erroDe({ ...completo, SUPABASE_SERVICE_ROLE_KEY: chave })
      expect(erro?.message, chave).toBe('SUPABASE_SERVICE_ROLE_KEY tem caracteres que uma chave não tem')
      expect(erro?.message, chave).not.toContain(chave)
    }
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

describe('rodandoComoPrograma', () => {
  it('só quando o arquivo chamado é este módulo', () => {
    const pasta = pastaTemporaria()
    const programa = join(pasta, 'programa.mjs')
    const outro = join(pasta, 'outro.mjs')
    writeFileSync(programa, '')
    writeFileSync(outro, '')
    const url = pathToFileURL(realpathSync(programa)).href
    expect(rodandoComoPrograma(url, programa)).toBe(true)
    expect(rodandoComoPrograma(url, outro)).toBe(false)
    expect(rodandoComoPrograma(url, join(pasta, 'nao-existe.mjs'))).toBe(false)
    expect(rodandoComoPrograma(url, undefined)).toBe(false)
  })

  it('chamado por um link simbólico também conta', (contexto) => {
    const pasta = pastaTemporaria()
    const programa = join(pasta, 'programa.mjs')
    const atalho = join(pasta, 'atalho.mjs')
    writeFileSync(programa, '')
    try {
      symlinkSync(programa, atalho)
    } catch {
      contexto.skip() // Windows sem permissão de criar link simbólico
    }
    expect(rodandoComoPrograma(pathToFileURL(realpathSync(programa)).href, atalho)).toBe(true)
  })
})

describe('sessaoPareada', () => {
  const gravar = (pasta: string, creds: unknown) => writeFileSync(join(pasta, 'creds.json'), typeof creds === 'string' ? creds : JSON.stringify(creds))
  // o que a biblioteca grava: `me` e `account` só juntos depois de o celular aceitar
  const EU = { id: '5565999990001:12@s.whatsapp.net', name: 'COA' }
  const CONTA = { details: 'Cg==', accountSignatureKey: 'AA==', accountSignature: 'AA==', deviceSignature: 'AA==' }

  it('sem a pasta ou sem o creds.json: não', () => {
    const pasta = pastaTemporaria()
    expect(sessaoPareada(pasta)).toBe(false)
    expect(sessaoPareada(join(pasta, 'nao-existe'))).toBe(false)
  })

  it('creds.json vazio, cortado no meio ou que não é um objeto: não', () => {
    const pasta = pastaTemporaria()
    for (const conteudo of ['', '{', '{"me":', 'null', '[]', '"texto"']) {
      gravar(pasta, conteudo)
      expect(sessaoPareada(pasta), conteudo).toBe(false)
    }
  })

  it('arquivo recém-criado pela biblioteca (QR ainda na tela): não', () => {
    const pasta = pastaTemporaria()
    gravar(pasta, { noiseKey: {}, registered: false })
    expect(sessaoPareada(pasta)).toBe(false)
  })

  it('pareamento por código pedido mas ainda não aceito no celular (a biblioteca já gravou `me` e até `registered`): não', () => {
    const pasta = pastaTemporaria()
    gravar(pasta, { me: { id: '5565999990001@s.whatsapp.net', name: '~' }, pairingCode: 'ABCD1234', registered: false })
    expect(sessaoPareada(pasta)).toBe(false)
    gravar(pasta, { me: { id: '5565999990001@s.whatsapp.net', name: '~' }, pairingCode: 'ABCD1234', registered: true })
    expect(sessaoPareada(pasta)).toBe(false)
  })

  it('conta registrada (`me` e `account`), por QR (`registered: false`) ou por código: sim', () => {
    const pasta = pastaTemporaria()
    gravar(pasta, { me: EU, account: CONTA, registered: false })
    expect(sessaoPareada(pasta)).toBe(true)
    gravar(pasta, { me: EU, account: CONTA, registered: true })
    expect(sessaoPareada(pasta)).toBe(true)
  })

  it('`account` sem `me`, ou com `me` sem endereço: não', () => {
    const pasta = pastaTemporaria()
    gravar(pasta, { account: CONTA })
    expect(sessaoPareada(pasta)).toBe(false)
    gravar(pasta, { me: { name: 'COA' }, account: CONTA })
    expect(sessaoPareada(pasta)).toBe(false)
    gravar(pasta, { me: EU, account: null })
    expect(sessaoPareada(pasta)).toBe(false)
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
  // meio grau a oeste: cai em outro quadrado da Trimble
  const outroQuadrado = { type: 'Polygon', coordinates: [[[-50.9, -12.6], [-50.7, -12.6], [-50.7, -12.4], [-50.9, -12.4], [-50.9, -12.6]]] }
  const contato = { id: 'c1', nome: 'Ana Souza', telefone: '5565999990001', todas_fazendas: true, alerta_janela: true, ativo: true, confirmado_em: '2026-10-01T00:00:00Z', confirmado_por: 'mensagem', jid: null }
  // 4 dos 7 dias com cintilação às 20:00 e 20:10 (hora de Cuiabá): uma janela de hoje, 20:00–20:10
  const serie = [29, 30, 31, 32].flatMap((d) => [0, 10].map((min) => ({
    value: 3, timeOfEstimation: new Date(2026, 8, d, 20, min).toISOString(), tecValue: 20, scintiValue: 50, predicted: false,
  })))

  function simular(opcoes: { duasFazendas?: boolean; fazendaSemVinculo?: boolean; contatos?: unknown[]; aoConsultarTrimble?: (url: string) => Response | undefined } = {}) {
    const chamadas: { url: string; method: string }[] = []
    const fazendas: { id: string; nome: string; coa_fazenda_id: number | null }[] = [{ id: 'f1', nome: 'Fazenda Exemplo', coa_fazenda_id: 2 }]
    const talhoes = [{ fazenda_id: 'f1', geom: quadrado }]
    if (opcoes.fazendaSemVinculo) {
      fazendas.push({ id: 'f9', nome: 'Fazenda Solta', coa_fazenda_id: null })
      talhoes.push({ fazenda_id: 'f9', geom: quadrado })
    }
    if (opcoes.duasFazendas) {
      fazendas.push({ id: 'f2', nome: 'Fazenda Outra', coa_fazenda_id: 3 })
      talhoes.push({ fazenda_id: 'f2', geom: outroQuadrado })
    }
    const corpo = (url: string): unknown => {
      if (url.includes('gnssplanning.com')) return serie
      if (url.includes('whatsapp_contato_fazendas')) return []
      if (url.includes('whatsapp_contatos')) return opcoes.contatos ?? [contato]
      if (url.includes('mapas_fazendas')) return fazendas
      if (url.includes('mapas_talhoes')) return talhoes
      return []
    }
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url, method: init.method ?? 'GET' })
      const especial = url.includes('gnssplanning.com') ? opcoes.aoConsultarTrimble?.(url) : undefined
      return especial ?? new Response(JSON.stringify(corpo(url)), { status: 200 })
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
    // todo mundo apto e toda fazenda vinculada: nenhuma linha de explicação
    expect(texto).not.toContain('não receberia')
    expect(texto).not.toContain('sem vínculo')
  })

  it('explica quem não receberia e avisa das fazendas sem vínculo com o COA WEB', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 6, 10, 0) })
    simular({
      contatos: [
        contato,
        { ...contato, id: 'c2', nome: 'Bia Lima', telefone: '5565999990002', confirmado_em: null, confirmado_por: null },
        { ...contato, id: 'c3', nome: 'Caio Reis', telefone: '5565999990003', ativo: false },
      ],
      fazendaSemVinculo: true,
    })
    const linhas: string[] = []
    vi.spyOn(console, 'log').mockImplementation((l: string) => { linhas.push(l) })

    expect(await ensaio(ambiente)).toBe(0)

    const texto = linhas.join('\n')
    expect(texto).toContain('ensaio: …0002 não receberia: aguardando ATIVAR')
    expect(texto).toContain('ensaio: …0003 não receberia: inativo')
    expect(texto).not.toContain('…0001 não receberia')
    expect(texto).toContain('ensaio: Fazendas sem vínculo com o COA WEB (não entram em contato nenhum que não seja "todas"): Fazenda Solta')
    expect(texto).not.toMatch(/55659999900\d\d/)
    // a explicação vem antes do primeiro horário
    expect(linhas.findIndex((l) => l.includes('não receberia'))).toBeLessThan(linhas.findIndex((l) => l.includes('ensaio: 07:00')))
  })

  it('espera 2 s antes de cada consulta à Trimble depois da primeira, também na nova tentativa', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 6, 10, 0) })
    const ordem: string[] = []
    let falhasDoSegundo = 1
    simular({
      duasFazendas: true,
      aoConsultarTrimble: (url) => {
        const segundo = url.includes('/ionoindex/-51/')
        ordem.push(segundo ? 'consulta 2' : 'consulta 1')
        if (segundo && falhasDoSegundo-- > 0) return new Response('fora do ar', { status: 500 })
        return undefined
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const pausa = vi.fn(async (ms: number) => { ordem.push(`pausa ${ms}`) })

    expect(await ensaio(ambiente, 'America/Cuiaba', pausa)).toBe(0)

    // o quadrado que já respondeu não é consultado de novo; o que falhou espera como qualquer outro
    expect(ordem).toEqual(['consulta 1', 'pausa 2000', 'consulta 2', 'pausa 2000', 'consulta 2'])
  })

  it('sem o fuso certo não faz nada', async () => {
    const chamadas = simular()
    await expect(ensaio(ambiente, 'UTC')).rejects.toThrow('America/Cuiaba')
    expect(chamadas).toEqual([])
  })
})

describe('ligarServico (tudo falso)', () => {
  const jidDe = (telefone: string) => `${telefone}@s.whatsapp.net`
  const pessoa = (id: string, nome: string, telefone: string): ContatoWpp => ({
    id, nome, telefone, todasFazendas: true, fazendas: [], alertaJanela: true, ativo: true,
    confirmadoEm: '2026-10-01T00:00:00Z', confirmadoPor: 'mensagem', jid: jidDe(telefone), atualizadoEm: null,
  })
  const ANA = pessoa('c-ana', 'Ana Souza', '5565999990001')
  const BIA = pessoa('c-bia', 'Bia Lima', '5565999990002')
  const FAZENDA: FazendaServidor = { id: 'f1', coaId: 2, nome: 'Fazenda Exemplo', celulaId: 'c1', lat: -12.5, lon: -50.5 }
  // 4 dos 7 dias anteriores com cintilação das 19:00 às 20:00: uma janela de hoje, que entra no resumo das 07:00
  const SERIE: PontoIono[] = [5, 4, 3, 2].flatMap((dia) => [0, 10, 20, 30, 40, 50].map((min): PontoIono => ({
    instante: new Date(2026, 9, dia, 19, min).getTime(), indice: 8, tec: 50, cintilacao: 80, previsto: false,
  })))

  /** O serviço ligado às 06:59:30 de um dia com janela: a primeira volta (07:00:30) manda o resumo a Ana e depois a Bia. */
  async function ligar(opcoes: { pareado?: boolean; segurarEnvios?: boolean; segurarPausa?: boolean } = {}) {
    vi.useFakeTimers({ now: new Date(2026, 9, 6, 6, 59, 30) })
    const ordem: string[] = []
    const linhas: string[] = []
    const estados: Parameters<Banco['gravarEstado']>[0][] = []
    const envios = new Map<string, SituacaoEnvio>()
    const soltar: (() => void)[] = []
    const soltarPausas: (() => void)[] = []
    const estado = { pareado: opcoes.pareado ?? true, consultasTrimble: 0 }
    const banco: Banco = {
      contatos: async () => [ANA, BIA].map((c) => ({ ...c })),
      fazendas: async () => [FAZENDA],
      reservarEnvio: async (contatoId, chave) => {
        const k = `${contatoId}|${chave}`
        if (envios.has(k)) return false
        envios.set(k, 'enviando')
        return true
      },
      fecharEnvio: async (contatoId, chave, situacao) => {
        envios.set(`${contatoId}|${chave}`, situacao)
        ordem.push(`fechar ${situacao}`)
      },
      chavesDoDia: async (dia) => [...envios].map(([k, situacao]) => ({ contatoId: k.split('|')[0], chave: k.split('|')[1], situacao }))
        .filter((r) => r.chave.startsWith(`${dia}:`)),
      confirmar: async () => {},
      guardarJid: async () => {},
      pausar: async () => {
        if (opcoes.segurarPausa) await new Promise<void>((r) => { soltarPausas.push(r) })
        ordem.push('pausar')
      },
      gravarEstado: async (e) => {
        estados.push(e)
        if (e.ultimoErro) ordem.push(`estado ${e.ultimoErro}`)
      },
      limparEnviosAntigos: async () => {},
    }
    const whatsapp: Whatsapp = {
      conectado: true,
      precisaParear: false,
      restritoAte: null,
      enviar: (jid) => {
        const quem = jid.slice(9, 13)
        ordem.push(`enviar ${quem}: começo`)
        return new Promise<string | null>((resolver) => {
          const fim = () => { ordem.push(`enviar ${quem}: fim`); resolver(`MSG-${quem}`) }
          if (opcoes.segurarEnvios) soltar.push(fim)
          else fim()
        })
      },
      resolverJid: async () => null,
      encerrar: async () => { ordem.push('encerrar') },
    }
    let opcoesDaConexao: OpcoesWhatsapp | undefined
    const conectar = vi.fn(async (o: OpcoesWhatsapp) => { opcoesDaConexao = o; return whatsapp })
    const sair = vi.fn((codigo: number) => { ordem.push(`sair ${codigo}`) })
    const processo = new EventEmitter()
    await ligarServico({
      banco,
      trimble: { historico: async () => { estado.consultasTrimble += 1; return SERIE } },
      conectar,
      pastaSessao: '/dados/sessao',
      pareado: () => estado.pareado,
      registrar: (linha) => { linhas.push(linha) },
      sair,
      processo,
    })
    return { ordem, linhas, estados, soltar, soltarPausas, estado, conectar, sair, processo, whatsapp, opcoesDaConexao: () => opcoesDaConexao }
  }
  const passar = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('conecta com a pasta da sessão e avisa que ligou', async () => {
    const s = await ligar()
    expect(s.conectar).toHaveBeenCalledTimes(1)
    expect(s.opcoesDaConexao()?.pastaSessao).toBe('/dados/sessao')
    expect(s.linhas).toContain('serviço ligado')
  })

  it('SIGTERM durante um envio: o envio termina, nenhum outro começa, e só então encerra e grava o estado', async () => {
    const s = await ligar({ segurarEnvios: true })
    await passar(60_000)
    expect(s.ordem).toEqual(['enviar 0001: começo'])

    s.processo.emit('SIGTERM')
    await passar(0)
    expect(s.ordem).toEqual(['enviar 0001: começo'])
    expect(s.sair).not.toHaveBeenCalled()

    s.soltar[0]()
    await passar(0)
    expect(s.ordem).toEqual(['enviar 0001: começo', 'enviar 0001: fim', 'fechar enviado', 'encerrar', 'estado serviço parado', 'sair 0'])
    expect(s.estados.at(-1)).toMatchObject({ conectado: false, ultimoErro: 'serviço parado' })
    expect(s.linhas).toContain('enviado resumo-07 a …0001')
  })

  it('depois do sinal o serviço enxerga o WhatsApp como desconectado, mesmo com a conexão aberta', async () => {
    const s = await ligar({ segurarEnvios: true })
    await passar(60_000)
    s.processo.emit('SIGTERM')
    s.soltar[0]()
    await passar(0)
    // o registro do último envio já sai com conectado: false
    expect(s.estados.find((e) => e.ultimoEnvioEm !== undefined)).toMatchObject({ conectado: false })
    expect(s.whatsapp.conectado).toBe(true)
  })

  it('SIGINT na pausa entre duas pessoas: a pausa acaba na hora e a segunda não recebe', async () => {
    const s = await ligar()
    await passar(60_000)
    expect(s.ordem).toEqual(['enviar 0001: começo', 'enviar 0001: fim', 'fechar enviado'])

    s.processo.emit('SIGINT')
    await passar(0)
    expect(s.ordem).toEqual(['enviar 0001: começo', 'enviar 0001: fim', 'fechar enviado', 'encerrar', 'estado serviço parado', 'sair 0'])
  })

  it('sem o sinal, a segunda pessoa recebe depois da pausa', async () => {
    const s = await ligar()
    await passar(60_000)
    await passar(45_000)
    expect(s.ordem).toEqual(['enviar 0001: começo', 'enviar 0001: fim', 'fechar enviado', 'enviar 0002: começo', 'enviar 0002: fim', 'fechar enviado'])
  })

  it('envio que não termina: espera no máximo 20 s e encerra assim mesmo', async () => {
    const s = await ligar({ segurarEnvios: true })
    await passar(60_000)
    s.processo.emit('SIGTERM')
    await passar(19_000)
    expect(s.ordem).toEqual(['enviar 0001: começo'])
    await passar(1_500)
    expect(s.ordem).toEqual(['enviar 0001: começo', 'encerrar', 'estado serviço parado', 'sair 0'])
  })

  it('um segundo sinal durante a espera sai na hora, sem esperar o envio', async () => {
    const s = await ligar({ segurarEnvios: true })
    await passar(60_000)
    s.processo.emit('SIGTERM')
    await passar(0)
    expect(s.sair).not.toHaveBeenCalled()
    s.processo.emit('SIGTERM')
    expect(s.sair).toHaveBeenCalledTimes(1)
    expect(s.ordem).toEqual(['enviar 0001: começo', 'sair 1'])
  })

  it('parado sem volta em curso: encerra, grava o estado e sai com 0; o relógio não roda mais', async () => {
    const s = await ligar()
    s.processo.emit('SIGTERM')
    await passar(0)
    expect(s.ordem).toEqual(['encerrar', 'estado serviço parado', 'sair 0'])
    await passar(180_000)
    expect(s.estado.consultasTrimble).toBe(0)
  })

  it('durante a parada a Trimble não é mais consultada', async () => {
    const s = await ligar({ segurarEnvios: true })
    await passar(60_000)
    expect(s.estado.consultasTrimble).toBe(1)
    s.processo.emit('SIGTERM')
    s.soltar[0]()
    await passar(120_000)
    expect(s.estado.consultasTrimble).toBe(1)
  })

  it('A1. SIGTERM com um SAIR ainda sendo gravado: espera a gravação e só então encerra', async () => {
    const s = await ligar({ segurarPausa: true })
    void s.opcoesDaConexao()?.aoReceber({ jid: jidDe('5565999990001'), texto: 'SAIR', em: null })
    await passar(0)
    s.processo.emit('SIGTERM')
    await passar(5_000)
    expect(s.ordem).not.toContain('encerrar')
    expect(s.sair).not.toHaveBeenCalled()
    s.soltarPausas[0]()
    await passar(0)
    expect(s.ordem.indexOf('pausar')).toBeGreaterThanOrEqual(0)
    expect(s.ordem.indexOf('pausar')).toBeLessThan(s.ordem.indexOf('encerrar'))
    expect(s.ordem.at(-1)).toBe('sair 0')
  })

  it('A1. SIGTERM com a gravação pendurada: espera 10 s e encerra assim mesmo, dentro do teto da parada', async () => {
    const s = await ligar({ segurarPausa: true })
    void s.opcoesDaConexao()?.aoReceber({ jid: jidDe('5565999990001'), texto: 'SAIR', em: null })
    await passar(0)
    s.processo.emit('SIGTERM')
    await passar(9_000)
    expect(s.ordem).not.toContain('encerrar')
    await passar(1_500)
    expect(s.ordem).toContain('encerrar')
    expect(s.ordem).not.toContain('pausar')
    expect(s.ordem.at(-1)).toBe('sair 0')
  })

  it('promessa rejeitada sem tratamento: registra só o nome do erro e segue vivo', async () => {
    const s = await ligar()
    s.processo.emit('unhandledRejection', new TypeError('texto com segredo'))
    s.processo.emit('unhandledRejection', 'texto com segredo')
    expect(s.linhas).toContain('erro não tratado: TypeError')
    expect(s.linhas).toContain('erro não tratado: erro')
    expect(s.linhas.join('\n')).not.toContain('segredo')
    expect(s.sair).not.toHaveBeenCalled()
  })

  it('exceção sem tratamento: registra só o nome do erro e sai com 1', async () => {
    const s = await ligar()
    s.processo.emit('uncaughtException', new RangeError('texto com segredo'))
    expect(s.linhas).toContain('erro não tratado: RangeError')
    expect(s.linhas.join('\n')).not.toContain('segredo')
    expect(s.sair).toHaveBeenCalledWith(1)
  })

  it('sem sessão pareada não abre conexão: avisa, grava o estado e confere a cada minuto', async () => {
    const s = await ligar({ pareado: false })
    expect(s.conectar).not.toHaveBeenCalled()
    expect(s.linhas).toContain('Ainda não pareado: rode o pareamento (ver LEIA-ME).')
    expect(s.estados).toHaveLength(1)
    expect(s.estados[0]).toMatchObject({ conectado: false, ultimoErro: 'ainda não pareado' })

    await passar(120_000)
    expect(s.conectar).not.toHaveBeenCalled()
    expect(s.linhas.filter((l) => l.startsWith('Ainda não pareado'))).toHaveLength(1)
    expect(s.sair).not.toHaveBeenCalled()

    s.estado.pareado = true
    await passar(60_000)
    expect(s.conectar).toHaveBeenCalledTimes(1)
    await passar(120_000)
    expect(s.conectar).toHaveBeenCalledTimes(1)
  })

  it('a restrição avisada pela conexão chega ao serviço: grava o aviso e nada sai, e o "sumiu" antes do prazo é ignorado', async () => {
    const s = await ligar()
    const ate = new Date(2026, 9, 6, 15, 0).getTime()
    s.opcoesDaConexao()?.aoRestringir?.(ate, 'BIZ_QUALITY')
    await passar(0)
    expect(s.estados.at(-1)).toEqual({ conectado: true, ultimoErro: 'WhatsApp restringiu os envios até 06/10 15:00' })
    await passar(120_000)
    expect(s.ordem.filter((o) => o.startsWith('enviar'))).toEqual([])
    // a biblioteca limpa sozinha o campo aos 60 s: o aviso de que sumiu só vale depois do prazo guardado
    s.opcoesDaConexao()?.aoRestringir?.(null, 'restrição retirada')
    await passar(60_000)
    expect(s.ordem.filter((o) => o.startsWith('enviar'))).toEqual([])
  })

  it('três recusas de entrega avisadas pela conexão param os envios e gravam o aviso', async () => {
    const s = await ligar()
    for (const _ of [1, 2, 3]) s.opcoesDaConexao()?.aoFalharEntrega?.(jidDe('5565999990001'))
    await passar(0)
    expect(s.estados.at(-1)).toEqual({ conectado: true, ultimoErro: 'WhatsApp recusou 3 mensagens seguidas: envios parados até amanhã' })
    await passar(120_000)
    expect(s.ordem.filter((o) => o.startsWith('enviar'))).toEqual([])
    expect(s.linhas.join('\n')).not.toContain('5565999990001')
  })

  it('queda sem volta por outro motivo não manda parear de novo', async () => {
    const s = await ligar()
    Object.assign(s.whatsapp, { conectado: false, precisaParear: true })
    await s.opcoesDaConexao()?.aoMudarConexao(false, 'sessão em uso em outro lugar')
    expect(s.linhas.join('\n')).not.toContain('parear de novo')
    expect(s.linhas).toContain('O WhatsApp fechou a conexão (sessão em uso em outro lugar) e o serviço não tenta de novo sozinho: ver "Se algo der errado" no LEIA-ME.')
    await s.opcoesDaConexao()?.aoMudarConexao(false, 'sessão encerrada no celular')
    expect(s.linhas).toContain('Sessão encerrada: é preciso parear de novo (ver LEIA-ME).')
  })
})

describe('desenho do QR do pareamento', () => {
  it('desenha com a biblioteca de verdade (chamada solta de `generate` quebrava com "bad rs block")', async () => {
    const { desenhadorDeQr } = await import('./principal')
    const escrito: string[] = []
    const original = console.log
    console.log = (...partes: unknown[]) => { escrito.push(partes.join(' ')) }
    try {
      const desenhar = await desenhadorDeQr()
      // formato de um QR de pareamento: referência, chaves e identificador separados por vírgula (valores fictícios)
      desenhar('2@AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh,ZmljdGljaW8tMQ==,ZmljdGljaW8tMg==,ZmljdGljaW8tMw==')
    } finally {
      console.log = original
    }
    const desenho = escrito.join('\n')
    expect(desenho.split('\n').length).toBeGreaterThan(10)
    expect(desenho).toMatch(/[▀▄█]/)
  })
})
