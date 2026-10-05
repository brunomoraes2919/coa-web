// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PedidoChuva, ResultadoIntegracao, SituacaoPedidoChuva } from '../src/lib/chuvaZeus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** repositório falso: o servidor "responde" na primeira leitura */
const falso = {
  podeBuscarChuva: true,
  pedidos: [] as PedidoChuva[],
  resposta: null as SituacaoPedidoChuva | null,
  async pedirChuvaZeus(p: PedidoChuva) {
    falso.pedidos.push(p);
    return 5;
  },
  async situacaoPedidoChuva() {
    return falso.resposta;
  },
};
vi.mock('../src/data', () => ({ repo: () => falso }));

const { default: IntegracaoZeus } = await import('../src/components/editor/IntegracaoZeus');

let raiz: ReturnType<typeof createRoot> | null = null;
let caixa: HTMLDivElement | null = null;
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 5, 9, 0, 0) });
  falso.podeBuscarChuva = true;
  falso.pedidos = [];
  falso.resposta = null;
});
afterEach(() => {
  act(() => raiz?.unmount());
  caixa?.remove();
  vi.useRealTimers();
});

function montar(fazendaNome: string | null) {
  const recebidos: ResultadoIntegracao[] = [];
  caixa = document.createElement('div');
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  act(() => raiz!.render(createElement(IntegracaoZeus, { fazendaNome, onDados: (r: ResultadoIntegracao) => recebidos.push(r) })));
  return recebidos;
}
const botao = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
const datas = () => [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')];
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('botão "Inserir dados via integração"', () => {
  it('não aparece fora do COA WEB (modo local)', () => {
    falso.podeBuscarChuva = false;
    montar('SM3');
    expect(botao('Inserir dados via integração')).toBeUndefined();
  });

  it('sem fazenda escolhida fica desabilitado', () => {
    montar(null);
    expect(botao('Inserir dados via integração')?.disabled).toBe(true);
  });

  it('abre a janela com o período de ontem e recusa período invertido sem pedir nada', () => {
    montar('SM3');
    act(() => botao('Inserir dados via integração')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('fazenda SM3');
    expect(datas().map((d) => d.value)).toEqual(['2026-10-04', '2026-10-04']);
    expect(datas().map((d) => d.max)).toEqual(['2026-10-05', '2026-10-05']);

    digitar(datas()[0], '2026-10-05');
    act(() => botao('Buscar dados')!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('A data inicial é depois da final.');
    expect(falso.pedidos).toEqual([]);
  });

  it('pede o período, espera o servidor e entrega os PICs; a janela fecha', async () => {
    falso.resposta = {
      atendidoEm: '2026-10-05T12:00:20.000Z',
      resultado: 'ok',
      dados: { fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-02', ultimoDia: '2026-10-02', pics: [{ id: '4700', nome: 'PIC 27 SM3', lat: -17.38, lon: -54.74, chuva: 2.4, leituras: 192 }] },
    };
    const recebidos = montar('SM3');
    act(() => botao('Inserir dados via integração')!.click());
    digitar(datas()[0], '2026-10-01');
    digitar(datas()[1], '2026-10-02');
    act(() => botao('Buscar dados')!.click());
    expect(botao('Buscando…')?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });

    expect(falso.pedidos).toEqual([{ fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-02' }]);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].nome).toBe('Integração ZEUS · 01 a 02/10/2026');
    expect(recebidos[0].pics[0]).toMatchObject({ nome: 'PIC 27 SM3', chuva: 2.4, incluir: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('erro do servidor aparece na janela, que continua aberta', async () => {
    falso.resposta = { atendidoEm: '2026-10-05T12:00:20.000Z', resultado: 'erro: A ZEUS não tem PICs para a fazenda "X".', dados: null };
    const recebidos = montar('X');
    act(() => botao('Inserir dados via integração')!.click());
    act(() => botao('Buscar dados')!.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(recebidos).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('O servidor não conseguiu buscar a chuva: A ZEUS não tem PICs para a fazenda "X".');
    expect(botao('Buscar dados')?.disabled).toBe(false);
  });
});
