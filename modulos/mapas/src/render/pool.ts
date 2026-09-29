/** Fila com limite de tarefas simultâneas e retentativa — usada no carregamento dos tiles. */

/**
 * Limita quantas tarefas assíncronas rodam ao mesmo tempo (fila FIFO). A tarefa só é chamada
 * quando ganha uma vaga, então qualquer timeout criado dentro dela conta a partir desse momento.
 */
export class Limitador {
  private ativos = 0;
  private readonly fila: (() => void)[] = [];
  readonly limite: number;

  constructor(limite: number) {
    this.limite = Math.max(1, Math.floor(limite));
  }

  async executar<T>(tarefa: () => Promise<T> | T): Promise<T> {
    if (this.ativos < this.limite) this.ativos++;
    else await new Promise<void>((liberar) => this.fila.push(liberar)); // a vaga é repassada por quem sai
    try {
      return await tarefa();
    } finally {
      const proxima = this.fila.shift();
      if (proxima) proxima();
      else this.ativos--;
    }
  }
}

/** Executa `fn` até `tentativas` vezes (padrão: 1 retentativa); propaga o último erro. */
export async function comRetentativa<T>(fn: () => Promise<T>, tentativas = 2): Promise<T> {
  let erro: unknown = new Error('nenhuma tentativa');
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      erro = e;
    }
  }
  throw erro;
}

/**
 * Carrega todos os itens respeitando o limitador, com retentativa (dentro da mesma vaga).
 * Nunca rejeita: devolve um resultado "settled" por item, na mesma ordem.
 */
export function carregarTodos<T, R>(
  itens: T[],
  carregar: (item: T) => Promise<R>,
  lim: Limitador,
  tentativas = 2,
): Promise<PromiseSettledResult<R>[]> {
  return Promise.allSettled(itens.map((it) => lim.executar(() => comRetentativa(() => carregar(it), tentativas))));
}
