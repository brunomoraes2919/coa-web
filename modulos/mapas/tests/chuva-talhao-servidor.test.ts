import { describe, expect, it } from 'vitest';
import { atualizarChuvaTalhao } from '../scripts/atender-pedidos.mjs';
import {
  ciclosDoPims, diasDaJanelaChuva, faixasDeDias, inicioChuvaTalhao, linhasChuvaTalhao, montarSqlChuvaDiariaPics, montarSqlChuvaTalhoes,
  montarSqlCiclosChuva, montarSqlDiasChuvaTalhoes, safrasDaJanelaChuva, SQL_VINCULOS_ZEUS,
} from '../scripts/sincronizar-plantio.mjs';

// Todos os dados daqui são FICTÍCIOS.
const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';
const AGORA = new Date('2026-10-08T12:20:00Z');
const GERADO = AGORA.toISOString();
const DESDE = '2024-09-01';
const DIAS = 768;

// stg_field_data: uma linha por talhão, com o primeiro e o último dia e só os dias com chuva
const TALHOES = {
  columns: ['unidade', 'fieldname', 'de', 'ate', 'dias'],
  rows: [
    ['TESTE', '001', 0, 742, '10:2.5,741:8.25'],
    ['TESTE', '02PIVO', 0, 742, null],
    ['TESTE', 'P14', 352, 742, '700:49.24'],
    ['Três Testes', '007', 0, 742, '3:1'],
    // dia fora da janela e texto estragado não entram
    ['TESTE', '099', 0, 900, '1:1'],
    ['TESTE', '098', 0, 10, 'drop table'],
    ['', '001', 0, 10, '1:1'],
  ],
};
const DIAS_COM_DADO = { columns: ['unidade', 'dias'], rows: [['TESTE', '0,1,2,3,5,6,742'], ['Três Testes', '0,1,2']] };
const VINCULOS = {
  columns: ['farm', 'talhao', 'picid', 'picname', 'lat', 'lon'],
  rows: [
    ['Faz. Teste', 'TH01', '900', 'PIC_900-TESTE_A', '-13,10', '-55.20'],
    ['Faz. Teste', 'PIVO 02', '901', 'PIC_901-TESTE_B', '-13.20', '-55.30'],
    ['Faz. Teste', '2 (1)', '900', 'PIC_900-TESTE_A', '-13,10', '-55.20'],
    ['Faz. Teste', 'TH02', '901', 'PIC_901-TESTE_B', '-13.20', '-55.30'],
    ['Fazenda Teste', '005', '902', 'PIC_902-TESTE_C', '0', '0'],
    // fazenda que só tem pluviômetro (sem chuva por talhão): entra, com os talhões vazios
    ['Faz_Outra', '001', '950', 'PIC_950-OUTRA', '-14.0', '-56.0'],
    [null, '001', '999', 'PIC_SEM_FAZENDA', '-14.0', '-56.0'],
  ],
};
const CHUVA = {
  columns: ['picid', 'leitura', 'dias'],
  rows: [
    ['900', '20261008110000', '0,1:2.4,767:10.0'],
    ['901', '2026100799', '766:0.6'],
    ['950', '20261007230000', '765,766:12.2'],
    ['777', '20261007230000', '766:5.0'],
  ],
};
// PIMS: uma linha por talhão × período de safra
const LINHAS_PIMS = [
  { unidade: 'TESTE', safra: 'SAFRA 2025/2026', periodo: 'SOJA 25/26', talhao: '001', plantio: '2025-09-20', colheita: '2026-02-10', inicio_per: '2025-09-01', fim_per: '2026-08-31' },
  { unidade: 'TESTE', safra: 'SAFRA 2025/2026', periodo: 'SOJA 25/26', talhao: '2PIVO', plantio: '2025-09-15', colheita: '2026-03-12', inicio_per: '2025-09-01', fim_per: '2026-08-31' },
  { unidade: 'TESTE', safra: 'SAFRA 2025/2026', periodo: 'SOJA 25/26', talhao: 'P14', plantio: null, colheita: null, inicio_per: '2025-09-01', fim_per: '2026-08-31' },
  // ciclo ainda sem plantio nem colheita: vale o período
  { unidade: 'TESTE', safra: 'SAFRA 2026/2027', periodo: 'MILHO 2ª SAFRA 26/27', talhao: '001', plantio: null, colheita: null, inicio_per: '2026-06-01', fim_per: '2027-08-31' },
  { unidade: 'TESTE', safra: 'SAFRA 2026/2027', periodo: 'SOJA 26/27', talhao: '001', plantio: '2026-09-07', colheita: null, inicio_per: '2026-05-01', fim_per: '2027-08-31' },
  { unidade: 'SEM CHUVA', safra: 'SAFRA 2026/2027', periodo: 'SOJA 26/27', talhao: '001', plantio: '2026-09-07', colheita: null, inicio_per: '2026-05-01', fim_per: '2027-08-31' },
  { unidade: 'TESTE', safra: null, periodo: 'SOJA 26/27', talhao: '001', plantio: null, colheita: null, inicio_per: null, fim_per: null },
];

describe('chuva por talhão (servidor)', () => {
  it('a janela começa em 1º de setembro, duas safras antes da atual, pela data da fazenda (UTC-4)', () => {
    expect(inicioChuvaTalhao(AGORA)).toBe('2024-09-01');
    expect(inicioChuvaTalhao(new Date('2026-08-31T12:00:00Z'))).toBe('2023-09-01');
    // 02:00 UTC do dia 1º ainda é 31/08 na fazenda: a safra não virou
    expect(inicioChuvaTalhao(new Date('2026-09-01T02:00:00Z'))).toBe('2023-09-01');
    expect(diasDaJanelaChuva(DESDE, AGORA)).toBe(DIAS);
    expect(safrasDaJanelaChuva(DESDE, AGORA)).toEqual(['SAFRA 2024/2025', 'SAFRA 2025/2026', 'SAFRA 2026/2027']);
  });

  it('a chuva de cada talhão vem da stg_field_data (a tabela do Power BI), com duas casas', () => {
    const sql = montarSqlChuvaTalhoes(DESDE);
    expect(sql).toContain('"DATABASE".stg_field_data');
    expect(sql).toContain("data >= DATE '2024-09-01'");
    expect(sql).toContain("coalesce(fieldname, '') <> ''");
    expect(sql).toContain('round(pluviometry::numeric, 2)');
    expect(sql).toContain('FILTER (WHERE round(pluviometry::numeric, 2) > 0)');
    expect(sql).toContain('GROUP BY unidade, fieldname');
    // o validador do Agrovex recusa comentário, e o '%' colide com o parâmetro do driver
    for (const s of [sql, montarSqlDiasChuvaTalhoes(DESDE), montarSqlChuvaDiariaPics(DESDE)]) {
      expect(s).not.toContain('--');
      expect(s).not.toContain('%');
    }
    expect(montarSqlChuvaTalhoes("2024-09-01'; DROP")).toContain("DATE '2024-09-01'");
    expect(montarSqlDiasChuvaTalhoes(DESDE)).toContain('SELECT DISTINCT unidade');
    // os pluviômetros continuam vindo do cadastro e da telemetria, só como referência
    expect(SQL_VINCULOS_ZEUS).toContain('"DATABASE".stg_zeus_picarea');
    expect(montarSqlChuvaDiariaPics(DESDE)).toContain('"DATABASE".stg_climatemonitoring2');
  });

  it('os ciclos usam o filtro do Power BI no PIMS, paginados', () => {
    const sql = montarSqlCiclosChuva(['SAFRA 2025/2026', "SAFRA 2026/2027'"], 4000);
    expect(sql).toContain("sf.DE_SAFRA IN ('SAFRA 2025/2026','SAFRA 2026/2027''')");
    expect(sql).toContain('up.QT_AREA_PROD > 1');
    expect(sql).toContain("oc.DE_OCUPACAO IN ('ALGODAO', 'SOJA', 'MILHO')");
    expect(sql).toContain("up.CD_UPNIVEL3 <> '9999'");
    expect(sql).toContain('OFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY');
  });

  it('ciclo = do primeiro plantio à última colheita; sem plantio ou colheita, valem as datas do período', () => {
    expect(ciclosDoPims(LINHAS_PIMS)).toEqual([
      { unidade: 'TESTE', safra: 'SAFRA 2025/2026', periodo: 'SOJA 25/26', inicio: '2025-09-15', fim: '2026-03-12', talhoes: ['001', '02PIVO', 'P14'] },
      { unidade: 'TESTE', safra: 'SAFRA 2026/2027', periodo: 'MILHO 2ª SAFRA 26/27', inicio: '2026-06-01', fim: '2027-08-31', talhoes: ['001'] },
      { unidade: 'TESTE', safra: 'SAFRA 2026/2027', periodo: 'SOJA 26/27', inicio: '2026-09-07', fim: '2027-08-31', talhoes: ['001'] },
      { unidade: 'SEM CHUVA', safra: 'SAFRA 2026/2027', periodo: 'SOJA 26/27', inicio: '2026-09-07', fim: '2027-08-31', talhoes: ['001'] },
    ]);
  });

  it('os dias com dado viram faixas', () => {
    expect(faixasDeDias('0,1,2,5,6,9')).toBe('0-2,5-6,9');
    expect(faixasDeDias('3,1,2,2,x,-1')).toBe('1-3');
    expect(faixasDeDias(null)).toBe('');
  });

  it('uma linha por fazenda: chuva de cada talhão, dias com dado, ciclos e os pluviômetros como referência', () => {
    const linhas = linhasChuvaTalhao({ talhoes: TALHOES, diasComDado: DIAS_COM_DADO, ciclos: ciclosDoPims(LINHAS_PIMS), vinculos: VINCULOS, chuva: CHUVA }, DESDE, DIAS, GERADO);
    expect(linhas.map((l) => l.unidade)).toEqual(['OUTRA', 'TESTE', 'TRES TESTES']);
    const teste = linhas[1];
    expect(teste).toMatchObject({ unidade: 'TESTE', gerado_em: GERADO, inicio: DESDE, dias: DIAS, ultimo_dia: '2026-09-13', lidos: '0-3,5-6,742', ultima_leitura: '2026-10-08T11:00' });
    // código do talhão normalizado como no cadastro do Mapas; o talhão sem chuva na janela entra com a lista vazia
    expect(teste.talhoes).toEqual({
      '001': { de: 0, ate: 742, d: '10:2.5,741:8.25' },
      '02PIVO': { de: 0, ate: 742, d: '' },
      P14: { de: 352, ate: 742, d: '700:49.24' },
      '098': { de: 0, ate: 10, d: '' },
    });
    // ciclos da fazenda, da safra mais recente para a mais antiga
    expect(teste.ciclos).toEqual([
      { s: 'SAFRA 2026/2027', p: 'MILHO 2ª SAFRA 26/27', de: '2026-06-01', ate: '2027-08-31', t: ['001'] },
      { s: 'SAFRA 2026/2027', p: 'SOJA 26/27', de: '2026-09-07', ate: '2027-08-31', t: ['001'] },
      { s: 'SAFRA 2025/2026', p: 'SOJA 25/26', de: '2025-09-15', ate: '2026-03-12', t: ['001', '02PIVO', 'P14'] },
    ]);
    expect(teste.pics).toEqual([
      { id: '900', n: 'PIC_900-TESTE_A', lat: -13.1, lon: -55.2, ul: '2026-10-08T11:00', d: '0,1:2.4,767:10.0' },
      { id: '901', n: 'PIC_901-TESTE_B', lat: -13.2, lon: -55.3, ul: null, d: '766:0.6' },
      { id: '902', n: 'PIC_902-TESTE_C', lat: null, lon: null, ul: null, d: '' },
    ]);
    expect(teste.vinculos).toEqual({ '001': [0], '002': [0, 1], '005': [2], '02PIVO': [1] });
    // fazenda só com pluviômetro e fazenda só com chuva por talhão
    expect(linhas[0]).toMatchObject({ unidade: 'OUTRA', talhoes: {}, lidos: '', ultimo_dia: null, ciclos: [] });
    expect(linhas[0].pics.map((p) => p.id)).toEqual(['950']);
    expect(linhas[2]).toMatchObject({ unidade: 'TRES TESTES', talhoes: { '007': { de: 0, ate: 742, d: '3:1' } }, lidos: '0-2', pics: [], vinculos: {} });
  });
});

interface Chamada { url: string; init?: RequestInit }

/** Supabase e Agrovex falsos: o GET devolve `situacao`; cada execute_query, o resultado da vez; o POST, `statusPost`. */
function servidores(situacao: unknown[], consultas: unknown[], statusGet = 200, corpoPost: { status: number; corpo?: unknown } = { status: 204 }) {
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
      if (init.method === 'POST' && corpoPost.status !== 204) return new Response(JSON.stringify(corpoPost.corpo), { status: corpoPost.status });
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

const PIMS = {
  columns: ['unidade', 'safra', 'periodo', 'talhao', 'plantio', 'colheita', 'inicio_per', 'fim_per'],
  rows: LINHAS_PIMS.map((l) => [l.unidade, l.safra, l.periodo, l.talhao, l.plantio, l.colheita, l.inicio_per, l.fim_per]),
};
// a ordem das consultas: chuva por talhão, dias com dado, ciclos do PIMS (uma página), vínculos e pluviômetros
const CONSULTAS = [TALHOES, DIAS_COM_DADO, PIMS, VINCULOS, CHUVA];

const opcoes = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({
  supabase: { url: URL_SB, chave: CHAVE },
  agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN },
  fetch: impl,
  agora: () => AGORA,
});
const foiAoAgrovex = (chamadas: Chamada[]) => chamadas.some((c) => c.url.includes('agrovex'));

describe('atualizarChuvaTalhao (tabela chuva_talhao)', () => {
  it('gravado há menos de 30 minutos: não consulta de novo', async () => {
    const { impl, chamadas } = servidores([{ gerado_em: '2026-10-08T12:00:00.000Z' }], []);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('recente');
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/chuva_talhao?select=gerado_em&order=gerado_em.desc&limit=1`);
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('sem a tabela (script 0013 não aplicado): não é erro e não consulta', async () => {
    const { impl, chamadas } = servidores([], [], 404);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('sem-tabela');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('fora do minuto de tentativa: espera o próximo', async () => {
    const { impl, chamadas } = servidores([], CONSULTAS);
    expect(await atualizarChuvaTalhao({ ...opcoes(impl), agora: () => new Date('2026-10-08T12:22:30Z') })).toBe('fora-do-passo');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('gravação antiga: consulta a ZEUS e o PIMS e grava uma fazenda por pedido', async () => {
    const { impl, chamadas } = servidores([{ gerado_em: '2026-10-08T11:40:00.000Z' }], CONSULTAS);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('ok');
    const consultas = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments);
    expect(consultas.map((c) => c.source)).toEqual(['zeus', 'zeus', 'sqlserver', 'zeus', 'zeus']);
    expect(consultas[0].sql).toContain('stg_field_data');
    expect(consultas[2].sql).toContain("'SAFRA 2024/2025','SAFRA 2025/2026','SAFRA 2026/2027'");
    const posts = chamadas.filter((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB));
    expect(posts.map((c) => c.url)).toEqual(new Array(3).fill(`${URL_SB}/rest/v1/chuva_talhao?on_conflict=unidade`));
    expect((posts[0].init?.headers as Record<string, string>).Prefer).toContain('resolution=merge-duplicates');
    const corpos = posts.map((c) => JSON.parse(String(c.init?.body)));
    expect(corpos.map((l) => l.length)).toEqual([1, 1, 1]);
    expect(corpos.map((l) => l[0].unidade)).toEqual(['OUTRA', 'TESTE', 'TRES TESTES']);
    expect(Object.keys(corpos[1][0].talhoes)).toEqual(['001', '02PIVO', 'P14', '098']);
    // fazenda que saiu da ZEUS não fica para trás com dado velho
    const limpeza = chamadas.find((c) => c.init?.method === 'DELETE' && c.url.startsWith(URL_SB));
    expect(limpeza?.url).toBe(`${URL_SB}/rest/v1/chuva_talhao?gerado_em=lt.${encodeURIComponent(GERADO)}`);
  });

  it('faltam as colunas novas (script 0014 não aplicado): avisa e não apaga o que já estava gravado', async () => {
    const { impl, chamadas } = servidores([], CONSULTAS, 200, { status: 400, corpo: { code: 'PGRST204', message: "Could not find the 'talhoes' column of 'chuva_talhao' in the schema cache" } });
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('sem-coluna');
    expect(chamadas.some((c) => c.init?.method === 'DELETE' && c.url.startsWith(URL_SB))).toBe(false);
  });

  it('nada na ZEUS: não grava nada', async () => {
    const vazio = (colunas: string[]) => ({ columns: colunas, rows: [] });
    const { impl, chamadas } = servidores([], [vazio(TALHOES.columns), vazio(DIAS_COM_DADO.columns), vazio(PIMS.columns), vazio(VINCULOS.columns), CHUVA]);
    expect(await atualizarChuvaTalhao(opcoes(impl))).toBe('vazio');
    expect(chamadas.some((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB))).toBe(false);
  });
});
