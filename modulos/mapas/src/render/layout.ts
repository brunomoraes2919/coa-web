/**
 * Página do layout: folha branca com moldura verde de 6 mm, um ou mais quadros de mapa e o
 * painel (lateral em paisagem, faixa inferior em retrato), conforme `compor()`.
 *
 * Unidades: o desenho é feito em "mm do A3" (paisagem 420×297, retrato 297×420); no A4 o desenho é
 * o mesmo × 297/420. Tudo é desenhado em pixels de dispositivo (transformação identidade, ou só uma
 * translação no modo de encaixe): cada medida em mm é multiplicada por s = pxPorMm × fator, e as
 * fontes recebem o tamanho já em px.
 *
 * Canvas: deve ter `paginaDe(inp)` × pxPorMm pixels (a orientação vem da composição). Se o canvas
 * for menor que isso (ex.: canvas em paisagem para uma composição em retrato), a página é reduzida
 * para caber e centralizada (modo de encaixe) em vez de sair cortada.
 */
import { geomToXY, lonLatToMerc } from '../lib/projection';
import type { MapExtent, Talhao } from '../lib/types';
import { classesDoGrid, type ClassesGrid } from './classes';
import { compor, type Composicao } from './composicao';
import type { Rect } from './labels';
import { areasDosQuadros, criarVista, desenharQuadro } from './mapFrame';
import { desenharPainel } from './painel';
import { carregarTiles, dividirOrcamentoTiles, type TileCarregado } from './tiles';
import { COR_VERDE, MOLDURA_MM, PAGINA_MM, QUADRO_MM, type RenderInput, type Vista } from './types';

const MARGEM_AUTO = 0.06;
const AMOSTRA_FONTE = 'MAPA DE PRECIPITAÇÃO ÁÉÍÓÚÂÊÔÃÕÇ 0123456789 – · ≤';

/** Quadro do mapa em A3 paisagem com um quadro (mm). Para a composição adaptativa use `composicaoDe(inp).quadros`. */
export function mapFrameRectMm(): { x: number; y: number; w: number; h: number } {
  return { ...QUADRO_MM };
}

/**
 * Enquadra o bbox Mercator dos talhões no quadro `quadro` (mm do A3; padrão = quadro da paisagem
 * com um quadro), com 6% de margem de cada lado.
 */
export function autoExtent(talhoes: Talhao[], quadro: { w: number; h: number } = QUADRO_MM): MapExtent {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of talhoes) {
    if (!t.geom || !Array.isArray(t.geom.coordinates)) continue;
    for (const poly of geomToXY(t.geom, lonLatToMerc))
      for (const anel of poly)
        for (const [x, y] of anel) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
  }
  if (!(x1 >= x0 && y1 >= y0)) {
    const [cx, cy] = lonLatToMerc(-55, -15); // sem talhões: centro do Brasil
    return { cx, cy, mPorMm: 10000 };
  }
  const util = 1 - 2 * MARGEM_AUTO;
  const mPorMm = Math.max((x1 - x0) / (quadro.w * util), (y1 - y0) / (quadro.h * util), 1);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, mPorMm };
}

function extentValido(e: MapExtent | null | undefined): e is MapExtent {
  return !!e && Number.isFinite(e.cx) && Number.isFinite(e.cy) && Number.isFinite(e.mPorMm) && e.mPorMm > 0;
}

// cache da composição: a prévia redesenha a cada arrasto e o agrupamento percorre todos os vértices
const cacheComposicao = new WeakMap<Talhao[], Map<string, Composicao>>();

/** Composição da folha para a entrada (orientação, quadros, painel), com cache por lista de talhões. */
export function composicaoDe(inp: Pick<RenderInput, 'talhoes' | 'config'>): Composicao {
  const { orientacao, quadros, pagina } = inp.config;
  const chave = `${orientacao ?? 'auto'}|${quadros ?? 'auto'}|${pagina}`;
  let porChave = cacheComposicao.get(inp.talhoes);
  if (!porChave) {
    porChave = new Map();
    cacheComposicao.set(inp.talhoes, porChave);
  }
  let c = porChave.get(chave);
  if (!c) {
    c = compor(inp.talhoes, { orientacao, quadros, pagina });
    porChave.set(chave, c);
  }
  return c;
}

/** Tamanho real da folha em mm (A3/A4, já na orientação da composição) — o canvas deve ter isto × pxPorMm. */
export function paginaDe(inp: Pick<RenderInput, 'talhoes' | 'config'>): { w: number; h: number } {
  return { ...composicaoDe(inp).pagina };
}

/** Tamanho do desenho em mm do A3 para a orientação. */
export function desenhoA3(orientacao: Composicao['orientacao']): { w: number; h: number } {
  return orientacao === 'paisagem' ? { w: 420, h: 297 } : { w: 297, h: 420 };
}

/** Parte de `r` (mm do A3) que fica dentro da moldura verde de 6 mm da folha `folha` (mm do A3). */
export function areaVisivel(r: Rect, folha: { w: number; h: number }, moldura = MOLDURA_MM): Rect {
  const x0 = Math.max(r.x, moldura);
  const y0 = Math.max(r.y, moldura);
  const x1 = Math.min(r.x + r.w, folha.w - moldura);
  const y1 = Math.min(r.y + r.h, folha.h - moldura);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Enquadramento de cada quadro: o `config.extent` (manual) só vale com um quadro; com vários, cada
 * um enquadra automaticamente os talhões do seu grupo no seu retângulo.
 */
export function extentsDosQuadros(inp: Pick<RenderInput, 'talhoes' | 'config'>, comp: Composicao): MapExtent[] {
  if (comp.quadros.length === 1) {
    const q = comp.quadros[0];
    return [extentValido(inp.config.extent) ? inp.config.extent : autoExtent(inp.talhoes, q.rect)];
  }
  return comp.quadros.map((q) => {
    const ids = new Set(q.grupo.ids);
    return autoExtent(
      inp.talhoes.filter((t) => ids.has(t.id)),
      q.rect,
    );
  });
}

async function carregarFontes(): Promise<void> {
  const fontes = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fontes) return;
  try {
    await Promise.all([
      fontes.load('400 10px "Open Sans"', AMOSTRA_FONTE),
      fontes.load('700 10px "Open Sans"', AMOSTRA_FONTE),
    ]);
  } catch {
    // segue com a fonte substituta
  }
}

/** Moldura verde em volta da folha (desenho de w×h mm do A3). */
function desenharMoldura(ctx: CanvasRenderingContext2D, folha: { w: number; h: number }, s: number): void {
  const m = MOLDURA_MM * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, folha.w * s, folha.h * s);
  ctx.rect(m, m, folha.w * s - 2 * m, folha.h * s - 2 * m);
  ctx.fillStyle = COR_VERDE;
  ctx.fill('evenodd');
  ctx.restore();
}

/**
 * Desenha o layout completo. O canvas deve ter `paginaDe(inp)` × pxPorMm pixels (veja o cabeçalho
 * sobre o modo de encaixe). A transformação do contexto é ignorada. Tiles que falham viram aviso,
 * nunca erro.
 */
export async function renderLayout(
  ctx: CanvasRenderingContext2D,
  inp: RenderInput,
  pxPorMm: number,
): Promise<{ avisos: string[] }> {
  const avisos: string[] = [];
  const comp = composicaoDe(inp);
  const folha = desenhoA3(comp.orientacao);
  const fator = inp.config.pagina === 'A4' ? PAGINA_MM.A4.w / PAGINA_MM.A3.w : 1;
  let s = pxPorMm * fator;
  let ox = 0;
  let oy = 0;
  const cw = ctx.canvas?.width ?? 0;
  const ch = ctx.canvas?.height ?? 0;
  if (cw > 0 && ch > 0 && (cw + 1 < folha.w * s || ch + 1 < folha.h * s)) {
    // canvas menor que a página (orientação diferente): reduz e centraliza
    s = Math.min(cw / folha.w, ch / folha.h);
    ox = Math.round((cw - folha.w * s) / 2);
    oy = Math.round((ch - folha.h * s) / 2);
  }

  const extents = extentsDosQuadros(inp, comp);
  const vistas: Vista[] = comp.quadros.map((q, i) => criarVista(extents[i], s, q.rect, areaVisivel(q.rect, folha)));

  // tudo que é assíncrono acontece antes de desenhar: o desenho em si é síncrono e completo
  await carregarFontes();
  let tiles: TileCarregado[][] = vistas.map(() => []);
  if (inp.tiles) {
    const fonteTiles = inp.tiles;
    // orçamento de 400 tiles por renderização, dividido entre os quadros pela área
    const cotas = dividirOrcamentoTiles(vistas.map((v) => v.w * v.h));
    const rs = await Promise.all(vistas.map((v, i) => carregarTiles(v, fonteTiles, cotas[i])));
    tiles = rs.map((r) => r.tiles);
    const falhas = rs.reduce((n, r) => n + r.falhas, 0);
    const total = rs.reduce((n, r) => n + r.total, 0);
    const carregados = rs.reduce((n, r) => n + r.tiles.length, 0);
    if (falhas > 0 && carregados === 0) avisos.push('Mapa base indisponível');
    else if (falhas > 0) avisos.push(`Mapa base incompleto: ${falhas} de ${total} partes não carregaram`);
  }

  let classes: ClassesGrid | null = null;
  const g = inp.grid;
  if (g) {
    if (g.values.length === g.cols * g.rows && inp.palette.classes.length) classes = classesDoGrid(g, inp.palette); // cache por grid/paleta
    else avisos.push('Interpolação inválida: o raster não foi desenhado');
  }

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (ox || oy) {
      ctx.fillStyle = '#E4E8E7';
      ctx.fillRect(0, 0, cw, ch);
      ctx.setTransform(1, 0, 0, 1, ox, oy);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ox || oy ? folha.w * s : Math.max(cw, folha.w * s), ox || oy ? folha.h * s : Math.max(ch, folha.h * s));
    const multiplos = comp.quadros.length > 1;
    const areas = areasDosQuadros(inp.areasCultura ?? [], inp.talhoes, comp.quadros.map((q) => q.grupo));
    comp.quadros.forEach((q, i) =>
      desenharQuadro(ctx, vistas[i], inp, classes, tiles[i], {
        titulo: q.titulo,
        ids: multiplos ? new Set(q.grupo.ids) : null,
        areas: areas[i],
      }),
    );
    const comTiles = !!inp.tiles && tiles.some((t) => t.length > 0);
    desenharPainel(ctx, comp, inp, s, {
      painel: areaVisivel(comp.painel, folha),
      presentes: classes ? classes.presentes : null,
      atribuicao: comTiles && inp.tiles ? inp.tiles.atribuicao : null,
    });
    desenharMoldura(ctx, folha, s);
  } finally {
    ctx.restore();
  }
  return { avisos };
}
