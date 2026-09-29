import type { Palette } from './types';
import dados from './palettes.data.json';

/** Paletas extraídas dos estilos .qml do COA (scripts/gerar-paletas.mjs). */
export const PALETTES: Palette[] = (dados as (Palette & { origem: string })[]).map(({ id, nome, classes }) => ({
  id,
  nome,
  classes,
}));

export function getPalette(id: string): Palette {
  const p = PALETTES.find((x) => x.id === id);
  if (!p) throw new Error(`Paleta "${id}" não encontrada`);
  return p;
}

/** Até 160 mm → período curto; até 2.000 mm → acumulado; acima → anual. */
export function autoPalette(max: number): Palette {
  if (!(max > 160)) return getPalette('locks_0_160');
  if (max <= 2000) return getPalette('acum_atual');
  return getPalette('acum_anual');
}

export function resolvePalette(id: string, max: number): Palette {
  return id === 'auto' ? autoPalette(max) : getPalette(id);
}

/** Índice da classe (primeira com v <= max; acima da última → última). NaN → -1. */
export function classify(v: number, p: Palette): number {
  if (Number.isNaN(v)) return -1;
  const c = p.classes;
  for (let i = 0; i < c.length; i++) if (v <= c[i].max) return i;
  return c.length - 1;
}

/** 255 = sem dado. Suporta até 255 classes. */
export function buildClassIndex(values: Float32Array, p: Palette): Uint8Array {
  const out = new Uint8Array(values.length);
  const maxs = Float64Array.from(p.classes, (c) => c.max);
  const ultimo = maxs.length - 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== v) {
      out[i] = 255;
      continue;
    }
    let k = 0;
    while (k < ultimo && v > maxs[k]) k++;
    out[i] = k;
  }
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
