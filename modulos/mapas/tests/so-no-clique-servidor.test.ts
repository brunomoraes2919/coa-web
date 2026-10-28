import { afterEach, describe, expect, it, vi } from 'vitest';
import { atenderPedidosChuvaTalhao, atenderPedidosValidacao, TABELAS_DE_PEDIDOS, unidadesDosPedidosValidacao } from '../scripts/atender-pedidos.mjs';
import {
  filtroUnidades, fotoDeHojeCompleta, gravarValidacaoSupabase, listaPostgrest, montarSqlApontamentosRecentes, montarSqlApontamentosValidacao, montarSqlBoletinsFalha,
  montarSqlBoletinsPendentes, montarSqlColetorValidacao, montarSqlCoordenadoresValidacao, montarSqlDepositosPims, montarSqlDoseValidacao,
  montarSqlEvolucaoValidacao, montarSqlNecessidadeValidacao, montarSqlOrdensValidacao, montarSqlTalhoesValidacao, rotinaDoHorario,
  sincronizarValidacao, unidadesDoPedido,
} from '../scripts/sincronizar-plantio.mjs';

// Só no clique (23/10/2026): o servidor só consulta o Agrovex quando alguém pede, e o Atualizar da Validação
// relê só a unidade da tela. Todos os dados daqui são FICTÍCIOS.
const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const URL_AGROVEX = 'https://agrovex.test/mcp';

afterEach(() => vi.restoreAllMocks());

type Chamada = { url: string; metodo: string; corpo: string };

/** Agrovex falso: responde toda consulta com `linhasDe(sql)` (ou recusa, se `recusa(sql)`); guarda o SQL de cada uma. */
function agrovexFalso(linhasDe: (sql: string) => Record<string, unknown>[], recusa: (sql: string) => boolean = () => false) {
  const sqls: string[] = [];
  const impl = async (_url: string | URL, init: RequestInit) => {
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
    const linhas = linhasDe(sql);
    const colunas = linhas.length ? Object.keys(linhas[0]) : ['unidade'];
    const dados = recusa(sql)
      ? { status: 'error', message: 'sintaxe' }
      : { status: 'success', columns: colunas, rows: linhas.map((l) => colunas.map((c) => l[c] ?? null)) };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ type: 'text', text: JSON.stringify(dados) }] } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  return { impl: impl as unknown as typeof fetch, sqls };
}

const ORDEM = (unidade: string, os: number) => ({
  unidade, os, equipe: 'COORD A', operacao: 10, operacao_de: 'PLANTIO', situacao: 'A', abertura: '2026-10-01', encerramento: null,
  planejado: 10, talhoes: 1, executado: 5, ultimo: '2026-10-03', sem_area: 0,
});
/** As ordens de duas unidades (a consulta de ordens é a que traz "AS sem_area"); o resto, vazio. */
const duasUnidades = (sql: string) => (sql.includes('AS sem_area') ? [ORDEM('FAZENDA A', 1), ORDEM('FAZENDA B', 2)] : []);

describe('rotina automática: só às 6h de Cuiabá (e às 12h se faltou foto do benchmark)', () => {
  it('às 6h o benchmark e as variedades; às 12h o complemento; nas outras horas nada; COA_ROTINA_COMPLETA=1 roda tudo', () => {
    // às 6h, não às 4h: antes das 6h o benchmark não tira a foto do dia (PREV_HORA_FOTO)
    expect(rotinaDoHorario(new Date('2026-10-24T10:17:00Z'), {})).toBe('diaria'); // 6h17 em Cuiabá
    expect(rotinaDoHorario(new Date('2026-10-24T16:17:00Z'), {})).toBe('complemento'); // 12h17
    for (const h of [0, 3, 5, 8, 9, 11, 12, 15, 17, 20, 23]) {
      expect(rotinaDoHorario(new Date(Date.UTC(2026, 9, 24, h, 17)), {}), `UTC ${h}h`).toBe('nada');
    }
    expect(rotinaDoHorario(new Date('2026-10-24T13:17:00Z'), { COA_ROTINA_COMPLETA: '1' })).toBe('completa');
    expect(rotinaDoHorario(new Date('2026-10-24T13:17:00Z'), { COA_ROTINA_COMPLETA: '0' })).toBe('nada');
  });
});

describe('benchmark: o complemento do meio-dia só consulta o Agrovex se faltou foto de hoje', () => {
  const ler = (linhas: Record<string, string>[]) => (async () => new Response(JSON.stringify(linhas), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
  const sb = { url: URL_SB, chave: CHAVE };
  const agora = new Date('2026-10-24T16:17:00Z'); // 24/10, 12h17 em Cuiabá
  const foto = (fonte: string, unidade: string, emitida_em: string) => ({ fonte, unidade, emitida_em });
  it('completa quando cada foto de ontem (fonte × fazenda) já existe hoje', async () => {
    const ontem = [foto('zeus', 'A', '2026-10-23'), foto('metno', 'A', '2026-10-23')];
    expect(await fotoDeHojeCompleta(sb, agora, ler([...ontem, foto('zeus', 'A', '2026-10-24'), foto('metno', 'A', '2026-10-24')]))).toBe(true);
    // a ZEUS de hoje não saiu (carga incompleta às 6h): falta
    expect(await fotoDeHojeCompleta(sb, agora, ler([...ontem, foto('metno', 'A', '2026-10-24')]))).toBe(false);
  });
  it('sem foto ontem: basta ter alguma hoje', async () => {
    expect(await fotoDeHojeCompleta(sb, agora, ler([]))).toBe(false);
    expect(await fotoDeHojeCompleta(sb, agora, ler([foto('zeus', 'A', '2026-10-24')]))).toBe(true);
  });
});

describe('Validação: o Atualizar relê só a unidade da tela', () => {
  it('nomes de unidade aceitos no SQL e no filtro do PostgREST', () => {
    expect(unidadesDoPedido(['FAZENDA DOURADO', 'FAZENDA DOURADO', 'PECUARIA LOCKS - GLOBO'])).toEqual(['FAZENDA DOURADO', 'PECUARIA LOCKS - GLOBO']);
    expect(unidadesDoPedido(['FAZENDA SÃO JOSÉ (MT)'])).toEqual(['FAZENDA SÃO JOSÉ (MT)']);
    expect(unidadesDoPedido(["X'; DROP TABLE y --"])).toBeNull(); // caractere fora da lista: vira todas
    expect(unidadesDoPedido([])).toBeNull();
    expect(unidadesDoPedido(null)).toBeNull();
    expect(filtroUnidades('u.DE_UNI_ADM', ["D'OURO"])).toBe(" AND u.DE_UNI_ADM IN ('D''OURO') AND u.DE_UNI_ADM NOT IN ('BACABA')");
    // sem unidade, só tira as unidades que saíram do grupo (a Bacaba)
    expect(filtroUnidades('u.DE_UNI_ADM', null)).toBe(" AND u.DE_UNI_ADM NOT IN ('BACABA')");
    expect(decodeURIComponent(listaPostgrest(['FAZENDA A', 'B"C', 'D\\E']))).toBe('in.("FAZENDA A","B\\"C","D\\\\E")');
  });

  it('cada consulta da validação ganha o filtro da unidade uma vez, e nenhum sem unidade', () => {
    const u = ['FAZENDA A'];
    const comFiltro = [
      montarSqlOrdensValidacao('2026-08-01', 0, 4000, u), montarSqlTalhoesValidacao('2026-08-01', 0, 4000, u),
      montarSqlApontamentosValidacao('2026-08-01', 0, 4000, u), montarSqlEvolucaoValidacao(0, 4000, u), montarSqlCoordenadoresValidacao('2026-08-01', u),
      montarSqlDepositosPims(u), montarSqlBoletinsPendentes('2026-08-01', 0, 4000, u), montarSqlApontamentosRecentes('2026-10-20', 0, 4000, u),
      montarSqlNecessidadeValidacao('2026-08-01', 0, 4000, u), montarSqlDoseValidacao('2026-10-01', 0, 4000, u),
    ];
    for (const sql of comFiltro) expect(sql).toContain("u.DE_UNI_ADM IN ('FAZENDA A')");
    expect(montarSqlBoletinsFalha('2026-08-01', 0, 4000, u)).toContain("COALESCE(ui.DE_UNI_ADM, up.DE_UNI_ADM, ut.DE_UNI_ADM, uc.DE_UNI_ADM, ul.DE_UNI_ADM) IN ('FAZENDA A')");
    // o coletor e os pendentes juntam várias tabelas: o filtro vai em cada parte
    expect(montarSqlColetorValidacao('2026-08-01', 0, 4000, u).match(/u\.DE_UNI_ADM IN \('FAZENDA A'\)/g)!.length).toBeGreaterThan(1);
    expect(montarSqlBoletinsPendentes('2026-08-01', 0, 4000, u).match(/u\.DE_UNI_ADM IN \('FAZENDA A'\)/g)).toHaveLength(3);
    const semFiltro = [
      montarSqlOrdensValidacao('2026-08-01', 0, 4000), montarSqlEvolucaoValidacao(0, 4000), montarSqlCoordenadoresValidacao('2026-08-01'),
      montarSqlDepositosPims(), montarSqlBoletinsFalha('2026-08-01', 0, 4000), montarSqlApontamentosRecentes('2026-10-20', 0, 4000),
      montarSqlColetorValidacao('2026-08-01', 0, 4000),
    ];
    for (const sql of semFiltro) expect(sql).not.toMatch(/DE_UNI_ADM\) IN \(|DE_UNI_ADM IN \(/);
    // sem unidade, os apontamentos recentes só tiram a Bacaba
    expect(montarSqlApontamentosRecentes('2026-10-20', 0, 4000)).toContain("WHERE 1 = 1 AND u.DE_UNI_ADM NOT IN ('BACABA')");
  });

  it('com unidade, as consultas vão filtradas e só a linha dela volta', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, sqls } = agrovexFalso(duasUnidades);
    const dados = await sincronizarValidacao({ url: URL_AGROVEX, token: 'tk', unidades: ['FAZENDA A'], fetchImpl: impl, agora: new Date(2026, 9, 23, 12) });
    expect(dados.linhas.map((l: { unidade: string }) => l.unidade)).toEqual(['FAZENDA A']);
    expect(dados.unidades).toEqual(['FAZENDA A']);
    const pims = sqls.filter((s) => s.includes('PIMSMCPRD'));
    expect(pims.length).toBeGreaterThan(5);
    expect(pims.every((s) => /DE_UNI_ADM\)? IN \('FAZENDA A'\)/.test(s))).toBe(true);
  });

  it('se a fonte recusa o SQL novo, vale o de antes (todas as unidades) filtrado aqui: a Validação não para', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, sqls } = agrovexFalso(duasUnidades, (sql) => sql.includes("IN ('FAZENDA A')"));
    const dados = await sincronizarValidacao({ url: URL_AGROVEX, token: 'tk', unidades: ['FAZENDA A'], fetchImpl: impl, agora: new Date(2026, 9, 23, 12) });
    expect(dados.linhas.map((l: { unidade: string }) => l.unidade)).toEqual(['FAZENDA A']);
    expect(aviso.mock.calls.some((c) => /consulta nova foi recusada \(ordens de serviço\)/.test(String(c[0])))).toBe(true);
    // a de antes foi sem filtro e com as somas de sempre
    expect(sqls.some((s) => s.includes('AS sem_area') && !s.includes('DE_UNI_ADM IN') && !s.includes('WHERE ID_APORDSERVICO IN'))).toBe(true);
  });

  it('gravar uma unidade não apaga as outras', async () => {
    const chamadas: Chamada[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      chamadas.push({ url: String(url), metodo: init.method ?? 'GET', corpo: String(init.body ?? '') });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    // só os campos que a gravação olha (unidade); o resto da linha não importa aqui
    const linha = { unidade: 'FAZENDA A', gerado_em: '2026-10-23T16:00:00.000Z', ordens: [] } as unknown as Parameters<typeof gravarValidacaoSupabase>[0]['linhas'][number];
    expect(await gravarValidacaoSupabase({ geradoEm: '2026-10-23T16:00:00.000Z', linhas: [linha], unidades: ['FAZENDA A'] }, { url: URL_SB, chave: CHAVE, fetch: impl })).toBe('ok');
    const apaga = chamadas.find((c) => c.metodo === 'DELETE')!;
    expect(decodeURIComponent(apaga.url)).toContain('valid_pims?unidade=in.("FAZENDA A")&gerado_em=lt.');
    // sem nada do PIMS para a unidade pedida: só a linha velha dela sai
    chamadas.length = 0;
    expect(await gravarValidacaoSupabase({ geradoEm: '2026-10-23T16:00:00.000Z', linhas: [], unidades: ['FAZENDA A'] }, { url: URL_SB, chave: CHAVE, fetch: impl })).toBe('vazio');
    expect(chamadas.map((c) => c.metodo)).toEqual(['DELETE']);
    expect(decodeURIComponent(chamadas[0].url)).toContain('unidade=in.("FAZENDA A")');
    // a rodada de todas as unidades continua limpando tudo o que é velho
    chamadas.length = 0;
    await gravarValidacaoSupabase({ geradoEm: '2026-10-23T16:00:00.000Z', linhas: [linha] }, { url: URL_SB, chave: CHAVE, fetch: impl });
    expect(chamadas.find((c) => c.metodo === 'DELETE')!.url).not.toContain('unidade=');
  });

  it('os pedidos pendentes: só unidades já conhecidas; uma vazia ou desconhecida vira todas', () => {
    const conhecidas = new Set(['FAZENDA A', 'FAZENDA B']);
    expect(unidadesDosPedidosValidacao([{ unidade: 'FAZENDA B' }, { unidade: 'FAZENDA A' }, { unidade: 'FAZENDA B' }], conhecidas)).toEqual(['FAZENDA A', 'FAZENDA B']);
    expect(unidadesDosPedidosValidacao([{ unidade: 'FAZENDA A' }, { unidade: null }], conhecidas)).toBeNull();
    expect(unidadesDosPedidosValidacao([{ unidade: 'FAZENDA NOVA' }], conhecidas)).toBeNull();
  });

  it('o pedido de uma unidade relê só ela e marca o pedido', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const chamadas: Chamada[] = [];
    const agrovex = agrovexFalso(duasUnidades);
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const u = String(url);
      if (u.startsWith(URL_AGROVEX)) return agrovex.impl(url, init);
      chamadas.push({ url: u, metodo: init.method ?? 'GET', corpo: String(init.body ?? '') });
      const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (u.includes('/valid_pedidos?select=')) return json([{ id: 7, unidade: 'FAZENDA A' }]);
      if (u.includes('/valid_pims?select=unidade')) return json([{ unidade: 'FAZENDA A' }, { unidade: 'FAZENDA B' }]);
      if (u.includes('/valid_vinculos')) return json([]);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await atenderPedidosValidacao({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: URL_AGROVEX, token: 'tk' }, fetch: impl })).toBe(true);
    expect(agrovex.sqls.filter((s) => s.includes('PIMSMCPRD')).every((s) => /IN \('FAZENDA A'\)/.test(s))).toBe(true);
    const gravou = chamadas.find((c) => c.metodo === 'POST' && c.url.includes('/valid_pims?'))!;
    expect(JSON.parse(gravou.corpo).map((l: { unidade: string }) => l.unidade)).toEqual(['FAZENDA A']);
    const marcou = chamadas.find((c) => c.metodo === 'PATCH' && c.url.includes('/valid_pedidos?'))!;
    expect(JSON.parse(marcou.corpo).resultado).toBe('ok');
  });
});

describe('Chuva por talhão: só pelo botão Atualizar', () => {
  it('a fila nova entra na conferência de "algum pedido pendente"', () => {
    expect(TABELAS_DE_PEDIDOS).toContain('chuva_talhao_pedidos');
  });

  it('sem a tabela (script 0034) ou sem pedido, não consulta nada', async () => {
    const chamadas: string[] = [];
    const responder = (corpo: unknown, status = 200) => (async (url: string | URL) => {
      chamadas.push(String(url));
      return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const base = { supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.invalid/mcp', token: 'tk' } };
    expect(await atenderPedidosChuvaTalhao({ ...base, fetch: responder([]) })).toBe(false);
    expect(await atenderPedidosChuvaTalhao({ ...base, fetch: responder({ code: 'PGRST205', message: 'tabela não existe' }, 404) })).toBe(false);
    expect(chamadas).toHaveLength(2);
    expect(chamadas.every((u) => u.startsWith(`${URL_SB}/rest/v1/chuva_talhao_pedidos?`))).toBe(true);
  });

  it('com pedido, relê sempre (sem esperar 30 min) e marca o pedido mesmo se a ZEUS falhar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chamadas: Chamada[] = [];
    const agora = () => new Date('2026-10-23T16:03:00Z'); // minuto 3: fora do passo de 5 min, que não vale sob demanda
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const u = String(url);
      chamadas.push({ url: u, metodo: init.method ?? 'GET', corpo: String(init.body ?? '') });
      if (u.startsWith('https://agrovex.invalid')) throw new TypeError('fetch failed');
      const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (u.includes('/chuva_talhao_pedidos?select=')) return json([{ id: 3 }, { id: 4 }]);
      // a última gravação é de 2 min atrás: antes, isso era "recente" e não relia
      if (u.includes('/chuva_talhao?select=gerado_em')) return json([{ gerado_em: '2026-10-23T16:01:00Z' }]);
      if (u.includes('select=gerado_em') || u.includes('select=conferido_em')) return json([]);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await atenderPedidosChuvaTalhao({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.invalid/mcp', token: 'tk' }, fetch: impl, agora })).toBe(true);
    // tentou a ZEUS (a chuva por talhão, os limites e a situação), mesmo com a gravação recente e fora do passo
    expect(chamadas.filter((c) => c.url.startsWith('https://agrovex.invalid')).length).toBeGreaterThanOrEqual(1);
    const marcou = chamadas.find((c) => c.metodo === 'PATCH' && c.url.includes('/chuva_talhao_pedidos?'))!;
    expect(marcou.url).toContain('atendido_em=is.null&id=lte.4');
    expect(JSON.parse(marcou.corpo).resultado).toMatch(/^erro: /);
  });
});
