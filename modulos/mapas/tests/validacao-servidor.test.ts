import { describe, expect, it } from 'vitest';
import { atenderPedidosValidacao } from '../scripts/atender-pedidos.mjs';
import {
  depositosVinculados, inicioSafraValidacao, linhasValidacao, montarSqlCoordenadoresValidacao, montarSqlEstoqueSap, montarSqlOrdensValidacao,
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

  it('o saldo do SAP só aceita códigos de depósito bem formados', () => {
    const sql = montarSqlEstoqueSap(['1001', '1000', '1001', "x' OR '1'='1"]);
    expect(sql).toContain(`t."WhsCode" IN ('1001', '1000')`);
    expect(sql).toContain('t."OnHand" <> 0');
    expect(() => montarSqlEstoqueSap(["'; --"])).toThrow('Nenhum depósito válido para consultar o saldo.');
  });

  it('agrupa os depósitos vinculados por empresa do SAP e por unidade', () => {
    expect(depositosVinculados([
      { unidade: 'DOURADO', deposito: '1001', deposito_origem: '1000' },
      { unidade: 'DOURADO', deposito: '1002', deposito_origem: '1000' },
      { unidade: 'SM3', deposito: '8101', deposito_origem: null },
      { unidade: 'UNIDADE DESCONHECIDA', deposito: '9999', deposito_origem: null },
      { unidade: 'GLOBO', deposito: 'código inválido', deposito_origem: null },
    ])).toEqual({
      SBOAGROPECUARIALOCKS: { DOURADO: ['1001', '1000', '1002'] },
      SBOAGROPECUARIASM3: { SM3: ['8101'] },
    });
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
    });
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
