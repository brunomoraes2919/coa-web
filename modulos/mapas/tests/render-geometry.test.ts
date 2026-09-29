import { describe, expect, it } from 'vitest';
import { lonLatToMerc } from '../src/lib/projection';
import type { Talhao } from '../src/lib/types';
import { autoExtent, mapFrameRectMm } from '../src/render/layout';
import {
  graticuleStep,
  mercToFramePx,
  niceScaleBar,
  tileBounds,
  tileRange,
  tileZoomFor,
} from '../src/render/geometry';

const RES0 = 156543.03392804097; // m/px do tile no zoom 0, no equador
const MEIO_MUNDO = 20037508.342789244;

describe('mercToFramePx', () => {
  const ext = { cx: -6345210.975, cy: -1574216.548, mPorMm: 100 };

  it('leva o centro do extent ao centro do quadro', () => {
    const f = mercToFramePx(ext, 333, 288, 10);
    const [x, y] = f(ext.cx, ext.cy);
    expect(x).toBeCloseTo(1665, 9);
    expect(y).toBeCloseTo(1440, 9);
  });

  it('x cresce para leste e y cresce para o sul (100 m Mercator = 1 mm = 10 px)', () => {
    const f = mercToFramePx(ext, 333, 288, 10);
    const [x, y] = f(ext.cx + 1000, ext.cy + 500);
    expect(x).toBeCloseTo(1665 + 100, 9);
    expect(y).toBeCloseTo(1440 - 50, 9);
  });

  it('escala com pxPorMm (resolução independente)', () => {
    const a = mercToFramePx(ext, 333, 288, 2)(ext.cx - 3000, ext.cy - 1000);
    const b = mercToFramePx(ext, 333, 288, 20)(ext.cx - 3000, ext.cy - 1000);
    expect(b[0]).toBeCloseTo(a[0] * 10, 9);
    expect(b[1]).toBeCloseTo(a[1] * 10, 9);
  });
});

describe('niceScaleBar', () => {
  const SERIE = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];

  it('escolhe 2.500 m para ~128 m/mm (mapa de referência: 0 – 2.500 – 5.000 m)', () => {
    const r = niceScaleBar(128.5);
    expect(r.segmentoM).toBe(2500);
    expect(r.segmentoMm).toBeCloseTo(2500 / 128.5, 9);
  });

  it('dois segmentos ficam perto do alvo de 40 mm', () => {
    expect(niceScaleBar(10).segmentoM).toBe(200);
    expect(niceScaleBar(50).segmentoM).toBe(1000);
    expect(niceScaleBar(250).segmentoM).toBe(5000);
  });

  it('respeita o alvo informado', () => {
    expect(niceScaleBar(128.5, 80).segmentoM).toBe(5000);
    expect(niceScaleBar(128.5, 20).segmentoM).toBe(1000);
  });

  it('no zoom máximo (0,5 m/mm) usa segmentos de 10, 20, 25 e 50 m', () => {
    expect(niceScaleBar(0.5).segmentoM).toBe(10);
    expect(niceScaleBar(1).segmentoM).toBe(20);
    expect(niceScaleBar(1.25).segmentoM).toBe(25);
    expect(niceScaleBar(2.5).segmentoM).toBe(50);
    // a barra continua perto do alvo de 40 mm (não vira um tracinho nem passa do quadro)
    const r = niceScaleBar(0.5);
    expect(2 * r.segmentoMm).toBeCloseTo(40, 6);
  });

  it('limita aos extremos da série', () => {
    expect(niceScaleBar(0.05).segmentoM).toBe(10);
    expect(niceScaleBar(1e6).segmentoM).toBe(20000);
  });

  it('sempre usa um valor da série e segmentoMm = segmentoM / metrosPorMm', () => {
    for (let m = 0.3; m < 5000; m *= 1.37) {
      const r = niceScaleBar(m);
      expect(SERIE).toContain(r.segmentoM);
      expect(r.segmentoMm).toBeCloseTo(r.segmentoM / m, 9);
    }
  });
});

describe('graticuleStep', () => {
  it('escolhe passos da série para vãos típicos', () => {
    expect(graticuleStep(0.39)).toBe(0.1);
    expect(graticuleStep(0.08)).toBe(0.02);
    expect(graticuleStep(0.04)).toBe(0.01);
    expect(graticuleStep(2)).toBe(0.5);
  });

  it('gera entre 2 e 5 marcas', () => {
    for (let span = 0.02; span <= 5; span *= 1.21) {
      const n = span / graticuleStep(span);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('limita aos extremos da série', () => {
    expect(graticuleStep(0.001)).toBe(0.01);
    expect(graticuleStep(40)).toBe(1);
  });
});

describe('tileZoomFor', () => {
  it('zoom 0 no equador com a resolução do tile 0', () => {
    expect(tileZoomFor(RES0, 0, 19)).toBe(0);
  });

  it('zoom 10 com 1/1024 dessa resolução', () => {
    expect(tileZoomFor(RES0 / 1024, 0, 19)).toBe(10);
  });

  it('usa metros no terreno (considera a latitude)', () => {
    expect(tileZoomFor((RES0 * 0.5) / 1024, 60, 19)).toBe(10);
  });

  it('arredonda para o zoom mais próximo', () => {
    expect(tileZoomFor(RES0 / 2 ** 13.4, 0, 19)).toBe(13);
    expect(tileZoomFor(RES0 / 2 ** 13.6, 0, 19)).toBe(14);
  });

  it('limita entre 0 e maxZoom', () => {
    expect(tileZoomFor(0.001, 0, 19)).toBe(19);
    expect(tileZoomFor(0.001, 0, 17)).toBe(17);
    expect(tileZoomFor(1e9, 0, 19)).toBe(0);
  });
});

describe('tileRange / tileBounds', () => {
  it('no zoom 0 há um único tile', () => {
    expect(tileRange(-1000, -1000, 1000, 1000, 0)).toEqual({ x0: 0, x1: 0, y0: 0, y1: 0 });
  });

  it('no zoom 1 um retângulo na origem pega os 4 tiles; y cresce para o sul', () => {
    expect(tileRange(-1, -1, 1, 1, 1)).toEqual({ x0: 0, x1: 1, y0: 0, y1: 1 });
    expect(tileRange(-5e6, -5e6, -4e6, -4e6, 1)).toEqual({ x0: 0, x1: 0, y0: 1, y1: 1 });
  });

  it('limita aos tiles existentes', () => {
    expect(tileRange(-3e7, -3e7, 3e7, 3e7, 2)).toEqual({ x0: 0, x1: 3, y0: 0, y1: 3 });
  });

  it('tileBounds devolve o retângulo Mercator do tile', () => {
    expect(tileBounds(0, 0, 0)).toEqual([-MEIO_MUNDO, -MEIO_MUNDO, MEIO_MUNDO, MEIO_MUNDO]);
    const [minX, minY, maxX, maxY] = tileBounds(1, 0, 1);
    expect(minX).toBeCloseTo(-MEIO_MUNDO, 6);
    expect(maxX).toBeCloseTo(0, 6);
    expect(minY).toBeCloseTo(-MEIO_MUNDO, 6);
    expect(maxY).toBeCloseTo(0, 6);
  });

  it('o tile que contém um ponto o envolve', () => {
    const [mx, my] = [-6345210.975, -1574216.548];
    const z = 14;
    const r = tileRange(mx, my, mx, my, z);
    const [minX, minY, maxX, maxY] = tileBounds(z, r.x0, r.y0);
    expect(mx).toBeGreaterThanOrEqual(minX);
    expect(mx).toBeLessThan(maxX);
    expect(my).toBeGreaterThan(minY);
    expect(my).toBeLessThanOrEqual(maxY);
  });
});

describe('mapFrameRectMm / autoExtent', () => {
  const talhao = (lon0: number, lat0: number, lon1: number, lat1: number): Talhao => ({
    id: `${lon0}`,
    fazendaId: 'f',
    nome: 'T',
    setor: null,
    areaHa: 1,
    geom: { type: 'Polygon', coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] },
    atributos: {},
    codigo: null,
  });

  it('quadro do mapa A3 em mm', () => {
    expect(mapFrameRectMm()).toEqual({ x: 5, y: 4.4, w: 333, h: 288 });
  });

  it('centraliza o bbox Mercator dos talhões', () => {
    const ext = autoExtent([talhao(-57.1, -14.05, -57.0, -14.0), talhao(-56.95, -13.95, -56.9, -13.9)]);
    const [x0, y0] = lonLatToMerc(-57.1, -14.05);
    const [x1, y1] = lonLatToMerc(-56.9, -13.9);
    expect(ext.cx).toBeCloseTo((x0 + x1) / 2, 6);
    expect(ext.cy).toBeCloseTo((y0 + y1) / 2, 6);
  });

  it('deixa 6% de margem na dimensão que limita e cabe na outra', () => {
    const talhoes = [talhao(-57.2, -14.0, -56.9, -13.95)]; // bem mais largo que alto
    const ext = autoExtent(talhoes);
    const f = mercToFramePx(ext, 333, 288, 1);
    const [ax, ay] = f(...lonLatToMerc(-57.2, -13.95));
    const [bx, by] = f(...lonLatToMerc(-56.9, -14.0));
    expect(ax).toBeCloseTo(333 * 0.06, 6);
    expect(bx).toBeCloseTo(333 * 0.94, 6);
    expect(ay).toBeGreaterThan(288 * 0.06);
    expect(by).toBeLessThan(288 * 0.94);
  });

  it('usa multipolígonos e ignora listas vazias sem gerar NaN', () => {
    const ext = autoExtent([]);
    expect(Number.isFinite(ext.cx) && Number.isFinite(ext.cy) && ext.mPorMm > 0).toBe(true);
    const multi: Talhao = {
      ...talhao(0, 0, 0, 0),
      geom: {
        type: 'MultiPolygon',
        coordinates: [
          [[[-57, -14], [-56.99, -14], [-56.99, -13.99], [-57, -14]]],
          [[[-56.9, -14], [-56.89, -14], [-56.89, -13.99], [-56.9, -14]]],
        ],
      },
    };
    const e2 = autoExtent([multi]);
    expect(e2.cx).toBeCloseTo((lonLatToMerc(-57, -14)[0] + lonLatToMerc(-56.89, -14)[0]) / 2, 6);
  });
});
