/**
 * O laço do serviço: a cada minuto decide o que mandar e a quem. É aqui que uma mensagem sai (ou
 * não) para uma pessoa, então a ordem das coisas importa: o envio é reservado no banco ANTES de
 * mandar, e se a reserva não vale (já existia, ou o banco falhou) a mensagem não sai.
 */
import { chaveData, DIA_MS, minutoDoDia } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'
import { chaveDoAntes, chaveEvento, eventosFixosNaHora, janelaDoAntes, MINUTOS_DE_CALCULO, precisaCalcular } from './agenda'
import type { Banco } from './banco'
import { chaveDoNumero, lerComando, mascarar, mesmoNumero } from './comandos'
import { fazendasDoContato, montarMensagem, textoAtivado, textoDoEvento, textoSaiu } from './mensagens'
import { ContadorDoDia, pausaEntrePessoas } from './ritmo'
import type { ContatoWpp, FazendaServidor, JanelasCalculadas, SituacaoEnvio, TipoEvento } from './tipos'
import { janelasDeHoje } from './trimble'
import type { MensagemRecebida, Whatsapp } from './whatsapp'

export interface Dependencias {
  banco: Banco
  trimble: { historico(celula: { lat: number; lon: number }, agora: number): Promise<PontoIono[]> }
  whatsapp: Pick<Whatsapp, 'conectado' | 'precisaParear' | 'enviar' | 'resolverJid'>
  agora: () => number
  dormir: (ms: number) => Promise<void>
  /** Escreve uma linha no registro (sem número inteiro, sem texto de mensagem recebida). */
  registrar: (linha: string) => void
  /** Ensaio: calcula e registra o que enviaria, sem reservar, sem enviar e sem gravar. */
  ensaio?: boolean
}

const BATIMENTO_MS = 5 * 60_000
/** A Trimble recusa quem insiste: depois de uma falha, só tenta de novo passado este tempo. */
const NOVA_TENTATIVA_TRIMBLE_MS = 5 * 60_000
const PAUSA_ENTRE_QUADRADOS_MS = 2_000
/** `enviar` e `resolverJid` podem ficar pendurados; sem prazo travariam o laço para sempre. */
export const PRAZO_DO_WHATSAPP_MS = 60_000
/** 00:05: a primeira volta depois disso, a cada dia, apaga os envios antigos. */
const MINUTO_DA_LIMPEZA = MINUTOS_DE_CALCULO[0]
const MAX_RESPOSTAS_POR_PESSOA_POR_DIA = 2
const ERRO_TETO_DO_DIA = 'teto diário de mensagens atingido'
const ERRO_SEM_WHATSAPP = 'número sem WhatsApp'
const ESTOUROU = Symbol('prazo estourado')

class PrazoEstourado extends Error {
  constructor() {
    super(`sem resposta do WhatsApp em ${PRAZO_DO_WHATSAPP_MS / 1000} s`)
  }
}

interface Reservada { contatoId: string; chave: string; situacao: SituacaoEnvio }

/** Um cálculo das janelas, que pode levar mais de uma tentativa: o que já respondeu não se consulta de novo. */
interface Rodada {
  dia: string
  fazendas: FazendaServidor[]
  quadrados: Map<string, { lat: number; lon: number }>
  respondidos: Record<string, Janela[]>
}

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Os dígitos do número que vem num endereço do WhatsApp (sem servidor nem aparelho). */
const numeroDoJid = (jid: string) => jid.split('@')[0].split(':')[0]

/** Troca todo número de telefone inteiro (55 + DDD + número, 12 ou 13 dígitos) pelos 4 últimos dígitos. */
export function semNumeros(texto: string): string {
  return texto.replace(/(?<!\d)55\d{10,11}(?!\d)/g, (n) => `…${n.slice(-4)}`)
}

export class Servico {
  private readonly d: Dependencias
  private readonly contador: ContadorDoDia
  private janelas: JanelasCalculadas | null = null
  /** As fazendas lidas junto do cálculo das janelas: a geometria dos talhões é pesada demais para reler a cada minuto. */
  private fazendas: FazendaServidor[] | null = null
  private rodada: Rodada | null = null
  private falhaDoCalculoEm: number | null = null
  private ultimoBatimento: number | null = null
  private diaDaLimpeza = ''
  private diaDoAvisoDeTeto = ''
  private emVolta = false
  private semeado = false
  /**
   * Números (`chaveDoNumero`) de quem mandou SAIR e cuja pausa o banco ainda não mostrou: ninguém
   * marcado recebe nada. A marca só sai quando a leitura do banco já traz `ativo === false` ou
   * quando a mesma pessoa manda ATIVAR.
   */
  private readonly pausados = new Set<string>()
  /** Só no ensaio: o que já foi registrado, para não repetir a cada minuto. */
  private readonly ensaiados = new Set<string>()
  /** Números que o WhatsApp disse não existir, no dia: perguntar de novo todo minuto parece robô. */
  private semWhatsapp = { dia: '', telefones: new Set<string>() }
  private readonly respostas = new Map<string, { dia: string; n: number }>()

  constructor(d: Dependencias) {
    this.d = d
    this.contador = new ContadorDoDia(d.agora)
  }

  /** Uma volta do laço: calcula se precisa, manda o que está na hora, grava o batimento a cada 5 min. */
  async volta(): Promise<void> {
    if (this.emVolta) return
    this.emVolta = true
    try {
      const agora = this.d.agora()
      await this.bater(agora)
      await this.limparAvisoDeTeto(agora)
      await this.limparUmaVezPorDia(agora)
      await this.calcularSePreciso(agora)
      const janelas = this.janelas
      // Janelas de outro dia não valem: dizem "hoje" sobre o que foi medido antes. As calculadas
      // às 00:05 servem para o resumo das 07:00 mesmo que o cálculo das 07:00 falhe, porque a
      // consulta cobre sempre os mesmos 7 dias inteiros antes de hoje. A nova tentativa segue a
      // cada 5 min, sem limite, para o evento seguinte poder sair.
      const valida = janelas !== null && chaveData(janelas.calculadoEm) === chaveData(agora)
      // Sem conexão não se reserva nada: o evento continua valendo, dentro da tolerância, quando voltar.
      const podeEnviar = this.d.ensaio || this.d.whatsapp.conectado
      if (valida && podeEnviar && this.algoNaHora(agora, janelas)) {
        await this.enviarEventos(agora, janelas)
      } else if (this.pausados.size && !this.d.ensaio) {
        await this.reconciliarPausados(await this.d.banco.contatos())
      }
    } catch (e) {
      this.registrar(`falha na volta: ${mensagemDe(e)}`)
    } finally {
      this.emVolta = false
    }
  }

  /** Mensagem recebida de alguém: ATIVAR ou SAIR de contato cadastrado. */
  async recebida(m: MensagemRecebida): Promise<void> {
    // Qualquer outro texto é ignorado sem nem ir ao banco, e nenhum texto recebido vai ao registro.
    const comando = lerComando(m.texto)
    if (!comando) return
    const quem = mascarar(numeroDoJid(m.jid))
    if (this.d.ensaio) {
      this.registrar(`ensaio: comando de ${quem} ignorado`)
      return
    }
    // Marcado de forma síncrona, antes de qualquer espera: uma volta que comece agora, ou uma
    // falha ao gravar, não pode deixar quem pediu para parar receber mais um alerta.
    const numero = chaveDoNumero(m.jid)
    if (numero) {
      if (comando === 'sair') this.pausados.add(numero)
      else this.pausados.delete(numero)
    }
    try {
      const contato = (await this.d.banco.contatos()).find((c) => mesmoNumero(c.telefone, m.jid))
      if (!contato) {
        if (numero) this.pausados.delete(numero)
        this.registrar(`comando de número não cadastrado (${quem}) ignorado`)
        return
      }
      let resposta: string
      if (comando === 'ativar') {
        await this.d.banco.confirmar(contato.id, m.jid)
        let nomes: string[] = []
        try {
          const fazendas = this.fazendas ?? await this.d.banco.fazendas()
          nomes = [...new Set(fazendasDoContato(contato, fazendas).map((f) => f.nome))]
        } catch (e) {
          // o contato já está confirmado; a resposta só fica sem a lista de fazendas
          this.registrar(`${quem}: não li as fazendas para a resposta: ${mensagemDe(e)}`)
        }
        resposta = textoAtivado(contato, nomes)
        this.registrar(`ativado: ${mascarar(contato.telefone)}`)
      } else {
        await this.d.banco.pausar(contato.id)
        resposta = textoSaiu(contato)
        this.registrar(`pausado: ${mascarar(contato.telefone)}`)
      }
      await this.responder(contato, m.jid, quem, resposta)
    } catch (e) {
      // se foi SAIR, a marca fica: a próxima volta tenta gravar a pausa de novo
      this.registrar(`falha ao tratar mensagem de ${quem}: ${mensagemDe(e)}`)
    }
  }

  /** Estado da conexão mudou. */
  async conexao(conectado: boolean, motivo?: string): Promise<void> {
    this.registrar(`WhatsApp ${conectado ? 'conectado' : 'desconectado'}${motivo ? `: ${motivo}` : ''}`)
    if (this.d.ensaio) return
    try {
      await this.d.banco.gravarEstado({
        conectado,
        desde: new Date(this.d.agora()).toISOString(),
        ultimoErro: conectado || !motivo ? null : semNumeros(motivo),
      })
    } catch (e) {
      this.registrar(`não gravei o estado da conexão: ${mensagemDe(e)}`)
    }
  }

  /** Todo registro passa por aqui: nunca sai número de telefone inteiro. */
  private registrar(linha: string): void {
    this.d.registrar(semNumeros(linha))
  }

  private async bater(agora: number): Promise<void> {
    if (this.d.ensaio) return
    if (this.ultimoBatimento !== null && agora - this.ultimoBatimento < BATIMENTO_MS) return
    try {
      await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado })
      this.ultimoBatimento = agora
    } catch (e) {
      this.registrar(`não gravei o batimento: ${mensagemDe(e)}`)
    }
  }

  /** O aviso de teto de um dia não pode ficar no estado no dia seguinte. */
  private async limparAvisoDeTeto(agora: number): Promise<void> {
    if (this.d.ensaio || !this.diaDoAvisoDeTeto || this.diaDoAvisoDeTeto === chaveData(agora)) return
    // desconectado, o `ultimoErro` já é outro (o motivo da queda): fica para quando voltar
    if (!this.d.whatsapp.conectado) return
    try {
      await this.d.banco.gravarEstado({ conectado: true, ultimoErro: null })
      this.diaDoAvisoDeTeto = ''
    } catch (e) {
      this.registrar(`não limpei o aviso de teto: ${mensagemDe(e)}`)
    }
  }

  private async limparUmaVezPorDia(agora: number): Promise<void> {
    const dia = chaveData(agora)
    if (this.d.ensaio || this.diaDaLimpeza === dia || minutoDoDia(agora) < MINUTO_DA_LIMPEZA) return
    this.diaDaLimpeza = dia // marcado antes: se falhar, tenta amanhã e não a cada minuto
    try {
      await this.d.banco.limparEnviosAntigos()
    } catch (e) {
      this.registrar(`não limpei os envios antigos: ${mensagemDe(e)}`)
    }
  }

  private async calcularSePreciso(agora: number): Promise<void> {
    if (!precisaCalcular(agora, this.janelas?.calculadoEm ?? null)) return
    if (this.falhaDoCalculoEm !== null && agora - this.falhaDoCalculoEm < NOVA_TENTATIVA_TRIMBLE_MS) return
    const dia = chaveData(agora)
    // A consulta cobre os 7 dias inteiros antes de hoje: dentro do mesmo dia, o que já respondeu vale.
    if (!this.rodada || this.rodada.dia !== dia) {
      const fazendas = await this.d.banco.fazendas()
      const quadrados = new Map<string, { lat: number; lon: number }>()
      for (const f of fazendas) if (f.celulaId && f.lat != null && f.lon != null) quadrados.set(f.celulaId, { lat: f.lat, lon: f.lon })
      this.rodada = { dia, fazendas, quadrados, respondidos: {} }
    }
    const rodada = this.rodada
    try {
      let primeiro = true
      for (const [id, celula] of rodada.quadrados) {
        if (id in rodada.respondidos) continue
        if (!primeiro) await this.d.dormir(PAUSA_ENTRE_QUADRADOS_MS)
        primeiro = false
        rodada.respondidos[id] = janelasDeHoje(await this.d.trimble.historico(celula, agora))
      }
    } catch (e) {
      // as janelas que já temos ficam como estão, e os quadrados que responderam não se consultam de novo
      this.falhaDoCalculoEm = agora
      this.registrar(`Trimble: ${mensagemDe(e)}`)
      return
    }
    this.janelas = { calculadoEm: agora, porCelula: rodada.respondidos }
    this.fazendas = rodada.fazendas
    this.rodada = null
    this.falhaDoCalculoEm = null
    this.registrar(`janelas calculadas para ${rodada.quadrados.size} quadrado(s)`)
  }

  /** Evita ler contatos e envios (o banco) a cada minuto do dia: só quando há um evento a considerar. */
  private algoNaHora(agora: number, janelas: JanelasCalculadas): boolean {
    if (eventosFixosNaHora(agora).length) return true
    return Object.values(janelas.porCelula).some((js) => janelaDoAntes(js, agora) !== null)
  }

  private async enviarEventos(agora: number, janelas: JanelasCalculadas): Promise<void> {
    const fazendas = this.fazendas ?? []
    // O "antes" de madrugada tem a chave da noite anterior: as de ontem também contam.
    const [contatos, deOntem, deHoje] = await Promise.all([
      this.d.banco.contatos(),
      this.d.banco.chavesDoDia(chaveData(agora - DIA_MS)),
      this.d.banco.chavesDoDia(chaveData(agora)),
    ])
    if (!this.semeado) {
      // depois de um reinício o teto do dia não pode zerar: conta o que já foi reservado hoje
      for (const r of deHoje) this.contador.contar(r.contatoId)
      this.semeado = true
    }
    const jaReservadas: Reservada[] = [...deOntem, ...deHoje]
    await this.reconciliarPausados(contatos)
    const aptos = contatos
      .filter((c) => c.ativo && c.alertaJanela && c.confirmadoEm)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    const tipos: TipoEvento[] = [...eventosFixosNaHora(agora), 'antes']
    let tentouAlgum = false
    for (const tipo of tipos) {
      const chave = tipo === 'antes' ? chaveDoAntes(agora) : chaveEvento(agora, tipo)
      for (const contato of aptos) {
        if (jaReservadas.some((r) => r.contatoId === contato.id && r.chave === chave)) continue
        let pronto = await this.preparar(tipo, contato, fazendas, janelas)
        if (pronto === 'parar') return
        if (pronto === null) continue
        if (tentouAlgum && !this.d.ensaio) {
          await this.d.dormir(pausaEntrePessoas())
          // passou tempo (e a pessoa pode ter mandado SAIR, o WhatsApp cair, o teto estourar): confere tudo de novo
          pronto = await this.preparar(tipo, contato, fazendas, janelas)
          if (pronto === 'parar') return
          if (pronto === null) continue
        }
        if (this.d.ensaio) this.ensaiar(contato, tipo, chave, pronto, jaReservadas)
        else if (await this.mandar(contato, tipo, chave, pronto, jaReservadas)) tentouAlgum = true
      }
    }
  }

  /**
   * Quem mandou SAIR e o banco ainda mostra ativo: tenta gravar a pausa de novo (uma vez por volta).
   * Quem o banco já mostra inativo: a marca cumpriu o papel e sai.
   */
  private async reconciliarPausados(contatos: ContatoWpp[]): Promise<void> {
    for (const c of contatos) {
      const numero = chaveDoNumero(c.telefone)
      if (!numero || !this.pausados.has(numero)) continue
      if (!c.ativo) {
        this.pausados.delete(numero)
        continue
      }
      try {
        await this.d.banco.pausar(c.id)
      } catch (e) {
        this.registrar(`${mascarar(c.telefone)}: não gravei a pausa: ${mensagemDe(e)}`)
      }
    }
  }

  private estaPausado(contato: ContatoWpp): boolean {
    const numero = chaveDoNumero(contato.telefone)
    return numero !== null && this.pausados.has(numero)
  }

  /** O texto a mandar a este contato agora; `null` = nada para ele; `'parar'` = nada mais sai nesta volta. */
  private async preparar(tipo: TipoEvento, contato: ContatoWpp, fazendas: FazendaServidor[], janelas: JanelasCalculadas): Promise<string | null | 'parar'> {
    if (!this.d.ensaio && !this.d.whatsapp.conectado) return 'parar'
    if (this.estaPausado(contato)) return null
    // o "antes" depende da hora de agora, não da de quando a volta começou
    const texto = textoDoEvento(tipo, contato, fazendas, janelas.porCelula, this.d.agora())
    if (!texto) return null
    if (this.contador.podeAlerta(contato.id)) return texto
    if (this.contador.podeMensagem()) return null // só esta pessoa já atingiu o teto
    await this.avisarTetoDoDia()
    return 'parar'
  }

  private async avisarTetoDoDia(): Promise<void> {
    const dia = chaveData(this.d.agora())
    if (this.diaDoAvisoDeTeto === dia) return
    this.diaDoAvisoDeTeto = dia
    this.registrar(`${ERRO_TETO_DO_DIA}: nada mais sai hoje`)
    if (this.d.ensaio) return
    try {
      await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado, ultimoErro: ERRO_TETO_DO_DIA })
    } catch (e) {
      this.registrar(`não gravei o aviso de teto: ${mensagemDe(e)}`)
    }
  }

  /** Espera a chamada ao WhatsApp, no máximo `PRAZO_DO_WHATSAPP_MS` (o relógio é o `dormir` injetado). */
  private async comPrazo<T>(chamada: Promise<T>): Promise<T> {
    chamada.catch(() => {}) // se o prazo vencer e ela falhar depois, ninguém mais espera por ela
    const r = await Promise.race([chamada, this.d.dormir(PRAZO_DO_WHATSAPP_MS).then(() => ESTOUROU)])
    if (r === ESTOUROU) throw new PrazoEstourado()
    return r as T
  }

  private numerosSemWhatsapp(): Set<string> {
    const dia = chaveData(this.d.agora())
    if (this.semWhatsapp.dia !== dia) this.semWhatsapp = { dia, telefones: new Set() }
    return this.semWhatsapp.telefones
  }

  /** `true` se tentou mandar (deu certo ou não): é o que pede a pausa antes da próxima pessoa. */
  private async mandar(contato: ContatoWpp, tipo: TipoEvento, chave: string, texto: string, jaReservadas: Reservada[]): Promise<boolean> {
    const quem = mascarar(contato.telefone)
    const hoje = chaveData(this.d.agora())
    // a linha do SAIR vai na primeira mensagem que a pessoa de fato recebe no dia
    const comSair = !jaReservadas.some((r) => r.contatoId === contato.id && r.situacao === 'enviado' && r.chave.startsWith(`${hoje}:`))
    let jid = contato.jid
    let entrada: Reservada
    try {
      if (!jid) {
        const semWhatsapp = this.numerosSemWhatsapp()
        let achado: string | null = null
        let falhou: string | null = null
        if (semWhatsapp.has(contato.telefone)) {
          falhou = ERRO_SEM_WHATSAPP
        } else {
          try {
            achado = await this.comPrazo(this.d.whatsapp.resolverJid(contato.telefone))
          } catch (e) {
            if (!(e instanceof PrazoEstourado)) throw e
            falhou = e.message
          }
          if (achado === null && falhou === null) {
            semWhatsapp.add(contato.telefone)
            falhou = ERRO_SEM_WHATSAPP
          }
        }
        if (falhou !== null || achado === null) {
          // fica registrado para este evento (e não se pergunta de novo ao WhatsApp)
          const erro = falhou ?? ERRO_SEM_WHATSAPP
          if (await this.d.banco.reservarEnvio(contato.id, chave, tipo)) {
            jaReservadas.push({ contatoId: contato.id, chave, situacao: 'falhou' })
            await this.fechar(contato.id, chave, quem, 'falhou', erro)
            this.registrar(`${quem}: ${erro}`)
          }
          return false
        }
        jid = achado
        try {
          await this.d.banco.guardarJid(contato.id, jid)
        } catch (e) {
          this.registrar(`${quem}: não guardei o endereço: ${mensagemDe(e)}`) // só atalho: manda assim mesmo
        }
      }
      // reservar ANTES de mandar: se não reservou, não manda
      const reservou = await this.d.banco.reservarEnvio(contato.id, chave, tipo)
      entrada = { contatoId: contato.id, chave, situacao: 'enviando' }
      jaReservadas.push(entrada)
      if (!reservou) return false
    } catch (e) {
      this.registrar(`${quem}: não mandei ${tipo}: ${mensagemDe(e)}`)
      return false
    }

    try {
      await this.comPrazo(this.d.whatsapp.enviar(jid, montarMensagem(contato, texto, this.d.agora(), comSair)))
    } catch (e) {
      this.registrar(`${quem}: falha ao enviar ${tipo}: ${mensagemDe(e)}`)
      entrada.situacao = 'falhou'
      await this.fechar(contato.id, chave, quem, 'falhou', mensagemDe(e))
      return true
    }
    // contado e anotado antes das chamadas ao banco, que podem lançar
    this.contador.contar(contato.id)
    entrada.situacao = 'enviado'
    this.registrar(`enviado ${tipo} a ${quem}`)
    await this.fechar(contato.id, chave, quem, 'enviado')
    try {
      await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado, ultimoEnvioEm: new Date(this.d.agora()).toISOString() })
    } catch (e) {
      this.registrar(`não gravei o último envio: ${mensagemDe(e)}`)
    }
    return true
  }

  private async fechar(contatoId: string, chave: string, quem: string, situacao: 'enviado' | 'falhou', erro?: string): Promise<void> {
    try {
      await this.d.banco.fecharEnvio(contatoId, chave, situacao, erro === undefined ? undefined : semNumeros(erro))
    } catch (e) {
      this.registrar(`${quem}: não fechei o envio: ${mensagemDe(e)}`)
    }
  }

  private ensaiar(contato: ContatoWpp, tipo: TipoEvento, chave: string, texto: string, jaReservadas: Reservada[]): void {
    const marca = `${contato.id}|${chave}`
    if (this.ensaiados.has(marca)) return
    const prefixoDoDia = `${contato.id}|${chave.split(':')[0]}:`
    const comSair = !jaReservadas.some((r) => r.contatoId === contato.id && r.situacao === 'enviado') && ![...this.ensaiados].some((m) => m.startsWith(prefixoDoDia))
    this.ensaiados.add(marca)
    const mensagem = montarMensagem(contato, texto, this.d.agora(), comSair).replaceAll('\n', ' / ')
    this.registrar(`ensaio: enviaria ${tipo} a ${mascarar(contato.telefone)}: ${mensagem}`)
  }

  /** Resposta a ATIVAR/SAIR: no máximo 2 por pessoa por dia, respeita o teto do dia e conta nele. */
  private async responder(contato: ContatoWpp, jid: string, quem: string, texto: string): Promise<void> {
    const dia = chaveData(this.d.agora())
    const anterior = this.respostas.get(contato.id)
    const feitas = anterior && anterior.dia === dia ? anterior.n : 0
    if (feitas >= MAX_RESPOSTAS_POR_PESSOA_POR_DIA) {
      // o comando já valeu; só a resposta fica de fora (mensagens repetidas ou reentregues esgotariam o teto)
      this.registrar(`${quem}: limite de respostas do dia, não respondi`)
      return
    }
    if (!this.contador.podeMensagem()) {
      await this.avisarTetoDoDia()
      return
    }
    this.respostas.set(contato.id, { dia, n: feitas + 1 })
    try {
      await this.comPrazo(this.d.whatsapp.enviar(jid, texto))
      this.contador.contar(null)
    } catch (e) {
      this.registrar(`${quem}: não consegui responder: ${mensagemDe(e)}`)
    }
  }
}
