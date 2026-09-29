/**
 * Barra de escala no canto inferior direito do quadro, sobre fundo branco 85%: 3 segmentos
 * alternados (preto ½x, branco ½x, preto x) com rótulos 0, x e 2x — em km quando 2x ≥ 1 km.
 */
import { fmtMilhar } from '../lib/format';
import { niceScaleBar } from './geometry';
import { ALTURA_MAIUSC, fonte, type Rect } from './labels';
import { COR_TEXTO, FUNDO_85, type Vista } from './types';

export interface PlanoEscala {
  /** área ocupada (px), para os rótulos e a grade desviarem */
  area: Rect;
  desenhar(): void;
}

/** "2,5", "0,5", "10" (km com vírgula, até 2 casas, sem zeros à direita). */
function fmtKm(km: number): string {
  return String(Math.round(km * 100) / 100).replace('.', ',');
}

/**
 * Rótulos da barra para um segmento de `segmentoM` metros: ['0', x, '2x unidade'].
 * Em km quando o total (2x) chega a 1 km: 2500 → ['0', '2,5', '5 km']; senão em m com milhar.
 */
export function rotulosEscala(segmentoM: number): [string, string, string] {
  const total = 2 * segmentoM;
  if (total >= 1000) return ['0', fmtKm(segmentoM / 1000), `${fmtKm(total / 1000)} km`];
  return ['0', fmtMilhar(segmentoM), `${fmtMilhar(total)} m`];
}

// medidas em mm do A3
const MARGEM = 3;
const PAD_X = 2.6;
const PAD_Y = 1.8;
const FONTE = 2.8;
const BARRA_H = 1.5;
const VAO_TEXTO = 1.2;
const TRACO = 0.2;

export function planejarEscala(ctx: CanvasRenderingContext2D, v: Vista): PlanoEscala {
  const s = v.s;
  const mPorMmTerreno = v.ext.mPorMm * Math.cos((v.latCentro * Math.PI) / 180);
  const { segmentoM, segmentoMm } = niceScaleBar(mPorMmTerreno);
  const seg = segmentoMm * s;
  const rotulos = rotulosEscala(segmentoM);
  const px = FONTE * s;
  const cap = px * ALTURA_MAIUSC;

  ctx.save();
  ctx.font = fonte(400, px);
  // o número fica centrado na marca; a unidade do último vem depois dele
  const numFinal = rotulos[2].split(' ')[0];
  const largNum = rotulos.map((r, i) => ctx.measureText(i === 2 ? numFinal : r).width);
  const largFinal = ctx.measureText(rotulos[2]).width;
  ctx.restore();

  const sobraEsq = largNum[0] / 2;
  const sobraDir = largFinal - largNum[2] / 2;
  const w = 2 * PAD_X * s + sobraEsq + 2 * seg + sobraDir;
  const h = 2 * PAD_Y * s + cap + VAO_TEXTO * s + BARRA_H * s;
  const area: Rect = { x: v.x + v.w - MARGEM * s - w, y: v.y + v.h - MARGEM * s - h, w, h };
  const x0 = area.x + PAD_X * s + sobraEsq;
  const topoBarra = area.y + area.h - PAD_Y * s - BARRA_H * s;
  const base = topoBarra - VAO_TEXTO * s;

  const desenhar = () => {
    ctx.save();
    ctx.fillStyle = FUNDO_85;
    ctx.beginPath();
    ctx.roundRect(area.x, area.y, area.w, area.h, 0.8 * s);
    ctx.fill();

    const barH = BARRA_H * s;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x0, topoBarra, seg / 2, barH);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x0 + seg / 2, topoBarra, seg / 2, barH);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x0 + seg, topoBarra, seg, barH);
    ctx.lineWidth = TRACO * s;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(x0, topoBarra, 2 * seg, barH);

    ctx.font = fonte(400, px);
    ctx.fillStyle = COR_TEXTO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    [x0, x0 + seg, x0 + 2 * seg].forEach((x, i) => ctx.fillText(rotulos[i], x - largNum[i] / 2, base));
    ctx.restore();
  };

  return { area, desenhar };
}
