import { describe, expect, it } from 'vitest';
import { ehAreaSintetica, filtrarAreasPorSetor, plantadosSemArea, talhoesParaInterpolacao } from '../src/lib/mascaraCultura';
import type { AreaCultura, PlantioPimsTalhao, StatusPlantio, Talhao } from '../src/lib/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (id: string, codigo: string | null, setor: string | null = null): Talhao => ({
  id,
  fazendaId: 'f',
  nome: id.toUpperCase(),
  setor,
  areaHa: 10,
  geom,
  atributos: {},
  codigo,
});
const area = (id: string, codigo: string): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo, areaHa: 5, geom });
const pims = (codigo: string, status: StatusPlantio, setor: string | null = null): PlantioPimsTalhao => ({
  codigo,
  codigoPims: codigo,
  setor,
  status,
  areaPrevista: 100,
  areaPlantada: 0,
  inicio: null,
  fim: null,
  variedade: null,
});

describe('talhoesParaInterpolacao', () => {
  it('base + uma entrada por área sem talhão base do mesmo código (antes dos base: na sobreposição a célula fica com o talhão base)', () => {
    const base = [talhao('a', '001'), talhao('b', '002')];
    const areas = [area('x', '1'), area('y', '046'), area('z', '')];
    const r = talhoesParaInterpolacao(base, areas);
    expect(r.map((t) => t.id)).toEqual(['y', 'z', 'a', 'b']);
    expect(r[0]).toMatchObject({ id: 'y', fazendaId: 'f', nome: '046', setor: null, codigo: '046', areaHa: 5, geom });
    expect(r[1].nome).toBe('Área da cultura');
    expect(ehAreaSintetica(r[0])).toBe(true);
    expect(ehAreaSintetica(r[2])).toBe(false);
  });

  it('setor da entrada sintética = setor do talhão base que contém a área', () => {
    const base = [talhao('a', '032', 'NORTE')];
    expect(talhoesParaInterpolacao(base, [area('x', '032A')])[0]).toMatchObject({ id: 'x', setor: 'NORTE' });
  });

  it('sem áreas: a própria lista base', () => {
    const base = [talhao('a', '001')];
    expect(talhoesParaInterpolacao(base, [])).toBe(base);
  });
});

describe('filtrarAreasPorSetor', () => {
  const quadrado = (x: number, y: number, l: number) => ({
    type: 'Polygon' as const,
    coordinates: [[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]],
  });
  const comGeom = <T extends { geom: unknown }>(o: T, g: ReturnType<typeof quadrado>): T => ({ ...o, geom: g });
  const todos = [comGeom(talhao('a', '001', 'SÃO MIGUEL'), quadrado(0, 0, 10)), comGeom(talhao('b', '002', 'SIRIEMA'), quadrado(20, 0, 10))];
  const areas = [
    comGeom(area('x', '001'), quadrado(1, 1, 2)), // dentro do 001
    comGeom(area('y', '002'), quadrado(21, 1, 2)), // dentro do 002
    comGeom(area('sub', '001A'), quadrado(5, 5, 2)), // subárea sem talhão base do mesmo código, dentro do 001
    comGeom(area('w', '046'), quadrado(50, 50, 1)), // sem talhão base: setor do PIMS
    comGeom(area('u', ''), quadrado(60, 60, 1)),
  ];
  // o PIMS escreve o setor de outro jeito ("SAO MIGUEL I"): não é usado quando a área tem talhão base
  const mapa = new Map([
    ['001A', pims('001A', 'plantado', 'SAO MIGUEL I')],
    ['046', pims('046', 'plantado', 'SÃO MIGUEL')],
  ]);

  it('sem filtro: todas', () => {
    expect(filtrarAreasPorSetor(areas, todos, todos, null, mapa)).toBe(areas);
  });

  it('com filtro: setor do talhão base que contém a área; sem talhão base, setor do PIMS', () => {
    const usados = [todos[0]];
    expect(filtrarAreasPorSetor(areas, usados, todos, ['SÃO MIGUEL'], mapa).map((a) => a.id)).toEqual(['x', 'sub', 'w']);
    expect(filtrarAreasPorSetor(areas, usados, todos, ['são miguel'], null).map((a) => a.id)).toEqual(['x', 'sub']);
    expect(filtrarAreasPorSetor(areas, [todos[1]], todos, ['SIRIEMA'], mapa).map((a) => a.id)).toEqual(['y']);
  });
});

describe('plantadosSemArea', () => {
  it('com áreas: plantados/plantando do PIMS com talhão base mas sem área da cultura', () => {
    const mapa = new Map([
      ['001', pims('001', 'plantado')],
      ['002', pims('002', 'plantando')],
      ['003', pims('003', 'a_plantar')],
      ['004', pims('004', 'plantado')],
    ]);
    const base = [talhao('a', '001'), talhao('b', '002'), talhao('c', '003')];
    expect(plantadosSemArea(mapa, base, [area('x', '001')]).map((t) => t.codigo)).toEqual(['002']);
  });

  it('sem áreas ou sem PIMS: nada', () => {
    expect(plantadosSemArea(new Map([['001', pims('001', 'plantado')]]), [talhao('a', '001')], [])).toEqual([]);
    expect(plantadosSemArea(null, [talhao('a', '001')], [area('x', '002')])).toEqual([]);
  });
});
