// @vitest-environment jsdom
// Exportar limites em shapefile e KML: o que sai tem de voltar igual pela importação do próprio Mapas (shpjs e
// togeojson). Geometrias FICTÍCIAS.
import type { MultiPolygon, Polygon } from 'geojson';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { arquivosShapefile, kmlDe, nomesDeColunaDbf, poligonosDe, shapefileZip, type FeicaoExportada } from '../src/lib/exportarLimites';
import { importarShape } from '../src/lib/shapes';

/** quadrado no sentido do GeoJSON (anti-horário) */
const quadrado = (x0: number, y0: number, l: number): number[][] => [[x0, y0], [x0 + l, y0], [x0 + l, y0 + l], [x0, y0 + l], [x0, y0]];
const comFuro: Polygon = { type: 'Polygon', coordinates: [quadrado(-57, -14, 0.01), [...quadrado(-56.996, -13.996, 0.002)].reverse()] };
const duas: MultiPolygon = { type: 'MultiPolygon', coordinates: [[quadrado(-56.98, -14, 0.005)], [quadrado(-56.97, -14, 0.005)]] };

const feicoes: FeicaoExportada[] = [
  { geom: comFuro, props: { TALHAO: '001', SETOR: 'Sede', CODIGO: '001', AREA_HA: 118.47, SITUACAO: 'Plantado' } },
  { geom: duas, props: { TALHAO: 'Área São João', SETOR: null, CODIGO: '023A', AREA_HA: 61.5, SITUACAO: 'A plantar' } },
  { geom: { type: 'Point', coordinates: [-57, -14] }, props: { TALHAO: 'ponto', SETOR: null, CODIGO: null, AREA_HA: 0, SITUACAO: null } },
];

const arquivo = (nome: string, dados: Uint8Array | string) => new File([typeof dados === 'string' ? dados : Uint8Array.from(dados)], nome);

describe('shapefile', () => {
  it('volta pela importação do Mapas com os polígonos, o furo e os atributos (acentos em UTF-8)', async () => {
    const { arquivos, ignoradas } = arquivosShapefile(feicoes, 'TALHOES_TESTE', new Date(2026, 9, 21));
    expect(ignoradas).toBe(1);
    expect(Object.keys(arquivos).sort()).toEqual(['TALHOES_TESTE.cpg', 'TALHOES_TESTE.dbf', 'TALHOES_TESTE.prj', 'TALHOES_TESTE.shp', 'TALHOES_TESTE.shx']);
    const r = await importarShape(Object.entries(arquivos).map(([n, d]) => arquivo(n, d)));
    expect(r.colunas).toEqual(['TALHAO', 'SETOR', 'CODIGO', 'AREA_HA', 'SITUACAO']);
    const p = r.feicoes.map((f) => f.props);
    expect(p[0]).toMatchObject({ TALHAO: '001', SETOR: 'Sede', CODIGO: '001', AREA_HA: 118.47, SITUACAO: 'Plantado' });
    expect(p[1]).toMatchObject({ TALHAO: 'Área São João', CODIGO: '023A', AREA_HA: 61.5, SITUACAO: 'A plantar' });
    // o furo continua furo (dois anéis no primeiro) e as duas partes continuam juntas na segunda feição
    const geoms = r.feicoes.map((f) => f.geom);
    const aneis = (g: (typeof geoms)[number]) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
    expect(aneis(geoms[0])[0]).toHaveLength(2);
    expect(geoms.slice(1).flatMap(aneis)).toHaveLength(2);
    const xs = geoms.flatMap(aneis).flat(2).map((c) => c[0]);
    expect(Math.min(...xs)).toBeCloseTo(-57, 9);
  });

  it('anel de fora no sentido horário e furo no anti-horário, como pede o formato', () => {
    const { arquivos } = arquivosShapefile([feicoes[0]], 'x');
    const dv = new DataView(arquivos['x.shp'].buffer);
    const c = 108;
    expect(dv.getInt32(c, true)).toBe(5);
    expect(dv.getInt32(c + 36, true)).toBe(2);
    const n = dv.getInt32(c + 40, true);
    const pts: number[][] = [];
    for (let i = 0; i < n; i++) pts.push([dv.getFloat64(c + 52 + 16 * i, true), dv.getFloat64(c + 60 + 16 * i, true)]);
    const area = (a: number[][]) => a.slice(0, -1).reduce((s, p, i) => s + p[0] * a[i + 1][1] - a[i + 1][0] * p[1], 0) / 2;
    expect(area(pts.slice(0, 5))).toBeLessThan(0);
    expect(area(pts.slice(5))).toBeGreaterThan(0);
    // .shx aponta para o registro
    const dx = new DataView(arquivos['x.shx'].buffer);
    expect(dx.getInt32(100, false)).toBe(50);
    expect(dx.getInt32(24, false) * 2).toBe(arquivos['x.shx'].length);
    expect(dv.getInt32(24, false) * 2).toBe(arquivos['x.shp'].length);
  });

  it('zip com os cinco arquivos', async () => {
    const { blob } = await shapefileZip(feicoes, 'AREAS');
    const nomes = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer()))).sort();
    expect(nomes).toEqual(['AREAS.cpg', 'AREAS.dbf', 'AREAS.prj', 'AREAS.shp', 'AREAS.shx']);
    const r = await importarShape([arquivo('AREAS.zip', new Uint8Array(await blob.arrayBuffer()))]);
    expect(r.feicoes).toHaveLength(2);
  });

  it('nomes de coluna do .dbf: sem acento, até 10 letras, começando por letra e sem repetir', () => {
    expect(nomesDeColunaDbf(['Situação', 'área (ha)', '1º corte', 'VARIEDADE_COMERCIAL', 'VARIEDADE_PIMS'])).toEqual([
      'SITUACAO',
      'AREA_HA',
      'C1_CORTE',
      'VARIEDADE_',
      'VARIEDAD_2',
    ]);
  });

  it('texto longo é cortado sem partir letra acentuada', async () => {
    const longo = 'ç'.repeat(200);
    const { arquivos } = arquivosShapefile([{ geom: comFuro, props: { NOME: longo } }], 'y');
    const r = await importarShape(Object.entries(arquivos).map(([n, d]) => arquivo(n, d)));
    expect(r.feicoes[0].props.NOME).toBe('ç'.repeat(127));
  });
});

describe('KML', () => {
  it('volta pela importação do Mapas com nome, atributos, furo e as duas partes', async () => {
    const { texto, ignoradas } = kmlDe(feicoes, 'Talhões · Teste', 'TALHAO');
    expect(ignoradas).toBe(1);
    expect(texto).toContain('<name>Área São João</name>');
    expect(texto).toContain('<MultiGeometry>');
    const r = await importarShape([arquivo('t.kml', texto)]);
    expect(r.feicoes[0].props).toMatchObject({ name: '001', SETOR: 'Sede', CODIGO: '001', SITUACAO: 'Plantado' });
    expect(r.feicoes.some((f) => f.props.name === 'Área São João')).toBe(true);
  });

  it('escapa o que quebraria o XML', () => {
    const { texto } = kmlDe([{ geom: comFuro, props: { NOME: 'A & B <C> "D"\u0001' } }], 'x', 'NOME');
    expect(texto).toContain('<name>A &amp; B &lt;C&gt; &quot;D&quot;</name>');
    expect(() => new DOMParser().parseFromString(texto, 'text/xml')).not.toThrow();
    expect(new DOMParser().parseFromString(texto, 'text/xml').getElementsByTagName('parsererror')).toHaveLength(0);
  });
});

describe('polígonos', () => {
  it('fecha o anel aberto e descarta polígono sem anel de fora válido', () => {
    const aberto: Polygon = { type: 'Polygon', coordinates: [quadrado(0, 0, 1).slice(0, 4)] };
    expect(poligonosDe(aberto)[0][0]).toHaveLength(5);
    expect(poligonosDe({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toEqual([]);
    expect(poligonosDe(null)).toEqual([]);
  });
});
