import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import { erroPedido } from '../src/data/supabasePedidos';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { buscarChuvaZeus, lerDadosChuva, picsDaIntegracao, validarPeriodo, type DadosChuvaZeus, type SituacaoPedidoChuva } from '../src/lib/chuvaZeus';
import { BancoFalso } from './helpers/supabaseFalso';

const resposta = (o: Partial<DadosChuvaZeus> = {}): DadosChuvaZeus => ({
  fazenda: 'SM3',
  de: '2026-10-01',
  ate: '2026-10-01',
  ultimoDia: '2026-10-01',
  pics: [
    { id: '4700', nome: 'PIC 27 SM3', lat: -17.382932, lon: -54.745256, chuva: 1, leituras: 96 },
    { id: '4287', nome: 'PIC 37 SM3 ', lat: -17.354717, lon: -54.740937, chuva: 1.4, leituras: 96 },
  ],
  ...o,
});

describe('validarPeriodo (janela "Inserir dados via integração")', () => {
  const hoje = '2026-10-05';
  it('aceita um dia só e um intervalo até hoje', () => {
    expect(validarPeriodo('2026-10-01', '2026-10-01', hoje)).toBeNull();
    expect(validarPeriodo('2026-09-01', '2026-10-05', hoje)).toBeNull();
  });
  it('recusa datas vazias, invertidas, no futuro e períodos longos demais', () => {
    expect(validarPeriodo('', '2026-10-01', hoje)).toBe('Informe as duas datas do período.');
    expect(validarPeriodo('2026-10-02', '2026-10-01', hoje)).toBe('A data inicial é depois da final.');
    expect(validarPeriodo('2026-10-01', '2026-10-06', hoje)).toBe('O período não pode passar de hoje.');
    expect(validarPeriodo('2025-01-01', '2026-10-01', hoje)).toMatch(/^Período muito longo \(639 dias\)/);
  });
});

describe('picsDaIntegracao (resposta do servidor → os PICs que o CSV daria)', () => {
  it('monta os PICs com o período do pedido e todos marcados', () => {
    const r = picsDaIntegracao(lerDadosChuva(resposta()));
    expect(r.nome).toBe('Integração ZEUS · 01/10/2026');
    expect(r.pics).toHaveLength(2);
    expect(r.pics[0]).toMatchObject({ id: '4700', nome: 'PIC 27 SM3', lat: -17.382932, lon: -54.745256, chuva: 1, inativo: false, incluir: true });
    expect(r.pics[1].nome).toBe('PIC 37 SM3');
    expect(r.inicio).toEqual(new Date(2026, 9, 1));
    expect(r.fim).toEqual(new Date(2026, 9, 1));
    expect(r.avisos).toEqual([]);
  });

  it('PIC sem leitura fica desmarcado, com aviso; zero é leitura', () => {
    const d = resposta();
    d.pics[0] = { ...d.pics[0], chuva: null, leituras: 0 };
    d.pics[1] = { ...d.pics[1], chuva: 0 };
    const r = picsDaIntegracao(lerDadosChuva(d));
    expect(r.pics.map((p) => [p.chuva, p.incluir])).toEqual([[null, false], [0, true]]);
    expect(r.avisos).toEqual(['1 PIC sem leitura no período foi desmarcado']);
  });

  it('avisa quando a ZEUS ainda não tem os últimos dias do período', () => {
    const r = picsDaIntegracao(lerDadosChuva(resposta({ de: '2026-10-01', ate: '2026-10-05', ultimoDia: '2026-10-04' })));
    expect(r.nome).toBe('Integração ZEUS · 01 a 05/10/2026');
    expect(r.avisos).toEqual(['A ZEUS só tem leituras até 04/10/2026: a chuva de 05/10/2026 em diante ainda não entrou no total.']);
  });

  it('nenhum PIC com leitura (ou nenhum PIC) é erro, não um mapa vazio', () => {
    const d = resposta({ ultimoDia: null });
    d.pics = d.pics.map((p) => ({ ...p, chuva: null, leituras: 0 }));
    expect(() => picsDaIntegracao(lerDadosChuva(d))).toThrow(/Nenhum PIC desta fazenda tem leitura na ZEUS em 01\/10\/2026/);
    expect(() => picsDaIntegracao(lerDadosChuva(resposta({ pics: [] })))).toThrow('A ZEUS não devolveu nenhum PIC para esta fazenda.');
  });

  it('resposta fora do formato é recusada; PIC sem coordenada é ignorado', () => {
    expect(() => lerDadosChuva(null)).toThrow('O servidor devolveu uma resposta que não foi possível ler.');
    expect(() => lerDadosChuva({ pics: 'x' })).toThrow();
    const d = lerDadosChuva({ ...resposta(), pics: [{ id: 1, nome: 'A', lat: 'x', lon: 2, chuva: 1 }, { id: 2, nome: '', lat: -1, lon: -2, chuva: -3 }] });
    expect(d.pics).toEqual([{ id: '2', nome: 'PIC 2', lat: -1, lon: -2, chuva: null, leituras: 0 }]);
  });
});

describe('buscarChuvaZeus (pedido → espera → PICs)', () => {
  const dormir = async () => undefined;
  const pendente: SituacaoPedidoChuva = { atendidoEm: null, resultado: null, dados: null };

  it('ok: espera o servidor e devolve os PICs', async () => {
    const etapas: string[] = [];
    const situacao = vi.fn<(id: number) => Promise<SituacaoPedidoChuva | null>>()
      .mockResolvedValueOnce(pendente)
      .mockResolvedValue({ atendidoEm: '2026-10-05T10:00:20.000Z', resultado: 'ok', dados: resposta() });
    const fim = await buscarChuvaZeus({ pedir: async () => 12, situacao, aoEtapa: (t) => etapas.push(t), opcoes: { dormir } });
    expect(situacao).toHaveBeenCalledWith(12);
    expect(etapas).toEqual(['Pedindo ao servidor…', 'Buscando na ZEUS… (até 1 minuto)']);
    expect(fim.tipo).toBe('ok');
    if (fim.tipo === 'ok') expect(fim.resultado.pics.map((p) => p.chuva)).toEqual([1, 1.4]);
  });

  it('erro do servidor, tempo esgotado e falha ao pedir viram texto para a tela', async () => {
    const erro = await buscarChuvaZeus({
      pedir: async () => 1,
      situacao: async () => ({ atendidoEm: 'x', resultado: 'erro: A ZEUS não tem PICs para a fazenda "X".', dados: null }),
      opcoes: { dormir },
    });
    expect(erro).toEqual({ tipo: 'erro', texto: 'O servidor não conseguiu buscar a chuva: A ZEUS não tem PICs para a fazenda "X".' });

    const tempo = await buscarChuvaZeus({ pedir: async () => 1, situacao: async () => pendente, opcoes: { dormir, limiteMs: 8000 } });
    expect(tempo).toEqual({ tipo: 'erro', texto: 'O servidor não respondeu em 2 minutos. Tente de novo em instantes.' });

    const semPedido = await buscarChuvaZeus({ pedir: async () => { throw new Error('Sem permissão.'); }, situacao: async () => null, opcoes: { dormir } });
    expect(semPedido).toEqual({ tipo: 'erro', texto: 'Sem permissão.' });
  });
});

describe('repositório: pedidos de chuva (mapas_chuva_pedidos)', () => {
  it('Supabase: grava fazenda e período e lê a resposta', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    const repo = criarSupabaseRepo(banco.cliente());
    expect(repo.podeBuscarChuva).toBe(true);

    const id = await repo.pedirChuvaZeus({ fazenda: '  SM3 ', de: '2026-10-01', ate: '2026-10-02' });
    expect(banco.tabelas.mapas_chuva_pedidos[0]).toMatchObject({ id, fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-02', pedido_por: 'u1', atendido_em: null, dados: null });
    expect(await repo.situacaoPedidoChuva(id)).toEqual({ atendidoEm: null, resultado: null, dados: null });

    Object.assign(banco.tabelas.mapas_chuva_pedidos[0], { atendido_em: '2026-10-05T10:00:20.000Z', resultado: 'ok', dados: resposta() });
    expect(await repo.situacaoPedidoChuva(id)).toEqual({ atendidoEm: '2026-10-05T10:00:20.000Z', resultado: 'ok', dados: resposta() });
    expect(await repo.situacaoPedidoChuva(999)).toBeNull();
  });

  it('tabela ausente: a mensagem aponta o script 0003', () => {
    expect(erroPedido('pedir a chuva da ZEUS', { code: 'PGRST205', message: 'Could not find the table' }, '0003_pedidos_chuva.sql').message).toBe(
      'Não foi possível pedir a chuva da ZEUS: falta a tabela de pedidos no Supabase (rode supabase/coa-web/0003_pedidos_chuva.sql).',
    );
  });

  it('local: o botão não existe e o pedido lança erro em português', async () => {
    const repo = criarLocalRepo('coa-chuva-teste-pedido-chuva');
    expect(repo.podeBuscarChuva).toBe(false);
    await expect(repo.pedirChuvaZeus({ fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-01' })).rejects.toThrow('Inserir dados via integração só funciona no COA WEB.');
    expect(await repo.situacaoPedidoChuva(1)).toBeNull();
  });
});
