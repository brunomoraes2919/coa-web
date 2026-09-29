import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bboxDe, centroideDe, pontoNaGeometria, talhaoBaseDaArea, vincularAreas } from '../src/lib/areasEspacial';
import type { Geometry, Talhao } from '../src/lib/types';

const ret = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const poli = (...aneis: [number, number][][]): Geometry => ({ type: 'Polygon', coordinates: aneis });
const talhao = (id: string, geom: Geometry, codigo: string | null = null, setor: string | null = null): Talhao => ({
  id,
  fazendaId: 'f',
  nome: id,
  setor,
  areaHa: 1,
  geom,
  atributos: {},
  codigo,
});

describe('pontoNaGeometria', () => {
  const comFuro = poli(ret(0, 0, 10, 10), ret(4, 4, 6, 6));
  it('Polygon com furo: dentro, no furo e fora', () => {
    expect(pontoNaGeometria(1, 1, comFuro)).toBe(true);
    expect(pontoNaGeometria(5, 5, comFuro)).toBe(false);
    expect(pontoNaGeometria(11, 5, comFuro)).toBe(false);
  });
  it('MultiPolygon: qualquer uma das partes', () => {
    const mp: Geometry = { type: 'MultiPolygon', coordinates: [[ret(0, 0, 1, 1)], [ret(5, 5, 6, 6)]] };
    expect(pontoNaGeometria(5.5, 5.5, mp)).toBe(true);
    expect(pontoNaGeometria(3, 3, mp)).toBe(false);
  });
});

describe('centroideDe e bboxDe', () => {
  it('média dos vértices do anel externo (sem repetir o fechamento)', () => {
    expect(centroideDe(poli(ret(0, 0, 4, 2)))).toEqual([2, 1]);
  });
  it('MultiPolygon: centróide da maior parte', () => {
    const mp: Geometry = { type: 'MultiPolygon', coordinates: [[ret(0, 0, 1, 1)], [ret(10, 10, 20, 20)]] };
    expect(centroideDe(mp)).toEqual([15, 15]);
    expect(bboxDe(mp)).toEqual([0, 0, 20, 20]);
  });
});

describe('talhaoBaseDaArea', () => {
  const t032 = talhao('t032', poli(ret(0, 0, 10, 10)), '032');
  const t033 = talhao('t033', poli(ret(10, 0, 20, 10)), '033');
  const talhoes = [t032, t033];

  it('talhão base cujo polígono contém o centróide da área, independentemente do código', () => {
    expect(talhaoBaseDaArea({ geom: poli(ret(1, 1, 3, 3)), codigo: '032A' }, talhoes)).toBe(t032);
    expect(talhaoBaseDaArea({ geom: poli(ret(12, 1, 18, 9)), codigo: '999' }, talhoes)).toBe(t033);
  });

  it('centróide em nenhum talhão: o de maior sobreposição de bbox; sem sobreposição: null', () => {
    const fora = poli(ret(21, 1, 25, 9));
    expect(talhaoBaseDaArea({ geom: fora, codigo: '' }, talhoes)).toBeNull();
    // centróide (13,5; 10) na borda norte dos dois talhões (fora pela regra par-ímpar); o bbox
    // sobrepõe 2 un² do 032 e 9 un² do 033
    const cruza = poli(ret(8, 9, 19, 11));
    expect(talhaoBaseDaArea({ geom: cruza, codigo: '' }, talhoes)).toBe(t033);
    const semNada = poli(ret(8, 10.5, 19, 12));
    expect(talhaoBaseDaArea({ geom: semNada, codigo: '' }, talhoes)).toBeNull();
  });

  it('centróide em dois talhões sobrepostos: prefere o do mesmo código', () => {
    const a = talhao('a', poli(ret(0, 0, 10, 10)), '001');
    const b = talhao('b', poli(ret(0, 0, 10, 10)), '002');
    expect(talhaoBaseDaArea({ geom: poli(ret(1, 1, 2, 2)), codigo: '002' }, [a, b])).toBe(b);
    expect(talhaoBaseDaArea({ geom: poli(ret(1, 1, 2, 2)), codigo: '' }, [a, b])).toBe(a);
  });

  it('vincularAreas: id da área → talhão base (ou null)', () => {
    const m = vincularAreas(
      [
        { id: 'x', geom: poli(ret(1, 1, 3, 3)), codigo: '032A' },
        { id: 'y', geom: poli(ret(30, 30, 31, 31)), codigo: '' },
      ],
      talhoes,
    );
    expect(m.get('x')).toBe(t032);
    expect(m.get('y')).toBeNull();
  });
});

const SEED = 'public/dados/seed';
const temSeed = existsSync(`${SEED}/base/SIRIEMA.geojson`) && existsSync(`${SEED}/soja-26-27/DOURADO.geojson`);

interface Fc {
  features: { properties: Record<string, string | null>; geometry: Geometry }[];
}
const ler = (arq: string) => JSON.parse(readFileSync(`${SEED}/${arq}`, 'utf8')) as Fc;

describe.skipIf(!temSeed)('talhaoBaseDaArea — seed real', () => {
  it('Siriema: 023A e 017A ficam nos talhões base 023 e 017 (setor SÃO MIGUEL); 009 ganha um talhão', () => {
    const base = ler('base/SIRIEMA.geojson').features.map((f, i) => talhao(`b${i}`, f.geometry, f.properties.codigo, f.properties.setor));
    const areas = ler('soja-26-27/SIRIEMA.geojson').features.map((f, i) => ({ id: `a${i}`, geom: f.geometry, codigo: f.properties.codigo ?? '' }));
    const vinc = vincularAreas(areas, base);
    const baseDe = (codigo: string) => vinc.get(areas.find((a) => a.codigo === codigo)!.id);
    expect(baseDe('023A')).toMatchObject({ codigo: '023', setor: 'SÃO MIGUEL' });
    expect(baseDe('017A')).toMatchObject({ codigo: '017', setor: 'SÃO MIGUEL' });
    expect(baseDe('009')).not.toBeNull();
  });

  it('Dourado: 032A e 032B dentro do 032', () => {
    const base = ler('base/DOURADO.geojson').features.map((f, i) => talhao(`b${i}`, f.geometry, f.properties.codigo));
    const areas = ler('soja-26-27/DOURADO.geojson').features.map((f, i) => ({ id: `a${i}`, geom: f.geometry, codigo: f.properties.codigo ?? '' }));
    const vinc = vincularAreas(areas, base);
    for (const c of ['032A', '032B']) expect(vinc.get(areas.find((a) => a.codigo === c)!.id)?.codigo).toBe('032');
  });
});
