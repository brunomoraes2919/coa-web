// Modo local de scripts/sincronizar-plantio.mjs (gravar public/dados/plantio.json em vez de gravar no Supabase):
// só vale quando pedido com --local (ou PLANTIO_LOCAL=1). Na VM, faltar uma variável é erro, com código de
// saída diferente de zero: antes, apagar SUPABASE_URL por engano fazia a rotina parar de atualizar o banco sem
// avisar ninguém. Nenhum valor daqui tem cara de chave de verdade.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modoDeExecucao } from '../scripts/sincronizar-plantio.mjs';

const TOKEN = ['token', 'inventado', 'de', 'teste'].join('-');
const CHAVE = ['chave', 'inventada', 'de', 'teste'].join('-');
const COMPLETO = { AGROVEX_TOKEN: TOKEN, SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: CHAVE };

describe('modoDeExecucao (o que a linha de comando pede)', () => {
  it('com as três variáveis: grava no Supabase (a rotina da VM)', () => {
    expect(modoDeExecucao([], { ...COMPLETO, SUPABASE_URL: '  https://supabase.invalid \n' })).toEqual({
      local: false, token: TOKEN, supabaseUrl: 'https://supabase.invalid', supabaseChave: CHAVE,
    });
  });

  it('sem --local, faltar qualquer variável do Supabase é erro (nada de cair no modo local em silêncio)', () => {
    expect(() => modoDeExecucao([], { AGROVEX_TOKEN: TOKEN })).toThrow(/Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente/);
    expect(() => modoDeExecucao([], { ...COMPLETO, SUPABASE_URL: '' })).toThrow(/Falta SUPABASE_URL no ambiente/);
    expect(() => modoDeExecucao([], { ...COMPLETO, SUPABASE_SERVICE_ROLE_KEY: '   ' })).toThrow(/Falta SUPABASE_SERVICE_ROLE_KEY no ambiente/);
    // a mensagem diz o que fazer nos dois casos: completar o ambiente (VM) ou pedir o modo local
    expect(() => modoDeExecucao([], { AGROVEX_TOKEN: TOKEN })).toThrow(/--local/);
  });

  it('sem --local, faltar o token do Agrovex também é erro', () => {
    expect(() => modoDeExecucao([], { ...COMPLETO, AGROVEX_TOKEN: undefined })).toThrow(/Falta AGROVEX_TOKEN no ambiente/);
    expect(() => modoDeExecucao([], {})).toThrow(/Faltam AGROVEX_TOKEN, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente/);
  });

  it('a mensagem de erro traz só os nomes das variáveis, nunca os valores', () => {
    const erro = (() => { try { modoDeExecucao([], { ...COMPLETO, SUPABASE_URL: '' }); return ''; } catch (e) { return String(e); } })();
    expect(erro).not.toContain(TOKEN);
    expect(erro).not.toContain(CHAVE);
  });

  it('--local (ou PLANTIO_LOCAL=1): modo local, mesmo com as variáveis do Supabase no ambiente', () => {
    expect(modoDeExecucao(['--local'], { AGROVEX_TOKEN: TOKEN })).toEqual({ local: true, token: TOKEN, supabaseUrl: '', supabaseChave: '' });
    expect(modoDeExecucao([], { AGROVEX_TOKEN: TOKEN, PLANTIO_LOCAL: '1' }).local).toBe(true);
    // pedido explícito: não grava no banco nem que as chaves estejam lá
    expect(modoDeExecucao(['--local'], COMPLETO)).toEqual({ local: true, token: TOKEN, supabaseUrl: '', supabaseChave: '' });
    // sem token o modo local só avisa (não há o que consultar): quem decide é o programa
    expect(modoDeExecucao(['--local'], {})).toEqual({ local: true, token: '', supabaseUrl: '', supabaseChave: '' });
  });

  it('só o pedido exato liga o modo local', () => {
    expect(() => modoDeExecucao(['--locale'], {})).toThrow(/no ambiente/);
    expect(() => modoDeExecucao([], { PLANTIO_LOCAL: '0' })).toThrow(/no ambiente/);
    expect(() => modoDeExecucao([], { PLANTIO_LOCAL: 'true' })).toThrow(/no ambiente/);
  });
});

// O programa como a VM o roda. Nenhum destes casos chega a abrir conexão: sem token não há consulta, e o erro
// de variável faltando sai antes de qualquer chamada (por isso os testes nunca passam AGROVEX_TOKEN aqui).
describe('sincronizar-plantio.mjs pela linha de comando', () => {
  const rodar = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [resolve('scripts', 'sincronizar-plantio.mjs'), ...args], {
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

  it('sem as variáveis e sem --local: termina com erro (código 1) e diz o que falta', () => {
    const r = rodar([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Erro ao sincronizar o plantio: Faltam AGROVEX_TOKEN, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente');
    expect(r.stderr).toContain('--local');
    expect(r.stderr).not.toContain('fetch failed');
    expect(r.stdout).toBe('');
  });

  it('só com as variáveis do Supabase pela metade: também é erro, antes de qualquer consulta', () => {
    const r = rodar([], { SUPABASE_URL: 'https://supabase.invalid' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Faltam AGROVEX_TOKEN e SUPABASE_SERVICE_ROLE_KEY no ambiente');
  });

  it('com --local e sem token: só avisa, como sempre fez no computador de quem desenvolve', () => {
    const r = rodar(['--local']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('AGROVEX_TOKEN não definido: plantio.json não foi atualizado.');
    const s = rodar([], { PLANTIO_LOCAL: '1' });
    expect(s.status).toBe(0);
    expect(s.stderr).toContain('AGROVEX_TOKEN não definido');
  });
});

describe('npm run plantio', () => {
  it('pede o modo local', () => {
    const pacote = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pacote.scripts.plantio).toBe('node scripts/sincronizar-plantio.mjs --local');
  });
});
