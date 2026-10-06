/**
 * Linha de comando do serviço da VM (`node locks-sat-whatsapp.mjs [modo]`). Sem argumento é o serviço
 * de verdade; os outros modos são para quem instala: parear o número, ensaiar e testar o envio.
 */
import { readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ANTECEDENCIA_JANELA_MIN } from '../logic/alertas'
import { inicioDoDiaLocal } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'
import { type Banco, criarBanco } from './banco'
import { mascarar } from './comandos'
import { MINUTO_LEMBRETE, MINUTO_RESUMO } from './agenda'
import { type Dependencias, PRAZO_DAS_GRAVACOES_MS, PRAZO_DO_WHATSAPP_MS, semNumeros, Servico } from './servico'
import { criarTrimble, janelasDeHoje } from './trimble'
import { conectarWhatsapp, type OpcoesWhatsapp, type Whatsapp } from './whatsapp'

export type Modo = 'servico' | 'parear' | 'ensaio' | 'teste'

const FUSO = 'America/Cuiaba'
const ACEITOS = 'sem argumento (liga o serviço) | --parear [número] | --ensaio | --teste <número>'
const TEXTO_DO_TESTE = 'Teste do Locks SAT: o envio pelo WhatsApp está funcionando.'
const VOLTA_MS = 60_000
const ESPERA_PARA_CONECTAR_MS = 90_000
/** Depois de abrir ou de mandar, o Baileys ainda grava a sessão e entrega a mensagem: sair já perderia isso. */
const FOLGA_ANTES_DE_SAIR_MS = 3_000
/** Parando, o serviço espera a volta em curso (um envio já reservado tem de sair) no máximo isto. */
const LIMITE_DA_VOLTA_MS = 20_000
/** Depois da volta: fechar a conexão e gravar o estado não podem segurar a parada para sempre. */
const LIMITE_PARA_ENCERRAR_MS = 15_000
const PAUSA_DA_TRIMBLE_NO_ENSAIO_MS = 2_000
const AINDA_NAO_PAREADO = 'Ainda não pareado: rode o pareamento (ver LEIA-ME).'
const SESSAO_ENCERRADA = 'Sessão encerrada: é preciso parear de novo (ver LEIA-ME).'
/** O motivo que o `whatsapp.ts` dá à única queda que se resolve pareando de novo. */
const MOTIVO_SESSAO_ENCERRADA = 'sessão encerrada no celular'

const FORMATO_DO_NUMERO = /^55[1-9][1-9]\d{8,9}$/
/** O número que o guia e os testes usam de exemplo; a faixa recusada é ele com qualquer último dígito. */
const NUMERO_DE_EXEMPLO = '5565999990001'

/** Quem cola o comando do guia sem trocar o número não pode mandar mensagem (nem pedir código) para um estranho. */
function conferirNumero(numero: string): string {
  if (numero.slice(0, -1) === NUMERO_DE_EXEMPLO.slice(0, -1)) throw new Error('Esse é o número de exemplo: troque pelo número de verdade.')
  // o que foi digitado não vai na mensagem
  if (!FORMATO_DO_NUMERO.test(numero)) throw new Error('Número fora do formato: use só dígitos, com 55 e DDD na frente.')
  return numero
}

export function lerArgumentos(argv: string[]): { modo: Modo; numero?: string } {
  const [primeiro, segundo, ...resto] = argv
  const invalido = () => new Error(`Argumento não reconhecido. Aceitos: ${ACEITOS}.`)
  if (primeiro === undefined) return { modo: 'servico' }
  if (resto.length > 0) throw invalido()
  if (primeiro === '--parear') return segundo === undefined ? { modo: 'parear' } : { modo: 'parear', numero: conferirNumero(segundo) }
  if (primeiro === '--teste') {
    if (segundo === undefined) throw new Error('Falta o número para o teste: --teste <número>.')
    return { modo: 'teste', numero: conferirNumero(segundo) }
  }
  if (primeiro === '--ensaio' && segundo === undefined) return { modo: 'ensaio' }
  throw invalido()
}

// Nenhuma mensagem daqui cita o valor: a chave pode ter sido colada na linha errada, e o erro vai para o registro.
const lerVariavel = (env: Record<string, string | undefined>, nome: string, formato: RegExp, foraDoFormato: string): string => {
  const valor = (env[nome] ?? '').trim().replace(/^["']+|["']+$/g, '').trim()
  if (!valor) throw new Error(`Falta ${nome} no arquivo de ambiente (/home/locks-sat/.locks-sat-whatsapp.env).`)
  if (!formato.test(valor)) throw new Error(foraDoFormato)
  return valor
}

/** Pasta da sessão do WhatsApp: o pareamento e o teste só precisam dela, não do Supabase. */
export const pastaDaSessao = (env: Record<string, string | undefined>): string => env.LOCKS_SAT_SESSAO?.trim() || './sessao'

export function lerAmbiente(env: Record<string, string | undefined>): { url: string; chave: string; pastaSessao: string } {
  return {
    url: lerVariavel(env, 'SUPABASE_URL', /^https:\/\/[a-z0-9.-]+$/, 'SUPABASE_URL não parece um endereço https://… do Supabase'),
    chave: lerVariavel(env, 'SUPABASE_SERVICE_ROLE_KEY', /^[A-Za-z0-9._-]{20,}$/, 'SUPABASE_SERVICE_ROLE_KEY tem caracteres que uma chave não tem'),
    pastaSessao: pastaDaSessao(env),
  }
}

/**
 * Já existe sessão pareada? Sem ela, conectar só geraria QR que ninguém vê. Existir o `creds.json` não basta:
 * a biblioteca o grava assim que começa, e o pareamento por código põe nele o `me` (e depois o `registered`)
 * antes de o celular aceitar. Conta registrada é a que tem `account`, que só chega junto do aceite; o
 * `registered` não serve de prova porque fica `false` para sempre em quem pareou por QR.
 */
export function sessaoPareada(pastaSessao: string): boolean {
  try {
    const creds = JSON.parse(readFileSync(join(pastaSessao, 'creds.json'), 'utf8')) as { me?: { id?: unknown } | null; account?: unknown } | null
    return typeof creds?.me?.id === 'string' && creds.me.id !== '' && typeof creds.account === 'object' && creds.account !== null
  } catch {
    // sem arquivo, ou gravado pela metade
    return false
  }
}

/**
 * Sobra de um pareamento que não terminou: o pareamento por código grava a sessão antes de o celular
 * aceitar, e com ela a tentativa seguinte entraria como uma conta que não existe e seria recusada.
 * Sessão pareada de verdade nunca é tocada. Devolve se apagou alguma coisa.
 */
export function limparPareamentoIncompleto(pastaSessao: string): boolean {
  if (sessaoPareada(pastaSessao)) return false
  let apagou = false
  try {
    for (const nome of readdirSync(pastaSessao)) {
      rmSync(join(pastaSessao, nome), { recursive: true, force: true })
      apagou = true
    }
  } catch {
    // a pasta ainda não existe: não há o que apagar
  }
  return apagou
}

export const fusoCerto = (tz: string | undefined): boolean => tz === FUSO

/** `AAAA-MM-DDTHH:MM:SS` na hora local do processo, e a linha. */
export function linhaDeRegistro(agora: number, linha: string): string {
  const d = new Date(agora)
  const dois = (n: number) => String(n).padStart(2, '0')
  const dia = `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
  return `${dia}T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())} ${linha}`
}

/** Minutos do dia que o ensaio percorre: 07:00, 12:00 e o "antes" de cada janela de hoje. */
export function horariosDoEnsaio(porCelula: Record<string, Janela[]>): number[] {
  const minutos = new Set([MINUTO_RESUMO, MINUTO_LEMBRETE])
  for (const janelas of Object.values(porCelula)) for (const j of janelas) minutos.add(Math.max(0, j.inicio - ANTECEDENCIA_JANELA_MIN))
  return [...minutos].sort((a, b) => a - b)
}

const registrar = (linha: string): void => console.log(linhaDeRegistro(Date.now(), linha))
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Para erro que ninguém previu: a mensagem pode trazer qualquer coisa, o nome não. */
const nomeDoErro = (e: unknown) => (e instanceof Error ? e.name : 'erro')

/** O que dizer de uma queda em que a conexão não é tentada de novo: só a sessão encerrada pede novo pareamento. */
const quedaSemVolta = (motivo: string | undefined, complemento = ''): string => (
  !motivo || motivo === MOTIVO_SESSAO_ENCERRADA
    ? SESSAO_ENCERRADA
    : `O WhatsApp fechou a conexão (${motivo})${complemento}: ver "Se algo der errado" no LEIA-ME.`
)

/** O fuso que o processo realmente usa (vale também se vier do sistema, não só da variável TZ). */
const fusoDoProcesso = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

function exigirFuso(fuso: string): void {
  if (!fusoCerto(fuso)) {
    throw new Error(`O fuso do processo precisa ser ${FUSO} (TZ=${FUSO}): as janelas e os horários dos alertas dependem dele. Hoje: ${fuso}.`)
  }
}

/** O que o serviço usa do mundo de fora. No programa é tudo de verdade; os testes trocam por falsos. */
export interface PecasDoServico {
  banco: Banco
  trimble: Dependencias['trimble']
  conectar: (opcoes: OpcoesWhatsapp) => Promise<Whatsapp>
  pastaSessao: string
  /** Já existe sessão pareada na pasta? */
  pareado: () => boolean
  registrar: (linha: string) => void
  sair: (codigo: number) => void
  /** O `process`: sinais de parada e erros que ninguém tratou. */
  processo: { on(evento: string, ouvinte: (valor: unknown) => void): unknown }
}

/** O serviço de verdade: fica ligado, olha o relógio a cada minuto e atende ATIVAR/SAIR. Não termina sozinho. */
export async function ligarServico(p: PecasDoServico): Promise<void> {
  let whatsapp: Whatsapp | null = null
  let conectando = false
  let parando = false
  let relogio: ReturnType<typeof setInterval> | undefined
  let voltaEmCurso: Promise<void> | null = null
  /** As esperas do Servico que a parada interrompe (a pausa entre duas pessoas chega a 45 s). */
  const acordar = new Set<() => void>()

  const dormirDoServico = (ms: number): Promise<void> => {
    // O prazo de uma chamada já feita ao WhatsApp não é interrompido: acordá-lo daria por falho um envio que ainda vai chegar.
    // O da espera pelas gravações, na própria parada, também não: acordado (`parando` já é verdadeiro) deixaria de esperar.
    if (ms === PRAZO_DO_WHATSAPP_MS || ms === PRAZO_DAS_GRAVACOES_MS) return dormir(ms)
    if (parando) return Promise.resolve()
    return new Promise<void>((resolver) => {
      const fim = () => {
        clearTimeout(prazo)
        acordar.delete(fim)
        resolver()
      }
      const prazo = setTimeout(fim, ms)
      acordar.add(fim)
    })
  }

  // O Servico nasce antes da conexão (um precisa do outro): a ponte repassa para o WhatsApp assim que ele existir.
  // Parando, ela responde "desconectado": o Servico confere isso antes de cada pessoa e não começa outro envio.
  // O envio que já passou dessa conferência segue pela conexão de verdade, que só fecha depois dele.
  const ponte: Dependencias['whatsapp'] = {
    get conectado() { return !parando && (whatsapp?.conectado ?? false) },
    get precisaParear() { return whatsapp?.precisaParear ?? false },
    enviar: (jid, texto) => (whatsapp ? whatsapp.enviar(jid, texto) : Promise.reject(new Error('WhatsApp desconectado'))),
    resolverJid: (telefone) => (whatsapp ? whatsapp.resolverJid(telefone) : Promise.reject(new Error('WhatsApp desconectado'))),
  }
  const s = new Servico({
    banco: p.banco,
    // com as esperas interrompidas, um cálculo em curso consultaria os quadrados que faltam sem pausa nenhuma
    trimble: { historico: (celula, agora) => (parando ? Promise.reject(new Error('serviço parando')) : p.trimble.historico(celula, agora)) },
    whatsapp: ponte,
    agora: () => Date.now(),
    dormir: dormirDoServico,
    registrar: p.registrar,
  })

  async function conectar(): Promise<void> {
    conectando = true
    try {
      const nova = await p.conectar({
        pastaSessao: p.pastaSessao,
        aoReceber: async (m) => {
          try { await s.recebida(m) } catch (e) { p.registrar(`falha ao tratar mensagem: ${mensagemDe(e)}`) }
        },
        aoMudarConexao: async (conectado, motivo) => {
          // parando, o estado que vale é o "serviço parado" gravado no fim
          if (parando) return
          // Sem ela não há o que tentar de novo: segue vivo (e batendo o estado como desconectado) em vez de sair em laço de reinício.
          if (ponte.precisaParear) p.registrar(quedaSemVolta(motivo, ' e o serviço não tenta de novo sozinho'))
          try { await s.conexao(conectado, motivo) } catch (e) { p.registrar(`falha ao tratar a conexão: ${mensagemDe(e)}`) }
        },
        aoRestringir: (ate, motivo) => {
          s.restricao(ate, motivo).catch((e) => p.registrar(`falha ao tratar a restrição: ${mensagemDe(e)}`))
        },
        aoFalharEntrega: (jid) => {
          s.falhaDeEntrega(jid).catch((e) => p.registrar(`falha ao tratar a recusa: ${mensagemDe(e)}`))
        },
      })
      if (parando) await nova.encerrar()
      else whatsapp = nova
    } finally {
      conectando = false
    }
  }

  const parar = (sinal: string): void => {
    if (parando) {
      p.registrar(`${sinal} de novo: saindo sem esperar`)
      p.sair(1)
      return
    }
    parando = true
    clearInterval(relogio)
    p.registrar(`${sinal} recebido: parando o serviço`)
    for (const fim of [...acordar]) fim()
    void (async () => {
      if (voltaEmCurso) await Promise.race([voltaEmCurso, dormir(LIMITE_DA_VOLTA_MS)])
      const teto = setTimeout(() => p.sair(0), LIMITE_PARA_ENCERRAR_MS)
      teto.unref()
      // um SAIR que o WhatsApp já deu como entregue tem de chegar ao banco; as respostas pendentes não se esperam
      try { await s.aguardarGravacoes(PRAZO_DAS_GRAVACOES_MS) } catch (e) { p.registrar(`falha ao esperar as gravações: ${mensagemDe(e)}`) }
      // encerra a conexão antes de gravar: nada mais pode regravar "conectado" depois
      try { await whatsapp?.encerrar() } catch (e) { p.registrar(`falha ao encerrar a conexão: ${mensagemDe(e)}`) }
      try { await s.conexao(false, 'serviço parado') } catch (e) { p.registrar(`não gravei o estado: ${mensagemDe(e)}`) }
      clearTimeout(teto)
      p.sair(0)
    })()
  }
  p.processo.on('SIGTERM', () => parar('SIGTERM'))
  p.processo.on('SIGINT', () => parar('SIGINT'))
  // Um erro que escapou não pode virar queda em laço (cada queda é uma reconexão ao WhatsApp), nem levar texto de fora ao registro.
  p.processo.on('unhandledRejection', (e) => p.registrar(`erro não tratado: ${nomeDoErro(e)}`))
  p.processo.on('uncaughtException', (e) => {
    p.registrar(`erro não tratado: ${nomeDoErro(e)}`)
    p.sair(1)
  })

  if (p.pareado()) {
    await conectar()
  } else {
    p.registrar(AINDA_NAO_PAREADO)
    await s.conexao(false, 'ainda não pareado')
  }
  if (parando) return

  relogio = setInterval(() => {
    // a sessão apareceu (alguém pareou com o serviço ligado): conecta
    if (!whatsapp && !conectando && p.pareado()) conectar().catch((e) => p.registrar(`falha ao conectar: ${mensagemDe(e)}`))
    if (voltaEmCurso) return
    voltaEmCurso = s.volta()
      .catch((e) => p.registrar(`falha na volta: ${mensagemDe(e)}`))
      .finally(() => { voltaEmCurso = null })
  }, VOLTA_MS)
  p.registrar('serviço ligado')
}

async function servico(env: Record<string, string | undefined>): Promise<void> {
  exigirFuso(fusoDoProcesso())
  const { url, chave, pastaSessao } = lerAmbiente(env)
  await ligarServico({
    banco: criarBanco({ url, chave }),
    trimble: criarTrimble(),
    conectar: conectarWhatsapp,
    pastaSessao,
    pareado: () => sessaoPareada(pastaSessao),
    registrar,
    sair: (codigo) => process.exit(codigo),
    processo: process,
  })
}

/**
 * O desenhador do QR no terminal. A biblioteca lê `this.error` dentro de `generate`: chamada solta
 * (`const generate = lib.generate`), ela quebra com "bad rs block" — foi o que aconteceu no primeiro
 * pareamento na VM. Por isso a chamada é sempre pelo objeto.
 */
export async function desenhadorDeQr(): Promise<(qr: string) => void> {
  // carregada só aqui: o serviço não precisa dela
  const modulo = await import('qrcode-terminal')
  const biblioteca = modulo.default ?? modulo
  return (qr) => biblioteca.generate(qr, { small: true })
}

/** Mostra o QR (ou o código de 8 dígitos, se vier o número) até o celular aceitar; então escreve "Pareado.". */
async function parear(env: Record<string, string | undefined>, numero?: string): Promise<number> {
  const desenharQr = await desenhadorDeQr()
  if (limparPareamentoIncompleto(pastaDaSessao(env))) console.log('Apaguei a sobra de uma tentativa de pareamento que não terminou.')
  let whatsapp: Whatsapp | undefined
  let terminar: (codigo: number) => void = () => {}
  const fim = new Promise<number>((r) => { terminar = r })
  whatsapp = await conectarWhatsapp({
    pastaSessao: pastaDaSessao(env),
    numeroParaCodigo: numero,
    aoReceber: () => {},
    aoPedirQr: (qr) => {
      if (numero) return
      console.log('No celular do COA: WhatsApp → Aparelhos conectados → Conectar um aparelho, e leia o código abaixo.')
      desenharQr(qr)
    },
    aoReceberCodigo: (codigo) => {
      const legivel = codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo
      console.log(`Código de pareamento: ${legivel}`)
      console.log('No celular: Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone, e digite o código.')
    },
    aoMudarConexao: (conectado, motivo) => {
      if (conectado) {
        console.log('Pareado.')
        terminar(0)
      } else if (whatsapp?.precisaParear) {
        console.log(!motivo || motivo === MOTIVO_SESSAO_ENCERRADA
          ? 'A sessão guardada foi encerrada no celular. Apague a pasta da sessão e pareie de novo (ver LEIA-ME).'
          : quedaSemVolta(motivo))
        terminar(1)
      }
    },
  })
  const codigo = await fim
  await dormir(FOLGA_ANTES_DE_SAIR_MS)
  await whatsapp.encerrar()
  return codigo
}

/** Percorre o dia de hoje (07:00, 12:00 e o "antes" das janelas) com dados reais e escreve o que enviaria. Não conecta ao WhatsApp e não grava nada. */
export async function ensaio(
  env: Record<string, string | undefined>,
  fuso: string = fusoDoProcesso(),
  pausa: (ms: number) => Promise<void> = dormir,
): Promise<number> {
  exigirFuso(fuso)
  const { url, chave } = lerAmbiente(env)
  const trimble = criarTrimble()
  // cada quadrado é consultado uma vez só, mesmo com o relógio passando por vários horários
  const historicos = new Map<string, PontoIono[]>()
  const janelasPorCelula: Record<string, Janela[]> = {}
  let jaConsultou = false
  const dia = inicioDoDiaLocal(Date.now())
  let agora = dia
  const servico = new Servico({
    banco: criarBanco({ url, chave }),
    trimble: {
      async historico(celula, quando) {
        const id = `${celula.lat}_${celula.lon}`
        let historico = historicos.get(id)
        if (!historico) {
          // A pausa que protege a Trimble fica aqui, e não no `dormir` do Servico: vale para toda consulta
          // de verdade (também a nova tentativa de um quadrado que falhou) e nunca para o que vem da memória.
          if (jaConsultou) await pausa(PAUSA_DA_TRIMBLE_NO_ENSAIO_MS)
          jaConsultou = true
          historico = await trimble.historico(celula, quando)
          historicos.set(id, historico)
          janelasPorCelula[id] = janelasDeHoje(historico)
        }
        return historico
      },
    },
    whatsapp: {
      conectado: true,
      precisaParear: false,
      enviar: () => Promise.reject(new Error('o ensaio não envia')),
      resolverJid: () => Promise.reject(new Error('o ensaio não consulta o WhatsApp')),
    },
    agora: () => agora,
    // no ensaio o Servico só dorme entre quadrados, e essa pausa é feita acima, junto da consulta
    dormir: () => Promise.resolve(),
    registrar,
    ensaio: true,
  })

  registrar('ensaio: nada é enviado nem gravado; os horários abaixo são os de hoje')
  agora = dia + 5 * 60_000 // o primeiro cálculo do dia
  await servico.volta()
  for (const minuto of horariosDoEnsaio(janelasPorCelula)) {
    agora = dia + minuto * 60_000
    registrar(`ensaio: ${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`)
    await servico.volta()
  }
  registrar('ensaio: fim')
  return 0
}

/** Manda uma mensagem de teste a um número e encerra. Não lê nem grava nada no banco. */
async function teste(env: Record<string, string | undefined>, numero: string): Promise<number> {
  let whatsapp: Whatsapp | undefined
  let abriu: () => void = () => {}
  let falhou: (e: Error) => void = () => {}
  const aberta = new Promise<void>((res, rej) => { abriu = res; falhou = rej })
  aberta.catch(() => {}) // a falha é tratada no `await aberta`; isto só evita aviso se ela vier antes
  const prazo = setTimeout(() => falhou(new Error('Não conectei ao WhatsApp em 90 segundos. Se o número ainda não foi pareado, pareie primeiro (ver LEIA-ME).')), ESPERA_PARA_CONECTAR_MS)
  try {
    whatsapp = await conectarWhatsapp({
      pastaSessao: pastaDaSessao(env),
      aoReceber: () => {},
      aoMudarConexao: (conectado, motivo) => {
        if (conectado) abriu()
        else if (whatsapp?.precisaParear) falhou(new Error(quedaSemVolta(motivo)))
      },
    })
    await aberta
    const jid = await whatsapp.resolverJid(numero)
    if (!jid) throw new Error(`O número ${mascarar(numero)} não tem WhatsApp.`)
    await whatsapp.enviar(jid, TEXTO_DO_TESTE)
    console.log(`Enviado para ${mascarar(numero)}`)
    await dormir(FOLGA_ANTES_DE_SAIR_MS)
  } finally {
    clearTimeout(prazo)
    await whatsapp?.encerrar()
  }
  return 0
}

/** Código de saída do programa; `undefined` no serviço, que não termina sozinho. */
export async function principal(argv: string[], env: Record<string, string | undefined> = process.env): Promise<number | undefined> {
  const { modo, numero } = lerArgumentos(argv)
  if (modo === 'parear') return parear(env, numero)
  if (modo === 'ensaio') return ensaio(env)
  if (modo === 'teste') return teste(env, numero as string)
  await servico(env)
  return undefined
}

type ConsoleDoProcesso = Pick<Console, 'log' | 'error' | 'info' | 'warn' | 'debug' | 'trace'>

/**
 * As bibliotecas escrevem direto no console, sem passar pelo nosso registro. A do protocolo do
 * WhatsApp despeja a sessão inteira de uma conversa, com as chaves, a cada "Closing session" — e no
 * serviço a saída vai para o journal. Daqui em diante só sai texto: `info`, `warn`, `debug` e `trace`
 * ficam mudos (é por eles que as bibliotecas falam); `log` e `error` continuam, mas nunca imprimem
 * objeto, e número de telefone sai mascarado.
 */
export function calarBibliotecas(alvo: ConsoleDoProcesso = console): void {
  const soTexto = (original: (...partes: unknown[]) => void) => (...partes: unknown[]): void => {
    original(semNumeros(partes.map((p) => (typeof p === 'string' ? p : '[omitido]')).join(' ')))
  }
  alvo.log = soTexto(alvo.log.bind(alvo))
  alvo.error = soTexto(alvo.error.bind(alvo))
  const mudo = (): void => {}
  alvo.info = mudo
  alvo.warn = mudo
  alvo.debug = mudo
  alvo.trace = mudo
}

/** Este módulo é o arquivo que o `node` foi chamado para rodar? Compara o caminho de verdade: chamado por link simbólico também conta. */
export function rodandoComoPrograma(urlDoModulo: string, chamado: string | undefined): boolean {
  if (!chamado) return false
  try {
    return urlDoModulo === pathToFileURL(realpathSync(chamado)).href
  } catch {
    return false
  }
}

// Só roda quando é o programa chamado (o teste importa este arquivo sem ligar nada).
if (rodandoComoPrograma(import.meta.url, process.argv[1])) {
  calarBibliotecas()
  principal(process.argv.slice(2))
    .then((codigo) => { if (codigo !== undefined) process.exit(codigo) })
    .catch((e) => {
      console.error(`Erro: ${mensagemDe(e)}`)
      process.exit(1)
    })
}
