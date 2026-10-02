// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import TabelaPics from '../src/components/editor/TabelaPics';
import type { Pic } from '../src/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PICS: Pic[] = [
  { id: '1', nome: 'PIC 27 SM3', lat: -14, lon: -56, chuva: 0.2, inativo: false, inicio: null, fim: null, incluir: true },
  { id: '2', nome: 'PIC 20 SM3', lat: -14.1, lon: -56.1, chuva: null, inativo: false, inicio: null, fim: null, incluir: false },
];

let raiz: ReturnType<typeof createRoot> | null = null;
let caixa: HTMLDivElement | null = null;
afterEach(() => {
  act(() => raiz?.unmount());
  caixa?.remove();
});

function montar() {
  const mudancas: Pic[][] = [];
  function Teste() {
    const [pics, setPics] = useState(PICS);
    return createElement(TabelaPics, { pics, onChange: (p: Pic[]) => { mudancas.push(p); setPics(p); } });
  }
  caixa = document.createElement('div');
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  act(() => raiz!.render(createElement(Teste)));
  return { caixa, mudancas };
}

function digitar(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, valor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TabelaPics: editar a chuva de um PIC', () => {
  it('o lápis abre o campo; Enter grava o novo valor e mostra "Editado"', () => {
    const { caixa, mudancas } = montar();
    act(() => (caixa.querySelector('button[aria-label="Editar a chuva de PIC 27 SM3"]') as HTMLButtonElement).click());
    const input = caixa.querySelector('input.pic-mm') as HTMLInputElement;
    expect(input.value).toBe('0,2');
    digitar(input, '18,5');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(mudancas.at(-1)![0]).toMatchObject({ chuva: 18.5, chuvaOriginal: 0.2, incluir: true });
    expect(caixa.textContent).toContain('Editado');
    expect(caixa.textContent).toContain('1 editado');
    // restaurar volta ao CSV
    act(() => (caixa.querySelector('button[aria-label="Voltar PIC 27 SM3 ao valor do CSV"]') as HTMLButtonElement).click());
    expect(mudancas.at(-1)![0].chuva).toBe(0.2);
    expect(caixa.textContent).not.toContain('Editado');
  });

  it('valor inválido mostra o aviso e não grava; PIC sem leitura entra na interpolação ao receber chuva', () => {
    const { caixa, mudancas } = montar();
    act(() => (caixa.querySelector('button[aria-label="Editar a chuva de PIC 20 SM3"]') as HTMLButtonElement).click());
    const input = caixa.querySelector('input.pic-mm') as HTMLInputElement;
    digitar(input, '-3');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(caixa.querySelector('[role="alert"]')?.textContent).toMatch(/entre 0 e 1000/);
    expect(mudancas).toHaveLength(0);
    digitar(input, '7');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(mudancas.at(-1)![1]).toMatchObject({ chuva: 7, incluir: true, chuvaOriginal: null });
  });
});
