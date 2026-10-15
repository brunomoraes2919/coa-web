// @vitest-environment jsdom
// Lista do "Ver plantio": linha sem PIMS e sem talhão no shape da fazenda não tem marcação manual. Dados FICTÍCIOS.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import TabelaPlantio from '../src/components/TabelaPlantio';
import type { Talhao } from '../src/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const linha = (id: string, nome: string): Talhao => ({ id, fazendaId: 'f', nome, setor: null, areaHa: 10, geom, atributos: {}, codigo: nome });

let raiz: ReturnType<typeof createRoot> | null = null;
let caixa: HTMLDivElement | null = null;
afterEach(() => {
  act(() => raiz?.unmount());
  caixa?.remove();
});

describe('TabelaPlantio', () => {
  it('linha sem marcação manual possível: caixa desativada e "sem PIMS"; as outras seguem manuais', () => {
    const alternados: string[] = [];
    caixa = document.createElement('div');
    document.body.appendChild(caixa);
    raiz = createRoot(caixa);
    act(() =>
      raiz!.render(
        createElement(TabelaPlantio, {
          talhoes: [linha('a1', '068'), linha('a2', '099X')],
          pimsDe: () => undefined,
          marcados: {},
          onAlternar: (id: string) => alternados.push(id),
          onData: () => undefined,
          busca: '',
          semManual: (t: Talhao) => t.id === 'a2',
        }),
      ),
    );
    const manual = caixa.querySelector('input[aria-label="Plantado: 068"]') as HTMLInputElement;
    const semManual = caixa.querySelector('input[aria-label="Sem registro no PIMS: 099X"]') as HTMLInputElement;
    expect(manual.disabled).toBe(false);
    expect(semManual.disabled).toBe(true);
    expect(semManual.closest('tr')!.textContent).toContain('sem PIMS');
    act(() => semManual.click());
    expect(alternados).toEqual([]);
  });
});
