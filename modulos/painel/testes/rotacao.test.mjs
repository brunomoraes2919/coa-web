// Testes da lógica do módulo Montagens de Painel (painel/logica.js) — rotação e atualização da TV.
// Rodar na raiz do repositório: node --test "modulos/painel/testes/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../painel/logica.js')

const quadro = (segundos, recarregar = 0) => ({ padrao: 60, recarregar, sites: segundos.map((s, i) => ({ id: 's' + i, nome: 'S' + i, url: 'https://s' + i + '.exemplo.com/', origem: 'externo', segundos: s, conferencia: 'abre' })) })
const montagem = (divisao, quadros) => ({ id: 'm', nome: 'M', divisao, quadros })
const vazio = () => quadro([])

test('duracaoMs: rotação usa o tempo do site; site fixo só troca se tiver recarga', () => {
  assert.equal(L.duracaoMs(quadro([30, 120]), 1), 120000)
  assert.equal(L.duracaoMs(quadro([30]), 0), Infinity)
  assert.equal(L.duracaoMs(quadro([30], 300), 0), 300000)
  assert.equal(L.duracaoMs(vazio(), 0), Infinity)
})

test('proximoIndice: volta ao começo; quadro de um site (recarga) fica no mesmo', () => {
  assert.equal(L.proximoIndice(quadro([30, 30, 30]), 1), 2)
  assert.equal(L.proximoIndice(quadro([30, 30, 30]), 2), 0)
  assert.equal(L.proximoIndice(quadro([30]), 0), 0)
  assert.equal(L.proximoIndice(vazio(), 0), 0)
})

test('atrasoPreCarga: 8 s antes da troca a partir de 20 s; antes disso, logo depois da troca anterior', () => {
  assert.equal(L.atrasoPreCarga(60000), 52000)
  assert.equal(L.atrasoPreCarga(20000), 12000)
  assert.equal(L.atrasoPreCarga(15000), 0)
  assert.equal(L.atrasoPreCarga(Infinity), Infinity)
})

test('assinaturaQuadro: muda com sites, ordem, tempo e recarga; não muda com o tempo padrão', () => {
  const a = quadro([30, 60])
  assert.equal(L.assinaturaQuadro(a), L.assinaturaQuadro(quadro([30, 60])))
  assert.equal(L.assinaturaQuadro(a), L.assinaturaQuadro({ ...quadro([30, 60]), padrao: 300 }))
  assert.notEqual(L.assinaturaQuadro(a), L.assinaturaQuadro(quadro([60, 30])))
  assert.notEqual(L.assinaturaQuadro(a), L.assinaturaQuadro(quadro([30, 60], 300)))
  const renomeado = quadro([30, 60]); renomeado.sites[0].nome = 'Outro'
  assert.notEqual(L.assinaturaQuadro(a), L.assinaturaQuadro(renomeado))
})

test('planoDeAtualizacao: primeira montagem recomeça os quadros que aparecem e tira os outros', () => {
  const nova = montagem('3b', [quadro([30]), quadro([30]), quadro([30]), quadro([30])])
  assert.deepEqual(L.planoDeAtualizacao(null, nova), ['recomecar', 'recomecar', 'recomecar', 'remover'])
})

test('planoDeAtualizacao: mesma montagem não recarrega nada; quadro mudado recomeça sozinho', () => {
  const antiga = montagem('4', [quadro([30, 60]), quadro([30]), vazio(), quadro([45])])
  const igual = montagem('4', [quadro([30, 60]), quadro([30]), vazio(), quadro([45])])
  assert.deepEqual(L.planoDeAtualizacao(antiga, igual), ['manter', 'manter', 'manter', 'manter'])
  const mudou = montagem('4', [quadro([30, 60]), quadro([120]), vazio(), quadro([45])])
  assert.deepEqual(L.planoDeAtualizacao(antiga, mudou), ['manter', 'recomecar', 'manter', 'manter'])
})

test('planoDeAtualizacao: 4 → 2 → 4 mantém Q1 e Q2 e devolve Q3 e Q4 recomeçando', () => {
  const qs = () => [quadro([30]), quadro([60]), quadro([90]), quadro([120])]
  const quatro = montagem('4', qs())
  const dois = montagem('2a', qs())
  assert.deepEqual(L.planoDeAtualizacao(quatro, dois), ['manter', 'manter', 'remover', 'remover'])
  assert.deepEqual(L.planoDeAtualizacao(dois, montagem('4', qs())), ['manter', 'manter', 'recomecar', 'recomecar'])
})

test('assinaturaDaTv: nenhuma montagem, montagem sem leitura e montagem com data', () => {
  assert.equal(L.assinaturaDaTv(null), 'nenhuma')
  assert.equal(L.assinaturaDaTv({ montagem_id: null, montagem: null }), 'nenhuma')
  assert.equal(L.assinaturaDaTv({ montagem_id: 'abc', montagem: null }), 'abc|')
  assert.equal(L.assinaturaDaTv({ montagem_id: 'abc', montagem: { atualizado_em: '2026-10-15T10:00:00Z' } }), 'abc|2026-10-15T10:00:00Z')
})
