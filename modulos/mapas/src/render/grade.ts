/** Grade de coordenadas: marcas discretas cinza nas bordas internas do quadro, texto 2,2 mm. */
import { lonLatToMerc, mercToLonLat } from '../lib/projection';
import { graticuleStep } from './geometry';
import { ALTURA_MAIUSC, caixaTexto, fonte, sobrepoe, textoComHalo, type Rect } from './labels';
import type { Vista } from './types';

const COR_MARCA = '#7A8784';
const COR_TEXTO_GRADE = '#4A5654';

const rotuloGrau = (g: number) => (Math.abs(g) < 1e-9 ? 0 : g).toFixed(3);

/**
 * Marcas de latitude/longitude nas bordas internas do quadro visível, com o valor (ex.: "-14.000").
 * Marcas que cairiam sobre `evitar` (título, rosa, escala) são omitidas. Devolve as áreas
 * desenhadas (marca + texto), para os rótulos do mapa não passarem por cima delas.
 */
export function desenharGrade(ctx: CanvasRenderingContext2D, v: Vista, evitar: Rect[]): Rect[] {
  const s = v.s;
  const desenhadas: Rect[] = [];
  const [lonE, latN] = mercToLonLat(...v.paraMerc(v.x, v.y));
  const [lonD, latS] = mercToLonLat(...v.paraMerc(v.x + v.w, v.y + v.h));
  if (!(lonD > lonE && latN > latS)) return desenhadas;
  const marca = 1.8 * s;
  const px = 2.2 * s;
  const halo = 0.35 * s;
  const cap = px * ALTURA_MAIUSC;
  const folga = 0.5 * s;
  const canto = 7 * s;
  ctx.save();
  ctx.strokeStyle = COR_MARCA;
  ctx.lineWidth = 0.2 * s;
  ctx.font = fonte(400, px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const livre = (r: Rect) => !evitar.some((e) => sobrepoe(r, e));
  const marcaH = (X: number, y0: number, y1: number, txt: string, base: number) => {
    const caixa = caixaTexto(ctx, txt, X, base, px, halo, 'center');
    const r = { x: caixa.x, y: Math.min(y0, y1, caixa.y), w: caixa.w, h: Math.max(y0, y1, caixa.y + caixa.h) - Math.min(y0, y1, caixa.y) };
    if (!livre(r)) return;
    desenhadas.push(r);
    ctx.beginPath();
    ctx.moveTo(X, y0);
    ctx.lineTo(X, y1);
    ctx.stroke();
    textoComHalo(ctx, txt, X, base, COR_TEXTO_GRADE, '#FFFFFF', halo);
  };
  const passoLon = graticuleStep(lonD - lonE);
  for (let k = Math.ceil(lonE / passoLon); k * passoLon <= lonD; k++) {
    const lon = k * passoLon;
    const X = v.paraPx(lonLatToMerc(lon, 0)[0], 0)[0];
    if (X < v.x + canto || X > v.x + v.w - canto) continue;
    const txt = rotuloGrau(lon);
    marcaH(X, v.y, v.y + marca, txt, v.y + marca + folga + cap);
    marcaH(X, v.y + v.h, v.y + v.h - marca, txt, v.y + v.h - marca - folga);
  }

  const passoLat = graticuleStep(latN - latS);
  for (let k = Math.ceil(latS / passoLat); k * passoLat <= latN; k++) {
    const lat = k * passoLat;
    const Y = v.paraPx(0, lonLatToMerc(0, lat)[1])[1];
    if (Y < v.y + canto || Y > v.y + v.h - canto) continue;
    const txt = rotuloGrau(lat);
    const larg = ctx.measureText(txt).width;
    // texto vertical (lê de baixo para cima), como no layout do QGIS
    for (const [x0, x1, bx] of [
      [v.x, v.x + marca, v.x + marca + folga + cap],
      [v.x + v.w, v.x + v.w - marca, v.x + v.w - marca - folga],
    ]) {
      const r = { x: Math.min(x0, x1, bx - cap - halo), y: Y - larg / 2 - halo, w: 0, h: larg + 2 * halo };
      r.w = Math.max(x0, x1, bx + halo) - r.x;
      if (!livre(r)) continue;
      desenhadas.push(r);
      ctx.beginPath();
      ctx.moveTo(x0, Y);
      ctx.lineTo(x1, Y);
      ctx.stroke();
      ctx.save();
      ctx.translate(bx, Y);
      ctx.rotate(-Math.PI / 2);
      textoComHalo(ctx, txt, 0, 0, COR_TEXTO_GRADE, '#FFFFFF', halo);
      ctx.restore();
    }
  }
  ctx.restore();
  return desenhadas;
}
