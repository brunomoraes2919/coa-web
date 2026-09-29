/**
 * Quadro do mapa: mapa base, raster classificado, talhões do grupo (contorno) e situação do plantio
 * (áreas da cultura ou talhões base: plantado, plantando, a plantar), os talhões de outros quadros
 * esmaecidos, grade de coordenadas, rótulos, PICs, título do quadro, rosa e escala — com clip no
 * quadro visível. A legenda fica no painel (painel.ts).
 */
import { centroideDe, vincularAreas } from '../lib/areasEspacial';
import { geomToXY, lonLatToMerc, mercToLonLat, type MultiPolyXY } from '../lib/projection';
import type { AreaCultura, MapExtent, StatusPlantio, Talhao } from '../lib/types';
import type { ClassesGrid } from './classes';
import { desenharGrade } from './grade';
import { ALTURA_MAIUSC, fonte, type Rect } from './labels';
import { planejarRosa } from './northArrow';
import { desenharPadrao } from './patterns';
import { desenharRaster } from './raster';
import { desenharRotulosEPics, type TalhaoPx } from './rotulosMapa';
import { planejarEscala } from './scalebar';
import { ESTILO_SITUACAO, situacaoDe } from './situacao';
import { desenharTiles, type TileCarregado } from './tiles';
import { COR_LARANJA, COR_VERDE, FUNDO_85, QUADRO_MM, type RenderInput, type Vista } from './types';

export type { TalhaoPx } from './rotulosMapa';

/**
 * Monta a vista do quadro para o extent e a escala s (px por mm do A3).
 * `quadro` = retângulo da composição (mm do A3; o centro do extent fica no centro dele);
 * `visivel` = parte que aparece (mm; padrão = o quadro inteiro).
 */
export function criarVista(ext: MapExtent, s: number, quadro: Rect = QUADRO_MM, visivel: Rect = quadro): Vista {
  const cxPx = (quadro.x + quadro.w / 2) * s;
  const cyPx = (quadro.y + quadro.h / 2) * s;
  const k = s / ext.mPorMm;
  const mPorPx = ext.mPorMm / s;
  return {
    s,
    x: visivel.x * s,
    y: visivel.y * s,
    w: visivel.w * s,
    h: visivel.h * s,
    ext,
    mPorPx,
    latCentro: mercToLonLat(ext.cx, ext.cy)[1],
    paraPx: (mx, my) => [cxPx + (mx - ext.cx) * k, cyPx - (my - ext.cy) * k],
    paraMerc: (px, py) => [ext.cx + (px - cxPx) * mPorPx, ext.cy - (py - cyPx) * mPorPx],
  };
}

function tracar(ctx: CanvasRenderingContext2D, xy: MultiPolyXY): void {
  for (const poly of xy)
    for (const anel of poly) {
      if (anel.length < 2) continue;
      ctx.moveTo(anel[0][0], anel[0][1]);
      for (let i = 1; i < anel.length; i++) ctx.lineTo(anel[i][0], anel[i][1]);
      ctx.closePath();
    }
}

function caixaDe(geoms: { xy: MultiPolyXY }[]): Rect | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geoms)
    for (const poly of g.xy)
      for (const [x, y] of poly[0] ?? []) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function intersecao(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Área da cultura (ou outra feição pintada) já projetada em px. */
export interface FeicaoPx {
  id: string;
  xy: MultiPolyXY;
}

/** Ordem de desenho dos contornos de situação (o plantado fica por cima). */
const ORDEM_CONTORNO: readonly StatusPlantio[] = ['a_plantar', 'plantando', 'plantado'];

/**
 * Talhões base (contorno preto) e a situação do plantio. Com `areas` (áreas da cultura projetadas),
 * elas são pintadas no lugar dos talhões base (sem situação = a plantar); sem áreas, os talhões base
 * com situação. Plantado = padrão escolhido + contorno laranja; plantando = hachura + contorno
 * amarelos; a plantar = só contorno tracejado cinza (no modo sem áreas, no lugar do contorno preto).
 */
export function desenharTalhoes(ctx: CanvasRenderingContext2D, v: Vista, geoms: TalhaoPx[], inp: RenderInput, areas: FeicaoPx[] = []): void {
  const s = v.s;
  const comAreas = areas.length > 0;
  const pintados: { xy: MultiPolyXY; status: StatusPlantio }[] = comAreas
    ? areas.map((a) => ({ xy: a.xy, status: situacaoDe(inp, a.id) ?? 'a_plantar' }))
    : geoms.flatMap((g) => {
        const status = situacaoDe(inp, g.t.id);
        return status ? [{ xy: g.xy, status }] : [];
      });
  const quadro: Rect = { x: v.x, y: v.y, w: v.w, h: v.h };
  ctx.save();
  ctx.lineJoin = 'round';
  // Um clip por feição: com um clip "evenodd" único, a área onde duas se sobrepõem ficaria sem
  // padrão. O padrão é ancorado no canto do quadro e continua contínuo entre feições.
  for (const p of pintados) {
    const e = ESTILO_SITUACAO[p.status];
    const estilo = e.preenchimento === 'padrao' ? inp.config.estiloPlantado : e.preenchimento === 'hachura' ? 'diagonal' : null;
    if (!estilo || estilo === 'contorno') continue;
    const caixa = caixaDe([p]);
    const area = caixa && intersecao(caixa, quadro);
    if (!area) continue;
    ctx.save();
    ctx.beginPath();
    tracar(ctx, p.xy);
    ctx.clip('evenodd'); // evenodd dentro da feição: os furos (anéis internos) ficam sem padrão
    const opcoes = e.preenchimento === 'hachura' ? { cor: e.cor, alfa: 0.9, larguraMm: 0.35 } : undefined;
    desenharPadrao(ctx, estilo, area, s, [v.x, v.y], opcoes);
    ctx.restore();
  }
  const pretos = comAreas ? geoms : geoms.filter((g) => situacaoDe(inp, g.t.id) !== 'a_plantar');
  if (pretos.length) {
    ctx.beginPath();
    pretos.forEach((g) => tracar(ctx, g.xy));
    ctx.lineWidth = 0.4 * s;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  }
  for (const status of ORDEM_CONTORNO) {
    const grupo = pintados.filter((p) => p.status === status);
    if (!grupo.length) continue;
    const e = ESTILO_SITUACAO[status];
    ctx.save();
    ctx.beginPath();
    grupo.forEach((p) => tracar(ctx, p.xy));
    ctx.lineWidth = e.larguraMm * s;
    ctx.strokeStyle = e.contorno;
    if (e.tracejadoMm) ctx.setLineDash(e.tracejadoMm.map((d) => d * s));
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Talhões de outros quadros que aparecem neste: véu branco de 70% (ficam a 30%) e contorno cinza
 * claro, sem rótulo.
 */
function esmaecer(ctx: CanvasRenderingContext2D, v: Vista, outros: TalhaoPx[]): void {
  if (!outros.length) return;
  ctx.save();
  ctx.beginPath();
  outros.forEach((g) => tracar(ctx, g.xy));
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill('evenodd');
  ctx.lineWidth = 0.25 * v.s;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#B8BEBC';
  ctx.stroke();
  ctx.restore();
}

/**
 * Distribui as áreas da cultura entre os quadros (um array por grupo, na mesma ordem): cada área vai
 * para o quadro do talhão base que a contém (vínculo espacial, não pelo código — subáreas "032A"
 * dentro do "032"); área sem talhão base (ou com o talhão fora dos quadros) vai para o quadro cujo
 * bbox contém o centróide dela, ou o mais próximo. Com um quadro só, todas.
 */
export function areasDosQuadros(
  areas: AreaCultura[],
  talhoes: Talhao[],
  grupos: readonly { ids: readonly string[]; bbox: readonly [number, number, number, number] }[],
): AreaCultura[][] {
  if (grupos.length <= 1) return grupos.map(() => areas);
  const grupoDoTalhao = new Map<string, number>();
  grupos.forEach((g, i) => g.ids.forEach((id) => grupoDoTalhao.set(id, i)));
  const vinculo = vincularAreas(areas, talhoes);
  const out: AreaCultura[][] = grupos.map(() => []);
  for (const a of areas) {
    const base = vinculo.get(a.id);
    let i = base ? (grupoDoTalhao.get(base.id) ?? -1) : -1;
    if (i < 0) {
      const [lon, lat] = centroideDe(a.geom);
      const [x, y] = lonLatToMerc(lon, lat);
      let menor = Infinity;
      grupos.forEach((g, k) => {
        const [x0, y0, x1, y1] = g.bbox;
        const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
        if (d < menor) {
          menor = d;
          i = k;
        }
      });
    }
    if (i >= 0) out[i].push(a);
  }
  return out;
}

/** Texto do título do quadro (caixa alta). Vazio = sem título. */
export function textoTituloQuadro(titulo: string | null | undefined): string {
  return (titulo ?? '').trim().toLocaleUpperCase('pt-BR');
}

/** Título no canto superior esquerdo: Open Sans 700 4,5 mm sobre branco 85%, filete laranja à esquerda. */
function planejarTitulo(ctx: CanvasRenderingContext2D, v: Vista, titulo: string): { area: Rect; desenhar(): void } | null {
  const txt = textoTituloQuadro(titulo);
  if (!txt) return null;
  const s = v.s;
  const px = 4.5 * s;
  const cap = px * ALTURA_MAIUSC;
  ctx.save();
  ctx.font = fonte(700, px);
  const largMax = v.w * 0.6;
  const larg = Math.min(ctx.measureText(txt).width, largMax);
  ctx.restore();
  const filete = 1 * s;
  const padE = 2.4 * s;
  const padD = 2.6 * s;
  const padV = 2 * s;
  const area: Rect = { x: v.x + 3 * s, y: v.y + 3 * s, w: filete + padE + larg + padD, h: cap + 2 * padV };
  const desenhar = () => {
    ctx.save();
    ctx.fillStyle = FUNDO_85;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = COR_LARANJA;
    ctx.fillRect(area.x, area.y, filete, area.h);
    ctx.font = fonte(700, px);
    ctx.fillStyle = COR_VERDE;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(txt, area.x + filete + padE, area.y + padV + cap, largMax);
    ctx.restore();
  };
  return { area, desenhar };
}

export interface OpcoesQuadro {
  /** título do quadro (null = sem título, quadro único) */
  titulo: string | null;
  /** ids dos talhões deste quadro; null = todos */
  ids: ReadonlySet<string> | null;
  /** áreas da cultura pintadas neste quadro (areasDosQuadros); ausente = todas */
  areas?: AreaCultura[];
}

/** Desenha o conteúdo do quadro (com clip), os elementos sobre o mapa e a borda verde de 0,5 mm. */
export function desenharQuadro(
  ctx: CanvasRenderingContext2D,
  v: Vista,
  inp: RenderInput,
  classes: ClassesGrid | null,
  tiles: TileCarregado[],
  opcoes: OpcoesQuadro,
): void {
  const s = v.s;
  // fundo com sombra sutil
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 1.6 * s;
  ctx.shadowOffsetY = 0.4 * s;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(v.x, v.y, v.w, v.h);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(v.x, v.y, v.w, v.h);
  ctx.clip();

  if (inp.tiles && tiles.length) desenharTiles(ctx, v, tiles, inp.tiles.clarear);
  if (inp.grid && classes) desenharRaster(ctx, v, inp.grid, classes.idx, inp.palette);

  const projetar = (lon: number, lat: number) => v.paraPx(...lonLatToMerc(lon, lat));
  const todos: TalhaoPx[] = inp.talhoes
    .filter((t) => t.geom && Array.isArray(t.geom.coordinates))
    .map((t) => ({ t, xy: geomToXY(t.geom, projetar) }));
  const ids = opcoes.ids;
  const geoms = ids ? todos.filter((g) => ids.has(g.t.id)) : todos;
  const quadro: Rect = { x: v.x, y: v.y, w: v.w, h: v.h };
  const cortaQuadro = (g: TalhaoPx) => {
    const c = caixaDe([g]);
    return !!c && !!intersecao(c, quadro);
  };
  const outros = ids ? todos.filter((g) => !ids.has(g.t.id) && cortaQuadro(g)) : [];
  const areas: FeicaoPx[] = (opcoes.areas ?? inp.areasCultura ?? [])
    .filter((a) => a.geom && Array.isArray(a.geom.coordinates))
    .map((a) => ({ id: a.id, xy: geomToXY(a.geom, projetar) }));
  desenharTalhoes(ctx, v, geoms, inp, areas);
  esmaecer(ctx, v, outros);

  const titulo = opcoes.titulo ? planejarTitulo(ctx, v, opcoes.titulo) : null;
  const rosa = planejarRosa(ctx, v);
  const escala = planejarEscala(ctx, v);
  const ocupadas = [rosa.area, escala.area, ...(titulo ? [titulo.area] : [])];
  const grade = inp.config.mostrarGrade ? desenharGrade(ctx, v, ocupadas) : [];
  desenharRotulosEPics(ctx, v, inp, geoms, [...ocupadas, ...grade]);
  titulo?.desenhar();
  rosa.desenhar();
  escala.desenhar();
  ctx.restore();

  ctx.save();
  const borda = 0.5 * s;
  ctx.lineWidth = borda;
  ctx.strokeStyle = COR_VERDE;
  ctx.strokeRect(v.x + borda / 2, v.y + borda / 2, v.w - borda, v.h - borda);
  ctx.restore();
}
