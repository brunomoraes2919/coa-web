/**
 * Fazendas e limites do cadastro do Mapas (`mapas_fazendas`, `mapas_talhoes`), lidos com a
 * sessão do usuário: a segurança do banco já entrega só as fazendas liberadas para ele.
 *
 * Os talhões pesam (milhares de vértices). O vigia só precisa do centro de cada fazenda, então
 * os centros ficam guardados no navegador por 7 dias e os talhões só são baixados quando falta
 * algum — ou quando o Mapa abre, que precisa do contorno. Fazenda que não tem talhão nenhum
 * também fica guardada (`semLimite`), para não forçar o download a cada abertura.
 */
import { celulaDe } from '../fazendasGnss'
import { centroDoLimite, limitesPorFazenda, type LimiteFazenda } from '../logic/limites'
import { DIA_MS } from '../logic/tempo'
import type { FazendaGnss } from '../tipos'

interface Resposta<T> {
  data: T[] | null
  error: { message: string } | null
}
interface Consulta<T> {
  select(colunas: string): Consulta<T>
  order(coluna: string): Consulta<T>
  range(de: number, ate: number): PromiseLike<Resposta<T>>
}
/** O pedaço do cliente do Supabase que o cadastro usa. */
export interface ClienteCadastro {
  from(tabela: string): unknown
}

export interface DepsCadastro {
  cliente: ClienteCadastro
  armazenamento: Pick<Storage, 'getItem' | 'setItem'>
  agora: () => number
}

type Centro = { lat: number; lon: number }

export const CHAVE_CENTROS = 'locks_sat_centros_v1'
const VALIDADE_CENTROS_MS = 7 * DIA_MS
/** Páginas pequenas: cada linha traz um polígono inteiro. */
const PAGINA = 250

async function lerTodas<T>(cliente: ClienteCadastro, tabela: string, colunas: string, ordem: string): Promise<T[]> {
  const tudo: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const consulta = cliente.from(tabela) as Consulta<T>
    const { data, error } = await consulta.select(colunas).order(ordem).range(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    tudo.push(...(data ?? []))
    if (!data || data.length < PAGINA) return tudo
  }
}

/** O que fica no navegador: centros e as fazendas que, em `em`, não tinham talhão nenhum. */
interface Guardado {
  centros: Record<string, Centro>
  semLimite: string[]
}

/** Guardado em dia (até 7 dias); velho, estragado ou ausente vira vazio. Guardado antigo sem `semLimite` vale com lista vazia. */
function lerGuardado(deps: DepsCadastro): Guardado {
  const nada: Guardado = { centros: {}, semLimite: [] }
  try {
    const bruto: unknown = JSON.parse(deps.armazenamento.getItem(CHAVE_CENTROS) ?? 'null')
    if (typeof bruto !== 'object' || bruto === null) return nada
    const { em, centros, semLimite } = bruto as { em?: unknown; centros?: unknown; semLimite?: unknown }
    if (typeof em !== 'number' || deps.agora() - em > VALIDADE_CENTROS_MS) return nada
    if (typeof centros !== 'object' || centros === null) return nada
    const validos: Record<string, Centro> = {}
    for (const [id, c] of Object.entries(centros)) {
      const { lat, lon } = (c ?? {}) as { lat?: unknown; lon?: unknown }
      if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
        validos[id] = { lat, lon }
      }
    }
    const semTalhao = Array.isArray(semLimite) && semLimite.every((id) => typeof id === 'string') ? (semLimite as string[]) : []
    return { centros: validos, semLimite: semTalhao }
  } catch {
    return nada
  }
}

function guardar(deps: DepsCadastro, centros: Record<string, Centro>, semLimite: string[]): void {
  try {
    deps.armazenamento.setItem(CHAVE_CENTROS, JSON.stringify({ em: deps.agora(), centros, semLimite }))
  } catch {
    /* navegador sem armazenamento: o centro é recalculado na próxima sessão */
  }
}

function centrosDosLimites(limites: Record<string, LimiteFazenda>): Record<string, Centro> {
  const centros: Record<string, Centro> = {}
  for (const [id, limite] of Object.entries(limites)) {
    const c = centroDoLimite(limite)
    if (c) centros[id] = c
  }
  return centros
}

let limitesEmCurso: Promise<Record<string, LimiteFazenda>> | null = null

/** Esquece os contornos em memória — chamado quando o usuário muda (e nos testes). */
export function limparLimitesDaSessao(): void {
  limitesEmCurso = null
}

/** Contornos de todas as fazendas visíveis — um download por sessão; renova os centros guardados. */
export function limitesDaSessao(deps: DepsCadastro): Promise<Record<string, LimiteFazenda>> {
  if (limitesEmCurso) return limitesEmCurso
  const pedido = lerTodas<{ fazenda_id: string; geom: unknown }>(deps.cliente, 'mapas_talhoes', 'fazenda_id, geom', 'id')
    .then((linhas) => {
      const limites = limitesPorFazenda(linhas)
      const centros = centrosDosLimites(limites)
      // Sem a lista de fazendas aqui: mantém as já sabidas sem talhão, menos as que agora têm.
      guardar(deps, centros, lerGuardado(deps).semLimite.filter((id) => !centros[id]))
      return limites
    })
  limitesEmCurso = pedido
  // Falha não fica guardada: a próxima tentativa pede de novo.
  pedido.catch(() => {
    if (limitesEmCurso === pedido) limitesEmCurso = null
  })
  return pedido
}

/** Fazendas do usuário, em ordem alfabética, com a posição e o quadrado de consulta. */
export async function carregarFazendasSat(deps: DepsCadastro): Promise<FazendaGnss[]> {
  const fazendas = await lerTodas<{ id: string; nome: string }>(deps.cliente, 'mapas_fazendas', 'id, nome', 'nome')
  const guardado = lerGuardado(deps)
  let centros = guardado.centros
  const semLimite = new Set(guardado.semLimite)
  if (fazendas.some((f) => !centros[f.id] && !semLimite.has(f.id))) {
    centros = centrosDosLimites(await limitesDaSessao(deps))
    guardar(deps, centros, fazendas.filter((f) => !centros[f.id]).map((f) => f.id))
  }
  return fazendas
    .map((f): FazendaGnss => {
      const c = centros[f.id]
      if (!c) return { id: f.id, nome: f.nome, lat: null, lon: null, celulaId: null }
      return { id: f.id, nome: f.nome, lat: c.lat, lon: c.lon, celulaId: celulaDe(c.lat, c.lon).id }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
