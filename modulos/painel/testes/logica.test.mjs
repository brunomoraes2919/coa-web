// Testes da lógica do módulo Montagens de Painel (painel/logica.js) — parte da montagem.
// Rodar na raiz do repositório: node --test "modulos/painel/testes/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const L = createRequire(import.meta.url)('../../../painel/logica.js')

const site = (url, extra = {}) => ({ nome: 'Site', url, segundos: 60, ...extra })
const montagem = (divisao, sitesPorQuadro) => L.normalizarMontagem({
  id: 'm1', nome: 'Teste', divisao,
  quadros: sitesPorQuadro.map((n) => ({ sites: Array.from({ length: n }, (_, i) => site('https://exemplo.com/' + i)) })),
})

test('divisões: os 7 códigos, cada um com o número certo de quadros', () => {
  assert.deepEqual(L.DIVISOES.map((d) => d.codigo), ['4', '3a', '3b', '3c', '2a', '2b', '1'])
  assert.deepEqual(L.DIVISOES.map((d) => d.areas.length), [4, 3, 3, 3, 2, 2, 1])
  assert.equal(L.divisao('3c').areas[2], '2 / 1 / 3 / 3')
  assert.equal(L.divisao('x').codigo, '4')
  assert.equal(L.divisao(undefined).codigo, '4')
})

test('tempoMaisProximo: encaixa no valor mais perto da lista; empate fica com o menor', () => {
  assert.equal(L.tempoMaisProximo(50, L.TEMPOS, 60), 45)
  assert.equal(L.tempoMaisProximo(90, L.TEMPOS, 60), 60)
  assert.equal(L.tempoMaisProximo(99999, L.TEMPOS, 60), 1800)
  assert.equal(L.tempoMaisProximo('120', L.TEMPOS, 60), 120)
  assert.equal(L.tempoMaisProximo('abc', L.TEMPOS, 60), 60)
  assert.equal(L.tempoMaisProximo(null, L.TEMPOS, 60), 60)
  assert.equal(L.tempoMaisProximo(undefined, L.RECARGAS, 0), 0)
  assert.equal(L.tempoMaisProximo(1000, L.RECARGAS, 0), 900)
})

test('rotuloTempo: segundos, minutos, horas e "não recarrega"', () => {
  assert.equal(L.rotuloTempo(15), '15 s')
  assert.equal(L.rotuloTempo(60), '1 min')
  assert.equal(L.rotuloTempo(1800), '30 min')
  assert.equal(L.rotuloTempo(3600), '1 h')
  assert.equal(L.rotuloTempo(0), 'Não recarrega')
})

test('lerEndereco: https de outro site entra como externo', () => {
  assert.deepEqual(L.lerEndereco('  https://www.rainviewer.com/map.html  '), { ok: true, url: 'https://www.rainviewer.com/map.html', origem: 'externo' })
  assert.deepEqual(L.lerEndereco('rainviewer.com/map.html'), { ok: true, url: 'https://rainviewer.com/map.html', origem: 'externo' })
})

test('lerEndereco: caminho do COA WEB entra como coa; endereço completo do COA WEB vira caminho', () => {
  assert.deepEqual(L.lerEndereco('acompanhamento/index.html?tv=1'), { ok: true, url: 'acompanhamento/index.html?tv=1', origem: 'coa' })
  assert.deepEqual(
    L.lerEndereco('https://coa-web-teal.vercel.app/previsao/index.html?tv=1&camadas=rain', 'https://coa-web-teal.vercel.app'),
    { ok: true, url: 'previsao/index.html?tv=1&camadas=rain', origem: 'coa' })
})

test('lerEndereco: recusa o próprio painel, a raiz do COA WEB, http, senha no endereço e lixo', () => {
  const recusa = (t, o) => { const r = L.lerEndereco(t, o); assert.equal(r.ok, false, t); assert.ok(r.motivo, t) }
  recusa('painel/index.html?tv=1')
  recusa('https://coa-web-teal.vercel.app/painel/?tv=1', 'https://coa-web-teal.vercel.app')
  recusa('https://coa-web-teal.vercel.app/', 'https://coa-web-teal.vercel.app')
  recusa('http://exemplo.com')
  recusa('https://usuario:senha@exemplo.com/')
  recusa('https://intranet/')
  recusa('javascript:alert(1)')
  recusa('../segredo/arquivo')
  recusa('')
  recusa('https://exemplo.com/' + 'a'.repeat(2001))
  assert.equal(L.lerEndereco('http://exemplo.com').motivo, 'Só endereços https abrem no painel.')
})

test('enderecoNoNavegador: caminho do COA WEB a partir da raiz do site; externo como está', () => {
  assert.equal(L.enderecoNoNavegador({ url: 'acompanhamento/index.html?tv=1', origem: 'coa' }), '/acompanhamento/index.html?tv=1')
  assert.equal(L.enderecoNoNavegador({ url: 'https://exemplo.com/a', origem: 'externo' }), 'https://exemplo.com/a')
})

test('normalizarMontagem: do nada sai uma montagem válida com 4 quadros vazios', () => {
  const m = L.normalizarMontagem({})
  assert.equal(m.nome, 'Sem nome')
  assert.equal(m.divisao, '4')
  assert.equal(m.quadros.length, 4)
  assert.deepEqual(m.quadros[0], { padrao: 60, recarregar: 0, sites: [] })
  assert.equal(m.id, null)
})

test('normalizarMontagem: limpa quadros, sites, tempos, ids e conferência', () => {
  const m = L.normalizarMontagem({
    id: 7, nome: '  ' + 'N'.repeat(70) + '  ', divisao: '2b', atualizado_em: '2026-10-15T10:00:00Z',
    quadros: [
      { padrao: 50, recarregar: 1000, sites: [
        { id: 'a1', nome: ' Radar ', url: 'https://radar.exemplo.com', segundos: 25, conferencia: 'abre' },
        { id: 'a1', nome: '', url: 'https://outro.exemplo.com/x', segundos: 'x' },
        { id: 'b2', nome: 'Velho', url: 'http://velho.exemplo.com' },
        { id: 'c3', nome: 'Acomp', url: 'acompanhamento/index.html?tv=1', segundos: 120, conferencia: 'incerto' },
        { id: 'd4', nome: 'Painel', url: 'painel/index.html?tv=1' },
      ] },
      { sites: Array.from({ length: 20 }, (_, i) => ({ url: 'https://s' + i + '.exemplo.com' })) },
      null, {}, { sites: [{ url: 'https://quinto.exemplo.com' }] },
    ],
  })
  assert.equal(m.id, '7')
  assert.equal(m.nome.length, 60)
  assert.equal(m.divisao, '2b')
  assert.equal(m.atualizadoEm, '2026-10-15T10:00:00Z')
  assert.equal(m.quadros.length, 4)
  const q = m.quadros[0]
  assert.equal(q.padrao, 45)
  assert.equal(q.recarregar, 900)
  assert.deepEqual(q.sites.map((s) => s.url), ['https://radar.exemplo.com/', 'https://outro.exemplo.com/x', 'acompanhamento/index.html?tv=1'])
  assert.equal(q.sites[0].nome, 'Radar')
  assert.equal(q.sites[0].segundos, 30)
  assert.equal(q.sites[0].conferencia, 'abre')
  assert.equal(q.sites[1].nome, 'outro.exemplo.com')
  assert.equal(q.sites[1].segundos, 60)
  assert.equal(q.sites[1].conferencia, 'incerto')
  assert.notEqual(q.sites[1].id, 'a1')
  assert.equal(new Set(q.sites.map((s) => s.id)).size, 3)
  assert.equal(q.sites[2].origem, 'coa')
  assert.equal(q.sites[2].conferencia, 'abre')
  assert.equal(m.quadros[1].sites.length, 12)
  assert.deepEqual(m.quadros[2].sites, [])
})

test('paraGravar: só as três colunas do banco', () => {
  const g = L.paraGravar(montagem('2a', [1, 0, 0, 0]))
  assert.deepEqual(Object.keys(g).sort(), ['divisao', 'nome', 'quadros'])
  assert.equal(g.quadros.length, 4)
  assert.deepEqual(Object.keys(g.quadros[0].sites[0]).sort(), ['conferencia', 'id', 'nome', 'origem', 'segundos', 'url'])
})

test('resumoMontagem: conta só os quadros que aparecem na divisão', () => {
  assert.equal(L.resumoMontagem(montagem('2a', [2, 1, 5, 0])), '2 quadros · 3 sites')
  assert.equal(L.resumoMontagem(montagem('1', [1, 0, 0, 0])), '1 quadro · 1 site')
  assert.equal(L.quadrosVisiveis(montagem('3b', [0, 0, 0, 0])).length, 3)
})

test('textoGuardados: quadros com sites que ficaram fora da divisão', () => {
  assert.equal(L.textoGuardados(montagem('2a', [1, 1, 2, 1])), 'Guardados fora da tela: Quadro 3 (2 sites), Quadro 4 (1 site)')
  assert.equal(L.textoGuardados(montagem('2a', [1, 1, 0, 0])), '')
  assert.equal(L.textoGuardados(montagem('4', [1, 1, 2, 1])), '')
})

test('textoDoQuadro: vazio, fixo, fixo com recarga e rotação', () => {
  assert.deepEqual(L.textoDoQuadro({ padrao: 60, recarregar: 0, sites: [] }), { titulo: 'Vazio', detalhe: 'clique para adicionar' })
  const um = [{ nome: 'Radar', segundos: 60 }]
  assert.deepEqual(L.textoDoQuadro({ padrao: 60, recarregar: 0, sites: um }), { titulo: 'Radar', detalhe: 'fixo' })
  assert.deepEqual(L.textoDoQuadro({ padrao: 60, recarregar: 900, sites: um }), { titulo: 'Radar', detalhe: 'fixo · recarrega a cada 15 min' })
  const tres = [{ nome: 'A', segundos: 120 }, { nome: 'B', segundos: 30 }, { nome: 'C', segundos: 30 }]
  assert.deepEqual(L.textoDoQuadro({ padrao: 60, recarregar: 0, sites: tres }), { titulo: 'A', detalhe: '2 min · +2 em rotação' })
})

test('nomes: repetido sem diferença de maiúsculas, nome livre e nome da cópia', () => {
  const lista = [{ id: 'a', nome: 'Nova montagem' }, { id: 'b', nome: 'nova montagem 2' }, { id: 'c', nome: 'Plantio' }]
  assert.equal(L.nomeRepetido(' PLANTIO ', lista, null), true)
  assert.equal(L.nomeRepetido('Plantio', lista, 'c'), false)
  assert.equal(L.nomeLivre('Nova montagem', lista), 'Nova montagem 3')
  assert.equal(L.nomeLivre('Colheita', lista), 'Colheita')
  assert.equal(L.nomeDaCopia('Plantio', lista), 'Plantio (cópia)')
  assert.equal(L.nomeDaCopia('Plantio', lista.concat({ id: 'd', nome: 'Plantio (cópia)' })), 'Plantio (cópia 2)')
  assert.ok(L.nomeDaCopia('X'.repeat(60), lista).length <= 60)
})

test('ordenarMontagens: a da TV primeiro, depois por nome (com acento)', () => {
  const lista = [{ id: '1', nome: 'Colheita' }, { id: '2', nome: 'Água' }, { id: '3', nome: 'Bravo' }]
  assert.deepEqual(L.ordenarMontagens(lista, '3').map((m) => m.nome), ['Bravo', 'Água', 'Colheita'])
  assert.deepEqual(L.ordenarMontagens(lista, null).map((m) => m.nome), ['Água', 'Bravo', 'Colheita'])
  assert.deepEqual(lista.map((m) => m.id), ['1', '2', '3'])
})

test('fazendasDoCadastro: nome sem "Fazenda", unidade em maiúsculas, ordem por nome', () => {
  assert.deepEqual(L.fazendasDoCadastro([
    { id: 9, nome: 'Fazenda Três Flechas', unidade_pims: ' tres flechas ' },
    { id: 3, nome: 'Fazenda Globo', unidade_pims: null },
  ]), [
    { id: '3', nome: 'Globo', unidade: null },
    { id: '9', nome: 'Três Flechas', unidade: 'TRES FLECHAS' },
  ])
})

test('atalhoAcompanhamento: todas as fazendas, uma fazenda e tempo encaixado', () => {
  assert.deepEqual(L.atalhoAcompanhamento({ fazendas: [], tempo: 20 }), {
    nome: 'Acompanhamento · todas as fazendas', url: 'acompanhamento/index.html?tv=1&tempo=20', origem: 'coa', conferencia: 'abre',
  })
  const a = L.atalhoAcompanhamento({ fazendas: [{ id: '9', nome: 'Três Flechas', unidade: 'TRES FLECHAS' }], tempo: 17 })
  assert.equal(a.url, 'acompanhamento/index.html?tv=1&tempo=15&todas=0&fazendas=TRES%20FLECHAS')
  assert.equal(a.nome, 'Acompanhamento · Três Flechas')
  const b = L.atalhoAcompanhamento({ fazendas: [{ id: '1', nome: 'A', unidade: 'A' }, { id: '2', nome: 'B', unidade: null }, { id: '3', nome: 'C', unidade: 'C' }] })
  assert.equal(b.url, 'acompanhamento/index.html?tv=1&tempo=20&todas=0&fazendas=A,C')
  assert.equal(b.nome, 'Acompanhamento · 2 fazendas')
})

test('atalhoPrevisao: camada conhecida (senão chuva) e fazendas pelo id', () => {
  const a = L.atalhoPrevisao({ fazendas: [{ id: '12', nome: 'Guapirama', unidade: 'GUAPIRAMA' }], camada: 'wind', tempo: 30 })
  assert.equal(a.url, 'previsao/index.html?tv=1&tempo=30&camadas=wind&todas=0&fazendas=12')
  assert.equal(a.nome, 'Previsão · Vento · Guapirama')
  const b = L.atalhoPrevisao({ fazendas: [], camada: 'nada' })
  assert.equal(b.url, 'previsao/index.html?tv=1&tempo=20&camadas=rain')
  assert.equal(b.nome, 'Previsão · Chuva e trovoadas · todas as fazendas')
})

test('data por extenso e hora', () => {
  const d = new Date(2026, 9, 15, 7, 11)
  assert.equal(L.dataPorExtenso(d), 'Quinta-feira, 15 de outubro')
  assert.equal(L.horaMinuto(d), '07:11')
})
