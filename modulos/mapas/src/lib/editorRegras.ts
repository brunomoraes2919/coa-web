/** Regras puras dos componentes do editor (ordenação da tabela, textos editados, parâmetros, prévia e zoom). */
import type { IdwParams, LayoutTextos, MapExtent, TalhaoStats } from './types';

export type ColunaTalhao = 'nome' | 'setor' | 'plantado' | 'areaHa' | 'media' | 'min' | 'max';

/** Comparação crescente; talhão sem valor (NaN) é tratado à parte em ordenarTalhoes. */
function comparar(a: TalhaoStats, b: TalhaoStats, c: ColunaTalhao): number {
  const va = a[c];
  const vb = b[c];
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  if (typeof va === 'boolean') return Number(va) - Number(vb);
  return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR', { numeric: true });
}

const semValor = (t: TalhaoStats, c: ColunaTalhao) => {
  const v = t[c];
  return typeof v === 'number' && Number.isNaN(v);
};

/** Linhas da tabela "Chuva por talhão" ordenadas pela coluna; talhões sem valor ficam sempre no fim. */
export function ordenarTalhoes(linhas: TalhaoStats[], coluna: ColunaTalhao, asc: boolean): TalhaoStats[] {
  const sentido = asc ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const na = semValor(a, coluna);
    const nb = semValor(b, coluna);
    if (na || nb) return Number(na) - Number(nb);
    return sentido * comparar(a, b, coluna);
  });
}

/**
 * Novo objeto de textos editados após o usuário alterar `campo` para `valor`.
 * Voltar ao valor automático deixa o campo de ser "editado" (volta a acompanhar os dados).
 */
export function editarTexto(
  editados: Partial<LayoutTextos>,
  automaticos: LayoutTextos,
  campo: keyof LayoutTextos,
  valor: string,
): Partial<LayoutTextos> {
  if (valor !== automaticos[campo]) return { ...editados, [campo]: valor };
  const resto = { ...editados };
  delete resto[campo];
  return resto;
}

export const LIMITES_IDW: Record<keyof IdwParams, { min: number; max: number; passo: number; inteiro?: boolean }> = {
  potencia: { min: 1, max: 8, passo: 0.5 },
  vizinhos: { min: 1, max: 50, passo: 1, inteiro: true },
  pixel: { min: 1, max: 50, passo: 1 },
  buffer: { min: 0, max: 200, passo: 5 },
};

/** Valor digitado em "Avançado" pode ser usado no parâmetro? (vizinhos só inteiro, como exige o pipeline) */
export function parametroIdwValido(campo: keyof IdwParams, v: number): boolean {
  const l = LIMITES_IDW[campo];
  return Number.isFinite(v) && v >= l.min && v <= l.max && (!l.inteiro || Number.isInteger(v));
}

/**
 * Texto digitado em "Avançado" → valor do parâmetro (vírgula ou ponto decimal), ou null se ainda não
 * é um valor válido (vazio, incompleto como "2," ou fora dos limites). O campo guarda o texto à parte,
 * então um null não trava a digitação: só não é aplicado.
 */
export function lerParametroIdw(campo: keyof IdwParams, texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return parametroIdwValido(campo, v) ? v : null;
}

export const ZOOM_MIN_M_POR_MM = 0.5;
export const ZOOM_MAX_M_POR_MM = 2000;

/**
 * Nova escala (metros por mm do papel) após aplicar o fator do zoom, limitada a 0,5–2000 m/mm.
 * Se a escala atual já está fora dos limites, o zoom nunca salta nem inverte o sentido pedido.
 */
export function limitarZoom(atual: number, fator: number): number {
  const min = Math.min(ZOOM_MIN_M_POR_MM, atual);
  const max = Math.max(ZOOM_MAX_M_POR_MM, atual);
  return Math.min(max, Math.max(min, atual * fator));
}

/** Altura da prévia (px CSS) para a largura dada, na proporção da folha real (`paginaDe(inp)`, mm). */
export function alturaPrevia(largura: number, pagina: { w: number; h: number }): number {
  return (largura * pagina.h) / pagina.w;
}

/**
 * Largura exibida da prévia: a da caixa, reduzida para a altura não passar de `alturaMax` (px CSS) —
 * uma folha em retrato na largura toda da coluna ficaria alta demais. `alturaMax` ≤ 0 = sem limite.
 */
export function larguraPrevia(larguraCaixa: number, pagina: { w: number; h: number }, alturaMax: number): number {
  if (!(alturaMax > 0)) return larguraCaixa;
  return Math.min(larguraCaixa, Math.floor((alturaMax * pagina.w) / pagina.h));
}

/** Arrastar/aproximar na prévia só com um quadro; com vários, cada quadro se enquadra sozinho. */
export function panZoomPermitido(comp: { quadros: readonly unknown[] }): boolean {
  return comp.quadros.length === 1;
}

export interface ControlesPrevia {
  /** arraste e roda do mouse mexem no enquadramento (e a roda deixa de rolar a página) */
  interativa: boolean;
  /** cadeado e Centralizar aparecem (só com um quadro) */
  botoes: boolean;
  /** Centralizar habilitado: o enquadramento foi mexido (não é o automático) */
  centralizar: boolean;
  /** texto sob a prévia */
  dica: string;
}

const MESMO_DESENHO = 'A prévia é o mesmo desenho do PNG.';

/**
 * Controles da prévia: `panZoom` (um quadro), `travado` (cadeado fechado, o padrão ao abrir o editor) e
 * `automatico` (extent null = enquadramento automático). Travada, a prévia ignora arraste e roda.
 */
export function controlesPrevia(panZoom: boolean, travado: boolean, automatico: boolean): ControlesPrevia {
  if (!panZoom) {
    return { interativa: false, botoes: false, centralizar: false, dica: `Com vários quadros o enquadramento é automático. ${MESMO_DESENHO}` };
  }
  const dica = travado
    ? `Mapa travado. Clique no cadeado para mover e aproximar. ${MESMO_DESENHO}`
    : `Arraste o mapa para mover e use a roda do mouse para aproximar. ${MESMO_DESENHO}`;
  return { interativa: !travado, botoes: true, centralizar: !automatico, dica };
}

/**
 * Retângulo `rect` (mm do desenho A3) em pixels CSS de uma prévia com `larguraCss` px de largura, para
 * um desenho de `desenhoW` mm de largura (420 em paisagem, 297 em retrato). `k` = px CSS por mm do desenho.
 */
export function quadroEmCss(
  rect: { x: number; y: number; w: number; h: number },
  larguraCss: number,
  desenhoW: number,
): { x: number; y: number; w: number; h: number; k: number } {
  const k = larguraCss / desenhoW;
  return { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k, k };
}

/** Enquadramento após arrastar o mapa `dxMm`/`dyMm` (mm do desenho, y para baixo). */
export function arrastarExtent(base: MapExtent, dxMm: number, dyMm: number): MapExtent {
  return { ...base, cx: base.cx - dxMm * base.mPorMm, cy: base.cy + dyMm * base.mPorMm };
}

/**
 * Zoom pela roda mantendo fixo o ponto sob o cursor. `mmX`/`mmY` = distância do cursor ao centro do
 * retângulo do quadro (mm do desenho, y para baixo). Devolve null se o zoom já está no limite.
 */
export function zoomNoPonto(base: MapExtent, mmX: number, mmY: number, fator: number): MapExtent | null {
  const m = limitarZoom(base.mPorMm, fator);
  if (m === base.mPorMm) return null;
  const mx = base.cx + mmX * base.mPorMm;
  const my = base.cy - mmY * base.mPorMm;
  return { cx: mx - mmX * m, cy: my + mmY * m, mPorMm: m };
}
