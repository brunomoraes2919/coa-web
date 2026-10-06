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
  const vinculos = [{ unidade: 'FAZENDA X', equipe: 'COORD A', deposito: '1001' }];
  const r = L.coordenadoresComVinculo(linhas, vinculos, {});
  assert.deepEqual(r.map((c) => [c.eq, c.abertas, c.ordens, c.deposito]), [
    ['COORD A', 1, 7, '1001'],
    ['COORD ANTIGO', 1, 0, null],
  ]);
});

test('saldo do coordenador: cada item com a sua origem (última transferência do SAP) e o saldo lá', () => {
  const linha = {
    unidade: 'FAZENDA X',
    depositos: [{ c: '1001', n: 'DEP COORD A' }, { c: '1000', n: 'DEP ADUBOS' }],
    estoque: {
      1001: [
        { c: 'I1', n: 'ADUBO UM', q: 12, u: 'KG', o: '1000', on: 'ADUBOS', oq: 400, od: '2026-09-30' },
        { c: 'I2', n: 'ADUBO DOIS', q: 3.5, u: 'KG', o: '1000', on: '', oq: 0 },
        { c: 'I3', n: 'SEMENTE', q: 8, u: 'SC', o: '1007', on: 'SEMENTES', oq: 55.5, od: '2026-10-01' },
        { c: 'I4', n: 'ITEM SEM TRANSFERENCIA', q: 1, u: 'UN' },
      ],
    },
  };
  assert.equal(L.saldoDoCoordenador(linha, null), null);
  assert.equal(L.saldoDoCoordenador(linha, { deposito: null }), null);
  const s = L.saldoDoCoordenador(linha, { deposito: '1001' });
  assert.equal(s.depositoNome, 'DEP COORD A');
  assert.equal(s.pendente, false);
  assert.deepEqual(s.itens.map((i) => [i.c, i.q, i.origem, i.origemNome, i.origemSaldo, i.transferidoEm]), [
    ['I1', 12, '1000', 'ADUBOS', 400, '2026-09-30'],
    ['I2', 3.5, '1000', 'DEP ADUBOS', 0, null], // sem nome do SAP: vale o da lista de depósitos da unidade
    ['I3', 8, '1007', 'SEMENTES', 55.5, '2026-10-01'],
    ['I4', 1, null, '', null, null],
  ]);
  // o depósito recebe de mais de uma origem: a que abastece mais itens vem primeiro
  assert.deepEqual(s.origens, [{ c: '1000', n: 'ADUBOS', itens: 2 }, { c: '1007', n: 'SEMENTES', itens: 1 }]);
  // vínculo salvo agora: o servidor ainda não leu o saldo
  assert.equal(L.saldoDoCoordenador(linha, { deposito: '2222' }).pendente, true);
  // retrato antigo (sem origem nos itens): nada quebra
  const antigo = L.saldoDoCoordenador({ unidade: 'X', depositos: [], estoque: { 1001: [{ c: 'I1', n: 'A', q: 1, u: 'L' }] } }, { deposito: '1001' });
  assert.deepEqual(antigo.origens, []);
  assert.equal(antigo.itens[0].origem, null);
});

test('detalhe da ordem: planejado × apontado por talhão e os apontamentos um a um', () => {
  const d = L.detalheDaOrdem(ordem({
    tl: [['T19', 65.5], ['T18', 81.25]],
    ap: [
      ['2026-10-01', 9001, 'T18', 100, '2026-10-01 18:40', 'usuario.um'],
      ['2026-10-02', 9002, 'T18', 62.5, null, null],
      ['2026-10-02', 9002, 'T77', 5, null, 'usuario.dois'],
    ],
  }));
  assert.equal(d.pendente, false);
  assert.deepEqual(d.talhoes, [
    { t: 'T19', pl: 65.5, ex: 0, falta: 65.5, fora: false, excedeu: false },
    { t: 'T18', pl: 81.25, ex: 162.5, falta: -81.25, fora: false, excedeu: true }, // apontou tudo num talhão só
    { t: 'T77', pl: 0, ex: 5, falta: -5, fora: true, excedeu: false }, // talhão que não está na ordem
  ]);
  assert.deepEqual(d.apontamentos[0], { dia: '2026-10-01', boletim: 9001, talhao: 'T18', ha: 100, lancado: '2026-10-01 18:40', por: 'usuario.um' });
  assert.equal(d.apontamentos.length, 3);
  // ordem sem apontamento ainda
  assert.deepEqual(L.detalheDaOrdem(ordem({ tl: [['T01', 10]], ap: [] })).apontamentos, []);
  // retrato antigo, de antes de o servidor mandar o detalhe
  assert.equal(L.detalheDaOrdem(ordem({})).pendente, true);
  assert.equal(L.detalheDaOrdem(null).pendente, true);
});

test('falha de integração: a mensagem do SAP vira explicação em português', () => {
  const e = L.explicarFalha('Error -10 - Quantity falls into negative inventory  [IGE1.ItemCode][line: 2]');
  assert.equal(e.titulo, 'Estoque insuficiente no SAP');
  assert.match(e.texto, /item da linha 2 do boletim/);
  assert.equal(e.tecnica, false);
  assert.equal(L.explicarFalha('Error -5002 - (1) Centro de custo não definido para a Fazenda Teste').titulo, 'Centro de custo não definido');
  assert.match(L.explicarFalha('Error -5002 - (1) Centro de custo não definido para a Fazenda Teste').texto, /^Centro de custo não definido para a Fazenda Teste\./);
  assert.equal(L.explicarFalha('Error -5002 - 10000515 - Item 057371 not found in Warehouse 1824').texto, 'O item 057371 não está cadastrado no depósito 1824 no SAP.');
  assert.equal(L.explicarFalha('Error -5002 - Inventory account is not defined  [IGE1.AcctCode][line: 1]').titulo, 'Conta de estoque não definida');
  assert.equal(L.explicarFalha('Error -5002 - Enter valid code  [IGE1.OcrCode][line: 16]').titulo, 'Centro de custo inválido no SAP');
  assert.equal(L.explicarFalha('Error -10 - 1470000341 - Fully allocate item "012345" to bin locations in warehouse "1801"').titulo, 'Falta alocar o item numa posição do depósito');
  assert.equal(L.explicarFalha('Error -10 - 131 - Item 000111 is frozen in warehouse 1801 and bin location 1801-BARRACAO-01').titulo, 'Item bloqueado no depósito');
  assert.equal(L.explicarFalha('Error -10 - Invalid XML file -    at SAPbobsCOM.CompanyClass.GetXMLelementCount(String FileName)').tecnica, true);
  // mensagem que a tela não conhece volta como veio
  assert.deepEqual(L.explicarFalha('Error -99 - Algo novo'), { titulo: 'Recusado pelo SAP', texto: 'Error -99 - Algo novo', tecnica: false });
});

test('boletins com problema: recusados, pendentes que vão falhar e pendentes sem problema', () => {
  const linhas = [{
    unidade: 'FAZENDA X',
    boletins: [
      { o: 'P', n: '501', d: '2026-10-02', os: 10, eq: 'COORD A', sit: 'F', em: '2026-10-03 16:57', t: 6, p1: '2026-10-03', ul: '2026-10-06',
        m: ['Error -10 - Quantity falls into negative inventory [IGE1.ItemCode][line: 2]', 'Error -10 - Quantity falls into negative inventory [IGE1.ItemCode][line: 2]'],
        it: [{ c: 'I1', nm: 'SEMENTE', q: 800, u: 'KG', dp: '1001', s: 100, pr: ['sem-estoque'] }, { c: 'I2', nm: 'INOCULANTE', q: 4, u: 'LT', dp: '1001', s: 30 }] },
      { o: 'I', n: '502', d: '2026-09-20', os: 11, eq: 'COORD B', sit: 'F', em: '2026-09-21 08:00', t: 40, p1: '2026-09-21', ul: '2026-10-06', m: ['Error -5002 - Enter valid code [IGE1.OcrCode][line: 1]'], it: [{ c: 'I3', nm: 'HERBICIDA', q: 10, u: 'LT', dp: '1002', s: 90 }] },
      { o: 'I', n: '503', d: '2026-10-05', os: 12, eq: 'COORD A', sit: 'P', em: '2026-10-06 07:15', it: [{ c: 'I3', nm: 'HERBICIDA', q: 10, u: 'LT', dp: '1009', pr: ['deposito-inativo', 'item-fora-deposito'] }] },
      { o: 'I', n: '504', d: '2026-09-01', os: null, eq: null, sit: 'P', em: '2026-09-02 06:40', si: 1, it: [] },
      { o: 'T', n: '505', d: '2026-10-06', os: null, eq: null, sit: 'P', em: null, it: [{ c: 'I4', nm: 'TRATAMENTO', q: 8, u: 'LT', dp: '1001', s: 50 }] },
    ],
  }, { unidade: 'OUTRA', boletins: [{ o: 'C', n: '900', d: '2026-10-01', os: null, eq: null, sit: 'F', em: null, m: [], it: [] }] }];
  const r = L.boletinsComProblema(linhas, HOJE, { unidade: 'FAZENDA X' });
  assert.deepEqual(r.falhas.map((b) => [b.n, b.tipo, b.dias, b.comProblema]), [['502', 'Aplicação de insumo', 15, 0], ['501', 'Plantio', 3, 1]]); // mais antigo primeiro
  assert.deepEqual(r.falhas[1].causas.map((c) => c.titulo), ['Estoque insuficiente no SAP']); // a mesma mensagem não repete
  assert.deepEqual(r.falhas[1].problemas, ['Saldo insuficiente no depósito']);
  assert.equal(r.falhas[1].chave, 'F|FAZENDA X|P|501');
  assert.deepEqual(r.vaoFalhar.map((b) => [b.n, b.problemas]), [
    ['504', ['Boletim sem item lançado']],
    ['503', ['Depósito inativo no SAP', 'Item não cadastrado no depósito']],
  ]);
  assert.deepEqual(r.aguardando.map((b) => b.n), ['505']);
  // filtro de coordenador e todas as fazendas
  assert.deepEqual(L.boletinsComProblema(linhas, HOJE, { equipe: 'COORD A' }).falhas.map((b) => b.n), ['501']);
  assert.equal(L.boletinsComProblema(linhas, HOJE, {}).falhas.length, 3);
  // retrato antigo, sem a lista de boletins
  assert.deepEqual(L.boletinsComProblema([{ unidade: 'X' }], HOJE, {}), { falhas: [], vaoFalhar: [], aguardando: [] });
});

test('início da safra, unidade da fazenda e título', () => {
  assert.equal(L.inicioSafra('2026-10-06'), '2026-08-01');
  assert.equal(L.inicioSafra('2026-07-31'), '2025-08-01');
  assert.equal(L.unidadeDaFazenda('Fazenda Três Flechas', ['DOURADO', 'TRES FLECHAS']), 'TRES FLECHAS');
  assert.equal(L.unidadeDaFazenda('Outra', ['DOURADO']), null);
  assert.equal(L.titulo('TRES FLECHAS'), 'Tres Flechas');
  assert.equal(L.titulo('SM3'), 'SM3');
});
