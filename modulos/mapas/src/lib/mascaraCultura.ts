/**
 * Áreas da cultura no mapa de chuva: a máscara da interpolação é talhões base ∪ áreas da cultura.
 * Cada área sem talhão base do mesmo código vira uma entrada "sintética" do pipeline (id = id da área,
 * nome = código, setor = o do talhão base que a contém), para aparecer na tabela; o pipeline dá a ela
 * as estatísticas da própria área (segunda rasterização, ver pipeline.ts), e as dos talhões reais não
 * mudam. O setor de uma área é o do talhão base que a contém (areasEspacial.ts), não o nome do PIMS.
 */
import { vincularAreas } from './areasEspacial';
import { normalizarCodigo } from './codigoTalhao';
import type { AreaCultura, PlantioPimsTalhao, Talhao } from './types';

const MARCA = 'areaCultura';

function codigosDe(talhoes: readonly Talhao[]): Set<string> {
  const s = new Set<string>();
  for (const t of talhoes) {
    const c = normalizarCodigo(t.codigo);
    if (c) s.add(c);
  }
  return s;
}

const chave = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim();

/** true = entrada criada por talhoesParaInterpolacao a partir de uma área da cultura. */
export function ehAreaSintetica(t: Pick<Talhao, 'atributos'>): boolean {
  return t.atributos?.[MARCA] === true;
}

/**
 * Talhões do pipeline: uma entrada por área da cultura sem talhão base do mesmo código (código vazio
 * também), seguida dos talhões base. As áreas vêm ANTES: na rasterização a última zona prevalece, então
 * onde uma área se sobrepõe a um talhão base a célula continua com o talhão base.
 */
export function talhoesParaInterpolacao(talhoes: Talhao[], areas: readonly AreaCultura[]): Talhao[] {
  if (!areas.length) return talhoes;
  const base = codigosDe(talhoes);
  const semBase = areas.filter((a) => {
    const codigo = normalizarCodigo(a.codigo);
    return !codigo || !base.has(codigo);
  });
  const vinculo = vincularAreas(semBase, talhoes);
  const extras: Talhao[] = [];
  for (const a of semBase) {
    const codigo = normalizarCodigo(a.codigo);
    extras.push({
      id: a.id,
      fazendaId: a.fazendaId,
      nome: codigo || 'Área da cultura',
      setor: vinculo.get(a.id)?.setor ?? null,
      areaHa: a.areaHa,
      geom: a.geom,
      atributos: { [MARCA]: true },
      codigo: codigo || null,
    });
  }
  return extras.length ? [...extras, ...talhoes] : talhoes;
}

/**
 * Áreas da cultura dentro dos setores escolhidos (null = todas): as que ficam dentro de um talhão
 * usado (vínculo espacial: o talhão base que contém a área, qualquer que seja o código dela) e, para
 * as sem talhão base, as cujo setor no PIMS está no filtro (sem diferenciar acentos).
 */
export function filtrarAreasPorSetor(
  areas: AreaCultura[],
  talhoesUsados: readonly Talhao[],
  todos: readonly Talhao[],
  setores: string[] | null,
  pims: Map<string, PlantioPimsTalhao> | null,
): AreaCultura[] {
  if (!setores || !setores.length) return areas;
  const usados = new Set(talhoesUsados.map((t) => t.id));
  const vinculo = vincularAreas(areas, todos);
  const filtro = new Set(setores.map(chave));
  return areas.filter((a) => {
    const base = vinculo.get(a.id);
    if (base) return usados.has(base.id);
    const codigo = normalizarCodigo(a.codigo);
    const setorPims = codigo ? pims?.get(codigo)?.setor : null;
    return !!setorPims && filtro.has(chave(setorPims));
  });
}

/**
 * Com áreas da cultura: plantados/plantando no PIMS que têm talhão base mas nenhuma área da cultura
 * com o código (o mapa pinta só as áreas, então esses não apareceriam como plantados).
 */
export function plantadosSemArea(
  pims: Map<string, PlantioPimsTalhao> | null,
  talhoes: readonly Talhao[],
  areas: readonly AreaCultura[],
): PlantioPimsTalhao[] {
  if (!pims || !areas.length) return [];
  const base = codigosDe(talhoes);
  const comArea = new Set(areas.map((a) => normalizarCodigo(a.codigo)).filter(Boolean));
  return [...pims.entries()].filter(([c, t]) => t.status !== 'a_plantar' && base.has(c) && !comArea.has(c)).map(([, t]) => t);
}
