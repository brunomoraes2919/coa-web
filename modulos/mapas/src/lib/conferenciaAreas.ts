/**
 * Conferência dos códigos das áreas da cultura (página "Áreas da cultura"). O que importa para o mapa é o PIMS:
 * a área é casada com o plantio do PIMS da safra pelo código (casarPlantio), exista ou não no shape da fazenda
 * (talhões base). Código fora do PIMS fica "a plantar" e "Sem variedade"; fora só do shape da fazenda (ex.: a
 * divisão 068A de um talhão 068) é casado normalmente, e no mapa o rótulo é o do talhão base.
 */
import { normalizarCodigo } from './codigoTalhao';
import type { AreaCultura, PlantioPimsTalhao, Talhao } from './types';

export interface ConferenciaAreas {
  /** áreas sem código: ficam sempre "a plantar" */
  semCodigo: number;
  /** códigos das áreas que não existem no PIMS da safra; null = sem plantio do PIMS da safra para comparar */
  foraDoPims: string[] | null;
  /** códigos que não estão no shape da fazenda e não foram acusados acima (estão no PIMS, ou não há PIMS) */
  soForaDaBase: string[];
}

/** `pims` = registros do PIMS da safra e da fazenda por código normalizado (casarPlantio().porCodigo); null = sem PIMS. */
export function conferirAreas(areas: AreaCultura[], talhoes: Talhao[], pims: Map<string, PlantioPimsTalhao> | null): ConferenciaAreas {
  const base = new Set(talhoes.map((t) => normalizarCodigo(t.codigo)).filter(Boolean));
  const codigos = [...new Set(areas.map((a) => normalizarCodigo(a.codigo)).filter(Boolean))];
  const foraDoPims = pims ? codigos.filter((c) => !pims.has(c)) : null;
  const acusados = new Set(foraDoPims ?? []);
  return {
    semCodigo: areas.filter((a) => !normalizarCodigo(a.codigo)).length,
    foraDoPims,
    soForaDaBase: codigos.filter((c) => !base.has(c) && !acusados.has(c)),
  };
}
