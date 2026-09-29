import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import type { Fazenda, PlantioPimsArquivo } from '../src/lib/types';
import { fazenda, mapa } from './helpers/dominio';

let contador = 0;
const nomeNovo = () => `coa-chuva-teste-coa-${++contador}`;
const jpeg = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const png = () => new Blob(['png'], { type: 'image/png' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localRepo: vínculo com a fazenda do COA WEB (coaFazendaId)', () => {
  it('fazenda gravada antes do campo existir é lida com coaFazendaId = null (e exportada assim)', async () => {
    const nome = nomeNovo();
    const repo = criarLocalRepo(nome);
    await repo.listarFazendas(); // cria o banco na versão atual
    const { coaFazendaId: _c, ...antiga } = fazenda(1);
    const db = await openDB(nome);
    await db.put('fazendas', antiga);
    db.close();

    expect(await repo.listarFazendas()).toEqual([fazenda(1)]);
    expect((await repo.exportarBackup()).fazendas).toEqual([fazenda(1)]);
  });

  it('o backup exporta e importa o campo; backup antigo sem o campo importa com null', async () => {
    const origem = criarLocalRepo(nomeNovo());
    const ligada: Fazenda = { ...fazenda(1), coaFazendaId: 7 };
    await origem.salvarFazenda(ligada, []);
    const backup = JSON.parse(JSON.stringify(await origem.exportarBackup()));
    expect(backup.fazendas[0].coaFazendaId).toBe(7);

    const destino = criarLocalRepo(nomeNovo());
    await destino.importarBackup(backup);
    expect(await destino.listarFazendas()).toEqual([ligada]);

    const { coaFazendaId: _c, ...semCampo } = fazenda(2);
    await destino.importarBackup({ versao: 1, fazendas: [semCampo as Fazenda], talhoes: [], safras: [], plantios: [], mapas: [] });
    expect((await destino.listarFazendas()).find((f) => f.id === fazenda(2).id)?.coaFazendaId).toBeNull();
  });
});

describe('localRepo: perfil, fazendas do COA WEB e plantio do PIMS', () => {
  it("modo local: perfil 'admin' e nenhuma fazenda do COA WEB", async () => {
    const repo = criarLocalRepo(nomeNovo());
    expect(await repo.perfil()).toBe('admin');
    expect(await repo.listarFazendasCoa()).toEqual([]);
  });

  it('lerPlantioPims lê ./dados/plantio.json (sem arquivo → null)', async () => {
    const arq: PlantioPimsArquivo = { versao: 1, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS via Agrovex', safras: [] };
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(arq), { status: 200 });
    });
    const repo = criarLocalRepo(nomeNovo());
    expect(await repo.lerPlantioPims()).toEqual(arq);
    expect(urls).toEqual(['./dados/plantio.json']);

    vi.stubGlobal('fetch', async () => new Response('não achei', { status: 404 }));
    expect(await repo.lerPlantioPims()).toBeNull();
  });
});

describe('localRepo: cópia do histórico em JPEG', () => {
  it('grava mapas/<id>.jpg (extensão pelo tipo do blob) e a miniatura PNG', async () => {
    const repo = criarLocalRepo(nomeNovo());
    const salvo = await repo.salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), jpeg(), png());
    expect(salvo.pngPath).toBe(`mapas/${salvo.id}.jpg`);
    expect(salvo.thumbPath).toBe(`mapas/${salvo.id}-thumb.png`);
    expect(await repo.urlArquivo(salvo.pngPath!)).toBeTruthy();
  });

  it('regravar um mapa antigo em PNG como JPEG apaga o PNG antigo; o mapa antigo continua abrindo até lá', async () => {
    const repo = criarLocalRepo(nomeNovo());
    const antigo = await repo.salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), png(), png());
    expect(antigo.pngPath).toBe(`mapas/${antigo.id}.png`);
    expect(await repo.urlArquivo(antigo.pngPath!)).toBeTruthy();

    const novo = await repo.salvarMapa({ ...antigo, titulo: 'Atualizado' }, jpeg(), png());

    expect(novo.pngPath).toBe(`mapas/${antigo.id}.jpg`);
    await expect(repo.urlArquivo(antigo.pngPath!)).rejects.toThrow('Arquivo não encontrado');
    expect(await repo.urlArquivo(novo.pngPath!)).toBeTruthy();
    expect(await repo.urlArquivo(novo.thumbPath!)).toBeTruthy(); // mesmo caminho: não é apagada
    expect((await repo.obterMapa(antigo.id))?.titulo).toBe('Atualizado');
  });
});
