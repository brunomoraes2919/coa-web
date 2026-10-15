// Repositório: cores das variedades e tipo dos mapas salvos, no Supabase falso e no IndexedDB falso. Dados FICTÍCIOS.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { mapaParaRow, TABELAS } from '../src/data/supabaseLinhas';
import type { Repositorio } from '../src/data/repo';
import { mapa } from './helpers/dominio';
import { BancoFalso } from './helpers/supabaseFalso';

let n = 0;
const repos: [string, () => Repositorio][] = [
  ['supabase', () => criarSupabaseRepo(new BancoFalso().cliente())],
  ['local', () => criarLocalRepo(`coa-chuva-variedade-${++n}`)],
];

describe.each(repos)('cores das variedades (%s)', (_nome, novo) => {
  it('cria, lista pela variedade, troca e apaga', async () => {
    const r = novo();
    await r.criarCorVariedade('TMG 2383', '#1F77B4');
    await r.criarCorVariedade('84KA92 CE', '#FF7F0E');
    expect((await r.listarCoresVariedade()).map((c) => [c.variedade, c.cor])).toEqual([['84KA92 CE', '#FF7F0E'], ['TMG 2383', '#1F77B4']]);
    await r.trocarCorVariedade('TMG 2383', '#000000');
    await r.excluirCorVariedade('84KA92 CE');
    expect((await r.listarCoresVariedade()).map((c) => [c.variedade, c.cor])).toEqual([['TMG 2383', '#000000']]);
  });
  it('criar de novo uma variedade que já tem cor devolve a cor que está gravada (sem trocar)', async () => {
    const r = novo();
    await r.criarCorVariedade('NEO 790', '#2CA02C');
    const segunda = await r.criarCorVariedade('NEO 790', '#D62728');
    expect(segunda.cor).toBe('#2CA02C');
    expect((await r.listarCoresVariedade()).map((c) => c.cor)).toEqual(['#2CA02C']);
  });
});

describe('mapas salvos com tipo', () => {
  it('Supabase: a lista de chuva não traz os de variedade e vice-versa; o tipo vai e volta', async () => {
    const banco = new BancoFalso();
    banco.inserir(TABELAS.mapas, [mapaParaRow(mapa(1)), mapaParaRow({ ...mapa(2), tipo: 'variedade' })]);
    const r = criarSupabaseRepo(banco.cliente());
    expect((await r.listarMapas()).map((m) => m.titulo)).toEqual(['Mapa 1']);
    const variedade = await r.listarMapas('variedade');
    expect(variedade.map((m) => [m.titulo, m.tipo])).toEqual([['Mapa 2', 'variedade']]);
    expect((await r.obterMapa(mapa(1).id))?.tipo).toBeUndefined();
    expect(banco.tabelas[TABELAS.mapas].map((l) => l.tipo)).toEqual(['chuva', 'variedade']);
  });
  it('local: mapas antigos (sem tipo) contam como chuva', async () => {
    const r = criarLocalRepo(`coa-chuva-variedade-${++n}`);
    await r.salvarMapa(mapa(1), new Blob(['x'], { type: 'image/jpeg' }), new Blob(['y'], { type: 'image/png' }));
    await r.salvarMapa({ ...mapa(2), tipo: 'variedade' }, new Blob(['x'], { type: 'image/jpeg' }), new Blob(['y'], { type: 'image/png' }));
    expect((await r.listarMapas()).map((m) => m.titulo)).toEqual(['Mapa 1']);
    expect((await r.listarMapas('variedade')).map((m) => m.titulo)).toEqual(['Mapa 2']);
  });
});
