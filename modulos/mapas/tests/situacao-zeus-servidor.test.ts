import { describe, expect, it } from 'vitest';
import { atualizarSituacaoZeus } from '../scripts/atender-pedidos.mjs';
import { linhasSituacaoZeus, SQL_ULTIMO_DIA_ZEUS } from '../scripts/sincronizar-plantio.mjs';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';
const AGORA = new Date('2026-10-06T11:20:00Z');

// leitura = os 14 últimos dígitos do idprecipitation (picid + aaaammddhhmmss): a hora da última leitura
const ULTIMOS = {
  columns: ['fazenda', 'ultimo', 'leitura'],
  rows: [
    ['Faz_SM3', '2026-10-05', '20261005234500'],
    // identificador fora do padrão: fica o dia, sem a hora
    ['Faz. Três Flechas', '2026-10-05', null],
    ['Faz. Globo', '2026-10-03', '20261003230000'],
    // a mesma fazenda escrita de dois jeitos na ZEUS: vale a leitura mais recente
    ['Fazenda Globo', '2026-10-04', '20261004070000'],
    ['Faz. Sem Data', null, null],
    ['', '2026-10-05', '20261005230000'],
  ],
};

describe('último dia da ZEUS no banco (servidor)', () => {
  it('a consulta olha as leituras de chuva por fazenda, só nas últimas semanas', () => {
    expect(SQL_ULTIMO_DIA_ZEUS).toContain('"DATABASE".stg_climatemonitoring2');
    expect(SQL_ULTIMO_DIA_ZEUS).toContain('"DATABASE".stg_zeus_picarea');
    expect(SQL_ULTIMO_DIA_ZEUS).toContain('c.pluviometria IS NOT NULL');
    expect(SQL_ULTIMO_DIA_ZEUS).toMatch(/c\.data >= CURRENT_DATE - \d+/);
    expect(SQL_ULTIMO_DIA_ZEUS).toContain('max(c.data)');
    // a coluna data vem truncada no dia: a hora da leitura está no fim do identificador
    expect(SQL_ULTIMO_DIA_ZEUS).toContain('right(c.idprecipitation, 14)');
  });

  it('hora da leitura que não é do último dia (ou não é uma data) é descartada: fica só o dia', () => {
    const res = { columns: ['fazenda', 'ultimo', 'leitura'], rows: [['Faz_SM3', '2026-10-05', '20261004230000'], ['Faz. Globo', '2026-10-05', '20261005990000']] };
    expect(linhasSituacaoZeus(res, AGORA).map((l) => l.ultima_leitura)).toEqual([null, null]);
  });

  it('uma linha por fazenda, com o nome do jeito que o pedido de chuva casa as fazendas', () => {
    expect(linhasSituacaoZeus(ULTIMOS, AGORA)).toEqual([
      { fazenda: 'GLOBO', ultimo_dia: '2026-10-04', ultima_leitura: '2026-10-04T07:00:00', conferido_em: '2026-10-06T11:20:00.000Z' },
      { fazenda: 'SM3', ultimo_dia: '2026-10-05', ultima_leitura: '2026-10-05T23:45:00', conferido_em: '2026-10-06T11:20:00.000Z' },
      { fazenda: 'TRES FLECHAS', ultimo_dia: '2026-10-05', ultima_leitura: null, conferido_em: '2026-10-06T11:20:00.000Z' },
    ]);
  });
});

interface Chamada { url: string; init?: RequestInit }

/** Supabase e Agrovex falsos: o GET devolve `situacao`; cada execute_query, o resultado da vez. */
function servidores(situacao: unknown[], consultas: unknown[], statusGet = 200) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      if (!init?.method || init.method === 'GET') {
        return statusGet === 200
          ? new Response(JSON.stringify(situacao), { status: 200 })
          : new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: statusGet });
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

const opcoes = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({
  supabase: { url: URL_SB, chave: CHAVE },
  agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN },
  fetch: impl,
  agora: () => AGORA,
});
const foiAoAgrovex = (chamadas: Chamada[]) => chamadas.some((c) => c.url.includes('agrovex'));

describe('atualizarSituacaoZeus (tabela mapas_zeus_situacao)', () => {
  it('conferido há pouco: não consulta a ZEUS de novo', async () => {
    const { impl, chamadas } = servidores([{ conferido_em: '2026-10-06T11:12:00.000Z' }], []);
    expect(await atualizarSituacaoZeus(opcoes(impl))).toBe('recente');
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_zeus_situacao?select=conferido_em&order=conferido_em.desc&limit=1`);
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('sem a tabela (script 0004 não aplicado): não é erro e não consulta a ZEUS', async () => {
    const { impl, chamadas } = servidores([], [], 404);
    expect(await atualizarSituacaoZeus(opcoes(impl))).toBe('sem-tabela');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('conferência antiga: consulta a ZEUS e grava uma linha por fazenda', async () => {
    const { impl, chamadas } = servidores([{ conferido_em: '2026-10-06T10:50:00.000Z' }], [ULTIMOS]);
    expect(await atualizarSituacaoZeus(opcoes(impl))).toBe('ok');
    const consulta = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments);
    expect(consulta).toHaveLength(1);
    expect(consulta[0].source).toBe('zeus');
    const post = chamadas.find((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB));
    expect(post?.url).toBe(`${URL_SB}/rest/v1/mapas_zeus_situacao?on_conflict=fazenda`);
    expect((post?.init?.headers as Record<string, string>).Prefer).toContain('resolution=merge-duplicates');
    expect(JSON.parse(String(post?.init?.body))).toEqual([
      { fazenda: 'GLOBO', ultimo_dia: '2026-10-04', ultima_leitura: '2026-10-04T07:00:00', conferido_em: '2026-10-06T11:20:00.000Z' },
      { fazenda: 'SM3', ultimo_dia: '2026-10-05', ultima_leitura: '2026-10-05T23:45:00', conferido_em: '2026-10-06T11:20:00.000Z' },
      { fazenda: 'TRES FLECHAS', ultimo_dia: '2026-10-05', ultima_leitura: null, conferido_em: '2026-10-06T11:20:00.000Z' },
    ]);
  });

  it('conferência antiga fora do minuto de tentativa: espera o próximo (Agrovex fora do ar não vira uma consulta a cada 30 s)', async () => {
    const { impl, chamadas } = servidores([{ conferido_em: '2026-10-06T10:50:00.000Z' }], [ULTIMOS]);
    expect(await atualizarSituacaoZeus({ ...opcoes(impl), agora: () => new Date('2026-10-06T11:22:30Z') })).toBe('fora-do-passo');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('tabela vazia (primeira vez): consulta e grava', async () => {
    const { impl, chamadas } = servidores([], [ULTIMOS]);
    expect(await atualizarSituacaoZeus(opcoes(impl))).toBe('ok');
    expect(chamadas.some((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB))).toBe(true);
  });

  it('a ZEUS não devolveu nenhuma fazenda: não grava nada', async () => {
    const { impl, chamadas } = servidores([], [{ columns: ['fazenda', 'ultimo', 'leitura'], rows: [] }]);
    expect(await atualizarSituacaoZeus(opcoes(impl))).toBe('vazio');
    expect(chamadas.some((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB))).toBe(false);
  });
});
