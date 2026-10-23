// Contas da Aderência de utilização (aderencia/logica.js). Rodar: node --test "modulos/aderencia/testes/*.test.mjs"
// Todos os dados daqui são FICTÍCIOS.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const L = createRequire(import.meta.url)('../../../aderencia/logica.js');

const HOJE = '2026-10-23';
const dados = {
  rastreio_desde: '2026-10-20T12:00:00Z',
  fazendas: [{ id: 1, nome: 'Fazenda Norte' }, { id: 2, nome: 'Fazenda Sul' }],
  usuarios: [
    { id: 'a', nome: 'Ana', email: 'ana@teste', perfil: 'colaborador', fazendas: [1], categorias: ['mapas'], criado_em: '2026-09-01T10:00:00Z', ultimo_login: '2026-10-22T12:00:00Z' },
    { id: 'b', nome: 'Beto', email: 'beto@teste', perfil: 'colaborador', fazendas: [2], categorias: ['acompanhamento'], criado_em: '2026-09-01T10:00:00Z', ultimo_login: '2026-09-10T12:00:00Z' },
    { id: 'c', nome: 'Caio', email: 'caio@teste', perfil: 'colaborador', fazendas: [1, 2], categorias: [], criado_em: '2026-10-01T10:00:00Z', ultimo_login: null },
    { id: 'd', nome: 'Duda', email: 'duda@teste', perfil: 'admin', super: true, todas_fazendas: true, fazendas: [], categorias: [], criado_em: '2026-01-01T10:00:00Z', ultimo_login: '2026-10-23T11:00:00Z' },
  ],
  eventos: [
    // [dia, hora, usuário, tipo, módulo, fazenda, detalhe, dispositivo, n, sessões]
    ['2026-10-21', 8, 'a', 'acesso', null, null, null, 'computador', 2, 2],
    ['2026-10-21', 8, 'a', 'modulo', 'mapas', 1, null, 'computador', 1, 1],
    ['2026-10-21', 9, 'a', 'pagina', 'mapas', 1, 'variedades/novo', 'computador', 3, 1],
    ['2026-10-21', 9, 'a', 'relatorio', 'mapas', 1, 'PNG · MAPA_CHUVA_NORTE_01-10-2026_a_15-10-2026', 'computador', 2, 1],
    ['2026-10-21', 9, 'a', 'ativo', 'mapas', 1, null, 'computador', 6, 1],
    ['2026-10-22', 14, 'a', 'acesso', null, null, null, 'celular', 1, 1],
    ['2026-10-22', 14, 'd', 'acesso', null, null, null, 'computador', 1, 1],
    ['2026-10-22', 15, 'd', 'relatorio', 'acompanhamento', 2, 'PDF · REVISTA_PLANTIO_SUL', 'computador', 1, 1],
    ['2026-09-01', 10, 'a', 'acesso', null, null, null, 'computador', 9, 9], // fora do período
  ],
  pedidos: [['2026-10-22', 'd', 'validacao', 2]],
  mapas: [['2026-10-21', 'a', 'variedade', 1, 1]],
};
const montar = (filtro) => L.montar(dados, Object.assign({ de: '2026-10-17', ate: HOJE, fazenda: null, perfil: 'todos' }, filtro), HOJE);

test('números do topo: cadastrados, ativos, adesão, acessos, relatórios, tempo', () => {
  const r = montar({});
  assert.equal(r.kpis.cadastrados, 4);
  assert.equal(r.kpis.ativos, 2); // Ana e Duda usaram no período
  assert.equal(r.kpis.adesao, 0.5);
  assert.equal(r.kpis.acessos, 4); // o de setembro fica de fora
  assert.equal(r.kpis.relatorios, 3);
  assert.equal(r.kpis.mapasSalvos, 1);
  assert.equal(r.kpis.pedidos, 2);
  assert.equal(r.kpis.minutos, 30);
  assert.equal(r.kpis.nunca, 1); // Caio
  assert.equal(r.kpis.semAcesso30, 1); // Beto: último login em 10/09
});

test('por usuário: percentual dos acessos, dias ativos, frequência, módulos e situação', () => {
  const r = montar({});
  const ana = r.usuarios.find((u) => u.id === 'a');
  assert.equal(r.usuarios[0].id, 'a'); // mais acessos primeiro
  assert.equal(ana.acessos, 3);
  assert.equal(ana.pctAcessos, 0.75);
  assert.equal(ana.diasAtivos, 2);
  assert.equal(ana.frequencia, 2 / 7);
  assert.deepEqual(ana.modulos, ['mapas']);
  assert.equal(ana.situacao, 'ativo');
  assert.deepEqual(ana.dispositivos, { computador: 2, celular: 1 });
  assert.equal(r.usuarios.find((u) => u.id === 'b').situacao, 'inativo');
  assert.equal(r.usuarios.find((u) => u.id === 'c').situacao, 'nunca');
  assert.deepEqual(r.atencao.map((u) => u.id), ['c', 'b']); // nunca acessou primeiro, depois o mais antigo
});

test('por unidade: liberados, ativos, adesão e o que foi feito com a fazenda escolhida', () => {
  const r = montar({});
  const norte = r.unidades.find((u) => u.id === 1);
  const sul = r.unidades.find((u) => u.id === 2);
  assert.deepEqual([norte.liberados, norte.ativos, norte.adesao], [2, 1, 0.5]); // Ana e Caio; só Ana usou
  assert.equal(norte.acoes, 3 + 1 + 2); // módulo, telas e relatórios (o tempo não conta como ação)
  assert.equal(norte.mapas, 1);
  assert.equal(norte.minutos, 30);
  assert.deepEqual([sul.liberados, sul.ativos, sul.relatorios], [2, 0, 1]); // Beto e Caio; o PDF foi da Duda (administradora)
});

test('filtro por unidade e por perfil', () => {
  assert.deepEqual(montar({ fazenda: 2 }).usuarios.map((u) => u.id).sort(), ['b', 'c', 'd']); // administradora vê todas
  assert.deepEqual(montar({ perfil: 'colaborador' }).usuarios.map((u) => u.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(montar({ perfil: 'admin' }).usuarios.map((u) => u.id), ['d']);
});

test('série por dia, módulos, relatórios, telas, horários e dispositivos', () => {
  const r = montar({});
  assert.equal(r.serie.length, 7);
  assert.deepEqual(r.serie.find((d) => d.dia === '2026-10-21'), { dia: '2026-10-21', ativos: 1, acessos: 2, relatorios: 2, minutos: 30, mapas: 1, semana: 3 });
  assert.equal(r.serie.find((d) => d.dia === '2026-10-22').ativos, 2);
  assert.deepEqual(r.modulos.map((m) => [m.modulo, m.usuarios]), [['mapas', 1], ['acompanhamento', 1]]);
  assert.deepEqual(r.relatorios.porTipo, [{ nome: 'PNG', n: 2 }, { nome: 'PDF', n: 1 }]);
  assert.equal(r.relatorios.top[0].nome, 'Mapas · MAPA CHUVA NORTE (PNG)');
  assert.deepEqual(r.relatorios.mapas, [{ nome: 'Mapa de variedade', n: 1 }]);
  assert.deepEqual(r.relatorios.pedidos, [{ nome: 'Atualizar validação', n: 2 }]);
  assert.deepEqual(r.telas, [{ nome: 'Mapas › variedades/novo', n: 3, usuarios: 1 }]);
  assert.equal(r.calor[3][9], 3 + 2 + 6); // quarta-feira, 9h
  assert.deepEqual(r.dispositivos, { computador: 3, celular: 1, tablet: 0 });
});

test('períodos prontos, período anterior, variação e situação', () => {
  assert.deepEqual(L.periodo('7', HOJE), { de: '2026-10-17', ate: HOJE });
  assert.deepEqual(L.periodo('mes', HOJE), { de: '2026-10-01', ate: HOJE });
  assert.deepEqual(L.periodo('mes-passado', HOJE), { de: '2026-09-01', ate: '2026-09-30' });
  assert.deepEqual(L.periodo('tudo', HOJE, '2026-10-20'), { de: '2026-10-20', ate: HOJE });
  assert.deepEqual(L.periodoAnterior('2026-10-17', '2026-10-23'), { de: '2026-10-10', ate: '2026-10-16' });
  assert.deepEqual(L.variacao(12, 8), { dif: 4, pct: 0.5 });
  assert.deepEqual(L.variacao(3, 0), { dif: 3, pct: null });
  assert.equal(L.situacao('2026-10-16', HOJE), 'ativo');
  assert.equal(L.situacao('2026-10-01', HOJE), 'esfriando');
  assert.equal(L.situacao(null, HOJE), 'nunca');
  assert.equal(L.hojeCuiaba(new Date('2026-10-24T03:30:00Z')), '2026-10-23'); // 23h30 em Cuiabá
});

test('CSV dos usuários: separador ";" e nome que começa com "=" não vira fórmula', () => {
  const r = L.montar(Object.assign({}, dados, { usuarios: [{ id: 'x', nome: '=SOMA(1)', email: 'x@teste', perfil: 'colaborador', fazendas: [1] }], eventos: [] }), { de: '2026-10-17', ate: HOJE, fazenda: null, perfil: 'todos' }, HOJE);
  const csv = L.csvUsuarios(r).split('\r\n');
  assert.equal(csv[0].split(';')[0], 'Usuário');
  assert.ok(csv[1].startsWith("'=SOMA(1);x@teste;Colaborador;Fazenda Norte;0;"));
});
