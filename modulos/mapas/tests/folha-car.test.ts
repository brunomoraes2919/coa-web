// Folha do Mapa de CAR: orientação e largura do painel lateral pelo desenho todo (talhões, CARs e matrículas), para o
// mapa não sobrar branco dos lados. Retângulos FICTÍCIOS em km (Mercator).
import { describe, expect, it } from 'vitest';
import { mercToLonLat } from '../src/lib/projection';
import type { Talhao } from '../src/lib/types';
import { folhaDoMapaCar, LINHAS_QUADRO_RETRATO } from '../src/render/car';
import { compor, PAINEL_MAX_MM } from '../src/render/composicao';

const X0 = -6_560_000;
const Y0 = -1_520_000;
/** retângulo de `w` × `h` km */
function item(w: number, h: number): Talhao {
  const p = (x: number, y: number) => mercToLonLat(X0 + x * 1000, Y0 + y * 1000);
  return { id: 'x', fazendaId: 'f', nome: 'x', setor: null, areaHa: 0, geom: { type: 'Polygon', coordinates: [[p(0, 0), p(w, 0), p(w, h), p(0, h), p(0, 0)]] }, atributos: {}, codigo: null };
}

describe('compor com painel lateral mais largo', () => {
  const normal = compor([], { orientacao: 'paisagem', quadros: 1, pagina: 'A3' });

  it('o painel cresce para a esquerda e o quadro do mapa perde a mesma largura', () => {
    const largo = compor([], { orientacao: 'paisagem', quadros: 1, pagina: 'A3', painelMm: 120 });
    expect(largo.painel.w).toBeCloseTo(120, 6);
    expect(largo.painel.x + largo.painel.w).toBeCloseTo(normal.painel.x + normal.painel.w, 6);
    expect(largo.quadros[0].rect.w).toBeCloseTo(normal.quadros[0].rect.w - (120 - normal.painel.w), 6);
    expect(largo.quadros[0].rect.h).toBe(normal.quadros[0].rect.h);
  });

  it('limitado a PAINEL_MAX_MM; menor que o normal e retrato ficam como sempre', () => {
    expect(compor([], { orientacao: 'paisagem', quadros: 1, pagina: 'A3', painelMm: 500 }).painel.w).toBeCloseTo(PAINEL_MAX_MM, 6);
    expect(compor([], { orientacao: 'paisagem', quadros: 1, pagina: 'A3', painelMm: 30 })).toEqual(normal);
    const retrato = compor([], { orientacao: 'retrato', quadros: 1, pagina: 'A3' });
    expect(compor([], { orientacao: 'retrato', quadros: 1, pagina: 'A3', painelMm: 120 })).toEqual(retrato);
  });
});

describe('folhaDoMapaCar', () => {
  it('desenho largo: paisagem com o painel normal', () => {
    expect(folhaDoMapaCar([item(20, 8)], 'auto', 30)).toEqual({ orientacao: 'paisagem', painelMm: 71.4 });
  });

  it('desenho quadrado: o quadro do mapa fica quadrado e o painel fica com o resto', () => {
    const f = folhaDoMapaCar([item(10, 10)], 'auto', 35);
    expect(f.orientacao).toBe('paisagem');
    const c = compor([], { orientacao: 'paisagem', quadros: 1, pagina: 'A3', painelMm: f.painelMm });
    expect(c.quadros[0].rect.w).toBeCloseTo(c.quadros[0].rect.h, 3);
  });

  it('desenho alto com poucas linhas no quadro: retrato; com muitas: paisagem com o painel no máximo', () => {
    expect(folhaDoMapaCar([item(5, 10)], 'auto', 11)).toEqual({ orientacao: 'retrato' });
    expect(folhaDoMapaCar([item(5, 10)], 'auto', LINHAS_QUADRO_RETRATO + 1)).toEqual({ orientacao: 'paisagem', painelMm: PAINEL_MAX_MM });
  });

  it('orientação escolhida pelo usuário vale; na paisagem o painel ainda se ajusta', () => {
    expect(folhaDoMapaCar([item(5, 10)], 'retrato', 40)).toEqual({ orientacao: 'retrato' });
    expect(folhaDoMapaCar([item(5, 10)], 'paisagem', 2)).toEqual({ orientacao: 'paisagem', painelMm: PAINEL_MAX_MM });
  });

  it('sem nada para enquadrar: paisagem normal', () => {
    expect(folhaDoMapaCar([], 'auto', 0)).toEqual({ orientacao: 'paisagem' });
  });
});
