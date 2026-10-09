// Antes de consultar o PIMS (boletins) ou a ZEUS (chuva), o servidor confere se quem fez o pedido pode ver
// a unidade/fazenda pedida, com as mesmas regras das funções SQL do banco. A regra principal é a do banco;
// esta é a segunda barreira: um pedido que chegue à tabela por outro caminho não é atendido.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  atenderPedidosChuva, atenderPedidosMec, decidirPermissao, lerPermissao, RESULTADOS, unidadePimsDaFazenda, type DadosDePermissao,
} from '../scripts/atender-pedidos.mjs';
import { bancoDePermissoes, CHAVE, servidoresFalsos, TOKEN, URL_AGROVEX, URL_SB, USUARIO } from './helpers/servidoresFalsos';

type Linha = Record<string, unknown>;
const banco = bancoDePermissoes();
const doUsuario = (linhas: Linha[], id: string) => linhas.filter((l) => l.usuario_id === id);

/** o que lerPermissao leria do banco para este usuário (as mesmas linhas, sem passar pela rede) */
function dadosDe(id: string, mudar: Partial<DadosDePermissao> = {}): DadosDePermissao {
  return {
    perfil: (banco.perfis.find((p) => p.id === id) as DadosDePermissao['perfil']) ?? null,
    fazendasDoUsuario: doUsuario(banco.usuario_fazendas, id),
    categorias: doUsuario(banco.usuario_categorias, id),
    fazendas: banco.fazendas,
    mapasFazendas: banco.mapas_fazendas,
    ...mudar,
  };
}
const mec = (id: string, unidade: unknown, mudar: Partial<DadosDePermissao> = {}) => decidirPermissao({ tipo: 'mecanizadas', alvo: unidade, ...dadosDe(id, mudar) });
const chuva = (id: string, fazenda: unknown, mudar: Partial<DadosDePermissao> = {}) => decidirPermissao({ tipo: 'chuva', alvo: fazenda, ...dadosDe(id, mudar) });
const SIM = { permitido: true, motivo: 'ok' };
const nao = (motivo: string) => ({ permitido: false, motivo });

describe('unidadePimsDaFazenda (a mesma regra da tela de Mecanizadas)', () => {
  it('liga o nome da fazenda do COA WEB à unidade do PIMS', () => {
    expect(unidadePimsDaFazenda('Fazenda Globo')).toBe('GLOBO');
    expect(unidadePimsDaFazenda('  faz.  três   flechas ')).toBe('T. FLECHAS');
    expect(unidadePimsDaFazenda('T. Flechas')).toBe('T. FLECHAS');
    expect(unidadePimsDaFazenda('Fazenda SM3')).toBe('SM3');
    expect(unidadePimsDaFazenda('Siriema')).toBe('SIRIEMA');
    expect(unidadePimsDaFazenda('Complexo Industrial')).toBeNull();
    expect(unidadePimsDaFazenda(null)).toBeNull();
    expect(unidadePimsDaFazenda(undefined)).toBeNull();
  });

  // A unidade nova tem de entrar nos dois lugares (index.html e atender-pedidos.mjs): este teste avisa.
  const html = resolve('../../index.html');
  it.skipIf(!existsSync(html))('devolve o mesmo que a função do index.html', () => {
    const texto = readFileSync(html, 'utf8');
    const funcao = (nome: string) => {
      const m = new RegExp(`function ${nome}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`).exec(texto);
      if (!m) throw new Error(`Não achei a função ${nome} no index.html: a regra do servidor precisa ser conferida à mão.`);
      return m[0];
    };
    const daTela = new Function(`${funcao('normalizarTextoMec')}\n${funcao('unidadePimsDaFazenda')}\nreturn unidadePimsDaFazenda;`)() as (n: unknown) => string | null;
    const nomes = [
      'Fazenda Globo', 'GLOBO', 'Guapirama', 'Faz. Guapirama II', 'Nebraska', 'Siriema', 'Dourado', 'Fazenda Dourado', 'SM3', 'Faz_SM3', 'sm3 norte',
      'Três Flechas', 'TRES FLECHAS', 'T. Flechas', 't.  flechas', 'Tres  Flechas', 'Complexo Industrial', 'Pecuária Locks - Globo', 'Bacaba', '', '  ', 'Nº 3', null, undefined,
    ];
    for (const n of nomes) expect(unidadePimsDaFazenda(n), String(n)).toBe(daTela(n));
  });
});

describe('boletins de Mecanizadas: quem pode pedir a unidade', () => {
  it('colaborador com a fazenda liberada e a categoria Mecanizadas: pode', () => {
    expect(mec(USUARIO.colaborador, 'GLOBO')).toEqual(SIM);
    // a unidade tem de vir exatamente como a tela a envia (a mesma comparação do banco): sem ajeitar nada
    for (const escrito of [' GLOBO ', 'globo', 'Globo', 'GLOBO ']) expect(mec(USUARIO.colaborador, escrito), escrito).toEqual(nao('unidade-desconhecida'));
  });

  it('colaborador sem a fazenda daquela unidade: não pode (era o furo: bastava ter UMA fazenda)', () => {
    expect(mec(USUARIO.colaborador, 'SM3')).toEqual(nao('sem-fazenda'));
    expect(mec(USUARIO.colaborador, 'T. FLECHAS')).toEqual(nao('sem-fazenda'));
    // `todas_fazendas` nasce true para todo mundo, mas só vale para administrador
    expect((banco.perfis.find((p) => p.id === USUARIO.colaborador) as Linha).todas_fazendas).toBe(true);
  });

  it('sem a categoria Mecanizadas: não pode, mesmo com a fazenda liberada', () => {
    expect(mec(USUARIO.outroColaborador, 'SM3')).toEqual(nao('sem-categoria'));
    expect(mec(USUARIO.colaborador, 'GLOBO', { categorias: [{ categoria: 'mapas' }] })).toEqual(nao('sem-categoria'));
    expect(mec(USUARIO.adminQueVeTudo, 'GLOBO', { categorias: [] })).toEqual(nao('sem-categoria'));
  });

  it('administrador restrito: só as unidades das fazendas que o ADMINISTRADOR+ liberou para ele', () => {
    expect(mec(USUARIO.adminRestrito, 'T. FLECHAS')).toEqual(SIM);
    expect(mec(USUARIO.adminRestrito, 'GLOBO')).toEqual(nao('sem-fazenda'));
    expect(mec(USUARIO.adminRestrito, 'T. FLECHAS', { fazendasDoUsuario: [] })).toEqual(nao('sem-fazenda'));
  });

  it('administrador que vê todas as fazendas: qualquer unidade de fazenda cadastrada', () => {
    for (const u of ['GLOBO', 'T. FLECHAS', 'SM3']) expect(mec(USUARIO.adminQueVeTudo, u), u).toEqual(SIM);
  });

  it('ADMINISTRADOR+: pode mesmo sem a linha da categoria e sem fazenda liberada', () => {
    expect(banco.usuario_categorias.some((c) => c.usuario_id === USUARIO.adminMais)).toBe(false);
    for (const u of ['GLOBO', 'T. FLECHAS', 'SM3']) expect(mec(USUARIO.adminMais, u), u).toEqual(SIM);
  });

  it('unidade que nenhuma fazenda cadastrada tem: recusada para todos, até para o ADMINISTRADOR+', () => {
    for (const id of [USUARIO.colaborador, USUARIO.adminQueVeTudo, USUARIO.adminMais]) {
      expect(mec(id, 'COMPLEXO INDUSTRIAL'), id).toEqual(nao('unidade-desconhecida'));
      expect(mec(id, 'NEBRASKA'), id).toEqual(nao('unidade-desconhecida')); // unidade do PIMS, mas sem fazenda no COA WEB deste banco
    }
    expect(mec(USUARIO.adminMais, '')).toEqual(nao('sem-alvo'));
    expect(mec(USUARIO.adminMais, null)).toEqual(nao('sem-alvo'));
  });

  it('sem linha em perfis: não pode', () => {
    expect(mec(USUARIO.semPerfil, 'GLOBO')).toEqual(nao('sem-perfil'));
    expect(mec(USUARIO.colaborador, 'GLOBO', { perfil: null })).toEqual(nao('sem-perfil'));
  });

  it('as marcas do perfil só valem como o banco as grava (verdadeiro de verdade, e só em administrador)', () => {
    const cat = [{ categoria: 'mecanizadas' }];
    // colaborador com a marca super (não existe no banco, mas não pode abrir nada)
    expect(mec(USUARIO.colaborador, 'SM3', { perfil: { perfil: 'colaborador', super: true, todas_fazendas: true } })).toEqual(nao('sem-fazenda'));
    expect(mec(USUARIO.outroColaborador, 'SM3', { perfil: { perfil: 'colaborador', super: true, todas_fazendas: true } })).toEqual(nao('sem-categoria'));
    // texto ou número no lugar do booleano não conta
    expect(mec(USUARIO.adminRestrito, 'GLOBO', { perfil: { perfil: 'admin', super: 'true', todas_fazendas: 1 }, categorias: cat })).toEqual(nao('sem-fazenda'));
    expect(mec(USUARIO.adminRestrito, 'GLOBO', { perfil: { perfil: 'ADMIN', super: true, todas_fazendas: true }, categorias: cat })).toEqual(nao('sem-fazenda'));
  });

  it('o id da fazenda casa vindo como número ou como texto; id que não é número nunca casa', () => {
    expect(mec(USUARIO.colaborador, 'GLOBO', { fazendasDoUsuario: [{ fazenda_id: '1' }] })).toEqual(SIM);
    expect(mec(USUARIO.colaborador, 'GLOBO', { fazendasDoUsuario: [{ fazenda_id: null }, { fazenda_id: '' }, { fazenda_id: 'x' }, {}] })).toEqual(nao('sem-fazenda'));
    expect(mec(USUARIO.colaborador, 'GLOBO', { fazendasDoUsuario: [{ fazenda_id: null }], fazendas: [{ id: null, nome: 'Globo' }] })).toEqual(nao('sem-fazenda'));
  });

  it('dados fora do formato (o que não der para ler) recusam, sem quebrar', () => {
    const ruim = { fazendasDoUsuario: 'x', categorias: null, fazendas: {}, mapasFazendas: 7 } as unknown as Partial<DadosDePermissao>;
    expect(mec(USUARIO.colaborador, 'GLOBO', ruim)).toEqual(nao('sem-categoria'));
    expect(mec(USUARIO.adminMais, 'GLOBO', ruim)).toEqual(nao('unidade-desconhecida'));
    expect(decidirPermissao({ tipo: 'outra' as 'chuva', alvo: 'GLOBO', ...dadosDe(USUARIO.adminMais) })).toEqual(nao('tipo-desconhecido'));
  });
});

describe('chuva da ZEUS: quem pode pedir a fazenda', () => {
  it('colaborador com a categoria Mapas: a fazenda de mapa ligada a uma fazenda liberada para ele', () => {
    expect(chuva(USUARIO.colaborador, 'Globo')).toEqual(SIM);
    expect(chuva(USUARIO.outroColaborador, 'Fazenda SM3')).toEqual(SIM);
  });

  it('colaborador: fazenda de mapa de outra fazenda não pode (era o furo)', () => {
    expect(chuva(USUARIO.colaborador, 'Fazenda SM3')).toEqual(nao('sem-fazenda'));
    expect(chuva(USUARIO.outroColaborador, 'Globo')).toEqual(nao('sem-fazenda'));
  });

  it('o nome tem de ser exatamente o da fazenda de mapa, como a tela envia (a mesma comparação do banco)', () => {
    for (const escrito of ['globo', 'GLOBO', ' Globo ', 'Faz. Globo', 'Fazenda Globo', 'Globo ']) {
      expect(chuva(USUARIO.colaborador, escrito), escrito).toEqual(nao('fazenda-desconhecida'));
    }
    // a tela envia o nome sem espaços nas pontas e cortado em 80 caracteres; o cadastro é comparado do mesmo jeito
    const comprido = `Globo ${'x'.repeat(100)}`;
    const cadastro = [{ nome: '  Globo  ', coa_fazenda_id: 1 }, { nome: comprido, coa_fazenda_id: 1 }, { nome: null, coa_fazenda_id: 1 }];
    expect(chuva(USUARIO.colaborador, 'Globo', { mapasFazendas: cadastro })).toEqual(SIM);
    expect(chuva(USUARIO.colaborador, comprido.slice(0, 80), { mapasFazendas: cadastro })).toEqual(SIM);
    expect(chuva(USUARIO.colaborador, comprido, { mapasFazendas: cadastro })).toEqual(nao('fazenda-desconhecida'));
  });

  it('sem a categoria Mapas: não pode, mesmo vendo a fazenda (o ADMINISTRADOR+ tem todas)', () => {
    expect(chuva(USUARIO.colaborador, 'Globo', { categorias: [{ categoria: 'mecanizadas' }] })).toEqual(nao('sem-categoria'));
    expect(chuva(USUARIO.colaborador, 'Globo', { categorias: [] })).toEqual(nao('sem-categoria'));
    expect(chuva(USUARIO.adminQueVeTudo, 'Globo', { categorias: [] })).toEqual(nao('sem-categoria'));
    expect(banco.usuario_categorias.some((c) => c.usuario_id === USUARIO.adminMais)).toBe(false);
    expect(chuva(USUARIO.adminMais, 'Globo')).toEqual(SIM);
  });

  it('fazenda de mapa sem vínculo com o COA WEB: só quem vê tudo', () => {
    expect(chuva(USUARIO.colaborador, 'Nebraska')).toEqual(nao('sem-fazenda'));
    expect(chuva(USUARIO.adminRestrito, 'Nebraska')).toEqual(nao('sem-fazenda'));
    expect(chuva(USUARIO.adminQueVeTudo, 'Nebraska')).toEqual(SIM);
    expect(chuva(USUARIO.adminMais, 'Nebraska')).toEqual(SIM);
  });

  it('administrador restrito: só as fazendas liberadas para ele', () => {
    expect(chuva(USUARIO.adminRestrito, 'Globo')).toEqual(nao('sem-fazenda'));
    expect(chuva(USUARIO.adminRestrito, 'Globo', { fazendasDoUsuario: [{ fazenda_id: 1 }] })).toEqual(SIM);
  });

  it('nome que nenhuma fazenda de mapa tem: recusado para todos', () => {
    for (const id of [USUARIO.colaborador, USUARIO.adminQueVeTudo, USUARIO.adminMais]) {
      expect(chuva(id, 'Três Flechas'), id).toEqual(nao('fazenda-desconhecida'));
    }
    expect(chuva(USUARIO.adminMais, '')).toEqual(nao('sem-alvo'));
    expect(chuva(USUARIO.adminMais, null)).toEqual(nao('sem-alvo'));
    expect(chuva(USUARIO.adminMais, 7)).toEqual(nao('sem-alvo'));
  });

  it('sem linha em perfis: não pode', () => {
    expect(chuva(USUARIO.semPerfil, 'Globo')).toEqual(nao('sem-perfil'));
    expect(chuva(USUARIO.colaborador, 'Globo', { perfil: null })).toEqual(nao('sem-perfil'));
  });
});

describe('lerPermissao (o que o servidor lê do Supabase)', () => {
  const ctx = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ url: URL_SB, chave: CHAVE, fetch: impl });

  it('boletins: perfil, fazendas e categorias de quem pediu, e as fazendas do COA WEB; a chave só nos cabeçalhos', async () => {
    const s = servidoresFalsos(banco);
    const dados = await lerPermissao(ctx(s.impl), 'mecanizadas', USUARIO.colaborador.toUpperCase());
    expect(dados.perfil).toEqual(banco.perfis[0]);
    expect(dados.fazendasDoUsuario).toEqual([{ usuario_id: USUARIO.colaborador, fazenda_id: 1 }]);
    expect(dados.categorias.map((c) => c.categoria)).toEqual(['mecanizadas', 'mapas']);
    expect(dados.fazendas).toEqual(banco.fazendas);
    expect(dados.mapasFazendas).toEqual([]);
    expect(s.chamadas.map((c) => c.url)).toEqual([
      `${URL_SB}/rest/v1/perfis?select=id,perfil,super,todas_fazendas&id=eq.${USUARIO.colaborador}&limit=1`,
      `${URL_SB}/rest/v1/usuario_fazendas?select=fazenda_id&usuario_id=eq.${USUARIO.colaborador}&order=fazenda_id.asc&limit=1000`,
      `${URL_SB}/rest/v1/usuario_categorias?select=categoria&usuario_id=eq.${USUARIO.colaborador}&order=categoria.asc&limit=50`,
      `${URL_SB}/rest/v1/fazendas?select=id,nome&order=id.asc&limit=1000`,
    ]);
    for (const c of s.chamadas) {
      expect(c.url).not.toContain(CHAVE);
      expect((c.init?.headers as Record<string, string>).apikey).toBe(CHAVE);
    }
    expect(decidirPermissao({ tipo: 'mecanizadas', alvo: 'GLOBO', ...dados })).toEqual(SIM);
  });

  it('chuva: perfil, fazendas e categorias de quem pediu, e as fazendas de mapa; as tabelas gerais são lidas uma vez por verificação', async () => {
    const s = servidoresFalsos(banco);
    const memo = new Map<string, unknown[]>();
    const a = await lerPermissao(ctx(s.impl), 'chuva', USUARIO.colaborador, memo);
    const b = await lerPermissao(ctx(s.impl), 'chuva', USUARIO.outroColaborador, memo);
    expect(a.mapasFazendas).toEqual(banco.mapas_fazendas);
    expect(b.mapasFazendas).toBe(a.mapasFazendas);
    expect(s.leituras('mapas_fazendas')).toEqual([`${URL_SB}/rest/v1/mapas_fazendas?select=id,nome,coa_fazenda_id&order=id.asc&limit=1000`]);
    expect(s.leituras('perfis')).toHaveLength(2);
    expect(s.leituras('usuario_categorias')).toHaveLength(2);
    expect(a.categorias.map((c) => c.categoria)).toEqual(['mecanizadas', 'mapas']);
    expect(decidirPermissao({ tipo: 'chuva', alvo: 'Globo', ...a })).toEqual(SIM);
    expect(decidirPermissao({ tipo: 'chuva', alvo: 'Globo', ...b })).toEqual(nao('sem-fazenda'));
  });

  it('pedido sem dono legível: nada é lido, e a decisão é não', async () => {
    const s = servidoresFalsos(banco);
    for (const dono of [undefined, null, '', 'x', "1' or '1'='1", `${USUARIO.colaborador}&select=*`, 7]) {
      const dados = await lerPermissao(ctx(s.impl), 'mecanizadas', dono);
      expect(dados.perfil).toBeNull();
      expect(decidirPermissao({ tipo: 'mecanizadas', alvo: 'GLOBO', ...dados })).toEqual(nao('sem-perfil'));
    }
    expect(s.chamadas).toHaveLength(0);
  });

  it('qualquer falha na leitura lança (quem chama recusa o pedido), sem a chave na mensagem', async () => {
    const semColuna = servidoresFalsos({ ...banco, perfis: { status: 400, corpo: { code: '42703', message: `column perfis.todas_fazendas does not exist ${CHAVE}` } } });
    const erro = await lerPermissao(ctx(semColuna.impl), 'mecanizadas', USUARIO.colaborador).catch((e: Error) => e);
    expect((erro as Error).message).toMatch(/^Supabase recusou a leitura do perfil de quem pediu \(HTTP 400\): 42703/);
    expect((erro as Error).message).not.toContain(CHAVE);

    const { usuario_fazendas: _sem, ...semTabela } = banco;
    await expect(lerPermissao(ctx(servidoresFalsos(semTabela).impl), 'chuva', USUARIO.colaborador)).rejects.toThrow(/a leitura das fazendas de quem pediu \(HTTP 404\)/);

    const foraDoFormato = servidoresFalsos({ ...banco, fazendas: { status: 200, corpo: { message: 'não é uma lista' } } });
    await expect(lerPermissao(ctx(foraDoFormato.impl), 'mecanizadas', USUARIO.colaborador)).rejects.toThrow('Supabase devolveu resposta fora do formato');

    const semRede = async () => { throw new TypeError('fetch failed'); };
    await expect(lerPermissao(ctx(semRede), 'chuva', USUARIO.colaborador)).rejects.toThrow('fetch failed');
  });
});

// ---------- de ponta a ponta: o pedido na fila, a conferência e a consulta (ou não) à fonte ----------

const COLUNAS_MEC = [
  'unidade', 'categoria', 'equipe', 'boletim', 'data', 'equipamento', 'modelo', 'implemento', 'implemento_de', 'funcionario', 'funcionario_de',
  'ano_agricola', 'periodo', 'periodo_de', 'ccusto', 'ccusto_de', 'operacao', 'operacao_de', 'ini', 'fim', 'total',
];
const BOLETIM = { columns: COLUNAS_MEC, rows: [['GLOBO', 'TRATOR', 'EQUIPE A', 100001, '2026-09-01', '30000011', 'MODELO A1', null, null, 1001, 'OPERADOR UM', '22627', 20001, 'SOJA 26/27', '1000001', 'SOJA', 19, 'DESLOCAMENTO', 10, 11, 1]] };
const CADASTRO_ZEUS = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['9101', 'PIC 1', 'Faz. Globo', '-20.1', '-45.6'], ['9102', 'PIC 2', 'Faz_SM3', '-20.2', '-45.7']] };
const CHUVA_ZEUS = { columns: ['picid', 'mm', 'leituras', 'ultimo'], rows: [['9101', 12.5, 96, '2026-10-01']] };
const opcoes = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ supabase: { url: URL_SB, chave: CHAVE }, agrovex: { url: URL_AGROVEX, token: TOKEN }, fetch: impl, agora: () => new Date('2026-10-05T10:00:00Z') });
const pedidoMec = (o: Linha) => ({ id: 1, pedido_por: USUARIO.colaborador, unidade: 'GLOBO', de: '2026-09-01', ate: '2026-09-01', ...o });
const pedidoChuva = (o: Linha) => ({ id: 1, pedido_por: USUARIO.colaborador, fazenda: 'Globo', de: '2026-10-01', ate: '2026-10-01', ...o });

describe('pedidos de boletins: a conferência antes do PIMS', () => {
  it('quem pode ver a unidade é atendido', async () => {
    const s = servidoresFalsos({ ...banco, mec_pims_pedidos: [pedidoMec({ id: 9 })] }, [BOLETIM]);
    expect(await atenderPedidosMec(opcoes(s.impl))).toBe(1);
    expect(s.consultasFeitas().map((c) => c.sql.includes("u.DA_UNI_ADM = 'GLOBO'"))).toEqual([true]);
    const [r] = s.respostas('mec_pims_pedidos');
    expect(r.url).toBe(`${URL_SB}/rest/v1/mec_pims_pedidos?atendido_em=is.null&id=eq.9`);
    expect(r.corpo.resultado).toBe('ok');
    expect((r.corpo.dados as { linhas: unknown[] }).linhas).toHaveLength(1);
  });

  it('unidade de outra fazenda: recusado com texto genérico, sem nenhuma chamada ao Agrovex', async () => {
    const s = servidoresFalsos({ ...banco, mec_pims_pedidos: [pedidoMec({ id: 9, unidade: 'SM3' })] }, [BOLETIM]);
    expect(await atenderPedidosMec(opcoes(s.impl))).toBe(1);
    expect(s.aoAgrovex()).toHaveLength(0);
    expect(s.respostas('mec_pims_pedidos').map((r) => r.corpo)).toEqual([{ atendido_em: '2026-10-05T10:00:00.000Z', resultado: 'erro: Sem permissão para esta unidade.', dados: null }]);
    expect(RESULTADOS.semPermissaoUnidade).toBe('erro: Sem permissão para esta unidade.');
  });

  it('sem a categoria, unidade fora do COA WEB, unidade escrita de outro jeito, pedido sem dono, usuário sem perfil: todos recusados sem consulta', async () => {
    const casos: Linha[] = [
      { pedido_por: USUARIO.outroColaborador, unidade: 'SM3' },
      { unidade: 'globo' },
      { pedido_por: USUARIO.adminMais, unidade: 'COMPLEXO INDUSTRIAL' },
      { pedido_por: null },
      { pedido_por: undefined },
      { pedido_por: USUARIO.semPerfil },
    ];
    for (const caso of casos) {
      const s = servidoresFalsos({ ...banco, mec_pims_pedidos: [pedidoMec(caso)] }, [BOLETIM]);
      await atenderPedidosMec(opcoes(s.impl));
      expect(s.aoAgrovex(), JSON.stringify(caso)).toHaveLength(0);
      expect(s.respostas('mec_pims_pedidos').map((r) => r.corpo.resultado), JSON.stringify(caso)).toEqual([RESULTADOS.semPermissaoUnidade]);
    }
  });

  it('se a conferência falhar (coluna que falta, tabela fora, rede), o pedido é recusado em vez de atendido', async () => {
    const defeitos: Record<string, unknown>[] = [
      { perfis: { status: 400, corpo: { code: '42703', message: 'column perfis.super does not exist' } } },
      { usuario_categorias: { status: 500, corpo: { message: 'erro' } } },
      { fazendas: { status: 200, corpo: 'texto' } },
    ];
    for (const defeito of defeitos) {
      const s = servidoresFalsos({ ...banco, mec_pims_pedidos: [pedidoMec({ id: 3 })], ...defeito } as Parameters<typeof servidoresFalsos>[0], [BOLETIM]);
      await atenderPedidosMec(opcoes(s.impl));
      expect(s.aoAgrovex(), JSON.stringify(defeito)).toHaveLength(0);
      expect(s.respostas('mec_pims_pedidos').map((r) => r.corpo), JSON.stringify(defeito)).toEqual([
        { atendido_em: '2026-10-05T10:00:00.000Z', resultado: 'erro: Não foi possível conferir a sua permissão agora. Tente de novo em alguns minutos.', dados: null },
      ]);
    }
  });

  it('pedido inválido é respondido antes da conferência (nem o banco é consultado)', async () => {
    const s = servidoresFalsos({ ...banco, mec_pims_pedidos: [pedidoMec({ unidade: "GLOBO' OR 1=1 --" })] }, [BOLETIM]);
    await atenderPedidosMec(opcoes(s.impl));
    expect(s.aoAgrovex()).toHaveLength(0);
    expect(s.leituras('perfis')).toHaveLength(0);
    expect(s.respostas('mec_pims_pedidos').map((r) => r.corpo.resultado)).toEqual(['erro: Unidade inválida.']);
  });
});

describe('pedidos de chuva: a conferência antes da ZEUS', () => {
  it('quem pode ver a fazenda é atendido', async () => {
    const s = servidoresFalsos({ ...banco, mapas_chuva_pedidos: [pedidoChuva({ id: 9 })] }, [CADASTRO_ZEUS, CHUVA_ZEUS]);
    expect(await atenderPedidosChuva(opcoes(s.impl))).toBe(1);
    expect(s.consultasFeitas().map((c) => c.source)).toEqual(['zeus', 'zeus']);
    const [r] = s.respostas('mapas_chuva_pedidos');
    expect(r.corpo.resultado).toBe('ok');
    expect(r.corpo.dados).toMatchObject({ fazenda: 'GLOBO', pics: [{ id: '9101', chuva: 12.5 }] });
  });

  it('fazenda de outro usuário: recusado com texto genérico, sem nenhuma chamada ao Agrovex', async () => {
    const s = servidoresFalsos({ ...banco, mapas_chuva_pedidos: [pedidoChuva({ id: 9, fazenda: 'Fazenda SM3' })] }, [CADASTRO_ZEUS, CHUVA_ZEUS]);
    await atenderPedidosChuva(opcoes(s.impl));
    expect(s.aoAgrovex()).toHaveLength(0);
    expect(s.respostas('mapas_chuva_pedidos').map((r) => r.corpo)).toEqual([{ atendido_em: '2026-10-05T10:00:00.000Z', resultado: 'erro: Sem permissão para esta fazenda.', dados: null }]);
  });

  it('fazenda que não é de mapa nenhum, nome escrito de outro jeito, pedido sem dono e usuário sem perfil: recusados sem consulta', async () => {
    const casos: Linha[] = [{ fazenda: 'Três Flechas', pedido_por: USUARIO.adminMais }, { fazenda: 'Faz. Globo' }, { pedido_por: null }, { pedido_por: USUARIO.semPerfil }];
    for (const caso of casos) {
      const s = servidoresFalsos({ ...banco, mapas_chuva_pedidos: [pedidoChuva(caso)] }, [CADASTRO_ZEUS, CHUVA_ZEUS]);
      await atenderPedidosChuva(opcoes(s.impl));
      expect(s.aoAgrovex(), JSON.stringify(caso)).toHaveLength(0);
      expect(s.respostas('mapas_chuva_pedidos').map((r) => r.corpo.resultado), JSON.stringify(caso)).toEqual([RESULTADOS.semPermissaoFazenda]);
    }
  });

  it('se a conferência falhar, o pedido é recusado em vez de atendido', async () => {
    const { mapas_fazendas: _sem, ...semFazendasDeMapa } = banco;
    const s = servidoresFalsos({ ...semFazendasDeMapa, mapas_chuva_pedidos: [pedidoChuva({})] }, [CADASTRO_ZEUS, CHUVA_ZEUS]);
    await atenderPedidosChuva(opcoes(s.impl));
    expect(s.aoAgrovex()).toHaveLength(0);
    expect(s.respostas('mapas_chuva_pedidos').map((r) => r.corpo.resultado)).toEqual([RESULTADOS.permissaoIndisponivel]);
  });

  it('na mesma verificação, cada pedido é conferido pelo próprio dono', async () => {
    const pedidos = [
      pedidoChuva({ id: 1, pedido_por: USUARIO.colaborador, fazenda: 'Fazenda SM3' }), // não pode
      pedidoChuva({ id: 2, pedido_por: USUARIO.outroColaborador, fazenda: 'Fazenda SM3' }), // pode
    ];
    const s = servidoresFalsos({ ...banco, mapas_chuva_pedidos: pedidos }, [CADASTRO_ZEUS, { columns: ['picid', 'mm', 'leituras', 'ultimo'], rows: [['9102', 3, 96, '2026-10-01']] }]);
    expect(await atenderPedidosChuva(opcoes(s.impl))).toBe(2);
    expect(s.respostas('mapas_chuva_pedidos').map((r) => [r.url.split('id=eq.')[1], r.corpo.resultado])).toEqual([['1', RESULTADOS.semPermissaoFazenda], ['2', 'ok']]);
    expect(s.consultasFeitas()).toHaveLength(2);
  });
});
