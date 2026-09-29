import type { Estat } from './types';

const VAZIA: Estat = { media: NaN, min: NaN, max: NaN, areaHa: 0 };

/**
 * Estatísticas por zona (média das células, mínimo, máximo e área em ha). Só contam células com valor
 * (não NaN) e índice de zona em [0, nZonas). Zona sem célula válida → NaN/NaN/NaN e área 0.
 */
export function statsZonas(values: Float32Array, zonas: Int32Array, nZonas: number, areaCelulaM2: number): Estat[] {
  const soma = new Float64Array(nZonas);
  const cont = new Float64Array(nZonas);
  const min = new Float64Array(nZonas).fill(Infinity);
  const max = new Float64Array(nZonas).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const z = zonas[i];
    if (z < 0 || z >= nZonas) continue;
    const v = values[i];
    if (v !== v) continue; // NaN
    soma[z] += v;
    cont[z]++;
    if (v < min[z]) min[z] = v;
    if (v > max[z]) max[z] = v;
  }
  const out: Estat[] = [];
  for (let z = 0; z < nZonas; z++) {
    out.push(
      cont[z] === 0
        ? { ...VAZIA }
        : { media: soma[z] / cont[z], min: min[z], max: max[z], areaHa: (cont[z] * areaCelulaM2) / 10000 },
    );
  }
  return out;
}

/** Estatísticas das células com `incluir(i)` verdadeiro e valor não NaN. Nenhuma → NaN/NaN/NaN e área 0. */
export function statsMascara(values: Float32Array, incluir: (i: number) => boolean, areaCelulaM2: number): Estat {
  let soma = 0;
  let cont = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== v || !incluir(i)) continue;
    soma += v;
    cont++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (cont === 0) return { ...VAZIA };
  return { media: soma / cont, min, max, areaHa: (cont * areaCelulaM2) / 10000 };
}
