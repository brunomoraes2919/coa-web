import { describe, expect, it } from 'vitest';
import { IDW_PADRAO, type LayoutConfig, type Talhao } from '../src/lib/types';
import { desenharTalhoes, type TalhaoPx } from '../src/render/mapFrame';
import type { RenderInput, Vista } from '../src/render/types';

/** Contexto 2D falso que registra os caminhos usados em cada clip e os traços desenhados. */
function ctxGravador() {
  let caminho: number[][] = [];
  const clips: { caminho: number[][]; regra: string | undefined }[] = [];
  let clipAtivo = 0;
  const pilha: number[] = [];
  let tracosComClip = 0;
  const ctx = {
    globalAlpha: 1,
    save: () => pilha.push(clipAtivo),
    restore: () => {
      clipAtivo = pilha.pop() ?? 0;
    },
    beginPath: () => {
      caminho = [];
    },
    moveTo: (x: number, y: number) => caminho.push([x, y]),
    lineTo: () => undefined,
    closePath: () => undefined,
    arc: () => undefined,
    clip: (regra?: string) => {
      clips.push({ caminho, regra });
      clipAtivo += 1;
    },
    stroke: () => {
      if (clipAtivo) tracosComClip += 1;
    },
    fill: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, clips, tracos: () => tracosComClip };
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

const quadrado = (x: number, y: number, l: number): TalhaoPx['xy'] => [
  [
    [
      [x, y],
      [x + l, y],
      [x + l, y + l],
      [x, y + l],
      [x, y],
    ],
  ],
];

function talhaoPx(id: string, xy: TalhaoPx['xy']): TalhaoPx {
  const t: Talhao = { id, fazendaId: 'f', nome: id, setor: null, areaHa: 1, geom: { type: 'Polygon', coordinates: [] }, atributos: {}, codigo: null };
  return { t, xy };
}

function entrada(plantados: string[]): RenderInput {
  const config = { estiloPlantado: 'quadriculado', idw: IDW_PADRAO } as unknown as LayoutConfig;
  return { config, palette: { id: 'p', nome: 'p', classes: [] }, grid: null, talhoes: [], situacoes: new Map(), areasCultura: [], plantados: new Set(plantados), nomeSafra: '', pics: [], logo: null, tiles: null };
}

describe('desenharTalhoes: padrão dos plantados', () => {
  it('recorta e preenche cada talhão plantado separadamente (a sobreposição não apaga a hachura)', () => {
    const { ctx, clips, tracos } = ctxGravador();
    // dois plantados que se sobrepõem em [50..80] e um não plantado
    const geoms = [talhaoPx('a', quadrado(20, 20, 60)), talhaoPx('b', quadrado(50, 50, 60)), talhaoPx('c', quadrado(200, 20, 40))];

    desenharTalhoes(ctx, vista, geoms, entrada(['a', 'b']));

    // um clip por talhão plantado, cada um só com o anel daquele talhão
    expect(clips).toHaveLength(2);
    expect(clips.map((c) => c.caminho)).toEqual([[[20, 20]], [[50, 50]]]);
    expect(tracos()).toBe(2); // o padrão foi desenhado dentro de cada clip
  });

  it('estilo "só contorno" não recorta nem preenche', () => {
    const { ctx, clips } = ctxGravador();
    const inp = entrada(['a']);
    inp.config.estiloPlantado = 'contorno';
    desenharTalhoes(ctx, vista, [talhaoPx('a', quadrado(20, 20, 60))], inp);
    expect(clips).toHaveLength(0);
  });
});
