/**
 * Limite da fazenda = contorno dos talhões do cadastro do Mapas (`mapas_talhoes.geom`,
 * GeoJSON em lon/lat). A fazenda não tem ponto próprio: a posição dela sai daqui.
 */
export type GeometriaTalhao = GeoJSON.Polygon | GeoJSON.MultiPolygon
export type LimiteFazenda = GeoJSON.FeatureCollection<GeometriaTalhao>

function geometriaValida(g: unknown): g is GeometriaTalhao {
  if (typeof g !== 'object' || g === null) return false
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown }
  return (type === 'Polygon' || type === 'MultiPolygon') && Array.isArray(coordinates)
}

/** Talhões agrupados por fazenda; linha sem polígono fica de fora, fazenda sem nenhum não aparece. */
export function limitesPorFazenda(linhas: { fazenda_id: string; geom: unknown }[]): Record<string, LimiteFazenda> {
  const limites: Record<string, LimiteFazenda> = {}
  for (const { fazenda_id, geom } of linhas) {
    if (!geometriaValida(geom)) continue
    limites[fazenda_id] ??= { type: 'FeatureCollection', features: [] }
    limites[fazenda_id].features.push({ type: 'Feature', properties: {}, geometry: geom })
  }
  return limites
}

/** Meio da caixa que envolve todos os talhões; `null` sem nenhum vértice válido. */
export function centroDoLimite(limite: LimiteFazenda): { lat: number; lon: number } | null {
  let oeste = Infinity
  let leste = -Infinity
  let sul = Infinity
  let norte = -Infinity
  const andar = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return
      oeste = Math.min(oeste, c[0])
      leste = Math.max(leste, c[0])
      sul = Math.min(sul, c[1])
      norte = Math.max(norte, c[1])
      return
    }
    for (const filho of c) andar(filho)
  }
  for (const f of limite.features) andar(f.geometry.coordinates)
  if (!Number.isFinite(oeste) || !Number.isFinite(sul)) return null
  return { lat: (sul + norte) / 2, lon: (oeste + leste) / 2 }
}
