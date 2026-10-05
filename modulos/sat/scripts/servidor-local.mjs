// COA WEB no computador, para testar o Locks SAT antes de publicar: serve a raiz do repositório e
// responde /api/gnss com o MESMO arquivo que a Vercel publica (api/gnss.js).
// Uso (em modulos/sat): npm run local   → faz o build em ../../sat e sobe em http://localhost:8770/
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RAIZ_REAL = realpathSync.native(RAIZ);
const ponte = createRequire(import.meta.url)(join(RAIZ, 'api', 'gnss.js'));
const PORTA = Number(process.env.PORT || 8770);
// só pelo endereço local: um site de fora que aponte um nome qualquer para 127.0.0.1 não lê isto
const HOSTS = [`localhost:${PORTA}`, `127.0.0.1:${PORTA}`];

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Caminho real do arquivo pedido, ou null: só arquivos de dentro da raiz do repositório e nunca a pasta .git. */
function arquivoServivel(caminho) {
  // ':', '\' e NUL não existem nos endereços do site e abrem brechas no Windows (fluxos NTFS, ..\)
  if (/[:\\\0]/.test(caminho)) return null;
  let real;
  try {
    // o caminho real resolve ../, atalhos e maiúsculas/minúsculas do disco antes da conferência
    real = realpathSync.native(join(RAIZ, caminho));
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  const rel = relative(RAIZ_REAL, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null;
  // .git em qualquer nível (no Windows .GIT é a mesma pasta)
  if (rel.split(sep).some((parte) => parte.toLowerCase() === '.git')) return null;
  return real;
}

function recusar(res, status, texto) {
  res.statusCode = status;
  res.end(texto);
}

createServer((req, res) => {
  if (!HOSTS.includes(String(req.headers.host || '').toLowerCase())) {
    recusar(res, 400, 'host não aceito');
    return;
  }
  let url;
  let caminho;
  try {
    url = new URL(req.url, 'http://local');
    caminho = decodeURIComponent(url.pathname);
  } catch {
    recusar(res, 400, 'endereço inválido');
    return;
  }
  if (url.pathname === '/api/gnss') {
    ponte(req, res).catch(() => recusar(res, 500, 'erro na ponte'));
    return;
  }
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = arquivoServivel(caminho);
  if (!arquivo) {
    recusar(res, 404, 'não encontrado');
    return;
  }
  res.setHeader('Content-Type', TIPOS[extname(arquivo).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  const leitura = createReadStream(arquivo);
  leitura.on('error', () => res.destroy());
  leitura.pipe(res);
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`COA WEB local em http://localhost:${PORTA}/ (ponte da Trimble em /api/gnss)`);
});
