import { describe, expect, it } from 'vitest';
import { idwAt, idwGrid, type IdwPoint } from '../src/lib/idw';
import { cellCenter, gridSpecFromBounds } from '../src/lib/raster';

/** mulberry32: gerador determinístico */
function gerador(semente: number) {
  return () => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('idwAt', () => {
  it('com 1 ponto devolve o valor do ponto em qualquer lugar', () => {
    const pts: IdwPoint[] = [{ x: 10, y: 20, v: 42.5 }];
    // (v/d^p)/(1/d^p): igual a v até o último bit do double (mesma conta do GRASS)
    expect(idwAt(0, 0, pts, 4, 12)).toBeCloseTo(42.5, 10);
    expect(idwAt(1000, -300, pts, 2, 1)).toBeCloseTo(42.5, 10);
    expect(Math.fround(idwAt(3, 7, pts, 4, 12))).toBe(42.5);
  });

  it('com d = 0 devolve exatamente o valor do ponto', () => {
    const pts: IdwPoint[] = [
      { x: 0, y: 0, v: 5 },
      { x: 10, y: 0, v: 20.3 },
      { x: 0, y: 10, v: 30 },
    ];
    expect(idwAt(10, 0, pts, 4, 12)).toBe(20.3);
    expect(idwAt(0, 0, pts, 4, 2)).toBe(5);
  });

  it('dois pontos simétricos dão a média', () => {
    const pts: IdwPoint[] = [
      { x: -1, y: 0, v: 10 },
      { x: 1, y: 0, v: 20 },
    ];
    expect(idwAt(0, 0, pts, 4, 12)).toBeCloseTo(15, 12);
    expect(idwAt(0, 7, pts, 2, 12)).toBeCloseTo(15, 12);
  });

  it('pesa por 1/d^p', () => {
    const pts: IdwPoint[] = [
      { x: 1, y: 0, v: 10 }, // d = 1
      { x: 0, y: 2, v: 20 }, // d = 2
    ];
    // p = 2: pesos 1 e 1/4 → (10 + 5) / 1,25 = 12
    expect(idwAt(0, 0, pts, 2, 12)).toBeCloseTo(12, 12);
    // p = 4: pesos 1 e 1/16
    expect(idwAt(0, 0, pts, 4, 12)).toBeCloseTo((10 + 20 / 16) / (1 + 1 / 16), 12);
    // p = 3 (caminho genérico)
    expect(idwAt(0, 0, pts, 3, 12)).toBeCloseTo((10 + 20 / 8) / (1 + 1 / 8), 12);
  });

  it('k = 1 devolve o vizinho mais próximo', () => {
    const pts: IdwPoint[] = [
      { x: 100, y: 0, v: 1 },
      { x: 3, y: 4, v: 7 },
      { x: -6, y: 0, v: 9 },
    ];
    expect(idwAt(0, 0, pts, 4, 1)).toBe(7);
    expect(idwAt(-5, 0, pts, 4, 1)).toBe(9);
  });

  it('k < n usa só os k mais próximos; k >= n usa todos', () => {
    const pts: IdwPoint[] = [
      { x: 100, y: 0, v: 1000 },
      { x: 1, y: 0, v: 10 },
      { x: 0, y: 2, v: 20 },
    ];
    expect(idwAt(0, 0, pts, 2, 2)).toBeCloseTo(12, 12);
    const w = [1 / 10000, 1, 1 / 4];
    const esperado = (1000 * w[0] + 10 * w[1] + 20 * w[2]) / (w[0] + w[1] + w[2]);
    expect(idwAt(0, 0, pts, 2, 3)).toBeCloseTo(esperado, 12);
    expect(idwAt(0, 0, pts, 2, 50)).toBeCloseTo(esperado, 12);
  });

  it('empate na k-ésima distância fica com o ponto que vem antes (como o GRASS)', () => {
    const pts: IdwPoint[] = [
      { x: 1, y: 0, v: 10 },
      { x: 0, y: 1, v: 20 },
      { x: -1, y: 0, v: 30 },
    ];
    expect(idwAt(0, 0, pts, 4, 2)).toBeCloseTo(15, 12);
  });

  it('sem pontos devolve NaN', () => {
    expect(idwAt(0, 0, [], 4, 12)).toBeNaN();
  });
});

describe('idwGrid', () => {
  it('respeita a máscara (NaN fora) e interpola no centro da célula', () => {
    const s = gridSpecFromBounds(0, 0, 20, 15, 5); // 4 × 3
    const mask = new Uint8Array([1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0]);
    const pts: IdwPoint[] = [
      { x: 2.5, y: 12.5, v: 50 }, // exatamente no centro da célula (0, 0)
      { x: 30, y: 0, v: 10 },
      { x: -10, y: -10, v: 30 },
    ];
    const g = idwGrid(s, mask, pts, 4, 12);
    expect(g).toBeInstanceOf(Float32Array);
    expect(g.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      if (!mask[i]) expect(g[i]).toBeNaN();
      else {
        const [x, y] = cellCenter(s, i % 4, Math.floor(i / 4));
        expect(g[i]).toBe(Math.fround(idwAt(x, y, pts, 4, 12)));
      }
    }
    expect(g[0]).toBe(50);
  });

  it('é idêntico a idwAt em cada célula com k < n (pontos aleatórios)', () => {
    const r = gerador(7);
    const s = gridSpecFromBounds(1000, 2000, 1000 + 5 * 97, 2000 + 5 * 61, 5);
    const mask = new Uint8Array(s.cols * s.rows);
    for (let i = 0; i < mask.length; i++) mask[i] = r() < 0.9 ? 1 : 0;
    const pts: IdwPoint[] = [];
    for (let i = 0; i < 25; i++)
      pts.push({ x: 900 + r() * 700, y: 1900 + r() * 500, v: Math.round(r() * 3000) / 10 });
    const [cx, cy] = cellCenter(s, 10, 10);
    pts.push({ x: cx, y: cy, v: 77 }); // PIC exatamente no centro de uma célula
    for (const [p, k] of [
      [4, 12],
      [2, 5],
      [3, 1],
      [4, 26],
    ]) {
      const g = idwGrid(s, mask, pts, p, k);
      let diferentes = 0;
      for (let row = 0; row < s.rows; row++)
        for (let col = 0; col < s.cols; col++) {
          const i = row * s.cols + col;
          if (!mask[i]) {
            if (!Number.isNaN(g[i])) diferentes++;
            continue;
          }
          const [x, y] = cellCenter(s, col, row);
          if (g[i] !== Math.fround(idwAt(x, y, pts, p, k))) diferentes++;
        }
      expect(diferentes).toBe(0);
      if (mask[10 * s.cols + 10]) expect(g[10 * s.cols + 10]).toBe(77);
    }
  });

  it('é idêntico a idwAt com muitos empates exatos (pontos em reticulado alinhado às células)', () => {
    const s = gridSpecFromBounds(0, 0, 5 * 70, 5 * 45, 5);
    const mask = new Uint8Array(s.cols * s.rows).fill(1);
    const pts: IdwPoint[] = [];
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 4; j++) pts.push({ x: 2.5 + 60 * i, y: 2.5 + 60 * j, v: 10 * i + j + 0.25 * ((i * 7 + j * 3) % 5) });
    for (const k of [1, 3, 4, 12]) {
      const g = idwGrid(s, mask, pts, 4, k);
      let diferentes = 0;
      for (let row = 0; row < s.rows; row++)
        for (let col = 0; col < s.cols; col++) {
          const [x, y] = cellCenter(s, col, row);
          if (g[row * s.cols + col] !== Math.fround(idwAt(x, y, pts, 4, k))) diferentes++;
        }
      expect(diferentes).toBe(0);
    }
  });

  it('informa o progresso no máximo ~100 vezes, crescente, terminando em 1', () => {
    const s = gridSpecFromBounds(0, 0, 5 * 50, 5 * 1000, 5); // 1000 linhas
    const mask = new Uint8Array(s.cols * s.rows).fill(1);
    const pts: IdwPoint[] = [
      { x: 0, y: 0, v: 1 },
      { x: 250, y: 5000, v: 2 },
      { x: 100, y: 2000, v: 3 },
    ];
    const fs: number[] = [];
    idwGrid(s, mask, pts, 4, 12, (f) => fs.push(f));
    expect(fs.length).toBeGreaterThan(1);
    expect(fs.length).toBeLessThanOrEqual(102);
    for (let i = 1; i < fs.length; i++) expect(fs[i]).toBeGreaterThanOrEqual(fs[i - 1]);
    expect(fs[fs.length - 1]).toBe(1);
  });

  it('desempenho: 2000 × 2000 células com 40 PICs em menos de 5 s', () => {
    const r = gerador(2026);
    const s = gridSpecFromBounds(0, 0, 10000, 10000, 5);
    const mask = new Uint8Array(s.cols * s.rows).fill(1);
    const pts: IdwPoint[] = [];
    for (let i = 0; i < 40; i++) pts.push({ x: r() * 10000, y: r() * 10000, v: r() * 300 });
    const t0 = performance.now();
    const g = idwGrid(s, mask, pts, 4, 12);
    const ms = performance.now() - t0;
    console.log(`idwGrid 2000×2000, 40 pontos, k = 12: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
    // amostra de conferência contra idwAt
    for (let i = 0; i < 200; i++) {
      const col = Math.floor(r() * s.cols);
      const row = Math.floor(r() * s.rows);
      const [x, y] = cellCenter(s, col, row);
      expect(g[row * s.cols + col]).toBe(Math.fround(idwAt(x, y, pts, 4, 12)));
    }
  }, 60_000);
});
