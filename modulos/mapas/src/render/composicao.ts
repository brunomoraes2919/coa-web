/**
 * Composição do layout (puro, sem canvas): decide a orientação da folha, quantos quadros de mapa
 * usar e onde fica cada retângulo, a partir da forma dos talhões.
 *
 * Regras (spec 2026-09-28-layout-adaptativo):
 * - Orientação 'auto': bbox dos talhões em Web Mercator; altura/largura > 1,25 → retrato, senão
 *   paisagem. Paisagem = A3 420×297 com painel lateral de 71,4 mm (geometria de sempre); retrato =
 *   A3 297×420 com faixa inferior de 68 mm e mapa de 287×338 mm.
 * - Quadros 'auto': talhões agrupados por proximidade; com 2 ou 3 grupos, usa quadros separados
 *   (empilhados) se o aproveitamento da folha for ≥ 1,5× o do quadro único. `1` força um quadro,
 *   `'setor'` força um quadro por setor. Nunca mais de 3 quadros: no modo
 *   'setor', ficam os 3 setores de maior bbox e os demais são fundidos no quadro mais próximo.
 *
 * Unidades: `quadros[].rect` e `painel` são mm do desenho A3 (no A4 o desenho é o mesmo × 297/420,
 * como em `layout.ts`); `pagina` é o tamanho real da folha em mm (A3 ou A4, já na orientação).
 */
import { geomToXY, lonLatToMerc } from '../lib/projection';
import type { LayoutConfig, Talhao } from '../lib/types';
import type { Rect } from './labels';
import { PAGINA_MM } from './types';

/** [x0, y0, x1, y1] em Web Mercator (m); y cresce para o norte. */
type BBox = [number, number, number, number];

/** Conjunto de talhões desenhado num mesmo quadro. */
export interface Grupo {
  ids: string[];
  /** bbox Web Mercator [x0, y0, x1, y1] em metros */
  bbox: [number, number, number, number];
  /** setor comum a todos os talhões do grupo; null se misto ou sem setor */
  setor: string | null;
}

export interface Composicao {
  orientacao: 'paisagem' | 'retrato';
  /** tamanho real da folha em mm (A3 ou A4), já na orientação */
  pagina: { w: number; h: number };
  /** quadros de norte para sul; `titulo` null quando há um quadro só */
  quadros: { rect: Rect; grupo: Grupo; titulo: string | null }[];
  painel: Rect;
  painelPosicao: 'lateral' | 'inferior';
}

/** altura/largura acima disto → retrato */
const LIMIAR_RETRATO = 1.25;
/** margem do enquadramento automático, por lado (igual a `autoExtent` em layout.ts) */
const MARGEM = 0.06;
/** ganho mínimo de aproveitamento para separar em quadros */
const GANHO_MINIMO = 1.5;
/** espaço entre quadros empilhados (mm) */
const VAO_QUADROS = 4;
/** fração mínima da altura útil de cada quadro empilhado (com mais de 3 quadros vira 1/n) */
const ALTURA_MINIMA = 0.3;
/** limite de quadros em qualquer modo */
const MAX_QUADROS = 3;

/** Folhas A3 (mm) e retângulos do desenho em cada orientação. */
const FOLHA = {
  paisagem: {
    pagina: { w: 420, h: 297 },
    areaMapa: { x: 5, y: 4.4, w: 333, h: 288 },
    painel: { x: 343.5, y: 4.4, w: 71.4, h: 288 },
    painelPosicao: 'lateral',
  },
  retrato: {
    pagina: { w: 297, h: 420 },
    areaMapa: { x: 5, y: 4.4, w: 287, h: 338 },
    painel: { x: 5, y: 420 - 4.4 - 68, w: 287, h: 68 },
    painelPosicao: 'inferior',
  },
} as const;

/**
 * Tamanho do rótulo do talhão (mm): clamp(2,1 × √(área média em mm² / 40), 1,6, 3,2).
 * `areaMediaMm2` é a área média dos talhões no papel (mm² do desenho).
 */
export function tamanhoRotuloMm(areaMediaMm2: number): number {
  const k = areaMediaMm2 > 0 ? Math.sqrt(areaMediaMm2 / 40) : 0;
  const v = 2.1 * k;
  return Number.isFinite(v) ? Math.min(3.2, Math.max(1.6, v)) : 1.6;
}

/**
 * Tamanho do número do talhão no mapa (mm): 0,75 × `tamanhoRotuloMm`, com piso de 1,3 mm (no máximo
 * 2,4 mm), menor e mais discreto que os valores dos PICs (3,5 mm) para não se confundir com eles.
 */
export function tamanhoRotuloTalhaoMm(areaMediaMm2: number): number {
  return Math.max(1.3, 0.75 * tamanhoRotuloMm(areaMediaMm2));
}

/** bbox Mercator do talhão; null se a geometria não tiver coordenadas válidas. */
function bboxTalhao(t: Talhao): BBox | null {
  if (!t.geom || !Array.isArray(t.geom.coordinates)) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of geomToXY(t.geom, lonLatToMerc))
    for (const anel of poly)
      for (const [x, y] of anel) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 >= x0 && y1 >= y0 ? [x0, y0, x1, y1] : null;
}

function uniao(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Os bboxes se tocam quando o vão entre eles (em x e em y) é ≤ tol. */
function tocam(a: BBox, b: BBox, tol: number): boolean {
  return a[0] <= b[2] + tol && b[0] <= a[2] + tol && a[1] <= b[3] + tol && b[1] <= a[3] + tol;
}

interface GrupoInterno {
  ids: string[];
  setores: (string | null)[];
  bbox: BBox;
}

function setorComum(setores: (string | null)[]): string | null {
  const s = setores[0];
  return s != null && setores.every((x) => x === s) ? s : null;
}

/**
 * Ordena norte→sul; grupos na mesma faixa de latitude (centros a menos de meia altura do menor
 * deles) ficam oeste→leste.
 */
function ordenar<T extends { bbox: BBox }>(gs: T[]): T[] {
  const cy = (b: BBox) => (b[1] + b[3]) / 2;
  return [...gs].sort((a, b) => {
    const tol = 0.5 * Math.min(a.bbox[3] - a.bbox[1], b.bbox[3] - b.bbox[1]);
    const d = cy(b.bbox) - cy(a.bbox);
    if (Math.abs(d) > tol) return d;
    return a.bbox[0] - b.bbox[0];
  });
}

function paraGrupo(g: GrupoInterno): Grupo {
  return { ids: g.ids, bbox: g.bbox, setor: setorComum(g.setores) };
}

/**
 * Agrupa talhões por proximidade: começa com o bbox de cada talhão e une repetidamente os bboxes
 * que se tocam com folga de `folga` × maior lado do bbox do conjunto, até nada mais se unir (os
 * bboxes finais não se sobrepõem). Talhões sem geometria válida são ignorados.
 * Ordem: norte→sul, depois oeste→leste.
 */
export function agruparTalhoes(talhoes: Talhao[], folga = 0.08): Grupo[] {
  let gs: GrupoInterno[] = [];
  for (const t of talhoes) {
    const b = bboxTalhao(t);
    if (b) gs.push({ ids: [t.id], setores: [t.setor], bbox: b });
  }
  if (gs.length === 0) return [];
  const total = gs.reduce((acc, g) => uniao(acc, g.bbox), gs[0].bbox);
  const tol = folga * Math.max(total[2] - total[0], total[3] - total[1]);

  let mudou = true;
  while (mudou) {
    mudou = false;
    const prox: GrupoInterno[] = [];
    for (const g of gs) {
      let atual = g;
      // absorve todos os grupos já acumulados que tocam o atual (o bbox cresce a cada união)
      for (let i = prox.length - 1; i >= 0; i--) {
        if (!tocam(prox[i].bbox, atual.bbox, tol)) continue;
        const o = prox.splice(i, 1)[0];
        atual = { ids: [...o.ids, ...atual.ids], setores: [...o.setores, ...atual.setores], bbox: uniao(o.bbox, atual.bbox) };
        mudou = true;
        i = prox.length; // recomeça: o bbox maior pode tocar grupos já testados
      }
      prox.push(atual);
    }
    gs = prox;
  }
  return ordenar(gs).map(paraGrupo);
}

/** Área (mm²) de uma coleção de bboxes enquadrada no retângulo pela união, com a margem de 6%. */
function areaEnquadrada(bboxes: BBox[], q: Rect): number {
  if (bboxes.length === 0) return 0;
  const u = bboxes.reduce(uniao);
  const w = u[2] - u[0];
  const h = u[3] - u[1];
  if (!(w > 0 || h > 0)) return 0;
  const util = 1 - 2 * MARGEM;
  // mm de papel por metro Mercator: o lado mais justo limita
  const k = Math.min(w > 0 ? (q.w * util) / w : Infinity, h > 0 ? (q.h * util) / h : Infinity);
  let soma = 0;
  for (const b of bboxes) soma += (b[2] - b[0]) * (b[3] - b[1]) * k * k;
  return soma;
}

/**
 * Fator de aproveitamento da folha: soma das áreas dos bboxes no papel (mm²) / soma das áreas dos
 * quadros, com cada bbox enquadrado no seu quadro (margem de 6% por lado, como no enquadramento
 * automático).
 * - `bboxes.length === quadros.length`: o bbox i vai no quadro i.
 * - um quadro só e vários bboxes: a escala é a da união dos bboxes, mas só as áreas dos bboxes
 *   contam (o vazio entre os grupos não é aproveitamento).
 * Retorna 0 quando não há o que enquadrar.
 */
export function aproveitamento(bboxes: [number, number, number, number][], quadros: Rect[]): number {
  const areaQuadros = quadros.reduce((s, q) => s + q.w * q.h, 0);
  if (bboxes.length === 0 || areaQuadros <= 0) return 0;
  let ocupada = 0;
  if (quadros.length === 1) ocupada = areaEnquadrada(bboxes, quadros[0]);
  else if (quadros.length === bboxes.length) bboxes.forEach((b, i) => (ocupada += areaEnquadrada([b], quadros[i])));
  else throw new Error('aproveitamento: informe um quadro por bbox ou um quadro só');
  return ocupada / areaQuadros;
}

type Orientacao = 'paisagem' | 'retrato';

function orientacaoPorForma(largura: number, altura: number): Orientacao {
  return largura > 0 && altura / largura > LIMIAR_RETRATO ? 'retrato' : 'paisagem';
}

/**
 * Frações da altura útil proporcionais a `alturas`, com mínimo de min(30%, 1/n) cada (quem fica
 * abaixo do mínimo recebe o mínimo e o resto é redividido entre os demais na mesma proporção).
 * O resultado nunca é negativo e soma exatamente 1 (renormalizado). Exportada para testes.
 */
export function fracoesAltura(alturas: number[]): number[] {
  const n = alturas.length;
  if (n === 0) return [];
  const minimo = Math.min(ALTURA_MINIMA, 1 / n);
  const fixos = new Set<number>();
  let f = alturas.map(() => 1 / n);
  for (let it = 0; it <= n; it++) {
    const livres = alturas.map((_, i) => i).filter((i) => !fixos.has(i));
    if (livres.length === 0) break;
    const positiva = (h: number) => (Number.isFinite(h) && h > 0 ? h : 0);
    const somaLivres = livres.reduce((s, i) => s + positiva(alturas[i]), 0);
    const resto = Math.max(0, 1 - fixos.size * minimo);
    f = alturas.map((h, i) =>
      fixos.has(i) ? minimo : somaLivres > 0 ? (resto * positiva(h)) / somaLivres : resto / livres.length,
    );
    const abaixo = livres.filter((i) => f[i] < minimo - 1e-12);
    if (abaixo.length === 0) break;
    abaixo.forEach((i) => fixos.add(i));
  }
  f = f.map((x) => Math.max(0, x));
  const soma = f.reduce((a, b) => a + b, 0);
  return soma > 0 ? f.map((x) => x / soma) : alturas.map(() => 1 / n);
}

/** Retângulos empilhados na área do mapa, alturas proporcionais às alturas dos bboxes, vão de 4 mm. */
function empilhar(area: Rect, grupos: Grupo[]): Rect[] {
  if (grupos.length === 1) return [{ ...area }];
  const util = area.h - VAO_QUADROS * (grupos.length - 1);
  const fs = fracoesAltura(grupos.map((g) => g.bbox[3] - g.bbox[1]));
  const rects: Rect[] = [];
  let y = area.y;
  fs.forEach((f, i) => {
    const h = i === fs.length - 1 ? area.y + area.h - y : util * f;
    rects.push({ x: area.x, y, w: area.w, h });
    y += h + VAO_QUADROS;
  });
  return rects;
}

/** Um grupo por setor (talhões sem setor formam um grupo à parte), ordem norte→sul. */
function gruposPorSetor(talhoes: Talhao[]): Grupo[] {
  const por = new Map<string | null, GrupoInterno>();
  for (const t of talhoes) {
    const b = bboxTalhao(t);
    if (!b) continue;
    const g = por.get(t.setor);
    if (g) {
      g.ids.push(t.id);
      g.setores.push(t.setor);
      g.bbox = uniao(g.bbox, b);
    } else por.set(t.setor, { ids: [t.id], setores: [t.setor], bbox: b });
  }
  return ordenar([...por.values()]).map(paraGrupo);
}

/** Distância entre bboxes (0 se se tocam ou sobrepõem); empate desfeito pela distância dos centros. */
function distancia(a: BBox, b: BBox): [number, number] {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  const cx = (a[0] + a[2] - b[0] - b[2]) / 2;
  const cy = (a[1] + a[3] - b[1] - b[3]) / 2;
  return [Math.hypot(dx, dy), Math.hypot(cx, cy)];
}

function fundir(a: Grupo, b: Grupo): Grupo {
  return {
    ids: [...a.ids, ...b.ids],
    bbox: uniao(a.bbox, b.bbox),
    setor: a.setor !== null && a.setor === b.setor ? a.setor : null,
  };
}

/**
 * Limita a MAX_QUADROS grupos: ficam os de maior área de bbox e cada um dos demais (do maior para o
 * menor) é fundido no grupo mantido de bbox mais próximo. O grupo fundido só mantém o setor se todos
 * os talhões ainda forem do mesmo setor (senão o título vira "Bloco N"). Ordem final norte→sul.
 */
function limitarQuadros(grupos: Grupo[]): Grupo[] {
  if (grupos.length <= MAX_QUADROS) return grupos;
  const area = (g: Grupo) => (g.bbox[2] - g.bbox[0]) * (g.bbox[3] - g.bbox[1]);
  const porArea = grupos.map((g, i) => ({ g, i })).sort((a, b) => area(b.g) - area(a.g) || a.i - b.i);
  const mantidos = porArea.slice(0, MAX_QUADROS).map((x) => x.g);
  for (const { g } of porArea.slice(MAX_QUADROS)) {
    let melhor = 0;
    let dMelhor = distancia(mantidos[0].bbox, g.bbox);
    for (let k = 1; k < mantidos.length; k++) {
      const d = distancia(mantidos[k].bbox, g.bbox);
      if (d[0] < dMelhor[0] || (d[0] === dMelhor[0] && d[1] < dMelhor[1])) [melhor, dMelhor] = [k, d];
    }
    mantidos[melhor] = fundir(mantidos[melhor], g);
  }
  return ordenar(mantidos);
}

function grupoUnico(grupos: Grupo[]): Grupo {
  if (grupos.length === 0) return { ids: [], bbox: [0, 0, 0, 0], setor: null };
  const ids = grupos.flatMap((g) => g.ids);
  const bbox = grupos.map((g) => g.bbox as BBox).reduce(uniao);
  const setores = grupos.map((g) => g.setor);
  return { ids, bbox, setor: grupos.every((g) => g.setor !== null) ? setorComum(setores) : null };
}

interface Candidata {
  orientacao: Orientacao;
  quadros: { rect: Rect; grupo: Grupo; titulo: string | null }[];
}

function candidataUnica(grupos: Grupo[], forcada: Orientacao | null): Candidata {
  const g = grupoUnico(grupos);
  const orientacao = forcada ?? orientacaoPorForma(g.bbox[2] - g.bbox[0], g.bbox[3] - g.bbox[1]);
  return { orientacao, quadros: [{ rect: { ...FOLHA[orientacao].areaMapa }, grupo: g, titulo: null }] };
}

/**
 * Quadros empilhados (no máximo MAX_QUADROS; o excedente é fundido por `limitarQuadros`); a
 * orientação vem do conjunto empilhado (Σ alturas × maior largura).
 */
function candidataMultipla(todos: Grupo[], forcada: Orientacao | null): Candidata {
  const grupos = limitarQuadros(todos);
  const largura = Math.max(...grupos.map((g) => g.bbox[2] - g.bbox[0]));
  const altura = grupos.reduce((s, g) => s + (g.bbox[3] - g.bbox[1]), 0);
  const orientacao = forcada ?? orientacaoPorForma(largura, altura);
  const rects = empilhar(FOLHA[orientacao].areaMapa, grupos);
  return {
    orientacao,
    quadros: grupos.map((grupo, i) => ({ rect: rects[i], grupo, titulo: grupo.setor ?? `Bloco ${i + 1}` })),
  };
}

function aproveitamentoDe(c: Candidata, grupos: Grupo[]): number {
  const bboxes = grupos.map((g) => g.bbox);
  if (c.quadros.length === 1) return aproveitamento(bboxes, [c.quadros[0].rect]);
  return aproveitamento(
    c.quadros.map((q) => q.grupo.bbox),
    c.quadros.map((q) => q.rect),
  );
}

/**
 * Decide a composição da folha para os talhões (já filtrados pelos setores do mapa).
 * `orientacao` e `quadros` ausentes (mapas antigos) valem 'auto'.
 */
export function compor(
  talhoes: Talhao[],
  config: Pick<LayoutConfig, 'orientacao' | 'quadros' | 'pagina'>,
): Composicao {
  const forcada = config.orientacao === 'paisagem' || config.orientacao === 'retrato' ? config.orientacao : null;
  const modo = config.quadros ?? 'auto';

  let escolha: Candidata;
  if (modo === 'setor') {
    const porSetor = gruposPorSetor(talhoes);
    escolha = porSetor.length >= 2 ? candidataMultipla(porSetor, forcada) : candidataUnica(porSetor, forcada);
  } else {
    const grupos = agruparTalhoes(talhoes);
    escolha = candidataUnica(grupos, forcada);
    if (modo === 'auto' && grupos.length >= 2 && grupos.length <= 3) {
      const multipla = candidataMultipla(grupos, forcada);
      if (aproveitamentoDe(multipla, grupos) >= GANHO_MINIMO * aproveitamentoDe(escolha, grupos)) escolha = multipla;
    }
  }

  const folha = FOLHA[escolha.orientacao];
  const real = PAGINA_MM[config.pagina === 'A4' ? 'A4' : 'A3'];
  return {
    orientacao: escolha.orientacao,
    pagina: escolha.orientacao === 'paisagem' ? { w: real.w, h: real.h } : { w: real.h, h: real.w },
    quadros: escolha.quadros,
    painel: { ...folha.painel },
    painelPosicao: folha.painelPosicao,
  };
}
