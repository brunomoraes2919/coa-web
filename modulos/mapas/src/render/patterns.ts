/** Padrões de preenchimento dos talhões plantados/plantando e o símbolo (gota) dos PICs: azul com chuva, cinza riscada sem. */
import type { EstiloPlantado } from '../lib/types';
import type { Rect } from './labels';

const ALFA_PADRAO = 0.55;

export interface OpcoesPadrao {
  /** cor das linhas/pontos (padrão preto) */
  cor?: string;
  /** opacidade (padrão 0,55) */
  alfa?: number;
  /** espessura das linhas em mm (padrão 0,25) */
  larguraMm?: number;
}

/**
 * Desenha o padrão do estilo sobre `area` (px do canvas). O chamador define o clip (ex.: os
 * talhões plantados). As linhas/pontos são ancorados em `origem` para o padrão ficar contínuo.
 * `s` = pixels por mm. `opcoes` muda cor/opacidade/espessura (ex.: hachura amarela do "plantando").
 */
export function desenharPadrao(
  ctx: CanvasRenderingContext2D,
  estilo: EstiloPlantado,
  area: Rect,
  s: number,
  origem: [number, number],
  opcoes: OpcoesPadrao = {},
): void {
  if (estilo === 'contorno' || area.w <= 0 || area.h <= 0) return;
  const [ox, oy] = origem;
  const x0 = area.x;
  const y0 = area.y;
  const x1 = area.x + area.w;
  const y1 = area.y + area.h;
  ctx.save();
  ctx.globalAlpha *= opcoes.alfa ?? ALFA_PADRAO;
  ctx.strokeStyle = opcoes.cor ?? '#000';
  ctx.fillStyle = opcoes.cor ?? '#000';
  ctx.lineWidth = (opcoes.larguraMm ?? 0.25) * s;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  if (estilo === 'quadriculado') {
    const passo = 2.5 * s;
    for (let k = Math.ceil((x0 - ox) / passo); ox + k * passo <= x1; k++) {
      const x = ox + k * passo;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let k = Math.ceil((y0 - oy) / passo); oy + k * passo <= y1; k++) {
      const y = oy + k * passo;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  } else if (estilo === 'diagonal') {
    // linhas "/" a 45° (x + y = c), 2,5 mm de distância perpendicular entre elas
    const passo = 2.5 * s * Math.SQRT2;
    const cMin = x0 - ox + (y0 - oy);
    const cMax = x1 - ox + (y1 - oy);
    for (let k = Math.ceil(cMin / passo); k * passo <= cMax; k++) {
      const c = k * passo;
      ctx.moveTo(ox + c - (y0 - oy), y0);
      ctx.lineTo(ox + c - (y1 - oy), y1);
    }
    ctx.stroke();
  } else {
    // pontilhado: pontos de 0,5 mm a cada 1,8 mm
    const passo = 1.8 * s;
    const raio = 0.25 * s;
    for (let j = Math.ceil((y0 - oy - raio) / passo); oy + j * passo <= y1 + raio; j++) {
      const y = oy + j * passo;
      for (let i = Math.ceil((x0 - ox - raio) / passo); ox + i * passo <= x1 + raio; i++) {
        const x = ox + i * passo;
        ctx.moveTo(x + raio, y);
        ctx.arc(x, y, raio, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

/** largura da gota em relação à altura (para reservar o espaço dela no mapa) */
export const LARGURA_GOTA = 0.72;

/** PIC sem chuva apontada no período: sem valor, ou com menos de 0,05 mm (aparece como "0"). */
export function picSemChuva(chuva: number | null | undefined): boolean {
  return chuva === null || chuva === undefined || !Number.isFinite(chuva) || Math.round(chuva * 10) === 0;
}

/**
 * Gota do PIC com a ponta em (x, y) e o corpo para baixo; `altura` em px. Azul com brilho quando o PIC tem
 * chuva; com `semChuva`, cinza e riscada. `s` (px por mm) define o traço branco fino em volta.
 */
export function desenharGota(ctx: CanvasRenderingContext2D, x: number, y: number, altura: number, s: number, semChuva = false): void {
  if (!(altura > 0)) return;
  const meia = LARGURA_GOTA / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(altura, altura);
  // unidades locais: altura = 1, largura = 0,72, centro do corpo em (0; 0,64)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(0.06, 0.1, meia, 0.42, meia, 0.64);
  ctx.arc(0, 0.64, meia, 0, Math.PI, false);
  ctx.bezierCurveTo(-meia, 0.42, -0.06, 0.1, 0, 0);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-0.3, 0.2, 0.3, 1);
  if (semChuva) {
    grad.addColorStop(0, '#D8DCE0');
    grad.addColorStop(0.5, '#B3B9C0');
    grad.addColorStop(1, '#848B94');
  } else {
    grad.addColorStop(0, '#35DBFF');
    grad.addColorStop(0.45, '#0FBDF0');
    grad.addColorStop(1, '#0568A5');
  }
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = (0.18 * s) / altura;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  // brilho: um traço curvo branco do lado esquerdo
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.147, 0.52);
  ctx.quadraticCurveTo(-0.24, 0.664, -0.127, 0.79);
  ctx.lineWidth = 0.085;
  ctx.strokeStyle = semChuva ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.92)';
  ctx.stroke();
  if (semChuva) {
    // risco escuro atravessado, com um fio branco em volta
    ctx.beginPath();
    ctx.moveTo(-0.37, 0.87);
    ctx.lineTo(0.37, 0.15);
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.lineWidth = 0.066;
    ctx.strokeStyle = '#3A3B3E';
    ctx.stroke();
  }
  ctx.restore();
}
