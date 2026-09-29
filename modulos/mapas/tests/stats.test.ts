import { describe, expect, it } from 'vitest';
import { statsMascara, statsZonas } from '../src/lib/stats';

describe('statsZonas', () => {
  it('calcula média, mínimo, máximo e área por zona, ignorando NaN e células fora', () => {
    const values = new Float32Array([1, 2, 3, 4, NaN, 6, 8]);
    const zonas = new Int32Array([0, 0, 1, 1, 1, -1, 0]);
    const r = statsZonas(values, zonas, 3, 25);
    expect(r).toHaveLength(3);
    expect(r[0].media).toBeCloseTo(11 / 3, 6);
    expect(r[0].min).toBe(1);
    expect(r[0].max).toBe(8);
    expect(r[0].areaHa).toBeCloseTo((3 * 25) / 10000, 12);
    expect(r[1]).toEqual({ media: 3.5, min: 3, max: 4, areaHa: (2 * 25) / 10000 });
  });

  it('zona sem célula válida → NaN/NaN/NaN e área 0', () => {
    const values = new Float32Array([NaN, 5]);
    const zonas = new Int32Array([0, 1]);
    const r = statsZonas(values, zonas, 3, 25);
    expect(r[0].media).toBeNaN();
    expect(r[0].min).toBeNaN();
    expect(r[0].max).toBeNaN();
    expect(r[0].areaHa).toBe(0);
    expect(r[2].media).toBeNaN();
    expect(r[2].areaHa).toBe(0);
    expect(r[1]).toEqual({ media: 5, min: 5, max: 5, areaHa: 0.0025 });
  });

  it('ignora índices de zona fora do intervalo', () => {
    const r = statsZonas(new Float32Array([1, 2]), new Int32Array([5, 0]), 1, 100);
    expect(r).toEqual([{ media: 2, min: 2, max: 2, areaHa: 0.01 }]);
  });
});

describe('statsMascara', () => {
  it('considera só as células incluídas e com valor', () => {
    const values = new Float32Array([10, 20, NaN, 40, 50]);
    const r = statsMascara(values, (i) => i !== 4, 25);
    expect(r.media).toBeCloseTo(70 / 3, 5);
    expect(r.min).toBe(10);
    expect(r.max).toBe(40);
    expect(r.areaHa).toBeCloseTo(0.0075, 12);
  });

  it('sem células → NaN e área 0', () => {
    const r = statsMascara(new Float32Array([1, NaN]), (i) => i === 1, 25);
    expect(r.media).toBeNaN();
    expect(r.min).toBeNaN();
    expect(r.max).toBeNaN();
    expect(r.areaHa).toBe(0);
  });
});
