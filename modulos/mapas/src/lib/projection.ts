import proj4 from 'proj4';
import type { Geometry } from './types';

/** Zona UTM SIRGAS 2000: sul = 31960 + zona (21S → 31981); norte = 31954 + zona (18N → 31972). */
export function utmEpsgFor(lon: number, lat: number): number {
  const zona = Math.floor((lon + 180) / 6) + 1;
  return lat < 0 ? 31960 + zona : 31954 + zona;
}

export interface Projetor {
  epsg: number;
  forward(lon: number, lat: number): [number, number];
  inverse(x: number, y: number): [number, number];
}

const cache = new Map<number, Projetor>();

export function projetorUtm(epsg: number): Projetor {
  const existente = cache.get(epsg);
  if (existente) return existente;
  const sul = epsg >= 31978;
  const zona = sul ? epsg - 31960 : epsg - 31954;
  const def = `+proj=utm +zone=${zona}${sul ? ' +south' : ''} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  const conv = proj4('EPSG:4326', def);
  const p: Projetor = {
    epsg,
    forward: (lon, lat) => conv.forward([lon, lat]) as [number, number],
    inverse: (x, y) => conv.inverse([x, y]) as [number, number],
  };
  cache.set(epsg, p);
  return p;
}

const R = 6378137;
const MAX_LAT = 85.0511287798;

/** EPSG:3857 (Web Mercator), mesma fórmula dos tiles. */
export function lonLatToMerc(lon: number, lat: number): [number, number] {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))];
}

export function mercToLonLat(x: number, y: number): [number, number] {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

export type Ring = [number, number][];
/** Primeiro anel = externo; demais = buracos */
export type PolyXY = Ring[];
export type MultiPolyXY = PolyXY[];

export function geomToXY(g: Geometry, f: (lon: number, lat: number) => [number, number]): MultiPolyXY {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => f(lon, lat))));
}
