import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { problemasNoConteudo, verificarPublicacao } from '../scripts/verificar-publicacao.mjs';

// Tokens inventados, montados em tempo de execução (nada com cara de chave fica escrito no repositório).
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.assinatura_inventada-123`;
const ANON = jwt({ iss: 'supabase', ref: 'projeto-teste', role: 'anon', iat: 1, exp: 2 });
const SERVICO = jwt({ iss: 'supabase', ref: 'projeto-teste', role: ['service', 'role'].join('_'), iat: 1, exp: 2 });
const SEGREDO = ['sb', 'secret', 'abcdefghijklmnop'].join('_');

describe('problemasNoConteudo', () => {
  it('código limpo e a chave anon passam', () => {
    expect(problemasNoConteudo('a.js', 'const x = 1; fetch("https://x.supabase.co")')).toEqual([]);
    expect(problemasNoConteudo('a.js', `createClient("https://x.supabase.co","${ANON}")`)).toEqual([]);
  });

  it('JWT com role diferente de anon é recusado, sem mostrar o token', () => {
    const p = problemasNoConteudo('assets/index.js', `const k="${ANON}";const s="${SERVICO}";`);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('assets/index.js');
    expect(p[0]).toContain(`"${['service', 'role'].join('_')}"`);
    expect(p[0]).not.toContain(SERVICO);
    expect(p[0]).not.toContain(SERVICO.split('.')[1]);
  });

  it('JWT sem role ou ilegível é recusado', () => {
    expect(problemasNoConteudo('a.js', jwt({ iss: 'x' }))).toEqual(['a.js contém um JWT com role "(sem role)" (só a chave anon pode ser publicada)']);
    const ilegivel = `${b64({ alg: 'HS256' })}.eyJ${'nao-e-json'}.x`;
    expect(problemasNoConteudo('a.js', ilegivel)).toEqual(['a.js contém um JWT ilegível']);
  });

  it('chave nova de serviço ("sb_secret_…") e a palavra service_role são recusadas', () => {
    const p = problemasNoConteudo('a.js', `const k="${SEGREDO}"`);
    expect(p).toHaveLength(1);
    expect(p[0]).not.toContain(SEGREDO);
    expect(problemasNoConteudo('a.js', `// ${['service', 'role'].join('_')}`)).toHaveLength(1);
  });

  it('só o prefixo "sb_secret_" (como no supabase-js, que reconhece o formato) não é chave', () => {
    const prefixo = ['sb', 'secret', ''].join('_');
    expect(problemasNoConteudo('a.js', `Nc=e=>e.startsWith(\`sb_publishable_\`)||e.startsWith(\`${prefixo}\`)`)).toEqual([]);
    expect(problemasNoConteudo('a.js', `k.startsWith("${prefixo}")`)).toEqual([]);
  });
});

describe('verificarPublicacao (pastas de teste)', () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  /** Pasta temporária com os arquivos informados (caminho relativo → conteúdo). */
  function saida(arquivos: Record<string, string | Buffer>): string {
    const raiz = mkdtempSync(join(tmpdir(), 'mapas-publicacao-'));
    pastas.push(raiz);
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      const caminho = join(raiz, rel);
      mkdirSync(join(caminho, '..'), { recursive: true });
      writeFileSync(caminho, conteudo);
    }
    return raiz;
  }

  it('saída limpa (com a chave anon e um binário) passa', () => {
    const r = verificarPublicacao(
      saida({
        'index.html': '<!doctype html><title>Mapas · COA WEB</title>',
        'assets/index.js': `createClient("https://x.supabase.co","${ANON}")`,
        'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]),
      }),
    );
    expect(r).toEqual({ problemas: [], total: 3 });
  });

  it('sem index.html é recusada', () => {
    const r = verificarPublicacao(saida({ 'assets/index.js': 'x' }));
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toMatch(/não existe .*index\.html/);
  });

  it('pasta inexistente é recusada (sem index.html)', () => {
    const r = verificarPublicacao(join(tmpdir(), 'mapas-publicacao-que-nao-existe-9f3a'));
    expect(r.total).toBe(0);
    expect(r.problemas[0]).toMatch(/não existe .*index\.html/);
  });

  it('com dados/ é recusada', () => {
    const r = verificarPublicacao(saida({ 'index.html': 'ok', 'dados/plantio.json': '{}' }));
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toMatch(/existe .*dados/);
  });

  it('JWT de serviço num arquivo aninhado é recusado, citando o arquivo', () => {
    const r = verificarPublicacao(saida({ 'index.html': 'ok', 'assets/sub/chunk.js': `x="${SERVICO}"` }));
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain(join('assets', 'sub', 'chunk.js'));
    expect(r.problemas[0]).not.toContain(SERVICO);
  });

  it('chave "sb_secret_…" é recusada', () => {
    const r = verificarPublicacao(saida({ 'index.html': 'ok', 'assets/a.js': `k="${SEGREDO}"` }));
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain('sb_secret_');
  });
});
