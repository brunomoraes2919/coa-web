import { describe, expect, it } from 'vitest';
import { atenderPedidosValidacao } from '../scripts/atender-pedidos.mjs';
import {
  depositosVinculados, inicioSafraValidacao, itemDoSaldoSap, linhasValidacao, montarSqlApontamentosValidacao, montarSqlCoordenadoresValidacao, montarSqlEstoqueSap,
  montarSqlOrdensValidacao, montarSqlTalhoesValidacao,
} from '../scripts/sincronizar-plantio.mjs';

// Todos os dados daqui são FICTÍCIOS.
const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';

const ordem = (o: Record<string, unknown>) => ({
  unidade: 'DOURADO', os: 1001, equipe: 'COORD A', operacao: 10, operacao_de: 'PLANTIO', situacao: 'A', abertura: '2026-10-01', encerramento: null,
  planejado: 100.004, talhoes: 2, executado: 40.126, ultimo: '2026-10-03', sem_area: 0, ...o,
});

describe('validação de apontamentos do PIMS (servidor)', () => {
  it('a safra começa em 1º de agosto', () => {
    expect(inicioSafraValidacao(new Date(2026, 9, 6))).toBe('2026-08-01');
    expect(inicioSafraValidacao(new Date(2026, 6, 31))).toBe('2025-08-01');
  });

  it('a consulta traz as abertas e as fechadas na safra com diferença acima de 1 ha, paginada', () => {
    const sql = montarSqlOrdensValidacao('2026-08-01', 4000, 4000);
    expect(sql).toContain("WHERE os.FG_SITUACAO = 'A'");
    expect(sql).toContain("os.FG_SITUACAO = 'F' AND os.DT_ENCERRA >= '2026-08-01' AND sa.ID_OPERACAO IS NULL AND ABS(ISNULL(pl.ha, 0) - ISNULL(ex.ha, 0)) > 1");
    // operações que não apontam área: medidas nas ordens fechadas desde a safra anterior
    expect(sql).toContain("o2.DT_ENCERRA >= '2025-08-01'");
    expect(sql).toContain('HAVING COUNT(*) >= 3 AND 2 * SUM(CASE WHEN ex.ha > 0 THEN 1 ELSE 0 END) < COUNT(*)');
    expect(sql).toMatch(/OFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY$/);
    // a data vai limpa para o SQL
    expect(montarSqlOrdensValidacao("2026-08-01'; DROP TABLE x --")).not.toContain('DROP');
    expect(montarSqlCoordenadoresValidacao('2026-08-01')).toContain("os.DT_ABERTURA >= '2026-08-01' OR os.DT_ENCERRA >= '2026-08-01'");
  });

  it('o detalhe (talhões e apontamentos) vale para as mesmas ordens do retrato, paginado', () => {
    const condicao = "os.FG_SITUACAO = 'F' AND os.DT_ENCERRA >= '2026-08-01' AND sa.ID_OPERACAO IS NULL AND ABS(ISNULL(pl.ha, 0) - ISNULL(ex.ha, 0)) > 1";
    const talhoes = montarSqlTalhoesValidacao('2026-08-01', 0, 4000);
    expect(talhoes).toContain(condicao);
    expect(talhoes).toContain('up.CD_UPNIVEL3 AS talhao, lc.QT_AREA AS ha');
    expect(talhoes).toMatch(/OFFSET 0 ROWS FETCH NEXT 4000 ROWS ONLY$/);
    const apont = montarSqlApontamentosValidacao('2026-08-01', 4000, 4000);
    expect(apont).toContain(condicao);
    expect(apont).toContain('ap.NO_BOLETIM AS boletim');
    expect(apont).toContain('ap.CHANGED_BY AS por');
    expect(apont).toMatch(/OFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY$/);
  });

  it('o saldo do SAP só aceita códigos de depósito bem formados', () => {
    const sql = montarSqlEstoqueSap(['1001', '1000', '1001', "x' OR '1'='1"]);
    expect(sql).toContain(`t."WhsCode" IN ('1001', '1000')`);
    expect(sql).toContain('t."OnHand" <> 0');
    // a origem de cada item: última transferência de estoque para o depósito, sem as canceladas
    expect(sql).toContain(`WHERE h."CANCELED" = 'N' AND l."WhsCode" IN ('1001', '1000') AND l."FromWhsCod" <> l."WhsCode"`);
    expect(sql).toContain('PARTITION BY l."WhsCode", l."ItemCode" ORDER BY h."DocDate" DESC, h."DocEntry" DESC');
    expect(sql).toContain('LEFT JOIN OITW o ON o."WhsCode" = u."FromWhsCod" AND o."ItemCode" = t."ItemCode"');
    expect(sql).not.toContain("OR '1'='1");
    expect(() => montarSqlEstoqueSap(["'; --"])).toThrow('Nenhum depósito válido para consultar o saldo.');
  });

  it('agrupa os depósitos dos coordenadores por empresa do SAP e por unidade', () => {
    expect(depositosVinculados([
      { unidade: 'DOURADO', deposito: '1001' },
      { unidade: 'DOURADO', deposito: '1002' },
      { unidade: 'DOURADO', deposito: '1001' },
      { unidade: 'SM3', deposito: '8101' },
      { unidade: 'SM3', deposito: null },
      { unidade: 'UNIDADE DESCONHECIDA', deposito: '9999' },
      { unidade: 'GLOBO', deposito: 'código inválido' },
    ])).toEqual({
      SBOAGROPECUARIALOCKS: { DOURADO: ['1001', '1002'] },
      SBOAGROPECUARIASM3: { SM3: ['8101'] },
    });
  });

  it('cada item do saldo leva a origem da última transferência, quando existe', () => {
    expect(itemDoSaldoSap({ deposito: '1001', item: 'I1', nome: 'PRODUTO UM', saldo: 12.3456, unidade: 'L', origem: '1000', origem_nome: 'CENTRAL', saldo_origem: 400, transferido_em: '2026-10-01' }))
      .toEqual({ c: 'I1', n: 'PRODUTO UM', q: 12.346, u: 'L', o: '1000', on: 'CENTRAL', oq: 400, od: '2026-10-01' });
    // a origem não tem mais o item: saldo 0 lá
    expect(itemDoSaldoSap({ item: 'I2', nome: 'PRODUTO DOIS', saldo: 3, unidade: 'KG', origem: '1000', origem_nome: null, saldo_origem: null, transferido_em: null }))
      .toEqual({ c: 'I2', n: 'PRODUTO DOIS', q: 3, u: 'KG', o: '1000', on: '', oq: 0 });
    // nunca chegou por transferência: sem origem
    expect(itemDoSaldoSap({ item: 'I3', nome: 'PRODUTO TRES', saldo: 1, unidade: 'UN', origem: null, origem_nome: null, saldo_origem: null, transferido_em: null }))
      .toEqual({ c: 'I3', n: 'PRODUTO TRES', q: 1, u: 'UN' });
  });

  it('monta uma linha por unidade, com a evolução nas abertas e a marca das operações sem área', () => {
    const linhas = linhasValidacao({
      ordens: [
        ordem({}),
        ordem({ os: 1002, situacao: 'F', encerramento: '2026-09-20', abertura: '2026-09-10', planejado: 200, executado: 150 }),
        ordem({ os: 1003, operacao: 55, operacao_de: 'TRATAMENTO DE SEMENTES', abertura: '2026-09-30', executado: 0, ultimo: null, sem_area: 1 }),
        ordem({ unidade: 'SM3', os: 2001, equipe: null }),
      ],
      evolucao: [
        { unidade: 'DOURADO', os: 1001, dia: '2026-10-02', ha: 15.126 },
        { unidade: 'DOURADO', os: 1001, dia: '2026-10-03', ha: 25 },
        { unidade: 'DOURADO', os: 1002, dia: '2026-09-15', ha: 150 }, // fechada: sem evolução
      ],
      talhoes: [
        { unidade: 'DOURADO', os: 1001, talhao: 'T01', ha: 60 },
        { unidade: 'DOURADO', os: 1001, talhao: 'T02', ha: 40.001 },
        { unidade: 'DOURADO', os: 9999, talhao: 'T99', ha: 1 }, // ordem que não está no retrato: ignorada
      ],
      apontamentos: [
        { unidade: 'DOURADO', os: 1001, boletim: 7001, dia: '2026-10-02', talhao: 'T01', ha: 15.126, lancado: '2026-10-02 18:40', por: 'usuario.um' },
        { unidade: 'DOURADO', os: 1001, boletim: 7002, dia: '2026-10-03', talhao: 'T02', ha: 25, lancado: null, por: null },
        { unidade: 'DOURADO', os: 9999, boletim: 7003, dia: '2026-10-03', talhao: 'T99', ha: 1, lancado: null, por: null },
      ],
      coordenadores: [{ unidade: 'DOURADO', equipe: 'COORD A', abertas: 2, ordens: 9 }],
      depositos: [{ unidade: 'DOURADO', codigo: '1001', nome: 'NOME NO PIMS' }, { unidade: 'DOURADO', codigo: '1000', nome: 'CENTRAL' }],
      depositosSap: { SBOAGROPECUARIALOCKS: new Map([['1001', { nome: 'NOME NO SAP', inativo: false }], ['1000', { nome: 'CENTRAL SAP', inativo: true }]]) },
      estoque: { DOURADO: { 1001: [{ c: 'I1', n: 'PRODUTO UM', q: 12, u: 'L' }] } },
      avisos: [],
    }, '2026-10-06T12:00:00.000Z');

    expect(linhas.map((l) => l.unidade)).toEqual(['DOURADO', 'SM3']);
    const d = linhas[0];
    expect(d.gerado_em).toBe('2026-10-06T12:00:00.000Z');
    expect(d.ordens.map((o) => o.os)).toEqual([1002, 1003, 1001]); // da abertura mais antiga para a mais nova
    expect(d.ordens[2]).toEqual({
      os: 1001, eq: 'COORD A', op: 10, opn: 'PLANTIO', s: 'A', ab: '2026-10-01', enc: null, pl: 100, ex: 40.13, nt: 2, ult: '2026-10-03',
      ev: [['2026-10-02', 15.13], ['2026-10-03', 25]],
      tl: [['T01', 60], ['T02', 40]],
      ap: [['2026-10-02', 7001, 'T01', 15.13, '2026-10-02 18:40', 'usuario.um'], ['2026-10-03', 7002, 'T02', 25, null, null]],
    });
    expect(d.ordens[0].tl).toEqual([]); // sem talhões nem apontamentos no retorno: listas vazias, não ausentes
    expect(d.ordens[0].ap).toEqual([]);
    expect(d.ordens[0].s).toBe('F');
    expect(d.ordens[0].ev).toBeUndefined();
    expect(d.ordens[1].sa).toBe(1);
    expect(d.coordenadores).toEqual([{ eq: 'COORD A', ab: 2, n: 9 }]);
    expect(d.depositos).toEqual([{ c: '1001', n: 'NOME NO SAP' }, { c: '1000', n: 'CENTRAL SAP', i: 1 }]);
    expect(d.estoque).toEqual({ 1001: [{ c: 'I1', n: 'PRODUTO UM', q: 12, u: 'L' }] });
    expect(linhas[1].ordens[0].eq).toBe('(sem equipe)');
  });

  it('sem pedido pendente (ou sem a tabela) não consulta o PIMS', async () => {
    const chamadas: string[] = [];
    const responder = (corpo: unknown, status = 200) => async (url: string | URL) => {
      chamadas.push(String(url));
      return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
    };
    const base = { supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.invalid/mcp', token: 'token-de-teste' } };

    expect(await atenderPedidosValidacao({ ...base, fetch: responder([]) as typeof fetch })).toBe(false);
    expect(await atenderPedidosValidacao({ ...base, fetch: responder({ code: 'PGRST205', message: 'tabela não existe' }, 404) as typeof fetch })).toBe(false);
    expect(chamadas).toHaveLength(2);
    expect(chamadas.every((u) => u.startsWith(`${URL_SB}/rest/v1/valid_pedidos?`))).toBe(true);
  });
});
