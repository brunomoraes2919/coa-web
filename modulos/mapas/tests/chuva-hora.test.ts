// Opção "informar a hora" do botão "Inserir dados via integração": o pedido leva, além das datas, a hora
// inicial e a final; o servidor filtra as leituras pela hora que vem no fim do identificador.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { atenderPedidosChuva, pedidosChuvaPendentes } from '../scripts/atender-pedidos.mjs';
import { montarChuvaPics, montarSqlChuvaPics, validarPeriodoChuva } from '../scripts/sincronizar-plantio.mjs';
import { erroPedido } from '../src/data/supabasePedidos';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { lerDadosChuva, picsDaIntegracao, validarPeriodo, type DadosChuvaZeus } from '../src/lib/chuvaZeus';
import { textosAutomaticos } from '../src/lib/editor';
import { fmtPeriodoHora } from '../src/lib/format';
import { BancoFalso } from './helpers/supabaseFalso';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';

// Quem fez os pedidos destes testes: um ADMINISTRADOR+ inventado. Antes de consultar a fonte, o servidor lê
// do Supabase se quem pediu pode ver o que pediu (as regras têm teste próprio em permissao-pedidos.test.ts).
const QUEM = '99999999-9999-4999-8999-999999999999';
const PERMISSOES: Record<string, unknown[]> = {
  perfis: [{ id: QUEM, perfil: 'admin', super: true, todas_fazendas: true }],
  usuario_fazendas: [],
  usuario_categorias: [],
  mapas_fazendas: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', nome: 'SM3', coa_fazenda_id: 1 }, { id: 'aaaaaaaa-0000-4000-8000-000000000002', nome: 'Fazenda Nova', coa_fazenda_id: null }],
};
/** tabela do Supabase que a chamada lê */
const tabelaDe = (url: string) => /\/rest\/v1\/([a-z_]+)/.exec(url)?.[1] ?? '';

describe('servidor: período com hora', () => {
  it('valida as horas: as duas ou nenhuma, no formato hh:mm, e a inicial antes da final', () => {
    expect(validarPeriodoChuva('2026-10-05', '2026-10-06', '06:00', '07:00')).toEqual({ de: '2026-10-05', ate: '2026-10-06', dias: 2, deHora: '06:00', ateHora: '07:00' });
    // o Postgres devolve a coluna time com os segundos
    expect(validarPeriodoChuva('2026-10-05', '2026-10-05', '06:00:00', '18:30:00')).toMatchObject({ deHora: '06:00', ateHora: '18:30' });
    // dia seguinte: a hora final pode ser menor que a inicial
    expect(validarPeriodoChuva('2026-10-05', '2026-10-06', '18:00', '06:00')).toMatchObject({ deHora: '18:00', ateHora: '06:00' });
    expect(() => validarPeriodoChuva('2026-10-05', '2026-10-05', '18:00', '06:00')).toThrow('Período inválido: a hora inicial é depois da final.');
    expect(() => validarPeriodoChuva('2026-10-05', '2026-10-05', '25:00', '26:00')).toThrow('Período inválido: informe as horas no formato hh:mm.');
    expect(() => validarPeriodoChuva('2026-10-05', '2026-10-05', "06:00'; drop", '07:00')).toThrow('Período inválido: informe as horas no formato hh:mm.');
    expect(() => validarPeriodoChuva('2026-10-05', '2026-10-05', '06:00', null)).toThrow('Período inválido: informe a hora inicial e a final.');
    // sem hora: o mesmo resultado de antes
    expect(validarPeriodoChuva('2026-10-05', '2026-10-05')).toEqual({ de: '2026-10-05', ate: '2026-10-05', dias: 1 });
    expect(validarPeriodoChuva('2026-10-05', '2026-10-05', null, null)).toEqual({ de: '2026-10-05', ate: '2026-10-05', dias: 1 });
  });

  it('a consulta com hora filtra as leituras pelo instante do identificador, os dois limites inclusive', () => {
    const sql = montarSqlChuvaPics(['9101'], '2026-10-05', '2026-10-06', '06:00', '07:00');
    expect(sql).toContain("c.data >= DATE '2026-10-05' AND c.data < DATE '2026-10-06' + INTERVAL '1 day'");
    expect(sql).toContain("right(c.idprecipitation, 14) >= '20261005060000'");
    expect(sql).toContain("right(c.idprecipitation, 14) <= '20261006070059'");
  });

  it('sem hora a consulta não filtra pelo identificador (dias inteiros, como antes)', () => {
    expect(montarSqlChuvaPics(['9101'], '2026-10-05', '2026-10-06')).not.toContain('right(c.idprecipitation, 14) >=');
  });

  it('a resposta traz a hora da última leitura do período', () => {
    const pics = [{ id: '9101', nome: 'PIC 27 SM3', lat: -20.12, lon: -45.65 }, { id: '9102', nome: 'PIC 37 SM3', lat: -20.11, lon: -45.22 }];
    const r = montarChuvaPics(pics, { columns: ['picid', 'mm', 'leituras', 'ultimo', 'leitura'], rows: [['9101', 2, 26, '2026-10-06', '20261006070000'], ['9102', 1, 20, '2026-10-06', '20261006054500']] });
    expect(r.ultimoDia).toBe('2026-10-06');
    expect(r.ultimaLeitura).toBe('2026-10-06T07:00');
    // identificador fora do padrão: sem a hora
    expect(montarChuvaPics(pics, { columns: ['picid', 'mm', 'leituras', 'ultimo', 'leitura'], rows: [['9101', 2, 26, '2026-10-06', null]] }).ultimaLeitura).toBeNull();
  });
});

interface Chamada { url: string; init?: RequestInit }
const CADASTRO = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['9101', 'PIC 27 SM3', 'Faz_SM3', '-20.123456', '-45.654321']] };

/** Supabase e Agrovex falsos. `semColunas`: o banco ainda não tem de_hora/ate_hora (script 0004 não aplicado). */
function servidores(pedidos: unknown[], consultas: unknown[], semColunas = false) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      // as leituras de permissão não são o pedido: respondem com o cadastro de quem pediu
      if ((!init?.method || init.method === 'GET') && tabelaDe(url) in PERMISSOES) return new Response(JSON.stringify(PERMISSOES[tabelaDe(url)]), { status: 200 });
      if (!init?.method || init.method === 'GET') {
        if (semColunas && url.includes('de_hora')) return new Response(JSON.stringify({ code: '42703', message: 'column mapas_chuva_pedidos.de_hora does not exist' }), { status: 400 });
        return new Response(JSON.stringify(pedidos), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }
    const corpo = init?.body ? JSON.parse(String(init.body)) : null;
    if (init?.method === 'DELETE' || !corpo?.id) return new Response('', { status: 202 });
    if (corpo.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
    }
    const dados = consultas[n++];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...(dados as object) }) }] } }), { status: 200 });
  };
  return { impl, chamadas };
}

describe('servidor: pedidos de chuva com hora', () => {
  it('lê as horas do pedido; num banco sem as colunas (0004 não aplicado) volta a ler só as datas', async () => {
    const a = servidores([{ id: 3, fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-06', de_hora: '06:00:00', ate_hora: '07:00:00' }], []);
    expect(await pedidosChuvaPendentes({ url: URL_SB, chave: CHAVE, fetch: a.impl })).toEqual([{ id: 3, fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-06', de_hora: '06:00:00', ate_hora: '07:00:00' }]);
    expect(a.chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_chuva_pedidos?select=id,pedido_por,fazenda,de,ate,de_hora,ate_hora&atendido_em=is.null&order=id.asc&limit=200`);

    const b = servidores([{ id: 4, fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-05' }], [], true);
    expect(await pedidosChuvaPendentes({ url: URL_SB, chave: CHAVE, fetch: b.impl })).toEqual([{ id: 4, fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-05' }]);
    expect(b.chamadas.map((c) => c.url)).toEqual([
      `${URL_SB}/rest/v1/mapas_chuva_pedidos?select=id,pedido_por,fazenda,de,ate,de_hora,ate_hora&atendido_em=is.null&order=id.asc&limit=200`,
      `${URL_SB}/rest/v1/mapas_chuva_pedidos?select=id,pedido_por,fazenda,de,ate&atendido_em=is.null&order=id.asc&limit=200`,
    ]);
  });

  it('atende o pedido com hora: filtra as leituras e devolve as horas na resposta', async () => {
    const { impl, chamadas } = servidores(
      [{ id: 9, pedido_por: QUEM, fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-06', de_hora: '06:00:00', ate_hora: '07:00:00' }],
      [CADASTRO, { columns: ['picid', 'mm', 'leituras', 'ultimo', 'leitura'], rows: [['9101', 3.2, 26, '2026-10-06', '20261006070000']] }],
    );
    await atenderPedidosChuva({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN }, fetch: impl, agora: () => new Date('2026-10-06T11:00:00Z') });
    const sql = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments.sql)[1];
    expect(sql).toContain("right(c.idprecipitation, 14) >= '20261005060000'");
    const corpo = JSON.parse(String(chamadas.find((c) => c.init?.method === 'PATCH')?.init?.body));
    expect(corpo.resultado).toBe('ok');
    expect(corpo.dados).toMatchObject({ fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-06', deHora: '06:00', ateHora: '07:00', ultimoDia: '2026-10-06', ultimaLeitura: '2026-10-06T07:00' });
  });
});

const resposta = (o: Partial<DadosChuvaZeus> = {}): DadosChuvaZeus => ({
  fazenda: 'SM3',
  de: '2026-10-05',
  ate: '2026-10-06',
  ultimoDia: '2026-10-06',
  pics: [{ id: '9101', nome: 'PIC 27 SM3', lat: -20.123456, lon: -45.654321, chuva: 3.2, leituras: 26 }],
  ...o,
});

describe('tela: período com hora', () => {
  const hoje = '2026-10-06';
  it('valida as horas do período', () => {
    expect(validarPeriodo('2026-10-05', '2026-10-06', hoje, '06:00', '07:00')).toBeNull();
    expect(validarPeriodo('2026-10-05', '2026-10-06', hoje, '18:00', '06:00')).toBeNull();
    expect(validarPeriodo('2026-10-05', '2026-10-05', hoje, '18:00', '06:00')).toBe('A hora inicial é depois da final.');
    expect(validarPeriodo('2026-10-05', '2026-10-05', hoje, '', '06:00')).toBe('Informe a hora inicial e a final.');
    // sem hora: como antes
    expect(validarPeriodo('2026-10-05', '2026-10-05', hoje)).toBeNull();
  });

  it('formata o período com hora', () => {
    expect(fmtPeriodoHora(new Date(2026, 9, 5, 6, 0), new Date(2026, 9, 6, 7, 0))).toBe('05/10/2026 06:00 a 06/10/2026 07:00');
    expect(fmtPeriodoHora(new Date(2026, 9, 5, 6, 0), new Date(2026, 9, 5, 18, 30))).toBe('05/10/2026 06:00 a 18:30');
    expect(fmtPeriodoHora(null, null)).toBe('');
  });

  it('os PICs vêm com o período em data e hora, e o nome diz as horas', () => {
    const r = picsDaIntegracao(lerDadosChuva(resposta({ deHora: '06:00', ateHora: '07:00', ultimaLeitura: '2026-10-06T07:00' })));
    expect(r.nome).toBe('Integração ZEUS · 05/10/2026 06:00 a 06/10/2026 07:00');
    expect(r.comHora).toBe(true);
    expect(r.inicio).toEqual(new Date(2026, 9, 5, 6, 0));
    expect(r.fim).toEqual(new Date(2026, 9, 6, 7, 0));
    expect(r.pics[0]).toMatchObject({ chuva: 3.2, incluir: true, inicio: new Date(2026, 9, 5, 6, 0), fim: new Date(2026, 9, 6, 7, 0) });
    expect(r.avisos).toEqual([]);
  });

  it('avisa quando a última leitura da ZEUS é anterior à hora final pedida', () => {
    const r = picsDaIntegracao(lerDadosChuva(resposta({ deHora: '06:00', ateHora: '12:00', ultimaLeitura: '2026-10-06T07:00' })));
    expect(r.avisos).toEqual(['A ZEUS só tem leituras até 06/10/2026 07:00: o que choveu depois disso ainda não entrou no total.']);
  });

  it('sem hora na resposta, nada muda (dias inteiros)', () => {
    const r = picsDaIntegracao(lerDadosChuva(resposta()));
    expect(r.nome).toBe('Integração ZEUS · 05 a 06/10/2026');
    expect(r.comHora).toBe(false);
    expect(r.inicio).toEqual(new Date(2026, 9, 5));
  });

  it('o texto do período no mapa leva a hora quando o período veio com hora', () => {
    const base = { fazenda: 'SM3', safra: null, periodoInicio: new Date(2026, 9, 5, 6, 0), periodoFim: new Date(2026, 9, 6, 7, 0), setores: null, hoje: new Date(2026, 9, 6) };
    expect(textosAutomaticos({ ...base, periodoComHora: true }).periodo).toBe('05/10/2026 06:00 a 06/10/2026 07:00');
    expect(textosAutomaticos(base).periodo).toBe('05 a 06/10/2026');
  });
});

describe('repositório: pedido de chuva com hora', () => {
  it('grava as horas só quando informadas (o pedido por data continua igual)', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    const repo = criarSupabaseRepo(banco.cliente());
    await repo.pedirChuvaZeus({ fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-06', deHora: '06:00', ateHora: '07:00' });
    expect(banco.tabelas.mapas_chuva_pedidos[0]).toMatchObject({ fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-06', de_hora: '06:00', ate_hora: '07:00' });
    await repo.pedirChuvaZeus({ fazenda: 'SM3', de: '2026-10-05', ate: '2026-10-05' });
    expect(Object.keys(banco.tabelas.mapas_chuva_pedidos[1])).not.toContain('de_hora');
  });

  it('banco sem as colunas de hora: a mensagem aponta o script 0004', () => {
    expect(erroPedido('pedir a chuva da ZEUS', { code: 'PGRST204', message: "Could not find the 'de_hora' column of 'mapas_chuva_pedidos' in the schema cache" }, '0003_pedidos_chuva.sql').message).toBe(
      'Não foi possível pedir a chuva da ZEUS: o pedido com hora ainda não foi habilitado no Supabase (rode supabase/coa-web/0004_situacao_zeus.sql). Enquanto isso, peça só pelas datas.',
    );
  });
});
