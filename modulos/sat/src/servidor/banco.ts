/**
 * Acesso do serviço da VM ao Supabase, direto pela API REST e com a chave de serviço
 * (ela passa por cima das regras de linha; por isso nunca entra em mensagem de erro).
 */
import { celulaDe } from '../fazendasGnss'
import { centroDoLimite, limitesPorFazenda } from '../logic/limites'
import { DIA_MS } from '../logic/tempo'
import type { ContatoWpp, FazendaServidor, SituacaoEnvio, TipoEvento } from './tipos'

export interface Banco {
  contatos(): Promise<ContatoWpp[]>
  fazendas(): Promise<FazendaServidor[]>
  /** Reserva o envio ANTES de mandar. `false` = já existia (não manda de novo). */
  reservarEnvio(contatoId: string, chave: string, tipo: TipoEvento): Promise<boolean>
  fecharEnvio(contatoId: string, chave: string, situacao: 'enviado' | 'falhou' | 'pulado', erro?: string): Promise<void>
  /** Chaves de evento já reservadas no dia, de todos os contatos (para a linha do SAIR e para não repetir). */
  chavesDoDia(dia: string): Promise<{ contatoId: string; chave: string; situacao: SituacaoEnvio }[]>
  confirmar(contatoId: string, jid: string): Promise<void>
  guardarJid(contatoId: string, jid: string): Promise<void>
  pausar(contatoId: string): Promise<void>
  gravarEstado(estado: { conectado: boolean; desde?: string; ultimoEnvioEm?: string; ultimoErro?: string | null }): Promise<void>
  /** Apaga os envios com mais de 30 dias. */
  limparEnviosAntigos(): Promise<void>
}

const PAGINA = 1000
// chamada pendurada travaria o laço do serviço
const PRAZO_MS = 20_000
const GUARDA_ENVIOS_DIAS = 30

interface PedidoOpcoes {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  /** Status que não são erro para quem chama (ex.: 409 = envio já reservado). */
  aceitar?: number[]
}

export function criarBanco(opcoes: { url: string; chave: string; fetch?: typeof fetch; agora?: () => number }): Banco {
  const buscar = opcoes.fetch ?? globalThis.fetch
  const agora = opcoes.agora ?? Date.now
  const base = `${opcoes.url.replace(/\/+$/, '')}/rest/v1`
  const agoraIso = () => new Date(agora()).toISOString()

  async function pedir(acao: string, caminho: string, pedido: PedidoOpcoes = {}): Promise<Response> {
    const headers: Record<string, string> = { apikey: opcoes.chave, Authorization: `Bearer ${opcoes.chave}`, ...pedido.headers }
    if (pedido.body !== undefined) headers['Content-Type'] = 'application/json'
    const resposta = await buscar(`${base}/${caminho}`, {
      method: pedido.method ?? 'GET',
      headers,
      body: pedido.body === undefined ? undefined : JSON.stringify(pedido.body),
      signal: AbortSignal.timeout(PRAZO_MS),
    })
    if (resposta.ok || pedido.aceitar?.includes(resposta.status)) return resposta
    // a mensagem do Supabase pode repetir a chave: some com ela antes de deixar sair
    let detalhe = ''
    try {
      detalhe = await resposta.text()
    } catch {
      // sem corpo legível: fica só o status
    }
    if (opcoes.chave) detalhe = detalhe.replaceAll(opcoes.chave, '***')
    throw new Error(`Supabase recusou ${acao} (HTTP ${resposta.status})${detalhe ? `: ${detalhe.slice(0, 200)}` : ''}`)
  }

  async function lerTudo<T>(acao: string, tabela: string, consulta: string): Promise<T[]> {
    const todas: T[] = []
    for (let de = 0; ; de += PAGINA) {
      const resposta = await pedir(acao, `${tabela}?${consulta}`, { headers: { 'Range-Unit': 'items', Range: `${de}-${de + PAGINA - 1}` } })
      let linhas: T[]
      try {
        linhas = (await resposta.json()) as T[]
      } catch {
        // o erro do interpretador pode citar um trecho do corpo
        throw new Error('Supabase devolveu resposta fora do formato')
      }
      todas.push(...linhas)
      if (linhas.length < PAGINA) return todas
    }
  }

  const alterar = (acao: string, caminho: string, corpo: unknown) =>
    pedir(acao, caminho, { method: 'PATCH', body: corpo, headers: { Prefer: 'return=minimal' } }).then(() => undefined)

  return {
    async contatos() {
      // uma tabela por vez: se a primeira falhar, o erro que sai é o dela
      const linhas = await lerTudo<LinhaContato>('ler os contatos', 'whatsapp_contatos', 'select=*&order=nome')
      const ligacoes = await lerTudo<{ contato_id: string; fazenda_id: number }>('ler as fazendas dos contatos', 'whatsapp_contato_fazendas', 'select=*&order=contato_id,fazenda_id')
      const porContato = new Map<string, number[]>()
      for (const l of ligacoes) porContato.set(l.contato_id, [...(porContato.get(l.contato_id) ?? []), Number(l.fazenda_id)])
      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        telefone: l.telefone,
        todasFazendas: l.todas_fazendas,
        fazendas: porContato.get(l.id) ?? [],
        alertaJanela: l.alerta_janela,
        ativo: l.ativo,
        confirmadoEm: l.confirmado_em ?? null,
        confirmadoPor: l.confirmado_por ?? null,
        jid: l.jid ?? null,
      }))
    },

    async fazendas() {
      const linhas = await lerTudo<{ id: string; nome: string; coa_fazenda_id: number | string | null }>('ler as fazendas', 'mapas_fazendas', 'select=id,nome,coa_fazenda_id&order=nome,id')
      const talhoes = await lerTudo<{ fazenda_id: string; geom: unknown }>('ler os talhões', 'mapas_talhoes', 'select=fazenda_id,geom&order=id')
      const limites = limitesPorFazenda(talhoes)
      return linhas.map((l) => {
        const centro = limites[l.id] ? centroDoLimite(limites[l.id]) : null
        const celula = centro ? celulaDe(centro.lat, centro.lon) : null
        return {
          id: l.id,
          coaId: l.coa_fazenda_id == null ? null : Number(l.coa_fazenda_id),
          nome: l.nome,
          celulaId: celula?.id ?? null,
          lat: celula?.lat ?? null,
          lon: celula?.lon ?? null,
        }
      })
    },

    async reservarEnvio(contatoId, chave, tipo) {
      const resposta = await pedir('reservar o envio', 'whatsapp_envios', {
        method: 'POST',
        body: { contato_id: contatoId, chave, tipo, situacao: 'enviando' },
        headers: { Prefer: 'return=minimal' },
        aceitar: [409],
      })
      return resposta.status !== 409
    },

    fecharEnvio(contatoId, chave, situacao, erro) {
      return alterar('fechar o envio', `whatsapp_envios?contato_id=eq.${encodeURIComponent(contatoId)}&chave=eq.${encodeURIComponent(chave)}`, {
        situacao,
        enviado_em: situacao === 'enviado' ? agoraIso() : null,
        erro: erro ? erro.slice(0, 300) : null,
      })
    },

    async chavesDoDia(dia) {
      const linhas = await lerTudo<{ contato_id: string; chave: string; situacao: SituacaoEnvio }>('ler os envios do dia', 'whatsapp_envios', `select=contato_id,chave,situacao&chave=like.${encodeURIComponent(dia)}:*&order=contato_id,chave`)
      return linhas.map((l) => ({ contatoId: l.contato_id, chave: l.chave, situacao: l.situacao }))
    },

    confirmar(contatoId, jid) {
      const agoraStr = agoraIso()
      return alterar('confirmar o contato', `whatsapp_contatos?id=eq.${encodeURIComponent(contatoId)}`, { confirmado_em: agoraStr, confirmado_por: 'mensagem', jid, ativo: true, atualizado_em: agoraStr })
    },

    guardarJid(contatoId, jid) {
      return alterar('guardar o endereço do contato', `whatsapp_contatos?id=eq.${encodeURIComponent(contatoId)}`, { jid, atualizado_em: agoraIso() })
    },

    pausar(contatoId) {
      return alterar('pausar o contato', `whatsapp_contatos?id=eq.${encodeURIComponent(contatoId)}`, { ativo: false, atualizado_em: agoraIso() })
    },

    gravarEstado(estado) {
      const corpo: Record<string, unknown> = { conectado: estado.conectado, batimento_em: agoraIso() }
      if (estado.desde !== undefined) corpo.desde = estado.desde
      if (estado.ultimoEnvioEm !== undefined) corpo.ultimo_envio_em = estado.ultimoEnvioEm
      if (estado.ultimoErro !== undefined) corpo.ultimo_erro = estado.ultimoErro === null ? null : estado.ultimoErro.slice(0, 300)
      return alterar('gravar o estado do serviço', 'whatsapp_estado?id=eq.1', corpo)
    },

    async limparEnviosAntigos() {
      const limite = new Date(agora() - GUARDA_ENVIOS_DIAS * DIA_MS).toISOString()
      await pedir('limpar os envios antigos', `whatsapp_envios?criado_em=lt.${encodeURIComponent(limite)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    },
  }
}

interface LinhaContato {
  id: string
  nome: string
  telefone: string
  todas_fazendas: boolean
  alerta_janela: boolean
  ativo: boolean
  confirmado_em: string | null
  confirmado_por: 'mensagem' | 'manual' | null
  jid: string | null
}
