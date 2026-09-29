/**
 * Situação do plantio para as telas e o mapa: quem é pintado como plantado/plantando/a plantar
 * (áreas da cultura, se houver, ou os talhões base), contadores e formatação (datas do PIMS, %).
 * A estatística "área plantada" da interpolação usa, com áreas da cultura, a união das áreas plantadas
 * ou plantando (plantadosAreas, rasterizadas à parte no pipeline); sem áreas, os talhões base
 * (plantadosBase). plantadosBase também marca as linhas da tabela: um talhão base conta como
 * plantado se ele mesmo ou alguma área da cultura com o seu código está plantada ou plantando; uma
 * área sem talhão base do mesmo código (entrada sintética, ver mascaraCultura.ts) pela própria situação.
 */
import { normalizarCodigo } from './codigoTalhao';
import { ordenarTalhoes, type ColunaTalhao } from './editorRegras';
import type { AreaCultura, Plantio, PlantioPimsArquivo, PlantioPimsTalhao, StatusPlantio, Talhao, TalhaoStats } from './types';

export const STATUS_ORDEM: readonly StatusPlantio[] = ['plantado', 'plantando', 'a_plantar'];

export const ROTULO_STATUS: Record<StatusPlantio, string> = { plantado: 'Plantado', plantando: 'Plantando', a_plantar: 'A plantar' };

/** Cores das situações (mapa, legenda, chips). */
export const COR_STATUS: Record<StatusPlantio, string> = { plantado: '#DB8A08', plantando: '#F2C200', a_plantar: '#555555' };

const dois = (n: number) => String(n).padStart(2, '0');

/** ISO com hora → "dd/MM/yyyy HH:mm" (ou "dd/MM HH:mm" se `curta`) no fuso do navegador; inválida → ''. */
export function fmtDataHora(iso: string | null | undefined, curta = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const data = curta ? `${dois(d.getDate())}/${dois(d.getMonth() + 1)}` : `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
  return `${data} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** 'yyyy-mm-dd' → 'dd/mm/yyyy'; vazio → '—'. */
export function fmtDataIso(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** % da área prevista já plantada (0..100); sem dados → null. */
export function pctPlantado(areaPlantada: number | null | undefined, areaPrevista: number | null | undefined): number | null {
  if (areaPlantada === null || areaPlantada === undefined || !areaPrevista || !(areaPrevista > 0)) return null;
  return Math.max(0, Math.min(100, (areaPlantada / areaPrevista) * 100));
}

export function fmtPct(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return '—';
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/** "3 plantados · 1 plantando · 20 a plantar (PIMS 28/09 07:05)" */
export function resumoContagem(c: Record<StatusPlantio, number>, geradoEm: string | null): string {
  const texto = `${c.plantado} ${c.plantado === 1 ? 'plantado' : 'plantados'} · ${c.plantando} plantando · ${c.a_plantar} a plantar`;
  const data = fmtDataHora(geradoEm, true);
  return data ? `${texto} (PIMS ${data})` : texto;
}

/**
 * Contagem e ha plantados da página Plantio: cada talhão base pelo PIMS (código) ou, sem registro, pela
 * marcação manual (`manuais` = ids marcados; ha do talhão); mais os códigos do PIMS que só existem
 * como área da cultura (subáreas "023A"), uma vez por código.
 */
export function resumoPlantioPagina(
  talhoes: readonly Talhao[],
  areas: readonly AreaCultura[],
  pims: Map<string, PlantioPimsTalhao> | null,
  manuais: ReadonlySet<string>,
): { contagem: Record<StatusPlantio, number>; ha: number } {
  const contagem: Record<StatusPlantio, number> = { plantado: 0, plantando: 0, a_plantar: 0 };
  let ha = 0;
  const codigosBase = new Set<string>();
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    if (codigo) codigosBase.add(codigo);
    const p = codigo ? pims?.get(codigo) : undefined;
    if (p) {
      contagem[p.status]++;
      ha += p.areaPlantada || 0;
    } else if (manuais.has(t.id)) {
      contagem.plantado++;
      ha += t.areaHa || 0;
    }
  }
  const soArea = new Set(areas.map((a) => normalizarCodigo(a.codigo)).filter((c) => c && !codigosBase.has(c)));
  for (const codigo of soArea) {
    const p = pims?.get(codigo);
    if (!p) continue;
    contagem[p.status]++;
    ha += p.areaPlantada || 0;
  }
  return { contagem, ha };
}

/** Unidades do PIMS presentes no plantio.json (todas as safras), sem repetição, em ordem alfabética. */
export function unidadesDoArquivo(arq: PlantioPimsArquivo | null): string[] {
  if (!arq) return [];
  const nomes = new Set<string>();
  for (const s of arq.safras) for (const u of s.unidades) if (u.unidade.trim()) nomes.add(u.unidade.trim());
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export interface InfoSituacao {
  status: StatusPlantio;
  origem: 'pims' | 'manual';
  /** % plantado (0..100); null sem área prevista/apontada (plantio manual) */
  pct: number | null;
  /** true = linha de uma área da cultura sem talhão base do mesmo código (entrada sintética do pipeline) */
  areaCultura?: true;
}

export interface SituacaoMapa {
  /** id do talhão base (sem áreas da cultura) ou da área da cultura → situação, para o render */
  situacoes: Map<string, StatusPlantio>;
  /**
   * ids plantados ou plantando para a estatística "área plantada" da interpolação: talhões base e as
   * áreas da cultura sem talhão base do mesmo código (entradas sintéticas, ver mascaraCultura.ts)
   */
  plantadosBase: Set<string>;
  /** ids das áreas da cultura plantadas ou plantando: estatística "área plantada" quando há áreas */
  plantadosAreas: Set<string>;
  /** talhão base (ou área da cultura sem talhão base) → situação (tabela "Chuva por talhão") */
  porTalhao: Map<string, InfoSituacao>;
  /** contagem das feições pintadas (áreas da cultura ou talhões base com situação) */
  contagem: Record<StatusPlantio, number>;
  /** true = o mapa pinta as áreas da cultura em vez dos talhões base */
  usaAreas: boolean;
}

const plantou = (s: StatusPlantio | undefined) => s === 'plantado' || s === 'plantando';

/**
 * Situação do mapa. `efetivos` = plantio efetivo dos talhões base (combinarPlantios: PIMS prevalece,
 * manual nos talhões sem PIMS). Com áreas da cultura, cada área recebe a situação do PIMS pelo código;
 * sem registro no PIMS, a do talhão base com o mesmo código (plantio manual); senão, "a plantar".
 */
export function situacaoDoMapa(
  talhoes: Talhao[],
  areas: AreaCultura[],
  efetivos: Plantio[],
  pims: Map<string, PlantioPimsTalhao> | null = null,
): SituacaoMapa {
  const idsBase = new Set(talhoes.map((t) => t.id));
  const porTalhao = new Map<string, InfoSituacao>();
  for (const p of efetivos) {
    if (!idsBase.has(p.talhaoId)) continue;
    porTalhao.set(p.talhaoId, { status: p.status, origem: p.origem, pct: pctPlantado(p.areaPlantada, p.areaPrevista) });
  }
  const contagem: Record<StatusPlantio, number> = { plantado: 0, plantando: 0, a_plantar: 0 };
  const situacoes = new Map<string, StatusPlantio>();
  const plantadosBase = new Set<string>();
  const plantadosAreas = new Set<string>();
  for (const t of talhoes) if (plantou(porTalhao.get(t.id)?.status)) plantadosBase.add(t.id);

  if (areas.length === 0) {
    for (const t of talhoes) {
      const info = porTalhao.get(t.id);
      if (!info) continue;
      situacoes.set(t.id, info.status);
      contagem[info.status]++;
    }
    return { situacoes, plantadosBase, plantadosAreas, porTalhao, contagem, usaAreas: false };
  }

  const codigosBase = new Set(talhoes.map((t) => normalizarCodigo(t.codigo)).filter(Boolean));
  const statusBasePorCodigo = new Map<string, StatusPlantio>();
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    const info = porTalhao.get(t.id);
    if (codigo && info && !statusBasePorCodigo.has(codigo)) statusBasePorCodigo.set(codigo, info.status);
  }
  const codigosPlantados = new Set<string>();
  for (const a of areas) {
    const codigo = normalizarCodigo(a.codigo);
    const status = (codigo && (pims?.get(codigo)?.status ?? statusBasePorCodigo.get(codigo))) || 'a_plantar';
    situacoes.set(a.id, status);
    contagem[status]++;
    if (plantou(status)) plantadosAreas.add(a.id);
    if (codigo && plantou(status)) codigosPlantados.add(codigo);
    if (!codigo || !codigosBase.has(codigo)) {
      // área sem talhão base: entra no pipeline como entrada própria (id da área)
      const registro = codigo ? pims?.get(codigo) : undefined;
      porTalhao.set(a.id, {
        status,
        origem: registro ? 'pims' : 'manual',
        pct: registro ? pctPlantado(registro.areaPlantada, registro.areaPrevista) : null,
        areaCultura: true,
      });
      if (plantou(status)) plantadosBase.add(a.id);
    }
  }
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    if (codigo && codigosPlantados.has(codigo)) plantadosBase.add(t.id);
  }
  return { situacoes, plantadosBase, plantadosAreas, porTalhao, contagem, usaAreas: true };
}

export type ColunaSituacao = ColunaTalhao | 'situacao' | 'pct';

/**
 * Ordena a tabela "Chuva por talhão" incluindo as colunas Situação (plantado, plantando, a plantar,
 * sem situação) e % plantado (sem valor sempre no fim). Demais colunas: ordenarTalhoes.
 */
export function ordenarComSituacao(
  linhas: TalhaoStats[],
  coluna: ColunaSituacao,
  asc: boolean,
  info: Map<string, Pick<InfoSituacao, 'status' | 'pct'>>,
): TalhaoStats[] {
  if (coluna !== 'situacao' && coluna !== 'pct') return ordenarTalhoes(linhas, coluna, asc);
  const sentido = asc ? 1 : -1;
  if (coluna === 'situacao') {
    const rank = (l: TalhaoStats) => {
      const s = info.get(l.talhaoId)?.status;
      return s ? STATUS_ORDEM.indexOf(s) : STATUS_ORDEM.length;
    };
    return [...linhas].sort((a, b) => sentido * (rank(a) - rank(b)));
  }
  const pct = (l: TalhaoStats) => info.get(l.talhaoId)?.pct ?? null;
  return [...linhas].sort((a, b) => {
    const pa = pct(a);
    const pb = pct(b);
    if (pa === null || pb === null) return Number(pa === null) - Number(pb === null);
    return sentido * (pa - pb);
  });
}
