// Código sempre novo nos pedidos: com pedido pendente, o servidor baixa os scripts do repositório antes de atender
// (atender-pedidos.mjs). Tudo em pasta temporária, com o GitHub e o Supabase falsos.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARQUIVOS_DOS_SCRIPTS, atualizarScripts, haPedidoPendente, refDosScripts, TABELAS_DE_PEDIDOS } from '../scripts/atender-pedidos.mjs';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'chave-de-teste';
const ATUAIS: Record<string, string> = {
  'sincronizar-plantio.mjs': 'export const versao = 1;\n',
  'atender-pedidos.mjs': 'export const versao = 1;\n',
  'plantio.config.json': '{"safras":"auto"}\n',
};

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});
/** Pasta como a do servidor: <raiz>/scripts com os três arquivos de agora. */
function pastaDoServidor(): string {
  const raiz = mkdtempSync(join(tmpdir(), 'coa-pedidos-'));
  pastas.push(raiz);
  mkdirSync(join(raiz, 'scripts'));
  for (const [f, t] of Object.entries(ATUAIS)) writeFileSync(join(raiz, 'scripts', f), t);
  return raiz;
}
/** GitHub falso: devolve o conteúdo de `arquivos` (ou o status) pelo nome do arquivo no fim da URL. */
function github(arquivos: Record<string, string | number>) {
  const pedidas: string[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    pedidas.push(u);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const v = arquivos[u.slice(u.lastIndexOf('/') + 1)];
    return typeof v === 'number' ? new Response('', { status: v }) : new Response(v ?? '', { status: v === undefined ? 404 : 200 });
  };
  return { impl: impl as typeof fetch, pedidas };
}
const lerScripts = (raiz: string) => Object.fromEntries(ARQUIVOS_DOS_SCRIPTS.map((f) => [f, readFileSync(join(raiz, 'scripts', f), 'utf8')]));
const NOVOS = { 'sincronizar-plantio.mjs': 'export const versao = 2;\n', 'atender-pedidos.mjs': 'export const versao = 2;\n', 'plantio.config.json': '{"safras":"auto"}\n' };
const semConferir = () => true;

describe('atualizarScripts: baixa, confere e troca os três juntos', () => {
  it('algum mudou: troca os três, do main, e não deixa a pasta .novo', async () => {
    const raiz = pastaDoServidor();
    const g = github(NOVOS);
    expect(await atualizarScripts({ raiz, fetch: g.impl, conferirSintaxe: semConferir })).toBe('trocou');
    expect(lerScripts(raiz)).toEqual(NOVOS);
    expect(g.pedidas).toEqual(ARQUIVOS_DOS_SCRIPTS.map((f) => `https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/mapas/scripts/${f}`));
    expect(existsSync(join(raiz, 'scripts', '.novo'))).toBe(false);
  });

  it('tudo igual ao que já está: não troca nada', async () => {
    const raiz = pastaDoServidor();
    expect(await atualizarScripts({ raiz, fetch: github(ATUAIS).impl, conferirSintaxe: semConferir })).toBe('igual');
    expect(lerScripts(raiz)).toEqual(ATUAIS);
  });

  it('download que falhou, arquivo vazio, script com erro ou configuração ilegível: nada é trocado', async () => {
    const casos: [Record<string, string | number>, (f: string) => boolean, RegExp][] = [
      [{ ...NOVOS, 'atender-pedidos.mjs': 503 }, semConferir, /atender-pedidos\.mjs respondeu HTTP 503/],
      [{ ...NOVOS, 'plantio.config.json': '   ' }, semConferir, /plantio\.config\.json veio vazio/],
      [NOVOS, (f) => !f.endsWith('atender-pedidos.mjs'), /atender-pedidos\.mjs veio com erro/],
      [{ ...NOVOS, 'plantio.config.json': '{ quebrado' }, semConferir, /plantio\.config\.json veio com erro/],
    ];
    for (const [arquivos, conferir, motivo] of casos) {
      const raiz = pastaDoServidor();
      const r = await atualizarScripts({ raiz, fetch: github(arquivos).impl, conferirSintaxe: conferir });
      expect(r).toMatch(/^falhou: /);
      expect(r).toMatch(motivo);
      expect(lerScripts(raiz)).toEqual(ATUAIS);
      expect(existsSync(join(raiz, 'scripts', '.novo'))).toBe(false);
    }
  });

  it('a conferência de sintaxe de verdade (node --check) recusa um script quebrado', async () => {
    const raiz = pastaDoServidor();
    const r = await atualizarScripts({ raiz, fetch: github({ ...NOVOS, 'sincronizar-plantio.mjs': 'export const = ;\n' }).impl });
    expect(r).toBe('falhou: sincronizar-plantio.mjs veio com erro');
    expect(lerScripts(raiz)).toEqual(ATUAIS);
  });

  it('com o arquivo versao (commit conferido), baixa só daquele commit; versao inválido não baixa nada', async () => {
    const raiz = pastaDoServidor();
    const commit = 'a'.repeat(40);
    writeFileSync(join(raiz, 'versao'), `${commit}\n`);
    expect(refDosScripts(raiz)).toBe(commit);
    const g = github(NOVOS);
    expect(await atualizarScripts({ raiz, fetch: g.impl, conferirSintaxe: semConferir })).toBe('trocou');
    expect(g.pedidas.every((u) => u.includes(`/coa-web/${commit}/`))).toBe(true);

    const outra = pastaDoServidor();
    writeFileSync(join(outra, 'versao'), 'main');
    const g2 = github(NOVOS);
    expect(await atualizarScripts({ raiz: outra, fetch: g2.impl, conferirSintaxe: semConferir })).toMatch(/^falhou: o arquivo versao/);
    expect(g2.pedidas).toEqual([]);
    expect(lerScripts(outra)).toEqual(ATUAIS);
  });
});

describe('haPedidoPendente: algum pedido esperando em alguma tabela', () => {
  /** Supabase falso: cada tabela responde a lista dada (ou o status com o corpo). */
  function supabase(tabelas: Record<string, unknown[] | { status: number; corpo: unknown }>) {
    const pedidas: string[] = [];
    const impl = async (url: string | URL | Request) => {
      const u = String(url);
      pedidas.push(u);
      const tabela = u.slice(`${URL_SB}/rest/v1/`.length).split('?')[0];
      const v = tabelas[tabela] ?? [];
      if (Array.isArray(v)) return Response.json(v);
      return Response.json(v.corpo, { status: v.status });
    };
    return { impl: impl as typeof fetch, pedidas };
  }

  it('lê uma linha de cada tabela de pedidos e para na primeira com pedido', async () => {
    const s = supabase({ valid_pedidos: [{ id: 7 }] });
    expect(await haPedidoPendente({ url: URL_SB, chave: CHAVE, fetch: s.impl })).toBe(true);
    const ate = TABELAS_DE_PEDIDOS.indexOf('valid_pedidos');
    expect(s.pedidas).toEqual(TABELAS_DE_PEDIDOS.slice(0, ate + 1).map((t) => `${URL_SB}/rest/v1/${t}?select=id&atendido_em=is.null&limit=1`));
  });

  it('nenhum pedido, tabela que não existe ou leitura que falhou: false', async () => {
    const s = supabase({
      mapas_chuva_pedidos: { status: 404, corpo: { code: 'PGRST205' } },
      mec_pims_pedidos: { status: 500, corpo: { message: 'falhou' } },
    });
    expect(await haPedidoPendente({ url: URL_SB, chave: CHAVE, fetch: s.impl })).toBe(false);
    expect(s.pedidas).toHaveLength(TABELAS_DE_PEDIDOS.length);
  });
});
