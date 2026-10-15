// "Ver plantio" com áreas da cultura: cada área vira uma linha (mapa e lista); a marcação manual vai para o
// talhão do shape da fazenda com o mesmo código. Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import { linhasDasAreas } from '../src/lib/plantioAreas';
import type { AreaCultura, Talhao } from '../src/lib/types';

const g = (x: number) => ({ type: 'Polygon' as const, coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
const talhao = (id: string, codigo: string, setor: string | null): Talhao =>
  ({ id, fazendaId: 'f', nome: `T ${codigo}`, setor, areaHa: 100, geom: g(0), atributos: {}, codigo });
const area = (id: string, codigo: string, areaHa: number, x = 5): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo, areaHa, geom: g(x) });

describe('linhasDasAreas', () => {
  const talhoes = [talhao('t68', '068', 'NORTE'), talhao('t24', '024', null)];

  it('cada área vira uma linha com o código, a área e o desenho dela; setor e marcação manual do talhão de mesmo código', () => {
    const { linhas, baseDe } = linhasDasAreas([area('a68', '068', 80.5, 1)], talhoes);
    expect(linhas).toEqual([{ id: 'a68', fazendaId: 'f', nome: '068', setor: 'NORTE', areaHa: 80.5, geom: g(1), atributos: {}, codigo: '068' }]);
    expect(baseDe.get('a68')).toBe('t68');
  });

  it('divisão que não está no shape da fazenda (068A): linha própria, sem setor e sem talhão para marcação manual', () => {
    const { linhas, baseDe } = linhasDasAreas([area('a68a', '068A', 12)], talhoes);
    expect(linhas.map((l) => [l.nome, l.setor, l.areaHa])).toEqual([['068A', null, 12]]);
    expect(baseDe.has('a68a')).toBe(false);
  });

  it('área sem código: "(sem código)"; linhas pela ordem do código (numérica)', () => {
    const { linhas } = linhasDasAreas([area('a2', '068A', 1), area('a0', '', 1), area('a1', '024', 1), area('a3', '068', 1)], talhoes);
    expect(linhas.map((l) => l.nome)).toEqual(['024', '068', '068A', '(sem código)']);
  });
});
