// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { areaHa, importarShape, ShapeError, sugerirColunaNome, sugerirColunaSetor } from '../src/lib/shapes';
import type { FeicaoImportada } from '../src/lib/shapes';
import type { Geometry } from '../src/lib/types';
import { criarShpPoligono, criarZipArmazenado, lerEntradasZip } from './helpers/shapefile';

const quadrado: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

function geojsonFile(nome: string, fc: unknown): File {
  return new File([JSON.stringify(fc)], nome, { type: 'application/geo+json' });
}

describe('importarShape (GeoJSON)', () => {
  it('importa só polígonos e avisa sobre a feição de ponto ignorada', async () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { NOME: 'Talhão A', TALHAO: '1' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-57, -14],
                [-57, -13.99],
                [-56.99, -13.99],
                [-56.99, -14],
                [-57, -14],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { NOME: 'Talhão B', TALHAO: '2' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-58, -14],
                [-58, -13.99],
                [-57.99, -13.99],
                [-57.99, -14],
                [-58, -14],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { NOME: 'Sede' },
          geometry: { type: 'Point', coordinates: [-57.5, -14] },
        },
      ],
    };

    const r = await importarShape([geojsonFile('talhoes.geojson', fc)]);

    expect(r.feicoes).toHaveLength(2);
    expect(r.colunas).toEqual(['NOME', 'TALHAO']);
    expect(r.nomeSugerido).toBe('talhoes');
    expect(r.avisos.some((a) => a === '1 feição ignorada (não é polígono)')).toBe(true);
  });

  it('usa o plural quando 2 ou mais feições são ignoradas', async () => {
    const ponto = (x: number) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, 0] } });
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: quadrado }, ponto(0), ponto(1)] };
    const r = await importarShape([geojsonFile('mistura.geojson', fc)]);
    expect(r.avisos).toContain('2 feições ignoradas (não são polígonos)');
  });

  it('lê GeometryCollection e remove a coordenada Z', async () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { NOME: 'GC' },
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0, 10],
                    [1, 0, 10],
                    [1, 1, 10],
                    [0, 1, 10],
                    [0, 0, 10],
                  ],
                ],
              },
              { type: 'Point', coordinates: [0.5, 0.5] },
            ],
          },
        },
      ],
    };

    const r = await importarShape([geojsonFile('gc.geojson', fc)]);

    expect(r.feicoes).toHaveLength(1);
    expect(r.feicoes[0].geom.type).toBe('Polygon');
    expect((r.feicoes[0].geom as { coordinates: number[][][] }).coordinates[0][0]).toEqual([0, 0]);
    expect(r.avisos.some((a) => a === '1 feição ignorada (não é polígono)')).toBe(true);
  });

  it('lança ShapeError quando não há nenhum polígono', async () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }],
    };
    const file = geojsonFile('pontos.geojson', fc);
    await expect(importarShape([file])).rejects.toBeInstanceOf(ShapeError);
    await expect(importarShape([geojsonFile('pontos.geojson', fc)])).rejects.toThrow(
      'Nenhum polígono encontrado no arquivo',
    );
  });
});

describe('importarShape (KML)', () => {
  it('lê 1 Placemark com Polygon', async () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Talhao 1</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-57.0,-14.0,0 -57.0,-14.01,0 -56.99,-14.01,0 -56.99,-14.0,0 -57.0,-14.0,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    const file = new File([kml], 'area.kml', { type: 'application/vnd.google-earth.kml+xml' });

    const r = await importarShape([file]);

    expect(r.feicoes).toHaveLength(1);
    expect(r.feicoes[0].geom.type).toBe('Polygon');
    expect(r.nomeSugerido).toBe('area');
  });

  it('MultiGeometry com 2 polígonos + 1 ponto vira 1 feição MultiPolygon', async () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Talhao composto</name>
      <MultiGeometry>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>-57.0,-14.0,0 -57.0,-14.01,0 -56.99,-14.01,0 -56.99,-14.0,0 -57.0,-14.0,0</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>-58.0,-14.0,0 -58.0,-14.01,0 -57.99,-14.01,0 -57.99,-14.0,0 -58.0,-14.0,0</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
        <Point>
          <coordinates>-57.5,-14.0,0</coordinates>
        </Point>
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>`;
    const file = new File([kml], 'composto.kml', { type: 'application/vnd.google-earth.kml+xml' });

    const r = await importarShape([file]);

    expect(r.feicoes).toHaveLength(1);
    expect(r.feicoes[0].geom.type).toBe('MultiPolygon');
    expect((r.feicoes[0].geom as { coordinates: unknown[] }).coordinates).toHaveLength(2);
    expect(r.avisos.some((a) => a === '1 feição ignorada (não é polígono)')).toBe(true);
  });
});

describe('sugerirColunaNome', () => {
  it('prioriza "nome" mesmo com "talhoes" também presente', () => {
    expect(sugerirColunaNome(['TALHÕES', 'ÁREA (ha)', 'NOME', 'PÁTIOS'], [])).toBe('NOME');
  });

  it('cai para talhao/talhoes quando não há coluna nome', () => {
    expect(sugerirColunaNome(['ID', 'TALHOES'], [])).toBe('TALHOES');
  });

  it('sem preferência conhecida, usa a primeira coluna de texto com valores únicos', () => {
    const feicoes: FeicaoImportada[] = [
      { geom: quadrado, props: { ID: 1, LABEL: 'Alfa' } },
      { geom: quadrado, props: { ID: 2, LABEL: 'Beta' } },
    ];
    expect(sugerirColunaNome(['ID', 'LABEL'], feicoes)).toBe('LABEL');
  });
});

describe('sugerirColunaSetor', () => {
  it('reconhece setor, sector, bloco e modulo', () => {
    expect(sugerirColunaSetor(['SETOR', 'NOME'])).toBe('SETOR');
    expect(sugerirColunaSetor(['Bloco'])).toBe('Bloco');
    expect(sugerirColunaSetor(['X', 'Y'])).toBeNull();
  });
});

describe('areaHa', () => {
  it('calcula a área geodésica de um quadrado de 0,01° no equador (~123,6 ha)', () => {
    const ha = areaHa({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0.01],
          [0, 0],
        ],
      ],
    });
    expect(Math.abs(ha - 123.6) / 123.6).toBeLessThan(0.01);
  });
});

const zipReal = 'dados-teste/Guapirama_V2.zip';

describe.skipIf(!existsSync(zipReal))('importarShape (shapefile real Guapirama_V2.zip)', () => {
  it('importa as 111 feições com colunas acentuadas e sugere NOME', async () => {
    const buf = readFileSync(zipReal);
    const file = new File([buf], 'Guapirama_V2.zip', { type: 'application/zip' });

    const r = await importarShape([file]);

    expect(r.feicoes).toHaveLength(111);
    expect(r.colunas).toContain('NOME');
    expect(r.colunas).toContain('TALHÕES');
    expect(sugerirColunaNome(r.colunas, r.feicoes)).toBe('NOME');
  });
});

describe('importarShape (.zip sem .prj)', () => {
  const anelGraus: [number, number][] = [
    [-57, -14],
    [-57, -13.99],
    [-56.99, -13.99],
    [-56.99, -14],
    [-57, -14],
  ];
  const anelUtm: [number, number][] = [
    [500000, 8452273],
    [500100, 8452273],
    [500100, 8452373],
    [500000, 8452373],
    [500000, 8452273],
  ];

  it('assume WGS84 e avisa quando as coordenadas cruas parecem graus', async () => {
    const zip = criarZipArmazenado([['talhao.shp', criarShpPoligono(anelGraus)]]);
    const file = new File([Uint8Array.from(zip)], 'talhao.zip', { type: 'application/zip' });

    const r = await importarShape([file]);

    expect(r.feicoes).toHaveLength(1);
    expect(r.avisos).toContain('Arquivo .prj ausente: assumindo WGS84 (coordenadas geográficas)');
  });

  it('lança ShapeError quando as coordenadas cruas não parecem lon/lat (ex.: UTM)', async () => {
    const zip = criarZipArmazenado([['talhao.shp', criarShpPoligono(anelUtm)]]);
    const file = new File([Uint8Array.from(zip)], 'talhao.zip', { type: 'application/zip' });

    await expect(importarShape([file])).rejects.toThrow(
      'Arquivo .prj ausente: não foi possível identificar o sistema de coordenadas',
    );
  });
});

describe.skipIf(!existsSync(zipReal))('importarShape (.shp/.dbf/.prj/.cpg soltos, extraídos do zip real)', () => {
  const entradas = lerEntradasZip(readFileSync(zipReal));
  const arquivo = (nome: string, tipo: string) => {
    const buf = entradas.get(nome) as Buffer;
    return new File([Uint8Array.from(buf)], nome, { type: tipo });
  };

  it('agrupa por nome base e importa igual ao zip', async () => {
    const files = [
      arquivo('Guapirama_V2.shp', 'application/octet-stream'),
      arquivo('Guapirama_V2.dbf', 'application/octet-stream'),
      arquivo('Guapirama_V2.prj', 'text/plain'),
      arquivo('Guapirama_V2.cpg', 'text/plain'),
    ];

    const r = await importarShape(files);

    expect(r.feicoes).toHaveLength(111);
    expect(r.nomeSugerido).toBe('Guapirama_V2');
    expect(r.avisos.some((a) => a.includes('.prj ausente'))).toBe(false);
  });

  it('sem .prj, assume WGS84 quando as coordenadas estão na faixa geográfica', async () => {
    const files = [
      arquivo('Guapirama_V2.shp', 'application/octet-stream'),
      arquivo('Guapirama_V2.dbf', 'application/octet-stream'),
      arquivo('Guapirama_V2.cpg', 'text/plain'),
    ];

    const r = await importarShape(files);

    expect(r.feicoes).toHaveLength(111);
    expect(r.avisos).toContain('Arquivo .prj ausente: assumindo WGS84 (coordenadas geográficas)');
  });
});
