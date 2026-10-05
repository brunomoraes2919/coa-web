import { paginaDe, renderLayout, type RenderInput } from '../render';
import { dpiPermitido, limitesDoAparelho } from './aparelho';
import { DPI_HISTORICO, QUALIDADE_JPEG_HISTORICO, tamanhoMiniatura } from './historico';
import { definirDpiPng } from './pngDpi';

export const DPI_OPCOES = [150, 300, 600] as const;
export const DPI_PADRAO = 300;

export interface Renderizado {
  canvas: HTMLCanvasElement;
  avisos: string[];
}

/** Libera a memória de um canvas que não será mais usado (canvases grandes pesam centenas de MB). */
export function liberarCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (c) c.width = c.height = 0;
}

function novoCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    liberarCanvas(canvas);
    throw new Error('Não foi possível criar a imagem (canvas indisponível)');
  }
  return { canvas, ctx };
}

/**
 * Desenha a página inteira num canvas novo, com pxPorMm pixels por milímetro. O tamanho vem da
 * composição (`paginaDe`): A3/A4 em paisagem ou retrato conforme a forma da fazenda.
 */
export async function renderizarPagina(inp: RenderInput, pxPorMm: number): Promise<Renderizado> {
  const { w, h } = paginaDe(inp);
  const { canvas, ctx } = novoCanvas(w * pxPorMm, h * pxPorMm);
  try {
    const { avisos } = await renderLayout(ctx, inp, pxPorMm);
    return { canvas, avisos };
  } catch (e) {
    liberarCanvas(canvas);
    throw e;
  }
}

function paraBlob(canvas: HTMLCanvasElement, tipo = 'image/png', qualidade?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem'))), tipo, qualidade),
  );
}

/** Cópia reduzida para `largura`×`altura` px, em reduções sucessivas pela metade (sem serrilhar textos e linhas). */
function reduzirCanvas(origem: HTMLCanvasElement, largura: number, altura: number): HTMLCanvasElement {
  let atual = origem;
  try {
    while (atual.width > largura * 2 && atual.height > altura * 2) {
      const { canvas, ctx } = novoCanvas(atual.width / 2, atual.height / 2);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(atual, 0, 0, canvas.width, canvas.height);
      if (atual !== origem) liberarCanvas(atual);
      atual = canvas;
    }
    const { canvas, ctx } = novoCanvas(largura, altura);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(atual, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if (atual !== origem) liberarCanvas(atual);
  }
}

/**
 * PNG em alta definição (150, 300 ou 600 dpi). No celular/tablet o dpi é o maior que o aparelho consegue
 * desenhar (o iPhone não passa de ~16,7 milhões de pixels por imagem): `dpi` devolve o que foi usado.
 */
export async function gerarPng(
  inp: RenderInput,
  dpiPedido: number = DPI_PADRAO,
  maxPixels: number = limitesDoAparelho().maxPixelsCanvas,
): Promise<{ blob: Blob; avisos: string[]; dpi: number }> {
  const dpi = dpiPermitido(dpiPedido, paginaDe(inp), maxPixels);
  const { canvas, avisos } = await renderizarPagina(inp, dpi / 25.4);
  try {
    const blob = await definirDpiPng(await paraBlob(canvas), dpi);
    return {
      blob,
      dpi,
      avisos: dpi < dpiPedido ? [...avisos, `Neste aparelho o PNG saiu em ${dpi} dpi (o máximo que ele consegue gerar); no computador sai em ${dpiPedido} dpi.`] : avisos,
    };
  } finally {
    liberarCanvas(canvas);
  }
}

/**
 * Arquivos do histórico a partir da página já desenhada: a cópia em JPEG (qualidade
 * QUALIDADE_JPEG_HISTORICO, ≈ 4× menor que o PNG) e a miniatura PNG (lado maior de 480 px, em
 * paisagem ou retrato), reduzida do mesmo canvas. Não libera `pagina` (é de quem chamou).
 */
export async function codificarCopiaHistorico(pagina: HTMLCanvasElement): Promise<{ imagem: Blob; miniatura: Blob }> {
  const t = tamanhoMiniatura({ w: pagina.width, h: pagina.height });
  const mini = reduzirCanvas(pagina, t.w, t.h);
  try {
    const [imagem, miniatura] = await Promise.all([paraBlob(pagina, 'image/jpeg', QUALIDADE_JPEG_HISTORICO), paraBlob(mini)]);
    return { imagem, miniatura };
  } finally {
    liberarCanvas(mini);
  }
}

/**
 * Cópia do histórico (JPEG no dpi do histórico) e miniatura PNG, com um único desenho da página (a
 * miniatura é reduzida do desenho grande, sem baixar os tiles de novo). O download pelo editor
 * continua sendo o PNG de gerarPng, no dpi escolhido.
 */
export async function gerarCopiaHistorico(
  inp: RenderInput,
  dpi: number = DPI_HISTORICO,
): Promise<{ imagem: Blob; miniatura: Blob; avisos: string[] }> {
  const { canvas, avisos } = await renderizarPagina(inp, dpi / 25.4);
  try {
    return { ...(await codificarCopiaHistorico(canvas)), avisos };
  } finally {
    liberarCanvas(canvas);
  }
}

export function baixarArquivo(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Baixa o arquivo de uma URL com o nome escolhido (ou calculado pelo conteúdo, ex.: a extensão pelo
 * tipo do blob). Busca o conteúdo antes: numa URL de outro domínio (signed URL do Supabase) o
 * navegador ignora o atributo `download` e abriria a imagem em vez de salvar.
 */
export async function baixarDeUrl(url: string, nome: string | ((blob: Blob) => string)): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`arquivo indisponível (erro ${resp.status})`);
  const blob = await resp.blob();
  baixarArquivo(blob, typeof nome === 'function' ? nome(blob) : nome);
}

/** "MAPA_CHUVA_GUAPIRAMA_01-02-2025_a_15-02-2025.png" */
export function nomeArquivoMapa(fazenda: string, periodo: string, ext = 'png'): string {
  const limpo = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\//g, '-')
      .replace(/[^A-Za-z0-9-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  const partes = ['MAPA_CHUVA', limpo(fazenda), limpo(periodo)].filter(Boolean);
  return `${partes.join('_')}.${ext}`;
}
