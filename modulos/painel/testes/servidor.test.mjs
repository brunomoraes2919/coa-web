// Testes do servidor local do Montagens de Painel (modulos/painel/scripts/servidor-local.mjs): a API das montagens
// na memória e os cabeçalhos do vercel.json. Rodar na raiz: node --test "modulos/painel/testes/*.test.mjs"
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { criarServidor } from '../scripts/servidor-local.mjs'

let servidor
let base
before(async () => {
  servidor = criarServidor()
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + servidor.address().port
})
after(() => new Promise((r) => servidor.close(r)))

async function pedir(metodo, caminho, corpo) {
  const r = await fetch(base + caminho, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined })
  const t = await r.text()
  let json = null
  try { json = t ? JSON.parse(t) : null } catch { json = t }
  return { status: r.status, cabecalhos: r.headers, corpo: json }
}

test('estado: três montagens fictícias, todas com 4 quadros, e a de Plantio na TV', async () => {
  const r = await pedir('GET', '/api/painel/estado')
  assert.equal(r.status, 200)
  assert.equal(r.corpo.montagens.length, 3)
  assert.ok(r.corpo.montagens.every((m) => m.quadros.length === 4 && m.atualizado_em))
  assert.equal(r.corpo.tvId, 'teste-plantio')
})

test('tv: devolve a montagem inteira', async () => {
  const r = await pedir('GET', '/api/painel/tv')
  assert.equal(r.corpo.montagem_id, 'teste-plantio')
  assert.equal(r.corpo.montagem.nome, 'Plantio (teste)')
})

test('criar: nome repetido (sem diferença de maiúsculas) dá 409; nome novo cria com 4 quadros', async () => {
  const rep = await pedir('POST', '/api/painel/montagens', { nome: 'plantio (TESTE)', divisao: '4', quadros: [] })
  assert.equal(rep.status, 409)
  assert.equal(rep.corpo.codigo, 'nome-repetido')
  const nova = await pedir('POST', '/api/painel/montagens', { nome: 'Nova', divisao: '2a', quadros: [] })
  assert.equal(nova.status, 201)
  assert.equal(nova.corpo.quadros.length, 4)
  assert.equal(nova.corpo.divisao, '2a')
  assert.match(nova.corpo.id, /^m-/)
})

test('salvar: a montagem da TV salva muda a marca que a TV confere', async () => {
  const antes = (await pedir('GET', '/api/painel/tv')).corpo.montagem.atualizado_em
  const atual = (await pedir('GET', '/api/painel/tv')).corpo.montagem
  const r = await pedir('PUT', '/api/painel/montagens/teste-plantio', { nome: atual.nome, divisao: '2a', quadros: atual.quadros })
  assert.equal(r.status, 200)
  const depois = (await pedir('GET', '/api/painel/tv')).corpo.montagem
  assert.equal(depois.divisao, '2a')
  assert.notEqual(depois.atualizado_em, antes)
})

test('apagar: a montagem da TV não pode; as outras podem', async () => {
  const naTv = await pedir('DELETE', '/api/painel/montagens/teste-plantio')
  assert.equal(naTv.status, 409)
  assert.equal(naTv.corpo.codigo, 'na-tv')
  assert.equal((await pedir('DELETE', '/api/painel/montagens/teste-colheita')).status, 204)
  assert.equal((await pedir('DELETE', '/api/painel/montagens/teste-colheita')).status, 404)
})

test('pôr na TV: id que não existe dá 404; outro id troca; null tira da TV', async () => {
  assert.equal((await pedir('PUT', '/api/painel/tv', { montagem_id: 'nao-existe' })).status, 404)
  assert.equal((await pedir('PUT', '/api/painel/tv', { montagem_id: 'teste-chuva' })).status, 200)
  assert.equal((await pedir('GET', '/api/painel/tv')).corpo.montagem.nome, 'Chuva e radar (teste)')
  assert.equal((await pedir('PUT', '/api/painel/tv', { montagem_id: null })).status, 200)
  assert.equal((await pedir('GET', '/api/painel/tv')).corpo.montagem, null)
})

test('fazendas: fictícias, com unidade', async () => {
  const r = await pedir('GET', '/api/painel/fazendas')
  assert.ok(r.corpo.length >= 3)
  assert.ok(r.corpo.every((f) => /Teste/.test(f.nome) && f.unidade_pims))
})

test('config.js local e cabeçalhos do vercel.json (sem upgrade-insecure-requests, que quebra http://localhost)', async () => {
  const cfg = await pedir('GET', '/painel/config.js')
  assert.match(cfg.corpo, /modo: 'local'/)
  const painel = await pedir('GET', '/painel/logica.js')
  assert.equal(painel.status, 200)
  assert.match(painel.cabecalhos.get('content-security-policy'), /frame-src 'self' https:(;|$)/)
  assert.doesNotMatch(painel.cabecalhos.get('content-security-policy'), /upgrade-insecure-requests/)
  assert.equal(painel.cabecalhos.get('strict-transport-security'), null)
  const casca = await pedir('GET', '/index.html')
  assert.match(casca.cabecalhos.get('content-security-policy'), /frame-src 'self' https:\/\/embed\.windy\.com/)
})

test('página de teste: escapa o nome e só aceita cor #rrggbb', async () => {
  const r = await pedir('GET', '/teste/quadro?nome=' + encodeURIComponent('<b>x</b>') + '&cor=red')
  assert.equal(r.status, 200)
  assert.match(r.corpo, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.match(r.corpo, /#0C5A50/)
})

test('host diferente de localhost/127.0.0.1 é recusado', async () => {
  const porta = servidor.address().port
  const status = await new Promise((resolve, rejeitar) => {
    http.get({ host: '127.0.0.1', port: porta, path: '/api/painel/estado', headers: { host: 'site-de-fora.com' } }, (res) => { res.resume(); resolve(res.statusCode) }).on('error', rejeitar)
  })
  assert.equal(status, 400)
})
