// Conferência de site do módulo Montagens de Painel: diz se um endereço abre dentro de um quadro do painel da TV,
// lendo os cabeçalhos que o dono do site manda (X-Frame-Options e Content-Security-Policy: frame-ancestors).
// Só atende usuário logado no COA WEB (X-Coa-Token = token da sessão do Supabase) com a categoria Montagens de
// Painel — a mesma conferência da api/gnss.js. Só https da internet: endereço que resolve para rede interna é
// recusado, também no meio de um redirecionamento (a função não serve de ponte para dentro de rede nenhuma).
// Lê só os cabeçalhos; o corpo é descartado. É uma função Node comum (req/res do http); a Vercel publica api/*.js.
'use strict';

const dns = require('node:dns');

const SUPABASE_URL = 'https://pkaxbitsqxjxjlwnhjhd.supabase.co';
// chave anon: pública por desenho (a mesma do index.html)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrYXhiaXRzcXhqeGpsd25oamhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTM2MzQsImV4cCI6MjEwMDgyOTYzNH0.XAxLopSqYef5vfW5sY6Pbv-EOoFdqwSeJpXwnqi9m8Q';
// chave da categoria do módulo em usuario_categorias (a mesma do index.html: CATEGORIAS)
const CATEGORIA = 'painel';
// o painel da TV mora aqui: é este host que o frame-ancestors do site precisa aceitar
const HOST_DO_PAINEL = 'coa-web-teal.vercel.app';
const MAX_ENDERECO = 2000;
const MAX_REDIRECIONAMENTOS = 5;
// os dois prazos somam menos que o limite de 10 s de uma função da Vercel
const PRAZO_SUPABASE_MS = 3000;
const PRAZO_SITE_MS = 6000;
const VALIDADE_TOKEN_MS = 5 * 60000;
const NAVEGADOR = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const JSON_UTF8 = 'application/json; charset=utf-8';

/* ------------------------------ endereços e redes ------------------------------ */

function ipv4ParaNumero(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((n, x) => n * 256 + Number(x), 0);
}

// faixas que não são internet pública: própria máquina, redes privadas, link-local (inclui 169.254.169.254, o
// endereço de metadados das nuvens), CGNAT, testes e multicast/reservado
const FAIXAS_V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]
  .map(([ip, bits]) => [ipv4ParaNumero(ip), bits]);

function v4Interno(n) {
  return FAIXAS_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

/** Os 8 blocos de 16 bits de um IPv6 (aceita "::" e IPv4 no fim); null se não for IPv6. */
function ipv6Blocos(ip) {
  let t = String(ip).toLowerCase();
  const zona = t.indexOf('%');
  if (zona >= 0) t = t.slice(0, zona);
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (m) {
    const v4 = ipv4ParaNumero(m[2]);
    if (v4 === null) return null;
    t = m[1] + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16);
  }
  const partes = t.split('::');
  if (partes.length > 2) return null;
  const esquerda = partes[0] ? partes[0].split(':') : [];
  const direita = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const faltam = 8 - esquerda.length - direita.length;
  if (partes.length === 1 ? esquerda.length !== 8 : faltam < 1) return null;
  const blocos = esquerda.concat(Array(partes.length === 2 ? faltam : 0).fill('0'), direita);
  if (blocos.some((b) => !/^[0-9a-f]{1,4}$/.test(b))) return null;
  return blocos.map((b) => parseInt(b, 16));
}

/** O IP (texto) é de rede interna? O que não for reconhecido como IP conta como interno: na dúvida, não consulta. */
function ipInterno(ip) {
  const s = String(ip || '').replace(/^\[|\]$/g, '');
  const n4 = ipv4ParaNumero(s);
  if (n4 !== null) return v4Interno(n4);
  const h = ipv6Blocos(s);
  if (!h) return true;
  if (h.every((x) => x === 0)) return true;                                   // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true;         // ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true;                                // fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true;                                // fe80::/10
  if ((h[0] & 0xff00) === 0xff00) return true;                                // ff00::/8
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return v4Interno(h[6] * 65536 + h[7]); // ::ffff:a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b) return v4Interno(h[6] * 65536 + h[7]); // 64:ff9b::/96
  return false;
}

/** URL https da internet (porta 443, sem usuário/senha, sem nome de rede interna) ou null. */
function lerEnderecoExterno(texto) {
  if (typeof texto !== 'string' || !texto || texto.length > MAX_ENDERECO) return null;
  let u;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return null;
  const literal = ipv4ParaNumero(host) !== null || host.startsWith('[');
  if (literal && ipInterno(host)) return null;
  if (!literal && host.indexOf('.') < 0) return null;
  return u;
}

/* ------------------------------ a decisão ------------------------------ */

/** Para cada política do Content-Security-Policy (separadas por vírgula) que tem frame-ancestors, a lista de fontes. */
function listasDeFrameAncestors(csp) {
  const listas = [];
  for (const politica of String(csp || '').split(',')) {
    for (const diretiva of politica.split(';')) {
      const partes = diretiva.trim().split(/\s+/).filter(Boolean);
      if (partes.length && partes[0].toLowerCase() === 'frame-ancestors') {
        listas.push(partes.slice(1).map((p) => p.toLowerCase()));
        break;
      }
    }
  }
  return listas;
}

/** Uma fonte do frame-ancestors aceita uma página do painel (https://HOST_DO_PAINEL)? */
function fonteAceita(fonte, host) {
  if (fonte === '*' || fonte === 'https:' || fonte === 'http:') return true;
  if (fonte.startsWith("'")) return false;                      // 'self', 'none'...: não é o COA WEB
  if (/^[a-z][a-z0-9+.-]*:$/.test(fonte)) return false;          // outro esquema sozinho (data:, blob:...)
  const semEsquema = fonte.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const h = semEsquema.split('/')[0].replace(/:(\d+|\*)$/, '');
  if (h.startsWith('*.')) return host.endsWith(h.slice(1));
  return h === host;
}

/**
 * 'abre' ou 'bloqueado', como o Chrome decide: se o Content-Security-Policy tem frame-ancestors, só ele vale (e
 * todas as políticas que o têm precisam deixar); senão, X-Frame-Options DENY ou SAMEORIGIN bloqueia.
 * `cabecalhos` tem `get(nome)` (Headers do fetch).
 */
function decidirEmbutir(cabecalhos, host) {
  const alvo = host || HOST_DO_PAINEL;
  const listas = listasDeFrameAncestors(cabecalhos.get('content-security-policy'));
  if (listas.length) return listas.every((l) => l.some((f) => fonteAceita(f, alvo))) ? 'abre' : 'bloqueado';
  const xfo = String(cabecalhos.get('x-frame-options') || '').toLowerCase().split(',').map((s) => s.trim());
  return xfo.some((v) => v === 'deny' || v === 'sameorigin') ? 'bloqueado' : 'abre';
}

/* ------------------------------ a consulta ------------------------------ */

/** Solta a conexão de uma resposta que não vai ser lida. */
async function descartar(r) {
  try { await r.body?.cancel(); } catch { /* já fechada */ }
}

const incerto = (motivo) => ({ resultado: 'incerto', motivo });

/** Confere um endereço: valida, resolve o nome (nunca rede interna), segue até 5 redirecionamentos e decide. Nunca lança. */
async function conferirEndereco(texto, deps) {
  let atual = lerEnderecoExterno(texto);
  if (!atual) return { resultado: 'invalido', motivo: 'Use um endereço https de um site da internet.' };
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), PRAZO_SITE_MS);
  const prazo = new Promise((_, rejeitar) => controle.signal.addEventListener('abort', () => rejeitar(new Error('prazo'))));
  prazo.catch(() => {});
  try {
    for (let salto = 0; salto <= MAX_REDIRECIONAMENTOS; salto++) {
      let ips;
      try {
        ips = await Promise.race([deps.resolver(atual.hostname.replace(/^\[|\]$/g, '')), prazo]);
      } catch {
        return incerto('O endereço do site não foi encontrado.');
      }
      if (!Array.isArray(ips) || !ips.length) return incerto('O endereço do site não foi encontrado.');
      if (ips.some(ipInterno)) return { resultado: 'invalido', motivo: 'Endereço de rede interna não é aceito.' };
      const r = await deps.fetch(atual.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controle.signal,
        headers: { 'User-Agent': NAVEGADOR, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      });
      await descartar(r);
      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get('location');
        let proximo = null;
        try { proximo = destino ? lerEnderecoExterno(new URL(destino, atual).href) : null; } catch { proximo = null; }
        if (!proximo) return incerto('O site levou para um endereço que não é https da internet.');
        atual = proximo;
        continue;
      }
      if (r.status >= 400) return incerto('O site respondeu ' + r.status + ' à conferência.');
      return decidirEmbutir(r.headers) === 'abre'
        ? { resultado: 'abre', motivo: 'O site deixa ser exibido dentro do painel.' }
        : { resultado: 'bloqueado', motivo: 'O site não deixa ser exibido dentro de outra página.' };
    }
    return incerto('O site redirecionou vezes demais.');
  } catch {
    return incerto('O site não respondeu a tempo.');
  } finally {
    clearTimeout(relogio);
  }
}

/* ------------------------------ acesso (o mesmo da api/gnss.js) ------------------------------ */

/** Só o formato da sessão: 3 partes, `sub` em texto e `exp` no futuro. Não confere assinatura: quem decide é o Supabase. */
function formatoDeSessao(token, agoraMs) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return false;
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((parte) => !parte)) return false;
  let carga;
  try { carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')); } catch { return false; }
  return !!carga && typeof carga.sub === 'string' && carga.sub !== '' && typeof carga.exp === 'number' && carga.exp * 1000 > agoraMs;
}

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', JSON_UTF8);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(JSON.stringify(corpo));
}

function criarHandler(deps) {
  /** token → até quando vale sem perguntar de novo ao Supabase (sessão aceita E categoria liberada) */
  const conferidos = new Map();

  /** 'valida' | 'recusada' | 'indisponivel'. Nunca lança. */
  async function perguntarSessao(token, sinal) {
    try {
      const r = await deps.fetch(SUPABASE_URL + '/auth/v1/user', { signal: sinal, headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
      await descartar(r);
      if (r.status === 200) return 'valida';
      return r.status === 401 || r.status === 403 ? 'recusada' : 'indisponivel';
    } catch {
      return 'indisponivel';
    }
  }

  /** 'tem' | 'nao-tem' | 'recusada' | 'indisponivel', pela função tem_categoria do banco. Nunca lança. */
  async function perguntarCategoria(token, sinal) {
    try {
      const r = await deps.fetch(SUPABASE_URL + '/rest/v1/rpc/tem_categoria', {
        method: 'POST',
        signal: sinal,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_categoria: CATEGORIA }),
      });
      if (r.status !== 200) {
        await descartar(r);
        return r.status === 401 ? 'recusada' : 'indisponivel';
      }
      const texto = (await r.text()).trim();
      if (texto === 'true') return 'tem';
      return texto === 'false' ? 'nao-tem' : 'indisponivel';
    } catch {
      return 'indisponivel';
    }
  }

  async function conferirAcesso(token) {
    const agora = deps.agora();
    const ate = conferidos.get(token);
    if (ate && ate > agora) return 'liberado';
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), PRAZO_SUPABASE_MS);
    let sessao;
    let categoria;
    try {
      [sessao, categoria] = await Promise.all([perguntarSessao(token, controle.signal), perguntarCategoria(token, controle.signal)]);
    } finally {
      clearTimeout(relogio);
    }
    if (sessao === 'valida' && categoria === 'tem') {
      if (conferidos.size > 500) conferidos.clear();
      conferidos.set(token, agora + VALIDADE_TOKEN_MS);
      return 'liberado';
    }
    conferidos.delete(token);
    if (sessao === 'recusada' || categoria === 'recusada') return 'recusada';
    if (sessao !== 'valida') return 'indisponivel';
    return categoria === 'nao-tem' ? 'sem-categoria' : 'indisponivel';
  }

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return responder(res, 405, { resultado: 'invalido', motivo: 'Só GET.' });
    }
    let consulta;
    try { consulta = new URL(req.url, 'http://local').searchParams; } catch { return responder(res, 400, { resultado: 'invalido', motivo: 'Pedido não aceito.' }); }
    const chaves = [...consulta.keys()];
    if (chaves.length !== 1 || chaves[0] !== 'url') return responder(res, 400, { resultado: 'invalido', motivo: 'Pedido não aceito.' });
    const token = req.headers['x-coa-token'];
    if (!formatoDeSessao(token, deps.agora())) return responder(res, 401, { resultado: 'sem-acesso', motivo: 'Entre no COA WEB.' });
    const acesso = await conferirAcesso(token);
    if (acesso === 'recusada') return responder(res, 401, { resultado: 'sem-acesso', motivo: 'Entre no COA WEB.' });
    if (acesso === 'indisponivel') return responder(res, 503, { resultado: 'incerto', motivo: 'Não foi possível conferir o acesso agora.' });
    if (acesso !== 'liberado') return responder(res, 403, { resultado: 'sem-acesso', motivo: 'Sem acesso a Montagens de Painel.' });
    const r = await conferirEndereco(consulta.get('url'), deps);
    return responder(res, r.resultado === 'invalido' ? 400 : 200, r);
  };
}

module.exports = criarHandler({
  fetch: (...a) => fetch(...a),
  agora: () => Date.now(),
  resolver: (host) => dns.promises.lookup(host, { all: true, verbatim: true }).then((l) => l.map((x) => x.address)),
});
module.exports.criarHandler = criarHandler;
module.exports.conferirEndereco = conferirEndereco;
module.exports.lerEnderecoExterno = lerEnderecoExterno;
module.exports.ipInterno = ipInterno;
module.exports.decidirEmbutir = decidirEmbutir;
module.exports.SUPABASE_URL = SUPABASE_URL;
