import { describe, expect, it } from 'vitest';
import {
  alturaPrevia,
  arrastarExtent,
  editarTexto,
  larguraPrevia,
  lerParametroIdw,
  limitarZoom,
  ordenarTalhoes,
  panZoomPermitido,
  parametroIdwValido,
  quadroEmCss,
  zoomNoPonto,
} from '../src/lib/editorRegras';
import { layoutPadrao, textosAutomaticos } from '../src/lib/editor';
import type { TalhaoStats } from '../src/lib/types';

const linha = (nome: string, media: number, setor: string | null = null): TalhaoStats => ({
  talhaoId: nome,
  nome,
  setor,
  plantado: false,
  areaHa: 10,
  media,
  min: media,
  max: media,
});

describe('ordenarTalhoes (achado 17)', () => {
  const linhas = [linha('TH 10', 30), linha('TH 2', NaN), linha('TH 1', 10), linha('TH 3', NaN), linha('TH 4', 20)];

  it('crescente: números em ordem e sem valor (NaN) no fim', () => {
    expect(ordenarTalhoes(linhas, 'media', true).map((l) => l.nome)).toEqual(['TH 1', 'TH 4', 'TH 10', 'TH 2', 'TH 3']);
  });

  it('decrescente: números em ordem inversa e sem valor (NaN) continua no fim', () => {
    const nomes = ordenarTalhoes(linhas, 'media', false).map((l) => l.nome);
    expect(nomes.slice(0, 3)).toEqual(['TH 10', 'TH 4', 'TH 1']);
    expect(nomes.slice(3).sort()).toEqual(['TH 2', 'TH 3']);
  });

  it('texto em ordem natural (TH 2 antes de TH 10) nas duas direções', () => {
    expect(ordenarTalhoes(linhas, 'nome', true).map((l) => l.nome)).toEqual(['TH 1', 'TH 2', 'TH 3', 'TH 4', 'TH 10']);
    expect(ordenarTalhoes(linhas, 'nome', false).map((l) => l.nome)).toEqual(['TH 10', 'TH 4', 'TH 3', 'TH 2', 'TH 1']);
  });

  it('não altera a lista recebida', () => {
    const copia = [...linhas];
    ordenarTalhoes(linhas, 'media', false);
    expect(linhas).toEqual(copia);
  });
});

describe('editarTexto (achado 15)', () => {
  const auto = textosAutomaticos({ fazenda: 'Guapirama', safra: null, periodoInicio: null, periodoFim: null, setores: null, hoje: new Date(2026, 8, 28) });

  it('marca o campo como editado quando difere do automático', () => {
    expect(editarTexto({}, auto, 'titulo', 'MAPA DE CHUVA')).toEqual({ titulo: 'MAPA DE CHUVA' });
  });

  it('campo que volta ao valor automático deixa de ser editado, sem mexer nos outros', () => {
    const editados = { titulo: 'MAPA DE CHUVA', fonte: 'ZEUS + manual' };
    expect(editarTexto(editados, auto, 'titulo', auto.titulo)).toEqual({ fonte: 'ZEUS + manual' });
    expect(editarTexto({}, auto, 'fazenda', 'GUAPIRAMA')).toEqual({});
  });
});

describe('parametroIdwValido (achado 14)', () => {
  it('vizinhos só aceita inteiros dentro dos limites', () => {
    expect(parametroIdwValido('vizinhos', 12)).toBe(true);
    expect(parametroIdwValido('vizinhos', 12.5)).toBe(false);
    expect(parametroIdwValido('vizinhos', 0)).toBe(false);
    expect(parametroIdwValido('vizinhos', 51)).toBe(false);
  });
  it('potência aceita fração; valores inválidos são recusados', () => {
    expect(parametroIdwValido('potencia', 2.5)).toBe(true);
    expect(parametroIdwValido('potencia', NaN)).toBe(false);
    expect(parametroIdwValido('buffer', 0)).toBe(true);
    expect(parametroIdwValido('pixel', 0)).toBe(false);
  });
});

describe('lerParametroIdw (campo de texto do Avançado)', () => {
  it('valores intermediários da digitação não são aplicados (null), mas também não travam o campo', () => {
    expect(lerParametroIdw('pixel', '')).toBeNull();
    expect(lerParametroIdw('pixel', '0')).toBeNull(); // a caminho de "0,5"? pixel mínimo é 1
    expect(lerParametroIdw('potencia', '2,')).toBeNull();
    expect(lerParametroIdw('vizinhos', '-')).toBeNull();
    expect(lerParametroIdw('vizinhos', '12.5')).toBeNull();
  });
  it('aceita vírgula ou ponto decimal e respeita os limites', () => {
    expect(lerParametroIdw('potencia', '2,5')).toBe(2.5);
    expect(lerParametroIdw('potencia', ' 3.5 ')).toBe(3.5);
    expect(lerParametroIdw('pixel', '10')).toBe(10);
    expect(lerParametroIdw('buffer', '0')).toBe(0);
    expect(lerParametroIdw('buffer', '201')).toBeNull();
  });
});

describe('limitarZoom (achado 7)', () => {
  it('aplica o fator dentro dos limites de 0,5 a 2000 m/mm', () => {
    expect(limitarZoom(100, 1.2)).toBeCloseTo(120);
    expect(limitarZoom(1900, 1.2)).toBe(2000);
    expect(limitarZoom(2000, 1.2)).toBe(2000);
    expect(limitarZoom(0.55, 1 / 1.2)).toBe(0.5);
    expect(limitarZoom(0.5, 1 / 1.2)).toBe(0.5);
  });
  it('fora dos limites nunca salta nem inverte o sentido do zoom', () => {
    expect(limitarZoom(10000, 1.2)).toBe(10000); // afastar mais: não muda
    expect(limitarZoom(10000, 1 / 1.2)).toBeCloseTo(10000 / 1.2); // aproximar: vai aos poucos
    expect(limitarZoom(0.3, 1 / 1.2)).toBe(0.3);
    expect(limitarZoom(0.3, 1.2)).toBeCloseTo(0.36);
  });
});

describe('layout adaptativo: padrões do editor', () => {
  it('orientação e quadros começam automáticos, sem enquadramento manual', () => {
    const l = layoutPadrao();
    expect(l.orientacao).toBe('auto');
    expect(l.quadros).toBe('auto');
    expect(l.extent).toBeNull();
  });
});

describe('prévia: proporção pela folha da composição', () => {
  it('altura segue a folha real (paisagem A3, retrato A3, retrato A4)', () => {
    expect(alturaPrevia(840, { w: 420, h: 297 })).toBeCloseTo(594);
    expect(alturaPrevia(297, { w: 297, h: 420 })).toBeCloseTo(420);
    expect(alturaPrevia(210, { w: 210, h: 297 })).toBeCloseTo(297);
  });
  it('largura exibida: a da caixa, reduzida para a altura caber no limite', () => {
    expect(larguraPrevia(900, { w: 420, h: 297 }, 2000)).toBe(900);
    // retrato: 900 de largura dariam 1273 de altura; com limite de 700, a largura cai para 700×297/420
    expect(larguraPrevia(900, { w: 297, h: 420 }, 700)).toBe(Math.floor((700 * 297) / 420));
    // limite inválido (0/NaN) não reduz
    expect(larguraPrevia(900, { w: 297, h: 420 }, 0)).toBe(900);
  });
});

describe('prévia: pan/zoom só com um quadro', () => {
  const q = { rect: { x: 5, y: 4.4, w: 333, h: 288 } };
  it('um quadro permite arrastar e aproximar; vários não', () => {
    expect(panZoomPermitido({ quadros: [q] })).toBe(true);
    expect(panZoomPermitido({ quadros: [q, q] })).toBe(false);
    expect(panZoomPermitido({ quadros: [q, q, q] })).toBe(false);
    expect(panZoomPermitido({ quadros: [] })).toBe(false);
  });
});

describe('prévia: conversão mm ↔ px do quadro', () => {
  const retrato = { x: 5, y: 4.4, w: 287, h: 338 };
  it('k = px CSS por mm do desenho A3; o retângulo acompanha', () => {
    const r = quadroEmCss(retrato, 594, 297);
    expect(r.k).toBeCloseTo(2);
    expect(r).toMatchObject({ x: 10, w: 574, h: 676 });
    expect(r.y).toBeCloseTo(8.8);
  });
  it('arrastar desloca o centro em metros (x oposto ao arraste, y invertido)', () => {
    const base = { cx: 1000, cy: 2000, mPorMm: 10 };
    expect(arrastarExtent(base, 3, -2)).toEqual({ cx: 970, cy: 1980, mPorMm: 10 });
  });
  it('zoom mantém fixo o ponto sob o cursor e respeita os limites', () => {
    const base = { cx: 0, cy: 0, mPorMm: 100 };
    // cursor 50 mm à direita e 20 mm acima do centro do quadro retrato
    const novo = zoomNoPonto(base, 50, -20, 1 / 1.2)!;
    expect(novo.mPorMm).toBeCloseTo(100 / 1.2);
    expect(novo.cx + 50 * novo.mPorMm).toBeCloseTo(base.cx + 50 * base.mPorMm);
    expect(novo.cy - -20 * novo.mPorMm).toBeCloseTo(base.cy - -20 * base.mPorMm);
    // no limite (2000 m/mm) afastar não muda nada
    expect(zoomNoPonto({ cx: 0, cy: 0, mPorMm: 2000 }, 10, 10, 1.2)).toBeNull();
    expect(zoomNoPonto({ cx: 0, cy: 0, mPorMm: 0.5 }, 10, 10, 1 / 1.2)).toBeNull();
  });
  it('o ponto no centro do retângulo do quadro não muda o centro do enquadramento', () => {
    const r = quadroEmCss(retrato, 594, 297);
    const cxPx = r.x + r.w / 2;
    const cyPx = r.y + r.h / 2;
    const novo = zoomNoPonto({ cx: 5, cy: 7, mPorMm: 50 }, (cxPx - (r.x + r.w / 2)) / r.k, (cyPx - (r.y + r.h / 2)) / r.k, 1.2)!;
    expect(novo.cx).toBeCloseTo(5);
    expect(novo.cy).toBeCloseTo(7);
  });
});
