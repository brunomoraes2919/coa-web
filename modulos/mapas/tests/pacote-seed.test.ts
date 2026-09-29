import 'fake-indexeddb/auto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { montarPacoteSeed } from '../scripts/pacote-seed.mjs';
import { criarLocalRepo } from '../src/data/localRepo';
import { carregarSeed, leitorDeZip } from '../src/lib/seed';
import { ARQUIVOS, leitorFalso } from './helpers/seedFalso';

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Pasta temporária com os arquivos do cadastro padrão de teste (menos os `sem`). */
function pastaDoSeed(sem: string[] = []): string {
  const pasta = mkdtempSync(join(tmpdir(), 'pacote-seed-'));
  pastas.push(pasta);
  for (const [caminho, v] of Object.entries(ARQUIVOS)) {
    if (sem.includes(caminho)) continue;
    mkdirSync(dirname(join(pasta, caminho)), { recursive: true });
    writeFileSync(join(pasta, caminho), JSON.stringify(v));
  }
  return pasta;
}

describe('montarPacoteSeed', () => {
  it('compacta a pasta do seed (seed.json na raiz do zip) e o leitorDeZip lê de volta', async () => {
    const { zip, arquivos } = montarPacoteSeed(pastaDoSeed());
    expect(arquivos).toEqual(Object.keys(ARQUIVOS).sort());

    const ler = await leitorDeZip(new Blob([zip as Uint8Array<ArrayBuffer>]));
    const r = await carregarSeed(criarLocalRepo('pacote-seed-zip'), ler);
    expect(r).toEqual(await carregarSeed(criarLocalRepo('pacote-seed-arquivos'), leitorFalso()));
  });

  it('recusa se falta o seed.json ou um arquivo citado nele', () => {
    expect(() => montarPacoteSeed(pastaDoSeed(['seed.json']))).toThrow(/seed\.json/);
    expect(() => montarPacoteSeed(pastaDoSeed(['base/GLOBO.geojson']))).toThrow(/base\/GLOBO\.geojson/);
  });
});
