/**
 * Validação contra um raster real gerado no QGIS (Três Flechas, chuva de 01 a 29/12/2023).
 * Os dados ficam em dados-teste/ (fora do git); sem eles o teste é pulado.
 * Rodar: npm run validar-grass
 */
import { existsSync, readFileSync } from 'node:fs';
import { fromFile } from 'geotiff';
import shp from 'shpjs';
import type { FeatureCollection, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import { idwAt, type IdwPoint } from '../src/lib/idw';
import { projetorUtm, utmEpsgFor } from '../src/lib/projection';

const dir = 'dados-teste/tres-flechas';
const tem = existsSync(`${dir}/precipitacao.tif`) && existsSync(`${dir}/PICS.shp`);

async function carregar() {
  const tif = await fromFile(`${dir}/precipitacao.tif`);
  const img = await tif.getImage();
  const [minLon, , , maxLat] = img.getBoundingBox();
  const [resLon, resLat] = img.getResolution();
  const w = img.getWidth();
  const h = img.getHeight();
  const [banda] = (await img.readRasters({ samples: [0] })) as unknown as Float32Array[];
  const fc = (await shp({
    shp: readFileSync(`${dir}/PICS.shp`),
    dbf: readFileSync(`${dir}/PICS.dbf`),
  })) as FeatureCollection<Point>;
  return { minLon, maxLat, resLon, resLat, w, h, banda, fc };
}

describe.skipIf(!tem)('validação contra o raster do QGIS (Três Flechas)', () => {
  it('o IDW (p=4, k=12) reproduz o raster', async () => {
    const { minLon, maxLat, resLon, resLat, w, h, banda, fc } = await carregar();
    const [lon0, lat0] = fc.features[0].geometry.coordinates;
    const proj = projetorUtm(utmEpsgFor(lon0, lat0));
    const pts: IdwPoint[] = fc.features.map((f) => {
      const [x, y] = proj.forward(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      return { x, y, v: Number(f.properties?.CHUVA) };
    });

    const amostras: { x: number; y: number; ref: number }[] = [];
    for (let r = 0; r < h; r += 7) {
      for (let c = 0; c < w; c += 7) {
        const ref = banda[r * w + c];
        if (!(ref > 0)) continue; // nodata = 0
        const lon = minLon + (c + 0.5) * resLon;
        const lat = maxLat + (r + 0.5) * resLat; // resLat é negativo
        const [x, y] = proj.forward(lon, lat);
        amostras.push({ x, y, ref });
      }
    }

    const erro = (p: number, k: number) => {
      let soma = 0;
      let max = 0;
      for (const a of amostras) {
        const d = Math.abs(idwAt(a.x, a.y, pts, p, k) - a.ref);
        soma += d;
        if (d > max) max = d;
      }
      return { mae: soma / amostras.length, max };
    };

    const combinacoes = [
      [2, 12],
      [3, 12],
      [4, 12],
      [4, 8],
      [5, 12],
    ] as const;
    const tabela = combinacoes.map(([p, k]) => ({ p, k, ...erro(p, k) }));
    const media = amostras.reduce((s, a) => s + a.ref, 0) / amostras.length;
    console.table(tabela.map((t) => ({ ...t, mae: t.mae.toFixed(3), max: t.max.toFixed(3) })));
    console.log(`amostras: ${amostras.length} · chuva média no raster: ${media.toFixed(1)} mm · PICs: ${pts.length}`);

    const alvo = tabela.find((t) => t.p === 4 && t.k === 12)!;
    expect(alvo.mae).toBeLessThan(0.25); // mm (hoje ~0,16 mm; o limite antigo, 0,5% da média, deixava passar ~3 mm)
    expect(Math.min(...tabela.map((t) => t.mae))).toBe(alvo.mae);
  }, 120_000);
});
