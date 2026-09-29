/**
 * Cliente Supabase falso, em memória e sem rede, para testar o supabaseRepo. Imita o que importa do
 * PostgREST: cada resposta de select traz no máximo `maxLinhas` linhas (1000 no Supabase), com
 * .range/.order/.eq/.in, count exato, upsert pela chave primária, delete e update; e o Storage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Linha = Record<string, unknown>;
type Erro = { message: string } | null;

export interface Requisicao {
  tabela: string;
  op: 'select' | 'upsert' | 'delete' | 'update';
  /** tamanho de cada lista .in(...) */
  listasIn: number[];
  /** linhas enviadas (upsert) */
  linhas: number;
}

const CHAVES: Record<string, string[]> = {
  fazendas: ['id'],
  talhoes: ['id'],
  safras: ['id'],
  plantios: ['safra_id', 'talhao_id'],
  mapas: ['id'],
  areas_cultura: ['id'],
};

export class BancoFalso {
  tabelas: Record<string, Linha[]> = { fazendas: [], talhoes: [], safras: [], plantios: [], mapas: [], areas_cultura: [] };
  arquivos = new Map<string, Blob>();
  requisicoes: Requisicao[] = [];
  /** devolve uma mensagem para simular erro do servidor nesta requisição */
  falhar: ((r: Requisicao) => string | null) | null = null;

  constructor(public maxLinhas = 1000) {}

  inserir(tabela: string, linhas: object[]): void {
    for (const l of linhas) this.tabelas[tabela].push({ ...(l as Linha) });
  }

  cliente(): SupabaseClient {
    return {
      from: (tabela: string) => new Consulta(this, tabela),
      storage: {
        from: () => ({
          upload: async (path: string, blob: Blob) => {
            this.arquivos.set(path, blob);
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            paths.forEach((p) => this.arquivos.delete(p));
            return { data: [], error: null };
          },
          createSignedUrl: async (path: string) =>
            this.arquivos.has(path)
              ? { data: { signedUrl: `https://falso/${path}` }, error: null }
              : { data: null, error: { message: 'Object not found' } },
        }),
      },
    } as unknown as SupabaseClient;
  }
}

class Consulta implements PromiseLike<{ data: unknown; error: Erro; count: number | null }> {
  private op: Requisicao['op'] = 'select';
  private colunas = '*';
  private comContagem = false;
  private filtros: ((l: Linha) => boolean)[] = [];
  private listasIn: number[] = [];
  private ordem: { col: string; asc: boolean }[] = [];
  private faixa: [number, number] | null = null;
  private umSo = false;
  private payload: Linha[] = [];
  private mudancas: Linha = {};

  constructor(
    private banco: BancoFalso,
    private tabela: string,
  ) {}

  select(colunas = '*', opcoes?: { count?: 'exact' }) {
    this.colunas = colunas;
    this.comContagem = opcoes?.count === 'exact';
    return this;
  }
  upsert(linhas: Linha | Linha[]) {
    this.op = 'upsert';
    this.payload = Array.isArray(linhas) ? linhas : [linhas];
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  update(mudancas: Linha) {
    this.op = 'update';
    this.mudancas = mudancas;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filtros.push((l) => l[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.listasIn.push(vs.length);
    const conjunto = new Set(vs);
    this.filtros.push((l) => conjunto.has(l[col]));
    return this;
  }
  order(col: string, opcoes?: { ascending?: boolean }) {
    this.ordem.push({ col, asc: opcoes?.ascending !== false });
    return this;
  }
  range(de: number, ate: number) {
    this.faixa = [de, ate];
    return this;
  }
  maybeSingle() {
    this.umSo = true;
    return this;
  }

  then<A = { data: unknown; error: Erro; count: number | null }, B = never>(
    ok?: ((v: { data: unknown; error: Erro; count: number | null }) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.executar()).then(ok, falha);
  }

  private executar(): { data: unknown; error: Erro; count: number | null } {
    const req: Requisicao = { tabela: this.tabela, op: this.op, listasIn: this.listasIn, linhas: this.payload.length };
    this.banco.requisicoes.push(req);
    const msg = this.banco.falhar?.(req);
    if (msg) return { data: null, error: { message: msg }, count: null };
    const tabela = this.banco.tabelas[this.tabela];
    const passa = (l: Linha) => this.filtros.every((f) => f(l));

    if (this.op === 'upsert') {
      const chave = CHAVES[this.tabela];
      for (const nova of this.payload) {
        const i = tabela.findIndex((l) => chave.every((k) => l[k] === nova[k]));
        if (i >= 0) tabela[i] = { ...nova };
        else tabela.push({ ...nova });
      }
      return { data: null, error: null, count: null };
    }
    if (this.op === 'delete') {
      this.banco.tabelas[this.tabela] = tabela.filter((l) => !passa(l));
      return { data: null, error: null, count: null };
    }
    if (this.op === 'update') {
      tabela.forEach((l, i) => {
        if (passa(l)) tabela[i] = { ...l, ...this.mudancas };
      });
      return { data: null, error: null, count: null };
    }

    let linhas = tabela.filter(passa);
    const total = linhas.length;
    if (this.ordem.length) {
      linhas = [...linhas].sort((a, b) => {
        for (const { col, asc } of this.ordem) {
          const va = String(a[col] ?? '');
          const vb = String(b[col] ?? '');
          if (va !== vb) return (va < vb ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.faixa) linhas = linhas.slice(this.faixa[0], this.faixa[1] + 1);
    linhas = linhas.slice(0, this.banco.maxLinhas); // limite do servidor (max-rows)
    const projetar = (l: Linha): Linha => {
      if (this.colunas.trim() === '*') return { ...l };
      return Object.fromEntries(this.colunas.split(',').map((c) => [c.trim(), l[c.trim()]]));
    };
    const data = linhas.map(projetar);
    if (this.umSo) return { data: data[0] ?? null, error: null, count: null };
    return { data, error: null, count: this.comContagem ? total : null };
  }
}
