/**
 * Legenda do mapa de variedade em forma de tabela: título "Variedades", cabeçalho e uma linha por variedade com
 * amostra da cor | Nome comercial | Variedade (PIMS) | ha | %. Com sementes por metro ou população cadastradas na
 * fazenda, entram as colunas Sem./m e População antes de ha. Os nomes quebram em até 3 linhas dentro da coluna.
 * No painel lateral prefere reduzir o texto; na faixa inferior (retrato) prefere dividir as linhas em blocos lado a
 * lado (cada bloco com o seu cabeçalho). Medidas em mm do A3 (k = 1); `s` = px por mm.
 */
import type { ResumoVariedades } from '../lib/types';
import { colunasNomeVariedade, fmtAreaHa, fmtPctVariedade, fmtPopulacao, fmtSementes, temPopulacao, TITULO_VARIEDADES } from '../lib/variedades';
import { ALTURA_MAIUSC, fonte, limitarLinhas, quebrarTexto } from './labels';
import type { PlanoLegenda } from './legend';
import { COR_BORDA_AMOSTRA, COR_CINZA, COR_SEPARADOR, COR_TEXTO, COR_VERDE } from './types';

const FONTE_TITULO = 3.5;
const ALTURA_TITULO = 5.4;
const FONTE_ITEM = 2.9;
const FONTE_CAB = 2.4;
const ENTRELINHA = 1.32; // × fonte
const PAD_V = 1.15;
const AMOSTRA = 3.6;
const VAO = 1.8;
const VAO_BLOCOS = 5;
const MAX_LINHAS = 3;
const K_MIN = 0.65;
const SEM_NOME = '—';

export const CABECALHO_VARIEDADES = ['Nome comercial', 'Variedade (PIMS)', 'ha', '%'] as const;
/** colunas que entram quando a fazenda tem sementes por metro ou população cadastradas */
export const CABECALHO_POPULACAO = ['Sem./m', 'População'] as const;

interface Linha {
  cor: string;
  comercial: string[];
  pims: string[];
  /** valores das colunas numéricas, na ordem de `cabNums` */
  nums: string[];
  h: number;
}

interface Plano {
  k: number;
  /** nenhuma palavra partida no meio e nenhum nome cortado com "…" (o que a busca procura primeiro) */
  inteiro: boolean;
  /** larguras (mm, já com k): amostra, nome comercial, PIMS */
  cols: [number, number, number];
  /** larguras das colunas numéricas (mm, já com k) */
  wNums: number[];
  linhas: Linha[];
  blocos: number[][];
  hCab: number;
  /** cabeçalhos das colunas de nome, quebrados na largura da coluna (até 2 linhas) */
  cabC: string[];
  cabP: string[];
  wBloco: number;
  w: number;
  h: number;
}

export function planejarTabelaVariedades(
  ctx: CanvasRenderingContext2D,
  resumo: ResumoVariedades,
  area: { w: number; h: number },
  s: number,
  modo: 'lateral' | 'inferior',
): PlanoLegenda | null {
  if (!resumo.itens.length) return null;
  const comPop = temPopulacao(resumo);
  const cabNums: string[] = comPop ? [...CABECALHO_POPULACAO, CABECALHO_VARIEDADES[2], CABECALHO_VARIEDADES[3]] : [CABECALHO_VARIEDADES[2], CABECALHO_VARIEDADES[3]];
  const dados = resumo.itens.map((i) => {
    const n = colunasNomeVariedade(i);
    const nums = [fmtAreaHa(i.areaHa), fmtPctVariedade(i.pct)];
    if (comPop) nums.unshift(fmtSementes(i.sementesMetro) || SEM_NOME, fmtPopulacao(i.populacao) || SEM_NOME);
    return { cor: i.cor, comercial: n.comercial || SEM_NOME, pims: n.pims, nums };
  });
  const medir = (texto: string, peso: 400 | 700, mm: number) => {
    ctx.font = fonte(peso, mm * s);
    return ctx.measureText(texto).width / s;
  };

  /** Plano com redução k e n blocos; null = não cabe. `forcar` devolve o plano mesmo sem caber (último recurso). */
  const tentar = (k: number, n: number, forcar = false): Plano | null => {
    const fI = FONTE_ITEM * k;
    const fC = FONTE_CAB * k;
    const vao = VAO * k;
    const vaoBlocos = VAO_BLOCOS * k;
    const larg = (textos: string[], cab: string) => Math.max(medir(cab, 700, fC), ...textos.map((t) => medir(t, 400, fI)));
    const wSw = AMOSTRA * k;
    const wNums = cabNums.map((cab, j) => larg(dados.map((d) => d.nums[j]), cab));
    const natC = larg(dados.map((d) => d.comercial), CABECALHO_VARIEDADES[0]);
    const natP = larg(dados.map((d) => d.pims), CABECALHO_VARIEDADES[1]);
    const fixo = wSw + wNums.reduce((a, b) => a + b, 0) + (2 + wNums.length) * vao;
    const disponivel = (area.w - (n - 1) * vaoBlocos) / n - fixo;
    if (disponivel < 14 * k && !forcar) return null;
    let wC = natC;
    let wP = natP;
    if (natC + natP > disponivel) {
      const total = Math.max(disponivel, 8 * k);
      // menor largura de cada coluna de nome sem partir palavra: a palavra mais larga dos nomes e do cabeçalho
      const maiorPalavra = (textos: string[], peso: 400 | 700, mm: number) =>
        Math.max(0, ...textos.flatMap((x) => x.split(/\s+/)).filter(Boolean).map((x) => medir(x, peso, mm)));
      const minC = Math.min(natC, Math.max(maiorPalavra(dados.map((d) => d.comercial), 400, fI), maiorPalavra([CABECALHO_VARIEDADES[0]], 700, fC)));
      const minP = Math.min(natP, Math.max(maiorPalavra(dados.map((d) => d.pims), 400, fI), maiorPalavra([CABECALHO_VARIEDADES[1]], 700, fC)));
      if (minC + minP <= total) {
        // cada uma com a sua palavra mais larga; o que sobra vai na proporção do que falta para a largura natural
        const sobra = total - minC - minP;
        const faltaC = natC - minC;
        const faltaP = natP - minP;
        wC = minC + (faltaC + faltaP > 0 ? (sobra * faltaC) / (faltaC + faltaP) : 0);
        wP = Math.min(natP, total - wC);
        wC = Math.min(natC, total - wP);
      } else {
        // nem a palavra mais larga cabe: divide pela largura natural, sem deixar uma coluna com menos de 30%
        const fracC = Math.min(0.7, Math.max(0.3, natC / (natC + natP)));
        wC = Math.min(natC, total * fracC);
        wP = Math.min(natP, total - wC);
        wC = Math.min(natC, total - wP);
      }
    }
    const linhaH = fI * ENTRELINHA;
    let inteiro = true;
    const quebrar = (t: string, w: number) => {
      const m = (x: string) => medir(x, 400, fI);
      const ls = quebrarTexto(t, w, m);
      if (ls.length > MAX_LINHAS || t.split(/\s+/).some((p) => m(p) > w + 1e-6)) inteiro = false;
      return limitarLinhas(ls, MAX_LINHAS, w, m);
    };
    const linhas: Linha[] = dados.map((d) => {
      const comercial = quebrar(d.comercial, wC);
      const pims = quebrar(d.pims, wP);
      return { ...d, comercial, pims, h: Math.max(comercial.length, pims.length, 1) * linhaH + 2 * PAD_V * k };
    });
    // os cabeçalhos das colunas de nome quebram na largura da coluna (não invadem a coluna do lado)
    const quebrarCab = (t: string, w: number) => {
      const m = (x: string) => medir(x, 700, fC);
      return limitarLinhas(quebrarTexto(t, w, m), 2, w, m);
    };
    const cabC = quebrarCab(CABECALHO_VARIEDADES[0], wC);
    const cabP = quebrarCab(CABECALHO_VARIEDADES[1], wP);
    const hCab = Math.max(cabC.length, cabP.length, 1) * fC * ENTRELINHA + 2 * PAD_V * k;
    const hTitulo = ALTURA_TITULO * k;
    const limite = area.h - hTitulo - hCab;
    // blocos de linhas seguidas, cada um com altura ≤ limite (o menor limite que cabe em n blocos, equilibrados)
    const agrupar = (lim: number): number[][] => {
      const bs: number[][] = [];
      let atual: number[] = [];
      let usado = 0;
      linhas.forEach((l, i) => {
        if (atual.length && usado + l.h > lim + 1e-9) {
          bs.push(atual);
          atual = [];
          usado = 0;
        }
        atual.push(i);
        usado += l.h;
      });
      if (atual.length) bs.push(atual);
      return bs;
    };
    const maiorLinha = Math.max(...linhas.map((l) => l.h));
    let blocos: number[][];
    if (maiorLinha <= limite + 1e-9 && agrupar(limite).length <= n) {
      let lo = maiorLinha;
      let hi = limite;
      for (let it = 0; it < 30; it++) {
        const meio = (lo + hi) / 2;
        if (agrupar(meio).length <= n) hi = meio;
        else lo = meio;
      }
      blocos = agrupar(hi);
    } else if (forcar) {
      const porBloco = Math.ceil(linhas.length / n);
      blocos = [];
      for (let i = 0; i < linhas.length; i += porBloco) blocos.push(linhas.slice(i, i + porBloco).map((_, j) => i + j));
    } else return null;
    const wBloco = fixo + wC + wP;
    const hBlocos = Math.max(...blocos.map((b) => b.reduce((acc, i) => acc + linhas[i].h, 0)));
    const mCab = (x: string) => medir(x, 700, fC);
    if (CABECALHO_VARIEDADES[0].split(' ').some((p) => mCab(p) > wC + 1e-6) || CABECALHO_VARIEDADES[1].split(' ').some((p) => mCab(p) > wP + 1e-6)) inteiro = false;
    return {
      k,
      inteiro,
      cols: [wSw, wC, wP],
      wNums,
      linhas,
      blocos,
      hCab,
      cabC,
      cabP,
      wBloco,
      w: blocos.length * wBloco + (blocos.length - 1) * vaoBlocos,
      h: hTitulo + hCab + hBlocos,
    };
  };

  ctx.save();
  const ks: number[] = [];
  for (let k = 1; k >= K_MIN - 1e-9; k -= 0.05) ks.push(Math.round(k * 100) / 100);
  const maxBlocos = modo === 'lateral' ? 1 : 3;
  const ns = Array.from({ length: maxBlocos }, (_, i) => i + 1);
  const ordem: [number, number][] = modo === 'lateral' ? ks.map((k) => [k, 1]) : ks.flatMap((k) => ns.map((n): [number, number] => [k, n]));
  let plano: Plano | null = null;
  // primeiro o maior texto em que todo nome sai inteiro; se nenhum, o maior que cabe (partindo palavras)
  for (const [k, n] of ordem) {
    const p = tentar(k, n);
    if (p?.inteiro) {
      plano = p;
      break;
    }
  }
  if (!plano) {
    for (const [k, n] of ordem) {
      plano = tentar(k, n);
      if (plano) break;
    }
  }
  plano ??= tentar(K_MIN, maxBlocos, true) as Plano;
  ctx.restore();
  const p = plano;

  const desenhar = (x0: number, y0: number) => {
    const u = p.k * s;
    const [wSw, wC, wP] = p.cols.map((c) => c * s);
    const wNums = p.wNums.map((c) => c * s);
    const vao = VAO * u;
    const fI = FONTE_ITEM * u;
    const fC = FONTE_CAB * u;
    const linhaH = fI * ENTRELINHA;
    const pad = PAD_V * u;
    ctx.save();
    // nada passa da área reservada (ex.: o rodapé), mesmo quando não coube
    ctx.beginPath();
    ctx.rect(x0, y0, area.w * s, area.h * s);
    ctx.clip();
    ctx.textBaseline = 'alphabetic';
    ctx.font = fonte(700, FONTE_TITULO * u);
    ctx.fillStyle = COR_VERDE;
    ctx.textAlign = 'left';
    ctx.fillText(TITULO_VARIEDADES, x0, y0 + ALTURA_TITULO * u - 2.2 * u);
    const yCab = y0 + ALTURA_TITULO * u;
    const xC = (xb: number) => xb + wSw + vao;
    const xP = (xb: number) => xC(xb) + wC + vao;
    /** borda direita de cada coluna numérica (o texto é alinhado à direita) */
    const xNumFim = (xb: number, j: number) => {
      let x = xP(xb) + wP;
      for (let q = 0; q <= j; q++) x += vao + wNums[q];
      return x;
    };
    const filete = (xb: number, y: number, espessura: number, cor: string) => {
      ctx.fillStyle = cor;
      ctx.fillRect(xb, y, p.wBloco * s, Math.max(1, espessura * s));
    };
    p.blocos.forEach((bloco, b) => {
      const xb = x0 + b * (p.wBloco + VAO_BLOCOS * p.k) * s;
      // cabeçalho
      // todos os cabeçalhos alinhados pela última linha (os de nome podem ter 2 linhas)
      const linhaCab = fC * ENTRELINHA;
      const baseUltima = yCab + p.hCab * s - pad - (linhaCab - fC * ALTURA_MAIUSC) / 2;
      ctx.font = fonte(700, fC);
      ctx.fillStyle = COR_CINZA;
      ctx.textAlign = 'left';
      p.cabC.forEach((t, q) => ctx.fillText(t, xC(xb), baseUltima - (p.cabC.length - 1 - q) * linhaCab));
      p.cabP.forEach((t, q) => ctx.fillText(t, xP(xb), baseUltima - (p.cabP.length - 1 - q) * linhaCab));
      ctx.textAlign = 'right';
      cabNums.forEach((cab, j) => ctx.fillText(cab, xNumFim(xb, j), baseUltima));
      let y = yCab + p.hCab * s;
      filete(xb, y - 0.25 * s, 0.25, COR_VERDE);
      bloco.forEach((i, j) => {
        const l = p.linhas[i];
        const h = l.h * s;
        // primeira linha de texto da linha da tabela
        const base1 = y + pad + fI * ALTURA_MAIUSC + (linhaH - fI * ALTURA_MAIUSC) / 2;
        const ySw = base1 - (fI * ALTURA_MAIUSC) / 2 - wSw / 2;
        ctx.beginPath();
        ctx.roundRect(xb, ySw, wSw, wSw, 0.5 * u);
        ctx.fillStyle = l.cor;
        ctx.fill();
        ctx.lineWidth = 0.15 * u;
        ctx.strokeStyle = COR_BORDA_AMOSTRA;
        ctx.stroke();
        ctx.font = fonte(400, fI);
        ctx.fillStyle = COR_TEXTO;
        ctx.textAlign = 'left';
        l.comercial.forEach((t, n) => ctx.fillText(t, xC(xb), base1 + n * linhaH));
        l.pims.forEach((t, n) => ctx.fillText(t, xP(xb), base1 + n * linhaH));
        ctx.textAlign = 'right';
        l.nums.forEach((v, q) => ctx.fillText(v, xNumFim(xb, q), base1));
        y += h;
        if (j < bloco.length - 1) filete(xb, y - 0.1 * s, 0.2, COR_SEPARADOR);
      });
    });
    ctx.restore();
  };

  return { w: p.w, h: p.h, desenhar };
}
