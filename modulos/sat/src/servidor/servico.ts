/**
 * O laço do serviço: a cada minuto decide o que mandar e a quem. É aqui que uma mensagem sai (ou
 * não) para uma pessoa, então a ordem das coisas importa: o envio é reservado no banco ANTES de
 * mandar, e se a reserva não vale (já existia, ou o banco falhou) a mensagem não sai.
 */
import { chaveData, dataCurta, DIA_MS, HORA_MS, horaDe, minutoDoDia } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'
import { chaveDoAntes, chaveEvento, eventosFixosNaHora, janelaDoAntes, MINUTOS_DE_CALCULO, precisaCalcular, ultimoMarcoDeCalculo } from './agenda'
import type { Banco } from './banco'
import { type Comando, chaveDoNumero, lerComando, mascarar, mesmoNumero } from './comandos'
import { fazendasDoContato, montarMensagem, textoAtivado, textoDoEvento, textoSaiu } from './mensagens'
import { ContadorDoDia, pausaEntrePessoas, pausaEntreRespostas } from './ritmo'
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
/** Uma rodada de cálculo insiste (a cada 5 min) durante este tempo: é a tolerância de atraso do evento. */
const INSISTENCIA_NA_TRIMBLE_MS = HORA_MS
/** Passada a insistência sem resposta, a Trimble é consultada só uma vez por hora (até o próximo horário de cálculo). */
const NOVA_TENTATIVA_LENTA_TRIMBLE_MS = HORA_MS
const PAUSA_ENTRE_QUADRADOS_MS = 2_000
/** `enviar` e `resolverJid` podem ficar pendurados; sem prazo travariam o laço para sempre. */
export const PRAZO_DO_WHATSAPP_MS = 60_000
/** 00:05: a primeira volta depois disso, a cada dia, apaga os envios antigos. */
const MINUTO_DA_LIMPEZA = MINUTOS_DE_CALCULO[0]
const MAX_RESPOSTAS_POR_PESSOA_POR_DIA = 2
/** O WhatsApp recusar tantas mensagens seguidas é sinal de conta restrita: insistir piora. */
const MAX_RECUSAS_SEGUIDAS = 3
const ERRO_TETO_DO_DIA = 'teto diário de mensagens atingido'
const ERRO_SEM_WHATSAPP = 'número sem WhatsApp'
const ERRO_PEDIU_PARA_SAIR = 'pediu para sair'
const ERRO_RESTRICAO = 'WhatsApp restringiu os envios'
const ERRO_RECUSAS = `WhatsApp recusou ${MAX_RECUSAS_SEGUIDAS} mensagens seguidas`
const ESTOUROU = Symbol('prazo estourado')

/** Os avisos que o site mostra em `ultimo_erro`, na ordem em que aparecem quando há mais de um. */
const TIPOS_DE_AVISO = ['restricao', 'recusas', 'teto', 'trimble'] as const
type TipoAviso = typeof TIPOS_DE_AVISO[number]
const ENTRE_AVISOS = ' · '

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

/** As falhas seguidas da Trimble desde um horário de cálculo (`marco`): cada horário abre uma contagem nova. */
interface FalhasDaTrimble { marco: number; primeira: number; ultima: number }

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
  private falhasDaTrimble: FalhasDaTrimble | null = null
  /** A primeira falha da Trimble desde o último cálculo que deu certo: é o "desde" do aviso. */
  private semTrimbleDesde: number | null = null
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
  private ensaioExplicado = false
  /** Números que o WhatsApp disse não existir, no dia: perguntar de novo todo minuto parece robô. */
  private semWhatsapp = { dia: '', telefones: new Set<string>() }
  private readonly respostas = new Map<string, { dia: string; n: number }>()
  /** As mensagens recebidas são tratadas uma por vez, na ordem de chegada: esta é a ponta da fila. */
  private filaDeRecebidas: Promise<void> = Promise.resolve()
  private ultimaResposta: { em: number; pausa: number } | null = null
  /** Até quando o WhatsApp restringiu os envios da conta (`Infinity` = sem prazo informado). */
  private restritoAte: number | null = null
  private recusasSeguidas = 0
  private recusaDesdeOUltimoEnvio = false
  /** O dia em que as recusas seguidas pararam os envios (até o dia seguinte). */
  private diaDasRecusas = ''
  private readonly avisos = new Map<TipoAviso, string>()
  /** O que está gravado em `ultimo_erro`; `undefined` = não se sabe (uma gravação falhou, ou está lá o motivo de uma queda). */
  private avisoGravado: string | null | undefined = null

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
      await this.vencerAvisos(agora)
      await this.limparUmaVezPorDia(agora)
      await this.calcularSePreciso(agora)
      const janelas = this.janelas
      // Janelas de outro dia não valem: dizem "hoje" sobre o que foi medido antes. As calculadas
      // às 00:05 servem para o resumo das 07:00 mesmo que o cálculo das 07:00 falhe, porque a
      // consulta cobre sempre os mesmos 7 dias inteiros antes de hoje.
      const valida = janelas !== null && chaveData(janelas.calculadoEm) === chaveData(agora)
      if (this.d.ensaio && valida && !this.ensaioExplicado) await this.explicarEnsaio(janelas)
      // Sem conexão (ou com o WhatsApp recusando) não se reserva nada: o evento continua valendo, dentro da tolerância, quando voltar.
      const podeEnviar = this.d.ensaio || (this.d.whatsapp.conectado && this.bloqueio() === null)
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

  /**
   * Mensagem recebida de alguém: ATIVAR ou SAIR de contato cadastrado. Entra numa fila (uma é tratada
   * por vez, na ordem de chegada): SAIR e ATIVAR da mesma pessoa não disputam a gravação.
   */
  async recebida(m: MensagemRecebida): Promise<void> {
    // Qualquer outro texto é ignorado sem nem ir ao banco, e nenhum texto recebido vai ao registro.
    const comando = lerComando(m.texto)
    if (!comando) return
    const quem = mascarar(numeroDoJid(m.jid))
    if (this.d.ensaio) {
      this.registrar(`ensaio: comando de ${quem} ignorado`)
      return
    }
    // Marcado de forma síncrona, na chegada e antes de entrar na fila: uma volta que comece agora,
    // ou uma falha ao gravar, não pode deixar quem pediu para parar receber mais um alerta.
    const numero = chaveDoNumero(m.jid)
    if (numero) {
      if (comando === 'sair') this.pausados.add(numero)
      else this.pausados.delete(numero)
    }
    const vez = this.filaDeRecebidas.then(() => this.tratar(m, comando, numero, quem))
    // a fila segue mesmo que uma mensagem dê erro
    this.filaDeRecebidas = vez.catch(() => {})
    await vez
  }

  /** O WhatsApp restringiu os envios da conta até `ate` (ms; `Infinity` = sem prazo), ou retirou a restrição (`null`). */
  async restricao(ate: number | null, motivo: string): Promise<void> {
    if (this.d.ensaio) return
    if (ate === null || ate <= this.d.agora()) {
      if (this.restritoAte === null) return
      this.restritoAte = null
      this.registrar('o WhatsApp retirou a restrição de envios')
      await this.avisar('restricao', null)
      return
    }
    // posto antes de qualquer espera: um envio que está para sair agora já enxerga
    this.restritoAte = ate
    const texto = `${ERRO_RESTRICAO} até ${Number.isFinite(ate) ? `${dataCurta(ate)} ${horaDe(ate)}` : 'novo aviso'}`
    this.registrar(`${texto}${motivo ? ` (${motivo})` : ''}: nada sai até lá`)
    await this.avisar('restricao', texto)
  }

  /** O WhatsApp recusou uma mensagem que o serviço mandou. Três seguidas param os envios até o dia seguinte. */
  async falhaDeEntrega(jid: string): Promise<void> {
    if (this.d.ensaio) return
    this.recusasSeguidas += 1
    this.recusaDesdeOUltimoEnvio = true
    this.registrar(`o WhatsApp recusou a mensagem para ${mascarar(numeroDoJid(jid))} (${this.recusasSeguidas} seguida(s))`)
    const hoje = chaveData(this.d.agora())
    if (this.recusasSeguidas < MAX_RECUSAS_SEGUIDAS || this.diaDasRecusas === hoje) return
    this.diaDasRecusas = hoje
    const texto = `${ERRO_RECUSAS}: envios parados até amanhã`
    this.registrar(texto)
    await this.avisar('recusas', texto)
  }

  /** Estado da conexão mudou. */
  async conexao(conectado: boolean, motivo?: string): Promise<void> {
    this.registrar(`WhatsApp ${conectado ? 'conectado' : 'desconectado'}${motivo ? `: ${motivo}` : ''}`)
    if (this.d.ensaio) return
    // conectado, o que vale são os avisos ativos; desconectado, o motivo da queda
    const ultimoErro = conectado ? this.textoDosAvisos() : (motivo ? semNumeros(motivo) : null)
    try {
      await this.d.banco.gravarEstado({ conectado, desde: new Date(this.d.agora()).toISOString(), ultimoErro })
      this.avisoGravado = conectado ? ultimoErro : undefined
    } catch (e) {
      this.avisoGravado = undefined
      this.registrar(`não gravei o estado da conexão: ${mensagemDe(e)}`)
    }
  }

  /** Todo registro passa por aqui: nunca sai número de telefone inteiro. */
  private registrar(linha: string): void {
    this.d.registrar(semNumeros(linha))
  }

  private async tratar(m: MensagemRecebida, comando: Comando, numero: string | null, quem: string): Promise<void> {
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

  private textoDosAvisos(): string | null {
    const textos = TIPOS_DE_AVISO.flatMap((tipo) => this.avisos.get(tipo) ?? [])
    return textos.length ? textos.join(ENTRE_AVISOS) : null
  }

  /**
   * Liga (com o texto) ou desliga (`null`) um aviso. O `ultimo_erro` do estado leva sempre a junção
   * dos avisos ativos, ou `null` sem nenhum: um aviso que entra ou sai não apaga os outros.
   */
  private async avisar(tipo: TipoAviso, texto: string | null): Promise<void> {
    if (texto === null) this.avisos.delete(tipo)
    else this.avisos.set(tipo, semNumeros(texto))
    await this.gravarAvisos()
  }

  /** Grava a junção dos avisos se ela mudou (ou se a gravação anterior falhou); chamada também a cada volta. */
  private async gravarAvisos(): Promise<void> {
    if (this.d.ensaio) return
    const texto = this.textoDosAvisos()
    if (texto === this.avisoGravado) return
    // desconectado, o `ultimo_erro` é o motivo da queda: os avisos entram quando a conexão voltar
    if (!this.d.whatsapp.conectado) return
    try {
      await this.d.banco.gravarEstado({ conectado: true, ultimoErro: texto })
      this.avisoGravado = texto
    } catch (e) {
      this.registrar(`não gravei o aviso do serviço: ${mensagemDe(e)}`)
    }
  }

  /** O que impede qualquer envio agora (alerta ou resposta), ou `null`. */
  private bloqueio(): string | null {
    const agora = this.d.agora()
    if (this.restritoAte !== null && agora < this.restritoAte) return ERRO_RESTRICAO
    if (this.diaDasRecusas === chaveData(agora)) return ERRO_RECUSAS
    return null
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

  /** Avisos com prazo: o de teto e o de recusas valem só no dia; o de restrição, até a hora que o WhatsApp deu. */
  private async vencerAvisos(agora: number): Promise<void> {
    const hoje = chaveData(agora)
    if (this.diaDoAvisoDeTeto && this.diaDoAvisoDeTeto !== hoje) {
      this.diaDoAvisoDeTeto = ''
      this.avisos.delete('teto')
    }
    if (this.diaDasRecusas && this.diaDasRecusas !== hoje) {
      this.diaDasRecusas = ''
      this.recusasSeguidas = 0
      this.recusaDesdeOUltimoEnvio = false
      this.avisos.delete('recusas')
    }
    if (this.restritoAte !== null && agora >= this.restritoAte) {
      this.restritoAte = null
      this.avisos.delete('restricao')
      this.registrar('venceu o prazo da restrição de envios do WhatsApp')
    }
    await this.gravarAvisos()
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
    const marco = ultimoMarcoDeCalculo(agora)
    // Cada horário de cálculo abre uma rodada nova: volta a insistir a cada 5 min.
    const falhas = this.falhasDaTrimble?.marco === marco ? this.falhasDaTrimble : null
    if (falhas) {
      const insistiu = falhas.ultima - falhas.primeira >= INSISTENCIA_NA_TRIMBLE_MS
      if (agora - falhas.ultima < (insistiu ? NOVA_TENTATIVA_LENTA_TRIMBLE_MS : NOVA_TENTATIVA_TRIMBLE_MS)) return
    }
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
      const primeira = falhas?.primeira ?? agora
      this.falhasDaTrimble = { marco, primeira, ultima: agora }
      this.semTrimbleDesde ??= agora
      this.registrar(`Trimble: ${mensagemDe(e)}`)
      // passou a tolerância do evento sem dados: o site precisa saber, e as tentativas rareiam
      if (agora - primeira >= INSISTENCIA_NA_TRIMBLE_MS) {
        const desde = this.semTrimbleDesde
        const quando = chaveData(desde) === dia ? horaDe(desde) : `${dataCurta(desde)} ${horaDe(desde)}`
        await this.avisar('trimble', `Sem dados da Trimble desde ${quando}: alertas parados até ela voltar`)
      }
      return
    }
    this.janelas = { calculadoEm: agora, porCelula: rodada.respondidos }
    this.fazendas = rodada.fazendas
    this.rodada = null
    this.falhasDaTrimble = null
    this.semTrimbleDesde = null
    this.registrar(`janelas calculadas para ${rodada.quadrados.size} quadrado(s)`)
    await this.avisar('trimble', null)
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
    if (!this.d.ensaio && (!this.d.whatsapp.conectado || this.bloqueio() !== null)) return 'parar'
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
    await this.avisar('teto', ERRO_TETO_DO_DIA)
  }

  /** Espera a chamada ao WhatsApp, no máximo `PRAZO_DO_WHATSAPP_MS` (o relógio é o `dormir` injetado). */
  private async comPrazo<T>(chamada: Promise<T>): Promise<T> {
    chamada.catch(() => {}) // se o prazo vencer e ela falhar depois, ninguém mais espera por ela
    const r = await Promise.race([chamada, this.d.dormir(PRAZO_DO_WHATSAPP_MS).then(() => ESTOUROU)])
    if (r === ESTOUROU) throw new PrazoEstourado()
    return r as T
  }

  /** Todo envio (alerta ou resposta) passa por aqui: é onde a sequência de recusas do WhatsApp é contada. */
  private async enviar(jid: string, texto: string): Promise<void> {
    // nenhuma recusa chegou desde a mensagem anterior: ela foi aceita, e a sequência recomeça
    if (!this.recusaDesdeOUltimoEnvio) this.recusasSeguidas = 0
    this.recusaDesdeOUltimoEnvio = false
    await this.comPrazo(this.d.whatsapp.enviar(jid, texto))
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

    // Última conferência, colada no envio: enquanto o endereço era resolvido e o envio reservado
    // pode ter chegado o SAIR da pessoa (ou a restrição do WhatsApp). Na dúvida, não manda.
    const impedimento = this.estaPausado(contato) ? ERRO_PEDIU_PARA_SAIR : this.bloqueio()
    if (impedimento !== null) {
      entrada.situacao = 'pulado'
      this.registrar(`${quem}: ${tipo} não enviado: ${impedimento}`)
      await this.fechar(contato.id, chave, quem, 'pulado', impedimento)
      return false
    }

    try {
      await this.enviar(jid, montarMensagem(tipo, contato, texto, this.d.agora(), comSair))
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

  private async fechar(contatoId: string, chave: string, quem: string, situacao: 'enviado' | 'falhou' | 'pulado', erro?: string): Promise<void> {
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
    const mensagem = montarMensagem(tipo, contato, texto, this.d.agora(), comSair).replaceAll('\n', ' / ')
    this.registrar(`ensaio: enviaria ${tipo} a ${mascarar(contato.telefone)}: ${mensagem}`)
  }

  /**
   * Só no ensaio, uma vez: por que cada contato NÃO receberia, e as fazendas que nenhum contato
   * alcança (a não ser os de "todas"). É o que explica um ensaio que não mostra ninguém.
   */
  private async explicarEnsaio(janelas: JanelasCalculadas): Promise<void> {
    const contatos = await this.d.banco.contatos()
    this.ensaioExplicado = true
    const fazendas = this.fazendas ?? []
    const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR')
    for (const c of [...contatos].sort((a, b) => porNome(a.nome, b.nome))) {
      const motivos: string[] = []
      if (!c.ativo) motivos.push('inativo')
      if (!c.alertaJanela) motivos.push('sem Janela de risco')
      if (!c.confirmadoEm) motivos.push('aguardando ATIVAR')
      const temJanela = fazendasDoContato(c, fazendas).some((f) => (janelas.porCelula[f.celulaId as string] ?? []).length > 0)
      if (!motivos.length && !temJanela) motivos.push('sem janela nas fazendas dele hoje')
      if (motivos.length) this.registrar(`ensaio: ${mascarar(c.telefone)} não receberia: ${motivos.join(', ')}`)
    }
    const semVinculo = fazendas.filter((f) => f.celulaId && f.coaId == null).map((f) => f.nome).sort(porNome)
    if (semVinculo.length) {
      this.registrar(`ensaio: Fazendas sem vínculo com o COA WEB (não entram em contato nenhum que não seja "todas"): ${semVinculo.join(', ')}`)
    }
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
    if (this.bloqueio() !== null) {
      // o comando já valeu; com o WhatsApp recusando, nada sai
      this.registrar(`${quem}: ${this.bloqueio()}, não respondi`)
      return
    }
    if (!this.contador.podeMensagem()) {
      await this.avisarTetoDoDia()
      return
    }
    this.respostas.set(contato.id, { dia, n: feitas + 1 })
    // Entre uma resposta e a próxima passa um tempo ao acaso (um lote de ATIVAR chega de uma vez só).
    if (this.ultimaResposta) {
      const passou = this.d.agora() - this.ultimaResposta.em
      if (passou >= 0 && passou < this.ultimaResposta.pausa) {
        await this.d.dormir(this.ultimaResposta.pausa - passou)
        // passou tempo: a restrição pode ter chegado
        if (this.bloqueio() !== null) return
      }
    }
    try {
      await this.enviar(jid, texto)
      this.contador.contar(null)
      this.ultimaResposta = { em: this.d.agora(), pausa: pausaEntreRespostas() }
    } catch (e) {
      this.registrar(`${quem}: não consegui responder: ${mensagemDe(e)}`)
    }
  }
}
