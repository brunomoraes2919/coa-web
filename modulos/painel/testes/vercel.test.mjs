// Testes das regras de cabeçalho do vercel.json: o painel libera abrir sites externos nos quadros (frame-src https:)
// e o resto do COA WEB continua travado como antes. Rodar na raiz: node --test "modulos/painel/testes/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerVercel, regrasDoCaminho, cabecalhosDoCaminho } from '../scripts/vercel-cabecalhos.mjs'

const V = lerVercel()
const regrasComCsp = (c) => regrasDoCaminho(c, V).filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'))
const diretivas = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(' ')] }))
const csp = (c) => diretivas(cabecalhosDoCaminho(c, V)['content-security-policy'])
const FORA = ['/', '/index.html', '/previsao/index.html', '/acompanhamento/index.html', '/api/gnss', '/api/conferir-site', '/painelx', '/assets/logo-coa-web.png']
const DENTRO = ['/painel', '/painel/', '/painel/index.html', '/painel/tv.js', '/painel/logica.js']

test('fora do painel: uma regra de CSP só, com o frame-src de antes (só o widget do Windy)', () => {
  for (const c of FORA) {
    assert.equal(regrasComCsp(c).length, 1, c)
    assert.equal(csp(c)['frame-src'], "'self' https://embed.windy.com", c)
  }
})

test('no painel: uma regra de CSP só, com frame-src para qualquer https', () => {
  for (const c of DENTRO) {
    assert.equal(regrasComCsp(c).length, 1, c)
    assert.equal(csp(c)['frame-src'], "'self' https:", c)
  }
})

test('as duas CSP só diferem no frame-src', () => {
  const fora = csp('/index.html')
  const dentro = csp('/painel/index.html')
  delete fora['frame-src']
  delete dentro['frame-src']
  assert.deepEqual(dentro, fora)
})

test('o painel recebe os mesmos cabeçalhos de segurança do resto do site', () => {
  const fora = cabecalhosDoCaminho('/index.html', V)
  const dentro = cabecalhosDoCaminho('/painel/index.html', V)
  for (const k of ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'strict-transport-security', 'cross-origin-opener-policy']) {
    assert.ok(fora[k], k)
    assert.equal(dentro[k], fora[k], k)
  }
})

test('o cache dos arquivos continua valendo dentro e fora do painel', () => {
  assert.match(cabecalhosDoCaminho('/assets/curiosidades.js', V)['cache-control'], /max-age=86400/)
  assert.match(cabecalhosDoCaminho('/painel/logo.png', V)['cache-control'], /max-age=86400/)
  assert.match(cabecalhosDoCaminho('/mapas/assets/index.js', V)['cache-control'], /immutable/)
})
