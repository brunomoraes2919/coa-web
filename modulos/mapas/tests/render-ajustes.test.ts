import { describe, expect, it } from 'vitest';
import type { AreaCultura, Talhao } from '../src/lib/types';
import { comReticencias, limitarLinhas } from '../src/render/labels';
import { lonLatToMerc } from '../src/lib/projection';
import { areasDosQuadros } from '../src/render/mapFrame';

const medir = (t: string) => t.length; // 1 unidade por caractere

describe('reticências', () => {
  it('limitarLinhas: o que sobra vira "…" na última linha, que é encurtada até caber', () => {
    expect(limitarLinhas(['aaaa', 'bbbb', 'cccc'], 2, 4, medir)).toEqual(['aaaa', 'bbb…']);
    expect(limitarLinhas(['aa', 'bb'], 2, 4, medir)).toEqual(['aa', 'bb']);
    expect(limitarLinhas(['aa bb', 'cc'], 1, 10, medir)).toEqual(['aa bb…']);
    expect(limitarLinhas(['aa'], 0, 10, medir)).toEqual([]);
  });
  it('comReticencias não deixa espaço antes do "…"', () => {
    expect(comReticencias('abc de', 5, medir)).toBe('abc…');
  });
});

describe('areasDosQuadros', () => {
  const ret = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  const poli = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon' as const, coordinates: [ret(x0, y0, x1, y1)] });
  const t = (id: string, codigo: string | null, g = poli(0, 0, 0.01, 0.01)): Talhao => ({ id, fazendaId: 'f', nome: id, setor: null, areaHa: 1, geom: g, atributos: {}, codigo });
  const a = (id: string, codigo: string, g = poli(0, 0, 0.01, 0.01)): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo, areaHa: 1, geom: g });
  const bbox = (lon0: number, lat0: number, lon1: number, lat1: number): [number, number, number, number] => [
    ...lonLatToMerc(lon0, lat0),
    ...lonLatToMerc(lon1, lat1),
  ];
  // quadro norte: talhões 1 e 2 (lat 0..0,01); quadro sul: talhão 3 (lat -1..-0,99)
  const talhoes = [t('1', '001', poli(0, 0, 0.01, 0.01)), t('2', '002', poli(0.02, 0, 0.03, 0.01)), t('3', '003', poli(0, -1, 0.01, -0.99))];
  const grupos = [
    { ids: ['1', '2'], bbox: bbox(0, 0, 0.03, 0.01) },
    { ids: ['3'], bbox: bbox(0, -1, 0.01, -0.99) },
  ];

  it('cada área vai para o quadro do talhão base que contém o centróide dela, qualquer que seja o código', () => {
    const areas = [a('x', '001A', poli(0.002, 0.002, 0.004, 0.004)), a('y', '003', poli(0.002, -0.998, 0.004, -0.996)), a('w', '', poli(0.022, 0.002, 0.024, 0.004))];
    expect(areasDosQuadros(areas, talhoes, grupos).map((q) => q.map((x) => x.id))).toEqual([['x', 'w'], ['y']]);
  });

  it('área sem talhão base: quadro cujo bbox contém (ou fica mais perto do) centróide', () => {
    const areas = [a('longe', '', poli(0.5, -0.9, 0.51, -0.89)), a('entre', '', poli(0.012, 0.004, 0.018, 0.006))];
    expect(areasDosQuadros(areas, talhoes, grupos).map((q) => q.map((x) => x.id))).toEqual([['entre'], ['longe']]);
  });

  it('um quadro só: todas', () => {
    const areas = [a('x', '001')];
    expect(areasDosQuadros(areas, talhoes, [grupos[0]])).toEqual([areas]);
  });
});
