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

/**
 * Os scripts do módulo, na ordem em que rodam (0002: pedidos de "Atualizar plantio"; 0003: pedidos de chuva da ZEUS;
 * 0026 e 0027, na pasta supabase/ do COA WEB: mapa de variedade e nome comercial das variedades; 0028 e 0029:
 * sementes por metro e população, cadastradas no mapa de variedade e lidas também pela Revista do Operacional).
 */
const SCRIPTS = [
  'supabase/coa-web/0001_mapas.sql',
  'supabase/coa-web/0002_pedidos_plantio.sql',
  'supabase/coa-web/0003_pedidos_chuva.sql',
  'supabase/coa-web/0004_situacao_zeus.sql',
  '../../supabase/0026_mapa_variedade.sql',
  '../../supabase/0027_variedades_nome_comercial.sql',
  '../../supabase/0028_variedades_populacao.sql',
  '../../supabase/0029_populacao_no_mapas.sql',
  '../../supabase/0030_mapa_car_matricula.sql',
];
const sql = SCRIPTS.map((s) => readFileSync(s, 'utf8'))
  .join('\n')
  .replace(/--.*$/gm, '');

/** Colunas de cada "create table if not exists public.<nome> ( ... );" do script, mais as de "add column if not exists". */
function colunasDasTabelas(): Map<string, Set<string>> {
  const tabelas = new Map<string, Set<string>>();
  for (const [, nome, corpo] of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const colunas = corpo
      .split('\n')
      .map((l) => /^\s+(\w+)\s/.exec(l)?.[1])
      .filter((c): c is string => !!c && c !== 'primary' && c !== 'constraint');
    tabelas.set(nome, new Set(colunas));
  }
  for (const [, nome, coluna] of sql.matchAll(/alter table public\.(\w+) add column if not exists (\w+)\s/g)) tabelas.get(nome)?.add(coluna);
  return tabelas;
}

describe('supabase/coa-web/0001_mapas.sql + 0002_pedidos_plantio.sql + 0003_pedidos_chuva.sql + 0004_situacao_zeus.sql + supabase/0026 e 0027 × repositório', () => {
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
    // pedidos de chuva: o repositório insere fazenda e período e lê a resposta
    for (const coluna of ['id', 'fazenda', 'de', 'ate', 'atendido_em', 'resultado', 'dados']) expect(tabelas.get(TABELAS.pedidosChuva)?.has(coluna), coluna).toBe(true);
    // pedido com hora: as duas colunas entram por "add column" no 0004
    for (const coluna of ['de_hora', 'ate_hora']) expect(sql).toMatch(new RegExp('add column if not exists ' + coluna + '\\s+time'));
    // situação da ZEUS: o repositório só lê estas colunas (quem grava é o servidor)
    for (const coluna of ['fazenda', 'ultimo_dia', 'ultima_leitura', 'conferido_em']) expect(tabelas.get(TABELAS.situacaoZeus)?.has(coluna), coluna).toBe(true);
    // cores das variedades: o repositório insere variedade e cor, troca cor e atualizado_em, e lê criado_em
    for (const coluna of ['variedade', 'cor', 'criado_em', 'atualizado_em']) expect(tabelas.get(TABELAS.coresVariedade)?.has(coluna), coluna).toBe(true);
    // variedades do PIMS: o repositório lê estas colunas e só grava nome_comercial (o resto vem da rotina da VM)
    for (const coluna of ['chave', 'nome_pims', 'grupo', 'pims', 'em_uso', 'talhoes', 'ativo', 'visto_em', 'nome_comercial', 'comercial_em']) {
      expect(tabelas.get(TABELAS.variedades)?.has(coluna), coluna).toBe(true);
    }
    expect(sql).toMatch(/grant update \(nome_comercial\) on table public\.mapas_variedades to authenticated;/);
  });

  it.each(Object.values(TABELAS))('tabela %s: RLS ligado, nada para anon, acesso explícito para authenticated', (t) => {
    expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
    expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from anon, authenticated;`));
    // só leitura no navegador (quem grava é o servidor): plantio do PIMS, situação da ZEUS, variedades e o CAR
    const soLeitura = t === TABELAS.plantioPims || t === TABELAS.situacaoZeus || t === TABELAS.variedades || t === TABELAS.car;
    const pedidos = t === TABELAS.pedidosPlantio || t === TABELAS.pedidosChuva || t === TABELAS.pedidosCar;
    const privilegios = soLeitura ? 'select' : pedidos ? 'select, insert' : 'select, insert, update, delete';
    expect(sql).toMatch(new RegExp(`grant ${privilegios}\\s+on table public\\.${t}\\s+to authenticated;`));
  });

  it('bucket privado do repositório, só PNG/JPEG; arquivos do mapa começam pelo id do mapa', () => {
    expect(BUCKET).toBe('mapas-chuva');
    expect(sql).toMatch(/values \('mapas-chuva', 'mapas-chuva', false, \d+, '\{image\/png,image\/jpeg\}'\)/);
    expect(sql).toMatch(/starts_with\(lower\(png_path\), id::text\)/);
    expect(sql).toMatch(/starts_with\(lower\(thumb_path\), id::text\)/);
  });
});
