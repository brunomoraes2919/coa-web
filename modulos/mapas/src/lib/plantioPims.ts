/**
 * Plantio automático do PIMS: leitura de public/dados/plantio.json (modo local; gerado por
 * scripts/sincronizar-plantio.mjs) ou montagem a partir das linhas de mapas_plantio_pims (Supabase),
 * e casamento com os talhões/áreas da cultura pelo par (fazenda.unidadePims, código normalizado).
 */
import { normalizarCodigo } from './codigoTalhao';
import type {
  AreaCultura,
  Fazenda,
  LinhaPlantioPims,
  Plantio,
  PlantioPimsArquivo,
  PlantioPimsTalhao,
  Safra,
  StatusPlantio,
  Talhao,
} from './types';

const URL_PLANTIO = './dados/plantio.json';
/** Mesma fonte que scripts/sincronizar-plantio.mjs grava no plantio.json. */
const FONTE_PIMS = 'PIMS via Agrovex';

/** Nome de safra/unidade para comparação: maiúsculas, sem acento, sem espaços nas pontas e repetidos. */
function chaveNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const STATUS: readonly StatusPlantio[] = ['plantado', 'plantando', 'a_plantar'];

/**
 * Completa um plantio lido do banco/backup: registros antigos não têm os campos novos e valem como
 * plantio manual de talhão plantado.
 */
export function completarPlantio(p: Plantio): Plantio {
  const o = p as Partial<Plantio> & Pick<Plantio, 'safraId' | 'talhaoId'>;
  return {
    safraId: o.safraId,
    talhaoId: o.talhaoId,
    dataPlantio: o.dataPlantio ?? null,
    origem: o.origem === 'pims' ? 'pims' : 'manual',
    status: o.status && STATUS.includes(o.status) ? o.status : 'plantado',
    areaPrevista: o.areaPrevista ?? null,
    areaPlantada: o.areaPlantada ?? null,
    inicio: o.inicio ?? null,
    fim: o.fim ?? null,
    variedade: o.variedade ?? null,
  };
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pareceTalhao(v: unknown): v is PlantioPimsTalhao {
  return ehObjeto(v) && typeof v.codigo === 'string' && STATUS.includes(v.status as StatusPlantio);
}

function pareceUnidade(v: unknown): boolean {
  return ehObjeto(v) && typeof v.unidade === 'string' && Array.isArray(v.talhoes) && v.talhoes.every(pareceTalhao);
}

function pareceSafra(v: unknown): boolean {
  return ehObjeto(v) && typeof v.nome === 'string' && Array.isArray(v.unidades) && v.unidades.every(pareceUnidade);
}

/** Valida a estrutura usada pelo app (safras → unidades → talhões com código e status válidos). */
function pareceArquivo(v: unknown): v is PlantioPimsArquivo {
  return ehObjeto(v) && v.versao === 1 && Array.isArray(v.safras) && v.safras.every(pareceSafra);
}

/** GET ./dados/plantio.json (sem cache). Ausente (404), sem rede ou inválido → null (o app segue com o plantio manual). */
export async function carregarPlantioPims(fetchImpl: typeof fetch = (u, i) => fetch(u, i)): Promise<PlantioPimsArquivo | null> {
  try {
    const resp = await fetchImpl(URL_PLANTIO, { cache: 'no-cache' });
    if (!resp.ok) return null;
    const dados: unknown = await resp.json();
    return pareceArquivo(dados) ? dados : null;
  } catch {
    return null;
  }
}

const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

/**
 * Monta o plantio do PIMS (mesmo formato do plantio.json) a partir das linhas de mapas_plantio_pims
 * (uma por safra × unidade; o RLS já deixou só as unidades visíveis ao usuário). Sem linhas → null.
 * Safras agrupadas pelo nome e unidades em ordem alfabética; geradoEm = a linha mais recente (ISO);
 * talhões que não passam na validação do plantio.json são descartados.
 */
export function montarPlantioPims(linhas: LinhaPlantioPims[]): PlantioPimsArquivo | null {
  if (!linhas.length) return null;
  const safras = new Map<string, Map<string, PlantioPimsTalhao[]>>();
  let maisRecente = -Infinity;
  for (const l of linhas) {
    const ms = Date.parse(l.geradoEm);
    if (ms > maisRecente) maisRecente = ms;
    const unidades = safras.get(l.safra) ?? new Map<string, PlantioPimsTalhao[]>();
    safras.set(l.safra, unidades);
    const validos = (Array.isArray(l.talhoes) ? l.talhoes : []).filter(pareceTalhao);
    unidades.set(l.unidade, [...(unidades.get(l.unidade) ?? []), ...validos]);
  }
  return {
    versao: 1,
    geradoEm: Number.isFinite(maisRecente) ? new Date(maisRecente).toISOString() : linhas[0].geradoEm,
    fonte: FONTE_PIMS,
    safras: [...safras.entries()]
      .sort(([a], [b]) => porNome(a, b))
      .map(([nome, unidades]) => ({
        nome,
        unidades: [...unidades.entries()].sort(([a], [b]) => porNome(a, b)).map(([unidade, talhoes]) => ({ unidade, talhoes })),
      })),
  };
}

export interface PlantioCasado {
  /** código normalizado → registro do PIMS (todos os talhões da unidade na safra) */
  porCodigo: Map<string, PlantioPimsTalhao>;
  /** plantados/plantando no PIMS cujo código não existe nos talhões nem nas áreas da cultura */
  semPoligono: PlantioPimsTalhao[];
  geradoEm: string;
}

/**
 * Casa o plantio do PIMS da safra (`safra.nomePims ?? safra.nome`) e da unidade (`fazenda.unidadePims`)
 * com os códigos dos talhões e das áreas da cultura. Sem unidade, safra ou unidade no arquivo → null.
 * Código repetido no PIMS (ex.: '9999' administrativo em vários setores): vale o primeiro.
 */
export function casarPlantio(
  arq: PlantioPimsArquivo,
  safra: Safra,
  fazenda: Fazenda,
  talhoes: Talhao[],
  areas: AreaCultura[],
): PlantioCasado | null {
  if (!fazenda.unidadePims) return null;
  const nomeSafra = chaveNome(safra.nomePims ?? safra.nome);
  const safraPims = arq.safras.find((s) => chaveNome(s.nome) === nomeSafra);
  if (!safraPims) return null;
  const unidade = chaveNome(fazenda.unidadePims);
  const unidadePims = safraPims.unidades.find((u) => chaveNome(u.unidade) === unidade);
  if (!unidadePims) return null;

  const porCodigo = new Map<string, PlantioPimsTalhao>();
  for (const t of unidadePims.talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    if (codigo !== '' && !porCodigo.has(codigo)) porCodigo.set(codigo, t);
  }
  const existentes = new Set<string>();
  for (const t of talhoes) existentes.add(normalizarCodigo(t.codigo));
  for (const a of areas) existentes.add(normalizarCodigo(a.codigo));
  existentes.delete('');
  const semPoligono = [...porCodigo.entries()]
    .filter(([codigo, t]) => t.status !== 'a_plantar' && !existentes.has(codigo))
    .map(([, t]) => t);
  return { porCodigo, semPoligono, geradoEm: arq.geradoEm };
}

function plantioDoPims(safraId: string, talhaoId: string, t: PlantioPimsTalhao): Plantio {
  const dataPlantio = t.status === 'plantado' ? (t.fim ?? t.inicio) : t.status === 'plantando' ? t.inicio : null;
  return {
    safraId,
    talhaoId,
    dataPlantio,
    origem: 'pims',
    status: t.status,
    areaPrevista: t.areaPrevista,
    areaPlantada: t.areaPlantada,
    inicio: t.inicio,
    fim: t.fim,
    variedade: t.variedade,
  };
}

/**
 * Plantio efetivo dos talhões informados (na ordem deles): o PIMS prevalece; o plantio manual só
 * permanece nos talhões sem registro no PIMS. Plantios manuais de talhões fora da lista são ignorados.
 * `safraId` (a safra em exibição) vai em todos os registros devolvidos, do PIMS e manuais.
 */
export function combinarPlantios(
  pims: Map<string, PlantioPimsTalhao> | null,
  manuais: Plantio[],
  talhoes: Talhao[],
  safraId: string,
): Plantio[] {
  const manualPorTalhao = new Map(manuais.map((p) => [p.talhaoId, p]));
  const saida: Plantio[] = [];
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    const doPims = codigo !== '' ? pims?.get(codigo) : undefined;
    if (doPims) {
      saida.push(plantioDoPims(safraId, t.id, doPims));
      continue;
    }
    const manual = manualPorTalhao.get(t.id);
    if (manual) saida.push(completarPlantio({ ...manual, safraId }));
  }
  return saida;
}
