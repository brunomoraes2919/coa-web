# Montagens de Painel (TV do COA) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo "Montagens de Painel" no COA WEB: montagens com nome (divisão da TV + sites de cada quadro com tempo próprio), uma delas "na TV hoje", e a página da TV (`/painel/?tv=1`) com a moldura do COA, rotação independente por quadro e atualização sozinha.

**Architecture:** Pasta nova `painel/` em JS puro, sem build (padrão de `previsao/`): as contas ficam em `painel/logica.js` (UMD, testado com `node --test`), o acesso a dados em `painel/fonte.js` (Supabase ou servidor local), o editor em `painel/editor.js` e a TV em `painel/tv.js`, as duas telas no mesmo `painel/index.html` (`?tv=1` escolhe a TV). Uma função nova da Vercel (`api/conferir-site.js`) diz se um site deixa ser exibido dentro de outra página. O banco ganha duas tabelas e a categoria `painel` (script `supabase/0025_painel.sql`); o `vercel.json` libera `frame-src https:` só em `/painel/`; a casca (`index.html`) ganha a categoria, o cartão e o menu.

**Tech Stack:** JS puro (navegador), supabase-js 2.117.3 (CDN, com `integrity`), IBM Plex Sans (Google Fonts), Node 24 (`node --test`, função da Vercel em CommonJS, servidor local `.mjs`), Postgres/Supabase com RLS.

**Spec:** `modulos/painel/docs/2026-10-15-montagens-de-painel-design.md`

## Global Constraints

- **Sem build e sem dependência nova** (nada de `npm install`). supabase-js por CDN, exatamente: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js` com `integrity="sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R" crossorigin="anonymous"`.
- **Identidade**: IBM Plex Sans 400/500/600/700; `--verde-escuro #103632`, `--verde-teal #0C5A50`, `--dourado #DB8A08`, `--dourado-claro #F0B24A`, `--fundo #EEF2EE`, `--linha #DCE3DC`, `--texto #17251F`, `--texto-suave #5B6B62`, `--texto-fraco #8A988F`, `--bom #1E7B4F`, `--atencao #B7791F`, `--ruim #B3261E`. Fundo liso, sem degradê; cartões com raio 8 px, botões e campos com 6 px e 36 px de altura; sombra só `0 1px 2px`. Números com `font-variant-numeric: tabular-nums`. Logo branca: `acompanhamento/assets/logo_coa_branco.png` (1600×445).
- **Divisões**: códigos `4`, `3a`, `3b`, `3c`, `2a`, `2b`, `1`. Toda montagem guarda **4 quadros**; até **12 sites** por quadro.
- **Tempos** (segundos): rotação e padrão do quadro `15, 30, 45, 60, 120, 180, 300, 600, 900, 1800` (padrão 60); recarga de site fixo `0, 300, 900, 1800, 3600` (0 = não recarrega).
- **TV**: pré-carga **8 s** antes da troca quando o site tem **≥ 20 s**; espera de até **10 s** pelo `load`; esmaecimento **600 ms**; conferência da montagem a cada **60 s**; conferência de versão a cada **5 min**; **3 falhas** seguidas → "Sem conexão desde HH:MM"; cursor some depois de **3 s**.
- **Endereços**: só `https://` externo ou caminho do próprio COA WEB (`acompanhamento/index.html?tv=1`); **nunca** `painel/...` (painel dentro do painel).
- **iframes da TV**: `sandbox="allow-scripts allow-same-origin allow-forms"`, `referrerpolicy="no-referrer"`, `allow=""`.
- **Texto vindo do banco vai para a tela por `textContent`**; `innerHTML` só com marcação constante (ícones), nunca com dado.
- Toda mudança em arquivo de `painel/` troca o `?v=` dele em `painel/index.html` (as TVs ligadas recarregam sozinhas pela versão).
- **Fim de linha**: arquivos novos em LF (ferramenta Write). `index.html` e `vercel.json` estão em CRLF na pasta de trabalho (`i/lf w/crlf`): editar **só com a ferramenta Edit**, nunca `sed -i`; conferir com `git diff --stat` (o arquivo não pode aparecer inteiro trocado) e `git ls-files --eol <arquivo>` (esperado `i/lf`).
- **Repositório público**: dados do servidor local e dos testes são fictícios (podem apontar para sites públicos como RainViewer e o widget do Windy).
- Trabalho no worktree `CLAUDE GERAL/coa-web-painel`, branch `modulo-painel`. Commits locais; **push, merge no `main` e o SQL 0025 só com autorização do usuário** (Tarefa 11). Mensagens de commit terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `node --test "modulos/painel/testes/*.test.mjs"` na raiz do worktree.
- Textos de tela e comentários em português do Brasil, no tom dos módulos existentes.
- Origem de produção: `https://coa-web-teal.vercel.app`.
- Testes de tela só no servidor local (dados fictícios, sem login). Nada de gravar no banco de produção durante o desenvolvimento.

## Review Focus

- **Endereço do próprio painel (ou da casca) posto num quadro**: a TV abriria o painel dentro do painel, sem fim. Espera-se recusa na hora, com motivo claro → testes de `lerEndereco` na Tarefa 1 (`painel/...`, raiz do COA WEB).
- **Montagem gravada com formato estranho** (quadros faltando, tempo fora da lista, `http://`, 20 sites, ids repetidos, nome vazio): a TV e o editor não podem quebrar, e o que entrar no banco sai limpo → testes de `normalizarMontagem` na Tarefa 1.
- **Divisão diminuída e depois aumentada** (4 → 2 → 4): os sites dos quadros 3 e 4 não podem sumir, e a TV não recarrega os quadros que não mudaram → `textoGuardados` (Tarefa 1) e `planoDeAtualizacao` 4 → 2 → 4 (Tarefa 2).
- **Montagem tirada da TV, apagada ou nenhuma na TV** com a TV ligada: a TV mostra "Nenhuma montagem na TV" em vez de quebrar, e não dá para apagar a que está na TV → `assinaturaDaTv` com nulos (Tarefa 2) e `DELETE` da montagem da TV recusado no servidor local (Tarefa 6).
- **Site que redireciona para `http`, para a rede interna, que demora ou que redireciona sem fim**: a conferência devolve "não deu para conferir" ou "não aceito", nunca "abre", e nunca consulta endereço interno → testes de `conferirEndereco` na Tarefa 3.

## Mapa dos arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `painel/logica.js` | 1, 2 | Contas sem tela: divisões, tempos, endereços, normalização, nomes, atalhos, datas, rotação, atualização da TV |
| `modulos/painel/testes/logica.test.mjs` | 1 | Testes da parte da montagem |
| `modulos/painel/testes/rotacao.test.mjs` | 2 | Testes da rotação e da atualização da TV |
| `api/conferir-site.js` | 3 | Função da Vercel: o site deixa ser exibido dentro de outra página? |
| `modulos/painel/testes/conferir-site.test.mjs` | 3 | Testes da função |
| `supabase/0025_painel.sql` | 4 | Categoria `painel`, tabelas `painel_montagens` e `painel_tv`, RLS |
| `vercel.json` | 5 | `frame-src https:` só em `/painel/` |
| `modulos/painel/scripts/vercel-cabecalhos.mjs` | 5 | Lê as regras do `vercel.json` para um caminho (teste e servidor local) |
| `modulos/painel/testes/vercel.test.mjs` | 5 | Uma regra de CSP por caminho, e as duas iguais menos o `frame-src` |
| `painel/config.js`, `painel/fonte.js` | 6 | Configuração e acesso a dados (Supabase ou servidor local) |
| `modulos/painel/scripts/servidor-local.mjs` | 6 | Servidor local com montagens fictícias na memória |
| `modulos/painel/testes/servidor.test.mjs` | 6 | Testes da API do servidor local |
| `painel/index.html`, `painel/estilo.css`, `painel/editor.js` | 7, 8 | Editor (lista, montagem, divisão, prévia, quadro, sites) |
| `painel/tv.css`, `painel/tv.js` (+ trecho do `painel/index.html`) | 9 | TV |
| `index.html` (casca) | 10 | Categoria, cartão, menu, entrada do módulo |
| `modulos/painel/README.md` | 11 | Como rodar, testar e deixar a TV abrindo sozinha |

---

### Task 1: Lógica da montagem (`painel/logica.js`)

**Files:**
- Create: `painel/logica.js`
- Test: `modulos/painel/testes/logica.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces (em `window.PainelLogica` e `module.exports`):
  - constantes `DIVISOES` (`[{ codigo, nome, colunas, linhas, areas: string[] }]`), `TOTAL_QUADROS = 4`, `MAX_SITES = 12`, `TEMPOS`, `RECARGAS`, `TEMPO_PADRAO = 60`, `TEMPOS_INTERNOS = [10, 15, 20, 30, 60]`, `CAMADAS_PREVISAO` (`[[codigo, nome]]`);
  - `divisao(codigo) → divisão` (desconhecido → a de `4`);
  - `tempoMaisProximo(valor, lista, padrao) → número`; `rotuloTempo(segundos) → texto`; `plural(n, um, varios)`;
  - `nomeDoHost(url) → texto`; `lerEndereco(texto, origemAtual?) → { ok: true, url, origem: 'coa'|'externo' } | { ok: false, motivo }`; `enderecoNoNavegador(site) → texto`;
  - `novoId() → texto`; `normalizarSite(s, ids?) → site | null`; `normalizarQuadro(q) → { padrao, recarregar, sites }`; `normalizarMontagem(linha) → { id, nome, divisao, quadros[4], atualizadoEm }`; `paraGravar(m) → { nome, divisao, quadros }`;
  - `quadrosVisiveis(m)`, `resumoMontagem(m)`, `textoGuardados(m)`, `textoDoQuadro(q) → { titulo, detalhe }`;
  - `nomeRepetido(nome, montagens, idProprio)`, `nomeLivre(base, montagens)`, `nomeDaCopia(nome, montagens)`, `ordenarMontagens(lista, idTv)`;
  - `fazendasDoCadastro(linhas) → [{ id, nome, unidade }]`, `atalhoAcompanhamento({ fazendas, tempo })`, `atalhoPrevisao({ fazendas, camada, tempo })` → `{ nome, url, origem: 'coa', conferencia: 'abre' }`;
  - `dataPorExtenso(data)`, `horaMinuto(data)`.
  - Um **site** normalizado é `{ id, nome, url, origem, segundos, conferencia: 'abre'|'incerto' }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `modulos/painel/testes/logica.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: FAIL com `Cannot find module '../../../painel/logica.js'`.

- [ ] **Step 3: Escrever `painel/logica.js`**

```js
/* Montagens de Painel — contas do módulo, sem tela: as divisões da TV, os tempos, os endereços aceitos, a leitura
   e a limpeza de uma montagem vinda do banco, os nomes, os atalhos do COA WEB, a data por extenso e a agenda da
   rotação da TV. Serve ao navegador (window.PainelLogica) e aos testes
   (node --test "modulos/painel/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PainelLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* As 7 divisões da tela. `areas` diz onde cada quadro fica na grade (grid-area: linha / coluna / linha-fim /
     coluna-fim), na ordem de leitura; quantas áreas = quantos quadros aparecem. */
  const DIVISOES = [
    { codigo: '4', nome: '4 · grade 2×2', colunas: '1fr 1fr', linhas: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'] },
    { codigo: '3a', nome: '3 · destaque + 2', colunas: '2fr 1fr', linhas: '1fr 1fr', areas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
    { codigo: '3b', nome: '3 · três colunas', colunas: '1fr 1fr 1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '1 / 3 / 2 / 4'] },
    { codigo: '3c', nome: '3 · 2 em cima + 1 embaixo', colunas: '1fr 1fr', linhas: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'] },
    { codigo: '2a', nome: '2 · lado a lado', colunas: '1fr 1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3'] },
    { codigo: '2b', nome: '2 · destaque + lateral', colunas: '2fr 1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3'] },
    { codigo: '1', nome: 'Tela cheia', colunas: '1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2'] },
  ];
  const TOTAL_QUADROS = 4;     // toda montagem guarda 4 quadros; a divisão decide quantos aparecem
  const MAX_SITES = 12;        // sites por quadro
  const TEMPOS = [15, 30, 45, 60, 120, 180, 300, 600, 900, 1800]; // segundos de um site na rotação
  const RECARGAS = [0, 300, 900, 1800, 3600];                      // recarga de site fixo (0 = não recarrega)
  const TEMPO_PADRAO = 60;
  const TEMPOS_INTERNOS = [10, 15, 20, 30, 60];                    // troca entre fazendas no Modo TV dos módulos
  const MAX_NOME_MONTAGEM = 60;
  const MAX_NOME_SITE = 80;
  const MAX_ENDERECO = 2000;
  /* camadas do Modo TV da Previsão do Tempo (as mesmas de previsao/app.js) */
  const CAMADAS_PREVISAO = [
    ['rain', 'Chuva e trovoadas'], ['rainAccu', 'Chuva acumulada'], ['wind', 'Vento'], ['gust', 'Rajadas de vento'],
    ['temp', 'Temperatura'], ['clouds', 'Nuvens'], ['rh', 'Umidade do ar'], ['radar', 'Radar'],
  ];

  const texto = (v) => String(v === null || v === undefined ? '' : v);

  function divisao(codigo) {
    return DIVISOES.find((d) => d.codigo === texto(codigo)) || DIVISOES[0];
  }

  /** O valor da lista mais perto de `valor` (empate: o menor); `padrao` quando não é número. */
  function tempoMaisProximo(valor, lista, padrao) {
    const n = Number(valor);
    if (valor === null || valor === undefined || valor === '' || !Number.isFinite(n)) return padrao;
    let melhor = lista[0];
    for (const x of lista) if (Math.abs(x - n) < Math.abs(melhor - n)) melhor = x;
    return melhor;
  }

  function rotuloTempo(s) {
    if (!s) return 'Não recarrega';
    if (s < 60) return s + ' s';
    if (s < 3600) return s / 60 + ' min';
    return s / 3600 + ' h';
  }

  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  function nomeDoHost(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (e) { return ''; }
  }

  /**
   * Endereço digitado → { ok: true, url, origem } ou { ok: false, motivo }.
   * origem 'coa' = página do próprio COA WEB, guardada como caminho a partir da raiz do site
   * ("acompanhamento/index.html?tv=1"); 'externo' = https de outro site. `origemAtual` (location.origin)
   * transforma o endereço completo do COA WEB em caminho. O próprio painel nunca entra num quadro.
   */
  function lerEndereco(entrada, origemAtual) {
    const t = texto(entrada).trim();
    if (!t) return { ok: false, motivo: 'Escreva o endereço do site.' };
    if (t.length > MAX_ENDERECO) return { ok: false, motivo: 'Endereço longo demais.' };
    if (/^http:\/\//i.test(t)) return { ok: false, motivo: 'Só endereços https abrem no painel.' };
    if (/^https:\/\//i.test(t)) {
      let u;
      try { u = new URL(t); } catch (e) { return { ok: false, motivo: 'Endereço inválido.' }; }
      if (u.username || u.password) return { ok: false, motivo: 'Endereço com usuário e senha não é aceito.' };
      if (origemAtual && u.origin === origemAtual) {
        const caminho = (u.pathname + u.search + u.hash).replace(/^\/+/, '');
        if (!/^[a-z0-9_-]+\//i.test(caminho)) return { ok: false, motivo: 'Use o endereço de um módulo do COA WEB, como o do Acompanhamento.' };
        return lerEndereco(caminho);
      }
      if (u.hostname.indexOf('.') < 0) return { ok: false, motivo: 'Endereço inválido.' };
      return { ok: true, url: u.href, origem: 'externo' };
    }
    if (/^[a-z0-9_-]+\/[^\s\\]*$/i.test(t)) {
      if (t.indexOf('..') >= 0) return { ok: false, motivo: 'Endereço inválido.' };
      if (/^painel\//i.test(t)) return { ok: false, motivo: 'O próprio painel não pode entrar num quadro.' };
      return { ok: true, url: t, origem: 'coa' };
    }
    // "rainviewer.com/map.html", sem o https://
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(t)) return lerEndereco('https://' + t, origemAtual);
    return { ok: false, motivo: 'Endereço inválido.' };
  }

  /** Endereço que vai no iframe: o caminho do COA WEB é sempre a partir da raiz do site (a TV está em /painel/). */
  function enderecoNoNavegador(site) {
    return site.origem === 'coa' ? '/' + texto(site.url).replace(/^\/+/, '') : site.url;
  }

  let contador = 0;
  function novoId() {
    contador = (contador + 1) % 1296;
    return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + contador.toString(36);
  }

  /** Site limpo, ou null se o endereço não é aceito. `ids` evita id repetido dentro do mesmo quadro. */
  function normalizarSite(s, ids) {
    if (!s || typeof s !== 'object') return null;
    const e = lerEndereco(s.url);
    if (!e.ok) return null;
    const usados = ids || new Set();
    let id = typeof s.id === 'string' && /^[a-z0-9]{1,24}$/i.test(s.id) ? s.id : '';
    if (!id || usados.has(id)) id = novoId();
    usados.add(id);
    const nome = texto(s.nome).trim().slice(0, MAX_NOME_SITE);
    return {
      id,
      nome: nome || (e.origem === 'coa' ? 'COA WEB' : nomeDoHost(e.url)),
      url: e.url,
      origem: e.origem,
      segundos: tempoMaisProximo(s.segundos, TEMPOS, TEMPO_PADRAO),
      conferencia: e.origem === 'coa' || s.conferencia === 'abre' ? 'abre' : 'incerto',
    };
  }

  function normalizarQuadro(q) {
    const o = q && typeof q === 'object' ? q : {};
    const ids = new Set();
    const sites = (Array.isArray(o.sites) ? o.sites : []).map((s) => normalizarSite(s, ids)).filter(Boolean).slice(0, MAX_SITES);
    return { padrao: tempoMaisProximo(o.padrao, TEMPOS, TEMPO_PADRAO), recarregar: tempoMaisProximo(o.recarregar, RECARGAS, 0), sites };
  }

  /** Montagem vinda do banco (ou de qualquer lugar) → sempre válida: nome, divisão conhecida, 4 quadros limpos. */
  function normalizarMontagem(m) {
    const o = m && typeof m === 'object' ? m : {};
    const lista = Array.isArray(o.quadros) ? o.quadros : [];
    const quadros = [];
    for (let i = 0; i < TOTAL_QUADROS; i++) quadros.push(normalizarQuadro(lista[i]));
    const nome = texto(o.nome).trim().slice(0, MAX_NOME_MONTAGEM);
    return {
      id: o.id === null || o.id === undefined ? null : String(o.id),
      nome: nome || 'Sem nome',
      divisao: divisao(o.divisao).codigo,
      quadros,
      atualizadoEm: o.atualizado_em || o.atualizadoEm || null,
    };
  }

  /** O que vai para o banco: as colunas nome, divisao e quadros. */
  function paraGravar(m) {
    const n = normalizarMontagem(m);
    return { nome: n.nome, divisao: n.divisao, quadros: n.quadros };
  }

  function quadrosVisiveis(m) { return m.quadros.slice(0, divisao(m.divisao).areas.length); }

  function resumoMontagem(m) {
    const qs = quadrosVisiveis(m);
    const sites = qs.reduce((t, q) => t + q.sites.length, 0);
    return plural(qs.length, 'quadro', 'quadros') + ' · ' + plural(sites, 'site', 'sites');
  }

  /** Quadros com sites que a divisão atual deixa de fora (continuam guardados). */
  function textoGuardados(m) {
    const n = divisao(m.divisao).areas.length;
    const partes = [];
    for (let i = n; i < TOTAL_QUADROS; i++) {
      const k = m.quadros[i].sites.length;
      if (k) partes.push('Quadro ' + (i + 1) + ' (' + plural(k, 'site', 'sites') + ')');
    }
    return partes.length ? 'Guardados fora da tela: ' + partes.join(', ') : '';
  }

  /** O que a prévia do editor escreve dentro de um quadro. */
  function textoDoQuadro(q) {
    const n = q.sites.length;
    if (!n) return { titulo: 'Vazio', detalhe: 'clique para adicionar' };
    if (n === 1) return { titulo: q.sites[0].nome, detalhe: q.recarregar ? 'fixo · recarrega a cada ' + rotuloTempo(q.recarregar) : 'fixo' };
    return { titulo: q.sites[0].nome, detalhe: rotuloTempo(q.sites[0].segundos) + ' · +' + (n - 1) + ' em rotação' };
  }

  const chaveNome = (t) => texto(t).trim().toLocaleLowerCase('pt-BR');

  function nomeRepetido(nome, montagens, idProprio) {
    const k = chaveNome(nome);
    return montagens.some((m) => m.id !== idProprio && chaveNome(m.nome) === k);
  }

  function nomeLivre(base, montagens) {
    if (!nomeRepetido(base, montagens, null)) return base;
    for (let k = 2; ; k++) if (!nomeRepetido(base + ' ' + k, montagens, null)) return base + ' ' + k;
  }

  function nomeDaCopia(nome, montagens) {
    for (let k = 1; ; k++) {
      const sufixo = k === 1 ? ' (cópia)' : ' (cópia ' + k + ')';
      const n = texto(nome).slice(0, MAX_NOME_MONTAGEM - sufixo.length).trim() + sufixo;
      if (!nomeRepetido(n, montagens, null)) return n;
    }
  }

  /** A da TV primeiro; as outras por nome. Não mexe na lista recebida. */
  function ordenarMontagens(lista, idTv) {
    return lista.slice().sort((a, b) => (b.id === idTv) - (a.id === idTv) || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  /** Linhas de mapas_fazendas → [{ id, nome, unidade }] para os atalhos (Acompanhamento usa a unidade; Previsão, o id). */
  function fazendasDoCadastro(linhas) {
    return (Array.isArray(linhas) ? linhas : [])
      .map((f) => ({ id: String(f.id), nome: texto(f.nome).replace(/^Fazenda\s+/i, '').trim(), unidade: f.unidade_pims ? String(f.unidade_pims).trim().toUpperCase() : null }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  function nomeDasFazendas(fz) {
    if (!fz.length) return 'todas as fazendas';
    return fz.length === 1 ? fz[0].nome : fz.length + ' fazendas';
  }

  /** Modo TV do Acompanhamento (acompanhamento/app.js: ?tv=1&tempo=&fazendas=<unidades>&todas=0). */
  function atalhoAcompanhamento(op) {
    const fz = (op && Array.isArray(op.fazendas) ? op.fazendas : []).filter((f) => f && f.unidade);
    const t = tempoMaisProximo(op && op.tempo, TEMPOS_INTERNOS, 20);
    const url = 'acompanhamento/index.html?tv=1&tempo=' + t + (fz.length ? '&todas=0&fazendas=' + fz.map((f) => encodeURIComponent(f.unidade)).join(',') : '');
    return { nome: 'Acompanhamento · ' + nomeDasFazendas(fz), url, origem: 'coa', conferencia: 'abre' };
  }

  /** Modo TV da Previsão do Tempo (previsao/app.js: ?tv=1&tempo=&camadas=&fazendas=<ids>&todas=0). */
  function atalhoPrevisao(op) {
    const fz = (op && Array.isArray(op.fazendas) ? op.fazendas : []).filter((f) => f && f.id !== null && f.id !== undefined);
    const camada = CAMADAS_PREVISAO.find((c) => c[0] === (op && op.camada)) || CAMADAS_PREVISAO[0];
    const t = tempoMaisProximo(op && op.tempo, TEMPOS_INTERNOS, 20);
    const url = 'previsao/index.html?tv=1&tempo=' + t + '&camadas=' + camada[0] + (fz.length ? '&todas=0&fazendas=' + fz.map((f) => encodeURIComponent(String(f.id))).join(',') : '');
    return { nome: 'Previsão · ' + camada[1] + ' · ' + nomeDasFazendas(fz), url, origem: 'coa', conferencia: 'abre' };
  }

  function dataPorExtenso(d) {
    const t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function horaMinuto(d) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  return {
    DIVISOES, TOTAL_QUADROS, MAX_SITES, TEMPOS, RECARGAS, TEMPO_PADRAO, TEMPOS_INTERNOS, CAMADAS_PREVISAO,
    divisao, tempoMaisProximo, rotuloTempo, plural, nomeDoHost, lerEndereco, enderecoNoNavegador,
    novoId, normalizarSite, normalizarQuadro, normalizarMontagem, paraGravar,
    quadrosVisiveis, resumoMontagem, textoGuardados, textoDoQuadro,
    nomeRepetido, nomeLivre, nomeDaCopia, ordenarMontagens,
    fazendasDoCadastro, atalhoAcompanhamento, atalhoPrevisao, dataPorExtenso, horaMinuto,
  };
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 19 testes, 0 falhas. Se `dataPorExtenso` falhar por causa de ICU, conferir `node -p "new Date(2026,9,15).toLocaleDateString('pt-BR',{weekday:'long'})"` (Node 24 já vem com ICU completo e deve dar `quinta-feira`).

- [ ] **Step 5: Commit**

```bash
git add painel/logica.js modulos/painel/testes/logica.test.mjs modulos/painel/docs/
git commit -m "Montagens de Painel: lógica das montagens (divisões, tempos, endereços, nomes e atalhos)

Inclui a especificação e este plano.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lógica da rotação e da atualização da TV

**Files:**
- Modify: `painel/logica.js` (constantes e funções novas antes do `return`, e no objeto exportado)
- Test: `modulos/painel/testes/rotacao.test.mjs`

**Interfaces:**
- Consumes: `divisao`, `TOTAL_QUADROS` (Tarefa 1).
- Produces: `PRE_CARGA_MS = 8000`, `LIMIAR_PRE_CARGA_MS = 20000`, `ESPERA_MAX_MS = 10000`, `ESMAECER_MS = 600`; `duracaoMs(quadro, indice) → ms | Infinity`; `proximoIndice(quadro, indice) → número`; `atrasoPreCarga(ms) → ms | Infinity`; `assinaturaQuadro(quadro) → texto`; `planoDeAtualizacao(antiga | null, nova) → ['manter'|'recomecar'|'remover' × 4]`; `assinaturaDaTv(linha | null) → texto` (`linha = { montagem_id, montagem: { atualizado_em } | null }`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `modulos/painel/testes/rotacao.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: FAIL nos testes de `rotacao.test.mjs` com `L.duracaoMs is not a function` (os 19 da Tarefa 1 continuam passando).

- [ ] **Step 3: Implementar em `painel/logica.js`**

Logo depois de `const MAX_ENDERECO = 2000;`, acrescentar:

```js
  /* rotação da TV */
  const PRE_CARGA_MS = 8000;          // o próximo site começa a carregar 8 s antes da troca…
  const LIMIAR_PRE_CARGA_MS = 20000;  // …quando o site atual fica pelo menos 20 s; senão, logo depois da troca anterior
  const ESPERA_MAX_MS = 10000;        // na hora da troca, espera o próximo terminar de carregar até 10 s
  const ESMAECER_MS = 600;            // esmaecimento cruzado entre um site e o próximo
```

Antes do `return {` final da fábrica (o que exporta: a linha seguinte começa com `DIVISOES, TOTAL_QUADROS`; não confundir com o `return {` de `normalizarSite` e `normalizarMontagem`), acrescentar:

```js
  /** Quanto tempo o site `i` fica no quadro: em rotação, o tempo dele; fixo, a recarga (sem recarga, para sempre). */
  function duracaoMs(q, i) {
    const n = q.sites.length;
    if (!n) return Infinity;
    if (n > 1) return q.sites[i].segundos * 1000;
    return q.recarregar > 0 ? q.recarregar * 1000 : Infinity;
  }

  function proximoIndice(q, i) {
    return q.sites.length ? (i + 1) % q.sites.length : 0;
  }

  /** Depois de quanto tempo, contado desde que o site entrou, o próximo começa a carregar escondido. */
  function atrasoPreCarga(ms) {
    if (!Number.isFinite(ms)) return Infinity;
    return ms >= LIMIAR_PRE_CARGA_MS ? ms - PRE_CARGA_MS : 0;
  }

  /** O que roda num quadro (sites, ordem, tempos, nomes e recarga). O tempo padrão não entra: só vale para site novo. */
  function assinaturaQuadro(q) {
    return JSON.stringify([q.recarregar, q.sites.map((s) => [s.url, s.segundos, s.nome])]);
  }

  /**
   * O que a TV faz em cada um dos 4 quadros quando a montagem muda: 'manter' (continua rodando, sem recarregar),
   * 'recomecar' (volta ao primeiro site) ou 'remover' (sai da tela). `antiga` null = primeira montagem.
   */
  function planoDeAtualizacao(antiga, nova) {
    const nAntiga = antiga ? divisao(antiga.divisao).areas.length : 0;
    const nNova = divisao(nova.divisao).areas.length;
    const acoes = [];
    for (let i = 0; i < TOTAL_QUADROS; i++) {
      if (i >= nNova) acoes.push('remover');
      else if (antiga && i < nAntiga && assinaturaQuadro(antiga.quadros[i]) === assinaturaQuadro(nova.quadros[i])) acoes.push('manter');
      else acoes.push('recomecar');
    }
    return acoes;
  }

  /** Marca leve da TV: muda quando outra montagem vai para a TV ou quando a montagem da TV é salva. */
  function assinaturaDaTv(linha) {
    if (!linha || !linha.montagem_id) return 'nenhuma';
    return linha.montagem_id + '|' + ((linha.montagem && linha.montagem.atualizado_em) || '');
  }
```

No objeto desse `return` final, logo depois de `return {`, acrescentar:

```js
    PRE_CARGA_MS, LIMIAR_PRE_CARGA_MS, ESPERA_MAX_MS, ESMAECER_MS,
    duracaoMs, proximoIndice, atrasoPreCarga, assinaturaQuadro, planoDeAtualizacao, assinaturaDaTv,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 27 testes.

- [ ] **Step 5: Commit**

```bash
git add painel/logica.js modulos/painel/testes/rotacao.test.mjs
git commit -m "Montagens de Painel: lógica da rotação e da atualização da TV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Conferência de site (`api/conferir-site.js`)

**Files:**
- Create: `api/conferir-site.js`
- Test: `modulos/painel/testes/conferir-site.test.mjs`

**Interfaces:**
- Consumes: função `tem_categoria(p_categoria)` do banco (supabase/0002), como a `api/gnss.js`.
- Produces: `GET /api/conferir-site?url=<endereço>` com cabeçalho `X-Coa-Token` → JSON `{ resultado: 'abre'|'bloqueado'|'incerto'|'invalido'|'sem-acesso', motivo }` (200 para abre/bloqueado/incerto, 400 inválido, 401/403 sem acesso, 503 Supabase fora). Exporta também, para testes e para o servidor local: `criarHandler(deps)`, `conferirEndereco(texto, deps) → Promise<{ resultado, motivo }>`, `lerEnderecoExterno(texto) → URL | null`, `ipInterno(ip) → boolean`, `decidirEmbutir(cabecalhos, host?) → 'abre'|'bloqueado'`, `SUPABASE_URL`. `deps = { fetch, agora: () => ms, resolver: (host) => Promise<string[]> }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `modulos/painel/testes/conferir-site.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: FAIL com `Cannot find module '../../../api/conferir-site.js'` (os 27 anteriores passam).

- [ ] **Step 3: Escrever `api/conferir-site.js`**

```js
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 38 testes.

- [ ] **Step 5: Conferir com os sites de verdade (rede da máquina, sem login)**

Run (na raiz do worktree):

```bash
node -e "const C=require('./api/conferir-site.js');const dns=require('node:dns');const d={fetch,agora:Date.now,resolver:h=>dns.promises.lookup(h,{all:true,verbatim:true}).then(l=>l.map(x=>x.address))};(async()=>{for(const u of ['https://operationscenter.deere.com/','https://portal.zeusagro.com/','https://www.windy.com/','https://zoom.earth/','https://www.rainviewer.com/map.html','https://embed.windy.com/embed2.html'])console.log(u,(await C.conferirEndereco(u,d)).resultado)})()"
```

Expected: Deere, ZEUS, windy.com e zoom.earth → `bloqueado`; RainViewer e embed.windy.com → `abre` (é a tabela da seção 2 da especificação). Se algum vier `incerto`, anotar o motivo no relatório da tarefa (o site pode ter recusado a conferência); não mudar a regra por isso.

- [ ] **Step 6: Commit**

```bash
git add api/conferir-site.js modulos/painel/testes/conferir-site.test.mjs
git commit -m "Montagens de Painel: função que confere se um site abre dentro do painel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Banco — script `supabase/0025_painel.sql`

**Files:**
- Create: `supabase/0025_painel.sql` (LF)

**Interfaces:**
- Consumes: `tem_categoria(text)` (0002), `tem_alguma_categoria(text[])` (0020), regra `mapas_fazendas_categoria` (0020).
- Produces: categoria `painel` aceita em `usuario_categorias`; tabela `painel_montagens(id uuid, nome text, divisao text, quadros jsonb, criado_por uuid, criado_em, atualizado_em)`; tabela `painel_tv(id smallint = 1, montagem_id uuid null, atualizado_em, atualizado_por)` com a linha 1 criada; `mapas_fazendas` legível também com a categoria `painel`.

Conferido no banco em 15/10/2026 (consulta só de leitura no SQL Editor): o `CHECK` de `usuario_categorias` é exatamente a lista do 0015; a regra `mapas_fazendas_categoria` é restritiva, de leitura, com `{mapas,acompanhamento,chuva,previsao,sat,validacao}`; não existe tabela `painel_*`; tabela nova não ganha permissão sozinha (o 0024 dá `grant` explícito).

- [ ] **Step 1: Escrever o script**

```sql
-- COA WEB — Montagens de Painel (TV do COA): as montagens com nome e a montagem que está na TV
-- (especificação: modulos/painel/docs/2026-10-15-montagens-de-painel-design.md).
-- Rodar UMA vez no SQL Editor do Supabase, DEPOIS do 0024 (pode rodar de novo sem estragar nada).
-- Depende de: 0002 (tem_categoria), 0020 (tem_alguma_categoria e a regra mapas_fazendas_categoria).
--
-- Muda duas coisas que já existem e cria duas tabelas:
--   1. a lista de categorias aceitas ganha 'painel' (Usuários → Categorias → "Montagens de Painel");
--   2. a regra restritiva de leitura de mapas_fazendas aceita também 'painel' (os atalhos do módulo listam as
--      fazendas que o usuário enxerga);
--   3. painel_montagens (uma linha por montagem) e painel_tv (uma linha só: a montagem que está na TV).
-- Quem lê e grava: logado com a categoria 'painel' (o ADMINISTRADOR+ tem todas). Ninguém sem login.
--
-- ANTES de rodar, confira que as duas listas abaixo são as de agora (o script reescreve as duas inteiras):
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'usuario_categorias_categoria_check';
--   select qual from pg_policies where tablename = 'mapas_fazendas' and policyname = 'mapas_fazendas_categoria';
-- (em 15/10/2026: a lista do 0015 e {mapas,acompanhamento,chuva,previsao,sat,validacao}). Se o CHECK novo não
-- couber nas linhas que já existem, o comando falha e NADA é gravado (está tudo num begin/commit).
--
-- Como desfazer:
--   drop table if exists public.painel_tv;
--   drop table if exists public.painel_montagens;
--   drop function if exists public.painel_tocar();
--   drop function if exists public.painel_tv_tocar();
--   e recriar o CHECK e a regra mapas_fazendas_categoria sem 'painel' (listas do 0015 e do 0020).

begin;

set local lock_timeout = '5s';

-- 1. categoria nova
alter table public.usuario_categorias drop constraint if exists usuario_categorias_categoria_check;
alter table public.usuario_categorias add constraint usuario_categorias_categoria_check
  check (categoria in ('algodao', 'mecanizadas', 'mapas', 'acompanhamento', 'sat', 'previsao', 'validacao', 'controle', 'chuva', 'painel'));

-- 2. os atalhos do módulo leem as fazendas
drop policy if exists mapas_fazendas_categoria on public.mapas_fazendas;
create policy mapas_fazendas_categoria on public.mapas_fazendas as restrictive for select to authenticated
  using ((select public.tem_alguma_categoria(array['mapas', 'acompanhamento', 'chuva', 'previsao', 'sat', 'validacao', 'painel']::text[])));

-- 3. tabelas
create or replace function public.painel_tocar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create or replace function public.painel_tv_tocar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

-- uma linha por montagem; os 4 quadros (sites, tempos, recarga) vão num JSON que a tela confere ao ler e ao gravar
-- (painel/logica.js → normalizarMontagem). Aqui só o essencial: um array de 4.
create table if not exists public.painel_montagens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(btrim(nome)) between 1 and 60),
  divisao       text not null default '4' check (divisao in ('4', '3a', '3b', '3c', '2a', '2b', '1')),
  quadros       jsonb not null check (jsonb_typeof(quadros) = 'array' and jsonb_array_length(quadros) = 4),
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists painel_montagens_nome_idx on public.painel_montagens (lower(btrim(nome)));
drop trigger if exists painel_montagens_tocar on public.painel_montagens;
create trigger painel_montagens_tocar before update on public.painel_montagens
  for each row execute function public.painel_tocar();

-- a montagem que está na TV (null = nenhuma); a que está na TV não pode ser apagada (on delete restrict)
create table if not exists public.painel_tv (
  id             smallint primary key default 1 check (id = 1),
  montagem_id    uuid references public.painel_montagens (id) on delete restrict,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
insert into public.painel_tv (id) values (1) on conflict (id) do nothing;
drop trigger if exists painel_tv_tocar on public.painel_tv;
create trigger painel_tv_tocar before update on public.painel_tv
  for each row execute function public.painel_tv_tocar();

alter table public.painel_montagens enable row level security;
alter table public.painel_tv enable row level security;
revoke all on table public.painel_montagens, public.painel_tv from anon, authenticated;
grant select, insert, update, delete on table public.painel_montagens to authenticated;
grant select, update on table public.painel_tv to authenticated;
grant select, insert, update, delete on table public.painel_montagens, public.painel_tv to service_role;

drop policy if exists painel_montagens_ler on public.painel_montagens;
create policy painel_montagens_ler on public.painel_montagens for select to authenticated
  using ((select public.tem_categoria('painel')));
drop policy if exists painel_montagens_criar on public.painel_montagens;
create policy painel_montagens_criar on public.painel_montagens for insert to authenticated
  with check ((select public.tem_categoria('painel')));
drop policy if exists painel_montagens_alterar on public.painel_montagens;
create policy painel_montagens_alterar on public.painel_montagens for update to authenticated
  using ((select public.tem_categoria('painel'))) with check ((select public.tem_categoria('painel')));
drop policy if exists painel_montagens_apagar on public.painel_montagens;
create policy painel_montagens_apagar on public.painel_montagens for delete to authenticated
  using ((select public.tem_categoria('painel')));

drop policy if exists painel_tv_ler on public.painel_tv;
create policy painel_tv_ler on public.painel_tv for select to authenticated
  using ((select public.tem_categoria('painel')));
drop policy if exists painel_tv_alterar on public.painel_tv;
create policy painel_tv_alterar on public.painel_tv for update to authenticated
  using ((select public.tem_categoria('painel'))) with check ((select public.tem_categoria('painel')));

commit;

-- Conferência depois de rodar (só leitura):
--   select tablename, policyname, cmd, permissive from pg_policies where tablename in ('painel_montagens', 'painel_tv', 'mapas_fazendas') order by 1, 2;
--   select * from public.painel_tv;   -- uma linha: id 1, montagem_id null
```

- [ ] **Step 2: Revisar o script contra a especificação (seção 8) e o padrão do 0015/0020/0024**

Conferir à mão: lista do CHECK = lista do 0015 + `'painel'`; lista da regra de `mapas_fazendas` = a do 0020 + `'painel'`; `begin`/`commit` em volta de tudo; `create ... if not exists` e `drop ... if exists` (pode rodar de novo); nenhum `grant` para `anon`; `painel_tv` sem `insert`/`delete` para `authenticated`. Conferir o fim de linha: `git ls-files --eol supabase/0025_painel.sql` depois do `git add` (esperado `i/lf`).

O script **não** é aplicado agora: só na Tarefa 11, com autorização do usuário.

- [ ] **Step 3: Commit**

```bash
git add supabase/0025_painel.sql
git commit -m "Banco: script 0025 das Montagens de Painel (categoria painel, montagens e montagem da TV)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cabeçalhos — `frame-src https:` só em `/painel/`

**Files:**
- Create: `modulos/painel/scripts/vercel-cabecalhos.mjs`
- Modify: `vercel.json` (CRLF: só com a ferramenta Edit)
- Test: `modulos/painel/testes/vercel.test.mjs`

**Interfaces:**
- Consumes: `vercel.json` da raiz.
- Produces: `lerVercel() → objeto`, `regrasDoCaminho(caminho, vercel?) → regras`, `cabecalhosDoCaminho(caminho, vercel?) → { nome-em-minúsculas: valor }` (usados pelo servidor local na Tarefa 6).

- [ ] **Step 1: Escrever o leitor de regras e os testes**

Criar `modulos/painel/scripts/vercel-cabecalhos.mjs`:

```js
// Cabeçalhos que a Vercel manda para um caminho, lidos do vercel.json da raiz. Usado pelo teste das regras
// (modulos/painel/testes/vercel.test.mjs) e pelo servidor local do painel (a TV local recebe o mesmo CSP).
// Só entende o que o vercel.json usa: texto fixo, "(.*)", alternativas "(a|b)", grupo opcional "(/.*)?" e
// "(?!...)". Esses padrões do path-to-regexp da Vercel valem igual como expressão regular.
import { readFileSync } from 'node:fs';

const VERCEL = new URL('../../../vercel.json', import.meta.url);

export function lerVercel() {
  return JSON.parse(readFileSync(VERCEL, 'utf8'));
}

/** Regras de "headers" do vercel.json que valem para o caminho (ex.: "/painel/index.html"). */
export function regrasDoCaminho(caminho, vercel = lerVercel()) {
  return vercel.headers.filter((r) => new RegExp('^' + r.source + '$').test(caminho));
}

/** Cabeçalhos do caminho, juntando as regras na ordem (no mesmo nome, vale a última). Nomes em minúsculas. */
export function cabecalhosDoCaminho(caminho, vercel = lerVercel()) {
  const saida = {};
  for (const r of regrasDoCaminho(caminho, vercel)) for (const h of r.headers) saida[h.key.toLowerCase()] = h.value;
  return saida;
}
```

Criar `modulos/painel/testes/vercel.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: FAIL em "no painel: uma regra de CSP só…" (frame-src ainda é o do Windy) e "fora do painel…" passa.

- [ ] **Step 3: Editar o `vercel.json` (ferramenta Edit)**

3a. Trocar a regra geral para não valer no painel. Edit com `old_string` = `"source": "/(.*)",` e `new_string` = `"source": "/((?!painel(?:/|$)).*)",` (o texto aparece uma vez só: a regra das imagens é `"/(.*)\\.(png|…"`).

3b. Acrescentar a regra do painel logo depois da geral. Edit com `old_string` = `"source": "/(mapas|sat)/assets/(.*)",` e `new_string`:

```
"source": "/painel(/.*)?",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://server.arcgisonline.com https://pkaxbitsqxjxjlwnhjhd.supabase.co; connect-src 'self' data: blob: https://pkaxbitsqxjxjlwnhjhd.supabase.co wss://pkaxbitsqxjxjlwnhjhd.supabase.co https://server.arcgisonline.com; frame-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), payment=(), usb=(), geolocation=(self), fullscreen=(self \"https://embed.windy.com\"), screen-wake-lock=(self)" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    },
    {
      "source": "/(mapas|sat)/assets/(.*)",
```

(O `old_string` está na linha depois de `    {`; o texto novo fecha a regra do painel e abre de novo a das imagens.) Comparar o valor do CSP novo com o da regra geral, letra por letra, menos o `frame-src`: o teste da Step 4 faz isso também.

3c. Conferir: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` (sem erro); `git diff --stat vercel.json` (só umas 15 linhas, não o arquivo inteiro).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 43 testes.

- [ ] **Step 5: Commit**

```bash
git add vercel.json modulos/painel/scripts/vercel-cabecalhos.mjs modulos/painel/testes/vercel.test.mjs
git commit -m "Montagens de Painel: só a página do painel pode abrir sites externos nos quadros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Acesso a dados e servidor local

**Files:**
- Create: `painel/config.js`, `painel/fonte.js`, `modulos/painel/scripts/servidor-local.mjs`
- Modify: `CLAUDE GERAL/.claude/launch.json` (fora do repositório: configuração do preview)
- Test: `modulos/painel/testes/servidor.test.mjs`

**Interfaces:**
- Consumes: `PainelLogica` (`normalizarMontagem`, `nomeRepetido`, `novoId`, `assinaturaDaTv`), `conferirEndereco` (Tarefa 3), `cabecalhosDoCaminho`/`lerVercel` (Tarefa 5).
- Produces:
  - `window.PAINEL_CONFIG = { modo: 'supabase'|'local', supabaseUrl, supabaseAnonKey }`;
  - `window.PainelFonte.criar() → fonte` com `pronto()`, `listar() → { montagens: linha[], tvId }`, `criar(dados) → linha`, `salvar(id, dados) → linha`, `apagar(id)`, `porNaTv(id|null)`, `daTv() → { montagem_id, montagem: linha|null }`, `marcaDaTv() → texto`, `fazendas() → linhas de mapas_fazendas`, `conferirSite(url) → { resultado, motivo }`. Erros com `.codigo`: `sem-login`, `sem-categoria`, `nome-repetido`, `na-tv`, `banco`. `linha = { id, nome, divisao, quadros, atualizado_em }`; `dados = { nome, divisao, quadros }`;
  - servidor local `criarServidor() → http.Server` (exportado) com: `GET /api/painel/estado`, `GET|PUT /api/painel/tv`, `GET /api/painel/fazendas`, `POST /api/painel/montagens`, `PUT|DELETE /api/painel/montagens/:id`, `GET /api/conferir-site?url=`, `GET /teste/quadro?nome=&cor=`, `/painel/config.js` local, e os arquivos do repositório com os cabeçalhos do `vercel.json`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `modulos/painel/testes/servidor.test.mjs`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: FAIL com `Cannot find module '.../modulos/painel/scripts/servidor-local.mjs'`.

- [ ] **Step 3: Escrever `painel/config.js`**

```js
// Configuração do módulo no COA WEB: mesmo projeto Supabase e mesma chave anon (pública) do COA WEB.
// O servidor local de testes (modulos/painel/scripts/servidor-local.mjs) troca este arquivo por { modo: 'local' }.
window.PAINEL_CONFIG = {
  modo: 'supabase',
  supabaseUrl: 'https://pkaxbitsqxjxjlwnhjhd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrYXhiaXRzcXhqeGpsd25oamhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTM2MzQsImV4cCI6MjEwMDgyOTYzNH0.XAxLopSqYef5vfW5sY6Pbv-EOoFdqwSeJpXwnqi9m8Q',
};
```

- [ ] **Step 4: Escrever `painel/fonte.js`**

```js
/* Montagens de Painel — de onde vêm e para onde vão os dados: o Supabase do COA WEB ou o servidor local de
   testes (modulos/painel/scripts/servidor-local.mjs, que troca config.js por { modo: 'local' }). O editor e a TV
   só falam com o objeto de PainelFonte.criar():
     pronto()                         confere login e categoria
     listar()                         { montagens: [linha], tvId }
     criar(dados) / salvar(id, dados) linha   (dados = { nome, divisao, quadros })
     apagar(id) / porNaTv(id | null)
     daTv()                           { montagem_id, montagem: linha | null }
     marcaDaTv()                      texto que muda quando a TV precisa reler a montagem
     fazendas()                       linhas de mapas_fazendas (id, nome, unidade_pims)
     conferirSite(url)                { resultado, motivo } (api/conferir-site.js)
   linha = { id, nome, divisao, quadros, atualizado_em }. Os erros têm .codigo: 'sem-login', 'sem-categoria',
   'nome-repetido', 'na-tv' ou 'banco'. */
(function () {
  'use strict';
  const CFG = window.PAINEL_CONFIG || {};
  const L = window.PainelLogica;
  const EMBED = new URLSearchParams(location.search).get('embed') === '1';
  const COLUNAS = 'id,nome,divisao,quadros,atualizado_em';

  function erro(mensagem, codigo) {
    const e = new Error(mensagem);
    e.codigo = codigo;
    return e;
  }

  function fonteSupabase() {
    // dentro da casca (embed) quem renova a sessão é o COA WEB; na TV (aba própria, dias ligada), a própria página
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { autoRefreshToken: !EMBED, persistSession: true } });
    function dados(r) {
      if (!r.error) return r.data;
      if (r.error.code === '23505') throw erro('Já existe uma montagem com esse nome.', 'nome-repetido');
      if (r.error.code === '23503') throw erro('Ponha outra montagem na TV antes de apagar esta.', 'na-tv');
      if (r.error.code === 'PGRST301' || r.status === 401) throw erro('Sua sessão expirou. Entre de novo no COA WEB.', 'sem-login');
      throw erro(r.error.message || 'Não foi possível falar com o banco.', 'banco');
    }
    return {
      pronto: async function () {
        const s = await sb.auth.getSession();
        if (!s.data || !s.data.session) throw erro('Entre no COA WEB neste computador.', 'sem-login');
        const r = await sb.rpc('tem_categoria', { p_categoria: 'painel' });
        if (r.error) throw erro('Não foi possível conferir o acesso.', 'banco');
        if (r.data !== true) throw erro('Este login não tem acesso a Montagens de Painel.', 'sem-categoria');
      },
      listar: async function () {
        const r = await Promise.all([
          sb.from('painel_montagens').select(COLUNAS).order('nome'),
          sb.from('painel_tv').select('montagem_id').eq('id', 1).maybeSingle(),
        ]);
        const tv = dados(r[1]);
        return { montagens: dados(r[0]) || [], tvId: tv ? tv.montagem_id : null };
      },
      criar: async function (d) { return dados(await sb.from('painel_montagens').insert(d).select(COLUNAS).single()); },
      salvar: async function (id, d) { return dados(await sb.from('painel_montagens').update(d).eq('id', id).select(COLUNAS).single()); },
      apagar: async function (id) { dados(await sb.from('painel_montagens').delete().eq('id', id)); },
      porNaTv: async function (id) { dados(await sb.from('painel_tv').update({ montagem_id: id }).eq('id', 1)); },
      daTv: async function () {
        const r = dados(await sb.from('painel_tv').select('montagem_id,montagem:painel_montagens(' + COLUNAS + ')').eq('id', 1).maybeSingle());
        return { montagem_id: r ? r.montagem_id : null, montagem: r && r.montagem ? r.montagem : null };
      },
      marcaDaTv: async function () {
        return L.assinaturaDaTv(dados(await sb.from('painel_tv').select('montagem_id,montagem:painel_montagens(atualizado_em)').eq('id', 1).maybeSingle()));
      },
      fazendas: async function () {
        return dados(await sb.from('mapas_fazendas').select('id,nome,unidade_pims').order('nome')) || [];
      },
      conferirSite: async function (url) {
        const s = await sb.auth.getSession();
        const token = s.data && s.data.session ? s.data.session.access_token : '';
        const r = await fetch('/api/conferir-site?url=' + encodeURIComponent(url), { headers: { 'X-Coa-Token': token }, cache: 'no-store' });
        let corpo = null;
        try { corpo = await r.json(); } catch (e) { /* não veio JSON */ }
        return corpo && corpo.resultado ? corpo : { resultado: 'incerto', motivo: 'Não foi possível conferir agora (' + r.status + ').' };
      },
    };
  }

  /* servidor local de testes: as mesmas respostas, sem login */
  function fonteLocal() {
    async function api(metodo, caminho, corpo) {
      const r = await fetch(caminho, {
        method: metodo,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        cache: 'no-store',
      });
      const t = await r.text();
      let d = null;
      try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
      if (d && d.codigo) throw erro(d.motivo, d.codigo);
      if (!r.ok && !(d && d.resultado)) throw erro((d && d.motivo) || 'O servidor local respondeu ' + r.status + '.', 'banco');
      return d;
    }
    return {
      pronto: async function () {},
      listar: function () { return api('GET', '/api/painel/estado'); },
      criar: function (d) { return api('POST', '/api/painel/montagens', d); },
      salvar: function (id, d) { return api('PUT', '/api/painel/montagens/' + encodeURIComponent(id), d); },
      apagar: function (id) { return api('DELETE', '/api/painel/montagens/' + encodeURIComponent(id)); },
      porNaTv: function (id) { return api('PUT', '/api/painel/tv', { montagem_id: id }); },
      daTv: function () { return api('GET', '/api/painel/tv'); },
      marcaDaTv: async function () { return L.assinaturaDaTv(await api('GET', '/api/painel/tv')); },
      fazendas: function () { return api('GET', '/api/painel/fazendas'); },
      conferirSite: function (url) { return api('GET', '/api/conferir-site?url=' + encodeURIComponent(url)); },
    };
  }

  window.PainelFonte = {
    criar: function () { return CFG.modo === 'local' ? fonteLocal() : fonteSupabase(); },
  };
})();
```

- [ ] **Step 5: Escrever `modulos/painel/scripts/servidor-local.mjs`**

```js
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
```

Observação: o caminho `/painel/` (com barra) chega aqui como `/painel/index.html` para ler o arquivo, mas os cabeçalhos são aplicados com o caminho já completado; as duas formas casam com a regra `/painel(/.*)?`.

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 53 testes.

- [ ] **Step 7: Configuração do preview**

Acrescentar em `C:/Users/bruno.moraes/Documents/CLAUDE GERAL/.claude/launch.json`, na lista `configurations` (ferramenta Edit, depois da entrada `coa-web-previsao-local`):

```json
        {
            "name": "coa-web-painel-local",
            "runtimeExecutable": "node",
            "runtimeArgs": [
                "C:/Users/bruno.moraes/Documents/CLAUDE GERAL/coa-web-painel/modulos/painel/scripts/servidor-local.mjs"
            ],
            "port": 8792
        },
```

Conferir que o arquivo continua sendo JSON válido: `node -e "JSON.parse(require('fs').readFileSync('C:/Users/bruno.moraes/Documents/CLAUDE GERAL/.claude/launch.json','utf8'))"`. Esse arquivo fica fora do repositório (não entra no commit). Se o `preview_start` desta sessão não achar a configuração (ele lê o `.claude/launch.json` da pasta da sessão), criar `.claude/launch.json` na raiz do worktree com a mesma entrada e acrescentar a linha `.claude/` em `.git/info/exclude` (nunca no `.gitignore`).

- [ ] **Step 8: Commit**

```bash
git add painel/config.js painel/fonte.js modulos/painel/scripts/servidor-local.mjs modulos/painel/testes/servidor.test.mjs
git commit -m "Montagens de Painel: acesso a dados (Supabase ou local) e servidor local com montagens fictícias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Editor — montagens, divisão, prévia e sites do quadro

**Files:**
- Create: `painel/index.html`, `painel/estilo.css`, `painel/editor.js`

**Interfaces:**
- Consumes: `window.PainelLogica` (Tarefas 1 e 2), `window.PainelFonte.criar()` (Tarefa 6).
- Produces: o editor em `painel/index.html` (sem `?tv=1`); elementos que a Tarefa 8 usa: `#painel-quadro` com `#quadro-conteudo`, a função `desenharQuadro(m)` terminando no bloco `if (n === 1) { … }`, e o ouvinte de clique da prévia; o contêiner vazio `<div class="tv" id="tv" hidden></div>` que a Tarefa 9 preenche.

Testes desta tarefa: não há teste automático de tela no repositório (o padrão dos módulos). A conferência é no navegador, com o servidor local (Step 5), e os testes da lógica continuam passando.

- [ ] **Step 1: Escrever `painel/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Montagens de Painel · COA</title>
<link rel="icon" href="../mapas/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="../assets/coa-loader.css?v=202610062300">
<link rel="stylesheet" href="estilo.css?v=202610151200">
<script src="config.js?v=202610151200"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js" integrity="sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R" crossorigin="anonymous"></script>
<script src="logica.js?v=202610151200"></script>
<script src="fonte.js?v=202610151200"></script>
</head>
<body>

<!-- ============================ EDITOR (no COA WEB: ?embed=1) ============================ -->
<div class="editor" id="editor" hidden>
  <header class="barra">
    <div class="marca">
      <span class="marca-titulo">Montagens de Painel</span>
      <span class="marca-sub">O que a TV do COA mostra, quadro por quadro</span>
    </div>
    <div class="situacao" id="situacao" role="status" aria-live="polite"><span id="situacao-texto"></span><button type="button" class="botao leve pequeno" id="btn-tentar" hidden>Tentar de novo</button></div>
    <div class="barra-acoes">
      <button type="button" class="botao" id="btn-nova"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nova montagem</button>
      <button type="button" class="botao cheio" id="btn-tv" title="Abre a TV numa aba nova: é o endereço para deixar aberto na TV do COA"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8 20.5h8"/></svg>Abrir na TV</button>
    </div>
  </header>

  <div class="corpo">
    <aside class="cartao lista" id="lista" aria-label="Montagens" hidden>
      <span class="rotulo">Montagens</span>
      <ul class="montagens" id="montagens"></ul>
    </aside>

    <section class="area" id="area" hidden>
      <div class="cartao cabeca">
        <div class="cabeca-nome">
          <label class="rotulo" for="nome-montagem">Nome da montagem</label>
          <input type="text" class="nome-montagem" id="nome-montagem" maxlength="60" autocomplete="off" spellcheck="false">
          <span class="aviso-nome" id="aviso-nome" hidden></span>
        </div>
        <div class="cabeca-acoes">
          <span class="selo-tv grande" id="selo-tv" hidden>Na TV hoje</span>
          <button type="button" class="botao" id="btn-por-tv">Pôr na TV</button>
          <button type="button" class="botao leve" id="btn-duplicar">Duplicar</button>
          <button type="button" class="botao leve perigo" id="btn-apagar">Apagar</button>
        </div>
      </div>

      <div class="cartao divisoes">
        <span class="rotulo">Divisão da tela</span>
        <div class="grupo-divisoes" id="divisoes" role="group" aria-label="Divisão da tela"></div>
      </div>

      <div class="cartao previa-cartao">
        <div class="previa">
          <div class="previa-topo" aria-hidden="true"><img src="../acompanhamento/assets/logo_coa_branco.png" alt=""><span class="previa-nome" id="previa-nome"></span><span class="previa-hora" id="previa-hora"></span></div>
          <div class="previa-grade" id="previa-grade"></div>
        </div>
        <p class="guardados" id="guardados" hidden></p>
      </div>

      <div class="cartao quadro-painel" id="painel-quadro">
        <div id="quadro-conteudo"></div>
      </div>
    </section>

    <section class="cartao comecar" id="comecar" hidden>
      <div class="comecar-desenho" aria-hidden="true"><i></i><i></i><i></i></div>
      <h2>Monte a primeira tela da TV</h2>
      <p>Uma montagem diz como a tela da TV se divide e quais sites passam em cada quadro, cada um com o seu tempo.</p>
      <button type="button" class="botao cheio" id="btn-comecar">Criar montagem</button>
    </section>
  </div>
</div>

<dialog class="dialogo" id="dlg-apagar" aria-labelledby="dlg-apagar-titulo">
  <h2 id="dlg-apagar-titulo">Apagar a montagem?</h2>
  <p><b id="dlg-apagar-nome"></b> sai da lista, com os sites de todos os quadros. Não dá para desfazer.</p>
  <div class="dialogo-acoes">
    <button type="button" class="botao" id="btn-apagar-nao">Cancelar</button>
    <button type="button" class="botao perigo-cheio" id="btn-apagar-sim">Apagar</button>
  </div>
</dialog>

<!-- ============================ TV (?tv=1) ============================ -->
<div class="tv" id="tv" hidden></div>

<div class="coa-loader claro pequeno carregando" id="carregando" role="status" aria-live="polite"><div class="coa-loader-caixa"><div class="coa-loader-logo"><i class="coa-loader-brilho-fundo"></i><i class="coa-loader-parte risco"></i><i class="coa-loader-parte c"></i><i class="coa-loader-parte o"></i><i class="coa-loader-parte a"></i><i class="coa-loader-brilho"></i></div><p class="coa-loader-texto"><span id="carregando-texto">Abrindo as montagens</span><i>.</i><i>.</i><i>.</i></p></div></div>
<script src="editor.js?v=202610151200"></script>
</body>
</html>
```

- [ ] **Step 2: Escrever `painel/estilo.css`**

```css
/* =====================================================================
   Montagens de Painel — editor (dentro do COA WEB). A TV tem o próprio tv.css.
   A mesma linguagem do COA WEB: IBM Plex Sans, fundo liso, cartões brancos de borda fina; o dourado marca só
   o que está escolhido ou na TV.
===================================================================== */
:root {
  --verde-escuro: #103632;
  --verde-teal: #0C5A50;
  --verde-medio: #2F7D6B;
  --dourado: #DB8A08;
  --dourado-claro: #F0B24A;
  --fundo: #EEF2EE;
  --cartao: #FFFFFF;
  --linha: #DCE3DC;
  --linha-suave: #EBF0EB;
  --campo: #CBD5CE;
  --texto: #17251F;
  --texto-suave: #5B6B62;
  --texto-fraco: #8A988F;
  --bom: #1E7B4F;
  --atencao: #B7791F;
  --ruim: #B3261E;
  --raio: 8px;
  --raio-p: 6px;
  --sombra: 0 1px 2px rgba(16, 54, 50, .06);
  --fonte: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--fundo); color: var(--texto); font: 14px/1.45 var(--fonte); -webkit-font-smoothing: antialiased; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--dourado); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

/* o "carregando" é o do COA WEB (../assets/coa-loader.css); aqui só o que é deste módulo */
.carregando { z-index: 100; padding: 0 24px; }
.carregando.fora { display: none; }

/* ---------- barra do módulo ---------- */
.barra { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 16px; min-height: 64px; padding: 10px 24px; background: var(--cartao); border-bottom: 1px solid var(--linha); }
.marca { display: flex; flex-direction: column; min-width: 0; }
.marca-titulo { font-size: 17px; font-weight: 600; line-height: 1.25; color: var(--verde-escuro); }
.marca-sub { font-size: 12.5px; color: var(--texto-suave); }
.situacao { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; font-size: 12.5px; color: var(--texto-fraco); text-align: right; }
.situacao.erro { color: var(--ruim); }
.barra-acoes { display: flex; gap: 8px; flex: none; }

/* ---------- botões ---------- */
.botao { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 14px; border: 1px solid var(--campo); border-radius: var(--raio-p); background: var(--cartao); font-weight: 500; white-space: nowrap; transition: background .15s, border-color .15s; }
.botao:hover { background: #F4F7F4; border-color: #B9C7BE; }
.botao svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.botao.cheio { background: var(--verde-escuro); border-color: var(--verde-escuro); color: #fff; }
.botao.cheio:hover { background: #0A2724; }
.botao.leve { border-color: transparent; background: transparent; color: var(--verde-teal); }
.botao.leve:hover { background: #E7EFEA; }
.botao.perigo { color: var(--ruim); }
.botao.perigo:hover { background: #FBEDEC; }
.botao.perigo-cheio { background: var(--ruim); border-color: var(--ruim); color: #fff; }
.botao.perigo-cheio:hover { background: #962019; }
.botao.pequeno { height: 28px; padding: 0 10px; font-size: 12.5px; }
.botao:disabled { opacity: .5; cursor: default; }

/* ---------- corpo ---------- */
.corpo { display: grid; grid-template-columns: 272px minmax(0, 1fr); gap: 20px; align-items: start; max-width: 1480px; margin: 0 auto; padding: 20px 24px 40px; }
.cartao { background: var(--cartao); border: 1px solid var(--linha); border-radius: var(--raio); box-shadow: var(--sombra); }
.rotulo { display: block; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--texto-fraco); }

/* lista de montagens */
.lista { position: sticky; top: 84px; padding: 14px 0 4px; }
.lista > .rotulo { padding: 0 16px 10px; }
.montagens { list-style: none; margin: 0; padding: 0; }
.item { position: relative; border-top: 1px solid var(--linha-suave); }
.item-abrir { display: block; width: 100%; padding: 12px 92px 12px 19px; border: 0; background: none; text-align: left; transition: background .15s; }
.item-abrir:hover { background: #F6F9F6; }
.item.sel .item-abrir { background: #FDF6EA; box-shadow: inset 3px 0 0 var(--dourado); }
.item-nome { display: block; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.item-resumo { display: block; margin-top: 1px; font-size: 12.5px; color: var(--texto-suave); }
.selo-tv { display: inline-flex; align-items: center; gap: 7px; margin-top: 7px; font-size: 12px; font-weight: 600; color: #8A5A04; }
.selo-tv::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--dourado); box-shadow: 0 0 0 3px rgba(219, 138, 8, .18); }
.item-por { position: absolute; top: 11px; right: 10px; height: 26px; padding: 0 10px; border: 1px solid var(--linha); border-radius: 13px; background: var(--cartao); font-size: 12px; font-weight: 600; color: var(--verde-teal); opacity: 0; transition: opacity .15s, border-color .15s; }
.item:hover .item-por, .item.sel .item-por, .item-por:focus-visible { opacity: 1; }
.item-por:hover { border-color: var(--verde-teal); }

/* montagem aberta */
.area { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.cabeca { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; padding: 14px 18px; }
.cabeca-nome { flex: 1 1 320px; min-width: 0; }
.nome-montagem { display: block; width: calc(100% + 8px); margin: 4px 0 0 -8px; padding: 2px 8px; border: 1px solid transparent; border-radius: var(--raio-p); background: transparent; font-size: 24px; font-weight: 600; letter-spacing: -.01em; color: var(--verde-escuro); }
.nome-montagem:hover { border-color: var(--linha); }
.nome-montagem:focus { outline: none; border-color: var(--campo); background: #fff; box-shadow: 0 0 0 3px rgba(219, 138, 8, .18); }
.aviso-nome { display: block; margin-top: 4px; font-size: 12.5px; color: var(--ruim); }
.cabeca-acoes { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.selo-tv.grande { height: 36px; margin: 0 6px 0 0; padding: 0 14px; border-radius: 18px; background: #FDF3E1; font-size: 13px; }

/* divisões */
.divisoes { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 14px 18px; }
.grupo-divisoes { display: flex; gap: 8px; flex-wrap: wrap; }
.divisao-btn { display: flex; flex-direction: column; align-items: center; gap: 7px; width: 104px; padding: 9px 6px 7px; border: 1px solid var(--linha); border-radius: var(--raio); background: var(--cartao); font-size: 11.5px; line-height: 1.25; color: var(--texto-suave); text-align: center; transition: border-color .15s, background .15s; }
.divisao-btn:hover { border-color: #B9C7BE; }
.divisao-btn[aria-pressed="true"] { border-color: var(--dourado); box-shadow: 0 0 0 1px var(--dourado); background: #FFFBF3; color: var(--texto); font-weight: 500; }
.mini { display: grid; gap: 2px; width: 58px; aspect-ratio: 16 / 9; padding: 3px; border-radius: 3px; background: var(--verde-escuro); }
.mini i { border-radius: 1px; background: #4E7A72; }
.divisao-btn[aria-pressed="true"] .mini i { background: var(--dourado-claro); }

/* prévia: a TV em miniatura, clicável */
.previa-cartao { padding: 18px; }
.previa { display: flex; flex-direction: column; gap: 1%; width: 100%; max-width: 1040px; aspect-ratio: 16 / 9; margin: 0 auto; padding: 1.1%; border-radius: 10px; background: var(--verde-escuro); }
.previa-topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 7%; min-height: 0; padding: 0 .8% 0 .4%; border-bottom: 2px solid var(--dourado); font-size: clamp(10px, 1.05vw, 14px); color: #9FC2B9; }
.previa-topo img { height: 62%; width: auto; }
.previa-nome { display: flex; align-items: center; gap: 7px; overflow: hidden; font-weight: 500; color: #EAF2EF; white-space: nowrap; }
.previa-nome::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dourado-claro); }
.previa-hora { font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
.previa-grade { flex: 1; display: grid; gap: 1%; min-height: 0; }
.previa-quadro { position: relative; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; min-width: 0; min-height: 0; padding: 10px 12px; overflow: hidden; border: 1.5px solid transparent; border-radius: 5px; background: #24514B; color: #EAF2EF; text-align: left; transition: background .15s, border-color .15s; }
.previa-quadro:hover { background: #2C5F58; }
.previa-quadro[aria-pressed="true"] { border-color: var(--dourado-claro); background: #2F6A62; }
.previa-quadro.vazio { border-style: dashed; border-color: #4E7A72; background: transparent; }
.previa-quadro.vazio[aria-pressed="true"] { border-color: var(--dourado-claro); }
.previa-numero { position: absolute; top: 9px; left: 12px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #9FC2B9; }
.previa-titulo { overflow: hidden; font-size: clamp(12px, 1.1vw, 15px); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.previa-detalhe { font-size: 12px; color: var(--dourado-claro); }
.previa-quadro.vazio .previa-detalhe { color: #9FC2B9; }
.guardados { margin: 12px 0 0; font-size: 12.5px; color: var(--texto-suave); text-align: center; }

/* quadro aberto */
.quadro-topo { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--linha-suave); }
.quadro-titulo { margin: 0; font-size: 16px; font-weight: 600; color: var(--verde-escuro); }
.quadro-modo { margin-left: 10px; font-size: 12.5px; font-weight: 500; color: var(--texto-suave); }
.quadro-padrao { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--texto-suave); }
.campo-tempo { height: 32px; padding: 0 30px 0 10px; border: 1px solid var(--campo); border-radius: var(--raio-p); background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%235B6B62' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 9px center / 12px; font-size: 13px; font-variant-numeric: tabular-nums; appearance: none; -webkit-appearance: none; }
.campo-tempo:focus { outline: none; border-color: var(--verde-teal); box-shadow: 0 0 0 3px rgba(12, 90, 80, .12); }
.sites { list-style: none; margin: 0; padding: 6px 0; }
.site { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto 32px; align-items: center; gap: 10px; padding: 8px 18px 8px 10px; transition: background .15s; }
.site + .site { border-top: 1px solid var(--linha-suave); }
.site:hover { background: #F8FAF8; }
.site.arrastando { opacity: .45; }
.site.alvo { box-shadow: inset 0 2px 0 var(--dourado); }
.site-alca { grid-column: 1; display: grid; place-items: center; width: 28px; height: 32px; border: 0; border-radius: 4px; background: none; color: var(--texto-fraco); cursor: grab; }
.site-alca:hover { background: #EDF2EE; color: var(--texto-suave); }
.site-alca svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; }
.site-info { grid-column: 2; min-width: 0; }
.site-nome { display: block; width: calc(100% + 6px); margin-left: -6px; padding: 3px 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; font-weight: 600; }
.site-nome:hover { border-color: var(--linha); }
.site-nome:focus { outline: none; border-color: var(--campo); background: #fff; }
.site-origem { display: block; overflow: hidden; font-size: 12px; color: var(--texto-fraco); text-overflow: ellipsis; white-space: nowrap; }
.site .campo-tempo { grid-column: 3; }
.selo { grid-column: 4; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 12px; font-size: 12px; font-weight: 500; white-space: nowrap; }
.selo::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.selo.ok { background: #E6F2EC; color: var(--bom); }
.selo.incerto { background: #FBF1DF; color: #8A5A04; }
.site-remover { grid-column: 5; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: var(--raio-p); background: none; color: var(--texto-fraco); }
.site-remover:hover { background: #FBEDEC; color: var(--ruim); }
.site-remover svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.quadro-vazio { margin: 0; padding: 22px 18px; color: var(--texto-suave); }
.linha-fixo { display: flex; align-items: center; gap: 10px; padding: 4px 18px 14px 48px; font-size: 13px; color: var(--texto-suave); }

/* nenhuma montagem ainda */
.comecar { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 24px; text-align: center; }
.comecar h2 { margin: 10px 0 0; font-size: 20px; font-weight: 600; color: var(--verde-escuro); }
.comecar p { max-width: 48ch; margin: 0 0 8px; color: var(--texto-suave); }
.comecar-desenho { display: grid; grid-template: 1fr 1fr / 2fr 1fr; gap: 4px; width: 168px; aspect-ratio: 16 / 9; padding: 6px; border-radius: 8px; background: var(--verde-escuro); }
.comecar-desenho i { border-radius: 2px; background: #2F6A62; }
.comecar-desenho i:first-child { grid-row: 1 / 3; background: var(--dourado-claro); }

/* diálogos */
.dialogo { width: min(440px, calc(100vw - 32px)); padding: 22px 24px 20px; border: 0; border-radius: 10px; box-shadow: 0 12px 40px rgba(16, 54, 50, .25); color: var(--texto); }
.dialogo::backdrop { background: rgba(16, 54, 50, .45); }
.dialogo h2 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: var(--verde-escuro); }
.dialogo p { margin: 0; color: var(--texto-suave); }
.dialogo-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

@media (max-width: 1100px) { .corpo { grid-template-columns: 236px minmax(0, 1fr); } }
@media (max-width: 900px) {
  .barra { flex-wrap: wrap; padding: 10px 14px; }
  .situacao { order: 3; width: 100%; margin: 0; justify-content: flex-start; text-align: left; }
  .corpo { grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 14px 14px 32px; }
  .lista { position: static; }
  .item-por { opacity: 1; }
  .divisao-btn { width: 88px; }
  .site { grid-template-columns: 28px minmax(0, 1fr) auto 32px; }
  .site .selo { grid-column: 3; }
  .site-remover { grid-column: 4; }
  .site .campo-tempo { grid-column: 2 / 4; grid-row: 2; justify-self: start; }
  .linha-fixo { padding-left: 18px; }
}
@media (max-width: 520px) {
  .barra-acoes { width: 100%; }
  .barra-acoes .botao { flex: 1; }
  .nome-montagem { font-size: 20px; }
}
```

- [ ] **Step 3: Escrever `painel/editor.js`**

```js
/* =====================================================================
   Montagens de Painel — editor (no COA WEB: painel/index.html?embed=1)
   Lista as montagens, cria, duplica, apaga, põe uma na TV e edita o nome, a divisão e os sites de cada quadro
   (ordem, tempo, recarga). Salva sozinho 800 ms depois da última mudança. A TV (tv.js, ?tv=1) lê do banco a
   montagem que está na TV e confere a cada minuto se ela mudou.
===================================================================== */
(function () {
  'use strict';
  const PARAMS = new URLSearchParams(location.search);
  if (PARAMS.get('tv') === '1') return; // a página da TV é o tv.js

  const L = window.PainelLogica;
  const fonte = window.PainelFonte.criar();
  const ESPERA_SALVAR_MS = 800;
  const $ = (id) => document.getElementById(id);
  // ícones fixos (nunca dado do banco)
  const ICONE_ALCA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
  const ICONE_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const OPCOES_TEMPO = L.TEMPOS.map((s) => [s, L.rotuloTempo(s)]);
  const OPCOES_RECARGA = L.RECARGAS.map((s) => [s, L.rotuloTempo(s)]);

  const estado = { montagens: [], tvId: null, sel: null, quadro: 0 };
  const salvar = { timer: null, ocupado: false, denovo: false, pendentes: new Set() };
  let arrasto = null; // índice do site sendo arrastado no quadro aberto

  const atual = () => estado.montagens.find((m) => m.id === estado.sel) || null;
  const nomeDe = (id) => { const m = estado.montagens.find((x) => x.id === id); return m ? m.nome.trim() : ''; };

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function botao(classe, texto, titulo) {
    const b = el('button', classe, texto);
    b.type = 'button';
    if (titulo) b.title = titulo;
    return b;
  }
  function seletor(opcoes, valor, rotulo) {
    const s = el('select', 'campo-tempo');
    s.setAttribute('aria-label', rotulo);
    opcoes.forEach(([v, t]) => { const o = el('option', '', t); o.value = String(v); o.selected = v === valor; s.appendChild(o); });
    return s;
  }

  /* ------------------------------ situação (canto da barra) ------------------------------ */
  function situacao(texto, erro, tentar) {
    $('situacao-texto').textContent = texto;
    $('situacao').classList.toggle('erro', !!erro);
    $('btn-tentar').hidden = !tentar;
  }

  /* ------------------------------ lista ------------------------------ */
  function desenharLista() {
    const ul = $('montagens');
    ul.textContent = '';
    L.ordenarMontagens(estado.montagens, estado.tvId).forEach((m) => {
      const li = el('li', 'item' + (m.id === estado.sel ? ' sel' : ''));
      const abrir = botao('item-abrir');
      abrir.setAttribute('aria-current', m.id === estado.sel ? 'true' : 'false');
      abrir.appendChild(el('span', 'item-nome', m.nome.trim() || 'Sem nome'));
      abrir.appendChild(el('span', 'item-resumo', L.resumoMontagem(m)));
      if (m.id === estado.tvId) abrir.appendChild(el('span', 'selo-tv', 'Na TV hoje'));
      abrir.addEventListener('click', () => selecionar(m.id));
      li.appendChild(abrir);
      if (m.id !== estado.tvId) {
        const por = botao('item-por', 'Pôr na TV', 'Mostrar esta montagem na TV do COA');
        por.addEventListener('click', () => porNaTv(m.id));
        li.appendChild(por);
      }
      ul.appendChild(li);
    });
  }

  /* ------------------------------ montagem aberta ------------------------------ */
  function desenharMontagem() {
    const m = atual();
    $('comecar').hidden = !!m;
    $('lista').hidden = !m;
    $('area').hidden = !m;
    if (!m) return;
    if (document.activeElement !== $('nome-montagem')) $('nome-montagem').value = m.nome;
    const naTv = m.id === estado.tvId;
    $('selo-tv').hidden = !naTv;
    $('btn-por-tv').hidden = naTv;
    $('btn-apagar').title = naTv ? 'Ponha outra montagem na TV antes de apagar esta' : 'Apagar esta montagem';
    desenharDivisoes(m);
    desenharPrevia(m);
    desenharQuadro(m);
  }

  function miniatura(d) {
    const g = el('span', 'mini');
    g.setAttribute('aria-hidden', 'true');
    g.style.gridTemplateColumns = d.colunas;
    g.style.gridTemplateRows = d.linhas;
    d.areas.forEach((a) => { const i = el('i'); i.style.gridArea = a; g.appendChild(i); });
    return g;
  }

  function desenharDivisoes(m) {
    const caixa = $('divisoes');
    caixa.textContent = '';
    L.DIVISOES.forEach((d) => {
      const b = botao('divisao-btn');
      b.setAttribute('aria-pressed', String(d.codigo === m.divisao));
      b.appendChild(miniatura(d));
      b.appendChild(el('span', '', d.nome));
      b.addEventListener('click', () => {
        if (m.divisao === d.codigo) return;
        m.divisao = d.codigo;
        if (estado.quadro >= d.areas.length) estado.quadro = 0;
        mudouTudo(m);
      });
      caixa.appendChild(b);
    });
  }

  function desenharPrevia(m) {
    const d = L.divisao(m.divisao);
    $('previa-nome').textContent = m.nome.trim() || 'Sem nome';
    $('previa-hora').textContent = L.horaMinuto(new Date());
    const g = $('previa-grade');
    g.textContent = '';
    g.style.gridTemplateColumns = d.colunas;
    g.style.gridTemplateRows = d.linhas;
    d.areas.forEach((area, i) => {
      const q = m.quadros[i];
      const t = L.textoDoQuadro(q);
      const b = botao('previa-quadro' + (q.sites.length ? '' : ' vazio'));
      b.style.gridArea = area;
      b.setAttribute('aria-pressed', String(i === estado.quadro));
      b.setAttribute('aria-label', 'Quadro ' + (i + 1) + ': ' + t.titulo + ', ' + t.detalhe);
      b.appendChild(el('span', 'previa-numero', 'Quadro ' + (i + 1)));
      b.appendChild(el('span', 'previa-titulo', t.titulo));
      b.appendChild(el('span', 'previa-detalhe', t.detalhe));
      b.addEventListener('click', () => { estado.quadro = i; desenharPrevia(m); desenharQuadro(m); });
      g.appendChild(b);
    });
    const guardados = L.textoGuardados(m);
    $('guardados').hidden = !guardados;
    $('guardados').textContent = guardados;
  }

  /* ------------------------------ quadro aberto ------------------------------ */
  function desenharQuadro(m) {
    const q = m.quadros[estado.quadro];
    const n = q.sites.length;
    const conteudo = $('quadro-conteudo');
    conteudo.textContent = '';
    const topo = el('div', 'quadro-topo');
    const titulo = el('h2', 'quadro-titulo', 'Quadro ' + (estado.quadro + 1));
    titulo.appendChild(el('span', 'quadro-modo', n === 0 ? 'vazio' : n === 1 ? 'site fixo' : 'rotação · ' + n + ' sites'));
    topo.appendChild(titulo);
    const padrao = el('label', 'quadro-padrao');
    padrao.appendChild(el('span', '', 'Tempo padrão do quadro'));
    const selPadrao = seletor(OPCOES_TEMPO, q.padrao, 'Tempo padrão do quadro');
    selPadrao.title = 'Tempo que cada site novo recebe neste quadro';
    selPadrao.addEventListener('change', () => { q.padrao = Number(selPadrao.value); agendarSalvar(m.id); });
    padrao.appendChild(selPadrao);
    topo.appendChild(padrao);
    conteudo.appendChild(topo);
    if (!n) {
      conteudo.appendChild(el('p', 'quadro-vazio', 'Este quadro está vazio. Adicione uma página do COA WEB ou o endereço de um site.'));
    } else {
      const ul = el('ul', 'sites');
      q.sites.forEach((s, i) => ul.appendChild(linhaDoSite(m, q, s, i)));
      conteudo.appendChild(ul);
    }
    if (n === 1) {
      const fixo = el('label', 'linha-fixo');
      fixo.appendChild(el('span', '', 'Site fixo · recarregar a cada'));
      const selR = seletor(OPCOES_RECARGA, q.recarregar, 'Recarregar o site fixo a cada');
      selR.addEventListener('change', () => { q.recarregar = Number(selR.value); mudouPrevia(m); });
      fixo.appendChild(selR);
      conteudo.appendChild(fixo);
    }
  }

  function linhaDoSite(m, q, s, i) {
    const li = el('li', 'site');
    const alca = botao('site-alca', undefined, 'Arraste para mudar a ordem (ou use as setas ↑ ↓)');
    alca.innerHTML = ICONE_ALCA;
    alca.draggable = true;
    alca.setAttribute('aria-label', 'Mudar a ordem de ' + s.nome);
    alca.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); mover(m, q, i, i - 1, true); }
      else if (e.key === 'ArrowDown' && i < q.sites.length - 1) { e.preventDefault(); mover(m, q, i, i + 1, true); }
    });
    alca.addEventListener('dragstart', (e) => {
      arrasto = i;
      li.classList.add('arrastando');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.setDragImage(li, 24, 20);
    });
    alca.addEventListener('dragend', () => { arrasto = null; li.classList.remove('arrastando'); });
    li.addEventListener('dragover', (e) => { if (arrasto === null) return; e.preventDefault(); li.classList.add('alvo'); });
    li.addEventListener('dragleave', () => li.classList.remove('alvo'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('alvo');
      if (arrasto !== null && arrasto !== i) mover(m, q, arrasto, i, false);
      arrasto = null;
    });
    li.appendChild(alca);

    const info = el('div', 'site-info');
    const nome = el('input', 'site-nome');
    nome.type = 'text';
    nome.value = s.nome;
    nome.maxLength = 80;
    nome.setAttribute('aria-label', 'Nome do site no quadro');
    nome.addEventListener('input', () => { s.nome = nome.value; mudouPrevia(m); });
    nome.addEventListener('blur', () => {
      if (s.nome.trim()) return;
      s.nome = s.origem === 'coa' ? 'COA WEB' : L.nomeDoHost(s.url);
      nome.value = s.nome;
      mudouPrevia(m);
    });
    info.appendChild(nome);
    info.appendChild(el('span', 'site-origem', s.origem === 'coa' ? 'COA WEB · ' + s.url.split(/[/?#]/)[0] : L.nomeDoHost(s.url)));
    li.appendChild(info);

    if (q.sites.length > 1) {
      const tempo = seletor(OPCOES_TEMPO, s.segundos, 'Tempo de ' + s.nome + ' na rotação');
      tempo.addEventListener('change', () => { s.segundos = Number(tempo.value); mudouPrevia(m); });
      li.appendChild(tempo);
    }
    const selo = el('span', 'selo ' + (s.conferencia === 'abre' ? 'ok' : 'incerto'), s.conferencia === 'abre' ? 'Abre no painel' : 'Não conferido');
    if (s.conferencia !== 'abre') selo.title = 'Confira na TV se ele aparece';
    li.appendChild(selo);
    const remover = botao('site-remover', undefined, 'Tirar do quadro');
    remover.innerHTML = ICONE_X;
    remover.setAttribute('aria-label', 'Tirar ' + s.nome + ' do quadro');
    remover.addEventListener('click', () => { q.sites.splice(i, 1); mudouTudo(m); });
    li.appendChild(remover);
    return li;
  }

  function mover(m, q, de, para, focar) {
    const [s] = q.sites.splice(de, 1);
    q.sites.splice(para, 0, s);
    mudouTudo(m);
    if (focar) {
      const alca = document.querySelectorAll('#quadro-conteudo .site-alca')[para];
      if (alca) alca.focus();
    }
  }

  /* ------------------------------ mudanças e salvamento ------------------------------ */
  function mudouTudo(m) { desenharLista(); desenharMontagem(); agendarSalvar(m.id); }
  function mudouPrevia(m) { desenharLista(); desenharPrevia(m); agendarSalvar(m.id); }

  function agendarSalvar(id) {
    salvar.pendentes.add(id);
    clearTimeout(salvar.timer);
    situacao('Salvando…');
    salvar.timer = setTimeout(gravar, ESPERA_SALVAR_MS);
  }

  async function gravar() {
    clearTimeout(salvar.timer);
    if (salvar.ocupado) { salvar.denovo = true; return; }
    salvar.ocupado = true;
    let erro = null;
    let erroDeNome = false;
    let tocouTv = false;
    for (const id of Array.from(salvar.pendentes)) {
      const m = estado.montagens.find((x) => x.id === id);
      salvar.pendentes.delete(id);
      if (!m) continue;
      if (!m.nome.trim()) { salvar.pendentes.add(id); erro = 'Dê um nome à montagem para salvar.'; erroDeNome = true; continue; }
      if (L.nomeRepetido(m.nome, estado.montagens, m.id)) { salvar.pendentes.add(id); erro = 'Já existe uma montagem com esse nome.'; erroDeNome = true; continue; }
      try {
        const linha = await fonte.salvar(id, L.paraGravar(m));
        if (linha && linha.atualizado_em) m.atualizadoEm = linha.atualizado_em;
        if (id === estado.tvId) tocouTv = true;
      } catch (e) {
        salvar.pendentes.add(id);
        erroDeNome = e.codigo === 'nome-repetido';
        erro = erroDeNome ? e.message : 'Não salvou: ' + (e.message || 'sem conexão');
      }
    }
    salvar.ocupado = false;
    $('aviso-nome').hidden = !erroDeNome;
    $('aviso-nome').textContent = erroDeNome ? erro : '';
    if (erro) situacao(erro, true, !erroDeNome);
    else if (!salvar.pendentes.size) situacao(tocouTv ? 'Salvo · a TV atualiza em até 1 min' : 'Salvo');
    if (salvar.denovo) { salvar.denovo = false; gravar(); }
  }

  /* ------------------------------ ações ------------------------------ */
  function selecionar(id) {
    if (id === estado.sel) return;
    estado.sel = id;
    estado.quadro = 0;
    $('aviso-nome').hidden = true;
    desenharLista();
    desenharMontagem();
  }

  async function criar(base) {
    const dados = base
      ? { nome: L.nomeDaCopia(base.nome.trim() || 'Sem nome', estado.montagens), divisao: base.divisao, quadros: L.paraGravar(base).quadros }
      : L.paraGravar(L.normalizarMontagem({ nome: L.nomeLivre('Nova montagem', estado.montagens), divisao: '4' }));
    situacao(base ? 'Duplicando…' : 'Criando…');
    try {
      const m = L.normalizarMontagem(await fonte.criar(dados));
      estado.montagens.push(m);
      estado.sel = m.id;
      estado.quadro = 0;
      if (!estado.tvId) await porNaTv(m.id, true);
      desenharLista();
      desenharMontagem();
      situacao(base ? 'Cópia criada' : estado.tvId === m.id ? 'Montagem criada e posta na TV' : 'Montagem criada');
      if (!base) { $('nome-montagem').focus(); $('nome-montagem').select(); }
    } catch (e) {
      situacao(e.message || 'Não foi possível criar a montagem.', true);
    }
  }

  async function porNaTv(id, quieto) {
    try {
      if (salvar.pendentes.has(id)) await gravar(); // a TV pega a versão salva
      await fonte.porNaTv(id);
      estado.tvId = id;
      desenharLista();
      desenharMontagem();
      if (!quieto) situacao('"' + nomeDe(id) + '" vai para a TV em até 1 min');
    } catch (e) {
      situacao('Não foi possível pôr na TV: ' + (e.message || 'sem conexão'), true);
    }
  }

  function pedirApagar() {
    const m = atual();
    if (!m) return;
    if (m.id === estado.tvId) { situacao('Ponha outra montagem na TV antes de apagar esta.', true); return; }
    $('dlg-apagar-nome').textContent = m.nome.trim() || 'Sem nome';
    $('dlg-apagar').showModal();
  }

  async function apagar() {
    const m = atual();
    $('dlg-apagar').close();
    if (!m) return;
    try {
      await fonte.apagar(m.id);
      salvar.pendentes.delete(m.id);
      estado.montagens = estado.montagens.filter((x) => x.id !== m.id);
      const proxima = L.ordenarMontagens(estado.montagens, estado.tvId)[0];
      estado.sel = proxima ? proxima.id : null;
      estado.quadro = 0;
      desenharLista();
      desenharMontagem();
      situacao('Montagem apagada');
    } catch (e) {
      situacao(e.message || 'Não foi possível apagar.', true);
    }
  }

  /* ------------------------------ eventos ------------------------------ */
  $('nome-montagem').addEventListener('input', (e) => {
    const m = atual();
    if (!m) return;
    m.nome = e.target.value.slice(0, 60);
    $('aviso-nome').hidden = true;
    mudouPrevia(m);
  });
  $('btn-nova').addEventListener('click', () => criar(null));
  $('btn-comecar').addEventListener('click', () => criar(null));
  $('btn-duplicar').addEventListener('click', () => { const m = atual(); if (m) criar(m); });
  $('btn-apagar').addEventListener('click', pedirApagar);
  $('btn-apagar-sim').addEventListener('click', apagar);
  $('btn-apagar-nao').addEventListener('click', () => $('dlg-apagar').close());
  $('btn-por-tv').addEventListener('click', () => { const m = atual(); if (m) porNaTv(m.id); });
  $('btn-tv').addEventListener('click', () => window.open('index.html?tv=1', '_blank', 'noopener'));
  $('btn-tentar').addEventListener('click', gravar);
  setInterval(() => { if (atual()) $('previa-hora').textContent = L.horaMinuto(new Date()); }, 30000);
  // saiu da aba ou do módulo com mudança na fila: grava na hora
  document.addEventListener('visibilitychange', () => { if (document.hidden && salvar.pendentes.size) gravar(); });
  window.addEventListener('pagehide', () => { if (salvar.pendentes.size) gravar(); });

  /* ------------------------------ início ------------------------------ */
  (async function iniciar() {
    $('editor').hidden = false;
    try {
      await fonte.pronto();
      const r = await fonte.listar();
      estado.montagens = (r.montagens || []).map(L.normalizarMontagem);
      estado.tvId = r.tvId || null;
      const primeira = L.ordenarMontagens(estado.montagens, estado.tvId)[0];
      estado.sel = primeira ? primeira.id : null;
    } catch (e) {
      $('carregando').classList.add('erro');
      $('carregando-texto').textContent = e && e.message ? e.message : 'Não foi possível abrir as montagens.';
      return;
    }
    $('carregando').classList.add('fora');
    desenharLista();
    desenharMontagem();
  })();
})();
```

- [ ] **Step 4: Rodar a suíte**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 53 testes (nada mudou na lógica).

- [ ] **Step 5: Conferir no navegador (servidor local, dados fictícios)**

1. `preview_start` com `name: "coa-web-painel-local"`; navegar para `http://localhost:8792/painel/`; `resize_window` 1440 × 900.
2. `read_console_messages` com `onlyErrors: true`: nenhum erro (nem de CSP).
3. Lista: 3 montagens, "Plantio (teste)" em primeiro com "Na TV hoje"; o editor abre nela, com o Quadro 1 (2 sites, com tempo cada) aberto embaixo da prévia.
4. Clicar na divisão "2 · lado a lado": a prévia fica com 2 quadros e aparece "Guardados fora da tela: Quadro 3 (3 sites), Quadro 4 (1 site)". Esperar 1 s: canto da barra "Salvo · a TV atualiza em até 1 min". Conferir no servidor: `javascript_tool` → `(await (await fetch('/api/painel/estado')).json()).montagens.find(m => m.id === 'teste-plantio').divisao` = `"2a"`. Voltar para "4 · grade 2×2": o aviso some e o Quadro 3 volta com "Mapa de Chuva 24 h".
5. Trocar o nome para `colheita (TESTE)`: aparece "Já existe uma montagem com esse nome." embaixo do nome e no canto; voltar para `Plantio (teste)`: "Salvo".
6. Quadro 1: focar a alça do primeiro site e apertar a seta para baixo: a ordem troca (a prévia mostra o outro site primeiro). Trocar o tempo de um site para "2 min": a prévia mostra "2 min · +1 em rotação" quando ele é o primeiro.
7. Quadro 4: "site fixo" com "recarregar a cada 5 min".
8. "Nova montagem": entra "Nova montagem", selecionada, com o nome selecionado para digitar; "Duplicar" → "Nova montagem (cópia)"; "Apagar" na cópia → diálogo → "Apagar" → some da lista. "Apagar" em "Plantio (teste)" → aviso "Ponha outra montagem na TV antes de apagar esta."
9. "Pôr na TV" em "Chuva e radar (teste)" (na lista ou na cabeça): o selo "Na TV hoje" passa para ela e ela vai para o topo da lista.
10. `resize_window` 390 × 844: tudo empilhado, sem rolagem de lado (`document.documentElement.scrollWidth <= innerWidth`). Voltar com `preset: "desktop"`.
11. `computer` → `screenshot` do editor em 1440 de largura (guardar para mostrar ao usuário na Tarefa 11).

Reiniciar o servidor local (`preview_stop` + `preview_start`) volta as montagens fictícias ao começo.

- [ ] **Step 6: Commit**

```bash
git add painel/index.html painel/estilo.css painel/editor.js
git commit -m "Montagens de Painel: editor (montagens, divisão, prévia e sites de cada quadro)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Editor — adicionar sites (endereço conferido e atalhos do COA WEB)

**Files:**
- Modify: `painel/index.html` (formulário e diálogo; `?v=` de `editor.js` e `estilo.css`), `painel/estilo.css` (fim do arquivo), `painel/editor.js`

**Interfaces:**
- Consumes: `fonte.conferirSite(url)`, `fonte.fazendas()` (Tarefa 6); `L.lerEndereco`, `L.normalizarSite`, `L.fazendasDoCadastro`, `L.atalhoAcompanhamento`, `L.atalhoPrevisao`, `L.CAMADAS_PREVISAO`, `L.TEMPOS_INTERNOS`, `L.MAX_SITES`, `L.nomeDoHost` (Tarefa 1); `desenharQuadro`, `mudouTudo`, `situacao`, `el`, `botao`, `atual`, `estado`, `selecionar` (Tarefa 7).
- Produces: `acoesDoQuadro(m, q)`, `mostrarFormEndereco(abrir)`, `abrirAtalho(m, q)`.

- [ ] **Step 1: Marcação (`painel/index.html`)**

1a. Edit: `old_string` = `        <div id="quadro-conteudo"></div>` e `new_string`:

```html
        <div id="quadro-conteudo"></div>
        <form class="form-endereco" id="form-endereco" hidden novalidate>
          <div class="form-linha">
            <label class="campo"><span>Endereço do site</span><input type="text" id="end-url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://www.rainviewer.com/map.html"></label>
            <label class="campo"><span>Nome no quadro</span><input type="text" id="end-nome" maxlength="80" autocomplete="off" placeholder="Nome do site"></label>
          </div>
          <div class="form-acoes">
            <button type="submit" class="botao cheio" id="end-adicionar">Adicionar</button>
            <button type="button" class="botao leve" id="end-cancelar">Cancelar</button>
            <p class="end-resultado" id="end-resultado" role="status" aria-live="polite"></p>
          </div>
        </form>
```

1b. Edit: `old_string` = `<!-- ============================ TV (?tv=1) ============================ -->` e `new_string`:

```html
<dialog class="dialogo dialogo-largo" id="dlg-atalho" aria-labelledby="dlg-atalho-titulo">
  <form id="form-atalho">
    <h2 id="dlg-atalho-titulo">Adicionar do COA WEB</h2>
    <p class="dialogo-sub">Páginas do COA WEB com Modo TV próprio. Abrem com o login do computador da TV.</p>
    <fieldset class="escolha-modulo">
      <legend class="rotulo">Página</legend>
      <label class="opcao"><input type="radio" name="modulo" value="acompanhamento" checked><span><b>Acompanhamento</b><small>Plantio e colheita, girando pelas fazendas</small></span></label>
      <label class="opcao"><input type="radio" name="modulo" value="previsao"><span><b>Previsão do Tempo</b><small>Mapa do Windy com os limites das fazendas</small></span></label>
    </fieldset>
    <div class="atalho-linha">
      <label class="campo" id="campo-camada"><span>Camada</span><select id="atalho-camada"></select></label>
      <label class="campo"><span>Troca entre fazendas</span><select id="atalho-tempo"></select></label>
    </div>
    <fieldset>
      <legend class="rotulo">Fazendas</legend>
      <label class="opcao-linha"><input type="checkbox" id="atalho-todas" checked> Todas as fazendas</label>
      <div class="fazendas-lista" id="atalho-fazendas"></div>
      <p class="atalho-aviso" id="atalho-aviso" hidden></p>
    </fieldset>
    <p class="atalho-previa">Entra no quadro como <b id="atalho-nome"></b></p>
    <div class="dialogo-acoes">
      <button type="button" class="botao" id="atalho-cancelar">Cancelar</button>
      <button type="submit" class="botao cheio">Adicionar ao quadro</button>
    </div>
  </form>
</dialog>

<!-- ============================ TV (?tv=1) ============================ -->
```

1c. Trocar o `?v=` de `estilo.css` e `editor.js` em `painel/index.html` para `202610151300`.

- [ ] **Step 2: Estilos (fim de `painel/estilo.css`)**

```css
/* ---------- adicionar sites ---------- */
.quadro-acoes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 18px 16px; border-top: 1px solid var(--linha-suave); }
.quadro-limite { font-size: 12.5px; color: var(--texto-fraco); }
.form-endereco { padding: 14px 18px 16px; border-top: 1px solid var(--linha-suave); border-radius: 0 0 var(--raio) var(--raio); background: #FAFCFA; }
.form-linha { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 12px; }
.campo { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; font-weight: 500; color: var(--texto-suave); }
.campo input, .campo select { height: 36px; padding: 0 10px; border: 1px solid var(--campo); border-radius: var(--raio-p); background: #fff; font-size: 14px; font-weight: 400; color: var(--texto); }
.campo input:focus, .campo select:focus { outline: none; border-color: var(--verde-teal); box-shadow: 0 0 0 3px rgba(12, 90, 80, .12); }
.form-acoes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.end-resultado { flex: 1 1 260px; margin: 0 0 0 6px; font-size: 13px; color: var(--texto-suave); }
.end-resultado.erro { color: var(--ruim); }

/* diálogo dos atalhos do COA WEB */
.dialogo-largo { width: min(560px, calc(100vw - 32px)); }
.dialogo .dialogo-sub { margin: 0 0 16px; font-size: 13px; }
.dialogo fieldset { min-width: 0; margin: 0 0 16px; padding: 0; border: 0; }
.dialogo legend { margin-bottom: 8px; padding: 0; }
.escolha-modulo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.escolha-modulo legend { grid-column: 1 / -1; }
.opcao { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border: 1px solid var(--linha); border-radius: var(--raio); cursor: pointer; transition: border-color .15s, background .15s; }
.opcao:has(input:checked) { border-color: var(--dourado); box-shadow: 0 0 0 1px var(--dourado); background: #FFFBF3; }
.opcao input { margin-top: 3px; accent-color: var(--verde-escuro); }
.opcao b { display: block; font-weight: 600; }
.opcao small { display: block; font-size: 12px; color: var(--texto-suave); }
.atalho-linha { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.opcao-linha { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.opcao-linha input { accent-color: var(--verde-escuro); }
.fazendas-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 12px; max-height: 180px; margin-top: 6px; padding: 8px 10px; overflow: auto; border: 1px solid var(--linha-suave); border-radius: var(--raio-p); }
.fazendas-lista:empty { display: none; }
.fazendas-lista .opcao-linha:has(input:disabled) { color: var(--texto-fraco); }
.dialogo .atalho-aviso { margin: 8px 0 0; font-size: 12.5px; color: #8A5A04; }
.dialogo .atalho-previa { margin: 0; padding: 10px 12px; border-radius: var(--raio-p); background: #F3F6F3; font-size: 13px; }
.atalho-previa b { color: var(--verde-escuro); }
@media (max-width: 900px) { .form-linha, .atalho-linha, .escolha-modulo { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Código (`painel/editor.js`)**

3a. No fim de `desenharQuadro`, Edit com `old_string`:

```js
      fixo.appendChild(selR);
      conteudo.appendChild(fixo);
    }
  }
```

e `new_string`:

```js
      fixo.appendChild(selR);
      conteudo.appendChild(fixo);
    }
    conteudo.appendChild(acoesDoQuadro(m, q));
  }
```

3b. Fechar o formulário ao trocar de quadro ou de montagem.

Em `desenharPrevia`, Edit com `old_string` = `      b.addEventListener('click', () => { estado.quadro = i; desenharPrevia(m); desenharQuadro(m); });` e `new_string` = `      b.addEventListener('click', () => { estado.quadro = i; mostrarFormEndereco(false); desenharPrevia(m); desenharQuadro(m); });`.

Em `selecionar`, Edit com `old_string` (duas linhas; só existem juntas dentro de `selecionar`):

```js
    $('aviso-nome').hidden = true;
    desenharLista();
```

e `new_string`:

```js
    $('aviso-nome').hidden = true;
    mostrarFormEndereco(false);
    desenharLista();
```

3c. Logo antes do bloco `/* ------------------------------ eventos ------------------------------ */`, acrescentar:

```js
  /* ------------------------------ adicionar sites ------------------------------ */
  const ICONE_COA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M12 4v13M2.5 10.5H12M8 20.5h8"/></svg>';
  const ICONE_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  let fazendasDoAtalho = null; // lidas uma vez, na primeira abertura do diálogo
  let alvoDoAtalho = null;     // { m, q } do quadro que abriu o diálogo

  function acoesDoQuadro(m, q) {
    const acoes = el('div', 'quadro-acoes');
    const cheio = q.sites.length >= L.MAX_SITES;
    const bCoa = botao('botao', undefined, 'Acompanhamento ou Previsão do Tempo em Modo TV');
    bCoa.innerHTML = ICONE_COA;
    bCoa.appendChild(document.createTextNode('Do COA WEB'));
    bCoa.disabled = cheio;
    bCoa.addEventListener('click', () => abrirAtalho(m, q));
    const bEnd = botao('botao', undefined, 'Endereço https de um site');
    bEnd.innerHTML = ICONE_LINK;
    bEnd.appendChild(document.createTextNode('Endereço'));
    bEnd.disabled = cheio;
    bEnd.addEventListener('click', () => mostrarFormEndereco(true));
    acoes.append(bCoa, bEnd);
    if (cheio) acoes.appendChild(el('span', 'quadro-limite', 'Limite de ' + L.MAX_SITES + ' sites por quadro.'));
    return acoes;
  }

  function resultadoEndereco(texto, erro) {
    $('end-resultado').textContent = texto;
    $('end-resultado').classList.toggle('erro', !!erro);
  }

  function mostrarFormEndereco(abrir) {
    $('form-endereco').hidden = !abrir;
    resultadoEndereco('', false);
    $('end-adicionar').disabled = false;
    if (abrir) {
      $('end-url').value = '';
      $('end-nome').value = '';
      $('end-nome').placeholder = 'Nome do site';
      $('end-url').focus();
    }
  }

  $('end-url').addEventListener('input', () => {
    const lido = L.lerEndereco($('end-url').value, location.origin);
    $('end-nome').placeholder = lido.ok ? (lido.origem === 'coa' ? 'COA WEB' : L.nomeDoHost(lido.url)) : 'Nome do site';
  });
  $('end-cancelar').addEventListener('click', () => mostrarFormEndereco(false));
  $('form-endereco').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = atual();
    if (!m) return;
    const q = m.quadros[estado.quadro];
    if (q.sites.length >= L.MAX_SITES) { resultadoEndereco('Limite de ' + L.MAX_SITES + ' sites por quadro.', true); return; }
    const lido = L.lerEndereco($('end-url').value, location.origin);
    if (!lido.ok) { resultadoEndereco(lido.motivo, true); return; }
    let conferencia = 'abre';
    if (lido.origem === 'externo') {
      resultadoEndereco('Conferindo se o site abre dentro do painel…', false);
      $('end-adicionar').disabled = true;
      let r;
      try { r = await fonte.conferirSite(lido.url); } catch (err) { r = { resultado: 'incerto', motivo: err.message }; }
      $('end-adicionar').disabled = false;
      if (r.resultado === 'bloqueado') { resultadoEndereco('Este site não deixa ser exibido dentro de outra página, então não aparece na TV. Sites com login, como John Deere e ZEUS, costumam bloquear.', true); return; }
      if (r.resultado === 'invalido' || r.resultado === 'sem-acesso') { resultadoEndereco(r.motivo || 'Endereço não aceito.', true); return; }
      conferencia = r.resultado === 'abre' ? 'abre' : 'incerto';
    }
    // vai para o quadro que estava aberto quando o botão foi clicado, mesmo que a tela tenha mudado na conferência
    q.sites.push(L.normalizarSite({ nome: $('end-nome').value, url: lido.url, segundos: q.padrao, conferencia }));
    mostrarFormEndereco(false);
    if (atual() === m) mudouTudo(m); else agendarSalvar(m.id);
    situacao(conferencia === 'abre' ? 'Site adicionado' : 'Site adicionado sem conferência: confira na TV se ele aparece');
  });

  /* atalhos do COA WEB */
  L.CAMADAS_PREVISAO.forEach(([v, t]) => { const o = el('option', '', t); o.value = v; $('atalho-camada').appendChild(o); });
  L.TEMPOS_INTERNOS.forEach((s) => { const o = el('option', '', s + ' s'); o.value = String(s); o.selected = s === 20; $('atalho-tempo').appendChild(o); });

  function moduloDoAtalho() {
    return document.querySelector('#form-atalho input[name="modulo"]:checked').value;
  }
  function desenharFazendasDoAtalho() {
    const caixa = $('atalho-fazendas');
    caixa.textContent = '';
    const modulo = moduloDoAtalho();
    $('campo-camada').hidden = modulo !== 'previsao';
    (fazendasDoAtalho || []).filter((f) => modulo === 'previsao' || f.unidade).forEach((f) => {
      const l = el('label', 'opcao-linha');
      const c = el('input');
      c.type = 'checkbox';
      c.value = f.id;
      c.disabled = $('atalho-todas').checked;
      l.append(c, document.createTextNode(' ' + f.nome));
      caixa.appendChild(l);
    });
  }
  function escolhaDoAtalho() {
    const ids = $('atalho-todas').checked ? [] : Array.from(document.querySelectorAll('#atalho-fazendas input:checked')).map((c) => c.value);
    const op = { fazendas: (fazendasDoAtalho || []).filter((f) => ids.indexOf(f.id) >= 0), tempo: Number($('atalho-tempo').value), camada: $('atalho-camada').value };
    return moduloDoAtalho() === 'previsao' ? L.atalhoPrevisao(op) : L.atalhoAcompanhamento(op);
  }
  function atualizarAtalho() { $('atalho-nome').textContent = escolhaDoAtalho().nome; }

  async function abrirAtalho(m, q) {
    alvoDoAtalho = { m, q };
    if (!fazendasDoAtalho) {
      try { fazendasDoAtalho = L.fazendasDoCadastro(await fonte.fazendas()); } catch (e) { fazendasDoAtalho = []; }
    }
    $('atalho-aviso').hidden = fazendasDoAtalho.length > 0;
    $('atalho-aviso').textContent = 'Não foi possível ler as fazendas: o atalho entra com todas.';
    desenharFazendasDoAtalho();
    atualizarAtalho();
    $('dlg-atalho').showModal();
  }

  // trocar de página volta para "Todas as fazendas" (a lista muda: o Acompanhamento só tem as fazendas com unidade do PIMS)
  document.querySelectorAll('#form-atalho input[name="modulo"]').forEach((r) => r.addEventListener('change', () => { $('atalho-todas').checked = true; desenharFazendasDoAtalho(); atualizarAtalho(); }));
  $('atalho-todas').addEventListener('change', () => {
    document.querySelectorAll('#atalho-fazendas input').forEach((c) => { c.disabled = $('atalho-todas').checked; if (c.disabled) c.checked = false; });
    atualizarAtalho();
  });
  $('atalho-fazendas').addEventListener('change', atualizarAtalho);
  $('atalho-camada').addEventListener('change', atualizarAtalho);
  $('atalho-tempo').addEventListener('change', atualizarAtalho);
  $('atalho-cancelar').addEventListener('click', () => $('dlg-atalho').close());
  $('form-atalho').addEventListener('submit', (e) => {
    e.preventDefault();
    const alvo = alvoDoAtalho;
    $('dlg-atalho').close();
    if (!alvo || alvo.q.sites.length >= L.MAX_SITES) return;
    alvo.q.sites.push(L.normalizarSite(Object.assign(escolhaDoAtalho(), { segundos: alvo.q.padrao })));
    if (atual() === alvo.m) mudouTudo(alvo.m); else agendarSalvar(alvo.m.id);
    situacao('Página do COA WEB adicionada');
  });
```

- [ ] **Step 4: Rodar a suíte**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 53 testes.

- [ ] **Step 5: Conferir no navegador (servidor local)**

1. Recarregar `http://localhost:8792/painel/` (o `?v=` mudou). `read_console_messages` só erros: nenhum.
2. Abrir o Quadro 2 → "Endereço":
   - `http://exemplo.com` → "Só endereços https abrem no painel." (vermelho), nada entra;
   - `painel/index.html?tv=1` → "O próprio painel não pode entrar num quadro.";
   - `https://operationscenter.deere.com/` → "Conferindo…" e depois a mensagem de bloqueio, nada entra;
   - `rainviewer.com/map.html` (sem https) com o nome vazio → entra "rainviewer.com" com "Abre no painel"; o quadro vira "rotação · 2 sites" e cada site ganha o seletor de tempo;
   - `acompanhamento/index.html?tv=1` → entra na hora (sem conferência), origem "COA WEB · acompanhamento".
3. "Do COA WEB": o diálogo abre com "Acompanhamento" e "Todas as fazendas"; a prévia diz "Acompanhamento · todas as fazendas". Desmarcar "Todas", marcar "Teste Norte": "Acompanhamento · Teste Norte". Trocar para "Previsão do Tempo": a escolha volta para "Todas as fazendas" e aparece "Camada"; escolher "Vento": "Previsão · Vento · todas as fazendas". "Adicionar ao quadro": o site entra com o tempo padrão do quadro. Conferir a URL salva: `(await (await fetch('/api/painel/estado')).json()).montagens.find(m => m.id === 'teste-plantio').quadros[1].sites.map(s => s.url)`.
4. Encher um quadro até 12 sites (repetir "Do COA WEB"): os dois botões ficam desabilitados com "Limite de 12 sites por quadro."
5. Trocar de quadro com o formulário aberto: o formulário fecha.
6. Screenshot do quadro com sites de origens diferentes e do diálogo aberto (para a Tarefa 11).

- [ ] **Step 6: Commit**

```bash
git add painel/index.html painel/estilo.css painel/editor.js
git commit -m "Montagens de Painel: adicionar sites por endereço conferido e atalhos do COA WEB

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: A TV (`?tv=1`)

**Files:**
- Create: `painel/tv.css`, `painel/tv.js`
- Modify: `painel/index.html` (marcação da TV, `<link>` do `tv.css`, `<script>` do `tv.js`)

**Interfaces:**
- Consumes: `L.DIVISOES`/`divisao`, `TOTAL_QUADROS`, `normalizarMontagem`, `enderecoNoNavegador`, `duracaoMs`, `proximoIndice`, `atrasoPreCarga`, `ESPERA_MAX_MS`, `ESMAECER_MS`, `planoDeAtualizacao`, `assinaturaDaTv`, `horaMinuto`, `dataPorExtenso` (Tarefas 1 e 2); `fonte.pronto/daTv/marcaDaTv` (Tarefa 6); `#carregando` e `[hidden]` do `estilo.css` (Tarefa 7).
- Produces: a página da TV. Parâmetro de teste: `?conferir=<segundos ≥ 5>`, só com `modo: 'local'`.

- [ ] **Step 1: Marcação (`painel/index.html`)**

1a. Edit: `old_string` = `<div class="tv" id="tv" hidden></div>` e `new_string`:

```html
<div class="tv" id="tv" hidden>
  <header class="tv-topo">
    <div class="tv-marca"><img src="../acompanhamento/assets/logo_coa_branco.png" alt="COA · Centro de Operações Agrícolas"></div>
    <div class="tv-montagem"><i aria-hidden="true"></i><span id="tv-nome"></span><b class="tv-conexao" id="tv-conexao" hidden></b></div>
    <div class="tv-relogio"><b id="tv-hora">--:--</b><span id="tv-data"></span></div>
  </header>
  <main class="tv-grade" id="tv-grade"></main>
  <section class="tv-aviso" id="tv-aviso" hidden>
    <img src="../acompanhamento/assets/logo_coa_branco.png" alt="">
    <h1 id="tv-aviso-titulo"></h1>
    <p id="tv-aviso-texto"></p>
    <a class="tv-aviso-botao" id="tv-aviso-botao" href="../" hidden>Entrar no COA WEB</a>
  </section>
  <div class="tv-cobertura" id="tv-cobertura" aria-hidden="true"></div>
  <div class="tv-controles" id="tv-controles">
    <span id="tv-mexendo" hidden>Mexendo nos sites · volta sozinho em 2 min</span>
    <button type="button" id="tv-mexer">Mexer nos sites (I)</button>
    <button type="button" id="tv-cheia">Tela cheia (F)</button>
  </div>
</div>
```

1b. Edit: `old_string` = `<link rel="stylesheet" href="estilo.css?v=202610151300">` e `new_string` = a mesma linha + nova linha `<link rel="stylesheet" href="tv.css?v=202610151400">`.

1c. Edit: `old_string` = `<script src="editor.js?v=202610151300"></script>` e `new_string` = a mesma linha + nova linha `<script src="tv.js?v=202610151400"></script>`.

- [ ] **Step 2: Escrever `painel/tv.css`**

```css
/* =====================================================================
   Montagens de Painel — a TV (?tv=1). Uma moldura só, verde-escura, em volta de tudo e entre os quadros:
   faixa no topo (marca, montagem, relógio), uma etiqueta fina em cima de cada quadro (sem cobrir o site) e o
   site embaixo. Medidas em vh/vmin com clamp(): proporcional de 1366×768 a 3840×2160, lida a 3–4 m.
===================================================================== */
html.modo-tv, html.modo-tv body { height: 100%; overflow: hidden; background: var(--verde-escuro); }
.tv { --borda: .8vmin; --vao: .6vmin; --verde-claro: #9FC2B9; --texto-tv: #EAF2EF; position: fixed; inset: 0; display: flex; flex-direction: column; gap: var(--vao); padding: var(--borda); background: var(--verde-escuro); color: var(--texto-tv); font-family: var(--fonte); }

/* faixa do topo */
.tv-topo { flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 2vmin; height: 6.5vh; min-height: 44px; padding: 0 1.2vmin .7vh .4vmin; border-bottom: 2px solid var(--dourado); }
/* a logo branca já traz "Centro de Operações Agrícolas" e a marca da Locks: nada de texto repetido ao lado */
.tv-marca { display: flex; align-items: center; min-width: 0; }
.tv-marca img { height: 4.6vh; min-height: 28px; width: auto; }
.tv-montagem { display: flex; align-items: center; gap: 1.1vmin; font-size: clamp(14px, 2.1vh, 38px); font-weight: 500; color: #fff; white-space: nowrap; }
.tv-montagem > i { width: 1.1vh; height: 1.1vh; min-width: 7px; min-height: 7px; border-radius: 50%; background: var(--dourado-claro); box-shadow: 0 0 0 .45vh rgba(240, 178, 74, .18); }
.tv-montagem:has(#tv-nome:empty) > i { display: none; }
.tv-conexao { margin-left: 1.2vmin; padding: .35vh 1vmin; border: 1px solid rgba(255, 180, 171, .4); border-radius: 4px; background: rgba(179, 38, 30, .22); font-size: clamp(11px, 1.35vh, 22px); font-weight: 500; color: #FFD2CC; }
.tv-relogio { justify-self: end; line-height: 1.05; text-align: right; }
.tv-relogio b { display: block; font-size: clamp(20px, 3.4vh, 60px); font-weight: 600; letter-spacing: -.01em; color: #fff; font-variant-numeric: tabular-nums; }
.tv-relogio span { font-size: clamp(11px, 1.35vh, 22px); color: var(--verde-claro); }

/* quadros */
.tv-grade { flex: 1; display: grid; gap: var(--vao); min-height: 0; }
.tv-quadro { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.tv-etiqueta { position: relative; flex: none; display: flex; align-items: center; justify-content: space-between; gap: 1vmin; height: 2.8vh; min-height: 20px; padding: 0 .4vmin .3vh .3vmin; font-size: clamp(11px, 1.45vh, 24px); font-weight: 500; color: var(--texto-tv); }
.tv-etiqueta::after { content: ""; position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: rgba(159, 194, 185, .16); }
.tv-etiqueta-nome { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-etiqueta-conta { flex: none; font-weight: 600; color: var(--dourado-claro); font-variant-numeric: tabular-nums; }
.tv-progresso { position: absolute; right: 0; bottom: 0; left: 0; z-index: 1; height: 2px; background: var(--dourado); transform: scaleX(0); transform-origin: left center; }
.tv-palco { position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: 4px; background: #0B2A27; }
.tv-site { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; opacity: 0; transition: opacity .6s ease; }
.tv-site.visivel { opacity: 1; }
.tv-vazio { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2vh; padding: 2vmin; color: var(--verde-claro); text-align: center; }
.tv-vazio img { width: 22%; max-width: 260px; opacity: .16; }
.tv-vazio p { max-width: 32ch; margin: 0; font-size: clamp(12px, 1.8vh, 30px); }

/* tela de aviso (sem montagem, sem login, sem conexão), por cima da cobertura */
.tv-aviso { position: relative; z-index: 7; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.2vh; padding: 4vmin; border-radius: 4px; background: #0B2A27; text-align: center; }
.tv-aviso img { width: 22vmin; opacity: .9; }
.tv-aviso h1 { margin: 1vh 0 0; font-size: clamp(20px, 3.6vh, 64px); font-weight: 600; color: #fff; }
.tv-aviso p { max-width: 52ch; margin: 0; font-size: clamp(13px, 2vh, 34px); color: var(--verde-claro); }
.tv-aviso-botao { margin-top: 1vh; padding: 1.1vh 2.4vmin; border-radius: 6px; background: var(--dourado); font-size: clamp(13px, 1.9vh, 30px); font-weight: 600; color: #1B1405; text-decoration: none; }

/* a TV é para assistir: a cobertura pega o mouse; a tecla I libera mexer nos sites */
.tv-cobertura { position: absolute; inset: 0; z-index: 5; }
html.parado .tv-cobertura { cursor: none; }
html.mexendo .tv-cobertura { display: none; }
.tv-controles { position: absolute; bottom: 3vh; left: 50%; z-index: 6; display: flex; align-items: center; gap: 1vmin; padding: .8vh 1vmin; border-radius: 999px; background: rgba(11, 42, 39, .94); box-shadow: 0 6px 24px rgba(0, 0, 0, .35); opacity: 0; pointer-events: none; transform: translateX(-50%); transition: opacity .25s; }
html.mostrar .tv-controles, html.mexendo .tv-controles { opacity: 1; pointer-events: auto; }
.tv-controles button { height: 4vh; min-height: 32px; padding: 0 1.8vmin; border: 1px solid rgba(159, 194, 185, .35); border-radius: 999px; background: transparent; font-size: clamp(12px, 1.6vh, 26px); font-weight: 500; color: #fff; }
.tv-controles button:hover { background: rgba(255, 255, 255, .08); }
.tv-controles span { padding: 0 1vmin; font-size: clamp(11px, 1.4vh, 22px); color: var(--verde-claro); }
@media (prefers-reduced-motion: reduce) { .tv-site { transition: none; } }
```

- [ ] **Step 3: Escrever `painel/tv.js`**

```js
/* =====================================================================
   Montagens de Painel — a TV (painel/index.html?tv=1)
   Mostra a montagem que está na TV (tabela painel_tv) dentro da moldura do COA: faixa no topo com a marca, o
   nome da montagem e o relógio; uma etiqueta fina em cima de cada quadro; cada quadro com a própria rotação
   (o próximo site carrega escondido e entra esmaecendo). A cada 60 s confere se a montagem mudou e aplica sem
   recarregar os quadros que não mudaram; a cada 5 min confere se o painel foi publicado de novo e recarrega.
   Ninguém precisa dar F5. Uma cobertura transparente fica por cima dos sites (a TV é para assistir): a tecla I
   (ou o botão) libera mexer nos sites por 2 min, para fechar um aviso de cookies ou entrar num site.
===================================================================== */
(function () {
  'use strict';
  const PARAMS = new URLSearchParams(location.search);
  if (PARAMS.get('tv') !== '1') return; // o editor é o editor.js

  const L = window.PainelLogica;
  const CFG = window.PAINEL_CONFIG || {};
  const fonte = window.PainelFonte.criar();
  // no servidor local, ?conferir=5 encurta a conferência da montagem para testar a troca sem esperar 1 min
  const conferirSeg = Number(PARAMS.get('conferir'));
  const CONFERIR_MS = (CFG.modo === 'local' && conferirSeg >= 5 ? conferirSeg : 60) * 1000;
  const VERSAO_MS = 5 * 60000;
  const FALHAS_PARA_AVISAR = 3;
  const PARADO_MS = 3000;
  const MEXER_MS = 2 * 60000;
  const LOGO = '../acompanhamento/assets/logo_coa_branco.png';
  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;

  let montagem = null; // a montagem na tela (normalizada) ou null
  let marca = null;    // assinatura da TV correspondente ao que está na tela (null = reler na próxima conferência)
  let falhas = 0;
  let desde = null;
  let ocupado = false;
  let wake = null;
  let paradoTimer = null;
  let mexerTimer = null;
  const quadros = [];

  /* ------------------------------ um quadro ------------------------------ */
  function criarQuadro(numero) {
    const el = document.createElement('section');
    el.className = 'tv-quadro';
    el.hidden = true;
    const etiqueta = document.createElement('div');
    etiqueta.className = 'tv-etiqueta';
    const nome = document.createElement('span');
    nome.className = 'tv-etiqueta-nome';
    const conta = document.createElement('span');
    conta.className = 'tv-etiqueta-conta';
    const barra = document.createElement('i');
    barra.className = 'tv-progresso';
    etiqueta.append(nome, conta, barra);
    const palco = document.createElement('div');
    palco.className = 'tv-palco';
    el.append(etiqueta, palco);
    const q = { dados: null, i: 0, atual: null, proximo: null, timers: [] };

    function limpar() { q.timers.forEach(clearTimeout); q.timers = []; }
    function novoIframe(indice) {
      const s = q.dados.sites[indice];
      const f = document.createElement('iframe');
      f.className = 'tv-site';
      f.title = s.nome;
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', '');
      f.dataset.indice = String(indice);
      f.dataset.carregado = '0';
      f.addEventListener('load', () => { f.dataset.carregado = '1'; });
      f.src = L.enderecoNoNavegador(s);
      palco.appendChild(f);
      return f;
    }
    function progresso(ms) {
      barra.style.transition = 'none';
      barra.style.transform = 'scaleX(0)';
      barra.hidden = !Number.isFinite(ms) || q.dados.sites.length < 2;
      if (barra.hidden) return;
      void barra.offsetWidth; // aplica o zero antes de começar a encher
      barra.style.transition = 'transform ' + ms + 'ms linear';
      barra.style.transform = 'scaleX(1)';
    }
    function exibir(f) {
      f.classList.add('visivel');
      const antigo = q.atual;
      q.atual = f;
      if (antigo && antigo !== f) setTimeout(() => antigo.remove(), L.ESMAECER_MS + 100);
    }
    function agendar() {
      const ms = L.duracaoMs(q.dados, q.i);
      const n = q.dados.sites.length;
      nome.textContent = q.dados.sites[q.i].nome;
      conta.textContent = n > 1 ? (q.i + 1) + '/' + n : '';
      progresso(ms);
      if (!Number.isFinite(ms)) return;
      q.timers.push(setTimeout(preCarregar, L.atrasoPreCarga(ms)));
      q.timers.push(setTimeout(() => trocar(Date.now()), ms));
    }
    function preCarregar() {
      if (!q.proximo) q.proximo = novoIframe(L.proximoIndice(q.dados, q.i));
    }
    function trocar(inicio) {
      preCarregar();
      const f = q.proximo;
      if (f.dataset.carregado !== '1' && Date.now() - inicio < L.ESPERA_MAX_MS) {
        q.timers.push(setTimeout(() => trocar(inicio), 250));
        return;
      }
      q.proximo = null;
      q.i = Number(f.dataset.indice);
      exibir(f);
      agendar();
    }
    function vazio() {
      const caixa = document.createElement('div');
      caixa.className = 'tv-vazio';
      const img = document.createElement('img');
      img.src = LOGO;
      img.alt = '';
      const p = document.createElement('p');
      p.textContent = 'Quadro vazio. Adicione sites em Montagens de Painel, no COA WEB.';
      caixa.append(img, p);
      palco.appendChild(caixa);
      nome.textContent = 'Quadro ' + numero;
      conta.textContent = '';
      barra.hidden = true;
    }
    function comecar(dados) {
      limpar();
      palco.textContent = '';
      q.atual = null;
      q.proximo = null;
      q.dados = dados;
      q.i = 0;
      if (!dados.sites.length) { vazio(); return; }
      exibir(novoIframe(0));
      agendar();
    }
    function parar() {
      limpar();
      palco.textContent = '';
      q.atual = null;
      q.proximo = null;
      q.dados = null;
    }
    return { el, comecar, parar };
  }

  /* ------------------------------ a montagem na tela ------------------------------ */
  function aplicar(nova) {
    const acoes = L.planoDeAtualizacao(montagem, nova);
    const d = L.divisao(nova.divisao);
    const grade = $('tv-grade');
    grade.style.gridTemplateColumns = d.colunas;
    grade.style.gridTemplateRows = d.linhas;
    acoes.forEach((acao, i) => {
      const q = quadros[i];
      if (acao === 'remover') { q.parar(); q.el.hidden = true; return; }
      q.el.hidden = false;
      q.el.style.gridArea = d.areas[i];
      if (acao === 'recomecar') q.comecar(nova.quadros[i]);
    });
    montagem = nova;
    $('tv-nome').textContent = nova.nome;
    document.title = nova.nome + ' · TV do COA';
  }

  function aviso(titulo, texto, entrar) {
    quadros.forEach((q) => { q.parar(); q.el.hidden = true; });
    montagem = null;
    $('tv-nome').textContent = '';
    $('tv-grade').hidden = true;
    $('tv-aviso').hidden = false;
    $('tv-aviso-titulo').textContent = titulo;
    $('tv-aviso-texto').textContent = texto;
    $('tv-aviso-botao').hidden = !entrar;
  }

  async function carregar() {
    const r = await fonte.daTv();
    marca = L.assinaturaDaTv(r);
    if (!r.montagem) {
      aviso('Nenhuma montagem na TV', 'Escolha uma em Montagens de Painel, no COA WEB. A TV troca sozinha em até 1 minuto.');
      return;
    }
    $('tv-aviso').hidden = true;
    $('tv-grade').hidden = false;
    aplicar(L.normalizarMontagem(r.montagem));
  }

  function conexao(ok) {
    const selo = $('tv-conexao');
    if (ok) { falhas = 0; desde = null; selo.hidden = true; return; }
    falhas++;
    if (!desde) desde = new Date();
    if (falhas >= FALHAS_PARA_AVISAR) { selo.hidden = false; selo.textContent = 'Sem conexão desde ' + L.horaMinuto(desde); }
  }

  async function conferir() {
    if (ocupado) return;
    ocupado = true;
    try {
      const m = await fonte.marcaDaTv();
      if (m !== marca) await carregar();
      conexao(true);
    } catch (e) {
      if (e && e.codigo === 'sem-login') {
        marca = null; // quando alguém entrar de novo, a próxima conferência relê a montagem
        aviso('Entre no COA WEB neste computador', 'A sessão deste computador terminou. Entre de novo para a TV voltar a mostrar a montagem do dia.', true);
      } else {
        conexao(false);
      }
    } finally {
      ocupado = false;
    }
  }

  /* ------------------------------ versão publicada ------------------------------ */
  /** Os arquivos da página com versão no endereço ("tv.js?v=..."): a lista muda quando o painel é publicado de novo. */
  function arquivosVersionados(doc) {
    return Array.prototype.map.call(doc.querySelectorAll('script[src*="?v="], link[href*="?v="]'), (e) => e.getAttribute('src') || e.getAttribute('href')).sort();
  }
  const VERSAO = arquivosVersionados(document);
  /** Recarrega só com os arquivos novos já respondendo (publicação pela metade não derruba a TV) e uma vez por versão. */
  async function conferirVersao() {
    if (!VERSAO.length) return;
    try {
      const r = await fetch(location.pathname, { cache: 'no-store' });
      if (!r.ok) return;
      const arqs = arquivosVersionados(new DOMParser().parseFromString(await r.text(), 'text/html'));
      const nova = arqs.join('|');
      let jaVista = null;
      try { jaVista = sessionStorage.getItem('painel.versao'); } catch (e) { jaVista = null; }
      if (!arqs.length || nova === VERSAO.join('|') || nova === jaVista) return;
      await Promise.all(arqs.filter((a) => VERSAO.indexOf(a) < 0).map((a) => fetch(a, { cache: 'reload' }).then((x) => { if (!x.ok) throw new Error(a); })));
      try { sessionStorage.setItem('painel.versao', nova); } catch (e) { /* sem armazenamento: recarrega assim mesmo */ }
      location.reload();
    } catch (e) { /* tenta de novo no próximo ciclo */ }
  }

  /* ------------------------------ relógio, tela cheia, tela acesa ------------------------------ */
  function relogio() {
    const d = new Date();
    $('tv-hora').textContent = L.horaMinuto(d);
    $('tv-data').textContent = L.dataPorExtenso(d);
  }
  function botaoCheia() { $('tv-cheia').hidden = !!document.fullscreenElement; }
  async function telaCheia() {
    try { if (!document.fullscreenElement && raiz.requestFullscreen) await raiz.requestFullscreen(); } catch (e) { /* o navegador pede um clique */ }
    botaoCheia();
  }
  async function manterLigada() {
    try {
      if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    } catch (e) { /* sem permissão: a proteção de tela do sistema também precisa estar desligada (README) */ }
  }
  function mexeu() {
    raiz.classList.add('mostrar');
    raiz.classList.remove('parado');
    clearTimeout(paradoTimer);
    paradoTimer = setTimeout(() => { raiz.classList.remove('mostrar'); raiz.classList.add('parado'); }, PARADO_MS);
  }
  function mexerNosSites(ligar) {
    clearTimeout(mexerTimer);
    raiz.classList.toggle('mexendo', ligar);
    $('tv-mexendo').hidden = !ligar;
    $('tv-mexer').textContent = ligar ? 'Voltar (I)' : 'Mexer nos sites (I)';
    if (ligar) mexerTimer = setTimeout(() => mexerNosSites(false), MEXER_MS);
    mexeu();
  }

  $('tv-cobertura').addEventListener('click', () => { telaCheia(); mexeu(); });
  document.addEventListener('mousemove', mexeu);
  $('tv-cheia').addEventListener('click', telaCheia);
  $('tv-mexer').addEventListener('click', () => mexerNosSites(!raiz.classList.contains('mexendo')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') mexerNosSites(!raiz.classList.contains('mexendo'));
    else if (e.key === 'f' || e.key === 'F') telaCheia();
    mexeu();
  });
  document.addEventListener('fullscreenchange', botaoCheia);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { manterLigada(); conferir(); } });

  /* ------------------------------ início ------------------------------ */
  (async function iniciar() {
    raiz.classList.add('modo-tv');
    $('carregando').classList.remove('claro');
    $('carregando-texto').textContent = 'Abrindo o painel da TV';
    $('tv').hidden = false;
    for (let i = 0; i < L.TOTAL_QUADROS; i++) {
      const q = criarQuadro(i + 1);
      quadros.push(q);
      $('tv-grade').appendChild(q.el);
    }
    relogio();
    setInterval(relogio, 1000);
    botaoCheia();
    try {
      await fonte.pronto();
    } catch (e) {
      $('carregando').classList.add('fora');
      if (e.codigo === 'sem-categoria') aviso('Sem acesso a Montagens de Painel', 'Este login não tem a categoria Montagens de Painel. Peça a liberação na página Usuários do COA WEB.');
      else if (e.codigo === 'sem-login') aviso('Entre no COA WEB neste computador', 'A TV mostra a montagem do dia depois que alguém entra no COA WEB neste navegador.', true);
      else aviso('Sem conexão com o COA WEB', 'A página tenta de novo sozinha em 1 minuto.');
      setTimeout(() => location.reload(), 60000); // depois do login (em outra aba) ou da volta da internet, a TV retoma sozinha
      return;
    }
    try {
      await carregar();
    } catch (e) {
      conexao(false);
      aviso('Sem conexão com o COA WEB', 'A TV tenta de novo sozinha a cada minuto.');
    }
    $('carregando').classList.add('fora');
    setInterval(conferir, CONFERIR_MS);
    setInterval(conferirVersao, VERSAO_MS);
    manterLigada();
    mexeu();
  })();
})();
```

- [ ] **Step 4: Rodar a suíte**

Run: `node --test "modulos/painel/testes/*.test.mjs"`
Expected: PASS, 53 testes.

- [ ] **Step 5: Conferir no navegador (servidor local)**

1. Reiniciar o preview `coa-web-painel-local` (montagens fictícias do começo) e abrir `http://localhost:8792/painel/?tv=1&conferir=5`. `read_console_messages` só erros: nenhum erro de CSP (os `iframes` do Windy e do RainViewer abrem: `frame-src 'self' https:`).
2. Quatro quadros com etiqueta: Q1 "Acompanhamento · Teste Norte" com "1/2" e a linha dourada correndo; Q2 Windy; Q3 "Mapa de Chuva 24 h" "1/3"; Q4 RainViewer (fixo, sem linha). Topo com a logo, "Plantio (teste)" e o relógio com a data por extenso.
3. Depois de ~32 s: Q1 em "2/2", trocado sem tela branca; `javascript_tool` → `[...document.querySelectorAll('.tv-palco')].map(p => p.querySelectorAll('iframe').length)` com todos ≤ 2.
4. Atualização sem recarregar: `window.__q2 = document.querySelectorAll('.tv-palco')[1].querySelector('iframe')`; mudar a divisão pela API: `const e = await (await fetch('/api/painel/tv')).json(); await fetch('/api/painel/montagens/teste-plantio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: e.montagem.nome, divisao: '2a', quadros: e.montagem.quadros }) })`. Em até ~6 s: só 2 quadros na tela, e `document.querySelectorAll('.tv-palco')[1].querySelector('iframe') === window.__q2` dá `true` (o Windy não recarregou).
5. `PUT /api/painel/tv` com `{ "montagem_id": null }`: em até ~6 s aparece "Nenhuma montagem na TV"; voltar com `teste-chuva`: a montagem "Chuva e radar (teste)" (3A) aparece.
6. `preview_stop` do servidor: depois de 3 conferências (~15 s) aparece "Sem conexão desde HH:MM" no topo, e os quadros continuam com o que tinham. `preview_start` de novo: o selo some na conferência seguinte.
7. Tecla `I`: `document.documentElement.classList.contains('mexendo')` = `true` e a pílula mostra "Mexendo nos sites · volta sozinho em 2 min"; `I` de novo: volta.
8. Fotos para o usuário, com o Edge sem janela (o servidor local precisa estar no ar; `$SCRATCH` = pasta de rascunho da sessão):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=20000 --screenshot="$SCRATCH/tv-1920.png" "http://localhost:8792/painel/?tv=1"
```

e o mesmo com `--window-size=3840,2160` (`tv-3840.png`) e `--window-size=1366,768` (`tv-1366.png`). Abrir as três imagens (ferramenta Read) e conferir: textos legíveis e proporcionais, nada cortado, etiquetas sem cobrir os sites, relógio alinhado à direita. Se o Edge não estiver nesse caminho, procurar com `ls "/c/Program Files"*/Microsoft/Edge/Application/msedge.exe`.

- [ ] **Step 6: Commit**

```bash
git add painel/index.html painel/tv.css painel/tv.js
git commit -m "Montagens de Painel: a TV com a moldura do COA, rotação por quadro e atualização sozinha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Casca do COA WEB (`index.html`)

**Files:**
- Modify: `index.html` (CRLF: só com a ferramenta Edit)

**Interfaces:**
- Consumes: `painel/index.html?embed=1` (Tarefas 7 a 9); padrões da casca: `CATEGORIAS`, `podeCategoria`, `irPara`, `coaLoader`, `mostrarCategoriaScreen`.
- Produces: categoria `painel` ("Montagens de Painel") com cartão, menu lateral `nav-painel`, `entrarPainel()`, `irParaPainel()`, `descarregarPainel()`; a caixa da categoria na página Usuários sai sozinha de `CATEGORIAS`.

Fazer as edições **nesta ordem** (a 1 antes da 10, para a troca em massa não pegar o bloco novo).

- [ ] **Step 1: Esconder o menu novo ao entrar nas outras categorias**

1a. Edit com `replace_all: true`: `old_string` = `  document.getElementById('nav-chuva').style.display = 'none';` e `new_string`:

```js
  document.getElementById('nav-chuva').style.display = 'none';
  document.getElementById('nav-painel').style.display = 'none';
```

(7 lugares: `entrarAcompanhamento`, `entrarPrevisao`, `entrarSat`, `entrarAlgodao`, `entrarMecanizadas`, `entrarAdministracao`, `entrarMapas`.)

1b. Três listas de `forEach`, uma Edit cada:
- `['nav-algodao','nav-mecanizadas','nav-administracao','nav-mapas','nav-acompanhamento','nav-sat','nav-previsao','nav-validacao','nav-controle']` (em `entrarChuva`) → acrescentar `,'nav-painel'` antes do `]`;
- `['nav-algodao','nav-mecanizadas','nav-administracao','nav-mapas','nav-acompanhamento','nav-sat','nav-previsao','nav-chuva','nav-controle']` (em `entrarValidacao`) → idem;
- `['nav-algodao','nav-mecanizadas','nav-administracao','nav-mapas','nav-acompanhamento','nav-sat','nav-previsao','nav-chuva','nav-validacao']` (em `entrarControle`) → idem.

- [ ] **Step 2: CSS**

2a. Edit: `old_string` = `.app.modo-acomp .topbar, .app.modo-previsao .topbar, .app.modo-validacao .topbar, .app.modo-controle .topbar, .app.modo-chuva .topbar{display:none;}` → acrescentar `, .app.modo-painel .topbar` antes de `{display:none;}`.

2b. Edit: `old_string` = `.app.modo-acomp main, .app.modo-previsao main, .app.modo-validacao main, .app.modo-controle main, .app.modo-chuva main{padding-top:0;}` → acrescentar `, .app.modo-painel main` antes de `{padding-top:0;}`.

2c. Edit: `old_string` = `/* ---------- categoria VALIDAÇÃO PIMS: módulo num iframe (validacao/index.html?embed=1) ---------- */` e `new_string`:

```css
/* ---------- categoria MONTAGENS DE PAINEL: módulo num iframe (painel/index.html?embed=1) ---------- */
.app.modo-painel{min-height:0;}
.app.modo-painel main{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;}
.app.modo-painel .page[data-page="painel"].active{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;margin:0 -34px -60px;}
#painel-frame{display:block;flex:1 1 auto;width:100%;min-height:0;border:0;background:var(--fundo);}
@media (max-width:900px){
  .app.modo-painel{display:flex;flex-direction:column;height:100vh;height:100dvh;}
  .app.modo-painel .sidebar{flex:none;}
  .app.modo-painel main{flex:1 1 auto;min-height:0;height:auto;}
  .app.modo-painel .page[data-page="painel"].active{margin:0 -18px -18px;}
}
@media (max-width:640px){
  .app.modo-painel .page[data-page="painel"].active{margin:0 -14px -14px;}
}
@media (max-width:480px){
  .app.modo-painel .page[data-page="painel"].active{margin:0 -12px -12px;}
}
/* ---------- categoria VALIDAÇÃO PIMS: módulo num iframe (validacao/index.html?embed=1) ---------- */
```

- [ ] **Step 3: Cartão, menu e página**

3a. Cartão. Edit: `old_string` = `      <button class="categoria-card admin-only" id="card-administracao">` e `new_string`:

```html
      <button class="categoria-card" id="card-painel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M12 4v13M2.5 10.5H12"/><path d="M8 20.5h8"/></svg>
        <span>Montagens de Painel</span><small class="categoria-card-desc">O que a TV do COA mostra, quadro por quadro</small>
      </button>
      <button class="categoria-card admin-only" id="card-administracao">
```

3b. Menu. Edit: `old_string` = `    <div id="nav-controle" style="display:none">` e `new_string`:

```html
    <div id="nav-painel" style="display:none">
      <div class="nav-eyebrow">Montagens de Painel</div>
      <nav>
        <button class="nav-btn" data-page="painel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M12 4v13M2.5 10.5H12"/><path d="M8 20.5h8"/></svg>Montagens</button>
      </nav>
    </div>
    <div id="nav-controle" style="display:none">
```

3c. Página. Edit: `old_string` = `    <section class="page" data-page="chuva"></section>` e `new_string` = a mesma linha + nova linha `    <section class="page" data-page="painel"></section>`.

- [ ] **Step 4: Categoria, título, menu e troca de página**

4a. Edit: `old_string` = `let categoriaAtual = null; // 'algodao' | 'mecanizadas' | 'administracao' | 'mapas' | 'acompanhamento' | 'sat' | 'previsao' | 'chuva' | 'validacao' | 'controle'` → acrescentar ` | 'painel'` no fim.

4b. Edit: `old_string` = `  { chave:'controle', nome:'Controle Técnico', card:'card-controle' },` e `new_string` = a mesma linha + nova linha `  { chave:'painel', nome:'Montagens de Painel', card:'card-painel' },`.

4c. Edit: `old_string` = `  controle:['Controle Técnico','Suas ordens, apontamentos e estoque do depósito'],` e `new_string` = a mesma linha + nova linha `  painel:['Montagens de Painel','O que a TV do COA mostra, quadro por quadro'], // o cabeçalho de verdade é o do módulo`.

4d. Edit: `old_string` = `    else if(btn.dataset.chuva) irParaChuva(btn.dataset.chuva);` e `new_string` = a mesma linha + nova linha `    else if(btn.dataset.page === 'painel') irParaPainel();`.

4e. Edit: `old_string` = `  document.getElementById('app-shell').classList.toggle('modo-controle', pagina==='controle');` e `new_string` = a mesma linha + nova linha `  document.getElementById('app-shell').classList.toggle('modo-painel', pagina==='painel');`.

- [ ] **Step 5: O módulo**

Edit: `old_string` = `   PREVISÃO DO TEMPO — módulo num iframe da mesma origem` (linha de dentro do comentário que abre o bloco da Previsão). Como a linha anterior é a abertura `/* =====…`, o texto novo **fecha** um bloco e reabre o comentário. `new_string`:

```js
   MONTAGENS DE PAINEL — módulo num iframe da mesma origem
   (painel/index.html?embed=1; a sessão do Supabase é a mesma do COA WEB). O módulo não usa a fazenda do menu
   lateral: cada página posta num quadro mostra as fazendas dela. A TV abre em aba própria
   (painel/index.html?tv=1) pelo botão "Abrir na TV" do módulo.
   ===================================================================== */
let painelFrame = null;      // iframe #painel-frame (criado na primeira entrada; removido ao sair)
function irParaPainel(){
  irPara('painel');
  if(painelFrame) return;
  const frame = document.createElement('iframe');
  frame.id = 'painel-frame';
  frame.title = 'Montagens de Painel';
  frame.addEventListener('load', ()=>{ if(frame === painelFrame) coaLoader.esconder(); });
  coaLoader.mostrar('Abrindo as Montagens de Painel', true);
  frame.src = 'painel/index.html?embed=1';
  painelFrame = frame;
  document.querySelector('.page[data-page="painel"]').appendChild(frame);
}
function entrarPainel(){
  if(!podeCategoria('painel')){ mostrarCategoriaScreen(); return; }
  categoriaAtual = 'painel';
  ['nav-algodao','nav-mecanizadas','nav-administracao','nav-mapas','nav-acompanhamento','nav-sat','nav-previsao','nav-chuva','nav-validacao','nav-controle']
    .forEach(id=>{ document.getElementById(id).style.display = 'none'; });
  document.getElementById('nav-painel').style.display = '';
  document.getElementById('categoria-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
  irParaPainel(); // 1ª entrada: cria o iframe; depois mantém o módulo onde estava
}
function descarregarPainel(){
  if(painelFrame){
    painelFrame.src = 'about:blank';
    painelFrame.remove();
  }
  painelFrame = null;
}

/* =====================================================================
   PREVISÃO DO TEMPO — módulo num iframe da mesma origem
```

- [ ] **Step 6: Cartão, sair e fim de sessão**

6a. Edit: `old_string` = `document.getElementById('card-controle').addEventListener('click', entrarControle);` e `new_string` = a mesma linha + nova linha `document.getElementById('card-painel').addEventListener('click', entrarPainel);`.

6b. Em `sair()`, Edit: `old_string` = `  descarregarControle();` (a única linha só com isso; a do `SIGNED_OUT` está no meio de outra linha) e `new_string` = a mesma linha + nova linha `  descarregarPainel();`.

6c. Edit: `old_string` = `descarregarValidacao(); descarregarControle(); mostrarTelaLogin(); }` e `new_string` = `descarregarValidacao(); descarregarControle(); descarregarPainel(); mostrarTelaLogin(); }`.

- [ ] **Step 7: Conferir**

1. Contagens: `grep -c "nav-painel" index.html` → `12` (a div do menu, os 7 escondidos da Step 1a, as 3 listas da Step 1b e o `display = ''` do `entrarPainel`; a lista do próprio `entrarPainel` não tem `nav-painel`); `grep -c "descarregarPainel" index.html` → `3`; `grep -c "card-painel" index.html` → `3`.
2. Sintaxe dos blocos `<script>` sem atributo da casca:

```bash
node -e "const h=require('fs').readFileSync('index.html','utf8');const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);let ok=true;s.forEach((c,i)=>{try{new Function(c)}catch(e){ok=false;console.error('bloco',i,e.message)}});console.log(s.length+' blocos; '+(ok?'sem erro de sintaxe':'COM ERRO'));process.exitCode=ok?0:1"
```

Expected: `… blocos; sem erro de sintaxe`.
3. Fim de linha: `git diff --stat index.html` mostra só umas 70 linhas novas (não o arquivo inteiro); depois do `git add`, `git ls-files --eol index.html` → `i/lf`.
4. Suíte: `node --test "modulos/painel/testes/*.test.mjs"` → PASS, 53 testes.
5. Tela de categorias sem login: não há como abrir a casca logada no servidor local (o login é o do Supabase de produção). A conferência logada fica para a Tarefa 11, depois de publicar.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Casca: categoria Montagens de Painel (cartão, menu e módulo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Manual, aprovação do usuário, banco e publicação

**Files:**
- Create: `modulos/painel/README.md`
- Modify: memória do projeto (fora do repositório), `modulos/painel/docs/2026-10-15-montagens-de-painel-design.md` (situação)

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 10.
- Produces: o módulo no ar em `https://coa-web-teal.vercel.app` (só depois das autorizações).

- [ ] **Step 1: Escrever `modulos/painel/README.md`**

```markdown
# Montagens de Painel (TV do COA)

Módulo do COA WEB que monta a tela da TV da sala do COA: **montagens** com nome (divisão da tela + sites de cada
quadro, cada site com o seu tempo), uma delas **na TV hoje**, e a página da TV com a moldura do COA.

- Editor: COA WEB → categoria **Montagens de Painel** (`painel/index.html?embed=1` dentro da casca).
- TV: `https://coa-web-teal.vercel.app/painel/?tv=1` (botão **Abrir na TV** do editor).
- Especificação e plano: `modulos/painel/docs/`. Banco: `supabase/0025_painel.sql`.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `painel/logica.js` | Contas sem tela (divisões, tempos, endereços, montagem, rotação), testadas |
| `painel/fonte.js`, `painel/config.js` | Dados: Supabase do COA WEB ou servidor local |
| `painel/editor.js`, `painel/estilo.css` | Editor |
| `painel/tv.js`, `painel/tv.css` | TV |
| `api/conferir-site.js` | Diz se um site deixa ser exibido dentro de outra página |
| `vercel.json` | Só `/painel/` pode abrir sites externos em quadros (`frame-src https:`) |

## Sites que não abrem num quadro

Quem decide é o dono do site (cabeçalhos `X-Frame-Options` e `frame-ancestors`). Em 15/10/2026 não abriam: John
Deere Operations Center, portal da ZEUS, windy.com e zoom.earth. Abrem: páginas do COA WEB, o widget do Windy
(`embed.windy.com`) e o radar do RainViewer. O editor confere na hora de adicionar. Site que pede login pode pedir o
login dentro do quadro: na TV, a tecla **I** libera mexer nos sites por 2 minutos.

## Deixar a TV abrindo sozinha (Linux)

1. No Chrome/Chromium da TV, entre uma vez no COA WEB com um login que tenha a categoria **Montagens de Painel** e
   as categorias das páginas que vão nos quadros (Operacional, Previsão do Tempo…).
2. Teste o modo quiosque (sai com Alt+F4):
   `chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://coa-web-teal.vercel.app/painel/?tv=1`
   (ou `google-chrome` no lugar de `chromium`).
3. Início automático: crie `~/.config/autostart/painel-coa.desktop` com:

       [Desktop Entry]
       Type=Application
       Name=Painel do COA
       Exec=chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://coa-web-teal.vercel.app/painel/?tv=1
       X-GNOME-Autostart-enabled=true

4. Desligue a proteção de tela e o desligamento do monitor (Configurações → Energia), senão a TV apaga.
5. TV 4K: ponha a escala da tela do sistema em 200% (ou o zoom do Chrome em 200%). A moldura acompanha sozinha, e
   os sites dos quadros deixam de aparecer miúdos (eles usam a escala própria deles).

Na TV: **I** libera mexer nos sites por 2 min; **F** pede tela cheia (no quiosque já está). A TV confere a montagem
a cada minuto e recarrega sozinha quando o painel é publicado de novo: ninguém precisa dar F5. Ao publicar mudança
em `painel/`, troque o `?v=` do arquivo em `painel/index.html`.

## Testes

- `node --test "modulos/painel/testes/*.test.mjs"` (na raiz).
- Servidor local, sem login e com montagens fictícias: `node modulos/painel/scripts/servidor-local.mjs` → editor em
  `http://localhost:8792/painel/` e TV em `http://localhost:8792/painel/?tv=1&conferir=5` (`conferir` encurta a
  conferência da montagem; só vale no servidor local).
```

Commit:

```bash
git add modulos/painel/README.md
git commit -m "Montagens de Painel: manual do módulo e da TV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Revisão final do branch**

Rodar a suíte inteira do painel (53 testes) e também as dos módulos vizinhos que dividem arquivos: `node --test "modulos/previsao/testes/*.test.mjs"` e `node --test modulos/acompanhamento/testes/` (nada deles mudou; precisam continuar passando). Pedir a revisão do branch inteiro (`git diff main...modulo-painel`), conferindo em especial: texto do banco sempre por `textContent`; `?v=` trocado em todo arquivo de `painel/` alterado; o `vercel.json` só afrouxou o `frame-src` em `/painel/`; `index.html` e `vercel.json` sem troca de fim de linha.

- [ ] **Step 3: Mostrar ao usuário e esperar o "pode publicar"**

Mandar ao usuário (SendUserFile) as fotos da TV em 1920 × 1080 e 3840 × 2160 e do editor (Tarefas 7 a 9), com os sites fictícios do servidor local, e dizer o que falta para ir ao ar (as três autorizações abaixo). **Parar aqui** até ele responder. Ajustes de desenho pedidos por ele voltam para a tarefa da tela correspondente (com o `?v=` trocado).

- [ ] **Step 4: Banco (só com autorização explícita do usuário para rodar o 0025)**

No navegador do app (Supabase já logado pelo usuário), SQL Editor do projeto `pkaxbitsqxjxjlwnhjhd`:
1. Rodar de novo as duas consultas de conferência do cabeçalho do script e confirmar que as listas são as de 15/10/2026.
2. Colar e rodar `supabase/0025_painel.sql` inteiro; esperar "Success".
3. Rodar a conferência do fim do script: as regras `painel_montagens_*`, `painel_tv_*` e `mapas_fazendas_categoria` (com `painel`) aparecem, e `painel_tv` tem uma linha com `montagem_id` nulo.

- [ ] **Step 5: Publicar (só com autorização explícita do usuário para o push)**

1. Atualizar o branch com o `main` publicado: `git fetch origin && git merge --ff-only origin/main` se o `main` não andou; se andou, `git merge origin/main` e rodar a suíte de novo.
2. `git push origin modulo-painel:main` (fast-forward do `main`, como nas publicações anteriores do COA WEB). A Vercel publica sozinha.
3. Conferir em produção (sem login), 1–3 min depois:
   - `curl -sI https://coa-web-teal.vercel.app/painel/ | grep -i content-security-policy` → contém `frame-src 'self' https:`;
   - `curl -sI https://coa-web-teal.vercel.app/ | grep -i content-security-policy` → contém `frame-src 'self' https://embed.windy.com` (o resto do site não mudou);
   - `curl -s "https://coa-web-teal.vercel.app/api/conferir-site?url=https://www.rainviewer.com/map.html"` → `{"resultado":"sem-acesso",…}` (401: a função está no ar e pede login).
   Se a página ainda vier com os cabeçalhos antigos depois de 5 min, a publicação falhou (por exemplo, um `source` do `vercel.json` recusado pela Vercel): abrir o painel da Vercel no navegador, ler o erro e corrigir antes de qualquer outra coisa.

- [ ] **Step 6: Primeiro uso, com o usuário**

Pedir ao usuário que abra o COA WEB logado e: (1) entre em **Montagens de Painel** (o ADMINISTRADOR+ tem todas as categorias; para os outros, marcar a categoria em Usuários); (2) crie a primeira montagem (ela vai sozinha para a TV) com uma página do COA WEB e o radar do RainViewer; (3) clique em **Abrir na TV** e veja a moldura com os dados reais. Se ele preferir que eu conduza no navegador do app com a sessão dele: criar só uma montagem chamada `TESTE PAINEL CLAUDE`, conferir, e no fim tirá-la da TV e apagá-la **pelo nome** (regra do COA WEB para teste em produção), conferindo que as montagens dele continuam iguais.

- [ ] **Step 7: Registrar**

Atualizar a situação no cabeçalho da especificação ("publicada em …, main <hash>, SQL 0025 aplicado") e a memória `montagens-de-painel` (o que foi publicado, o que o usuário ainda não conferiu, o passo a passo da TV no README). Commit da especificação e push só se o usuário já tiver autorizado a publicação.

