import { describe, expect, it, vi } from 'vitest';
import {
  culturaDaSafra,
  gravarAcompanhamentoSupabase,
  inicioChuva,
  limparVariedade,
  linhasChuva,
  montarSqlChuva,
  unidadeDaFazendaZeus,
  linhasAcompanhamento,
  linhasHistorico,
  montarSqlHistorico,
  safrasAnteriores,
  logAcompanhamento,
  montarSqlAcompanhamento,
  primeiroNome,
  rodarAcompanhamento,
  sincronizarAcompanhamento,
  type AcompanhamentoScript,
  type FetchLike,
} from '../scripts/sincronizar-plantio.mjs';
import { atenderPedidos } from '../scripts/atender-pedidos.mjs';

const COL_TALHOES = ['unidade', 'setor', 'safra', 'id', 'codigo', 'area', 'dano', 'variedade', 'encerrado'];
const COL_PLANTIO = ['unidade', 'safra', 'id', 'codigo', 'data', 'area', 'equipe', 'cd_operacao', 'replantio'];
const COL_COLHEITA = ['unidade', 'safra', 'id', 'codigo', 'data', 'area', 'equipe', 'cd_operacao'];

const TALHOES = {
  columns: COL_TALHOES,
  rows: [
    ['SIRIEMA', 'SAO MIGUEL II', 'SOJA 26/27', '391829458181832501', '019', 64, 0, 'SEMENTE DE SOJA 76KA72 CE', null],
    ['SM3', 'SM3', 'SOJA 26/27', '1', '015', 120.5, 2, 'SEMENTE SOJA 23311 I2X', '2026-09-25'],
    ['SM3', 'SM3', 'MILHO 2ª SAFRA 26/27', '2', '015', 120.5, 0, null, null],
  ],
};
const PLANTIO = {
  columns: COL_PLANTIO,
  rows: [
    ['SIRIEMA', 'SOJA 26/27', '391829458181832501', '019', '2026-09-27', 64, 'HENRIQUE RAMOS CARDOSO', 17, 'N'],
    ['SM3', 'SOJA 26/27', '1', '015', '2026-09-24', 3, 'EQUIPE TERCEIRA', 18, 'N'],
    ['GLOBO', 'SOJA 26/27', '9', '001', '2026-09-24', 50, null, 17, 'N'],
    ['SM3', 'SOJA 26/27', '1', '015', null, 10, 'X', 17, 'N'],
  ],
};
const PLANTIO_MAPAS = {
  columns: ['unidade', 'setor', 'codigo', 'safra', 'area_prevista', 'area_plantada', 'plantio_inicio', 'plantio_fim', 'plantio_encerrado', 'variedade'],
  rows: [['SM3', 'SM3', '015', 'SOJA 26/27', 120.5, 3, '2026-09-24', '2026-09-24', null, null]],
};
const COLHEITA = { columns: COL_COLHEITA, rows: [['SM3', 'MILHO 2ª SAFRA 26/27', '2', '015', '2027-06-10', 40, 'DANILO SOUZA', 16]] };
const SAFRAS = {
  columns: ['DE_PER_SAFRA'],
  rows: [['SOJA 24/25'], ['SOJA 25/26'], ['SOJA 26/27'], ['MILHO 2º SAFRA 25/26'], ['MILHO SAFRINHA 23/24'], ['MILHO 2ª SAFRA 26/27'], ['ADM 25/26']],
};
const HIST = {
  columns: ['unidade', 'safra', 'op', 'data', 'area'],
  rows: [
    ['SM3', 'SOJA 25/26', 'PLANTIO', '2025-09-24', 210.5],
    ['SM3', 'SOJA 25/26', 'PLANTIO', '2025-09-23', 80],
    ['SIRIEMA', 'SOJA 24/25', 'PLANTIO', '2024-09-30', 64],
    ['SM3', 'SOJA 25/26', 'COLHEITA', '2026-02-10', 0],
    ['SM3', 'SOJA 26/27', 'PLANTIO', '2026-09-24', 3],
  ],
};
const CHUVA = {
  columns: ['fazenda', 'data', 'mm'],
  rows: [
    ['Faz_SM3', '2025-10-02', 12.4],
    ['Faz_SM3', '2025-10-03', 0],
    ['SIRIEMA', '2025-10-02', 3],
    ['Semi Confinamento', '2025-10-02', 8],
  ],
};

describe('acompanhamento: regras puras', () => {
  it('limpa o nome da variedade como o Power BI', () => {
    expect(limparVariedade('SEMENTE DE SOJA 84KA92 CE')).toBe('84KA92 CE');
    expect(limparVariedade('SEMENTE SOJA GUEPARDO IPRO')).toBe('GUEPARDO IPRO');
    expect(limparVariedade('A DEFINIR SOJA')).toBe('A DEFINIR');
    expect(limparVariedade(null)).toBeNull();
  });

  it('usa o primeiro nome da equipe ("Equipe" vira "Terceiro")', () => {
    expect(primeiroNome('HENRIQUE RAMOS CARDOSO')).toBe('Henrique');
    expect(primeiroNome('EQUIPE TERCEIRA')).toBe('Terceiro');
    expect(primeiroNome(null)).toBe('Sem equipe');
  });

  it('escapa aspas simples nos nomes de safra', () => {
    const sql = montarSqlAcompanhamento(["SOJA 26/27", "D'ÁGUA 26/27"]);
    expect(sql.talhoes).toContain("IN ('SOJA 26/27','D''ÁGUA 26/27')");
    expect(sql.plantio).toContain('APPLANTIO');
    expect(sql.colheita).toContain('CD_OPERACAO IN (16, 114)');
  });

  it('agrupa por safra × unidade e descarta apontamento sem data ou sem talhão na safra', () => {
    const linhas = linhasAcompanhamento({ talhoes: TALHOES, plantio: PLANTIO, colheita: COLHEITA }, '2026-09-29T12:00:00.000Z');
    expect(linhas.map((l) => `${l.safra}|${l.unidade}`)).toEqual([
      'MILHO 2ª SAFRA 26/27|SM3',
      'SOJA 26/27|SIRIEMA',
      'SOJA 26/27|SM3',
    ]);
    const sm3 = linhas.find((l) => l.safra === 'SOJA 26/27' && l.unidade === 'SM3')!;
    expect(sm3.talhoes).toEqual([
      { setor: 'SM3', id: '1', t: '015', area: 120.5, dano: 2, variedade: '23311 I2X', enc: '2026-09-25' },
    ]);
    // operação 18 = replantio; a linha sem data some
    expect(sm3.apontamentos).toEqual([
      { op: 'PLANTIO', id: '1', t: '015', d: '2026-09-24', a: 3, eq: 'EQUIPE TERCEIRA', e: 'Terceiro', rep: true },
    ]);
    const milho = linhas.find((l) => l.safra.startsWith('MILHO'))!;
    expect(milho.apontamentos[0]).toMatchObject({ op: 'COLHEITA', a: 40, e: 'Danilo', rep: false });
    // GLOBO não tem talhão na consulta: o apontamento dela não cria linha
    expect(linhas.some((l) => l.unidade === 'GLOBO')).toBe(false);
  });

  it('reconhece a mesma cultura mesmo com o nome da safra mudando de um ano para outro', () => {
    expect(culturaDaSafra('MILHO SAFRINHA 23/24')).toBe('MILHO 2 SAFRA');
    expect(culturaDaSafra('MILHO 2ª SAFRA 24/25')).toBe('MILHO 2 SAFRA');
    expect(culturaDaSafra('MILHO 2º SAFRA 25/26')).toBe('MILHO 2 SAFRA');
    expect(culturaDaSafra('ALGODÃO SAFRA 23/24')).toBe('ALGODAO 1 SAFRA');
    expect(culturaDaSafra('MILHO SILAGEM 25/26')).toBe(culturaDaSafra('SILAGEM 26/27'));
    expect(culturaDaSafra('MILHETO  25/26')).toBe('MILHETO');
  });

  it('acha as safras anteriores (até 3 anos) da mesma cultura', () => {
    const todas = SAFRAS.rows.map((r) => r[0]);
    expect(safrasAnteriores(['SOJA 26/27'], todas)).toEqual(['SOJA 24/25', 'SOJA 25/26']);
    expect(safrasAnteriores(['MILHO 2ª SAFRA 26/27'], todas)).toEqual(['MILHO 2º SAFRA 25/26', 'MILHO SAFRINHA 23/24']);
    expect(safrasAnteriores(['MILHO 2ª SAFRA 25/26'], todas)).toEqual(['MILHO SAFRINHA 23/24']);
    // até 3 anos antes (a aba "Safras"); com anos = 2, só as duas últimas
    expect(safrasAnteriores(['SOJA 27/28'], todas)).toEqual(['SOJA 24/25', 'SOJA 25/26', 'SOJA 26/27']);
    expect(safrasAnteriores(['SOJA 27/28'], todas, 2)).toEqual(['SOJA 25/26', 'SOJA 26/27']);
  });

  it('comparativo: um total por dia, sem talhões, sem a safra atual e sem dia zerado', () => {
    expect(montarSqlHistorico(['SOJA 25/26'])).toContain("IN ('SOJA 25/26')");
    expect(montarSqlHistorico(['SOJA 25/26'])).toContain('UNION ALL');
    const linhas = linhasHistorico(HIST, 'g', ['SOJA 26/27']);
    expect(linhas.map((l) => `${l.safra}|${l.unidade}`)).toEqual(['SOJA 24/25|SIRIEMA', 'SOJA 25/26|SM3']);
    const sm3 = linhas[1];
    expect(sm3.talhoes).toEqual([]);
    expect(sm3.apontamentos).toEqual([
      { op: 'PLANTIO', d: '2025-09-23', a: 80 },
      { op: 'PLANTIO', d: '2025-09-24', a: 210.5 },
    ]);
  });

  it('chuva: nome da fazenda da ZEUS vira a unidade do PIMS', () => {
    expect(unidadeDaFazendaZeus('Faz. Três Flechas')).toBe('TRES FLECHAS');
    expect(unidadeDaFazendaZeus('Faz_SM3')).toBe('SM3');
    expect(unidadeDaFazendaZeus('Fazenda Dourado')).toBe('DOURADO');
    expect(unidadeDaFazendaZeus('SIRIEMA')).toBe('SIRIEMA');
    expect(unidadeDaFazendaZeus('Faz. Globo')).toBe('GLOBO');
  });

  it('chuva: janela desde agosto de 3 anos-safra antes, SQL por pluviômetro e linhas só das unidades conhecidas', () => {
    expect(inicioChuva(new Date('2026-09-30T12:00:00Z'))).toBe('2023-08-01');
    expect(inicioChuva(new Date('2027-03-10T12:00:00Z'))).toBe('2023-08-01');
    const sql = montarSqlChuva("2023-08-01'; drop");
    expect(sql).toContain("DATE '2023-08-01'");
    expect(sql).not.toContain('drop');
    expect(sql).toContain('avg(p.mm)');
    const linhas = linhasChuva(CHUVA, 'g', ['SM3', 'SIRIEMA']);
    expect(linhas).toEqual([
      { safra: 'CHUVA', unidade: 'SIRIEMA', gerado_em: 'g', talhoes: [], apontamentos: [{ op: 'CHUVA', d: '2025-10-02', a: 3 }] },
      { safra: 'CHUVA', unidade: 'SM3', gerado_em: 'g', talhoes: [], apontamentos: [{ op: 'CHUVA', d: '2025-10-02', a: 12.4 }] },
    ]);
  });

  it('log só com totais, sem nome de fazenda', () => {
    const linhas = linhasAcompanhamento({ talhoes: TALHOES, plantio: PLANTIO, colheita: COLHEITA }, 'x');
    const log = logAcompanhamento({ geradoEm: 'x', safras: [], linhas }, 'ok');
    expect(log).toBe('Acompanhamento: ok; 3 linhas (safra × unidade), 3 talhões, 2 apontamentos de plantio, 1 de colheita.');
    expect(log).not.toMatch(/SIRIEMA|SM3/);
  });
});

// ---------- Agrovex falso (MCP) ----------

function agrovexFalso(opcoes: { http?: number } = {}) {
  const sqls: string[] = [];
  const impl: FetchLike = async (_url, init) => {
    if (opcoes.http) return new Response('{"error":"Unauthorized"}', { status: opcoes.http });
    if (init.method === 'DELETE') return new Response(null, { status: 200 });
    const corpo = JSON.parse(String(init.body));
    if (corpo.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), {
        status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' },
      });
    }
    if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const sql = String(corpo.params.arguments.sql);
    sqls.push(sql);
    // a consulta do plantio dos mapas (montarSql) também passa por aqui no teste do atenderPedidos
    const r = sql.includes('area_prevista')
      ? PLANTIO_MAPAS
      : sql.includes('stg_climatemonitoring2') ? CHUVA
      : sql.includes('UNION ALL') ? HIST
      : sql.includes('APPLANTIO') ? PLANTIO : sql.includes('APATIVPROD') ? COLHEITA
      : sql.includes('JOIN') ? TALHOES : SAFRAS;
    const texto = JSON.stringify({ status: 'success', columns: r.columns, rows: r.rows, row_count: r.rows.length, truncated: false });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ type: 'text', text: texto }] } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, sqls };
}

describe('sincronizarAcompanhamento', () => {
  it('faz as consultas numa sessão e monta as linhas, com as safras anteriores para o comparativo', async () => {
    const { impl, sqls } = agrovexFalso();
    const dados = await sincronizarAcompanhamento({
      url: 'https://agrovex.test/mcp', token: 'tk', safras: ['SOJA 26/27', 'MILHO 2ª SAFRA 26/27'],
      fetchImpl: impl, agora: new Date('2026-09-29T12:00:00Z'),
    });
    // lista de safras, talhões, plantio, colheita, o total por dia das safras anteriores e a chuva (ZEUS)
    expect(sqls).toHaveLength(6);
    expect(sqls[5]).toContain('stg_climatemonitoring2');
    expect(sqls[4]).toContain("'MILHO 2º SAFRA 25/26','MILHO SAFRINHA 23/24','SOJA 24/25','SOJA 25/26'");
    expect(dados.geradoEm).toBe('2026-09-29T12:00:00.000Z');
    expect(dados.safras).toEqual(['SOJA 26/27', 'MILHO 2ª SAFRA 26/27']);
    expect(dados.anteriores).toEqual(['MILHO 2º SAFRA 25/26', 'MILHO SAFRINHA 23/24', 'SOJA 24/25', 'SOJA 25/26']);
    expect(dados.linhas.filter((l) => l.talhoes.length)).toHaveLength(3);
    expect(dados.linhas.filter((l) => !l.talhoes.length).map((l) => l.safra)).toEqual(['SOJA 24/25', 'SOJA 25/26', 'CHUVA', 'CHUVA']);
    expect(dados.chuva).toBe(2);
    expect(dados.linhas.every((l) => l.gerado_em === dados.geradoEm)).toBe(true);
  });
});

// ---------- Supabase falso ----------

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const DADOS: AcompanhamentoScript = {
  geradoEm: '2026-09-29T12:00:00.000Z',
  safras: ['SOJA 26/27'],
  linhas: [{ safra: 'SOJA 26/27', unidade: 'SM3', gerado_em: '2026-09-29T12:00:00.000Z', talhoes: [], apontamentos: [] }],
};

function supabaseFalso(respostas: Response[]) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const impl: FetchLike = async (url, init) => {
    chamadas.push({ url, init });
    return respostas[Math.min(i++, respostas.length - 1)];
  };
  return { impl, chamadas };
}

describe('gravarAcompanhamentoSupabase', () => {
  it('faz upsert em acomp_pims e depois limpa as linhas de rodadas anteriores', async () => {
    const { impl, chamadas } = supabaseFalso([new Response(null, { status: 201 }), new Response(null, { status: 204 })]);
    const r = await gravarAcompanhamentoSupabase(DADOS, { url: URL_SB, chave: CHAVE, fetch: impl });
    expect(r).toBe('ok');
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/acomp_pims?on_conflict=safra,unidade`);
    expect(chamadas[0].init.method).toBe('POST');
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual(DADOS.linhas);
    expect(chamadas[1].url).toBe(`${URL_SB}/rest/v1/acomp_pims?gerado_em=lt.${encodeURIComponent(DADOS.geradoEm)}`);
    expect(chamadas[1].init.method).toBe('DELETE');
  });

  it('sem a tabela (script SQL não aplicado) só avisa e não apaga nada', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, chamadas } = supabaseFalso([
      new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.acomp_pims'" }), { status: 404 }),
    ]);
    const r = await gravarAcompanhamentoSupabase(DADOS, { url: URL_SB, chave: CHAVE, fetch: impl });
    expect(r).toBe('sem-tabela');
    expect(chamadas).toHaveLength(1);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('PIMS sem talhão não mexe no Supabase', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, chamadas } = supabaseFalso([new Response(null, { status: 201 })]);
    const r = await gravarAcompanhamentoSupabase({ ...DADOS, linhas: [] }, { url: URL_SB, chave: CHAVE, fetch: impl });
    expect(r).toBe('vazio');
    expect(chamadas).toHaveLength(0);
    aviso.mockRestore();
  });

  it('outro erro do Supabase é lançado sem a chave', async () => {
    const { impl } = supabaseFalso([new Response(JSON.stringify({ code: '42501', message: `permissão negada ${CHAVE}` }), { status: 403 })]);
    const erro = await gravarAcompanhamentoSupabase(DADOS, { url: URL_SB, chave: CHAVE, fetch: impl }).catch((e: Error) => e);
    expect(String(erro)).toMatch(/Supabase recusou o upsert em acomp_pims \(HTTP 403\)/);
    expect(String(erro)).not.toContain(CHAVE);
  });
});

describe('rodarAcompanhamento', () => {
  it('erro do Agrovex vira mensagem (sem o token nem a chave) e não é lançado', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { impl } = agrovexFalso({ http: 401 });
    const msg = await rodarAcompanhamento({
      agrovex: { url: 'https://agrovex.test/mcp', token: 'token-secreto', safras: ['SOJA 26/27'] },
      supabase: { url: URL_SB, chave: CHAVE },
      fetchImpl: impl,
    });
    expect(msg).toMatch(/O servidor de dados do PIMS recusou o acesso/);
    expect(msg).not.toContain('token-secreto');
    expect(msg).not.toContain(CHAVE);
    log.mockRestore();
  });
});

describe('atenderPedidos com o acompanhamento ligado', () => {
  it('depois do plantio dos mapas, também grava acomp_pims', async () => {
    const vistos: string[] = [];
    const agrovex = agrovexFalso();
    const impl = async (url: string, init?: RequestInit) => {
      if (url.startsWith(URL_SB)) {
        vistos.push(`${init?.method ?? 'GET'} ${url.replace(URL_SB, '').split('?')[0]}`);
        if (!init?.method || init.method === 'GET') return new Response(JSON.stringify([{ id: 5 }]), { status: 200 });
        return new Response(null, { status: 204 });
      }
      return agrovex.impl(url, init as RequestInit);
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = await atenderPedidos({
      supabase: { url: URL_SB, chave: CHAVE },
      agrovex: { url: 'https://agrovex.test/mcp', token: 'tk', safras: ['SOJA 26/27'] },
      acompanhamento: true,
      fetch: impl,
    });
    log.mockRestore();
    expect(r).toBe(true);
    const iPlantio = vistos.indexOf('POST /rest/v1/mapas_plantio_pims');
    const iAcomp = vistos.indexOf('POST /rest/v1/acomp_pims');
    const iMarca = vistos.indexOf('PATCH /rest/v1/mapas_plantio_pedidos');
    expect(iPlantio).toBeGreaterThanOrEqual(0);
    expect(iAcomp).toBeGreaterThan(iPlantio);
    expect(iMarca).toBeGreaterThan(iAcomp);
  });
});
