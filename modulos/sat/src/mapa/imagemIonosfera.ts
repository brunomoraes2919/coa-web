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

/** Só para testes. */
export function limparCacheIonosfera(): void {
  cache.clear()
}
