// Contas da Aderência de utilização (aderencia/logica.js). Rodar: node --test "modulos/aderencia/testes/*.test.mjs"
// Todos os dados daqui são FICTÍCIOS.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const L = createRequire(import.meta.url)('../../../aderencia/logica.js');

const HOJE = '2026-10-23'; // sexta-feira
const dados = {
  rastreio_desde: '2026-10-21T11:00:00Z',
  historico_desde: '2026-07-28T19:50:00Z',
  fazendas: [{ id: 1, nome: 'Fazenda Norte' }, { id: 2, nome: 'Fazenda Sul' }],
  usuarios: [
    // Ana entrou com senha em setembro e usa todo dia com a sessão salva: o último uso é de hoje
    { id: 'a', nome: 'Ana', email: 'ana@teste', perfil: 'colaborador', fazendas: [1], categorias: ['mapas'], criado_em: '2026-09-01T10:00:00Z', ultimo_login: '2026-09-10T12:00:00Z', ultimo_uso: '2026-10-23T12:00:00Z' },
    { id: 'b', nome: 'Beto', email: 'beto@teste', perfil: 'colaborador', fazendas: [2], categorias: ['acompanhamento'], criado_em: '2026-09-01T10:00:00Z', ultimo_login: '2026-09-10T12:00:00Z', ultimo_uso: '2026-09-10T12:00:00Z' },
    { id: 'c', nome: 'Caio', email: 'caio@teste', perfil: 'colaborador', fazendas: [1, 2], categorias: [], criado_em: '2026-10-01T10:00:00Z', ultimo_login: null, ultimo_uso: null },
    { id: 'd', nome: 'Duda', email: 'duda@teste', perfil: 'admin', super: true, todas_fazendas: true, fazendas: [], categorias: [], criado_em: '2026-01-01T10:00:00Z', ultimo_login: '2026-10-22T11:00:00Z', ultimo_uso: '2026-10-22T20:00:00Z' },
  ],
  // histórico do Supabase: [dia, hora, usuário, aparelho, n]
  renovacoes: [
    ['2026-10-20', 9, 'a', 'computador', 1], ['2026-10-20', 10, 'a', 'computador', 1], ['2026-10-20', 14, 'a', 'celular', 1],
    ['2026-10-22', 9, 'a', 'computador', 2],
    ['2026-09-05', 9, 'b', 'computador', 1], // fora do período
  ],
  logins: [['2026-10-20', 8, 'a', 'computador', 1]],
  eventos: [
    // [dia, hora, usuário, tipo, módulo, fazenda, detalhe, dispositivo, n, sessões]
    ['2026-10-21', 8, 'a', 'acesso', null, null, null, 'computador', 2, 2],
    ['2026-10-21', 8, 'a', 'entrada', null, null, null, 'computador', 1, 1],
    ['2026-10-21', 8, 'a', 'modulo', 'mapas', 1, null, 'computador', 1, 1],
    ['2026-10-21', 9, 'a', 'pagina', 'mapas', 1, 'variedades/novo', 'computador', 3, 1],
    ['2026-10-21', 9, 'a', 'relatorio', 'mapas', 1, 'PNG · MAPA_CHUVA_NORTE_01-10-2026_a_15-10-2026', 'computador', 2, 1],
    ['2026-10-21', 9, 'a', 'ativo', 'mapas', 1, null, 'computador', 6, 1],
    ['2026-10-22', 14, 'd', 'acesso', null, null, null, 'computador', 1, 1],
    ['2026-10-22', 15, 'd', 'relatorio', 'acompanhamento', 2, 'PDF · REVISTA_PLANTIO_SUL', 'computador', 1, 1],
  ],
  pedidos: [['2026-10-22', 'd', 'validacao', 2, 16]], // [dia, usuário, tipo, n, hora]
  mapas: [['2026-10-21', 'a', 'variedade', 1, 1, 11]], // [dia, usuário, tipo, fazenda, n, hora]
};
const montar = (filtro) => L.montar(dados, Object.assign({ de: '2026-10-17', ate: HOJE, fazenda: null, perfil: 'todos' }, filtro), HOJE);

test('quem usa com a sessão salva aparece ativo, mesmo com o último login antigo', () => {
  const r = montar({});
  const ana = r.usuarios.find((u) => u.id === 'a');
  assert.equal(ana.situacao, 'ativo');
  assert.equal(ana.ultimoAcesso, '2026-10-23');
  assert.equal(r.usuarios.find((u) => u.id === 'b').situacao, 'inativo');
  assert.equal(r.usuarios.find((u) => u.id === 'c').situacao, 'nunca');
});

test('acesso é cada sequência de horas seguidas com uso; dias e horas somam todas as fontes', () => {
  const r = montar({});
  const ana = r.usuarios.find((u) => u.id === 'a');
  // 20/10: 8h a 10h (entrada e renovações) e 14h = 2 acessos, 4 horas
  // 21/10: 8h a 9h (eventos) e 11h (mapa salvo) = 2 acessos, 3 horas
  // 22/10: 9h = 1 acesso, 1 hora; 23/10: o último uso, às 8h = 1 acesso, 1 hora
  assert.equal(ana.acessos, 6);
  assert.equal(ana.horasUso, 9);
  assert.equal(ana.diasAtivos, 4);
  assert.deepEqual(ana.dias, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.equal(ana.entradas, 2); // a do Supabase em 20/10 e a da plataforma em 21/10
  assert.equal(ana.pctAcessos, 6 / 8);
  assert.equal(ana.frequencia, 4 / 7);
  assert.deepEqual(ana.dispositivos, { computador: 3, celular: 1, desconhecido: 2 });
  assert.deepEqual(ana.modulos, ['mapas']);
  const duda = r.usuarios.find((u) => u.id === 'd');
  assert.deepEqual([duda.acessos, duda.horasUso, duda.pedidos, duda.relatorios], [2, 4, 2, 1]); // o login às 7h; 14h, 15h e o pedido às 16h
  assert.equal(r.usuarios[0].id, 'a'); // mais acessos primeiro
  assert.deepEqual(r.atencao.map((u) => u.id), ['c', 'b']); // nunca acessou primeiro, depois o mais antigo
});

test('números do topo', () => {
  const k = montar({}).kpis;
  assert.deepEqual(
    [k.cadastrados, k.ativos, k.adesao, k.acessos, k.entradas, k.relatorios, k.mapasSalvos, k.pedidos, k.horas, k.ativos7, k.nunca, k.semAcesso30],
    [4, 2, 0.5, 8, 2, 3, 1, 2, 13, 2, 1, 1],
  );
  assert.equal(k.mediaAtivosDia, 5 / 7); // 20, 21, 22 (dois usuários) e 23
});

test('série por dia, horários e dispositivos', () => {
  const r = montar({});
  assert.equal(r.serie.length, 7);
  assert.deepEqual(r.serie.find((d) => d.dia === '2026-10-20'), { dia: '2026-10-20', ativos: 1, acessos: 2, relatorios: 0, horas: 4, mapas: 0, semana: 2 });
  assert.deepEqual(r.serie.find((d) => d.dia === '2026-10-21'), { dia: '2026-10-21', ativos: 1, acessos: 2, relatorios: 2, horas: 3, mapas: 1, semana: 3 });
  assert.deepEqual(r.serie.find((d) => d.dia === '2026-10-22'), { dia: '2026-10-22', ativos: 2, acessos: 3, relatorios: 1, horas: 5, mapas: 0, semana: 4 });
  assert.deepEqual([r.calor[2][8], r.calor[2][14], r.calor[3][11], r.calor[4][9], r.calor[4][16], r.calor[4][10]], [1, 1, 1, 1, 1, 0]);
  assert.deepEqual(r.dispositivos, { computador: 4, celular: 1, tablet: 0, desconhecido: 3 });
});

test('por unidade, módulo, relatórios e telas', () => {
  const r = montar({});
  const norte = r.unidades.find((u) => u.id === 1);
  const sul = r.unidades.find((u) => u.id === 2);
  assert.deepEqual([norte.liberados, norte.ativos, norte.adesao, norte.acessos, norte.horas], [2, 1, 0.5, 6, 9]); // Ana e Caio; só Ana usou
  assert.equal(norte.acoes, 1 + 3 + 2); // módulo, telas e relatórios com a Norte escolhida (o tempo não é ação)
  assert.equal(norte.mapas, 1);
  assert.deepEqual([sul.liberados, sul.ativos, sul.acessos, sul.relatorios], [2, 0, 0, 1]); // o PDF foi da Duda (administradora)
  assert.deepEqual(r.modulos.map((m) => [m.modulo, m.usuarios, m.horas]), [['mapas', 1, 3], ['acompanhamento', 1, 1]]);
  assert.deepEqual(r.relatorios.porTipo, [{ nome: 'PNG', n: 2 }, { nome: 'PDF', n: 1 }]);
  assert.equal(r.relatorios.top[0].nome, 'Mapas · MAPA CHUVA NORTE (PNG)');
  assert.deepEqual(r.relatorios.mapas, [{ nome: 'Mapa de variedade', n: 1 }]);
  assert.deepEqual(r.relatorios.pedidos, [{ nome: 'Atualizar validação', n: 2 }]);
  assert.deepEqual(r.telas, [{ nome: 'Mapas › variedades/novo', n: 3, usuarios: 1 }]);
});

test('mês antigo: quem ainda não tinha cadastro fica de fora; o horário do último login conta como uso', () => {
  const r = L.montar(dados, { de: '2026-09-01', ate: '2026-09-30', fazenda: null, perfil: 'todos' }, HOJE);
  assert.deepEqual(r.usuarios.map((u) => u.id).sort(), ['a', 'b', 'd']); // Caio foi cadastrado em 01/10
  const ana = r.usuarios.find((u) => u.id === 'a');
  assert.deepEqual([ana.acessos, ana.diasAtivos, ana.horasUso], [1, 1, 1]); // o login de 10/09 (sem nenhuma sessão guardada)
  assert.deepEqual(r.usuarios.find((u) => u.id === 'b').dias, ['2026-09-05', '2026-09-10']);
  assert.equal(r.kpis.cadastrados, 3);
});

test('filtro por unidade e por perfil', () => {
  assert.deepEqual(montar({ fazenda: 2 }).usuarios.map((u) => u.id).sort(), ['b', 'c', 'd']); // administradora vê todas
  assert.deepEqual(montar({ perfil: 'colaborador' }).usuarios.map((u) => u.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(montar({ perfil: 'admin' }).usuarios.map((u) => u.id), ['d']);
});

test('grade dos últimos dias e sinal sem hora (dado antigo)', () => {
  const g = L.atividadePorDia(dados, new Set(['a', 'b']));
  assert.deepEqual(g.get('a').get('2026-10-20'), { acessos: 2, horas: 4 });
  assert.deepEqual(g.get('b').get('2026-09-05'), { acessos: 1, horas: 1 });
  const semHora = L.montar({ usuarios: [dados.usuarios[1]], pedidos: [['2026-10-18', 'b', 'plantio', 1]] }, { de: '2026-10-17', ate: HOJE, fazenda: null, perfil: 'todos' }, HOJE);
  assert.deepEqual([semHora.usuarios[0].acessos, semHora.usuarios[0].horasUso, semHora.usuarios[0].diasAtivos], [1, 0, 1]);
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
  assert.ok(csv[0].includes('Horas de uso'));
  assert.ok(csv[1].startsWith("'=SOMA(1);x@teste;Colaborador;Fazenda Norte;0;"));
});

test('dias ativos contam desde o cadastro; ações em outras tabelas contam como uso', () => {
  // Caio foi cadastrado em 01/10: no período de 24/09 a 23/10 ele só podia usar em 23 dias
  const base = Object.assign({}, dados, { acoes: [['2026-10-15', 10, 'c', 1], ['2026-10-16', 9, 'c', 2]] }); // [dia, hora, usuário, n]
  const r = L.montar(base, { de: '2026-09-24', ate: HOJE, fazenda: null, perfil: 'todos' }, HOJE);
  const caio = r.usuarios.find((u) => u.id === 'c');
  assert.deepEqual([caio.diasAtivos, caio.diasPossiveis, caio.desdeCadastro, caio.acessos, caio.horasUso], [2, 23, true, 2, 2]);
  assert.equal(caio.frequencia, 2 / 23);
  assert.equal(caio.situacao, 'ativo'); // uma meta salva em 16/10 é uso
  const ana = r.usuarios.find((u) => u.id === 'a'); // cadastrada em 01/09: vale o período inteiro
  assert.deepEqual([ana.diasPossiveis, ana.desdeCadastro], [30, false]);
  assert.ok(L.csvUsuarios(r).split('\r\n')[0].includes('Dias possíveis'));
});
