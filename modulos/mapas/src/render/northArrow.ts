/**
 * Rosa dos ventos simplificada: seta N com haste (metade branca, metade preta) e 4 pontos,
 * com a letra N acima, sobre fundo branco 85% no canto superior direito do quadro.
 */
import { ALTURA_MAIUSC, fonte, type Rect } from './labels';
import { COR_CINZA, FUNDO_85, type Vista } from './types';

/** tamanho da rosa (altura do conjunto com o fundo), em mm do A3 */
export const TAMANHO_ROSA_MM = 14;
const LARGURA_MM = 10.5;
const MARGEM = 3;

export interface PlanoRosa {
  area: Rect;
  desenhar(): void;
}

/** Retângulo da rosa (mm, relativo ao quadro visível): canto superior direito com margem de 3 mm. */
export function retanguloRosaMm(quadro: Rect): Rect {
  return { x: quadro.x + quadro.w - MARGEM - LARGURA_MM, y: quadro.y + MARGEM, w: LARGURA_MM, h: TAMANHO_ROSA_MM };
}

/**
 * Desenha só o símbolo, com o centro da estrela em (cx, cy) px e a ponta norte a `raio` px do centro.
 * `s` = px por mm (traços).
 */
export function desenharRosa(ctx: CanvasRenderingContext2D, cx: number, cy: number, raio: number, s: number): void {
  const curto = raio * 0.55;
  const meia = raio * 0.25;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 0.15 * s;
  ctx.strokeStyle = '#000000';
  // pontos L, S, O (cinza)
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    ctx.beginPath();
    ctx.moveTo(dx * curto, dy * curto);
    ctx.lineTo(-dy * meia * 0.8, dx * meia * 0.8);
    ctx.lineTo(dy * meia * 0.8, -dx * meia * 0.8);
    ctx.closePath();
    ctx.fillStyle = COR_CINZA;
    ctx.fill();
  }
  // seta N: metade esquerda branca, metade direita preta, com haste até o centro
  ctx.beginPath();
  ctx.moveTo(0, -raio);
  ctx.lineTo(-meia, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -raio);
  ctx.lineTo(meia, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.stroke();
  // miolo
  ctx.beginPath();
  ctx.arc(0, 0, meia * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Planeja a rosa no canto superior direito do quadro visível da vista. */
export function planejarRosa(ctx: CanvasRenderingContext2D, v: Vista): PlanoRosa {
  const s = v.s;
  const r = retanguloRosaMm({ x: v.x / s, y: v.y / s, w: v.w / s, h: v.h / s });
  const area: Rect = { x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s };
  const desenhar = () => {
    ctx.save();
    ctx.fillStyle = FUNDO_85;
    ctx.beginPath();
    ctx.roundRect(area.x, area.y, area.w, area.h, 0.8 * s);
    ctx.fill();
    const px = 3.2 * s;
    const cap = px * ALTURA_MAIUSC;
    const cx = area.x + area.w / 2;
    const baseN = area.y + 1.3 * s + cap;
    ctx.font = fonte(700, px);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('N', cx, baseN);
    // estrela: ponta N logo abaixo da letra; ponta S (curta) acima da borda inferior
    const topo = baseN + 0.8 * s;
    const fundo = area.y + area.h - 1.2 * s;
    const raio = (fundo - topo) / 1.55;
    desenharRosa(ctx, cx, topo + raio, raio, s);
    ctx.restore();
  };
  return { area, desenhar };
}
