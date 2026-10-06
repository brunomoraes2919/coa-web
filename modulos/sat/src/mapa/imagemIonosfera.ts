/**
 * A imagem da Trimble vira um canvas 256×256 pronto para desenhar: a cintilação recolorida
 * na nossa paleta, o TEC como veio. Um pedido por (camada, passo): a barra, o play e o
 * pré-carregamento dividem o mesmo cache.
 */
import { cabecalhosDaPonte, TEMPO_LIMITE_MS, urlOverlay } from '../api/gnssApi'
import { recolorirCintilacao } from '../logic/recolorir'

export type CamadaTrimble = 'sci' | 'tec'

const LADO = 256
/** Dois dias das duas camadas (144 × 2 × 2) cabem com folga. */
const LIMITE_CACHE = 600
const cache = new Map<string, Promise<HTMLCanvasElement>>()

async function montar(camada: CamadaTrimble, url: string): Promise<HTMLCanvasElement> {
  // A ponte exige o token, então a imagem vem por fetch (um <img> não manda cabeçalho).
  const resposta = await fetch(url, { headers: await cabecalhosDaPonte(), signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
  if (!resposta.ok) throw new Error(`Imagem da Trimble indisponível (${resposta.status})`)
  const bitmap = await createImageBitmap(await resposta.blob())
  const canvas = document.createElement('canvas')
  canvas.width = LADO
  canvas.height = LADO
  const ctx = canvas.getContext('2d', { willReadFrequently: camada === 'sci' })
  if (!ctx) throw new Error('Canvas 2D indisponível')
  ctx.drawImage(bitmap, 0, 0, LADO, LADO)
  bitmap.close()
  if (camada === 'sci') {
    const pixels = ctx.getImageData(0, 0, LADO, LADO)
    recolorirCintilacao(pixels.data)
    ctx.putImageData(pixels, 0, 0)
  }
  return canvas
}

/** Canvas-fonte do passo. Falha não fica no cache: a próxima tentativa pede de novo. */
export function carregarIonosfera(camada: CamadaTrimble, instante: number): Promise<HTMLCanvasElement> {
  const url = urlOverlay(camada, instante)
  const pronto = cache.get(url)
  if (pronto) {
    // O usado volta para o fim da fila: quem sai é sempre o mais antigo.
    cache.delete(url)
    cache.set(url, pronto)
    return pronto
  }
  const pedido = montar(camada, url)
  cache.set(url, pedido)
  pedido.catch(() => {
    if (cache.get(url) === pedido) cache.delete(url)
  })
  while (cache.size > LIMITE_CACHE) {
    const maisAntigo = cache.keys().next().value
    if (maisAntigo === undefined) break
    cache.delete(maisAntigo)
  }
  return pedido
}

/** Pré-carga: o mesmo pedido, sem tratar o erro (o passo marca a falha quando for exibido). */
export function precarregarIonosfera(camada: CamadaTrimble, instante: number): void {
  carregarIonosfera(camada, instante).catch(() => {})
}

/** Pedido novo para a Trimble só a cada tanto: a rajada de pedidos é bloqueada (e derruba os dados de todos). */
export const INTERVALO_MINIMO_PEDIDO_MS = 500
/** Quando saiu (ou vai sair) o último pedido novo disparado pelo play. */
let ultimoPedidoNovo = Number.NEGATIVE_INFINITY
/** Pedidos do play que esperam a vez: o mesmo passo pedido de novo não ocupa outra vaga. */
const agendados = new Map<string, { timer: ReturnType<typeof setTimeout>; pedido: Promise<HTMLCanvasElement> }>()

/**
 * Como `carregarIonosfera`, para o play: imagem já no cache vem na hora; imagem nova só sai
 * quando já passaram `INTERVALO_MINIMO_PEDIDO_MS` do pedido novo anterior, em qualquer velocidade.
 * Falha de um pedido não segura o seguinte (a vaga é reservada ao pedir, não ao terminar).
 */
export function carregarIonosferaNoRitmo(camada: CamadaTrimble, instante: number): Promise<HTMLCanvasElement> {
  const url = urlOverlay(camada, instante)
  if (cache.has(url)) return carregarIonosfera(camada, instante)
  const esperando = agendados.get(url)
  if (esperando) return esperando.pedido

  const agora = Date.now()
  const saida = Math.max(agora, ultimoPedidoNovo + INTERVALO_MINIMO_PEDIDO_MS)
  ultimoPedidoNovo = saida
  if (saida <= agora) return carregarIonosfera(camada, instante)

  let timer!: ReturnType<typeof setTimeout>
  const pedido = new Promise<HTMLCanvasElement>((resolve, reject) => {
    timer = setTimeout(() => {
      agendados.delete(url)
      carregarIonosfera(camada, instante).then(resolve, reject)
    }, saida - agora)
  })
  agendados.set(url, { timer, pedido })
  return pedido
}

/** Só para testes. */
export function limparCacheIonosfera(): void {
  cache.clear()
  for (const { timer } of agendados.values()) clearTimeout(timer)
  agendados.clear()
  ultimoPedidoNovo = Number.NEGATIVE_INFINITY
}
