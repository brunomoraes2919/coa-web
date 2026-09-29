import { describe, expect, it } from 'vitest';
import { celulaDoPonto } from '../src/render/raster';
import type { GridSpec } from '../src/lib/types';

// 4 colunas × 3 linhas de 5 m; canto superior esquerdo (noroeste) em (1000; 5000)
const g: GridSpec = { x0: 1000, y0: 5000, res: 5, cols: 4, rows: 3 };

describe('celulaDoPonto (UTM → célula do grid, norte para cima)', () => {
  it('linha 0 é a do norte (y maior) e a última é a do sul', () => {
    expect(celulaDoPonto(g, 1002.5, 4997.5)).toBe(0); // canto noroeste
    expect(celulaDoPonto(g, 1017.5, 4997.5)).toBe(3); // nordeste
    expect(celulaDoPonto(g, 1002.5, 4987.5)).toBe(8); // sudoeste: linha 2
    expect(celulaDoPonto(g, 1017.5, 4987.5)).toBe(11); // sudeste
  });

  it('subir no terreno (y maior) diminui a linha; ir para leste aumenta a coluna', () => {
    const sul = celulaDoPonto(g, 1007, 4991);
    const norte = celulaDoPonto(g, 1007, 4996);
    expect(norte).toBe(sul - g.cols);
    expect(celulaDoPonto(g, 1012, 4991)).toBe(sul + 1);
  });

  it('bordas: norte e oeste entram; sul e leste ficam fora (-1)', () => {
    expect(celulaDoPonto(g, 1000, 5000)).toBe(0);
    expect(celulaDoPonto(g, 1020, 4990)).toBe(-1);
    expect(celulaDoPonto(g, 1010, 4985)).toBe(-1);
    expect(celulaDoPonto(g, 999.9, 4990)).toBe(-1);
    expect(celulaDoPonto(g, 1010, 5000.1)).toBe(-1);
  });
});
