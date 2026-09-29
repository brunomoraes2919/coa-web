import { describe, expect, it } from 'vitest';
import { mercToLonLat } from '../src/lib/projection';
import { IDW_PADRAO, type Geometry, type LayoutConfig, type LayoutTextos, type Talhao } from '../src/lib/types';
import type { Composicao } from '../src/render/composicao';
import { distribuirColunas, itensLegenda, planejarColunas, rotuloClasse, type LinhaLegenda } from '../src/render/legend';
import { areaVisivel, composicaoDe, desenhoA3, extentsDosQuadros, paginaDe, renderLayout } from '../src/render/layout';
import { criarVista, textoTituloQuadro } from '../src/render/mapFrame';
import { retanguloRosaMm, TAMANHO_ROSA_MM } from '../src/render/northArrow';
import {
  gradeInfo,
  itensInformacao,
  LARGURA_CABECALHO_FAIXA,
  PAD_FAIXA,
  PAD_LATERAL,
  planoFaixa,
  planoLateral,
  VAO_COLUNA_FAIXA,
  VAO_SECAO,
} from '../src/render/painel';
import { areaMediaMm2 } from '../src/render/rotulosMapa';
import { rotulosEscala } from '../src/render/scalebar';
import type { RenderInput } from '../src/render/types';

const X0 = -6_560_000;
const Y0 = -1_520_000;
let seq = 0;
/** Talhão retangular a partir de um bbox em km (Mercator) relativo à origem. */
function talhao(x0: number, y0: number, x1: number, y1: number, setor: string | null = null): Talhao {
  const p = (x: number, y: number) => mercToLonLat(X0 + x * 1000, Y0 + y * 1000);
  const geom: Geometry = { type: 'Polygon', coordinates: [[p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)]] };
  const id = `t${++seq}`;
  return { id, fazendaId: 'f', nome: id, setor, areaHa: 0, geom, atributos: {}, codigo: null };
}
function bloco(x0: number, y0: number, x1: number, y1: number, n: number, m: number, setor: string | null = null): Talhao[] {
  const out: Talhao[] = [];
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / m;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) out.push(talhao(x0 + i * dx, y0 + j * dy, x0 + (i + 1) * dx, y0 + (j + 1) * dy, setor));
  return out;
}

const TEXTOS: LayoutTextos = {
  titulo: 'MAPA DE PRECIPITAÇÃO',
  fazenda: 'SIRIEMA',
  safra: 'SOJA 26/27',
  periodo: '01 a 15/02/2025',
  fonte: 'ZEUS',
  talhoes: 'TODOS',
  setor: 'TODOS',
  observacao: '',
  data: '28/09/2026',
};

function config(p: Partial<LayoutConfig> = {}): LayoutConfig {
  return {
    pagina: 'A3',
    textos: TEXTOS,
    paletaId: 'auto',
    estiloPlantado: 'quadriculado',
    destaquePics: 'escuro',
    mapaBase: 'nenhum',
    mostrarRotulosTalhoes: true,
    mostrarValoresPics: true,
    mostrarGrade: true,
    legendaCompacta: false,
    extent: null,
    idw: IDW_PADRAO,
    ...p,
  };
}

function entrada(talhoes: Talhao[], p: Partial<RenderInput> = {}, c: Partial<LayoutConfig> = {}): RenderInput {
  return {
    config: config(c),
    palette: {
      id: 'p',
      nome: 'p',
      classes: [
        { max: 1, color: '#FFFFFF', label: '<= 1 mm' },
        { max: 5, color: '#1E90FF', label: '1 - 5 mm' },
        { max: 10, color: '#0050C8', label: '5 - 10 mm' },
      ],
    },
    grid: null,
    talhoes,
    situacoes: new Map(),
    areasCultura: [],
    nomeSafra: 'SOJA 26/27',
    pics: [],
    logo: null,
    tiles: null,
    ...p,
  };
}

describe('rotulosEscala', () => {
  it('em km quando o total chega a 1 km (vírgula decimal)', () => {
    expect(rotulosEscala(2500)).toEqual(['0', '2,5', '5 km']);
    expect(rotulosEscala(500)).toEqual(['0', '0,5', '1 km']);
    expect(rotulosEscala(5000)).toEqual(['0', '5', '10 km']);
    expect(rotulosEscala(1000)).toEqual(['0', '1', '2 km']);
  });
  it('em metros abaixo de 1 km', () => {
    expect(rotulosEscala(250)).toEqual(['0', '250', '500 m']);
    expect(rotulosEscala(25)).toEqual(['0', '25', '50 m']);
  });
});

describe('título do quadro e rótulos', () => {
  it('título em caixa alta; vazio sem título', () => {
    expect(textoTituloQuadro('São Miguel')).toBe('SÃO MIGUEL');
    expect(textoTituloQuadro('Bloco 2')).toBe('BLOCO 2');
    expect(textoTituloQuadro(null)).toBe('');
    expect(textoTituloQuadro('  ')).toBe('');
  });
  it('rótulo da classe sem "mm" (está no título) e com ≤', () => {
    expect(rotuloClasse('<= 1 mm')).toBe('≤ 1');
    expect(rotuloClasse('1 - 5 mm')).toBe('1 - 5');
    expect(rotuloClasse('> 150')).toBe('> 150');
  });
  it('área média no papel (mm²) para o tamanho proporcional do rótulo', () => {
    const q = (x: number, l: number) => [[[[x, 0], [x + l, 0], [x + l, l], [x, l], [x, 0]]]] as [number, number][][][];
    const t = { id: 'a' } as Talhao;
    // s = 2 px/mm: quadrados de 20 px e 40 px = 10 mm e 20 mm de lado → (100 + 400) / 2
    expect(areaMediaMm2([{ t, xy: q(0, 20) }, { t, xy: q(50, 40) }], 2)).toBeCloseTo(250, 9);
    expect(areaMediaMm2([], 2)).toBe(0);
  });
  it('rosa de 14 mm no canto superior direito do quadro, a 3 mm das bordas', () => {
    const r = retanguloRosaMm({ x: 6, y: 6, w: 332, h: 285 });
    expect(r.h).toBe(TAMANHO_ROSA_MM);
    expect(r.x + r.w).toBeCloseTo(6 + 332 - 3, 9);
    expect(r.y).toBeCloseTo(9, 9);
  });
});

describe('área visível e página', () => {
  it('a moldura de 6 mm recorta os retângulos da composição', () => {
    expect(areaVisivel({ x: 5, y: 4.4, w: 333, h: 288 }, desenhoA3('paisagem'))).toEqual({ x: 6, y: 6, w: 332, h: 285 });
    const faixa = areaVisivel({ x: 5, y: 347.6, w: 287, h: 68 }, desenhoA3('retrato'));
    expect(faixa.x).toBe(6);
    expect(faixa.y).toBeCloseTo(347.6, 9);
    expect(faixa.w).toBe(285);
    expect(faixa.h).toBeCloseTo(414 - 347.6, 9);
  });
  it('paginaDe segue a orientação da composição (retrato em A4 = 210×297)', () => {
    const alta = bloco(0, 0, 10, 30, 2, 6);
    expect(paginaDe(entrada(alta))).toEqual({ w: 297, h: 420 });
    expect(paginaDe(entrada(alta, {}, { pagina: 'A4' }))).toEqual({ w: 210, h: 297 });
    expect(paginaDe(entrada(alta, {}, { orientacao: 'paisagem' }))).toEqual({ w: 420, h: 297 });
  });
  it('composicaoDe usa cache pela lista de talhões e pelas opções', () => {
    const ts = bloco(0, 0, 10, 10, 2, 2);
    const a = composicaoDe(entrada(ts));
    expect(composicaoDe(entrada(ts))).toBe(a);
    expect(composicaoDe(entrada(ts, {}, { orientacao: 'retrato' }))).not.toBe(a);
  });
});

describe('extentsDosQuadros', () => {
  const siriema = [...bloco(0, 20, 11, 26, 3, 2, 'SIRIEMA'), ...bloco(14, 0, 23, 5, 3, 2, 'SÃO MIGUEL')];

  it('com 2 quadros, cada um enquadra o seu grupo (o extent manual é ignorado)', () => {
    const manual = { cx: 1, cy: 2, mPorMm: 3 };
    const inp = entrada(siriema, {}, { extent: manual });
    const comp = composicaoDe(inp);
    expect(comp.quadros.map((q) => q.titulo)).toEqual(['SIRIEMA', 'SÃO MIGUEL']);
    const exts = extentsDosQuadros(inp, comp);
    expect(exts).toHaveLength(2);
    expect(exts[0]).not.toEqual(manual);
    expect(exts[0].cx).toBeCloseTo(X0 + 5.5 * 1000, 3);
    expect(exts[0].cy).toBeCloseTo(Y0 + 23 * 1000, 3);
    expect(exts[1].cx).toBeCloseTo(X0 + 18.5 * 1000, 3);
    // o grupo cabe no seu quadro com 6% de margem na dimensão que limita
    const q0 = comp.quadros[0].rect;
    expect(Math.max(11000 / (q0.w * 0.88), 6000 / (q0.h * 0.88))).toBeCloseTo(exts[0].mPorMm, 6);
  });

  it('com 1 quadro vale o extent manual; sem ele, enquadra no retângulo da composição', () => {
    const ts = bloco(0, 0, 10, 30, 2, 6);
    const manual = { cx: X0, cy: Y0, mPorMm: 50 };
    expect(extentsDosQuadros(entrada(ts, {}, { extent: manual }), composicaoDe(entrada(ts)))).toEqual([manual]);
    const inp = entrada(ts);
    const comp = composicaoDe(inp);
    expect(comp.orientacao).toBe('retrato');
    const [e] = extentsDosQuadros(inp, comp);
    expect(e.mPorMm).toBeCloseTo(Math.max(10000 / (287 * 0.88), 30000 / (338 * 0.88)), 6);
  });
});

describe('criarVista', () => {
  it('o centro do retângulo da composição é o centro do extent; x/y/w/h = parte visível', () => {
    const ext = { cx: 1000, cy: 2000, mPorMm: 10 };
    const v = criarVista(ext, 2, { x: 5, y: 4.4, w: 333, h: 288 }, { x: 6, y: 6, w: 332, h: 285 });
    expect([v.x, v.y, v.w, v.h]).toEqual([12, 12, 664, 570]);
    const [px, py] = v.paraPx(1000, 2000);
    expect(px).toBeCloseTo((5 + 333 / 2) * 2, 9);
    expect(py).toBeCloseTo((4.4 + 144) * 2, 9);
    const [mx, my] = v.paraMerc(100, 50);
    const [bx, by] = v.paraPx(mx, my);
    expect(bx).toBeCloseTo(100, 9);
    expect(by).toBeCloseTo(50, 9);
    // 1 mm de papel (2 px) = 10 m Mercator; norte para cima
    expect(v.paraPx(1010, 2010)[0] - px).toBeCloseTo(2, 9);
    expect(v.paraPx(1010, 2010)[1] - py).toBeCloseTo(-2, 9);
  });
});

describe('painel: seções', () => {
  it('lateral (paisagem): cabeçalho, informações e legenda de cima para baixo; rodapé no pé', () => {
    const p = { x: 343.5, y: 6, w: 70.5, h: 285 };
    const r = planoLateral(p, { cabecalho: 40, info: 60, rodape: 7 });
    expect(r.cabecalho).toEqual({ x: 343.5 + PAD_LATERAL, y: 6 + PAD_LATERAL, w: 70.5 - 2 * PAD_LATERAL, h: 40 });
    expect(r.info.y).toBeCloseTo(r.cabecalho.y + 40 + VAO_SECAO, 9);
    expect(r.legenda.y).toBeCloseTo(r.info.y + 60 + VAO_SECAO, 9);
    expect(r.rodape.y + r.rodape.h).toBeCloseTo(291 - 4, 9);
    expect(r.legenda.y + r.legenda.h).toBeCloseTo(r.rodape.y - 4, 9);
    expect(r.legenda.x).toBe(r.cabecalho.x);
    expect(r.legenda.w).toBe(r.cabecalho.w);
  });

  it('inferior (retrato): 3 colunas logo+título | informações | legenda à direita', () => {
    const p = { x: 6, y: 347.6, w: 285, h: 66.4 };
    const r = planoFaixa(p, 100, 4.2);
    const x = 6 + PAD_FAIXA;
    const w = 285 - 2 * PAD_FAIXA;
    expect(r.cabecalho.x).toBe(x);
    expect(r.cabecalho.w).toBe(LARGURA_CABECALHO_FAIXA);
    expect(r.legenda.x + r.legenda.w).toBeCloseTo(x + w, 9);
    expect(r.legenda.w).toBe(100);
    expect(r.info.x).toBeCloseTo(x + LARGURA_CABECALHO_FAIXA + VAO_COLUNA_FAIXA, 9);
    expect(r.info.x + r.info.w).toBeCloseTo(r.legenda.x - VAO_COLUNA_FAIXA, 9);
    // mesma altura nas três colunas, acima do rodapé de largura total
    expect(r.cabecalho.h).toBe(r.info.h);
    expect(r.legenda.h).toBe(r.info.h);
    expect(r.rodape).toMatchObject({ x, w, h: 4.2 });
    expect(r.cabecalho.y + r.cabecalho.h).toBeLessThanOrEqual(r.rodape.y);
    expect(r.rodape.y + r.rodape.h).toBeCloseTo(414 - 3.5, 9);
  });

  it('inferior: a legenda não passa de 45% da faixa', () => {
    const p = { x: 6, y: 347.6, w: 285, h: 66.4 };
    expect(planoFaixa(p, Infinity, 4.2).legenda.w).toBeCloseTo(0.45 * (285 - 2 * PAD_FAIXA), 9);
  });
});

describe('gradeInfo', () => {
  it('pares curtos lado a lado; o que não cabe na célula ocupa mais colunas', () => {
    // 2 colunas de 27,5 mm (60 − 5 de vão)
    expect(gradeInfo([20, 40, 10, 10], 60, 2, 5)).toEqual([
      { coluna: 0, linha: 0, span: 1 },
      { coluna: 0, linha: 1, span: 2 },
      { coluna: 1, linha: 0, span: 1 }, // completa a primeira linha
      { coluna: 0, linha: 2, span: 1 },
    ]);
  });
  it('3 colunas: par médio ocupa 2', () => {
    // colunas de 30 mm (100 − 2×5)
    expect(gradeInfo([25, 50, 25, 25], 100, 3, 5)).toEqual([
      { coluna: 0, linha: 0, span: 1 },
      { coluna: 1, linha: 0, span: 2 },
      { coluna: 0, linha: 1, span: 1 },
      { coluna: 1, linha: 1, span: 1 },
    ]);
  });
  it('maior que a linha: linha inteira (o valor quebra em linhas)', () => {
    expect(gradeInfo([500], 60, 2, 5)).toEqual([{ coluna: 0, linha: 0, span: 2 }]);
  });
});

describe('itensInformacao', () => {
  it('ordem do spec, médias do resumo e data do PIMS; vazios ficam de fora', () => {
    const est = (media: number) => ({ media, min: 0, max: 0, areaHa: 0 });
    const inp = entrada([], {
      resumo: { geral: est(3.64), plantado: est(12), talhoes: [] },
      plantioGeradoEm: '2026-09-28T07:05:00',
    });
    expect(itensInformacao(inp)).toEqual([
      { rotulo: 'Safra', valor: 'SOJA 26/27' },
      { rotulo: 'Período', valor: '01 a 15/02/2025' },
      { rotulo: 'Fonte', valor: 'ZEUS' },
      { rotulo: 'Talhões', valor: 'TODOS' },
      { rotulo: 'Setor', valor: 'TODOS' },
      { rotulo: 'Média da fazenda', valor: '3,6 mm' },
      { rotulo: 'Média na área plantada', valor: '12 mm' },
      { rotulo: 'Plantio', valor: 'PIMS 28/09 07:05' },
      { rotulo: 'Data', valor: '28/09/2026' },
    ]);
  });
  it('sem resumo, sem plantado e sem PIMS: só os textos', () => {
    const est = { media: 3, min: 0, max: 0, areaHa: 0 };
    const rotulos = itensInformacao(entrada([], { resumo: { geral: est, plantado: null, talhoes: [] } })).map((p) => p.rotulo);
    expect(rotulos).toContain('Média da fazenda');
    expect(rotulos).not.toContain('Média na área plantada');
    expect(rotulos).not.toContain('Plantio');
    expect(itensInformacao(entrada([])).map((p) => p.rotulo)).not.toContain('Média da fazenda');
  });
});

describe('legenda: itens e colunas', () => {
  it('PICs e situação acima; depois o título "Precipitação (mm)" e as classes (compacta = só as presentes)', () => {
    const inp = entrada([talhao(0, 0, 1, 1)], { pics: [{ id: 'p' } as RenderInput['pics'][number]] });
    inp.situacoes = new Map([[inp.talhoes[0].id, 'plantado']]);
    const itens = itensLegenda(inp, [true, false, true]);
    expect(itens.map((i) => i.tipo)).toEqual(['pic', 'situacao', 'titulo', 'classe', 'classe', 'classe']);
    expect(itens[2].texto).toBe('Precipitação (mm)');
    const compacta = itensLegenda({ ...inp, config: { ...inp.config, legendaCompacta: true } }, [true, false, true]);
    expect(compacta.filter((i) => i.tipo === 'classe').map((i) => i.texto)).toEqual(['≤ 1', '5 - 10']);
    expect(itensLegenda(inp, null).some((i) => i.tipo === 'titulo')).toBe(false);
  });

  const linhas = (n: number, titulos: number[] = []): LinhaLegenda[] =>
    Array.from({ length: n }, (_, i) => ({ h: 5, largura: 20, titulo: titulos.includes(i) }));

  it('distribui em colunas equilibradas, de cima para baixo', () => {
    expect(distribuirColunas(linhas(9), 50, 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ]);
    expect(distribuirColunas(linhas(9), 20, 2)).toBeNull();
    expect(distribuirColunas(linhas(4), 100, 1)).toEqual([[0, 1, 2, 3]]);
  });

  it('um título nunca fica sozinho no pé da coluna', () => {
    // sem a regra, a 1ª coluna seria [0, 1, 2] com o título (2) no pé
    const cols = distribuirColunas(linhas(6, [2]), 15, 3)!;
    expect(cols).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    for (const c of cols) expect(linhas(6, [2])[c[c.length - 1]].titulo).toBe(false);
  });

  it('quebraAntes começa uma coluna nova (classes à direita da situação do plantio)', () => {
    const ls = linhas(8, [2]);
    ls[2] = { ...ls[2], quebraAntes: true };
    expect(distribuirColunas(ls, 100, 2)).toEqual([
      [0, 1],
      [2, 3, 4, 5, 6, 7],
    ]);
    // com mais colunas, equilibra o que vem depois da quebra
    expect(distribuirColunas(ls, 100, 3)).toEqual([
      [0, 1],
      [2, 3, 4],
      [5, 6, 7],
    ]);
    expect(distribuirColunas(ls, 100, 1)).toBeNull();
  });

  it('lateral prefere reduzir a abrir colunas; faixa inferior prefere colunas', () => {
    const ls = linhas(12); // 60 mm em 1 coluna
    const lateral = planejarColunas(ls, { w: 60, h: 50 }, 2, 'reduzir');
    expect(lateral.colunas).toHaveLength(1);
    expect(lateral.k).toBeLessThan(1);
    expect(lateral.h).toBeLessThanOrEqual(50 + 1e-9);
    const faixa = planejarColunas(ls, { w: 120, h: 50 }, 4, 'colunas');
    expect(faixa.k).toBe(1);
    expect(faixa.colunas).toHaveLength(2);
    expect(faixa.w).toBeCloseTo(20 + 5 + 20, 9);
  });

  it('sem espaço: redução máxima (70%) e o máximo de colunas', () => {
    const p = planejarColunas(linhas(40), { w: 30, h: 20 }, 2, 'colunas');
    expect(p.k).toBe(0.7);
    expect(p.colunas).toHaveLength(2);
  });
});

/** Contexto 2D falso: aceita qualquer chamada, mede texto por 0,55 em por caractere e grava os textos. */
function ctxFalso(w: number, h: number) {
  const textos: string[] = [];
  let font = '10px sans-serif';
  const alvo: Record<string | symbol, unknown> = {
    canvas: { width: w, height: h },
    measureText: (t: string) => ({ width: t.length * 0.55 * parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? '10') }),
    fillText: (t: string) => textos.push(t),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  const ctx = new Proxy(alvo, {
    get: (o, k) => (k === 'font' ? font : k in o ? o[k] : () => undefined),
    set: (o, k, v) => {
      if (k === 'font') font = v as string;
      else o[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, textos };
}

describe('renderLayout (fumaça, contexto falso)', () => {
  const logo = { width: 1600, height: 441 } as unknown as CanvasImageSource;
  const est = (media: number) => ({ media, min: 0, max: 0, areaHa: 0 });

  it('2 quadros em paisagem: títulos dos quadros, painel, legenda, rodapé', async () => {
    const ts = [...bloco(0, 20, 11, 26, 3, 2, 'SIRIEMA'), ...bloco(14, 0, 23, 5, 3, 2, 'SÃO MIGUEL')];
    const pics = [{ id: 'p', nome: 'P', lat: mercToLonLat(X0 + 5000, Y0 + 23000)[1], lon: mercToLonLat(X0 + 5000, Y0 + 23000)[0], chuva: 17.4, inativo: false, inicio: null, fim: null, incluir: true }];
    const inp = entrada(ts, { logo, pics, resumo: { geral: est(21), plantado: null, talhoes: [] } });
    const comp: Composicao = composicaoDe(inp);
    expect(comp.quadros).toHaveLength(2);
    const { ctx, textos } = ctxFalso(420 * 2, 297 * 2);
    const { avisos } = await renderLayout(ctx, inp, 2);
    expect(avisos).toEqual([]);
    expect(textos).toEqual(expect.arrayContaining(['SIRIEMA', 'SÃO MIGUEL', 'SIRIEMA', 'Média da fazenda', '21 mm', 'Mapa de Chuva COA · Locks', 'N', '17.4', 'PICs']));
    expect(textos.filter((t) => t === 'N')).toHaveLength(2); // uma rosa por quadro
    expect(textos.some((t) => t.startsWith('Gerado em '))).toBe(true);
  });

  it('retrato (1 quadro, faixa inferior) desenha sem erro; no canvas em paisagem entra no modo de encaixe', async () => {
    const ts = bloco(0, 0, 10, 30, 2, 6);
    const inp = entrada(ts, { logo });
    expect(composicaoDe(inp).painelPosicao).toBe('inferior');
    const certo = ctxFalso(297 * 2, 420 * 2);
    await renderLayout(certo.ctx, inp, 2);
    expect(certo.textos).toEqual(expect.arrayContaining(['MAPA DE PRECIPITAÇÃO', 'Safra', 'SOJA 26/27', 'N']));
    const paisagem = ctxFalso(420 * 2, 297 * 2);
    await expect(renderLayout(paisagem.ctx, inp, 2)).resolves.toEqual({ avisos: [] });
  });
});
