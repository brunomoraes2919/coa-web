import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Feature, FeatureCollection, Geometry as GeoJsonGeom } from 'geojson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizarCodigo as normalizarTs } from '../src/lib/codigoTalhao';

interface ResumoArquivo {
  arquivo: string;
  lidas: number;
  escritas: number;
  vazios: number;
  unidos: number;
  semGeometria: number;
  semPrj: boolean;
}

interface ModuloSeed {
  normalizarCodigo(s: string | null | undefined): string;
  unirFeaturesPorCodigo(features: Feature[], campo: string): Feature[];
  gerarSeed(opcoes: { origem: string; destino: string; agora?: Date; silencioso?: boolean }): Promise<ResumoArquivo[]>;
}

// caminho em variável: o módulo .mjs é carregado sem tipos (ModuloSeed descreve o que ele exporta)
const caminhoScript = pathToFileURL(resolve(__dirname, '../scripts/gerar-seed.mjs')).href;
const carregar = async () => (await import(/* @vite-ignore */ caminhoScript)) as ModuloSeed;

const CASOS = [
  '39B', 'TH 033A', '69', '09A', 'PIVÔ 02', 'PIVO 2', 'PIV2', '02PIVO', 'P14', 'M1A', '19PESQ', '08 PESQ',
  'TH008', 'TALHÃO 5', 'talhao 12b', 'EXP-CL', 'M 4 B', 'THX', '001-A', 'TH-033A', 'TH 002-A', '01AR', '', '  ',
];

function quadrado(x: number): GeoJsonGeom {
  return {
    type: 'Polygon',
    coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]],
  };
}

const feature = (geometry: GeoJsonGeom | null, properties: Record<string, unknown>): Feature =>
  ({ type: 'Feature', geometry, properties }) as Feature;

describe('gerar-seed: normalizarCodigo', () => {
  it('é igual à versão TypeScript', async () => {
    const { normalizarCodigo } = await carregar();
    for (const c of [...CASOS, null, undefined]) {
      expect(normalizarCodigo(c), String(c)).toBe(normalizarTs(c));
    }
  });
});

describe('gerar-seed: unirFeaturesPorCodigo', () => {
  it('une um FeatureCollection sintético por código normalizado', async () => {
    const { unirFeaturesPorCodigo } = await carregar();
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        feature(quadrado(0), { COD: '072' }),
        feature(quadrado(1), { COD: '' }),
        feature(quadrado(2), { COD: '72' }),
        feature({ type: 'MultiPolygon', coordinates: [(quadrado(5) as { coordinates: number[][][] }).coordinates] }, { COD: '053' }),
        feature(quadrado(3), { COD: ' ' }),
        feature(quadrado(4), { COD: 'TH 053' }),
      ],
    };
    const r = unirFeaturesPorCodigo(fc.features, 'COD');
    expect(r.map((f) => f.properties?.codigo)).toEqual(['072', '', '053', '']);
    expect(r.map((f) => f.properties?.codigoBruto)).toEqual(['072', '', '053', '']);
    expect(r[0].geometry).toEqual({
      type: 'MultiPolygon',
      coordinates: [(quadrado(0) as { coordinates: unknown }).coordinates, (quadrado(2) as { coordinates: unknown }).coordinates],
    });
    expect(r[1].geometry).toEqual(quadrado(1));
    expect(r[2].geometry?.type).toBe('MultiPolygon');
    expect((r[2].geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });
});

const temFonte = existsSync(resolve(__dirname, '../dados-fonte/base')) && existsSync(resolve(__dirname, '../dados-fonte/soja-26-27'));

describe.skipIf(!temFonte)('gerar-seed: integração com dados-fonte/', () => {
  let destino = '';
  let resumo: ResumoArquivo[] = [];
  const ler = <T>(rel: string): T => JSON.parse(readFileSync(join(destino, rel), 'utf8')) as T;

  beforeAll(async () => {
    destino = mkdtempSync(join(tmpdir(), 'seed-'));
    const { gerarSeed } = await carregar();
    resumo = await gerarSeed({
      origem: resolve(__dirname, '../dados-fonte'),
      destino,
      agora: new Date('2026-09-28T10:00:00Z'),
      silencioso: true,
    });
  }, 120_000);

  afterAll(() => {
    if (destino) rmSync(destino, { recursive: true, force: true });
  });

  it('escreve seed.json com as 7 fazendas e a safra SOJA 26/27', () => {
    const seed = ler<{
      versao: number;
      geradoEm: string;
      fazendas: { nome: string; unidadePims: string; campoSetor: string | null; arquivoBase: string }[];
      safras: { nome: string; nomePims: string; inicio: string; fim: string; areasCultura: { unidadePims: string; arquivo: string }[] }[];
    }>('seed.json');
    expect(seed.versao).toBe(1);
    expect(seed.geradoEm).toBe('2026-09-28T10:00:00.000Z');
    expect(seed.fazendas.map((f) => f.nome)).toEqual(['Dourado', 'Globo', 'Guapirama', 'Nebraska', 'Siriema', 'SM3', 'Três Flechas']);
    expect(seed.fazendas.map((f) => f.unidadePims)).toEqual([
      'DOURADO', 'GLOBO', 'GUAPIRAMA', 'NEBRASKA', 'SIRIEMA', 'SM3', 'TRES FLECHAS',
    ]);
    for (const f of seed.fazendas) expect(existsSync(join(destino, f.arquivoBase)), f.arquivoBase).toBe(true);
    expect(seed.fazendas.find((f) => f.nome === 'Siriema')?.campoSetor).toBe('setor');
    const [safra] = seed.safras;
    expect(safra).toMatchObject({ nome: 'SOJA 26/27', nomePims: 'SOJA 26/27', inicio: '2026-09-01', fim: '2027-08-31' });
    expect(safra.areasCultura.map((a) => a.unidadePims)).toEqual(['DOURADO', 'GLOBO', 'GUAPIRAMA', 'NEBRASKA', 'SIRIEMA', 'SM3', 'TRES FLECHAS']);
    for (const a of safra.areasCultura) expect(existsSync(join(destino, a.arquivo)), a.arquivo).toBe(true);
    expect(resumo.length).toBeGreaterThan(0);
  });

  it('Siriema tem 2 setores e 30 feições', () => {
    const fc = ler<FeatureCollection>('base/SIRIEMA.geojson');
    expect(fc.features).toHaveLength(30);
    expect(new Set(fc.features.map((f) => f.properties?.setor))).toEqual(new Set(['SIRIEMA', 'SÃO MIGUEL']));
  });

  it('Três Flechas normaliza 39B/09A para 039B/009A', () => {
    const fc = ler<FeatureCollection>('base/TRES_FLECHAS.geojson');
    const codigos = fc.features.map((f) => f.properties?.codigo);
    expect(codigos).toContain('039B');
    expect(codigos).toContain('009A');
    const f039b = fc.features.find((f) => f.properties?.codigo === '039B');
    expect(f039b?.properties).toEqual({ codigo: '039B', codigoBruto: '39B', nome: '39B', setor: null });
  });

  it('Guapirama une os duplicados 053/072 em MultiPolygon', () => {
    const fc = ler<FeatureCollection>('base/GUAPIRAMA.geojson');
    for (const c of ['053', '072']) {
      const achadas = fc.features.filter((f) => f.properties?.codigo === c);
      expect(achadas, c).toHaveLength(1);
      expect(achadas[0].geometry.type).toBe('MultiPolygon');
    }
  });

  it('Globo: vazios viram "Talhão N" e a soja tem 02PIVO..05PIVO', () => {
    const base = ler<FeatureCollection>('base/GLOBO.geojson');
    const vazios = base.features.filter((f) => f.properties?.codigo === '');
    expect(vazios.length).toBe(6);
    expect(vazios.map((f) => f.properties?.nome)).toEqual(['Talhão 1', 'Talhão 2', 'Talhão 3', 'Talhão 4', 'Talhão 5', 'Talhão 6']);
    const soja = ler<FeatureCollection>('soja-26-27/GLOBO.geojson');
    const codigos = soja.features.map((f) => f.properties?.codigo);
    for (const c of ['02PIVO', '03PIVO', '04PIVO', '05PIVO']) expect(codigos).toContain(c);
    expect(Object.keys(soja.features[0].properties ?? {})).toEqual(['codigo', 'codigoBruto']);
  });

  it('Guapirama soja: códigos com hífen (001-A) viram 001A', () => {
    const fc = ler<FeatureCollection>('soja-26-27/GUAPIRAMA.geojson');
    const codigos = fc.features.map((f) => f.properties?.codigo as string);
    for (const c of ['001A', '002A', '007A', '054A', '058A', '062A']) expect(codigos).toContain(c);
    expect(codigos.filter((c) => c.includes('-'))).toEqual([]);
    expect(fc.features.find((f) => f.properties?.codigo === '001A')?.properties?.codigoBruto).toBe('001-A');
  });

  it('coordenadas em WGS84 com no máximo 7 casas decimais', () => {
    const fc = ler<FeatureCollection>('soja-26-27/GLOBO.geojson');
    const coords = (fc.features[0].geometry as { coordinates: number[][][] }).coordinates.flat();
    for (const [x, y] of coords) {
      expect(Math.abs(x)).toBeLessThanOrEqual(180);
      expect(Math.abs(y)).toBeLessThanOrEqual(90);
      expect(Math.round(x * 1e7) / 1e7).toBe(x);
      expect(Math.round(y * 1e7) / 1e7).toBe(y);
    }
  });
});
