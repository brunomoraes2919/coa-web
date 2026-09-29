import { describe, expect, it } from 'vitest';
import { alvoPreSelecaoCoa } from '../src/components/editor/usePreSelecaoCoa';
import type { Fazenda } from '../src/lib/types';

const f = (id: string, coaFazendaId: number | null) => ({ id, coaFazendaId }) as unknown as Fazenda;
const lista = [f('a', null), f('b', 5), f('c', 7), f('d', 7)];

describe('alvoPreSelecaoCoa (novo mapa segue a fazenda do COA WEB)', () => {
  it('seleciona a primeira fazenda de mapa ligada à fazenda do COA WEB', () => {
    expect(alvoPreSelecaoCoa(lista, 7, '')).toBe('c');
    expect(alvoPreSelecaoCoa(lista, 5, 'c')).toBe('b');
  });

  it('troca mesmo depois de uma escolha à mão de outra fazenda', () => {
    expect(alvoPreSelecaoCoa(lista, 7, 'a')).toBe('c');
  });

  it('sem fazenda de mapa ligada: limpa a escolha', () => {
    expect(alvoPreSelecaoCoa(lista, 99, 'c')).toBe('');
  });

  it('já na fazenda certa ou já vazia: nada muda', () => {
    expect(alvoPreSelecaoCoa(lista, 7, 'c')).toBeNull();
    expect(alvoPreSelecaoCoa(lista, 99, '')).toBeNull();
  });

  it('sem fazenda do COA WEB (fora do iframe ou "todas"): nada muda', () => {
    expect(alvoPreSelecaoCoa(lista, null, 'a')).toBeNull();
    expect(alvoPreSelecaoCoa(lista, null, '')).toBeNull();
  });
});
