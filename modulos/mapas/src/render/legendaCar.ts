/**
 * Legenda do Mapa de CAR e Matrícula: as camadas (amostra + nome) e o quadro de áreas por CAR e por matrícula
 * (ha). Na faixa inferior (retrato), lado a lado; no painel lateral, uma coluna (legenda em cima, quadro embaixo) ou,
 * no painel largo, lado a lado quando o texto fica maior assim.
 * O texto reduz até caber; se nem assim couber, o quadro mostra as maiores linhas e avisa quantas ficaram na tela.
 * Medidas em mm do A3; `s` = px por mm.
 */
import { CORES_CAR, CORES_MATRICULA, escurecer, fmtHa, type LinhaQuadroCar } from '../lib/car';
import { ALTURA_MAIUSC, fonte, quebrarTexto, type Rect } from './labels';
import type { PlanoLegenda } from './legend';
import { ehRodovia, ESTILO_CAR, type EntradaCar } from './car';
import { desenharPadrao } from './patterns';
import { COR_CINZA, COR_SEPARADOR, COR_TEXTO, COR_VERDE } from './types';

const FONTE_TITULO = 3.5;
const ALTURA_TITULO = 5.6;
const FONTE_ITEM = 2.9;
const LINHA_ITEM = 4.6;
const AMOSTRA_W = 6;
const AMOSTRA_H = 3.6;
const FONTE_TAB = 2.5;
const FONTE_CAB = 2.1;
const LINHA_TAB = 3.6;
const VAO_COL = 1.6;
const VAO_BLOCO = 6;
const K_MIN = 0.62;
/** quadradinho da cor de cada CAR e matrícula antes do rótulo, no quadro */
const COR_LINHA = 2.4;
const VAO_COR_LINHA = 1;
const NOTA = '* Pecuária estimada: área consolidada declarada no CAR, fora dos talhões.';

type Amostra = 'car' | 'matricula' | 'agricola' | 'eucalipto' | 'reservaLegal' | 'app' | 'vegetacaoNativa' | 'agua' | 'estrada' | 'rodovia';

/** Camadas da legenda presentes no mapa, na ordem de leitura. */
export function itensLegendaCar(car: EntradaCar): { amostra: Amostra; texto: string }[] {
  const d = car.dados;
  const temTema = (prefixo: RegExp) => d.temas.features.some((f) => prefixo.test(String(f.properties?.tema ?? '')));
  const itens: { amostra: Amostra; texto: string }[] = [];
  if (d.car.features.length) itens.push({ amostra: 'car', texto: 'CAR (SICAR), cor de cada um no quadro' });
  if (d.matriculas.features.length) itens.push({ amostra: 'matricula', texto: 'Matrícula (SIGEF), cor de cada uma' });
  itens.push({ amostra: 'agricola', texto: 'Talhão agrícola' });
  if ([...car.usoTalhao.values()].includes('eucalipto')) itens.push({ amostra: 'eucalipto', texto: 'Eucalipto (PIMS)' });
  if (temTema(/^arl_/)) itens.push({ amostra: 'reservaLegal', texto: 'Reserva legal' });
  if (temTema(/^app_/)) itens.push({ amostra: 'app', texto: 'APP' });
  if (temTema(/^vegetacao_nativa$/)) itens.push({ amostra: 'vegetacaoNativa', texto: 'Vegetação nativa' });
  if (d.hidrografia.features.length || temTema(/^(rio_|nascente|lago_natural|vereda|reservatorio_)/)) itens.push({ amostra: 'agua', texto: "Rios, córregos e lagos" });
  if (d.estradas.features.some((f) => ehRodovia(f))) itens.push({ amostra: 'rodovia', texto: 'Rodovia' });
  if (d.estradas.features.some((f) => !ehRodovia(f))) itens.push({ amostra: 'estrada', texto: 'Estrada e carreador' });
  return itens;
}

/** Colunas do quadro: rótulo e áreas; eucalipto só quando há. */
export function colunasQuadroCar(linhas: LinhaQuadroCar[]): { cab: string; valor: (l: LinhaQuadroCar) => string }[] {
  const cols: { cab: string; valor: (l: LinhaQuadroCar) => string }[] = [
    { cab: '', valor: (l) => l.rotulo },
    { cab: 'Área', valor: (l) => fmtHa(l.areaHa) },
    { cab: 'Agríc.', valor: (l) => fmtHa(l.agricolaHa) },
  ];
  if (linhas.some((l) => l.eucaliptoHa >= 0.05)) cols.push({ cab: 'Euc.', valor: (l) => fmtHa(l.eucaliptoHa) });
  cols.push({ cab: 'Pec.*', valor: (l) => fmtHa(l.pecuariaHa) }, { cab: 'RL', valor: (l) => fmtHa(l.reservaLegalHa) }, { cab: 'APP', valor: (l) => fmtHa(l.appHa) });
  return cols;
}

/** Quadradinho de um CAR (tom claro + contorno na cor dele) ou de uma matrícula (preenchida, contorno mais escuro). */
function corDe(ctx: CanvasRenderingContext2D, tipo: 'car' | 'matricula', cor: string, r: Rect, u: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = cor;
  ctx.globalAlpha = tipo === 'car' ? 0.25 : ESTILO_CAR.matricula.alfa;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = (tipo === 'car' ? 0.45 : 0.2) * u;
  ctx.strokeStyle = tipo === 'car' ? cor : escurecer(cor);
  ctx.stroke();
  ctx.restore();
}

/** Cor do rótulo de cada linha: a do CAR; a da matrícula, escurecida para ler no branco. */
export function corDoRotulo(l: LinhaQuadroCar): string {
  return l.tipo === 'car' ? l.cor : escurecer(l.cor, 0.45);
}

function amostra(ctx: CanvasRenderingContext2D, tipo: Amostra, r: Rect, s: number, u: number, cores: { car: string[]; matricula: string[] }): void {
  ctx.save();
  const meioY = r.y + r.h / 2;
  const linha = (cor: string, mm: number, traco: number[] | null) => {
    ctx.beginPath();
    ctx.moveTo(r.x, meioY);
    ctx.lineTo(r.x + r.w, meioY);
    ctx.lineWidth = mm * u;
    ctx.strokeStyle = cor;
    if (traco) ctx.setLineDash(traco.map((d) => d * u));
    ctx.stroke();
  };
  const caixa = (fill: string | null, contorno: string | null, mm = 0.25, traco: number[] | null = null) => {
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (contorno) {
      ctx.lineWidth = mm * u;
      ctx.strokeStyle = contorno;
      if (traco) ctx.setLineDash(traco.map((d) => d * u));
      ctx.stroke();
    }
  };
  /** amostra com padrão (grade, pontos) recortado na caixa */
  const comPadrao = (estilo: 'quadriculado' | 'pontilhado', cor: string, alfa: number, mm: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    desenharPadrao(ctx, estilo, r, s, [r.x, r.y], { cor, alfa, larguraMm: mm });
    ctx.restore();
  };
  /** as cores de verdade do mapa (até 3), lado a lado: cada CAR e cada matrícula tem a sua */
  const variasCores = (t: 'car' | 'matricula', lista: string[]) => {
    const cs = lista.slice(0, 3);
    const vao = 0.5 * u;
    const w = (r.w - vao * (cs.length - 1)) / cs.length;
    cs.forEach((c, i) => corDe(ctx, t, c, { x: r.x + i * (w + vao), y: r.y, w, h: r.h }, u));
  };
  switch (tipo) {
    case 'car':
      variasCores('car', cores.car.length ? cores.car : [...CORES_CAR]);
      break;
    case 'matricula':
      variasCores('matricula', cores.matricula.length ? cores.matricula : [...CORES_MATRICULA]);
      break;
    case 'agricola':
      caixa(null, ESTILO_CAR.agricola.contorno, 0.2);
      break;
    case 'eucalipto':
      comPadrao('quadriculado', ESTILO_CAR.eucalipto.padrao, 0.6, 0.2);
      caixa(null, ESTILO_CAR.eucalipto.contorno, 0.2);
      break;
    case 'vegetacaoNativa':
      comPadrao('pontilhado', ESTILO_CAR.vegetacaoNativa.padrao, 0.7, 0.25);
      caixa(null, '#9DBF93', 0.12);
      break;
    case 'app':
      caixa(ESTILO_CAR.app.fill, ESTILO_CAR.app.contorno, 0.12);
      break;
    case 'reservaLegal':
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      desenharPadrao(ctx, 'diagonal', r, s, [r.x, r.y], { cor: ESTILO_CAR.reservaLegal.hachura, alfa: 0.75, larguraMm: 0.22 });
      ctx.restore();
      caixa(null, ESTILO_CAR.reservaLegal.contorno, 0.25);
      break;
    case 'agua':
      caixa(ESTILO_CAR.agua.fill, ESTILO_CAR.agua.linha, 0.2);
      break;
    case 'estrada':
      linha(ESTILO_CAR.estrada.cor, 0.3, [1.2, 0.7]);
      break;
    case 'rodovia':
      linha(ESTILO_CAR.rodovia.cor, 0.7, null);
      break;
  }
  ctx.restore();
}

/**
 * Planeja a legenda do CAR para caber em `area` (mm). Devolve o tamanho ocupado e a função que desenha a partir do
 * canto superior esquerdo (px).
 */
export function planejarLegendaCar(ctx: CanvasRenderingContext2D, car: EntradaCar, area: { w: number; h: number }, s: number, modo: 'lateral' | 'inferior'): PlanoLegenda | null {
  const itens = itensLegendaCar(car);
  const linhas = car.quadro.linhas;
  const cols = colunasQuadroCar(linhas);
  // cores na ordem do quadro (a amostra da legenda mostra as primeiras)
  const cores = { car: linhas.filter((l) => l.tipo === 'car').map((l) => l.cor), matricula: linhas.filter((l) => l.tipo === 'matricula').map((l) => l.cor) };
  const medir = (t: string, peso: 400 | 700, mm: number) => {
    ctx.font = fonte(peso, mm * s);
    return ctx.measureText(t).width / s;
  };

  /** tamanho da legenda (itens) e do quadro com redução k e `n` linhas no quadro */
  const medidas = (k: number, n: number) => {
    const wItens = Math.max(...itens.map((it) => AMOSTRA_W * k + 2 * k + medir(it.texto, 400, FONTE_ITEM * k)), medir('Legenda', 700, FONTE_TITULO * k));
    const hItens = ALTURA_TITULO * k + itens.length * LINHA_ITEM * k;
    const mostradas = linhas.slice(0, n);
    const larg = cols.map((c, j) => Math.max(medir(c.cab, 700, FONTE_CAB * k), ...mostradas.map((l) => medir(c.valor(l), j === 0 ? 700 : 400, FONTE_TAB * k) + (j === 0 ? (COR_LINHA + VAO_COR_LINHA) * k : 0))));
    const wTab = larg.reduce((a, b) => a + b, 0) + VAO_COL * k * (cols.length - 1);
    const sobra = linhas.length - n;
    // título, cabeçalho, linhas, aviso das que sobraram e a nota (até 2 linhas)
    const hTab = linhas.length ? ALTURA_TITULO * k + LINHA_TAB * k * (1 + n) + (sobra > 0 ? LINHA_TAB * k : 0) + LINHA_TAB * k * 2 : 0;
    const wNota = linhas.length ? medir(NOTA, 400, FONTE_CAB * k) : 0;
    return { wItens, hItens, larg, wTab: Math.max(wTab, Math.min(wNota, wTab)), hTab, sobra };
  };
  /** 'pilha' = legenda em cima e quadro embaixo; 'lado' = lado a lado */
  type Arranjo = 'pilha' | 'lado';
  const total = (k: number, n: number, arranjo: Arranjo) => {
    const m = medidas(k, n);
    return arranjo === 'pilha'
      ? { ...m, w: Math.max(m.wItens, m.wTab), h: m.hItens + (m.hTab ? VAO_BLOCO * k + m.hTab : 0) }
      : { ...m, w: m.wItens + (m.hTab ? VAO_BLOCO * k + m.wTab : 0), h: Math.max(m.hItens, m.hTab) };
  };
  const cabe = (t: { w: number; h: number }) => t.w <= area.w + 1e-9 && t.h <= area.h + 1e-9;
  // lado a lado primeiro: no painel largo deixa o texto maior; no estreito não cabe e fica a coluna
  const arranjos: Arranjo[] = modo === 'lateral' ? ['lado', 'pilha'] : ['lado'];
  let escolhido: { k: number; n: number; arranjo: Arranjo } | null = null;
  for (let k = 1; k >= K_MIN - 1e-9 && !escolhido; k = Math.round((k - 0.04) * 100) / 100) {
    const arranjo = arranjos.find((a) => cabe(total(k, linhas.length, a)));
    if (arranjo) escolhido = { k, n: linhas.length, arranjo };
  }
  if (!escolhido) {
    // nem com o texto menor: mostra as maiores linhas que cabem (CARs primeiro, na ordem do quadro)
    const maisLinhas = (arranjo: Arranjo) => {
      let n = linhas.length;
      while (n > 0 && !cabe(total(K_MIN, n, arranjo))) n--;
      return { k: K_MIN, n, arranjo };
    };
    escolhido = arranjos.map(maisLinhas).reduce((a, b) => (b.n > a.n ? b : a));
  }
  const { k, n, arranjo } = escolhido;
  const m = total(k, n, arranjo);

  const desenhar = (x0: number, y0: number) => {
    const u = k * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, area.w * s, area.h * s);
    ctx.clip();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // legenda das camadas
    ctx.font = fonte(700, FONTE_TITULO * u);
    ctx.fillStyle = COR_VERDE;
    ctx.fillText('Legenda', x0, y0 + ALTURA_TITULO * u - 2 * u);
    let y = y0 + ALTURA_TITULO * u;
    for (const it of itens) {
      const cy = y + (LINHA_ITEM * u) / 2;
      amostra(ctx, it.amostra, { x: x0, y: cy - (AMOSTRA_H * u) / 2, w: AMOSTRA_W * u, h: AMOSTRA_H * u }, s, u, cores);
      ctx.font = fonte(400, FONTE_ITEM * u);
      ctx.fillStyle = COR_TEXTO;
      ctx.textAlign = 'left';
      ctx.fillText(it.texto, x0 + (AMOSTRA_W + 2) * u, cy + (FONTE_ITEM * u * ALTURA_MAIUSC) / 2);
      y += LINHA_ITEM * u;
    }
    if (!linhas.length) {
      ctx.restore();
      return;
    }
    // quadro de áreas
    const tx = arranjo === 'pilha' ? x0 : x0 + (m.wItens + VAO_BLOCO * k) * s;
    let ty = arranjo === 'pilha' ? y + VAO_BLOCO * u : y0;
    ctx.font = fonte(700, FONTE_TITULO * u);
    ctx.fillStyle = COR_VERDE;
    ctx.textAlign = 'left';
    ctx.fillText('Áreas (ha)', tx, ty + ALTURA_TITULO * u - 2 * u);
    ty += ALTURA_TITULO * u;
    const xs: number[] = [];
    let acc = tx;
    m.larg.forEach((w) => {
      xs.push(acc);
      acc += (w + VAO_COL * k) * s;
    });
    const fimCol = (j: number) => xs[j] + m.larg[j] * s;
    const base = (yy: number, mm: number) => yy + (LINHA_TAB * u + mm * u * ALTURA_MAIUSC) / 2;
    ctx.font = fonte(700, FONTE_CAB * u);
    ctx.fillStyle = COR_CINZA;
    cols.forEach((c, j) => {
      ctx.textAlign = j === 0 ? 'left' : 'right';
      ctx.fillText(c.cab, j === 0 ? xs[j] : fimCol(j), base(ty, FONTE_CAB));
    });
    ty += LINHA_TAB * u;
    ctx.fillStyle = COR_VERDE;
    ctx.fillRect(tx, ty - 0.15 * s, (acc - tx) - VAO_COL * u, Math.max(1, 0.2 * s));
    let anterior: 'car' | 'matricula' | null = null;
    for (const l of linhas.slice(0, n)) {
      if (anterior && anterior !== l.tipo) {
        ctx.fillStyle = COR_SEPARADOR;
        ctx.fillRect(tx, ty, (acc - tx) - VAO_COL * u, Math.max(1, 0.25 * s));
      }
      anterior = l.tipo;
      corDe(ctx, l.tipo, l.cor, { x: xs[0], y: ty + ((LINHA_TAB - COR_LINHA) * u) / 2, w: COR_LINHA * u, h: COR_LINHA * u }, u);
      cols.forEach((c, j) => {
        ctx.font = fonte(j === 0 ? 700 : 400, FONTE_TAB * u);
        ctx.fillStyle = j === 0 ? corDoRotulo(l) : COR_TEXTO;
        ctx.textAlign = j === 0 ? 'left' : 'right';
        ctx.fillText(c.valor(l), j === 0 ? xs[j] + (COR_LINHA + VAO_COR_LINHA) * u : fimCol(j), base(ty, FONTE_TAB));
      });
      ty += LINHA_TAB * u;
    }
    ctx.font = fonte(400, FONTE_CAB * u);
    ctx.fillStyle = COR_CINZA;
    ctx.textAlign = 'left';
    if (m.sobra > 0) {
      ctx.fillText(`+ ${m.sobra} ${m.sobra === 1 ? 'linha' : 'linhas'} no quadro da tela e no CSV`, tx, base(ty, FONTE_CAB));
      ty += LINHA_TAB * u;
    }
    // a nota quebra na largura do bloco (a legenda e o quadro, o que for mais largo)
    const largNota = (arranjo === 'pilha' ? m.w : m.wTab) * s;
    quebrarTexto(NOTA, largNota, (t) => ctx.measureText(t).width).forEach((l, i) => ctx.fillText(l, tx, base(ty + 0.4 * u + i * LINHA_TAB * u * 0.9, FONTE_CAB)));
    ctx.restore();
  };
  return { w: m.w, h: m.h, desenhar };
}
