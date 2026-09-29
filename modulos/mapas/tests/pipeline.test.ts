import { describe, expect, it, vi } from 'vitest';
import { runPipeline, type PipelineInput } from '../src/lib/pipeline';
import { projetorUtm } from '../src/lib/projection';
import { IDW_PADRAO, type Geometry } from '../src/lib/types';

/** Retângulo em graus (lon/lat), anel fechado. */
const ret = (lon0: number, lat0: number, lon1: number, lat1: number): [number, number][] => [
  [lon0, lat0],
  [lon1, lat0],
  [lon1, lat1],
  [lon0, lat1],
  [lon0, lat0],
];

// Dois talhões de ~0,001° × 0,001° (~108 m × 110 m) perto de -57,2 / -13,8 (UTM 21S); B é multipolígono
const geomA: Geometry = { type: 'Polygon', coordinates: [ret(-57.201, -13.801, -57.2, -13.8)] };
const geomB: Geometry = { type: 'MultiPolygon', coordinates: [[ret(-57.199, -13.801, -57.198, -13.8)]] };
const talhoes: PipelineInput['talhoes'] = [
  { id: 'a', nome: 'T01', setor: 'S1', geom: geomA },
  { id: 'b', nome: 'T02', setor: null, geom: geomB },
];

// PICs nos cantos, dentro da região (bbox dos talhões + buffer), como exige o GRASS
const pics = (v: [number, number, number, number]): PipelineInput['pics'] => [
  { lon: -57.2009, lat: -13.8009, chuva: v[0] }, // SO
  { lon: -57.1981, lat: -13.8009, chuva: v[1] }, // SE
  { lon: -57.2009, lat: -13.8001, chuva: v[2] }, // NO
  { lon: -57.1981, lat: -13.8001, chuva: v[3] }, // NE
  { lon: -57.1995, lat: -13.8005, chuva: null }, // sem precipitação: ignorado
];

const entrada = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  talhoes,
  pics: pics([10, 10, 10, 10]),
  params: { ...IDW_PADRAO },
  plantados: [],
  ...over,
});

describe('runPipeline', () => {
  it('com 4 PICs iguais a 10 todas as células valem 10', () => {
    const out = runPipeline(entrada());
    const { grid, resumo } = out;
    expect(grid.epsg).toBe(31981);
    expect(grid.res).toBe(5);
    expect(grid.values).toBeInstanceOf(Float32Array);
    expect(grid.values.length).toBe(grid.cols * grid.rows);
    let validas = 0;
    for (const v of grid.values) {
      if (Number.isNaN(v)) continue;
      validas++;
      expect(v).toBe(10);
    }
    expect(validas).toBeGreaterThan(0);
    expect(resumo.geral.media).toBe(10);
    expect(resumo.geral.min).toBe(10);
    expect(resumo.geral.max).toBe(10);
    expect(resumo.plantado).toBeNull();
    expect(out.picsIgnorados).toEqual([]);
    expect(resumo.talhoes.map((t) => [t.talhaoId, t.nome, t.setor, t.plantado, t.media])).toEqual([
      ['a', 'T01', 'S1', false, 10],
      ['b', 'T02', null, false, 10],
    ]);
  });

  it('grade cobre o bbox + buffer e a máscara inclui o anel de 10 m (disco)', () => {
    const { grid, resumo } = runPipeline(entrada());
    // largura: 0,003° ≈ 324 m + 2 × 10 m de buffer → ~69 colunas de 5 m
    expect(grid.cols).toBeGreaterThanOrEqual(66);
    expect(grid.cols).toBeLessThanOrEqual(71);
    expect(grid.rows).toBeGreaterThanOrEqual(24);
    expect(grid.rows).toBeLessThanOrEqual(28);
    const v = (col: number, row: number) => grid.values[row * grid.cols + col];
    const meio = Math.floor(grid.rows / 2);
    expect(v(0, meio)).toBe(10); // 7,5 m a oeste do talhão A: dentro do buffer
    expect(v(grid.cols - 1, meio)).not.toBeNaN();
    expect(v(0, 0)).toBeNaN(); // canto: fora do disco de 10 m
    expect(v(grid.cols - 1, grid.rows - 1)).toBeNaN();
    expect(v(Math.floor(grid.cols / 2), meio)).toBeNaN(); // entre os talhões (~108 m)

    // área: cada talhão ~1,196 ha (0,001° × 0,001° a 13,8° S), com tolerância da discretização
    for (const t of resumo.talhoes) expect(Math.abs(t.areaHa - 1.196) / 1.196).toBeLessThan(0.08);
    expect(resumo.geral.areaHa).toBeCloseTo(resumo.talhoes[0].areaHa + resumo.talhoes[1].areaHa, 9);
    let validas = 0;
    for (const x of grid.values) if (!Number.isNaN(x)) validas++;
    expect((validas * 25) / 10000).toBeGreaterThan(resumo.geral.areaHa); // buffer fora dos talhões
  });

  it('resume por talhão, geral e plantado preservando a ordem', () => {
    const { grid, resumo } = runPipeline(entrada({ pics: pics([100, 200, 300, 400]), plantados: ['b'] }));
    for (const x of grid.values) if (!Number.isNaN(x)) {
      expect(x).toBeGreaterThanOrEqual(100);
      expect(x).toBeLessThanOrEqual(400);
    }
    const [a, b] = resumo.talhoes;
    expect(a.talhaoId).toBe('a');
    expect(b.talhaoId).toBe('b');
    expect(a.plantado).toBe(false);
    expect(b.plantado).toBe(true);
    for (const t of resumo.talhoes) {
      expect(t.min).toBeLessThanOrEqual(t.media);
      expect(t.media).toBeLessThanOrEqual(t.max);
    }
    expect(b.media).toBeGreaterThan(a.media); // B fica do lado dos PICs 200 e 400
    expect(resumo.plantado).not.toBeNull();
    expect(resumo.plantado!.media).toBeCloseTo(b.media, 9);
    expect(resumo.plantado!.min).toBe(b.min);
    expect(resumo.plantado!.max).toBe(b.max);
    expect(resumo.plantado!.areaHa).toBeCloseTo(b.areaHa, 12);
    const somaArea = a.areaHa + b.areaHa;
    expect(resumo.geral.media).toBeCloseTo((a.media * a.areaHa + b.media * b.areaHa) / somaArea, 4);
    expect(resumo.geral.min).toBe(Math.min(a.min, b.min));
    expect(resumo.geral.max).toBe(Math.max(a.max, b.max));
  });

  it('plantado é null quando nenhum id confere', () => {
    expect(runPipeline(entrada({ plantados: ['nao-existe'] })).resumo.plantado).toBeNull();
  });

  it('exige no mínimo 3 PICs com precipitação', () => {
    const poucos: PipelineInput['pics'] = [
      { lon: -57.202, lat: -13.802, chuva: 10 },
      { lon: -57.197, lat: -13.802, chuva: 20 },
      { lon: -57.202, lat: -13.799, chuva: null },
      { lon: -57.197, lat: -13.799, chuva: null },
    ];
    expect(() => runPipeline(entrada({ pics: poucos }))).toThrow('Mínimo de 3 PICs com precipitação para interpolar');
    expect(() => runPipeline(entrada({ pics: [] }))).toThrow('Mínimo de 3 PICs com precipitação para interpolar');
  });

  it('recusa lista de talhões vazia', () => {
    expect(() => runPipeline(entrada({ talhoes: [] }))).toThrow('Nenhum talhão para interpolar');
  });

  it('recusa parâmetros de interpolação inválidos', () => {
    const invalidos: Partial<typeof IDW_PADRAO>[] = [
      { potencia: 0 },
      { potencia: -2 },
      { potencia: NaN },
      { potencia: Infinity },
      { vizinhos: 0 },
      { vizinhos: 2.5 },
      { vizinhos: NaN },
      { vizinhos: Infinity },
      { pixel: 0 },
      { pixel: -5 },
      { pixel: NaN },
      { pixel: Infinity },
      { buffer: -1 },
      { buffer: NaN },
      { buffer: Infinity },
    ];
    for (const p of invalidos)
      expect(() => runPipeline(entrada({ params: { ...IDW_PADRAO, ...p } })), JSON.stringify(p)).toThrow(
        'Parâmetros de interpolação inválidos',
      );
    // buffer 0 e vizinhos > nº de PICs são válidos
    expect(() => runPipeline(entrada({ params: { ...IDW_PADRAO, buffer: 0, vizinhos: 50 } }))).not.toThrow();
  });

  it('recusa grade grande demais para o pixel (limite de 60 milhões de células)', () => {
    expect(() => runPipeline(entrada({ params: { ...IDW_PADRAO, pixel: 0.01 } }))).toThrow(
      'Área grande demais para o tamanho de pixel escolhido: aumente o pixel em Avançado',
    );
  });

  it('informa o progresso até 1', () => {
    const fs: number[] = [];
    runPipeline(entrada(), (f) => fs.push(f));
    expect(fs.length).toBeGreaterThan(0);
    expect(fs.length).toBeLessThanOrEqual(105);
    for (let i = 1; i < fs.length; i++) expect(fs[i]).toBeGreaterThanOrEqual(fs[i - 1]);
    expect(fs[fs.length - 1]).toBe(1);
  });
});

describe('runPipeline — região do GRASS (v.surf.idw sem -n ignora PICs fora da região)', () => {
  const proj = projetorUtm(31981);
  /** PIC na posição UTM (x, y) da grade */
  const picUtm = (x: number, y: number, chuva: number) => {
    const [lon, lat] = proj.inverse(x, y);
    return { lon, lat, chuva };
  };
  const base = runPipeline(entrada()).grid; // a grade não depende dos PICs

  it('PIC muito longe do bbox não influencia nenhuma célula e aparece em picsIgnorados', () => {
    const [p0, ...resto] = pics([10, 10, 10, 10]);
    const lista = [p0, { lon: -57.3, lat: -13.9, chuva: 1000 }, ...resto]; // índice 1 = longe
    const { grid, resumo, picsIgnorados } = runPipeline(entrada({ pics: lista }));
    expect(picsIgnorados).toEqual([1]);
    for (const v of grid.values) if (!Number.isNaN(v)) expect(v).toBe(10);
    expect(resumo.geral.max).toBe(10);
    // sem PICs fora: lista vazia (o PIC com chuva null não conta)
    expect(runPipeline(entrada()).picsIgnorados).toEqual([]);
  });

  it('meia célula fora das bordas norte/oeste fica (truncamento do C); 1,5 célula fora sai', () => {
    const { x0, y0, res, cols, rows } = base;
    const meioX = x0 + (cols / 2) * res;
    const meioY = y0 - (rows / 2) * res;
    const lista = [
      ...pics([10, 10, 10, 10]),
      picUtm(meioX, y0 + 0.5 * res, 500), // 5: norte, meia célula
      picUtm(x0 - 0.5 * res, meioY, 500), // 6: oeste, meia célula
      picUtm(x0 - 0.5 * res, y0 + 0.5 * res, 500), // 7: canto noroeste
      picUtm(meioX, y0 + 1.5 * res, 500), // 8: norte, 1,5 célula → fora
      picUtm(x0 - 1.5 * res, meioY, 500), // 9: oeste, 1,5 célula → fora
    ];
    const { grid, picsIgnorados } = runPipeline(entrada({ pics: lista }));
    expect(picsIgnorados).toEqual([8, 9]);
    expect(grid.values.some((v) => v > 10)).toBe(true); // os PICs mantidos (500) entram na interpolação
  });

  it('meia célula fora das bordas sul/leste sai', () => {
    const { x0, y0, res, cols, rows } = base;
    const meioX = x0 + (cols / 2) * res;
    const meioY = y0 - (rows / 2) * res;
    const lista = [
      picUtm(meioX, y0 - rows * res - 0.5 * res, 500), // 0: sul
      ...pics([10, 10, 10, 10]),
      picUtm(x0 + cols * res + 0.5 * res, meioY, 500), // 6: leste
      picUtm(x0 + cols * res - 0.5 * res, y0 - rows * res + 0.5 * res, 20), // 7: última célula (dentro)
    ];
    const { picsIgnorados } = runPipeline(entrada({ pics: lista }));
    expect(picsIgnorados).toEqual([0, 6]);
  });

  it('mensagem específica quando a regra da região deixa menos de 3 PICs', () => {
    const [so, se, no, ne] = pics([10, 20, 30, 40]);
    const longe = (chuva: number) => ({ lon: -57.3, lat: -13.9, chuva });
    expect(() => runPipeline(entrada({ pics: [so, se, longe(1), longe(2)] }))).toThrow(
      'Mínimo de 3 PICs com precipitação dentro da área do mapa para interpolar',
    );
    // menos de 3 válidos no total: mensagem original
    expect(() => runPipeline(entrada({ pics: [no, ne, { ...so, chuva: null }] }))).toThrow(
      'Mínimo de 3 PICs com precipitação para interpolar',
    );
  });
});

describe('runPipeline — memória', () => {
  it('converte RangeError de alocação em mensagem em português', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/raster', async (original) => ({
      ...(await original<typeof import('../src/lib/raster')>()),
      rasterizeZones: () => {
        throw new RangeError('Array buffer allocation failed');
      },
    }));
    try {
      const { runPipeline: rodar } = await import('../src/lib/pipeline');
      expect(() => rodar(entrada())).toThrow(
        'Área grande demais para o tamanho de pixel escolhido: aumente o pixel em Avançado',
      );
    } finally {
      vi.doUnmock('../src/lib/raster');
      vi.resetModules();
    }
  });
});
