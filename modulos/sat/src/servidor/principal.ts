/**
 * Linha de comando do serviço da VM (`node locks-sat-whatsapp.mjs [modo]`). Sem argumento é o serviço
 * de verdade; os outros modos são para quem instala: parear o número, ensaiar e testar o envio.
 */
import { pathToFileURL } from 'node:url'
import { ANTECEDENCIA_JANELA_MIN } from '../logic/alertas'
import { inicioDoDiaLocal } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'
import { criarBanco } from './banco'
import { mascarar } from './comandos'
import { MINUTO_LEMBRETE, MINUTO_RESUMO } from './agenda'
import { type Dependencias, Servico } from './servico'
import { criarTrimble, janelasDeHoje } from './trimble'
import { conectarWhatsapp, type Whatsapp } from './whatsapp'

export type Modo = 'servico' | 'parear' | 'ensaio' | 'teste'

const FUSO = 'America/Cuiaba'
const ACEITOS = 'sem argumento (liga o serviço) | --parear [número] | --ensaio | --teste <número>'
const TEXTO_DO_TESTE = 'Teste do Locks SAT: o envio pelo WhatsApp está funcionando.'
const VOLTA_MS = 60_000
const ESPERA_PARA_CONECTAR_MS = 90_000
/** Depois de abrir ou de mandar, o Baileys ainda grava a sessão e entrega a mensagem: sair já perderia isso. */
const FOLGA_ANTES_DE_SAIR_MS = 3_000
const LIMITE_PARA_PARAR_MS = 15_000
const SESSAO_ENCERRADA = 'Sessão encerrada: é preciso parear de novo (ver LEIA-ME).'

export function lerArgumentos(argv: string[]): { modo: Modo; numero?: string } {
  const [primeiro, segundo, ...resto] = argv
  const invalido = () => new Error(`Argumento não reconhecido. Aceitos: ${ACEITOS}.`)
  if (primeiro === undefined) return { modo: 'servico' }
  if (resto.length > 0) throw invalido()
  if (primeiro === '--parear') return segundo === undefined ? { modo: 'parear' } : { modo: 'parear', numero: segundo }
  if (primeiro === '--teste') {
    if (segundo === undefined) throw new Error('Falta o número para o teste: --teste <número>.')
    return { modo: 'teste', numero: segundo }
  }
  if (primeiro === '--ensaio' && segundo === undefined) return { modo: 'ensaio' }
  throw invalido()
}

const lerVariavel = (env: Record<string, string | undefined>, nome: string): string => {
  const valor = env[nome]?.trim()
  // só o nome vai na mensagem: o valor pode ser a chave de serviço
  if (!valor) throw new Error(`Falta ${nome} no arquivo de ambiente (/home/locks-sat/.locks-sat-whatsapp.env).`)
  return valor
}

/** Pasta da sessão do WhatsApp: o pareamento e o teste só precisam dela, não do Supabase. */
export const pastaDaSessao = (env: Record<string, string | undefined>): string => env.LOCKS_SAT_SESSAO?.trim() || './sessao'

export function lerAmbiente(env: Record<string, string | undefined>): { url: string; chave: string; pastaSessao: string } {
  return { url: lerVariavel(env, 'SUPABASE_URL'), chave: lerVariavel(env, 'SUPABASE_SERVICE_ROLE_KEY'), pastaSessao: pastaDaSessao(env) }
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

/** O fuso que o processo realmente usa (vale também se vier do sistema, não só da variável TZ). */
const fusoDoProcesso = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

function exigirFuso(fuso: string): void {
  if (!fusoCerto(fuso)) {
    throw new Error(`O fuso do processo precisa ser ${FUSO} (TZ=${FUSO}): as janelas e os horários dos alertas dependem dele. Hoje: ${fuso}.`)
  }
}

/** O serviço de verdade: fica ligado, olha o relógio a cada minuto e atende ATIVAR/SAIR. */
async function servico(env: Record<string, string | undefined>): Promise<void> {
  exigirFuso(fusoDoProcesso())
  const { url, chave, pastaSessao } = lerAmbiente(env)
  // O Servico nasce antes da conexão (um precisa do outro): a ponte repassa para o WhatsApp assim que ele existir.
  let whatsapp: Whatsapp | null = null
  const ponte: Dependencias['whatsapp'] = {
    get conectado() { return whatsapp?.conectado ?? false },
    get precisaParear() { return whatsapp?.precisaParear ?? false },
    enviar: (jid, texto) => (whatsapp ? whatsapp.enviar(jid, texto) : Promise.reject(new Error('WhatsApp desconectado'))),
    resolverJid: (telefone) => (whatsapp ? whatsapp.resolverJid(telefone) : Promise.reject(new Error('WhatsApp desconectado'))),
  }
  const s = new Servico({ banco: criarBanco({ url, chave }), trimble: criarTrimble(), whatsapp: ponte, agora: Date.now, dormir, registrar })

  whatsapp = await conectarWhatsapp({
    pastaSessao,
    aoReceber: async (m) => {
      try { await s.recebida(m) } catch (e) { registrar(`falha ao tratar mensagem: ${mensagemDe(e)}`) }
    },
    aoMudarConexao: async (conectado, motivo) => {
      // Sem ela não há o que tentar de novo: segue vivo (e batendo o estado como desconectado) em vez de sair em laço de reinício.
      if (ponte.precisaParear) registrar(SESSAO_ENCERRADA)
      try { await s.conexao(conectado, motivo) } catch (e) { registrar(`falha ao tratar a conexão: ${mensagemDe(e)}`) }
    },
  })

  let emVolta = false
  const relogio = setInterval(() => {
    if (emVolta) return
    emVolta = true
    s.volta().catch((e) => registrar(`falha na volta: ${mensagemDe(e)}`)).finally(() => { emVolta = false })
  }, VOLTA_MS)

  let parando = false
  const parar = (sinal: string) => {
    if (parando) return
    parando = true
    clearInterval(relogio)
    registrar(`${sinal} recebido: parando o serviço`)
    setTimeout(() => process.exit(0), LIMITE_PARA_PARAR_MS).unref()
    void (async () => {
      // encerra a conexão antes de gravar: uma volta em andamento não pode regravar "conectado" depois
      try { await whatsapp?.encerrar() } catch (e) { registrar(`falha ao encerrar a conexão: ${mensagemDe(e)}`) }
      try { await s.conexao(false, 'serviço parado') } catch (e) { registrar(`não gravei o estado: ${mensagemDe(e)}`) }
      process.exit(0)
    })()
  }
  process.on('SIGTERM', () => parar('SIGTERM'))
  process.on('SIGINT', () => parar('SIGINT'))
  registrar('serviço ligado')
}

/** Mostra o QR (ou o código de 8 dígitos, se vier o número) até o celular aceitar; então escreve "Pareado.". */
async function parear(env: Record<string, string | undefined>, numero?: string): Promise<number> {
  // carregada só aqui: o serviço não precisa dela
  const modulo = await import('qrcode-terminal')
  const generate = (modulo.default ?? modulo).generate
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
      generate(qr, { small: true })
    },
    aoReceberCodigo: (codigo) => {
      const legivel = codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo
      console.log(`Código de pareamento: ${legivel}`)
      console.log('No celular: Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone, e digite o código.')
    },
    aoMudarConexao: (conectado) => {
      if (conectado) {
        console.log('Pareado.')
        terminar(0)
      } else if (whatsapp?.precisaParear) {
        console.log('A sessão guardada foi encerrada no celular. Apague a pasta da sessão e pareie de novo (ver LEIA-ME).')
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
export async function ensaio(env: Record<string, string | undefined>, fuso: string = fusoDoProcesso()): Promise<number> {
  exigirFuso(fuso)
  const { url, chave } = lerAmbiente(env)
  const trimble = criarTrimble()
  // cada quadrado é consultado uma vez só, mesmo com o relógio passando por vários horários
  const historicos = new Map<string, PontoIono[]>()
  const janelasPorCelula: Record<string, Janela[]> = {}
  let primeiraVoltaFeita = false
  const dia = inicioDoDiaLocal(Date.now())
  let agora = dia
  const servico = new Servico({
    banco: criarBanco({ url, chave }),
    trimble: {
      async historico(celula, quando) {
        const id = `${celula.lat}_${celula.lon}`
        let historico = historicos.get(id)
        if (!historico) {
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
    // a pausa entre quadrados protege a Trimble; depois da primeira rodada tudo vem da memória
    dormir: (ms) => (primeiraVoltaFeita ? Promise.resolve() : dormir(ms)),
    registrar,
    ensaio: true,
  })

  registrar('ensaio: nada é enviado nem gravado; os horários abaixo são os de hoje')
  agora = dia + 5 * 60_000 // o primeiro cálculo do dia
  await servico.volta()
  primeiraVoltaFeita = true
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
      aoMudarConexao: (conectado) => {
        if (conectado) abriu()
        else if (whatsapp?.precisaParear) falhou(new Error(SESSAO_ENCERRADA))
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

// Só roda quando é o programa chamado (o teste importa este arquivo sem ligar nada).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2))
    .then((codigo) => { if (codigo !== undefined) process.exit(codigo) })
    .catch((e) => {
      console.error(`Erro: ${mensagemDe(e)}`)
      process.exit(1)
    })
}
