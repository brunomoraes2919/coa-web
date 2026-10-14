# Relatório de previsão por fazenda (PDF) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Relatório (PDF)" no módulo Previsão do Tempo que gera, no navegador, um PDF com capa e uma página por fazenda (temperatura máxima e mínima em cima, chuva da ZEUS embaixo e a faixa de números de cada dia), a partir da foto diária que a VM já tira para o Benchmark.

**Architecture:** A rotina da VM (`modulos/mapas/scripts/sincronizar-plantio.mjs`) passa a gravar `tx`/`tn` (máxima e mínima) em cada dia previsto do Visual Crossing e do MET Norway (este lido no formato `complete`), no mesmo JSON `prev_previsoes.dias`, sem mudar o banco. Na tela, `previsao/relatorio-logica.js` (UMD, testado) monta os dados de cada fazenda e `previsao/relatorio.js` desenha os gráficos (ECharts fora da tela) e o PDF (jsPDF 2.5.1, carregado só no clique). `previsao/app.js` liga o botão e a leitura.

**Tech Stack:** Node ≥ 18 sem dependências (VM), Vitest + TypeScript (testes do servidor), JS puro + ECharts 5.5.1 + jsPDF 2.5.1 (cdnjs, com SRI) + supabase-js 2.117.3 na tela, `node --test` nos testes da tela.

**Spec:** `modulos/previsao/docs/2026-10-14-relatorio-previsao-design.md`

## Global Constraints

- Sem tabela nova e sem script de banco: a temperatura vai em `prev_previsoes.dias` como `tx`/`tn` (°C, 1 casa, ou `null`). A ZEUS não ganha os campos (a tela lê a falta como "sem temperatura").
- O Benchmark não muda de comportamento: os testes dele continuam passando, só com `tx`/`tn` a mais nas saídas do Visual Crossing e do MET Norway.
- Programas da VM: **sem dependência nova**; tudo no `sincronizar-plantio.mjs` (a VM só baixa três arquivos). Nada de chave, token ou nome de fazenda no log.
- MET Norway: mesma identificação (`PREV_USER_AGENT`), formato `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=…&lon=…`.
- Dia sempre no fuso de Mato Grosso (UTC−4), calculado no código.
- Relatório: só a estrutura do modelo da Rural Clima; **nenhuma marca, nome ou texto da Rural Clima ou da Bayer**. Identidade do COA (`assets/logo-coa-relatorio.png`, 900 × 234) e da Locks (`assets/locks-agtech-lab.png`, 900 × 70). Créditos: "Dados de Visual Crossing (visualcrossing.com)" e "MET Norway (api.met.no), CC BY 4.0" quando usados.
- Fazendas do relatório: as do cadastro que o usuário vê (a regra de acesso já filtra) e que têm `unidade_pims`, em ordem alfabética; fotos dos últimos 3 dias (hoje, ontem, anteontem); período de hoje até o último dia com dado, no máximo hoje + 14.
- Temperatura: Visual Crossing quando a foto dele tem temperatura; senão MET Norway; senão nenhuma.
- Gráfico em dois painéis colados (temperatura em cima, chuva embaixo), sem número em cada ponto (os números estão na faixa). Cores: máxima `#db8a08`, mínima `#5470c6`, chuva `#0f9484` (conjunto já aprovado no validador de paleta no Benchmark).
- Textos do PDF passam por `paraPdf` (as fontes padrão do jsPDF só têm o conjunto WinAnsi).
- Repositório público: dados de teste fictícios; dados reais e PDFs reais só fora do repositório (`doc-coa-web/_trabalho`).
- Fim de linha: índice do git sempre LF (`core.autocrlf=true`); não misturar CRLF e LF num arquivo; conferir com `git ls-files --eol <arquivo>` (esperado `i/lf`) e `git diff --stat`. Nunca `sed -i`.
- Toda mudança em arquivo de `previsao/` troca o `?v=` dele em `previsao/index.html` (nesta entrega: `202610142300`).
- Textos e comentários em português do Brasil, no tom dos existentes.
- Commits locais no branch `relatorio-previsao`; publicação só na Tarefa 4, com "pode publicar".

## Review Focus

- **Foto da véspera** (relatório gerado antes da rodada das 6:17) **ou foto antiga** (VM parada): dias anteriores a hoje não aparecem, foto com mais de 3 dias não entra, e a data da foto usada aparece na página → testes na Tarefa 2.
- **Visual Crossing sem temperatura** (foto de antes da publicação, ou sem chave na VM): a temperatura vem do MET Norway; sem nenhuma, só o painel da chuva, com a nota → teste na Tarefa 2 e conferência do PDF na Tarefa 3.
- **Bloco de 6 h do MET Norway atravessando a meia-noite de MT:** máxima e mínima do bloco contam no dia que tem a maioria das horas dele, e só dias completos ficam → teste na Tarefa 1.
- **Fazenda sem `unidade_pims` ou sem foto recente:** a primeira fica fora; a segunda ganha uma página com o aviso, sem quebrar o PDF → teste na Tarefa 2 e conferência na Tarefa 3.
- **Caracteres fora da fonte do PDF** (acentos de "Três Flechas", travessão, grau, "≥"): os acentos ficam, o resto vira texto legível ou "?" em vez de lixo → teste de `paraPdf` na Tarefa 2 e página real conferida na Tarefa 4.

---

### Task 1: Rotina — temperatura do Visual Crossing e do MET Norway

**Files:**
- Modify: `modulos/mapas/scripts/sincronizar-plantio.mjs` (`previsaoVisualCrossing`, `urlMetNo`, `previsaoMetNo`)
- Modify: `modulos/mapas/scripts/sincronizar-plantio.d.mts` (`PrevDia`)
- Modify: `modulos/mapas/tests/previsao-benchmark-servidor.test.ts` (testes das fontes e da etapa)
- Modify: `modulos/previsao/docs/2026-10-14-relatorio-previsao-design.md` (linha da ZEUS na tabela da seção 2)

**Interfaces:**
- Produces: `previsaoVisualCrossing(json): { d, mm, p, tx, tn }[]`; `previsaoMetNo(json): { d, mm, p: null, tx, tn }[]`; `urlMetNo(ponto)` → formato `complete`. `tx`/`tn`: número com 1 casa ou `null`. `PrevDia` ganha `tx?: number | null; tn?: number | null`.

- [ ] **Step 1: Atualizar os testes (falham)**

Em `modulos/mapas/tests/previsao-benchmark-servidor.test.ts`:

1. No teste `'Visual Crossing: mm com 1 casa e probabilidade inteira; dia inválido sai'`, trocar o esperado por:
```ts
    ] })).toEqual([{ d: '2026-10-14', mm: 2.3, p: 55, tx: null, tn: null }, { d: '2026-10-15', mm: 0, p: null, tx: null, tn: null }]);
```
e acrescentar logo depois dele:
```ts
  it('Visual Crossing: máxima e mínima com 1 casa; ausente ou inválida vira null', () => {
    expect(previsaoVisualCrossing({ days: [
      { datetime: '2026-10-14', precip: 1, precipprob: 10, tempmax: 33.46, tempmin: 21.04 },
      { datetime: '2026-10-15', precip: 0, precipprob: 0, tempmax: 'x' },
    ] })).toEqual([{ d: '2026-10-14', mm: 1, p: 10, tx: 33.5, tn: 21 }, { d: '2026-10-15', mm: 0, p: 0, tx: null, tn: null }]);
  });
```
2. No teste dos endereços, trocar `'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-13.05&lon=-56.1'` por `'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=-13.05&lon=-56.1'`.
3. Substituir os três testes do MET Norway (`'MET Norway: blocos de 6 h…'`, `'MET Norway: no trecho de hora em hora…'` e `'MET Norway: na passagem de 1 h para 6 h…'`) por:
```ts
  it('MET Norway: blocos de 6 h repartidos pela meia-noite de MT; temperatura do bloco no dia da maioria das horas; só dias com 24 h', () => {
    const temp: Record<string, [number, number]> = { '00': [26, 22], '06': [24, 19], '12': [31, 23], '18': [34, 28] };
    const bloco = (time: string, mm: number, [max, min]: [number, number]) =>
      ({ time, data: { next_6_hours: { details: { precipitation_amount: mm, air_temperature_max: max, air_temperature_min: min } } } });
    const serie = [];
    for (const dia of ['16', '17', '18']) for (const h of ['00', '06', '12', '18']) {
      serie.push(bloco(`2026-10-${dia}T${h}:00:00Z`, dia === '17' && h === '00' ? 12 : 6, dia === '17' && h === '12' ? [36, 23] : temp[h]));
    }
    // 00Z do dia 16 = 20 h do dia 15 em MT: o dia 15 (4 h) e o dia 18 (20 h) ficam de fora. O bloco das 00Z
    // (20 h às 2 h de MT) conta a temperatura no dia anterior, onde estão 4 das 6 horas.
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([
      { d: '2026-10-16', mm: 28, p: null, tx: 34, tn: 19 },
      { d: '2026-10-17', mm: 26, p: null, tx: 36, tn: 19 },
    ]);
  });
  it('MET Norway: no trecho de hora em hora usa o bloco de 1 h (e a temperatura de cada hora), sem somar o de 6 h junto', () => {
    const serie = [];
    for (let h = 0; h < 24; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, 4 + h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { instant: { details: { air_temperature: 20 + (h % 12) } }, next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3 } } } });
    }
    // as 23 primeiras horas usam a hora (20 a 31 °C); a última vira bloco de 6 h (sem máxima e mínima) e conta no dia 17
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 12, p: null, tx: 31, tn: 20 }]);
  });
  it('MET Norway: na passagem de 1 h para 6 h o último horário usa o bloco de 6 h (sem buraco no dia)', () => {
    const serie = [];
    for (let h = 4; h <= 18; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { instant: { details: { air_temperature: 25 } }, next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3, air_temperature_max: 33, air_temperature_min: 27 } } } });
    }
    serie.push({ time: '2026-10-17T00:00:00Z', data: { next_6_hours: { details: { precipitation_amount: 6, air_temperature_max: 26, air_temperature_min: 21 } } } });
    // chuva: 14 h × 0,5 (04Z–17Z) + o bloco das 18Z (3) + 4 h do bloco das 00Z (4 × 1) = 14. Temperatura: horas a 25 °C,
    // bloco das 18Z (33/27) e o das 00Z (26/21), que tem 4 das 6 horas no dia 16 → máxima 33, mínima 21
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 14, p: null, tx: 33, tn: 21 }]);
  });
  it('MET Norway: sem temperatura na resposta, máxima e mínima ficam null e a chuva continua', () => {
    const serie = [0, 6, 12, 18, 24].map((h) => ({ time: new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', ''), data: { next_6_hours: { details: { precipitation_amount: 1.2 } } } }));
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 4.8, p: null, tx: null, tn: null }]);
  });
```
4. No teste da etapa `'às 6 h de MT tira a foto das três fontes…'`, trocar `toEqual([{ d: '2026-10-16', mm: 4.8, p: null }])` por `toEqual([{ d: '2026-10-16', mm: 4.8, p: null, tx: null, tn: null }])` e `'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-13.1&lon=-56.1'` por `'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=-13.1&lon=-56.1'`.

- [ ] **Step 2: Rodar e ver falhar**

Run (em `modulos/mapas`): `npx vitest run tests/previsao-benchmark-servidor.test.ts`
Expected: FAIL nos testes do Visual Crossing (sem `tx`/`tn`), dos endereços, do MET Norway e da etapa; os demais passam.

- [ ] **Step 3: Implementar**

Em `sincronizar-plantio.mjs`, trocar `previsaoVisualCrossing`, `urlMetNo` e `previsaoMetNo` (com os comentários de cima) por:

```js
/** Resposta do Visual Crossing → [{ d, mm, p, tx, tn }] (os dias já vêm no fuso do ponto, que em MT é UTC−4). */
export function previsaoVisualCrossing(json) {
  const dias = Array.isArray(json?.days) ? json.days : [];
  const grau = (v) => (typeof v === 'number' && Number.isFinite(v) ? arred1(v) : null);
  const saida = [];
  for (const x of dias) {
    const d = txt(x?.datetime);
    const mm = typeof x?.precip === 'number' ? x.precip : Number.NaN;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(mm) || mm < 0) continue;
    const p = typeof x?.precipprob === 'number' && Number.isFinite(x.precipprob) ? Math.round(x.precipprob) : null;
    saida.push({ d, mm: arred1(mm), p, tx: grau(x?.tempmax), tn: grau(x?.tempmin) });
  }
  return saida;
}

/** Endereço do MET Norway (Locationforecast 2.0, completo: traz a máxima e a mínima de cada bloco de 6 h). */
export function urlMetNo({ lat, lon }) {
  return `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`;
}

/**
 * Resposta do MET Norway → [{ d, mm, p: null, tx, tn }] por dia de MT. Usa o bloco de 1 h enquanto o próximo horário
 * vem 1 h depois e o de 6 h quando o passo abre (o último horário de hora em hora já é seguido por um de 6 h depois),
 * sem somar blocos que se sobrepõem; a chuva de cada bloco é repartida pelas horas de cada dia local que ele cobre.
 * Temperatura: no bloco de 1 h, a do instante; no de 6 h, a máxima e a mínima do bloco, contadas no dia que tem a
 * maioria das horas dele (o da 3ª hora). Só ficam os dias com as 24 horas cobertas (o de hoje, a partir da hora da
 * consulta, e o último, cortado, saem); dia sem temperatura fica com tx e tn null.
 */
export function previsaoMetNo(json) {
  const serie = Array.isArray(json?.properties?.timeseries) ? json.properties.timeseries : [];
  const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const mm = new Map();
  const horas = new Map();
  const tx = new Map();
  const tn = new Map();
  const temperatura = (dia, max, min) => {
    if (max !== null) tx.set(dia, Math.max(tx.get(dia) ?? -Infinity, max));
    if (min !== null) tn.set(dia, Math.min(tn.get(dia) ?? Infinity, min));
  };
  let cobertoAte = -Infinity;
  for (let i = 0; i < serie.length; i++) {
    const item = serie[i];
    const inicio = Date.parse(item?.time);
    if (!Number.isFinite(inicio) || inicio < cobertoAte) continue;
    const proximo = i + 1 < serie.length ? Date.parse(serie[i + 1]?.time) : Number.NaN;
    const passoDeUmaHora = Number.isFinite(proximo) && proximo - inicio <= 3_600_000;
    const um = numero(item?.data?.next_1_hours?.details?.precipitation_amount);
    const seis = numero(item?.data?.next_6_hours?.details?.precipitation_amount);
    let duracao, total;
    if (um !== null && (passoDeUmaHora || seis === null)) { duracao = 1; total = um; }
    else if (seis !== null) { duracao = 6; total = seis; }
    else continue;
    for (let h = 0; h < duracao; h++) {
      const dia = diaMT(inicio + h * 3_600_000);
      mm.set(dia, (mm.get(dia) ?? 0) + total / duracao);
      horas.set(dia, (horas.get(dia) ?? 0) + 1);
    }
    if (duracao === 1) {
      const t = numero(item?.data?.instant?.details?.air_temperature);
      temperatura(diaMT(inicio), t, t);
    } else {
      const d6 = item?.data?.next_6_hours?.details;
      temperatura(diaMT(inicio + 2 * 3_600_000), numero(d6?.air_temperature_max), numero(d6?.air_temperature_min));
    }
    cobertoAte = inicio + duracao * 3_600_000;
  }
  return [...mm].filter(([d]) => horas.get(d) >= 24).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({
    d, mm: arred1(v), p: null, tx: tx.has(d) ? arred1(tx.get(d)) : null, tn: tn.has(d) ? arred1(tn.get(d)) : null,
  }));
}
```

Em `sincronizar-plantio.d.mts`, trocar `export interface PrevDia { d: string; mm: number; p: number | null }` por:
```ts
export interface PrevDia { d: string; mm: number; p: number | null; tx?: number | null; tn?: number | null }
```

Na especificação (`2026-10-14-relatorio-previsao-design.md`, tabela da seção 2), trocar a célula da ZEUS `Não prevê temperatura: \`tx\` e \`tn\` ficam \`null\`` por `Não prevê temperatura: os dias da ZEUS não ganham \`tx\` e \`tn\` (a tela lê a falta como sem temperatura)`.

- [ ] **Step 4: Rodar e ver passar; suíte inteira**

Run (em `modulos/mapas`): `npx vitest run tests/previsao-benchmark-servidor.test.ts && npx tsc --noEmit -p . && node --check scripts/sincronizar-plantio.mjs && npx vitest run`
Expected: tudo PASS; a suíte inteira com 1.052 testes (1.050 + 2 novos).

- [ ] **Step 5: Commit (local)**

```bash
git add modulos/mapas/scripts/sincronizar-plantio.mjs modulos/mapas/scripts/sincronizar-plantio.d.mts modulos/mapas/tests/previsao-benchmark-servidor.test.ts modulos/previsao/docs/2026-10-14-relatorio-previsao-design.md
git commit -m "Previsão do Tempo: máxima e mínima na foto diária (Visual Crossing e MET Norway completo)"
```

---

### Task 2: Tela — contas do relatório (`previsao/relatorio-logica.js`)

**Files:**
- Create: `previsao/relatorio-logica.js` (UMD, como `previsao/benchmark-logica.js`)
- Test: `modulos/previsao/testes/relatorio.test.mjs`

**Interfaces:**
- Consumes: linhas de `prev_previsoes` (`{ fonte, unidade, emitida_em, capturada_em, dias: [{ d, mm, p, tx?, tn? }] }`), fazendas `{ nome, unidade }`.
- Produces (`window.PrevisaoRelatorioLogica` / `require`): `DIAS_MAX = 15`, `FOTOS_DIAS = 3`, `somarDias(dia, n)`, `montarRelatorio(previsoes, fazendas, hoje) → { fazendas: Fazenda[], fotoMaisRecente: string | null, fontesTemperatura: string[] }` com `Fazenda = { nome, unidade, dias: string[], mm, p, tx, tn: (number|null)[], fonteTemperatura: 'visualcrossing'|'metno'|null, fotos: { chuva: string|null, temperatura: string|null }, total: number|null, semDados: boolean }`; `paraPdf(texto): string`; `nomeArquivo(hoje): string`.

- [ ] **Step 1: Escrever os testes (falham)**

```js
// Testes das contas do relatório em PDF (previsao/relatorio-logica.js). Dados FICTÍCIOS.
// Rodar na raiz do repositório: node --test modulos/previsao/testes/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const R = createRequire(import.meta.url)('../../../previsao/relatorio-logica.js')
const foto = (fonte, unidade, emitida_em, dias, capturada_em = emitida_em + 'T10:20:00Z') => ({ fonte, unidade, emitida_em, capturada_em, dias })
const dia = (d, mm, p = null, tx, tn) => (tx === undefined ? { d, mm, p } : { d, mm, p, tx, tn })
const so = (previsoes, hoje = '2026-10-15') => R.montarRelatorio(previsoes, [{ nome: 'Globo', unidade: 'GLOBO' }], hoje).fazendas[0]

test('período: de hoje até o último dia com dado; a foto da véspera não traz dias passados', () => {
  const f = so([foto('zeus', 'GLOBO', '2026-10-14', [dia('2026-10-14', 9, 80), dia('2026-10-15', 2, 40), dia('2026-10-16', 0, 5)])])
  assert.deepEqual(f.dias, ['2026-10-15', '2026-10-16'])
  assert.deepEqual(f.mm, [2, 0])
  assert.deepEqual(f.p, [40, 5])
  assert.equal(f.total, 2)
  assert.equal(f.fotos.chuva, '2026-10-14T10:20:00Z')
  assert.equal(f.semDados, false)
})

test('temperatura: Visual Crossing quando a foto dele tem temperatura; senão MET Norway; senão nenhuma', () => {
  const zeus = foto('zeus', 'GLOBO', '2026-10-15', [dia('2026-10-15', 1, 10), dia('2026-10-16', 2, 20)])
  const vcSem = foto('visualcrossing', 'GLOBO', '2026-10-15', [dia('2026-10-15', 0, 0)]) // foto de antes da temperatura
  const vc = foto('visualcrossing', 'GLOBO', '2026-10-15', [dia('2026-10-15', 0, 0, 34, 22), dia('2026-10-16', 0, 0, 35, 23)])
  const met = foto('metno', 'GLOBO', '2026-10-15', [dia('2026-10-16', 0, null, 33.5, 21)], '2026-10-15T10:21:00Z')
  const comVc = so([zeus, vc, met])
  assert.equal(comVc.fonteTemperatura, 'visualcrossing')
  assert.deepEqual(comVc.tx, [34, 35])
  assert.deepEqual(comVc.tn, [22, 23])
  const r = R.montarRelatorio([zeus, vcSem, met], [{ nome: 'Globo', unidade: 'GLOBO' }], '2026-10-15')
  assert.equal(r.fazendas[0].fonteTemperatura, 'metno')
  assert.deepEqual(r.fazendas[0].tx, [null, 33.5])
  assert.deepEqual(r.fontesTemperatura, ['metno'])
  assert.equal(r.fotoMaisRecente, '2026-10-15T10:21:00Z')
  const nenhuma = so([zeus])
  assert.equal(nenhuma.fonteTemperatura, null)
  assert.deepEqual(nenhuma.tn, [null, null])
  assert.equal(nenhuma.fotos.temperatura, null)
})

test('foto com mais de 3 dias não entra; fazenda sem unidade do PIMS fica fora', () => {
  const r = R.montarRelatorio([foto('zeus', 'GLOBO', '2026-10-12', [dia('2026-10-15', 5, 50)])],
    [{ nome: 'Globo', unidade: 'GLOBO' }, { nome: 'Sem PIMS', unidade: null }], '2026-10-15')
  assert.equal(r.fazendas.length, 1)
  assert.equal(r.fazendas[0].semDados, true)
  assert.deepEqual(r.fazendas[0].dias, [])
  assert.equal(r.fazendas[0].total, null)
  assert.equal(r.fotoMaisRecente, null)
})

test('no máximo 15 dias; sem chuva, total null', () => {
  const dias = Array.from({ length: 20 }, (_, i) => dia(R.somarDias('2026-10-15', i), null, null, 30, 20))
  const f = so([foto('visualcrossing', 'GLOBO', '2026-10-15', dias)])
  assert.equal(f.dias.length, 15)
  assert.equal(f.dias[14], '2026-10-29')
  assert.equal(f.total, null)
})

test('fazendas em ordem alfabética (com acento) e foto mais recente entre todas', () => {
  const previsoes = [foto('zeus', 'TRES FLECHAS', '2026-10-15', [dia('2026-10-15', 1, 10)], '2026-10-15T10:25:00Z'), foto('zeus', 'GLOBO', '2026-10-15', [dia('2026-10-15', 3, 30)])]
  const r = R.montarRelatorio(previsoes, [{ nome: 'Três Flechas', unidade: 'TRES FLECHAS' }, { nome: 'Globo', unidade: 'GLOBO' }, { nome: 'Dourado', unidade: 'DOURADO' }], '2026-10-15')
  assert.deepEqual(r.fazendas.map((f) => f.nome), ['Dourado', 'Globo', 'Três Flechas'])
  assert.equal(r.fotoMaisRecente, '2026-10-15T10:25:00Z')
})

test('paraPdf mantém acentos, travessão, ponto e grau; troca o que a fonte do PDF não tem', () => {
  assert.equal(R.paraPdf('Três Flechas — 15/10 · 33 °C'), 'Três Flechas — 15/10 · 33 °C')
  assert.equal(R.paraPdf('≥ 10 mm'), '>= 10 mm')
  assert.equal(R.paraPdf('chuva → 🌧'), 'chuva ? ?')
  assert.equal(R.nomeArquivo('2026-10-15'), 'previsao-fazendas-2026-10-15.pdf')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test modulos/previsao/testes/*.test.mjs`
Expected: o arquivo novo falha (`Cannot find module '../../../previsao/relatorio-logica.js'`); os 26 testes anteriores passam.

- [ ] **Step 3: Implementar `previsao/relatorio-logica.js`**

```js
/* Previsão do Tempo — contas do relatório em PDF por fazenda, sem tela: período, chuva da ZEUS, temperatura do
   Visual Crossing (ou do MET Norway), fotos usadas e total. Dados: prev_previsoes (foto diária da rotina da VM).
   Serve ao navegador (window.PrevisaoRelatorioLogica) e aos testes (node --test "modulos/previsao/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PrevisaoRelatorioLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIAS_MAX = 15; // hoje até hoje + 14
  const FOTOS_DIAS = 3; // fotos de hoje, ontem e anteontem

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  function somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** A foto mais recente de uma fonte para uma fazenda, entre as dos últimos FOTOS_DIAS dias. */
  function fotoMaisRecente(previsoes, fonte, unidade, hoje) {
    const desde = somarDias(hoje, -(FOTOS_DIAS - 1));
    let melhor = null;
    previsoes.forEach((l) => {
      if (l.fonte !== fonte || l.unidade !== unidade || l.emitida_em < desde || l.emitida_em > hoje) return;
      if (!melhor || l.emitida_em > melhor.emitida_em) melhor = l;
    });
    return melhor;
  }
  const diasDa = (foto) => (foto && Array.isArray(foto.dias) ? foto.dias : []);
  const temTemperatura = (foto) => diasDa(foto).some((x) => num(x.tx) !== null || num(x.tn) !== null);
  function valor(foto, d, campo) {
    const x = diasDa(foto).find((y) => y.d === d);
    return x ? num(x[campo]) : null;
  }

  /** Uma fazenda: chuva da ZEUS, temperatura do Visual Crossing (ou do MET Norway), de hoje ao último dia com dado. */
  function fazendaDoRelatorio(previsoes, fazenda, hoje) {
    const zeus = fotoMaisRecente(previsoes, 'zeus', fazenda.unidade, hoje);
    const vc = fotoMaisRecente(previsoes, 'visualcrossing', fazenda.unidade, hoje);
    const met = fotoMaisRecente(previsoes, 'metno', fazenda.unidade, hoje);
    const temp = temTemperatura(vc) ? vc : temTemperatura(met) ? met : null;
    const todos = Array.from({ length: DIAS_MAX }, (_, i) => somarDias(hoje, i));
    let ultimo = -1;
    todos.forEach((d, i) => {
      if (valor(zeus, d, 'mm') !== null || valor(temp, d, 'tx') !== null || valor(temp, d, 'tn') !== null) ultimo = i;
    });
    const dias = todos.slice(0, ultimo + 1);
    const mm = dias.map((d) => valor(zeus, d, 'mm'));
    const comChuva = mm.filter((v) => v !== null);
    return {
      nome: fazenda.nome,
      unidade: fazenda.unidade,
      dias,
      mm,
      p: dias.map((d) => valor(zeus, d, 'p')),
      tx: dias.map((d) => valor(temp, d, 'tx')),
      tn: dias.map((d) => valor(temp, d, 'tn')),
      fonteTemperatura: temp ? temp.fonte : null,
      fotos: { chuva: zeus ? zeus.capturada_em : null, temperatura: temp ? temp.capturada_em : null },
      total: comChuva.length ? Math.round(comChuva.reduce((s, v) => s + v, 0) * 10) / 10 : null,
      semDados: !dias.length,
    };
  }

  /** O relatório: fazendas com unidade do PIMS, em ordem alfabética, a foto mais recente usada e as fontes de temperatura. */
  function montarRelatorio(previsoes, fazendas, hoje) {
    const lista = fazendas.filter((f) => f.unidade).slice()
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
      .map((f) => fazendaDoRelatorio(previsoes, f, hoje));
    const fotos = [];
    lista.forEach((f) => { if (f.fotos.chuva) fotos.push(f.fotos.chuva); if (f.fotos.temperatura) fotos.push(f.fotos.temperatura); });
    fotos.sort();
    const fontesTemperatura = [];
    lista.forEach((f) => { if (f.fonteTemperatura && fontesTemperatura.indexOf(f.fonteTemperatura) < 0) fontesTemperatura.push(f.fonteTemperatura); });
    return { fazendas: lista, fotoMaisRecente: fotos.length ? fotos[fotos.length - 1] : null, fontesTemperatura };
  }

  /* As fontes padrão do jsPDF só têm o conjunto WinAnsi: Latin-1 e estes sinais. O resto vira '?' (ou o equivalente). */
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const TROCAS = { '≥': '>=', '≤': '<=' };
  function paraPdf(texto) {
    return Array.from(String(texto).normalize('NFC'))
      .map((c) => (c.charCodeAt(0) <= 0xff || WINANSI_EXTRA.indexOf(c) >= 0 ? c : TROCAS[c] || '?'))
      .join('');
  }
  const nomeArquivo = (hoje) => 'previsao-fazendas-' + hoje + '.pdf';

  return { DIAS_MAX, FOTOS_DIAS, somarDias, montarRelatorio, paraPdf, nomeArquivo };
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test modulos/previsao/testes/*.test.mjs`
Expected: PASS (26 anteriores + 6 novos = 32).

- [ ] **Step 5: Commit (local)**

```bash
git add previsao/relatorio-logica.js modulos/previsao/testes/relatorio.test.mjs
git commit -m "Previsão do Tempo: contas do relatório em PDF por fazenda"
```

---

### Task 3: Tela — botão, gráficos e PDF

**Files:**
- Create: `previsao/relatorio.js`
- Modify: `previsao/index.html` (botão, aviso de erro, scripts, `?v=`)
- Modify: `previsao/app.js` (leitura do relatório e do nome do usuário; clique do botão)
- Modify: `previsao/estilo.css` (aviso de erro)
- Modify: `modulos/previsao/scripts/servidor-local.mjs` (temperatura fictícia)

**Interfaces:**
- Consumes: `window.PrevisaoRelatorioLogica` (Tarefa 2); `window.PrevisaoBenchmark.hojeMT` (já existe); `window.echarts`.
- Produces: `window.PrevisaoRelatorio = { gerar(ctx): Promise<void> }` com `ctx = { hoje(): string, carregar(hoje): Promise<linhas de prev_previsoes>, usuario(): Promise<string>, fazendas(): { nome, unidade }[] }`. Fonte de dados do módulo ganha `relatorio(hoje)` e `usuario()`.

- [ ] **Step 1: `previsao/relatorio.js`**

```js
/* =====================================================================
   Previsão do Tempo — relatório em PDF por fazenda (botão "Relatório (PDF)" da barra): capa e uma página por
   fazenda com a máxima e a mínima em cima, a chuva da ZEUS embaixo e a faixa com os números de cada dia.
   Contas em relatorio-logica.js; gráficos com ECharts desenhados fora da tela; PDF com jsPDF 2.5.1, carregado só
   no clique (como no relatório do Operacional). Todo texto do PDF passa por paraPdf (fonte padrão do jsPDF).
===================================================================== */
(function () {
  'use strict';

  const R = window.PrevisaoRelatorioLogica;
  const COR = { max: '#db8a08', min: '#5470c6', chuva: '#0f9484', texto: '#17251F', suave: '#5B6B62', marca: '#0C5A50', faixa: '#F1F4F1' };
  const A4 = { largura: 297, altura: 210, margem: 12 };
  const GRAFICO = { largura: 1600, altura: 640 };
  let jsPdfCarregando = null;

  function carregarJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfCarregando) jsPdfCarregando = new Promise(function (ok, falha) {
      const s = document.createElement('script');
      // versão fixa conferida pelo navegador (SRI): arquivo diferente do esperado não roda
      s.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
      s.crossOrigin = 'anonymous';
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function () { ok(window.jspdf.jsPDF); };
      s.onerror = function () { jsPdfCarregando = null; falha(new Error('Não foi possível carregar o gerador de PDF. Verifique a conexão.')); };
      document.head.appendChild(s);
    });
    return jsPdfCarregando;
  }
  /** Imagem do próprio site (logos) como data URL; null se não abrir (o PDF sai sem ela). */
  async function imagem(caminho) {
    try {
      const r = await fetch(caminho);
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(blob); });
    } catch (e) {
      return null;
    }
  }

  const fmtDia = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const fmtSemana = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  const fmtNum = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  const fmtHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const nomeFonte = (id) => (id === 'metno' ? 'MET Norway (CC BY 4.0)' : id === 'visualcrossing' ? 'Visual Crossing' : '');
  const texto = (pdf, t, x, y, opcoes) => pdf.text(R.paraPdf(t), x, y, opcoes);

  /** Gráfico de uma fazenda como PNG: temperatura em cima e chuva embaixo, com as mesmas datas (um painel só se faltar um). */
  function grafico(f) {
    const temTemp = f.tx.some((v) => v !== null) || f.tn.some((v) => v !== null);
    const temChuva = f.mm.some((v) => v !== null);
    const paineis = [temTemp ? 'temp' : null, temChuva ? 'chuva' : null].filter(Boolean);
    const datas = f.dias.map((d) => fmtSemana(d) + ' ' + fmtDia(d));
    const eixo = { fontSize: 20, color: COR.suave };
    const grid = [], xAxis = [], yAxis = [], series = [];
    paineis.forEach((p, i) => {
      const dois = paineis.length === 2;
      grid.push({ left: 80, right: 30, top: dois ? (i === 0 ? 60 : 345) : 60, height: dois ? 240 : 525 });
      xAxis.push({ type: 'category', gridIndex: i, data: datas, axisLabel: Object.assign({ show: i === paineis.length - 1 }, eixo), axisTick: { alignWithLabel: true } });
      if (p === 'temp') {
        yAxis.push({ type: 'value', gridIndex: i, scale: true, name: '°C', nameTextStyle: eixo, axisLabel: eixo });
        series.push({ name: 'Máxima (°C)', type: 'line', xAxisIndex: i, yAxisIndex: i, data: f.tx, symbolSize: 10, lineStyle: { width: 4, color: COR.max }, itemStyle: { color: COR.max } });
        series.push({ name: 'Mínima (°C)', type: 'line', xAxisIndex: i, yAxisIndex: i, data: f.tn, symbolSize: 10, lineStyle: { width: 4, color: COR.min }, itemStyle: { color: COR.min } });
      } else {
        yAxis.push({ type: 'value', gridIndex: i, min: 0, name: 'mm', nameTextStyle: eixo, axisLabel: eixo });
        series.push({ name: 'Chuva (mm) — ZEUS', type: 'bar', xAxisIndex: i, yAxisIndex: i, data: f.mm, barMaxWidth: 52, itemStyle: { color: COR.chuva, borderRadius: [4, 4, 0, 0] } });
      }
    });
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + GRAFICO.largura + 'px;height:' + GRAFICO.altura + 'px;';
    document.body.appendChild(div);
    const c = window.echarts.init(div, null, { renderer: 'canvas', width: GRAFICO.largura, height: GRAFICO.altura });
    try {
      c.setOption({ animation: false, backgroundColor: '#fff', legend: { top: 0, textStyle: { fontSize: 20, color: COR.texto } }, grid, xAxis, yAxis, series });
      return c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    } finally {
      c.dispose();
      div.remove();
    }
  }

  function rodape(pdf, n) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(COR.suave);
    texto(pdf, 'COA WEB · Previsão do Tempo · relatório por fazenda', A4.margem, A4.altura - 7);
    texto(pdf, String(n), A4.largura - A4.margem, A4.altura - 7, { align: 'right' });
  }

  function capa(pdf, rel, info) {
    const m = A4.margem;
    if (info.logoCoa) pdf.addImage(info.logoCoa, 'PNG', m, m, 62, 62 * 234 / 900);
    if (info.logoLocks) pdf.addImage(info.logoLocks, 'PNG', A4.largura - m - 72, m + 6, 72, 72 * 70 / 900);
    pdf.setTextColor(COR.marca);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(30);
    texto(pdf, 'Previsão do Tempo — Fazendas', m, 82);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(14);
    pdf.setTextColor(COR.texto);
    texto(pdf, 'Emitido em ' + info.hojeTexto + ' · previsão da foto de ' + fmtHora(rel.fotoMaisRecente), m, 94);
    const temp = rel.fontesTemperatura.map(nomeFonte).join(' e ') || 'indisponível nesta emissão';
    const linhas = [
      'Fazendas: ' + rel.fazendas.map((f) => f.nome).join(', ') + '.',
      'Chuva: ZEUS (Locks), média dos pluviômetros de cada fazenda, com a probabilidade de chuva.',
      'Temperatura máxima e mínima: ' + temp + '.',
      'Dados de Visual Crossing (visualcrossing.com) e de MET Norway (api.met.no), CC BY 4.0, quando usados.',
      'Gerado por ' + info.usuario + ' em ' + info.agoraTexto + '.',
    ];
    pdf.setFontSize(11);
    pdf.setTextColor(COR.suave);
    let y = 112;
    linhas.forEach((t) => {
      pdf.splitTextToSize(R.paraPdf(t), A4.largura - 2 * m).forEach((l) => { pdf.text(l, m, y); y += 6; });
      y += 2;
    });
    rodape(pdf, 1);
  }

  /** Faixa de números: uma coluna por dia (data, chuva, probabilidade, máxima, mínima) e o total de chuva. */
  function faixa(pdf, f, topo) {
    const m = A4.margem;
    const largura = A4.largura - 2 * m;
    const rotulo = 32;
    const coluna = (largura - rotulo) / f.dias.length;
    const altura = 6.4;
    const linhas = [
      ['Dia', f.dias.map(fmtDia)],
      ['Chuva (mm)', f.mm.map(fmtNum)],
      ['Prob. de chuva (%)', f.p.map((v) => (v === null ? '—' : String(v)))],
      ['Máxima (°C)', f.tx.map(fmtNum)],
      ['Mínima (°C)', f.tn.map(fmtNum)],
    ];
    pdf.setFontSize(8.5);
    linhas.forEach(([nome, valores], i) => {
      const y = topo + i * altura;
      if (i % 2 === 0) { pdf.setFillColor(COR.faixa); pdf.rect(m, y - 4.4, largura, altura, 'F'); }
      pdf.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      pdf.setTextColor(i === 0 ? COR.suave : COR.texto);
      texto(pdf, nome, m + 1.5, y);
      valores.forEach((v, j) => texto(pdf, v, m + rotulo + coluna * (j + 0.5), y, { align: 'center' }));
    });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(COR.texto);
    texto(pdf, 'Chuva prevista no período (ZEUS): ' + (f.total === null ? '—' : fmtNum(f.total) + ' mm'), m, topo + linhas.length * altura + 4);
  }

  function paginaDaFazenda(pdf, f, n) {
    const m = A4.margem;
    const largura = A4.largura - 2 * m;
    pdf.setTextColor(COR.marca);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    texto(pdf, f.nome, m, 18);
    pdf.setFont('helvetica', 'normal');
    if (f.semDados) {
      pdf.setFontSize(12);
      pdf.setTextColor(COR.texto);
      texto(pdf, 'Sem previsão recente para esta fazenda (nenhuma foto nos últimos ' + R.FOTOS_DIAS + ' dias).', m, 34);
      rodape(pdf, n);
      return;
    }
    const chuva = f.fotos.chuva ? 'chuva: ZEUS (Locks), foto de ' + fmtHora(f.fotos.chuva) : 'chuva da ZEUS indisponível';
    const temp = f.fonteTemperatura ? 'temperatura: ' + nomeFonte(f.fonteTemperatura) + ', foto de ' + fmtHora(f.fotos.temperatura) : 'temperatura indisponível';
    pdf.setFontSize(9.5);
    pdf.setTextColor(COR.suave);
    texto(pdf, fmtDia(f.dias[0]) + ' a ' + fmtDia(f.dias[f.dias.length - 1]) + ' · ' + chuva + ' · ' + temp, m, 25);
    const alturaGrafico = largura * GRAFICO.altura / GRAFICO.largura;
    pdf.addImage(grafico(f), 'PNG', m, 29, largura, alturaGrafico, undefined, 'FAST');
    faixa(pdf, f, 29 + alturaGrafico + 7);
    rodape(pdf, n);
  }

  /** Gera e baixa o PDF de todas as fazendas que o usuário vê. */
  async function gerar(ctx) {
    const hoje = ctx.hoje();
    const r = await Promise.all([
      carregarJsPdf(),
      ctx.carregar(hoje),
      ctx.usuario().catch(() => ''),
      imagem('../assets/logo-coa-relatorio.png'),
      imagem('../assets/locks-agtech-lab.png'),
    ]);
    const rel = R.montarRelatorio(r[1], ctx.fazendas(), hoje);
    if (!rel.fazendas.length) throw new Error('nenhuma fazenda com unidade do PIMS para o seu usuário.');
    const JsPdf = r[0];
    const pdf = new JsPdf({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    capa(pdf, rel, {
      logoCoa: r[3],
      logoLocks: r[4],
      usuario: r[2] || 'usuário do COA WEB',
      hojeTexto: fmtDia(hoje) + '/' + hoje.slice(0, 4),
      agoraTexto: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    rel.fazendas.forEach((f, i) => { pdf.addPage('a4', 'landscape'); paginaDaFazenda(pdf, f, i + 2); });
    pdf.setProperties({ title: R.paraPdf('Previsão do Tempo — Fazendas — ' + fmtDia(hoje)), creator: 'COA WEB' });
    pdf.save(R.nomeArquivo(hoje));
  }

  window.PrevisaoRelatorio = { gerar };
})();
```

- [ ] **Step 2: `previsao/index.html`**

1. Logo depois do `</div>` que fecha `<div class="barra-acoes" id="acoes-mapa">`, acrescentar:
```html
    <div class="barra-acoes">
      <button class="botao-acao" id="btn-relatorio" title="PDF com a previsão dos próximos dias de cada fazenda: chuva da ZEUS e temperatura máxima e mínima">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg><span>Relatório (PDF)</span>
      </button>
      <span class="relatorio-erro" id="relatorio-erro" role="alert" hidden></span>
    </div>
```
2. Antes de `<script src="app.js?…">`, acrescentar:
```html
<script src="relatorio-logica.js?v=202610142300"></script>
<script src="relatorio.js?v=202610142300"></script>
```
3. Trocar o `?v=` de `app.js` e de `estilo.css` para `202610142300`.

- [ ] **Step 3: `previsao/app.js`**

1. Em `fonteSupabase()`, depois do método `benchmark`, acrescentar:
```js
      // relatório em PDF: as fotos dos últimos 3 dias (a mais recente de cada fonte e fazenda)
      relatorio: async function (hoje) {
        return tudo(() => sb.from('prev_previsoes').select('fonte,unidade,emitida_em,capturada_em,dias')
          .gte('emitida_em', window.PrevisaoRelatorioLogica.somarDias(hoje, -2)).order('emitida_em').order('fonte').order('unidade'), 1000);
      },
      // quem gerou o relatório (capa): o nome do perfil, sem cair para o e-mail
      usuario: async function () {
        const u = await sb.auth.getUser();
        const id = u && u.data && u.data.user ? u.data.user.id : null;
        if (!id) return '';
        const r = await sb.from('perfis').select('nome').eq('id', id).maybeSingle();
        return r.data && r.data.nome ? String(r.data.nome) : '';
      },
```
2. Em `fonteLocal()`, depois do método `benchmark`, acrescentar:
```js
      relatorio: async function () {
        const r = await fetch('/api/previsao-benchmark-teste');
        if (!r.ok) throw new Error('servidor local sem dados de teste do benchmark');
        return (await r.json()).previsoes;
      },
      usuario: async function () { return 'Usuário de teste'; },
```
3. Depois da linha `$('sel-modelo').addEventListener('change', …);`, acrescentar:
```js

  /* ------------------------------ relatório em PDF ------------------------------ */
  $('btn-relatorio').addEventListener('click', async () => {
    const b = $('btn-relatorio');
    if (!iniciado || b.disabled) return;
    const rotulo = b.querySelector('span');
    const antes = rotulo.textContent;
    b.disabled = true;
    rotulo.textContent = 'Gerando…';
    $('relatorio-erro').hidden = true;
    try {
      await window.PrevisaoRelatorio.gerar({
        hoje: () => window.PrevisaoBenchmark.hojeMT(),
        carregar: (hoje) => fonte.relatorio(hoje),
        usuario: () => fonte.usuario(),
        fazendas: () => fazendas.map((f) => ({ nome: f.nome, unidade: f.unidade })),
      });
    } catch (e) {
      console.warn('PREVISÃO: relatório não gerado', e);
      $('relatorio-erro').textContent = 'Não foi possível gerar o relatório: ' + (e && e.message ? e.message : e);
      $('relatorio-erro').hidden = false;
    } finally {
      b.disabled = false;
      rotulo.textContent = antes;
    }
  });
```

- [ ] **Step 4: `previsao/estilo.css`** (acrescentar no fim)

```css
/* ------------------------------ relatório em PDF ------------------------------ */
.relatorio-erro { color: #9b2c1f; font-size: 12px; max-width: 280px; line-height: 1.3; }
#btn-relatorio:disabled { opacity: .6; cursor: progress; }
```

- [ ] **Step 5: Servidor local com temperatura fictícia**

Em `modulos/previsao/scripts/servidor-local.mjs`, na função `benchmarkTeste`, trocar a linha:
```js
        dias.push({ d, mm: Math.max(0, Math.round((base + (sorteio() - 0.5) * erro[fonte] * (1 + k / 5)) * 10) / 10), p: fonte === 'metno' ? null : Math.round(sorteio() * 100) });
```
por:
```js
        const temp = fonte === 'zeus' ? {} : { tx: 30 + ((k + unidades.indexOf(u)) % 5), tn: 19 + ((2 * k + unidades.indexOf(u)) % 4) };
        dias.push({ d, mm: Math.max(0, Math.round((base + (sorteio() - 0.5) * erro[fonte] * (1 + k / 5)) * 10) / 10), p: fonte === 'metno' ? null : Math.round(sorteio() * 100), ...temp });
```

- [ ] **Step 6: Verificar no navegador local**

Run: `node --check previsao/app.js && node --check previsao/relatorio.js && node --check modulos/previsao/scripts/servidor-local.mjs && node --test modulos/previsao/testes/*.test.mjs`
Expected: sem erro; 32 testes passando.

Depois, com o servidor local (`coa-web-benchmark-local`, porta 8791) em `http://localhost:8791/previsao/#benchmark`:
1. Clicar no botão uma vez (baixa `previsao-fazendas-AAAA-MM-DD.pdf` e deixa o jsPDF carregado). Para ver o PDF na própria aba, desviar o download no console, embrulhando o construtor (o `gerar` pega `window.jspdf.jsPDF` de novo a cada clique): `const O = window.jspdf.jsPDF; window.jspdf.jsPDF = function (...a) { const d = new O(...a); d.save = () => { window.__pdf = d.output('bloburl'); }; return d; };`, clicar de novo e abrir `location.href = window.__pdf`.
2. Conferir: capa com os dois logos, título, data da foto, fazendas, fontes e "Gerado por Usuário de teste"; uma página por fazenda de teste com os dois painéis (máxima laranja e mínima azul em cima, barras verdes embaixo, mesmas datas), faixa de números alinhada e total; rodapé com o número da página; nenhum caractere estranho.
3. Botão: fica "Gerando…" e desativado enquanto monta; console sem erro.
4. Aba Mapa e aba Benchmark continuam iguais (botão visível nas duas).
5. Caso sem temperatura: no console, `window.PrevisaoRelatorio.gerar({ hoje: () => window.PrevisaoBenchmark.hojeMT(), carregar: async () => (await (await fetch('/api/previsao-benchmark-teste')).json()).previsoes.filter((l) => l.fonte === 'zeus'), usuario: async () => 'Teste', fazendas: () => [{ nome: 'Teste Norte', unidade: 'TESTE NORTE' }, { nome: 'Sem foto', unidade: 'NENHUMA' }] })` → página com só o painel da chuva e "temperatura indisponível", e a página "Sem previsão recente" para a segunda.

- [ ] **Step 7: Commit (local)**

```bash
git add previsao/ modulos/previsao/scripts/servidor-local.mjs
git commit -m "Previsão do Tempo: botão Relatório (PDF) com capa e uma página por fazenda"
```

---

### Task 4: Entrada no ar

**Files:** nenhum novo.

- [ ] **Step 1: Suítes completas**

Run: `cd modulos/mapas && npx vitest run && npx tsc --noEmit -p . && cd ../.. && node --test modulos/previsao/testes/*.test.mjs`
Expected: tudo PASS (1.052 e 32).

- [ ] **Step 2: PDF com dados reais, fora do repositório**

1. `node "C:/Users/bruno.moraes/Documents/CLAUDE GERAL/doc-coa-web/_trabalho/conferir_benchmark.mjs" --json` (agora com a temperatura do MET Norway no JSON; Visual Crossing só se houver chave no ambiente desta máquina, o que não é o caso).
2. Subir `coa-web-benchmark-real` e, em `http://localhost:8791/previsao/#benchmark`, gerar pelo console com as unidades reais (os nomes ficam só nesta máquina): `window.PrevisaoRelatorio.gerar({ hoje: () => window.PrevisaoBenchmark.hojeMT(), carregar: async () => (await (await fetch('/api/previsao-benchmark-teste')).json()).previsoes, usuario: async () => 'Conferência local', fazendas: () => ['DOURADO','GLOBO','GUAPIRAMA','NEBRASKA','SIRIEMA','SM3','TRES FLECHAS'].map((u) => ({ nome: u === 'TRES FLECHAS' ? 'Três Flechas' : u.charAt(0) + u.slice(1).toLowerCase(), unidade: u })) })`, depois de carregar o jsPDF (um clique no botão) e com o desvio do `save` do Step 6 da Tarefa 3 para ver o PDF.
3. Capturas da capa e de duas páginas (uma delas "Três Flechas") mostradas ao dono; imagens em `doc-coa-web/_trabalho/`.

- [ ] **Step 3: Pedir "pode publicar" e publicar**

Levar o branch `relatorio-previsao` ao `main` (fast-forward), rodar as suítes no `main`, `git push origin main`, apagar o branch. Conferir que o site serve `previsao/relatorio.js?v=202610142300` e que o `raw.githubusercontent.com` tem `locationforecast/2.0/complete` em `sincronizar-plantio.mjs`.

- [ ] **Step 4: Conferir a temperatura na primeira foto** (no dia seguinte, depois das 6:17 de MT), por leitura no SQL Editor:

```sql
select fonte, unidade, jsonb_array_length(dias) as dias,
       (select count(*) from jsonb_array_elements(dias) x where x ? 'tx' and x->>'tx' is not null) as com_temperatura
from public.prev_previsoes where emitida_em = (now() at time zone 'America/Cuiaba')::date order by 1, 2;
```
Expected: `metno` (e `visualcrossing`, se a chave já estiver na VM) com `com_temperatura` igual a `dias`; `zeus` com 0.

- [ ] **Step 5: Atualizar a memória do projeto** (`previsao-tempo-coa.md`): relatório no ar, data, commit.
