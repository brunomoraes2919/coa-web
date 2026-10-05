// Confere o build publicado no COA WEB (npm run publicar → ../../sat, a partir de modulos/sat),
// com as mesmas regras do módulo Mapas: index.html presente, sem dados/, só a chave anon.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarPublicacao } from '../../mapas/scripts/verificar-publicacao.mjs';

const raizModulo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raizModulo, '../../sat');
const { problemas, total } = verificarPublicacao(saida);
if (problemas.length) {
  console.error('Publicação recusada:');
  for (const p of problemas) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`Publicação conferida: ${total} arquivos em ${saida} (index.html presente, sem dados/, só a chave anon).`);
}
