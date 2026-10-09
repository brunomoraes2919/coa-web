import { describe, expect, it } from 'vitest';
import { atenderPedidosChuva, pedidosChuvaPendentes, responderPedidoChuva } from '../scripts/atender-pedidos.mjs';
import { fazendasDaZeus, montarChuvaPics, montarSqlChuvaPics, picsDaFazendaZeus, SQL_PICS_ZEUS, validarPeriodoChuva } from '../scripts/sincronizar-plantio.mjs';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';

// Quem fez os pedidos destes testes: um ADMINISTRADOR+ inventado. Antes de consultar a fonte, o servidor lê
// do Supabase se quem pediu pode ver o que pediu (as regras têm teste próprio em permissao-pedidos.test.ts).
const QUEM = '99999999-9999-4999-8999-999999999999';
const PERMISSOES: Record<string, unknown[]> = {
  perfis: [{ id: QUEM, perfil: 'admin', super: true, todas_fazendas: true }],
  usuario_fazendas: [],
  usuario_categorias: [],
  mapas_fazendas: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', nome: 'SM3', coa_fazenda_id: 1 }, { id: 'aaaaaaaa-0000-4000-8000-000000000002', nome: 'Fazenda Nova', coa_fazenda_id: null }],
};
/** tabela do Supabase que a chamada lê */
const tabelaDe = (url: string) => /\/rest\/v1\/([a-z_]+)/.exec(url)?.[1] ?? '';

const CADASTRO = {
  columns: ['picid', 'picname', 'farm', 'lat', 'lon'],
  rows: [
    ['9101', 'PIC 27 SM3', 'Faz_SM3', '-20.123456', '-45.654321'],
    ['9102', 'PIC 37 SM3 ', 'Faz_SM3', '-20.11111111111', '-45.22222222222'],
    ['9103', 'PIC_77-GLOBO_PV5', 'Faz. Globo', '-21.54321', '-46.123456'],
    ['9001', 'PIC sem coordenada', 'Faz_SM3', '', ''],
    ["1'; drop", 'PIC id estranho', 'Faz_SM3', '-20.1', '-45.6'],
    ['9104', 'PIC_19_TRES_FLECHAS', 'Faz. Três Flechas', '-22.345678', '-47.876543'],
  ],
};

describe('chuva por PIC na ZEUS (servidor)', () => {
  it('valida o período do pedido', () => {
    expect(validarPeriodoChuva('2026-10-01', '2026-10-01')).toEqual({ de: '2026-10-01', ate: '2026-10-01', dias: 1 });
    expect(() => validarPeriodoChuva('2026-10-02', '2026-10-01')).toThrow('Período inválido: a data inicial é depois da final.');
    expect(() => validarPeriodoChuva("2026-10-01'; drop table x; --", '2026-10-01')).toThrow('Período inválido: informe as duas datas.');
    expect(() => validarPeriodoChuva('2024-01-01', '2026-10-01')).toThrow(/Período muito longo/);
  });

  it('acha os PICs da fazenda pelo nome, sem prefixo, acento nem caixa', () => {
    expect(picsDaFazendaZeus(CADASTRO, 'SM3').map((p) => p.id)).toEqual(['9101', '9102']);
    expect(picsDaFazendaZeus(CADASTRO, 'Fazenda sm3')).toHaveLength(2);
    expect(picsDaFazendaZeus(CADASTRO, 'Três Flechas')).toEqual([{ id: '9104', nome: 'PIC_19_TRES_FLECHAS', lat: -22.345678, lon: -47.876543 }]);
    expect(picsDaFazendaZeus(CADASTRO, 'Nebraska')).toEqual([]);
    expect(picsDaFazendaZeus(CADASTRO, '')).toEqual([]);
    expect(fazendasDaZeus(CADASTRO)).toEqual(['GLOBO', 'SM3', 'TRES FLECHAS']);
  });

  it('a consulta soma só os PICs pedidos, com as duas datas inclusive', () => {
    const sql = montarSqlChuvaPics(['9101', '9102', "x' or 1=1"], '2026-10-01', '2026-10-03');
    expect(sql).toContain("c.picid IN ('9101', '9102')");
    expect(sql).toContain("c.data >= DATE '2026-10-01' AND c.data < DATE '2026-10-03' + INTERVAL '1 day'");
    expect(sql).toContain('"DATABASE".stg_climatemonitoring2');
    expect(SQL_PICS_ZEUS).toContain('"DATABASE".stg_zeus_picarea');
  });

  it('junta cadastro e chuva: sem leitura no período → chuva null', () => {
    const pics = picsDaFazendaZeus(CADASTRO, 'SM3');
    const r = montarChuvaPics(pics, { columns: ['picid', 'mm', 'leituras', 'ultimo'], rows: [['9101', 1.04, 96, '2026-10-01']] });
    expect(r.ultimoDia).toBe('2026-10-01');
    expect(r.pics).toEqual([
      { id: '9101', nome: 'PIC 27 SM3', lat: -20.123456, lon: -45.654321, chuva: 1, leituras: 96 },
      { id: '9102', nome: 'PIC 37 SM3', lat: -20.11111111111, lon: -45.22222222222, chuva: null, leituras: 0 },
    ]);
  });
});

interface Chamada { url: string; init?: RequestInit }

/** Agrovex falso (MCP): responde initialize, a notificação e cada execute_query com o resultado da vez. */
function servidores(pedidos: unknown[], consultas: unknown[], statusPedidos = 200) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      // as leituras de permissão não são o pedido: respondem com o cadastro de quem pediu
      if ((!init?.method || init.method === 'GET') && tabelaDe(url) in PERMISSOES) return new Response(JSON.stringify(PERMISSOES[tabelaDe(url)]), { status: 200 });
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

describe('pedidos de chuva (mapas_chuva_pedidos)', () => {
  const ctx = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ url: URL_SB, chave: CHAVE, fetch: impl });

  it('lê os pendentes; sem a tabela (0003 não aplicado) não é erro', async () => {
    const a = servidores([{ id: 3, fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-01' }], []);
    expect(await pedidosChuvaPendentes(ctx(a.impl))).toEqual([{ id: 3, fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-01' }]);
    expect(a.chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_chuva_pedidos?select=id,pedido_por,fazenda,de,ate,de_hora,ate_hora&atendido_em=is.null&order=id.asc&limit=200`);
    const b = servidores([], [], 404);
    expect(await pedidosChuvaPendentes(ctx(b.impl))).toEqual([]);
  });

  it('responde só o pedido indicado, enquanto pendente', async () => {
    const { impl, chamadas } = servidores([], []);
    await responderPedidoChuva(ctx(impl), 7, 'ok', { pics: [] }, new Date('2026-10-05T10:00:00Z'));
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_chuva_pedidos?atendido_em=is.null&id=eq.7`);
    expect(JSON.parse(String(chamadas[0].init?.body))).toEqual({ atendido_em: '2026-10-05T10:00:00.000Z', resultado: 'ok', dados: { pics: [] } });
  });

  it('sem pedido pendente não chama o Agrovex', async () => {
    const { impl, chamadas } = servidores([], []);
    expect(await atenderPedidosChuva({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN }, fetch: impl })).toBe(0);
    expect(chamadas).toHaveLength(1);
  });

  it('atende o pedido: consulta a ZEUS e grava os PICs no próprio pedido', async () => {
    const { impl, chamadas } = servidores(
      [{ id: 9, pedido_por: QUEM, fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-01' }],
      [CADASTRO, { columns: ['picid', 'mm', 'leituras', 'ultimo'], rows: [['9101', 1, 96, '2026-10-01'], ['9102', 1.4, 96, '2026-10-01']] }],
    );
    const n = await atenderPedidosChuva({
      supabase: { url: URL_SB, chave: CHAVE },
      agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN },
      fetch: impl,
      agora: () => new Date('2026-10-05T10:00:00Z'),
    });
    expect(n).toBe(1);
    const consultas = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments);
    expect(consultas.map((a) => a.source)).toEqual(['zeus', 'zeus']);
    expect(consultas[1].sql).toContain("c.picid IN ('9101', '9102')");
    const patch = chamadas.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toContain('id=eq.9');
    const corpo = JSON.parse(String(patch?.init?.body));
    expect(corpo.resultado).toBe('ok');
    expect(corpo.dados).toMatchObject({ fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-01', ultimoDia: '2026-10-01' });
    expect(corpo.dados.pics.map((p: { chuva: number }) => p.chuva)).toEqual([1, 1.4]);
  });

  it('fazenda que a ZEUS não conhece vira o resultado do pedido (sem token nem chave)', async () => {
    const { impl, chamadas } = servidores([{ id: 4, pedido_por: QUEM, fazenda: 'Fazenda Nova', de: '2026-10-01', ate: '2026-10-01' }], [CADASTRO]);
    await atenderPedidosChuva({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN }, fetch: impl });
    const corpo = JSON.parse(String(chamadas.find((c) => c.init?.method === 'PATCH')?.init?.body));
    // a lista das fazendas da ZEUS não vai mais para quem pediu (fica no log do servidor)
    expect(corpo.resultado).toBe('erro: A ZEUS não tem PICs para a fazenda "Fazenda Nova". Confira se o nome da fazenda no cadastro do mapa é o mesmo usado na ZEUS.');
    expect(corpo.dados).toBeNull();
    expect(JSON.stringify(corpo)).not.toContain(TOKEN);
    expect(JSON.stringify(corpo)).not.toContain(CHAVE);
  });
});
