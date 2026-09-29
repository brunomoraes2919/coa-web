/** Anticolisão de rótulos, quebra de linhas e utilitários de texto do layout. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Interseção com área positiva (encostar não conta). */
export function sobrepoe(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contem(lim: Rect, r: Rect): boolean {
  return r.x >= lim.x && r.y >= lim.y && r.x + r.w <= lim.x + lim.w && r.y + r.h <= lim.y + lim.h;
}

/**
 * Coloca rótulos sem sobreposição: cada chamada de `tenta` aceita a primeira candidata que não
 * colide com o que já foi aceito ou reservado (encostar não é colisão) e que cabe nos limites.
 */
export class LabelPlacer {
  private readonly ocupados: Rect[] = [];
  private readonly limites: Rect | null;

  constructor(limites?: Rect) {
    this.limites = limites ?? null;
  }

  /** Marca uma área como ocupada (ex.: símbolo de PIC, legenda), sem testar colisão. */
  reserva(r: Rect): void {
    this.ocupados.push(r);
  }

  livre(r: Rect): boolean {
    if (this.limites && !contem(this.limites, r)) return false;
    for (const o of this.ocupados) if (sobrepoe(r, o)) return false;
    return true;
  }

  tenta(cands: Rect[]): Rect | null {
    for (const c of cands) {
      if (this.livre(c)) {
        this.ocupados.push(c);
        return c;
      }
    }
    return null;
  }
}

/**
 * Quebra automática por palavras (greedy). `\n` força quebra; palavra maior que a largura é
 * partida por caracteres. `medir` devolve a largura de um trecho na mesma unidade de larguraMax.
 */
export function quebrarTexto(texto: string, larguraMax: number, medir: (s: string) => number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split('\n')) {
    const palavras = paragrafo.trim().split(/\s+/).filter(Boolean);
    let linha = '';
    for (const palavra of palavras) {
      const cand = linha ? `${linha} ${palavra}` : palavra;
      if (medir(cand) <= larguraMax) {
        linha = cand;
        continue;
      }
      if (linha) linhas.push(linha);
      linha = '';
      if (medir(palavra) <= larguraMax) {
        linha = palavra;
        continue;
      }
      let pedaco = '';
      for (const ch of Array.from(palavra)) {
        if (pedaco && medir(pedaco + ch) > larguraMax) {
          linhas.push(pedaco);
          pedaco = ch;
        } else pedaco += ch;
      }
      linha = pedaco;
    }
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/** Última linha com "…" no fim, encurtada até caber em `larguraMax`. */
export function comReticencias(linha: string, larguraMax: number, medir: (s: string) => number): string {
  let chars = Array.from(linha.trimEnd());
  while (chars.length && medir(`${chars.join('').trimEnd()}…`) > larguraMax) chars = chars.slice(0, -1);
  return `${chars.join('').trimEnd()}…`;
}

/**
 * No máximo `max` linhas; se sobrar texto, a última termina em "…" (encurtada até caber em
 * `larguraMax`) em vez de o resto sumir sem aviso.
 */
export function limitarLinhas(linhas: string[], max: number, larguraMax: number, medir: (s: string) => number): string[] {
  if (linhas.length <= max) return linhas;
  if (max <= 0) return [];
  const res = linhas.slice(0, max);
  res[max - 1] = comReticencias(res[max - 1], larguraMax, medir);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Texto no canvas. O layout desenha em pixels de dispositivo (transformação identidade) e as
// fontes recebem o tamanho já em px, evitando o limite de fonte mínima de alguns navegadores.

export const FAMILIA = '"Open Sans", "Segoe UI", Arial, sans-serif';
/** Altura das maiúsculas da Open Sans em relação ao corpo (em). */
export const ALTURA_MAIUSC = 0.714;

export function fonte(peso: 400 | 700, px: number): string {
  return `${peso} ${Math.max(px, 0.5).toFixed(2)}px ${FAMILIA}`;
}

/** Texto com halo (contorno arredondado de largura haloPx para cada lado). */
export function textoComHalo(
  ctx: CanvasRenderingContext2D,
  txt: string,
  x: number,
  y: number,
  cor: string,
  halo?: string,
  haloPx = 0,
): void {
  if (halo && haloPx > 0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = haloPx * 2;
    ctx.strokeStyle = halo;
    ctx.strokeText(txt, x, y);
    ctx.restore();
  }
  ctx.fillStyle = cor;
  ctx.fillText(txt, x, y);
}

/**
 * Retângulo ocupado por um texto de uma linha (baseline alfabética em y), incluindo o halo.
 * Usa a largura medida com a fonte atual do contexto.
 */
export function caixaTexto(
  ctx: CanvasRenderingContext2D,
  txt: string,
  x: number,
  yBase: number,
  px: number,
  haloPx: number,
  alinhar: 'left' | 'center' | 'right' = 'left',
): Rect {
  const w = ctx.measureText(txt).width;
  const x0 = alinhar === 'left' ? x : alinhar === 'center' ? x - w / 2 : x - w;
  const asc = px * ALTURA_MAIUSC;
  const desc = px * 0.22;
  return { x: x0 - haloPx, y: yBase - asc - haloPx, w: w + 2 * haloPx, h: asc + desc + 2 * haloPx };
}
