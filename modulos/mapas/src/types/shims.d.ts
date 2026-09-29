declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson';
  type Buf = ArrayBuffer | Uint8Array | DataView;
  type Resultado = FeatureCollection | (FeatureCollection & { fileName?: string })[];
  export interface PartesShapefile { shp: Buf; dbf?: Buf; cpg?: string | Buf; prj?: string | Buf }
  /** Aceita um .zip (buffer), uma URL ou um objeto com as partes do shapefile. */
  export default function shp(input: Buf | string | PartesShapefile): Promise<Resultado>;
  export function parseZip(buf: Buf, whiteList?: string[]): Promise<Resultado>;
  export function parseShp(shp: Buf, prj?: string | Buf): unknown[];
  export function parseDbf(dbf: Buf, cpg?: string | Buf): Record<string, unknown>[];
  export function combine(arr: [unknown[], Record<string, unknown>[] | undefined]): FeatureCollection;
}
