import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  areaCulturaParaRow,
  BUCKET,
  fazendaParaRow,
  mapaParaRow,
  plantioParaRow,
  safraParaRow,
  TABELAS,
  talhaoParaRow,
  type PlantioPimsRow,
} from '../src/data/supabaseLinhas';
import { area, fazenda, mapa, plantio, safra, talhao } from './helpers/dominio';

/** Os scripts do módulo, na ordem em que rodam (0002: pedidos do botão "Atualizar plantio"). */
const SCRIPTS = ['supabase/coa-web/0001_mapas.sql', 'supabase/coa-web/0002_pedidos_plantio.sql'];
const sql = SCRIPTS.map((s) => readFileSync(s, 'utf8'))
  .join('\n')
  .replace(/--.*$/gm, '');

/** Colunas de cada "create table if not exists public.<nome> ( ... );" do script. */
function colunasDasTabelas(): Map<string, Set<string>> {
  const tabelas = new Map<string, Set<string>>();
  for (const [, nome, corpo] of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const colunas = corpo
      .split('\n')
      .map((l) => /^\s+(\w+)\s/.exec(l)?.[1])
      .filter((c): c is string => !!c && c !== 'primary' && c !== 'constraint');
    tabelas.set(nome, new Set(colunas));
  }
  return tabelas;
}

describe('supabase/coa-web/0001_mapas.sql + 0002_pedidos_plantio.sql × repositório', () => {
  const tabelas = colunasDasTabelas();

  it('cria exatamente as tabelas de TABELAS', () => {
    expect([...tabelas.keys()].sort()).toEqual(Object.values(TABELAS).sort());
  });

  it('todas as colunas gravadas pelos mapeadores existem na tabela certa', () => {
    const f = { ...fazenda(1), unidadePims: 'X', campoCodigo: 'C', coaFazendaId: 3 };
    const s = safra(1);
    const pims: PlantioPimsRow = { safra: 'SOJA 26/27', unidade: 'SIRIEMA', gerado_em: '2026-09-28T10:00:00Z', talhoes: [] };
    const linhas: [string, object][] = [
      [TABELAS.fazendas, fazendaParaRow(f)],
      [TABELAS.talhoes, talhaoParaRow({ ...talhao(1, f.id), codigo: '001' })],
      [TABELAS.safras, safraParaRow(s)],
      [TABELAS.plantios, plantioParaRow(plantio(s.id, 'x'))],
      [TABELAS.areasCultura, areaCulturaParaRow(area(1, s.id, f.id))],
      [TABELAS.mapas, mapaParaRow(mapa(1))],
      [TABELAS.plantioPims, pims],
    ];
    for (const [tabela, linha] of linhas) {
      for (const coluna of Object.keys(linha)) expect(tabelas.get(tabela)?.has(coluna), `${tabela}.${coluna}`).toBe(true);
    }
    // pedidos: o repositório insere uma linha vazia e lê estas colunas
    for (const coluna of ['id', 'atendido_em', 'resultado']) expect(tabelas.get(TABELAS.pedidosPlantio)?.has(coluna), coluna).toBe(true);
  });

  it.each(Object.values(TABELAS))('tabela %s: RLS ligado, nada para anon, acesso explícito para authenticated', (t) => {
    expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
    expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from anon, authenticated;`));
    const privilegios = t === TABELAS.plantioPims ? 'select' : t === TABELAS.pedidosPlantio ? 'select, insert' : 'select, insert, update, delete';
    expect(sql).toMatch(new RegExp(`grant ${privilegios}\\s+on table public\\.${t}\\s+to authenticated;`));
  });

  it('bucket privado do repositório, só PNG/JPEG; arquivos do mapa começam pelo id do mapa', () => {
    expect(BUCKET).toBe('mapas-chuva');
    expect(sql).toMatch(/values \('mapas-chuva', 'mapas-chuva', false, \d+, '\{image\/png,image\/jpeg\}'\)/);
    expect(sql).toMatch(/starts_with\(lower\(png_path\), id::text\)/);
    expect(sql).toMatch(/starts_with\(lower\(thumb_path\), id::text\)/);
  });
});
