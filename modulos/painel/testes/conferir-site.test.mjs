// Testes da conferência de site do Montagens de Painel (api/conferir-site.js).
// Rodar na raiz do repositório: node --test "modulos/painel/testes/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const C = createRequire(import.meta.url)('../../../api/conferir-site.js')

const resposta = (status, headers = {}, corpo = null) => new Response(corpo, { status, headers })
/** fetch falso: cada endereço devolve a resposta da tabela; fora da tabela, erro de rede. Guarda os pedidos. */
function fetchFalso(tabela, pedidos = []) {
  return async (url, op) => {
    pedidos.push({ url: String(url), op })
    const r = tabela[String(url)]
    if (!r) throw new TypeError('fetch failed')
    return typeof r === 'function' ? r(op) : r
  }
}
const publico = async () => ['93.184.215.14']
const deps = (tabela, pedidos, resolver = publico) => ({ fetch: fetchFalso(tabela, pedidos), agora: () => AGORA, resolver })
const AGORA = Date.parse('2026-10-15T12:00:00Z')
const TOKEN = 'x.' + Buffer.from(JSON.stringify({ sub: 'u1', exp: AGORA / 1000 + 3600 })).toString('base64url') + '.y'

test('lerEnderecoExterno: só https da internet, porta 443, sem senha, sem nome interno', () => {
  for (const ruim of ['http://exemplo.com/', 'ftp://exemplo.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://10.0.0.1/',
    'https://[::1]/', 'https://exemplo.com:8443/', 'https://u:p@exemplo.com/', 'https://metadata.google.internal/',
    'https://impressora.local/', 'https://intranet/', 'https://' + 'a'.repeat(2000) + '.com/', 123, '', null]) {
    assert.equal(C.lerEnderecoExterno(ruim), null, String(ruim).slice(0, 60))
  }
  assert.equal(C.lerEnderecoExterno('https://exemplo.com/a?b=1').href, 'https://exemplo.com/a?b=1')
  assert.equal(C.lerEnderecoExterno('https://exemplo.com:443/x').href, 'https://exemplo.com/x')
  assert.equal(C.lerEnderecoExterno('https://8.8.8.8/').hostname, '8.8.8.8')
})

test('ipInterno: faixas internas de IPv4 e IPv6 (inclusive IPv4 dentro de IPv6)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd12:3456::1', 'ff02::1', '::ffff:10.0.0.1',
    '::ffff:a00:1', '[::1]', '64:ff9b::a00:1', 'lixo']) assert.equal(C.ipInterno(ip), true, ip)
  for (const ip of ['8.8.8.8', '93.184.215.14', '172.15.255.255', '172.32.0.1', '100.63.255.255', '2001:4860:4860::8888', '::ffff:8.8.8.8'])
    assert.equal(C.ipInterno(ip), false, ip)
})

test('decidirEmbutir: os cabeçalhos reais dos sites da TV de hoje (15/10/2026)', () => {
  const d = (h) => C.decidirEmbutir(new Headers(h))
  assert.equal(d({ 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'self' *.deere.com:* *.johndeerecloud.com *.johndeere.com" }), 'bloqueado')
  assert.equal(d({ 'x-frame-options': 'SAMEORIGIN' }), 'bloqueado')
  assert.equal(d({ 'content-security-policy': "frame-ancestors 'self' *.windy.com:*" }), 'bloqueado')
  assert.equal(d({ 'x-frame-options': 'ALLOWALL', 'content-security-policy': 'frame-ancestors *' }), 'abre')
  assert.equal(d({}), 'abre')
})

test('decidirEmbutir: frame-ancestors vence o X-Frame-Options; Report-Only não vale; todas as políticas precisam deixar', () => {
  const d = (h) => C.decidirEmbutir(new Headers(h))
  assert.equal(d({ 'content-security-policy': 'frame-ancestors https:' }), 'abre')
  assert.equal(d({ 'content-security-policy': "frame-ancestors 'self' *.vercel.app" }), 'abre')
  assert.equal(d({ 'content-security-policy': 'frame-ancestors https://coa-web-teal.vercel.app:443' }), 'abre')
  assert.equal(d({ 'content-security-policy': 'frame-ancestors *', 'x-frame-options': 'DENY' }), 'abre')
  assert.equal(d({ 'content-security-policy': "frame-ancestors 'none'" }), 'bloqueado')
  assert.equal(d({ 'content-security-policy': 'frame-ancestors https://outro.com' }), 'bloqueado')
  assert.equal(d({ 'content-security-policy': 'frame-ancestors data:' }), 'bloqueado')
  assert.equal(d({ 'content-security-policy-report-only': "frame-ancestors 'none'" }), 'abre')
  assert.equal(d({ 'x-frame-options': 'sameorigin, sameorigin' }), 'bloqueado')
  assert.equal(C.decidirEmbutir(new Headers([['content-security-policy', 'frame-ancestors *'], ['content-security-policy', "frame-ancestors 'self'"]])), 'bloqueado')
})

test('conferirEndereco: abre e bloqueado, pedindo sem seguir redirecionamento sozinho', async () => {
  const pedidos = []
  const t = { 'https://ok.exemplo.com/': resposta(200, { 'content-security-policy': 'frame-ancestors *' }), 'https://nao.exemplo.com/': resposta(200, { 'x-frame-options': 'DENY' }) }
  assert.equal((await C.conferirEndereco('https://ok.exemplo.com/', deps(t, pedidos))).resultado, 'abre')
  assert.equal((await C.conferirEndereco('https://nao.exemplo.com/', deps(t, pedidos))).resultado, 'bloqueado')
  assert.equal(pedidos[0].op.redirect, 'manual')
  assert.equal(pedidos[0].op.method, 'GET')
})

test('conferirEndereco: segue redirecionamentos https (inclusive relativos) e decide pelo último', async () => {
  const pedidos = []
  const t = {
    'https://a.exemplo.com/': resposta(301, { location: 'https://b.exemplo.com/x' }),
    'https://b.exemplo.com/x': resposta(302, { location: '/entrar' }),
    'https://b.exemplo.com/entrar': resposta(200, { 'x-frame-options': 'SAMEORIGIN' }),
  }
  assert.equal((await C.conferirEndereco('https://a.exemplo.com/', deps(t, pedidos))).resultado, 'bloqueado')
  assert.deepEqual(pedidos.map((p) => p.url), ['https://a.exemplo.com/', 'https://b.exemplo.com/x', 'https://b.exemplo.com/entrar'])
})

test('conferirEndereco: rede interna nunca é consultada, nem por redirecionamento', async () => {
  const pedidos = []
  const resolver = async (h) => (h === 'interno.exemplo.com' ? ['10.0.0.8'] : ['93.184.215.14'])
  const t = { 'https://fora.exemplo.com/': resposta(302, { location: 'https://interno.exemplo.com/admin' }) }
  assert.equal((await C.conferirEndereco('https://interno.exemplo.com/', deps(t, pedidos, resolver))).resultado, 'invalido')
  assert.equal(pedidos.length, 0)
  assert.equal((await C.conferirEndereco('https://fora.exemplo.com/', deps(t, pedidos, resolver))).resultado, 'invalido')
  assert.deepEqual(pedidos.map((p) => p.url), ['https://fora.exemplo.com/'])
})

test('conferirEndereco: http no caminho, erro do site, queda, DNS e redirecionamento sem fim viram "incerto"', async () => {
  const t = {
    'https://h.exemplo.com/': resposta(302, { location: 'http://h.exemplo.com/' }),
    'https://e.exemplo.com/': resposta(403),
    'https://l.exemplo.com/': resposta(302, { location: 'https://l.exemplo.com/' }),
  }
  const r403 = await C.conferirEndereco('https://e.exemplo.com/', deps(t, []))
  assert.equal(r403.resultado, 'incerto')
  assert.match(r403.motivo, /403/)
  assert.equal((await C.conferirEndereco('https://h.exemplo.com/', deps(t, []))).resultado, 'incerto')
  assert.equal((await C.conferirEndereco('https://caiu.exemplo.com/', deps(t, []))).resultado, 'incerto')
  const semDns = async () => { throw new Error('ENOTFOUND') }
  assert.equal((await C.conferirEndereco('https://e.exemplo.com/', deps(t, [], semDns))).resultado, 'incerto')
  const pedidos = []
  const loop = await C.conferirEndereco('https://l.exemplo.com/', deps(t, pedidos))
  assert.equal(loop.resultado, 'incerto')
  assert.equal(pedidos.length, 6)
})

test('conferirEndereco: endereço que não é https da internet é "invalido" sem consultar nada', async () => {
  const pedidos = []
  assert.equal((await C.conferirEndereco('http://exemplo.com/', deps({}, pedidos))).resultado, 'invalido')
  assert.equal((await C.conferirEndereco('https://localhost/', deps({}, pedidos))).resultado, 'invalido')
  assert.equal(pedidos.length, 0)
})

/** Chama o handler como a Vercel chama (req/res do http) e devolve status, cabeçalhos e o JSON. */
function chamar(handler, { method = 'GET', url, token }) {
  return new Promise((resolve) => {
    const cabecalhos = {}
    const res = {
      statusCode: 0,
      setHeader: (k, v) => { cabecalhos[k.toLowerCase()] = v },
      end: (corpo) => resolve({ status: res.statusCode, cabecalhos, corpo: JSON.parse(corpo) }),
    }
    handler({ method, url, headers: token ? { 'x-coa-token': token } : {} }, res)
  })
}
const supabase = (categoria) => ({
  [C.SUPABASE_URL + '/auth/v1/user']: () => resposta(200, {}, '{}'),
  [C.SUPABASE_URL + '/rest/v1/rpc/tem_categoria']: () => resposta(200, {}, categoria),
})
const SITE = { 'https://ok.exemplo.com/': () => resposta(200, { 'content-security-policy': 'frame-ancestors *' }) }

test('handler: método, parâmetros e login', async () => {
  const h = C.criarHandler(deps({ ...supabase('true'), ...SITE }, []))
  assert.equal((await chamar(h, { method: 'POST', url: '/api/conferir-site?url=x', token: TOKEN })).status, 405)
  assert.equal((await chamar(h, { url: '/api/conferir-site?url=https://ok.exemplo.com/&x=1', token: TOKEN })).status, 400)
  const sem = await chamar(h, { url: '/api/conferir-site?url=https://ok.exemplo.com/' })
  assert.equal(sem.status, 401)
  assert.equal(sem.corpo.resultado, 'sem-acesso')
})

test('handler: com login e categoria confere o site; sem categoria, 403; Supabase fora, 503', async () => {
  const ok = await chamar(C.criarHandler(deps({ ...supabase('true'), ...SITE }, [])), { url: '/api/conferir-site?url=' + encodeURIComponent('https://ok.exemplo.com/'), token: TOKEN })
  assert.equal(ok.status, 200)
  assert.equal(ok.corpo.resultado, 'abre')
  assert.equal(ok.cabecalhos['cache-control'], 'no-store')
  const invalido = await chamar(C.criarHandler(deps({ ...supabase('true') }, [])), { url: '/api/conferir-site?url=http://x.com/', token: TOKEN })
  assert.equal(invalido.status, 400)
  assert.equal(invalido.corpo.resultado, 'invalido')
  const semCategoria = await chamar(C.criarHandler(deps({ ...supabase('false'), ...SITE }, [])), { url: '/api/conferir-site?url=https://ok.exemplo.com/', token: TOKEN })
  assert.equal(semCategoria.status, 403)
  assert.equal(semCategoria.corpo.resultado, 'sem-acesso')
  const fora = await chamar(C.criarHandler(deps({ ...SITE }, [])), { url: '/api/conferir-site?url=https://ok.exemplo.com/', token: TOKEN })
  assert.equal(fora.status, 503)
})
