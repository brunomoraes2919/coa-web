// Paginação das consultas do servidor (scripts/sincronizar-plantio.mjs). O Agrovex corta toda consulta em
// 5.000 linhas e a rotina trata o corte como falha: as consultas que podem crescer são lidas em páginas.
// O Agrovex falso daqui se comporta como o de verdade: sem paginação, devolve no máximo 5.000 linhas e avisa
// que cortou; com paginação, devolve a fatia pedida. Cada fonte só entende a própria forma de paginar.
// Todos os dados são FICTÍCIOS.
import { describe, expect, it, vi } from 'vitest';
import {
  montarSql,
  montarSqlAcompanhamento,
  montarSqlBoletinsFalha,
  montarSqlBoletinsPendentes,
  montarSqlChuva,
  montarSqlChuvaTalhoes,
  montarSqlColetorValidacao,
  montarSqlDoseValidacao,
  montarSqlEstoqueSap,
  montarSqlEvolucaoValidacao,
  montarSqlHistorico,
  montarSqlLogIntegracaoSap,
  montarSqlNecessidadeValidacao,
  montarSqlSaldoItensSap,
  montarSqlTalhoesComChuva,
  montarSqlVinculosZeus,
  PAGINA_CONSULTA,
  PAGINAS_MAX,
  sincronizar,
  sincronizarAcompanhamento,
  sincronizarChuvaTalhao,
  sincronizarLimitesZeus,
  sincronizarValidacao,
  SQL_EVOLUCAO_VALIDACAO,
  SQL_VINCULOS_ZEUS,
  type FetchLike,
} from '../scripts/sincronizar-plantio.mjs';

/** o Agrovex corta o resultado aqui */
const CORTE = 5000;

interface Tabela { columns: string[]; rows: unknown[][] }
interface Feita { sql: string; source: string; pular: number | null; tamanho: number | null }

const resposta = (id: number, dados: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(dados) }] } }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

/**
 * Agrovex falso. `tabelaDe` devolve o resultado INTEIRO da consulta (já na ordem do ORDER BY); o falso corta
 * em 5.000 linhas quando a consulta não pagina, e devolve a página quando pagina.
 */
function agrovexQuePagina(tabelaDe: (sql: string, source: string) => Tabela, recusa: (feita: Feita) => string | null = () => null) {
  const feitas: Feita[] = [];
  const impl: FetchLike = async (_url, init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 200 });
    const corpo = JSON.parse(String(init.body));
    if (corpo.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), {
        status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' },
      });
    }
    if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const { sql, source } = corpo.params.arguments as { sql: string; source: string };
    // SQL Server (PIMS): OFFSET n ROWS FETCH NEXT m ROWS ONLY. PostgreSQL (ZEUS) e Athena: OFFSET n LIMIT m.
    // HANA (SAP): LIMIT m OFFSET n.
    const sqlServer = /\nOFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY$/.exec(sql);
    const offsetLimit = /\nOFFSET (\d+) LIMIT (\d+)$/.exec(sql);
    const limitOffset = /\nLIMIT (\d+) OFFSET (\d+)$/.exec(sql);
    const pagina = sqlServer ?? offsetLimit ?? limitOffset;
    const pular = sqlServer ? Number(sqlServer[1]) : offsetLimit ? Number(offsetLimit[1]) : limitOffset ? Number(limitOffset[2]) : null;
    const tamanho = sqlServer ? Number(sqlServer[2]) : offsetLimit ? Number(offsetLimit[2]) : limitOffset ? Number(limitOffset[1]) : null;
    feitas.push({ sql, source, pular, tamanho });
    // a fonte recusa a consulta (o teste escolhe qual): responde, mas com erro
    const motivo = recusa({ sql, source, pular, tamanho });
    if (motivo) return resposta(corpo.id, { status: 'error', message: motivo });
    const dialetoCerto = (sqlServer && source === 'sqlserver') || (offsetLimit && (source === 'zeus' || source === 'athena')) || (limitOffset && source === 'hana');
    if (pagina && !dialetoCerto) return resposta(corpo.id, { status: 'error', message: `sintaxe de paginação errada para a fonte ${source}` });
    // paginar sem ORDER BY é erro no SQL Server (e não tem ordem definida nos outros)
    if (pagina && !/\nORDER BY [^\n]+\n(?:OFFSET|LIMIT) \d+ [^\n]+$/.test(sql)) return resposta(corpo.id, { status: 'error', message: 'paginação sem ORDER BY' });
    const t = tabelaDe(sql, source);
    if (pular === null || tamanho === null) {
      return resposta(corpo.id, { status: 'success', columns: t.columns, rows: t.rows.slice(0, CORTE), row_count: Math.min(t.rows.length, CORTE), truncated: t.rows.length > CORTE });
    }
    const rows = t.rows.slice(pular, pular + Math.min(tamanho, CORTE));
    return resposta(corpo.id, { status: 'success', columns: t.columns, rows, row_count: rows.length, truncated: tamanho > CORTE && t.rows.length - pular > CORTE });
  };
  return { impl, feitas };
}

const VAZIA: Tabela = { columns: [], rows: [] };
const serie = <T,>(n: number, linha: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => linha(i));
const semRepeticao = (valores: unknown[]) => new Set(valores).size === valores.length;
/** as páginas pedidas de uma consulta, na ordem */
const paginasDe = (feitas: Feita[], marca: string) => feitas.filter((f) => f.sql.includes(marca)).map((f) => f.pular);

describe('paginação: o SQL de cada consulta', () => {
  const acomp = montarSqlAcompanhamento(['SOJA 26/27'], 4000, 4000);
  const FIM_PIMS = '\nOFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY';

  it('a página do PIMS vem depois de um ORDER BY sem empates', () => {
    // plantio por safra: a ordem de antes (unidade, código) e, para desempatar, a chave do talhão
    expect(montarSql('SOJA 26/27', 4000, 4000)).toMatch(/\nORDER BY unidade, codigo, up\.ID_UPNIVEL3, up\.ID_PERIODOSAFRA\nOFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY$/);
    // acompanhamento: talhões pela chave do talhão; plantio pela chave do boletim
    expect(acomp.talhoes.endsWith(`\nORDER BY up.ID_UPNIVEL3, up.ID_PERIODOSAFRA${FIM_PIMS}`)).toBe(true);
    expect(acomp.plantio.endsWith(`\nORDER BY a.ID_APPLANTIO, a.ID_UNIDADEADM${FIM_PIMS}`)).toBe(true);
    // colheita: tudo o que define a linha devolvida (ordem, unidade, boletim, talhão, dia, área, lançamento)
    expect(acomp.colheita.endsWith(`\nORDER BY a.ID_APORDSERVICO, a.ID_UNIDADEADM, a.NO_BOLETIM, a.ID_UPNIVEL3, a.DT_OPERACAO, a.QT_AREA_EXEC, a.LAST_UPDATE${FIM_PIMS}`)).toBe(true);
    // consultas agrupadas: pelas colunas do GROUP BY (e a operação, que distingue as duas metades do UNION)
    expect(montarSqlHistorico(['SOJA 25/26'], 4000, 4000).endsWith(`\nORDER BY 1, 2, 3, 4${FIM_PIMS}`)).toBe(true);
    expect(montarSqlEvolucaoValidacao(4000, 4000).endsWith(`\nORDER BY 1, 2, 3${FIM_PIMS}`)).toBe(true);
    // dose: a ordem de antes e a chave do item do boletim
    expect(montarSqlDoseValidacao('2026-09-26', 4000, 4000).endsWith(`\nORDER BY 1, a.DT_OPERACAO DESC, a.NO_BOLETIM, 8, l.ID_APAPLINS_INSLC${FIM_PIMS}`)).toBe(true);
    // sem chave conhecida: a ordem de antes e, para desempatar, as demais colunas devolvidas
    expect(montarSqlBoletinsFalha('2026-08-01', 4000, 4000).endsWith(`\nORDER BY 1, 3, 5, 2, 4, 6, 7, 8, 9, 10, 11, 12${FIM_PIMS}`)).toBe(true);
    expect(montarSqlBoletinsPendentes('2026-08-01', 4000, 4000).endsWith(`\nORDER BY 1, 4, 3, 2, 5, 6, 7, 8, 9, 10, 11, 12${FIM_PIMS}`)).toBe(true);
    expect(montarSqlNecessidadeValidacao('2026-08-01', 4000, 4000).endsWith(`\nORDER BY 1, 2, 7, 3, 4, 5, 6, 8, 9${FIM_PIMS}`)).toBe(true);
    // coletor: todas menos a 9 (a mensagem do PIMS, texto livre)
    expect(montarSqlColetorValidacao('2026-08-01', 4000, 4000).endsWith(`\nORDER BY 1, 4 DESC, 3, 2, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19${FIM_PIMS}`)).toBe(true);
  });

  it('a mesma coluna nunca aparece duas vezes no ORDER BY (o SQL Server recusa)', () => {
    const consultas = [
      montarSql('SOJA 26/27', 0), acomp.talhoes, acomp.plantio, acomp.colheita, montarSqlHistorico(['SOJA 25/26'], 0), montarSqlEvolucaoValidacao(0),
      montarSqlBoletinsFalha('2026-08-01', 0), montarSqlBoletinsPendentes('2026-08-01', 0), montarSqlNecessidadeValidacao('2026-08-01', 0),
      montarSqlDoseValidacao('2026-09-26', 0), montarSqlColetorValidacao('2026-08-01', 0),
    ];
    for (const sql of consultas) {
      const ordem = /\nORDER BY ([^\n]+)\nOFFSET /.exec(sql)?.[1] ?? '';
      const itens = ordem.split(',').map((x) => x.trim().replace(/ DESC$/, ''));
      expect(itens.length, sql.slice(-200)).toBeGreaterThan(0);
      expect(semRepeticao(itens), ordem).toBe(true);
    }
  });

  it('a chuva da ZEUS (PostgreSQL) pagina com OFFSET … LIMIT, pelas colunas do GROUP BY', () => {
    const sql = montarSqlChuva('2023-08-01', 4000, 4000);
    expect(sql).toContain('GROUP BY pa.farm, p.dia');
    expect(sql.endsWith('\nORDER BY 1, 2\nOFFSET 4000 LIMIT 4000')).toBe(true);
    expect(sql).not.toContain('FETCH NEXT');
  });

  it('as consultas da chuva por talhão na ZEUS: pelas colunas do GROUP BY ou do DISTINCT (todas as devolvidas)', () => {
    const FIM_ZEUS = '\nOFFSET 4000 LIMIT 4000';
    const talhoes = montarSqlChuvaTalhoes('2024-09-01', 4000, 4000);
    expect(talhoes).toContain('GROUP BY unidade, fieldname');
    expect(talhoes.endsWith(`\nORDER BY unidade, fieldname${FIM_ZEUS}`)).toBe(true);
    const comChuva = montarSqlTalhoesComChuva('2024-09-01', 4000, 4000);
    expect(comChuva).toContain('SELECT DISTINCT unidade, fieldname');
    expect(comChuva.endsWith(`\nORDER BY 1, 2${FIM_ZEUS}`)).toBe(true);
    const vinculos = montarSqlVinculosZeus(4000, 4000);
    expect(vinculos).toContain('SELECT DISTINCT farm, talhao, picid, picname, lat, lon');
    expect(vinculos.endsWith(`\nORDER BY 1, 2, 3, 4, 5, 6${FIM_ZEUS}`)).toBe(true);
    // sem página, o texto de antes
    expect(montarSqlChuvaTalhoes('2024-09-01').endsWith('GROUP BY unidade, fieldname\nORDER BY unidade, fieldname')).toBe(true);
    expect(montarSqlTalhoesComChuva('2024-09-01').endsWith("coalesce(fieldname, '') <> ''")).toBe(true);
    expect(montarSqlVinculosZeus()).toBe(SQL_VINCULOS_ZEUS);
    expect(SQL_VINCULOS_ZEUS.endsWith('WHERE picid IS NOT NULL')).toBe(true);
  });

  it('as consultas do SAP (HANA) paginam com LIMIT … OFFSET, pela chave do saldo (depósito + item)', () => {
    const FIM_SAP = '\nLIMIT 4000 OFFSET 8000';
    // saldo dos depósitos: a ordem de antes (depósito, nome) e o código do item, que desempata
    expect(montarSqlEstoqueSap(['1001'], 8000, 4000).endsWith(`\nORDER BY 1, 3, 2${FIM_SAP}`)).toBe(true);
    // cadastro e saldo dos itens dos boletins: item + depósito
    expect(montarSqlSaldoItensSap(['000040'], ['1718'], 8000, 4000).endsWith(`\nORDER BY 1, 5${FIM_SAP}`)).toBe(true);
    // log da integração: uma linha por item de boletim
    expect(montarSqlLogIntegracaoSap(['8853'], '2026-08-01', 8000, 4000).endsWith(`\nORDER BY 1${FIM_SAP}`)).toBe(true);
    // sem página, o texto de antes
    expect(montarSqlEstoqueSap(['1001']).endsWith('AND t."OnHand" <> 0\nORDER BY 1, 3')).toBe(true);
    expect(montarSqlSaldoItensSap(['000040'], ['1718']).endsWith(`WHERE i."ItemCode" IN ('000040')`)).toBe(true);
    expect(montarSqlLogIntegracaoSap(['8853'], '2026-08-01').endsWith('GROUP BY "U_ID_BOLETIM_DE") t ON t.codigo = l."Code"')).toBe(true);
  });

  it('sem pedir página, a consulta sai inteira como sempre foi (quem não pagina não perde linha em silêncio)', () => {
    const a = montarSqlAcompanhamento(['SOJA 26/27']);
    const inteiras = [
      montarSql('SOJA 26/27'), a.talhoes, a.plantio, a.colheita, montarSqlHistorico(['SOJA 25/26']), montarSqlChuva('2023-08-01'),
      SQL_EVOLUCAO_VALIDACAO, montarSqlEvolucaoValidacao(), montarSqlBoletinsFalha('2026-08-01'), montarSqlBoletinsPendentes('2026-08-01'),
      montarSqlNecessidadeValidacao('2026-08-01'), montarSqlDoseValidacao('2026-09-26'), montarSqlColetorValidacao('2026-08-01'),
    ];
    for (const sql of inteiras) expect(sql, sql.slice(-120)).not.toMatch(/OFFSET|FETCH NEXT|LIMIT/);
    // o texto é o de antes da paginação: o ORDER BY que cada consulta já tinha, sem as colunas de desempate…
    expect(montarSql('SOJA 26/27').endsWith("WHERE ps.DE_PER_SAFRA = 'SOJA 26/27'\nORDER BY unidade, codigo")).toBe(true);
    expect(montarSqlChuva('2023-08-01').endsWith('HAVING avg(p.mm) >= 0.2\nORDER BY 1, 2')).toBe(true);
    expect(SQL_EVOLUCAO_VALIDACAO.endsWith('CONVERT(varchar(10), x.dia, 23)\nORDER BY 1, 2, 3')).toBe(true);
    expect(montarSqlEvolucaoValidacao()).toBe(SQL_EVOLUCAO_VALIDACAO);
    expect(montarSqlBoletinsFalha('2026-08-01').endsWith("e.FG_STATUS <> '12'\nORDER BY 1, 3, 5")).toBe(true);
    expect(montarSqlBoletinsPendentes('2026-08-01').endsWith("a.FG_INTEGRAR = 'S'\nORDER BY 1, 4, 3")).toBe(true);
    expect(montarSqlNecessidadeValidacao('2026-08-01').endsWith("os.DT_ABERTURA >= '2026-08-01'\nORDER BY 1, 2, 7")).toBe(true);
    expect(montarSqlDoseValidacao('2026-09-26').endsWith('> 0.1\nORDER BY 1, a.DT_OPERACAO DESC, a.NO_BOLETIM, 8')).toBe(true);
    expect(montarSqlColetorValidacao('2026-08-01').endsWith("WHERE t.DT_OPERACAO >= '2026-08-01'\nORDER BY 1, 4 DESC, 3")).toBe(true);
    // …e as que não tinham ORDER BY continuam sem
    expect(a.talhoes.endsWith("IN ('SOJA 26/27') AND up.QT_AREA_PROD > 0.1")).toBe(true);
    expect(a.plantio.endsWith("WHERE os.FG_SITUACAO IN ('A','F') AND ps.DE_PER_SAFRA IN ('SOJA 26/27')")).toBe(true);
    expect(a.colheita.endsWith("o.CD_OPERACAO IN (16, 114) AND ps.DE_PER_SAFRA IN ('SOJA 26/27')")).toBe(true);
    expect(montarSqlHistorico(['SOJA 25/26']).endsWith('GROUP BY u.DE_UNI_ADM, ps.DE_PER_SAFRA, CONVERT(varchar(10), a.DT_OPERACAO, 120)')).toBe(true);
  });

  it('a página tem menos linhas que o corte do Agrovex', () => {
    expect(PAGINA_CONSULTA).toBe(4000);
    expect(PAGINA_CONSULTA).toBeLessThan(CORTE);
    expect(PAGINAS_MAX).toBeGreaterThanOrEqual(10);
  });
});

// ---------- plantio por safra ----------

const COL_PLANTIO = ['unidade', 'setor', 'codigo', 'safra', 'area_prevista', 'area_plantada', 'plantio_inicio', 'plantio_fim', 'plantio_encerrado', 'variedade'];
const plantioCom = (n: number): Tabela => ({ columns: COL_PLANTIO, rows: serie(n, (i) => ['GLOBO', 'SETOR', `T${i}`, 'SOJA 26/27', 10, 0, null, null, null, null]) });
const opcoesPlantio = (impl: FetchLike) => ({ url: 'https://agrovex.test/mcp', token: 'tk', safras: ['SOJA 26/27'], fetchImpl: impl, agora: new Date('2026-09-28T10:00:00Z') });

describe('paginação: plantio por safra (sincronizar)', () => {
  it('mais de uma página: o resultado é a união das páginas, sem repetir nem pular talhão', async () => {
    const { impl, feitas } = agrovexQuePagina(() => plantioCom(9001));
    const dados = await sincronizar(opcoesPlantio(impl));
    const talhoes = dados.safras[0].unidades[0].talhoes;
    expect(talhoes).toHaveLength(9001);
    expect(new Set(talhoes.map((t) => t.codigoPims))).toEqual(new Set(serie(9001, (i) => `T${i}`)));
    expect(feitas.map((f) => f.pular)).toEqual([0, 4000, 8000]);
    expect(feitas.every((f) => f.tamanho === PAGINA_CONSULTA && f.source === 'sqlserver')).toBe(true);
  });

  it('total múltiplo exato da página: lê uma página vazia no fim e não perde nada', async () => {
    const { impl, feitas } = agrovexQuePagina(() => plantioCom(8000));
    const dados = await sincronizar(opcoesPlantio(impl));
    expect(dados.safras[0].unidades[0].talhoes).toHaveLength(8000);
    expect(feitas.map((f) => f.pular)).toEqual([0, 4000, 8000]);
  });

  it('menos de uma página: uma consulta só, com o mesmo resultado de antes', async () => {
    const { impl, feitas } = agrovexQuePagina(() => plantioCom(3));
    const dados = await sincronizar(opcoesPlantio(impl));
    expect(dados.safras[0].unidades[0].talhoes.map((t) => t.codigoPims)).toEqual(['T0', 'T1', 'T2']);
    expect(feitas.map((f) => f.pular)).toEqual([0]);
  });

  it('teto de páginas: uma fonte que nunca termina não prende a rotina', async () => {
    let consultas = 0;
    const cheia = plantioCom(PAGINA_CONSULTA);
    const impl: FetchLike = async (_url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 200 });
      const corpo = JSON.parse(String(init.body));
      if (corpo.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
      if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
      consultas++;
      // devolve sempre uma página cheia, qualquer que seja o OFFSET
      return resposta(corpo.id, { status: 'success', ...cheia, row_count: PAGINA_CONSULTA, truncated: false });
    };
    const erro = await sincronizar(opcoesPlantio(impl)).catch((e: Error & { tipo?: string }) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(new RegExp(`Consulta ao PIMS falhou \\(SOJA 26/27\\): mais de ${PAGINAS_MAX} páginas`));
    expect((erro as Error & { tipo?: string }).tipo).toBe('fonte');
    expect(consultas).toBe(PAGINAS_MAX);
  });
});

// ---------- reserva: a fonte recusou a consulta em páginas ----------
// O ORDER BY novo e a cláusula da página não puderam ser conferidos em cada fonte de verdade antes de publicar.
// Se a fonte recusar a primeira página, a rotina roda a consulta inteira de sempre e avisa no log.

describe('paginação: reserva quando a fonte recusa a consulta em páginas', () => {
  const TOKEN = ['token', 'inventado', 'do', 'teste'].join('-');
  const opcoes = (impl: FetchLike) => ({ ...opcoesPlantio(impl), token: TOKEN });

  it('recusou a primeira página: roda a consulta inteira (o SQL de antes), avisa no log e o resultado é o de sempre', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, feitas } = agrovexQuePagina(() => plantioCom(3), (f) => (f.pular !== null ? `Invalid column name 'ID_PERIODOSAFRA' (${TOKEN})` : null));
    const dados = await sincronizar(opcoes(impl));
    expect(dados.safras[0].unidades[0].talhoes.map((t) => t.codigoPims)).toEqual(['T0', 'T1', 'T2']);
    expect(feitas.map((f) => f.pular)).toEqual([0, null]);
    expect(feitas[1].sql).toBe(montarSql('SOJA 26/27'));
    const texto = aviso.mock.calls.flat().join(' ');
    aviso.mockRestore();
    expect(texto).toContain('Consulta ao PIMS em páginas foi recusada (SOJA 26/27); usando a consulta inteira, sem paginação.');
    expect(texto).toContain("Motivo: Consulta ao PIMS falhou (SOJA 26/27): Invalid column name 'ID_PERIODOSAFRA'");
    expect(texto).not.toContain(TOKEN);
  });

  it('a consulta inteira também falha (mais de 5.000 linhas): o erro é o de antes, resultado truncado', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, feitas } = agrovexQuePagina(() => plantioCom(6000), (f) => (f.pular !== null ? 'sintaxe recusada' : null));
    await expect(sincronizar(opcoes(impl))).rejects.toThrow(/Consulta ao PIMS falhou \(SOJA 26\/27\): resultado truncado \(5000 linhas\)/);
    aviso.mockRestore();
    expect(feitas.map((f) => f.pular)).toEqual([0, null]);
  });

  it('recusa numa página seguinte não tem reserva: metade do resultado não serve', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, feitas } = agrovexQuePagina(() => plantioCom(9001), (f) => (f.pular === 4000 ? 'falhou no meio' : null));
    await expect(sincronizar(opcoes(impl))).rejects.toThrow(/Consulta ao PIMS falhou \(SOJA 26\/27\): falhou no meio/);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
    expect(feitas.map((f) => f.pular)).toEqual([0, 4000]);
  });

  it('prazo estourado ou rede fora do ar não é recusa: nada de consultar duas vezes', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let consultas = 0;
    const impl: FetchLike = async (_url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 200 });
      const corpo = JSON.parse(String(init.body));
      if (corpo.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
      if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
      consultas++;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    await expect(sincronizar(opcoes(impl))).rejects.toThrow(/timeout/);
    expect(consultas).toBe(1);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('resultado cortado numa página não é recusa (não acontece com páginas de 4.000, mas não vira consulta inteira)', async () => {
    let consultas = 0;
    const impl: FetchLike = async (_url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 200 });
      const corpo = JSON.parse(String(init.body));
      if (corpo.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
      if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
      consultas++;
      return resposta(corpo.id, { status: 'success', ...plantioCom(3), row_count: 3, truncated: true });
    };
    await expect(sincronizar(opcoes(impl))).rejects.toThrow(/resultado truncado/);
    expect(consultas).toBe(1);
  });
});

// ---------- acompanhamento ----------

describe('paginação: as consultas do Acompanhamento (sincronizarAcompanhamento)', () => {
  const N = { talhoes: 4500, plantio: 9500, colheita: 4100, hist: 4200, chuva: 4300 };
  const TABELAS = {
    safras: { columns: ['DE_PER_SAFRA'], rows: [['SOJA 26/27'], ['SOJA 25/26']] },
    talhoes: {
      columns: ['unidade', 'setor', 'safra', 'id', 'codigo', 'area', 'dano', 'variedade', 'encerrado'],
      rows: serie(N.talhoes, (i) => ['SM3', 'SETOR', 'SOJA 26/27', String(i), `T${i}`, 10, 0, null, null]),
    },
    plantio: {
      columns: ['unidade', 'safra', 'id', 'codigo', 'data', 'area', 'equipe', 'cd_operacao', 'replantio'],
      rows: serie(N.plantio, (i) => ['SM3', 'SOJA 26/27', String(i % N.talhoes), `T${i % N.talhoes}`, '2026-09-24', i + 1, 'EQUIPE UM', 17, 'N']),
    },
    colheita: {
      columns: ['unidade', 'safra', 'id', 'codigo', 'data', 'area', 'equipe', 'cd_operacao'],
      rows: serie(N.colheita, (i) => ['SM3', 'SOJA 26/27', String(i), `T${i}`, '2027-02-01', i + 1, 'EQUIPE DOIS', 16]),
    },
    hist: { columns: ['unidade', 'safra', 'op', 'data', 'area'], rows: serie(N.hist, (i) => ['SM3', 'SOJA 25/26', 'PLANTIO', '2025-09-24', i + 1]) },
    chuva: { columns: ['fazenda', 'data', 'mm'], rows: serie(N.chuva, (i) => ['Faz_SM3', '2025-10-02', i + 1]) },
  };
  const tabelaDe = (sql: string): Tabela =>
    sql.includes('stg_climatemonitoring2') ? TABELAS.chuva
      : sql.includes('UNION ALL') ? TABELAS.hist
      : sql.includes('APPLANTIO') ? TABELAS.plantio
      : sql.includes('APATIVPROD') ? TABELAS.colheita
      : sql.includes('JOIN') ? TABELAS.talhoes : TABELAS.safras;

  it('talhões, plantio, colheita, safras anteriores e chuva: cada uma é a união das suas páginas', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, feitas } = agrovexQuePagina(tabelaDe);
    const dados = await sincronizarAcompanhamento({
      url: 'https://agrovex.test/mcp', token: 'tk', safras: ['SOJA 26/27'], fetchImpl: impl, agora: new Date('2026-09-29T12:00:00Z'),
    });
    // a chuva não pode ter caído no "segue sem a chuva"
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();

    const atual = dados.linhas.find((l) => l.safra === 'SOJA 26/27')!;
    expect(atual.talhoes).toHaveLength(N.talhoes);
    expect(semRepeticao(atual.talhoes.map((t) => t.id))).toBe(true);
    const plantio = atual.apontamentos.filter((a) => a.op === 'PLANTIO');
    const colheita = atual.apontamentos.filter((a) => a.op === 'COLHEITA');
    expect(plantio.map((a) => a.a).sort((x, y) => x - y)).toEqual(serie(N.plantio, (i) => i + 1));
    expect(colheita.map((a) => a.a).sort((x, y) => x - y)).toEqual(serie(N.colheita, (i) => i + 1));
    const anterior = dados.linhas.find((l) => l.safra === 'SOJA 25/26')!;
    expect(anterior.apontamentos.map((a) => a.a).sort((x, y) => x - y)).toEqual(serie(N.hist, (i) => i + 1));
    const chuva = dados.linhas.find((l) => l.safra === 'CHUVA')!;
    expect(chuva.apontamentos.map((a) => a.a).sort((x, y) => x - y)).toEqual(serie(N.chuva, (i) => i + 1));
    expect(dados.chuva).toBe(1);

    expect(paginasDe(feitas, 'up.QT_AREA_PROD > 0.1')).toEqual([0, 4000]);
    expect(paginasDe(feitas, 'a.FG_REPLANTIO AS replantio')).toEqual([0, 4000, 8000]);
    expect(paginasDe(feitas, 'a.QT_AREA_EXEC AS area')).toEqual([0, 4000]);
    expect(paginasDe(feitas, 'UNION ALL')).toEqual([0, 4000]);
    const daChuva = feitas.filter((f) => f.sql.includes('stg_climatemonitoring2'));
    expect(daChuva.map((f) => f.pular)).toEqual([0, 4000]);
    expect(daChuva.every((f) => f.source === 'zeus')).toBe(true);
    // a lista de safras é cadastro: uma consulta só, sem paginar
    expect(feitas.filter((f) => !f.sql.includes('JOIN')).map((f) => f.pular)).toEqual([null]);
  });

  it('a ZEUS recusou a chuva em páginas (a forma OFFSET … LIMIT nunca tinha passado pelo Agrovex nela): vale a consulta inteira de sempre', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const POUCA: Tabela = { columns: ['fazenda', 'data', 'mm'], rows: [['Faz_SM3', '2025-10-02', 12.4], ['Faz_SM3', '2025-10-03', 7]] };
    const { impl, feitas } = agrovexQuePagina(
      (sql) => (sql.includes('stg_climatemonitoring2') ? POUCA : tabelaDe(sql)),
      (f) => (f.source === 'zeus' && f.pular !== null ? 'syntax error at or near "OFFSET"' : null),
    );
    const dados = await sincronizarAcompanhamento({
      url: 'https://agrovex.test/mcp', token: 'tk', safras: ['SOJA 26/27'], fetchImpl: impl, agora: new Date('2026-09-29T12:00:00Z'),
    });
    const texto = aviso.mock.calls.flat().join(' ');
    aviso.mockRestore();
    expect(dados.chuva).toBe(1);
    expect(dados.linhas.find((l) => l.safra === 'CHUVA')!.apontamentos).toEqual([{ op: 'CHUVA', d: '2025-10-02', a: 12.4 }, { op: 'CHUVA', d: '2025-10-03', a: 7 }]);
    const daChuva = feitas.filter((f) => f.sql.includes('stg_climatemonitoring2'));
    expect(daChuva.map((f) => f.pular)).toEqual([0, null]);
    expect(daChuva[1].sql).toBe(montarSqlChuva('2023-08-01'));
    expect(texto).toContain('Consulta ao ZEUS em páginas foi recusada (chuva)');
    expect(texto).not.toContain('segue sem a chuva');
  });
});

// ---------- validação ----------

describe('paginação: as consultas da Validação (sincronizarValidacao)', () => {
  const N = { evolucao: 9000, falhas: 4500, pendentes: 4400, necessidade: 5500, dose: 4100, coletor: 6000, log: 4300, itens: 4200, estoque: 4500 };
  const TABELAS: Record<string, Tabela> = {
    ordens: {
      columns: ['unidade', 'os', 'equipe', 'operacao', 'operacao_de', 'situacao', 'abertura', 'encerramento', 'planejado', 'talhoes', 'executado', 'ultimo', 'sem_area'],
      rows: [['DOURADO', 1, 'COORD A', 10, 'PLANTIO', 'A', '2026-10-01', null, 100, 1, 10, null, 0]],
    },
    evolucao: { columns: ['unidade', 'os', 'dia', 'ha'], rows: serie(N.evolucao, (i) => ['DOURADO', 1, '2026-10-02', i + 1]) },
    falhas: {
      columns: ['unidade', 'origem', 'boletim', 'dia', 'id_item', 'material', 'qtd', 'un', 'deposito', 'os', 'equipe', 'em'],
      rows: serie(N.falhas, (i) => ['DOURADO', 'P', 100000 + i, '2026-10-02', String(i), 'I1', 1, 'KG', '1001', 1, 'COORD A', '2026-10-03 10:00']),
    },
    pendentes: {
      columns: ['unidade', 'origem', 'boletim', 'dia', 'id_item', 'material', 'nome', 'qtd', 'deposito', 'os', 'equipe', 'em'],
      rows: serie(N.pendentes, (i) => ['DOURADO', 'I', 200000 + i, '2026-10-05', String(i), `M${i}`, 'PRODUTO', 1, '1001', 1, 'COORD A', '2026-10-06 07:15']),
    },
    necessidade: {
      columns: ['unidade', 'os', 'equipe', 'abertura', 'operacao_de', 'item', 'nome', 'planejado', 'consumido'],
      rows: serie(N.necessidade, (i) => ['DOURADO', 1, 'COORD A', '2026-10-01', 'APLIC', `I${i}`, 'PRODUTO', 10, 0]),
    },
    dose: {
      columns: ['unidade', 'boletim', 'dia', 'os', 'equipe', 'talhao', 'item', 'nome', 'prog', 'dose_real', 'ha', 'total', 'obs'],
      rows: serie(N.dose, (i) => ['DOURADO', i + 1, '2026-10-03', 1, 'COORD A', '007A', 'I1', 'PRODUTO', 1.2, 0.4, 10, 4, null]),
    },
    coletor: {
      columns: ['unidade', 'tipo', 'boletim', 'dia', 'os', 'equipe', 'operacao_de', 'st', 'msg', 'lancado', 'por', 'talhao', 'ha', 'os_sit', 'os_ab', 'os_enc', 'plan_talhao', 'exec_talhao', 'ja_no_pims'],
      rows: serie(N.coletor, (i) => ['DOURADO', 'M', i + 1, '2026-09-30', null, 'COORD A', null, 'I', 'erro', null, null, null, null, null, null, null, null, null, 0]),
    },
    // SAP (HANA): o log dos primeiros 4.300 itens recusados, o cadastro dos primeiros 4.200 materiais pendentes e o saldo do depósito vinculado
    log: { columns: ['id_item', 'msg', 'tentativas', 'primeira', 'ultima'], rows: serie(N.log, (i) => [String(i), 'Error -10', 2, '2026-10-03', '2026-10-06']) },
    itens: { columns: ['item', 'nome', 'unidade', 'congelado', 'deposito', 'saldo'], rows: serie(N.itens, (i) => [`M${i}`, 'PRODUTO SAP', 'KG', 'N', '1001', 1000]) },
    estoque: {
      columns: ['deposito', 'item', 'nome', 'saldo', 'unidade', 'origem', 'origem_nome', 'saldo_origem', 'transferido_em'],
      rows: serie(N.estoque, (i) => ['1001', `E${i}`, 'PRODUTO', i + 1, 'KG', null, null, null, null]),
    },
  };
  const MARCAS: [string, string][] = [
    ['AS sem_area', 'ordens'], ['GROUP BY u.DE_UNI_ADM, os.NO_BOLETIM', 'evolucao'], ['BRG_BXMATERIAL_EMS', 'falhas'], ["a.FG_STATUS_EAI = '0'", 'pendentes'],
    ['APORDSERVICO_CO', 'necessidade'], ['QT_DOSE_PROG', 'dose'], ['APAPLINSUMO_TMP', 'coletor'],
  ];
  const MARCAS_SAP: [string, string][] = [['"@GA_PIMS_LOG" l', 'log'], ['FROM OITM i LEFT JOIN OITW w', 'itens'], ['FROM OITW t JOIN OITM i', 'estoque']];
  const VINCULOS = [{ unidade: 'DOURADO', deposito: '1001' }];
  const tabelaDe = (sql: string, source: string): Tabela => {
    const marca = (source === 'hana' ? MARCAS_SAP : source === 'sqlserver' ? MARCAS : []).find(([m]) => sql.includes(m));
    return marca ? TABELAS[marca[1]] : VAZIA;
  };

  it('evolução, boletins com falha e pendentes, necessidade, dose, coletor e as três do SAP: cada uma é a união das suas páginas', async () => {
    const { impl, feitas } = agrovexQuePagina(tabelaDe);
    const dados = await sincronizarValidacao({ url: 'https://agrovex.test/mcp', token: 'tk', vinculos: VINCULOS, fetchImpl: impl, agora: new Date(2026, 9, 6, 12, 0) });
    expect(dados.avisos).toEqual([]);
    expect(dados.linhas.map((l) => l.unidade)).toEqual(['DOURADO']);
    const d = dados.linhas[0];

    expect(d.ordens[0].ev!.map((e) => e[1]).sort((x, y) => x - y)).toEqual(serie(N.evolucao, (i) => i + 1));
    const numeros = (sit: string) => d.boletins.filter((b) => b.sit === sit).map((b) => Number(b.n)).sort((x, y) => x - y);
    expect(numeros('F')).toEqual(serie(N.falhas, (i) => 100000 + i));
    expect(numeros('P')).toEqual(serie(N.pendentes, (i) => 200000 + i));
    const extras = d.extras as Record<string, Record<string, unknown>[]>;
    expect(new Set(extras.nec.map((x) => x.c))).toEqual(new Set(serie(N.necessidade, (i) => `I${i}`)));
    expect(extras.nec).toHaveLength(N.necessidade);
    expect(extras.dose.map((x) => Number(x.b)).sort((x, y) => x - y)).toEqual(serie(N.dose, (i) => i + 1));
    expect(extras.col.map((x) => Number(x.b)).sort((x, y) => x - y)).toEqual(serie(N.coletor, (i) => i + 1));

    for (const [marca, nome] of MARCAS) {
      const total = TABELAS[nome].rows.length;
      const esperadas = serie(Math.floor(total / PAGINA_CONSULTA) + 1, (i) => i * PAGINA_CONSULTA);
      expect(paginasDe(feitas, marca), nome).toEqual(esperadas);
    }
    // cadastros (coordenadores e depósitos do PIMS) seguem numa consulta só, sem paginar
    expect(paginasDe(feitas, 'AS abertas')).toEqual([null]);
    expect(paginasDe(feitas, 'FROM PIMSMCPRD.dbo.DEPOSITO d')).toEqual([null]);

    // SAP: o log chegou para os 4.300 itens que têm log (nenhum a menos, por causa da segunda página)…
    expect(d.boletins.filter((b) => b.sit === 'F' && b.t === 2)).toHaveLength(N.log);
    // …o cadastro chegou para os 4.200 materiais que existem no SAP: só os outros 200 saem como "item inexistente"…
    const semCadastro = d.boletins.filter((b) => b.sit === 'P' && b.it[0].pr?.includes('item-inexistente'));
    expect(semCadastro).toHaveLength(N.pendentes - N.itens);
    // …e o saldo do depósito vinculado veio inteiro, sem item repetido
    expect(d.estoque['1001']).toHaveLength(N.estoque);
    expect(semRepeticao(d.estoque['1001'].map((x) => x.c))).toBe(true);
    for (const [marca, nome] of MARCAS_SAP) {
      const doSap = feitas.filter((f) => f.sql.includes(marca));
      expect(doSap.map((f) => f.pular), nome).toEqual([0, 4000]);
      expect(doSap.every((f) => f.source === 'hana')).toBe(true);
    }
    // o cadastro de depósitos de cada empresa do SAP segue numa consulta só
    expect(new Set(paginasDe(feitas, 'FROM OWHS'))).toEqual(new Set([null]));
  });

  it('a fonte recusou as consultas que passaram a ser paginadas: cada uma cai na consulta inteira de sempre, e a etapa não para', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const NOVAS = ['evolucao', 'falhas', 'pendentes', 'necessidade', 'dose', 'coletor'];
    const marcasNovas = [...MARCAS.filter(([, nome]) => NOVAS.includes(nome)), ...MARCAS_SAP];
    // poucas linhas: o resultado inteiro cabe numa consulta, como hoje
    const poucas = (sql: string, source: string): Tabela => {
      const t = tabelaDe(sql, source);
      return t === TABELAS.ordens ? t : { columns: t.columns, rows: t.rows.slice(0, 3) };
    };
    const { impl, feitas } = agrovexQuePagina(poucas, (f) => (f.pular !== null && marcasNovas.some(([m]) => f.sql.includes(m)) ? 'ORDER BY recusado' : null));
    const dados = await sincronizarValidacao({ url: 'https://agrovex.test/mcp', token: 'tk', vinculos: VINCULOS, fetchImpl: impl, agora: new Date(2026, 9, 6, 12, 0) });
    const avisos = aviso.mock.calls.flat().join('\n');
    aviso.mockRestore();
    const d = dados.linhas[0];
    const extras = d.extras as Record<string, Record<string, unknown>[]>;
    expect(d.ordens[0].ev).toHaveLength(3);
    expect(d.boletins).toHaveLength(6);
    expect([extras.nec.length, extras.dose.length, extras.col.length]).toEqual([3, 3, 3]);
    for (const [marca, nome] of marcasNovas) expect(paginasDe(feitas, marca), nome).toEqual([0, null]);
    expect(avisos.match(/em páginas foi recusada/g)).toHaveLength(9);
    // o SAP respondeu pela consulta inteira: nenhum aviso de "SAP indisponível" gravado na linha
    expect(dados.avisos).toEqual([]);
    expect(d.estoque['1001']).toHaveLength(3);
  });

  it('as consultas que já eram paginadas não têm reserva (não existe consulta inteira delas): a recusa derruba a etapa, como antes', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl, feitas } = agrovexQuePagina(tabelaDe, (f) => (f.sql.includes('AS sem_area') ? 'falhou' : null));
    await expect(sincronizarValidacao({ url: 'https://agrovex.test/mcp', token: 'tk', fetchImpl: impl, agora: new Date(2026, 9, 6, 12, 0) }))
      .rejects.toThrow(/Consulta ao PIMS falhou \(ordens de serviço\): falhou/);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
    expect(feitas.map((f) => f.pular)).toEqual([0]);
  });

  it('teto de páginas também vale para as consultas da validação que já paginavam', async () => {
    const cheia: Tabela = { columns: TABELAS.ordens.columns, rows: serie(PAGINA_CONSULTA, () => TABELAS.ordens.rows[0]) };
    let consultas = 0;
    const impl: FetchLike = async (_url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 200 });
      const corpo = JSON.parse(String(init.body));
      if (corpo.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
      if (corpo.method === 'notifications/initialized') return new Response(null, { status: 202 });
      consultas++;
      return resposta(corpo.id, { status: 'success', ...cheia, row_count: PAGINA_CONSULTA, truncated: false });
    };
    await expect(sincronizarValidacao({ url: 'https://agrovex.test/mcp', token: 'tk', fetchImpl: impl, agora: new Date(2026, 9, 6, 12, 0) }))
      .rejects.toThrow(new RegExp(`Consulta ao PIMS falhou \\(ordens de serviço\\): mais de ${PAGINAS_MAX} páginas`));
    expect(consultas).toBe(PAGINAS_MAX);
  });
});

// ---------- chuva por talhão e limites da ZEUS ----------

describe('paginação: as consultas da ZEUS na chuva por talhão (sincronizarChuvaTalhao e sincronizarLimitesZeus)', () => {
  const AGORA = new Date('2026-10-08T12:20:00Z');
  const N = { talhoes: 4500, vinculos: 4200 };
  const TALHOES: Tabela = { columns: ['unidade', 'fieldname', 'de', 'ate', 'dias'], rows: serie(N.talhoes, (i) => ['GUAPIRAMA', `T${i}`, 0, 10, '1:5']) };
  const VINCULOS: Tabela = {
    columns: ['farm', 'talhao', 'picid', 'picname', 'lat', 'lon'],
    rows: serie(N.vinculos, (i) => ['Faz. Guapirama', `T${i}`, '9103', 'PIC GUAPIRAMA', '-21.5', '-46.1']),
  };
  const COM_CHUVA: Tabela = { columns: ['unidade', 'fieldname'], rows: serie(N.talhoes, (i) => ['GUAPIRAMA', `T${i}`]) };
  const POLIGONO = 'POLYGON ((-55 -12, -55 -12.01, -55.01 -12.01, -55.01 -12, -55 -12))';
  const tabelaDe = (sql: string, source: string): Tabela => {
    if (source === 'sqlserver') return VAZIA; // ciclos do PIMS: nenhum, nesta rodada
    if (source === 'athena') {
      return sql.includes('count(*) AS n')
        ? { columns: ['businessunitname', 'n'], rows: [['Fazenda Guapirama', 3]] }
        // um talhão da primeira página dos "com chuva" e dois da segunda
        : { columns: ['idfield', 'fieldname', 'fieldgeom'], rows: [[1, 'T0', POLIGONO], [2, 'T4100', POLIGONO], [3, 'T4499', POLIGONO]] };
    }
    if (sql.includes('string_agg((data::date')) return TALHOES;
    if (sql.includes('SELECT DISTINCT farm, talhao')) return VINCULOS;
    if (sql.includes('SELECT DISTINCT unidade, fieldname')) return COM_CHUVA;
    if (sql.includes('WITH por_dia')) return { columns: ['picid', 'leitura', 'dias'], rows: [['9103', '20261007230000', '1:5']] };
    return { columns: ['unidade', 'dias'], rows: [['GUAPIRAMA', '0,1,2']] }; // os dias com dado
  };

  it('chuva dos talhões e vínculos talhão × pluviômetro: cada uma é a união das suas páginas', async () => {
    const { impl, feitas } = agrovexQuePagina(tabelaDe);
    const linhas = await sincronizarChuvaTalhao({ url: 'https://agrovex.test/mcp', token: 'tk', fetchImpl: impl, agora: AGORA });
    expect(linhas.map((l) => l.unidade)).toEqual(['GUAPIRAMA']);
    expect(new Set(Object.keys(linhas[0].talhoes))).toEqual(new Set(serie(N.talhoes, (i) => `T${i}`)));
    expect(new Set(Object.keys(linhas[0].vinculos))).toEqual(new Set(serie(N.vinculos, (i) => `T${i}`)));
    expect(linhas[0].pics).toHaveLength(1);
    const daZeus = (marca: string) => feitas.filter((f) => f.sql.includes(marca));
    expect(daZeus('string_agg((data::date').map((f) => f.pular)).toEqual([0, 4000]);
    expect(daZeus('SELECT DISTINCT farm, talhao').map((f) => f.pular)).toEqual([0, 4000]);
    expect([...daZeus('string_agg((data::date'), ...daZeus('SELECT DISTINCT farm, talhao')].every((f) => f.source === 'zeus')).toBe(true);
    // uma linha por fazenda ou por pluviômetro: numa consulta só
    expect(daZeus('WITH por_dia').map((f) => f.pular)).toEqual([null]);
    expect(daZeus('GROUP BY unidade\nORDER BY unidade').map((f) => f.pular)).toEqual([null]);
  });

  it('talhões com chuva (limites da ZEUS): o talhão que só vem na segunda página também ganha limite', async () => {
    const { impl, feitas } = agrovexQuePagina(tabelaDe);
    const linhas = await sincronizarLimitesZeus({ url: 'https://agrovex.test/mcp', token: 'tk', fetchImpl: impl, agora: AGORA });
    expect(linhas.map((l) => l.unidade)).toEqual(['GUAPIRAMA']);
    expect(linhas[0].talhoes.map((t) => t.codigo)).toEqual(['T0', 'T4100', 'T4499']);
    expect(paginasDe(feitas, 'SELECT DISTINCT unidade, fieldname')).toEqual([0, 4000]);
  });

  it('a ZEUS recusou as consultas em páginas: valem as inteiras de sempre', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poucas = (sql: string, source: string): Tabela => {
      const t = tabelaDe(sql, source);
      return { columns: t.columns, rows: t.rows.slice(0, 3) };
    };
    const recusa = (f: Feita) => (f.source === 'zeus' && f.pular !== null ? 'syntax error at or near "OFFSET"' : null);
    const a = agrovexQuePagina(poucas, recusa);
    const chuva = await sincronizarChuvaTalhao({ url: 'https://agrovex.test/mcp', token: 'tk', fetchImpl: a.impl, agora: AGORA });
    expect(Object.keys(chuva[0].talhoes)).toEqual(['T0', 'T1', 'T2']);
    expect(Object.keys(chuva[0].vinculos)).toEqual(['T0', 'T1', 'T2']);
    expect(paginasDe(a.feitas, 'string_agg((data::date')).toEqual([0, null]);
    expect(paginasDe(a.feitas, 'SELECT DISTINCT farm, talhao')).toEqual([0, null]);
    const b = agrovexQuePagina(poucas, recusa);
    const limites = await sincronizarLimitesZeus({ url: 'https://agrovex.test/mcp', token: 'tk', fetchImpl: b.impl, agora: AGORA });
    expect(limites[0].talhoes.map((t) => t.codigo)).toEqual(['T0']);
    expect(paginasDe(b.feitas, 'SELECT DISTINCT unidade, fieldname')).toEqual([0, null]);
    expect(aviso.mock.calls.flat().join('\n').match(/Consulta ao ZEUS em páginas foi recusada/g)).toHaveLength(3);
    aviso.mockRestore();
  });
});
