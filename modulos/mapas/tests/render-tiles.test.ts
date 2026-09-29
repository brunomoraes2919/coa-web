import { describe, expect, it } from 'vitest';
import { lonLatToMerc } from '../src/lib/projection';
import { criarVista } from '../src/render/mapFrame';
import { dividirOrcamentoTiles, MAX_TILES, MIN_TILES_QUADRO, planejarTiles } from '../src/render/tiles';
import type { TileSource } from '../src/render/types';

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('dividirOrcamentoTiles', () => {
  it('um quadro fica com o orçamento inteiro (400)', () => {
    expect(dividirOrcamentoTiles([333 * 288])).toEqual([400]);
  });

  it('proporcional à área dos quadros', () => {
    expect(dividirOrcamentoTiles([2, 1, 1])).toEqual([200, 100, 100]);
    expect(dividirOrcamentoTiles([1, 1])).toEqual([200, 200]);
  });

  it('mínimo de 60 por quadro; o resto é redividido entre os demais', () => {
    const c = dividirOrcamentoTiles([100, 5, 5]);
    expect(c.slice(1)).toEqual([MIN_TILES_QUADRO, MIN_TILES_QUADRO]);
    expect(c[0]).toBe(400 - 2 * MIN_TILES_QUADRO);
  });

  it('a soma nunca passa de 400 (inclusive com áreas quebradas, zeradas ou quadros demais)', () => {
    const casos = [[1, 1, 1], [333 * 95, 333 * 97.3, 333 * 87.7], [0, 0, 0], [Number.NaN, 1, 2], [1, 1, 1, 1, 1, 1, 1, 1], [3, 7]];
    for (const areas of casos) {
      const c = dividirOrcamentoTiles(areas);
      expect(c).toHaveLength(areas.length);
      expect(soma(c)).toBeLessThanOrEqual(MAX_TILES);
      c.forEach((x) => expect(Number.isInteger(x) && x >= 1).toBe(true));
    }
    // 8 quadros × 60 > 400: divide igualmente
    expect(dividirOrcamentoTiles([1, 1, 1, 1, 1, 1, 1, 1])).toEqual(Array(8).fill(50));
    // aleatório
    for (let k = 0; k < 200; k++) {
      const n = 1 + (k % 3);
      const areas = Array.from({ length: n }, (_, i) => ((k * 7919 + i * 104729) % 1000) + 1);
      expect(soma(dividirOrcamentoTiles(areas))).toBeLessThanOrEqual(MAX_TILES);
    }
  });
});

describe('planejarTiles com cota', () => {
  const fonte: TileSource = { url: () => '', maxZoom: 19, atribuicao: '', clarear: 0 };
  // quadro grande em 600 dpi: no zoom natural passaria de 400 tiles
  const [cx, cy] = lonLatToMerc(-58.9, -13.4);
  const v = criarVista({ cx, cy, mPorMm: 100 }, 600 / 25.4);

  it('respeita o máximo recebido reduzindo o zoom', () => {
    const livre = planejarTiles(v, fonte, 100000);
    expect(livre.lista.length).toBeGreaterThan(400);
    const padrao = planejarTiles(v, fonte);
    expect(padrao.lista.length).toBeLessThanOrEqual(400);
    const cota = planejarTiles(v, fonte, 120);
    expect(cota.lista.length).toBeLessThanOrEqual(120);
    expect(cota.z).toBeLessThan(livre.z);
  });
});
