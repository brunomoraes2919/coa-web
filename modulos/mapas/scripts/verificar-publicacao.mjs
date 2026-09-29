// Confere o build publicado no COA WEB (npm run publicar → ../../mapas, a partir de modulos/mapas).
// Recusa se: não há index.html; os dados da Locks (dados/) foram junto; algum arquivo traz uma chave
// que não seja a anon (JWT com role diferente de 'anon', JWT ilegível, chave "sb_secret_…") ou cita
// "service_role". As mensagens nunca mostram o token, só o arquivo e o role.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Tokens com cara de JWT (cabeçalho e payload JSON em base64url: começam com "eyJ"). */
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
/**
 * Chave secreta do formato novo: o prefixo seguido do corpo da chave. Só o prefixo não conta: o
 * próprio supabase-js traz `startsWith("sb_secret_")` para reconhecer o formato das chaves.
 */
const SEGREDO_NOVO = /sb_secret_[A-Za-z0-9_-]{8,}/;
const SERVICE_ROLE = 'service_role';

/** role do payload do JWT; null se o payload não for base64url/JSON legível. */
function roleDoJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? String(payload.role ?? '(sem role)') : null;
  } catch {
    return null;
  }
}

/**
 * Problemas no conteúdo de um arquivo da saída (texto; binários lidos como latin1).
 * @param {string} nome caminho relativo, só para a mensagem
 * @param {string} texto
 * @returns {string[]}
 */
export function problemasNoConteudo(nome, texto) {
  const problemas = [];
  if (texto.includes(SERVICE_ROLE)) problemas.push(`${nome} cita "${SERVICE_ROLE}"`);
  if (SEGREDO_NOVO.test(texto)) problemas.push(`${nome} contém uma chave "sb_secret_…"`);
  for (const [token] of texto.matchAll(JWT)) {
    const role = roleDoJwt(token);
    if (role === null) problemas.push(`${nome} contém um JWT ilegível`);
    else if (role !== 'anon') problemas.push(`${nome} contém um JWT com role "${role}" (só a chave anon pode ser publicada)`);
  }
  return problemas;
}

/** Todos os arquivos (recursivo) de uma pasta. */
function arquivos(pasta) {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(pasta, e.name);
    return e.isDirectory() ? arquivos(caminho) : [caminho];
  });
}

/**
 * Confere a pasta publicada.
 * @param {string} saida pasta do build
 * @returns {{ problemas: string[]; total: number }}
 */
export function verificarPublicacao(saida) {
  const problemas = [];
  if (!existsSync(join(saida, 'index.html'))) problemas.push(`não existe ${join(saida, 'index.html')}`);
  if (existsSync(join(saida, 'dados'))) problemas.push(`existe ${join(saida, 'dados')} (dados da Locks não podem ser publicados)`);
  let total = 0;
  if (existsSync(saida)) {
    for (const arq of arquivos(saida)) {
      total++;
      problemas.push(...problemasNoConteudo(relative(saida, arq), readFileSync(arq).toString('latin1')));
    }
  }
  return { problemas, total };
}

function main() {
  const raizModulo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const saida = resolve(raizModulo, '../../mapas');
  const { problemas, total } = verificarPublicacao(saida);
  if (problemas.length) {
    console.error('Publicação recusada:');
    for (const p of problemas) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Publicação conferida: ${total} arquivos em ${saida} (index.html presente, sem dados/, só a chave anon).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
