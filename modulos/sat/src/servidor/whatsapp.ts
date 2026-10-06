/** Conexão do WhatsApp do serviço (Baileys). É o único arquivo que importa a biblioteca. */
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState, WAMessageStatus,
} from 'baileys'
import { chaveDoNumero, mascarar } from './comandos'
import { tempoDigitando } from './ritmo'

export interface MensagemRecebida {
  jid: string
  texto: string
  /** Quando a mensagem foi mandada, em ms (o carimbo dela); `null` quando a biblioteca não informa. */
  em: number | null
}

export interface Whatsapp {
  readonly conectado: boolean
  /** `true` quando a conexão não é mais tentada sozinha (sessão encerrada, recusada, versão incompatível): alguém precisa olhar. */
  readonly precisaParear: boolean
  /** Até quando o WhatsApp restringiu os envios da conta, em ms (`Infinity` = sem prazo informado); `null` = sem restrição. */
  readonly restritoAte: number | null
  /** Manda um texto com "digitando" antes e devolve o id da mensagem (`null` se a biblioteca não devolveu). Lança se não estiver conectado. */
  enviar(jid: string, texto: string): Promise<string | null>
  /** Endereço do WhatsApp de um número (55…); `null` se o número não tem WhatsApp. */
  resolverJid(telefone: string): Promise<string | null>
  encerrar(): Promise<void>
}

/** A parte do socket do Baileys que este arquivo usa. */
export interface SocketMinimo {
  ev: { on(evento: string, fn: (dados: never) => void): void }
  sendMessage(jid: string, conteudo: { text: string }): Promise<{ key?: { id?: string | null } | null } | undefined>
  sendPresenceUpdate(tipo: 'composing' | 'paused', jid: string): Promise<void>
  onWhatsApp(...numeros: string[]): Promise<{ jid: string; exists: boolean }[] | undefined>
  requestPairingCode(numero: string): Promise<string>
  end(erro: Error | undefined): void | Promise<void>
  authState: { creds: { registered?: boolean } }
  /** O mapa `@lid` → telefone que a biblioteca guarda na sessão (consulta local, não vai à rede). */
  signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null> } }
}

type Versao = [number, number, number]

export interface OpcoesWhatsapp {
  pastaSessao: string
  aoReceber: (m: MensagemRecebida) => void | Promise<void>
  aoMudarConexao: (conectado: boolean, motivo?: string) => void
  /** A restrição de envios da conta apareceu (`ate` em ms; `Infinity` = sem prazo informado) ou sumiu (`ate` = `null`). */
  aoRestringir?: (ate: number | null, motivo: string) => void
  /** O WhatsApp recusou uma mensagem que este serviço mandou para `jid`. */
  aoFalharEntrega?: (jid: string) => void
  /** Só no pareamento: mostra o QR (texto para desenhar) ou o código de 8 dígitos. */
  aoPedirQr?: (qr: string) => void
  numeroParaCodigo?: string
  aoReceberCodigo?: (codigo: string) => void
  /** Para os testes: fábrica do socket e do estado de autenticação, relógio e busca da versão. */
  dependencias?: {
    criarSocket: (config: Record<string, unknown>) => SocketMinimo
    estadoDaSessao: (pasta: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
    dormir: (ms: number) => Promise<void>
    agora?: () => number
    /** Sem ela, nos testes, a versão do protocolo não é buscada. */
    buscarVersao?: () => Promise<{ version: Versao; isLatest?: boolean }>
  }
}

interface MensagemBruta {
  key: { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null }
  message?: Parameters<typeof normalizeMessageContent>[0]
  /** Segundos desde 1970; a biblioteca entrega número ou um objeto `Long`. */
  messageTimestamp?: unknown
}

interface RestricaoBruta { isActive?: boolean; timeEnforcementEnds?: Date | string | number | null; enforcementType?: string | null }

interface AtualizacaoBruta { key?: { id?: string | null } | null; update?: { status?: number | null } | null }

const ESPERA_MINIMA = 5_000
const ESPERA_MAXIMA = 5 * 60_000
/** Conexão que abre e cai logo em seguida não zera a espera: só a que ficou aberta este tempo. */
const ABERTA_PARA_ZERAR_A_ESPERA_MS = 5 * 60_000
const HORA_MS = 60 * 60_000
/** Mais quedas que isto dentro de uma hora: reconectar em laço só piora a reputação do número. */
const MAXIMO_DE_QUEDAS_POR_HORA = 10
/** Com quedas demais o serviço espera isto e tenta de novo sozinho: uma queda de internet da VM não pede ninguém. */
const PAUSA_POR_MUITAS_QUEDAS_MS = HORA_MS
const MOTIVO_MUITAS_QUEDAS = 'muitas quedas seguidas: nova tentativa em 1 hora'
/** Na biblioteca o 500 é o código-coringa (erro de WebSocket ou `stream:error` sem código), não só "sessão inválida". */
const CODIGO_ERRO_DE_SESSAO = DisconnectReason.badSession
const MOTIVO_ERRO_DE_SESSAO = 'erro de sessão: nova tentativa em 1 hora'
/** A fila de quando o serviço estava fora do ar: mensagem mais velha que isto não vale mais como pedido. */
const VALIDADE_DA_FILA_MS = 48 * HORA_MS
const PRAZO_DA_VERSAO_MS = 10_000
/** A consulta ao mapa de endereços `@lid` é local; se pendurar, não pode travar as mensagens que vêm depois. */
const PRAZO_DO_MAPA_MS = 5_000
/** Quantas mensagens enviadas ficam lembradas para reconhecer uma recusa que chega depois. */
const ENVIADAS_LEMBRADAS = 200

// Quedas em que tentar de novo só piora: o número precisa de atenção de uma pessoa.
// Dois lugares se derrubando em laço prejudicam a reputação do número.
const MOTIVO_SEM_RECONEXAO: Record<number, string> = {
  [DisconnectReason.loggedOut]: 'sessão encerrada no celular',
  [DisconnectReason.connectionReplaced]: 'sessão em uso em outro lugar',
  [DisconnectReason.forbidden]: 'acesso recusado pelo WhatsApp',
  [DisconnectReason.multideviceMismatch]: 'versão do aparelho incompatível',
}

const textoDoErro = (e: unknown) => (e instanceof Error ? e.message : 'erro')

/** O texto da mensagem; mensagem temporária (efêmera) ou de visualização única embrulha o conteúdo. */
function textoDe(m: MensagemBruta): string | null {
  const conteudo = normalizeMessageContent(m.message)
  return (conteudo?.conversation ?? conteudo?.extendedTextMessage?.text) || null
}

/** Só o texto de uma mensagem de conversa individual vinda de outra pessoa; o resto vira `null`. */
export function lerRecebida(m: MensagemBruta): MensagemRecebida | null {
  if (m.key.fromMe) return null
  const bruto = m.key.remoteJid ?? ''
  // Endereço @lid não é telefone: só vale quando a mensagem traz o endereço de telefone junto.
  const jid = bruto.endsWith('@lid') ? (m.key.remoteJidAlt ?? '') : bruto
  // Descarta grupo, status/broadcast e número de fora do Brasil.
  if (!jid || chaveDoNumero(jid) === null) return null
  const texto = textoDe(m)
  const segundos = segundosDe(m.messageTimestamp)
  return texto ? { jid, texto, em: segundos === null ? null : segundos * 1000 } : null
}

/** Remetente em `@lid` sem o telefone junto: só o mapa da biblioteca diz quem é. */
function precisaDoMapa(m: MensagemBruta): boolean {
  return !m.key.fromMe && (m.key.remoteJid ?? '').endsWith('@lid') && !m.key.remoteJidAlt && textoDe(m) !== null
}

function segundosDe(carimbo: unknown): number | null {
  const valor = typeof carimbo === 'number' ? carimbo
    : typeof (carimbo as { toNumber?: unknown } | null)?.toNumber === 'function' ? (carimbo as { toNumber(): number }).toNumber()
      : NaN
  return Number.isFinite(valor) && valor > 0 ? valor : null
}

// O registrador padrão da biblioteca escreveria conteúdo de mensagem no log.
const registradorSilencioso = {
  level: 'silent',
  child() { return registradorSilencioso },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
}

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** A versão mais nova do protocolo, com prazo: sem resposta (ou com falha), a biblioteca usa a que ela traz. */
async function versaoDoProtocolo(buscar: () => Promise<{ version: Versao; isLatest?: boolean }>, dormir: (ms: number) => Promise<void>): Promise<Versao | undefined> {
  try {
    const busca = buscar()
    busca.catch(() => {}) // se o prazo vencer e ela falhar depois, ninguém mais espera por ela
    const resposta = await Promise.race([busca, dormir(PRAZO_DA_VERSAO_MS).then(() => undefined)])
    // quando a busca falha, a biblioteca não lança: devolve a versão que ela traz, com `isLatest: false`
    return resposta && resposta.isLatest !== false ? resposta.version : undefined
  } catch {
    return undefined
  }
}

export async function conectarWhatsapp(opcoes: OpcoesWhatsapp): Promise<Whatsapp> {
  const dep = opcoes.dependencias
  const criarSocket = dep?.criarSocket ?? ((config: Record<string, unknown>) => makeWASocket(config as never) as unknown as SocketMinimo)
  const estadoDaSessao = dep?.estadoDaSessao ?? useMultiFileAuthState
  const dormir = dep?.dormir ?? dormirDeVerdade
  const agora = dep?.agora ?? Date.now
  const buscarVersao = dep ? dep.buscarVersao : fetchLatestBaileysVersion

  const { state, saveCreds } = await estadoDaSessao(opcoes.pastaSessao)

  // Versão do protocolo: busca uma vez, com prazo (a busca da biblioteca não tem nenhum e seguraria a partida).
  const version = buscarVersao ? await versaoDoProtocolo(buscarVersao, dormir) : undefined

  let socket: SocketMinimo | undefined
  let conectado = false
  let precisaParear = false
  let encerrado = false
  let reconectando = false
  /** Dentro da espera de 1 hora (muitas quedas, ou erro de sessão): um novo `close` não é queda nenhuma. */
  let emPausa = false
  /** Acorda a espera da reconexão antes da hora (só `encerrar()` chama). */
  let acordarEspera: (() => void) | null = null
  let espera = ESPERA_MINIMA
  let abertaEm: number | null = null
  let quedas: number[] = []
  let restritoAte: number | null = null
  /** Id de cada mensagem enviada → para onde foi (a recusa chega depois, com o endereço que o servidor quiser). */
  const enviadas = new Map<string, string>()
  /** As recebidas à espera do mapa de endereços; vazia, a mensagem é entregue na hora. */
  let filaDeRecebidas: Promise<void> | null = null
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

  const entregar = (recebida: MensagemRecebida | null): void => {
    if (recebida) Promise.resolve(opcoes.aoReceber(recebida)).catch(falhouAoReceber)
  }

  /** Lê a mensagem e a entrega; devolve uma promessa só quando precisou perguntar ao mapa de endereços. */
  function receber(s: SocketMinimo, m: MensagemBruta): void | Promise<void> {
    if (!precisaDoMapa(m)) return entregar(lerRecebida(m))
    const lid = m.key.remoteJid as string
    const consulta = Promise.resolve(s.signalRepository?.lidMapping?.getPNForLID(lid) ?? null)
    consulta.catch(() => {}) // se o prazo vencer e ela falhar depois, ninguém mais espera por ela
    // sem resposta no prazo, vale como "sem telefone": a mensagem se perde e a seguinte da fila segue
    return Promise.race([consulta, dormir(PRAZO_DO_MAPA_MS).then(() => null)]).then((telefone) => {
      // o mapa devolve o endereço com o aparelho (`…:0@s.whatsapp.net`); a conversa é com a pessoa
      if (telefone) entregar(lerRecebida({ ...m, key: { ...m.key, remoteJidAlt: jidNormalizedUser(telefone) } }))
    })
  }

  /** Uma por vez e na ordem de chegada: um SAIR não pode passar na frente (nem ficar atrás) do ATIVAR da mesma pessoa. */
  function enfileirar(s: SocketMinimo, m: MensagemBruta): void {
    const passo = (): void | Promise<void> => {
      try {
        return receber(s, m)
      } catch (erro) {
        // uma mensagem que dá problema não derruba as outras nem volta para a biblioteca
        falhouAoReceber(erro)
      }
    }
    const pendente = filaDeRecebidas ? filaDeRecebidas.then(passo) : passo()
    if (!pendente) return
    const vez: Promise<void> = pendente.catch(falhouAoReceber).finally(() => {
      if (filaDeRecebidas === vez) filaDeRecebidas = null
    })
    filaDeRecebidas = vez
  }

  /** Mensagem de quando o serviço estava fora do ar: só a de outra pessoa e com menos de 48 h. */
  function recenteNaFila(m: MensagemBruta): boolean {
    const segundos = segundosDe(m.messageTimestamp)
    return !m.key.fromMe && segundos !== null && agora() - segundos * 1000 < VALIDADE_DA_FILA_MS
  }

  function tratarRestricao(r: RestricaoBruta): void {
    const fim = r.timeEnforcementEnds == null ? NaN : new Date(r.timeEnforcementEnds).getTime()
    // ativa e sem prazo legível: vale até a biblioteca dizer que acabou
    const novo = r.isActive ? (Number.isFinite(fim) ? fim : Infinity) : null
    if (novo === restritoAte) return
    restritoAte = novo
    opcoes.aoRestringir?.(novo, novo === null ? 'restrição retirada' : (r.enforcementType ?? ''))
  }

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

    s.ev.on('connection.update', ((u: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string; reachoutTimeLock?: RestricaoBruta }) => {
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
      if (u.reachoutTimeLock) tratarRestricao(u.reachoutTimeLock)
      if (u.connection === 'open') {
        conectado = true
        precisaParear = false
        // a espera não volta a 5 s aqui: conexão que abre e cai em seguida continuaria batendo no WhatsApp a cada 5 s
        abertaEm = agora()
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
        // Na pausa de 1 hora um `close` repetido do mesmo socket nada acrescenta, e avisar apagaria do site o motivo da pausa.
        if (emPausa) return
        // um segundo `close` do mesmo socket, com a reconexão já marcada, não é outra queda
        if (!reconectando) {
          // sem `precisaParear`: o 500 não diz que a sessão acabou, e muitas quedas são a rede; é esperar e tentar de novo
          if (codigo === CODIGO_ERRO_DE_SESSAO) {
            pausarPorUmaHora(MOTIVO_ERRO_DE_SESSAO)
            return
          }
          const quando = agora()
          if (abertaEm !== null && quando - abertaEm >= ABERTA_PARA_ZERAR_A_ESPERA_MS) espera = ESPERA_MINIMA
          quedas = [...quedas.filter((t) => quando - t < HORA_MS), quando]
          if (quedas.length > MAXIMO_DE_QUEDAS_POR_HORA) {
            pausarPorUmaHora(MOTIVO_MUITAS_QUEDAS)
            return
          }
        }
        abertaEm = null
        opcoes.aoMudarConexao(false, `conexão perdida${codigo ? ` (${codigo})` : ''}`)
        void reconectar()
      }
    }) as (d: never) => void)

    s.ev.on('messages.upsert', ((e: { messages: MensagemBruta[]; type: string }) => {
      if (!atual()) return
      // `notify` é a mensagem que chega na hora; `append` é a que ficou na fila com o serviço fora do ar
      // (e também o eco das nossas próprias, que o `fromMe` descarta).
      if (e.type !== 'notify' && e.type !== 'append') return
      for (const m of e.messages) {
        if (e.type === 'append' && !recenteNaFila(m)) continue
        enfileirar(s, m)
      }
    }) as (d: never) => void)

    s.ev.on('messages.update', ((atualizacoes: AtualizacaoBruta[]) => {
      if (!atual()) return
      for (const a of atualizacoes) {
        const id = a.key?.id
        // a recusa do servidor chega como `status: ERROR` na mensagem que mandamos
        if (!id || a.update?.status !== WAMessageStatus.ERROR) continue
        const jid = enviadas.get(id)
        if (!jid) continue
        enviadas.delete(id)
        try {
          opcoes.aoFalharEntrega?.(jid)
        } catch (erro) {
          console.log(`[whatsapp] falha ao tratar uma recusa de mensagem: ${erro instanceof Error ? erro.name : 'erro'}`)
        }
      }
    }) as (d: never) => void)
  }

  /** Avisa e espera 1 hora antes de tentar de novo; depois da pausa a contagem de quedas e a espera recomeçam do zero. */
  function pausarPorUmaHora(motivo: string): void {
    abertaEm = null
    quedas = []
    espera = ESPERA_MINIMA
    opcoes.aoMudarConexao(false, motivo)
    void reconectar(PAUSA_POR_MUITAS_QUEDAS_MS)
  }

  /** Espera `ms`. `encerrar()` acorda a espera, e fora dos testes o timer é solto (um de 1 hora seguraria o processo). */
  function esperar(ms: number): Promise<void> {
    return new Promise<void>((resolver) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const fim = () => {
        clearTimeout(timer)
        if (acordarEspera === fim) acordarEspera = null
        resolver()
      }
      acordarEspera = fim
      if (dep?.dormir) dormir(ms).then(fim, fim)
      else timer = setTimeout(fim, ms)
    })
  }

  // Nunca dois sockets: não depende de a biblioteca emitir um só `close`.
  // `primeiraEspera` (ms) troca só a espera da 1ª tentativa; as seguintes seguem a espera crescente.
  async function reconectar(primeiraEspera?: number): Promise<void> {
    if (reconectando) return
    reconectando = true
    try {
      while (!encerrado) {
        let ms = espera
        if (primeiraEspera !== undefined) {
          ms = primeiraEspera
          primeiraEspera = undefined
          emPausa = true
        } else {
          espera = Math.min(espera * 2, ESPERA_MAXIMA)
        }
        console.log(`[whatsapp] nova tentativa de conexão em ${Math.round(ms / 1000)} s`)
        await esperar(ms)
        emPausa = false
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
      emPausa = false
    }
  }

  abrir()

  return {
    get conectado() { return conectado },
    get precisaParear() { return precisaParear },
    get restritoAte() { return restritoAte !== null && restritoAte > agora() ? restritoAte : null },

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
      const id = (await s.sendMessage(jid, { text: texto }))?.key?.id ?? null
      if (id) {
        enviadas.set(id, jid)
        if (enviadas.size > ENVIADAS_LEMBRADAS) enviadas.delete(enviadas.keys().next().value as string)
      }
      return id
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
      acordarEspera?.()
      await socket?.end(undefined)
      await gravarSessao()
    },
  }
}
