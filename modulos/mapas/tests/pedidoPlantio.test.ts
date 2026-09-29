import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import { TABELAS } from '../src/data/supabaseLinhas';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { aguardarPedido, atualizarPlantio, textoPlantioPims, type PassosAtualizacao, type SituacaoPedidoPlantio } from '../src/lib/pedidoPlantio';
import { BancoFalso } from './helpers/supabaseFalso';

const pendente: SituacaoPedidoPlantio = { atendidoEm: null, resultado: null };
const atendido = (resultado: string | null): SituacaoPedidoPlantio => ({ atendidoEm: '2026-09-29T10:00:30.000Z', resultado });

/** `dormir` falso: não espera de verdade, só registra quanto seria esperado. */
function relogio() {
  const esperas: number[] = [];
  return { esperas, dormir: async (ms: number) => void esperas.push(ms) };
}

describe('aguardarPedido (espera o servidor atender o pedido de atualização do plantio)', () => {
  it('ok: espera o intervalo antes de cada leitura até o pedido ser atendido', async () => {
    const { esperas, dormir } = relogio();
    const ler = vi.fn<() => Promise<SituacaoPedidoPlantio | null>>().mockResolvedValueOnce(pendente).mockResolvedValueOnce(pendente).mockResolvedValue(atendido('ok'));

    expect(await aguardarPedido(ler, { dormir })).toEqual({ tipo: 'ok' });
    expect(ler).toHaveBeenCalledTimes(3);
    expect(esperas).toEqual([4000, 4000, 4000]);
  });

  it('erro: devolve a mensagem do servidor sem o prefixo "erro: "', async () => {
    const { dormir } = relogio();
    const ler = async () => atendido('erro: Agrovex fora do ar');
    expect(await aguardarPedido(ler, { dormir })).toEqual({ tipo: 'erro', mensagem: 'Agrovex fora do ar' });
  });

  it('erro: resultado sem o prefixo ou vazio também é erro', async () => {
    const { dormir } = relogio();
    expect(await aguardarPedido(async () => atendido('falhou'), { dormir })).toEqual({ tipo: 'erro', mensagem: 'falhou' });
    expect(await aguardarPedido(async () => atendido(null), { dormir })).toEqual({ tipo: 'erro', mensagem: 'sem detalhes' });
    expect(await aguardarPedido(async () => atendido('erro: '), { dormir })).toEqual({ tipo: 'erro', mensagem: 'sem detalhes' });
  });

  it('tempo: sem resposta até o limite (a última leitura é feita no limite)', async () => {
    const { esperas, dormir } = relogio();
    const ler = vi.fn(async () => pendente);

    expect(await aguardarPedido(ler, { intervaloMs: 4000, limiteMs: 10000, dormir })).toEqual({ tipo: 'tempo' });
    expect(esperas).toEqual([4000, 4000, 2000]);
    expect(ler).toHaveBeenCalledTimes(3);
  });

  it('intervalo 0 ou negativo não vira laço infinito', async () => {
    const { esperas, dormir } = relogio();
    expect(await aguardarPedido(async () => pendente, { intervaloMs: 0, limiteMs: 5, dormir })).toEqual({ tipo: 'tempo' });
    expect(esperas.length).toBe(5);
  });

  it('padrão: lê a cada 4 s por até 120 s (os 2 minutos do aviso)', async () => {
    const { esperas, dormir } = relogio();
    expect(await aguardarPedido(async () => pendente, { dormir })).toEqual({ tipo: 'tempo' });
    expect(esperas.reduce((a, b) => a + b, 0)).toBe(120000);
    expect(Math.max(...esperas)).toBe(4000);
  });

  it('pedido não encontrado (null) conta como pendente', async () => {
    const { dormir } = relogio();
    const ler = vi.fn<() => Promise<SituacaoPedidoPlantio | null>>().mockResolvedValueOnce(null).mockResolvedValue(atendido('ok'));
    expect(await aguardarPedido(ler, { dormir })).toEqual({ tipo: 'ok' });
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it('falha passageira na leitura (rede) é ignorada e a leitura é repetida', async () => {
    const { dormir } = relogio();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ler = vi
      .fn<() => Promise<SituacaoPedidoPlantio | null>>()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(atendido('ok'));

    expect(await aguardarPedido(ler, { dormir })).toEqual({ tipo: 'ok' });
    expect(ler).toHaveBeenCalledTimes(3);
    expect(aviso).toHaveBeenCalledTimes(2);
    aviso.mockRestore();
  });

  it('leitura falhando até o limite → tempo', async () => {
    const { dormir } = relogio();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ler = async (): Promise<SituacaoPedidoPlantio | null> => {
      throw new Error('Failed to fetch');
    };
    expect(await aguardarPedido(ler, { intervaloMs: 1000, limiteMs: 3000, dormir })).toEqual({ tipo: 'tempo' });
    aviso.mockRestore();
  });
});

describe('supabaseRepo: pedidos de atualização do plantio (mapas_plantio_pedidos)', () => {
  it('TABELAS.pedidosPlantio', () => {
    expect(TABELAS.pedidosPlantio).toBe('mapas_plantio_pedidos');
  });

  it('pode atualizar o plantio no modo Supabase', () => {
    expect(criarSupabaseRepo(new BancoFalso().cliente()).podeAtualizarPlantio).toBe(true);
  });

  it('pedirAtualizacaoPlantio insere uma linha vazia (o banco preenche o resto) e devolve o id novo', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    const repo = criarSupabaseRepo(banco.cliente());

    const id1 = await repo.pedirAtualizacaoPlantio();
    const id2 = await repo.pedirAtualizacaoPlantio();

    expect(typeof id1).toBe('number');
    expect(id2).toBeGreaterThan(id1);
    const linhas = banco.tabelas.mapas_plantio_pedidos;
    expect(linhas.map((l) => l.id)).toEqual([id1, id2]);
    expect(linhas[0]).toMatchObject({ pedido_por: 'u1', atendido_em: null, resultado: null });
    expect(banco.requisicoes.filter((r) => r.tabela === 'mapas_plantio_pedidos').map((r) => r.op)).toEqual(['insert', 'insert']);
  });

  it('pedirAtualizacaoPlantio: erro do servidor (ex.: RLS) vira exceção com contexto', async () => {
    const banco = new BancoFalso();
    banco.falhar = (r) => (r.op === 'insert' ? 'new row violates row-level security policy' : null);
    await expect(criarSupabaseRepo(banco.cliente()).pedirAtualizacaoPlantio()).rejects.toThrow(
      'Sem permissão para pedir a atualização do plantio: é preciso ter pelo menos uma fazenda liberada no COA WEB.',
    );
  });

  it('situacaoPedidoPlantio lê atendido_em e resultado do pedido; inexistente → null', async () => {
    const banco = new BancoFalso();
    banco.inserir('mapas_plantio_pedidos', [
      { id: 7, pedido_em: '2026-09-29T10:00:00.000Z', pedido_por: 'u1', atendido_em: null, resultado: null },
      { id: 8, pedido_em: '2026-09-29T10:00:05.000Z', pedido_por: 'u1', atendido_em: '2026-09-29T10:00:40.000Z', resultado: 'erro: sem rede' },
    ]);
    const repo = criarSupabaseRepo(banco.cliente());

    expect(await repo.situacaoPedidoPlantio(7)).toEqual({ atendidoEm: null, resultado: null });
    expect(await repo.situacaoPedidoPlantio(8)).toEqual({ atendidoEm: '2026-09-29T10:00:40.000Z', resultado: 'erro: sem rede' });
    expect(await repo.situacaoPedidoPlantio(99)).toBeNull();
  });

  it('situacaoPedidoPlantio: erro do servidor vira exceção com contexto', async () => {
    const banco = new BancoFalso();
    banco.falhar = () => 'Failed to fetch';
    await expect(criarSupabaseRepo(banco.cliente()).situacaoPedidoPlantio(1)).rejects.toThrow(
      'Não foi possível acompanhar o pedido de atualização do plantio: o Supabase não respondeu a tempo. Verifique a internet e tente de novo.',
    );
  });
});

describe('localRepo: sem atualização do plantio (só no COA WEB)', () => {
  const repo = () => criarLocalRepo('coa-chuva-teste-pedido-plantio');

  it('não pode atualizar o plantio', () => {
    expect(repo().podeAtualizarPlantio).toBe(false);
  });

  it('pedirAtualizacaoPlantio lança erro em português', async () => {
    await expect(repo().pedirAtualizacaoPlantio()).rejects.toThrow('Atualizar o plantio só funciona no COA WEB.');
  });

  it('situacaoPedidoPlantio → null (não há pedidos no modo local)', async () => {
    expect(await repo().situacaoPedidoPlantio(1)).toBeNull();
  });
});

/** 29/09 10:05 no fuso local (o texto mostra a hora local). */
const geradoEm = new Date(2026, 8, 29, 10, 5).toISOString();

describe('textoPlantioPims (data do plantio do PIMS no topo da página)', () => {
  it('dd/MM HH:mm na hora local; sem plantio → "sem dados"; carregando → "…"', () => {
    expect(textoPlantioPims(geradoEm)).toBe('Plantio do PIMS: 29/09 10:05');
    expect(textoPlantioPims(null)).toBe('Plantio do PIMS: sem dados');
    expect(textoPlantioPims(undefined)).toBe('Plantio do PIMS: …');
  });
});

describe('atualizarPlantio (fluxo do botão "Atualizar plantio")', () => {
  function passos(p: Partial<PassosAtualizacao> = {}) {
    const etapas: string[] = [];
    const base: PassosAtualizacao = {
      pedir: vi.fn(async () => 42),
      situacao: vi.fn(async () => atendido('ok')),
      recarregar: vi.fn(async () => ({ geradoEm })),
      aoEtapa: (texto) => void etapas.push(texto),
      opcoes: { dormir: async () => undefined },
      ...p,
    };
    return { etapas, p: base };
  }

  it('ok: pede, acompanha o pedido pelo id, relê o plantio e avisa a data nova', async () => {
    const { etapas, p } = passos();
    expect(await atualizarPlantio(p)).toEqual({ tipo: 'sucesso', texto: 'Plantio atualizado: PIMS 29/09 10:05' });
    expect(etapas).toEqual(['Pedindo ao servidor…', 'Buscando no PIMS… (até 1 minuto)']);
    expect(p.situacao).toHaveBeenCalledWith(42);
    expect(p.recarregar).toHaveBeenCalledTimes(1);
  });

  it('ok sem plantio no banco: "PIMS sem dados"', async () => {
    const { p } = passos({ recarregar: async () => null });
    expect(await atualizarPlantio(p)).toEqual({ tipo: 'sucesso', texto: 'Plantio atualizado: PIMS sem dados' });
  });

  it('erro do servidor: mostra a mensagem dele e não relê o plantio', async () => {
    const { p } = passos({ situacao: async () => atendido('erro: Agrovex fora do ar') });
    expect(await atualizarPlantio(p)).toEqual({ tipo: 'erro', texto: 'O servidor não conseguiu atualizar o plantio: Agrovex fora do ar' });
    expect(p.recarregar).not.toHaveBeenCalled();
  });

  it('sem resposta no limite: alerta de tempo', async () => {
    const { p } = passos({ situacao: async () => pendente });
    expect(await atualizarPlantio(p)).toEqual({
      tipo: 'alerta',
      texto: 'O servidor não respondeu em 2 minutos. O plantio também é atualizado sozinho a cada hora.',
    });
    expect(p.recarregar).not.toHaveBeenCalled();
  });

  it('falha ao gravar o pedido: erro traduzido, sem acompanhar nada', async () => {
    const { etapas, p } = passos({
      pedir: async () => {
        throw new Error('Atualizar o plantio só funciona no COA WEB.');
      },
    });
    expect(await atualizarPlantio(p)).toEqual({ tipo: 'erro', texto: 'Atualizar o plantio só funciona no COA WEB.' });
    expect(etapas).toEqual(['Pedindo ao servidor…']);
    expect(p.situacao).not.toHaveBeenCalled();

    const { p: semRede } = passos({
      pedir: async () => {
        throw new Error('Não foi possível pedir a atualização do plantio: Failed to fetch');
      },
    });
    expect((await atualizarPlantio(semRede)).texto).toBe('Não foi possível conectar ao servidor. Verifique a internet e as configurações.');
  });

  it('servidor atualizou mas a releitura falhou: erro explicando', async () => {
    const { p } = passos({
      recarregar: async () => {
        throw new Error('Failed to fetch');
      },
    });
    expect(await atualizarPlantio(p)).toEqual({
      tipo: 'erro',
      texto:
        'O servidor atualizou o plantio, mas não foi possível carregá-lo: Não foi possível conectar ao servidor. Verifique a internet e as configurações. Recarregue a página.',
    });
  });
});
