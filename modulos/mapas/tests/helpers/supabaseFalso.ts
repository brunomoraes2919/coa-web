/**
 * Cliente Supabase falso, em memória e sem rede, para testar o supabaseRepo. Imita o que importa do
 * PostgREST: cada resposta de select traz no máximo `maxLinhas` linhas (1000 no Supabase), com
 * .range/.order/.eq/.in, count exato, upsert pela chave primária, insert (com id gerado e os valores
 * padrão das colunas, como no banco), .single/.maybeSingle, delete e update; o Storage; e a
 * sessão (auth.getSession). Tabela desconhecida responde com o erro do PostgREST (PGRST205), então
 * um nome de tabela errado no repositório aparece nos testes. Registra os nomes usados em from(nome)
 * e storage.from(nome).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Linha = Record<string, unknown>;
type Erro = { message: string; code?: string } | null;

export interface Requisicao {
  /** tabela, ou "storage:<bucket>" nas operações do Storage */
  tabela: string;
  op: 'select' | 'insert' | 'upsert' | 'delete' | 'update' | 'upload' | 'remove';
  /** tamanho de cada lista .in(...) */
  listasIn: number[];
  /** linhas enviadas (insert/upsert) */
  linhas: number;
  /** arquivos (upload/remove) */
  paths?: string[];
}

export interface Envio {
  bucket: string;
  path: string;
  contentType: string | undefined;
  upsert: boolean | undefined;
}

/** Chaves primárias: tabelas do módulo (mapas_*) e as do COA WEB lidas pelo módulo (fazendas, perfis). */
const CHAVES: Record<string, string[]> = {
  mapas_fazendas: ['id'],
  mapas_talhoes: ['id'],
  mapas_safras: ['id'],
  mapas_plantios: ['safra_id', 'talhao_id'],
  mapas_areas_cultura: ['id'],
  mapas_chuva: ['id'],
  mapas_plantio_pims: ['safra', 'unidade'],
  mapas_plantio_pedidos: ['id'],
  fazendas: ['id'],
  perfis: ['id'],
};

/** Colunas preenchidas pelo banco num insert que não as informa (id "generated always as identity" e defaults). */
const PADROES: Record<string, (b: BancoFalso) => Linha> = {
  mapas_plantio_pedidos: (b) => ({
    id: b.tabelas.mapas_plantio_pedidos.reduce((max, l) => Math.max(max, Number(l.id)), 0) + 1,
    pedido_em: new Date().toISOString(),
    pedido_por: b.sessao?.user.id ?? null,
    atendido_em: null,
    resultado: null,
  }),
};

export class BancoFalso {
  tabelas: Record<string, Linha[]> = Object.fromEntries(Object.keys(CHAVES).map((t) => [t, []]));
  arquivos = new Map<string, Blob>();
  requisicoes: Requisicao[] = [];
  /** nomes passados a client.from(nome) */
  tabelasUsadas = new Set<string>();
  /** nomes passados a client.storage.from(nome) */
  buckets = new Set<string>();
  envios: Envio[] = [];
  /** sessão devolvida por auth.getSession (null = sem login) */
  sessao: { user: { id: string } } | null = null;
  /** devolve uma mensagem para simular erro do servidor nesta requisição (tabelas e Storage) */
  falhar: ((r: Requisicao) => string | null) | null = null;

  constructor(public maxLinhas = 1000) {}

  inserir(tabela: string, linhas: object[]): void {
    for (const l of linhas) this.tabelas[tabela].push({ ...(l as Linha) });
  }

  /** Registra a operação do Storage; devolve o erro simulado, se houver. */
  private storage(bucket: string, op: 'upload' | 'remove', paths: string[]): Erro {
    const req: Requisicao = { tabela: `storage:${bucket}`, op, listasIn: [], linhas: 0, paths };
    this.requisicoes.push(req);
    const msg = this.falhar?.(req);
    return msg ? { message: msg } : null;
  }

  cliente(): SupabaseClient {
    return {
      from: (tabela: string) => {
        this.tabelasUsadas.add(tabela);
        return new Consulta(this, tabela);
      },
      auth: {
        getSession: async () => ({ data: { session: this.sessao }, error: null }),
      },
      storage: {
        from: (bucket: string) => {
          this.buckets.add(bucket);
          return {
            upload: async (path: string, blob: Blob, opcoes?: { contentType?: string; upsert?: boolean }) => {
              const error = this.storage(bucket, 'upload', [path]);
              if (error) return { data: null, error };
              this.envios.push({ bucket, path, contentType: opcoes?.contentType, upsert: opcoes?.upsert });
              this.arquivos.set(path, blob);
              return { data: { path }, error: null };
            },
            remove: async (paths: string[]) => {
              const error = this.storage(bucket, 'remove', paths);
              if (error) return { data: null, error };
              paths.forEach((p) => this.arquivos.delete(p));
              return { data: [], error: null };
            },
            createSignedUrl: async (path: string) =>
              this.arquivos.has(path)
                ? { data: { signedUrl: `https://falso/${path}` }, error: null }
                : { data: null, error: { message: 'Object not found' } },
          };
        },
      },
    } as unknown as SupabaseClient;
  }
}

class Consulta implements PromiseLike<{ data: unknown; error: Erro; count: number | null }> {
  private op: 'select' | 'insert' | 'upsert' | 'delete' | 'update' = 'select';
  private colunas = '*';
  private comContagem = false;
  private filtros: ((l: Linha) => boolean)[] = [];
  private listasIn: number[] = [];
  private ordem: { col: string; asc: boolean }[] = [];
  private faixa: [number, number] | null = null;
  /** maybeSingle: 0 ou 1 linha; single: exatamente 1 (senão erro PGRST116, como no PostgREST) */
  private umSo: 'talvez' | 'exato' | null = null;
  /** .select(...) depois de insert: devolve as linhas inseridas */
  private devolver = false;
  private payload: Linha[] = [];
  private mudancas: Linha = {};

  constructor(
    private banco: BancoFalso,
    private tabela: string,
  ) {}

  select(colunas = '*', opcoes?: { count?: 'exact' }) {
    this.colunas = colunas;
    this.devolver = true;
    this.comContagem = opcoes?.count === 'exact';
    return this;
  }
  insert(linhas: Linha | Linha[]) {
    this.op = 'insert';
    this.payload = Array.isArray(linhas) ? linhas : [linhas];
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
    this.umSo = 'talvez';
    return this;
  }
  single() {
    this.umSo = 'exato';
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
    const tabela = this.banco.tabelas[this.tabela];
    if (!tabela) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.tabela}' in the schema cache` }, count: null };
    }
    const msg = this.banco.falhar?.(req);
    if (msg) return { data: null, error: { message: msg }, count: null };
    const passa = (l: Linha) => this.filtros.every((f) => f(l));
    const projetar = (l: Linha): Linha => {
      if (this.colunas.trim() === '*') return { ...l };
      return Object.fromEntries(this.colunas.split(',').map((c) => [c.trim(), l[c.trim()]]));
    };
    const responder = (linhas: Linha[], count: number | null) => {
      const data = linhas.map(projetar);
      if (this.umSo === 'exato' && data.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count: null };
      }
      if (this.umSo) return { data: data[0] ?? null, error: null, count: null };
      return { data, error: null, count };
    };

    if (this.op === 'insert') {
      const novas = this.payload.map((l) => ({ ...(PADROES[this.tabela]?.(this.banco) ?? {}), ...l }));
      tabela.push(...novas);
      return this.devolver ? responder(novas, null) : { data: null, error: null, count: null };
    }

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
    return responder(linhas, this.comContagem ? total : null);
  }
}
