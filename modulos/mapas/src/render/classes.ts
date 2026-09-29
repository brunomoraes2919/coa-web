/**
 * Índice de classes do grid (buildClassIndex) e classes presentes, com cache por grid.
 * A prévia redesenha a cada arrasto/zoom e os grids reais têm dezenas de milhões de células:
 * a classificação só é refeita quando o grid ou a paleta (id) mudam.
 */
import { buildClassIndex } from '../lib/palettes';
import type { Grid, Palette } from '../lib/types';

export interface ClassesGrid {
  paletteId: string;
  /** índice da classe por célula; 255 = sem dado */
  idx: Uint8Array;
  /** presentes[i] = a classe i aparece em alguma célula */
  presentes: boolean[];
}

const cache = new WeakMap<Grid, ClassesGrid>();

export function classesDoGrid(grid: Grid, palette: Palette): ClassesGrid {
  const existente = cache.get(grid);
  if (existente && existente.paletteId === palette.id && existente.presentes.length === palette.classes.length) {
    return existente;
  }
  const idx = buildClassIndex(grid.values, palette);
  const vistos = new Uint8Array(256);
  for (let i = 0; i < idx.length; i++) vistos[idx[i]] = 1;
  const presentes = palette.classes.map((_, i) => i < 255 && vistos[i] === 1);
  const novo: ClassesGrid = { paletteId: palette.id, idx, presentes };
  cache.set(grid, novo);
  return novo;
}
