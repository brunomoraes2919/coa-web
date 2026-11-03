// Mapa de dias sem chuva: o pedido (mapas_chuva_pedidos com tipo 'talhoes') traz a chuva diária de cada talhão
// da unidade da fazenda de mapa, só no período pedido (stg_field_data da ZEUS).
import { describe, expect, it } from 'vitest';
import { atenderPedidosChuva, unidadeDaFazendaDeMapa } from '../scripts/atender-pedidos.mjs';
import { montarSecaTalhoes, montarSqlDiasSecaTalhoes, montarSqlSecaTalhoes, unidadeChuvaTalhao } from '../scripts/sincronizar-plantio.mjs';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';
const QUEM = '99999999-9999-4999-8999-999999999999';
const TABELAS: Record<string, unknown[]> = {
  perfis: [{ id: QUEM, perfil: 'admin', super: true, todas_fazendas: true }],
  usuario_fazendas: [],
  usuario_categorias: [],
  mapas_fazendas: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', nome: 'Três Flechas', coa_fazenda_id: 1, unidade_pims: 'TRES FLECHAS' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', nome: 'Sem Unidade', coa_fazenda_id: 2, unidade_pims: null },
  ],
};
const tabelaDe = (url: string) => /\/rest\/v1\/([a-z_]+)/.exec(url)?.[1] ?? '';

interface Chamada { url: string; init?: RequestInit }
function servidores(pedidos: unknown[], consultas: unknown[]) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      const get = !init?.method || init.method === 'GET';
      if (get && tabelaDe(url) in TABELAS) return new Response(JSON.stringify(TABELAS[tabelaDe(url)]), { status: 200 });
      if (get) return new Response(JSON.stringify(pedidos), { status: 200 });
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
const respostas = (c: Chamada[]) => c.filter((x) => x.init?.method === 'PATCH').map((x) => JSON.parse(String(x.init?.body)));
const sqls = (c: Chamada[]) =>
  c
    .filter((x) => !x.url.startsWith(URL_SB))
    .map((x) => (x.init?.body ? JSON.parse(String(x.init.body)) : null))
    .filter((b) => b?.method === 'tools/call')
    .map((b) => String(b.params.arguments.sql));
const opcoes = (impl: unknown) => ({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://mcp.agrovex.com.br/mcp', token: TOKEN }, fetch: impl as typeof fetch });

describe('servidor: chuva por talhão do período (mapa de dias sem chuva)', () => {
  it('a unidade sai como na stg_field_data, sem acento e sem nada que quebre a consulta', () => {
    expect(unidadeChuvaTalhao('Três Flechas')).toBe('TRES FLECHAS');
    expect(unidadeChuvaTalhao("SM3'; drop table x; --")).toBe('SM3 DROP TABLE X');
    expect(unidadeChuvaTalhao(null)).toBe('');
  });

  it('as consultas pegam só a unidade e o período pedidos', () => {
    const sql = montarSqlSecaTalhoes('Três Flechas', '2026-09-01', '2026-09-30');
    expect(sql).toContain("WHERE unidade = 'TRES FLECHAS' AND data BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'");
    expect(sql).toContain("(data::date - DATE '2026-09-01')");
    expect(montarSqlSecaTalhoes('SM3', '2026-09-01', '2026-09-30', 0, 100)).toMatch(/ORDER BY fieldname\nOFFSET 0 LIMIT 100$/);
    const dias = montarSqlDiasSecaTalhoes('SM3', '2026-09-01', '2026-09-30');
    expect(dias).toContain("WHERE unidade = 'SM3' AND data BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'");
    expect(dias).toContain("to_char(max(data), 'YYYY-MM-DD')");
  });

  it('monta a resposta: código normalizado, dias com dado em faixas e o último dia da tabela', () => {
    const r = montarSecaTalhoes(
      {
        linhas: { columns: ['fieldname', 'dias'], rows: [['TH 19A', '2:0.74,4:17.68'], ['1', null], ['019A', null], ['X', "1:2'; drop"]] },
        dias: { columns: ['dias', 'ultimo'], rows: [['0,1,2,3,4,7', '2026-10-07']] },
      },
      { fazenda: 'Três Flechas', unidade: 'Três Flechas', de: '2026-09-01', ate: '2026-09-30' },
    );
    expect(r).toEqual({
      tipo: 'talhoes', fazenda: 'Três Flechas', unidade: 'TRES FLECHAS', de: '2026-09-01', ate: '2026-09-30',
      lidos: '0-4,7', ultimoDia: '2026-10-07', talhoes: { '019A': '2:0.74,4:17.68', '001': '', X: '' },
    });
    const vazio = montarSecaTalhoes(
      { linhas: { columns: ['fieldname', 'dias'], rows: [] }, dias: { columns: ['dias', 'ultimo'], rows: [[null, null]] } },
      { fazenda: 'F', unidade: 'SM3', de: '2026-09-01', ate: '2026-09-02' },
    );
    expect(vazio).toMatchObject({ lidos: '', ultimoDia: null, talhoes: {} });
  });

  it('acha a unidade da fazenda de mapa pelo nome do pedido (a lista é lida uma vez por verificação)', async () => {
    const s = servidores([], []);
    const ctx = { url: URL_SB, chave: CHAVE, fetch: s.impl as typeof fetch };
    const memo = new Map();
    expect(await unidadeDaFazendaDeMapa(ctx, 'Três Flechas', memo)).toBe('TRES FLECHAS');
    expect(await unidadeDaFazendaDeMapa(ctx, 'Sem Unidade', memo)).toBeNull();
    expect(await unidadeDaFazendaDeMapa(ctx, 'Outra', memo)).toBeNull();
    expect(s.chamadas).toHaveLength(1);
  });

  it('atende o pedido de tipo talhoes com a chuva por talhão (e não com os PICs)', async () => {
    const pedido = { id: 7, pedido_por: QUEM, fazenda: 'Três Flechas', de: '2026-09-01', ate: '2026-09-30', tipo: 'talhoes' };
    const s = servidores([pedido], [
      { columns: ['fieldname', 'dias'], rows: [['001', '3:12.5'], ['002', null]] },
      { columns: ['dias', 'ultimo'], rows: [['0,1,2,3', '2026-10-07']] },
    ]);
    expect(await atenderPedidosChuva(opcoes(s.impl))).toBe(1);
    const consultas = sqls(s.chamadas);
    expect(consultas).toHaveLength(2);
    expect(consultas.every((q) => q.includes('stg_field_data'))).toBe(true);
    const [r] = respostas(s.chamadas);
    expect(r.resultado).toBe('ok');
    expect(r.dados).toMatchObject({ tipo: 'talhoes', unidade: 'TRES FLECHAS', lidos: '0-3', talhoes: { '001': '3:12.5', '002': '' } });
  });

  it('fazenda sem a unidade do PIMS: responde com o que fazer, sem consultar a ZEUS', async () => {
    const s = servidores([{ id: 8, pedido_por: QUEM, fazenda: 'Sem Unidade', de: '2026-09-01', ate: '2026-09-30', tipo: 'talhoes' }], []);
    await atenderPedidosChuva(opcoes(s.impl));
    expect(sqls(s.chamadas)).toEqual([]);
    expect(respostas(s.chamadas)[0].resultado).toMatch(/^erro: A fazenda deste mapa não tem a unidade do PIMS/);
  });
});
