import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import type { Repositorio } from '../src/data/repo';
import { carregarSeed, idDeterministico, leitorHttp, seedJaCarregado } from '../src/lib/seed';
import { ARQUIVOS, leitorFalso, quadrado } from './helpers/seedFalso';

let contador = 0;
const repoNovo = (): Repositorio => criarLocalRepo(`coa-seed-teste-${++contador}`);

/** fetch falso servindo ARQUIVOS em ./dados/seed/ (a pasta padrão do leitorHttp). */
function fetchFalso(arquivos: Record<string, unknown> = ARQUIVOS): typeof fetch {
  return (async (url: string) => {
    const caminho = url.replace(/^\.\/dados\/seed\//, '');
    return caminho in arquivos ? new Response(JSON.stringify(arquivos[caminho]), { status: 200 }) : new Response('não encontrado', { status: 404 });
  }) as unknown as typeof fetch;
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

    const r = await carregarSeed(repo, leitorFalso());

    // modo local: nenhuma fazenda do COA WEB para ligar
    expect(r).toEqual({ fazendas: 2, talhoes: 4, areas: 3, ligadas: 0, semVinculo: ['Siriema', 'Globo'] });
    expect(await seedJaCarregado(repo)).toBe(true);
    const fazendas = await repo.listarFazendas();
    expect(fazendas.map((f) => [f.nome, f.unidadePims, f.campoCodigo, f.campoNome, f.campoSetor, f.coaFazendaId])).toEqual([
      ['Globo', 'GLOBO', 'codigo', 'nome', null, null],
      ['Siriema', 'SIRIEMA', 'codigo', 'nome', 'setor', null],
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
    await carregarSeed(repo, leitorFalso());
    const antes = await repo.exportarBackup();
    await carregarSeed(repo, leitorFalso());
    const depois = await repo.exportarBackup();
    expect(depois.fazendas.map((f) => f.id).sort()).toEqual(antes.fazendas.map((f) => f.id).sort());
    expect(depois.talhoes).toHaveLength(4);
    expect(depois.safras).toHaveLength(1);
    expect(depois.areasCultura).toHaveLength(3);
  });

  it('não apaga dados do usuário: mantém nome da fazenda/talhão renomeados e o plantio marcado', async () => {
    const repo = repoNovo();
    await carregarSeed(repo, leitorFalso());
    const siriema = (await repo.listarFazendas()).find((f) => f.unidadePims === 'SIRIEMA')!;
    const [safra] = await repo.listarSafras();
    const t007 = (await repo.obterTalhoes(siriema.id)).find((t) => t.codigo === '007')!;
    await repo.atualizarFazenda({ ...siriema, nome: 'Siriema + São Miguel' }, [{ ...t007, nome: 'Sete' }]);
    const plantio = { safraId: safra.id, talhaoId: t007.id, dataPlantio: '2026-09-20', origem: 'manual' as const, status: 'plantado' as const, areaPrevista: null, areaPlantada: null, inicio: null, fim: null, variedade: null };
    await repo.salvarPlantios(safra.id, siriema.id, [plantio]);
    await repo.salvarSafra({ ...safra, nome: 'Soja 2026/2027' });

    const r = await carregarSeed(repo, leitorFalso());

    const f = (await repo.listarFazendas()).find((x) => x.id === siriema.id)!;
    expect(f.nome).toBe('Siriema + São Miguel');
    expect(r.semVinculo).toEqual(['Siriema + São Miguel', 'Globo']); // o nome que o usuário vê
    expect((await repo.obterTalhoes(siriema.id)).find((t) => t.id === t007.id)?.nome).toBe('Sete');
    expect(await repo.listarPlantios(safra.id)).toEqual([plantio]);
    expect((await repo.listarSafras()).map((s) => s.nome)).toEqual(['Soja 2026/2027']);
  });

  it('reaproveita fazenda e safra cadastradas à mão (mesmo nome), sem duplicar nem trocar os talhões do usuário', async () => {
    const repo = repoNovo();
    const minha = { id: 'minha-faz', nome: 'SIRIEMA', campoNome: 'TALHAO', campoSetor: null, colunas: ['TALHAO'], criadoEm: '2026-01-01T00:00:00.000Z', unidadePims: null, campoCodigo: null, coaFazendaId: null };
    await repo.salvarFazenda(minha, [{ id: 'meu-talhao', fazendaId: 'minha-faz', nome: 'T1', setor: null, areaHa: 1, geom: quadrado(0), atributos: {}, codigo: null }]);
    await repo.salvarSafra({ id: 'minha-safra', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-15', fim: '2027-03-31', nomePims: null });

    const r = await carregarSeed(repo, leitorFalso());

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

  it('avisa o andamento (leitura, cada unidade e as áreas da cultura)', async () => {
    const etapas: string[] = [];
    await carregarSeed(repoNovo(), leitorFalso(), { aoAvancar: (t) => etapas.push(t) });
    expect(etapas).toEqual([
      'Lendo os arquivos do cadastro padrão…',
      'Gravando Siriema (1 de 2)…',
      'Gravando Globo (2 de 2)…',
      'Gravando as áreas da cultura da SOJA 26/27…',
    ]);
  });

  it('seed.json sem fazendas/safras → erro em português', async () => {
    await expect(carregarSeed(repoNovo(), leitorFalso({ 'seed.json': { versao: 1 } }))).rejects.toThrow(/cadastro padrão.*seed\.json/i);
  });

  it('arquivo que não é JSON → erro em português com o caminho', async () => {
    const ler = async (c: string) => (c === 'seed.json' ? '{ quebrado' : '');
    await expect(carregarSeed(repoNovo(), ler)).rejects.toThrow(/seed\.json.*cadastro padrão|cadastro padrão.*seed\.json/i);
  });

  const SEED_REAL = 'public/dados/seed/seed.json';
  it.skipIf(!existsSync(SEED_REAL))('carrega o seed real de public/dados/seed', async () => {
    const lerPublico = (caminho: string) => readFile(`public/dados/seed/${caminho}`, 'utf8');
    const seed = JSON.parse(readFileSync(SEED_REAL, 'utf8'));
    const contar = (arq: string) => JSON.parse(readFileSync(`public/dados/seed/${arq}`, 'utf8')).features.length as number;
    const talhoesEsperados = seed.fazendas.reduce((n: number, f: { arquivoBase: string }) => n + contar(f.arquivoBase), 0);
    const areasEsperadas = seed.safras.flatMap((s: { areasCultura: { arquivo: string }[] }) => s.areasCultura).reduce((n: number, a: { arquivo: string }) => n + contar(a.arquivo), 0);

    const repo = repoNovo();
    const r = await carregarSeed(repo, lerPublico);

    expect(r).toMatchObject({ fazendas: seed.fazendas.length, talhoes: talhoesEsperados, areas: areasEsperadas, ligadas: 0 });
    const b = await repo.exportarBackup();
    expect(b.talhoes).toHaveLength(talhoesEsperados);
    expect(b.areasCultura).toHaveLength(areasEsperadas);
    expect(new Set(b.talhoes.map((t) => t.id)).size).toBe(talhoesEsperados);
    await carregarSeed(repo, lerPublico);
    expect((await repo.exportarBackup()).talhoes).toHaveLength(talhoesEsperados);
  }, 60_000); // ~8 MB de GeoJSON, duas cargas no fake-indexeddb
});

describe('leitorHttp', () => {
  it('lê da pasta ./dados/seed/ pelo caminho relativo (padrão do carregarSeed)', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await leitorHttp(undefined, { fetchImpl: f })('base/SM3.geojson')).toBe('{"ok":true}');
    expect(await leitorHttp('/outra', { fetchImpl: f })('seed.json')).toBe('{"ok":true}');
    expect(urls).toEqual(['./dados/seed/base/SM3.geojson', '/outra/seed.json']);
  });

  it('carregarSeed pelo leitorHttp cadastra o mesmo que pelo leitor em memória', async () => {
    const r = await carregarSeed(repoNovo(), leitorHttp(undefined, { fetchImpl: fetchFalso() }));
    expect(r).toMatchObject({ fazendas: 2, talhoes: 4, areas: 3 });
  });

  it('seed.json ausente (HTTP 404) → erro em português', async () => {
    await expect(carregarSeed(repoNovo(), leitorHttp(undefined, { fetchImpl: fetchFalso({}) }))).rejects.toThrow(/cadastro padrão \(seed\.json\): HTTP 404/i);
  });

  it('servidor que não responde: desiste no tempo limite com mensagem em português e cancela o fetch', async () => {
    let sinal: AbortSignal | undefined;
    const trava = ((_url: string, init?: RequestInit) => {
      sinal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); // nunca responde (nem respeita o abort)
    }) as unknown as typeof fetch;
    await expect(leitorHttp(undefined, { fetchImpl: trava, timeoutMs: 20 })('seed.json')).rejects.toThrow(/Tempo esgotado ao ler o cadastro padrão \(seed\.json\)/);
    expect(sinal?.aborted).toBe(true);
  });

  it('corpo que trava depois do cabeçalho também cai no tempo limite', async () => {
    const corpoTrava = (async () => ({ ok: true, status: 200, text: () => new Promise(() => undefined) }) as unknown as Response) as unknown as typeof fetch;
    await expect(leitorHttp(undefined, { fetchImpl: corpoTrava, timeoutMs: 20 })('seed.json')).rejects.toThrow(/Tempo esgotado/);
  });
});
