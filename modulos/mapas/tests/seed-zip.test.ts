import 'fake-indexeddb/auto';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import { carregarSeed, leitorDeZip, nomeComparavel } from '../src/lib/seed';
import { ARQUIVOS, leitorFalso } from './helpers/seedFalso';

let contador = 0;
const repoNovo = () => criarLocalRepo(`coa-seed-zip-${++contador}`);

/** Zip montado no teste: nome da entrada → texto (entrada terminada em "/" = pasta). */
function zipDe(entradas: Record<string, string>): Blob {
  const z: Zippable = {};
  for (const [nome, texto] of Object.entries(entradas)) z[nome] = strToU8(texto);
  return new Blob([zipSync(z) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** Os arquivos do cadastro padrão de teste, com um prefixo opcional (pasta dentro do zip). */
const entradasDoSeed = (prefixo = '', separador = '/') =>
  Object.fromEntries(Object.entries(ARQUIVOS).map(([caminho, v]) => [prefixo + caminho.replaceAll('/', separador), JSON.stringify(v)]));

describe('nomeComparavel', () => {
  it('sem acento, maiúsculas, espaços simples e sem pontas', () => {
    expect(nomeComparavel('Três Flechas')).toBe('TRES FLECHAS');
    expect(nomeComparavel('  tres   flechas\t')).toBe('TRES FLECHAS');
    expect(nomeComparavel('São  Miguel')).toBe('SAO MIGUEL');
    expect(nomeComparavel('Conceição\nda Barra')).toBe('CONCEICAO DA BARRA');
    expect(nomeComparavel('SM3')).toBe('SM3');
    expect(nomeComparavel('')).toBe('');
  });

  it('o nome do seed casa com o do COA WEB (Três Flechas ↔ Tres Flechas)', () => {
    expect(nomeComparavel('Três Flechas')).toBe(nomeComparavel('Tres Flechas'));
    expect(nomeComparavel('Três Flechas')).toBe(nomeComparavel('TRES FLECHAS'));
    expect(nomeComparavel('Globo')).not.toBe(nomeComparavel('Globo 2'));
  });
});

describe('leitorDeZip', () => {
  it('lê os arquivos com o seed.json na raiz do zip (texto UTF-8)', async () => {
    const ler = await leitorDeZip(zipDe(entradasDoSeed()));
    expect(JSON.parse(await ler('seed.json'))).toEqual(ARQUIVOS['seed.json']);
    expect(await ler('base/SIRIEMA.geojson')).toContain('SÃO MIGUEL');
  });

  it('aceita o seed dentro de uma pasta única (zip da pasta inteira)', async () => {
    const ler = await leitorDeZip(zipDe({ 'cadastro-padrao/': '', 'cadastro-padrao/base/': '', ...entradasDoSeed('cadastro-padrao/') }));
    expect(JSON.parse(await ler('seed.json'))).toEqual(ARQUIVOS['seed.json']);
    expect(JSON.parse(await ler('soja-26-27/SIRIEMA.geojson'))).toEqual(ARQUIVOS['soja-26-27/SIRIEMA.geojson']);
  });

  it('aceita nomes com barra invertida (zip feito no Windows)', async () => {
    const ler = await leitorDeZip(zipDe(entradasDoSeed('seed\\', '\\')));
    expect(JSON.parse(await ler('base/GLOBO.geojson'))).toEqual(ARQUIVOS['base/GLOBO.geojson']);
  });

  it('arquivo que falta no zip → erro em português com o caminho', async () => {
    const ler = await leitorDeZip(zipDe(entradasDoSeed()));
    await expect(ler('base/NAO_EXISTE.geojson')).rejects.toThrow(/cadastro padrão.*base\/NAO_EXISTE\.geojson/);
  });

  it('zip sem seed.json (ou com mais de uma pasta com seed.json) → erro em português', async () => {
    await expect(leitorDeZip(zipDe({ 'outra-coisa.txt': 'x' }))).rejects.toThrow(/seed\.json/);
    await expect(leitorDeZip(zipDe({ ...entradasDoSeed('a/'), ...entradasDoSeed('b/') }))).rejects.toThrow(/seed\.json/);
  });

  it('arquivo que não é zip → erro em português', async () => {
    await expect(leitorDeZip(new Blob(['isto não é um zip']))).rejects.toThrow(/zip do cadastro padrão/i);
  });

  it('carregarSeed pelo zip (raiz ou pasta única) grava o mesmo que pelos arquivos', async () => {
    const repoArquivos = repoNovo();
    const esperado = await carregarSeed(repoArquivos, leitorFalso());
    const backupArquivos = await repoArquivos.exportarBackup();
    for (const blob of [zipDe(entradasDoSeed()), zipDe(entradasDoSeed('cadastro-padrao-mapas/'))]) {
      const repo = repoNovo();
      expect(await carregarSeed(repo, await leitorDeZip(blob))).toEqual(esperado);
      const b = await repo.exportarBackup();
      expect(b.talhoes.map((t) => t.id).sort()).toEqual(backupArquivos.talhoes.map((t) => t.id).sort());
      expect(b.areasCultura?.map((a) => a.id).sort()).toEqual(backupArquivos.areasCultura?.map((a) => a.id).sort());
    }
  });
});
