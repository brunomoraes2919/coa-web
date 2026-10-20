// Desenho do mapa de variedade: legenda, painel, cor sólida nas feições e nome do arquivo. Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import { nomeArquivoMapa } from '../src/lib/exportar';
import { IDW_PADRAO, type LayoutConfig, type ResumoVariedades, type Talhao } from '../src/lib/types';
import { itensLegenda } from '../src/render/legend';
import { CABECALHO_VARIEDADES, planejarTabelaVariedades } from '../src/render/legendaVariedades';
import { colunasNomeVariedade } from '../src/lib/variedades';
import { desenharTalhoes, type FeicaoPx } from '../src/render/mapFrame';
import type { TalhaoPx } from '../src/render/rotulosMapa';
import { itensInformacao } from '../src/render/painel';
import type { RenderInput, Vista } from '../src/render/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (id: string): Talhao => ({ id, fazendaId: 'f', nome: id, setor: null, areaHa: 1, geom, atributos: {}, codigo: id });
const resumo: ResumoVariedades = {
  totalHa: 100,
  itens: [
    { chave: '84KA92 CE', nome: '84KA92 CE', cor: '#FF7F0E', areaHa: 60, pct: 60, talhoes: 2 },
    { chave: '', nome: 'Sem variedade', cor: '#B5B5B5', areaHa: 40, pct: 40, talhoes: 1 },
  ],
};
const config: LayoutConfig = {
  pagina: 'A3',
  textos: { titulo: 'MAPA DE VARIEDADES', fazenda: 'GLOBO', safra: 'SOJA 26/27', periodo: '', fonte: 'PIMS', talhoes: 'TODOS', setor: 'TODOS', observacao: '', data: '15/10/2026' },
  paletaId: 'auto', estiloPlantado: 'quadriculado', mapaBase: 'nenhum', mostrarRotulosTalhoes: true, mostrarValoresPics: false,
  mostrarGrade: false, legendaCompacta: false, extent: null, idw: IDW_PADRAO,
};
const entrada = (p: Partial<RenderInput> = {}): RenderInput => ({
  config, palette: { id: 'variedade', nome: 'Variedade', classes: [] }, grid: null, talhoes: [talhao('t1'), talhao('t2')],
  situacoes: new Map(), areasCultura: [], plantioGeradoEm: '2026-10-15T10:17:00.000Z', resumo: null, nomeSafra: 'SOJA 26/27',
  pics: [], logo: null, tiles: null,
  variedades: { cores: new Map([['t1', '#FF7F0E'], ['t2', '#B5B5B5']]), resumo },
  ...p,
});

describe('legenda e painel do mapa de variedade', () => {
  it('legenda: título "Variedades" e uma linha por variedade, na ordem do resumo', () => {
    expect(itensLegenda(entrada(), null)).toEqual([
      { tipo: 'titulo', texto: 'Variedades' },
      { tipo: 'classe', texto: '84KA92 CE — 60 ha (60%)', cor: '#FF7F0E' },
      { tipo: 'classe', texto: 'Sem variedade — 40 ha (40%)', cor: '#B5B5B5' },
    ]);
  });
  it('painel: safra, fonte, área total, nº de variedades (sem contar "Sem variedade"), talhões, setor, plantio e data', () => {
    expect(itensInformacao(entrada()).map((p) => [p.rotulo, p.valor])).toEqual([
      ['Safra', 'SOJA 26/27'],
      ['Fonte', 'PIMS'],
      ['Área total', '100 ha'],
      ['Variedades', '1'],
      ['Talhões', 'TODOS'],
      ['Setor', 'TODOS'],
      ['Plantio', expect.stringMatching(/^PIMS \d{2}\/\d{2} \d{2}:\d{2}$/)],
      ['Data', '15/10/2026'],
    ]);
  });
  it('sem `variedades`, a legenda e o painel são os do mapa de chuva (nada muda)', () => {
    expect(itensLegenda(entrada({ variedades: null }), null)).toEqual([]);
    expect(itensInformacao(entrada({ variedades: null })).map((p) => p.rotulo)).not.toContain('Variedades');
  });
});

describe('cor sólida nas feições', () => {
  const vista: Vista = { s: 1, x: 0, y: 0, w: 300, h: 200, ext: { cx: 0, cy: 0, mPorMm: 1 }, mPorPx: 1, latCentro: 0, paraPx: (x, y) => [x, y], paraMerc: (x, y) => [x, y] };
  const quadrado = (x: number): TalhaoPx['xy'] => [[[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]]]];
  function gravador() {
    const preenchidos: string[] = [];
    let clips = 0;
    let estilo = '';
    const ctx = {
      save: () => undefined, restore: () => undefined, beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
      closePath: () => undefined, stroke: () => undefined, setLineDash: () => undefined,
      clip: () => { clips += 1; },
      fill: () => { preenchidos.push(estilo); },
      set fillStyle(v: string) { estilo = v; },
      get fillStyle() { return estilo; },
      lineWidth: 1, strokeStyle: '', lineJoin: 'miter',
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, preenchidos, clips: () => clips };
  }
  it('talhões base: cada um com a cor da variedade, sem os padrões da situação do plantio', () => {
    const g = gravador();
    const inp = entrada();
    const geoms: TalhaoPx[] = inp.talhoes.map((t, i) => ({ t, xy: quadrado(i * 20) }));
    desenharTalhoes(g.ctx, vista, geoms, inp);
    expect(g.preenchidos).toEqual(['#FF7F0E', '#B5B5B5']);
    expect(g.clips()).toBe(0);
  });
  it('com áreas da cultura: pinta as áreas (pelo id delas), não os talhões base', () => {
    const g = gravador();
    const inp = entrada({ variedades: { cores: new Map([['a1', '#2CA02C']]), resumo } });
    const geoms: TalhaoPx[] = inp.talhoes.map((t, i) => ({ t, xy: quadrado(i * 20) }));
    const areas: FeicaoPx[] = [{ id: 'a1', xy: quadrado(50) }];
    desenharTalhoes(g.ctx, vista, geoms, inp, areas);
    expect(g.preenchidos).toEqual(['#2CA02C']);
  });
});

describe('nome do arquivo', () => {
  it('prefixo do mapa de variedade', () => {
    expect(nomeArquivoMapa('Três Flechas', 'SOJA 26/27', 'png', 'MAPA_VARIEDADE')).toBe('MAPA_VARIEDADE_TRES_FLECHAS_SOJA_26-27.png');
    expect(nomeArquivoMapa('Globo', '01/02/2025 a 15/02/2025')).toBe('MAPA_CHUVA_GLOBO_01-02-2025_A_15-02-2025.png');
  });
});

describe('legenda em tabela (nome comercial | nome do PIMS | ha | %)', () => {
  // canvas falso: largura proporcional ao nº de caracteres e ao tamanho da fonte; grava os textos e onde saem
  function ctxFalso() {
    const textos: { t: string; x: number; y: number }[] = [];
    let px = 10;
    const ctx = {
      save: () => undefined, restore: () => undefined, beginPath: () => undefined, rect: () => undefined, clip: () => undefined,
      roundRect: () => undefined, fill: () => undefined, stroke: () => undefined, fillRect: () => undefined,
      set font(f: string) { px = Number(/([\d.]+)px/.exec(f)?.[1] ?? 10); },
      get font() { return `${px}px`; },
      measureText: (t: string) => ({ width: t.length * px * 0.55 }),
      fillText: (t: string, x: number, y: number) => { textos.push({ t, x, y }); },
      fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic',
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, textos };
  }
  const comNomes: ResumoVariedades = {
    totalHa: 100,
    itens: [
      { chave: '80I82 IPRO', nome: 'Brasmax Olimpo IPRO (80I82 IPRO)', nomePims: '80I82 IPRO', comercial: 'Brasmax Olimpo IPRO', cor: '#1F77B4', areaHa: 60, pct: 60, talhoes: 2 },
      { chave: 'STINE', nome: 'STINE', nomePims: 'STINE', comercial: '', cor: '#FF7F0E', areaHa: 30, pct: 30, talhoes: 1 },
      { chave: '', nome: 'Sem variedade', nomePims: 'Sem variedade', comercial: '', cor: '#B5B5B5', areaHa: 10, pct: 10, talhoes: 1 },
    ],
  };

  it('painel lateral: cabeçalho, nome comercial e nome do PIMS em colunas, "—" sem nome comercial, dentro da largura', () => {
    const { ctx, textos } = ctxFalso();
    const area = { w: 61.4, h: 150 };
    const plano = planejarTabelaVariedades(ctx, comNomes, area, 4, 'lateral')!;
    expect(plano.w).toBeLessThanOrEqual(area.w + 1e-9);
    expect(plano.h).toBeLessThanOrEqual(area.h + 1e-9);
    plano.desenhar(0, 0);
    const ts = textos.map((x) => x.t);
    expect(ts).toEqual(expect.arrayContaining(['Variedades', ...CABECALHO_VARIEDADES, '80I82 IPRO', 'STINE', '—', '60', '30']));
    expect(ts.join(' ')).toContain('Olimpo');
    expect(ts.join(' ')).toContain('Sem variedade');
    // nome comercial numa coluna à esquerda da do PIMS, na mesma linha
    const xCom = textos.find((x) => x.t.includes('Brasmax'))!;
    const xPims = textos.find((x) => x.t === '80I82 IPRO')!;
    expect(xCom.x).toBeLessThan(xPims.x);
    expect(xCom.y).toBeCloseTo(xPims.y, 5);
  });

  it('resumo gravado antes do nome comercial (sem nomePims): o nome mostrado vai na coluna do PIMS', () => {
    const { ctx, textos } = ctxFalso();
    planejarTabelaVariedades(ctx, resumo, { w: 61.4, h: 150 }, 4, 'lateral')!.desenhar(0, 0);
    const ts = textos.map((x) => x.t);
    expect(ts).toContain('84KA92 CE');
    expect(ts.filter((t) => t === '—')).toHaveLength(2);
  });

  it('faixa inferior baixa: divide as linhas em blocos lado a lado, cada um com cabeçalho', () => {
    const { ctx, textos } = ctxFalso();
    const muitos: ResumoVariedades = {
      totalHa: 120,
      itens: Array.from({ length: 12 }, (_, i) => ({ chave: `V${i}`, nome: `V${i}`, nomePims: `V${i}`, comercial: `Marca ${i}`, cor: '#1F77B4', areaHa: 10, pct: 100 / 12, talhoes: 1 })),
    };
    const plano = planejarTabelaVariedades(ctx, muitos, { w: 160, h: 40 }, 4, 'inferior')!;
    expect(plano.h).toBeLessThanOrEqual(40 + 1e-9);
    plano.desenhar(0, 0);
    expect(textos.filter((x) => x.t === 'Nome comercial').length).toBeGreaterThan(1);
  });

  it('tabela da tela e legenda pegam as duas colunas do mesmo jeito', () => {
    expect(colunasNomeVariedade(comNomes.itens[0])).toEqual({ comercial: 'Brasmax Olimpo IPRO', pims: '80I82 IPRO' });
    expect(colunasNomeVariedade(comNomes.itens[2])).toEqual({ comercial: '', pims: 'Sem variedade' });
    expect(colunasNomeVariedade(resumo.itens[0])).toEqual({ comercial: '', pims: '84KA92 CE' });
  });
});
