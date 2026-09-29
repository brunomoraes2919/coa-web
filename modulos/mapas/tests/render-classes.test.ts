import { describe, expect, it } from 'vitest';
import type { Grid, Palette } from '../src/lib/types';
import { classesDoGrid } from '../src/render/classes';

const paleta = (id: string, maxs: number[]): Palette => ({
  id,
  nome: id,
  classes: maxs.map((max) => ({ max, color: '#000000', label: `<= ${max}` })),
});
const novoGrid = (vals: number[]): Grid => ({ x0: 0, y0: 0, res: 1, cols: 3, rows: 2, epsg: 31981, values: Float32Array.from(vals) });

describe('classesDoGrid', () => {
  const p1 = paleta('a', [1, 5, 10, 20]);
  const p2 = paleta('b', [50, 100]);

  it('classifica o grid e marca as classes presentes', () => {
    const c = classesDoGrid(novoGrid([0.5, 3, NaN, 3, 3, 100]), p1);
    expect(Array.from(c.idx)).toEqual([0, 1, 255, 1, 1, 3]);
    expect(c.presentes).toEqual([true, true, false, true]);
  });

  it('reaproveita o resultado para o mesmo grid e a mesma paleta', () => {
    const g = novoGrid([0.5, 3, NaN, 7, 3, 100]);
    const a = classesDoGrid(g, p1);
    expect(classesDoGrid(g, p1)).toBe(a);
  });

  it('recalcula quando a paleta muda', () => {
    const g = novoGrid([0.5, 3, NaN, 7, 3, 100]);
    const a = classesDoGrid(g, p1);
    const b = classesDoGrid(g, p2);
    expect(b).not.toBe(a);
    expect(Array.from(b.idx)).toEqual([0, 0, 255, 0, 0, 1]);
    expect(b.presentes).toEqual([true, true]);
    const c = classesDoGrid(g, p1);
    expect(Array.from(c.idx)).toEqual(Array.from(a.idx));
  });

  it('grids diferentes não compartilham o cache', () => {
    const a = classesDoGrid(novoGrid([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), p1);
    const b = classesDoGrid(novoGrid([15, 15, 15, 15, 15, 15]), p1);
    expect(a.presentes).toEqual([true, false, false, false]);
    expect(b.presentes).toEqual([false, false, false, true]);
  });
});
