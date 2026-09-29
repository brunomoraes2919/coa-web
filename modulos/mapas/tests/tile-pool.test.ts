import { describe, expect, it } from 'vitest';
import { Limitador, carregarTodos, comRetentativa } from '../src/render/pool';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Limitador', () => {
  it('nunca passa do limite de tarefas simultâneas e executa todas', async () => {
    const lim = new Limitador(3);
    let ativos = 0;
    let max = 0;
    const feitos: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        lim.executar(async () => {
          ativos++;
          max = Math.max(max, ativos);
          await espera(1 + (i % 4));
          ativos--;
          feitos.push(i);
        }),
      ),
    );
    expect(max).toBe(3);
    expect(feitos.sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
  });

  it('só começa a tarefa quando ganha a vaga (o timeout do tile conta a partir daí)', async () => {
    const lim = new Limitador(1);
    const inicios: number[] = [];
    const t0 = Date.now();
    await Promise.all([0, 1].map(() => lim.executar(async () => {
      inicios.push(Date.now() - t0);
      await espera(30);
    })));
    expect(inicios[1]).toBeGreaterThanOrEqual(25);
  });

  it('libera a vaga quando a tarefa falha, inclusive com erro síncrono', async () => {
    const lim = new Limitador(1);
    await expect(lim.executar(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(
      lim.executar(() => {
        throw new Error('y');
      }),
    ).rejects.toThrow('y');
    await expect(lim.executar(async () => 42)).resolves.toBe(42);
  });
});

describe('comRetentativa', () => {
  it('tenta de novo uma vez depois de uma falha', async () => {
    let n = 0;
    const r = await comRetentativa(async () => {
      n++;
      if (n === 1) throw new Error('falhou');
      return 'ok';
    });
    expect(r).toBe('ok');
    expect(n).toBe(2);
  });

  it('desiste depois da segunda falha e propaga o último erro', async () => {
    let n = 0;
    await expect(
      comRetentativa(async () => {
        n++;
        throw new Error(`e${n}`);
      }),
    ).rejects.toThrow('e2');
    expect(n).toBe(2);
  });

  it('não repete quando dá certo', async () => {
    let n = 0;
    await comRetentativa(async () => ++n);
    expect(n).toBe(1);
  });
});

describe('carregarTodos (carregador falso)', () => {
  it('limita o paralelismo, repete cada falha uma vez e devolve todos os resultados', async () => {
    const lim = new Limitador(4);
    let ativos = 0;
    let max = 0;
    const chamadas = new Map<number, number>();
    const carregar = async (i: number) => {
      chamadas.set(i, (chamadas.get(i) ?? 0) + 1);
      ativos++;
      max = Math.max(max, ativos);
      try {
        await espera(1 + (i % 3));
        if (i % 5 === 0) throw new Error(`sempre falha ${i}`);
        if (i % 5 === 1 && chamadas.get(i) === 1) throw new Error(`falha uma vez ${i}`);
        return i * 10;
      } finally {
        ativos--;
      }
    };
    const itens = [...Array(30).keys()];
    const res = await carregarTodos(itens, carregar, lim);
    expect(res).toHaveLength(30);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBe(4);
    res.forEach((r, i) => {
      if (i % 5 === 0) {
        expect(r.status).toBe('rejected');
        expect(chamadas.get(i)).toBe(2);
      } else {
        expect(r).toEqual({ status: 'fulfilled', value: i * 10 });
        expect(chamadas.get(i)).toBe(i % 5 === 1 ? 2 : 1);
      }
    });
  });

  it('lista vazia resolve imediatamente', async () => {
    await expect(carregarTodos([], async () => 1, new Limitador(2))).resolves.toEqual([]);
  });
});
