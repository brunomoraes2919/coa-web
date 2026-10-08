// COA WEB no computador, para testar a "Chuva por talhão" sem login: serve a raiz do repositório, troca
// chuva/config.js por { modo: 'local' } e responde /api/chuva-teste com uma fazenda FICTÍCIA (nenhum limite,
// pluviômetro ou chuva real entra no repositório). Com CHUVA_DADOS=<arquivo .json fora do repositório> abre
// dados de verdade, só neste computador: { fazendas, safras, porFazenda: { <id>: { talhoes, areas, chuva } } }.
// Uso (na raiz): node modulos/chuva/scripts/servidor-local.mjs  → http://localhost:8794/chuva/
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RAIZ_REAL = realpathSync.native(RAIZ);
const PORTA = Number(process.env.PORT || 8794);
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

/** Fazenda de mentira: 12 talhões em grade (um subdividido e um sem vínculo), 3 pluviômetros e 60 dias de chuva. */
function dadosFicticios() {
  const DIAS = 60;
  const hoje = new Date(Date.now() - 4 * 3600000);
  const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - (DIAS - 1))).toISOString().slice(0, 10);
  const LAT = -13.0, LON = -55.0, PASSO = 0.012;
  const quadra = (col, lin, larg = 1) => {
    const o = LON + col * PASSO, l = o + PASSO * larg * 0.96, n = LAT - lin * PASSO, s = n - PASSO * 0.96;
    return { type: 'Polygon', coordinates: [[[o, s], [l, s], [l, n], [o, n], [o, s]]] };
  };
  const talhoes = [];
  let n = 0;
  for (let lin = 0; lin < 3; lin++) {
    for (let col = 0; col < 4; col++) {
      n++;
      const codigo = String(n).padStart(3, '0');
      if (n === 4) {
        // talhão subdividido: a ZEUS só conhece o '004'
        talhoes.push({ codigo: '004A', nome: '004A', area_ha: 80, geom: quadra(col, lin, 0.48) });
        talhoes.push({ codigo: '004B', nome: '004B', area_ha: 80, geom: quadra(col + 0.5, lin, 0.48) });
      } else talhoes.push({ codigo: n === 12 ? 'P14' : codigo, nome: n === 12 ? 'P14' : codigo, area_ha: 165, geom: quadra(col, lin) });
    }
  }
  // chuva de mentira, sempre igual: um "gerador" simples com semente fixa
  let semente = 7;
  const sorte = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const chuvaDoPic = (fator, parado) => {
    const partes = [];
    for (let d = 0; d < DIAS; d++) {
      if (parado && d >= DIAS - 2) continue; // pluviômetro sem leitura nos dois últimos dias
      const chove = sorte() < 0.28;
      const mm = chove ? Math.round(sorte() * 380 * fator) / 10 : 0;
      partes.push(mm > 0 ? `${d}:${mm.toFixed(1)}` : String(d));
    }
    return partes.join(',');
  };
  const leitura = (atras, hora) => `${new Date(Date.parse(inicio) + (DIAS - 1 - atras) * 86400000).toISOString().slice(0, 10)}T${hora}`;
  return {
    fazendas: [{ id: 'f1', nome: 'Teste Norte', unidade_pims: 'TESTE NORTE', coa_fazenda_id: 1 }, { id: 'f2', nome: 'Teste Sul', unidade_pims: 'TESTE SUL', coa_fazenda_id: 2 }],
    safras: [{ id: 's1', nome: 'Soja de teste', inicio: '2026-09-01' }],
    porFazenda: {
      f1: {
        talhoes,
        areas: [],
        chuva: {
          unidade: 'TESTE NORTE', gerado_em: new Date().toISOString(), inicio, dias: DIAS, ultima_leitura: leitura(0, '07:00'),
          pics: [
            { id: '901', n: 'PIC_901-TESTE_SEDE', lat: LAT - PASSO * 0.5, lon: LON + PASSO * 0.6, ul: leitura(0, '07:00'), l: 24, d: chuvaDoPic(1, false) },
            { id: '902', n: 'PIC_902-TESTE_TL07', lat: LAT - PASSO * 1.5, lon: LON + PASSO * 2.6, ul: leitura(0, '07:00'), l: 24, d: chuvaDoPic(0.7, false) },
            { id: '903', n: 'PIC_903-TESTE_TL10', lat: LAT - PASSO * 2.5, lon: LON + PASSO * 1.2, ul: leitura(2, '23:00'), l: 24, d: chuvaDoPic(1.3, true) },
          ],
          vinculos: { '001': [0], '002': [0], '003': [0, 1], '004': [1], '005': [0], '006': [0, 2], '007': [1], '008': [1], '009': [2], '010': [2], '011': [1, 2] },
        },
      },
      // fazenda sem limite e sem pluviômetro: as mensagens de "sem dados"
      f2: { talhoes: [], areas: [], chuva: null },
    },
  };
}

const DADOS = process.env.CHUVA_DADOS ? JSON.parse(readFileSync(process.env.CHUVA_DADOS, 'utf8')) : dadosFicticios();

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
  let url;
  try {
    url = new URL(req.url, 'http://local');
  } catch {
    responder(res, 400, 'text/plain; charset=utf-8', 'endereço inválido');
    return;
  }
  let caminho;
  try {
    caminho = decodeURIComponent(url.pathname);
  } catch {
    responder(res, 400, 'text/plain; charset=utf-8', 'endereço inválido');
    return;
  }
  if (caminho === '/api/chuva-teste') {
    responder(res, 200, TIPOS['.json'], JSON.stringify({ fazendas: DADOS.fazendas, safras: DADOS.safras }));
    return;
  }
  if (caminho === '/api/chuva-teste/fazenda') {
    const f = DADOS.porFazenda[url.searchParams.get('id') ?? ''];
    responder(res, f ? 200 : 404, TIPOS['.json'], JSON.stringify(f ?? { erro: 'fazenda não encontrada' }));
    return;
  }
  if (caminho === '/chuva/config.js') {
    responder(res, 200, TIPOS['.js'], "window.CHUVA_CONFIG = { modo: 'local' };\n");
    return;
  }
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = arquivoServivel(caminho);
  if (!arquivo) {
    responder(res, 404, 'text/plain; charset=utf-8', 'não encontrado');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', TIPOS[extname(arquivo).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(arquivo).pipe(res);
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`Chuva por talhão (teste local${process.env.CHUVA_DADOS ? ', dados de verdade' : ', dados fictícios'}): http://localhost:${PORTA}/chuva/`);
});
