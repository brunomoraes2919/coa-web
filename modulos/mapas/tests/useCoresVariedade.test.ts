// @vitest-environment jsdom
// useCoresVariedade: sem conseguir ler o cadastro de cores, as cores do mapa são provisórias e nada é gravado.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeicaoVariedade } from '../src/lib/variedades';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const falso = {
  listarCoresVariedade: vi.fn(),
  criarCorVariedade: vi.fn(),
};
vi.mock('../src/data', () => ({ repo: () => falso }));
const { useCoresVariedade } = await import('../src/components/editor/useCoresVariedade');

const FEICOES: FeicaoVariedade[] = [
  { id: 't1', nome: '001', setor: null, areaHa: 10, variedade: 'TMG 2383' },
  { id: 't2', nome: '002', setor: null, areaHa: 5, variedade: 'NEO 790' },
];

let raiz: ReturnType<typeof createRoot> | null = null;
let caixa: HTMLDivElement | null = null;
afterEach(() => {
  act(() => raiz?.unmount());
  caixa?.remove();
  vi.clearAllMocks();
});

async function montar() {
  const visto: { cores: Map<string, string> | null; aviso: string | null } = { cores: null, aviso: null };
  function Teste() {
    const r = useCoresVariedade(FEICOES, null);
    visto.cores = r.cores;
    visto.aviso = r.aviso;
    return null;
  }
  caixa = document.createElement('div');
  document.body.appendChild(caixa);
  raiz = createRoot(caixa);
  await act(async () => raiz!.render(createElement(Teste)));
  await act(async () => new Promise((ok) => setTimeout(ok, 0)));
  return visto;
}

describe('useCoresVariedade', () => {
  it('cadastro lido: grava a cor das variedades novas', async () => {
    falso.listarCoresVariedade.mockResolvedValue([{ variedade: 'TMG 2383', cor: '#000000', criadoEm: '' }]);
    falso.criarCorVariedade.mockImplementation(async (variedade: string, cor: string) => ({ variedade, cor, criadoEm: '' }));
    const visto = await montar();
    expect(falso.criarCorVariedade).toHaveBeenCalledTimes(1);
    expect(falso.criarCorVariedade.mock.calls[0][0]).toBe('NEO 790');
    expect(visto.cores?.get('TMG 2383')).toBe('#000000');
    expect(visto.aviso).toBeNull();
  });
  it('sem ler o cadastro: cores provisórias para todas, nada gravado, e o aviso da leitura fica', async () => {
    falso.listarCoresVariedade.mockRejectedValue(new Error('relation "public.mapas_variedade_cores" does not exist'));
    const visto = await montar();
    expect(falso.criarCorVariedade).not.toHaveBeenCalled();
    expect(visto.cores?.size).toBe(2);
    expect(visto.aviso).toMatch(/^Não foi possível ler as cores das variedades/);
  });
});
