/**
 * Legenda do painel: PICs e situação do plantio (com a amostra do padrão real) acima; depois o
 * título "Precipitação (mm)" e as classes (amostras 6×4 mm com canto arredondado).
 * Em paisagem fica numa coluna do painel lateral; em retrato, em 2–4 colunas na faixa inferior.
 */
import type { StatusPlantio } from '../lib/types';
import { ALTURA_MAIUSC, fonte, type Rect } from './labels';
import { desenharGota, desenharPadrao } from './patterns';
import { ESTILO_SITUACAO, itensLegendaSituacao } from './situacao';
import { COR_BORDA_AMOSTRA, COR_TEXTO, COR_VERDE, type RenderInput } from './types';

export type ItemLegenda =
  | { tipo: 'pic'; texto: string }
  | { tipo: 'situacao'; texto: string; status: StatusPlantio }
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'classe'; texto: string; cor: string };

// medidas em mm do A3 (k = 1)
export const AMOSTRA_W = 6;
export const AMOSTRA_H = 4;
const RAIO_AMOSTRA = 0.6;
const VAO_AMOSTRA = 2;
const LINHA = 5.4;
const LINHA_TITULO = 7.4;
const FONTE_ITEM = 3.2;
const FONTE_TITULO = 3.5;
/** espaço entre colunas da legenda */
export const VAO_COLUNAS = 5;
const K_MIN = 0.7;

export const TITULO_PRECIPITACAO = 'Precipitação (mm)';

/** Rótulo da classe sem a unidade (já está no título) e com "≤": "<= 1 mm" → "≤ 1". */
export function rotuloClasse(label: string): string {
  return label
    .replace(/\s*mm\s*$/i, '')
    .replace(/<=\s*/g, '≤ ')
    .replace(/>=\s*/g, '≥ ')
    .trim();
}

/** Itens da legenda na ordem de desenho. `presentes` = classes presentes no grid; null = sem grid. */
export function itensLegenda(inp: RenderInput, presentes: boolean[] | null): ItemLegenda[] {
  const itens: ItemLegenda[] = [];
  if (inp.pics.length) itens.push({ tipo: 'pic', texto: 'PICs' });
  for (const it of itensLegendaSituacao(inp).itens) itens.push({ tipo: 'situacao', texto: it.texto, status: it.status });
  if (!presentes) return itens; // sem interpolação não há classes a explicar
  const classes = inp.palette.classes.filter((_, i) => !inp.config.legendaCompacta || presentes[i]);
  if (classes.length) itens.push({ tipo: 'titulo', texto: TITULO_PRECIPITACAO });
  for (const c of classes) itens.push({ tipo: 'classe', texto: rotuloClasse(c.label), cor: c.color });
  return itens;
}

/** Linha da legenda para o planejamento: altura e largura em mm (k = 1); `titulo` fica com a linha seguinte. */
export interface LinhaLegenda {
  h: number;
  largura: number;
  titulo: boolean;
  /** começa uma coluna nova (ex.: "Precipitação (mm)" na faixa inferior, depois da situação do plantio) */
  quebraAntes?: boolean;
}

/**
 * Distribui as linhas em colunas (de cima para baixo, coluna a coluna), no máximo `nCols`, cada
 * coluna com altura ≤ `alturaMax`, equilibrando as alturas. Um título nunca fica sozinho no pé
 * da coluna; `quebraAntes` força uma coluna nova. null = não cabe.
 */
export function distribuirColunas(linhas: LinhaLegenda[], alturaMax: number, nCols: number): number[][] | null {
  if (!linhas.length) return [];
  if (linhas.some((l) => l.h > alturaMax + 1e-9)) return null;
  const guloso = (limite: number): number[][] => {
    const cols: number[][] = [];
    let atual: number[] = [];
    let usado = 0;
    linhas.forEach((l, i) => {
      const seguinte = l.titulo && i + 1 < linhas.length ? linhas[i + 1].h : 0;
      if (atual.length && (l.quebraAntes || usado + l.h + seguinte > limite + 1e-9)) {
        cols.push(atual);
        atual = [];
        usado = 0;
      }
      atual.push(i);
      usado += l.h;
    });
    if (atual.length) cols.push(atual);
    return cols;
  };
  if (guloso(alturaMax).length > nCols) return null;
  // menor limite que ainda usa no máximo nCols colunas (colunas equilibradas)
  let lo = Math.max(...linhas.map((l) => l.h));
  let hi = alturaMax;
  for (let it = 0; it < 40; it++) {
    const meio = (lo + hi) / 2;
    if (guloso(meio).length <= nCols) hi = meio;
    else lo = meio;
  }
  return guloso(hi);
}

export interface PlanoColunas {
  /** fator de redução do texto e das amostras (0,7..1) */
  k: number;
  colunas: number[][];
  /** largura de cada coluna (mm, já com k) */
  larguras: number[];
  /** largura e altura totais (mm, já com k) */
  w: number;
  h: number;
}

/**
 * Escolhe número de colunas e redução para caber em `area` (mm).
 * 'reduzir' (painel lateral): prefere reduzir o texto a abrir colunas; 'colunas' (faixa inferior):
 * prefere mais colunas a reduzir. Se nada couber, usa a menor redução com `maxCols` colunas.
 */
export function planejarColunas(
  linhas: LinhaLegenda[],
  area: { w: number; h: number },
  maxCols: number,
  preferencia: 'reduzir' | 'colunas',
): PlanoColunas {
  const ks: number[] = [];
  for (let k = 1; k >= K_MIN - 1e-9; k -= 0.05) ks.push(Math.round(k * 100) / 100);
  const ns = Array.from({ length: Math.max(1, maxCols) }, (_, i) => i + 1);
  const tentativas: [number, number][] =
    preferencia === 'reduzir' ? ns.flatMap((n) => ks.map((k): [number, number] => [n, k])) : ks.flatMap((k) => ns.map((n): [number, number] => [n, k]));
  const montar = (k: number, colunas: number[][]): PlanoColunas => {
    const larguras = colunas.map((c) => Math.max(0, ...c.map((i) => linhas[i].largura * k)));
    const alturas = colunas.map((c) => c.reduce((s, i) => s + linhas[i].h * k, 0));
    const w = larguras.reduce((a, b) => a + b, 0) + VAO_COLUNAS * k * Math.max(0, colunas.length - 1);
    return { k, colunas, larguras, w, h: Math.max(0, ...alturas) };
  };
  for (const [n, k] of tentativas) {
    const esc = linhas.map((l) => ({ ...l, h: l.h * k }));
    const colunas = distribuirColunas(esc, area.h, n);
    if (!colunas) continue;
    const p = montar(k, colunas);
    if (p.w <= area.w + 1e-9) return p;
  }
  // não coube: redução máxima, colunas por quantidade (o que sobrar é cortado pelo clip)
  const n = Math.max(1, maxCols);
  const porCol = Math.ceil(linhas.length / n);
  const colunas: number[][] = [];
  for (let i = 0; i < linhas.length; i += porCol) colunas.push(linhas.slice(i, i + porCol).map((_, j) => i + j));
  return montar(K_MIN, colunas);
}

/** Amostra arredondada (caminho). */
function caminhoAmostra(ctx: CanvasRenderingContext2D, r: Rect, raio: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, raio);
}

/** Amostra da situação: o mesmo padrão e contorno do mapa, recortados na amostra arredondada. */
function amostraSituacao(ctx: CanvasRenderingContext2D, status: StatusPlantio, inp: RenderInput, r: Rect, s: number, u: number): void {
  const e = ESTILO_SITUACAO[status];
  ctx.save();
  caminhoAmostra(ctx, r, RAIO_AMOSTRA * u);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  const estilo = e.preenchimento === 'padrao' ? inp.config.estiloPlantado : e.preenchimento === 'hachura' ? 'diagonal' : null;
  if (estilo) {
    ctx.save();
    ctx.clip();
    const opcoes = e.preenchimento === 'hachura' ? { cor: e.cor, alfa: 0.9, larguraMm: 0.35 } : undefined;
    // o padrão usa o espaçamento do mapa (s), como aparece nos talhões
    desenharPadrao(ctx, estilo, r, s, [r.x, r.y], opcoes);
    ctx.restore();
  }
  caminhoAmostra(ctx, r, RAIO_AMOSTRA * u);
  ctx.lineWidth = (status === 'a_plantar' ? 0.35 : 0.5) * u;
  ctx.strokeStyle = e.contorno;
  if (e.tracejadoMm) ctx.setLineDash(e.tracejadoMm.map((d) => d * 0.6 * u));
  ctx.stroke();
  ctx.restore();
}

export interface PlanoLegenda {
  /** tamanho ocupado (mm) */
  w: number;
  h: number;
  /** desenha com o canto superior esquerdo em (x, y) px, recortado na área recebida */
  desenhar(x: number, y: number): void;
}

/**
 * Planeja a legenda para caber em `area` (mm). `s` = px por mm do A3. null = nada a mostrar.
 */
export function planejarLegenda(
  ctx: CanvasRenderingContext2D,
  inp: RenderInput,
  presentes: boolean[] | null,
  area: { w: number; h: number },
  s: number,
  modo: 'lateral' | 'inferior',
): PlanoLegenda | null {
  const itens = itensLegenda(inp, presentes);
  if (!itens.length) return null;
  ctx.save();
  const linhas: LinhaLegenda[] = itens.map((it) => {
    if (it.tipo === 'titulo') {
      ctx.font = fonte(700, FONTE_TITULO * s);
      return { h: LINHA_TITULO, largura: ctx.measureText(it.texto).width / s, titulo: true };
    }
    ctx.font = fonte(400, FONTE_ITEM * s);
    return { h: LINHA, largura: AMOSTRA_W + VAO_AMOSTRA + ctx.measureText(it.texto).width / s, titulo: false };
  });
  ctx.restore();
  // título no topo de uma coluna não precisa do respiro de cima; na faixa inferior as classes
  // começam numa coluna própria, à direita da situação do plantio
  const iTitulo = itens.findIndex((it) => it.tipo === 'titulo');
  if (iTitulo === 0) linhas[0] = { ...linhas[0], h: LINHA_TITULO - 2 };
  else if (iTitulo > 0 && modo === 'inferior') linhas[iTitulo] = { ...linhas[iTitulo], h: LINHA_TITULO - 2, quebraAntes: true };
  const plano = planejarColunas(linhas, area, modo === 'lateral' ? 2 : 4, modo === 'lateral' ? 'reduzir' : 'colunas');
  const { k } = plano;
  const u = k * s;

  const desenhar = (x0: number, y0: number) => {
    ctx.save();
    // nada passa da área reservada (ex.: para o rodapé), mesmo no pior caso de `planejarColunas`
    ctx.beginPath();
    ctx.rect(x0, y0, area.w * s, area.h * s);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let xCol = x0;
    plano.colunas.forEach((col, c) => {
      let y = y0;
      for (const i of col) {
        const it = itens[i];
        const h = linhas[i].h * u;
        if (it.tipo === 'titulo') {
          const px = FONTE_TITULO * u;
          ctx.font = fonte(700, px);
          ctx.fillStyle = COR_VERDE;
          ctx.fillText(it.texto, xCol, y + h - 2.2 * u);
          y += h;
          continue;
        }
        const cy = y + h / 2;
        const r: Rect = { x: xCol, y: cy - (AMOSTRA_H * u) / 2, w: AMOSTRA_W * u, h: AMOSTRA_H * u };
        if (it.tipo === 'pic') {
          const alt = 4.8 * u;
          desenharGota(ctx, r.x + r.w / 2, cy - alt / 2, alt, s);
        } else if (it.tipo === 'situacao') {
          amostraSituacao(ctx, it.status, inp, r, s, u);
        } else {
          caminhoAmostra(ctx, r, RAIO_AMOSTRA * u);
          ctx.fillStyle = it.cor;
          ctx.fill();
          ctx.lineWidth = 0.15 * u;
          ctx.strokeStyle = COR_BORDA_AMOSTRA;
          ctx.stroke();
        }
        const px = FONTE_ITEM * u;
        ctx.font = fonte(400, px);
        ctx.fillStyle = COR_TEXTO;
        ctx.fillText(it.texto, xCol + (AMOSTRA_W + VAO_AMOSTRA) * u, cy + (px * ALTURA_MAIUSC) / 2);
        y += h;
      }
      xCol += plano.larguras[c] * s + VAO_COLUNAS * u;
    });
    ctx.restore();
  };

  return { w: plano.w, h: plano.h, desenhar };
}
