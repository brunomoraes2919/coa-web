/** Conexão do WhatsApp do serviço (Baileys). É o único arquivo que importa a biblioteca. */
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from 'baileys'
import { chaveDoNumero, mascarar } from './comandos'
import { tempoDigitando } from './ritmo'

export interface MensagemRecebida { jid: string; texto: string }

export interface Whatsapp {
  readonly conectado: boolean
  /** `true` depois de o celular encerrar a sessão: só um novo pareamento resolve. */
  readonly precisaParear: boolean
  /** Manda um texto com "digitando" antes. Lança se não estiver conectado. */
  enviar(jid: string, texto: string): Promise<void>
  /** Endereço do WhatsApp de um número (55…); `null` se o número não tem WhatsApp. */
  resolverJid(telefone: string): Promise<string | null>
  encerrar(): Promise<void>
}

/** A parte do socket do Baileys que este arquivo usa. */
export interface SocketMinimo {
  ev: { on(evento: string, fn: (dados: never) => void): void }
  sendMessage(jid: string, conteudo: { text: string }): Promise<unknown>
  sendPresenceUpdate(tipo: 'composing' | 'paused', jid: string): Promise<void>
  onWhatsApp(...numeros: string[]): Promise<{ jid: string; exists: boolean }[] | undefined>
  requestPairingCode(numero: string): Promise<string>
  end(erro: Error | undefined): void | Promise<void>
  authState: { creds: { registered?: boolean } }
}

export interface OpcoesWhatsapp {
  pastaSessao: string
  aoReceber: (m: MensagemRecebida) => void | Promise<void>
  aoMudarConexao: (conectado: boolean, motivo?: string) => void
  /** Só no pareamento: mostra o QR (texto para desenhar) ou o código de 8 dígitos. */
  aoPedirQr?: (qr: string) => void
  numeroParaCodigo?: string
  aoReceberCodigo?: (codigo: string) => void
  /** Para os testes: fábrica do socket e do estado de autenticação. */
  dependencias?: {
    criarSocket: (config: Record<string, unknown>) => SocketMinimo
    estadoDaSessao: (pasta: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
    dormir: (ms: number) => Promise<void>
  }
}

interface MensagemBruta {
  key: { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null }
  message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null
}

const ESPERA_MINIMA = 5_000
const ESPERA_MAXIMA = 5 * 60_000

// Quedas em que tentar de novo só piora: o número precisa de atenção de uma pessoa.
// Dois lugares se derrubando em laço prejudicam a reputação do número.
const MOTIVO_SEM_RECONEXAO: Record<number, string> = {
  [DisconnectReason.loggedOut]: 'sessão encerrada no celular',
  [DisconnectReason.connectionReplaced]: 'sessão em uso em outro lugar',
  [DisconnectReason.forbidden]: 'acesso recusado pelo WhatsApp',
}

const textoDoErro = (e: unknown) => (e instanceof Error ? e.message : 'erro')

/** Só o texto de uma mensagem de conversa individual vinda de outra pessoa; o resto vira `null`. */
export function lerRecebida(m: MensagemBruta): MensagemRecebida | null {
  if (m.key.fromMe) return null
  const bruto = m.key.remoteJid ?? ''
  // Endereço @lid não é telefone: só vale quando a mensagem traz o endereço de telefone junto.
  const jid = bruto.endsWith('@lid') ? (m.key.remoteJidAlt ?? '') : bruto
  // Descarta grupo, status/broadcast e número de fora do Brasil.
  if (!jid || chaveDoNumero(jid) === null) return null
  const texto = m.message?.conversation ?? m.message?.extendedTextMessage?.text
  return texto ? { jid, texto } : null
}

// O registrador padrão da biblioteca escreveria conteúdo de mensagem no log.
const registradorSilencioso = {
  level: 'silent',
  child() { return registradorSilencioso },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
}

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function conectarWhatsapp(opcoes: OpcoesWhatsapp): Promise<Whatsapp> {
  const dep = opcoes.dependencias
  const criarSocket = dep?.criarSocket ?? ((config: Record<string, unknown>) => makeWASocket(config as never) as unknown as SocketMinimo)
  const estadoDaSessao = dep?.estadoDaSessao ?? useMultiFileAuthState
  const dormir = dep?.dormir ?? dormirDeVerdade

  const { state, saveCreds } = await estadoDaSessao(opcoes.pastaSessao)

  // Versão do protocolo: busca uma vez; se falhar, a biblioteca usa a dela.
  let version: [number, number, number] | undefined
  if (!dep) {
    try { version = (await fetchLatestBaileysVersion()).version } catch { version = undefined }
  }

  let socket: SocketMinimo | undefined
  let conectado = false
  let precisaParear = false
  let encerrado = false
  let reconectando = false
  let espera = ESPERA_MINIMA
  const numeroParaCodigo = opcoes.numeroParaCodigo?.replace(/\D/g, '')

  async function gravarSessao(): Promise<void> {
    try {
      await saveCreds()
    } catch (e) {
      console.log(`[whatsapp] falha ao gravar a sessão: ${textoDoErro(e)}`)
    }
  }

  // Sem o texto da mensagem: o registro só diz que uma falhou.
  const falhouAoReceber = (e: unknown) => console.log(`[whatsapp] falha ao tratar uma mensagem recebida: ${e instanceof Error ? e.name : 'erro'}`)

  function abrir(): void {
    const s = criarSocket({
      auth: state,
      ...(version ? { version } : {}),
      browser: Browsers.ubuntu('Locks SAT'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      logger: registradorSilencioso,
    })
    socket = s
    let codigoPedido = false
    // Eventos de um socket já substituído (ou de depois do encerramento) não valem.
    const atual = () => socket === s && !encerrado

    // Sem o guarda: credencial emitida por um socket já trocado ou depois de encerrar() ainda tem de ser gravada.
    s.ev.on('creds.update', () => { void gravarSessao() })

    s.ev.on('connection.update', ((u: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }) => {
      if (!atual()) return
      if (u.qr) {
        opcoes.aoPedirQr?.(u.qr)
        if (numeroParaCodigo && !codigoPedido && !s.authState.creds.registered) {
          codigoPedido = true
          s.requestPairingCode(numeroParaCodigo)
            .then((codigo) => opcoes.aoReceberCodigo?.(codigo))
            .catch((e) => console.log(`[whatsapp] não consegui pedir o código de pareamento (${mascarar(numeroParaCodigo)}): ${textoDoErro(e)}`))
        }
      }
      if (u.connection === 'open') {
        conectado = true
        precisaParear = false
        espera = ESPERA_MINIMA
        opcoes.aoMudarConexao(true)
      } else if (u.connection === 'close') {
        conectado = false
        const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
        const motivoFixo = codigo === undefined ? undefined : MOTIVO_SEM_RECONEXAO[codigo]
        if (motivoFixo) {
          precisaParear = true
          opcoes.aoMudarConexao(false, motivoFixo)
          return
        }
        opcoes.aoMudarConexao(false, `conexão perdida${codigo ? ` (${codigo})` : ''}`)
        void reconectar()
      }
    }) as (d: never) => void)

    s.ev.on('messages.upsert', ((e: { messages: MensagemBruta[]; type: string }) => {
      if (!atual() || e.type !== 'notify') return
      // Uma mensagem que dá problema não derruba as outras nem volta para a biblioteca.
      for (const m of e.messages) {
        try {
          const recebida = lerRecebida(m)
          if (recebida) Promise.resolve(opcoes.aoReceber(recebida)).catch(falhouAoReceber)
        } catch (erro) {
          falhouAoReceber(erro)
        }
      }
    }) as (d: never) => void)
  }

  // Nunca dois sockets: não depende de a biblioteca emitir um só `close`.
  async function reconectar(): Promise<void> {
    if (reconectando) return
    reconectando = true
    try {
      while (!encerrado) {
        const ms = espera
        espera = Math.min(espera * 2, ESPERA_MAXIMA)
        console.log(`[whatsapp] nova tentativa de conexão em ${Math.round(ms / 1000)} s`)
        await dormir(ms)
        if (encerrado) return
        try {
          abrir()
          return
        } catch (e) {
          console.log(`[whatsapp] falha ao reabrir a conexão: ${textoDoErro(e)}`)
        }
      }
    } finally {
      reconectando = false
    }
  }

  abrir()

  return {
    get conectado() { return conectado },
    get precisaParear() { return precisaParear },

    async enviar(jid, texto) {
      if (!conectado || !socket) throw new Error('WhatsApp desconectado')
      const s = socket
      await s.sendPresenceUpdate('composing', jid)
      try {
        await dormir(tempoDigitando())
      } finally {
        // Não deixa "digitando" preso; se este aviso falhar, o erro original é que importa.
        await s.sendPresenceUpdate('paused', jid).catch(() => {})
      }
      await s.sendMessage(jid, { text: texto })
    },

    async resolverJid(telefone) {
      if (!conectado || !socket) throw new Error('WhatsApp desconectado')
      const achados = await socket.onWhatsApp(telefone.replace(/\D/g, ''))
      const primeiro = achados?.[0]
      return primeiro?.exists ? primeiro.jid : null
    },

    async encerrar() {
      encerrado = true
      conectado = false
      await socket?.end(undefined)
      await gravarSessao()
    },
  }
}
