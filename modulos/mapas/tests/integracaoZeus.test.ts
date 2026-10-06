// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PedidoChuva, ResultadoIntegracao, SituacaoPedidoChuva } from '../src/lib/chuvaZeus';
import type { SituacaoZeus } from '../src/lib/situacaoZeus';

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
  /** último dia de cada fazenda da ZEUS no banco (vazio = o servidor ainda não gravou) */
  situacao: [] as SituacaoZeus[],
  async situacaoZeus() {
    return falso.situacao;
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
  falso.situacao = [];
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

describe('opção de informar a hora do período', () => {
  const horas = () => [...document.querySelectorAll<HTMLInputElement>('input[type="time"]')];
  const caixaHora = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => c.closest('label')?.textContent?.includes('Informar também a hora'));

  it('por padrão a janela pede só as datas; marcando a opção aparecem a hora inicial e a final', () => {
    montar('SM3');
    act(() => botao('Inserir dados via integração')!.click());
    expect(caixaHora()?.checked).toBe(false);
    expect(horas()).toHaveLength(0);
    act(() => caixaHora()!.click());
    expect(horas().map((h) => h.value)).toEqual(['00:00', '23:59']);
  });

  it('com a opção marcada o pedido leva as horas; a resposta entra com o período em data e hora', async () => {
    falso.resposta = {
      atendidoEm: '2026-10-05T12:00:20.000Z',
      resultado: 'ok',
      dados: { fazenda: 'SM3', de: '2026-10-03', ate: '2026-10-04', deHora: '06:00', ateHora: '07:00', ultimoDia: '2026-10-04', ultimaLeitura: '2026-10-04T07:00', pics: [{ id: '4700', nome: 'PIC 27 SM3', lat: -17.38, lon: -54.74, chuva: 2.4, leituras: 26 }] },
    };
    const recebidos = montar('SM3');
    act(() => botao('Inserir dados via integração')!.click());
    act(() => caixaHora()!.click());
    digitar(datas()[0], '2026-10-03');
    digitar(datas()[1], '2026-10-04');
    digitar(horas()[0], '06:00');
    digitar(horas()[1], '07:00');
    act(() => botao('Buscar dados')!.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(falso.pedidos).toEqual([{ fazenda: 'SM3', de: '2026-10-03', ate: '2026-10-04', deHora: '06:00', ateHora: '07:00' }]);
    expect(recebidos[0].nome).toBe('Integração ZEUS · 03/10/2026 06:00 a 04/10/2026 07:00');
    expect(recebidos[0].comHora).toBe(true);
  });

  it('hora inicial depois da final no mesmo dia é recusada sem pedir nada', () => {
    montar('SM3');
    act(() => botao('Inserir dados via integração')!.click());
    act(() => caixaHora()!.click());
    digitar(horas()[0], '18:00');
    digitar(horas()[1], '06:00');
    act(() => botao('Buscar dados')!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('A hora inicial é depois da final.');
    expect(falso.pedidos).toEqual([]);
  });
});

describe('último dia da ZEUS no banco, ao lado do botão', () => {
  /** conferido em 05/10/2026 às 08:17, horário local */
  const CONFERIDO = new Date(2026, 9, 5, 8, 17, 0).toISOString();
  const situacao = () => document.querySelector('.integracao-situacao')?.textContent ?? null;
  const esperar = () => act(async () => { await vi.advanceTimersByTimeAsync(10); });

  it('mostra até que dia a fazenda escolhida tem dados e quando isso foi conferido', async () => {
    falso.situacao = [
      { fazenda: 'SM3', ultimoDia: '2026-10-04', ultimaHora: '23:45', conferidoEm: CONFERIDO },
      { fazenda: 'GLOBO', ultimoDia: '2026-10-02', ultimaHora: '23:00', conferidoEm: CONFERIDO },
    ];
    montar('Fazenda SM3');
    await esperar();
    expect(situacao()).toBe('ZEUS no banco até 04/10/2026 às 23:45 (ontem) · conferido hoje às 08:17');
  });

  it('sem nada gravado pelo servidor (ou fazenda fora da ZEUS), não mostra a linha', async () => {
    montar('SM3');
    await esperar();
    expect(situacao()).toBeNull();
    expect(botao('Inserir dados via integração')).toBeDefined();
  });

  it('a janela sugere o último dia com dados quando ele é anterior a ontem', async () => {
    falso.situacao = [{ fazenda: 'SM3', ultimoDia: '2026-10-02', ultimaHora: '23:00', conferidoEm: CONFERIDO }];
    montar('SM3');
    await esperar();
    act(() => botao('Inserir dados via integração')!.click());
    expect(datas().map((d) => d.value)).toEqual(['2026-10-02', '2026-10-02']);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('ZEUS no banco até 02/10/2026 às 23:00');
  });

  it('avisa, sem impedir a busca, quando o "até" passa do último dia com dados', async () => {
    falso.situacao = [{ fazenda: 'SM3', ultimoDia: '2026-10-04', ultimaHora: '23:00', conferidoEm: CONFERIDO }];
    montar('SM3');
    await esperar();
    act(() => botao('Inserir dados via integração')!.click());
    expect(document.querySelector('.integracao-aviso')).toBeNull();
    digitar(datas()[1], '2026-10-05');
    expect(document.querySelector('.integracao-aviso')?.textContent).toBe('A ZEUS só tem dados no banco até 04/10/2026: a chuva de 05/10/2026 ainda não chegou e não entra no total.');
    expect(botao('Buscar dados')?.disabled).toBe(false);
  });

  it('dia de hoje ainda pela metade na ZEUS: a janela diz até que horas há leituras', async () => {
    falso.situacao = [{ fazenda: 'SM3', ultimoDia: '2026-10-05', ultimaHora: '07:00', conferidoEm: CONFERIDO }];
    montar('SM3');
    await esperar();
    expect(situacao()).toBe('ZEUS no banco até 05/10/2026 às 07:00 (hoje) · conferido hoje às 08:17');
    act(() => botao('Inserir dados via integração')!.click());
    digitar(datas()[1], '2026-10-05');
    expect(document.querySelector('.integracao-aviso')?.textContent).toBe('A ZEUS só tem leituras de 05/10/2026 até as 07:00: o total desse dia ainda está incompleto.');
  });
});
