import { describe, expect, it } from 'vitest';
import { atualizarChuvaTalhao } from '../scripts/atender-pedidos.mjs';
import { CHUVA_TALHAO_DIAS, inicioChuvaTalhao, linhasChuvaTalhao, montarSqlChuvaDiariaPics, SQL_VINCULOS_ZEUS } from '../scripts/sincronizar-plantio.mjs';

// Todos os dados daqui são FICTÍCIOS.
const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';
const AGORA = new Date('2026-10-08T12:20:00Z');
const GERADO = AGORA.toISOString();

const VINCULOS = {
  columns: ['farm', 'talhao', 'picid', 'picname', 'lat', 'lon'],
  rows: [
    ['Faz. Teste', 'TH01', '900', 'PIC_900-TESTE_A', '-13,10', '-55.20'],
    ['Faz. Teste', 'TH19 (0)', '900', 'PIC_900-TESTE_A', '-13,10', '-55.20'],
    ['Faz. Teste', 'PIVO 03', '901', 'PIC_901-TESTE_B', '-13.20', '-55.30'],
    // o mesmo talhão escrito de dois jeitos, em dois pluviômetros: fica com os dois
    ['Faz. Teste', '2 (1)', '900', 'PIC_900-TESTE_A', '-13,10', '-55.20'],
    ['Faz. Teste', 'TH02', '901', 'PIC_901-TESTE_B', '-13.20', '-55.30'],
    // a mesma fazenda escrita de outro jeito na ZEUS
    ['Fazenda Teste', '005', '902', 'PIC_902-TESTE_C', '0', '0'],
    ['Faz_Outra', '001', '950', 'PIC_950-OUTRA', '-14.0', '-56.0'],
    ['Faz_Outra', '', '950', 'PIC_950-OUTRA', '-14.0', '-56.0'],
    [null, '001', '999', 'PIC_SEM_FAZENDA', '-14.0', '-56.0'],
  ],
};
const CHUVA = {
  columns: ['picid', 'leitura', 'leituras', 'dias'],
  rows: [
    ['900', '20261008110000', 24, '0,1:2.4,399:10.0x11'],
    ['901', '2026100799', 96, '398:0.6'],
    ['950', '20261007230000', 24, '397,398:12.2'],
    // pluviômetro com leitura mas sem cadastro: não tem fazenda, fica de fora
    ['777', '20261007230000', 24, '398:5.0'],
  ],
};

describe('chuva por talhão (servidor)', () => {
  it('a janela são os últimos 400 dias, pela data da fazenda (UTC-4)', () => {
    expect(CHUVA_TALHAO_DIAS).toBe(400);
    expect(inicioChuvaTalhao(AGORA)).toBe('2025-09-04');
    // 02:00 UTC ainda é a noite do dia anterior na fazenda
    expect(inicioChuvaTalhao(new Date('2026-10-08T02:00:00Z'))).toBe('2025-09-03');
  });

  it('o vínculo vem do cadastro da ZEUS (a mesma base da visão vw_precipitacao_talhao)', () => {
    expect(SQL_VINCULOS_ZEUS).toContain('"DATABASE".stg_zeus_picarea');
    expect(SQL_VINCULOS_ZEUS).toMatch(/SELECT DISTINCT farm, talhao, picid/);
  });

  it('a chuva é a soma do dia de cada pluviômetro, compactada em uma linha por pluviômetro', () => {
    const sql = montarSqlChuvaDiariaPics('2025-09-04');
    expect(sql).toContain('"DATABASE".stg_climatemonitoring2');
    expect(sql).toContain("c.data >= DATE '2025-09-04'");
    expect(sql).toContain('sum(c.pluviometria)');
    // a visão da ZEUS pesa a média do talhão pelo número de leituras de cada pluviômetro no dia
    expect(sql).toContain('count(*) AS n');
    expect(sql).toContain('mode() WITHIN GROUP (ORDER BY n)');
    expect(sql).toContain("'x' || p.n::text");
    expect(sql).toContain("(p.dia - DATE '2025-09-04')");
    expect(sql).toContain('string_agg(');
    expect(sql).toContain('right(c.idprecipitation, 14)');
    // o validador do Agrovex recusa comentário, e o '%' colide com o parâmetro do driver
    expect(sql).not.toContain('--');
    expect(sql).not.toContain('%');
    expect(montarSqlChuvaDiariaPics("2025-09-04'; DROP")).toContain("DATE '2025-09-04'");
  });

  it('uma linha por fazenda: pluviômetros com a chuva diária e o vínculo talhão → pluviômetros', () => {
    const linhas = linhasChuvaTalhao({ vinculos: VINCULOS, chuva: CHUVA }, '2025-09-04', GERADO);
    expect(linhas.map((l) => l.unidade)).toEqual(['OUTRA', 'TESTE']);
    const teste = linhas[1];
    expect(teste).toMatchObject({ unidade: 'TESTE', gerado_em: GERADO, inicio: '2025-09-04', dias: 400, ultima_leitura: '2026-10-08T11:00' });
    expect(teste.pics).toEqual([
      { id: '900', n: 'PIC_900-TESTE_A', lat: -13.1, lon: -55.2, ul: '2026-10-08T11:00', l: 24, d: '0,1:2.4,399:10.0x11' },
      // hora da leitura fora do padrão: fica sem a hora
      { id: '901', n: 'PIC_901-TESTE_B', lat: -13.2, lon: -55.3, ul: null, l: 96, d: '398:0.6' },
      // coordenada 0,0 não é coordenada; sem leitura na janela, a chuva vem vazia
      { id: '902', n: 'PIC_902-TESTE_C', lat: null, lon: null, ul: null, l: 1, d: '' },
    ]);
    // código do talhão do jeito do PIMS: 'TH01' → '001', 'TH19 (0)' → '019', 'PIVO 03' → '03PIVO', '2 (1)' e 'TH02' → '002'
    expect(teste.vinculos).toEqual({ '001': [0], '002': [0, 1], '005': [2], '019': [0], '03PIVO': [1] });
    expect(linhas[0].pics.map((p) => p.id)).toEqual(['950']);
    expect(linhas[0].vinculos).toEqual({ '001': [0] });
    expect(linhas[0].ultima_leitura).toBe('2026-10-07T23:00');
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

describe('atualizarChuvaTalhao (tabela chuva_talhao)', () => {
  it('gravado há menos de 30 minutos: não consulta a ZEUS de novo', async () => {
    const { impl, chamadas } = servidores([{ gerado_em: '2026-10-08T12:00:00.000Z' }], []);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('recente');
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/chuva_talhao?select=gerado_em&order=gerado_em.desc&limit=1`);
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('sem a tabela (script 0013 não aplicado): não é erro e não consulta a ZEUS', async () => {
    const { impl, chamadas } = servidores([], [], 404);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('sem-tabela');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('fora do minuto de tentativa: espera o próximo', async () => {
    const { impl, chamadas } = servidores([], [VINCULOS, CHUVA]);
    expect(await atualizarChuvaTalhao({ ...opcoes(impl), agora: () => new Date('2026-10-08T12:22:30Z') })).toBe('fora-do-passo');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('gravação antiga: consulta a ZEUS (cadastro e chuva) e grava uma linha por fazenda', async () => {
    const { impl, chamadas } = servidores([{ gerado_em: '2026-10-08T11:40:00.000Z' }], [VINCULOS, CHUVA]);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('ok');
    const consultas = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments);
    expect(consultas.map((c) => c.source)).toEqual(['zeus', 'zeus']);
    expect(consultas[1].sql).toContain("DATE '2025-09-04'");
    const post = chamadas.find((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB));
    expect(post?.url).toBe(`${URL_SB}/rest/v1/chuva_talhao?on_conflict=unidade`);
    expect((post?.init?.headers as Record<string, string>).Prefer).toContain('resolution=merge-duplicates');
    const corpo = JSON.parse(String(post?.init?.body));
    expect(corpo.map((l: { unidade: string }) => l.unidade)).toEqual(['OUTRA', 'TESTE']);
    expect(corpo[1].gerado_em).toBe(GERADO);
    // fazenda que saiu da ZEUS não fica para trás com dado velho
    const limpeza = chamadas.find((c) => c.init?.method === 'DELETE' && c.url.startsWith(URL_SB));
    expect(limpeza?.url).toBe(`${URL_SB}/rest/v1/chuva_talhao?gerado_em=lt.${encodeURIComponent(GERADO)}`);
  });

  it('a ZEUS não devolveu nenhum pluviômetro com fazenda: não grava nada', async () => {
    const { impl, chamadas } = servidores([], [{ columns: VINCULOS.columns, rows: [] }, CHUVA]);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('vazio');
    expect(chamadas.some((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB))).toBe(false);
  });
});
