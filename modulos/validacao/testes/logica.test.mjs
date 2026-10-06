// Contas da Validação PIMS (validacao/logica.js). Rodar: node --test "modulos/validacao/testes/*.test.mjs"
// Todos os dados daqui são FICTÍCIOS.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const L = createRequire(import.meta.url)('../../../validacao/logica.js');

const HOJE = '2026-10-06';
const ordem = (extra) => Object.assign({ os: 1, eq: 'COORD A', op: 10, opn: 'PLANTIO', s: 'A', ab: HOJE, enc: null, pl: 100, ex: 0, nt: 2, ult: null, ev: [] }, extra);

test('prazo: até 2 dias verde, de 3 a 5 amarelo, acima de 5 vermelho', () => {
  assert.equal(L.classificarPrazo(0), 'ok');
  assert.equal(L.classificarPrazo(2), 'ok');
  assert.equal(L.classificarPrazo(3), 'atencao');
  assert.equal(L.classificarPrazo(5), 'atencao');
  assert.equal(L.classificarPrazo(6), 'atraso');
  assert.equal(L.classificarPrazo(null), 'atraso');
});

test('dias em aberto contam dias corridos, sem depender de fuso', () => {
  assert.equal(L.diasEmAberto('2026-10-06', HOJE), 0);
  assert.equal(L.diasEmAberto('2026-10-01', HOJE), 5);
  assert.equal(L.diasEmAberto('2026-09-28', HOJE), 8);
  assert.equal(L.diasEmAberto('2026-10-09', HOJE), 0); // data no futuro não vira prazo negativo
  assert.equal(L.diasEmAberto(null, HOJE), null);
});

test('ordem aberta: falta = 5 − dias em aberto e os textos acompanham', () => {
  const o = L.ordemAberta(ordem({ ab: '2026-10-04', ex: 40 }), HOJE);
  assert.equal(o.dias, 2);
  assert.equal(o.falta, 3);
  assert.equal(o.prazo, 'ok');
  assert.equal(o.aRealizar, 60);
  assert.equal(o.excedeu, false);
  assert.equal(L.textoFalta(3), 'faltam 3 dias');
  assert.equal(L.textoFalta(1), 'falta 1 dia');
  assert.equal(L.textoFalta(0), 'vence hoje');
  assert.equal(L.textoFalta(-1), '1 dia acima do prazo');
  assert.equal(L.textoFalta(-4), '4 dias acima do prazo');
});

test('área apontada maior que a planejada: a realizar negativa e alerta', () => {
  const o = L.ordemAberta(ordem({ pl: 100, ex: 112.5 }), HOJE);
  assert.equal(o.aRealizar, -12.5);
  assert.equal(o.excedeu, true);
  // exatamente no planejado não é excesso
  assert.equal(L.ordemAberta(ordem({ pl: 100, ex: 100 }), HOJE).excedeu, false);
});

test('operação que não aponta área: vale só o prazo, sem alerta de área', () => {
  const o = L.ordemAberta(ordem({ pl: 500, ex: 0, sa: 1, ab: '2026-09-20' }), HOJE);
  assert.equal(o.semArea, true);
  assert.equal(o.excedeu, false);
  assert.equal(o.prazo, 'atraso');
});

test('abertas por coordenador: agrupa, soma e põe quem tem mais atraso na frente', () => {
  const linhas = [{
    unidade: 'FAZENDA X',
    ordens: [
      ordem({ os: 1, eq: 'COORD A', ab: '2026-10-05' }),
      ordem({ os: 2, eq: 'COORD B', ab: '2026-09-25', pl: 50, ex: 60 }),
      ordem({ os: 3, eq: 'COORD B', ab: '2026-10-02' }),
      ordem({ os: 4, eq: 'COORD B', ab: '2026-10-03', pl: 300, sa: 1 }),
      ordem({ os: 5, eq: 'COORD A', s: 'F', enc: '2026-10-01' }),
      ordem({ os: 6, eq: 'COORD A', ab: '2025-03-10' }), // aberta bem antes do período
    ],
  }];
  const r = L.abertasPorCoordenador(linhas, HOJE, { de: '2026-09-01', ate: HOJE });
  assert.equal(r.escondidas, 1);
  assert.equal(r.maisAntiga, '2025-03-10');
  assert.deepEqual(r.grupos.map((g) => g.eq), ['COORD B', 'COORD A']);
  const b = r.grupos[0];
  assert.deepEqual(b.ordens.map((o) => o.os), [2, 3, 4]); // da mais antiga para a mais nova
  assert.equal(b.atraso, 1);
  assert.equal(b.atencao, 2);
  assert.equal(b.excedidas, 1);
  assert.equal(b.pl, 150); // a ordem sem área não entra na soma de hectares
  assert.deepEqual(L.resumoAbertas(r.grupos), { ordens: 4, ok: 1, atencao: 2, atraso: 1, excedidas: 1, coordenadores: 2 });

  const semPeriodo = L.abertasPorCoordenador(linhas, HOJE, {});
  assert.equal(semPeriodo.escondidas, 0);
  assert.equal(L.resumoAbertas(semPeriodo.grupos).ordens, 5);
  // padrão da tela: do primeiro dia do mês até hoje, pela data de abertura
  const doMes = L.abertasPorCoordenador(linhas, HOJE, { de: L.inicioDoMes(HOJE), ate: HOJE });
  assert.deepEqual(doMes.grupos.flatMap((g) => g.ordens.map((o) => o.os)).sort(), [1, 3, 4]);
  assert.equal(doMes.escondidas, 2);
  assert.equal(doMes.maisAntiga, '2025-03-10');
  assert.equal(L.abertasPorCoordenador(linhas, HOJE, { de: '2026-10-01', ate: '2026-10-02' }).grupos[0].ordens[0].os, 3);
  assert.equal(L.abertasPorCoordenador(linhas, HOJE, { equipe: 'COORD A' }).grupos.length, 1);
  assert.equal(L.abertasPorCoordenador(linhas, HOJE, { unidade: 'OUTRA' }).grupos.length, 0);
});

test('fechadas com diferença: separa as que faltam das que sobram, da maior para a menor', () => {
  const linhas = [{
    unidade: 'FAZENDA X',
    ordens: [
      ordem({ os: 10, s: 'F', pl: 200, ex: 150 }),
      ordem({ os: 11, s: 'F', pl: 100, ex: 20 }),
      ordem({ os: 12, s: 'F', pl: 80, ex: 95.5 }),
      ordem({ os: 13, s: 'F', pl: 400, ex: 0, sa: 1 }), // operação sem área: fora
      ordem({ os: 14, s: 'A', pl: 10, ex: 30 }), // aberta: fora
    ],
  }];
  const r = L.fechadasComDiferenca(linhas, {});
  assert.deepEqual(r.faltando.map((o) => [o.os, o.dif]), [[11, -80], [10, -50]]);
  assert.deepEqual(r.sobrando.map((o) => [o.os, o.dif]), [[12, 15.5]]);
  assert.equal(L.fechadasComDiferenca(linhas, { equipe: 'NINGUEM' }).faltando.length, 0);
});

test('fechadas com diferença: o período vale pela data de encerramento', () => {
  const linhas = [{
    unidade: 'FAZENDA X',
    ordens: [
      ordem({ os: 20, s: 'F', enc: '2026-09-28', pl: 100, ex: 50 }),
      ordem({ os: 21, s: 'F', enc: '2026-10-01', pl: 100, ex: 60 }),
      ordem({ os: 22, s: 'F', enc: '2026-10-06', pl: 100, ex: 130 }),
    ],
  }];
  const r = L.fechadasComDiferenca(linhas, { de: L.inicioDoMes(HOJE), ate: HOJE });
  assert.deepEqual(r.faltando.map((o) => o.os), [21]);
  assert.deepEqual(r.sobrando.map((o) => o.os), [22]);
  assert.equal(L.fechadasComDiferenca(linhas, { ate: '2026-09-30' }).faltando[0].os, 20);
  assert.equal(L.fechadasComDiferenca(linhas, {}).faltando.length, 2);
});

test('período: primeiro dia do mês e limites inclusive', () => {
  assert.equal(L.inicioDoMes('2026-10-06'), '2026-10-01');
  assert.equal(L.inicioDoMes('2026-01-31'), '2026-01-01');
  assert.equal(L.noPeriodo('2026-10-01', { de: '2026-10-01', ate: '2026-10-06' }), true);
  assert.equal(L.noPeriodo('2026-10-06', { de: '2026-10-01', ate: '2026-10-06' }), true);
  assert.equal(L.noPeriodo('2026-09-30', { de: '2026-10-01', ate: '2026-10-06' }), false);
  assert.equal(L.noPeriodo('2026-10-07', { de: '2026-10-01', ate: '2026-10-06' }), false);
  assert.equal(L.noPeriodo(null, { de: '2026-10-01' }), false);
  assert.equal(L.noPeriodo(null, {}), true);
});

test('coordenadores com vínculo: junta os da safra, os de ordem antiga e os já vinculados', () => {
  const linhas = [{
    unidade: 'FAZENDA X',
    coordenadores: [{ eq: 'COORD A', ab: 1, n: 7 }],
    ordens: [ordem({ os: 1, eq: 'COORD A' }), ordem({ os: 2, eq: 'COORD ANTIGO', ab: '2025-01-01' })],
  }];
  const vinculos = [{ unidade: 'FAZENDA X', equipe: 'COORD A', deposito: '1001', deposito_origem: '1000' }];
  const r = L.coordenadoresComVinculo(linhas, vinculos, {});
  assert.deepEqual(r.map((c) => [c.eq, c.abertas, c.ordens, c.deposito, c.origem]), [
    ['COORD A', 1, 7, '1001', '1000'],
    ['COORD ANTIGO', 1, 0, null, null],
  ]);
});

test('saldo do coordenador: itens do depósito dele com o saldo do mesmo item na origem', () => {
  const linha = {
    unidade: 'FAZENDA X',
    depositos: [{ c: '1001', n: 'DEP COORD A' }, { c: '1000', n: 'DEP CENTRAL' }],
    estoque: {
      1001: [{ c: 'I1', n: 'PRODUTO UM', q: 12, u: 'L' }, { c: 'I2', n: 'PRODUTO DOIS', q: 3.5, u: 'KG' }],
      1000: [{ c: 'I1', n: 'PRODUTO UM', q: 400, u: 'L' }],
    },
  };
  assert.equal(L.saldoDoCoordenador(linha, null), null);
  assert.equal(L.saldoDoCoordenador(linha, { deposito: null }), null);
  const s = L.saldoDoCoordenador(linha, { deposito: '1001', deposito_origem: '1000' });
  assert.equal(s.depositoNome, 'DEP COORD A');
  assert.equal(s.origemNome, 'DEP CENTRAL');
  assert.equal(s.pendente, false);
  assert.deepEqual(s.itens.map((i) => [i.c, i.q, i.origem]), [['I1', 12, 400], ['I2', 3.5, 0]]);
  // vínculo salvo agora: o servidor ainda não leu o saldo
  assert.equal(L.saldoDoCoordenador(linha, { deposito: '2222', deposito_origem: null }).pendente, true);
  // sem depósito de origem não há coluna de origem
  assert.equal(L.saldoDoCoordenador(linha, { deposito: '1001', deposito_origem: null }).itens[0].origem, null);
});

test('início da safra, unidade da fazenda e título', () => {
  assert.equal(L.inicioSafra('2026-10-06'), '2026-08-01');
  assert.equal(L.inicioSafra('2026-07-31'), '2025-08-01');
  assert.equal(L.unidadeDaFazenda('Fazenda Três Flechas', ['DOURADO', 'TRES FLECHAS']), 'TRES FLECHAS');
  assert.equal(L.unidadeDaFazenda('Outra', ['DOURADO']), null);
  assert.equal(L.titulo('TRES FLECHAS'), 'Tres Flechas');
  assert.equal(L.titulo('SM3'), 'SM3');
});
