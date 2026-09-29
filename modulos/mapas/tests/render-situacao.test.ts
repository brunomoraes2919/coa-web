import { describe, expect, it } from 'vitest';
import { IDW_PADRAO, type AreaCultura, type LayoutConfig, type StatusPlantio, type Talhao } from '../src/lib/types';
import { desenharTalhoes, type TalhaoPx } from '../src/render/mapFrame';
import { ESTILO_SITUACAO, itensLegendaSituacao, situacaoDe } from '../src/render/situacao';
import type { RenderInput, Vista } from '../src/render/types';

const geom = { type: 'Polygon' as const, coordinates: [] as number[][][] };
const talhao = (id: string): Talhao => ({ id, fazendaId: 'f', nome: id, setor: null, areaHa: 1, geom, atributos: {}, codigo: null });
const area = (id: string): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo: id, areaHa: 1, geom });

function entrada(p: Partial<RenderInput> = {}): RenderInput {
  const config = { estiloPlantado: 'quadriculado', idw: IDW_PADRAO } as unknown as LayoutConfig;
  return {
    config,
    palette: { id: 'p', nome: 'p', classes: [] },
    grid: null,
    talhoes: [],
    situacoes: new Map(),
    areasCultura: [],
    nomeSafra: 'SOJA 26/27',
    pics: [],
    logo: null,
    tiles: null,
    ...p,
  };
}

describe('ESTILO_SITUACAO', () => {
  it('plantado = padrão + contorno laranja 0,7 mm; plantando = hachura e contorno amarelos; a plantar = tracejado cinza 0,45 mm sem preenchimento', () => {
    expect(ESTILO_SITUACAO.plantado).toMatchObject({ preenchimento: 'padrao', contorno: '#DB8A08', larguraMm: 0.7, tracejadoMm: null });
    expect(ESTILO_SITUACAO.plantando).toMatchObject({ preenchimento: 'hachura', contorno: '#F2C200', cor: '#F2C200' });
    expect(ESTILO_SITUACAO.a_plantar).toMatchObject({ preenchimento: null, contorno: '#555555', larguraMm: 0.45 });
    expect(ESTILO_SITUACAO.a_plantar.tracejadoMm?.length).toBe(2);
  });
});

describe('situacaoDe', () => {
  it('usa situacoes; compatível com o antigo `plantados`', () => {
    expect(situacaoDe(entrada({ situacoes: new Map([['a', 'plantando']]) }), 'a')).toBe('plantando');
    expect(situacaoDe(entrada({ situacoes: undefined as unknown as Map<string, StatusPlantio>, plantados: new Set(['a']) }), 'a')).toBe('plantado');
    expect(situacaoDe(entrada(), 'x')).toBeUndefined();
  });
});

describe('itensLegendaSituacao', () => {
  it('sem PIMS nem áreas da cultura: comportamento antigo ("Área plantada – safra")', () => {
    const inp = entrada({ talhoes: [talhao('a'), talhao('b')], situacoes: new Map([['a', 'plantado']]) });
    expect(itensLegendaSituacao(inp)).toEqual({ itens: [{ status: 'plantado', texto: 'Área plantada – SOJA 26/27' }], nota: null });
  });

  it('com áreas da cultura: só as situações presentes, na ordem, e a linha do PIMS', () => {
    const inp = entrada({
      talhoes: [talhao('a')],
      areasCultura: [area('x'), area('y'), area('z')],
      situacoes: new Map<string, StatusPlantio>([
        ['x', 'plantando'],
        ['y', 'plantando'],
      ]),
      plantioGeradoEm: '2026-09-28T07:05:00',
    });
    expect(itensLegendaSituacao(inp)).toEqual({
      itens: [
        { status: 'plantando', texto: 'Plantando' },
        { status: 'a_plantar', texto: 'A plantar' }, // 'z' sem situação = a plantar
      ],
      nota: 'Plantio: PIMS 28/09/2026 07:05',
    });
  });

  it('nada pintado → sem itens nem nota', () => {
    expect(itensLegendaSituacao(entrada({ talhoes: [talhao('a')], plantioGeradoEm: '2026-09-28T07:05:00' }))).toEqual({ itens: [], nota: null });
  });

  it('PIMS nos talhões base: "Plantado – safra"', () => {
    const inp = entrada({ talhoes: [talhao('a')], situacoes: new Map([['a', 'plantado']]), plantioGeradoEm: '2026-09-28T07:05:00' });
    expect(itensLegendaSituacao(inp).itens).toEqual([{ status: 'plantado', texto: 'Plantado – SOJA 26/27' }]);
  });
});

/** Contexto falso que registra clips, cores e tracejados dos traços. */
function ctxGravador() {
  let caminho: number[][] = [];
  const clips: number[][][] = [];
  const tracos: { cor: string; largura: number; tracejado: number[]; caminho: number[][] }[] = [];
  const estado = { strokeStyle: '', lineWidth: 0, dash: [] as number[] };
  const pilha: (typeof estado)[] = [];
  const ctx = {
    globalAlpha: 1,
    lineJoin: '',
    lineCap: '',
    fillStyle: '',
    get strokeStyle() {
      return estado.strokeStyle;
    },
    set strokeStyle(v: string) {
      estado.strokeStyle = v;
    },
    get lineWidth() {
      return estado.lineWidth;
    },
    set lineWidth(v: number) {
      estado.lineWidth = v;
    },
    setLineDash: (d: number[]) => (estado.dash = d),
    save: () => pilha.push({ ...estado }),
    restore: () => Object.assign(estado, pilha.pop()),
    beginPath: () => (caminho = []),
    moveTo: (x: number, y: number) => caminho.push([x, y]),
    lineTo: () => undefined,
    closePath: () => undefined,
    arc: () => undefined,
    clip: () => clips.push(caminho),
    stroke: () => tracos.push({ cor: estado.strokeStyle, largura: estado.lineWidth, tracejado: estado.dash, caminho }),
    fill: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, clips, tracos };
}

const vista: Vista = {
  s: 1,
  x: 0,
  y: 0,
  w: 300,
  h: 200,
  ext: { cx: 0, cy: 0, mPorMm: 1 },
  mPorPx: 1,
  latCentro: 0,
  paraPx: (x, y) => [x, y],
  paraMerc: (x, y) => [x, y],
};
const quadrado = (x: number, y: number, l: number): TalhaoPx['xy'] => [[[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]]];

describe('desenharTalhoes com situações', () => {
  it('sem áreas: plantando = hachura + contorno amarelo; a plantar = tracejado cinza no lugar do contorno preto', () => {
    const { ctx, clips, tracos } = ctxGravador();
    const geoms: TalhaoPx[] = [
      { t: talhao('a'), xy: quadrado(10, 10, 20) },
      { t: talhao('b'), xy: quadrado(50, 10, 20) },
      { t: talhao('c'), xy: quadrado(90, 10, 20) },
    ];
    const inp = entrada({ situacoes: new Map<string, StatusPlantio>([['a', 'plantando'], ['b', 'a_plantar']]) });
    desenharTalhoes(ctx, vista, geoms, inp);
    expect(clips).toEqual([[[10, 10]]]); // só a hachura do "plantando"
    const preto = tracos.filter((t) => t.cor === '#000000' && t.tracejado.length === 0 && t.largura === 0.4);
    expect(preto.map((t) => t.caminho)).toEqual([[[10, 10], [90, 10]]]); // 'b' (a plantar) sai do contorno preto
    expect(tracos.find((t) => t.cor === '#F2C200' && t.largura === 0.7)?.caminho).toEqual([[10, 10]]);
    const cinza = tracos.find((t) => t.cor === '#555555');
    expect(cinza).toMatchObject({ largura: 0.45, caminho: [[50, 10]] });
    expect(cinza!.tracejado.length).toBe(2);
  });

  it('com áreas da cultura: pinta as áreas (sem situação = a plantar) e os talhões base ficam só com o contorno preto', () => {
    const { ctx, clips, tracos } = ctxGravador();
    const geoms: TalhaoPx[] = [{ t: talhao('a'), xy: quadrado(10, 10, 100) }];
    const areas = [
      { id: 'x', xy: quadrado(20, 20, 10) },
      { id: 'y', xy: quadrado(40, 20, 10) },
    ];
    const inp = entrada({ situacoes: new Map([['a', 'plantado'], ['x', 'plantado']]), areasCultura: [area('x'), area('y')] });
    desenharTalhoes(ctx, vista, geoms, inp, areas);
    expect(clips).toEqual([[[20, 20]]]); // padrão do plantado só na área x (o talhão base não é pintado)
    expect(tracos.find((t) => t.cor === '#000000')?.caminho).toEqual([[10, 10]]);
    expect(tracos.find((t) => t.cor === '#DB8A08')).toMatchObject({ largura: 0.7, caminho: [[20, 20]] });
    expect(tracos.find((t) => t.cor === '#555555')?.caminho).toEqual([[40, 20]]);
  });
});
