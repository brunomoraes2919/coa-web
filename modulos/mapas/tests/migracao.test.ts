import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
const TABELAS = ['fazendas', 'talhoes', 'safras', 'plantios', 'mapas'];

describe('supabase/migrations/0001_init.sql (segurança)', () => {
  it('avisa no topo para desativar novos cadastros (qualquer usuário logado lê e grava tudo)', () => {
    const topo = sql.slice(0, 1500);
    expect(topo).toMatch(/Allow new users to sign up/);
    expect(topo).toMatch(/ATENÇÃO/);
  });

  it.each(TABELAS)('tabela %s: nenhum privilégio para anon e acesso explícito para authenticated', (t) => {
    expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from anon;`));
    expect(sql).toMatch(new RegExp(`grant select, insert, update, delete on table public\\.${t}\\s+to authenticated;`));
  });
});
