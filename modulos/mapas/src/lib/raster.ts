import type { MultiPolyXY, PolyXY } from './projection';
import type { GridSpec } from './types';

/** Grade ancorada no canto superior esquerdo (x0 = minX, y0 = maxY); linha 0 = norte. */
export function gridSpecFromBounds(minX: number, minY: number, maxX: number, maxY: number, res: number): GridSpec {
  return {
    x0: minX,
    y0: maxY,
    res,
    cols: Math.ceil((maxX - minX) / res),
    rows: Math.ceil((maxY - minY) / res),
  };
}

/** Centro da célula (col, row) em coordenadas da grade. */
export function cellCenter(s: GridSpec, col: number, row: number): [number, number] {
  return [s.x0 + (col + 0.5) * s.res, s.y0 - (row + 0.5) * s.res];
}

/** Arestas de um polígono (anel externo + buracos) em arrays planos: [xa, ya, xb, yb] por aresta. */
function arestas(poly: PolyXY): { e: Float64Array; n: number; minY: number; maxY: number } {
  let total = 0;
  for (const ring of poly) total += ring.length;
  const e = new Float64Array(total * 4);
  let n = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of poly) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const [xa, ya] = ring[i];
      const [xb, yb] = ring[(i + 1) % m];
      if (ya === yb) continue; // horizontal (ou fechamento repetido): nunca cruza a linha de varredura
      e[n * 4] = xa;
      e[n * 4 + 1] = ya;
      e[n * 4 + 2] = xb;
      e[n * 4 + 3] = yb;
      n++;
      if (ya < minY) minY = ya;
      if (yb < minY) minY = yb;
      if (ya > maxY) maxY = ya;
      if (yb > maxY) maxY = yb;
    }
  }
  return { e, n, minY, maxY };
}

/**
 * Preenche com `valor` as células cujo centro está dentro do polígono (regra par-ímpar sobre todos os
 * anéis, então buracos ficam de fora). Semiaberto: centro exatamente na borda direita/superior fica fora.
 */
function preencherPoligono(s: GridSpec, poly: PolyXY, out: Int32Array, valor: number, xs: Float64Array): void {
  const { e, n, minY, maxY } = arestas(poly);
  if (n === 0) return;
  const { x0, y0, res, cols, rows } = s;
  // linhas cujo centro y = y0 - (row + 0,5)·res está em [minY, maxY]
  const r0 = Math.max(0, Math.ceil((y0 - maxY) / res - 0.5));
  const r1 = Math.min(rows - 1, Math.floor((y0 - minY) / res - 0.5));
  for (let row = r0; row <= r1; row++) {
    const y = y0 - (row + 0.5) * res;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const ya = e[i * 4 + 1];
      const yb = e[i * 4 + 3];
      if (ya > y !== yb > y) {
        const xa = e[i * 4];
        const xb = e[i * 4 + 2];
        xs[k++] = xa + ((y - ya) / (yb - ya)) * (xb - xa);
      }
    }
    if (k < 2) continue;
    const v = xs.subarray(0, k).sort();
    const base = row * cols;
    for (let p = 0; p + 1 < k; p += 2) {
      // colunas com centro x em [v[p], v[p+1])
      const c0 = Math.max(0, Math.ceil((v[p] - x0) / res - 0.5));
      const c1 = Math.min(cols, Math.ceil((v[p + 1] - x0) / res - 0.5));
      if (c1 > c0) out.fill(valor, base + c0, base + c1);
    }
  }
}

/**
 * Rasteriza zonas (cada uma um multipolígono) pelo centro da célula.
 * Retorna o índice da zona por célula; -1 fora de todas. Zonas posteriores sobrescrevem as anteriores.
 */
export function rasterizeZones(s: GridSpec, zonas: MultiPolyXY[]): Int32Array {
  const out = new Int32Array(s.cols * s.rows).fill(-1);
  let maxArestas = 0;
  for (const z of zonas) for (const poly of z) {
    let t = 0;
    for (const ring of poly) t += ring.length;
    if (t > maxArestas) maxArestas = t;
  }
  const xs = new Float64Array(maxArestas);
  zonas.forEach((z, idx) => {
    for (const poly of z) preencherPoligono(s, poly, out, idx, xs);
  });
  return out;
}

/**
 * Dilatação por um disco (dx² + dy² <= r², em células). Só as células de borda da máscara (com algum
 * vizinho-4 vazio) carimbam o disco: a célula da máscara mais próxima de qualquer ponto de fora é de borda,
 * então o resultado é idêntico ao de carimbar todas.
 */
export function dilate(mask: Uint8Array, s: GridSpec, raioCelulas: number): Uint8Array {
  const { cols, rows } = s;
  const out = new Uint8Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 1 : 0;
  const r = Math.max(0, Math.floor(raioCelulas));
  if (r === 0) return out;
  // meia-largura do disco em cada deslocamento de linha
  const meia = new Int32Array(2 * r + 1);
  for (let dy = -r; dy <= r; dy++) meia[dy + r] = Math.floor(Math.sqrt(r * r - dy * dy));
  for (let row = 0; row < rows; row++) {
    const base = row * cols;
    for (let col = 0; col < cols; col++) {
      const i = base + col;
      if (!mask[i]) continue;
      const borda =
        col === 0 || col === cols - 1 || row === 0 || row === rows - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - cols] || !mask[i + cols];
      if (!borda) continue;
      const l0 = Math.max(0, row - r);
      const l1 = Math.min(rows - 1, row + r);
      for (let l = l0; l <= l1; l++) {
        const w = meia[l - row + r];
        const c0 = Math.max(0, col - w);
        const c1 = Math.min(cols - 1, col + w);
        out.fill(1, l * cols + c0, l * cols + c1 + 1);
      }
    }
  }
  return out;
}
