/** Mapa base em tiles Web Mercator: planejamento, carregamento com cache e desenho no quadro. */
import { tileBounds, tileRange, tileZoomFor } from './geometry';
import { Limitador, carregarTodos } from './pool';
import type { TileSource, Vista } from './types';

/** orçamento de tiles de UMA renderização (somando todos os quadros) */
export const MAX_TILES = 400;
/** mínimo de tiles por quadro quando o orçamento é dividido */
export const MIN_TILES_QUADRO = 60;
const MAX_CACHE = 800;
/** Tempo máximo de UMA requisição, contado a partir do momento em que ela sai da fila. */
const TEMPO_LIMITE_MS = 20000;
/** Requisições de tile simultâneas (compartilhado por todas as renderizações). */
const REQUISICOES_SIMULTANEAS = 12;
const limitador = new Limitador(REQUISICOES_SIMULTANEAS);

/** Cache em memória por URL (LRU simples pela ordem de inserção do Map). */
const cache = new Map<string, Promise<HTMLImageElement>>();

function lembrar(url: string, p: Promise<HTMLImageElement>): void {
  cache.set(url, p);
  while (cache.size > MAX_CACHE) {
    const maisAntigo = cache.keys().next().value;
    if (maisAntigo === undefined) break;
    cache.delete(maisAntigo);
  }
}

/**
 * Carrega uma imagem com CORS anônimo (não contamina o canvas). A requisição e o timeout começam
 * nesta chamada. Falhas saem do cache antes de a promessa rejeitar, então uma nova tentativa
 * faz uma requisição nova.
 */
export function carregarImagem(url: string): Promise<HTMLImageElement> {
  const existente = cache.get(url);
  if (existente) {
    cache.delete(url);
    cache.set(url, existente);
    return existente;
  }
  const p: Promise<HTMLImageElement> = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const falhar = (motivo: string) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      if (cache.get(url) === p) cache.delete(url);
      reject(new Error(`${motivo} ${url}`));
    };
    const timer = setTimeout(() => {
      falhar('Tempo esgotado ao carregar');
      img.src = '';
    }, TEMPO_LIMITE_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => falhar('Falha ao carregar');
    img.src = url;
  });
  lembrar(url, p);
  return p;
}

export interface TileCarregado {
  img: HTMLImageElement;
  /** [minX, minY, maxX, maxY] em Web Mercator */
  bounds: [number, number, number, number];
}

/**
 * Divide o orçamento de tiles de uma renderização (`total`, padrão 400) entre os quadros, na
 * proporção da área de cada um, com mínimo de `minimo` (60) por quadro. Valores inteiros; a soma
 * nunca passa de `total` (se `n × minimo > total`, cada quadro fica com ⌊total / n⌋).
 */
export function dividirOrcamentoTiles(areas: number[], total = MAX_TILES, minimo = MIN_TILES_QUADRO): number[] {
  const n = areas.length;
  if (n === 0) return [];
  if (n * minimo > total) return areas.map(() => Math.floor(total / n));
  const a = areas.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const fixos = new Set<number>();
  let cotas: number[] = a.map(() => total / n);
  for (let it = 0; it <= n; it++) {
    const livres = a.map((_, i) => i).filter((i) => !fixos.has(i));
    const somaLivres = livres.reduce((soma, i) => soma + a[i], 0);
    const resto = total - fixos.size * minimo;
    cotas = a.map((x, i) => (fixos.has(i) ? minimo : somaLivres > 0 ? (resto * x) / somaLivres : resto / livres.length));
    const abaixo = livres.filter((i) => cotas[i] < minimo);
    if (!abaixo.length) break;
    abaixo.forEach((i) => fixos.add(i));
  }
  return cotas.map((c) => Math.max(minimo, Math.floor(c)));
}

/** Zoom e tiles que cobrem o quadro (no máximo `max`, padrão 400: reduz o zoom até caber). */
export function planejarTiles(v: Vista, fonte: TileSource, max = MAX_TILES): { z: number; lista: [number, number][] } {
  const [minX, maxY] = v.paraMerc(v.x, v.y);
  const [maxX, minY] = v.paraMerc(v.x + v.w, v.y + v.h);
  const mPorPxTerreno = v.mPorPx * Math.cos((v.latCentro * Math.PI) / 180);
  let z = tileZoomFor(mPorPxTerreno, v.latCentro, fonte.maxZoom);
  let r = tileRange(minX, minY, maxX, maxY, z);
  while (z > 0 && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > max) {
    z--;
    r = tileRange(minX, minY, maxX, maxY, z);
  }
  const lista: [number, number][] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) lista.push([x, y]);
  return { z, lista };
}

/**
 * Carrega os tiles do quadro (no máximo `max`; com vários quadros, a cota de `dividirOrcamentoTiles`).
 * Nunca lança: devolve os que carregaram e quantos falharam.
 */
export async function carregarTiles(
  v: Vista,
  fonte: TileSource,
  max = MAX_TILES,
): Promise<{ tiles: TileCarregado[]; falhas: number; total: number }> {
  if (typeof Image === 'undefined') return { tiles: [], falhas: 1, total: 1 };
  try {
    const { z, lista } = planejarTiles(v, fonte, max);
    // no máximo 12 requisições por vez; cada tile que falha é tentado de novo uma vez
    const res = await carregarTodos(lista, ([x, y]) => carregarImagem(fonte.url(z, x, y)), limitador);
    const tiles: TileCarregado[] = [];
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') tiles.push({ img: r.value, bounds: tileBounds(z, lista[i][0], lista[i][1]) });
    });
    return { tiles, falhas: lista.length - tiles.length, total: lista.length };
  } catch {
    return { tiles: [], falhas: 1, total: 1 };
  }
}

/** Desenha os tiles (bordas arredondadas ao pixel para não deixar frestas) e o véu branco. */
export function desenharTiles(ctx: CanvasRenderingContext2D, v: Vista, tiles: TileCarregado[], clarear: number): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const t of tiles) {
    const [a, b] = v.paraPx(t.bounds[0], t.bounds[3]);
    const [c, d] = v.paraPx(t.bounds[2], t.bounds[1]);
    const x0 = Math.round(a);
    const y0 = Math.round(b);
    const x1 = Math.round(c);
    const y1 = Math.round(d);
    if (x1 <= x0 || y1 <= y0) continue;
    try {
      ctx.drawImage(t.img, x0, y0, x1 - x0, y1 - y0);
    } catch {
      // imagem quebrada: ignora este tile
    }
  }
  if (tiles.length && clarear > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, clarear)})`;
    ctx.fillRect(v.x, v.y, v.w, v.h);
  }
  ctx.restore();
}
