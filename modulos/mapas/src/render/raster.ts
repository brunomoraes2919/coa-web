/**
 * Raster classificado desenhado por amostragem: para cada pixel do canvas dentro do quadro,
 * Mercator → lon/lat → UTM → célula do grid → cor da classe. A transformação exata é feita numa
 * malha a cada 8 px e as coordenadas UTM são interpoladas (bilinear) entre os nós.
 */
import { hexToRgb } from '../lib/palettes';
import { lonLatToMerc, mercToLonLat, projetorUtm, type Projetor } from '../lib/projection';
import type { Grid, GridSpec, Palette } from '../lib/types';
import type { Vista } from './types';

const PASSO = 8;
/** linhas de pixels por faixa (limita a memória do ImageData em 600 dpi) */
const FAIXA = 512;

interface Regiao {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Retângulo inteiro (px do canvas) coberto pelo grid, recortado ao quadro. */
function regiaoDoGrid(v: Vista, grid: Grid, proj: Projetor): Regiao | null {
  const gx0 = grid.x0;
  const gx1 = grid.x0 + grid.cols * grid.res;
  const gy1 = grid.y0;
  const gy0 = grid.y0 - grid.rows * grid.res;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const N = 16;
  const add = (ux: number, uy: number) => {
    const [lon, lat] = proj.inverse(ux, uy);
    const [px, py] = v.paraPx(...lonLatToMerc(lon, lat));
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    add(gx0 + (gx1 - gx0) * t, gy0);
    add(gx0 + (gx1 - gx0) * t, gy1);
    add(gx0, gy0 + (gy1 - gy0) * t);
    add(gx1, gy0 + (gy1 - gy0) * t);
  }
  const x0 = Math.max(Math.floor(v.x), Math.floor(minX) - 2);
  const y0 = Math.max(Math.floor(v.y), Math.floor(minY) - 2);
  const x1 = Math.min(Math.ceil(v.x + v.w), Math.ceil(maxX) + 2);
  const y1 = Math.min(Math.ceil(v.y + v.h), Math.ceil(maxY) + 2);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Índice (linha × cols + coluna) da célula do grid que contém o ponto UTM (ux, uy); -1 fora do grid.
 * Norte para cima: y0 é a borda norte e a linha 0 é a do norte (y cresce para o norte, a linha para o sul).
 */
export function celulaDoPonto(g: GridSpec, ux: number, uy: number): number {
  const c = Math.floor((ux - g.x0) / g.res);
  const l = Math.floor((g.y0 - uy) / g.res);
  if (c < 0 || c >= g.cols || l < 0 || l >= g.rows) return -1;
  return l * g.cols + c;
}

/** Tabela de cores RGBA por índice de classe (255 = transparente). */
function tabelaCores(p: Palette): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  p.classes.forEach((c, i) => {
    if (i >= 255) return;
    const [r, g, b] = hexToRgb(c.color);
    lut.set([r, g, b, 255], i * 4);
  });
  return lut;
}

/** Desenha o raster classificado (`classes` = buildClassIndex do grid) dentro do quadro. */
export function desenharRaster(
  ctx: CanvasRenderingContext2D,
  v: Vista,
  grid: Grid,
  classes: Uint8Array,
  palette: Palette,
): void {
  if (grid.cols <= 0 || grid.rows <= 0 || classes.length !== grid.cols * grid.rows) return;
  const proj = projetorUtm(grid.epsg);
  const reg = regiaoDoGrid(v, grid, proj);
  if (!reg) return;
  const lut = tabelaCores(palette);
  const { x0, y0, w: W, h: H } = reg;
  const nx = Math.floor((W - 1) / PASSO) + 2;

  /** Coordenadas UTM exatas dos nós da linha j da malha (centro do pixel y0 + j*PASSO). */
  const linhaMalha = (j: number): [Float64Array, Float64Array] => {
    const xs = new Float64Array(nx);
    const ys = new Float64Array(nx);
    const py = y0 + j * PASSO + 0.5;
    for (let i = 0; i < nx; i++) {
      const [mx, my] = v.paraMerc(x0 + i * PASSO + 0.5, py);
      const [lon, lat] = mercToLonLat(mx, my);
      const [ux, uy] = proj.forward(lon, lat);
      xs[i] = ux;
      ys[i] = uy;
    }
    return [xs, ys];
  };

  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = Math.min(FAIXA, H);
  const tctx = tmp.getContext('2d');
  if (!tctx) return;

  const linhaX = new Float64Array(nx);
  const linhaY = new Float64Array(nx);
  let jAtual = 0;
  let A = linhaMalha(0);
  let B = linhaMalha(1);

  // um único ImageData (W × FAIXA) reaproveitado em todas as faixas
  const img = tctx.createImageData(W, tmp.height);
  const d = img.data;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let f0 = 0; f0 < H; f0 += FAIXA) {
    const fh = Math.min(FAIXA, H - f0);
    d.fill(0, 0, fh * W * 4); // transparente = sem dado
    for (let r = 0; r < fh; r++) {
      const yy = f0 + r;
      const j = Math.floor(yy / PASSO);
      if (j !== jAtual) {
        A = j === jAtual + 1 ? B : linhaMalha(j);
        B = linhaMalha(j + 1);
        jAtual = j;
      }
      const t = (yy - j * PASSO) / PASSO;
      const [ax, ay] = A;
      const [bx, by] = B;
      for (let i = 0; i < nx; i++) {
        linhaX[i] = ax[i] + (bx[i] - ax[i]) * t;
        linhaY[i] = ay[i] + (by[i] - ay[i]) * t;
      }
      let o = r * W * 4;
      for (let xx = 0; xx < W; xx++, o += 4) {
        const i = (xx / PASSO) | 0;
        const u = (xx - i * PASSO) / PASSO;
        const ux = linhaX[i] + (linhaX[i + 1] - linhaX[i]) * u;
        const uy = linhaY[i] + (linhaY[i + 1] - linhaY[i]) * u;
        const celula = celulaDoPonto(grid, ux, uy);
        if (celula < 0) continue;
        const k = classes[celula];
        if (k === 255) continue;
        const q = k * 4;
        d[o] = lut[q];
        d[o + 1] = lut[q + 1];
        d[o + 2] = lut[q + 2];
        d[o + 3] = lut[q + 3];
      }
    }
    tctx.putImageData(img, 0, 0, 0, 0, W, fh);
    ctx.drawImage(tmp, 0, 0, W, fh, x0, y0 + f0, W, fh);
  }
  ctx.restore();
  tmp.width = tmp.height = 0;
}
