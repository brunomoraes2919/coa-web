/** Rótulos dos talhões (tamanho proporcional), gotas e valores dos PICs, com anticolisão. */
import polylabel from 'polylabel';
import { fmtChuva } from '../lib/format';
import { lonLatToMerc, type MultiPolyXY, type Ring } from '../lib/projection';
import type { Talhao } from '../lib/types';
import { tamanhoRotuloTalhaoMm } from './composicao';
import { ALTURA_MAIUSC, LabelPlacer, caixaTexto, fonte, textoComHalo, type Rect } from './labels';
import { desenharGota, LARGURA_GOTA, picSemChuva } from './patterns';
import { estiloValorPic } from './picStyle';
import type { RenderInput, Vista } from './types';

export interface TalhaoPx {
  t: Talhao;
  xy: MultiPolyXY;
}

export function areaAnel(anel: Ring): number {
  let a = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) a += (anel[j][0] + anel[i][0]) * (anel[j][1] - anel[i][1]);
  return Math.abs(a / 2);
}

/** Área média dos talhões no papel (mm²): soma dos anéis externos em px² / s² / quantidade. */
export function areaMediaMm2(geoms: TalhaoPx[], s: number): number {
  if (!geoms.length || !(s > 0)) return 0;
  let soma = 0;
  for (const g of geoms) for (const poly of g.xy) if (poly[0]?.length >= 4) soma += areaAnel(poly[0]);
  return soma / (s * s) / geoms.length;
}

/** Ponto do rótulo (polylabel no maior polígono) e a área em px². */
function ancora(xy: MultiPolyXY, precisao: number): { x: number; y: number; area: number } | null {
  let melhor: Ring[] | null = null;
  let maior = 0;
  for (const poly of xy) {
    if (!poly.length || poly[0].length < 4) continue;
    const a = areaAnel(poly[0]);
    if (a > maior) {
      maior = a;
      melhor = poly;
    }
  }
  if (!melhor) return null;
  const p = polylabel(melhor, precisao);
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { x: p[0], y: p[1], area: maior } : null;
}

/** Número do talhão: cinza escuro (não preto) com halo fino e translúcido, discreto ao lado dos valores dos PICs. */
const COR_ROTULO_TALHAO = '#3A4541';
const HALO_ROTULO_TALHAO = 'rgba(255,255,255,0.75)';
/** espessura do halo do número do talhão, em fração do tamanho da fonte (o mesmo nas caixas da anticolisão) */
const FRACAO_HALO_TALHAO = 0.15;

/**
 * Rótulos dos talhões (`geoms`, tamanho por `tamanhoRotuloTalhaoMm` da área média), gotas e valores dos
 * PICs que caem no quadro visível. `reservas` = áreas onde nada é escrito (título, rosa, escala, grade).
 */
export function desenharRotulosEPics(
  ctx: CanvasRenderingContext2D,
  v: Vista,
  inp: RenderInput,
  geoms: TalhaoPx[],
  reservas: Rect[],
): void {
  const s = v.s;
  const placer = new LabelPlacer({ x: v.x, y: v.y, w: v.w, h: v.h });
  reservas.forEach((r) => placer.reserva(r));

  const altGota = 5.5 * s;
  const meiaGota = (LARGURA_GOTA / 2) * altGota;
  const pics = inp.pics
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
    .map((p) => ({ p, xy: v.paraPx(...lonLatToMerc(p.lon, p.lat)) }))
    .filter(({ xy }) => xy[0] >= v.x && xy[0] <= v.x + v.w && xy[1] >= v.y && xy[1] <= v.y + v.h);
  for (const { xy } of pics) placer.reserva({ x: xy[0] - meiaGota, y: xy[1], w: 2 * meiaGota, h: altGota });

  // valores dos PICs (3,5 mm fixo; prioridade sobre os rótulos dos talhões; sempre desenhados)
  const pxPic = 3.5 * s;
  const haloPic = 0.8 * s;
  const capPic = pxPic * ALTURA_MAIUSC;
  const valores: { txt: string; r: Rect }[] = [];
  ctx.save();
  if (inp.config.mostrarValoresPics) {
    ctx.font = fonte(700, pxPic);
    for (const { p, xy } of pics) {
      if (p.chuva === null || !Number.isFinite(p.chuva)) continue;
      const [x, y] = xy;
      const txt = fmtChuva(p.chuva);
      const meio = y + 0.7 * altGota + capPic / 2;
      const cands = [
        caixaTexto(ctx, txt, x + 1.0 * s, y - 0.3 * s, pxPic, haloPic, 'left'),
        caixaTexto(ctx, txt, x - 1.0 * s, y - 0.3 * s, pxPic, haloPic, 'right'),
        caixaTexto(ctx, txt, x + meiaGota + 0.8 * s, meio, pxPic, haloPic, 'left'),
        caixaTexto(ctx, txt, x - meiaGota - 0.8 * s, meio, pxPic, haloPic, 'right'),
        caixaTexto(ctx, txt, x, y - 1.4 * s, pxPic, haloPic, 'center'),
        caixaTexto(ctx, txt, x, y + altGota + 0.8 * s + haloPic + capPic, pxPic, haloPic, 'center'),
      ];
      let r = placer.tenta(cands);
      if (!r) {
        r = cands[0];
        placer.reserva(r);
      }
      valores.push({ txt, r });
    }
  }

  // rótulos dos talhões (maiores primeiro; sem lugar livre = sem rótulo)
  const pxTal = tamanhoRotuloTalhaoMm(areaMediaMm2(geoms, s)) * s;
  const haloTal = FRACAO_HALO_TALHAO * pxTal;
  const capTal = pxTal * ALTURA_MAIUSC;
  const rotulos: { txt: string; r: Rect }[] = [];
  if (inp.config.mostrarRotulosTalhoes) {
    ctx.font = fonte(400, pxTal);
    const itens = geoms
      .map((g) => ({ txt: (g.t.nome ?? '').trim(), a: ancora(g.xy, 0.5 * s) }))
      .filter((i): i is { txt: string; a: { x: number; y: number; area: number } } => !!i.txt && !!i.a)
      .sort((a, b) => b.a.area - a.a.area);
    const passo = capTal + 2 * haloTal;
    for (const { txt, a } of itens) {
      const base = a.y + capTal / 2;
      const cands = [0, -1, 1].map((d) => caixaTexto(ctx, txt, a.x, base + d * passo, pxTal, haloTal, 'center'));
      const r = placer.tenta(cands);
      if (r) rotulos.push({ txt, r });
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = fonte(400, pxTal);
  for (const { txt, r } of rotulos) textoComHalo(ctx, txt, r.x + haloTal, r.y + haloTal + capTal, COR_ROTULO_TALHAO, HALO_ROTULO_TALHAO, haloTal);
  for (const { p, xy } of pics) desenharGota(ctx, xy[0], xy[1], altGota, s, picSemChuva(p.chuva));
  ctx.font = fonte(700, pxPic);
  const estilo = estiloValorPic(inp.config.destaquePics);
  for (const { txt, r } of valores) {
    if (estilo.caixa) {
      ctx.fillStyle = estilo.caixa;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 0.6 * s);
      ctx.fill();
    }
    textoComHalo(ctx, txt, r.x + haloPic, r.y + haloPic + capPic, estilo.texto, estilo.halo ?? undefined, estilo.halo ? haloPic : 0);
  }
  ctx.restore();
}
