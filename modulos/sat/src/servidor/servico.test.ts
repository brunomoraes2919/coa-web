// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PontoIono } from '../tipos'
import type { Banco } from './banco'
import { mascarar } from './comandos'
import { textoAtivado, textoSaiu } from './mensagens'
import { ContadorDoDia, TETO_DO_DIA } from './ritmo'
import { Servico } from './servico'
import type { ContatoWpp, FazendaServidor, SituacaoEnvio, TipoEvento } from './tipos'

afterEach(() => vi.restoreAllMocks())

const em = (h: number, m = 0, dia = 6) => new Date(2026, 9, dia, h, m).getTime()
const HOJE = '2026-10-06'
const AMANHA = '2026-10-07'
const PRAZO_DO_WHATSAPP = 60_000
const vezes = (n: number) => Array.from({ length: n }, (_, i) => i)

const fazenda = (id: string, coaId: number, nome: string, celulaId: string | null, lat: number | null, lon: number | null): FazendaServidor =>
  ({ id, coaId, nome, celulaId, lat, lon })
// Globo e Boa Vista têm quadrado só deles; Nebraska e Três Flechas dividem o c2; Sem Talhão não tem quadrado.
const FAZENDAS = [
  fazenda('f1', 1, 'Globo', 'c1', -12.5, -50.5),
  fazenda('f2', 2, 'Nebraska', 'c2', -12.5, -50),
  fazenda('f3', 3, 'Três Flechas', 'c2', -12.5, -50),
  fazenda('f4', 4, 'Boa Vista', 'c3', -13, -51),
  fazenda('f5', 5, 'Sem Talhão', null, null, null),
]

const jidDe = (telefone: string) => `${telefone}@s.whatsapp.net`
const contato = (extra: Partial<ContatoWpp> = {}): ContatoWpp => {
  const telefone = extra.telefone ?? '5565999990001'
  return {
    id: 'c-ana', nome: 'Ana Souza', telefone, todasFazendas: false, fazendas: [2], alertaJanela: true,
    ativo: true, confirmadoEm: '2026-10-01T00:00:00Z', confirmadoPor: 'mensagem', jid: jidDe(telefone), ...extra,
  }
}
const ANA = contato()
const BRUNO = contato({ id: 'c-bruno', nome: 'Bruno Lima', telefone: '5565999990002' })
const CARLA = contato({ id: 'c-carla', nome: 'Carla Dias', telefone: '5565999990003' })
const DIEGO = contato({ id: 'c-diego', nome: 'Diego Reis', telefone: '5565999990004' })

/** Quatro dias anteriores com cintilação média/forte no intervalo: dá uma janela com 4 de 7 dias. */
function serieComJanela(inicioMin: number, fimMin: number, dias = 4): PontoIono[] {
  const fatias = Array.from({ length: Math.ceil((fimMin - inicioMin) / 10) }, (_, i) => inicioMin + i * 10)
  return vezes(dias).flatMap((d) => {
    const base = new Date(2026, 9, 5 - d).getTime()
    return fatias.map((min): PontoIono => ({ instante: base + min * 60_000, indice: 8, tec: 50, cintilacao: 80, previsto: false }))
  })
}

class BancoFalso implements Banco {
  envios = new Map<string, SituacaoEnvio>()
  reservas: [string, string, TipoEvento][] = []
  fechamentos: { contatoId: string; chave: string; situacao: string; erro?: string }[] = []
  estados: Parameters<Banco['gravarEstado']>[0][] = []
  confirmacoes: [string, string][] = []
  jidsGuardados: [string, string][] = []
  pausas: string[] = []
  tentativasDePausa: string[] = []
  chamadas: string[] = []
  limpezas = 0
  leiturasDeFazendas = 0
  erroDeContatos: Error | null = null
  pausarLanca = false
  reservaLanca = new Set<string>()
  fecharLanca = new Set<string>()
  chavesEscondidas = false
  /** Quantas das próximas gravações de estado falham. */
  estadoLanca = 0
  /** Ganchos para os testes de ordem: o que acontece no meio de uma chamada ao banco. */
  aoReservar?: () => void
  antesDePausar?: () => Promise<void>
  antesDeConfirmar?: () => Promise<void>
  constructor(private ordem: string[], public contatosLista: ContatoWpp[], public fazendasLista: FazendaServidor[]) {}

  get escritas() {
    return this.reservas.length + this.fechamentos.length + this.estados.length + this.confirmacoes.length
      + this.jidsGuardados.length + this.tentativasDePausa.length + this.limpezas
  }
  async contatos() {
    this.chamadas.push('contatos')
    if (this.erroDeContatos) {
      const e = this.erroDeContatos
      this.erroDeContatos = null
      throw e
    }
    return this.contatosLista.map((c) => ({ ...c }))
  }
  async fazendas() {
    this.chamadas.push('fazendas')
    this.leiturasDeFazendas += 1
    return this.fazendasLista
  }
  async reservarEnvio(contatoId: string, chave: string, tipo: TipoEvento) {
    this.chamadas.push('reservarEnvio')
    if (this.reservaLanca.has(contatoId)) throw new Error('Supabase fora do ar')
    const k = `${contatoId}|${chave}`
    if (this.envios.has(k)) return false
    this.envios.set(k, 'enviando')
    this.reservas.push([contatoId, chave, tipo])
    this.ordem.push('reservar')
    this.aoReservar?.()
    return true
  }
  async fecharEnvio(contatoId: string, chave: string, situacao: 'enviado' | 'falhou' | 'pulado', erro?: string) {
    this.chamadas.push('fecharEnvio')
    if (this.fecharLanca.has(contatoId)) throw new Error('Supabase recusou fechar o envio')
    this.envios.set(`${contatoId}|${chave}`, situacao)
    this.fechamentos.push({ contatoId, chave, situacao, erro })
    this.ordem.push('fechar')
  }
  async chavesDoDia(dia: string) {
    this.chamadas.push('chavesDoDia')
    if (this.chavesEscondidas) return []
    return [...this.envios.entries()].map(([k, situacao]) => {
      const [contatoId, chave] = k.split('|')
      return { contatoId, chave, situacao }
    }).filter((r) => r.chave.startsWith(`${dia}:`))
  }
  async confirmar(contatoId: string, jid: string) {
    this.chamadas.push('confirmar')
    await this.antesDeConfirmar?.()
    this.confirmacoes.push([contatoId, jid])
    this.ordem.push('confirmar')
    const c = this.contatosLista.find((x) => x.id === contatoId)
    if (c) {
      c.ativo = true
      c.confirmadoEm = '2026-10-06T00:00:00Z'
    }
  }
  async guardarJid(contatoId: string, jid: string) {
    this.chamadas.push('guardarJid')
    this.jidsGuardados.push([contatoId, jid])
  }
  async pausar(contatoId: string) {
    this.chamadas.push('pausar')
    this.tentativasDePausa.push(contatoId)
    if (this.pausarLanca) throw new Error('Supabase fora do ar')
    await this.antesDePausar?.()
    this.pausas.push(contatoId)
    this.ordem.push('pausar')
    const c = this.contatosLista.find((x) => x.id === contatoId)
    if (c) c.ativo = false
  }
  async gravarEstado(estado: Parameters<Banco['gravarEstado']>[0]) {
    this.chamadas.push('gravarEstado')
    if (this.estadoLanca > 0) {
      this.estadoLanca -= 1
      throw new Error('Supabase fora do ar')
    }
    this.estados.push(estado)
  }
  async limparEnviosAntigos() {
    this.chamadas.push('limparEnviosAntigos')
    this.limpezas += 1
  }
}

class WhatsappFalso {
  conectado = true
  precisaParear = false
  enviados: { jid: string; texto: string }[] = []
  resolvidos: string[] = []
  jids: Record<string, string | null> = {}
  falhaEnvio = new Map<string, Error>()
  /** Endereços para os quais `enviar` nunca responde. */
  pendurados = new Set<string>()
  resolverPendurado = false
  depoisDeEnviar?: (jid: string) => void
  constructor(private ordem: string[]) {}
  async enviar(jid: string, texto: string): Promise<string | null> {
    this.ordem.push('enviar')
    if (this.pendurados.has(jid)) return new Promise<string | null>(() => {})
    const erro = this.falhaEnvio.get(jid)
    if (erro) throw erro
    this.enviados.push({ jid, texto })
    this.depoisDeEnviar?.(jid)
    return `MSG${this.enviados.length}`
  }
  async resolverJid(telefone: string) {
    this.resolvidos.push(telefone)
    if (this.resolverPendurado) return new Promise<string | null>(() => {})
    return telefone in this.jids ? this.jids[telefone] : null
  }
}

class TrimbleFalsa {
  chamadas: { lat: number; lon: number; agora: number }[] = []
  falhasPendentes = 0
  sempreFalha = false
  falhasPorQuadrado = new Map<string, number>()
  series: Record<string, PontoIono[]> = {
    '-12.5_-50.5': serieComJanela(19 * 60, 20 * 60),
    '-12.5_-50': serieComJanela(19 * 60, 20 * 60),
    '-13_-51': [],
  }
  async historico(celula: { lat: number; lon: number }, agora: number) {
    this.chamadas.push({ ...celula, agora })
    const quadrado = `${celula.lat}_${celula.lon}`
    const doQuadrado = this.falhasPorQuadrado.get(quadrado) ?? 0
    if (this.sempreFalha || this.falhasPendentes > 0 || doQuadrado > 0) {
      if (this.falhasPendentes > 0) this.falhasPendentes -= 1
      if (doQuadrado > 0) this.falhasPorQuadrado.set(quadrado, doQuadrado - 1)
      throw new Error('Sem resposta da Trimble.')
    }
    return this.series[quadrado] ?? []
  }
}

interface Opcoes { contatos?: ContatoWpp[]; ensaio?: boolean; banco?: BancoFalso }

function montar(opcoes: Opcoes = {}, inicio = em(7)) {
  const ordem: string[] = []
  const relogio = { agora: inicio }
  // cópia: pausar() e confirmar() alteram o contato
  const banco = opcoes.banco ?? new BancoFalso(ordem, (opcoes.contatos ?? [ANA]).map((c) => ({ ...c })), FAZENDAS)
  const wpp = new WhatsappFalso(ordem)
  const trimble = new TrimbleFalsa()
  const sonos: number[] = []
  const registro: string[] = []
  const gancho: { somar: boolean; estourarPrazo: boolean; aoDormir?: (ms: number) => Promise<void> } = { somar: false, estourarPrazo: false }
  const servico = new Servico({
    banco,
    trimble,
    whatsapp: wpp,
    agora: () => relogio.agora,
    dormir: async (ms) => {
      sonos.push(ms)
      if (ms === PRAZO_DO_WHATSAPP) {
        // o prazo só vence se o teste mandar; senão a corrida fica com a chamada ao WhatsApp
        if (gancho.estourarPrazo) return
        return new Promise<void>(() => {})
      }
      if (ms >= 20_000) ordem.push('pausa')
      else if (ms >= 3_000) ordem.push('entre respostas')
      if (gancho.somar) relogio.agora += ms
      await gancho.aoDormir?.(ms)
    },
    registrar: (linha) => registro.push(linha),
    ensaio: opcoes.ensaio,
  })
  /** Põe o relógio na hora e faz uma volta. */
  const volta = async (h: number, m = 0, dia = 6) => {
    relogio.agora = em(h, m, dia)
    await servico.volta()
  }
  const pausasEntrePessoas = () => sonos.filter((ms) => ms >= 20_000 && ms < PRAZO_DO_WHATSAPP)
  const contador = () => (servico as unknown as { contador: ContadorDoDia }).contador
  const recebida = (c: ContatoWpp, texto: string) => servico.recebida({ jid: jidDe(c.telefone), texto })
  /** Os avisos gravados em `ultimo_erro`, na ordem (sem os batimentos, que não mexem nele). */
  const avisos = () => banco.estados.filter((e) => e.ultimoErro !== undefined).map((e) => e.ultimoErro)
  return { servico, banco, wpp, trimble, relogio, registro, sonos, ordem, gancho, volta, pausasEntrePessoas, contador, recebida, avisos }
}

const umInstante = () => new Promise<void>((r) => setTimeout(r, 5))
/** Uma promessa que o teste solta quando quiser. */
function trava() {
  let soltar: () => void = () => {}
  const espera = new Promise<void>((r) => { soltar = r })
  return { espera, soltar }
}

const semNumerosNoRegistro = (registro: string[]) => expect(registro.join('\n')).not.toMatch(/55\d{8,}/)
const alertasPara = (c: ReturnType<typeof montar>, telefone: string) =>
  c.wpp.enviados.filter((e) => e.jid === jidDe(telefone) && e.texto.includes('Janela'))

describe('servico: o que sai a cada minuto', () => {
  it('1. às 07:00 reserva o resumo, envia e fecha como enviado; a primeira do dia leva a linha do SAIR', async () => {
    const c = montar()
    await c.volta(7)
    expect(c.banco.reservas).toEqual([['c-ana', `${HOJE}:resumo-07`, 'resumo-07']])
    expect(c.wpp.enviados).toHaveLength(1)
    const { jid, texto } = c.wpp.enviados[0]
    expect(jid).toBe(jidDe('5565999990001'))
    expect(texto).toContain('Bom dia, Ana.')
    expect(texto).toContain('Janelas de risco de cintilação hoje entre 19:00 e 20:00 em Nebraska.')
    expect(texto).toContain('Para parar de receber, responda SAIR.')
    expect(c.banco.fechamentos).toEqual([{ contatoId: 'c-ana', chave: `${HOJE}:resumo-07`, situacao: 'enviado' }])
    // a reserva vem antes do envio, e o envio antes de fechar
    expect(c.ordem).toEqual(['reservar', 'enviar', 'fechar'])
    expect(c.banco.estados.some((e) => e.ultimoEnvioEm !== undefined)).toBe(true)
    semNumerosNoRegistro(c.registro)
  })

  it('2. a segunda volta (mesmo minuto ou 07:20) não repete; e reserva negada nunca envia', async () => {
    const c = montar()
    await c.volta(7)
    await c.volta(7)
    await c.volta(7, 20)
    expect(c.wpp.enviados).toHaveLength(1)

    // lista de chaves do dia desatualizada: quem barra é a reserva (devolve false)
    const d = montar()
    await d.volta(7)
    d.banco.chavesEscondidas = true
    await d.volta(7, 1)
    expect(d.wpp.enviados).toHaveLength(1)
    expect(d.banco.reservas).toHaveLength(1)
  })

  it('3. às 12:00 sai o lembrete, sem a linha do SAIR', async () => {
    const c = montar()
    await c.volta(7)
    await c.volta(12)
    expect(c.wpp.enviados).toHaveLength(2)
    expect(c.banco.reservas[1]).toEqual(['c-ana', `${HOJE}:lembrete-12`, 'lembrete-12'])
    const { texto } = c.wpp.enviados[1]
    expect(texto).toContain('Lembrete: janela de risco de cintilação hoje a partir de 19:00 em Nebraska.')
    expect(texto).toContain('Boa tarde, Ana.')
    expect(texto).not.toContain('SAIR')
  })

  it('4. às 18:30, com janela às 19:00, sai o "começa em breve" uma vez só; se é a primeira do dia, leva o SAIR', async () => {
    const c = montar()
    await c.volta(18, 30)
    await c.volta(18, 31)
    await c.volta(18, 45)
    expect(c.wpp.enviados).toHaveLength(1)
    expect(c.banco.reservas).toEqual([['c-ana', `${HOJE}:antes`, 'antes']])
    expect(c.wpp.enviados[0].texto).toContain('Janela de risco de cintilação começa em breve: 19:00–20:00')
    expect(c.wpp.enviados[0].texto).toContain('Boa noite, Ana.')
    expect(c.wpp.enviados[0].texto).toContain('Para parar de receber, responda SAIR.')

    // quando já houve mensagem no dia, o "antes" vai sem a linha
    const d = montar()
    await d.volta(7)
    await d.volta(18, 30)
    expect(d.wpp.enviados).toHaveLength(2)
    expect(d.wpp.enviados[1].texto).not.toContain('SAIR')
  })

  it('5. contato inativo, sem "Janela de risco" ou sem confirmação não recebe; o apto recebe', async () => {
    const inativo = contato({ ativo: false })
    const semAlerta = contato({ id: 'c-bruno', nome: 'Bruno', telefone: '5565999990002', alertaJanela: false })
    const naoConfirmado = contato({ id: 'c-carla', nome: 'Carla', telefone: '5565999990003', confirmadoEm: null, confirmadoPor: null })
    const c = montar({ contatos: [inativo, semAlerta, naoConfirmado, DIEGO] })
    await c.volta(7)
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-diego'])
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990004')])
  })

  it('6. sem janela nas fazendas do contato: não reserva nem envia', async () => {
    const semJanela = contato({ fazendas: [4] }) // Boa Vista: quadrado sem janela
    const semQuadrado = contato({ id: 'c-bruno', nome: 'Bruno', telefone: '5565999990002', fazendas: [5] }) // sem talhão
    const c = montar({ contatos: [semJanela, semQuadrado] })
    await c.volta(7)
    await c.volta(12)
    await c.volta(18, 30)
    expect(c.banco.reservas).toEqual([])
    expect(c.wpp.enviados).toEqual([])
  })

  it('7. entre uma pessoa e outra espera a pausa; a ordem é a alfabética do nome', async () => {
    const c = montar({ contatos: [CARLA, ANA, BRUNO] })
    await c.volta(7)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002'), jidDe('5565999990003')])
    const pausas = c.pausasEntrePessoas()
    expect(pausas).toHaveLength(2)
    for (const ms of pausas) {
      expect(ms).toBeGreaterThanOrEqual(20_000)
      expect(ms).toBeLessThan(45_000)
    }
    expect(c.ordem.filter((o) => o !== 'fechar')).toEqual(['reservar', 'enviar', 'pausa', 'reservar', 'enviar', 'pausa', 'reservar', 'enviar'])
    semNumerosNoRegistro(c.registro)
  })

  it('8. confirmado à mão, sem jid: resolve uma vez, guarda e envia; sem WhatsApp fecha como falhou', async () => {
    const manual = contato({ jid: null, confirmadoPor: 'manual' })
    const c = montar({ contatos: [manual] })
    c.wpp.jids['5565999990001'] = '556599990001@s.whatsapp.net'
    await c.volta(7)
    await c.volta(7, 1)
    expect(c.wpp.resolvidos).toEqual(['5565999990001'])
    expect(c.banco.jidsGuardados).toEqual([['c-ana', '556599990001@s.whatsapp.net']])
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual(['556599990001@s.whatsapp.net'])

    const d = montar({ contatos: [manual] }) // resolverJid devolve null
    await d.volta(7)
    await d.volta(7, 1)
    expect(d.wpp.resolvidos).toHaveLength(1)
    expect(d.wpp.enviados).toEqual([])
    expect(d.banco.reservas).toHaveLength(1)
    expect(d.banco.fechamentos).toEqual([{ contatoId: 'c-ana', chave: `${HOJE}:resumo-07`, situacao: 'falhou', erro: 'número sem WhatsApp' }])
    semNumerosNoRegistro(d.registro)
  })

  it('8b. número sem WhatsApp não é consultado de novo no mesmo dia; no dia seguinte, sim', async () => {
    const c = montar({ contatos: [contato({ jid: null, confirmadoPor: 'manual' })] })
    await c.volta(7)
    await c.volta(12)
    expect(c.wpp.resolvidos).toHaveLength(1)
    // o evento das 12:00 também fecha como falhou, sem perguntar ao WhatsApp
    expect(c.banco.fechamentos.map((f) => [f.chave, f.situacao, f.erro])).toEqual([
      [`${HOJE}:resumo-07`, 'falhou', 'número sem WhatsApp'],
      [`${HOJE}:lembrete-12`, 'falhou', 'número sem WhatsApp'],
    ])
    expect(c.wpp.enviados).toEqual([])
    await c.volta(7, 0, 7)
    expect(c.wpp.resolvidos).toHaveLength(2)
  })

  it('9. se enviar lança, fecha como falhou com a mensagem e segue para o próximo', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.wpp.falhaEnvio.set(jidDe('5565999990001'), new Error('socket caiu'))
    await c.volta(7)
    expect(c.banco.fechamentos).toEqual([
      { contatoId: 'c-ana', chave: `${HOJE}:resumo-07`, situacao: 'falhou', erro: 'socket caiu' },
      { contatoId: 'c-bruno', chave: `${HOJE}:resumo-07`, situacao: 'enviado' },
    ])
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990002')])
    semNumerosNoRegistro(c.registro)
  })

  it('10. WhatsApp fora do ar às 07:00 não reserva nada; às 07:30 o resumo ainda sai; às 08:05 já não', async () => {
    const c = montar()
    c.wpp.conectado = false
    await c.volta(7)
    expect(c.banco.reservas).toEqual([])
    c.wpp.conectado = true
    await c.volta(7, 30)
    expect(c.wpp.enviados).toHaveLength(1)

    const d = montar()
    d.wpp.conectado = false
    await d.volta(7)
    d.wpp.conectado = true
    await d.volta(8, 5)
    expect(d.banco.reservas).toEqual([])
    expect(d.wpp.enviados).toEqual([])
  })

  it('11. Trimble falha: não envia; só tenta de novo 5 min depois', async () => {
    const c = montar()
    c.trimble.falhasPendentes = 1
    await c.volta(7)
    expect(c.wpp.enviados).toEqual([])
    expect(c.trimble.chamadas).toHaveLength(1)
    expect(c.registro).toContain('Trimble: Sem resposta da Trimble.')
    for (const m of [1, 2, 3, 4]) await c.volta(7, m)
    expect(c.trimble.chamadas).toHaveLength(1)
    expect(c.wpp.enviados).toEqual([])
    await c.volta(7, 5)
    expect(c.trimble.chamadas).toHaveLength(4) // três quadrados
    expect(c.wpp.enviados).toHaveLength(1)
  })

  it('12. calcula às 07:00 (uma chamada por quadrado distinto), não às 07:30, de novo às 12:00', async () => {
    const c = montar()
    await c.volta(7)
    expect(c.trimble.chamadas.map((x) => `${x.lat}_${x.lon}`).sort()).toEqual(['-12.5_-50', '-12.5_-50.5', '-13_-51'])
    expect(c.sonos.filter((ms) => ms === 2_000)).toHaveLength(2) // pausa entre quadrados
    await c.volta(7, 30)
    expect(c.trimble.chamadas).toHaveLength(3)
    await c.volta(12)
    expect(c.trimble.chamadas).toHaveLength(6)
  })

  it('13. teto por pessoa: com 3 alertas contados o quarto não é reservado nem enviado', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    for (const _ of vezes(3)) c.contador().contar('c-ana')
    await c.volta(7)
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-bruno'])
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990002')])
    // não houve pausa à toa por quem foi barrado
    expect(c.pausasEntrePessoas()).toEqual([])
  })

  it('14. teto do dia: para de enviar e grava o aviso uma vez só', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    for (const _ of vezes(TETO_DO_DIA)) c.contador().contar(null)
    await c.volta(7)
    await c.volta(7, 1)
    expect(c.banco.reservas).toEqual([])
    expect(c.wpp.enviados).toEqual([])
    const avisos = c.banco.estados.filter((e) => e.ultimoErro === 'teto diário de mensagens atingido')
    expect(avisos).toEqual([{ conectado: true, ultimoErro: 'teto diário de mensagens atingido' }])
  })

  it('o teto é conferido de novo antes de cada envio, não só no começo da volta', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    // durante a pausa chega uma enxurrada de respostas e estoura o teto do dia
    c.gancho.aoDormir = async (ms) => {
      if (ms >= 20_000) for (const _ of vezes(TETO_DO_DIA)) c.contador().contar(null)
    }
    await c.volta(7)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001')])
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana'])
  })
})

describe('servico: janelas e Trimble', () => {
  it('1. janelas de ontem não valem hoje: Trimble fora do ar de 00:05 às 08:00 do dia 7, nada sai', async () => {
    const c = montar({}, em(12))
    await c.volta(12) // cálculo bom no dia 6; o lembrete sai
    expect(c.wpp.enviados).toHaveLength(1)
    c.trimble.sempreFalha = true
    const chamadasAntes = c.trimble.chamadas.length
    for (const [h, m] of [[0, 5], [0, 10], [7, 0], [7, 5], [7, 30], [8, 0]]) await c.volta(h, m, 7)
    expect(c.banco.reservas).toHaveLength(1)
    expect(c.wpp.enviados).toHaveLength(1)
    // continuou tentando, a cada 5 min
    expect(c.trimble.chamadas.length).toBeGreaterThan(chamadasAntes + 3)
  })

  it('1b. se a Trimble volta às 07:20, o resumo sai às 07:20', async () => {
    const c = montar({}, em(12))
    await c.volta(12)
    c.trimble.sempreFalha = true
    await c.volta(0, 5, 7)
    await c.volta(7, 0, 7)
    expect(c.wpp.enviados).toHaveLength(1)
    c.trimble.sempreFalha = false
    await c.volta(7, 20, 7)
    expect(c.wpp.enviados).toHaveLength(2)
    expect(c.banco.reservas[1]).toEqual(['c-ana', `${AMANHA}:resumo-07`, 'resumo-07'])
  })

  it('1c. janelas calculadas às 00:05 valem para o resumo das 07:00 mesmo se o cálculo das 07:00 falhar', async () => {
    const c = montar({}, em(0, 5))
    await c.volta(0, 5)
    c.trimble.sempreFalha = true
    await c.volta(7)
    expect(c.wpp.enviados).toHaveLength(1)
    expect(c.wpp.enviados[0].texto).toContain('Janelas de risco de cintilação hoje')
  })

  it('5. as fazendas são lidas junto do cálculo, não a cada minuto', async () => {
    const c = montar()
    for (const m of vezes(10)) await c.volta(7, m)
    expect(c.banco.leiturasDeFazendas).toBe(1)
    await c.volta(12)
    expect(c.banco.leiturasDeFazendas).toBe(2)
  })

  it('7. Trimble fora: tenta a cada 5 min por 60 min; a falha das 08:00 grava o aviso; depois, uma tentativa por hora', async () => {
    const c = montar()
    c.trimble.sempreFalha = true
    for (let m = 0; m < 60; m++) await c.volta(7, m)
    expect(c.trimble.chamadas).toHaveLength(12) // 07:00, 07:05, …, 07:55
    expect(c.avisos()).toEqual([])
    await c.volta(8, 0)
    expect(c.trimble.chamadas).toHaveLength(13)
    expect(c.banco.estados.filter((e) => e.ultimoErro !== undefined)).toEqual([
      { conectado: true, ultimoErro: 'Sem dados da Trimble desde 07:00: alertas parados até ela voltar' },
    ])
    for (let m = 1; m < 60; m++) await c.volta(8, m)
    expect(c.trimble.chamadas).toHaveLength(13)
    await c.volta(9, 0)
    expect(c.trimble.chamadas).toHaveLength(14)
    for (let m = 1; m < 60; m++) await c.volta(9, m)
    await c.volta(10, 0)
    expect(c.trimble.chamadas).toHaveLength(15)
    // o aviso foi gravado uma vez só
    expect(c.avisos()).toHaveLength(1)
    expect(c.wpp.enviados).toEqual([])
    semNumerosNoRegistro(c.registro)
  })

  it('7b. quando um cálculo dá certo, o aviso da Trimble é limpo', async () => {
    const c = montar()
    c.trimble.sempreFalha = true
    for (let m = 0; m <= 60; m += 5) await c.volta(7 + Math.floor(m / 60), m % 60)
    expect(c.avisos()).toEqual(['Sem dados da Trimble desde 07:00: alertas parados até ela voltar'])
    c.trimble.sempreFalha = false
    await c.volta(8, 30) // ainda não é hora de tentar
    expect(c.avisos()).toHaveLength(1)
    await c.volta(9, 0)
    expect(c.avisos()).toEqual(['Sem dados da Trimble desde 07:00: alertas parados até ela voltar', null])
    expect(c.banco.estados.at(-1)).toEqual({ conectado: true, ultimoErro: null })
    // e a falha seguinte começa a contar do zero
    c.trimble.sempreFalha = true
    await c.volta(12, 0)
    await c.volta(12, 5)
    await c.volta(12, 55)
    expect(c.avisos()).toHaveLength(2)
  })

  it('7c. cada horário de cálculo abre uma rodada nova: às 12:00 volta a tentar a cada 5 min, e o aviso continua', async () => {
    const c = montar()
    c.trimble.sempreFalha = true
    for (let m = 0; m <= 60; m += 5) await c.volta(7 + Math.floor(m / 60), m % 60)
    for (const h of [9, 10, 11]) await c.volta(h, 0)
    const antes = c.trimble.chamadas.length
    expect(antes).toBe(16)
    await c.volta(11, 58)
    expect(c.trimble.chamadas).toHaveLength(antes)
    await c.volta(12, 0)
    await c.volta(12, 3)
    await c.volta(12, 5)
    await c.volta(12, 10)
    expect(c.trimble.chamadas).toHaveLength(antes + 3)
    expect(c.avisos()).toEqual(['Sem dados da Trimble desde 07:00: alertas parados até ela voltar'])
  })

  it('7d. Trimble fora desde ontem: o aviso diz o dia', async () => {
    const c = montar({}, em(12))
    c.trimble.sempreFalha = true
    for (let m = 0; m <= 60; m += 5) await c.volta(12 + Math.floor(m / 60), m % 60)
    expect(c.avisos()).toEqual(['Sem dados da Trimble desde 12:00: alertas parados até ela voltar'])
    for (let m = 5; m <= 65; m += 5) await c.volta(Math.floor(m / 60), m % 60, 7)
    expect(c.avisos().at(-1)).toBe('Sem dados da Trimble desde 06/10 12:00: alertas parados até ela voltar')
  })

  it('6. falha parcial: na nova tentativa só os quadrados que faltam são consultados', async () => {
    const c = montar()
    c.banco.fazendasLista = FAZENDAS.slice(0, 2) // dois quadrados: c1 e c2
    c.trimble.falhasPorQuadrado.set('-12.5_-50', 1) // o segundo falha uma vez
    await c.volta(7)
    expect(c.trimble.chamadas.map((x) => `${x.lat}_${x.lon}`)).toEqual(['-12.5_-50.5', '-12.5_-50'])
    expect(c.wpp.enviados).toEqual([])
    await c.volta(7, 5)
    expect(c.trimble.chamadas.map((x) => `${x.lat}_${x.lon}`)).toEqual(['-12.5_-50.5', '-12.5_-50', '-12.5_-50'])
    expect(c.wpp.enviados).toHaveLength(1)
    expect(c.banco.leiturasDeFazendas).toBe(1)
  })
})

describe('servico: reserva antes de enviar', () => {
  it('se a reserva lança, não envia a ela e segue para o próximo', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.reservaLanca.add('c-ana')
    await c.volta(7)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990002')])
    expect(c.registro.some((l) => l.includes('Supabase fora do ar'))).toBe(true)
    semNumerosNoRegistro(c.registro)
  })

  it('se fechar o envio lança depois de enviar, não reenvia na volta seguinte e segue para o próximo', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.fecharLanca.add('c-ana')
    await c.volta(7)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002')])
    await c.volta(7, 1)
    await c.volta(7, 2)
    expect(c.wpp.enviados).toHaveLength(2)
    expect(c.banco.reservas).toHaveLength(2)
    expect(c.registro.some((l) => l.includes('não fechei o envio'))).toBe(true)
  })

  it('SAIR que chega durante a reserva: nada é enviado e o envio fica como pulado', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    let tratada: Promise<void> | undefined
    c.banco.aoReservar = () => {
      // só a marca posta na chegada protege: a fila ainda nem começou a tratar a mensagem
      if (c.banco.reservas.at(-1)?.[0] === 'c-bruno') tratada = c.recebida(BRUNO, 'SAIR')
    }
    await c.volta(7)
    await tratada
    expect(alertasPara(c, '5565999990002')).toEqual([])
    expect(alertasPara(c, '5565999990001')).toHaveLength(1)
    expect(c.banco.fechamentos).toContainEqual({ contatoId: 'c-bruno', chave: `${HOJE}:resumo-07`, situacao: 'pulado', erro: 'pediu para sair' })
    expect(c.banco.envios.get(`c-bruno|${HOJE}:resumo-07`)).toBe('pulado')
    // não conta no teto nem volta a sair na volta seguinte
    expect(c.contador().total).toBe(2) // o alerta da Ana e a resposta ao SAIR
    await c.volta(7, 1)
    expect(alertasPara(c, '5565999990002')).toEqual([])
    semNumerosNoRegistro(c.registro)
  })

  it('"começa em breve" é por noite: a janela depois da meia-noite não gera outro; a do dia seguinte gera', async () => {
    const c = montar({}, em(18, 30))
    await c.volta(18, 30)
    expect(c.banco.reservas).toEqual([['c-ana', `${HOJE}:antes`, 'antes']])
    c.trimble.series['-12.5_-50'] = serieComJanela(30, 90) // janela às 00:30
    await c.volta(0, 5, 7)
    await c.volta(0, 10, 7)
    await c.volta(0, 30, 7)
    expect(c.banco.reservas).toHaveLength(1)
    expect(c.wpp.enviados).toHaveLength(1)
    c.trimble.series['-12.5_-50'] = serieComJanela(19 * 60, 20 * 60)
    await c.volta(12, 0, 7) // recalcula; o lembrete do dia 7 sai
    await c.volta(18, 30, 7)
    expect(c.banco.reservas.map((r) => r[1])).toEqual([`${HOJE}:antes`, `${AMANHA}:lembrete-12`, `${AMANHA}:antes`])
  })

  it('o aviso de 30 min não sai para quem já passou da hora enquanto a fila andava', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // pausa de ~44,7 s
    const c = montar({ contatos: [ANA, BRUNO, CARLA, DIEGO] }, em(18, 59) + 20_000)
    c.gancho.somar = true
    await c.servico.volta()
    // 18:59:20, +4 s do cálculo, depois 3 pausas de ~44,7 s: 19:00:08 e 19:00:53 ainda valem; 19:01:38 já não (a janela de 19:00 começou há mais de um minuto)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002'), jidDe('5565999990003')])
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana', 'c-bruno', 'c-carla'])
  })

  it('se o WhatsApp cai no meio da volta, o resto fica sem reserva para sair quando voltar', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.gancho.aoDormir = async (ms) => {
      if (ms >= 20_000) c.wpp.conectado = false
    }
    await c.volta(7)
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana'])
    c.wpp.conectado = true
    c.gancho.aoDormir = undefined
    await c.volta(7, 1)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002')])
  })

  it('3. com uma volta em andamento, a segunda retorna sem tocar no banco nem no WhatsApp', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    let soltar: () => void = () => {}
    const segurada = new Promise<void>((resolve) => { soltar = resolve })
    c.gancho.aoDormir = (ms) => (ms >= 20_000 && ms < PRAZO_DO_WHATSAPP ? segurada : Promise.resolve())
    c.relogio.agora = em(7)
    const primeira = c.servico.volta()
    await vi.waitFor(() => expect(c.pausasEntrePessoas()).toHaveLength(1))
    const chamadasDoBanco = c.banco.chamadas.length
    const enviados = c.wpp.enviados.length
    const resolvidos = c.wpp.resolvidos.length
    await c.servico.volta()
    expect(c.banco.chamadas).toHaveLength(chamadasDoBanco)
    expect(c.wpp.enviados).toHaveLength(enviados)
    expect(c.wpp.resolvidos).toHaveLength(resolvidos)
    soltar()
    await primeira
    expect(c.wpp.enviados).toHaveLength(2)
  })
})

describe('servico: ritmo, estado e prazo', () => {
  it('7. depois de um reinício, o teto do dia lembra o que já foi reservado', async () => {
    const a = montar({ contatos: [ANA, BRUNO] })
    await a.volta(7)
    expect(a.banco.reservas).toHaveLength(2)
    const b = montar({ banco: a.banco }, em(7, 5))
    await b.volta(7, 5)
    expect(b.contador().total).toBe(2)

    // 80 reservas de hoje: o serviço novo não zera o teto
    const c = montar({ contatos: [ANA] })
    for (const i of vezes(TETO_DO_DIA)) c.banco.envios.set(`c-x|${HOJE}:k${i}`, 'enviado')
    await c.volta(7)
    expect(c.banco.reservas).toEqual([])
    expect(c.wpp.enviados).toEqual([])
    expect(c.banco.estados.some((e) => e.ultimoErro === 'teto diário de mensagens atingido')).toBe(true)
  })

  it('9. a linha do SAIR depende do que foi enviado: se o primeiro do dia falhou, a seguinte leva a linha', async () => {
    const c = montar()
    c.wpp.falhaEnvio.set(jidDe('5565999990001'), new Error('socket caiu'))
    await c.volta(7)
    expect(c.banco.fechamentos[0].situacao).toBe('falhou')
    c.wpp.falhaEnvio.clear()
    await c.volta(12)
    expect(c.wpp.enviados).toHaveLength(1)
    expect(c.wpp.enviados[0].texto).toContain('Lembrete:')
    expect(c.wpp.enviados[0].texto).toContain('Para parar de receber, responda SAIR.')
  })

  it('10. enviar pendurado: estoura em 60 s, fecha como falhou e segue para o próximo', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.gancho.estourarPrazo = true
    c.wpp.pendurados.add(jidDe('5565999990001'))
    await c.volta(7)
    expect(c.sonos).toContain(PRAZO_DO_WHATSAPP)
    expect(c.banco.fechamentos).toEqual([
      { contatoId: 'c-ana', chave: `${HOJE}:resumo-07`, situacao: 'falhou', erro: 'sem resposta do WhatsApp em 60 s' },
      { contatoId: 'c-bruno', chave: `${HOJE}:resumo-07`, situacao: 'enviado' },
    ])
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990002')])
  })

  it('10b. resolverJid pendurado: estoura em 60 s, fecha como falhou e não envia', async () => {
    const c = montar({ contatos: [contato({ jid: null, confirmadoPor: 'manual' })] })
    c.gancho.estourarPrazo = true
    c.wpp.resolverPendurado = true
    await c.volta(7)
    expect(c.wpp.enviados).toEqual([])
    expect(c.banco.fechamentos).toEqual([{ contatoId: 'c-ana', chave: `${HOJE}:resumo-07`, situacao: 'falhou', erro: 'sem resposta do WhatsApp em 60 s' }])
  })

  it('10c. sem o prazo vencer, a resposta do WhatsApp vale', async () => {
    const c = montar()
    await c.volta(7)
    expect(c.sonos).toContain(PRAZO_DO_WHATSAPP)
    expect(c.banco.fechamentos[0].situacao).toBe('enviado')
  })

  it('11. depois de um envio, o estado leva a conexão real, não "true" fixo', async () => {
    const c = montar()
    c.wpp.depoisDeEnviar = () => { c.wpp.conectado = false }
    await c.volta(7)
    const gravado = c.banco.estados.find((e) => e.ultimoEnvioEm !== undefined)
    expect(gravado).toEqual({ conectado: false, ultimoEnvioEm: new Date(em(7)).toISOString() })
  })

  it('11b. o aviso de teto é limpo na primeira volta do dia seguinte, uma vez só', async () => {
    const c = montar({ contatos: [ANA] })
    for (const _ of vezes(TETO_DO_DIA)) c.contador().contar(null)
    await c.volta(7)
    expect(c.banco.estados.filter((e) => e.ultimoErro === 'teto diário de mensagens atingido')).toHaveLength(1)
    expect(c.banco.estados.filter((e) => e.ultimoErro === null)).toHaveLength(0)
    await c.volta(23, 59)
    expect(c.banco.estados.filter((e) => e.ultimoErro === null)).toHaveLength(0)
    await c.volta(0, 10, 7)
    await c.volta(0, 11, 7)
    expect(c.banco.estados.filter((e) => e.ultimoErro === null)).toEqual([{ conectado: true, ultimoErro: null }])
  })

  it('12. números inteiros não vão ao registro nem ao banco: ficam só os 4 últimos dígitos', async () => {
    const c = montar()
    c.wpp.falhaEnvio.set(jidDe('5565999990001'), new Error('falha com 5565999990001 no texto'))
    await c.volta(7)
    expect(c.banco.fechamentos[0].erro).toBe('falha com …0001 no texto')
    expect(c.registro.some((l) => l.includes('falha com …0001 no texto'))).toBe(true)
    semNumerosNoRegistro(c.registro)

    await c.servico.conexao(false, 'erro de 556599990002')
    expect(c.banco.estados.at(-1)).toMatchObject({ conectado: false, ultimoErro: 'erro de …0002' })
    semNumerosNoRegistro(c.registro)
  })
})

describe('servico: ATIVAR e SAIR', () => {
  it('15. ATIVAR de número cadastrado (com ou sem nono dígito) confirma e responde com as fazendas', async () => {
    const novo = contato({ confirmadoEm: null, confirmadoPor: null, ativo: false, jid: null, fazendas: [2, 3] })
    for (const jid of [jidDe('5565999990001'), '556599990001@s.whatsapp.net']) {
      const c = montar({ contatos: [novo] })
      await c.servico.recebida({ jid, texto: 'Ativar' })
      expect(c.banco.confirmacoes).toEqual([['c-ana', jid]])
      expect(c.wpp.enviados).toEqual([{ jid, texto: textoAtivado(novo, ['Nebraska', 'Três Flechas']) }])
      semNumerosNoRegistro(c.registro)
    }
  })

  it('16. SAIR pausa o contato e responde', async () => {
    const c = montar()
    const jid = jidDe('5565999990001')
    await c.servico.recebida({ jid, texto: ' sair ' })
    expect(c.banco.pausas).toEqual(['c-ana'])
    expect(c.wpp.enviados).toEqual([{ jid, texto: textoSaiu(ANA) }])
  })

  it('17. número não cadastrado ou texto que não é comando: nada é gravado nem enviado, e o texto não vai ao registro', async () => {
    const c = montar()
    await c.servico.recebida({ jid: jidDe('5565999990009'), texto: 'ATIVAR' })
    await c.servico.recebida({ jid: jidDe('5565999990009'), texto: 'sair' })
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'SEGREDO-XYZ preciso falar com alguém' })
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'ativar por favor' })
    expect(c.banco.escritas).toBe(0)
    expect(c.wpp.enviados).toEqual([])
    const tudo = c.registro.join('\n')
    expect(tudo).not.toContain('SEGREDO-XYZ')
    expect(tudo).not.toMatch(/ativar|sair/i)
    semNumerosNoRegistro(c.registro)
  })

  it('com o teto do dia estourado o SAIR vale do mesmo jeito, só a resposta não sai', async () => {
    const c = montar()
    for (const _ of vezes(TETO_DO_DIA)) c.contador().contar(null)
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'SAIR' })
    expect(c.banco.pausas).toEqual(['c-ana'])
    expect(c.wpp.enviados).toEqual([])
  })

  it('a resposta conta para o teto do dia', async () => {
    const c = montar()
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'SAIR' })
    expect(c.contador().total).toBe(1)
  })

  it('13. no máximo 2 respostas por pessoa por dia: o terceiro ATIVAR confirma mas não responde; no dia seguinte volta a responder', async () => {
    const c = montar({}, em(9))
    for (const _ of vezes(3)) await c.recebida(ANA, 'ATIVAR')
    expect(c.banco.confirmacoes).toHaveLength(3)
    expect(c.wpp.enviados).toHaveLength(2)
    c.relogio.agora = em(9, 0, 7)
    await c.recebida(ANA, 'ATIVAR')
    expect(c.wpp.enviados).toHaveLength(3)
  })

  it('2. se pausar lança, a volta seguinte não envia a ela e tenta pausar de novo, uma vez por volta', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.pausarLanca = true
    await c.recebida(BRUNO, 'SAIR')
    expect(c.banco.tentativasDePausa).toEqual(['c-bruno'])
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toEqual([])
    expect(c.banco.tentativasDePausa).toHaveLength(2)
    await c.volta(7, 1)
    expect(c.banco.tentativasDePausa).toHaveLength(3)
    // o banco volta: a pausa é gravada
    c.banco.pausarLanca = false
    await c.volta(7, 2)
    expect(c.banco.pausas).toEqual(['c-bruno'])
    // a leitura seguinte já traz ativo = false: a marca sai e não há mais tentativas
    await c.volta(7, 3)
    expect(c.banco.tentativasDePausa).toHaveLength(4)
    // alguém reativa pela tela: como a marca saiu, volta a receber
    c.banco.contatosLista[1].ativo = true
    await c.volta(7, 4)
    expect(alertasPara(c, '5565999990002')).toHaveLength(1)
    expect(alertasPara(c, '5565999990001')).toHaveLength(1)
  })

  it('2b. se contatos() lança dentro de recebida, a pessoa continua marcada e a volta seguinte não envia a ela', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.erroDeContatos = new Error('rede caiu')
    await c.recebida(BRUNO, 'SAIR')
    expect(c.registro.some((l) => l.includes('rede caiu'))).toBe(true)
    expect(c.banco.pausas).toEqual([])
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toEqual([])
    expect(alertasPara(c, '5565999990001')).toHaveLength(1)
    // a volta completa a pausa que a mensagem não conseguiu gravar
    expect(c.banco.pausas).toEqual(['c-bruno'])
  })

  it('2c. SAIR seguido de ATIVAR da mesma pessoa: volta a receber', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    await c.recebida(BRUNO, 'SAIR')
    await c.recebida(BRUNO, 'ATIVAR')
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toHaveLength(1)
  })

  it('SAIR e ATIVAR da mesma pessoa no mesmo lote: uma é tratada por vez e vale a última (ATIVAR)', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.antesDePausar = umInstante // sem a fila, o ATIVAR gravaria antes e o SAIR ficaria por último
    await Promise.all([c.recebida(BRUNO, 'SAIR'), c.recebida(BRUNO, 'ATIVAR')])
    expect(c.ordem.filter((o) => o === 'pausar' || o === 'confirmar')).toEqual(['pausar', 'confirmar'])
    expect(c.banco.contatosLista[1].ativo).toBe(true)
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toHaveLength(1)
  })

  it('ATIVAR e SAIR da mesma pessoa no mesmo lote: vale a última (SAIR) e ela não recebe', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.antesDeConfirmar = umInstante
    await Promise.all([c.recebida(BRUNO, 'ATIVAR'), c.recebida(BRUNO, 'SAIR')])
    expect(c.ordem.filter((o) => o === 'pausar' || o === 'confirmar')).toEqual(['confirmar', 'pausar'])
    expect(c.banco.contatosLista[1].ativo).toBe(false)
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toEqual([])
    expect(alertasPara(c, '5565999990001')).toHaveLength(1)
  })

  it('duas respostas não saem coladas: entre uma e a próxima há uma espera de 3 a 8 s', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    await Promise.all([c.recebida(ANA, 'SAIR'), c.recebida(BRUNO, 'SAIR')])
    expect(c.ordem).toEqual(['pausar', 'enviar', 'pausar', 'entre respostas', 'enviar'])
    const esperas = c.sonos.filter((ms) => ms !== PRAZO_DO_WHATSAPP)
    expect(esperas).toHaveLength(1)
    expect(esperas[0]).toBeGreaterThanOrEqual(3_000)
    expect(esperas[0]).toBeLessThan(8_000)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002')])
  })

  it('resposta bem depois da anterior não espera nada', async () => {
    const c = montar({ contatos: [ANA, BRUNO] }, em(9))
    await c.recebida(ANA, 'SAIR')
    c.relogio.agora = em(9, 1)
    await c.recebida(BRUNO, 'SAIR')
    expect(c.sonos.filter((ms) => ms !== PRAZO_DO_WHATSAPP)).toEqual([])
    expect(c.wpp.enviados).toHaveLength(2)
  })

  it('a marca do SAIR é posta na chegada, mesmo com a fila parada em outra mensagem', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    const t = trava()
    c.banco.antesDeConfirmar = () => t.espera
    const daAna = c.recebida(ANA, 'ATIVAR')
    const doBruno = c.recebida(BRUNO, 'SAIR')
    await umInstante()
    expect(c.banco.tentativasDePausa).toEqual([]) // o SAIR do Bruno ainda está na fila
    c.banco.antesDeConfirmar = undefined
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toEqual([])
    t.soltar()
    await Promise.all([daAna, doBruno])
    expect(c.banco.contatosLista[1].ativo).toBe(false)
  })

  it('uma mensagem que falha não trava a fila', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.banco.erroDeContatos = new Error('rede caiu')
    await Promise.all([c.recebida(ANA, 'SAIR'), c.recebida(BRUNO, 'SAIR')])
    expect(c.banco.pausas).toEqual(['c-bruno'])
    expect(c.registro.some((l) => l.includes('rede caiu'))).toBe(true)
  })

  it('quem manda SAIR no meio da volta não recebe o alerta que estava na fila', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.gancho.aoDormir = async (ms) => {
      if (ms >= 20_000) await c.recebida(BRUNO, 'SAIR')
    }
    await c.volta(7)
    const paraBruno = c.wpp.enviados.filter((e) => e.jid === jidDe('5565999990002'))
    expect(paraBruno).toHaveLength(1)
    expect(paraBruno[0].texto).toBe(textoSaiu(BRUNO))
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana'])
  })

  it('14. SAIR e depois ATIVAR no meio da mesma volta: a pessoa ainda recebe o alerta da fila', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.gancho.aoDormir = async (ms) => {
      if (ms < 20_000) return
      await c.recebida(BRUNO, 'SAIR')
      await c.recebida(BRUNO, 'ATIVAR')
    }
    await c.volta(7)
    expect(alertasPara(c, '5565999990002')).toHaveLength(1)
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana', 'c-bruno'])
  })
})

describe('servico: restrição da conta e recusas de entrega', () => {
  it('enquanto houver restrição nenhum alerta e nenhuma resposta saem, e o aviso vai para o estado; vencido o prazo, volta', async () => {
    const c = montar({ contatos: [ANA, BRUNO] }, em(6))
    await c.servico.restricao(em(15), 'BIZ_QUALITY')
    expect(c.banco.estados).toEqual([{ conectado: true, ultimoErro: 'WhatsApp restringiu os envios até 06/10 15:00' }])
    await c.volta(7)
    await c.volta(12)
    await c.recebida(BRUNO, 'SAIR')
    expect(c.wpp.enviados).toEqual([])
    expect(c.banco.reservas).toEqual([])
    // o SAIR vale do mesmo jeito; só a resposta não sai
    expect(c.banco.pausas).toEqual(['c-bruno'])
    await c.volta(18, 30)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001')])
    expect(c.avisos()).toEqual(['WhatsApp restringiu os envios até 06/10 15:00', null])
    semNumerosNoRegistro(c.registro)
  })

  it('restrição retirada pelo WhatsApp libera na hora; sem prazo informado vale até segunda ordem', async () => {
    const c = montar({}, em(6))
    await c.servico.restricao(Infinity, '')
    expect(c.avisos()).toEqual(['WhatsApp restringiu os envios até novo aviso'])
    await c.volta(7)
    await c.volta(7, 30, 9) // três dias depois continua valendo
    expect(c.wpp.enviados).toEqual([])
    await c.servico.restricao(null, 'restrição retirada')
    expect(c.avisos()).toEqual(['WhatsApp restringiu os envios até novo aviso', null])
    await c.volta(7, 31, 9)
    expect(c.wpp.enviados).toHaveLength(1)
    // retirar o que não existe não grava nada
    await c.servico.restricao(null, 'restrição retirada')
    expect(c.avisos()).toHaveLength(2)
  })

  it('restrição que chega durante a reserva: o envio fica como pulado e nada sai', async () => {
    const c = montar()
    let avisada: Promise<void> | undefined
    c.banco.aoReservar = () => { avisada = c.servico.restricao(em(15), 'BIZ_QUALITY') }
    await c.volta(7)
    await avisada
    expect(c.wpp.enviados).toEqual([])
    expect(c.banco.fechamentos).toEqual([{ contatoId: 'c-ana', chave: `${HOJE}:resumo-07`, situacao: 'pulado', erro: 'WhatsApp restringiu os envios' }])
  })

  it('3 recusas seguidas: para de enviar pelo resto do dia (alertas e respostas), grava o aviso e volta no dia seguinte', async () => {
    const c = montar({ contatos: [ANA, BRUNO, CARLA, DIEGO] })
    // o WhatsApp recusa cada mensagem logo depois de aceitar o envio
    c.wpp.depoisDeEnviar = (jid) => { void c.servico.falhaDeEntrega(jid) }
    await c.volta(7)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002'), jidDe('5565999990003')])
    expect(c.avisos()).toEqual(['WhatsApp recusou 3 mensagens seguidas: envios parados até amanhã'])
    await c.volta(7, 1)
    await c.volta(12)
    await c.recebida(DIEGO, 'SAIR')
    expect(c.wpp.enviados).toHaveLength(3)
    expect(c.banco.pausas).toEqual(['c-diego'])
    // no dia seguinte o aviso sai e os envios voltam
    c.wpp.depoisDeEnviar = undefined
    await c.volta(0, 10, 7)
    expect(c.avisos()).toEqual(['WhatsApp recusou 3 mensagens seguidas: envios parados até amanhã', null])
    await c.volta(7, 0, 7)
    expect(c.wpp.enviados.length).toBeGreaterThan(3)
    semNumerosNoRegistro(c.registro)
  })

  it('recusas que não são seguidas (uma mensagem aceita no meio) não param os envios', async () => {
    const c = montar({ contatos: [ANA, BRUNO, CARLA, DIEGO] })
    c.wpp.depoisDeEnviar = (jid) => { if (jid !== jidDe('5565999990003')) void c.servico.falhaDeEntrega(jid) }
    await c.volta(7)
    // Ana e Bruno recusadas, Carla aceita, Diego recusada: nunca três seguidas
    expect(c.wpp.enviados).toHaveLength(4)
    expect(c.avisos()).toEqual([])
    await c.volta(12)
    // 12:00: Ana recusada (2 seguidas com a do Diego), Bruno recusada (3): para antes da Carla
    expect(c.wpp.enviados).toHaveLength(6)
    expect(c.avisos()).toEqual(['WhatsApp recusou 3 mensagens seguidas: envios parados até amanhã'])
  })
})

describe('servico: avisos em ultimo_erro', () => {
  const TRIMBLE = 'Sem dados da Trimble desde 07:00: alertas parados até ela voltar'
  const RESTRICAO = 'WhatsApp restringiu os envios até 06/10 15:00'
  const semTrimble = async (c: ReturnType<typeof montar>) => {
    c.trimble.sempreFalha = true
    for (let m = 0; m <= 60; m += 5) await c.volta(7 + Math.floor(m / 60), m % 60)
  }

  it('dois avisos ativos ficam juntos, separados por " · "; quando um sai, o outro fica', async () => {
    const c = montar()
    await semTrimble(c)
    await c.servico.restricao(em(15), 'BIZ_QUALITY')
    await c.servico.restricao(null, 'restrição retirada')
    c.trimble.sempreFalha = false
    await c.volta(9, 0)
    expect(c.avisos()).toEqual([TRIMBLE, `${RESTRICAO} · ${TRIMBLE}`, TRIMBLE, null])
  })

  it('o teto do dia entra na mesma junção e sai no dia seguinte sem levar os outros', async () => {
    const c = montar({ contatos: [ANA] }, em(0, 5))
    await c.volta(0, 5) // as janelas das 00:05 valem o dia inteiro
    await semTrimble(c)
    for (const _ of vezes(TETO_DO_DIA)) c.contador().contar(null)
    await c.volta(12) // o lembrete esbarra no teto
    expect(c.avisos()).toEqual([TRIMBLE, `teto diário de mensagens atingido · ${TRIMBLE}`])
    await c.volta(0, 10, 7)
    expect(c.avisos().at(-1)).toBe(TRIMBLE)
    expect(c.avisos()).toHaveLength(3)
  })

  it('desconectado, o aviso espera a conexão voltar e não apaga o motivo da queda', async () => {
    const c = montar({}, em(9))
    c.wpp.conectado = false
    await c.servico.conexao(false, 'conexão perdida (428)')
    await c.servico.restricao(em(15), 'BIZ_QUALITY')
    await c.volta(9, 1)
    expect(c.avisos()).toEqual(['conexão perdida (428)'])
    c.wpp.conectado = true
    c.relogio.agora = em(9, 2)
    await c.servico.conexao(true)
    expect(c.banco.estados.at(-1)).toEqual({ conectado: true, desde: new Date(em(9, 2)).toISOString(), ultimoErro: RESTRICAO })
  })

  it('se a gravação do aviso falha, a volta seguinte grava', async () => {
    const c = montar({}, em(9))
    c.banco.estadoLanca = 1
    await c.servico.restricao(em(15), 'BIZ_QUALITY')
    expect(c.avisos()).toEqual([])
    await c.volta(9, 1)
    expect(c.avisos()).toEqual([RESTRICAO])
    await c.volta(9, 2)
    expect(c.avisos()).toEqual([RESTRICAO])
  })
})

describe('servico: ensaio', () => {
  it('diz, uma vez, por que cada contato não receberia e que fazendas estão sem vínculo; números mascarados, nada gravado', async () => {
    const inativo = contato({ ativo: false })
    const semAlerta = contato({ id: 'c-b', nome: 'Bruno', telefone: '5565999990002', alertaJanela: false })
    const aguardando = contato({ id: 'c-c', nome: 'Carla', telefone: '5565999990003', confirmadoEm: null, confirmadoPor: null, jid: null })
    const semJanela = contato({ id: 'c-d', nome: 'Diego', telefone: '5565999990004', fazendas: [4] })
    const semFazenda = contato({ id: 'c-e', nome: 'Edu', telefone: '5565999990005', fazendas: [5] })
    const doisMotivos = contato({ id: 'c-f', nome: 'Fabi', telefone: '5565999990006', ativo: false, confirmadoEm: null, confirmadoPor: null })
    const apto = contato({ id: 'c-g', nome: 'Gil', telefone: '5565999990007' })
    const c = montar({ ensaio: true, contatos: [inativo, semAlerta, aguardando, semJanela, semFazenda, doisMotivos, apto] })
    c.banco.fazendasLista = [
      ...FAZENDAS,
      { id: 'f6', coaId: null, nome: 'Sem Vínculo', celulaId: 'c1', lat: -12.5, lon: -50.5 },
      { id: 'f7', coaId: null, nome: 'Aurora', celulaId: 'c2', lat: -12.5, lon: -50 },
      { id: 'f8', coaId: null, nome: 'Sem Vínculo Nem Talhão', celulaId: null, lat: null, lon: null },
    ]
    await c.volta(0, 5)
    await c.volta(7)
    const explicacoes = c.registro.filter((l) => l.includes('não receberia') || l.includes('sem vínculo'))
    expect(explicacoes).toEqual([
      'ensaio: …0001 não receberia: inativo',
      'ensaio: …0002 não receberia: sem Janela de risco',
      'ensaio: …0003 não receberia: aguardando ATIVAR',
      'ensaio: …0004 não receberia: sem janela nas fazendas dele hoje',
      'ensaio: …0005 não receberia: sem janela nas fazendas dele hoje',
      'ensaio: …0006 não receberia: inativo, aguardando ATIVAR',
      'ensaio: Fazendas sem vínculo com o COA WEB (não entram em contato nenhum que não seja "todas"): Aurora, Sem Vínculo',
    ])
    expect(c.registro.filter((l) => l.includes('enviaria resumo-07'))).toHaveLength(1)
    semNumerosNoRegistro(c.registro)
    expect(c.banco.escritas).toBe(0)
  })

  it('sem fazenda desvinculada e com todos aptos, não acrescenta linha nenhuma', async () => {
    const c = montar({ ensaio: true, contatos: [ANA, BRUNO] })
    await c.volta(7)
    expect(c.registro.filter((l) => l.includes('não receberia') || l.includes('sem vínculo'))).toEqual([])
  })
})

describe('servico: estado, batimento e limpeza', () => {
  it('18. conexao grava o estado com a hora e o motivo', async () => {
    const c = montar({}, em(9))
    await c.servico.conexao(true)
    await c.servico.conexao(false, 'conexão perdida (428)')
    const desde = new Date(em(9)).toISOString()
    expect(c.banco.estados).toEqual([
      { conectado: true, desde, ultimoErro: null },
      { conectado: false, desde, ultimoErro: 'conexão perdida (428)' },
    ])
  })

  it('19. batimento: na primeira volta e depois só a cada 5 min', async () => {
    const c = montar({}, em(10))
    await c.volta(10)
    expect(c.banco.estados).toHaveLength(1)
    await c.volta(10, 1)
    await c.volta(10, 4)
    expect(c.banco.estados).toHaveLength(1)
    await c.volta(10, 5)
    expect(c.banco.estados).toHaveLength(2)
    await c.volta(10, 9)
    expect(c.banco.estados).toHaveLength(2)
    await c.volta(10, 10)
    expect(c.banco.estados).toHaveLength(3)
    expect(c.banco.estados[0]).toEqual({ conectado: true })
  })

  it('20. ensaio: registra o que enviaria com o número mascarado e não escreve nem envia nada', async () => {
    const c = montar({ ensaio: true, contatos: [ANA, BRUNO] })
    c.wpp.conectado = false
    await c.volta(7)
    await c.volta(7, 1)
    const linhas = c.registro.filter((l) => l.includes('Janelas de risco de cintilação hoje entre 19:00 e 20:00 em Nebraska.'))
    expect(linhas).toHaveLength(2) // uma por contato, sem repetir na volta seguinte
    expect(linhas[0]).toContain(mascarar('5565999990001'))
    expect(linhas[1]).toContain(mascarar('5565999990002'))
    expect(linhas[0]).not.toContain('\n')
    semNumerosNoRegistro(c.registro)
    expect(c.banco.escritas).toBe(0)
    expect(c.wpp.enviados).toEqual([])
    expect(c.wpp.resolvidos).toEqual([])
    await c.servico.conexao(true)
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'SAIR' })
    expect(c.banco.escritas).toBe(0)
  })

  it('21. uma vez por dia, na primeira volta depois das 00:05, apaga os envios antigos', async () => {
    const c = montar({}, em(0, 4))
    await c.volta(0, 4)
    expect(c.banco.limpezas).toBe(0)
    await c.volta(0, 5)
    expect(c.banco.limpezas).toBe(1)
    await c.volta(0, 6)
    await c.volta(15)
    expect(c.banco.limpezas).toBe(1)
    await c.volta(0, 4, 7)
    expect(c.banco.limpezas).toBe(1)
    await c.volta(0, 5, 7)
    expect(c.banco.limpezas).toBe(2)

    const d = montar() // serviço que sobe no meio do dia limpa na primeira volta
    await d.volta(3)
    expect(d.banco.limpezas).toBe(1)
  })

  it('22. exceção em contatos() não derruba a volta; a próxima tenta de novo', async () => {
    const c = montar()
    c.banco.erroDeContatos = new Error('rede caiu')
    await expect(c.volta(7)).resolves.toBeUndefined()
    expect(c.registro).toContain('falha na volta: rede caiu')
    expect(c.wpp.enviados).toEqual([])
    await c.volta(7, 1)
    expect(c.wpp.enviados).toHaveLength(1)
  })
})
