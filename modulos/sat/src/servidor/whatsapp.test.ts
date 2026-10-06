// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { conectarWhatsapp, lerRecebida, type OpcoesWhatsapp, type SocketMinimo } from './whatsapp'

const JID_A = '5565999990001@s.whatsapp.net'

describe('lerRecebida', () => {
  it('lê o texto de conversa individual (conversation e extendedTextMessage)', () => {
    expect(lerRecebida({ key: { remoteJid: JID_A, fromMe: false }, message: { conversation: 'ATIVAR' } })).toEqual({ jid: JID_A, texto: 'ATIVAR' })
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: { extendedTextMessage: { text: 'sair' } } })).toEqual({ jid: JID_A, texto: 'sair' })
  })

  it('descarta mensagem minha, grupo, status e mensagem sem texto', () => {
    expect(lerRecebida({ key: { remoteJid: JID_A, fromMe: true }, message: { conversation: 'ATIVAR' } })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: '120363000000000001@g.us' }, message: { conversation: 'ATIVAR' } })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: 'status@broadcast' }, message: { conversation: 'ATIVAR' } })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: {} })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: null })).toBeNull()
  })

  it('endereço @lid usa o alternativo; sem alternativa é descartado', () => {
    expect(lerRecebida({ key: { remoteJid: '123456789012345@lid', remoteJidAlt: JID_A }, message: { conversation: 'ATIVAR' } })).toEqual({ jid: JID_A, texto: 'ATIVAR' })
    expect(lerRecebida({ key: { remoteJid: '123456789012345@lid' }, message: { conversation: 'ATIVAR' } })).toBeNull()
  })
})

type Config = Record<string, unknown>

class SocketFalso extends EventEmitter {
  ev = { on: (evento: string, fn: (d: never) => void) => { this.on(evento, fn as (...args: unknown[]) => void) } }
  authState = { creds: { registered: false } }
  sendMessage = vi.fn(async (_jid: string, _conteudo: { text: string }) => {})
  sendPresenceUpdate = vi.fn(async (_tipo: string, _jid: string) => {})
  onWhatsApp = vi.fn(async (..._numeros: string[]): Promise<{ jid: string; exists: boolean }[] | undefined> => [])
  requestPairingCode = vi.fn(async (_numero: string) => 'ABCD1234')
  end = vi.fn()
}

function montar(extra: Partial<OpcoesWhatsapp> = {}) {
  const sockets: SocketFalso[] = []
  const configs: Config[] = []
  const esperas: number[] = []
  const saveCreds = vi.fn(async () => {})
  const aoReceber = vi.fn()
  const aoMudarConexao = vi.fn()
  const opcoes: OpcoesWhatsapp = {
    pastaSessao: 'sessao-falsa',
    aoReceber,
    aoMudarConexao,
    dependencias: {
      criarSocket: (config) => {
        const s = new SocketFalso()
        sockets.push(s)
        configs.push(config)
        return s as unknown as SocketMinimo
      },
      estadoDaSessao: async () => ({ state: { falso: true }, saveCreds }),
      dormir: async (ms) => { esperas.push(ms) },
    },
    ...extra,
  }
  return { opcoes, sockets, configs, esperas, saveCreds, aoReceber, aoMudarConexao }
}

const proximoCiclo = () => new Promise<void>((r) => setImmediate(r))
const queda = (codigo: number) => ({ connection: 'close', lastDisconnect: { error: { output: { statusCode: codigo } } } })

describe('conectarWhatsapp', () => {
  it('config do socket: sem presença online, sem histórico, sem QR no terminal', async () => {
    const { opcoes, configs } = montar()
    await conectarWhatsapp(opcoes)
    const c = configs[0]
    expect(c.markOnlineOnConnect).toBe(false)
    expect(c.syncFullHistory).toBe(false)
    expect((c.shouldSyncHistoryMessage as () => boolean)()).toBe(false)
    expect(c.printQRInTerminal ?? false).toBe(false)
    expect(c.auth).toEqual({ falso: true })
    expect((c.logger as { level: string }).level).toBe('silent')
    expect((c.logger as { child: () => unknown }).child()).toBe(c.logger)
  })

  it('open: fica conectado e avisa', async () => {
    const { opcoes, sockets, aoMudarConexao } = montar()
    const w = await conectarWhatsapp(opcoes)
    expect(w.conectado).toBe(false)
    sockets[0].emit('connection.update', { connection: 'open' })
    expect(w.conectado).toBe(true)
    expect(aoMudarConexao).toHaveBeenCalledWith(true)
  })

  it('close com loggedOut (401): pede pareamento e não reconecta', async () => {
    const { opcoes, sockets, aoMudarConexao, esperas } = montar()
    const w = await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', { connection: 'open' })
    sockets[0].emit('connection.update', queda(401))
    await proximoCiclo()
    expect(w.precisaParear).toBe(true)
    expect(w.conectado).toBe(false)
    expect(aoMudarConexao).toHaveBeenLastCalledWith(false, 'sessão encerrada no celular')
    expect(sockets).toHaveLength(1)
    expect(esperas).toEqual([])
  })

  it('close com outro código: espera crescente, recria o socket e volta a 5 s depois de um open', async () => {
    const { opcoes, sockets, esperas } = montar()
    await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(esperas).toEqual([5_000])
    expect(sockets).toHaveLength(2)
    sockets[1].emit('connection.update', queda(428))
    await proximoCiclo()
    sockets[2].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(esperas).toEqual([5_000, 10_000, 20_000])
    sockets[3].emit('connection.update', { connection: 'open' })
    sockets[3].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(esperas).toEqual([5_000, 10_000, 20_000, 5_000])
    expect(sockets).toHaveLength(5)
  })

  it('a espera da reconexão para em 5 minutos', async () => {
    const { opcoes, sockets, esperas } = montar()
    await conectarWhatsapp(opcoes)
    for (let i = 0; i < 9; i++) {
      sockets[i].emit('connection.update', queda(428))
      await proximoCiclo()
    }
    expect(esperas).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000])
  })

  it('creds.update grava as credenciais', async () => {
    const { opcoes, sockets, saveCreds } = montar()
    await conectarWhatsapp(opcoes)
    sockets[0].emit('creds.update', {})
    expect(saveCreds).toHaveBeenCalledTimes(1)
  })

  it('messages.upsert: entrega as válidas quando notify; ignora append', async () => {
    const { opcoes, sockets, aoReceber } = montar()
    await conectarWhatsapp(opcoes)
    const valida = { key: { remoteJid: JID_A, fromMe: false }, message: { conversation: 'ATIVAR' } }
    const grupo = { key: { remoteJid: '120363000000000001@g.us' }, message: { conversation: 'oi' } }
    sockets[0].emit('messages.upsert', { type: 'append', messages: [valida] })
    expect(aoReceber).not.toHaveBeenCalled()
    sockets[0].emit('messages.upsert', { type: 'notify', messages: [valida, grupo] })
    expect(aoReceber).toHaveBeenCalledTimes(1)
    expect(aoReceber).toHaveBeenCalledWith({ jid: JID_A, texto: 'ATIVAR' })
  })

  it('enviar: digitando, espera, pausa e só então manda o texto', async () => {
    const m = montar()
    const ordem: string[] = []
    m.opcoes.dependencias!.dormir = async (ms) => { ordem.push(`dormir:${ms >= 2_000 && ms <= 4_000 ? 'digitando' : ms}`) }
    const w = await conectarWhatsapp(m.opcoes)
    const s = m.sockets[0]
    s.emit('connection.update', { connection: 'open' })
    s.sendPresenceUpdate.mockImplementation(async (t: string, j: string) => { ordem.push(`presenca:${t}:${j}`) })
    s.sendMessage.mockImplementation(async (j: string, c: { text: string }) => { ordem.push(`mensagem:${j}:${c.text}`) })
    await w.enviar(JID_A, 'Olá')
    expect(ordem).toEqual([`presenca:composing:${JID_A}`, 'dormir:digitando', `presenca:paused:${JID_A}`, `mensagem:${JID_A}:Olá`])
  })

  it('enviar desconectado lança', async () => {
    const { opcoes, sockets } = montar()
    const w = await conectarWhatsapp(opcoes)
    await expect(w.enviar(JID_A, 'Olá')).rejects.toThrow('WhatsApp desconectado')
    expect(sockets[0].sendMessage).not.toHaveBeenCalled()
  })

  it('resolverJid: devolve o endereço quando o número tem WhatsApp; senão null', async () => {
    const { opcoes, sockets } = montar()
    const w = await conectarWhatsapp(opcoes)
    const s = sockets[0]
    s.emit('connection.update', { connection: 'open' })
    s.onWhatsApp.mockResolvedValueOnce([{ exists: true, jid: '556599990001@s.whatsapp.net' }])
    expect(await w.resolverJid('5565999990001')).toBe('556599990001@s.whatsapp.net')
    expect(s.onWhatsApp).toHaveBeenCalledWith('5565999990001')
    s.onWhatsApp.mockResolvedValueOnce([{ exists: false, jid: '5565999990002@s.whatsapp.net' }])
    expect(await w.resolverJid('5565999990002')).toBeNull()
    s.onWhatsApp.mockResolvedValueOnce([])
    expect(await w.resolverJid('5565999990003')).toBeNull()
    s.onWhatsApp.mockResolvedValueOnce(undefined)
    expect(await w.resolverJid('5565999990004')).toBeNull()
  })

  it('pareamento: repassa o QR; com número pede o código de 8 dígitos uma vez', async () => {
    const aoPedirQr = vi.fn()
    const aoReceberCodigo = vi.fn()
    const { opcoes, sockets } = montar({ aoPedirQr, numeroParaCodigo: '+55 (65) 99999-0001', aoReceberCodigo })
    await conectarWhatsapp(opcoes)
    const s = sockets[0]
    s.emit('connection.update', { qr: 'texto-do-qr' })
    s.emit('connection.update', { qr: 'outro-qr' })
    await proximoCiclo()
    expect(aoPedirQr).toHaveBeenCalledWith('texto-do-qr')
    expect(aoPedirQr).toHaveBeenCalledTimes(2)
    expect(s.requestPairingCode).toHaveBeenCalledTimes(1)
    expect(s.requestPairingCode).toHaveBeenCalledWith('5565999990001')
    expect(aoReceberCodigo).toHaveBeenCalledWith('ABCD1234')
  })

  it('pareamento: sessão já registrada não pede código', async () => {
    const aoReceberCodigo = vi.fn()
    const { opcoes, sockets } = montar({ numeroParaCodigo: '5565999990001', aoReceberCodigo })
    await conectarWhatsapp(opcoes)
    sockets[0].authState.creds.registered = true
    sockets[0].emit('connection.update', { qr: 'x' })
    await proximoCiclo()
    expect(sockets[0].requestPairingCode).not.toHaveBeenCalled()
    expect(aoReceberCodigo).not.toHaveBeenCalled()
  })

  it('encerrar: fecha o socket e não reconecta', async () => {
    const { opcoes, sockets } = montar()
    const w = await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', { connection: 'open' })
    await w.encerrar()
    expect(sockets[0].end).toHaveBeenCalledTimes(1)
    expect(w.conectado).toBe(false)
    sockets[0].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(sockets).toHaveLength(1)
  })
})
