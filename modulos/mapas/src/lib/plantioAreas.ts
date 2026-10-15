/**
 * "Ver plantio" de uma safra com áreas da cultura: o mapa e a lista mostram as áreas (o mesmo limite dos mapas de
 * chuva e de variedade), não o shape da fazenda. Cada área vira uma linha no formato de talhão; a marcação manual
 * (tabela mapas_plantios, por talhão) vai para o talhão do shape da fazenda com o mesmo código — a regra de
 * situacaoDoMapa. Divisão que só existe nas áreas (ex.: 068A) não tem marcação manual: vale o PIMS.
 */
import { normalizarCodigo } from './codigoTalhao';
import type { AreaCultura, Talhao } from './types';

export const SEM_CODIGO = '(sem código)';

export interface LinhasDasAreas {
  /** uma linha por área, pela ordem do código (sem código por último) */
  linhas: Talhao[];
  /** id da linha (área) → id do talhão do shape da fazenda com o mesmo código (para a marcação manual) */
  baseDe: Map<string, string>;
}

export function linhasDasAreas(areas: AreaCultura[], talhoes: Talhao[]): LinhasDasAreas {
  const basePorCodigo = new Map<string, Talhao>();
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    if (codigo && !basePorCodigo.has(codigo)) basePorCodigo.set(codigo, t);
  }
  const baseDe = new Map<string, string>();
  const linhas = areas.map((a): Talhao => {
    const codigo = normalizarCodigo(a.codigo);
    const base = codigo ? basePorCodigo.get(codigo) : undefined;
    if (base) baseDe.set(a.id, base.id);
    return { id: a.id, fazendaId: a.fazendaId, nome: codigo || SEM_CODIGO, setor: base?.setor ?? null, areaHa: a.areaHa, geom: a.geom, atributos: {}, codigo: codigo || null };
  });
  linhas.sort((x, y) => Number(!x.codigo) - Number(!y.codigo) || x.nome.localeCompare(y.nome, 'pt-BR', { numeric: true }));
  return { linhas, baseDe };
}
