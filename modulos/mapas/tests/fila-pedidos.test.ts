// Freios das filas de pedidos: um usuário não pode fazer o servidor martelar o PIMS, o SAP ou a ZEUS.
//   * toda leitura de pendentes tem ordem e limite;
//   * "Atualizar plantio" e "Atualizar" da Validação: rodada completa há menos de 5 min → 'ok' sem consultar;
//   * chuva e boletins: um pedido de cada usuário por verificação; mais de 5 pendentes → "muitos pedidos".
import { describe, expect, it } from 'vitest';
import {
  atenderPedidos, atenderPedidosChuva, atenderPedidosMec, atenderPedidosValidacao, MAX_PENDENTES_POR_USUARIO, MENSAGENS_DE_ERRO,
  pedidosChuvaPendentes, pedidosMecPendentes, planejarFila, RECENTE_MINUTOS, RESULTADOS,
} from '../scripts/atender-pedidos.mjs';
import { bancoDePermissoes, CHAVE, servidoresFalsos, TOKEN, URL_AGROVEX, URL_SB, USUARIO, type TabelaFalsa } from './helpers/servidoresFalsos';

const AGORA = new Date('2026-10-05T10:00:00.000Z');
const haMinutos = (n: number) => new Date(AGORA.getTime() - n * 60_000).toISOString();
const A = USUARIO.colaborador;
const B = USUARIO.outroColaborador;
const C = USUARIO.adminRestrito;
const ctx = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ url: URL_SB, chave: CHAVE, fetch: impl });
const opcoes = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: URL_AGROVEX, token: TOKEN }, fetch: impl, agora: () => AGORA });

describe('planejarFila', () => {
  const p = (id: number, pedido_por: string | null) => ({ id, pedido_por });

  it('atende o pedido mais antigo de cada usuário, do mais antigo para o mais novo', () => {
    const plano = planejarFila([p(5, B), p(1, A), p(2, A), p(3, A), p(9, C)], { porRodada: 5 });
    expect(plano.atender.map((x) => x.id)).toEqual([1, 5, 9]);
    expect(plano.excesso).toEqual([]);
  });

  it('respeita o máximo por verificação: quem pediu primeiro vai primeiro, e ninguém passa duas vezes', () => {
    const plano = planejarFila([p(1, A), p(2, A), p(3, B), p(4, C), p(5, A)], { porRodada: 2 });
    expect(plano.atender.map((x) => x.id)).toEqual([1, 3]);
  });

  it(`quem tem mais de ${MAX_PENDENTES_POR_USUARIO} pendentes recebe "muitos pedidos" nos que passam disso; os outros usuários não são afetados`, () => {
    const deA = [1, 2, 3, 4, 6, 7, 8, 10].map((id) => p(id, A));
    const plano = planejarFila([...deA, p(5, B), p(9, B)], { porRodada: 5 });
    expect(MAX_PENDENTES_POR_USUARIO).toBe(5);
    expect(plano.atender.map((x) => x.id)).toEqual([1, 5]);
    // de A ficam 1, 2, 3, 4 e 6; saem os que vêm depois do 6
    expect(plano.excesso).toEqual([{ pedidoPor: A, depoisDoId: 6, ids: [7, 8, 10] }]);
    // exatamente 5 pendentes ainda não é excesso
    expect(planejarFila(deA.slice(0, 5), { porRodada: 5 }).excesso).toEqual([]);
  });

  it('o mesmo usuário escrito em maiúsculas é o mesmo usuário; pedido sem dono legível vai para um grupo só', () => {
    const plano = planejarFila([p(1, A), p(2, A.toUpperCase()), p(3, null), p(4, 'não é uuid'), { id: 5 }], { porRodada: 5, maxPorUsuario: 1 });
    expect(plano.atender.map((x) => x.id)).toEqual([1, 3]);
    expect(plano.excesso).toEqual([
      { pedidoPor: A, depoisDoId: 1, ids: [2] },
      { pedidoPor: null, depoisDoId: 3, ids: [4, 5] },
    ]);
  });

  it('fila vazia ou fora do formato não quebra', () => {
    expect(planejarFila([], { porRodada: 5 })).toEqual({ atender: [], excesso: [] });
    expect(planejarFila(null as unknown as [], { porRodada: 5 })).toEqual({ atender: [], excesso: [] });
    expect(planejarFila([{ id: 'x' }, { id: '7', pedido_por: A }], { porRodada: 0 }).atender.map((x) => x.id)).toEqual(['7']);
  });
});

describe('toda leitura de pedidos pendentes tem ordem e limite', () => {
  it('chuva e boletins: os 200 mais antigos, com quem pediu', async () => {
    const s = servidoresFalsos({ mapas_chuva_pedidos: [], mec_pims_pedidos: [] });
    await pedidosChuvaPendentes(ctx(s.impl));
    await pedidosMecPendentes(ctx(s.impl));
    expect(s.chamadas.map((c) => c.url)).toEqual([
      `${URL_SB}/rest/v1/mapas_chuva_pedidos?select=id,pedido_por,fazenda,de,ate,de_hora,ate_hora&atendido_em=is.null&order=id.asc&limit=200`,
      `${URL_SB}/rest/v1/mec_pims_pedidos?select=id,pedido_por,unidade,de,ate&atendido_em=is.null&order=id.asc&limit=200`,
    ]);
  });

  it('chuva: num banco sem as colunas de hora, lê só as datas (com o mesmo limite)', async () => {
    const chamadas: string[] = [];
    const impl = async (url: string) => {
      chamadas.push(url);
      return url.includes('de_hora')
        ? new Response(JSON.stringify({ code: '42703', message: 'column mapas_chuva_pedidos.de_hora does not exist' }), { status: 400 })
        : new Response(JSON.stringify([{ id: 4, pedido_por: A, fazenda: 'Globo', de: '2026-10-05', ate: '2026-10-05' }]), { status: 200 });
    };
    expect(await pedidosChuvaPendentes(ctx(impl))).toEqual([{ id: 4, pedido_por: A, fazenda: 'Globo', de: '2026-10-05', ate: '2026-10-05' }]);
    expect(chamadas[1]).toBe(`${URL_SB}/rest/v1/mapas_chuva_pedidos?select=id,pedido_por,fazenda,de,ate&atendido_em=is.null&order=id.asc&limit=200`);
  });

  it('sem a tabela (script SQL não aplicado) não é erro: nada a atender', async () => {
    const s = servidoresFalsos({});
    expect(await pedidosChuvaPendentes(ctx(s.impl))).toEqual([]);
    expect(await pedidosMecPendentes(ctx(s.impl))).toEqual([]);
    expect(await atenderPedidosChuva(opcoes(s.impl))).toBe(0);
    expect(await atenderPedidosMec(opcoes(s.impl))).toBe(0);
  });

  it('plantio e validação: os 500 mais antigos', async () => {
    const s = servidoresFalsos({ mapas_plantio_pedidos: [], valid_pedidos: [] });
    expect(await atenderPedidos({ ...opcoes(s.impl), agrovex: { url: URL_AGROVEX, token: TOKEN, safras: ['SOJA 26/27'] } })).toBe(false);
    expect(await atenderPedidosValidacao(opcoes(s.impl))).toBe(false);
    expect(s.chamadas.map((c) => c.url)).toEqual([
      `${URL_SB}/rest/v1/mapas_plantio_pedidos?select=id&atendido_em=is.null&order=id.asc&limit=500`,
      `${URL_SB}/rest/v1/valid_pedidos?select=id&atendido_em=is.null&order=id.asc&limit=500`,
    ]);
  });
});

describe('chuva e boletins: um pedido por usuário por verificação, e o excesso sem consulta', () => {
  const COLUNAS_MEC = [
    'unidade', 'categoria', 'equipe', 'boletim', 'data', 'equipamento', 'modelo', 'implemento', 'implemento_de', 'funcionario', 'funcionario_de',
    'ano_agricola', 'periodo', 'periodo_de', 'ccusto', 'ccusto_de', 'operacao', 'operacao_de', 'ini', 'fim', 'total',
  ];
  const boletim = (unidade: string) => ({ columns: COLUNAS_MEC, rows: [[unidade, 'TRATOR', 'EQUIPE A', 100001, '2026-09-01', '30000011', 'MODELO A1', null, null, 1001, 'OPERADOR UM', '22627', 20001, 'SOJA 26/27', '1000001', 'SOJA', 19, 'DESLOCAMENTO', 10, 11, 1]] });
  const mec = (id: number, pedido_por: string, unidade: string) => ({ id, pedido_por, unidade, de: '2026-09-01', ate: '2026-09-01' });

  it('quem enfileira muitos pedidos: um é atendido, o excesso é respondido de uma vez e o outro usuário não espera', async () => {
    // A (unidade GLOBO) gravou 8 pedidos; C (T. FLECHAS) gravou 1, depois dos 6 primeiros de A
    const fila = [1, 2, 3, 4, 5, 6].map((id) => mec(id, A, 'GLOBO')).concat([mec(7, C, 'T. FLECHAS'), mec(8, A, 'GLOBO'), mec(9, A, 'GLOBO')]);
    const s = servidoresFalsos({ ...bancoDePermissoes(), mec_pims_pedidos: fila }, [boletim('GLOBO'), boletim('T. FLECHAS')]);
    expect(await atenderPedidosMec(opcoes(s.impl))).toBe(2);

    const respostas = s.respostas('mec_pims_pedidos');
    // 1º: o excesso de A, num pedido só ao Supabase — todos os pendentes dele depois do 5º, estejam ou não na leitura
    expect(respostas[0].url).toBe(`${URL_SB}/rest/v1/mec_pims_pedidos?atendido_em=is.null&pedido_por=eq.${A}&id=gt.5`);
    expect(respostas[0].corpo).toEqual({ atendido_em: AGORA.toISOString(), resultado: 'erro: Há muitos pedidos seus aguardando. Espere os anteriores terminarem e tente de novo.', dados: null });
    expect(RESULTADOS.muitosPedidos).toBe(respostas[0].corpo.resultado);
    // depois: o mais antigo de A e o de C, cada um com a sua unidade
    expect(respostas.slice(1).map((r) => [r.url.split('&id=')[1], r.corpo.resultado])).toEqual([['eq.1', 'ok'], ['eq.7', 'ok']]);
    // só duas consultas ao PIMS, por mais pedidos que A tenha gravado
    expect(s.consultasFeitas().map((c) => /DA_UNI_ADM = '([^']+)'/.exec(c.sql)?.[1])).toEqual(['GLOBO', 'T. FLECHAS']);
  });

  it('pedidos pendentes de um mesmo usuário (até 5) são atendidos um por verificação', async () => {
    const s = servidoresFalsos({ ...bancoDePermissoes(), mec_pims_pedidos: [mec(1, A, 'GLOBO'), mec(2, A, 'GLOBO'), mec(3, A, 'GLOBO')] }, [boletim('GLOBO')]);
    expect(await atenderPedidosMec(opcoes(s.impl))).toBe(1);
    expect(s.respostas('mec_pims_pedidos').map((r) => r.url.split('&id=')[1])).toEqual(['eq.1']);
    expect(s.consultasFeitas()).toHaveLength(1);
  });

  it('chuva: o mesmo freio, com o máximo de 5 pedidos (de usuários diferentes) por verificação', async () => {
    const cadastro = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['9101', 'PIC 1', 'Faz. Globo', '-20.1', '-45.6']] };
    const chuva = { columns: ['picid', 'mm', 'leituras', 'ultimo'], rows: [['9101', 2, 96, '2026-10-01']] };
    const ped = (id: number, pedido_por: string) => ({ id, pedido_por, fazenda: 'Globo', de: '2026-10-01', ate: '2026-10-01' });
    const fila = [1, 2, 3, 4, 5, 6, 7].map((id) => ped(id, A));
    const s = servidoresFalsos({ ...bancoDePermissoes(), mapas_chuva_pedidos: fila }, [cadastro, chuva]);
    expect(await atenderPedidosChuva(opcoes(s.impl))).toBe(1);
    const respostas = s.respostas('mapas_chuva_pedidos');
    expect(respostas[0].url).toBe(`${URL_SB}/rest/v1/mapas_chuva_pedidos?atendido_em=is.null&pedido_por=eq.${A}&id=gt.5`);
    expect(respostas[0].corpo.resultado).toBe(RESULTADOS.muitosPedidos);
    expect(respostas.slice(1).map((r) => [r.url.split('&id=')[1], r.corpo.resultado])).toEqual([['eq.1', 'ok']]);
    expect(s.consultasFeitas()).toHaveLength(2); // o cadastro dos PICs e a chuva, uma vez
  });

  it('falha ao responder o excesso não impede o atendimento do resto', async () => {
    const fila = [1, 2, 3, 4, 5, 6].map((id) => mec(id, A, 'GLOBO'));
    const s = servidoresFalsos({ ...bancoDePermissoes(), mec_pims_pedidos: fila }, [boletim('GLOBO')]);
    const impl = async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url.includes('id=gt.')) {
        s.chamadas.push({ url, init });
        return new Response(JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }), { status: 500 });
      }
      return s.impl(url, init);
    };
    expect(await atenderPedidosMec(opcoes(impl))).toBe(1);
    expect(s.respostas('mec_pims_pedidos').map((r) => r.corpo.resultado)).toEqual([RESULTADOS.muitosPedidos, 'ok']);
  });
});

describe('"Atualizar plantio": rodada recente responde com os dados já gravados', () => {
  const agrovex = { url: URL_AGROVEX, token: TOKEN, safras: ['SOJA 26/27'] };
  const rodar = (tabelas: Record<string, TabelaFalsa>, acompanhamento = true, agrovexStatus = 401) => {
    const s = servidoresFalsos({ mapas_plantio_pedidos: [{ id: 7 }, { id: 8 }], ...tabelas }, [], { agrovexStatus });
    const fim = atenderPedidos({ ...opcoes(s.impl), agrovex, acompanhamento }).then((r) => ({ r, erro: null as Error | null }), (erro: Error) => ({ r: null, erro }));
    return fim.then((f) => ({ ...f, s }));
  };

  it(`plantio e acompanhamento gravados há menos de ${RECENTE_MINUTOS} min: os pedidos ficam 'ok' sem nenhuma chamada ao Agrovex`, async () => {
    const { r, s } = await rodar({ mapas_plantio_pims: [{ gerado_em: haMinutos(2) }], acomp_pims: [{ gerado_em: haMinutos(2) }] });
    expect(r).toBe(true);
    expect(s.aoAgrovex()).toHaveLength(0);
    expect(s.leituras('mapas_plantio_pims')).toEqual([`${URL_SB}/rest/v1/mapas_plantio_pims?select=gerado_em&order=gerado_em.desc&limit=1`]);
    // a tela trata exatamente 'ok' como sucesso e relê o plantio gravado
    expect(s.respostas('mapas_plantio_pedidos')).toEqual([
      { url: `${URL_SB}/rest/v1/mapas_plantio_pedidos?atendido_em=is.null&id=lte.8`, corpo: { atendido_em: AGORA.toISOString(), resultado: 'ok' } },
    ]);
  });

  it('rodada antiga, tabela vazia, carimbo ilegível ou no futuro: roda a rotina do PIMS, como sempre', async () => {
    const casos: Record<string, TabelaFalsa>[] = [
      { mapas_plantio_pims: [{ gerado_em: haMinutos(RECENTE_MINUTOS) }], acomp_pims: [{ gerado_em: haMinutos(1) }] },
      { mapas_plantio_pims: [{ gerado_em: haMinutos(6) }], acomp_pims: [{ gerado_em: haMinutos(1) }] },
      { mapas_plantio_pims: [], acomp_pims: [{ gerado_em: haMinutos(1) }] },
      { mapas_plantio_pims: [{ gerado_em: 'ontem' }], acomp_pims: [{ gerado_em: haMinutos(1) }] },
      { mapas_plantio_pims: [{ gerado_em: haMinutos(-10) }], acomp_pims: [{ gerado_em: haMinutos(1) }] },
      { mapas_plantio_pims: { status: 500, corpo: { message: 'erro' } }, acomp_pims: [{ gerado_em: haMinutos(1) }] },
      { acomp_pims: [{ gerado_em: haMinutos(1) }] }, // sem a tabela do plantio
    ];
    for (const tabelas of casos) {
      const { erro, s } = await rodar(tabelas);
      expect(erro?.message, JSON.stringify(tabelas)).toMatch(/recusou o acesso \(HTTP 401\)/);
      expect(s.aoAgrovex().length, JSON.stringify(tabelas)).toBeGreaterThan(0);
      expect(s.respostas('mapas_plantio_pedidos').map((x) => x.corpo.resultado)).toEqual([`erro: ${MENSAGENS_DE_ERRO.fonte}`]);
    }
  });

  it('o mesmo botão atualiza o Acompanhamento: se ele está velho (ou não dá para saber), roda de novo', async () => {
    const plantio = { mapas_plantio_pims: [{ gerado_em: haMinutos(1) }] };
    for (const acomp of [{ acomp_pims: [{ gerado_em: haMinutos(30) }] }, { acomp_pims: [] }, { acomp_pims: { status: 500, corpo: {} } }] as Record<string, TabelaFalsa>[]) {
      const { erro, s } = await rodar({ ...plantio, ...acomp });
      expect(erro, JSON.stringify(acomp)).not.toBeNull();
      expect(s.aoAgrovex().length).toBeGreaterThan(0);
    }
    // sem a tabela do acompanhamento (script não aplicado), ou com o acompanhamento desligado, vale só o plantio
    const semTabela = await rodar(plantio);
    expect(semTabela.r).toBe(true);
    expect(semTabela.s.aoAgrovex()).toHaveLength(0);
    const desligado = await rodar({ ...plantio, acomp_pims: [{ gerado_em: haMinutos(30) }] }, false);
    expect(desligado.r).toBe(true);
    expect(desligado.s.leituras('acomp_pims')).toHaveLength(0);
  });

  it('muitos pedidos seguidos: no máximo uma rodada do PIMS a cada 5 minutos', async () => {
    // 1ª verificação: nada recente → roda (aqui o Agrovex recusa, e os pedidos levam o erro)
    const primeira = await rodar({ mapas_plantio_pims: [{ gerado_em: haMinutos(40) }] }, false);
    expect(primeira.s.aoAgrovex().length).toBeGreaterThan(0);
    // verificações seguintes, com a rodada já gravada: nenhuma chamada
    for (const minutos of [0.5, 1, 2, 4.9]) {
      const { r, s } = await rodar({ mapas_plantio_pims: [{ gerado_em: haMinutos(minutos) }] }, false);
      expect(r).toBe(true);
      expect(s.aoAgrovex()).toHaveLength(0);
    }
  });
});

describe('"Atualizar" da Validação: rodada recente responde com os dados já gravados', () => {
  const rodar = async (tabelas: Record<string, TabelaFalsa>) => {
    const s = servidoresFalsos({ valid_pedidos: [{ id: 3 }, { id: 4 }], ...tabelas }, [], { agrovexStatus: 403, agrovexCorpo: '{"error":"Forbidden"}' });
    return { r: await atenderPedidosValidacao(opcoes(s.impl)), s };
  };

  it(`valid_pims gravada há menos de ${RECENTE_MINUTOS} min e nenhum vínculo novo: 'ok' sem consultar o PIMS nem o SAP`, async () => {
    for (const vinculos of [{ valid_vinculos: [{ atualizado_em: haMinutos(60) }] }, { valid_vinculos: [] }, {}] as Record<string, TabelaFalsa>[]) {
      const { r, s } = await rodar({ valid_pims: [{ gerado_em: haMinutos(3) }], ...vinculos });
      expect(r).toBe(true);
      expect(s.aoAgrovex(), JSON.stringify(vinculos)).toHaveLength(0);
      expect(s.respostas('valid_pedidos')).toEqual([
        { url: `${URL_SB}/rest/v1/valid_pedidos?atendido_em=is.null&id=lte.4`, corpo: { atendido_em: AGORA.toISOString(), resultado: 'ok' } },
      ]);
    }
  });

  it('vínculo de depósito salvo depois da rodada ("O saldo entra na próxima atualização"): roda de novo', async () => {
    const { s } = await rodar({ valid_pims: [{ gerado_em: haMinutos(3) }], valid_vinculos: [{ atualizado_em: haMinutos(1), unidade: 'GLOBO', deposito: 'D01' }] });
    expect(s.leituras('valid_vinculos')[0]).toBe(`${URL_SB}/rest/v1/valid_vinculos?select=atualizado_em&order=atualizado_em.desc&limit=1`);
    expect(s.aoAgrovex().length).toBeGreaterThan(0);
  });

  it('rodada antiga, tabela vazia ou sem conseguir saber: roda, e o erro vira o texto do tipo da falha', async () => {
    const casos: Record<string, TabelaFalsa>[] = [
      { valid_pims: [{ gerado_em: haMinutos(8) }], valid_vinculos: [] },
      { valid_pims: [], valid_vinculos: [] },
      { valid_pims: { status: 500, corpo: {} }, valid_vinculos: [] },
    ];
    for (const tabelas of casos) {
      const { r, s } = await rodar(tabelas);
      expect(r).toBe(true);
      expect(s.aoAgrovex().length, JSON.stringify(tabelas)).toBeGreaterThan(0);
      // o Agrovex respondeu 403 {"error":"Forbidden"}: a tela recebe só o texto fixo
      expect(s.respostas('valid_pedidos').map((x) => x.corpo.resultado)).toEqual([`erro: ${MENSAGENS_DE_ERRO.fonte}`]);
    }
  });

  it('sem conseguir ler os vínculos, não trata como recente; a recusa do Supabase vira "erro interno", sem o texto dela', async () => {
    const recusa = { status: 500, corpo: { code: 'XX000', message: 'texto interno do banco que não vai para a tela' } };
    const { r, s } = await rodar({ valid_pims: [{ gerado_em: haMinutos(1) }], valid_vinculos: recusa });
    expect(r).toBe(true);
    expect(s.respostas('valid_pedidos').map((x) => x.corpo.resultado)).toEqual([`erro: ${MENSAGENS_DE_ERRO.interno}`]);
  });
});
