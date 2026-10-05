/**
 * Limites do aparelho para gerar o mapa no navegador. No computador nada muda. No celular e no tablet a
 * memória é curta: o iPhone/iPad não desenha imagens (canvas) com mais de ~16,7 milhões de pixels (a
 * folha A3 em 300 dpi tem 17,4 milhões e sairia em branco) e a grade da interpolação precisa caber na
 * memória da aba. Por isso, ali, o PNG sai na maior resolução que o aparelho aguenta e a grade usa um
 * pixel maior quando a fazenda é grande.
 */

export type TipoAparelho = 'ios' | 'movel' | 'computador';

export interface LimitesAparelho {
  tipo: TipoAparelho;
  /** área máxima de uma imagem (largura × altura em pixels); Infinity = sem limite próprio */
  maxPixelsCanvas: number;
  /** células da grade da interpolação antes de aumentar o pixel sozinho; null = regra do computador (erro acima de 60 milhões) */
  maxCelulas: number | null;
}

interface NavegadorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
}

export function tipoDeAparelho(nav: NavegadorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): TipoAparelho {
  if (!nav) return 'computador';
  const ua = nav.userAgent ?? '';
  // o iPad moderno se apresenta como Mac: a diferença é a tela de toque
  if (/iP(hone|ad|od)/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (nav.userAgentData?.mobile === true || /Android|Mobile/i.test(ua)) return 'movel';
  return 'computador';
}

export function limitesDoAparelho(tipo: TipoAparelho = tipoDeAparelho()): LimitesAparelho {
  if (tipo === 'ios') return { tipo, maxPixelsCanvas: 16_000_000, maxCelulas: 8_000_000 };
  if (tipo === 'movel') return { tipo, maxPixelsCanvas: 40_000_000, maxCelulas: 12_000_000 };
  return { tipo, maxPixelsCanvas: Infinity, maxCelulas: null };
}

/**
 * Maior dpi (arredondado para baixo em dezenas, mínimo 100) em que a folha cabe na área máxima de
 * imagem do aparelho; nunca acima do dpi pedido.
 */
export function dpiPermitido(dpi: number, paginaMm: { w: number; h: number }, maxPixels: number): number {
  if (!Number.isFinite(maxPixels)) return dpi;
  const teto = Math.sqrt(maxPixels / (paginaMm.w * paginaMm.h)) * 25.4;
  if (dpi <= teto) return dpi;
  return Math.max(100, Math.floor(teto / 10) * 10);
}

/**
 * Pixel (m) da grade para o aparelho: o pedido, ou o menor inteiro que deixa a grade dentro de
 * `maxCelulas` (a grade tem `celulas` células com o pixel pedido).
 */
export function pixelParaCaber(pixel: number, celulas: number, maxCelulas: number): number {
  if (!(celulas > maxCelulas)) return pixel;
  return Math.ceil(pixel * Math.sqrt(celulas / maxCelulas));
}

/** Como o raster da chuva é desenhado no canvas (src/render/raster.ts). */
export type ModoRaster = 'imagem' | 'retangulos';

/**
 * Navegador com o motor do Safari (WebKit): todos os do iPhone/iPad e o Safari do Mac. Neles o desenho
 * do raster por imagem sai corrompido (faixas fora do lugar e cores trocadas), então o raster é
 * desenhado por retângulos.
 */
export function ehWebKit(nav: NavegadorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  if (tipoDeAparelho(nav) === 'ios') return true;
  const ua = nav.userAgent ?? '';
  return /Safari\//.test(ua) && !/Chrom(e|ium)|Edg|OPR|Android/.test(ua);
}

export function modoRasterDoNavegador(nav?: NavegadorLike): ModoRaster {
  return ehWebKit(nav ?? (typeof navigator === 'undefined' ? undefined : navigator)) ? 'retangulos' : 'imagem';
}
