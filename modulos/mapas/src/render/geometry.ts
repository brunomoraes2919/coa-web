/** Geometria pura do layout (sem canvas): projeção no quadro, escala, grade e tiles. */
import type { MapExtent } from '../lib/types';

/** Metade da largura do mundo em Web Mercator (m). */
export const MEIO_MUNDO = 20037508.342789244;
/** Resolução (m/px) de um tile de 256 px no zoom 0, no equador. */
export const RES_ZOOM0 = (2 * MEIO_MUNDO) / 256;

/**
 * Função que leva Web Mercator (m) a pixels do quadro do mapa (origem no canto superior
 * esquerdo do quadro; y cresce para o sul). frameW/frameH em mm; pxPorMm = pixels por mm.
 */
export function mercToFramePx(
  ext: MapExtent,
  frameW: number,
  frameH: number,
  pxPorMm: number,
): (mx: number, my: number) => [number, number] {
  const k = pxPorMm / ext.mPorMm;
  const ox = (frameW / 2) * pxPorMm;
  const oy = (frameH / 2) * pxPorMm;
  return (mx, my) => [ox + (mx - ext.cx) * k, oy - (my - ext.cy) * k];
}

/** Segmentos "redondos" (m); os de 10 a 50 m servem ao zoom máximo da prévia (0,5 m por mm). */
const SERIE_ESCALA = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];

/**
 * Segmento "redondo" da barra de escala: 2 segmentos ≈ alvoMm no papel.
 * metrosPorMm = metros NO TERRENO por mm de papel.
 */
export function niceScaleBar(metrosPorMm: number, alvoMm = 40): { segmentoM: number; segmentoMm: number } {
  let melhor = SERIE_ESCALA[0];
  let erro = Infinity;
  for (const seg of SERIE_ESCALA) {
    const e = Math.abs(Math.log((2 * seg) / metrosPorMm / alvoMm));
    if (e < erro) {
      erro = e;
      melhor = seg;
    }
  }
  return { segmentoM: melhor, segmentoMm: melhor / metrosPorMm };
}

const SERIE_GRADE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];

/** Passo (graus) das marcas de coordenadas: o menor da série que dá no máximo 5 marcas. */
export function graticuleStep(spanGraus: number): number {
  for (const passo of SERIE_GRADE) if (spanGraus / passo <= 5 + 1e-9) return passo;
  return SERIE_GRADE[SERIE_GRADE.length - 1];
}

/**
 * Zoom de tile cuja resolução mais se aproxima da saída.
 * metrosPorPx = metros NO TERRENO por pixel de saída; lat em graus.
 */
export function tileZoomFor(metrosPorPx: number, lat: number, maxZoom: number): number {
  const resEquador = metrosPorPx / Math.cos((lat * Math.PI) / 180);
  const z = Math.round(Math.log2(RES_ZOOM0 / resEquador));
  if (!Number.isFinite(z)) return z > 0 ? maxZoom : 0;
  return Math.max(0, Math.min(maxZoom, z));
}

/** Faixa (inclusiva) de tiles XYZ que cobre um retângulo Web Mercator. */
export function tileRange(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  z: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const n = 2 ** z;
  const tam = (2 * MEIO_MUNDO) / n;
  const lim = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
  return {
    x0: lim((minX + MEIO_MUNDO) / tam),
    x1: lim((maxX + MEIO_MUNDO) / tam),
    y0: lim((MEIO_MUNDO - maxY) / tam),
    y1: lim((MEIO_MUNDO - minY) / tam),
  };
}

/** Retângulo Web Mercator [minX, minY, maxX, maxY] do tile XYZ. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const tam = (2 * MEIO_MUNDO) / 2 ** z;
  const minX = -MEIO_MUNDO + x * tam;
  const maxY = MEIO_MUNDO - y * tam;
  return [minX, maxY - tam, minX + tam, maxY];
}
