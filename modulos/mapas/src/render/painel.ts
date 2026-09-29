/**
 * Painel do layout: lateral (paisagem, uma coluna) ou faixa inferior (retrato, 3 colunas:
 * logo+título | informações | legenda). Cabeçalho com a logo colorida, título em caixa alta com
 * filete laranja e a fazenda; pares rótulo/valor (rótulo 400 cinza 3,2 mm, valor 700 preto 3,8 mm)
 * separados por filetes finos; legenda; rodapé com a assinatura, a data de geração e a atribuição
 * do mapa base. Medidas em mm do A3; `s` = px por mm do A3.
 */
import { fmtChuva, fmtData } from '../lib/format';
import { fmtDataHora } from '../lib/situacaoPlantio';
import type { Composicao } from './composicao';
import { ALTURA_MAIUSC, comReticencias, fonte, limitarLinhas, quebrarTexto, type Rect } from './labels';
import { planejarLegenda } from './legend';
import { COR_CINZA, COR_LARANJA, COR_SEPARADOR, COR_TEXTO, COR_VERDE, type RenderInput } from './types';

export interface ParInfo {
  rotulo: string;
  valor: string;
}

/** "3,6 mm" (uma casa, vírgula). */
export function fmtMm(v: number): string {
  return `${fmtChuva(v).replace('.', ',')} mm`;
}

/**
 * Pares do bloco de informações, na ordem do spec; valores vazios ficam de fora (média dos PICs com chuva:
 * null = "sem chuva"; ausente em mapa salvo antes do campo = fora). A fazenda vai no cabeçalho, não aqui.
 */
export function itensInformacao(inp: RenderInput): ParInfo[] {
  const t = inp.config.textos;
  const media = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? fmtMm(v) : '');
  const pims = fmtDataHora(inp.plantioGeradoEm, true); // dd/MM HH:mm
  const pares: ParInfo[] = [
    { rotulo: 'Safra', valor: t.safra },
    { rotulo: 'Período', valor: t.periodo },
    { rotulo: 'Fonte', valor: t.fonte },
    { rotulo: 'Talhões', valor: t.talhoes },
    { rotulo: 'Setor', valor: t.setor },
    { rotulo: 'Média da fazenda', valor: media(inp.resumo?.geral.media) },
    { rotulo: 'Média dos PICs com chuva', valor: inp.resumo?.mediaPicsComChuva === null ? 'sem chuva' : media(inp.resumo?.mediaPicsComChuva) },
    { rotulo: 'Plantio', valor: pims ? `PIMS ${pims}` : '' },
    { rotulo: 'Data', valor: t.data },
    { rotulo: 'Observação', valor: t.observacao },
  ];
  return pares.map((p) => ({ ...p, valor: (p.valor ?? '').trim() })).filter((p) => p.valor);
}

export interface CelulaInfo {
  coluna: number;
  linha: number;
  /** quantas colunas ocupa (1..nCols) */
  span: number;
}

/**
 * Grade dos pares: colunas de largura (L − vão·(n−1))/n; cada par ocupa as colunas de que precisa
 * (`larguras[i]` = maior entre rótulo e valor, em mm; no máximo a linha inteira). Encaixe "first
 * fit": o par vai na primeira linha que ainda tem colunas livres suficientes à direita, então um
 * par curto pode completar uma linha anterior (a grade fica compacta, quase na ordem dos itens).
 */
export function gradeInfo(larguras: number[], largura: number, nCols: number, vao: number): CelulaInfo[] {
  const n = Math.max(1, Math.floor(nCols));
  const celula = (largura - vao * (n - 1)) / n;
  const ocupadas: number[] = []; // colunas ocupadas em cada linha
  return larguras.map((w) => {
    const span = Math.min(n, Math.max(1, Math.ceil((w + vao) / (celula + vao) - 1e-9)));
    let linha = ocupadas.findIndex((o) => o + span <= n);
    if (linha < 0) {
      linha = ocupadas.length;
      ocupadas.push(0);
    }
    const coluna = ocupadas[linha];
    ocupadas[linha] += span;
    return { coluna, linha, span };
  });
}

export interface SecoesPainel {
  cabecalho: Rect;
  info: Rect;
  legenda: Rect;
  rodape: Rect;
}

/** margem interna do painel lateral / da faixa inferior */
export const PAD_LATERAL = 5;
export const PAD_FAIXA = 4.5;
/** vão entre as seções do painel lateral (o filete fica no meio) */
export const VAO_SECAO = 7;
/** largura da coluna logo+título na faixa inferior */
export const LARGURA_CABECALHO_FAIXA = 62;
/** vão entre as colunas da faixa inferior (o filete vertical fica no meio) */
export const VAO_COLUNA_FAIXA = 8;

/** Seções do painel lateral (mm), de cima para baixo; a legenda fica com o que sobra. */
export function planoLateral(p: Rect, alt: { cabecalho: number; info: number; rodape: number }): SecoesPainel {
  const x = p.x + PAD_LATERAL;
  const w = p.w - 2 * PAD_LATERAL;
  const cabecalho = { x, y: p.y + PAD_LATERAL, w, h: alt.cabecalho };
  const info = { x, y: cabecalho.y + cabecalho.h + VAO_SECAO, w, h: alt.info };
  const rodape = { x, y: p.y + p.h - 4 - alt.rodape, w, h: alt.rodape };
  const yLeg = info.y + info.h + VAO_SECAO;
  const legenda = { x, y: yLeg, w, h: Math.max(0, rodape.y - 4 - yLeg) };
  return { cabecalho, info, legenda, rodape };
}

/**
 * Colunas da faixa inferior (mm): logo+título à esquerda (62 mm), legenda à direita (a largura
 * dela, até 45% da faixa), informações no meio; rodapé em toda a largura embaixo.
 */
export function planoFaixa(p: Rect, larguraLegenda: number, alturaRodape: number): SecoesPainel {
  const x = p.x + PAD_FAIXA;
  const y = p.y + PAD_FAIXA;
  const w = p.w - 2 * PAD_FAIXA;
  const rodape = { x, y: p.y + p.h - 3.5 - alturaRodape, w, h: alturaRodape };
  const h = Math.max(0, rodape.y - 3 - y);
  const cabecalho = { x, y, w: Math.min(LARGURA_CABECALHO_FAIXA, w), h };
  const legW = Math.max(0, Math.min(larguraLegenda, 0.45 * w));
  const legenda = { x: x + w - legW, y, w: legW, h };
  const xInfo = cabecalho.x + cabecalho.w + VAO_COLUNA_FAIXA;
  const info = { x: xInfo, y, w: Math.max(0, legenda.x - VAO_COLUNA_FAIXA - xInfo), h };
  return { cabecalho, info, legenda, rodape };
}

function dimensoes(img: CanvasImageSource): [number, number] {
  const o = img as unknown as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  if (num('naturalWidth') > 0) return [num('naturalWidth'), num('naturalHeight')];
  if (num('videoWidth') > 0) return [num('videoWidth'), num('videoHeight')];
  if (num('displayWidth') > 0) return [num('displayWidth'), num('displayHeight')];
  return [num('width'), num('height')];
}

/** Linhas do texto em até `max` linhas, reduzindo a fonte (até 70%) se precisar; o que sobrar vira "…". */
function ajustar(ctx: CanvasRenderingContext2D, txt: string, peso: 400 | 700, mm: number, largura: number, max: number, s: number) {
  let k = 1;
  let linhas: string[] = [];
  const medir = (t: string) => ctx.measureText(t).width;
  for (let i = 0; i <= 6; i++) {
    k = 1 - i * 0.05;
    ctx.font = fonte(peso, mm * k * s);
    linhas = quebrarTexto(txt, largura * s, medir);
    if (linhas.length <= max) break;
  }
  // a fonte ainda é a da última tentativa (k): mede as reticências com ela
  return { linhas: limitarLinhas(linhas, max, largura * s, medir), mm: mm * k };
}

/** Cabeçalho (logo, título, filete, fazenda). Devolve a altura (mm); só desenha se `desenhar`. */
function cabecalho(ctx: CanvasRenderingContext2D, inp: RenderInput, r: Rect, s: number, lateral: boolean, desenhar: boolean): number {
  let y = r.y;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (inp.logo) {
    const [lw, lh] = dimensoes(inp.logo);
    if (lw > 0 && lh > 0) {
      const w = Math.min(r.w, lateral ? 52 : 50);
      const h = (w * lh) / lw;
      if (desenhar) {
        try {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(inp.logo, r.x * s, y * s, w * s, h * s);
        } catch {
          // logo inválido: segue sem ele
        }
      }
      y += h + (lateral ? 6 : 4.5);
    }
  }
  const titulo = (inp.config.textos.titulo ?? '').trim().toLocaleUpperCase('pt-BR');
  if (titulo) {
    const t = ajustar(ctx, titulo, 700, lateral ? 5.4 : 5, r.w, 2, s);
    const passo = t.mm * 1.2;
    t.linhas.forEach((l, i) => {
      const base = y + t.mm * ALTURA_MAIUSC + i * passo;
      if (desenhar) {
        ctx.font = fonte(700, t.mm * s);
        ctx.fillStyle = COR_TEXTO;
        ctx.fillText(l, r.x * s, base * s);
      }
    });
    y += t.mm * ALTURA_MAIUSC + (t.linhas.length - 1) * passo + 2.6;
    if (desenhar) {
      ctx.fillStyle = COR_LARANJA;
      ctx.fillRect(r.x * s, y * s, 16 * s, 1 * s);
    }
    y += 1 + 3.4;
  }
  const fazenda = (inp.config.textos.fazenda ?? '').trim();
  if (fazenda) {
    const f = ajustar(ctx, fazenda, 700, 4.2, r.w, 2, s);
    f.linhas.forEach((l, i) => {
      if (!desenhar) return;
      ctx.font = fonte(700, f.mm * s);
      ctx.fillStyle = COR_VERDE;
      ctx.fillText(l, r.x * s, (y + f.mm * ALTURA_MAIUSC + i * f.mm * 1.2) * s);
    });
    y += f.mm * ALTURA_MAIUSC + (f.linhas.length - 1) * f.mm * 1.2 + 1;
  } else if (titulo) y -= 3.4;
  ctx.restore();
  return y - r.y;
}

const FONTE_ROTULO = 3.2;
const FONTE_VALOR = 3.8;
const VAO_INFO = 5;
const VAO_LINHA_INFO = 3.4;

/**
 * Bloco de informações em `nCols` colunas, reduzido (até 75%) para caber em `r.h` quando
 * `limitar`. Devolve a altura (mm); só desenha se `desenhar`.
 */
function blocoInfo(ctx: CanvasRenderingContext2D, itens: ParInfo[], r: Rect, s: number, nCols: number, limitar: boolean, desenhar: boolean): number {
  if (!itens.length) return 0;
  ctx.save();
  let plano: { k: number; celulas: CelulaInfo[]; linhas: string[][]; alturas: number[]; total: number } | null = null;
  for (let k = 1; k >= 0.75 - 1e-9; k -= 0.05) {
    const larguras = itens.map((it) => {
      ctx.font = fonte(400, FONTE_ROTULO * k * s);
      const a = ctx.measureText(it.rotulo).width;
      ctx.font = fonte(700, FONTE_VALOR * k * s);
      return Math.max(a, ctx.measureText(it.valor).width) / s;
    });
    const celulas = gradeInfo(larguras, r.w, nCols, VAO_INFO);
    const celulaW = (r.w - VAO_INFO * (nCols - 1)) / nCols;
    ctx.font = fonte(700, FONTE_VALOR * k * s);
    const linhas = itens.map((it, i) => {
      const w = celulas[i].span * celulaW + (celulas[i].span - 1) * VAO_INFO;
      const medir = (t: string) => ctx.measureText(t).width;
      return limitarLinhas(quebrarTexto(it.valor, w * s, medir), 3, w * s, medir);
    });
    const nLinhas = Math.max(0, ...celulas.map((c) => c.linha)) + 1;
    const alturas = Array.from({ length: nLinhas }, (_, l) => {
      const n = Math.max(1, ...celulas.map((c, i) => (c.linha === l ? linhas[i].length : 0)));
      return (FONTE_ROTULO * ALTURA_MAIUSC + 5 + (n - 1) * 4.7 + 1) * k;
    });
    const total = alturas.reduce((a, b) => a + b, 0) + VAO_LINHA_INFO * k * (nLinhas - 1);
    plano = { k, celulas, linhas, alturas, total };
    if (!limitar || total <= r.h) break;
  }
  if (!plano) {
    ctx.restore();
    return 0;
  }
  if (desenhar) {
    const { k, celulas, linhas, alturas } = plano;
    const celulaW = (r.w - VAO_INFO * (nCols - 1)) / nCols;
    const larguraCelula = (c: CelulaInfo) => c.span * celulaW + (c.span - 1) * VAO_INFO;
    // linhas da grade que cabem na altura (sem limite: todas)
    let visiveis = alturas.length;
    if (limitar) {
      let fim = r.y;
      visiveis = 0;
      for (const h of alturas) {
        fim += (visiveis ? VAO_LINHA_INFO * k : 0) + h;
        if (fim > r.y + r.h + 1e-9) break;
        visiveis++;
      }
    }
    if (visiveis < alturas.length && visiveis > 0) {
      // o que não coube vira "…" no último par visível (em vez de sumir sem aviso)
      const ultimo = celulas.reduce((m, c, i) => (c.linha === visiveis - 1 && (m < 0 || c.coluna > celulas[m].coluna) ? i : m), -1);
      if (ultimo >= 0) {
        ctx.font = fonte(700, FONTE_VALOR * k * s);
        const ls = linhas[ultimo];
        ls[ls.length - 1] = comReticencias(ls[ls.length - 1], larguraCelula(celulas[ultimo]) * s, (t) => ctx.measureText(t).width);
      }
    }
    const topo: number[] = [];
    let y = r.y;
    alturas.forEach((h, l) => {
      topo[l] = y;
      if (l > 0 && l < visiveis) {
        const yf = (y - (VAO_LINHA_INFO * k) / 2) * s;
        ctx.fillStyle = COR_SEPARADOR;
        ctx.fillRect(r.x * s, yf - 0.1 * s, r.w * s, 0.2 * s);
      }
      y += h + VAO_LINHA_INFO * k;
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x * s, r.y * s, r.w * s, (limitar ? r.h : plano.total) * s + 1);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    itens.forEach((it, i) => {
      const c = celulas[i];
      if (c.linha >= visiveis) return;
      const x = r.x + c.coluna * (celulaW + VAO_INFO);
      const baseRot = topo[c.linha] + FONTE_ROTULO * ALTURA_MAIUSC * k;
      ctx.font = fonte(400, FONTE_ROTULO * k * s);
      ctx.fillStyle = COR_CINZA;
      ctx.fillText(it.rotulo, x * s, baseRot * s);
      ctx.font = fonte(700, FONTE_VALOR * k * s);
      ctx.fillStyle = '#000000';
      linhas[i].forEach((l, j) => ctx.fillText(l, x * s, (baseRot + (5 + j * 4.7) * k) * s));
    });
    ctx.restore();
  }
  ctx.restore();
  return plano.total;
}

const ASSINATURA = 'Mapa de Chuva COA · Locks';

/** Altura do rodapé (mm): uma linha na faixa inferior; no painel lateral, duas com a atribuição. */
function alturaRodape(lateral: boolean, atribuicao: string | null): number {
  return lateral && atribuicao ? 7 : 4.2;
}

function rodape(ctx: CanvasRenderingContext2D, r: Rect, s: number, lateral: boolean, atribuicao: string | null): void {
  ctx.save();
  ctx.fillStyle = COR_SEPARADOR;
  ctx.fillRect(r.x * s, r.y * s, r.w * s, 0.2 * s);
  const px = 2.2 * s;
  const base = (r.y + 1.4) * s + px * ALTURA_MAIUSC;
  ctx.textBaseline = 'alphabetic';
  ctx.font = fonte(400, px);
  ctx.fillStyle = COR_CINZA;
  ctx.textAlign = 'left';
  ctx.fillText(ASSINATURA, r.x * s, base);
  ctx.textAlign = 'right';
  ctx.fillText(`Gerado em ${fmtData(new Date())}`, (r.x + r.w) * s, base);
  if (atribuicao) {
    const pxA = 1.8 * s;
    ctx.font = fonte(400, pxA);
    ctx.fillStyle = '#8A8A8A';
    if (lateral) {
      ctx.textAlign = 'left';
      ctx.fillText(atribuicao, r.x * s, base + 2.8 * s, r.w * s);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(atribuicao, (r.x + r.w / 2) * s, base);
    }
  }
  ctx.restore();
}

export interface OpcoesPainel {
  /** parte visível do painel (mm do A3), já sem a moldura */
  painel: Rect;
  /** classes presentes no grid; null = sem grid */
  presentes: boolean[] | null;
  /** atribuição do mapa base (só quando algum tile foi desenhado) */
  atribuicao: string | null;
}

export function desenharPainel(ctx: CanvasRenderingContext2D, comp: Composicao, inp: RenderInput, s: number, op?: Partial<OpcoesPainel>): void {
  const p = op?.painel ?? comp.painel;
  const presentes = op?.presentes ?? null;
  const atribuicao = op?.atribuicao ?? null;
  const lateral = comp.painelPosicao === 'lateral';
  const info = itensInformacao(inp);
  const hRodape = alturaRodape(lateral, atribuicao);

  ctx.save();
  // fundo com sombra sutil e filete
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 1.6 * s;
  ctx.shadowOffsetY = 0.4 * s;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(p.x * s, p.y * s, p.w * s, p.h * s);
  ctx.restore();
  ctx.lineWidth = 0.5 * s;
  ctx.strokeStyle = COR_VERDE;
  ctx.strokeRect((p.x + 0.25) * s, (p.y + 0.25) * s, (p.w - 0.5) * s, (p.h - 0.5) * s);

  const filete = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = COR_SEPARADOR;
    ctx.fillRect(x * s, y * s, Math.max(w, 0.2) * s, Math.max(h, 0.2) * s);
  };

  let sec: SecoesPainel;
  if (lateral) {
    const larg = p.w - 2 * PAD_LATERAL;
    const hCab = cabecalho(ctx, inp, { x: 0, y: 0, w: larg, h: 0 }, s, true, false);
    const hInfo = blocoInfo(ctx, info, { x: 0, y: 0, w: larg, h: 0 }, s, 2, false, false);
    sec = planoLateral(p, { cabecalho: hCab, info: hInfo, rodape: hRodape });
    cabecalho(ctx, inp, sec.cabecalho, s, true, true);
    if (info.length) {
      filete(sec.info.x, sec.info.y - VAO_SECAO / 2, sec.info.w, 0);
      blocoInfo(ctx, info, sec.info, s, 2, false, true);
    }
    const leg = planejarLegenda(ctx, inp, presentes, sec.legenda, s, 'lateral');
    if (leg) {
      filete(sec.legenda.x, sec.legenda.y - VAO_SECAO / 2, sec.legenda.w, 0);
      leg.desenhar(sec.legenda.x * s, sec.legenda.y * s);
    }
  } else {
    const maximo = planoFaixa(p, Infinity, hRodape);
    const leg = planejarLegenda(ctx, inp, presentes, maximo.legenda, s, 'inferior');
    sec = planoFaixa(p, leg ? leg.w : 0, hRodape);
    cabecalho(ctx, inp, sec.cabecalho, s, false, true);
    const nCols = sec.info.w >= 3 * 24 + 2 * VAO_INFO ? 3 : 2;
    blocoInfo(ctx, info, sec.info, s, nCols, true, true);
    const meio = VAO_COLUNA_FAIXA / 2;
    filete(sec.info.x - meio, sec.info.y, 0, sec.info.h);
    if (leg) {
      filete(sec.legenda.x - meio, sec.legenda.y, 0, sec.legenda.h);
      leg.desenhar(sec.legenda.x * s, sec.legenda.y * s);
    }
  }
  rodape(ctx, sec.rodape, s, lateral, atribuicao);
  ctx.restore();
}
