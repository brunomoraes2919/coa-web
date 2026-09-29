import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import type { Repositorio } from '../src/data/repo';
import { carregarSeed } from '../src/lib/seed';
import type { FazendaCoa } from '../src/lib/types';
import { colecao, feicao, leitorFalso, quadrado } from './helpers/seedFalso';

let contador = 0;
const repoNovo = (): Repositorio => criarLocalRepo(`coa-seed-coa-${++contador}`);

/** Repositório local com as fazendas do COA WEB simuladas (no modo local a lista é vazia). */
const comCoa = (repo: Repositorio, lista: FazendaCoa[] | (() => Promise<FazendaCoa[]>)): Repositorio => ({
  ...repo,
  listarFazendasCoa: typeof lista === 'function' ? lista : async () => lista,
});

const base = (nome: string, arquivo: string) => ({ nome, unidadePims: nome.toUpperCase(), campoNome: 'nome', campoCodigo: 'codigo', campoSetor: null, arquivoBase: arquivo });

/** Três unidades como no cadastro real: "Três Flechas" (com acento), "Globo" e "SM3"; sem safras. */
const ARQUIVOS = {
  'seed.json': {
    versao: 1,
    geradoEm: '2026-09-28T00:00:00.000Z',
    fazendas: [{ ...base('Três Flechas', 'base/TRES_FLECHAS.geojson'), unidadePims: 'TRES FLECHAS' }, base('Globo', 'base/GLOBO.geojson'), base('SM3', 'base/SM3.geojson')],
    safras: [],
  },
  'base/TRES_FLECHAS.geojson': colecao([feicao(0, { codigo: '001', nome: '001' })]),
  'base/GLOBO.geojson': colecao([feicao(1, { codigo: 'P11', nome: 'P11' })]),
  'base/SM3.geojson': colecao([feicao(2, { codigo: '010', nome: '010' })]),
};
const ler = () => leitorFalso(ARQUIVOS);

const COA: FazendaCoa[] = [
  { id: 3, nome: ' GLOBO ' },
  { id: 7, nome: 'Tres Flechas' },
  { id: 99, nome: 'Outra' },
];

async function vinculos(repo: Repositorio): Promise<Record<string, number | null>> {
  return Object.fromEntries((await repo.listarFazendas()).map((f) => [f.nome, f.coaFazendaId]));
}

describe('carregarSeed: ligação com as fazendas do COA WEB', () => {
  it('liga cada unidade à fazenda do COA WEB pelo nome comparável (Três Flechas ↔ Tres Flechas)', async () => {
    const repo = comCoa(repoNovo(), COA);
    const r = await carregarSeed(repo, ler());
    expect(r).toMatchObject({ fazendas: 3, ligadas: 2, semVinculo: ['SM3'] });
    expect(await vinculos(repo)).toEqual({ 'Três Flechas': 7, Globo: 3, SM3: null });
  });

  it('ignora o prefixo "Fazenda" do nome no COA WEB (Fazenda Globo ↔ Globo)', async () => {
    const repo = comCoa(repoNovo(), [{ id: 2, nome: 'Fazenda Globo' }, { id: 6, nome: 'Faz. Três Flechas' }, { id: 5, nome: 'SM3' }]);
    const r = await carregarSeed(repo, ler());
    expect(r).toMatchObject({ fazendas: 3, ligadas: 3, semVinculo: [] });
    expect(await vinculos(repo)).toEqual({ 'Três Flechas': 6, Globo: 2, SM3: 5 });
  });

  it('modo local (lista vazia): tudo sem vínculo, sem erro', async () => {
    const repo = repoNovo();
    const r = await carregarSeed(repo, ler());
    expect(r).toMatchObject({ fazendas: 3, ligadas: 0, semVinculo: ['Três Flechas', 'Globo', 'SM3'] });
    expect(await vinculos(repo)).toEqual({ 'Três Flechas': null, Globo: null, SM3: null });
  });

  it('recarregar não desfaz o vínculo ajustado à mão (nem com a lista do COA WEB vazia)', async () => {
    const local = repoNovo();
    await carregarSeed(comCoa(local, COA), ler());
    const fazendas = await local.listarFazendas();
    const globo = fazendas.find((f) => f.nome === 'Globo')!;
    const sm3 = fazendas.find((f) => f.nome === 'SM3')!;
    await local.atualizarFazenda({ ...globo, coaFazendaId: 50 }, []);
    await local.atualizarFazenda({ ...sm3, coaFazendaId: 8 }, []);

    const r = await carregarSeed(comCoa(local, COA), ler());
    expect(r).toMatchObject({ ligadas: 3, semVinculo: [] });
    expect(await vinculos(local)).toEqual({ 'Três Flechas': 7, Globo: 50, SM3: 8 });

    await carregarSeed(local, ler()); // modo local: lista vazia
    expect(await vinculos(local)).toEqual({ 'Três Flechas': 7, Globo: 50, SM3: 8 });
  });

  it('nome repetido no COA WEB (ambíguo) fica sem vínculo — melhor ajustar à mão do que ligar errado', async () => {
    const repo = comCoa(repoNovo(), [
      { id: 1, nome: 'Globo' },
      { id: 2, nome: 'GLOBO' },
      { id: 7, nome: 'Tres Flechas' },
    ]);
    const r = await carregarSeed(repo, ler());
    expect(r).toMatchObject({ ligadas: 1, semVinculo: ['Globo', 'SM3'] });
    expect((await vinculos(repo)).Globo).toBeNull();
  });

  it('fazenda cadastrada à mão (com talhões próprios) também é ligada, mantendo os talhões', async () => {
    const repo = comCoa(repoNovo(), COA);
    const minha = { id: 'minha-faz', nome: 'GLOBO', campoNome: 'T', campoSetor: null, colunas: ['T'], criadoEm: '2026-01-01T00:00:00.000Z', unidadePims: null, campoCodigo: null, coaFazendaId: null };
    await repo.salvarFazenda(minha, [{ id: 'meu-talhao', fazendaId: 'minha-faz', nome: 'T1', setor: null, areaHa: 1, geom: quadrado(0), atributos: {}, codigo: null }]);

    const r = await carregarSeed(repo, ler());

    expect(r).toMatchObject({ ligadas: 2, semVinculo: ['SM3'] });
    const f = (await repo.listarFazendas()).find((x) => x.id === 'minha-faz')!;
    expect(f).toMatchObject({ nome: 'GLOBO', unidadePims: 'GLOBO', coaFazendaId: 3 });
    expect((await repo.obterTalhoes('minha-faz')).map((t) => t.id)).toEqual(['meu-talhao']);
  });

  it('falha ao listar as fazendas do COA WEB interrompe antes de gravar qualquer coisa', async () => {
    const local = repoNovo();
    const repo = comCoa(local, () => Promise.reject(new Error('Não foi possível listar as fazendas do COA WEB: sem rede')));
    await expect(carregarSeed(repo, ler())).rejects.toThrow(/fazendas do COA WEB: sem rede/);
    expect(await local.listarFazendas()).toEqual([]);
  });
});

describe('carregarSeed: unidade no PIMS na forma canônica', () => {
  const comUnidade = (unidadePims: string) => leitorFalso({
    ...ARQUIVOS,
    'seed.json': { ...ARQUIVOS['seed.json'], fazendas: [{ ...base('Três Flechas', 'base/TRES_FLECHAS.geojson'), unidadePims }] },
  });

  it('grava sem acento, em maiúsculas e com espaços simples (o RLS do plantio compara só upper())', async () => {
    const repo = repoNovo();
    await carregarSeed(repo, comUnidade(' Três  flechas '));
    expect((await repo.listarFazendas()).map((f) => f.unidadePims)).toEqual(['TRES FLECHAS']);
  });

  it('fazenda cadastrada à mão (talhões próprios, sem unidade) recebe a unidade canônica', async () => {
    const repo = repoNovo();
    const minha = { id: 'minha-tf', nome: 'Três Flechas', campoNome: 'T', campoSetor: null, colunas: ['T'], criadoEm: '2026-01-01T00:00:00.000Z', unidadePims: null, campoCodigo: null, coaFazendaId: null };
    await repo.salvarFazenda(minha, [{ id: 'meu-talhao', fazendaId: 'minha-tf', nome: 'T1', setor: null, areaHa: 1, geom: quadrado(0), atributos: {}, codigo: null }]);
    await carregarSeed(repo, comUnidade('três flechas'));
    expect((await repo.listarFazendas()).find((f) => f.id === 'minha-tf')?.unidadePims).toBe('TRES FLECHAS');
  });
});
