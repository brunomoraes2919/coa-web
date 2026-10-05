import { describe, expect, it } from 'vitest';
import { atenderPedidosMec, pedidosMecPendentes, responderPedidoMec } from '../scripts/atender-pedidos.mjs';
import { fmtHrKm, linhasMecanizadas, MEC_CABECALHO, montarSqlMecanizadas, validarPedidoMec } from '../scripts/sincronizar-plantio.mjs';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';

const COLUNAS = [
  'unidade', 'categoria', 'equipe', 'boletim', 'data', 'equipamento', 'modelo', 'implemento', 'implemento_de', 'funcionario', 'funcionario_de',
  'ano_agricola', 'periodo', 'periodo_de', 'ccusto', 'ccusto_de', 'operacao', 'operacao_de', 'ini', 'fim', 'total',
];
const linha = (o: Record<string, unknown>) => ({
  unidade: 'T. FLECHAS', categoria: 'PULVERIZADOR-H', equipe: 'EQUIPE A', boletim: 516261, data: '2026-09-01', equipamento: '31005011', modelo: 'DN M4040',
  implemento: null, implemento_de: null, funcionario: 5432, funcionario_de: 'MARCOS', ano_agricola: '22627', periodo: 27052, periodo_de: 'SOJA 26/27',
  ccusto: '1005052', ccusto_de: 'SOJA', operacao: 19, operacao_de: 'DESLOCAMENTO', ini: 3491.9, fim: 3492.4, total: 0.5, ...o,
});

describe('boletins de atividades mecanizadas do PIMS (servidor)', () => {
  it('valida a unidade e o período do pedido', () => {
    expect(validarPedidoMec(' t. flechas ', '2026-09-01', '2026-09-30')).toEqual({ unidade: 'T. FLECHAS', de: '2026-09-01', ate: '2026-09-30', dias: 30 });
    expect(() => validarPedidoMec("GLOBO' OR 1=1 --", '2026-09-01', '2026-09-30')).toThrow('Unidade inválida.');
    expect(() => validarPedidoMec('GLOBO', '2026-09-02', '2026-09-01')).toThrow('Período inválido: a data inicial é depois da final.');
    expect(() => validarPedidoMec('GLOBO', '2026-01-01', '2026-09-01')).toThrow(/Período muito longo \(244 dias\): o máximo é 62 dias\./);
  });

  it('a consulta filtra a unidade, o período inclusive e só horímetro/km, com paginação', () => {
    const sql = montarSqlMecanizadas('T. FLECHAS', '2026-09-01', '2026-09-30', 4000, 4000);
    expect(sql).toContain("u.DA_UNI_ADM = 'T. FLECHAS' AND o.FG_TP_HR = '1'");
    expect(sql).toContain("a.DT_OPERACAO >= '2026-09-01' AND a.DT_OPERACAO < DATEADD(day, 1, '2026-09-30')");
    expect(sql).toContain('COALESCE(lc.ID_PERIODOSAFRA, up.ID_PERIODOSAFRA)');
    expect(sql).toMatch(/OFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY$/);
  });

  it('escreve Hr/Km como o PIMS', () => {
    expect(fmtHrKm(3491.9)).toBe('3.491,90');
    expect(fmtHrKm(332014)).toBe('332.014,00');
    expect(fmtHrKm(0.5)).toBe('0,50');
    expect(fmtHrKm(1234567.891)).toBe('1.234.567,89');
    expect(fmtHrKm(null)).toBe('');
  });

  it('monta as 22 colunas na ordem do relatório, com a Situação por equipamento', () => {
    expect(MEC_CABECALHO).toHaveLength(22);
    const l = linhasMecanizadas([
      linha({ operacao: 100, operacao_de: 'APLIC ADUBO', ini: 3493.5, fim: 3494.3, total: 0.8 }),
      linha({}),
      linha({ operacao: 184, operacao_de: 'REGULAGEM', ini: 3492.4, fim: 3493.5, total: 1.1 }),
      linha({ data: '2026-09-02', boletim: 516262, ini: 3500, fim: 3501, total: 1 }),
      linha({ categoria: 'CAMINHOES', equipamento: '41005008', implemento: '81005057', implemento_de: 'S-REBOQUE', periodo: null, periodo_de: null, ano_agricola: null, ini: 332014, fim: 332828, total: 814 }),
    ]);
    expect(l.map((r) => [r[1], r[5], r[4], r[18], r[21]])).toEqual([
      ['CAMINHOES', '41005008', '01/09/2026', '332.014,00', 'Início'],
      ['PULVERIZADOR-H', '31005011', '01/09/2026', '3.491,90', 'Início'],
      ['PULVERIZADOR-H', '31005011', '01/09/2026', '3.492,40', 'Correto'],
      ['PULVERIZADOR-H', '31005011', '01/09/2026', '3.493,50', 'Correto'],
      ['PULVERIZADOR-H', '31005011', '02/09/2026', '3.500,00', 'Incorreto'],
    ]);
    expect(l[1]).toEqual([
      'T. FLECHAS', 'PULVERIZADOR-H', 'EQUIPE A', '516261', '01/09/2026', '31005011', 'DN M4040', '', '', '5432', 'MARCOS', '22627', '27052', 'SOJA 26/27',
      '1005052', 'SOJA', '19', 'DESLOCAMENTO', '3.491,90', '3.492,40', '0,50', 'Início',
    ]);
    expect(l[0].slice(7, 9)).toEqual(['81005057', 'S-REBOQUE']);
    expect(l[0].slice(11, 14)).toEqual(['', '', '']);
  });
});

interface Chamada { url: string; init?: RequestInit }

function servidores(pedidos: unknown[], consultas: unknown[], statusPedidos = 200) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      if (!init?.method || init.method === 'GET') {
        return statusPedidos === 200
          ? new Response(JSON.stringify(pedidos), { status: 200 })
          : new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: statusPedidos });
      }
      return new Response(null, { status: 204 });
    }
    const corpo = init?.body ? JSON.parse(String(init.body)) : null;
    if (init?.method === 'DELETE' || !corpo?.id) return new Response('', { status: 202 });
    if (corpo.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
    }
    const dados = consultas[n++];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...(dados as object) }) }] } }), { status: 200 });
  };
  return { impl, chamadas };
}

describe('pedidos de boletins (mec_pims_pedidos)', () => {
  const ctx = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ url: URL_SB, chave: CHAVE, fetch: impl });

  it('lê os pendentes; sem a tabela não é erro', async () => {
    const a = servidores([{ id: 3, unidade: 'GLOBO', de: '2026-10-01', ate: '2026-10-05' }], []);
    expect(await pedidosMecPendentes(ctx(a.impl))).toEqual([{ id: 3, unidade: 'GLOBO', de: '2026-10-01', ate: '2026-10-05' }]);
    expect(a.chamadas[0].url).toBe(`${URL_SB}/rest/v1/mec_pims_pedidos?select=id,unidade,de,ate&atendido_em=is.null&order=id.asc&limit=2`);
    expect(await pedidosMecPendentes(ctx(servidores([], [], 404).impl))).toEqual([]);
  });

  it('responde só o pedido indicado, enquanto pendente', async () => {
    const { impl, chamadas } = servidores([], []);
    await responderPedidoMec(ctx(impl), 7, 'ok', { linhas: [] }, new Date('2026-10-05T10:00:00Z'));
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mec_pims_pedidos?atendido_em=is.null&id=eq.7`);
    expect(JSON.parse(String(chamadas[0].init?.body))).toEqual({ atendido_em: '2026-10-05T10:00:00.000Z', resultado: 'ok', dados: { linhas: [] } });
  });

  it('atende o pedido: consulta o PIMS e grava o relatório no próprio pedido', async () => {
    const l = linha({});
    const { impl, chamadas } = servidores(
      [{ id: 9, unidade: 'T. FLECHAS', de: '2026-09-01', ate: '2026-09-01' }],
      [{ columns: COLUNAS, rows: [COLUNAS.map((c) => (l as Record<string, unknown>)[c])] }],
    );
    const n = await atenderPedidosMec({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN }, fetch: impl });
    expect(n).toBe(1);
    const consulta = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments);
    expect(consulta).toHaveLength(1);
    expect(consulta[0].source).toBe('sqlserver');
    expect(consulta[0].sql).toContain("u.DA_UNI_ADM = 'T. FLECHAS'");
    const corpo = JSON.parse(String(chamadas.find((c) => c.init?.method === 'PATCH')?.init?.body));
    expect(corpo.resultado).toBe('ok');
    expect(corpo.dados.cabecalho).toEqual(MEC_CABECALHO);
    expect(corpo.dados.linhas).toHaveLength(1);
    expect(corpo.dados.linhas[0][18]).toBe('3.491,90');
  });

  it('pedido inválido vira o resultado do pedido, sem consultar o PIMS', async () => {
    const { impl, chamadas } = servidores([{ id: 4, unidade: "X'; drop table y; --", de: '2026-09-01', ate: '2026-09-01' }], []);
    await atenderPedidosMec({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN }, fetch: impl });
    expect(chamadas.some((c) => c.url.includes('agrovex'))).toBe(false);
    const corpo = JSON.parse(String(chamadas.find((c) => c.init?.method === 'PATCH')?.init?.body));
    expect(corpo).toMatchObject({ resultado: 'erro: Unidade inválida.', dados: null });
  });
});
