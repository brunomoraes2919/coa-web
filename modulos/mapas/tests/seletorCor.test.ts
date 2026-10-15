// @vitest-environment jsdom
// Seletor de cor do cadastro "Cores das variedades": arrastar no seletor não grava; grava uma vez quando a pessoa confirma.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import SeletorCor from '../src/components/editor/SeletorCor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: ReturnType<typeof createRoot> | null = null;
let caixa: HTMLDivElement | null = null;
afterEach(() => {
  act(() => raiz?.unmount());
  caixa?.remove();
});

function montar(cor: string) {
  const trocas: string[] = [];
  caixa = document.createElement('div');
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  act(() => raiz!.render(createElement(SeletorCor, { variedade: 'TMG 2383', cor, onTrocar: (c: string) => trocas.push(c) })));
  return { input: caixa.querySelector('input[aria-label="Cor de TMG 2383"]') as HTMLInputElement, trocas };
}

function mover(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, valor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SeletorCor', () => {
  it('arrastar (eventos input) só muda a cor na tela; confirmar (change) grava uma vez, a cor final', () => {
    const { input, trocas } = montar('#1F77B4');
    mover(input, '#111111');
    mover(input, '#222222');
    mover(input, '#333333');
    expect(trocas).toEqual([]);
    expect(input.value).toBe('#333333');
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(trocas).toEqual(['#333333']);
  });
  it('confirmar a mesma cor que já está gravada não grava', () => {
    const { input, trocas } = montar('#1F77B4');
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(trocas).toEqual([]);
  });
});
