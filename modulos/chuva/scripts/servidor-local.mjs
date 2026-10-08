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

/**
 * Fazenda de mentira: 12 talhões em grade (um deles sem dado na ZEUS), 3 pluviômetros, 120 dias de janela e
 * dois ciclos. A "tabela da ZEUS" de mentira para 3 dias antes de hoje e tem um dia faltando.
 */
function dadosFicticios() {
  const DIAS = 120;
  const FIM = DIAS - 4; // último dia com chuva por talhão
  const hoje = new Date(Date.now() - 4 * 3600000);
  const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - (DIAS - 1))).toISOString().slice(0, 10);
  const dia = (n) => new Date(Date.parse(inicio) + n * 86400000).toISOString().slice(0, 10);
  const LAT = -13.0, LON = -55.0, PASSO = 0.012;
  const quadra = (col, lin) => {
    const o = LON + col * PASSO, l = o + PASSO * 0.96, n = LAT - lin * PASSO, s = n - PASSO * 0.96;
    return { type: 'Polygon', coordinates: [[[o, s], [l, s], [l, n], [o, n], [o, s]]] };
  };
  // chuva de mentira, sempre igual: um "gerador" simples com semente fixa
  let semente = 7;
  const sorte = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const chuvaDoDia = [];
  for (let d = 0; d < DIAS; d++) chuvaDoDia.push(sorte() < 0.25 ? sorte() * 45 : 0);
  const talhoes = [];
  const chuva = {};
  let n = 0;
  for (let lin = 0; lin < 3; lin++) {
    for (let col = 0; col < 4; col++) {
      n++;
      const codigo = n === 12 ? 'P14' : String(n).padStart(3, '0');
      talhoes.push({ codigo, nome: codigo, area_ha: 165, geom: quadra(col, lin) });
      if (n === 12) continue; // talhão com limite no mapa, mas fora da tabela da ZEUS
      const fator = 0.6 + 0.12 * col + 0.1 * lin;
      const partes = [];
      for (let d = 0; d <= FIM; d++) { const mm = Math.round(chuvaDoDia[d] * fator * 100) / 100; if (mm > 0) partes.push(`${d}:${mm}`); }
      chuva[codigo] = { de: 0, ate: FIM, d: partes.join(',') };
    }
  }
  const medida = (fator, parado) => {
    const partes = [];
    for (let d = 0; d < DIAS; d++) {
      if (parado && d >= DIAS - 2) continue; // pluviômetro sem leitura nos dois últimos dias
      const mm = Math.round(chuvaDoDia[d] * fator * 10) / 10;
      partes.push(mm > 0 ? `${d}:${mm.toFixed(1)}` : String(d));
    }
    return partes.join(',');
  };
  const leitura = (atras, hora) => `${dia(DIAS - 1 - atras)}T${hora}`;
  const anoSafra = Number(dia(FIM).slice(0, 4)) - (Number(dia(FIM).slice(5, 7)) >= 9 ? 0 : 1);
  return {
    fazendas: [{ id: 'f1', nome: 'Teste Norte', unidade_pims: 'TESTE NORTE', coa_fazenda_id: 1 }, { id: 'f2', nome: 'Teste Sul', unidade_pims: 'TESTE SUL', coa_fazenda_id: 2 }],
    safras: [],
    porFazenda: {
      f1: {
        talhoes,
        areas: [],
        // os talhões "da ZEUS" de mentira: só os que têm chuva, com o contorno um pouco diferente do cadastro do Mapas
        zeus: talhoes.filter((t) => chuva[t.codigo]).map((t, i) => ({
          codigo: t.codigo, nome: t.codigo, id: 100 + i, area_ha: 150,
          geom: { type: 'MultiPolygon', coordinates: [[t.geom.coordinates[0].map((p) => [p[0] + 0.0006, p[1] - 0.0004])]] },
        })),
        chuva: {
          unidade: 'TESTE NORTE', gerado_em: new Date().toISOString(), inicio, dias: DIAS, ultimo_dia: dia(FIM), lidos: `0-39,41-${FIM}`,
          talhoes: chuva,
          ciclos: [
            { s: `SAFRA ${anoSafra}/${anoSafra + 1}`, p: 'SOJA DE TESTE', de: dia(FIM - 30), ate: dia(DIAS + 120), t: ['001', '002', '003', '005', '006', '007', '009', '010'] },
            { s: `SAFRA ${anoSafra}/${anoSafra + 1}`, p: 'MILHO DE TESTE', de: dia(20), ate: dia(80), t: ['004', '008', '011'] },
          ],
          ultima_leitura: leitura(0, '07:00'),
          pics: [
            { id: '901', n: 'PIC_901-TESTE_NORTE_SEDE', lat: LAT - PASSO * 0.5, lon: LON + PASSO * 0.6, ul: leitura(0, '07:00'), d: medida(0.7, false) },
            { id: '902', n: 'PIC_902-TESTE_NORTE_TL07', lat: LAT - PASSO * 1.5, lon: LON + PASSO * 2.6, ul: leitura(0, '07:00'), d: medida(0.95, false) },
            { id: '903', n: 'PIC_903-TESTE_NORTE_TL10', lat: LAT - PASSO * 2.5, lon: LON + PASSO * 1.2, ul: leitura(2, '23:00'), d: medida(0.85, true) },
          ],
          vinculos: { '001': [0], '002': [0], '003': [0, 1], '004': [1], '005': [0], '006': [0, 2], '007': [1], '008': [1], '009': [2], '010': [2], '011': [1, 2] },
        },
      },
      // fazenda sem limite e sem chuva: as mensagens de "sem dados"
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
