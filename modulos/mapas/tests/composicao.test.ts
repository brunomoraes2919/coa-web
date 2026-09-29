import { existsSync, readFileSync } from 'node:fs';
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { mercToLonLat } from '../src/lib/projection';
import type { Geometry, Talhao } from '../src/lib/types';
import {
  agruparTalhoes,
  aproveitamento,
  compor,
  fracoesAltura,
  tamanhoRotuloMm,
  type Composicao,
} from '../src/render/composicao';
import type { Rect } from '../src/render/labels';

/** Origem Mercator perto da Siriema (~13° S, 59° O); os retângulos dos testes são em km a partir dela. */
const X0 = -6_560_000;
const Y0 = -1_520_000;

let seq = 0;
/** Talhão retangular a partir de um bbox em km (Mercator) relativo à origem. */
function talhao(x0: number, y0: number, x1: number, y1: number, setor: string | null = null): Talhao {
  const p = (x: number, y: number) => mercToLonLat(X0 + x * 1000, Y0 + y * 1000);
  const geom: Geometry = {
    type: 'Polygon',
    coordinates: [[p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, y0)]],
  };
  const id = `t${++seq}`;
  return { id, fazendaId: 'f', nome: id, setor, areaHa: 0, geom, atributos: {}, codigo: null };
}

/** Bloco de n×m talhões encostados cobrindo o bbox (km). */
function bloco(x0: number, y0: number, x1: number, y1: number, n: number, m: number, setor: string | null = null): Talhao[] {
  const out: Talhao[] = [];
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / m;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) out.push(talhao(x0 + i * dx, y0 + j * dy, x0 + (i + 1) * dx, y0 + (j + 1) * dy, setor));
  return out;
}

const AUTO = { orientacao: 'auto', quadros: 'auto', pagina: 'A3' } as const;
const perto = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const rectPerto = (a: Rect, b: Rect, eps = 1e-6) =>
  perto(a.x, b.x, eps) && perto(a.y, b.y, eps) && perto(a.w, b.w, eps) && perto(a.h, b.h, eps);

describe('tamanhoRotuloMm', () => {
  it('2,1 mm quando a área média é 40 mm²', () => {
    expect(tamanhoRotuloMm(40)).toBeCloseTo(2.1, 10);
  });
  it('cresce com a raiz da área média', () => {
    expect(tamanhoRotuloMm(60)).toBeCloseTo(2.1 * Math.sqrt(1.5), 10);
  });
  it('limita entre 1,6 e 3,2 mm', () => {
    expect(tamanhoRotuloMm(0)).toBe(1.6);
    expect(tamanhoRotuloMm(5)).toBe(1.6);
    expect(tamanhoRotuloMm(10_000)).toBe(3.2);
  });
  it('valor inválido cai no mínimo', () => {
    expect(tamanhoRotuloMm(Number.NaN)).toBe(1.6);
    expect(tamanhoRotuloMm(-10)).toBe(1.6);
  });
});

describe('agruparTalhoes', () => {
  it('talhões encostados formam um único grupo com o bbox da união', () => {
    const ts = bloco(0, 0, 30, 30, 3, 3);
    const g = agruparTalhoes(ts);
    expect(g).toHaveLength(1);
    expect(g[0].ids.sort()).toEqual(ts.map((t) => t.id).sort());
    const [x0, y0, x1, y1] = g[0].bbox;
    expect(x0).toBeCloseTo(X0, 3);
    expect(y0).toBeCloseTo(Y0, 3);
    expect(x1).toBeCloseTo(X0 + 30_000, 3);
    expect(y1).toBeCloseTo(Y0 + 30_000, 3);
  });

  it('dois blocos afastados → 2 grupos, ordem norte→sul', () => {
    const sul = bloco(20, 0, 30, 10, 2, 2, 'B');
    const norte = bloco(0, 30, 10, 40, 2, 2, 'A');
    const g = agruparTalhoes([...sul, ...norte]);
    expect(g).toHaveLength(2);
    expect(g[0].setor).toBe('A');
    expect(g[1].setor).toBe('B');
  });

  it('blocos na mesma faixa de latitude ficam em ordem oeste→leste', () => {
    const leste = bloco(40, 0.5, 50, 10.5, 1, 1, 'L');
    const oeste = bloco(0, 0, 10, 10, 1, 1, 'O');
    const g = agruparTalhoes([...leste, ...oeste]);
    expect(g.map((x) => x.setor)).toEqual(['O', 'L']);
  });

  it('dois blocos próximos (vão menor que a folga) → 1 grupo', () => {
    // maior lado do conjunto = 20,5 km; folga 8% = 1,64 km; vão = 0,5 km
    const g = agruparTalhoes([...bloco(0, 0, 10, 10, 2, 2), ...bloco(10.5, 0, 20.5, 10, 2, 2)]);
    expect(g).toHaveLength(1);
  });

  it('a folga é parâmetro', () => {
    const ts = [...bloco(0, 0, 10, 10, 1, 1), ...bloco(12, 0, 22, 10, 1, 1)]; // vão 2 km; maior lado 22
    expect(agruparTalhoes(ts)).toHaveLength(2); // 8% de 22 = 1,76 < 2
    expect(agruparTalhoes(ts, 0.1)).toHaveLength(1); // 10% de 22 = 2,2 ≥ 2
  });

  it('funde grupos cujos bboxes se sobrepõem (em "L")', () => {
    // barra horizontal em cima e uma barra vertical que só encosta no bbox depois da primeira união
    const ts = [talhao(0, 20, 30, 25), talhao(25, 0, 30, 19.9), talhao(10, 10, 12, 12)];
    const g = agruparTalhoes(ts);
    expect(g).toHaveLength(1);
  });

  it('setor do grupo = setor comum; misto ou vazio → null', () => {
    const g = agruparTalhoes([talhao(0, 0, 1, 1, 'X'), talhao(1, 0, 2, 1, 'Y')]);
    expect(g[0].setor).toBeNull();
    expect(agruparTalhoes([talhao(0, 0, 1, 1, 'X'), talhao(1, 0, 2, 1, 'X')])[0].setor).toBe('X');
    expect(agruparTalhoes([talhao(0, 0, 1, 1)])[0].setor).toBeNull();
  });

  it('sem talhões → nenhum grupo; geometria inválida é ignorada', () => {
    expect(agruparTalhoes([])).toEqual([]);
    const ruim = { ...talhao(0, 0, 1, 1), geom: { type: 'Polygon', coordinates: [] } as Geometry };
    expect(agruparTalhoes([ruim])).toEqual([]);
  });
});

describe('aproveitamento', () => {
  it('bbox com a mesma proporção do quadro ocupa 88% × 88% (margem de 6% por lado)', () => {
    expect(aproveitamento([[0, 0, 333, 288]], [{ x: 5, y: 4.4, w: 333, h: 288 }])).toBeCloseTo(0.88 * 0.88, 10);
    expect(aproveitamento([[0, 0, 1000, 1000]], [{ x: 0, y: 0, w: 100, h: 100 }])).toBeCloseTo(0.7744, 10);
  });

  it('bbox alongado num quadro quadrado aproveita menos', () => {
    // 2:1 num quadrado: largura limita → 88 × 44 de 100 × 100
    expect(aproveitamento([[0, 0, 2000, 1000]], [{ x: 0, y: 0, w: 100, h: 100 }])).toBeCloseTo((88 * 44) / 10_000, 10);
  });

  it('um bbox por quadro: soma das áreas / soma das áreas dos quadros', () => {
    const v = aproveitamento(
      [
        [0, 0, 10, 10],
        [0, 0, 20, 10],
      ],
      [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 0, y: 104, w: 100, h: 100 },
      ],
    );
    expect(v).toBeCloseTo((88 * 88 + 88 * 44) / 20_000, 10);
  });

  it('vários bboxes num quadro só: enquadra a união e soma só as áreas dos bboxes', () => {
    // dois quadrados de 10 separados por 20 → união 50 × 10; escala limitada pela largura (88/50)
    const k = 88 / 50;
    const v = aproveitamento(
      [
        [0, 0, 10, 10],
        [40, 0, 50, 10],
      ],
      [{ x: 0, y: 0, w: 100, h: 100 }],
    );
    expect(v).toBeCloseTo((2 * 100 * k * k) / 10_000, 10);
  });

  it('nada para enquadrar → 0', () => {
    expect(aproveitamento([], [{ x: 0, y: 0, w: 100, h: 100 }])).toBe(0);
    expect(aproveitamento([[0, 0, 0, 0]], [{ x: 0, y: 0, w: 100, h: 100 }])).toBe(0);
  });
});

const PAISAGEM_QUADRO: Rect = { x: 5, y: 4.4, w: 333, h: 288 };
const PAISAGEM_PAINEL: Rect = { x: 343.5, y: 4.4, w: 71.4, h: 288 };
const RETRATO_QUADRO: Rect = { x: 5, y: 4.4, w: 287, h: 338 };
const RETRATO_PAINEL: Rect = { x: 5, y: 347.6, w: 287, h: 68 };

describe('compor — quadro único', () => {
  it('fazenda quadrada → paisagem, 1 quadro, geometria atual do A3', () => {
    const ts = bloco(0, 0, 30, 30, 3, 3);
    const c = compor(ts, AUTO);
    expect(c.orientacao).toBe('paisagem');
    expect(c.pagina).toEqual({ w: 420, h: 297 });
    expect(c.painelPosicao).toBe('lateral');
    expect(c.quadros).toHaveLength(1);
    expect(rectPerto(c.quadros[0].rect, PAISAGEM_QUADRO)).toBe(true);
    expect(rectPerto(c.painel, PAISAGEM_PAINEL)).toBe(true);
    expect(c.quadros[0].titulo).toBeNull();
    expect(c.quadros[0].grupo.ids).toHaveLength(9);
  });

  it('alongada na vertical → retrato com painel embaixo', () => {
    const c = compor(bloco(0, 0, 13, 31, 2, 6), AUTO);
    expect(c.orientacao).toBe('retrato');
    expect(c.pagina).toEqual({ w: 297, h: 420 });
    expect(c.painelPosicao).toBe('inferior');
    expect(c.quadros).toHaveLength(1);
    expect(rectPerto(c.quadros[0].rect, RETRATO_QUADRO)).toBe(true);
    expect(rectPerto(c.painel, RETRATO_PAINEL)).toBe(true);
  });

  it('limiar 1,25: 1,2 fica em paisagem, 1,3 vai para retrato', () => {
    expect(compor(bloco(0, 0, 10, 12, 1, 1), AUTO).orientacao).toBe('paisagem');
    expect(compor(bloco(0, 0, 10, 13, 1, 1), AUTO).orientacao).toBe('retrato');
  });

  it('orientação forçada vence o automático', () => {
    expect(compor(bloco(0, 0, 13, 31, 1, 1), { ...AUTO, orientacao: 'paisagem' }).orientacao).toBe('paisagem');
    const r = compor(bloco(0, 0, 30, 10, 1, 1), { ...AUTO, orientacao: 'retrato' });
    expect(r.orientacao).toBe('retrato');
    expect(r.painelPosicao).toBe('inferior');
  });

  it('A4: página real menor, retângulos continuam em mm do A3 (desenho × 297/420)', () => {
    const c = compor(bloco(0, 0, 30, 30, 1, 1), { ...AUTO, pagina: 'A4' });
    expect(c.pagina).toEqual({ w: 297, h: 210 });
    expect(rectPerto(c.quadros[0].rect, PAISAGEM_QUADRO)).toBe(true);
    const r = compor(bloco(0, 0, 10, 30, 1, 1), { ...AUTO, pagina: 'A4' });
    expect(r.pagina).toEqual({ w: 210, h: 297 });
  });

  it('campos ausentes (mapa antigo) = auto', () => {
    const c = compor(bloco(0, 0, 13, 31, 1, 1), { pagina: 'A3' });
    expect(c.orientacao).toBe('retrato');
  });

  it('sem talhões → paisagem, 1 quadro vazio', () => {
    const c = compor([], AUTO);
    expect(c.orientacao).toBe('paisagem');
    expect(c.quadros).toHaveLength(1);
    expect(c.quadros[0].grupo.ids).toEqual([]);
  });
});

/** Siriema sintética: bloco SIRIEMA (11 × 6 km) a noroeste e SÃO MIGUEL (9 × 5 km) a sudeste. */
function siriema(): Talhao[] {
  return [...bloco(0, 21, 11, 27, 4, 2, 'SIRIEMA'), ...bloco(17, 0, 26, 5, 3, 2, 'SÃO MIGUEL')];
}

function conferirPilha(c: Composicao, area: Rect): void {
  const rs = c.quadros.map((q) => q.rect);
  for (const r of rs) {
    expect(r.x).toBeCloseTo(area.x, 9);
    expect(r.w).toBeCloseTo(area.w, 9);
  }
  expect(rs[0].y).toBeCloseTo(area.y, 9);
  for (let i = 1; i < rs.length; i++) expect(rs[i].y).toBeCloseTo(rs[i - 1].y + rs[i - 1].h + 4, 9);
  const ult = rs[rs.length - 1];
  expect(ult.y + ult.h).toBeCloseTo(area.y + area.h, 9);
}

describe('compor — vários quadros', () => {
  it('dois blocos afastados → 2 quadros empilhados, título = setor', () => {
    const c = compor(siriema(), AUTO);
    expect(c.quadros).toHaveLength(2);
    expect(c.quadros.map((q) => q.titulo)).toEqual(['SIRIEMA', 'SÃO MIGUEL']);
    expect(c.quadros[0].grupo.ids).toHaveLength(8);
    expect(c.quadros[1].grupo.ids).toHaveLength(6);
    expect(c.orientacao).toBe('paisagem'); // conjunto empilhado: 11 km de altura × 11 km de largura
    conferirPilha(c, PAISAGEM_QUADRO);
    // alturas proporcionais às alturas dos bboxes (6 : 5)
    const [a, b] = c.quadros.map((q) => q.rect.h);
    expect(a / b).toBeCloseTo(6 / 5, 6);
  });

  it('blocos com setores misturados → título "Bloco N"', () => {
    const ts = [...bloco(0, 21, 11, 27, 2, 1, 'A'), talhao(0, 20, 11, 21, 'B'), ...bloco(17, 0, 26, 5, 2, 1, 'A')];
    const c = compor(ts, AUTO);
    expect(c.quadros.map((q) => q.titulo)).toEqual(['Bloco 1', 'A']);
  });

  it('dois blocos próximos → 1 quadro', () => {
    const c = compor([...bloco(0, 0, 10, 10, 2, 2, 'A'), ...bloco(10.5, 0, 20.5, 10, 2, 2, 'B')], AUTO);
    expect(c.quadros).toHaveLength(1);
    expect(c.quadros[0].titulo).toBeNull();
  });

  it('dois grupos lado a lado sem ganho de 1,5× → 1 quadro', () => {
    // dois quadrados de 10 km com vão de 3 km: separar não compensa
    const c = compor([...bloco(0, 0, 10, 10, 1, 1, 'A'), ...bloco(13, 0, 23, 10, 1, 1, 'B')], AUTO);
    expect(agruparTalhoes([...bloco(0, 0, 10, 10, 1, 1), ...bloco(13, 0, 23, 10, 1, 1)])).toHaveLength(2);
    expect(c.quadros).toHaveLength(1);
  });

  it('mais de 3 grupos → 1 quadro', () => {
    const ts = [0, 40, 80, 120].flatMap((x) => bloco(x, x, x + 5, x + 5, 1, 1));
    expect(agruparTalhoes(ts)).toHaveLength(4);
    expect(compor(ts, AUTO).quadros).toHaveLength(1);
  });

  it('quadros: 1 força um quadro só', () => {
    const c = compor(siriema(), { ...AUTO, quadros: 1 });
    expect(c.quadros).toHaveLength(1);
    expect(c.quadros[0].grupo.ids).toHaveLength(14);
    expect(c.quadros[0].titulo).toBeNull();
  });

  it("quadros: 'setor' com 2 setores → 2 quadros, mesmo encostados", () => {
    const ts = [...bloco(0, 10, 10, 20, 2, 2, 'NORTE'), ...bloco(0, 0, 10, 10, 2, 2, 'SUL')];
    expect(agruparTalhoes(ts)).toHaveLength(1);
    const c = compor(ts, { ...AUTO, quadros: 'setor' });
    expect(c.quadros.map((q) => q.titulo)).toEqual(['NORTE', 'SUL']);
    expect(c.quadros[0].grupo.setor).toBe('NORTE');
    conferirPilha(c, c.orientacao === 'retrato' ? RETRATO_QUADRO : PAISAGEM_QUADRO);
  });

  it("quadros: 'setor' com um setor só → 1 quadro", () => {
    const c = compor(bloco(0, 0, 10, 10, 2, 2, 'X'), { ...AUTO, quadros: 'setor' });
    expect(c.quadros).toHaveLength(1);
  });

  it('pilha em retrato quando o conjunto empilhado é alto', () => {
    // dois blocos 10 × 8 afastados: empilhados = 16 de altura × 10 de largura → retrato
    const ts = [...bloco(0, 40, 10, 48, 1, 1, 'A'), ...bloco(40, 0, 50, 8, 1, 1, 'B')];
    const c = compor(ts, AUTO);
    expect(c.quadros).toHaveLength(2);
    expect(c.orientacao).toBe('retrato');
    expect(c.painelPosicao).toBe('inferior');
    conferirPilha(c, RETRATO_QUADRO);
  });

  it('cada quadro tem no mínimo 30% da altura útil', () => {
    const ts = [...bloco(0, 40, 10, 58, 1, 1, 'ALTO'), ...bloco(40, 0, 50, 1, 1, 1, 'BAIXO')];
    const c = compor(ts, { ...AUTO, quadros: 'setor', orientacao: 'retrato' });
    const util = RETRATO_QUADRO.h - 4;
    expect(c.quadros[1].rect.h).toBeCloseTo(0.3 * util, 9);
    expect(c.quadros[0].rect.h).toBeCloseTo(0.7 * util, 9);
  });

  const quadrado10 = (x: number, y: number, setor: string) => bloco(x, y, x + 10, y + 10, 1, 1, setor);
  const conferirLimite = (c: Composicao, n: number) => {
    expect(c.quadros).toHaveLength(3);
    for (const q of c.quadros) expect(q.rect.h).toBeGreaterThan(0);
    conferirPilha(c, c.orientacao === 'retrato' ? RETRATO_QUADRO : PAISAGEM_QUADRO);
    const area = c.orientacao === 'retrato' ? RETRATO_QUADRO : PAISAGEM_QUADRO;
    const soma = c.quadros.reduce((s, q) => s + q.rect.h, 0) + 4 * (c.quadros.length - 1);
    expect(soma).toBeCloseTo(area.h, 9);
    expect(c.quadros.flatMap((q) => q.grupo.ids)).toHaveLength(n);
  };

  it("'setor' com 4 setores iguais → 3 quadros; o que sobra vai para o quadro mais próximo", () => {
    const ts = [quadrado10(0, 60, 'A'), quadrado10(30, 40, 'B'), quadrado10(0, 20, 'C'), quadrado10(30, 0, 'D')].flat();
    const c = compor(ts, { ...AUTO, quadros: 'setor' });
    conferirLimite(c, 4);
    expect(c.quadros.map((q) => q.titulo)).toEqual(['A', 'B', 'Bloco 3']);
    expect(c.quadros[2].grupo.setor).toBeNull();
  });

  it("'setor' com 5 setores iguais → 3 quadros, alturas positivas", () => {
    const ts = [0, 1, 2, 3, 4].flatMap((i) => quadrado10(i * 30, 100 - i * 25, `S${i}`));
    for (const orientacao of ['auto', 'paisagem', 'retrato'] as const) conferirLimite(compor(ts, { ...AUTO, quadros: 'setor', orientacao }), 5);
  });

  it("'setor' com 4 setores: ficam os 3 de maior bbox", () => {
    const ts = [
      ...bloco(0, 100, 2, 102, 1, 1, 'PEQUENO'),
      ...bloco(0, 70, 20, 90, 2, 2, 'A'),
      ...bloco(40, 40, 60, 60, 2, 2, 'B'),
      ...bloco(0, 0, 20, 20, 2, 2, 'C'),
    ];
    const c = compor(ts, { ...AUTO, quadros: 'setor' });
    expect(c.quadros.map((q) => q.titulo)).toEqual(['Bloco 1', 'B', 'C']);
    expect(c.quadros[0].grupo.ids).toHaveLength(5);
  });
});

describe('fracoesAltura', () => {
  const soma = (f: number[]) => f.reduce((a, b) => a + b, 0);
  it('proporcional, com mínimo de 30% para até 3 quadros', () => {
    expect(fracoesAltura([1, 1])).toEqual([0.5, 0.5]);
    const f = fracoesAltura([9, 1]);
    expect(f[0]).toBeCloseTo(0.7, 12);
    expect(f[1]).toBeCloseTo(0.3, 12);
  });
  it('com mais quadros o mínimo vira 1/n; soma 1 e nada negativo', () => {
    expect(fracoesAltura([1, 1, 1, 1, 1]).every((x) => Math.abs(x - 0.2) < 1e-12)).toBe(true);
    for (const hs of [[100, 1, 1, 1, 1], [1, 1, 1, 1], [5, 0, 0, 3], [0, 0, 0, 0, 0, 0], [3, 2, 1, 1, 1, 1, 1]]) {
      const f = fracoesAltura(hs);
      expect(soma(f)).toBeCloseTo(1, 12);
      for (const x of f) expect(x).toBeGreaterThanOrEqual(Math.min(0.3, 1 / hs.length) - 1e-12);
    }
  });
});

const SEED = 'public/dados/seed/base';

function carregar(nome: string): Talhao[] {
  const fc = JSON.parse(readFileSync(`${SEED}/${nome}.geojson`, 'utf8')) as FeatureCollection;
  return fc.features.map((f, i) => ({
    id: `${nome}-${i}`,
    fazendaId: nome,
    nome: String(f.properties?.nome ?? i),
    setor: (f.properties?.setor as string | null | undefined) ?? null,
    areaHa: 0,
    geom: f.geometry as Geometry,
    atributos: {},
    codigo: null,
  }));
}

function relatar(nome: string, ts: Talhao[]): Composicao {
  const grupos = agruparTalhoes(ts);
  const bboxes = grupos.map((g) => g.bbox);
  const unico = compor(ts, { ...AUTO, quadros: 1 });
  const auto = compor(ts, AUTO);
  const aUnico = aproveitamento(bboxes, unico.quadros.map((q) => q.rect));
  const aAuto = aproveitamento(
    auto.quadros.length === 1 ? bboxes : auto.quadros.map((q) => q.grupo.bbox),
    auto.quadros.map((q) => q.rect),
  );
  console.log(
    `${nome}: ${ts.length} talhões, ${grupos.length} grupo(s) → ${auto.orientacao}, ${auto.quadros.length} quadro(s)` +
      ` [${auto.quadros.map((q) => q.titulo ?? '—').join(', ')}]; aproveitamento único ${unico.orientacao} = ${aUnico.toFixed(3)},` +
      ` escolhido = ${aAuto.toFixed(3)}`,
  );
  return auto;
}

describe.skipIf(!existsSync(`${SEED}/SIRIEMA.geojson`))('compor — fazendas reais do seed', () => {
  it('SIRIEMA → 2 quadros (SIRIEMA, SÃO MIGUEL)', () => {
    const c = relatar('SIRIEMA', carregar('SIRIEMA'));
    expect(c.quadros.map((q) => q.titulo)).toEqual(['SIRIEMA', 'SÃO MIGUEL']);
  });

  it('TRES_FLECHAS → retrato, 1 quadro', () => {
    const c = relatar('TRES_FLECHAS', carregar('TRES_FLECHAS'));
    expect(c.orientacao).toBe('retrato');
    expect(c.quadros).toHaveLength(1);
  });

  it('GUAPIRAMA → paisagem, 1 quadro (bbox 31,3 × 36,7 km: 1,17 ≤ 1,25)', () => {
    const c = relatar('GUAPIRAMA', carregar('GUAPIRAMA'));
    expect(c.quadros).toHaveLength(1);
    expect(c.orientacao).toBe('paisagem');
  });
});
