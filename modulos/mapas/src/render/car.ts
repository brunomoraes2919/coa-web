/**
 * Desenho do Mapa de CAR e Matrícula no quadro: vegetação nativa, talhões (agrícola e eucalipto), APP, reserva legal
 * (hachura), água (polígonos e linhas), estradas, contorno das matrículas (tracejado) e dos CARs, e os rótulos
 * "CAR 1", "Mat. 12.345". As cores ficam aqui para a legenda usar as mesmas.
 */
import type { Feature, Geometry, Position } from 'geojson';
import polylabel from 'polylabel';
import { categoriaDoTema, escurecer, type QuadroCar } from '../lib/car';
import { geomToXY, lonLatToMerc } from '../lib/projection';
import type { DadosCar, Talhao } from '../lib/types';
import { compor, PAINEL_MAX_MM } from './composicao';
import { ALTURA_MAIUSC, fonte, textoComHalo, type Rect } from './labels';
import { desenharPadrao } from './patterns';
import type { TalhaoPx } from './rotulosMapa';
import type { Vista } from './types';

/** Entrada do Mapa de CAR e Matrícula (RenderInput.car). `dados` já sem os CARs cancelados (dadosValidos). */
export interface EntradaCar {
  dados: DadosCar;
  quadro: QuadroCar;
  /** id do talhão → uso (eucalipto pelo PIMS; o resto é agrícola) */
  usoTalhao: Map<string, 'agricola' | 'eucalipto'>;
  /** o SIGEF respondeu na última busca? (false: as matrículas não foram consultadas, não "zero matrículas") */
  sigefOk?: boolean;
}

/** Cores e traços (mm do A3) do mapa e da legenda. */
export const ESTILO_CAR = {
  // o talhão é só contorno: o fundo é a cor da matrícula (ou o tom do CAR), que é o que o mapa quer diferenciar
  agricola: { contorno: '#6F6450' },
  // eucalipto e vegetação nativa em padrão (grade e pontos), para a cor da matrícula aparecer por baixo
  eucalipto: { padrao: '#24502A', contorno: '#24502A' },
  vegetacaoNativa: { padrao: '#2F7A34' },
  app: { fill: '#F7D560', contorno: '#B98A00' },
  reservaLegal: { hachura: '#1F6B2A', contorno: '#1F6B2A' },
  agua: { fill: '#A9D3F2', linha: '#2E7CC4' },
  estrada: { cor: '#8A6A55' },
  rodovia: { cor: '#5B4033' },
  /** opacidade do preenchimento de cada matrícula e do tom de dentro de cada CAR */
  matricula: { alfa: 0.62 },
  car: { tom: 0.13 },
} as const;

type XY = [number, number];

/** Projeta os polígonos de uma geometria em px (anéis). */
function poligonosPx(g: Geometry | null, p: (lon: number, lat: number) => XY): XY[][][] {
  if (!g) return [];
  const polys: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((poly) => poly.map((anel) => anel.map(([x, y]) => p(x, y))));
}

/** Projeta as linhas de uma geometria em px. */
function linhasPx(g: Geometry | null, p: (lon: number, lat: number) => XY): XY[][] {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates.map(([x, y]) => p(x, y))];
  if (g.type === 'MultiLineString') return g.coordinates.map((l) => l.map(([x, y]) => p(x, y)));
  return [];
}

function tracarPolys(ctx: CanvasRenderingContext2D, polys: XY[][][]): void {
  for (const poly of polys)
    for (const anel of poly) {
      if (anel.length < 3) continue;
      ctx.moveTo(anel[0][0], anel[0][1]);
      for (let i = 1; i < anel.length; i++) ctx.lineTo(anel[i][0], anel[i][1]);
      ctx.closePath();
    }
}

function tracarLinhas(ctx: CanvasRenderingContext2D, linhas: XY[][]): void {
  for (const l of linhas) {
    if (l.length < 2) continue;
    ctx.moveTo(l[0][0], l[0][1]);
    for (let i = 1; i < l.length; i++) ctx.lineTo(l[i][0], l[i][1]);
  }
}

function caixa(polys: XY[][][]): Rect | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys)
    for (const [x, y] of poly[0] ?? []) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Linhas no quadro de áreas acima das quais a faixa de baixo do retrato não comporta o quadro (fica na paisagem). */
export const LINHAS_QUADRO_RETRATO = 16;
/** O retrato só ganha da paisagem com o mapa pelo menos este tanto maior. */
const GANHO_RETRATO = 1.05;

/**
 * Folha do Mapa de CAR: a orientação e, na paisagem, a largura do painel lateral. `itens` = o que o mapa enquadra
 * (talhões e os CARs e matrículas da fazenda), não só os talhões como nos outros mapas.
 * - Paisagem: o quadro do mapa estreita até a largura que a altura pede (sem branco dos lados) e o painel fica com
 *   o resto, até PAINEL_MAX_MM; desenho mais largo que o quadro fica com o painel normal.
 * - Automática: retrato quando o mapa sai maior nele e o quadro de áreas cabe na faixa de baixo; senão, paisagem.
 */
export function folhaDoMapaCar(
  itens: Talhao[],
  escolhida: 'auto' | 'paisagem' | 'retrato' | undefined,
  linhasQuadro: number,
): { orientacao: 'paisagem' | 'retrato'; painelMm?: number } {
  if (escolhida === 'retrato') return { orientacao: 'retrato' };
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of itens) {
    if (!t.geom || !Array.isArray((t.geom as { coordinates?: unknown }).coordinates)) continue;
    for (const poly of geomToXY(t.geom, lonLatToMerc))
      for (const [x, y] of poly[0] ?? []) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
  }
  if (!(x1 > x0 && y1 > y0)) return { orientacao: 'paisagem' };
  const [bw, bh] = [x1 - x0, y1 - y0];
  const paisagem = compor([], { orientacao: 'paisagem', quadros: 1, pagina: 'A3' });
  const q = paisagem.quadros[0].rect;
  // largura que o quadro perde: o que sobraria dos lados com o desenho na altura toda
  const extra = Math.max(0, Math.min(q.w - (q.h * bw) / bh, PAINEL_MAX_MM - paisagem.painel.w));
  const comPainel = { orientacao: 'paisagem' as const, painelMm: paisagem.painel.w + extra };
  if (escolhida === 'paisagem') return comPainel;
  const escala = (r: { w: number; h: number }) => Math.min(r.w / bw, r.h / bh);
  const retrato = compor([], { orientacao: 'retrato', quadros: 1, pagina: 'A3' }).quadros[0].rect;
  const melhorRetrato = escala(retrato) > GANHO_RETRATO * escala({ w: q.w - extra, h: q.h });
  return melhorRetrato && linhasQuadro <= LINHAS_QUADRO_RETRATO ? { orientacao: 'retrato' } : comPainel;
}

/** Classes de estrada do OSM que saem como rodovia (traço cheio e mais grosso); o resto é estrada de terra/carreador. */
const RODOVIA_OSM = /^(motorway|trunk|primary|secondary)(_link)?$/;

/** Uma estrada é rodovia? (IBGE = sempre; OSM = pelas classes principais). */
export function ehRodovia(f: Feature): boolean {
  const p = f.properties ?? {};
  return p.fonte === 'ibge' || RODOVIA_OSM.test(String(p.classe ?? ''));
}

/** Desenha as camadas do CAR no lugar dos talhões coloridos dos outros mapas. */
export function desenharCar(ctx: CanvasRenderingContext2D, v: Vista, geoms: TalhaoPx[], car: EntradaCar): void {
  const s = v.s;
  const p = (lon: number, lat: number) => v.paraPx(...lonLatToMerc(lon, lat)) as XY;
  const temas = car.dados.temas.features.map((f) => ({ cat: categoriaDoTema(String(f.properties?.tema ?? '')), polys: poligonosPx(f.geometry, p) }));
  const quadro: Rect = { x: v.x, y: v.y, w: v.w, h: v.h };
  /**
   * Pinta cada polígono sozinho (par-ímpar só dentro dele, para os furos): num caminho único, a área onde duas
   * feições se sobrepõem ficaria sem cor.
   */
  const preencher = (polys: XY[][][], cor: string) => {
    ctx.fillStyle = cor;
    for (const poly of polys) {
      ctx.beginPath();
      tracarPolys(ctx, [poly]);
      ctx.fill('evenodd');
    }
  };
  const contornar = (polys: XY[][][], cor: string, mm: number, traco: number[] | null = null) => {
    if (!polys.length) return;
    ctx.save();
    ctx.beginPath();
    tracarPolys(ctx, polys);
    ctx.lineWidth = mm * s;
    ctx.strokeStyle = cor;
    if (traco) ctx.setLineDash(traco.map((d) => d * s));
    ctx.stroke();
    ctx.restore();
  };
  const dos = (cat: string) => temas.filter((t) => t.cat === cat).flatMap((t) => t.polys);
  /** padrão (grade, pontos, hachura) recortado em cada polígono, ancorado no canto do quadro */
  const padrao = (polys: XY[][][], estilo: 'quadriculado' | 'pontilhado' | 'diagonal', cor: string, alfa: number, mm: number) => {
    for (const poly of polys) {
      const c = caixa([poly]);
      if (!c) continue;
      const x0 = Math.max(c.x, quadro.x);
      const y0 = Math.max(c.y, quadro.y);
      const x1 = Math.min(c.x + c.w, quadro.x + quadro.w);
      const y1 = Math.min(c.y + c.h, quadro.y + quadro.h);
      if (x1 <= x0 || y1 <= y0) continue;
      ctx.save();
      ctx.beginPath();
      tracarPolys(ctx, [poly]);
      ctx.clip('evenodd');
      desenharPadrao(ctx, estilo, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, s, [v.x, v.y], { cor, alfa, larguraMm: mm });
      ctx.restore();
    }
  };
  // cor de cada CAR e matrícula (do quadro: vizinhos não repetem)
  const corCar = new Map(car.quadro.linhas.filter((l) => l.tipo === 'car').map((l) => [l.indice, l.cor]));
  const corMat = new Map(car.quadro.linhas.filter((l) => l.tipo === 'matricula').map((l) => [l.indice, l.cor]));
  const cars = car.dados.car.features.map((f, i) => ({ polys: poligonosPx(f.geometry, p), cor: corCar.get(i) ?? '#C62828' }));
  const mats = car.dados.matriculas.features.map((f, i) => ({ polys: poligonosPx(f.geometry, p), cor: corMat.get(i) ?? '#BEBADA' }));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1. tom de cada CAR (a parte do CAR fora de matrícula fica com a cor dele, bem clara)
  ctx.save();
  ctx.globalAlpha = ESTILO_CAR.car.tom;
  for (const c of cars) preencher(c.polys, c.cor);
  ctx.restore();
  // 2. cada matrícula pintada com a sua cor
  ctx.save();
  ctx.globalAlpha = ESTILO_CAR.matricula.alfa;
  for (const m of mats) preencher(m.polys, m.cor);
  ctx.restore();
  // 3. vegetação nativa em pontos verdes
  padrao(dos('vegetacao_nativa'), 'pontilhado', ESTILO_CAR.vegetacaoNativa.padrao, 0.7, 0.25);
  // 4. talhões: só o contorno; eucalipto em grade verde-escura
  const agr = geoms.filter((g) => car.usoTalhao.get(g.t.id) !== 'eucalipto').flatMap((g) => g.xy as XY[][][]);
  const euc = geoms.filter((g) => car.usoTalhao.get(g.t.id) === 'eucalipto').flatMap((g) => g.xy as XY[][][]);
  padrao(euc, 'quadriculado', ESTILO_CAR.eucalipto.padrao, 0.6, 0.2);
  contornar(agr, ESTILO_CAR.agricola.contorno, 0.15);
  contornar(euc, ESTILO_CAR.eucalipto.contorno, 0.2);
  // 3. água (polígonos do CAR e do IBGE/OSM)
  const aguaPolys = [...dos('hidrografia'), ...car.dados.hidrografia.features.flatMap((f) => poligonosPx(f.geometry, p))];
  preencher(aguaPolys, ESTILO_CAR.agua.fill);
  // 4. APP (amarelo translúcido) e reserva legal (hachura verde, uma por feição para o padrão não falhar na sobreposição)
  const app = dos('app');
  preencher(app, ESTILO_CAR.app.fill);
  contornar(app, ESTILO_CAR.app.contorno, 0.12);
  for (const rl of temas.filter((t) => t.cat === 'reserva_legal')) {
    const c = caixa(rl.polys);
    if (!c) continue;
    const x0 = Math.max(c.x, quadro.x);
    const y0 = Math.max(c.y, quadro.y);
    const x1 = Math.min(c.x + c.w, quadro.x + quadro.w);
    const y1 = Math.min(c.y + c.h, quadro.y + quadro.h);
    if (x1 <= x0 || y1 <= y0) continue;
    ctx.save();
    ctx.beginPath();
    tracarPolys(ctx, rl.polys);
    ctx.clip('evenodd');
    desenharPadrao(ctx, 'diagonal', { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, s, [v.x, v.y], { cor: ESTILO_CAR.reservaLegal.hachura, alfa: 0.75, larguraMm: 0.22 });
    ctx.restore();
    contornar(rl.polys, ESTILO_CAR.reservaLegal.contorno, 0.25);
  }
  // 5. rios e córregos (linhas)
  const rios = car.dados.hidrografia.features.flatMap((f) => linhasPx(f.geometry, p));
  if (rios.length) {
    ctx.beginPath();
    tracarLinhas(ctx, rios);
    ctx.lineWidth = 0.35 * s;
    ctx.strokeStyle = ESTILO_CAR.agua.linha;
    ctx.stroke();
  }
  // 6. estradas: de terra/carreador tracejada, rodovia cheia
  const estradas = car.dados.estradas.features;
  const terra = estradas.filter((f) => !ehRodovia(f)).flatMap((f) => linhasPx(f.geometry, p));
  const rodovias = estradas.filter(ehRodovia).flatMap((f) => linhasPx(f.geometry, p));
  if (terra.length) {
    ctx.save();
    ctx.beginPath();
    tracarLinhas(ctx, terra);
    ctx.lineWidth = 0.3 * s;
    ctx.strokeStyle = ESTILO_CAR.estrada.cor;
    ctx.setLineDash([1.2 * s, 0.7 * s]);
    ctx.stroke();
    ctx.restore();
  }
  if (rodovias.length) {
    ctx.beginPath();
    tracarLinhas(ctx, rodovias);
    ctx.lineWidth = 0.7 * s;
    ctx.strokeStyle = ESTILO_CAR.rodovia.cor;
    ctx.stroke();
  }
  // 7. por cima de tudo: o contorno de cada matrícula (tracejado, na cor dela mais escura) e de cada CAR (na cor dele)
  for (const m of mats) contornar(m.polys, escurecer(m.cor), 0.45, [1.6, 0.9]);
  for (const c of cars) contornar(c.polys, c.cor, 0.8);
  ctx.restore();
}

/** Ponto do rótulo: polylabel no maior polígono (em px). */
function pontoDoRotulo(polys: XY[][][]): XY | null {
  let melhor: XY[][] | null = null;
  let maior = 0;
  for (const poly of polys) {
    const anel = poly[0];
    if (!anel || anel.length < 4) continue;
    let a = 0;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) a += (anel[j][0] + anel[i][0]) * (anel[j][1] - anel[i][1]);
    if (Math.abs(a) > maior) {
      maior = Math.abs(a);
      melhor = poly;
    }
  }
  if (!melhor) return null;
  const r = polylabel(melhor, 2);
  return Number.isFinite(r[0]) && Number.isFinite(r[1]) ? [r[0], r[1]] : null;
}

/**
 * Rótulos "CAR 1" (vermelho) e das matrículas (roxo) no ponto interno do maior polígono de cada um, com halo branco;
 * rótulo que cairia sobre uma área reservada (rosa, escala, título) ou fora do quadro não é escrito.
 */
export function desenharRotulosCar(ctx: CanvasRenderingContext2D, v: Vista, car: EntradaCar, reservas: Rect[]): void {
  const s = v.s;
  const p = (lon: number, lat: number) => v.paraPx(...lonLatToMerc(lon, lat)) as XY;
  const ocupadas: Rect[] = [...reservas];
  const escrever = (txt: string, ponto: XY | null, cor: string, mm: number) => {
    if (!ponto) return;
    const px = mm * s;
    ctx.font = fonte(700, px);
    const w = ctx.measureText(txt).width;
    const h = px * ALTURA_MAIUSC;
    // no ponto do rótulo; se estiver ocupado (ex.: a matrícula que cobre quase o CAR inteiro), logo abaixo ou acima
    for (const dy of [0, 2.2 * h, -2.2 * h, 4.4 * h, -4.4 * h]) {
      const cy = ponto[1] + dy;
      const r: Rect = { x: ponto[0] - w / 2 - 0.6 * s, y: cy - h / 2 - 0.6 * s, w: w + 1.2 * s, h: h + 1.2 * s };
      if (r.x < v.x || r.y < v.y || r.x + r.w > v.x + v.w || r.y + r.h > v.y + v.h) continue;
      if (ocupadas.some((o) => o.x < r.x + r.w && r.x < o.x + o.w && o.y < r.y + r.h && r.y < o.y + o.h)) continue;
      ocupadas.push(r);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      textoComHalo(ctx, txt, ponto[0], cy + h / 2, cor, 'rgba(255,255,255,0.92)', 0.5 * s);
      return;
    }
  };
  ctx.save();
  for (const l of car.quadro.linhas.filter((x) => x.tipo === 'car')) {
    const f = car.dados.car.features[l.indice];
    if (f) escrever(l.rotulo, pontoDoRotulo(poligonosPx(f.geometry, p)), l.cor, 3.4);
  }
  for (const l of car.quadro.linhas.filter((x) => x.tipo === 'matricula')) {
    const f = car.dados.matriculas.features[l.indice];
    if (f) escrever(l.rotulo, pontoDoRotulo(poligonosPx(f.geometry, p)), escurecer(l.cor, 0.45), 2.6);
  }
  ctx.restore();
}
