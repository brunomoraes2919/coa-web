import { describe, expect, it } from 'vitest'
import { centroDoLimite, limitesPorFazenda } from './limites'

const quadrado = (x: number, y: number, lado = 1): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + lado, y], [x + lado, y + lado], [x, y + lado], [x, y]]],
})

describe('limites das fazendas', () => {
  it('agrupa os talhões por fazenda e ignora o que não é polígono', () => {
    const limites = limitesPorFazenda([
      { fazenda_id: 'a', geom: quadrado(-57, -15) },
      { fazenda_id: 'a', geom: { type: 'MultiPolygon', coordinates: [quadrado(-56, -15).coordinates] } },
      { fazenda_id: 'b', geom: quadrado(-47, -9) },
      { fazenda_id: 'b', geom: { type: 'Point', coordinates: [-47, -9] } },
      { fazenda_id: 'b', geom: null },
      { fazenda_id: 'c', geom: 'lixo' },
      { fazenda_id: 'd', geom: { type: 'Polygon', coordinates: 'lixo' } },
    ])
    expect(Object.keys(limites).sort()).toEqual(['a', 'b'])
    expect(limites.a.type).toBe('FeatureCollection')
    expect(limites.a.features).toHaveLength(2)
    expect(limites.a.features[0]).toMatchObject({ type: 'Feature', geometry: { type: 'Polygon' } })
    expect(limites.b.features).toHaveLength(1)
  })

  it('o centro é o meio da caixa de todos os talhões', () => {
    const { a } = limitesPorFazenda([
      { fazenda_id: 'a', geom: quadrado(-57, -15) },
      { fazenda_id: 'a', geom: quadrado(-55, -14) },
    ])
    expect(centroDoLimite(a)).toEqual({ lat: -14, lon: -55.5 })
  })

  it('sem talhão não há centro', () => {
    expect(centroDoLimite({ type: 'FeatureCollection', features: [] })).toBeNull()
  })
})
