import { describe, expect, it } from 'vitest';
import { atenderPedidosValidacao } from '../scripts/atender-pedidos.mjs';
import {
  depositosVinculados, diaAnterior, inicioSafraValidacao, itemDoSaldoSap, linhasBoletins, linhasExtras, linhasValidacao, montarSqlApontamentosRecentes,
  montarSqlApontamentosValidacao, montarSqlBoletinsFalha, montarSqlColetorValidacao, montarSqlDoseValidacao, montarSqlNecessidadeValidacao,
  montarSqlBoletinsPendentes, montarSqlLogIntegracaoSap, montarSqlSaldoItensSap, montarSqlCoordenadoresValidacao, montarSqlEstoqueSap,
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

  it('boletins: as consultas pegam os recusados pelo SAP e os ainda não enviados, com listas limpas', () => {
    const falhas = montarSqlBoletinsFalha('2026-08-01');
    expect(falhas).toContain("WHERE e.DT_CONSUMO >= '2026-08-01' AND LTRIM(RTRIM(e.NO_DOC_ERP)) = '-1' AND e.FG_STATUS <> '12'");
    expect(falhas).toContain('CONVERT(varchar(30), e.ID_BOLETIM_DE) AS id_item'); // id grande demais para número do JavaScript
    const pend = montarSqlBoletinsPendentes('2026-08-01');
    expect(pend.match(/a\.FG_STATUS_EAI = '0' AND a\.FG_INTEGRAR = 'S'/g)).toHaveLength(3);
    expect(pend).toContain('l.QT_CONS_TOTAL AS qtd');
    expect(pend).toContain('l.QT_TOTAL AS qtd');
    const log = montarSqlLogIntegracaoSap(['10001283', 8853, "1'); DROP TABLE X --"], '2026-08-01');
    expect(log).toContain(`"U_NO_BOLETIM" IN ('10001283', '8853') AND "U_Date" >= '2026-08-01'`);
    expect(() => montarSqlLogIntegracaoSap(['abc'], '2026-08-01')).toThrow('Nenhum boletim válido');
    const saldo = montarSqlSaldoItensSap(['000040', '000040', "x' OR '1'='1"], ['1718', null]);
    expect(saldo).toContain(`w."WhsCode" IN ('1718')`);
    expect(saldo).toContain(`WHERE i."ItemCode" IN ('000040')`);
    expect(montarSqlSaldoItensSap(['000040'], [])).toContain(`w."WhsCode" IN ('')`);
  });

  it('boletins: junta os itens, explica com o log do SAP e confere saldo e cadastro', () => {
    const falha = (o: Record<string, unknown>) => ({ unidade: 'DOURADO', origem: 'P', boletim: 501, dia: '2026-10-02', id_item: '9000000000000000001', material: 'I1', qtd: 500, un: 'KG', deposito: '1001', os: 10, equipe: 'COORD A', em: '2026-10-03 16:57', ...o });
    const pend = (o: Record<string, unknown>) => ({ unidade: 'DOURADO', origem: 'I', boletim: 601, dia: '2026-10-05', id_item: '7', material: 'I1', nome: 'NOME DO PIMS', qtd: 60, deposito: '1001', os: 12, equipe: 'COORD A', em: '2026-10-06 07:15', ...o });
    const r = linhasBoletins({
      falhas: [
        falha({}),
        falha({ id_item: '9000000000000000002', qtd: 300 }), // o mesmo item em outro talhão: soma
        falha({ id_item: '9000000000000000003', material: 'I2', qtd: 4, un: 'LT' }),
        falha({ unidade: null, boletim: 999 }), // boletim que não existe mais no PIMS: fora
      ],
      pendentes: [
        pend({}),
        pend({ boletim: 602, material: 'I9', deposito: '1009' }),
        pend({ boletim: 603, material: 'I3', deposito: '1001' }),
        pend({ boletim: 604, id_item: null, material: null, nome: null, qtd: null, deposito: null }),
        pend({ unidade: 'SM3', boletim: 701 }), // empresa sem dados do SAP nesta rodada: sem diagnóstico
      ],
      logs: { SBOAGROPECUARIALOCKS: new Map([
        ['9000000000000000001', { msg: 'Error -10 - Quantity falls into negative inventory  [IGE1.ItemCode][line: 1]', n: 6, primeira: '2026-10-03', ultima: '2026-10-06' }],
        ['9000000000000000002', { msg: 'Error -10 - Quantity falls into negative inventory  [IGE1.ItemCode][line: 1]', n: 4, primeira: '2026-10-04', ultima: '2026-10-05' }],
        ['9000000000000000003', { msg: 'Adicionado  579188', n: 1, primeira: '2026-10-03', ultima: '2026-10-03' }],
      ]) },
      sap: { SBOAGROPECUARIALOCKS: {
        itens: new Map([['I1', { nome: 'SEMENTE', un: 'KG', inativo: false }], ['I2', { nome: 'INOCULANTE', un: 'LT', inativo: true }], ['I3', { nome: 'ADUBO', un: 'KG', inativo: false }]]),
        saldo: new Map([['I1|1001', 820], ['I2|1001', 30]]),
      } },
      depositosSap: { SBOAGROPECUARIALOCKS: new Map([['1001', { nome: 'DEP', inativo: false }], ['1009', { nome: 'VELHO', inativo: true }]]) },
    });
    expect(Object.keys(r)).toEqual(['DOURADO', 'SM3']);
    const [f, p1, p2, p3, p4] = r.DOURADO;
    expect(f).toEqual({
      o: 'P', n: '501', d: '2026-10-02', os: 10, eq: 'COORD A', sit: 'F', em: '2026-10-03 16:57', t: 6, p1: '2026-10-03', ul: '2026-10-06',
      m: ['Error -10 - Quantity falls into negative inventory [IGE1.ItemCode][line: 1]'],
      it: [{ c: 'I2', nm: 'INOCULANTE', q: 4, u: 'LT', dp: '1001', s: 30, pr: ['item-inativo'] }, { c: 'I1', nm: 'SEMENTE', q: 800, u: 'KG', dp: '1001', s: 820 }],
    });
    // o boletim recusado já compromete 800 dos 820: o pendente seguinte não cabe mais
    expect(p1.it).toEqual([{ c: 'I1', nm: 'SEMENTE', q: 60, u: 'KG', dp: '1001', s: 820, ant: 800, pr: ['sem-estoque'] }]);
    expect(p2.it[0].pr).toEqual(['deposito-inativo', 'item-inexistente']);
    expect(p3.it[0].pr).toEqual(['item-fora-deposito']);
    expect(p4).toMatchObject({ n: '604', sit: 'P', si: 1, it: [] });
    expect(r.SM3[0].it).toEqual([{ c: 'I1', nm: 'NOME DO PIMS', q: 60, u: '', dp: '1001' }]);
  });

  it('páginas novas: as consultas de apontamentos recentes, necessidade, dose e coletor', () => {
    expect(diaAnterior(new Date(2026, 9, 6, 21, 40), 2)).toBe('2026-10-04');
    expect(diaAnterior(new Date(2026, 9, 1, 8, 0), 2)).toBe('2026-09-29');
    const ap = montarSqlApontamentosRecentes('2026-10-04', 4000, 4000);
    expect(ap).toContain("(DT_OPERACAO >= '2026-10-04' OR LAST_UPDATE >= '2026-10-04')");
    expect(ap).toContain("(a.DT_OPERACAO >= '2026-10-04' OR a.LAST_UPDATE >= '2026-10-04')");
    expect(ap).toContain('lc.ha AS plan_talhao, tot.ha AS exec_talhao');
    expect(ap).toMatch(/OFFSET 4000 ROWS FETCH NEXT 4000 ROWS ONLY$/);
    const nec = montarSqlNecessidadeValidacao('2026-08-01');
    expect(nec).toContain("WHERE os.FG_SITUACAO = 'A' AND os.DT_ABERTURA >= '2026-08-01'");
    expect(nec).toContain('co.CONSUMO_TOTAL AS planejado, ISNULL(ci.q, 0) + ISNULL(cp.q, 0) AS consumido');
    expect(montarSqlDoseValidacao('2026-09-26')).toContain("a.DT_OPERACAO >= '2026-09-26' AND l.QT_DOSE_PROG > 0 AND ABS(l.QT_DOSE_REAL - l.QT_DOSE_PROG) / l.QT_DOSE_PROG > 0.1");
    expect(montarSqlDoseValidacao('2026-09-26')).toContain('a.DE_OBSERVACAO AS obs'); // a justificativa da variação
    const col = montarSqlColetorValidacao('2026-08-01');
    expect(col.match(/t\.DT_OPERACAO >= '2026-08-01'/g)).toHaveLength(4);
    expect(col).toContain('APATIVMEC_TMP');
    // a ordem do boletim (pelo id ou pelo número), o planejado e o já apontado no talhão, e o número já usado
    expect(col).toContain('o2.NO_BOLETIM = t.NO_APORDSERVICO');
    expect(col).toContain('f.ID_UPNIVEL3 = t.ID_UPNIVEL3) AS exec_talhao');
    expect(col).toContain('f.NO_BOLETIM = t.NO_BOLETIM AND f.ID_UNIDADEADM = t.ID_UNIDADEADM) AS ja_no_pims');
  });

  it('páginas novas: os dados vão por unidade, com o coordenador em todas as linhas', () => {
    const r = linhasExtras({
      apontamentos: [
        { unidade: 'DOURADO', os: 10, os_sit: 'A', abertura: '2026-10-01', encerramento: null, equipe: 'COORD A', operacao_de: 'PLANTIO', tipo: 'P', boletim: 7001, dia: '2026-10-05', talhao: 'T01', ha: 50.004, lancado: '2026-10-05 18:00', por: 'usuario.um', itens: null, plan_talhao: 100, exec_talhao: 50.004 },
        { unidade: 'DOURADO', os: null, os_sit: null, abertura: null, encerramento: null, equipe: 'COORD B', operacao_de: 'APLIC', tipo: 'I', boletim: 7002, dia: '2026-10-05', talhao: 'T02', ha: 10, lancado: null, por: null, itens: 0, plan_talhao: null, exec_talhao: null },
        { unidade: null, os: 1, tipo: 'P', boletim: 1, dia: '2026-10-05' }, // sem unidade: fora
      ],
      necessidade: [{ unidade: 'DOURADO', os: 10, equipe: 'COORD A', abertura: '2026-10-01', operacao_de: 'APLIC', item: '000040', nome: 'DUAL HERBICIDA', planejado: 259.9994, consumido: 0 }],
      dose: [
        { unidade: 'SM3', boletim: 9, dia: '2026-10-03', os: 20, equipe: 'COORD C', talhao: '007A', item: '075908', nome: 'CARTAGO', prog: 1.2, dose_real: 0.40071, ha: 156, total: 62.5102, obs: null },
        { unidade: 'SM3', boletim: 10, dia: '2026-10-04', os: 20, equipe: 'COORD C', talhao: '008', item: '075908', nome: 'CARTAGO', prog: 1.2, dose_real: 1.5, ha: 10, total: 15, obs: '  Dose superior\n ajuste de estoque. ' },
      ],
      coletor: [
        { unidade: 'SM3', tipo: 'A', boletim: 1502, dia: '2026-09-29', os: '1762', equipe: 'COORD C', operacao_de: 'ADUBACAO', st: null, msg: null, lancado: '2026-09-29 08:34', por: 'COORD C', talhao: '028', ha: 5, os_sit: 'F', os_ab: '2026-09-24', os_enc: '2026-10-01', plan_talhao: 5, exec_talhao: null, ja_no_pims: 0 },
        { unidade: 'SM3', tipo: 'M', boletim: 9, dia: '2026-09-30', os: null, equipe: 'COORD C', operacao_de: null, st: 'I', msg: 'erro', lancado: null, por: null, talhao: null, ha: null, os_sit: null, os_ab: null, os_enc: null, plan_talhao: null, exec_talhao: null, ja_no_pims: 2 },
      ],
    });
    expect(Object.keys(r)).toEqual(['DOURADO', 'SM3']);
    expect(r.DOURADO.ap).toEqual([
      { os: 10, s: 'A', ab: '2026-10-01', enc: null, eq: 'COORD A', opn: 'PLANTIO', t: 'P', b: 7001, d: '2026-10-05', tl: 'T01', ha: 50, la: '2026-10-05 18:00', por: 'usuario.um', pt: 100, xt: 50 },
      { os: null, s: null, ab: null, enc: null, eq: 'COORD B', opn: 'APLIC', t: 'I', b: 7002, d: '2026-10-05', tl: 'T02', ha: 10, la: null, por: null, pt: null, xt: 0, it: 0 },
    ]);
    expect(r.DOURADO.nec).toEqual([{ os: 10, eq: 'COORD A', ab: '2026-10-01', opn: 'APLIC', c: '000040', nm: 'DUAL HERBICIDA', pl: 259.999, co: 0 }]);
    expect(r.SM3.dose).toEqual([
      { b: 9, d: '2026-10-03', os: 20, eq: 'COORD C', tl: '007A', c: '075908', nm: 'CARTAGO', pg: 1.2, re: 0.4007, ha: 156, q: 62.51 },
      { b: 10, d: '2026-10-04', os: 20, eq: 'COORD C', tl: '008', c: '075908', nm: 'CARTAGO', pg: 1.2, re: 1.5, ha: 10, q: 15, ju: 'Dose superior ajuste de estoque.' },
    ]);
    expect(r.SM3.col).toEqual([
      { t: 'A', b: 1502, d: '2026-09-29', os: '1762', eq: 'COORD C', opn: 'ADUBACAO', st: null, m: '', la: '2026-09-29 08:34', por: 'COORD C', tl: '028', ha: 5, oss: 'F', oab: '2026-09-24', oenc: '2026-10-01', pt: 5, xt: 0 },
      { t: 'M', b: 9, d: '2026-09-30', os: null, eq: 'COORD C', opn: '', st: 'I', m: 'erro', la: null, por: null, dup: 1 },
    ]);
    // e entram na linha da unidade, ao lado das ordens
    const linhas = linhasValidacao({ ordens: [], evolucao: [], coordenadores: [], depositos: [], extras: r }, '2026-10-06T12:00:00.000Z');
    expect(linhas.map((l) => [l.unidade, Object.keys(l.extras)])).toEqual([['DOURADO', ['ap', 'nec', 'dose', 'col']], ['SM3', ['ap', 'nec', 'dose', 'col']]]);
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
