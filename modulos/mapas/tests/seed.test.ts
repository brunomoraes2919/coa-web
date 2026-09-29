import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import type { Repositorio } from '../src/data/repo';
import { carregarSeed, idDeterministico, seedJaCarregado } from '../src/lib/seed';

let contador = 0;
const repoNovo = (): Repositorio => criarLocalRepo(`coa-seed-teste-${++contador}`);

const quadrado = (x: number): Polygon => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 0.01, 0], [x + 0.01, 0.01], [x, 0.01], [x, 0]]] });
const feicao = (x: number, props: Record<string, unknown>): Feature => ({ type: 'Feature', properties: props, geometry: quadrado(x) });
const colecao = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

const SEED = {
  versao: 1,
  geradoEm: '2026-09-28T16:49:44.154Z',
  fazendas: [
    { nome: 'Siriema', unidadePims: 'SIRIEMA', campoNome: 'nome', campoCodigo: 'codigo', campoSetor: 'setor', arquivoBase: 'base/SIRIEMA.geojson' },
    { nome: 'Globo', unidadePims: 'GLOBO', campoNome: 'nome', campoCodigo: 'codigo', campoSetor: null, arquivoBase: 'base/GLOBO.geojson' },
  ],
  safras: [
    {
      nome: 'SOJA 26/27',
      nomePims: 'SOJA 26/27',
      cultura: 'SOJA',
      anoSafra: '26/27',
      inicio: '2026-09-01',
      fim: '2027-08-31',
      areasCultura: [
        { unidadePims: 'SIRIEMA', arquivo: 'soja-26-27/SIRIEMA.geojson' },
        { unidadePims: 'NAO EXISTE', arquivo: 'soja-26-27/NAO_EXISTE.geojson' },
      ],
    },
  ],
};

const ARQUIVOS: Record<string, unknown> = {
  './dados/seed/seed.json': SEED,
  './dados/seed/base/SIRIEMA.geojson': colecao([
    feicao(0, { codigo: '007', codigoBruto: '007', nome: '007', setor: 'SIRIEMA' }),
    feicao(1, { codigo: '039B', codigoBruto: '39B', nome: '39B', setor: 'SÃO MIGUEL' }),
  ]),
  './dados/seed/base/GLOBO.geojson': colecao([
    feicao(2, { codigo: 'P11', codigoBruto: 'P11', nome: 'P11', setor: null }),
    feicao(3, { codigo: '', codigoBruto: '', nome: 'Talhão 1', setor: null }),
  ]),
  './dados/seed/soja-26-27/SIRIEMA.geojson': colecao([
    feicao(0, { codigo: '007', codigoBruto: '007' }),
    feicao(1, { codigo: '018A', codigoBruto: '018A' }),
    feicao(5, { codigo: '', codigoBruto: '' }),
  ]),
  './dados/seed/soja-26-27/NAO_EXISTE.geojson': colecao([feicao(9, { codigo: '001', codigoBruto: '001' })]),
};

function fetchFalso(arquivos: Record<string, unknown> = ARQUIVOS): typeof fetch {
  return (async (url: string) =>
    url in arquivos ? new Response(JSON.stringify(arquivos[url]), { status: 200 }) : new Response('não encontrado', { status: 404 })) as unknown as typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('idDeterministico', () => {
  it('gera um UUID (v5-like) estável a partir da chave', () => {
    const a = idDeterministico('seed:fazenda:GUAPIRAMA');
    expect(a).toMatch(UUID);
    expect(idDeterministico('seed:fazenda:GUAPIRAMA')).toBe(a);
    expect(idDeterministico('seed:fazenda:GLOBO')).not.toBe(a);
    expect(idDeterministico('seed:talhao:GUAPIRAMA:053')).not.toBe(idDeterministico('seed:talhao:GUAPIRAMA:054'));
  });
});

describe('carregarSeed', () => {
  it('cadastra fazendas (com unidade PIMS e coluna de código), talhões, safra e áreas da cultura', async () => {
    const repo = repoNovo();
    expect(await seedJaCarregado(repo)).toBe(false);

    const r = await carregarSeed(repo, fetchFalso());

    expect(r).toEqual({ fazendas: 2, talhoes: 4, areas: 3 });
    expect(await seedJaCarregado(repo)).toBe(true);
    const fazendas = await repo.listarFazendas();
    expect(fazendas.map((f) => [f.nome, f.unidadePims, f.campoCodigo, f.campoNome, f.campoSetor])).toEqual([
      ['Globo', 'GLOBO', 'codigo', 'nome', null],
      ['Siriema', 'SIRIEMA', 'codigo', 'nome', 'setor'],
    ]);
    const siriema = fazendas.find((f) => f.unidadePims === 'SIRIEMA')!;
    expect(siriema.id).toBe(idDeterministico('seed:fazenda:SIRIEMA'));
    expect(siriema.colunas).toEqual(['codigo', 'codigoBruto', 'nome', 'setor']);

    const talhoes = await repo.obterTalhoes(siriema.id);
    const t39 = talhoes.find((t) => t.codigo === '039B')!;
    expect(t39).toMatchObject({ id: idDeterministico('seed:talhao:SIRIEMA:039B'), nome: '39B', setor: 'SÃO MIGUEL', fazendaId: siriema.id });
    expect(t39.areaHa).toBeGreaterThan(100); // ~0,01° × 0,01° no equador ≈ 123 ha
    expect(t39.atributos).toMatchObject({ codigoBruto: '39B' });

    const globo = fazendas.find((f) => f.unidadePims === 'GLOBO')!;
    const semCodigo = (await repo.obterTalhoes(globo.id)).find((t) => t.nome === 'Talhão 1')!;
    expect(semCodigo.codigo).toBeNull();
    expect(semCodigo.id).toBe(idDeterministico('seed:talhao:GLOBO:#1'));
    expect(semCodigo.setor).toBeNull();

    const [safra] = await repo.listarSafras();
    expect(safra).toEqual({
      id: idDeterministico('seed:safra:SOJA 26/27'),
      nome: 'SOJA 26/27',
      nomePims: 'SOJA 26/27',
      cultura: 'SOJA',
      anoSafra: '26/27',
      inicio: '2026-09-01',
      fim: '2027-08-31',
    });
    const areas = await repo.listarAreasCultura(safra.id, siriema.id);
    expect(areas.map((a) => [a.codigo, a.id])).toEqual(
      expect.arrayContaining([
        ['007', idDeterministico('seed:area:SOJA 26/27:SIRIEMA:007')],
        ['018A', idDeterministico('seed:area:SOJA 26/27:SIRIEMA:018A')],
        ['', idDeterministico('seed:area:SOJA 26/27:SIRIEMA:#2')],
      ]),
    );
    expect(areas).toHaveLength(3);
  });

  it('é idempotente: rodar duas vezes não duplica nada', async () => {
    const repo = repoNovo();
    await carregarSeed(repo, fetchFalso());
    const antes = await repo.exportarBackup();
    await carregarSeed(repo, fetchFalso());
    const depois = await repo.exportarBackup();
    expect(depois.fazendas.map((f) => f.id).sort()).toEqual(antes.fazendas.map((f) => f.id).sort());
    expect(depois.talhoes).toHaveLength(4);
    expect(depois.safras).toHaveLength(1);
    expect(depois.areasCultura).toHaveLength(3);
  });

  it('não apaga dados do usuário: mantém nome da fazenda/talhão renomeados e o plantio marcado', async () => {
    const repo = repoNovo();
    await carregarSeed(repo, fetchFalso());
    const siriema = (await repo.listarFazendas()).find((f) => f.unidadePims === 'SIRIEMA')!;
    const [safra] = await repo.listarSafras();
    const t007 = (await repo.obterTalhoes(siriema.id)).find((t) => t.codigo === '007')!;
    await repo.atualizarFazenda({ ...siriema, nome: 'Siriema + São Miguel' }, [{ ...t007, nome: 'Sete' }]);
    const plantio = { safraId: safra.id, talhaoId: t007.id, dataPlantio: '2026-09-20', origem: 'manual' as const, status: 'plantado' as const, areaPrevista: null, areaPlantada: null, inicio: null, fim: null, variedade: null };
    await repo.salvarPlantios(safra.id, siriema.id, [plantio]);
    await repo.salvarSafra({ ...safra, nome: 'Soja 2026/2027' });

    await carregarSeed(repo, fetchFalso());

    const f = (await repo.listarFazendas()).find((x) => x.id === siriema.id)!;
    expect(f.nome).toBe('Siriema + São Miguel');
    expect((await repo.obterTalhoes(siriema.id)).find((t) => t.id === t007.id)?.nome).toBe('Sete');
    expect(await repo.listarPlantios(safra.id)).toEqual([plantio]);
    expect((await repo.listarSafras()).map((s) => s.nome)).toEqual(['Soja 2026/2027']);
  });

  it('reaproveita fazenda e safra cadastradas à mão (mesmo nome), sem duplicar nem trocar os talhões do usuário', async () => {
    const repo = repoNovo();
    const minha = { id: 'minha-faz', nome: 'SIRIEMA', campoNome: 'TALHAO', campoSetor: null, colunas: ['TALHAO'], criadoEm: '2026-01-01T00:00:00.000Z', unidadePims: null, campoCodigo: null };
    await repo.salvarFazenda(minha, [{ id: 'meu-talhao', fazendaId: 'minha-faz', nome: 'T1', setor: null, areaHa: 1, geom: quadrado(0), atributos: {}, codigo: null }]);
    await repo.salvarSafra({ id: 'minha-safra', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-15', fim: '2027-03-31', nomePims: null });

    const r = await carregarSeed(repo, fetchFalso());

    expect(r.fazendas).toBe(2);
    const fazendas = await repo.listarFazendas();
    expect(fazendas).toHaveLength(2);
    const f = fazendas.find((x) => x.id === 'minha-faz')!;
    expect(f).toMatchObject({ nome: 'SIRIEMA', unidadePims: 'SIRIEMA', campoNome: 'TALHAO' });
    expect((await repo.obterTalhoes('minha-faz')).map((t) => t.id)).toEqual(['meu-talhao']);
    const safras = await repo.listarSafras();
    expect(safras).toEqual([{ id: 'minha-safra', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-15', fim: '2027-03-31', nomePims: 'SOJA 26/27' }]);
    expect(await repo.listarAreasCultura('minha-safra', 'minha-faz')).toHaveLength(3);
  });

  it('seed.json ausente → erro em português', async () => {
    await expect(carregarSeed(repoNovo(), fetchFalso({}))).rejects.toThrow(/cadastro padrão/i);
  });

  it('servidor que não responde: desiste no tempo limite com mensagem em português e cancela o fetch', async () => {
    let sinal: AbortSignal | undefined;
    const trava = ((_url: string, init?: RequestInit) => {
      sinal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); // nunca responde (nem respeita o abort)
    }) as unknown as typeof fetch;
    await expect(carregarSeed(repoNovo(), trava, { timeoutMs: 20 })).rejects.toThrow(/Tempo esgotado ao ler o cadastro padrão \(seed\.json\)/);
    expect(sinal?.aborted).toBe(true);
  });

  it('corpo que trava depois do cabeçalho também cai no tempo limite', async () => {
    const corpoTrava = (async () => ({ ok: true, status: 200, json: () => new Promise(() => undefined) }) as unknown as Response) as unknown as typeof fetch;
    await expect(carregarSeed(repoNovo(), corpoTrava, { timeoutMs: 20 })).rejects.toThrow(/Tempo esgotado/);
  });

  const SEED_REAL = 'public/dados/seed/seed.json';
  it.skipIf(!existsSync(SEED_REAL))('carrega o seed real de public/dados/seed', async () => {
    const lerPublico = (async (url: string) => {
      const caminho = `public/${url.replace(/^\.\//, '')}`;
      return existsSync(caminho) ? new Response(readFileSync(caminho, 'utf8'), { status: 200 }) : new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const seed = JSON.parse(readFileSync(SEED_REAL, 'utf8'));
    const contar = (arq: string) => JSON.parse(readFileSync(`public/dados/seed/${arq}`, 'utf8')).features.length as number;
    const talhoesEsperados = seed.fazendas.reduce((n: number, f: { arquivoBase: string }) => n + contar(f.arquivoBase), 0);
    const areasEsperadas = seed.safras.flatMap((s: { areasCultura: { arquivo: string }[] }) => s.areasCultura).reduce((n: number, a: { arquivo: string }) => n + contar(a.arquivo), 0);

    const repo = repoNovo();
    const r = await carregarSeed(repo, lerPublico);

    expect(r).toEqual({ fazendas: seed.fazendas.length, talhoes: talhoesEsperados, areas: areasEsperadas });
    const b = await repo.exportarBackup();
    expect(b.talhoes).toHaveLength(talhoesEsperados);
    expect(b.areasCultura).toHaveLength(areasEsperadas);
    expect(new Set(b.talhoes.map((t) => t.id)).size).toBe(talhoesEsperados);
    await carregarSeed(repo, lerPublico);
    expect((await repo.exportarBackup()).talhoes).toHaveLength(talhoesEsperados);
  }, 60_000); // ~8 MB de GeoJSON, duas cargas no fake-indexeddb
});
