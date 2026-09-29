import { paginaDe, renderLayout, type RenderInput } from '../render';
import { tamanhoMiniatura } from './historico';
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

function paraBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem'))), 'image/png'),
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

/** PNG em alta definição (150, 300 ou 600 dpi). */
export async function gerarPng(inp: RenderInput, dpi: number = DPI_PADRAO): Promise<{ blob: Blob; avisos: string[] }> {
  const { canvas, avisos } = await renderizarPagina(inp, dpi / 25.4);
  try {
    const blob = await definirDpiPng(await paraBlob(canvas), dpi);
    return { blob, avisos };
  } finally {
    liberarCanvas(canvas);
  }
}

/**
 * PNG em alta definição e miniatura PNG para o histórico (lado maior de 480 px, em paisagem ou retrato),
 * com um único desenho da página (a miniatura é reduzida do PNG grande, sem baixar os tiles de novo).
 */
export async function gerarPngEMiniatura(
  inp: RenderInput,
  dpi: number = DPI_PADRAO,
): Promise<{ png: Blob; miniatura: Blob; avisos: string[] }> {
  const { canvas, avisos } = await renderizarPagina(inp, dpi / 25.4);
  let mini: HTMLCanvasElement | null = null;
  try {
    const t = tamanhoMiniatura({ w: canvas.width, h: canvas.height });
    mini = reduzirCanvas(canvas, t.w, t.h);
    const [bruto, miniatura] = await Promise.all([paraBlob(canvas), paraBlob(mini)]);
    return { png: await definirDpiPng(bruto, dpi), miniatura, avisos };
  } finally {
    liberarCanvas(canvas);
    liberarCanvas(mini);
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
 * Baixa o arquivo de uma URL com o nome escolhido. Busca o conteúdo antes: numa URL de outro domínio
 * (signed URL do Supabase) o navegador ignora o atributo `download` e abriria a imagem em vez de salvar.
 */
export async function baixarDeUrl(url: string, nome: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`arquivo indisponível (erro ${resp.status})`);
  baixarArquivo(await resp.blob(), nome);
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
