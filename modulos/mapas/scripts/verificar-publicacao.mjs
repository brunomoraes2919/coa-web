// Confere o build publicado no COA WEB (npm run publicar → ../../mapas, a partir de modulos/mapas).
// Falha se: não há index.html; os dados da Locks (dados/) foram junto; algum arquivo cita "service_role".
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizModulo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raizModulo, '../../mapas');
const PROIBIDO = Buffer.from('service_role');

/** Todos os arquivos (recursivo) de uma pasta. */
function arquivos(pasta) {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(pasta, e.name);
    return e.isDirectory() ? arquivos(caminho) : [caminho];
  });
}

const problemas = [];
if (!existsSync(join(saida, 'index.html'))) problemas.push(`não existe ${join(saida, 'index.html')}`);
if (existsSync(join(saida, 'dados'))) problemas.push(`existe ${join(saida, 'dados')} (dados da Locks não podem ser publicados)`);

let total = 0;
if (existsSync(saida)) {
  for (const arq of arquivos(saida)) {
    total++;
    if (readFileSync(arq).includes(PROIBIDO)) problemas.push(`${relative(saida, arq)} contém "service_role"`);
  }
}

if (problemas.length) {
  console.error('Publicação recusada:');
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Publicação conferida: ${total} arquivos em ${saida} (index.html presente, sem dados/, sem service_role).`);
