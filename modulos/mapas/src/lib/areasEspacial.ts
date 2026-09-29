/**
 * Vínculo espacial entre as áreas da cultura e os talhões base: o código da área nem sempre é o do
 * talhão base (subáreas "032A" dentro do "032", setores com nomes diferentes no PIMS), então a área
 * pertence ao talhão base cujo polígono contém o centróide dela. Tudo em lon/lat (WGS84), sem
 * dependências: par-ímpar (ray casting) sobre o anel externo menos os furos.
 */
import { normalizarCodigo } from './codigoTalhao';
import type { Geometry, Talhao } from './types';

/** [minX, minY, maxX, maxY] nas coordenadas da geometria. */
export type BBox = [number, number, number, number];

type Anel = number[][];

function poligonos(g: Geometry): Anel[][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

export function bboxDe(g: Geometry): BBox {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of poligonos(g))
    for (const [x, y] of p[0] ?? []) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}

function noAnel(x: number, y: number, anel: Anel): boolean {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i];
    const [xj, yj] = anel[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** true se (x, y) está dentro de alguma parte da geometria (fora dos furos). */
export function pontoNaGeometria(x: number, y: number, g: Geometry): boolean {
  return poligonos(g).some((p) => p.length > 0 && noAnel(x, y, p[0]) && !p.slice(1).some((furo) => noAnel(x, y, furo)));
}

const areaBBox = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);

/**
 * Centróide aproximado: média dos vértices do anel externo da maior parte (pelo bbox), sem contar o
 * vértice de fechamento repetido.
 */
export function centroideDe(g: Geometry): [number, number] {
  let melhor: Anel = [];
  let maior = -1;
  for (const p of poligonos(g)) {
    const anel = p[0] ?? [];
    const a = areaBBox(bboxDe({ type: 'Polygon', coordinates: [anel] }));
    if (a > maior) {
      maior = a;
      melhor = anel;
    }
  }
  let n = melhor.length;
  if (n > 1 && melhor[0][0] === melhor[n - 1][0] && melhor[0][1] === melhor[n - 1][1]) n--;
  if (n === 0) return [NaN, NaN];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += melhor[i][0];
    sy += melhor[i][1];
  }
  return [sx / n, sy / n];
}

function sobreposicao(a: BBox, b: BBox): number {
  return areaBBox([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
}

type Base = Pick<Talhao, 'id' | 'geom' | 'codigo'>;
type AreaGeo = { geom: Geometry; codigo?: string | null };

const geometriaValida = (g: Geometry | null | undefined): g is Geometry => !!g && Array.isArray(g.coordinates);

function escolher<T extends Base>(area: AreaGeo, talhoes: readonly T[], caixas: readonly BBox[]): T | null {
  if (!geometriaValida(area.geom)) return null;
  const [cx, cy] = centroideDe(area.geom);
  const codigo = normalizarCodigo(area.codigo ?? '');
  let contem: T | null = null;
  for (let i = 0; i < talhoes.length; i++) {
    const b = caixas[i];
    if (!(cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3])) continue;
    if (!pontoNaGeometria(cx, cy, talhoes[i].geom)) continue;
    if (codigo && normalizarCodigo(talhoes[i].codigo) === codigo) return talhoes[i];
    contem ??= talhoes[i];
  }
  if (contem) return contem;
  const caixa = bboxDe(area.geom);
  let melhor: T | null = null;
  let maior = 0;
  for (let i = 0; i < talhoes.length; i++) {
    const s = sobreposicao(caixa, caixas[i]);
    if (s > maior) {
      maior = s;
      melhor = talhoes[i];
    }
  }
  return melhor;
}

function caixasDe(talhoes: readonly Base[]): BBox[] {
  return talhoes.map((t) => (geometriaValida(t.geom) ? bboxDe(t.geom) : [Infinity, Infinity, -Infinity, -Infinity]));
}

/**
 * Talhão base da área da cultura: o que contém o centróide da área (entre vários, o do mesmo código);
 * se nenhum contém, o de maior sobreposição de bbox; sem sobreposição, null.
 */
export function talhaoBaseDaArea<T extends Base>(area: AreaGeo, talhoes: readonly T[]): T | null {
  return escolher(area, talhoes, caixasDe(talhoes));
}

/** id da área → talhão base (talhaoBaseDaArea) para uma lista de áreas. */
export function vincularAreas<T extends Base>(areas: readonly (AreaGeo & { id: string })[], talhoes: readonly T[]): Map<string, T | null> {
  const caixas = caixasDe(talhoes);
  const m = new Map<string, T | null>();
  for (const a of areas) m.set(a.id, escolher(a, talhoes, caixas));
  return m;
}
