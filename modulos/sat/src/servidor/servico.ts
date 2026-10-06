/**
 * O laço do serviço: a cada minuto decide o que mandar e a quem. É aqui que uma mensagem sai (ou
 * não) para uma pessoa, então a ordem das coisas importa: o envio é reservado no banco ANTES de
 * mandar, e se a reserva não vale (já existia, ou o banco falhou) a mensagem não sai.
 */
import { chaveData, minutoDoDia } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'
import { chaveEvento, eventosFixosNaHora, janelaDoAntes, MINUTOS_DE_CALCULO, precisaCalcular } from './agenda'
import type { Banco } from './banco'
import { lerComando, mascarar, mesmoNumero } from './comandos'
import { fazendasDoContato, montarMensagem, textoAtivado, textoDoEvento, textoSaiu } from './mensagens'
import { ContadorDoDia, pausaEntrePessoas } from './ritmo'
import type { ContatoWpp, FazendaServidor, JanelasCalculadas, TipoEvento } from './tipos'
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
/** 00:05: a primeira volta depois disso, a cada dia, apaga os envios antigos. */
const MINUTO_DA_LIMPEZA = MINUTOS_DE_CALCULO[0]
const ERRO_TETO_DO_DIA = 'teto diário de mensagens atingido'
const ERRO_SEM_WHATSAPP = 'número sem WhatsApp'

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Os dígitos do número que vem num endereço do WhatsApp (sem servidor nem aparelho). */
const numeroDoJid = (jid: string) => jid.split('@')[0].split(':')[0]

export class Servico {
  private readonly d: Dependencias
  private readonly contador: ContadorDoDia
  private janelas: JanelasCalculadas | null = null
  private falhaDoCalculoEm: number | null = null
  private ultimoBatimento: number | null = null
  private diaDaLimpeza = ''
  private diaDoAvisoDeTeto = ''
  private emVolta = false
  /** Quem mandou SAIR enquanto uma volta rodava: a lista de contatos dela já estava lida. */
  private readonly pausados = new Set<string>()
  /** Só no ensaio: o que já foi registrado, para não repetir a cada minuto. */
  private readonly ensaiados = new Set<string>()

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
      await this.limparUmaVezPorDia(agora)
      await this.calcularSePreciso(agora)
      if (!this.janelas) return
      // Sem conexão não se reserva nada: o evento continua valendo, dentro da tolerância, quando voltar.
      if (!this.d.ensaio && !this.d.whatsapp.conectado) return
      const tipos: TipoEvento[] = [...eventosFixosNaHora(agora), 'antes']
      if (!this.algoNaHora(agora, this.janelas)) return
      await this.enviarEventos(agora, tipos, this.janelas)
    } catch (e) {
      this.d.registrar(`falha na volta: ${mensagemDe(e)}`)
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
      this.d.registrar(`ensaio: comando de ${quem} ignorado`)
      return
    }
    try {
      const contato = (await this.d.banco.contatos()).find((c) => mesmoNumero(c.telefone, m.jid))
      if (!contato) {
        this.d.registrar(`comando de número não cadastrado (${quem}) ignorado`)
        return
      }
      let resposta: string
      if (comando === 'ativar') {
        await this.d.banco.confirmar(contato.id, m.jid)
        this.pausados.delete(contato.id)
        let nomes: string[] = []
        try {
          nomes = [...new Set(fazendasDoContato(contato, await this.d.banco.fazendas()).map((f) => f.nome))]
        } catch (e) {
          // o contato já está confirmado; a resposta só fica sem a lista de fazendas
          this.d.registrar(`${quem}: não li as fazendas para a resposta: ${mensagemDe(e)}`)
        }
        resposta = textoAtivado(contato, nomes)
        this.d.registrar(`ativado: ${mascarar(contato.telefone)}`)
      } else {
        // marcado antes de gravar: uma volta em andamento não pode mandar mais nada a quem pediu para parar
        this.pausados.add(contato.id)
        await this.d.banco.pausar(contato.id)
        resposta = textoSaiu(contato)
        this.d.registrar(`pausado: ${mascarar(contato.telefone)}`)
      }
      await this.responder(m.jid, quem, resposta)
    } catch (e) {
      this.d.registrar(`falha ao tratar mensagem de ${quem}: ${mensagemDe(e)}`)
    }
  }

  /** Estado da conexão mudou. */
  async conexao(conectado: boolean, motivo?: string): Promise<void> {
    this.d.registrar(`WhatsApp ${conectado ? 'conectado' : 'desconectado'}${motivo ? `: ${motivo}` : ''}`)
    if (this.d.ensaio) return
    try {
      await this.d.banco.gravarEstado({ conectado, desde: new Date(this.d.agora()).toISOString(), ultimoErro: conectado ? null : (motivo ?? null) })
    } catch (e) {
      this.d.registrar(`não gravei o estado da conexão: ${mensagemDe(e)}`)
    }
  }

  private async bater(agora: number): Promise<void> {
    if (this.d.ensaio) return
    if (this.ultimoBatimento !== null && agora - this.ultimoBatimento < BATIMENTO_MS) return
    try {
      await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado })
      this.ultimoBatimento = agora
    } catch (e) {
      this.d.registrar(`não gravei o batimento: ${mensagemDe(e)}`)
    }
  }

  private async limparUmaVezPorDia(agora: number): Promise<void> {
    const dia = chaveData(agora)
    if (this.d.ensaio || this.diaDaLimpeza === dia || minutoDoDia(agora) < MINUTO_DA_LIMPEZA) return
    this.diaDaLimpeza = dia // marcado antes: se falhar, tenta amanhã e não a cada minuto
    try {
      await this.d.banco.limparEnviosAntigos()
    } catch (e) {
      this.d.registrar(`não limpei os envios antigos: ${mensagemDe(e)}`)
    }
  }

  private async calcularSePreciso(agora: number): Promise<void> {
    if (!precisaCalcular(agora, this.janelas?.calculadoEm ?? null)) return
    if (this.falhaDoCalculoEm !== null && agora - this.falhaDoCalculoEm < NOVA_TENTATIVA_TRIMBLE_MS) return
    const fazendas = await this.d.banco.fazendas()
    const quadrados = new Map<string, { lat: number; lon: number }>()
    for (const f of fazendas) if (f.celulaId && f.lat != null && f.lon != null) quadrados.set(f.celulaId, { lat: f.lat, lon: f.lon })
    const porCelula: Record<string, Janela[]> = {}
    try {
      let primeiro = true
      for (const [id, celula] of quadrados) {
        if (!primeiro) await this.d.dormir(PAUSA_ENTRE_QUADRADOS_MS)
        primeiro = false
        porCelula[id] = janelasDeHoje(await this.d.trimble.historico(celula, agora))
      }
    } catch (e) {
      // as janelas boas que já temos ficam como estão
      this.falhaDoCalculoEm = agora
      this.d.registrar(`Trimble: ${mensagemDe(e)}`)
      return
    }
    this.janelas = { calculadoEm: agora, porCelula }
    this.falhaDoCalculoEm = null
    this.d.registrar(`janelas calculadas para ${quadrados.size} quadrado(s)`)
  }

  /** Evita ler contatos e fazendas (o banco) a cada minuto do dia: só quando há um evento a considerar. */
  private algoNaHora(agora: number, janelas: JanelasCalculadas): boolean {
    if (eventosFixosNaHora(agora).length) return true
    return Object.values(janelas.porCelula).some((js) => janelaDoAntes(js, agora) !== null)
  }

  private async enviarEventos(agora: number, tipos: TipoEvento[], janelas: JanelasCalculadas): Promise<void> {
    this.pausados.clear()
    const [contatos, fazendas, jaReservadas] = await Promise.all([
      this.d.banco.contatos(),
      this.d.banco.fazendas(),
      this.d.banco.chavesDoDia(chaveData(agora)),
    ])
    const aptos = contatos
      .filter((c) => c.ativo && c.alertaJanela && c.confirmadoEm)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    let tentouAlgum = false
    for (const tipo of tipos) {
      const chave = chaveEvento(agora, tipo)
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

  /** O texto a mandar a este contato agora; `null` = nada para ele; `'parar'` = nada mais sai nesta volta. */
  private async preparar(tipo: TipoEvento, contato: ContatoWpp, fazendas: FazendaServidor[], janelas: JanelasCalculadas): Promise<string | null | 'parar'> {
    if (!this.d.ensaio && !this.d.whatsapp.conectado) return 'parar'
    if (this.pausados.has(contato.id)) return null
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
    this.d.registrar(`${ERRO_TETO_DO_DIA}: nada mais sai hoje`)
    if (this.d.ensaio) return
    try {
      await this.d.banco.gravarEstado({ conectado: this.d.whatsapp.conectado, ultimoErro: ERRO_TETO_DO_DIA })
    } catch (e) {
      this.d.registrar(`não gravei o aviso de teto: ${mensagemDe(e)}`)
    }
  }

  /** `true` se tentou mandar (deu certo ou não): é o que pede a pausa antes da próxima pessoa. */
  private async mandar(contato: ContatoWpp, tipo: TipoEvento, chave: string, texto: string, jaReservadas: { contatoId: string; chave: string }[]): Promise<boolean> {
    const quem = mascarar(contato.telefone)
    const comSair = !jaReservadas.some((r) => r.contatoId === contato.id)
    let jid = contato.jid
    try {
      if (!jid) {
        const achado = await this.d.whatsapp.resolverJid(contato.telefone)
        if (achado === null) {
          // o número não tem WhatsApp: fica registrado para hoje e não se pergunta de novo a cada minuto
          if (await this.d.banco.reservarEnvio(contato.id, chave, tipo)) {
            jaReservadas.push({ contatoId: contato.id, chave })
            await this.d.banco.fecharEnvio(contato.id, chave, 'falhou', ERRO_SEM_WHATSAPP)
            this.d.registrar(`${quem}: ${ERRO_SEM_WHATSAPP}`)
          }
          return false
        }
        jid = achado
        try {
          await this.d.banco.guardarJid(contato.id, jid)
        } catch (e) {
          this.d.registrar(`${quem}: não guardei o endereço: ${mensagemDe(e)}`) // só atalho: manda assim mesmo
        }
      }
      // reservar ANTES de mandar: se não reservou, não manda
      const reservou = await this.d.banco.reservarEnvio(contato.id, chave, tipo)
      jaReservadas.push({ contatoId: contato.id, chave })
      if (!reservou) return false
    } catch (e) {
      this.d.registrar(`${quem}: não mandei ${tipo}: ${mensagemDe(e)}`)
      return false
    }

    try {
      await this.d.whatsapp.enviar(jid, montarMensagem(contato, texto, this.d.agora(), comSair))
    } catch (e) {
      this.d.registrar(`${quem}: falha ao enviar ${tipo}: ${mensagemDe(e)}`)
      await this.fechar(contato.id, chave, quem, 'falhou', mensagemDe(e))
      return true
    }
    this.contador.contar(contato.id)
    this.d.registrar(`enviado ${tipo} a ${quem}`)
    await this.fechar(contato.id, chave, quem, 'enviado')
    try {
      await this.d.banco.gravarEstado({ conectado: true, ultimoEnvioEm: new Date(this.d.agora()).toISOString() })
    } catch (e) {
      this.d.registrar(`não gravei o último envio: ${mensagemDe(e)}`)
    }
    return true
  }

  private async fechar(contatoId: string, chave: string, quem: string, situacao: 'enviado' | 'falhou', erro?: string): Promise<void> {
    try {
      await this.d.banco.fecharEnvio(contatoId, chave, situacao, erro)
    } catch (e) {
      this.d.registrar(`${quem}: não fechei o envio: ${mensagemDe(e)}`)
    }
  }

  private ensaiar(contato: ContatoWpp, tipo: TipoEvento, chave: string, texto: string, jaReservadas: { contatoId: string }[]): void {
    const marca = `${contato.id}|${chave}`
    if (this.ensaiados.has(marca)) return
    const prefixoDoDia = `${contato.id}|${chave.split(':')[0]}:`
    const comSair = !jaReservadas.some((r) => r.contatoId === contato.id) && ![...this.ensaiados].some((m) => m.startsWith(prefixoDoDia))
    this.ensaiados.add(marca)
    const mensagem = montarMensagem(contato, texto, this.d.agora(), comSair).replaceAll('\n', ' / ')
    this.d.registrar(`ensaio: enviaria ${tipo} a ${mascarar(contato.telefone)}: ${mensagem}`)
  }

  /** Resposta a ATIVAR/SAIR: respeita o teto do dia e conta nele. */
  private async responder(jid: string, quem: string, texto: string): Promise<void> {
    if (!this.contador.podeMensagem()) {
      await this.avisarTetoDoDia()
      return
    }
    try {
      await this.d.whatsapp.enviar(jid, texto)
      this.contador.contar(null)
    } catch (e) {
      this.d.registrar(`${quem}: não consegui responder: ${mensagemDe(e)}`)
    }
  }
}
