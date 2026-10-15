// COA WEB no computador, para testar Montagens de Painel sem login: serve a raiz do repositório com os cabeçalhos
// do vercel.json (menos o upgrade-insecure-requests e o HSTS, que não valem em http://localhost), troca
// painel/config.js por { modo: 'local' }, guarda as montagens na memória (começa com montagens FICTÍCIAS), serve
// páginas de teste em /teste/quadro e confere sites de verdade com a mesma conta da api/conferir-site.js.
// Uso (na raiz): node modulos/painel/scripts/servidor-local.mjs
//   editor: http://localhost:8792/painel/     TV: http://localhost:8792/painel/?tv=1&conferir=5
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { promises as dnsp } from 'node:dns';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cabecalhosDoCaminho, lerVercel } from './vercel-cabecalhos.mjs';

const exigir = createRequire(import.meta.url);
const L = exigir('../../../painel/logica.js');
const { conferirEndereco } = exigir('../../../api/conferir-site.js');

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RAIZ_REAL = realpathSync.native(RAIZ);
const PORTA = Number(process.env.PORT || 8792);
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

const FAZENDAS = [
  { id: 'teste-1', nome: 'Fazenda Teste Norte', unidade_pims: 'TESTE NORTE' },
  { id: 'teste-2', nome: 'Fazenda Teste Centro', unidade_pims: 'TESTE CENTRO' },
  { id: 'teste-3', nome: 'Fazenda Teste Sul', unidade_pims: 'TESTE SUL' },
];

let ultimoMs = 0;
/** Data ISO que sempre anda para a frente (duas gravações no mesmo milissegundo não têm a mesma marca). */
function agoraIso() {
  ultimoMs = Math.max(Date.now(), ultimoMs + 1);
  return new Date(ultimoMs).toISOString();
}

function linha(m) {
  return { id: m.id, nome: m.nome, divisao: m.divisao, quadros: m.quadros, atualizado_em: agoraIso() };
}

/** Montagens de mentira: as páginas /teste/quadro mostram o nome, a cor e a hora em que abriram. */
function montagensIniciais() {
  const teste = (nome, cor, segundos) => ({ nome, url: 'teste/quadro?nome=' + encodeURIComponent(nome) + '&cor=' + encodeURIComponent(cor), segundos });
  const windy = { nome: 'Previsão · Windy', url: 'https://embed.windy.com/embed2.html?lat=-13.6&lon=-56.1&zoom=6&level=surface&overlay=rain&product=ecmwf', segundos: 60, conferencia: 'abre' };
  const radar = { nome: 'Radar · RainViewer', url: 'https://www.rainviewer.com/map.html?loc=-13.6,-56.1,6&layer=radar', segundos: 60, conferencia: 'abre' };
  const brutas = [
    { id: 'teste-plantio', nome: 'Plantio (teste)', divisao: '4', quadros: [
      { padrao: 30, sites: [teste('Acompanhamento · Teste Norte', '#0C5A50', 30), teste('Acompanhamento · Teste Sul', '#2F7D6B', 15)] },
      { padrao: 60, sites: [windy] },
      { padrao: 45, sites: [teste('Mapa de Chuva 24 h', '#2A6F97', 45), teste('Chuva por talhão', '#1E7B4F', 45), teste('Pluviômetros', '#8A5A04', 45)] },
      { padrao: 60, recarregar: 300, sites: [radar] },
    ] },
    { id: 'teste-chuva', nome: 'Chuva e radar (teste)', divisao: '3a', quadros: [{ sites: [radar] }, { sites: [windy] }, { sites: [teste('Pluviômetros', '#8A5A04', 60)] }] },
    { id: 'teste-colheita', nome: 'Colheita (teste)', divisao: '2a', quadros: [{ sites: [teste('Colheita · Teste Centro', '#0C5A50', 60)] }] },
  ];
  return brutas.map((m) => linha(Object.assign(L.normalizarMontagem(m), { id: m.id })));
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function paginaDeTeste(nome, cor) {
  const n = esc(nome || 'Página de teste');
  const c = /^#[0-9a-f]{6}$/i.test(cor || '') ? cor : '#0C5A50';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + n + '</title><style>'
    + 'html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vh;'
    + 'background:' + c + ';color:#fff;font:600 5vmin/1.2 "IBM Plex Sans",system-ui,sans-serif;text-align:center;padding:0 4vmin}'
    + 'b{font-variant-numeric:tabular-nums;font-size:9vmin}small{font-weight:400;font-size:2.6vmin;opacity:.8}</style></head>'
    + '<body><span>' + n + '</span><b id="h"></b><small>aberta às <span id="a"></span> · página fictícia do servidor local</small>'
    + '<script>const f=(d)=>d.toLocaleTimeString("pt-BR");document.getElementById("a").textContent=f(new Date());'
    + 'const t=()=>{document.getElementById("h").textContent=f(new Date())};t();setInterval(t,250);</script></body></html>';
}

/** Caminho real do arquivo pedido, ou null: só arquivos de dentro da raiz do repositório e nunca a pasta .git. */
function arquivoServivel(caminho) {
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

function lerJson(req) {
  return new Promise((resolver, rejeitar) => {
    let t = '';
    req.setEncoding('utf8');
    req.on('data', (p) => { t += p; if (t.length > 1e6) { rejeitar(new Error('corpo grande demais')); req.destroy(); } });
    req.on('end', () => { try { resolver(t ? JSON.parse(t) : null); } catch (e) { rejeitar(e); } });
    req.on('error', rejeitar);
  });
}

export function criarServidor() {
  const montagens = new Map(montagensIniciais().map((m) => [m.id, m]));
  const tv = { montagem_id: 'teste-plantio', atualizado_em: agoraIso() };
  const vercel = lerVercel();
  let porta = PORTA;

  function cabecalhos(res, caminho) {
    for (const [k, v] of Object.entries(cabecalhosDoCaminho(caminho, vercel))) {
      if (k === 'strict-transport-security' || k === 'cache-control') continue;
      res.setHeader(k, k === 'content-security-policy' ? v.split(';').map((s) => s.trim()).filter((s) => s && s !== 'upgrade-insecure-requests').join('; ') : v);
    }
  }
  function enviar(res, status, tipo, corpo) {
    res.statusCode = status;
    res.setHeader('Content-Type', tipo);
    res.setHeader('Cache-Control', 'no-store');
    res.end(corpo);
  }
  const json = (res, status, corpo) => enviar(res, status, TIPOS['.json'], JSON.stringify(corpo));
  const lista = () => [...montagens.values()];

  async function apiPainel(req, res, resto) {
    const metodo = req.method;
    if (resto === 'estado' && metodo === 'GET') return json(res, 200, { montagens: lista(), tvId: tv.montagem_id });
    if (resto === 'fazendas' && metodo === 'GET') return json(res, 200, FAZENDAS);
    if (resto === 'tv' && metodo === 'GET') return json(res, 200, { montagem_id: tv.montagem_id, montagem: tv.montagem_id ? montagens.get(tv.montagem_id) || null : null });
    if (resto === 'tv' && metodo === 'PUT') {
      const corpo = await lerJson(req);
      const id = corpo ? corpo.montagem_id : undefined;
      if (id !== null && !montagens.has(id)) return json(res, 404, { motivo: 'Montagem não encontrada.' });
      tv.montagem_id = id;
      tv.atualizado_em = agoraIso();
      return json(res, 200, tv);
    }
    if (resto === 'montagens' && metodo === 'POST') {
      const n = L.normalizarMontagem(await lerJson(req));
      if (L.nomeRepetido(n.nome, lista(), null)) return json(res, 409, { codigo: 'nome-repetido', motivo: 'Já existe uma montagem com esse nome.' });
      const nova = linha(Object.assign(n, { id: 'm-' + L.novoId() }));
      montagens.set(nova.id, nova);
      return json(res, 201, nova);
    }
    const alvo = /^montagens\/([^/]+)$/.exec(resto);
    if (alvo && montagens.has(alvo[1])) {
      const id = alvo[1];
      if (metodo === 'PUT') {
        const n = L.normalizarMontagem(Object.assign({}, await lerJson(req), { id }));
        if (L.nomeRepetido(n.nome, lista(), id)) return json(res, 409, { codigo: 'nome-repetido', motivo: 'Já existe uma montagem com esse nome.' });
        const salva = linha(n);
        montagens.set(id, salva);
        return json(res, 200, salva);
      }
      if (metodo === 'DELETE') {
        if (tv.montagem_id === id) return json(res, 409, { codigo: 'na-tv', motivo: 'Ponha outra montagem na TV antes de apagar esta.' });
        montagens.delete(id);
        res.statusCode = 204;
        return res.end();
      }
    }
    return json(res, 404, { motivo: 'Não encontrado.' });
  }

  const servidor = createServer(async (req, res) => {
    // só pelo endereço local: um site de fora que aponte um nome qualquer para 127.0.0.1 não lê isto
    if (![`localhost:${porta}`, `127.0.0.1:${porta}`].includes(String(req.headers.host || '').toLowerCase())) return enviar(res, 400, 'text/plain; charset=utf-8', 'host não aceito');
    let url;
    let caminho;
    try {
      url = new URL(req.url, 'http://local');
      caminho = decodeURIComponent(url.pathname);
    } catch {
      return enviar(res, 400, 'text/plain; charset=utf-8', 'endereço inválido');
    }
    try {
      if (caminho.startsWith('/api/painel/')) return await apiPainel(req, res, caminho.slice('/api/painel/'.length));
      if (caminho === '/api/conferir-site') {
        const r = await conferirEndereco(url.searchParams.get('url'), {
          fetch,
          resolver: (h) => dnsp.lookup(h, { all: true, verbatim: true }).then((l) => l.map((x) => x.address)),
        });
        return json(res, r.resultado === 'invalido' ? 400 : 200, r);
      }
      if (caminho === '/teste/quadro') {
        cabecalhos(res, caminho);
        return enviar(res, 200, TIPOS['.html'], paginaDeTeste(url.searchParams.get('nome'), url.searchParams.get('cor')));
      }
      if (caminho === '/painel/config.js') {
        cabecalhos(res, caminho);
        return enviar(res, 200, TIPOS['.js'], "window.PAINEL_CONFIG = { modo: 'local' };\n");
      }
      if (caminho.endsWith('/')) caminho += 'index.html';
      const arquivo = arquivoServivel(caminho);
      if (!arquivo) return enviar(res, 404, 'text/plain; charset=utf-8', 'não encontrado');
      cabecalhos(res, caminho);
      res.setHeader('Content-Type', TIPOS[extname(arquivo).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      const leitura = createReadStream(arquivo);
      leitura.on('error', () => res.destroy());
      leitura.pipe(res);
    } catch (e) {
      return json(res, 500, { motivo: 'Erro no servidor local: ' + (e && e.message) });
    }
  });
  servidor.on('listening', () => { porta = servidor.address().port; });
  return servidor;
}

// rodado direto (node .../servidor-local.mjs): sobe na porta 8792; importado pelos testes: só exporta
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  criarServidor().listen(PORTA, '127.0.0.1', () => {
    console.log(`Montagens de Painel local: http://localhost:${PORTA}/painel/ (editor) e http://localhost:${PORTA}/painel/?tv=1&conferir=5 (TV), montagens fictícias`);
  });
}
