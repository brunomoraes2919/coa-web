// O que o servidor grava na coluna `resultado` dos pedidos (que quem pediu lê): 'ok' ou 'erro: ' + um texto
// curto escolhido pelo TIPO da falha. O texto que veio de fora (erro do banco de origem, HTML do Cloudflare,
// resposta do Supabase) fica só no log do servidor, sem a chave e sem o token.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atenderPedidosChuva, atenderPedidosMec, MENSAGENS_DE_ERRO, mensagemPublica, tipoDoErro } from '../scripts/atender-pedidos.mjs';
import {
  boletinsMecanizadas, chuvaPorPicZeus, depositosVinculados, linhasBoletins, linhasValidacao, montarSqlEstoqueSap, sincronizar, validarPedidoMec, validarPeriodoChuva,
} from '../scripts/sincronizar-plantio.mjs';
import { bancoDePermissoes, CHAVE, servidoresFalsos, TOKEN, URL_AGROVEX, URL_SB, USUARIO } from './helpers/servidoresFalsos';

const capturar = async (p: Promise<unknown>): Promise<unknown> => p.then(() => { throw new Error('devia ter falhado'); }, (e: unknown) => e);
const comTipo = (tipo: string, mensagem: string) => Object.assign(new Error(mensagem), { tipo });

describe('tipoDoErro e mensagemPublica', () => {
  it('cada tipo de falha tem um texto fixo e curto', () => {
    expect(MENSAGENS_DE_ERRO).toEqual({
      fonte: 'A fonte de dados (PIMS, SAP ou ZEUS) está indisponível no momento. Tente de novo em alguns minutos.',
      tempo: 'A consulta à fonte de dados demorou demais e foi interrompida. Tente de novo em alguns minutos.',
      invalido: 'Pedido inválido.',
      interno: 'Erro interno do servidor do COA WEB. Se continuar, avise o administrador.',
    });
    expect(Object.isFrozen(MENSAGENS_DE_ERRO)).toBe(true);
  });

  it('fonte indisponível: o texto de fora nunca passa', () => {
    const e = comTipo('fonte', "Consulta ao PIMS falhou (x): Invalid object name 'PIMSMCPRD.dbo.SEGREDO' on server sql01.interno");
    expect(tipoDoErro(e)).toBe('fonte');
    expect(mensagemPublica(e)).toBe(MENSAGENS_DE_ERRO.fonte);
    // rede fora do ar (o fetch do Node diz "fetch failed")
    expect(mensagemPublica(new TypeError('fetch failed'))).toBe(MENSAGENS_DE_ERRO.fonte);
  });

  it('tempo esgotado: o prazo do fetch (AbortSignal.timeout) e o cancelamento', () => {
    expect(tipoDoErro(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('tempo');
    expect(tipoDoErro(new DOMException('This operation was aborted', 'AbortError'))).toBe('tempo');
    expect(tipoDoErro(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('tempo');
    expect(mensagemPublica(new DOMException('x', 'TimeoutError'))).toBe(MENSAGENS_DE_ERRO.tempo);
  });

  it('pedido inválido: leva o texto do próprio servidor (é nosso, não vem de fora), aparado', () => {
    expect(mensagemPublica(comTipo('invalido', 'Período muito longo (70 dias): o máximo é 62 dias.'))).toBe('Período muito longo (70 dias): o máximo é 62 dias.');
    expect(mensagemPublica(comTipo('invalido', `  linha 1\n\n linha 2 ${'x'.repeat(400)}`))).toHaveLength(200);
    expect(mensagemPublica(comTipo('invalido', '   '))).toBe(MENSAGENS_DE_ERRO.invalido);
    // as validações do servidor já saem marcadas
    expect(tipoDoErro(erroDe(() => validarPedidoMec("GLOBO' OR 1=1", '2026-09-01', '2026-09-02')))).toBe('invalido');
    expect(tipoDoErro(erroDe(() => validarPedidoMec('GLOBO', '2026-01-01', '2026-09-01')))).toBe('invalido');
    expect(tipoDoErro(erroDe(() => validarPeriodoChuva('2026-10-02', '2026-10-01')))).toBe('invalido');
    expect(tipoDoErro(erroDe(() => validarPeriodoChuva('2026-10-01', '2026-10-01', '25:00', '26:00')))).toBe('invalido');
  });

  it('todo o resto é erro interno: recusa do Supabase, erro de programa, texto solto, objeto que veio de fora', () => {
    const interno = [
      new Error('Supabase recusou a resposta do pedido (HTTP 401): 42501 permission denied for table x'),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new Error('Endereço do Agrovex não permitido'),
      comTipo('outro', 'tipo que não existe'),
      comTipo('__proto__', 'x'),
      'texto solto',
      null,
      undefined,
      42,
      // um objeto qualquer com a marca não escolhe o tipo: só um Error criado pelo servidor
      { tipo: 'invalido', message: 'texto que veio de fora' },
      { tipo: 'fonte', message: 'idem' },
    ];
    for (const e of interno) {
      expect(tipoDoErro(e), String(e)).toBe('interno');
      expect(mensagemPublica(e), String(e)).toBe(MENSAGENS_DE_ERRO.interno);
    }
  });
});

/** o erro que a função lança (as validações são síncronas) */
function erroDe(f: () => unknown): unknown {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('devia ter falhado');
}

describe('as falhas do servidor de dados saem marcadas como "fonte"', () => {
  const agrovex = (status: number, corpo: string) => async () => new Response(corpo, { status });

  it('recusa do token, bloqueio do Cloudflare, HTTP 5xx e resposta ilegível', async () => {
    const casos: [number, string, RegExp][] = [
      [401, '{"error":"Unauthorized"}', /recusou o acesso \(HTTP 401\)/],
      [403, 'error code: 1010', /bloqueou o acesso deste servidor \(erro 1010\)/],
      [403, '<html><title>Just a moment...</title></html>', /página de verificação \(HTTP 403\)/],
      [502, 'Bad Gateway <b>nginx</b>', /respondeu HTTP 502/],
      [200, 'isto não é JSON nem SSE', /Resposta ilegível/],
    ];
    for (const [status, corpo, detalhe] of casos) {
      const e = await capturar(sincronizar({ url: URL_AGROVEX, token: TOKEN, safras: ['SOJA 26/27'], fetchImpl: agrovex(status, corpo) }));
      expect((e as Error).message, corpo).toMatch(detalhe);
      expect(tipoDoErro(e), corpo).toBe('fonte');
      expect(mensagemPublica(e), corpo).toBe(MENSAGENS_DE_ERRO.fonte);
    }
  });

  it('a mensagem de "recusou o acesso" junta os espaços da resposta sem comer a letra s', async () => {
    const e = await capturar(sincronizar({ url: URL_AGROVEX, token: TOKEN, safras: ['SOJA 26/27'], fetchImpl: agrovex(401, 'acesso   recusado:\n\n  sessao  sem  permissao') }));
    expect((e as Error).message).toContain('Resposta: acesso recusado: sessao sem permissao');
  });

  it('erro devolvido pela consulta (o texto do banco de origem) e resultado truncado', async () => {
    const s = servidoresFalsos({}, [{ erro: "Invalid object name 'PIMSMCPRD.dbo.TABELA' (servidor sql01.interno)" }]);
    const e = await capturar(boletinsMecanizadas({ url: URL_AGROVEX, token: TOKEN, unidade: 'GLOBO', de: '2026-09-01', ate: '2026-09-02', fetchImpl: s.impl }));
    expect((e as Error).message).toContain('sql01.interno'); // o detalhe continua no erro, para o log
    expect(tipoDoErro(e)).toBe('fonte');
    const truncado = servidoresFalsos({}, [{ columns: ['a'], rows: [], truncated: true, row_count: 5000 } as never]);
    expect(tipoDoErro(await capturar(boletinsMecanizadas({ url: URL_AGROVEX, token: TOKEN, unidade: 'GLOBO', de: '2026-09-01', ate: '2026-09-02', fetchImpl: truncado.impl })))).toBe('fonte');
  });
});

describe('fazenda que a ZEUS não conhece', () => {
  const CADASTRO = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['9101', 'PIC 1', 'Faz. Globo', '-20.1', '-45.6'], ['9102', 'PIC 2', 'Faz_SM3', '-20.2', '-45.7']] };

  it('a resposta diz o que conferir, sem a lista das fazendas da ZEUS (que fica no detalhe, para o log)', async () => {
    const s = servidoresFalsos({}, [CADASTRO]);
    const e = (await capturar(chuvaPorPicZeus({ url: URL_AGROVEX, token: TOKEN, fazenda: 'Fazenda Nova', de: '2026-10-01', ate: '2026-10-01', fetchImpl: s.impl }))) as Error & { detalhe?: string };
    expect(e.message).toBe('A ZEUS não tem PICs para a fazenda "Fazenda Nova". Confira se o nome da fazenda no cadastro do mapa é o mesmo usado na ZEUS.');
    expect(mensagemPublica(e)).toBe(e.message);
    expect(mensagemPublica(e)).not.toMatch(/GLOBO|SM3/);
    expect(e.detalhe).toBe('fazendas na ZEUS: GLOBO, SM3');
  });

  it('o nome que volta na mensagem é o que foi pedido, só com letras, números e pontuação simples', async () => {
    const s = servidoresFalsos({}, [CADASTRO]);
    const e = (await capturar(chuvaPorPicZeus({ url: URL_AGROVEX, token: TOKEN, fazenda: ' <b>Fazenda</b> "Água\nBoa" 2 ' + 'x'.repeat(100), de: '2026-10-01', ate: '2026-10-01', fetchImpl: s.impl }))) as Error;
    expect(e.message).toMatch(/^A ZEUS não tem PICs para a fazenda "bFazenda\/b Água Boa 2 x+"\. Confira/);
    expect(e.message.length).toBeLessThan(200);
  });
});

describe('o pedido leva o texto do tipo; o detalhe vai para o log, sem a chave e sem o token', () => {
  afterEach(() => vi.restoreAllMocks());
  const opcoes = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: URL_AGROVEX, token: TOKEN }, fetch: impl, agora: () => new Date('2026-10-05T10:00:00Z') });
  const pedidoMec = { id: 9, pedido_por: USUARIO.colaborador, unidade: 'GLOBO', de: '2026-09-01', ate: '2026-09-01' };
  const pedidoChuva = { id: 4, pedido_por: USUARIO.colaborador, fazenda: 'Globo', de: '2026-10-01', ate: '2026-10-01' };

  it('boletins: erro do banco de origem (com a chave e o token no meio) → "fonte indisponível" na tela', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const textoDeFora = `Invalid object name 'PIMSMCPRD.dbo.TABELA' em sql01.interno ${TOKEN} ${CHAVE}`;
    const s = servidoresFalsos({ ...bancoDePermissoes(), mec_pims_pedidos: [pedidoMec] }, [{ erro: textoDeFora }]);
    await atenderPedidosMec(opcoes(s.impl));
    const [r] = s.respostas('mec_pims_pedidos');
    expect(r.corpo).toEqual({ atendido_em: '2026-10-05T10:00:00.000Z', resultado: `erro: ${MENSAGENS_DE_ERRO.fonte}`, dados: null });
    const registrado = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(registrado).toContain("Erro no pedido de boletins 9: Consulta ao PIMS falhou (atividades mecanizadas): Invalid object name 'PIMSMCPRD.dbo.TABELA' em sql01.interno [REDACTED] [REDACTED]");
    expect(registrado).not.toContain(TOKEN);
    expect(registrado).not.toContain(CHAVE);
  });

  it('boletins: período longo demais → o texto da validação (nosso), sem consultar nada', async () => {
    const s = servidoresFalsos({ ...bancoDePermissoes(), mec_pims_pedidos: [{ ...pedidoMec, de: '2026-01-01' }] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await atenderPedidosMec(opcoes(s.impl));
    expect(s.aoAgrovex()).toHaveLength(0);
    expect(s.respostas('mec_pims_pedidos').map((r) => r.corpo.resultado)).toEqual(['erro: Período muito longo (244 dias): o máximo é 62 dias.']);
  });

  it('chuva: Agrovex fora do ar (HTML do Cloudflare) e prazo estourado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fora = servidoresFalsos({ ...bancoDePermissoes(), mapas_chuva_pedidos: [pedidoChuva] }, [], { agrovexStatus: 503, agrovexCorpo: '<html>upstream connect error</html>' });
    await atenderPedidosChuva(opcoes(fora.impl));
    expect(fora.respostas('mapas_chuva_pedidos').map((r) => r.corpo.resultado)).toEqual([`erro: ${MENSAGENS_DE_ERRO.fonte}`]);

    const lento = servidoresFalsos({ ...bancoDePermissoes(), mapas_chuva_pedidos: [pedidoChuva] });
    const impl = async (url: string, init?: RequestInit) => {
      if (!url.startsWith(URL_SB)) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return lento.impl(url, init);
    };
    await atenderPedidosChuva(opcoes(impl));
    expect(lento.respostas('mapas_chuva_pedidos').map((r) => r.corpo.resultado)).toEqual([`erro: ${MENSAGENS_DE_ERRO.tempo}`]);
  });

  it('chuva: fazenda que a ZEUS não conhece → a mensagem sem a lista; a lista vai para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cadastro = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['9102', 'PIC 2', 'Faz_SM3', '-20.2', '-45.7']] };
    const s = servidoresFalsos({ ...bancoDePermissoes(), mapas_chuva_pedidos: [pedidoChuva] }, [cadastro]);
    await atenderPedidosChuva(opcoes(s.impl));
    expect(s.respostas('mapas_chuva_pedidos').map((r) => r.corpo)).toEqual([
      { atendido_em: '2026-10-05T10:00:00.000Z', resultado: 'erro: A ZEUS não tem PICs para a fazenda "Globo". Confira se o nome da fazenda no cadastro do mapa é o mesmo usado na ZEUS.', dados: null },
    ]);
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('[fazendas na ZEUS: SM3]');
  });
});

describe('nomes que vêm do banco não caem em propriedade herdada (B4)', () => {
  const HERDADAS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

  it('vínculo com unidade "constructor", "__proto__"… é ignorado, sem derrubar a rodada da validação', () => {
    for (const unidade of HERDADAS) {
      expect(depositosVinculados([{ unidade, deposito: 'D01' }]), unidade).toEqual({});
    }
    const r = depositosVinculados([{ unidade: 'constructor', deposito: 'D01' }, { unidade: ' GLOBO ', deposito: 'D01' }, { unidade: 'GLOBO', deposito: '__proto__' }, { unidade: 'SM3', deposito: "X' OR '1'='1" }]);
    expect(JSON.parse(JSON.stringify(r))).toEqual({ SBOAGROPECUARIALOCKS: { GLOBO: ['D01', '__proto__'] } });
    expect(Object.getPrototypeOf(r)).toBeNull();
    expect(({} as Record<string, unknown>).D01).toBeUndefined();
    // o código de depósito "__proto__" passa pela regra de formato, e vira só um texto entre aspas na consulta
    expect(montarSqlEstoqueSap(['__proto__', 'D01'])).toContain(`IN ('__proto__', 'D01')`);
  });

  it('unidade do PIMS com nome de propriedade herdada não quebra a montagem das linhas', () => {
    for (const unidade of HERDADAS) {
      const linhas = linhasValidacao({
        ordens: [{ unidade, os: 1, equipe: 'EQUIPE A', operacao: 1, operacao_de: 'X', situacao: 'A', abertura: '2026-09-01', encerramento: null, planejado: 1, talhoes: 1, executado: 0, ultimo: null, sem_area: 0 }],
        evolucao: [], coordenadores: [], depositos: [{ unidade, codigo: 'D01', nome: 'Depósito 1' }],
      }, '2026-10-06T12:00:00.000Z');
      expect(linhas.map((l) => [l.unidade, l.depositos]), unidade).toEqual([[unidade, [{ c: 'D01', n: 'Depósito 1' }]]]);
      const boletins = linhasBoletins({ falhas: [{ unidade, origem: 'I', boletim: 7, dia: '2026-09-01', id_item: '1', material: 'M1', qtd: 2, un: 'L', deposito: 'D01', os: 1, equipe: 'EQUIPE A', em: '2026-09-01 10:00' }] });
      expect(Object.keys(boletins), unidade).toEqual([unidade]);
      expect(boletins[unidade][0].it, unidade).toEqual([{ c: 'M1', nm: '', q: 2, u: 'L', dp: 'D01' }]);
    }
  });
});
