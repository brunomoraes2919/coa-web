// Prazo das chamadas ao Supabase (scripts/sincronizar-plantio.mjs e scripts/atender-pedidos.mjs): antes só as
// chamadas ao Agrovex tinham prazo, e uma chamada pendurada ao Supabase só era encerrada pelo systemd (20 ou 30
// minutos depois). Leitura: 60 s. Gravação: 120 s. Nada aqui tem cara de chave de verdade.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atenderPedidos, atenderPedidosChuva, atenderPedidosValidacao, atualizarSituacaoZeus, pedidosPendentes, tipoDoErro } from '../scripts/atender-pedidos.mjs';
import {
  chamarSupabase, gravarAcompanhamentoSupabase, gravarSupabase, lerVinculosValidacao, rodarAcompanhamento, SUPABASE_GRAVACAO_MS, SUPABASE_LEITURA_MS,
} from '../scripts/sincronizar-plantio.mjs';
import { bancoDePermissoes, CHAVE, servidoresFalsos, TOKEN, URL_AGROVEX, URL_SB, USUARIO } from './helpers/servidoresFalsos';

afterEach(() => vi.restoreAllMocks());

/** troca AbortSignal.timeout por um sinal que nunca dispara e anota o prazo pedido em cada chamada */
function anotarPrazos() {
  const prazos: number[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    prazos.push(ms);
    return new AbortController().signal;
  });
  return prazos;
}

/** troca AbortSignal.timeout por um sinal já estourado (como se o prazo tivesse acabado) */
function prazoEstourado() {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
}

/** fetch que respeita o sinal, como o de verdade: com o prazo estourado, rejeita com o motivo do sinal */
const fetchQueRespeitaOSinal = async (_url: string, init?: RequestInit): Promise<Response> => {
  if (init?.signal?.aborted) throw init.signal.reason;
  return new Response('[]', { status: 200 });
};

describe('chamarSupabase', () => {
  it('leitura tem 60 s e gravação tem 120 s; o resto da chamada vai como veio', async () => {
    expect(SUPABASE_LEITURA_MS).toBe(60_000);
    expect(SUPABASE_GRAVACAO_MS).toBe(120_000);
    const prazos = anotarPrazos();
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const impl = async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(null, { status: 204 });
    };
    await chamarSupabase(impl, `${URL_SB}/rest/v1/t?select=id`, { headers: { apikey: CHAVE } }, 'a leitura de teste');
    await chamarSupabase(impl, `${URL_SB}/rest/v1/t`, { method: 'GET', headers: {} }, 'a leitura de teste');
    for (const method of ['POST', 'PATCH', 'DELETE']) await chamarSupabase(impl, `${URL_SB}/rest/v1/t`, { method, headers: { apikey: CHAVE }, body: method === 'DELETE' ? undefined : '[]' }, 'a gravação de teste');
    expect(prazos).toEqual([60_000, 60_000, 120_000, 120_000, 120_000]);
    expect(chamadas.every((c) => c.init?.signal instanceof AbortSignal)).toBe(true);
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/t?select=id`);
    expect(chamadas[0].init?.headers).toEqual({ apikey: CHAVE });
    expect(chamadas[2].init?.method).toBe('POST');
    expect(chamadas[2].init?.body).toBe('[]');
  });

  it('prazo estourado vira um erro claro, com o que estava sendo feito e sem a chave', async () => {
    prazoEstourado();
    const leitura = await chamarSupabase(fetchQueRespeitaOSinal, `${URL_SB}/rest/v1/t`, { headers: { apikey: CHAVE } }, 'a leitura dos pedidos').catch((e: Error) => e);
    expect(leitura).toBeInstanceOf(Error);
    expect((leitura as Error).message).toBe('O Supabase não respondeu em 60 s (a leitura dos pedidos): a chamada foi interrompida.');
    const gravacao = await chamarSupabase(fetchQueRespeitaOSinal, `${URL_SB}/rest/v1/t`, { method: 'POST', headers: { apikey: CHAVE }, body: '[]' }, 'o upsert em acomp_pims').catch((e: Error) => e);
    expect((gravacao as Error).message).toBe('O Supabase não respondeu em 120 s (o upsert em acomp_pims): a chamada foi interrompida.');
    expect(String(gravacao)).not.toContain(CHAVE);
    // para a tela é erro interno do servidor do COA WEB (a "fonte de dados" é o PIMS, o SAP e a ZEUS)
    expect(tipoDoErro(gravacao)).toBe('interno');
  });

  it('outros erros de rede passam como vieram', async () => {
    const semRede = async () => { throw new TypeError('fetch failed'); };
    await expect(chamarSupabase(semRede, `${URL_SB}/rest/v1/t`, {}, 'a leitura')).rejects.toThrow(new TypeError('fetch failed'));
  });
});

describe('as rotinas passam o prazo adiante', () => {
  it('gravações da rotina de hora em hora: 120 s no upsert e na limpeza, 60 s na leitura dos vínculos', async () => {
    const prazos = anotarPrazos();
    const ok = async () => new Response('[]', { status: 200 });
    const arquivo = {
      versao: 1 as const, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS',
      safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'GLOBO', talhoes: [{ codigo: '001', codigoPims: '001', setor: null, status: 'a_plantar' as const, areaPrevista: 1, areaPlantada: 0, inicio: null, fim: null, variedade: null }] }] }],
    };
    await gravarSupabase(arquivo, { url: URL_SB, chave: CHAVE, fetch: ok });
    await gravarAcompanhamentoSupabase({ geradoEm: 'g', safras: [], linhas: [{ safra: 'S', unidade: 'U', gerado_em: 'g', talhoes: [], apontamentos: [] }] }, { url: URL_SB, chave: CHAVE, fetch: ok });
    await lerVinculosValidacao({ url: URL_SB, chave: CHAVE, fetch: ok });
    expect(prazos).toEqual([120_000, 120_000, 120_000, 120_000, 60_000]);
  });

  it('Supabase pendurado na gravação do acompanhamento: a etapa devolve a mensagem clara, sem a chave', async () => {
    prazoEstourado();
    const erroNoLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // o Agrovex responde (o falso não olha o sinal); o Supabase respeita o sinal e estoura
    const s = servidoresFalsos({}, [
      { columns: ['DE_PER_SAFRA'], rows: [['SOJA 26/27']] },
      { columns: ['unidade', 'setor', 'safra', 'id', 'codigo', 'area', 'dano', 'variedade', 'encerrado'], rows: [['SM3', 'SM3', 'SOJA 26/27', '1', '015', 120.5, 0, null, null]] },
      { columns: ['unidade', 'safra', 'id', 'codigo', 'data', 'area', 'equipe', 'cd_operacao', 'replantio'], rows: [] },
      { columns: ['unidade', 'safra', 'id', 'codigo', 'data', 'area', 'equipe', 'cd_operacao'], rows: [] },
      { columns: ['fazenda', 'data', 'mm'], rows: [] },
    ]);
    const impl = async (url: string, init?: RequestInit) => (url.startsWith(URL_SB) ? fetchQueRespeitaOSinal(url, init) : s.impl(url, init));
    const msg = await rodarAcompanhamento({ agrovex: { url: URL_AGROVEX, token: TOKEN, safras: ['SOJA 26/27'] }, supabase: { url: URL_SB, chave: CHAVE }, fetchImpl: impl });
    expect(msg).toBe('O Supabase não respondeu em 120 s (o upsert em acomp_pims): a chamada foi interrompida.');
    expect(erroNoLog.mock.calls.flat().join(' ')).not.toContain(CHAVE);
  });

  it('leitura dos pedidos pendurada: erro claro em vez de esperar o systemd', async () => {
    prazoEstourado();
    await expect(pedidosPendentes({ url: URL_SB, chave: CHAVE, fetch: fetchQueRespeitaOSinal }))
      .rejects.toThrow('O Supabase não respondeu em 60 s (a leitura dos pedidos): a chamada foi interrompida.');
  });

  it('nenhuma chamada ao Supabase sai sem prazo nos atendimentos de pedidos', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const AGORA = new Date('2026-10-06T11:20:00Z');
    const supabase = { url: URL_SB, chave: CHAVE };
    const agrovex = { url: URL_AGROVEX, token: TOKEN, safras: ['SOJA 26/27'] };
    const PLANTIO = { columns: ['unidade', 'setor', 'codigo', 'safra', 'area_prevista', 'area_plantada', 'plantio_inicio', 'plantio_fim', 'plantio_encerrado', 'variedade'], rows: [['SM3', 'SM3', '015', 'SOJA 26/27', 120.5, 3, null, null, null, null]] };
    const rodadas = [
      // plantio com rodada antiga: consulta o PIMS, grava, marca e limpa
      async (s: ReturnType<typeof servidoresFalsos>) => atenderPedidos({ supabase, agrovex, fetch: s.impl, agora: () => AGORA }),
      // chuva: lê a fila e as permissões, consulta a ZEUS e responde
      async (s: ReturnType<typeof servidoresFalsos>) => atenderPedidosChuva({ supabase, agrovex, fetch: s.impl, agora: () => AGORA }),
      async (s: ReturnType<typeof servidoresFalsos>) => atenderPedidosValidacao({ supabase, agrovex, fetch: s.impl, agora: () => AGORA }),
      async (s: ReturnType<typeof servidoresFalsos>) => atualizarSituacaoZeus({ supabase, agrovex, fetch: s.impl, agora: () => AGORA }),
    ];
    const consultas = [
      [PLANTIO],
      [
        { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['9103', 'PIC GLOBO', 'Faz. Globo', '-21.5', '-46.1']] },
        { columns: ['picid', 'mm', 'leituras', 'ultimo', 'leitura'], rows: [['9103', 12.5, 24, '2026-10-05', '20261005230000']] },
      ],
      [],
      [{ columns: ['fazenda', 'ultimo', 'leitura'], rows: [['Faz. Globo', '2026-10-05', '20261005230000']] }],
    ];
    let total = 0;
    for (let i = 0; i < rodadas.length; i++) {
      const s = servidoresFalsos({
        ...bancoDePermissoes(),
        mapas_plantio_pedidos: [{ id: 7 }],
        mapas_plantio_pims: [{ gerado_em: '2026-10-06T08:00:00.000Z' }],
        mapas_chuva_pedidos: [{ id: 3, pedido_por: USUARIO.colaborador, fazenda: 'Globo', de: '2026-10-01', ate: '2026-10-05' }],
        valid_pedidos: [],
        mapas_zeus_situacao: [{ conferido_em: '2026-10-06T10:50:00.000Z' }],
      }, consultas[i]);
      await rodadas[i](s);
      const aoSupabase = s.chamadas.filter((c) => c.url.startsWith(URL_SB));
      expect(aoSupabase.length, `rodada ${i}`).toBeGreaterThan(0);
      for (const c of aoSupabase) expect(c.init?.signal, `${c.init?.method ?? 'GET'} ${c.url}`).toBeInstanceOf(AbortSignal);
      total += aoSupabase.length;
    }
    expect(total).toBeGreaterThan(12);
    log.mockRestore();
  });

  it('nos dois programas, todo fetch ao Supabase passa por chamarSupabase', () => {
    const fonte = (arquivo: string) => readFileSync(resolve('scripts', arquivo), 'utf8');
    // atender-pedidos.mjs: só no download dos scripts do repositório (atualizarScripts), com o prazo PRAZO_DOWNLOAD_MS
    expect(fonte('atender-pedidos.mjs').match(/\bfetchImpl\(/g)).toHaveLength(1);
    expect(fonte('atender-pedidos.mjs')).toMatch(/fetchImpl\(`\$\{REPOSITORIO_RAW\}[^\n]*signal: AbortSignal\.timeout\(PRAZO_DOWNLOAD_MS\)/);
    // sincronizar-plantio.mjs: só no cliente do Agrovex (que tem o prazo dele), dentro de chamarSupabase, na leitura
    // das fontes de previsão de fora (lerFonteExterna, com prazo de 30 s; conferido em previsao-benchmark-servidor.test.ts)
    // e na leitura das bases públicas do Mapa de CAR e Matrícula (buscarBase, com prazo CAR_PRAZO_MS)
    expect(fonte('sincronizar-plantio.mjs').match(/\bfetchImpl\(/g)).toHaveLength(4);
  });
});
