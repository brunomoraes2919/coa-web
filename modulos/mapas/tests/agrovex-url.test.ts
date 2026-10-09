// O token do Agrovex só pode sair para https://mcp.agrovex.com.br. O endereço vem do plantio.config.json
// (baixado do repositório a cada hora pela VM) ou da variável AGROVEX_URL: trocar uma linha ali não pode
// bastar para mandar o token para outro lugar.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGROVEX_HOST, conferirUrlAgrovex, sincronizar } from '../scripts/sincronizar-plantio.mjs';

const TOKEN = ['token', 'do', 'agrovex', 'inventado'].join('-');

describe('conferirUrlAgrovex', () => {
  it('o endereço que está no plantio.config.json passa, e sai igual (a VM continua funcionando)', () => {
    const config = JSON.parse(readFileSync(resolve('scripts/plantio.config.json'), 'utf8')) as { url: string };
    expect(conferirUrlAgrovex(config.url)).toBe(config.url);
    expect(new URL(config.url).hostname).toBe(AGROVEX_HOST);
  });

  it('aceita só https no host do Agrovex, com a porta padrão', () => {
    expect(conferirUrlAgrovex('https://mcp.agrovex.com.br/mcp')).toBe('https://mcp.agrovex.com.br/mcp');
    expect(conferirUrlAgrovex('  https://MCP.Agrovex.com.br/mcp \n')).toBe('https://mcp.agrovex.com.br/mcp');
    expect(conferirUrlAgrovex('https://mcp.agrovex.com.br:443/mcp')).toBe('https://mcp.agrovex.com.br/mcp');
    expect(conferirUrlAgrovex('https://mcp.agrovex.com.br')).toBe('https://mcp.agrovex.com.br/');
  });

  it.each([
    ['http (sem TLS)', 'http://mcp.agrovex.com.br/mcp'],
    ['outro host', 'https://exemplo.invalid/mcp'],
    ['host que só começa igual', 'https://mcp.agrovex.com.br.exemplo.invalid/mcp'],
    ['host que só termina igual', 'https://xmcp.agrovex.com.br/mcp'],
    ['outro subdomínio', 'https://api.agrovex.com.br/mcp'],
    ['o host certo como "usuário" de outro host', 'https://mcp.agrovex.com.br@exemplo.invalid/mcp'],
    ['barra invertida no lugar da barra', 'https://exemplo.invalid\\@mcp.agrovex.com.br/mcp'],
    ['o host certo só no caminho', 'https://exemplo.invalid/mcp.agrovex.com.br/mcp'],
    ['o host certo só na consulta', 'https://exemplo.invalid/mcp?x=https://mcp.agrovex.com.br'],
    ['usuário e senha embutidos', 'https://alguem:senha@mcp.agrovex.com.br/mcp'],
    ['outra porta', 'https://mcp.agrovex.com.br:8443/mcp'],
    ['ponto no fim do host', 'https://mcp.agrovex.com.br./mcp'],
    ['outro protocolo', 'ftp://mcp.agrovex.com.br/mcp'],
    ['sem protocolo', 'mcp.agrovex.com.br/mcp'],
    ['vazio', ''],
    ['texto qualquer', 'não é um endereço'],
  ])('recusa: %s', (_caso, url) => {
    expect(() => conferirUrlAgrovex(url)).toThrow(/Endereço do Agrovex não permitido.*https:\/\/mcp\.agrovex\.com\.br/);
  });

  it('recusa o que não é texto de endereço', () => {
    for (const v of [undefined, null, 0, {}, []]) expect(() => conferirUrlAgrovex(v)).toThrow('Endereço do Agrovex não permitido');
  });

  it('a mensagem mostra só o protocolo e o host recebidos (o resto do endereço pode trazer segredo)', () => {
    let msg = '';
    try {
      conferirUrlAgrovex('https://exemplo.invalid/caminho-secreto?chave=valor-secreto#resto');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('(recebido: https://exemplo.invalid)');
    expect(msg).not.toContain('secreto');
    // endereço que nem dá para ler: nada do que veio é repetido
    expect(() => conferirUrlAgrovex('valor-secreto colado na linha errada')).toThrow(/^Endereço do Agrovex não permitido: /);
  });
});

describe('na rede de verdade, o token não sai para outro host', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sincronizar recusa o endereço antes de qualquer chamada', async () => {
    const rede = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', rede);
    await expect(sincronizar({ url: 'https://exemplo.invalid/mcp', token: TOKEN, safras: ['SOJA 26/27'] }))
      .rejects.toThrow('Endereço do Agrovex não permitido (recebido: https://exemplo.invalid)');
    expect(rede).not.toHaveBeenCalled();
  });

  it('com o endereço certo a chamada sai, com o token só no cabeçalho', async () => {
    const rede = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"error":"Unauthorized"}', { status: 401 }));
    vi.stubGlobal('fetch', rede);
    await expect(sincronizar({ url: 'https://mcp.agrovex.com.br/mcp', token: TOKEN, safras: ['SOJA 26/27'] })).rejects.toThrow(/recusou o acesso \(HTTP 401\)/);
    expect(rede).toHaveBeenCalledTimes(1);
    const [url, init] = rede.mock.calls[0];
    expect(url).toBe('https://mcp.agrovex.com.br/mcp');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

// Os dois programas, como a VM os roda: com o endereço trocado, param com uma mensagem clara ANTES de qualquer
// chamada (nem ao Supabase). Os endereços usam domínios reservados (.invalid): mesmo que a conferência
// falhasse, nada chegaria a lugar nenhum.
describe('os programas param antes de qualquer chamada quando o endereço do Agrovex não é o permitido', () => {
  const rodar = (script: string, env: Record<string, string>) => spawnSync(process.execPath, [resolve('scripts', script)], {
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const base = { AGROVEX_TOKEN: TOKEN, SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: ['chave', 'inventada', 'de', 'teste'].join('-') };

  it('atender-pedidos.mjs', () => {
    const r = rodar('atender-pedidos.mjs', { ...base, AGROVEX_URL: 'https://exemplo.invalid/mcp' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Erro ao atender os pedidos: Endereço do Agrovex não permitido (recebido: https://exemplo.invalid)');
    expect(r.stderr).not.toContain('fetch failed');
    expect(r.stdout).toBe('');
  });

  it('sincronizar-plantio.mjs', () => {
    const r = rodar('sincronizar-plantio.mjs', { ...base, AGROVEX_URL: 'http://mcp.agrovex.com.br/mcp' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Erro ao sincronizar o plantio: Endereço do Agrovex não permitido (recebido: http://mcp.agrovex.com.br)');
    expect(r.stderr).not.toContain('fetch failed');
  });

  it('o erro final não leva a chave nem o token para o log, mesmo que o texto do erro os repita', () => {
    // o "host" recebido é o próprio token: a mensagem o repetiria, e a saída tem de vir sem ele
    const token = 'tokeninventado0123456789abcdef';
    const r = rodar('atender-pedidos.mjs', { ...base, AGROVEX_TOKEN: token, AGROVEX_URL: `https://${token}.invalid/mcp` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Endereço do Agrovex não permitido (recebido: https://[REDACTED].invalid)');
    expect(r.stderr).not.toContain(token);
    const s = rodar('sincronizar-plantio.mjs', { ...base, AGROVEX_TOKEN: token, AGROVEX_URL: `https://${token}.invalid/mcp` });
    expect(s.status).toBe(1);
    expect(s.stderr).toContain('[REDACTED]');
    expect(s.stderr).not.toContain(token);
  });
});
