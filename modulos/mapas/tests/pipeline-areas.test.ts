import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizarCodigo } from '../src/lib/codigoTalhao';
import { talhoesParaInterpolacao } from '../src/lib/mascaraCultura';
import { runPipeline, type PipelineInput } from '../src/lib/pipeline';
import { situacaoDoMapa } from '../src/lib/situacaoPlantio';
import { IDW_PADRAO, type AreaCultura, type Geometry, type PlantioPimsArquivo, type PlantioPimsTalhao, type Talhao } from '../src/lib/types';

const ret = (lon0: number, lat0: number, lon1: number, lat1: number): [number, number][] => [
  [lon0, lat0],
  [lon1, lat0],
  [lon1, lat1],
  [lon0, lat1],
  [lon0, lat0],
];
const poli = (lon0: number, lat0: number, lon1: number, lat1: number): Geometry => ({ type: 'Polygon', coordinates: [ret(lon0, lat0, lon1, lat1)] });

// talhão base A (~108 m × 110 m) e B a leste; subáreas "sub" e "leste" = metades oeste e leste de A;
// "fora" = área sem talhão base
const geomA = poli(-57.201, -13.801, -57.2, -13.8);
const geomB = poli(-57.199, -13.801, -57.198, -13.8);
const geomSub = poli(-57.201, -13.801, -57.2005, -13.8);
const geomLeste = poli(-57.2005, -13.801, -57.2, -13.8);
const geomFora = poli(-57.201, -13.8025, -57.2, -13.8015);

// chuva cresce de oeste (0) para leste (20)
const pics: PipelineInput['pics'] = [
  { lon: -57.2009, lat: -13.8009, chuva: 0 },
  { lon: -57.1981, lat: -13.8009, chuva: 20 },
  { lon: -57.2009, lat: -13.8001, chuva: 0 },
  { lon: -57.1981, lat: -13.8001, chuva: 20 },
];

const entrada = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  talhoes: [
    { id: 'sub', nome: '001A', setor: null, geom: geomSub }, // entrada sintética (área sem talhão base do mesmo código)
    { id: 'a', nome: '001', setor: null, geom: geomA },
    { id: 'b', nome: '002', setor: null, geom: geomB },
  ],
  pics,
  params: { ...IDW_PADRAO },
  plantados: ['a'],
  areas: [
    { id: 'sub', geom: geomSub },
    { id: 'leste', geom: geomLeste },
  ],
  plantadosAreas: ['sub'],
  ...over,
});

describe('runPipeline — áreas da cultura (segunda rasterização)', () => {
  it('resumo.areas: estatísticas de cada área sobre os mesmos valores da grade', () => {
    const { resumo } = runPipeline(entrada());
    const porId = new Map(resumo.areas!.map((a) => [a.id, a]));
    const sub = porId.get('sub')!;
    const leste = porId.get('leste')!;
    expect(sub.areaHa).toBeGreaterThan(0.5);
    expect(leste.areaHa).toBeGreaterThan(0.5);
    expect(Number.isFinite(sub.media)).toBe(true);
    expect(sub.media).toBeLessThan(leste.media); // metade oeste, mais seca
    expect(sub.min).toBeLessThanOrEqual(sub.media);
    expect(sub.max).toBeGreaterThanOrEqual(sub.media);
  });

  it('a entrada sintética com o id de uma área recebe as estatísticas da própria área (não ~0 células)', () => {
    const { resumo } = runPipeline(entrada());
    const linha = resumo.talhoes.find((t) => t.talhaoId === 'sub')!;
    const sub = resumo.areas!.find((a) => a.id === 'sub')!;
    expect(linha).toMatchObject({ media: sub.media, min: sub.min, max: sub.max, areaHa: sub.areaHa });
    // o talhão base continua com as dele
    const soma = resumo.areas!.reduce((s, a) => s + a.areaHa, 0);
    expect(resumo.talhoes.find((t) => t.talhaoId === 'a')!.areaHa).toBeCloseTo(soma, 6);
  });

  it('com áreas, "plantado" = união das áreas plantadas/plantando (os talhões base plantados não contam)', () => {
    const { resumo } = runPipeline(entrada());
    const sub = resumo.areas!.find((a) => a.id === 'sub')!;
    expect(resumo.plantado).not.toBeNull();
    expect(resumo.plantado!.areaHa).toBeCloseTo(sub.areaHa, 6);
    expect(resumo.plantado!.media).toBeCloseTo(sub.media, 4);
    expect(runPipeline(entrada({ plantadosAreas: [] })).resumo.plantado).toBeNull();
  });

  it('sem áreas: plantado pelos talhões base (comportamento anterior) e sem resumo.areas', () => {
    const { resumo } = runPipeline(entrada({ areas: undefined, plantadosAreas: undefined }));
    expect(resumo.areas).toBeUndefined();
    expect(resumo.plantado!.areaHa).toBeCloseTo(resumo.talhoes.find((t) => t.talhaoId === 'a')!.areaHa, 6);
  });

  it('a máscara inclui áreas fora dos talhões base (grade e estatísticas cobrem a área)', () => {
    const { resumo, grid } = runPipeline(
      entrada({
        talhoes: [{ id: 'a', nome: '001', setor: null, geom: geomA }],
        areas: [{ id: 'fora', geom: geomFora }],
        plantadosAreas: ['fora'],
        pics: [
          { lon: -57.2009, lat: -13.8024, chuva: 5 },
          { lon: -57.2001, lat: -13.8024, chuva: 5 },
          { lon: -57.2009, lat: -13.8001, chuva: 5 },
        ],
      }),
    );
    const fora = resumo.areas!.find((a) => a.id === 'fora')!;
    expect(fora.areaHa).toBeGreaterThan(0.8);
    expect(Number.isFinite(resumo.plantado!.media)).toBe(true);
    // geral = talhões base ∪ áreas
    expect(resumo.geral.areaHa).toBeCloseTo(resumo.talhoes[0].areaHa + fora.areaHa, 6);
    // o buffer da grade ainda é transferível sozinho (o worker transfere grid.values.buffer)
    expect(grid.values.buffer.byteLength).toBe(grid.values.length * 4);
  });
});

// ---------------------------------------------------------------- seed real

const SEED = 'public/dados/seed';
const PLANTIO = 'public/dados/plantio.json';
const temDados = existsSync(`${SEED}/base/DOURADO.geojson`) && existsSync(`${SEED}/soja-26-27/SIRIEMA.geojson`) && existsSync(PLANTIO);

interface Fc {
  features: { properties: Record<string, string | null>; geometry: Geometry }[];
}
const ler = (arq: string) => JSON.parse(readFileSync(arq, 'utf8')) as Fc;

function cenario(unidade: string) {
  const talhoes: Talhao[] = ler(`${SEED}/base/${unidade}.geojson`).features.map((f, i) => ({
    id: `t${i}`,
    fazendaId: 'f',
    nome: f.properties.nome ?? '',
    setor: f.properties.setor ?? null,
    areaHa: 1,
    geom: f.geometry,
    atributos: {},
    codigo: normalizarCodigo(f.properties.codigo) || null,
  }));
  const areas: AreaCultura[] = ler(`${SEED}/soja-26-27/${unidade}.geojson`).features.map((f, i) => ({
    id: `a${i}`,
    safraId: 's',
    fazendaId: 'f',
    codigo: normalizarCodigo(f.properties.codigo),
    areaHa: 1,
    geom: f.geometry,
  }));
  const arq = JSON.parse(readFileSync(PLANTIO, 'utf8')) as PlantioPimsArquivo;
  const pims = new Map<string, PlantioPimsTalhao>();
  const u = arq.safras.find((s) => s.nome === 'SOJA 26/27')?.unidades.find((x) => x.unidade === unidade);
  for (const t of u?.talhoes ?? []) pims.set(normalizarCodigo(t.codigo), t);
  const situacao = situacaoDoMapa(talhoes, areas, [], pims);
  // 4 PICs nos cantos do bbox das áreas
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of talhoes) {
    const polys = t.geom.type === 'Polygon' ? [t.geom.coordinates] : t.geom.coordinates;
    for (const p of polys)
      for (const [x, y] of p[0]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  }
  const interp = talhoesParaInterpolacao(talhoes, areas);
  const inp: PipelineInput = {
    talhoes: interp.map(({ id, nome, setor, geom }) => ({ id, nome, setor, geom })),
    pics: [
      { lon: x0 + 0.001, lat: y0 + 0.001, chuva: 10 },
      { lon: x1 - 0.001, lat: y0 + 0.001, chuva: 20 },
      { lon: x0 + 0.001, lat: y1 - 0.001, chuva: 30 },
      { lon: x1 - 0.001, lat: y1 - 0.001, chuva: 40 },
    ],
    params: { ...IDW_PADRAO, pixel: 20, buffer: 20 },
    plantados: [...situacao.plantadosBase],
    areas: areas.map(({ id, geom }) => ({ id, geom })),
    plantadosAreas: [...situacao.plantadosAreas],
  };
  return { areas, situacao, out: runPipeline(inp) };
}

describe.skipIf(!temDados)('runPipeline — seed real com áreas da cultura', () => {
  it('Dourado: subáreas 032A/032B (dentro do 032) têm estatísticas próprias e a média na área plantada existe', () => {
    const { areas, out } = cenario('DOURADO');
    for (const codigo of ['032A', '032B']) {
      const id = areas.find((a) => a.codigo === codigo)!.id;
      const linha = out.resumo.talhoes.find((t) => t.talhaoId === id)!;
      expect(linha.areaHa, codigo).toBeGreaterThan(1);
      expect(Number.isFinite(linha.media), codigo).toBe(true);
    }
    expect(out.resumo.plantado).not.toBeNull();
    expect(Number.isFinite(out.resumo.plantado!.media)).toBe(true);
  });

  it('Siriema: 023A e 017A (plantados no PIMS, sem talhão base do mesmo código) entram na área plantada', () => {
    const { areas, situacao, out } = cenario('SIRIEMA');
    for (const codigo of ['023A', '017A']) {
      const id = areas.find((a) => a.codigo === codigo)!.id;
      expect(situacao.plantadosAreas.has(id), codigo).toBe(true);
      const linha = out.resumo.talhoes.find((t) => t.talhaoId === id)!;
      expect(linha.areaHa, codigo).toBeGreaterThan(1);
    }
    const plantadas = out.resumo.areas!.filter((a) => situacao.plantadosAreas.has(a.id));
    const soma = plantadas.reduce((s, a) => s + a.areaHa, 0);
    expect(out.resumo.plantado!.areaHa).toBeGreaterThan(0);
    expect(out.resumo.plantado!.areaHa).toBeLessThanOrEqual(soma + 1e-6);
  });
});
