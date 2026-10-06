// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PontoIono } from '../tipos'
import type { Banco } from './banco'
import { mascarar } from './comandos'
import { textoAtivado, textoSaiu } from './mensagens'
import { ContadorDoDia, TETO_DO_DIA } from './ritmo'
import { Servico } from './servico'
import type { ContatoWpp, FazendaServidor, TipoEvento } from './tipos'

afterEach(() => vi.restoreAllMocks())

const em = (h: number, m = 0, dia = 6) => new Date(2026, 9, dia, h, m).getTime()
const HOJE = '2026-10-06'

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
  const pontos: PontoIono[] = []
  for (let d = 1; d <= dias; d++) {
    const base = new Date(2026, 9, 6 - d).getTime()
    for (let min = inicioMin; min < fimMin; min += 10) {
      pontos.push({ instante: base + min * 60_000, indice: 8, tec: 50, cintilacao: 80, previsto: false })
    }
  }
  return pontos
}

class BancoFalso implements Banco {
  envios = new Map<string, string>()
  reservas: [string, string, TipoEvento][] = []
  fechamentos: { contatoId: string; chave: string; situacao: string; erro?: string }[] = []
  estados: Parameters<Banco['gravarEstado']>[0][] = []
  confirmacoes: [string, string][] = []
  jidsGuardados: [string, string][] = []
  pausas: string[] = []
  limpezas = 0
  erroDeContatos: Error | null = null
  reservaLanca = new Set<string>()
  chavesEscondidas = false
  constructor(private ordem: string[], public contatosLista: ContatoWpp[], public fazendasLista: FazendaServidor[]) {}

  get escritas() {
    return this.reservas.length + this.fechamentos.length + this.estados.length + this.confirmacoes.length
      + this.jidsGuardados.length + this.pausas.length + this.limpezas
  }
  async contatos() {
    if (this.erroDeContatos) { const e = this.erroDeContatos; this.erroDeContatos = null; throw e }
    return this.contatosLista.map((c) => ({ ...c }))
  }
  async fazendas() { return this.fazendasLista }
  async reservarEnvio(contatoId: string, chave: string, tipo: TipoEvento) {
    if (this.reservaLanca.has(contatoId)) throw new Error('Supabase fora do ar')
    const k = `${contatoId}|${chave}`
    if (this.envios.has(k)) return false
    this.envios.set(k, 'enviando')
    this.reservas.push([contatoId, chave, tipo])
    this.ordem.push('reservar')
    return true
  }
  async fecharEnvio(contatoId: string, chave: string, situacao: 'enviado' | 'falhou' | 'pulado', erro?: string) {
    this.envios.set(`${contatoId}|${chave}`, situacao)
    this.fechamentos.push({ contatoId, chave, situacao, erro })
    this.ordem.push('fechar')
  }
  async chavesDoDia(dia: string) {
    if (this.chavesEscondidas) return []
    return [...this.envios.keys()].map((k) => { const [contatoId, chave] = k.split('|'); return { contatoId, chave } })
      .filter((r) => r.chave.startsWith(`${dia}:`))
  }
  async confirmar(contatoId: string, jid: string) { this.confirmacoes.push([contatoId, jid]) }
  async guardarJid(contatoId: string, jid: string) { this.jidsGuardados.push([contatoId, jid]) }
  async pausar(contatoId: string) {
    this.pausas.push(contatoId)
    const c = this.contatosLista.find((x) => x.id === contatoId)
    if (c) c.ativo = false
  }
  async gravarEstado(estado: Parameters<Banco['gravarEstado']>[0]) { this.estados.push(estado) }
  async limparEnviosAntigos() { this.limpezas += 1 }
}

class WhatsappFalso {
  conectado = true
  precisaParear = false
  enviados: { jid: string; texto: string }[] = []
  resolvidos: string[] = []
  jids: Record<string, string | null> = {}
  falhaEnvio = new Map<string, Error>()
  constructor(private ordem: string[]) {}
  async enviar(jid: string, texto: string) {
    this.ordem.push('enviar')
    const erro = this.falhaEnvio.get(jid)
    if (erro) throw erro
    this.enviados.push({ jid, texto })
  }
  async resolverJid(telefone: string) {
    this.resolvidos.push(telefone)
    return telefone in this.jids ? this.jids[telefone] : null
  }
}

class TrimbleFalsa {
  chamadas: { lat: number; lon: number; agora: number }[] = []
  falhasPendentes = 0
  series: Record<string, PontoIono[]> = {
    '-12.5_-50.5': serieComJanela(19 * 60, 20 * 60),
    '-12.5_-50': serieComJanela(19 * 60, 20 * 60),
    '-13_-51': [],
  }
  async historico(celula: { lat: number; lon: number }, agora: number) {
    this.chamadas.push({ ...celula, agora })
    if (this.falhasPendentes > 0) { this.falhasPendentes -= 1; throw new Error('Sem resposta da Trimble.') }
    return this.series[`${celula.lat}_${celula.lon}`] ?? []
  }
}

interface Opcoes { contatos?: ContatoWpp[]; ensaio?: boolean }

function montar(opcoes: Opcoes = {}, inicio = em(7)) {
  const ordem: string[] = []
  const relogio = { agora: inicio }
  const banco = new BancoFalso(ordem, (opcoes.contatos ?? [ANA]).map((c) => ({ ...c })), FAZENDAS) // cópia: pausar() altera o contato
  const wpp = new WhatsappFalso(ordem)
  const trimble = new TrimbleFalsa()
  const sonos: number[] = []
  const registro: string[] = []
  const gancho: { somar: boolean; aoDormir?: (ms: number) => Promise<void> } = { somar: false }
  const servico = new Servico({
    banco,
    trimble,
    whatsapp: wpp,
    agora: () => relogio.agora,
    dormir: async (ms) => {
      sonos.push(ms)
      if (ms >= 20_000) ordem.push('pausa')
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
  const pausasEntrePessoas = () => sonos.filter((ms) => ms >= 20_000)
  const contador = () => (servico as unknown as { contador: ContadorDoDia }).contador
  return { servico, banco, wpp, trimble, relogio, registro, sonos, ordem, gancho, volta, pausasEntrePessoas, contador }
}

const semNumerosNoRegistro = (registro: string[]) => expect(registro.join('\n')).not.toMatch(/55\d{8,}/)

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

  it('4. às 18:30, com janela às 19:00, sai o "começa em breve" uma vez só', async () => {
    const c = montar()
    await c.volta(18, 30)
    await c.volta(18, 31)
    await c.volta(18, 45)
    expect(c.wpp.enviados).toHaveLength(1)
    expect(c.banco.reservas).toEqual([['c-ana', `${HOJE}:antes`, 'antes']])
    expect(c.wpp.enviados[0].texto).toContain('Janela de risco de cintilação começa em breve: 19:00–20:00')
    expect(c.wpp.enviados[0].texto).toContain('Boa noite, Ana.')
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
    for (const ms of pausas) { expect(ms).toBeGreaterThanOrEqual(20_000); expect(ms).toBeLessThan(45_000) }
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
    for (let i = 0; i < 3; i++) c.contador().contar('c-ana')
    await c.volta(7)
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-bruno'])
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990002')])
    // não houve pausa à toa por quem foi barrado
    expect(c.pausasEntrePessoas()).toEqual([])
  })

  it('14. teto do dia: para de enviar e grava o aviso uma vez só', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    for (let i = 0; i < TETO_DO_DIA; i++) c.contador().contar(null)
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
    c.gancho.aoDormir = async (ms) => { if (ms >= 20_000) for (let i = 0; i < TETO_DO_DIA; i++) c.contador().contar(null) }
    await c.volta(7)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001')])
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana'])
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

  it('o aviso de 30 min não sai para quem já passou da hora enquanto a fila andava', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // pausa de ~44,7 s
    const c = montar({ contatos: [ANA, BRUNO, CARLA, DIEGO] }, em(18, 59) + 20_000)
    c.gancho.somar = true
    await c.servico.volta()
    // 18:59:20, +4 s do cálculo, depois 3 pausas de ~44,7 s: 19:00:08 e 19:00:53 ainda valem; 19:01:38 já não (a janela de 19:00 começou há mais de um minuto)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002'), jidDe('5565999990003')])
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana', 'c-bruno', 'c-carla'])
  })

  it('quem manda SAIR no meio da volta não recebe o alerta que estava na fila', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.gancho.aoDormir = async (ms) => {
      if (ms >= 20_000) await c.servico.recebida({ jid: jidDe('5565999990002'), texto: 'SAIR' })
    }
    await c.volta(7)
    const paraBruno = c.wpp.enviados.filter((e) => e.jid === jidDe('5565999990002'))
    expect(paraBruno).toHaveLength(1)
    expect(paraBruno[0].texto).toBe(textoSaiu(BRUNO))
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana'])
  })

  it('se o WhatsApp cai no meio da volta, o resto fica sem reserva para sair quando voltar', async () => {
    const c = montar({ contatos: [ANA, BRUNO] })
    c.gancho.aoDormir = async (ms) => { if (ms >= 20_000) c.wpp.conectado = false }
    await c.volta(7)
    expect(c.banco.reservas.map((r) => r[0])).toEqual(['c-ana'])
    c.wpp.conectado = true
    c.gancho.aoDormir = undefined
    await c.volta(7, 1)
    expect(c.wpp.enviados.map((e) => e.jid)).toEqual([jidDe('5565999990001'), jidDe('5565999990002')])
  })

  it('duas voltas ao mesmo tempo não se atropelam', async () => {
    const c = montar()
    c.relogio.agora = em(7)
    await Promise.all([c.servico.volta(), c.servico.volta()])
    expect(c.wpp.enviados).toHaveLength(1)
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
    for (let i = 0; i < TETO_DO_DIA; i++) c.contador().contar(null)
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'SAIR' })
    expect(c.banco.pausas).toEqual(['c-ana'])
    expect(c.wpp.enviados).toEqual([])
  })

  it('a resposta conta para o teto do dia', async () => {
    const c = montar()
    await c.servico.recebida({ jid: jidDe('5565999990001'), texto: 'SAIR' })
    expect(c.contador().total).toBe(1)
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
