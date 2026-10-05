/**
 * Posição das fazendas no quadrado de 0,5° que vira chamada à Trimble. As
 * fazendas e as coordenadas vêm do cadastro do Mapas (`dados/cadastro.ts`);
 * aqui só se calcula a célula de cada uma e as células distintas.
 */
import type { Celula, FazendaGnss } from './tipos'

export function celulaDe(lat: number, lon: number): Celula {
  const la = Math.round(lat * 2) / 2
  const lo = Math.round(lon * 2) / 2
  return { id: `${la}_${lo}`, lat: la, lon: lo }
}

/** Um quadrado por posição distinta — é o que vira chamada à Trimble. */
export function celulasDasFazendas(fazendas: FazendaGnss[]): Celula[] {
  const vistas = new Map<string, Celula>()
  for (const f of fazendas) {
    if (f.lat == null || f.lon == null) continue
    const c = celulaDe(f.lat, f.lon)
    vistas.set(c.id, c)
  }
  return [...vistas.values()]
}
