import { describe, expect, it } from 'vitest';
import { LabelPlacer, quebrarTexto, type Rect } from '../src/render/labels';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('LabelPlacer', () => {
  it('aceita a primeira candidata quando não há nada ocupado', () => {
    const p = new LabelPlacer();
    expect(p.tenta([r(0, 0, 10, 5), r(20, 0, 10, 5)])).toEqual(r(0, 0, 10, 5));
  });

  it('rejeita sobreposição e passa para a próxima candidata', () => {
    const p = new LabelPlacer();
    p.tenta([r(0, 0, 10, 5)]);
    expect(p.tenta([r(5, 2, 10, 5), r(0, 10, 10, 5)])).toEqual(r(0, 10, 10, 5));
  });

  it('aceita retângulos adjacentes (só encostando)', () => {
    const p = new LabelPlacer();
    p.tenta([r(0, 0, 10, 5)]);
    expect(p.tenta([r(10, 0, 10, 5)])).toEqual(r(10, 0, 10, 5));
    expect(p.tenta([r(0, 5, 10, 5)])).toEqual(r(0, 5, 10, 5));
  });

  it('retorna null quando todas as candidatas colidem e não registra nada', () => {
    const p = new LabelPlacer();
    p.tenta([r(0, 0, 10, 10)]);
    expect(p.tenta([r(1, 1, 2, 2), r(8, 8, 5, 5)])).toBeNull();
    expect(p.tenta([r(12, 12, 5, 5)])).toEqual(r(12, 12, 5, 5));
  });

  it('respeita áreas reservadas', () => {
    const p = new LabelPlacer();
    p.reserva(r(0, 0, 10, 10));
    expect(p.tenta([r(5, 5, 4, 4)])).toBeNull();
  });

  it('descarta candidatas fora dos limites', () => {
    const p = new LabelPlacer(r(0, 0, 100, 50));
    expect(p.tenta([r(95, 0, 10, 5), r(-1, 0, 5, 5), r(0, 48, 5, 5), r(80, 40, 20, 10)])).toEqual(r(80, 40, 20, 10));
  });
});

describe('quebrarTexto', () => {
  const medir = (s: string) => s.length; // 1 unidade por caractere

  it('mantém em uma linha quando cabe', () => {
    expect(quebrarTexto('FAZENDA: GUAPIRAMA', 30, medir)).toEqual(['FAZENDA: GUAPIRAMA']);
  });

  it('quebra entre palavras', () => {
    expect(quebrarTexto('FONTE DE INFORMAÇÃO: ZEUS', 20, medir)).toEqual(['FONTE DE INFORMAÇÃO:', 'ZEUS']);
    expect(quebrarTexto('MAPA DE PRECIPITAÇÃO', 12, medir)).toEqual(['MAPA DE', 'PRECIPITAÇÃO']);
  });

  it('quebra palavra maior que a largura', () => {
    expect(quebrarTexto('ABCDEFGHIJ', 4, medir)).toEqual(['ABCD', 'EFGH', 'IJ']);
  });

  it('respeita quebras de linha explícitas e ignora espaços repetidos', () => {
    expect(quebrarTexto('MAPA  DE\nPRECIPITAÇÃO', 50, medir)).toEqual(['MAPA DE', 'PRECIPITAÇÃO']);
  });

  it('texto vazio não gera linhas', () => {
    expect(quebrarTexto('   ', 10, medir)).toEqual([]);
  });
});
