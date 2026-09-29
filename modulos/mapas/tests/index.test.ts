import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** localStorage em memória, para simular a config salva pelo usuário (sem tocar no DOM). */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

/**
 * Carrega src/data/index.ts com o módulo zerado (vi.resetModules), para que `instancia`/
 * `chaveInstancia` comecem do zero em cada teste, usando o localStorage informado.
 */
async function carregarRepo(storage: MemoryStorage) {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  const mod = await import('../src/data/index');
  return mod.repo;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('data/index: repo() singleton', () => {
  it('mantém a mesma instância quando a config não muda (modo local)', async () => {
    const repo = await carregarRepo(new MemoryStorage());
    const a = repo();
    const b = repo();
    expect(a).toBe(b);
    expect(a.modo).toBe('local');
  });

  it('reaproveita a instância Supabase enquanto URL/chave não mudam', async () => {
    const storage = new MemoryStorage();
    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'supabase', supabaseUrl: 'https://a.supabase.co', supabaseKey: 'chave-a' }));
    const repo = await carregarRepo(storage);

    const primeiro = repo();
    const segundo = repo();
    expect(primeiro.modo).toBe('supabase');
    expect(segundo).toBe(primeiro);
  });

  it('recria o repositório quando supabaseUrl/supabaseKey mudam, mesmo permanecendo em modo supabase', async () => {
    const storage = new MemoryStorage();
    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'supabase', supabaseUrl: 'https://a.supabase.co', supabaseKey: 'chave-a' }));
    const repo = await carregarRepo(storage);
    const primeiro = repo();
    expect(primeiro.modo).toBe('supabase');

    // Troca de projeto Supabase (mesma "modo", URL/chave diferentes): não pode reter o client antigo.
    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'supabase', supabaseUrl: 'https://b.supabase.co', supabaseKey: 'chave-b' }));
    const segundo = repo();
    expect(segundo.modo).toBe('supabase');
    expect(segundo).not.toBe(primeiro);
  });

  it('recria o repositório ao trocar de modo (supabase -> local e local -> supabase)', async () => {
    const storage = new MemoryStorage();
    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'supabase', supabaseUrl: 'https://a.supabase.co', supabaseKey: 'chave-a' }));
    const repo = await carregarRepo(storage);
    const supabase1 = repo();
    expect(supabase1.modo).toBe('supabase');

    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'local', supabaseUrl: '', supabaseKey: '' }));
    const local = repo();
    expect(local.modo).toBe('local');
    expect(local).not.toBe(supabase1);

    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'supabase', supabaseUrl: 'https://a.supabase.co', supabaseKey: 'chave-a' }));
    const supabase2 = repo();
    expect(supabase2.modo).toBe('supabase');
    expect(supabase2).not.toBe(local);
  });
});

describe('data/index: armazenamento persistente no modo local', () => {
  it('pede ao navegador para não apagar os dados (navigator.storage.persist) ao criar o repositório local, uma vez', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persist } });
    const repo = await carregarRepo(new MemoryStorage());
    repo();
    repo();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('não pede no modo Supabase e não quebra sem a API (navegador antigo / Node)', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { storage: { persist } });
    const storage = new MemoryStorage();
    storage.setItem('coa-chuva-config', JSON.stringify({ modo: 'supabase', supabaseUrl: 'https://a.supabase.co', supabaseKey: 'chave-a' }));
    (await carregarRepo(storage))();
    expect(persist).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', {});
    const semApi = await carregarRepo(new MemoryStorage());
    expect(semApi().modo).toBe('local');

    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('negado')) } });
    const negado = await carregarRepo(new MemoryStorage());
    expect(negado().modo).toBe('local'); // recusa do navegador não vira erro
  });
});
