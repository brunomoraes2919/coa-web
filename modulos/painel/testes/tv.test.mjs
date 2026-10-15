// Testes da TV do Montagens de Painel: os avisos (e quando a TV se recarrega sozinha) e a marcação do botão Entrar.
// Rodar na raiz do repositório: node --test "modulos/painel/testes/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const L = createRequire(import.meta.url)('../../../painel/logica.js')

test('avisoDaTv: sem login, a TV pede para entrar e se recarrega sozinha a cada minuto até haver sessão', () => {
  for (const codigo of ['sem-login', 'sessao-terminou']) {
    const a = L.avisoDaTv(codigo)
    assert.equal(a.entrar, true, codigo)
    assert.equal(a.recarregarMs, 60000, codigo)
    assert.match(a.titulo, /Entre no COA WEB/, codigo)
    assert.match(a.texto, /janela à parte/, codigo)
  }
})

test('avisoDaTv: sem montagem não recarrega (a conferência de 1 min traz a nova); sem conexão e sem categoria recarregam', () => {
  assert.equal(L.avisoDaTv('sem-montagem').recarregarMs, 0)
  assert.equal(L.avisoDaTv('sem-montagem').titulo, 'Nenhuma montagem na TV')
  assert.equal(L.avisoDaTv('sem-conexao').recarregarMs, 60000)
  assert.equal(L.avisoDaTv('sem-categoria').recarregarMs, 300000)
  assert.equal(L.avisoDaTv('sem-categoria').entrar, false)
})

test('avisoDaTv: código desconhecido vira "sem conexão"', () => {
  assert.deepEqual(L.avisoDaTv('qualquer'), L.avisoDaTv('sem-conexao'))
})

test('o botão Entrar da TV abre o login numa janela à parte (a aba da TV não sai do painel)', () => {
  const html = readFileSync(new URL('../../../painel/index.html', import.meta.url), 'utf8')
  const botao = /<a [^>]*id="tv-aviso-botao"[^>]*>/.exec(html)
  assert.ok(botao, 'botão Entrar não achado')
  assert.match(botao[0], /target="_blank"/)
  assert.match(botao[0], /rel="noopener"/)
})
