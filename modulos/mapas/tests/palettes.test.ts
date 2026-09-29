import { describe, expect, it } from 'vitest';
import { autoPalette, buildClassIndex, classify, getPalette, hexToRgb, PALETTES, resolvePalette } from '../src/lib/palettes';

describe('paletas', () => {
  it('carrega as paletas do COA', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(5);
    expect(getPalette('locks_0_160').classes).toHaveLength(18);
    expect(() => getPalette('nao-existe')).toThrow();
  });

  it('classifica como o DISCRETE do QGIS (v <= max)', () => {
    const p = getPalette('locks_0_160');
    expect(classify(0, p)).toBe(0);
    expect(classify(1, p)).toBe(0);
    expect(classify(1.01, p)).toBe(1);
    expect(classify(5, p)).toBe(1);
    expect(classify(160, p)).toBe(17);
    expect(classify(999, p)).toBe(17);
    expect(classify(NaN, p)).toBe(-1);
  });

  it('escolhe a paleta automática pela chuva máxima', () => {
    expect(autoPalette(12).id).toBe('locks_0_160');
    expect(autoPalette(160).id).toBe('locks_0_160');
    expect(autoPalette(385).id).toBe('acum_atual');
    expect(autoPalette(2000).id).toBe('acum_atual');
    expect(autoPalette(2300).id).toBe('acum_anual');
    expect(resolvePalette('auto', 40).id).toBe('locks_0_160');
    expect(resolvePalette('acum_v2', 40).id).toBe('acum_v2');
  });

  it('gera o índice de classes com 255 para sem dado', () => {
    const p = getPalette('locks_0_160');
    const idx = buildClassIndex(new Float32Array([0, 7, NaN, 200]), p);
    expect(Array.from(idx)).toEqual([0, 2, 255, 17]);
  });

  it('converte hex em rgb', () => {
    expect(hexToRgb('#0C5A50')).toEqual([12, 90, 80]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
  });
});
