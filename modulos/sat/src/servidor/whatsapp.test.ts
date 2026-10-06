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

  it('lê o texto embrulhado por mensagem temporária (efêmera) ou de visualização única', () => {
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: { ephemeralMessage: { message: { conversation: 'SAIR' } } } })).toEqual({ jid: JID_A, texto: 'SAIR' })
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'ativar' } } } } })).toEqual({ jid: JID_A, texto: 'ativar' })
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: { viewOnceMessageV2: { message: { conversation: 'SAIR' } } } })).toEqual({ jid: JID_A, texto: 'SAIR' })
    expect(lerRecebida({ key: { remoteJid: JID_A }, message: { ephemeralMessage: { message: {} } } })).toBeNull()
  })

  it('descarta número estrangeiro, canal (newsletter) e @lid com alternativa que não é de telefone', () => {
    expect(lerRecebida({ key: { remoteJid: '14155550100@s.whatsapp.net' }, message: { conversation: 'ATIVAR' } })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: '120363000000000001@newsletter' }, message: { conversation: 'ATIVAR' } })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: '123456789012345@lid', remoteJidAlt: '120363000000000001@g.us' }, message: { conversation: 'ATIVAR' } })).toBeNull()
    expect(lerRecebida({ key: { remoteJid: '123456789012345@lid', remoteJidAlt: '987654321098765@lid' }, message: { conversation: 'ATIVAR' } })).toBeNull()
  })
})

type Config = Record<string, unknown>

class SocketFalso extends EventEmitter {
  ev = { on: (evento: string, fn: (d: never) => void) => { this.on(evento, fn as (...args: unknown[]) => void) } }
  authState = { creds: { registered: false } }
  enviadas = 0
  sendMessage = vi.fn(async (_jid: string, _conteudo: { text: string }): Promise<{ key: { id: string } } | undefined> => ({ key: { id: `MSG${++this.enviadas}` } }))
  /** O mapa de endereços da biblioteca: `@lid` → telefone (com o aparelho, como ela devolve). */
  pnDoLid = vi.fn(async (_lid: string): Promise<string | null> => null)
  signalRepository = { lidMapping: { getPNForLID: (lid: string) => this.pnDoLid(lid) } }
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
  const aoRestringir = vi.fn()
  const aoFalharEntrega = vi.fn()
  const relogio = { agora: new Date(2026, 9, 6, 9, 0).getTime() }
  const opcoes: OpcoesWhatsapp = {
    pastaSessao: 'sessao-falsa',
    aoReceber,
    aoMudarConexao,
    aoRestringir,
    aoFalharEntrega,
    dependencias: {
      criarSocket: (config) => {
        const s = new SocketFalso()
        sockets.push(s)
        configs.push(config)
        return s as unknown as SocketMinimo
      },
      estadoDaSessao: async () => ({ state: { falso: true }, saveCreds }),
      dormir: async (ms) => { esperas.push(ms) },
      agora: () => relogio.agora,
    },
    ...extra,
  }
  return { opcoes, sockets, configs, esperas, saveCreds, aoReceber, aoMudarConexao, aoRestringir, aoFalharEntrega, relogio }
}

const MINUTO = 60_000
const HORA = 60 * MINUTO

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

  it('close com outro código: espera crescente e recria o socket; abrir e cair logo não zera a espera', async () => {
    const { opcoes, sockets, esperas, relogio } = montar()
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
    // abre e cai 4 min 59 s depois: a espera continua crescendo
    sockets[3].emit('connection.update', { connection: 'open' })
    relogio.agora += 5 * MINUTO - 1_000
    sockets[3].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(esperas).toEqual([5_000, 10_000, 20_000, 40_000])
    expect(sockets).toHaveLength(5)
  })

  it('a espera só volta a 5 s depois de a conexão ficar aberta por 5 minutos seguidos', async () => {
    const { opcoes, sockets, esperas, relogio } = montar()
    await conectarWhatsapp(opcoes)
    for (const i of [0, 1, 2]) {
      sockets[i].emit('connection.update', queda(428))
      await proximoCiclo()
    }
    expect(esperas).toEqual([5_000, 10_000, 20_000])
    sockets[3].emit('connection.update', { connection: 'open' })
    relogio.agora += 5 * MINUTO
    sockets[3].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(esperas).toEqual([5_000, 10_000, 20_000, 5_000])
    // o tempo aberto não soma de uma conexão para a outra
    sockets[4].emit('connection.update', { connection: 'open' })
    relogio.agora += 3 * MINUTO
    sockets[4].emit('connection.update', queda(428))
    await proximoCiclo()
    sockets[5].emit('connection.update', { connection: 'open' })
    relogio.agora += 3 * MINUTO
    sockets[5].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(esperas).toEqual([5_000, 10_000, 20_000, 5_000, 10_000, 20_000])
  })

  it('mais de 10 quedas dentro de uma hora: para de tentar sozinho e avisa', async () => {
    const { opcoes, sockets, esperas, aoMudarConexao, relogio } = montar()
    const w = await conectarWhatsapp(opcoes)
    for (let i = 0; i < 10; i++) {
      sockets[i].emit('connection.update', queda(428))
      await proximoCiclo()
      relogio.agora += 5 * MINUTO
    }
    // dez quedas em 50 min: ainda tenta
    expect(sockets).toHaveLength(11)
    expect(w.precisaParear).toBe(false)
    sockets[10].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(w.precisaParear).toBe(true)
    expect(w.conectado).toBe(false)
    expect(aoMudarConexao).toHaveBeenLastCalledWith(false, 'muitas quedas seguidas')
    expect(sockets).toHaveLength(11)
    expect(esperas).toHaveLength(10)
  })

  it('quedas espalhadas (menos de 11 em qualquer hora) não param a reconexão; close repetido do mesmo socket conta uma vez', async () => {
    const { opcoes, sockets, relogio } = montar()
    const w = await conectarWhatsapp(opcoes)
    for (let i = 0; i < 30; i++) {
      sockets[i].emit('connection.update', queda(428))
      sockets[i].emit('connection.update', queda(428))
      await proximoCiclo()
      relogio.agora += 7 * MINUTO
    }
    expect(relogio.agora).toBeGreaterThan(new Date(2026, 9, 6, 9, 0).getTime() + 3 * HORA)
    expect(w.precisaParear).toBe(false)
    expect(sockets).toHaveLength(31)
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

  it('messages.upsert: entrega as válidas quando notify (com ou sem carimbo de hora)', async () => {
    const { opcoes, sockets, aoReceber, relogio } = montar()
    await conectarWhatsapp(opcoes)
    const valida = { key: { remoteJid: JID_A, fromMe: false }, message: { conversation: 'ATIVAR' } }
    const grupo = { key: { remoteJid: '120363000000000001@g.us' }, message: { conversation: 'oi' } }
    sockets[0].emit('messages.upsert', { type: 'notify', messages: [valida, grupo] })
    expect(aoReceber).toHaveBeenCalledTimes(1)
    expect(aoReceber).toHaveBeenCalledWith({ jid: JID_A, texto: 'ATIVAR' })
    sockets[0].emit('messages.upsert', { type: 'notify', messages: [{ ...valida, messageTimestamp: Math.floor(relogio.agora / 1000) }] })
    expect(aoReceber).toHaveBeenCalledTimes(2)
    sockets[0].emit('messages.upsert', { type: 'outro', messages: [valida] })
    expect(aoReceber).toHaveBeenCalledTimes(2)
  })

  describe('messages.upsert do tipo append (a fila de quando o serviço estava fora do ar)', () => {
    const segundos = (ms: number) => Math.floor(ms / 1000)
    const sair = (carimbo: unknown, fromMe = false) => ({ key: { remoteJid: JID_A, fromMe }, message: { conversation: 'SAIR' }, messageTimestamp: carimbo })

    it('recente e de outra pessoa: é entregue', async () => {
      const { opcoes, sockets, aoReceber, relogio } = montar()
      await conectarWhatsapp(opcoes)
      sockets[0].emit('messages.upsert', { type: 'append', messages: [sair(segundos(relogio.agora - 47 * HORA))] })
      expect(aoReceber).toHaveBeenCalledTimes(1)
      expect(aoReceber).toHaveBeenCalledWith({ jid: JID_A, texto: 'SAIR' })
      // a biblioteca também entrega o carimbo como objeto (Long)
      sockets[0].emit('messages.upsert', { type: 'append', messages: [sair({ toNumber: () => segundos(relogio.agora - HORA) })] })
      expect(aoReceber).toHaveBeenCalledTimes(2)
    })

    it('com 3 dias (ou 48 h em ponto) não é entregue', async () => {
      const { opcoes, sockets, aoReceber, relogio } = montar()
      await conectarWhatsapp(opcoes)
      sockets[0].emit('messages.upsert', { type: 'append', messages: [sair(segundos(relogio.agora - 72 * HORA))] })
      sockets[0].emit('messages.upsert', { type: 'append', messages: [sair(segundos(relogio.agora - 48 * HORA))] })
      expect(aoReceber).not.toHaveBeenCalled()
    })

    it('minha (fromMe) não é entregue, nem a sem carimbo de hora', async () => {
      const { opcoes, sockets, aoReceber, relogio } = montar()
      await conectarWhatsapp(opcoes)
      sockets[0].emit('messages.upsert', { type: 'append', messages: [sair(segundos(relogio.agora), true)] })
      sockets[0].emit('messages.upsert', { type: 'append', messages: [sair(undefined), sair(null), sair('texto')] })
      expect(aoReceber).not.toHaveBeenCalled()
    })
  })

  describe('remetente em @lid sem o telefone junto', () => {
    const LID = '123456789012345@lid'
    const doLid = (texto: string) => ({ key: { remoteJid: LID }, message: { conversation: texto } })

    it('resolve o telefone pelo mapa da biblioteca e entrega com o endereço de telefone, sem o aparelho', async () => {
      const { opcoes, sockets, aoReceber } = montar()
      await conectarWhatsapp(opcoes)
      sockets[0].pnDoLid.mockResolvedValue('5565999990001:0@s.whatsapp.net')
      sockets[0].emit('messages.upsert', { type: 'notify', messages: [doLid('ATIVAR')] })
      await proximoCiclo()
      expect(sockets[0].pnDoLid).toHaveBeenCalledWith(LID)
      expect(aoReceber).toHaveBeenCalledTimes(1)
      expect(aoReceber).toHaveBeenCalledWith({ jid: JID_A, texto: 'ATIVAR' })
    })

    it('o mapa não conhece, devolve número de fora ou falha: descarta, e o registro não leva o texto', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const { opcoes, sockets, aoReceber } = montar()
        await conectarWhatsapp(opcoes)
        sockets[0].emit('messages.upsert', { type: 'notify', messages: [doLid('ATIVAR')] })
        await proximoCiclo()
        sockets[0].pnDoLid.mockResolvedValueOnce('14155550100:0@s.whatsapp.net')
        sockets[0].emit('messages.upsert', { type: 'notify', messages: [doLid('ATIVAR')] })
        await proximoCiclo()
        sockets[0].pnDoLid.mockRejectedValueOnce(new Error('falhou com TEXTO-SECRETO'))
        sockets[0].emit('messages.upsert', { type: 'notify', messages: [doLid('TEXTO-SECRETO')] })
        await proximoCiclo()
        expect(aoReceber).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalled()
        expect(JSON.stringify(log.mock.calls)).not.toContain('TEXTO-SECRETO')
      } finally {
        log.mockRestore()
      }
    })

    it('mensagem sem texto nem consulta o mapa', async () => {
      const { opcoes, sockets, aoReceber } = montar()
      await conectarWhatsapp(opcoes)
      sockets[0].emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: LID }, message: {} }, { key: { remoteJid: LID, fromMe: true }, message: { conversation: 'oi' } }] })
      await proximoCiclo()
      expect(sockets[0].pnDoLid).not.toHaveBeenCalled()
      expect(aoReceber).not.toHaveBeenCalled()
    })

    it('a ordem de chegada se mantém: a que espera o mapa não é ultrapassada pela seguinte', async () => {
      const { opcoes, sockets, aoReceber } = montar()
      await conectarWhatsapp(opcoes)
      let soltar: (pn: string) => void = () => {}
      sockets[0].pnDoLid.mockReturnValueOnce(new Promise<string>((r) => { soltar = r }))
      sockets[0].emit('messages.upsert', { type: 'notify', messages: [doLid('ATIVAR'), { key: { remoteJid: JID_A }, message: { conversation: 'SAIR' } }] })
      await proximoCiclo()
      expect(aoReceber).not.toHaveBeenCalled()
      soltar('5565999990001:0@s.whatsapp.net')
      await proximoCiclo()
      expect(aoReceber.mock.calls.map((c) => c[0].texto)).toEqual(['ATIVAR', 'SAIR'])
      // fila vazia de novo: a próxima sai na hora
      sockets[0].emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: JID_A }, message: { conversation: 'ATIVAR' } }] })
      expect(aoReceber).toHaveBeenCalledTimes(3)
    })
  })

  describe('restrição da conta e recusa de mensagem', () => {
    it('connection.update com reachoutTimeLock ativo: guarda até quando e avisa; quando some, avisa de novo', async () => {
      const { opcoes, sockets, aoRestringir, relogio } = montar()
      const w = await conectarWhatsapp(opcoes)
      expect(w.restritoAte).toBeNull()
      const fim = relogio.agora + 6 * HORA
      sockets[0].emit('connection.update', { reachoutTimeLock: { isActive: true, timeEnforcementEnds: new Date(fim), enforcementType: 'BIZ_QUALITY' } })
      expect(w.restritoAte).toBe(fim)
      expect(aoRestringir).toHaveBeenLastCalledWith(fim, 'BIZ_QUALITY')
      // o mesmo aviso repetido não chama de novo
      sockets[0].emit('connection.update', { reachoutTimeLock: { isActive: true, timeEnforcementEnds: new Date(fim), enforcementType: 'BIZ_QUALITY' } })
      expect(aoRestringir).toHaveBeenCalledTimes(1)
      sockets[0].emit('connection.update', { reachoutTimeLock: { isActive: false, enforcementType: 'DEFAULT' } })
      expect(w.restritoAte).toBeNull()
      expect(aoRestringir).toHaveBeenCalledTimes(2)
      expect(aoRestringir.mock.calls[1][0]).toBeNull()
    })

    it('restrição ativa sem prazo informado vale até segunda ordem; a que já venceu não conta', async () => {
      const { opcoes, sockets, aoRestringir, relogio } = montar()
      const w = await conectarWhatsapp(opcoes)
      sockets[0].emit('connection.update', { reachoutTimeLock: { isActive: true } })
      expect(w.restritoAte).toBe(Infinity)
      expect(aoRestringir).toHaveBeenLastCalledWith(Infinity, '')
      const fim = relogio.agora + HORA
      sockets[0].emit('connection.update', { reachoutTimeLock: { isActive: true, timeEnforcementEnds: new Date(fim) } })
      expect(w.restritoAte).toBe(fim)
      relogio.agora = fim
      expect(w.restritoAte).toBeNull()
    })

    it('enviar devolve o id da mensagem', async () => {
      const { opcoes, sockets } = montar()
      const w = await conectarWhatsapp(opcoes)
      sockets[0].emit('connection.update', { connection: 'open' })
      expect(await w.enviar(JID_A, 'Olá')).toBe('MSG1')
      sockets[0].sendMessage.mockResolvedValueOnce(undefined)
      expect(await w.enviar(JID_A, 'Olá')).toBeNull()
    })

    it('messages.update com erro para uma mensagem nossa: avisa a falha de entrega, uma vez, com o endereço para onde foi', async () => {
      const { opcoes, sockets, aoFalharEntrega } = montar()
      const w = await conectarWhatsapp(opcoes)
      const s = sockets[0]
      s.emit('connection.update', { connection: 'open' })
      const id = await w.enviar(JID_A, 'Olá')
      // a biblioteca devolve a recusa com o endereço que o servidor mandou (pode ser @lid) e status 0 (ERROR)
      const recusa = { key: { remoteJid: '123456789012345@lid', fromMe: true, id }, update: { status: 0, messageStubParameters: ['463'] } }
      s.emit('messages.update', [recusa])
      expect(aoFalharEntrega).toHaveBeenCalledTimes(1)
      expect(aoFalharEntrega).toHaveBeenCalledWith(JID_A)
      s.emit('messages.update', [recusa])
      expect(aoFalharEntrega).toHaveBeenCalledTimes(1)
    })

    it('messages.update sem erro, ou de mensagem que não é deste serviço: nada', async () => {
      const { opcoes, sockets, aoFalharEntrega } = montar()
      const w = await conectarWhatsapp(opcoes)
      const s = sockets[0]
      s.emit('connection.update', { connection: 'open' })
      const id = await w.enviar(JID_A, 'Olá')
      s.emit('messages.update', [
        { key: { remoteJid: JID_A, fromMe: true, id }, update: { status: 2 } },
        { key: { remoteJid: JID_A, fromMe: true, id }, update: { messageStubParameters: ['x'] } },
        { key: { remoteJid: JID_A, fromMe: true, id: 'DE-OUTRO-LUGAR' }, update: { status: 0 } },
        { key: { remoteJid: JID_A, fromMe: true }, update: { status: 0 } },
      ])
      expect(aoFalharEntrega).not.toHaveBeenCalled()
    })

    it('um tratador de falha que lança não volta para a biblioteca', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const { opcoes, sockets, aoFalharEntrega } = montar()
        const w = await conectarWhatsapp(opcoes)
        sockets[0].emit('connection.update', { connection: 'open' })
        const id = await w.enviar(JID_A, 'Olá')
        aoFalharEntrega.mockImplementationOnce(() => { throw new Error('quebrou') })
        expect(() => sockets[0].emit('messages.update', [{ key: { fromMe: true, id }, update: { status: 0 } }])).not.toThrow()
      } finally {
        log.mockRestore()
      }
    })
  })

  describe('versão do protocolo', () => {
    const comVersao = (buscarVersao: () => Promise<{ version: [number, number, number]; isLatest: boolean }>) => {
      const m = montar()
      m.opcoes.dependencias = { ...m.opcoes.dependencias!, buscarVersao }
      return m
    }

    it('a busca responde: o socket usa a versão', async () => {
      const m = comVersao(async () => ({ version: [2, 3000, 123], isLatest: true }))
      m.opcoes.dependencias!.dormir = (ms) => (ms === 10_000 ? new Promise<void>(() => {}) : Promise.resolve())
      await conectarWhatsapp(m.opcoes)
      expect(m.configs[0].version).toEqual([2, 3000, 123])
    })

    it('a busca não responde em 10 s: segue sem `version`', async () => {
      const m = comVersao(() => new Promise(() => {}))
      await conectarWhatsapp(m.opcoes)
      expect(m.esperas).toEqual([10_000])
      expect(m.configs).toHaveLength(1)
      expect('version' in m.configs[0]).toBe(false)
    })

    it('a busca falha (lançando, ou do jeito da biblioteca: `isLatest: false`): segue sem `version`', async () => {
      const lanca = comVersao(async () => { throw new Error('sem rede') })
      lanca.opcoes.dependencias!.dormir = () => new Promise<void>(() => {})
      await conectarWhatsapp(lanca.opcoes)
      expect('version' in lanca.configs[0]).toBe(false)
      const daBiblioteca = comVersao(async () => ({ version: [2, 3000, 1], isLatest: false }))
      daBiblioteca.opcoes.dependencias!.dormir = () => new Promise<void>(() => {})
      await conectarWhatsapp(daBiblioteca.opcoes)
      expect('version' in daBiblioteca.configs[0]).toBe(false)
    })
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

  it('creds.update de socket já trocado ou depois de encerrar() ainda grava', async () => {
    const { opcoes, sockets, saveCreds } = montar()
    const w = await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(sockets).toHaveLength(2)
    sockets[0].emit('creds.update', {})
    expect(saveCreds).toHaveBeenCalledTimes(1)
    await w.encerrar()
    saveCreds.mockClear()
    sockets[1].emit('creds.update', {})
    expect(saveCreds).toHaveBeenCalledTimes(1)
  })

  it('falha ao gravar a sessão é registrada, sem rejeição solta e sem dados', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { opcoes, sockets, saveCreds } = montar()
      const w = await conectarWhatsapp(opcoes)
      saveCreds.mockRejectedValue(new Error('disco cheio'))
      sockets[0].emit('creds.update', {})
      await proximoCiclo()
      expect(log).toHaveBeenCalledWith('[whatsapp] falha ao gravar a sessão: disco cheio')
      saveCreds.mockRejectedValue('estranho')
      await expect(w.encerrar()).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith('[whatsapp] falha ao gravar a sessão: erro')
    } finally {
      log.mockRestore()
    }
  })

  it('encerrar() grava as credenciais uma vez no fim, depois de fechar o socket', async () => {
    const { opcoes, sockets, saveCreds } = montar()
    const w = await conectarWhatsapp(opcoes)
    const ordem: string[] = []
    sockets[0].end.mockImplementation(() => { ordem.push('end') })
    saveCreds.mockImplementation(async () => { ordem.push('saveCreds') })
    await w.encerrar()
    expect(ordem).toEqual(['end', 'saveCreds'])
  })

  it('eventos de um socket já substituído não valem', async () => {
    const { opcoes, sockets, aoReceber } = montar()
    const w = await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(sockets).toHaveLength(2)
    sockets[0].emit('connection.update', { connection: 'open' })
    expect(w.conectado).toBe(false)
    sockets[0].emit('connection.update', queda(428))
    await proximoCiclo()
    sockets[0].emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: JID_A }, message: { conversation: 'ATIVAR' } }] })
    expect(aoReceber).not.toHaveBeenCalled()
    expect(w.conectado).toBe(false)
    expect(sockets).toHaveLength(2)
  })

  it('dois close seguidos no mesmo socket criam um socket só', async () => {
    const { opcoes, sockets, esperas } = montar()
    await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', queda(428))
    sockets[0].emit('connection.update', queda(428))
    await proximoCiclo()
    expect(sockets).toHaveLength(2)
    expect(esperas).toEqual([5_000])
  })

  it('enviar: manda "paused" mesmo se o envio falhar, e o erro original sobe', async () => {
    const { opcoes, sockets } = montar()
    const w = await conectarWhatsapp(opcoes)
    const s = sockets[0]
    s.emit('connection.update', { connection: 'open' })
    s.sendMessage.mockRejectedValueOnce(new Error('sem rede'))
    await expect(w.enviar(JID_A, 'Olá')).rejects.toThrow('sem rede')
    expect(s.sendPresenceUpdate.mock.calls.map((c) => c[0])).toEqual(['composing', 'paused'])
  })

  it('enviar: manda "paused" mesmo se a espera falhar', async () => {
    const m = montar()
    m.opcoes.dependencias!.dormir = async () => { throw new Error('interrompido') }
    const w = await conectarWhatsapp(m.opcoes)
    const s = m.sockets[0]
    s.emit('connection.update', { connection: 'open' })
    await expect(w.enviar(JID_A, 'Olá')).rejects.toThrow('interrompido')
    expect(s.sendPresenceUpdate.mock.calls.map((c) => c[0])).toEqual(['composing', 'paused'])
    expect(s.sendMessage).not.toHaveBeenCalled()
  })

  it('messages.upsert: uma mensagem que lança não derruba as outras, e o registro não leva o texto', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { opcoes, sockets, aoReceber } = montar()
      await conectarWhatsapp(opcoes)
      aoReceber.mockImplementationOnce(() => { throw new Error('quebrou com TEXTO-SECRETO') })
      const msg = (texto: string) => ({ key: { remoteJid: JID_A }, message: { conversation: texto } })
      expect(() => sockets[0].emit('messages.upsert', { type: 'notify', messages: [msg('primeira'), msg('segunda')] })).not.toThrow()
      expect(aoReceber).toHaveBeenCalledTimes(2)
      expect(aoReceber).toHaveBeenLastCalledWith({ jid: JID_A, texto: 'segunda' })
      const registrado = JSON.stringify(log.mock.calls)
      expect(log).toHaveBeenCalled()
      expect(registrado).not.toContain('primeira')
      expect(registrado).not.toContain('segunda')
      expect(registrado).not.toContain('TEXTO-SECRETO')
    } finally {
      log.mockRestore()
    }
  })

  it('messages.upsert: aoReceber que devolve Promise rejeitada é tratado', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { opcoes, sockets, aoReceber } = montar()
      await conectarWhatsapp(opcoes)
      aoReceber.mockRejectedValueOnce(new Error('falhou com TEXTO-SECRETO'))
      sockets[0].emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: JID_A }, message: { conversation: 'ATIVAR' } }] })
      await proximoCiclo()
      expect(log).toHaveBeenCalled()
      expect(JSON.stringify(log.mock.calls)).not.toContain('TEXTO-SECRETO')
    } finally {
      log.mockRestore()
    }
  })

  it.each([
    [440, 'sessão em uso em outro lugar'],
    [403, 'acesso recusado pelo WhatsApp'],
    [500, 'sessão inválida'],
    [411, 'versão do aparelho incompatível'],
  ])('close %i: para a reconexão e pede atenção', async (codigo, motivo) => {
    const { opcoes, sockets, aoMudarConexao, esperas } = montar()
    const w = await conectarWhatsapp(opcoes)
    sockets[0].emit('connection.update', { connection: 'open' })
    sockets[0].emit('connection.update', queda(codigo))
    await proximoCiclo()
    expect(w.precisaParear).toBe(true)
    expect(w.conectado).toBe(false)
    expect(aoMudarConexao).toHaveBeenLastCalledWith(false, motivo)
    expect(sockets).toHaveLength(1)
    expect(esperas).toEqual([])
  })
})
