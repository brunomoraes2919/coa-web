import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  classificar,
  filtrarSafras,
  gravarSupabase,
  linhasSupabase,
  mesmosDados,
  montarSql,
  normalizarCodigo,
  resumo,
  safrasPadrao,
  sincronizar,
  type FetchLike,
} from '../scripts/sincronizar-plantio.mjs';

const COLUNAS = [
  'unidade', 'setor', 'codigo', 'safra', 'area_prevista', 'area_plantada',
  'plantio_inicio', 'plantio_fim', 'plantio_encerrado', 'variedade',
];

describe('normalizarCodigo', () => {
  it('segue os casos do plano', () => {
    expect(normalizarCodigo('39B')).toBe('039B');
    expect(normalizarCodigo('TH 033A')).toBe('033A');
    expect(normalizarCodigo('TH033A')).toBe('033A');
    expect(normalizarCodigo('69')).toBe('069');
    expect(normalizarCodigo('PIVÔ 02')).toBe('02PIVO');
    expect(normalizarCodigo('PIVO 2')).toBe('02PIVO');
    expect(normalizarCodigo('PIV2')).toBe('02PIVO');
    expect(normalizarCodigo('Talhão 5')).toBe('005');
    expect(normalizarCodigo('talhao 12a')).toBe('012A');
    expect(normalizarCodigo('P14')).toBe('P14');
    expect(normalizarCodigo(' m1 a ')).toBe('M1A');
  });

  it('hífen separa prefixo/número/sufixo, mas é mantido nos demais códigos', () => {
    expect(normalizarCodigo('001-A')).toBe('001A');
    expect(normalizarCodigo('TH-033A')).toBe('033A');
    expect(normalizarCodigo('TH 002-A')).toBe('002A');
    expect(normalizarCodigo('39B')).toBe('039B');
    expect(normalizarCodigo('PIVÔ 02')).toBe('02PIVO');
    expect(normalizarCodigo('19PESQ')).toBe('019PESQ');
    expect(normalizarCodigo('01AR')).toBe('001AR');
    expect(normalizarCodigo('P14')).toBe('P14');
    expect(normalizarCodigo('M1A')).toBe('M1A');
    expect(normalizarCodigo('EXP-CL')).toBe('EXP-CL');
    expect(normalizarCodigo('THX')).toBe('THX');
    expect(normalizarCodigo('TALHÃO - 7B')).toBe('007B');
    expect(normalizarCodigo('PIVÔ-3')).toBe('03PIVO');
  });

  it('é idempotente nos códigos do PIMS', () => {
    for (const c of ['001', '013A', '02PIVO', '05PIVO', 'M1A', 'P14', '032PQ', '9999']) {
      expect(normalizarCodigo(c)).toBe(c);
      expect(normalizarCodigo(normalizarCodigo(c))).toBe(normalizarCodigo(c));
    }
    expect(normalizarCodigo(normalizarCodigo('19PESQ'))).toBe(normalizarCodigo('19PESQ'));
  });

  it('devolve vazio para nulo/vazio', () => {
    expect(normalizarCodigo(null)).toBe('');
    expect(normalizarCodigo(undefined)).toBe('');
    expect(normalizarCodigo('   ')).toBe('');
  });

  const ts = resolve('src/lib/codigoTalhao.ts');
  it.skipIf(!existsSync(ts))('é igual à versão do app (src/lib/codigoTalhao.ts)', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(ts).href)) as {
      normalizarCodigo: (s: string | null | undefined) => string;
    };
    const casos = [
      '39B', 'TH 033A', 'TH033A', '69', 'PIVÔ 02', 'PIVO 2', 'PIV2', '02PIVO', 'Talhão 5', 'TALHÃO 033A',
      'talhao 12a', 'P14', 'M1A', ' m1 a ', '001', '013A', '19PESQ', '08PESQ', '032PQ', '9999', '0012',
      'SÃO 1', '', '  ', null, undefined, 'TH-12', 'TALHÃO - 7B', 'PIVÔ-3', 'PIVO - 02', 'EXP-CL', 'M-1 A', '001-A', '01AR', 'Ç 7',
      'TH-033A', 'TH 002-A', 'THX', 'TH', 'THIAGO', 'TALHAO: 5', '2 - PIVO', '02 PIVO',
    ];
    const amostraReal = resolve('dados-teste/pims_status_soja2627.json');
    if (existsSync(amostraReal)) {
      const d = JSON.parse(readFileSync(amostraReal, 'utf8')) as { rows: unknown[][] };
      casos.push(...d.rows.map((r) => String(r[2])));
    }
    for (const c of casos) expect(normalizarCodigo(c), String(c)).toBe(mod.normalizarCodigo(c));
  });
});

describe('classificar', () => {
  it('plantado quando o plantio foi encerrado, mesmo com área parcial', () => {
    expect(classificar({ areaPrevista: 179, areaPlantada: 165, plantioEncerrado: '2026-09-25' })).toBe('plantado');
  });
  it('plantando quando há apontamento parcial', () => {
    expect(classificar({ areaPrevista: 228, areaPlantada: 208, plantioEncerrado: null })).toBe('plantando');
  });
  it('a_plantar sem apontamento', () => {
    expect(classificar({ areaPrevista: 52, areaPlantada: 0, plantioEncerrado: null })).toBe('a_plantar');
    expect(classificar({ areaPrevista: 52, areaPlantada: null, plantioEncerrado: null })).toBe('a_plantar');
  });
  it('limite de 99% da área prevista', () => {
    expect(classificar({ areaPrevista: 100, areaPlantada: 99, plantioEncerrado: null })).toBe('plantado');
    expect(classificar({ areaPrevista: 100, areaPlantada: 98.99, plantioEncerrado: null })).toBe('plantando');
    expect(classificar({ areaPrevista: 91, areaPlantada: 94, plantioEncerrado: null })).toBe('plantado');
    expect(classificar({ areaPrevista: 100, areaPlantada: 0.01, plantioEncerrado: null })).toBe('plantando');
  });
});

describe('montarSql', () => {
  it('usa a consulta validada com o nome da safra entre aspas', () => {
    const sql = montarSql('SOJA 26/27');
    expect(sql).toContain("WHERE ps.DE_PER_SAFRA = 'SOJA 26/27'");
    expect(sql).toContain('FROM PIMSMCPRD.dbo.UPNIVEL3 up');
    expect(sql).toContain('SUM(QT_AREA) AS area_plantada');
    expect(sql).not.toContain(':safra');
    expect(sql).not.toContain('--');
  });
  it("escapa aspas simples ('' no SQL Server)", () => {
    expect(montarSql("SOJA D'OESTE")).toContain("= 'SOJA D''OESTE'");
  });
});

describe('safrasPadrao / filtrarSafras', () => {
  it('ano-safra corrente e seguinte (setembro a agosto)', () => {
    expect(safrasPadrao(new Date(2026, 8, 28))).toEqual(['%26/27', '%27/28']);
    expect(safrasPadrao(new Date(2026, 7, 31))).toEqual(['%25/26', '%26/27']);
    expect(safrasPadrao(new Date(2027, 0, 15))).toEqual(['%26/27', '%27/28']);
    expect(safrasPadrao(new Date(2029, 11, 1))).toEqual(['%29/30', '%30/31']);
  });
  it('filtra os nomes do PIMS pelo final e ordena', () => {
    const nomes = ['SOJA 25/26', 'SOJA 26/27 ', 'MILHO 2ª SAFRA 26/27', 'ADM 25/26', 'TRIGO 27/28', 'SOJA 126/27X'];
    expect(filtrarSafras(nomes, ['%26/27', '%27/28'])).toEqual(['MILHO 2ª SAFRA 26/27', 'SOJA 26/27', 'TRIGO 27/28']);
  });
  it('exclui safras não agrícolas pelos prefixos (sem acento, maiúsculas)', () => {
    const nomes = [
      'ADM 26/27', 'CORRECAO PREP. SOLO 26/27', 'Correção prep. solo 27/28', 'COBERTURA SOLO 26/27',
      'ABERTURA AREA 26/27', 'SOJA 26/27', 'ALGODAO 2º SAFRA 26/27', 'SORGO 26/27', 'SOJA ADM 26/27',
    ];
    const excluir = ['ADM', 'CORREC', 'COBERTURA', 'ABERTURA'];
    expect(filtrarSafras(nomes, ['%26/27', '%27/28'], excluir))
      .toEqual(['ALGODAO 2º SAFRA 26/27', 'SOJA 26/27', 'SOJA ADM 26/27', 'SORGO 26/27']);
    expect(filtrarSafras(nomes, ['%26/27'], ['correç'])).not.toContain('CORRECAO PREP. SOLO 26/27');
  });
});

// ---------- sincronizar com fetch falso ----------

interface Chamada { url: string; headers: Record<string, string>; corpo: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } | null; metodoHttp: string }

function sse(obj: unknown): string {
  return `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } })}\n\nevent: message\ndata: ${JSON.stringify(obj)}\n\n`;
}

function respostaQuery(id: number, dados: unknown) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(dados) }] } };
}

function fetchFalso(consultas: (sql: string) => unknown, opcoes: { sseInit?: boolean; http?: number } = {}) {
  const chamadas: Chamada[] = [];
  const impl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, headers, corpo, metodoHttp: init.method ?? 'GET' });
    if (opcoes.http) return new Response('proibido', { status: opcoes.http });
    if (init.method === 'DELETE') return new Response(null, { status: 200 });
    if (corpo.method === 'initialize') {
      const r = { jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'agrovex' } } };
      return opcoes.sseInit
        ? new Response(`event: message\ndata: ${JSON.stringify(r)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sessao-123' } })
        : new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sessao-123' } });
    }
    if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (corpo.method === 'tools/call') {
      const dados = consultas(String(corpo.params.arguments.sql));
      return new Response(sse(respostaQuery(corpo.id, dados)), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('?', { status: 400 });
  };
  return { impl, chamadas };
}

const LINHAS = [
  ['SIRIEMA', 'SIRIEMA', '007', 'SOJA 26/27', 228, 208, '2026-09-27', '2026-09-27', null, 'A DEFINIR SOJA'],
  ['SIRIEMA', 'SIRIEMA', '001', 'SOJA 26/27', 97, 97, '2026-09-24', '2026-09-24', '2026-09-24', 'SEMENTE DE SOJA 84KA92 CE'],
  ['GLOBO', 'GLEBA DUAS BARRAS', '02PIVO', 'SOJA 26/27', 68, 0, null, null, null, null],
];

describe('sincronizar', () => {
  const agora = new Date('2026-09-28T10:00:00Z');

  it('abre a sessão MCP, consulta a safra e monta o plantio.json', async () => {
    const { impl, chamadas } = fetchFalso(() => ({ status: 'success', columns: COLUNAS, rows: LINHAS, row_count: 3, truncated: false }));
    const dados = await sincronizar({ url: 'https://mcp.exemplo/mcp', token: 'tk', safras: ['SOJA 26/27'], fetchImpl: impl, agora });

    expect(dados).toEqual({
      versao: 1,
      geradoEm: '2026-09-28T10:00:00.000Z',
      fonte: 'PIMS via Agrovex',
      safras: [{
        nome: 'SOJA 26/27',
        unidades: [
          { unidade: 'GLOBO', talhoes: [
            { codigo: '02PIVO', codigoPims: '02PIVO', setor: 'GLEBA DUAS BARRAS', status: 'a_plantar', areaPrevista: 68, areaPlantada: 0, inicio: null, fim: null, variedade: null },
          ] },
          { unidade: 'SIRIEMA', talhoes: [
            { codigo: '001', codigoPims: '001', setor: 'SIRIEMA', status: 'plantado', areaPrevista: 97, areaPlantada: 97, inicio: '2026-09-24', fim: '2026-09-24', variedade: 'SEMENTE DE SOJA 84KA92 CE' },
            { codigo: '007', codigoPims: '007', setor: 'SIRIEMA', status: 'plantando', areaPrevista: 228, areaPlantada: 208, inicio: '2026-09-27', fim: '2026-09-27', variedade: 'A DEFINIR SOJA' },
          ] },
        ],
      }],
    });

    const [ini, notif, call] = chamadas;
    expect(ini.corpo?.method).toBe('initialize');
    expect(ini.headers['authorization']).toBe('Bearer tk');
    expect(ini.headers['user-agent']).toBe('mapa-chuva-coa/1.0');
    expect(ini.headers['accept']).toBe('application/json, text/event-stream');
    expect(ini.headers['mcp-session-id']).toBeUndefined();
    expect(notif.corpo?.method).toBe('notifications/initialized');
    expect(notif.headers['mcp-session-id']).toBe('sessao-123');
    expect(call.corpo?.method).toBe('tools/call');
    expect(call.headers['mcp-session-id']).toBe('sessao-123');
    expect(call.corpo?.params?.name).toBe('execute_query');
    expect(call.corpo?.params?.arguments).toMatchObject({
      source: 'sqlserver', database: 'PIMSMCPRD', schema: 'dbo', full: true,
      original_question: 'status de plantio por talhão SOJA 26/27',
    });
    expect(String(call.corpo?.params?.arguments?.sql)).toContain("'SOJA 26/27'");
  });

  it('aceita initialize em SSE e safras "auto" (lista do PIMS filtrada pelo ano-safra)', async () => {
    const pedidas: string[] = [];
    const { impl } = fetchFalso((sql) => {
      if (sql.includes('FROM PIMSMCPRD.dbo.PERIODOSAFRA') && !sql.includes('UPNIVEL3')) {
        return {
          status: 'success', columns: ['DE_PER_SAFRA'],
          rows: [['SOJA 25/26'], ['SOJA 26/27'], ['MILHO 2ª SAFRA 26/27'], ['ADM 26/27'], ['CORREÇÃO PREP. SOLO 26/27']],
          row_count: 5, truncated: false,
        };
      }
      const nome = /DE_PER_SAFRA = '([^']+)'/.exec(sql)![1];
      pedidas.push(nome);
      return { status: 'success', columns: COLUNAS, rows: nome === 'SOJA 26/27' ? LINHAS : [], row_count: 0, truncated: false };
    }, { sseInit: true });
    const dados = await sincronizar({
      url: 'u', token: 't', safras: 'auto', excluirPrefixos: ['ADM', 'CORREC'], fetchImpl: impl, agora: new Date(2026, 8, 28),
    });
    expect(pedidas.sort()).toEqual(['MILHO 2ª SAFRA 26/27', 'SOJA 26/27']);
    expect(dados.safras.map((s) => s.nome)).toEqual(['MILHO 2ª SAFRA 26/27', 'SOJA 26/27']);
    expect(dados.safras[1].unidades.map((u) => u.unidade)).toEqual(['GLOBO', 'SIRIEMA']);
  });

  it('lança erro em português quando a consulta falha', async () => {
    const { impl } = fetchFalso(() => ({ status: 'error', message: 'Invalid column name' }));
    await expect(sincronizar({ url: 'u', token: 't', safras: ['SOJA 26/27'], fetchImpl: impl, agora }))
      .rejects.toThrow(/Consulta ao PIMS falhou \(SOJA 26\/27\): Invalid column name/);
  });

  it('lança erro em português quando o Agrovex recusa o token', async () => {
    const { impl } = fetchFalso(() => null, { http: 401 });
    await expect(sincronizar({ url: 'u', token: 't', safras: ['SOJA 26/27'], fetchImpl: impl, agora }))
      .rejects.toThrow(/Agrovex recusou o acesso \(HTTP 401\)/);
  });

  it('recusa resultado truncado', async () => {
    const { impl } = fetchFalso(() => ({ status: 'success', columns: COLUNAS, rows: LINHAS, row_count: 3, truncated: true }));
    await expect(sincronizar({ url: 'u', token: 't', safras: ['SOJA 26/27'], fetchImpl: impl, agora }))
      .rejects.toThrow(/truncado/);
  });
});

describe('mesmosDados / resumo', () => {
  const base = {
    versao: 1 as const, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS via Agrovex',
    safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'SIRIEMA', talhoes: [
      { codigo: '001', codigoPims: '001', setor: 'SIRIEMA', status: 'plantado' as const, areaPrevista: 97, areaPlantada: 97, inicio: null, fim: null, variedade: null },
      { codigo: '007', codigoPims: '007', setor: 'SIRIEMA', status: 'plantando' as const, areaPrevista: 228, areaPlantada: 208, inicio: null, fim: null, variedade: null },
    ] }] }],
  };
  it('ignora geradoEm ao comparar', () => {
    expect(mesmosDados(base, { ...base, geradoEm: '2026-09-28T11:00:00.000Z' })).toBe(true);
    expect(mesmosDados(null, base)).toBe(false);
    const outro = structuredClone(base);
    outro.safras[0].unidades[0].talhoes[1].areaPlantada = 228;
    expect(mesmosDados(base, outro)).toBe(false);
  });
  it('resume por safra/unidade/status', () => {
    expect(resumo(base)).toEqual(['SOJA 26/27', '  SIRIEMA: 2 talhões (plantado 1, plantando 1, a plantar 0)']);
  });
});

// ---------- linhasSupabase / gravarSupabase ----------

const TALHOES_SIRIEMA = [
  { codigo: '001', codigoPims: '001', setor: 'SIRIEMA', status: 'plantado' as const, areaPrevista: 97, areaPlantada: 97, inicio: null, fim: null, variedade: null },
];
const TALHOES_GLOBO = [
  { codigo: '02PIVO', codigoPims: '02PIVO', setor: 'GLEBA DUAS BARRAS', status: 'a_plantar' as const, areaPrevista: 68, areaPlantada: 0, inicio: null, fim: null, variedade: null },
];

const ARQUIVO = {
  versao: 1 as const,
  geradoEm: '2026-09-28T10:00:00.000Z',
  fonte: 'PIMS via Agrovex',
  safras: [
    {
      nome: 'SOJA 26/27',
      unidades: [
        { unidade: 'GLOBO', talhoes: TALHOES_GLOBO },
        { unidade: 'SIRIEMA', talhoes: TALHOES_SIRIEMA },
        { unidade: '(sem unidade)', talhoes: [] },
      ],
    },
    {
      nome: 'MILHO 2ª SAFRA 26/27',
      unidades: [{ unidade: 'SIRIEMA', talhoes: TALHOES_SIRIEMA }],
    },
  ],
};

describe('linhasSupabase', () => {
  it('uma linha por safra × unidade, só unidades com talhões', () => {
    expect(linhasSupabase(ARQUIVO)).toEqual([
      { safra: 'SOJA 26/27', unidade: 'GLOBO', gerado_em: '2026-09-28T10:00:00.000Z', talhoes: TALHOES_GLOBO },
      { safra: 'SOJA 26/27', unidade: 'SIRIEMA', gerado_em: '2026-09-28T10:00:00.000Z', talhoes: TALHOES_SIRIEMA },
      { safra: 'MILHO 2ª SAFRA 26/27', unidade: 'SIRIEMA', gerado_em: '2026-09-28T10:00:00.000Z', talhoes: TALHOES_SIRIEMA },
    ]);
  });

  it('arquivo sem nenhum talhão devolve lista vazia', () => {
    expect(linhasSupabase({ ...ARQUIVO, safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'X', talhoes: [] }] }] })).toEqual([]);
  });
});

interface ChamadaSupabase { url: string; init: { method?: string; headers?: HeadersInit; body?: BodyInit | null } }

function fetchFalsoSupabase(respostas: (Response | (() => Response))[]) {
  const chamadas: ChamadaSupabase[] = [];
  let i = 0;
  const impl: FetchLike = async (url, init) => {
    chamadas.push({ url, init });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i++;
    return typeof r === 'function' ? r() : r;
  };
  return { impl, chamadas };
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.servicerole.assinatura';
const SB_SECRET = 'sb_secret_abcdef123456';

describe('gravarSupabase', () => {
  it('faz upsert e depois limpa as linhas que sumiram do PIMS (chave JWT)', async () => {
    const { impl, chamadas } = fetchFalsoSupabase([
      new Response(null, { status: 200 }),
      new Response(null, { status: 200 }),
    ]);
    await gravarSupabase(ARQUIVO, { url: 'https://proj.supabase.co', chave: JWT, fetch: impl });

    expect(chamadas).toHaveLength(2);
    const [upsert, limpeza] = chamadas;

    expect(upsert.url).toBe('https://proj.supabase.co/rest/v1/mapas_plantio_pims?on_conflict=safra,unidade');
    expect(upsert.init.method).toBe('POST');
    const headersUpsert = Object.fromEntries(new Headers(upsert.init.headers).entries());
    expect(headersUpsert['apikey']).toBe(JWT);
    expect(headersUpsert['authorization']).toBe(`Bearer ${JWT}`);
    expect(headersUpsert['content-type']).toBe('application/json');
    expect(headersUpsert['prefer']).toBe('resolution=merge-duplicates,return=minimal');
    expect(JSON.parse(String(upsert.init.body))).toEqual(linhasSupabase(ARQUIVO));

    expect(limpeza.url).toBe(
      `https://proj.supabase.co/rest/v1/mapas_plantio_pims?gerado_em=lt.${encodeURIComponent('2026-09-28T10:00:00.000Z')}`,
    );
    expect(limpeza.init.method).toBe('DELETE');
    const headersLimpeza = Object.fromEntries(new Headers(limpeza.init.headers).entries());
    expect(headersLimpeza['apikey']).toBe(JWT);
    expect(headersLimpeza['authorization']).toBe(`Bearer ${JWT}`);
  });

  it('chave sb_secret_… manda apikey mas nunca Authorization', async () => {
    const { impl, chamadas } = fetchFalsoSupabase([
      new Response(null, { status: 200 }),
      new Response(null, { status: 204 }),
    ]);
    await gravarSupabase(ARQUIVO, { url: 'https://proj.supabase.co', chave: SB_SECRET, fetch: impl });

    for (const c of chamadas) {
      const h = Object.fromEntries(new Headers(c.init.headers).entries());
      expect(h['apikey']).toBe(SB_SECRET);
      expect(h['authorization']).toBeUndefined();
    }
  });

  it('só chama DELETE depois que o upsert deu certo', async () => {
    const { impl, chamadas } = fetchFalsoSupabase([new Response('erro interno', { status: 500 })]);
    await expect(gravarSupabase(ARQUIVO, { url: 'https://proj.supabase.co', chave: JWT, fetch: impl }))
      .rejects.toThrow(/HTTP 500/);
    expect(chamadas).toHaveLength(1);
  });

  it('erro no upsert traz status e corpo, nunca a chave', async () => {
    const corpoErro = () => new Response(`negado: apikey ${JWT} inválida`, { status: 401 });
    const { impl: implA } = fetchFalsoSupabase([corpoErro]);
    await expect(gravarSupabase(ARQUIVO, { url: 'https://proj.supabase.co', chave: JWT, fetch: implA }))
      .rejects.toThrow(/HTTP 401/);

    const { impl: implB } = fetchFalsoSupabase([corpoErro]);
    try {
      await gravarSupabase(ARQUIVO, { url: 'https://proj.supabase.co', chave: JWT, fetch: implB });
      expect.unreachable();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain(JWT);
      expect(msg).toContain('negado');
    }
  });

  it('erro na limpeza (depois de um upsert ok) também não vaza a chave', async () => {
    const { impl } = fetchFalsoSupabase([
      new Response(null, { status: 200 }),
      new Response(`falha ${JWT}`, { status: 500 }),
    ]);
    try {
      await gravarSupabase(ARQUIVO, { url: 'https://proj.supabase.co', chave: JWT, fetch: impl });
      expect.unreachable();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain(JWT);
      expect(msg).toContain('HTTP 500');
    }
  });

  it('sem nenhum talhão (arquivo vazio), não chama o Supabase (nem upsert nem limpeza)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { impl, chamadas } = fetchFalsoSupabase([new Response(null, { status: 200 })]);
    const vazio = { versao: 1 as const, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS via Agrovex', safras: [] };
    await gravarSupabase(vazio, { url: 'https://proj.supabase.co', chave: JWT, fetch: impl });
    expect(chamadas).toHaveLength(0);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('não retornou nenhum talhão'));
    aviso.mockRestore();
  });

  it('sem nenhum talhão (safras sem unidades ou unidades vazias), também não chama o Supabase', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { impl, chamadas } = fetchFalsoSupabase([new Response(null, { status: 200 })]);
    const semUnidades = {
      versao: 1 as const,
      geradoEm: '2026-09-28T10:00:00.000Z',
      fonte: 'PIMS via Agrovex',
      safras: [
        { nome: 'SOJA 26/27', unidades: [] },
        { nome: 'MILHO 2ª SAFRA 26/27', unidades: [{ unidade: 'SIRIEMA', talhoes: [] }] },
      ],
    };
    await gravarSupabase(semUnidades, { url: 'https://proj.supabase.co', chave: JWT, fetch: impl });
    expect(chamadas).toHaveLength(0);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('não retornou nenhum talhão'));
    expect(aviso.mock.calls.flat().join(' ')).not.toContain(JWT);
    aviso.mockRestore();
  });
});

// ---------- integração com a amostra real (dados-teste, fora do git) ----------

const amostra = resolve('dados-teste/pims_status_soja2627.json');
describe('amostra real SOJA 26/27', () => {
  it.skipIf(!existsSync(amostra))('classificar concorda com o CASE validado no PIMS', () => {
    const d = JSON.parse(readFileSync(amostra, 'utf8')) as { columns: string[]; rows: unknown[][] };
    const i = (c: string) => d.columns.indexOf(c);
    for (const r of d.rows) {
      const status = classificar({
        areaPrevista: r[i('area_prevista')] as number,
        areaPlantada: r[i('area_plantada')] as number,
        plantioEncerrado: r[i('plantio_encerrado')] as string | null,
      });
      expect(status, `${r[0]} ${r[2]}`).toBe(r[i('status')]);
    }
  });
});
