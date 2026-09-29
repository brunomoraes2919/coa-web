import { describe, expect, it } from 'vitest';
import { geomToXY, lonLatToMerc, mercToLonLat, projetorUtm, utmEpsgFor } from '../src/lib/projection';

describe('projection', () => {
  it('escolhe a zona UTM SIRGAS 2000', () => {
    expect(utmEpsgFor(-57.2, -13.8)).toBe(31981);
    expect(utmEpsgFor(-51, -15)).toBe(31982);
    expect(utmEpsgFor(-60.5, 2)).toBe(31974);
  });

  it('projeta igual ao pyproj (EPSG:31981)', () => {
    const p = projetorUtm(31981);
    const [x, y] = p.forward(-57, -14);
    expect(x).toBeCloseTo(500000, 3);
    expect(y).toBeCloseTo(8452273.693, 2);
    const [x2, y2] = p.forward(-57.2, -13.8);
    expect(x2).toBeCloseTo(478383.257, 2);
    expect(y2).toBeCloseTo(8474383.52, 2);
  });

  it('faz ida e volta', () => {
    const p = projetorUtm(31981);
    const [lon, lat] = p.inverse(...p.forward(-57.31, -13.9));
    expect(lon).toBeCloseTo(-57.31, 7);
    expect(lat).toBeCloseTo(-13.9, 7);
  });

  it('converte Web Mercator', () => {
    const [x, y] = lonLatToMerc(-57, -14);
    expect(x).toBeCloseTo(-6345210.975, 2);
    expect(y).toBeCloseTo(-1574216.548, 2);
    const [lon, lat] = mercToLonLat(x, y);
    expect(lon).toBeCloseTo(-57, 9);
    expect(lat).toBeCloseTo(-14, 9);
  });

  it('converte geometria em anéis XY', () => {
    const xy = geomToXY(
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      (lon, lat) => [lon * 10, lat * 10],
    );
    expect(xy).toEqual([[[[0, 0], [10, 0], [10, 10], [0, 0]]]]);
  });
});
