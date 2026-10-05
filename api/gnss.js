// Ponte do Locks SAT com o Trimble GNSS Planning: o serviço não aceita pedido direto do navegador.
// Só atende usuário logado no COA WEB (X-Coa-Token = token da sessão do Supabase) e só os dois
// endereços que o módulo usa. É uma função Node comum (req/res do http); a Vercel publica api/*.js.
'use strict';

const SUPABASE_URL = 'https://pkaxbitsqxjxjlwnhjhd.supabase.co';
// chave anon: pública por desenho (a mesma do index.html)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrYXhiaXRzcXhqeGpsd25oamhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTM2MzQsImV4cCI6MjEwMDgyOTYzNH0.XAxLopSqYef5vfW5sY6Pbv-EOoFdqwSeJpXwnqi9m8Q';
const TRIMBLE = 'https://www.gnssplanning.com/api/';

const SERIE = /^ionoindex\/(-?\d{1,3}(?:\.\d{1,2})?)\/(-?\d{1,2}(?:\.\d{1,2})?)\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\/(\d{1,3})\/(\d{3,4})$/;
const IMAGEM = /^overlay\/(sci|tec)\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/;
const HORA_MS = 3600000;
const DIA_MS = 24 * HORA_MS;
const HORAS_SERIE = [24, 27, 168];
const PASSO_SERIE_S = 600;
const PASSO_IMAGEM_MS = 600000;
// período aceito: o histórico do módulo é de 29 dias; o futuro só cobre o fuso e a previsão do dia
const JANELA_PASSADO_MS = 32 * DIA_MS;
const JANELA_FUTURO_MS = DIA_MS;
// os dois prazos somam menos que o limite de 10 s de uma função da Vercel
const PRAZO_SUPABASE_MS = 3000;
const PRAZO_TRIMBLE_MS = 6000;
const VALIDADE_TOKEN_MS = 5 * 60000;
const LIMITE_CORPO = 2 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXTO = 'text/plain; charset=utf-8';
const JSON_UTF8 = 'application/json; charset=utf-8';

/** Instante (ms, UTC) de um texto AAAA-MM-DDTHH:MM:SS; NaN se a data não existir (30 de fevereiro, 24:00:00...). */
function lerInstante(texto) {
  const ms = Date.parse(texto + 'Z');
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === texto ? ms : NaN;
}

/** { tipo, inicioMs, fimMs } do caminho pedido; null se não for um dos dois formatos aceitos. */
function lerCaminho(p) {
  if (typeof p !== 'string' || p.length > 120) return null;
  const serie = SERIE.exec(p);
  if (serie) {
    const inicioMs = lerInstante(serie[3]);
    const lon = Number(serie[1]);
    const lat = Number(serie[2]);
    const horas = Number(serie[4]);
    if (Number.isNaN(inicioMs) || !HORAS_SERIE.includes(horas) || Number(serie[5]) !== PASSO_SERIE_S) return null;
    // coordenadas na grade de meio grau, dentro do globo
    if (!Number.isInteger(lon * 2) || !Number.isInteger(lat * 2) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    return { tipo: 'serie', inicioMs, fimMs: inicioMs + horas * HORA_MS };
  }
  const imagem = IMAGEM.exec(p);
  if (imagem) {
    const instante = lerInstante(imagem[2]);
    return Number.isNaN(instante) || instante % PASSO_IMAGEM_MS !== 0 ? null : { tipo: 'imagem', inicioMs: instante, fimMs: instante };
  }
  return null;
}

/** Segundos que a Vercel pode guardar a resposta: dado de mais de 1 h atrás não muda mais. */
function segundosDeCache(caminho, agoraMs) {
  if (caminho.fimMs < agoraMs - HORA_MS) return 86400;
  return caminho.tipo === 'serie' ? 120 : 300;
}

/** Só o formato da sessão: 3 partes, `sub` em texto e `exp` no futuro. Não confere assinatura: quem decide é o Supabase. */
function formatoDeSessao(token, agoraMs) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return false;
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((parte) => !parte)) return false;
  let carga;
  try {
    carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  return !!carga && typeof carga.sub === 'string' && carga.sub !== '' && typeof carga.exp === 'number' && carga.exp * 1000 > agoraMs;
}

/** Content-type que a ponte devolve se o corpo da Trimble é o que o caminho promete; null se não for. */
function tipoDeSaida(tipo, recebido, corpo) {
  if (tipo === 'serie') {
    if (!recebido.startsWith('application/json')) return null;
    const i = corpo.findIndex((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
    return i >= 0 && corpo[i] === 0x5b ? JSON_UTF8 : null;
  }
  return recebido.startsWith('image/png') && corpo.subarray(0, PNG.length).equals(PNG) ? 'image/png' : null;
}

/** Corpo que é só `[` e `]` com espaço no meio (a origem sem dado naquele momento): não vale guardar. */
function arrayVazio(corpo) {
  const branco = (b) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  const i = corpo.findIndex((b) => !branco(b));
  if (i < 0 || corpo[i] !== 0x5b) return false;
  const j = corpo.findIndex((b, k) => k > i && !branco(b));
  return j >= 0 && corpo[j] === 0x5d && corpo.findIndex((b, k) => k > j && !branco(b)) < 0;
}

/** Corpo da resposta como Buffer, parando de ler ao passar do limite (null). */
async function lerCorpo(r) {
  if (Number(r.headers.get('content-length')) > LIMITE_CORPO) return null;
  if (!r.body) return Buffer.alloc(0);
  const pedacos = [];
  let total = 0;
  const leitor = r.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > LIMITE_CORPO) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos);
}

/** Solta a conexão de uma resposta que não vai ser lida. */
async function descartar(r) {
  try {
    await r.body?.cancel();
  } catch {
    // já fechada
  }
}

function responder(res, status, tipo, corpo, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', tipo);
  res.setHeader('Cache-Control', cache || 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(corpo);
}

function criarHandler(deps) {
  /** token → até quando vale sem perguntar de novo ao Supabase */
  const conferidos = new Map();

  /** 'valida' | 'recusada' (o Supabase disse não) | 'indisponivel' (erro, queda ou demora) */
  async function conferirSessao(token) {
    const agora = deps.agora();
    const ate = conferidos.get(token);
    if (ate && ate > agora) return 'valida';
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), PRAZO_SUPABASE_MS);
    try {
      const r = await deps.fetch(SUPABASE_URL + '/auth/v1/user', {
        signal: controle.signal,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
      });
      await descartar(r);
      if (r.status === 200) {
        if (conferidos.size > 500) conferidos.clear();
        conferidos.set(token, agora + VALIDADE_TOKEN_MS);
        return 'valida';
      }
      conferidos.delete(token);
      return r.status === 401 || r.status === 403 ? 'recusada' : 'indisponivel';
    } catch {
      return 'indisponivel';
    } finally {
      clearTimeout(relogio);
    }
  }

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return responder(res, 405, TEXTO, 'Só GET.');
    }
    let consulta;
    try {
      consulta = new URL(req.url, 'http://local').searchParams;
    } catch {
      return responder(res, 400, TEXTO, 'Endereço inválido.');
    }
    // exatamente um parâmetro, o p
    const chaves = [...consulta.keys()];
    if (chaves.length !== 1 || chaves[0] !== 'p') return responder(res, 400, TEXTO, 'Caminho não aceito.');
    const p = consulta.get('p');
    const caminho = lerCaminho(p);
    if (!caminho) return responder(res, 400, TEXTO, 'Caminho não aceito.');
    const agora = deps.agora();
    if (caminho.inicioMs < agora - JANELA_PASSADO_MS || caminho.inicioMs > agora + JANELA_FUTURO_MS) {
      return responder(res, 400, TEXTO, 'Data fora do período aceito.');
    }
    const token = req.headers['x-coa-token'];
    if (!formatoDeSessao(token, agora)) return responder(res, 401, TEXTO, 'Entre no COA WEB.');
    const sessao = await conferirSessao(token);
    if (sessao === 'indisponivel') return responder(res, 503, TEXTO, 'Não foi possível conferir a sessão.');
    if (sessao !== 'valida') return responder(res, 401, TEXTO, 'Entre no COA WEB.');

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), PRAZO_TRIMBLE_MS);
    try {
      const r = await deps.fetch(TRIMBLE + p, { signal: controle.signal, headers: { Accept: '*/*' }, redirect: 'error' });
      if (r.status !== 200) {
        await descartar(r);
        // o 401 da Trimble não pode parecer sessão vencida do COA WEB; sucesso que não é 200 também não serve
        const status = r.status === 401 || r.status < 400 ? 502 : r.status;
        return responder(res, status, TEXTO, `A Trimble respondeu ${r.status}.`);
      }
      const corpo = await lerCorpo(r);
      const tipo = corpo && tipoDeSaida(caminho.tipo, (r.headers.get('content-type') || '').toLowerCase(), corpo);
      if (!tipo) return responder(res, 502, TEXTO, 'A Trimble devolveu algo inesperado.');
      // série vazia: se a Vercel guardasse (até um dia, para janela passada), todos veriam o vazio de um momento ruim
      if (caminho.tipo === 'serie' && arrayVazio(corpo)) return responder(res, 200, tipo, corpo);
      return responder(res, 200, tipo, corpo, `public, max-age=0, s-maxage=${segundosDeCache(caminho, deps.agora())}`);
    } catch {
      return responder(res, 504, TEXTO, 'A Trimble não respondeu.');
    } finally {
      clearTimeout(relogio);
    }
  };
}

module.exports = criarHandler({ fetch: (...a) => fetch(...a), agora: () => Date.now() });
module.exports.criarHandler = criarHandler;
module.exports.lerCaminho = lerCaminho;
module.exports.segundosDeCache = segundosDeCache;
