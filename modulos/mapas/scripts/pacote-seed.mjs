// Compacta o cadastro padrão (public/dados/seed/: seed.json + GeoJSONs) em cadastro-padrao-mapas.zip,
// na raiz do módulo, para o admin importar em Fazendas → "Importar cadastro padrão" (a publicação não
// leva public/dados/). São dados da Locks: o zip nunca vai para o git (*.zip no .gitignore da raiz).
// Uso: npm run pacote-seed (a partir de modulos/mapas).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';

/** Todos os arquivos (recursivo) de uma pasta, relativos a `raiz`, com "/" e em ordem. */
function arquivos(raiz, pasta = raiz) {
  return readdirSync(pasta, { withFileTypes: true })
    .flatMap((e) => {
      const caminho = join(pasta, e.name);
      return e.isDirectory() ? arquivos(raiz, caminho) : [relative(raiz, caminho).split(sep).join('/')];
    })
    .sort();
}

/**
 * Monta o zip da pasta do seed (seed.json na raiz do zip). Recusa se falta o seed.json ou algum
 * arquivo citado nele (arquivoBase das fazendas e arquivos das áreas da cultura).
 * @param {string} pasta
 * @returns {{ zip: Uint8Array; arquivos: string[] }}
 */
export function montarPacoteSeed(pasta) {
  const seedJson = join(pasta, 'seed.json');
  if (!existsSync(seedJson)) throw new Error(`não existe ${seedJson} (gere com "npm run seed")`);
  const seed = JSON.parse(readFileSync(seedJson, 'utf8'));
  const citados = [
    ...(seed.fazendas ?? []).map((f) => f.arquivoBase),
    ...(seed.safras ?? []).flatMap((s) => (s.areasCultura ?? []).map((a) => a.arquivo)),
  ];
  const lista = arquivos(pasta);
  const faltam = citados.filter((c) => !lista.includes(c));
  if (faltam.length) throw new Error(`arquivos citados no seed.json que não existem em ${pasta}: ${faltam.join(', ')}`);
  const conteudo = Object.fromEntries(lista.map((c) => [c, readFileSync(join(pasta, c))]));
  return { zip: zipSync(conteudo, { level: 9 }), arquivos: lista };
}

function main() {
  const raizModulo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pasta = resolve(raizModulo, 'public/dados/seed');
  const saida = resolve(raizModulo, 'cadastro-padrao-mapas.zip');
  let pacote;
  try {
    pacote = montarPacoteSeed(pasta);
  } catch (e) {
    console.error(`Pacote do cadastro padrão não gerado: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(saida, pacote.zip);
  const mb = (pacote.zip.length / 1024 / 1024).toFixed(1).replace('.', ',');
  console.log(`${saida} (${mb} MB, ${pacote.arquivos.length} arquivos):`);
  for (const a of pacote.arquivos) console.log(`  ${a}`);
  console.log('Não publique nem faça commit deste arquivo (dados da Locks).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
