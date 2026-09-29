import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fazenda } from '../src/lib/types';

const ORIGEM = 'https://coa.exemplo.com';

/** window falso (ambiente node): EventTarget com location e parent, para as mensagens do COA WEB. */
function janelaFalsa(search: string, opcoes: { semPai?: boolean } = {}) {
  const alvo = new EventTarget() as EventTarget & {
    location: { search: string; origin: string };
    parent: unknown;
  };
  alvo.location = { search, origin: ORIGEM };
  const postMessage = vi.fn();
  alvo.parent = opcoes.semPai ? alvo : { postMessage };
  vi.stubGlobal('window', alvo);
  vi.stubGlobal('location', alvo.location);
  return { janela: alvo, postMessage };
}

/**
 * Evento 'message' com dados, origem e janela de origem (por padrão, o pai da janela falsa: o COA WEB).
 * O MessageEvent do node não é garantido em todas as versões.
 */
function mensagem(data: unknown, origin = ORIGEM, source: unknown = (globalThis as { window?: { parent: unknown } }).window?.parent): Event {
  return Object.assign(new Event('message'), { data, origin, source });
}

async function carregarEmbed() {
  vi.resetModules();
  return import('../src/lib/embed');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('emEmbed', () => {
  it('só com ?embed=1', async () => {
    const { emEmbed } = await carregarEmbed();
    expect(emEmbed({ search: '?embed=1' })).toBe(true);
    expect(emEmbed({ search: '?x=2&embed=1' })).toBe(true);
    expect(emEmbed({ search: '' })).toBe(false);
    expect(emEmbed({ search: '?embed=0' })).toBe(false);
    expect(emEmbed({ search: '?embedded=1' })).toBe(false);
  });

  it('sem argumento usa location (e sem location, false)', async () => {
    const { emEmbed } = await carregarEmbed();
    expect(emEmbed()).toBe(false);
    janelaFalsa('?embed=1');
    expect(emEmbed()).toBe(true);
  });
});

describe('tituloDaRota', () => {
  it('traduz as rotas do módulo para o título do topo do COA WEB', async () => {
    const { tituloDaRota } = await carregarEmbed();
    expect(tituloDaRota('/mapas/novo')).toBe('Novo mapa de chuva');
    expect(tituloDaRota('/mapas')).toBe('Mapas salvos');
    expect(tituloDaRota('/mapas/')).toBe('Mapas salvos');
    expect(tituloDaRota('/mapas/3f2c-99')).toBe('Mapa salvo');
    expect(tituloDaRota('/fazendas')).toBe('Fazendas e shapes');
    expect(tituloDaRota('/fazendas/nova')).toBe('Fazendas e shapes');
    expect(tituloDaRota('/fazendas/abc')).toBe('Fazendas e shapes');
    expect(tituloDaRota('/safras')).toBe('Safras e plantio');
    expect(tituloDaRota('/safras/s1/plantio/f1')).toBe('Safras e plantio');
    expect(tituloDaRota('/safras/s1/areas/f1')).toBe('Safras e plantio');
    expect(tituloDaRota('/login')).toBe('Mapas');
    expect(tituloDaRota('/')).toBe('Mapas');
    expect(tituloDaRota('/config')).toBe('Mapas');
  });
});

describe('avisarRota', () => {
  it('em embed, posta { tipo, rota, titulo } ao pai com a origem da página', async () => {
    const { postMessage } = janelaFalsa('?embed=1');
    const { avisarRota } = await carregarEmbed();
    avisarRota('/mapas/novo');
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ tipo: 'mapas-rota', rota: '/mapas/novo', titulo: 'Novo mapa de chuva' }, ORIGEM);
  });

  it('não posta fora de embed', async () => {
    const { postMessage } = janelaFalsa('');
    const { avisarRota } = await carregarEmbed();
    avisarRota('/mapas');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('não posta quando a página não está num iframe (parent === window)', async () => {
    const { janela } = janelaFalsa('?embed=1', { semPai: true });
    const post = vi.fn();
    Object.assign(janela, { postMessage: post });
    const { avisarRota } = await carregarEmbed();
    avisarRota('/mapas');
    expect(post).not.toHaveBeenCalled();
  });

  it('sem window (node), não faz nada', async () => {
    const { avisarRota } = await carregarEmbed();
    expect(() => avisarRota('/mapas')).not.toThrow();
  });
});

describe('ouvirFazendaCoa', () => {
  it('entrega { id, nome } das mensagens coa-fazenda da mesma origem', async () => {
    const { janela } = janelaFalsa('?embed=1');
    const { ouvirFazendaCoa } = await carregarEmbed();
    const cb = vi.fn();
    const parar = ouvirFazendaCoa(cb);
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: null, nome: null }));
    expect(cb.mock.calls).toEqual([[{ id: 7, nome: 'Siriema' }], [{ id: null, nome: null }]]);
    parar();
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 8, nome: 'Guapirama' }));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('ignora mensagens de outra origem', async () => {
    const { janela } = janelaFalsa('?embed=1');
    const { ouvirFazendaCoa } = await carregarEmbed();
    const cb = vi.fn();
    ouvirFazendaCoa(cb);
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }, 'https://outro.site'));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }, 'null'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignora mensagens da mesma origem que não vêm do pai (outra janela ou a própria)', async () => {
    const { janela } = janelaFalsa('?embed=1');
    const { ouvirFazendaCoa } = await carregarEmbed();
    const cb = vi.fn();
    ouvirFazendaCoa(cb);
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }, ORIGEM, { postMessage: vi.fn() }));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }, ORIGEM, janela));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }, ORIGEM, null));
    expect(cb).not.toHaveBeenCalled();
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 7, nome: 'Siriema' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignora formato inválido', async () => {
    const { janela } = janelaFalsa('?embed=1');
    const { ouvirFazendaCoa } = await carregarEmbed();
    const cb = vi.fn();
    ouvirFazendaCoa(cb);
    const invalidas: unknown[] = [
      null,
      'coa-fazenda',
      7,
      {},
      { tipo: 'mapas-rota', rota: '/mapas', titulo: 'Mapas' },
      { tipo: 'coa-fazenda', id: '7', nome: 'Siriema' },
      { tipo: 'coa-fazenda', id: 7, nome: 42 },
      { tipo: 'coa-fazenda', id: Number.NaN, nome: 'x' },
      { tipo: 'coa-fazenda', id: Number.POSITIVE_INFINITY, nome: 'x' },
      { tipo: 'coa-fazenda', nome: 'sem id' },
      { tipo: 'coa-fazenda', id: 7 },
    ];
    for (const d of invalidas) janela.dispatchEvent(mensagem(d));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('fazenda do COA guardada pelo módulo', () => {
  it('guarda a última fazenda recebida desde o início, antes de a tela montar', async () => {
    const { janela } = janelaFalsa('?embed=1');
    const { iniciarEscutaFazendaCoa, ultimaFazendaCoa } = await carregarEmbed();
    expect(ultimaFazendaCoa()).toBeNull();
    iniciarEscutaFazendaCoa();
    iniciarEscutaFazendaCoa(); // idempotente
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 3, nome: 'Rio Negro' }));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 9, nome: 'Siriema' }));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 1, nome: 'Outra' }, 'https://outro.site'));
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 2, nome: 'Outra janela' }, ORIGEM, janela));
    expect(ultimaFazendaCoa()).toEqual({ id: 9, nome: 'Siriema' });
  });

  it('fora de embed não escuta', async () => {
    const { janela } = janelaFalsa('');
    const { iniciarEscutaFazendaCoa, ultimaFazendaCoa } = await carregarEmbed();
    iniciarEscutaFazendaCoa();
    janela.dispatchEvent(mensagem({ tipo: 'coa-fazenda', id: 3, nome: 'Rio Negro' }));
    expect(ultimaFazendaCoa()).toBeNull();
  });
});

describe('fazendaDoCoa', () => {
  const fazenda = (id: string, coaFazendaId: number | null): Fazenda => ({
    id,
    nome: id,
    campoNome: 'nome',
    campoSetor: null,
    colunas: [],
    criadoEm: '2026-09-28T00:00:00Z',
    unidadePims: null,
    campoCodigo: null,
    coaFazendaId,
  });

  it('primeira fazenda de mapa ligada ao id do COA; sem correspondente, null', async () => {
    const { fazendaDoCoa } = await carregarEmbed();
    const lista = [fazenda('a', null), fazenda('b', 5), fazenda('c', 7), fazenda('d', 7)];
    expect(fazendaDoCoa(lista, 7)?.id).toBe('c');
    expect(fazendaDoCoa(lista, 5)?.id).toBe('b');
    expect(fazendaDoCoa(lista, 99)).toBeNull();
    expect(fazendaDoCoa([], 7)).toBeNull();
  });
});

describe('lerConfig no modo fixo (VITE_MODO_FIXO=supabase)', () => {
  class MemoryStorage {
    private m = new Map<string, string>();
    getItem(k: string) {
      return this.m.has(k) ? this.m.get(k)! : null;
    }
    setItem(k: string, v: string) {
      this.m.set(k, v);
    }
  }

  async function carregarConfig(salva: unknown) {
    const storage = new MemoryStorage();
    storage.setItem('coa-chuva-config', JSON.stringify(salva));
    vi.stubGlobal('localStorage', storage);
    vi.resetModules();
    return import('../src/data/config');
  }

  it('ignora o localStorage e usa as variáveis do build', async () => {
    vi.stubEnv('VITE_MODO_FIXO', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fixo.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'chave-fixa');
    const { lerConfig, modoFixo } = await carregarConfig({ modo: 'local', supabaseUrl: 'https://outro.supabase.co', supabaseKey: 'outra' });
    expect(modoFixo()).toBe(true);
    expect(lerConfig()).toEqual({ modo: 'supabase', supabaseUrl: 'https://fixo.supabase.co', supabaseKey: 'chave-fixa' });
  });

  it('sem VITE_MODO_FIXO, o localStorage continua valendo (como hoje)', async () => {
    vi.stubEnv('VITE_MODO_FIXO', '');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fixo.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'chave-fixa');
    const { lerConfig, modoFixo } = await carregarConfig({ modo: 'local', supabaseUrl: 'https://outro.supabase.co', supabaseKey: 'outra' });
    expect(modoFixo()).toBe(false);
    expect(lerConfig()).toEqual({ modo: 'local', supabaseUrl: 'https://outro.supabase.co', supabaseKey: 'outra' });
  });
});

describe('fazendasDoCoa', () => {
  const f = (id: string, coaFazendaId: number | null) => ({ id, coaFazendaId }) as unknown as Fazenda;
  const lista = [f('a', null), f('b', 5), f('c', 7), f('d', 7)];

  it('sem fazenda do COA WEB (fora do iframe ou "todas"): lista inteira', async () => {
    const { fazendasDoCoa } = await carregarEmbed();
    expect(fazendasDoCoa(lista, null, '').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(fazendasDoCoa(lista, { id: null, nome: null }, '').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('com fazenda do COA WEB: só as ligadas a ela', async () => {
    const { fazendasDoCoa } = await carregarEmbed();
    expect(fazendasDoCoa(lista, { id: 7, nome: 'Fazenda X' }, '').map((x) => x.id)).toEqual(['c', 'd']);
    expect(fazendasDoCoa(lista, { id: 99, nome: 'Outra' }, '')).toEqual([]);
  });

  it('mantém a fazenda já escolhida (mapa salvo de outra fazenda)', async () => {
    const { fazendasDoCoa } = await carregarEmbed();
    expect(fazendasDoCoa(lista, { id: 7, nome: 'X' }, 'b').map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(fazendasDoCoa(lista, { id: 7, nome: 'X' }, 'c').map((x) => x.id)).toEqual(['c', 'd']);
  });
});
