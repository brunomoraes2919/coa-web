import { describe, expect, it } from 'vitest';
import type { MultiPolyXY, Ring } from '../src/lib/projection';
import { cellCenter, dilate, gridSpecFromBounds, rasterizeZones } from '../src/lib/raster';

/** Quadrado fechado (primeiro ponto repetido no fim, como no GeoJSON). */
const quadrado = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

const contar = (a: ArrayLike<number>, v: number) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === v) n++;
  return n;
};

describe('gridSpecFromBounds / cellCenter', () => {
  it('ancora no canto superior esquerdo e arredonda linhas/colunas para cima', () => {
    expect(gridSpecFromBounds(0, 0, 50, 30, 5)).toEqual({ x0: 0, y0: 30, res: 5, cols: 10, rows: 6 });
    expect(gridSpecFromBounds(100, 200, 151, 231, 5)).toEqual({ x0: 100, y0: 231, res: 5, cols: 11, rows: 7 });
  });

  it('devolve o centro da célula (linha 0 = norte)', () => {
    const s = gridSpecFromBounds(0, 0, 50, 30, 5);
    expect(cellCenter(s, 0, 0)).toEqual([2.5, 27.5]);
    expect(cellCenter(s, 9, 5)).toEqual([47.5, 2.5]);
  });
});

describe('rasterizeZones', () => {
  const s = gridSpecFromBounds(0, 0, 100, 100, 5); // 20 × 20

  it('marca as 100 células de um quadrado de 10 × 10 células', () => {
    const z = rasterizeZones(s, [[[quadrado(10, 10, 60, 60)]]]);
    expect(z).toBeInstanceOf(Int32Array);
    expect(z.length).toBe(400);
    expect(contar(z, 0)).toBe(100);
    expect(contar(z, -1)).toBe(300);
    // centros x 12,5..57,5 → colunas 2..11; centros y 57,5..12,5 → linhas 8..17
    expect(z[8 * 20 + 2]).toBe(0);
    expect(z[17 * 20 + 11]).toBe(0);
    expect(z[7 * 20 + 2]).toBe(-1);
    expect(z[8 * 20 + 12]).toBe(-1);
  });

  it('aceita anel sem o ponto de fechamento', () => {
    const aberto: Ring = [
      [10, 10],
      [60, 10],
      [60, 60],
      [10, 60],
    ];
    const z = rasterizeZones(s, [[[aberto]]]);
    expect(contar(z, 0)).toBe(100);
  });

  it('deixa o buraco com -1 (par-ímpar, qualquer orientação)', () => {
    const buraco = quadrado(25, 25, 75, 75).reverse();
    const z = rasterizeZones(s, [[[quadrado(0, 0, 100, 100), buraco]]]);
    expect(contar(z, 0)).toBe(300);
    expect(contar(z, -1)).toBe(100);
    // centro (50, 50) → coluna 10, linha 9: dentro do buraco
    expect(z[9 * 20 + 10]).toBe(-1);
    expect(z[0]).toBe(0);
  });

  it('une as partes de um multipolígono e zonas posteriores sobrescrevem', () => {
    const multi: MultiPolyXY = [[quadrado(0, 0, 20, 20)], [quadrado(50, 50, 70, 70)]];
    const outra: MultiPolyXY = [[quadrado(60, 60, 100, 100)]];
    const z = rasterizeZones(s, [multi, outra]);
    // multi: 16 + 16 células; outra: 8 × 8 = 64, das quais 2 × 2 = 4 sobrepõem a segunda parte
    expect(contar(z, 0)).toBe(16 + 16 - 4);
    expect(contar(z, 1)).toBe(64);
    expect(contar(z, -1)).toBe(400 - 28 - 64);
  });

  it('usa o centro da célula em bordas inclinadas e recorta o que sai da grade', () => {
    // hipotenusa x + y = 101: nenhum centro cai exatamente sobre a borda
    const triangulo: Ring = [
      [0, 0],
      [101, 0],
      [0, 101],
      [0, 0],
    ];
    const z = rasterizeZones(s, [[[triangulo]]]);
    // centros (i+0,5; j+0,5)·5 com (i + j + 1)·5 < 101 → i + j <= 19 → 20·21/2 = 210
    expect(contar(z, 0)).toBe(210);
    expect(z[0 * 20 + 19]).toBe(-1); // canto nordeste (i = 19, j = 19)
    expect(z[19 * 20 + 19]).toBe(0); // canto sudeste (i = 19, j = 0)

    const grande = rasterizeZones(s, [[[quadrado(-500, -500, 50, 500)]]]);
    expect(contar(grande, 0)).toBe(200); // 10 colunas × 20 linhas
  });

  it('não marca nada para polígono fora da grade ou degenerado', () => {
    const z = rasterizeZones(s, [[[quadrado(200, 200, 300, 300)]], [[[[10, 10], [20, 20], [10, 10]]]]]);
    expect(contar(z, -1)).toBe(400);
  });
});

describe('dilate', () => {
  /** Dilatação de referência (força bruta) para comparar. */
  function dilateIngenuo(m: Uint8Array, cols: number, rows: number, r: number): Uint8Array {
    const out = new Uint8Array(m.length);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        if (!m[row * cols + col]) continue;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const c = col + dx;
            const l = row + dy;
            if (dx * dx + dy * dy <= r * r && c >= 0 && c < cols && l >= 0 && l < rows) out[l * cols + c] = 1;
          }
      }
    return out;
  }

  it('um pixel com raio 2 vira um disco de 13 células', () => {
    const s = gridSpecFromBounds(0, 0, 45, 45, 5); // 9 × 9
    const m = new Uint8Array(81);
    m[4 * 9 + 4] = 1;
    const d = dilate(m, s, 2);
    expect(d).toBeInstanceOf(Uint8Array);
    expect(contar(d, 1)).toBe(13);
    for (let row = 0; row < 9; row++)
      for (let col = 0; col < 9; col++) {
        const dentro = (col - 4) ** 2 + (row - 4) ** 2 <= 4;
        expect(d[row * 9 + col]).toBe(dentro ? 1 : 0);
      }
    expect(m[0]).toBe(0); // não altera a entrada
    expect(contar(m, 1)).toBe(1);
  });

  it('recorta na borda da grade e raio 0 só copia', () => {
    const s = gridSpecFromBounds(0, 0, 45, 45, 5);
    const m = new Uint8Array(81);
    m[0] = 1;
    expect(contar(dilate(m, s, 2), 1)).toBe(6);
    const c = dilate(m, s, 0);
    expect(Array.from(c)).toEqual(Array.from(m));
    expect(c).not.toBe(m);
  });

  it('dilata um bloco cheio (interior incluído) com raio 1', () => {
    const s = gridSpecFromBounds(0, 0, 50, 50, 5); // 10 × 10
    const m = new Uint8Array(100);
    for (let row = 2; row < 7; row++) for (let col = 2; col < 7; col++) m[row * 10 + col] = 1;
    expect(contar(dilate(m, s, 1), 1)).toBe(25 + 4 * 5);
  });

  it('é igual à dilatação ingênua numa máscara aleatória', () => {
    const cols = 37;
    const rows = 23;
    const s = gridSpecFromBounds(0, 0, cols * 5, rows * 5, 5);
    // mulberry32: gerador determinístico
    let semente = 12345;
    const aleatorio = () => {
      semente = (semente + 0x6d2b79f5) | 0;
      let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (const r of [1, 2, 3, 5]) {
      const m = new Uint8Array(cols * rows);
      for (let i = 0; i < m.length; i++) m[i] = aleatorio() < 0.08 ? 1 : 0;
      // um bloco cheio para ter interior
      for (let row = 5; row < 15; row++) for (let col = 10; col < 25; col++) m[row * cols + col] = 1;
      expect(Array.from(dilate(m, s, r))).toEqual(Array.from(dilateIngenuo(m, cols, rows, r)));
    }
  });
});
