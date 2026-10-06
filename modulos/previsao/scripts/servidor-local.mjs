// COA WEB no computador, para testar a Previsão do Tempo sem login: serve a raiz do repositório,
// troca previsao/config.js por { modo: 'local' } e responde /api/previsao-teste com fazendas
// FICTÍCIAS (nenhum limite real entra no repositório).
// Uso (na raiz): node modulos/previsao/scripts/servidor-local.mjs  → http://localhost:8791/previsao/
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RAIZ_REAL = realpathSync.native(RAIZ);
const PORTA = Number(process.env.PORT || 8791);
// só pelo endereço local: um site de fora que aponte um nome qualquer para 127.0.0.1 não lê isto
const HOSTS = [`localhost:${PORTA}`, `127.0.0.1:${PORTA}`];

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Fazenda de mentira: uma grade de talhões retangulares a partir do canto noroeste. */
function fazendaTeste(id, nome, coaId, norte, oeste, colunas, linhas) {
  const lado = 0.022; // ~2,4 km
  const talhoes = [];
  for (let l = 0; l < linhas; l++) {
    for (let c = 0; c < colunas; c++) {
      // a grade "quebra" um pouco para o contorno não ser um retângulo perfeito
      if ((l === 0 && c === colunas - 1) || (l === linhas - 1 && c === 0)) continue;
      const o = oeste + c * lado, n = norte - l * lado;
      talhoes.push({
        fazenda_id: id,
        geom: { type: 'Polygon', coordinates: [[[o, n], [o + lado * 0.96, n], [o + lado * 0.96, n - lado * 0.96], [o, n - lado * 0.96], [o, n]]] },
      });
    }
  }
  return { fazenda: { id, nome, coa_fazenda_id: coaId }, talhoes };
}
const TESTE = [
  fazendaTeste('teste-1', 'Fazenda Teste Norte', 1, -12.9, -56.3, 5, 4),
  fazendaTeste('teste-2', 'Fazenda Teste Centro', 2, -13.6, -55.7, 6, 3),
  fazendaTeste('teste-3', 'Fazenda Teste Sul', 3, -14.6, -56.9, 4, 5),
];
const CADASTRO_TESTE = JSON.stringify({
  fazendas: TESTE.map((t) => t.fazenda),
  talhoes: TESTE.flatMap((t) => t.talhoes),
});

/** Caminho real do arquivo pedido, ou null: só arquivos de dentro da raiz do repositório e nunca a pasta .git. */
function arquivoServivel(caminho) {
  // ':', '\' e NUL não existem nos endereços do site e abrem brechas no Windows (fluxos NTFS, ..\)
  if (/[:\\\0]/.test(caminho)) return null;
  let real;
  try {
    real = realpathSync.native(join(RAIZ, caminho));
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  const rel = relative(RAIZ_REAL, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null;
  if (rel.split(sep).some((parte) => parte.toLowerCase() === '.git')) return null;
  return real;
}

function responder(res, status, tipo, texto) {
  res.statusCode = status;
  res.setHeader('Content-Type', tipo);
  res.setHeader('Cache-Control', 'no-store');
  res.end(texto);
}

createServer((req, res) => {
  if (!HOSTS.includes(String(req.headers.host || '').toLowerCase())) {
    responder(res, 400, 'text/plain; charset=utf-8', 'host não aceito');
    return;
  }
  let caminho;
  try {
    caminho = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch {
    responder(res, 400, 'text/plain; charset=utf-8', 'endereço inválido');
    return;
  }
  if (caminho === '/api/previsao-teste') {
    responder(res, 200, TIPOS['.json'], CADASTRO_TESTE);
    return;
  }
  if (caminho === '/previsao/config.js') {
    responder(res, 200, TIPOS['.js'], "window.PREVISAO_CONFIG = { modo: 'local' };\n");
    return;
  }
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = arquivoServivel(caminho);
  if (!arquivo) {
    responder(res, 404, 'text/plain; charset=utf-8', 'não encontrado');
    return;
  }
  res.setHeader('Content-Type', TIPOS[extname(arquivo).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  const leitura = createReadStream(arquivo);
  leitura.on('error', () => res.destroy());
  leitura.pipe(res);
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`COA WEB local em http://localhost:${PORTA}/previsao/ (fazendas fictícias)`);
});
