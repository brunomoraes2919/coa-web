import type { GridSpec } from './types';

/** Ponto de entrada do IDW, em metros (UTM). */
export interface IdwPoint {
  x: number;
  y: number;
  v: number;
}

/** Pontos em arrays planos + buffers reutilizáveis (sem alocação por célula). */
interface Ctx {
  px: Float64Array;
  py: Float64Array;
  pv: Float64Array;
  n: number;
  /** vizinhos efetivos: 1 <= k <= n */
  k: number;
  /** p/2: o peso sai direto de d² (1/d^p = 1/(d²)^(p/2)) */
  meiaP: number;
  /** buffer de seleção ordenado por (d², índice) */
  bd: Float64Array;
  bi: Int32Array;
}

function criarCtx(pts: IdwPoint[], potencia: number, k: number): Ctx {
  const n = pts.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pv = new Float64Array(n);
  pts.forEach((p, i) => {
    px[i] = p.x;
    py[i] = p.y;
    pv[i] = p.v;
  });
  const kk = Math.max(1, Math.min(n, Math.floor(k)));
  return { px, py, pv, n, k: kk, meiaP: potencia / 2, bd: new Float64Array(kk), bi: new Int32Array(kk) };
}

/** d^p a partir de d² (atalhos exatos para p = 2 e p = 4). */
function potD(d2: number, meiaP: number): number {
  if (meiaP === 2) return d2 * d2;
  if (meiaP === 1) return d2;
  return Math.pow(d2, meiaP);
}

/**
 * IDW como o GRASS v.surf.idw: Σ v/d^p ÷ Σ 1/d^p sobre os k pontos mais próximos; se um deles está a
 * d = 0, devolve o valor dele. Empate na k-ésima distância: fica o ponto de menor índice (como o GRASS,
 * que só troca por um ponto estritamente mais próximo). A soma é sempre feita em ordem de índice, então
 * o resultado não depende de quais candidatos foram avaliados — só de quais foram escolhidos.
 *
 * `cand[off .. off+nc)` são índices crescentes que contêm todos os pontos que podem estar entre os k
 * mais próximos de (x, y); com nc === k, são exatamente eles.
 */
function interpolar(c: Ctx, x: number, y: number, cand: Int32Array, off: number, nc: number): number {
  const { px, py, pv, meiaP, k } = c;
  const fim = off + nc;
  // limite de inclusão (d², índice); sem seleção (nc === k), todos entram
  let limD = Infinity;
  let limI = 0x7fffffff;
  if (nc > k) {
    const { bd, bi } = c;
    let m = 0;
    for (let t = off; t < fim; t++) {
      const j = cand[t];
      const dx = x - px[j];
      const dy = y - py[j];
      const d2 = dx * dx + dy * dy;
      let i: number;
      if (m < k) i = m++;
      else if (d2 < bd[k - 1]) i = k - 1; // índices crescentes: empate não troca
      else continue;
      while (i > 0 && bd[i - 1] > d2) {
        bd[i] = bd[i - 1];
        bi[i] = bi[i - 1];
        i--;
      }
      bd[i] = d2;
      bi[i] = j;
    }
    if (bd[0] === 0) return pv[bi[0]];
    limD = bd[k - 1];
    limI = bi[k - 1];
  }
  let s1 = 0;
  let s2 = 0;
  for (let t = off; t < fim; t++) {
    const j = cand[t];
    const dx = x - px[j];
    const dy = y - py[j];
    const d2 = dx * dx + dy * dy;
    if (d2 > limD || (d2 === limD && j > limI)) continue;
    if (d2 === 0) return pv[j];
    const dp = potD(d2, meiaP);
    s1 += pv[j] / dp;
    s2 += 1 / dp;
  }
  return s1 / s2;
}

function indicesTodos(n: number): Int32Array {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/** Valor IDW em (x, y) com os k vizinhos mais próximos e peso 1/d^p. Sem pontos → NaN. */
export function idwAt(x: number, y: number, pts: IdwPoint[], potencia: number, k: number): number {
  if (pts.length === 0) return NaN;
  const c = criarCtx(pts, potencia, k);
  return interpolar(c, x, y, indicesTodos(c.n), 0, c.n);
}

/** Lado do bloco (em células) que compartilha a mesma lista de candidatos. */
const BLOCO = 16;

/**
 * Candidatos do bloco de colunas [c0, c0+BLOCO) × linhas [r0, r1). Com c = centro do bloco, h = meia-diagonal
 * dos centros das células e D_k = k-ésima menor distância |c − p|, um ponto com |c − p| > D_k + 2h está
 * estritamente mais longe que o k-ésimo vizinho de qualquer célula do bloco (desigualdade triangular) e
 * pode ser ignorado sem mudar o resultado. Grava os índices em ordem crescente em cand[off..] e devolve quantos.
 */
function candidatosBloco(
  c: Ctx, s: GridSpec, r0: number, r1: number, c0: number,
  cand: Int32Array, off: number, dc: Float64Array, tmp: Float64Array,
): number {
  const { px, py, n, k } = c;
  const { x0, y0, res, cols } = s;
  const c1 = Math.min(cols, c0 + BLOCO);
  const cx = x0 + ((c0 + c1) / 2) * res;
  const cy = y0 - ((r0 + r1) / 2) * res;
  const hx = ((c1 - c0 - 1) / 2) * res;
  const hy = ((r1 - r0 - 1) / 2) * res;
  for (let j = 0; j < n; j++) {
    const dx = cx - px[j];
    const dy = cy - py[j];
    dc[j] = Math.sqrt(dx * dx + dy * dy);
  }
  tmp.set(dc);
  tmp.sort();
  // folga relativa cobre o arredondamento das raízes
  const limite = (tmp[k - 1] + 2 * Math.sqrt(hx * hx + hy * hy)) * (1 + 1e-9) + 1e-9;
  let m = 0;
  for (let j = 0; j < n; j++) if (dc[j] <= limite) cand[off + m++] = j;
  return m;
}

/**
 * IDW no centro de cada célula da máscara (NaN fora dela), idêntico a `idwAt` célula a célula.
 * `onProgress` recebe a fração concluída no máximo ~100 vezes, terminando em 1.
 */
export function idwGrid(
  s: GridSpec,
  mask: Uint8Array,
  pts: IdwPoint[],
  potencia: number,
  k: number,
  onProgress?: (f: number) => void,
): Float32Array {
  const { x0, y0, res, cols, rows } = s;
  const out = new Float32Array(cols * rows).fill(NaN);
  if (pts.length > 0) {
    const c = criarCtx(pts, potencia, k);
    const n = c.n;
    // k >= n: todos os pontos em toda célula; senão, candidatos por bloco (calculados quando necessários)
    const todos = c.k >= n;
    const nBlocos = Math.ceil(cols / BLOCO);
    const cand = todos ? indicesTodos(n) : new Int32Array(nBlocos * n);
    const ncand = new Int32Array(nBlocos);
    const dc = new Float64Array(n);
    const tmp = new Float64Array(n);
    const nFaixas = Math.ceil(rows / BLOCO);
    const passo = Math.max(1, Math.ceil(nFaixas / 100));
    for (let f = 0; f < nFaixas; f++) {
      const r0 = f * BLOCO;
      const r1 = Math.min(rows, r0 + BLOCO);
      ncand.fill(todos ? n : -1);
      for (let row = r0; row < r1; row++) {
        const y = y0 - (row + 0.5) * res;
        const base = row * cols;
        for (let col = 0; col < cols; col++) {
          if (!mask[base + col]) continue;
          const b = todos ? 0 : (col / BLOCO) | 0;
          if (ncand[b] < 0) ncand[b] = candidatosBloco(c, s, r0, r1, b * BLOCO, cand, b * n, dc, tmp);
          out[base + col] = interpolar(c, x0 + (col + 0.5) * res, y, cand, b * n, ncand[b]);
        }
      }
      if (onProgress && (f + 1) % passo === 0 && f + 1 < nFaixas) onProgress(r1 / rows);
    }
  }
  onProgress?.(1);
  return out;
}
