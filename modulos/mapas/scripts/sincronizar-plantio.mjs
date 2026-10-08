// Sincroniza o status de plantio do PIMS (via Agrovex MCP). Com SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY no ambiente, grava em mapas_plantio_pims (upsert + limpeza das linhas
// que sumiram do PIMS); sem elas, grava public/dados/plantio.json como antes (uso local).
// Uso: AGROVEX_TOKEN=... node scripts/sincronizar-plantio.mjs   (ou npm run plantio)
// Configuração: scripts/plantio.config.json  { "safras": "auto" | ["SOJA 26/27", ...], "url": "..." }
// Sem dependências (Node >= 20, fetch nativo). O token e a chave de serviço nunca são gravados nem impressos;
// no Supabase ou no GitHub Actions (logs públicos) o log só traz totais, sem nomes de fazenda (linhasDeLog).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USER_AGENT = 'mapa-chuva-coa/1.0'; // o Cloudflare do Agrovex bloqueia user-agents genéricos (erro 1010)
const PROTOCOLO = '2025-06-18';
const TEMPO_LIMITE_MS = 120_000;
const SQL_SAFRAS = 'SELECT DE_PER_SAFRA FROM PIMSMCPRD.dbo.PERIODOSAFRA';
/** Bases do Agrovex usadas aqui: PIMS (SQL Server) e ZEUS (clima, PostgreSQL). */
const FONTES = {
  pims: { nome: 'PIMS', source: 'sqlserver', database: 'PIMSMCPRD', schema: 'dbo' },
  zeus: { nome: 'ZEUS', source: 'zeus', database: 'LKS_DATABASE_ZEUS', schema: 'DATABASE' },
};

// ---------- regras puras ----------

/** Normaliza o código do talhão (mesma regra de src/lib/codigoTalhao.ts; duplicada porque o script roda sem bundler). */
export function normalizarCodigo(s) {
  if (s === null || s === undefined) return '';
  let c = String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
  c = c.replace(/^(?:TALHAO|TH)(?:[\s-]+|(?=\d))/, '').trim();
  if (c === '') return '';
  // '02PIVO' (forma do PIMS) precisa continuar '02PIVO' — senão a regra numérica abaixo daria '002PIVO'
  const pivo = /^PIVO?\s*-?\s*(\d+)$/.exec(c) ?? /^(\d+)\s*-?\s*PIVO$/.exec(c);
  if (pivo) return semZeros(pivo[1]).padStart(2, '0') + 'PIVO';
  const numero = /^(\d+)[\s-]*([A-Z]*)$/.exec(c);
  if (numero) return semZeros(numero[1]).padStart(3, '0') + numero[2];
  return c.replace(/\s+/g, '');
}

function semZeros(d) {
  return d.replace(/^0+(?=\d)/, '');
}

/** SQL validada no Agrovex (28/09/2026); o status é calculado em JS por classificar(). Sem comentários '--' (o validador recusa). */
export function montarSql(nomeSafra) {
  const safra = `'${String(nomeSafra).replace(/'/g, "''")}'`;
  return `SELECT u.DE_UNI_ADM AS unidade, u2.DE_UPNIVEL2 AS setor, up.CD_UPNIVEL3 AS codigo, ps.DE_PER_SAFRA AS safra,
  up.QT_AREA_PROD AS area_prevista, ISNULL(a.area_plantada,0) AS area_plantada,
  CONVERT(varchar(10), a.primeira, 120) AS plantio_inicio, CONVERT(varchar(10), a.ultima, 120) AS plantio_fim,
  CONVERT(varchar(10), up.DT_PLANT_ENC, 120) AS plantio_encerrado, v.DE_VARIEDADE AS variedade
FROM PIMSMCPRD.dbo.UPNIVEL3 up
JOIN PIMSMCPRD.dbo.PERIODOSAFRA ps ON up.ID_PERIODOSAFRA = ps.ID_PERIODOSAFRA
JOIN PIMSMCPRD.dbo.UPNIVEL2 u2 ON up.ID_UPNIVEL2 = u2.ID_UPNIVEL2
JOIN PIMSMCPRD.dbo.UPNIVEL1 u1 ON u2.ID_UPNIVEL1 = u1.ID_UPNIVEL1
JOIN PIMSMCPRD.dbo.UNIDADEADM u ON u1.ID_UNIDADEADM = u.ID_UNIDADEADM
LEFT JOIN PIMSMCPRD.dbo.VARIEDADE v ON v.ID_VARIEDADE = up.ID_VARIEDADE
LEFT JOIN (SELECT ID_UPNIVEL3, ID_PERIODOSAFRA, SUM(QT_AREA) AS area_plantada, MIN(DT_OPERACAO) AS primeira, MAX(DT_OPERACAO) AS ultima
           FROM PIMSMCPRD.dbo.APPLANTIO GROUP BY ID_UPNIVEL3, ID_PERIODOSAFRA) a
  ON a.ID_UPNIVEL3 = up.ID_UPNIVEL3 AND a.ID_PERIODOSAFRA = up.ID_PERIODOSAFRA
WHERE ps.DE_PER_SAFRA = ${safra}
ORDER BY unidade, codigo`;
}

/** plantado = plantio encerrado ou apontado >= 99% da área prevista; plantando = 0 < apontado < 99%; a_plantar = sem apontamento. */
export function classificar({ areaPrevista, areaPlantada, plantioEncerrado }) {
  if (plantioEncerrado) return 'plantado';
  const plantada = Number(areaPlantada) || 0;
  const prevista = Number(areaPrevista) || 0;
  if (plantada <= 0) return 'a_plantar';
  return plantada >= prevista * 0.99 - 1e-9 ? 'plantado' : 'plantando';
}

/** Padrões dos nomes de safra do ano-safra corrente e do seguinte (ano-safra de setembro a agosto). */
export function safrasPadrao(hoje = new Date()) {
  const aa = (hoje.getFullYear() - (hoje.getMonth() >= 8 ? 0 : 1)) % 100;
  const par = (a) => `%${String(a % 100).padStart(2, '0')}/${String((a + 1) % 100).padStart(2, '0')}`;
  return [par(aa), par(aa + 1)];
}

/**
 * Nomes do PIMS (sem espaços nas pontas, sem repetição, em ordem) que terminam em algum dos padrões '%AA/AA'
 * e não começam por nenhum dos prefixos excluídos (safras não agrícolas: ADM, CORREC…; sem acento, maiúsculas).
 */
export function filtrarSafras(nomes, padroes, excluirPrefixos = []) {
  const fins = padroes.map((p) => p.replace(/^%/, ''));
  const excluir = excluirPrefixos.map(chaveNome).filter(Boolean);
  const ok = (n) =>
    fins.some((f) => n.endsWith(f) && !/\d/.test(n.charAt(n.length - f.length - 1))) &&
    !excluir.some((p) => chaveNome(n).startsWith(p));
  return [...new Set(nomes.map((n) => String(n ?? '').trim()).filter((n) => n && ok(n)))].sort(comparar);
}

function chaveNome(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
}

function comparar(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- cliente MCP (Streamable HTTP) ----------

async function lerResposta(resp, token = '') {
  const texto = await resp.text();
  // 403 com "error code: NNNN" é o Cloudflare do Agrovex barrando este servidor (não é o token)
  const cloudflare = resp.status === 403 ? /error code: (\d+)/i.exec(texto) : null;
  if (cloudflare) {
    throw new Error(`O servidor de dados do PIMS bloqueou o acesso deste servidor (erro ${cloudflare[1]}); o token não foi recusado.`);
  }
  if (resp.status === 403 && /cloudflare|<html/i.test(texto)) {
    throw new Error('O servidor de dados do PIMS barrou este servidor com uma página de verificação (HTTP 403); o token não foi recusado.');
  }
  if (resp.status === 401 || resp.status === 403) {
    // o corpo do Agrovex é curto ({"error": ...}) e não traz o token; mesmo assim ele é tirado da mensagem
    const corpo = token ? texto.split(token).join('[REDACTED]') : texto;
    throw new Error(`O servidor de dados do PIMS recusou o acesso (HTTP ${resp.status}): verifique o token de acesso do servidor. Resposta: ${corpo.replace(/s+/g, ' ').slice(0, 150)}`);
  }
  if (!resp.ok) throw new Error(`O servidor de dados do PIMS respondeu HTTP ${resp.status}: ${texto.slice(0, 300)}`);
  const t = texto.trim();
  if (!t) return null;
  let json;
  try {
    if (t.startsWith('{')) json = JSON.parse(t);
    else {
      const dados = t.split(/\r?\n/).filter((l) => l.startsWith('data:'));
      if (!dados.length) throw new Error('sem linha data:');
      json = JSON.parse(dados[dados.length - 1].slice(5).trim());
    }
  } catch {
    throw new Error(`Resposta ilegível do servidor de dados do PIMS: ${t.slice(0, 300)}`);
  }
  if (json?.error) throw new Error(`Servidor de dados do PIMS: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json;
}

async function abrirSessao(url, token, fetchImpl) {
  let sessao = null;
  let protocolo = null;
  let id = 0;
  const enviar = async (metodoHttp, corpo) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': USER_AGENT,
    };
    if (sessao) headers['Mcp-Session-Id'] = sessao;
    if (protocolo) headers['MCP-Protocol-Version'] = protocolo;
    const init = { method: metodoHttp, headers, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) };
    if (corpo) init.body = JSON.stringify(corpo);
    return fetchImpl(url, init);
  };

  const respIni = await enviar('POST', {
    jsonrpc: '2.0', id: ++id, method: 'initialize',
    params: { protocolVersion: PROTOCOLO, capabilities: {}, clientInfo: { name: 'mapa-chuva-coa', version: '1.0' } },
  });
  sessao = respIni.headers.get('mcp-session-id');
  const ini = await lerResposta(respIni, token);
  protocolo = ini?.result?.protocolVersion ?? PROTOCOLO;
  await lerResposta(await enviar('POST', { jsonrpc: '2.0', method: 'notifications/initialized' }), token);

  return {
    /** Executa uma SELECT no PIMS (ou na ZEUS, com fonte = FONTES.zeus) e devolve { columns, rows }. */
    async consultar(sql, pergunta, rotulo, fonte = FONTES.pims) {
      const r = await lerResposta(await enviar('POST', {
        jsonrpc: '2.0', id: ++id, method: 'tools/call',
        params: {
          name: 'execute_query',
          arguments: { sql, source: fonte.source, database: fonte.database, schema: fonte.schema, original_question: pergunta, full: true },
        },
      }), token);
      const texto = r?.result?.content?.[0]?.text ?? '';
      const nome = fonte.nome;
      if (r?.result?.isError) throw new Error(`Consulta ao ${nome} falhou (${rotulo}): ${texto}`);
      let dados;
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new Error(`Consulta ao ${nome} falhou (${rotulo}): resposta inesperada: ${String(texto).slice(0, 300)}`);
      }
      if (dados?.status !== 'success') {
        const msg = dados?.message ?? dados?.error ?? dados?.detail ?? JSON.stringify(dados);
        throw new Error(`Consulta ao ${nome} falhou (${rotulo}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      }
      if (dados.truncated) throw new Error(`Consulta ao ${nome} falhou (${rotulo}): resultado truncado (${dados.row_count} linhas).`);
      return { columns: dados.columns ?? [], rows: dados.rows ?? [] };
    },
    async fechar() {
      if (!sessao) return;
      try {
        await enviar('DELETE');
      } catch {
        /* encerrar a sessão é cortesia; o servidor expira sozinho */
      }
    },
  };
}

// ---------- montagem do plantio.json ----------

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const txt = (x) => (x === null || x === undefined ? null : String(x).trim() || null);

function montarUnidades({ columns, rows }, rotulo) {
  const idx = new Map(columns.map((c, i) => [String(c).toLowerCase(), i]));
  for (const c of ['unidade', 'setor', 'codigo', 'area_prevista', 'area_plantada', 'plantio_inicio', 'plantio_fim', 'plantio_encerrado', 'variedade']) {
    if (!idx.has(c)) throw new Error(`Consulta ao PIMS falhou (${rotulo}): coluna "${c}" ausente no resultado.`);
  }
  const v = (r, c) => r[idx.get(c)] ?? null;
  const porUnidade = new Map();
  for (const r of rows) {
    const unidade = txt(v(r, 'unidade')) ?? '(sem unidade)';
    const codigoPims = txt(v(r, 'codigo')) ?? '';
    const areaPrevista = num(v(r, 'area_prevista'));
    const areaPlantada = num(v(r, 'area_plantada'));
    const talhao = {
      codigo: normalizarCodigo(codigoPims),
      codigoPims,
      setor: txt(v(r, 'setor')),
      status: classificar({ areaPrevista, areaPlantada, plantioEncerrado: txt(v(r, 'plantio_encerrado')) }),
      areaPrevista,
      areaPlantada,
      inicio: txt(v(r, 'plantio_inicio')),
      fim: txt(v(r, 'plantio_fim')),
      variedade: txt(v(r, 'variedade')),
    };
    if (!porUnidade.has(unidade)) porUnidade.set(unidade, []);
    porUnidade.get(unidade).push(talhao);
  }
  return [...porUnidade.keys()].sort(comparar).map((unidade) => ({
    unidade,
    talhoes: porUnidade.get(unidade).sort((a, b) =>
      comparar(a.codigo, b.codigo) || comparar(a.setor ?? '', b.setor ?? '') || comparar(a.codigoPims, b.codigoPims)),
  }));
}

/** Consulta o PIMS pelo Agrovex e devolve o conteúdo de plantio.json (não grava nada). */
export async function sincronizar({ url, token, safras, excluirPrefixos = [], fetchImpl = fetch, agora = new Date() }) {
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    let nomes;
    if (safras === 'auto') {
      const lista = await cliente.consultar(SQL_SAFRAS, 'lista de safras do PIMS', 'lista de safras');
      nomes = filtrarSafras(lista.rows.map((r) => r[0]), safrasPadrao(agora), excluirPrefixos);
      if (!nomes.length) throw new Error(`Nenhuma safra do PIMS termina em ${safrasPadrao(agora).join(' ou ')}.`);
    } else {
      nomes = [...new Set(safras.map((s) => String(s).trim()).filter(Boolean))];
    }
    const resultado = [];
    for (const nome of nomes) {
      const r = await cliente.consultar(montarSql(nome), `status de plantio por talhão ${nome}`, nome);
      resultado.push({ nome, unidades: montarUnidades(r, nome) });
    }
    resultado.sort((a, b) => comparar(a.nome, b.nome));
    return { versao: 1, geradoEm: agora.toISOString(), fonte: 'PIMS', safras: resultado };
  } finally {
    await cliente.fechar();
  }
}

/** Mesmo conteúdo (ignorando geradoEm): evita commit/deploy a cada hora sem mudança no PIMS. */
export function mesmosDados(antigo, novo) {
  if (!antigo || antigo.versao !== novo.versao || antigo.fonte !== novo.fonte) return false;
  return JSON.stringify(antigo.safras) === JSON.stringify(novo.safras);
}

// ---------- gravação no Supabase (upsert + limpeza) ----------

/** PlantioPimsArquivo → linhas de mapas_plantio_pims (uma por safra × unidade; só unidades com talhões). */
export function linhasSupabase(arquivo) {
  const linhas = [];
  for (const s of arquivo.safras) {
    for (const u of s.unidades) {
      if (!u.talhoes.length) continue;
      linhas.push({ safra: s.nome, unidade: u.unidade, gerado_em: arquivo.geradoEm, talhoes: u.talhoes });
    }
  }
  return linhas;
}

/** A chave de serviço legada é um JWT ('eyJ...'); as novas (sb_secret_…) não usam Authorization. */
function ehChaveJwt(chave) {
  return chave.startsWith('eyJ');
}

export function cabecalhosSupabase(chave) {
  const h = { apikey: chave };
  if (ehChaveJwt(chave)) h.Authorization = `Bearer ${chave}`;
  return h;
}

/** Tira a chave do corpo da resposta (caso ela seja ecoada de volta) antes de colocá-lo num erro. */
export function semChave(texto, chave) {
  return chave ? texto.split(chave).join('[REDACTED]') : texto;
}

/**
 * Erro do PostgREST sem dados: só o código e a mensagem (o campo "details" pode trazer a linha recusada,
 * com nomes de fazenda e talhões, e o log do GitHub Actions é público). Corpo que não é JSON → só o status.
 */
async function erroSupabase(resp, chave, acao) {
  const texto = await resp.text().catch(() => '');
  let resumo = '';
  try {
    const corpo = JSON.parse(texto);
    resumo = [corpo?.code, corpo?.message].filter((v) => typeof v === 'string' && v).join(' ');
  } catch {
    resumo = '';
  }
  resumo = semChave(resumo, chave).slice(0, 200);
  throw new Error(`Supabase recusou ${acao} (HTTP ${resp.status})${resumo ? `: ${resumo}` : ''}`);
}

/**
 * Grava o plantio em mapas_plantio_pims: upsert (uma linha por safra × unidade) e, só depois de
 * bem-sucedido, apaga as linhas com gerado_em anterior a esta rodada (sumiram do PIMS).
 * Sem nenhuma linha (PIMS não devolveu talhão nenhum), não mexe no Supabase: um upsert vazio seguido
 * da limpeza por gerado_em apagaria a tabela inteira.
 */
export async function gravarSupabase(arquivo, { url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const linhas = linhasSupabase(arquivo);
  if (!linhas.length) {
    console.warn('PIMS não retornou nenhum talhão; o Supabase não foi alterado.');
    return;
  }
  const respUpsert = await fetchImpl(`${url}/rest/v1/mapas_plantio_pims?on_conflict=safra,unidade`, {
    method: 'POST',
    headers: {
      ...cabecalhosSupabase(chave),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(linhas),
  });
  if (!respUpsert.ok) await erroSupabase(respUpsert, chave, 'o upsert em mapas_plantio_pims');

  const respLimpeza = await fetchImpl(
    `${url}/rest/v1/mapas_plantio_pims?gerado_em=lt.${encodeURIComponent(arquivo.geradoEm)}`,
    { method: 'DELETE', headers: cabecalhosSupabase(chave) },
  );
  if (!respLimpeza.ok) await erroSupabase(respLimpeza, chave, 'a limpeza de mapas_plantio_pims');
}

export function resumo(dados) {
  const linhas = [];
  for (const s of dados.safras) {
    linhas.push(s.nome);
    for (const u of s.unidades) {
      const c = { plantado: 0, plantando: 0, a_plantar: 0 };
      for (const t of u.talhoes) c[t.status]++;
      linhas.push(`  ${u.unidade}: ${u.talhoes.length} talhões (plantado ${c.plantado}, plantando ${c.plantando}, a plantar ${c.a_plantar})`);
    }
  }
  return linhas;
}

/**
 * O que imprimir da rodada. O repositório é público e os logs do GitHub Actions também: gravando no
 * Supabase ou rodando no Actions, só totais agregados (sem nome de fazenda nem contagem por fazenda).
 * O detalhe por safra/unidade (resumo) fica para o modo local (plantio.json na própria máquina).
 */
export function linhasDeLog(dados, { supabase = false, githubActions = false } = {}) {
  if (!supabase && !githubActions) return resumo(dados);
  const linhas = linhasSupabase(dados);
  const talhoes = linhas.reduce((soma, l) => soma + l.talhoes.length, 0);
  const destino = supabase ? ' gravadas no Supabase' : '';
  return [`${linhas.length} linhas (safra × unidade)${destino}, ${talhoes} talhões, geradoEm ${dados.geradoEm}.`];
}

// ---------- Acompanhamento Operacional (módulo acompanhamento/ do COA WEB) ----------
// Talhões e apontamentos diários de plantio e colheita, gravados em acomp_pims (uma linha por
// safra × unidade). O painel calcula os indicadores no navegador. Roda depois do plantio dos mapas
// e nunca derruba a rotina deles: sem a tabela acomp_pims (script SQL ainda não aplicado), só avisa.

const PIMS = 'PIMSMCPRD.dbo.';
const listaSql = (nomes) => nomes.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',');

/** SELECTs do acompanhamento (validadas no Agrovex em 28/09/2026). ID_UPNIVEL3 vai como texto: o bigint perde precisão no JSON. */
export function montarSqlAcompanhamento(safras) {
  const em = listaSql(safras);
  return {
    talhoes: `SELECT u.DE_UNI_ADM AS unidade, u2.DE_UPNIVEL2 AS setor, ps.DE_PER_SAFRA AS safra,
  CONVERT(varchar(30), up.ID_UPNIVEL3) AS id, up.CD_UPNIVEL3 AS codigo,
  up.QT_AREA_PROD AS area, ISNULL(up.QT_AREA_DANO,0) AS dano, v.DE_VARIEDADE AS variedade,
  CONVERT(varchar(10), up.DT_PLANT_ENC, 120) AS encerrado
FROM ${PIMS}UPNIVEL3 up
JOIN ${PIMS}PERIODOSAFRA ps ON up.ID_PERIODOSAFRA = ps.ID_PERIODOSAFRA
JOIN ${PIMS}UPNIVEL2 u2 ON up.ID_UPNIVEL2 = u2.ID_UPNIVEL2
JOIN ${PIMS}UPNIVEL1 u1 ON u2.ID_UPNIVEL1 = u1.ID_UPNIVEL1
JOIN ${PIMS}UNIDADEADM u ON u1.ID_UNIDADEADM = u.ID_UNIDADEADM
LEFT JOIN ${PIMS}VARIEDADE v ON v.ID_VARIEDADE = up.ID_VARIEDADE
WHERE ps.DE_PER_SAFRA IN (${em}) AND up.QT_AREA_PROD > 0.1`,
    plantio: `SELECT u.DE_UNI_ADM AS unidade, ps.DE_PER_SAFRA AS safra, CONVERT(varchar(30), up.ID_UPNIVEL3) AS id,
  up.CD_UPNIVEL3 AS codigo, CONVERT(varchar(10), a.DT_OPERACAO, 120) AS data, a.QT_AREA AS area,
  e.DE_EQUIPE AS equipe, o.CD_OPERACAO AS cd_operacao, a.FG_REPLANTIO AS replantio
FROM ${PIMS}APPLANTIO a
JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = a.ID_APORDSERVICO AND os.ID_UNIDADEADM = a.ID_UNIDADEADM
JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = a.ID_UPNIVEL3
JOIN ${PIMS}PERIODOSAFRA ps ON ps.ID_PERIODOSAFRA = up.ID_PERIODOSAFRA
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
LEFT JOIN ${PIMS}OPERACAO o ON o.ID_OPERACAO = os.ID_OPERACAO
LEFT JOIN ${PIMS}EQUIPE e ON e.ID_EQUIPE = os.ID_EQUIPE
WHERE os.FG_SITUACAO IN ('A','F') AND ps.DE_PER_SAFRA IN (${em})`,
    colheita: `SELECT u.DE_UNI_ADM AS unidade, ps.DE_PER_SAFRA AS safra, CONVERT(varchar(30), up.ID_UPNIVEL3) AS id,
  up.CD_UPNIVEL3 AS codigo, CONVERT(varchar(10), a.DT_OPERACAO, 120) AS data, a.QT_AREA_EXEC AS area,
  e.DE_EQUIPE AS equipe, o.CD_OPERACAO AS cd_operacao
FROM ${PIMS}APATIVPROD a
JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = a.ID_APORDSERVICO AND os.ID_UNIDADEADM = a.ID_UNIDADEADM
JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = a.ID_UPNIVEL3
JOIN ${PIMS}PERIODOSAFRA ps ON ps.ID_PERIODOSAFRA = up.ID_PERIODOSAFRA
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
JOIN ${PIMS}OPERACAO o ON o.ID_OPERACAO = os.ID_OPERACAO
LEFT JOIN ${PIMS}EQUIPE e ON e.ID_EQUIPE = os.ID_EQUIPE
WHERE os.FG_SITUACAO IN ('A','F') AND o.CD_OPERACAO IN (16, 114) AND ps.DE_PER_SAFRA IN (${em})`,
  };
}

/** 'SEMENTE DE SOJA 84KA92 CE' -> '84KA92 CE' (mesma limpeza do relatório Power BI). */
export function limparVariedade(v) {
  const t = txt(v);
  if (!t) return null;
  return t.replace(/^SEMENTE\s+(DE\s+)?(SOJA|MILHO|ALGODAO|SORGO|MILHETO)\s+/i, '').replace(/\s+(SOJA|MILHO|ALGODAO)$/i, '').trim() || null;
}

/** 'HENRIQUE RAMOS CARDOSO' -> 'Henrique' ("Equipe ..." -> 'Terceiro', como no Power BI). */
export function primeiroNome(s) {
  const n = txt(s);
  if (!n) return 'Sem equipe';
  const p = n.split(/\s+/)[0].toLowerCase();
  const nome = p.charAt(0).toUpperCase() + p.slice(1);
  return nome === 'Equipe' ? 'Terceiro' : nome;
}

function objetosDe({ columns, rows }) {
  const cols = columns.map((c) => String(c).toLowerCase());
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null])));
}

/**
 * Monta as linhas de acomp_pims (uma por safra × unidade que tenha talhão) a partir das três
 * consultas. Apontamento sem data ou de talhão/unidade sem talhão cadastrado na safra é descartado.
 */
export function linhasAcompanhamento({ talhoes, plantio, colheita }, geradoEm) {
  const linhas = new Map();
  const chave = (s, u) => `${s}\u0000${u}`;
  for (const r of objetosDe(talhoes)) {
    const s = txt(r.safra);
    const u = txt(r.unidade);
    if (!s || !u) continue;
    if (!linhas.has(chave(s, u))) linhas.set(chave(s, u), { safra: s, unidade: u, gerado_em: geradoEm, talhoes: [], apontamentos: [] });
    linhas.get(chave(s, u)).talhoes.push({
      setor: txt(r.setor), id: txt(r.id), t: txt(r.codigo), area: num(r.area), dano: num(r.dano),
      variedade: limparVariedade(r.variedade), enc: txt(r.encerrado),
    });
  }
  const somar = (res, op) => {
    for (const r of objetosDe(res)) {
      const l = linhas.get(chave(txt(r.safra), txt(r.unidade)));
      const d = txt(r.data);
      if (!l || !d) continue;
      l.apontamentos.push({
        op, id: txt(r.id), t: txt(r.codigo), d, a: num(r.area), eq: txt(r.equipe), e: primeiroNome(r.equipe),
        rep: op === 'PLANTIO' && (txt(r.replantio) === 'S' || Number(r.cd_operacao) === 18),
      });
    }
  };
  somar(plantio, 'PLANTIO');
  somar(colheita, 'COLHEITA');
  return [...linhas.values()].sort((a, b) => comparar(a.safra, b.safra) || comparar(a.unidade, b.unidade));
}

// ---------- comparativo com as safras anteriores ----------

/**
 * Chave da cultura de um nome de safra do PIMS, sem o ano: os nomes mudam de um ano para outro
 * ('MILHO SAFRINHA 23/24', 'MILHO 2ª SAFRA 24/25', 'MILHO 2º SAFRA 25/26' → 'MILHO 2 SAFRA').
 */
export function culturaDaSafra(nome) {
  let s = chaveNome(nome).replace(/\s*\d{2}\/\d{2}$/, '');
  s = s.replace(/(\d)\s*[ªº°]/g, '$1').replace(/\bSAFRINHA\b/g, '2 SAFRA').replace(/^MILHO\s+SILAGEM\b/, 'SILAGEM');
  if (/\bSAFRA\b/.test(s) && !/\d\s+SAFRA\b/.test(s)) s = s.replace(/\bSAFRA\b/, '1 SAFRA');
  return s.replace(/\s+/g, ' ').trim();
}

/** Ano inicial (2 dígitos) de um nome de safra ('SOJA 26/27' → 26), ou null. */
function anoDaSafra(nome) {
  const m = /(\d{2})\/\d{2}\s*$/.exec(String(nome ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * Nomes das safras anteriores (mesma cultura, 1 a `anos` anos antes) de cada safra, entre os nomes do
 * PIMS. O painel usa as 2 últimas; a aba "Safras" usa as 3.
 */
export function safrasAnteriores(atuais, todas, anos = 3) {
  const saida = new Set();
  for (const a of atuais) {
    const c = culturaDaSafra(a);
    const ano = anoDaSafra(a);
    if (ano === null) continue;
    for (const n of todas) {
      const an = anoDaSafra(n);
      if (an !== null && ano - an >= 1 && ano - an <= anos && culturaDaSafra(n) === c) saida.add(String(n).trim());
    }
  }
  return [...saida].sort(comparar);
}

/** Hectares por dia × unidade × safra × operação das safras anteriores (só o total do dia, sem talhão). */
export function montarSqlHistorico(safras) {
  const em = listaSql(safras);
  return `SELECT u.DE_UNI_ADM AS unidade, ps.DE_PER_SAFRA AS safra, 'PLANTIO' AS op,
  CONVERT(varchar(10), a.DT_OPERACAO, 120) AS data, SUM(a.QT_AREA) AS area
FROM ${PIMS}APPLANTIO a
JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = a.ID_APORDSERVICO AND os.ID_UNIDADEADM = a.ID_UNIDADEADM
JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = a.ID_UPNIVEL3
JOIN ${PIMS}PERIODOSAFRA ps ON ps.ID_PERIODOSAFRA = up.ID_PERIODOSAFRA
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
LEFT JOIN ${PIMS}OPERACAO o ON o.ID_OPERACAO = os.ID_OPERACAO
WHERE os.FG_SITUACAO IN ('A','F') AND ps.DE_PER_SAFRA IN (${em}) AND a.DT_OPERACAO IS NOT NULL
  AND ISNULL(a.FG_REPLANTIO, 'N') <> 'S' AND ISNULL(o.CD_OPERACAO, 0) <> 18
GROUP BY u.DE_UNI_ADM, ps.DE_PER_SAFRA, CONVERT(varchar(10), a.DT_OPERACAO, 120)
UNION ALL
SELECT u.DE_UNI_ADM, ps.DE_PER_SAFRA, 'COLHEITA', CONVERT(varchar(10), a.DT_OPERACAO, 120), SUM(a.QT_AREA_EXEC)
FROM ${PIMS}APATIVPROD a
JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = a.ID_APORDSERVICO AND os.ID_UNIDADEADM = a.ID_UNIDADEADM
JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = a.ID_UPNIVEL3
JOIN ${PIMS}PERIODOSAFRA ps ON ps.ID_PERIODOSAFRA = up.ID_PERIODOSAFRA
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
JOIN ${PIMS}OPERACAO o ON o.ID_OPERACAO = os.ID_OPERACAO
WHERE os.FG_SITUACAO IN ('A','F') AND o.CD_OPERACAO IN (16, 114) AND ps.DE_PER_SAFRA IN (${em}) AND a.DT_OPERACAO IS NOT NULL
GROUP BY u.DE_UNI_ADM, ps.DE_PER_SAFRA, CONVERT(varchar(10), a.DT_OPERACAO, 120)`;
}

/**
 * Linhas de acomp_pims das safras anteriores: sem talhões (a página as usa só no comparativo do
 * gráfico diário e não as mostra na lista de safras) e com um apontamento por dia e operação.
 * Uma safra que também está entre as atuais não entra (a linha dela já tem os talhões).
 */
export function linhasHistorico(res, geradoEm, atuais = []) {
  const ja = new Set(atuais.map((s) => String(s).trim()));
  const linhas = new Map();
  for (const r of objetosDe(res)) {
    const s = txt(r.safra);
    const u = txt(r.unidade);
    const d = txt(r.data);
    const a = num(r.area);
    if (!s || !u || !d || ja.has(s) || !(a > 0)) continue;
    const k = `${s}\u0000${u}`;
    if (!linhas.has(k)) linhas.set(k, { safra: s, unidade: u, gerado_em: geradoEm, talhoes: [], apontamentos: [] });
    linhas.get(k).apontamentos.push({ op: txt(r.op) === 'COLHEITA' ? 'COLHEITA' : 'PLANTIO', d, a });
  }
  for (const l of linhas.values()) l.apontamentos.sort((x, y) => comparar(x.op + x.d, y.op + y.d));
  return [...linhas.values()].sort((a, b) => comparar(a.safra, b.safra) || comparar(a.unidade, b.unidade));
}

// ---------- chuva por fazenda (ZEUS) ----------

/** Fazenda da ZEUS → unidade do PIMS ('Faz. Três Flechas' → 'TRES FLECHAS', 'Faz_SM3' → 'SM3'). */
export function unidadeDaFazendaZeus(nome) {
  return chaveNome(nome).replace(/^(FAZENDA|FAZ)(?=[\s._-])[\s._-]*/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Primeiro dia da janela da chuva: 1º de agosto, `anos` anos-safra antes do atual. */
export function inicioChuva(agora = new Date(), anos = 3) {
  const ano = agora.getFullYear() - (agora.getMonth() >= 8 ? 0 : 1) - anos;
  return `${ano}-08-01`;
}

/**
 * Chuva diária (mm) por fazenda na ZEUS: soma o dia de cada pluviômetro e tira a média entre os
 * pluviômetros da fazenda (a média direta das leituras pesa quem lê mais vezes). Só dias com chuva.
 */
export function montarSqlChuva(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  return `WITH pa AS (SELECT DISTINCT ON (picid) picid, farm FROM "DATABASE".stg_zeus_picarea ORDER BY picid, farm),
por_pic AS (
  SELECT c.picid, c.data::date AS dia, sum(c.pluviometria) AS mm
  FROM "DATABASE".stg_climatemonitoring2 c
  WHERE c.data >= DATE '${d}' AND c.pluviometria IS NOT NULL
  GROUP BY 1, 2)
SELECT pa.farm AS fazenda, to_char(p.dia, 'YYYY-MM-DD') AS data, round(avg(p.mm)::numeric, 1) AS mm
FROM por_pic p JOIN pa ON pa.picid = p.picid
GROUP BY pa.farm, p.dia
HAVING avg(p.mm) >= 0.2
ORDER BY 1, 2`;
}

/** Linhas de acomp_pims da chuva: safra 'CHUVA', uma por unidade conhecida, um apontamento por dia. */
export function linhasChuva(res, geradoEm, unidades) {
  const ok = new Set(unidades);
  const linhas = new Map();
  for (const r of objetosDe(res)) {
    const u = unidadeDaFazendaZeus(r.fazenda);
    const d = txt(r.data);
    const mm = num(r.mm);
    if (!ok.has(u) || !d || !(mm > 0)) continue;
    if (!linhas.has(u)) linhas.set(u, { safra: 'CHUVA', unidade: u, gerado_em: geradoEm, talhoes: [], apontamentos: [] });
    linhas.get(u).apontamentos.push({ op: 'CHUVA', d, a: mm });
  }
  return [...linhas.values()].sort((a, b) => comparar(a.unidade, b.unidade));
}

/** Consulta o PIMS pelo Agrovex e devolve { geradoEm, safras, linhas } do acompanhamento (não grava nada). */
export async function sincronizarAcompanhamento({ url, token, safras, excluirPrefixos = [], fetchImpl = fetch, agora = new Date() }) {
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    // a lista de safras do PIMS também serve para achar as safras anteriores (comparativo do gráfico diário)
    const lista = await cliente.consultar(SQL_SAFRAS, 'lista de safras do PIMS', 'lista de safras');
    const todas = lista.rows.map((r) => String(r[0] ?? '').trim()).filter(Boolean);
    const nomes = safras === 'auto'
      ? filtrarSafras(todas, safrasPadrao(agora), excluirPrefixos)
      : [...new Set(safras.map((s) => String(s).trim()).filter(Boolean))];
    const geradoEm = agora.toISOString();
    if (!nomes.length) return { geradoEm, safras: [], linhas: [] };
    const sql = montarSqlAcompanhamento(nomes);
    const talhoes = await cliente.consultar(sql.talhoes, 'talhões do acompanhamento operacional', 'talhões do acompanhamento');
    const plantio = await cliente.consultar(sql.plantio, 'apontamentos de plantio do acompanhamento operacional', 'plantio do acompanhamento');
    const colheita = await cliente.consultar(sql.colheita, 'apontamentos de colheita do acompanhamento operacional', 'colheita do acompanhamento');
    const linhas = linhasAcompanhamento({ talhoes, plantio, colheita }, geradoEm);
    const anteriores = safrasAnteriores(nomes, todas).filter((s) => !nomes.includes(s));
    if (anteriores.length && linhas.length) {
      const hist = await cliente.consultar(montarSqlHistorico(anteriores), 'hectares por dia das safras anteriores (comparativo)', 'safras anteriores');
      linhas.push(...linhasHistorico(hist, geradoEm, nomes));
    }
    // chuva por fazenda (ZEUS): se falhar, o acompanhamento segue sem as gotas
    let chuva = 0;
    const unidades = [...new Set(linhas.filter((l) => l.talhoes.length).map((l) => l.unidade))];
    if (unidades.length) {
      try {
        const res = await cliente.consultar(montarSqlChuva(inicioChuva(agora)), 'chuva diária por fazenda (acompanhamento operacional)', 'chuva', FONTES.zeus);
        const lc = linhasChuva(res, geradoEm, unidades);
        chuva = lc.length;
        linhas.push(...lc);
      } catch (e) {
        console.warn(`Acompanhamento: chuva da ZEUS indisponível (${e instanceof Error ? e.message : e}); segue sem a chuva.`);
      }
    }
    return { geradoEm, safras: nomes, anteriores, chuva, linhas };
  } finally {
    await cliente.fechar();
  }
}

/**
 * Grava em acomp_pims: upsert e, só depois dele, apaga as linhas de rodadas anteriores. Devolve
 * 'ok', 'vazio' (PIMS sem talhão: não mexe no Supabase) ou 'sem-tabela' (script
 * modulos/acompanhamento/supabase/0001_acompanhamento.sql ainda não aplicado: só avisa).
 */
export async function gravarAcompanhamentoSupabase(dados, { url, chave, fetch: fetchImpl = globalThis.fetch }) {
  if (!dados.linhas.length) {
    console.warn('Acompanhamento: o PIMS não retornou nenhum talhão; acomp_pims não foi alterada.');
    return 'vazio';
  }
  const resp = await fetchImpl(`${url}/rest/v1/acomp_pims?on_conflict=safra,unidade`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(dados.linhas),
  });
  if (!resp.ok) {
    const texto = await resp.clone().text().catch(() => '');
    if (resp.status === 404 || /PGRST205|42P01/.test(texto)) {
      console.warn('Acompanhamento: a tabela acomp_pims ainda não existe no Supabase (rode modulos/acompanhamento/supabase/0001_acompanhamento.sql).');
      return 'sem-tabela';
    }
    await erroSupabase(resp, chave, 'o upsert em acomp_pims');
  }
  const limpeza = await fetchImpl(`${url}/rest/v1/acomp_pims?gerado_em=lt.${encodeURIComponent(dados.geradoEm)}`, {
    method: 'DELETE',
    headers: cabecalhosSupabase(chave),
  });
  if (!limpeza.ok) await erroSupabase(limpeza, chave, 'a limpeza de acomp_pims');
  return 'ok';
}

/** Linha de log do acompanhamento: só totais (os logs podem ser públicos). */
export function logAcompanhamento(dados, situacao) {
  const atuais = dados.linhas.filter((l) => l.talhoes.length);
  const chuva = dados.linhas.filter((l) => l.safra === 'CHUVA').length;
  const hist = dados.linhas.length - atuais.length - chuva;
  const n = (op) => atuais.reduce((s, l) => s + l.apontamentos.filter((a) => a.op === op).length, 0);
  const talhoes = atuais.reduce((s, l) => s + l.talhoes.length, 0);
  return `Acompanhamento: ${situacao}; ${atuais.length} linhas (safra × unidade), ${talhoes} talhões, ${n('PLANTIO')} apontamentos de plantio, ${n('COLHEITA')} de colheita` +
    (hist ? `; ${hist} linhas de safras anteriores (comparativo)` : '') + (chuva ? `; chuva de ${chuva} fazendas` : '') + '.';
}

/**
 * Etapa do acompanhamento dentro da rotina: consulta, grava e registra. Erro aqui não interrompe o
 * plantio dos mapas (já gravado); é devolvido para quem chamou decidir o código de saída.
 */
export async function rodarAcompanhamento({ agrovex, supabase, fetchImpl = globalThis.fetch }) {
  try {
    const dados = await sincronizarAcompanhamento({ ...agrovex, fetchImpl });
    const situacao = await gravarAcompanhamentoSupabase(dados, { ...supabase, fetch: fetchImpl });
    console.log(logAcompanhamento(dados, situacao === 'ok' ? 'gravado no Supabase' : situacao));
    return null;
  } catch (e) {
    const msg = semChave(semChave(e instanceof Error ? e.message : String(e), supabase.chave), agrovex.token);
    console.error(`Acompanhamento: erro (o plantio dos mapas não foi afetado): ${msg}`);
    return msg;
  }
}

// ---------- validação de apontamentos (módulo validacao/ do COA WEB) ----------
// Ordens de serviço do PIMS (abertas e fechadas com diferença de área), coordenadores (a Equipe da
// ordem), depósitos e, para os depósitos que o usuário vinculou aos coordenadores, o saldo do SAP.

/** Diferença de área (ha) acima da qual uma ordem FECHADA entra na lista "faltando / sobrando área". */
export const VALID_TOLERANCIA_HA = 1;
const VALID_PAGINA = 4000;

/** Empresa do SAP B1 (base SBO*) em que ficam os depósitos de cada unidade do PIMS (DE_UNI_ADM). */
export const SAP_EMPRESA_DA_UNIDADE = {
  BACABA: 'SBOAGROPECUARIALOCKS',
  'COMPLEXO INDUSTRIAL': 'SBOAGROPECUARIALOCKS',
  DOURADO: 'SBOAGROPECUARIALOCKS',
  GLOBO: 'SBOAGROPECUARIALOCKS',
  GUAPIRAMA: 'SBOAGROPECUARIALOCKS',
  NEBRASKA: 'SBOAGROPECUARIALOCKS',
  'TRES FLECHAS': 'SBOAGROPECUARIALOCKS',
  SM3: 'SBOAGROPECUARIASM3',
  SIRIEMA: 'SBOSAMUELMAGGILOCKS',
  'PECUARIA LOCKS - DOURADO': 'SBOPECUARIALOCKS',
  'PECUARIA LOCKS - GLOBO': 'SBOPECUARIALOCKS',
  'PECUARIA LOCKS - GUAPIRAMA': 'SBOPECUARIALOCKS',
};

/** Primeiro dia da safra atual para a validação: 1º de agosto (do ano passado, se ainda não chegou agosto). */
export function inicioSafraValidacao(agora = new Date()) {
  return `${agora.getFullYear() - (agora.getMonth() >= 7 ? 0 : 1)}-08-01`;
}

/** Área executada de uma ordem: plantio, produção (colheita/preparo) e aplicação de insumo, por dia. */
const SQL_EXEC_VALIDACAO = `SELECT ID_APORDSERVICO, DT_OPERACAO AS dia, QT_AREA AS ha FROM ${PIMS}APPLANTIO WHERE ID_APORDSERVICO IS NOT NULL
  UNION ALL SELECT ID_APORDSERVICO, DT_OPERACAO, QT_AREA_EXEC FROM ${PIMS}APATIVPROD WHERE ID_APORDSERVICO IS NOT NULL
  UNION ALL SELECT a.ID_APORDSERVICO, a.DT_OPERACAO, l.QT_AREA_EXEC FROM ${PIMS}APAPLINSUMO a
    JOIN ${PIMS}APAPLINS_LC l ON l.ID_APAPLINSUMO = a.ID_APAPLINSUMO WHERE a.ID_APORDSERVICO IS NOT NULL`;

/**
 * Ordens de serviço para a validação: todas as ABERTAS e as FECHADAS desde `desde` em que a área
 * apontada difere da planejada em mais de VALID_TOLERANCIA_HA. Uma página por vez.
 * Operações que não apontam área (tratamento de sementes, apoio a combate de incêndio, compactação de
 * silagem…) não são medidas em hectares: as fechadas ficam de fora e as abertas vêm com sem_area = 1.
 * Entra nessa lista a operação com 3 ou mais ordens fechadas desde a safra anterior em que menos da
 * metade teve área apontada (no PIMS de hoje as operações ficam ou acima de 65% ou abaixo de 10%).
 */
export function montarSqlOrdensValidacao(desde, pular = 0, tamanho = VALID_PAGINA) {
  const a = alvoValidacao(desde);
  return `${a.cte}
SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, e.DE_EQUIPE AS equipe, o.CD_OPERACAO AS operacao, o.DE_OPERACAO AS operacao_de,
  os.FG_SITUACAO AS situacao, CONVERT(varchar(10), os.DT_ABERTURA, 23) AS abertura, CONVERT(varchar(10), os.DT_ENCERRA, 23) AS encerramento,
  ISNULL(pl.ha, 0) AS planejado, ISNULL(pl.n, 0) AS talhoes, ISNULL(ex.ha, 0) AS executado, CONVERT(varchar(10), ex.ultimo, 23) AS ultimo,
  CASE WHEN sa.ID_OPERACAO IS NOT NULL THEN 1 ELSE 0 END AS sem_area
${a.de}
${a.onde}
ORDER BY os.ID_APORDSERVICO
${paginaSql(pular, tamanho)}`;
}

const paginaSql = (pular, tamanho) => `OFFSET ${Math.max(0, Math.floor(pular))} ROWS FETCH NEXT ${Math.max(1, Math.floor(tamanho))} ROWS ONLY`;

/** As ordens da validação (as mesmas de montarSqlOrdensValidacao), em pedaços para as consultas que detalham cada uma. */
function alvoValidacao(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  const anterior = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  return {
    cte: `WITH pl AS (SELECT ID_APORDSERVICO, SUM(QT_AREA) AS ha, COUNT(*) AS n FROM ${PIMS}APORDSERVICO_LC GROUP BY ID_APORDSERVICO),
ex AS (SELECT x.ID_APORDSERVICO, SUM(x.ha) AS ha, MAX(x.dia) AS ultimo FROM (${SQL_EXEC_VALIDACAO}) x GROUP BY x.ID_APORDSERVICO),
sa AS (SELECT o2.ID_OPERACAO FROM ${PIMS}APORDSERVICO o2 LEFT JOIN ex ON ex.ID_APORDSERVICO = o2.ID_APORDSERVICO
  WHERE o2.FG_SITUACAO = 'F' AND o2.DT_ENCERRA >= '${anterior}' GROUP BY o2.ID_OPERACAO
  HAVING COUNT(*) >= 3 AND 2 * SUM(CASE WHEN ex.ha > 0 THEN 1 ELSE 0 END) < COUNT(*))`,
    de: `FROM ${PIMS}APORDSERVICO os
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
LEFT JOIN ${PIMS}EQUIPE e ON e.ID_EQUIPE = os.ID_EQUIPE
LEFT JOIN ${PIMS}OPERACAO o ON o.ID_OPERACAO = os.ID_OPERACAO
LEFT JOIN pl ON pl.ID_APORDSERVICO = os.ID_APORDSERVICO
LEFT JOIN ex ON ex.ID_APORDSERVICO = os.ID_APORDSERVICO
LEFT JOIN sa ON sa.ID_OPERACAO = os.ID_OPERACAO`,
    onde: `WHERE os.FG_SITUACAO = 'A'
   OR (os.FG_SITUACAO = 'F' AND os.DT_ENCERRA >= '${d}' AND sa.ID_OPERACAO IS NULL AND ABS(ISNULL(pl.ha, 0) - ISNULL(ex.ha, 0)) > ${VALID_TOLERANCIA_HA})`,
  };
}

/** Talhões planejados de cada ordem da validação (APORDSERVICO_LC): o que a tela mostra ao abrir a ordem. */
export function montarSqlTalhoesValidacao(desde, pular = 0, tamanho = VALID_PAGINA) {
  const a = alvoValidacao(desde);
  return `${a.cte}
SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, up.CD_UPNIVEL3 AS talhao, lc.QT_AREA AS ha
${a.de}
JOIN ${PIMS}APORDSERVICO_LC lc ON lc.ID_APORDSERVICO = os.ID_APORDSERVICO
LEFT JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = lc.ID_UPNIVEL3
${a.onde}
ORDER BY os.ID_APORDSERVICO, lc.ID_APORDSERVICO_LC
${paginaSql(pular, tamanho)}`;
}

/** Apontamentos como a tela mostra ao abrir uma ordem: boletim, dia, talhão, hectares, quando e quem lançou. */
const SQL_APONT_VALIDACAO = `SELECT ID_APORDSERVICO, NO_BOLETIM, DT_OPERACAO, ID_UPNIVEL3, QT_AREA AS ha, LAST_UPDATE, CHANGED_BY FROM ${PIMS}APPLANTIO WHERE ID_APORDSERVICO IS NOT NULL
  UNION ALL SELECT ID_APORDSERVICO, NO_BOLETIM, DT_OPERACAO, ID_UPNIVEL3, QT_AREA_EXEC, LAST_UPDATE, CHANGED_BY FROM ${PIMS}APATIVPROD WHERE ID_APORDSERVICO IS NOT NULL
  UNION ALL SELECT a.ID_APORDSERVICO, a.NO_BOLETIM, a.DT_OPERACAO, l.ID_UPNIVEL3, l.QT_AREA_EXEC, a.LAST_UPDATE, a.CHANGED_BY FROM ${PIMS}APAPLINSUMO a
    JOIN ${PIMS}APAPLINS_LC l ON l.ID_APAPLINSUMO = a.ID_APAPLINSUMO WHERE a.ID_APORDSERVICO IS NOT NULL`;

/** Apontamentos (um por talhão de cada boletim) das ordens da validação. */
export function montarSqlApontamentosValidacao(desde, pular = 0, tamanho = VALID_PAGINA) {
  const a = alvoValidacao(desde);
  return `${a.cte}
SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, ap.NO_BOLETIM AS boletim, CONVERT(varchar(10), ap.DT_OPERACAO, 23) AS dia, up.CD_UPNIVEL3 AS talhao, ap.ha,
  CONVERT(varchar(16), ap.LAST_UPDATE, 120) AS lancado, ap.CHANGED_BY AS por
${a.de}
JOIN (${SQL_APONT_VALIDACAO}) ap ON ap.ID_APORDSERVICO = os.ID_APORDSERVICO
LEFT JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = ap.ID_UPNIVEL3
${a.onde}
ORDER BY os.ID_APORDSERVICO, ap.DT_OPERACAO, ap.NO_BOLETIM, ap.ID_UPNIVEL3
${paginaSql(pular, tamanho)}`;
}

/** Evolução das ordens ABERTAS: hectares apontados por dia em cada ordem. */
export const SQL_EVOLUCAO_VALIDACAO = `SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, CONVERT(varchar(10), x.dia, 23) AS dia, SUM(x.ha) AS ha
FROM ${PIMS}APORDSERVICO os
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
JOIN (${SQL_EXEC_VALIDACAO}) x ON x.ID_APORDSERVICO = os.ID_APORDSERVICO
WHERE os.FG_SITUACAO = 'A'
GROUP BY u.DE_UNI_ADM, os.NO_BOLETIM, CONVERT(varchar(10), x.dia, 23)
ORDER BY 1, 2, 3`;

/** Coordenadores: as Equipes que tiveram ordem aberta ou fechada desde `desde` (ou têm ordem em aberto). */
export function montarSqlCoordenadoresValidacao(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  return `SELECT u.DE_UNI_ADM AS unidade, e.DE_EQUIPE AS equipe,
  SUM(CASE WHEN os.FG_SITUACAO = 'A' THEN 1 ELSE 0 END) AS abertas, COUNT(*) AS ordens
FROM ${PIMS}APORDSERVICO os
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
JOIN ${PIMS}EQUIPE e ON e.ID_EQUIPE = os.ID_EQUIPE
WHERE os.DT_ABERTURA >= '${d}' OR os.DT_ENCERRA >= '${d}'
GROUP BY u.DE_UNI_ADM, e.DE_EQUIPE
ORDER BY 1, 2`;
}

/** Depósitos de cada unidade no PIMS que têm código no SAP (CD_INT_ERP = WhsCode). */
export const SQL_DEPOSITOS_PIMS = `SELECT DISTINCT u.DE_UNI_ADM AS unidade, d.CD_INT_ERP AS codigo, d.DE_DEPOSITO AS nome
FROM ${PIMS}DEPOSITO d
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = d.ID_UNIDADEADM
WHERE d.FG_INT_ERP = 'S' AND d.CD_INT_ERP IS NOT NULL AND LTRIM(RTRIM(d.CD_INT_ERP)) <> ''
ORDER BY 1, 2`;

/** Depósitos de uma empresa do SAP (nome atual e se está inativo). */
export const SQL_DEPOSITOS_SAP = 'SELECT "WhsCode" AS codigo, "WhsName" AS nome, "Inactive" AS inativo FROM OWHS';

const ehCodigoSap = (c) => /^[A-Za-z0-9_.-]{1,20}$/.test(String(c ?? ''));

/**
 * Saldo (≠ 0) de cada item nos depósitos pedidos, numa empresa do SAP, com a ORIGEM de cada item: o
 * depósito de onde ele veio na última transferência de estoque para aquele depósito (OWTR/WTR1, sem as
 * canceladas) e o saldo do item nessa origem. Item que nunca chegou por transferência vem sem origem.
 */
export function montarSqlEstoqueSap(codigos) {
  const lista = [...new Set(codigos.map((c) => String(c)).filter(ehCodigoSap))].map((c) => `'${c}'`).join(', ');
  if (!lista) throw new Error('Nenhum depósito válido para consultar o saldo.');
  return `SELECT t."WhsCode" AS deposito, t."ItemCode" AS item, i."ItemName" AS nome, t."OnHand" AS saldo, i."InvntryUom" AS unidade,
  u."FromWhsCod" AS origem, w."WhsName" AS origem_nome, o."OnHand" AS saldo_origem, TO_VARCHAR(u."DocDate", 'YYYY-MM-DD') AS transferido_em
FROM OITW t JOIN OITM i ON i."ItemCode" = t."ItemCode"
LEFT JOIN (SELECT l."WhsCode", l."ItemCode", l."FromWhsCod", h."DocDate",
    ROW_NUMBER() OVER (PARTITION BY l."WhsCode", l."ItemCode" ORDER BY h."DocDate" DESC, h."DocEntry" DESC, l."LineNum" DESC) AS rn
  FROM WTR1 l JOIN OWTR h ON h."DocEntry" = l."DocEntry"
  WHERE h."CANCELED" = 'N' AND l."WhsCode" IN (${lista}) AND l."FromWhsCod" <> l."WhsCode") u
  ON u."WhsCode" = t."WhsCode" AND u."ItemCode" = t."ItemCode" AND u.rn = 1
LEFT JOIN OWHS w ON w."WhsCode" = u."FromWhsCod"
LEFT JOIN OITW o ON o."WhsCode" = u."FromWhsCod" AND o."ItemCode" = t."ItemCode"
WHERE t."WhsCode" IN (${lista}) AND t."OnHand" <> 0
ORDER BY 1, 3`;
}

/** Item do saldo como a tela lê: { c, n, q, u } e, quando há transferência, { o origem, on nome, oq saldo lá, od data }. */
export function itemDoSaldoSap(r) {
  const item = { c: txt(r.item), n: txt(r.nome) ?? '', q: arred(r.saldo, 3), u: txt(r.unidade) ?? '' };
  const origem = txt(r.origem);
  if (origem) {
    item.o = origem;
    item.on = txt(r.origem_nome) ?? '';
    item.oq = arred(r.saldo_origem, 3);
    const dia = txt(r.transferido_em);
    if (dia) item.od = dia;
  }
  return item;
}

const arred = (v, casas = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
};

/**
 * Monta as linhas de valid_pims (uma por unidade): ordens (abertas com a evolução por dia; fechadas com
 * diferença), coordenadores, depósitos (nome do SAP quando houver; inativos ficam marcados) e o saldo
 * dos depósitos vinculados. Chaves curtas: a tela lê isso inteiro a cada abertura.
 */
export function linhasValidacao({ ordens, evolucao, coordenadores, depositos, talhoes = [], apontamentos = [], depositosSap = {}, estoque = {}, boletins = {}, extras = {}, avisos = [] }, geradoEm) {
  const linhas = new Map();
  const linha = (unidade) => {
    const u = txt(unidade);
    if (!u) return null;
    if (!linhas.has(u)) linhas.set(u, { unidade: u, gerado_em: geradoEm, ordens: [], coordenadores: [], depositos: [], estoque: {}, boletins: [], extras: {}, avisos });
    return linhas.get(u);
  };
  const porOrdem = new Map();
  for (const r of ordens) {
    const l = linha(r.unidade);
    if (!l) continue;
    const o = {
      os: Number(r.os), eq: txt(r.equipe) ?? '(sem equipe)', op: r.operacao === null ? null : Number(r.operacao), opn: txt(r.operacao_de) ?? '',
      s: txt(r.situacao) === 'F' ? 'F' : 'A', ab: txt(r.abertura), enc: txt(r.encerramento), pl: arred(r.planejado), ex: arred(r.executado),
      nt: Number(r.talhoes) || 0, ult: txt(r.ultimo),
    };
    if (o.s === 'A') o.ev = [];
    if (Number(r.sem_area) === 1) o.sa = 1;
    // detalhe que a tela abre ao clicar na ordem: tl = [[talhão, ha planejado]]; ap = [[dia, boletim, talhão, ha, lançado em, por]]
    o.tl = [];
    o.ap = [];
    l.ordens.push(o);
    porOrdem.set(`${l.unidade}|${o.os}`, o);
  }
  for (const r of evolucao) {
    const o = porOrdem.get(`${txt(r.unidade)}|${Number(r.os)}`);
    if (o?.ev && txt(r.dia)) o.ev.push([txt(r.dia), arred(r.ha)]);
  }
  for (const r of talhoes) {
    const o = porOrdem.get(`${txt(r.unidade)}|${Number(r.os)}`);
    if (o) o.tl.push([txt(r.talhao) ?? '?', arred(r.ha)]);
  }
  for (const r of apontamentos) {
    const o = porOrdem.get(`${txt(r.unidade)}|${Number(r.os)}`);
    if (!o || !txt(r.dia)) continue;
    o.ap.push([txt(r.dia), r.boletim === null || r.boletim === undefined ? null : Number(r.boletim), txt(r.talhao) ?? '?', arred(r.ha), txt(r.lancado), txt(r.por)]);
  }
  for (const r of coordenadores) {
    const l = linha(r.unidade);
    if (l && txt(r.equipe)) l.coordenadores.push({ eq: txt(r.equipe), ab: Number(r.abertas) || 0, n: Number(r.ordens) || 0 });
  }
  for (const r of depositos) {
    const l = linha(r.unidade);
    const c = txt(r.codigo);
    if (!l || !c) continue;
    const sap = depositosSap[SAP_EMPRESA_DA_UNIDADE[l.unidade]]?.get(c);
    const d = { c, n: sap?.nome ?? txt(r.nome) ?? c };
    if (sap?.inativo) d.i = 1;
    l.depositos.push(d);
  }
  for (const [unidade, porDeposito] of Object.entries(estoque)) {
    const l = linhas.get(unidade);
    if (l) l.estoque = porDeposito;
  }
  // boletins com falha de integração (ou ainda não integrados): a unidade aparece mesmo sem ordem no retrato
  for (const [unidade, lista] of Object.entries(boletins)) {
    const l = linha(unidade);
    if (l) l.boletins = lista;
  }
  for (const [unidade, dados] of Object.entries(extras)) {
    const l = linha(unidade);
    if (l) l.extras = dados;
  }
  for (const l of linhas.values()) l.ordens.sort((a, b) => comparar(a.ab ?? '', b.ab ?? '') || a.os - b.os);
  return [...linhas.values()].sort((a, b) => comparar(a.unidade, b.unidade));
}

/* ---- boletins que falharam na integração com o SAP e boletins que ainda não foram integrados ----
   A fila de baixa de material do PIMS (BRG_BXMATERIAL_EMS) marca com documento "-1" o item que o SAP
   recusou; o motivo fica no SAP, na tabela "@GA_PIMS_LOG" (uma linha por tentativa). O boletim que ainda
   não foi enviado tem FG_STATUS_EAI = '0' no cabeçalho: para ele, conferimos no SAP o que faria a baixa
   falhar (saldo, cadastro do item no depósito, item ou depósito inativo). */
const ORIGEM_BOLETIM = ['I', 'P', 'T', 'C', 'L']; // insumo, plantio, tratamento de sementes, abastecimento, lubrificação

/** Itens que o SAP recusou (documento -1 na fila), com a unidade, a ordem e o coordenador de cada boletim. */
export function montarSqlBoletinsFalha(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  return `SELECT COALESCE(ui.DE_UNI_ADM, up.DE_UNI_ADM, ut.DE_UNI_ADM, uc.DE_UNI_ADM, ul.DE_UNI_ADM) AS unidade, e.FG_ORIGEM AS origem, e.NO_BOLETIM AS boletim,
  CONVERT(varchar(10), e.DT_CONSUMO, 23) AS dia, CONVERT(varchar(30), e.ID_BOLETIM_DE) AS id_item, e.CD_MATERIAL_ERP AS material, e.QT_CONSUMO AS qtd, e.CD_UNI_MEDIDA AS un,
  e.CD_DEPOSITO AS deposito, os.NO_BOLETIM AS os, COALESCE(eqo.DE_EQUIPE, eqi.DE_EQUIPE, eqp.DE_EQUIPE) AS equipe, CONVERT(varchar(16), e.DTHR_GERACAO, 120) AS em
FROM ${PIMS}BRG_BXMATERIAL_EMS e
LEFT JOIN ${PIMS}APAPLINSUMO ai ON e.FG_ORIGEM = 'I' AND ai.ID_APAPLINSUMO = e.ID_BOLETIM
LEFT JOIN ${PIMS}APPLANTIO ap ON e.FG_ORIGEM = 'P' AND ap.ID_APPLANTIO = e.ID_BOLETIM
LEFT JOIN ${PIMS}APTRATSEMENT ats ON e.FG_ORIGEM = 'T' AND ats.ID_APTRATSEMENT = e.ID_BOLETIM
LEFT JOIN ${PIMS}APABASTEC ac ON e.FG_ORIGEM = 'C' AND ac.ID_APABASTEC = e.ID_BOLETIM
LEFT JOIN ${PIMS}APLUBRIF al ON e.FG_ORIGEM = 'L' AND al.ID_APLUBRIF = e.ID_BOLETIM
LEFT JOIN ${PIMS}UNIDADEADM ui ON ui.ID_UNIDADEADM = ai.ID_UNIDADEADM
LEFT JOIN ${PIMS}UNIDADEADM up ON up.ID_UNIDADEADM = ap.ID_UNIDADEADM
LEFT JOIN ${PIMS}UNIDADEADM ut ON ut.ID_UNIDADEADM = ats.ID_UNIDADEADM
LEFT JOIN ${PIMS}UNIDADEADM uc ON uc.ID_UNIDADEADM = ac.ID_UNIDADEADM
LEFT JOIN ${PIMS}UNIDADEADM ul ON ul.ID_UNIDADEADM = al.ID_UNIDADEADM
LEFT JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = COALESCE(ai.ID_APORDSERVICO, ap.ID_APORDSERVICO, ats.ID_APORDSERVICO)
LEFT JOIN ${PIMS}EQUIPE eqo ON eqo.ID_EQUIPE = os.ID_EQUIPE
LEFT JOIN ${PIMS}EQUIPE eqi ON eqi.ID_EQUIPE = ai.ID_EQUIPE
LEFT JOIN ${PIMS}EQUIPE eqp ON eqp.ID_EQUIPE = ap.ID_EQUIPE
WHERE e.DT_CONSUMO >= '${d}' AND LTRIM(RTRIM(e.NO_DOC_ERP)) = '-1' AND e.FG_STATUS <> '12'
ORDER BY 1, 3, 5`;
}

/** Boletins ainda não enviados ao SAP (FG_STATUS_EAI = '0'), um por item; boletim sem item vem com o item nulo. */
export function montarSqlBoletinsPendentes(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  const parte = (origem, cab, id, itens, idItem, qtd, equipe) => `SELECT u.DE_UNI_ADM AS unidade, '${origem}' AS origem, a.NO_BOLETIM AS boletim, CONVERT(varchar(10), a.DT_OPERACAO, 23) AS dia,
  CONVERT(varchar(30), l.${idItem}) AS id_item, i.CD_INT_ERP AS material, i.DE_INSUMO AS nome, l.${qtd} AS qtd, dp.CD_INT_ERP AS deposito, os.NO_BOLETIM AS os,
  ${equipe ? 'COALESCE(eqo.DE_EQUIPE, eqa.DE_EQUIPE)' : 'eqo.DE_EQUIPE'} AS equipe, CONVERT(varchar(16), a.LAST_UPDATE, 120) AS em
FROM ${PIMS}${cab} a
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = a.ID_UNIDADEADM
LEFT JOIN ${PIMS}${itens} l ON l.${id} = a.${id}
LEFT JOIN ${PIMS}INSUMO i ON i.ID_INSUMO = l.ID_INSUMO
LEFT JOIN ${PIMS}DEPOSITO dp ON dp.ID_DEPOSITO = l.ID_DEPOSITO
LEFT JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = a.ID_APORDSERVICO
LEFT JOIN ${PIMS}EQUIPE eqo ON eqo.ID_EQUIPE = os.ID_EQUIPE${equipe ? `\nLEFT JOIN ${PIMS}EQUIPE eqa ON eqa.ID_EQUIPE = a.ID_EQUIPE` : ''}
WHERE a.DT_OPERACAO >= '${d}' AND a.FG_STATUS_EAI = '0' AND a.FG_INTEGRAR = 'S'`;
  return `${parte('I', 'APAPLINSUMO', 'ID_APAPLINSUMO', 'APAPLINS_INSLC', 'ID_APAPLINS_INSLC', 'QT_CONS_TOTAL', true)}
UNION ALL
${parte('P', 'APPLANTIO', 'ID_APPLANTIO', 'APPLANTIO_IN', 'ID_APPLANTIO_IN', 'QT_TOTAL', true)}
UNION ALL
${parte('T', 'APTRATSEMENT', 'ID_APTRATSEMENT', 'APTRATSEMENT_IN', 'ID_APTRATSEMENT_IN', 'QT_TOTAL', false)}
ORDER BY 1, 4, 3`;
}

const listaSap = (valores, teste) => [...new Set(valores.map((v) => String(v ?? '')).filter(teste))].map((v) => `'${v}'`).join(', ');

/** Última mensagem do SAP para cada item dos boletins pedidos, com quantas tentativas houve e de quando a quando. */
export function montarSqlLogIntegracaoSap(boletins, desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  const lista = listaSap(boletins, (b) => /^\d{1,18}$/.test(b));
  if (!lista) throw new Error('Nenhum boletim válido para consultar o log de integração.');
  return `SELECT l."U_ID_BOLETIM_DE" AS id_item, l."U_Message" AS msg, t.n AS tentativas, t.primeira, t.ultima
FROM "@GA_PIMS_LOG" l
JOIN (SELECT MAX("Code") AS codigo, COUNT(*) AS n, TO_VARCHAR(MIN("U_Date"), 'YYYY-MM-DD') AS primeira, TO_VARCHAR(MAX("U_Date"), 'YYYY-MM-DD') AS ultima
  FROM "@GA_PIMS_LOG" WHERE "U_NO_BOLETIM" IN (${lista}) AND "U_Date" >= '${d}' GROUP BY "U_ID_BOLETIM_DE") t ON t.codigo = l."Code"`;
}

/** Cadastro e saldo, no SAP, dos itens dos boletins nos depósitos de onde eles vão sair. */
export function montarSqlSaldoItensSap(itens, depositos) {
  const listaItens = listaSap(itens, ehCodigoSap);
  if (!listaItens) throw new Error('Nenhum item válido para consultar o saldo.');
  const listaDeps = listaSap(depositos, ehCodigoSap) || "''";
  return `SELECT i."ItemCode" AS item, i."ItemName" AS nome, i."InvntryUom" AS unidade, i."frozenFor" AS congelado, w."WhsCode" AS deposito, w."OnHand" AS saldo
FROM OITM i LEFT JOIN OITW w ON w."ItemCode" = i."ItemCode" AND w."WhsCode" IN (${listaDeps})
WHERE i."ItemCode" IN (${listaItens})`;
}

const empresaDa = (unidade) => SAP_EMPRESA_DA_UNIDADE[txt(unidade) ?? ''] ?? null;

/**
 * Monta, por unidade, a lista de boletins com problema de integração:
 *   { o origem, n boletim, d dia, os, eq coordenador, sit 'F' falhou | 'P' ainda não integrado, em (quando entrou na fila
 *     ou foi lançado), t tentativas, p1/ul primeira e última tentativa, m [mensagens do SAP], si 1 = sem item,
 *     it [{ c item, nm nome, q quantidade, u unidade, dp depósito, s saldo no SAP, pr [problemas previstos] }] }
 * Problemas previstos em cada item: 'sem-deposito', 'deposito-inativo', 'item-inexistente', 'item-inativo',
 * 'item-fora-deposito' e 'sem-estoque' (o saldo é consumido na ordem: primeiro os que já falharam, depois por data).
 * `logs` = { empresa: Map(id do item → { msg, n, primeira, ultima }) }; `sap` = { empresa: { itens: Map(item → { nome,
 * un, inativo }), saldo: Map('item|depósito' → número) } }. Empresa sem dados do SAP → sem diagnóstico.
 */
export function linhasBoletins({ falhas = [], pendentes = [], logs = {}, sap = {}, depositosSap = {} }) {
  const grupos = new Map();
  const juntar = (r, sit) => {
    const unidade = txt(r.unidade);
    const origem = txt(r.origem);
    if (!unidade || !ORIGEM_BOLETIM.includes(origem) || r.boletim === null || r.boletim === undefined) return;
    const chave = `${sit}|${unidade}|${origem}|${r.boletim}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, { unidade, b: { o: origem, n: String(r.boletim), d: txt(r.dia), os: r.os === null || r.os === undefined ? null : Number(r.os), eq: txt(r.equipe), sit, em: txt(r.em), it: [] }, itens: new Map(), msgs: new Set() });
    }
    const g = grupos.get(chave);
    const em = txt(r.em);
    if (em && (!g.b.em || em < g.b.em)) g.b.em = em;
    const material = txt(r.material);
    if (!material && !txt(r.id_item)) return; // boletim sem item
    const dep = txt(r.deposito);
    const k = `${material ?? '?'}|${dep ?? ''}`;
    if (!g.itens.has(k)) g.itens.set(k, { c: material ?? '?', nm: txt(r.nome) ?? '', q: 0, u: txt(r.un) ?? '', dp: dep });
    g.itens.get(k).q += Number(r.qtd) || 0;
    if (sit !== 'F') return;
    const log = logs[empresaDa(unidade)]?.get(String(r.id_item));
    if (!log) return;
    g.b.t = Math.max(g.b.t ?? 0, Number(log.n) || 0);
    if (log.primeira && (!g.b.p1 || log.primeira < g.b.p1)) g.b.p1 = log.primeira;
    if (log.ultima && (!g.b.ul || log.ultima > g.b.ul)) g.b.ul = log.ultima;
    const msg = String(log.msg ?? '').replace(/\s+/g, ' ').trim();
    if (msg && !/^adicionado/i.test(msg)) g.msgs.add(msg.slice(0, 260));
  };
  for (const r of falhas) juntar(r, 'F');
  for (const r of pendentes) juntar(r, 'P');

  const ordenados = [...grupos.values()].sort((a, b) => comparar(a.b.sit, b.b.sit) || comparar(a.b.d ?? '', b.b.d ?? '') || comparar(a.b.n, b.b.n));
  const consumido = new Map(); // 'empresa|item|depósito' → quanto os boletins anteriores já vão tirar
  const porUnidade = new Map();
  for (const g of ordenados) {
    const empresa = empresaDa(g.unidade);
    const dados = sap[empresa];
    for (const item of g.itens.values()) {
      item.q = arred(item.q, 3);
      const cadastro = dados?.itens.get(item.c);
      if (cadastro) {
        item.nm = cadastro.nome || item.nm;
        item.u = item.u || cadastro.un || '';
      }
      const problemas = [];
      if (!item.dp) problemas.push('sem-deposito');
      else if (depositosSap[empresa]?.get(item.dp)?.inativo) problemas.push('deposito-inativo');
      if (dados) {
        if (!cadastro) problemas.push('item-inexistente');
        else {
          if (cadastro.inativo) problemas.push('item-inativo');
          if (item.dp) {
            const k = `${item.c}|${item.dp}`;
            const saldo = dados.saldo.get(k);
            if (saldo === undefined) problemas.push('item-fora-deposito');
            else {
              item.s = arred(saldo, 3);
              const antes = consumido.get(`${empresa}|${k}`) ?? 0;
              if (antes + item.q > saldo + 1e-6) problemas.push('sem-estoque');
              if (antes) item.ant = arred(antes, 3); // outros boletins, antes deste, tiram do mesmo saldo
              consumido.set(`${empresa}|${k}`, antes + item.q);
            }
          }
        }
      }
      if (problemas.length) item.pr = problemas;
      g.b.it.push(item);
    }
    g.b.it.sort((a, b) => comparar(a.nm || a.c, b.nm || b.c));
    if (g.msgs.size) g.b.m = [...g.msgs];
    if (g.b.sit === 'P' && !g.b.it.length) g.b.si = 1;
    if (!porUnidade.has(g.unidade)) porUnidade.set(g.unidade, []);
    porUnidade.get(g.unidade).push(g.b);
  }
  return Object.fromEntries(porUnidade);
}

/* ---- páginas novas da validação: apontamentos recentes, necessidade de produto, dose e coletor ---- */
export const VALID_DIAS_APONT = 3; // apontamentos feitos ou lançados nos últimos N dias (hoje incluído)
export const VALID_DIAS_DOSE = 10;
export const VALID_DOSE_TOLERANCIA = 0.1; // dose real fora de ±10% da programada

/** 'YYYY-MM-DD' de `dias` dias antes de `agora` (data local do servidor). */
export function diaAnterior(agora, dias) {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Apontamentos feitos ou lançados desde `desdeDia` (de qualquer ordem, aberta ou fechada, e sem ordem),
 * com o que a conferência precisa: a ordem e as datas dela, o planejado do talhão na ordem (nulo = talhão
 * fora da ordem), o total já apontado no talhão e, na aplicação de insumo, quantos itens o boletim tem.
 */
export function montarSqlApontamentosRecentes(desdeDia, pular = 0, tamanho = VALID_PAGINA) {
  const d = String(desdeDia).replace(/[^0-9-]/g, '');
  const cond = (a) => `(${a}DT_OPERACAO >= '${d}' OR ${a}LAST_UPDATE >= '${d}')`;
  return `SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, os.FG_SITUACAO AS os_sit, CONVERT(varchar(10), os.DT_ABERTURA, 23) AS abertura,
  CONVERT(varchar(10), os.DT_ENCERRA, 23) AS encerramento, COALESCE(eo.DE_EQUIPE, ea.DE_EQUIPE) AS equipe, op.DE_OPERACAO AS operacao_de, ap.tipo, ap.NO_BOLETIM AS boletim,
  CONVERT(varchar(10), ap.DT_OPERACAO, 23) AS dia, up.CD_UPNIVEL3 AS talhao, ap.ha, CONVERT(varchar(16), ap.LAST_UPDATE, 120) AS lancado, ap.CHANGED_BY AS por, ap.itens,
  lc.ha AS plan_talhao, tot.ha AS exec_talhao
FROM (
  SELECT 'P' AS tipo, ID_APORDSERVICO, ID_UNIDADEADM, ID_EQUIPE, ID_OPERACAO, NO_BOLETIM, DT_OPERACAO, ID_UPNIVEL3, QT_AREA AS ha, LAST_UPDATE, CHANGED_BY, NULL AS itens
    FROM ${PIMS}APPLANTIO WHERE ${cond('')}
  UNION ALL SELECT 'A', ID_APORDSERVICO, ID_UNIDADEADM, ID_EQUIPE, ID_OPERACAO, NO_BOLETIM, DT_OPERACAO, ID_UPNIVEL3, QT_AREA_EXEC, LAST_UPDATE, CHANGED_BY, NULL
    FROM ${PIMS}APATIVPROD WHERE ${cond('')}
  UNION ALL SELECT 'I', a.ID_APORDSERVICO, a.ID_UNIDADEADM, a.ID_EQUIPE, a.ID_OPERACAO, a.NO_BOLETIM, a.DT_OPERACAO, l.ID_UPNIVEL3, l.QT_AREA_EXEC, a.LAST_UPDATE, a.CHANGED_BY,
      (SELECT COUNT(*) FROM ${PIMS}APAPLINS_INSLC i WHERE i.ID_APAPLINSUMO = a.ID_APAPLINSUMO)
    FROM ${PIMS}APAPLINSUMO a LEFT JOIN ${PIMS}APAPLINS_LC l ON l.ID_APAPLINSUMO = a.ID_APAPLINSUMO WHERE ${cond('a.')}
) ap
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = ap.ID_UNIDADEADM
LEFT JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = ap.ID_APORDSERVICO
LEFT JOIN ${PIMS}EQUIPE eo ON eo.ID_EQUIPE = os.ID_EQUIPE
LEFT JOIN ${PIMS}EQUIPE ea ON ea.ID_EQUIPE = ap.ID_EQUIPE
LEFT JOIN ${PIMS}OPERACAO op ON op.ID_OPERACAO = COALESCE(os.ID_OPERACAO, ap.ID_OPERACAO)
LEFT JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = ap.ID_UPNIVEL3
LEFT JOIN (SELECT ID_APORDSERVICO, ID_UPNIVEL3, SUM(QT_AREA) AS ha FROM ${PIMS}APORDSERVICO_LC GROUP BY ID_APORDSERVICO, ID_UPNIVEL3) lc
  ON lc.ID_APORDSERVICO = ap.ID_APORDSERVICO AND lc.ID_UPNIVEL3 = ap.ID_UPNIVEL3
LEFT JOIN (SELECT x.ID_APORDSERVICO, x.ID_UPNIVEL3, SUM(x.ha) AS ha FROM (${SQL_APONT_VALIDACAO}) x GROUP BY x.ID_APORDSERVICO, x.ID_UPNIVEL3) tot
  ON tot.ID_APORDSERVICO = ap.ID_APORDSERVICO AND tot.ID_UPNIVEL3 = ap.ID_UPNIVEL3
ORDER BY u.DE_UNI_ADM, ap.DT_OPERACAO DESC, ap.NO_BOLETIM, ap.ID_UPNIVEL3
${paginaSql(pular, tamanho)}`;
}

/**
 * Receita das ordens ABERTAS desde `desde`: para cada produto da ordem, o total planejado e o que os
 * boletins (aplicação de insumo e plantio) já consumiram. O que falta consumir é a necessidade.
 */
export function montarSqlNecessidadeValidacao(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  return `SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, e.DE_EQUIPE AS equipe, CONVERT(varchar(10), os.DT_ABERTURA, 23) AS abertura, op.DE_OPERACAO AS operacao_de,
  i.CD_INT_ERP AS item, i.DE_INSUMO AS nome, co.CONSUMO_TOTAL AS planejado, ISNULL(ci.q, 0) + ISNULL(cp.q, 0) AS consumido
FROM ${PIMS}APORDSERVICO os
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
JOIN ${PIMS}APORDSERVICO_CO co ON co.ID_APORDSERVICO = os.ID_APORDSERVICO
JOIN ${PIMS}INSUMO i ON i.ID_INSUMO = co.ID_INSUMO
LEFT JOIN ${PIMS}EQUIPE e ON e.ID_EQUIPE = os.ID_EQUIPE
LEFT JOIN ${PIMS}OPERACAO op ON op.ID_OPERACAO = os.ID_OPERACAO
LEFT JOIN (SELECT a.ID_APORDSERVICO, l.ID_INSUMO, SUM(l.QT_CONS_TOTAL) AS q FROM ${PIMS}APAPLINSUMO a JOIN ${PIMS}APAPLINS_INSLC l ON l.ID_APAPLINSUMO = a.ID_APAPLINSUMO
  WHERE a.ID_APORDSERVICO IS NOT NULL GROUP BY a.ID_APORDSERVICO, l.ID_INSUMO) ci ON ci.ID_APORDSERVICO = os.ID_APORDSERVICO AND ci.ID_INSUMO = co.ID_INSUMO
LEFT JOIN (SELECT a.ID_APORDSERVICO, l.ID_INSUMO, SUM(l.QT_TOTAL) AS q FROM ${PIMS}APPLANTIO a JOIN ${PIMS}APPLANTIO_IN l ON l.ID_APPLANTIO = a.ID_APPLANTIO
  WHERE a.ID_APORDSERVICO IS NOT NULL GROUP BY a.ID_APORDSERVICO, l.ID_INSUMO) cp ON cp.ID_APORDSERVICO = os.ID_APORDSERVICO AND cp.ID_INSUMO = co.ID_INSUMO
WHERE os.FG_SITUACAO = 'A' AND os.DT_ABERTURA >= '${d}'
ORDER BY 1, 2, 7`;
}

/**
 * Aplicações desde `desdeDia` em que a dose real fugiu da programada além da tolerância, com a Observação do boletim
 * (APAPLINSUMO.DE_OBSERVACAO): é nela que o coordenador justifica, no PIMS, a variação que aconteceu de verdade.
 */
export function montarSqlDoseValidacao(desdeDia) {
  const d = String(desdeDia).replace(/[^0-9-]/g, '');
  return `SELECT u.DE_UNI_ADM AS unidade, a.NO_BOLETIM AS boletim, CONVERT(varchar(10), a.DT_OPERACAO, 23) AS dia, os.NO_BOLETIM AS os, COALESCE(eo.DE_EQUIPE, ea.DE_EQUIPE) AS equipe,
  up.CD_UPNIVEL3 AS talhao, i.CD_INT_ERP AS item, i.DE_INSUMO AS nome, l.QT_DOSE_PROG AS prog, l.QT_DOSE_REAL AS dose_real, l.QT_AREA_EXEC AS ha, l.QT_CONS_TOTAL AS total, a.DE_OBSERVACAO AS obs
FROM ${PIMS}APAPLINSUMO a
JOIN ${PIMS}APAPLINS_INSLC l ON l.ID_APAPLINSUMO = a.ID_APAPLINSUMO
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = a.ID_UNIDADEADM
LEFT JOIN ${PIMS}INSUMO i ON i.ID_INSUMO = l.ID_INSUMO
LEFT JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = l.ID_UPNIVEL3
LEFT JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = a.ID_APORDSERVICO
LEFT JOIN ${PIMS}EQUIPE eo ON eo.ID_EQUIPE = os.ID_EQUIPE
LEFT JOIN ${PIMS}EQUIPE ea ON ea.ID_EQUIPE = a.ID_EQUIPE
WHERE a.DT_OPERACAO >= '${d}' AND l.QT_DOSE_PROG > 0 AND ABS(l.QT_DOSE_REAL - l.QT_DOSE_PROG) / l.QT_DOSE_PROG > ${VALID_DOSE_TOLERANCIA}
ORDER BY 1, a.DT_OPERACAO DESC, a.NO_BOLETIM, 8`;
}

/**
 * Boletins que já estão no PIMS, na tela de validação, aguardando a importação (tabelas *_TMP), com a mensagem que o
 * PIMS registrou e o que a conferência precisa para prever o erro da importação: a ordem (se existe, se está aberta,
 * as datas), o planejado e o já apontado no talhão, e se o número do boletim já existe entre os apontamentos.
 */
export function montarSqlColetorValidacao(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  // `final` = tabela onde o boletim cai depois de importado; `area` = a coluna de hectares do boletim e da tabela final
  const parte = (tipo, tabela, final, area) => {
    const comOrdem = tipo !== 'M';
    const comTalhao = Boolean(area);
    const os = comOrdem ? `LEFT JOIN ${PIMS}APORDSERVICO os ON os.ID_APORDSERVICO = COALESCE(t.ID_APORDSERVICO,
    (SELECT MAX(o2.ID_APORDSERVICO) FROM ${PIMS}APORDSERVICO o2 WHERE o2.ID_UNIDADEADM = t.ID_UNIDADEADM AND o2.NO_BOLETIM = t.NO_APORDSERVICO))
LEFT JOIN ${PIMS}EQUIPE eo ON eo.ID_EQUIPE = os.ID_EQUIPE` : '';
    return `SELECT u.DE_UNI_ADM AS unidade, '${tipo}' AS tipo, t.NO_BOLETIM AS boletim, CONVERT(varchar(10), t.DT_OPERACAO, 23) AS dia,
  ${comOrdem ? 'CONVERT(varchar(20), t.NO_APORDSERVICO)' : 'NULL'} AS os, ${comOrdem ? 'COALESCE(eo.DE_EQUIPE, t.DE_EQUIPE)' : 't.DE_EQUIPE'} AS equipe, ${comOrdem ? 't.DE_OPERACAO' : 'NULL'} AS operacao_de,
  t.FG_STATUS AS st, t.DE_MENSAGEM AS msg, CONVERT(varchar(16), t.LAST_UPDATE, 120) AS lancado, t.CHANGED_BY_MOBIL AS por,
  ${comTalhao ? 't.CD_UPNIVEL3' : 'NULL'} AS talhao, ${comTalhao ? `t.${area}` : 'NULL'} AS ha,
  ${comOrdem ? 'os.FG_SITUACAO' : 'NULL'} AS os_sit, ${comOrdem ? 'CONVERT(varchar(10), os.DT_ABERTURA, 23)' : 'NULL'} AS os_ab, ${comOrdem ? 'CONVERT(varchar(10), os.DT_ENCERRA, 23)' : 'NULL'} AS os_enc,
  ${comTalhao ? `(SELECT SUM(lc.QT_AREA) FROM ${PIMS}APORDSERVICO_LC lc WHERE lc.ID_APORDSERVICO = os.ID_APORDSERVICO AND lc.ID_UPNIVEL3 = t.ID_UPNIVEL3)` : 'NULL'} AS plan_talhao,
  ${comTalhao ? `(SELECT SUM(f.${area}) FROM ${PIMS}${final} f WHERE f.ID_APORDSERVICO = os.ID_APORDSERVICO AND f.ID_UPNIVEL3 = t.ID_UPNIVEL3)` : 'NULL'} AS exec_talhao,
  (SELECT COUNT(*) FROM ${PIMS}${final} f WHERE f.NO_BOLETIM = t.NO_BOLETIM AND f.ID_UNIDADEADM = t.ID_UNIDADEADM) AS ja_no_pims
FROM ${PIMS}${tabela} t
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = t.ID_UNIDADEADM
${os}
WHERE t.DT_OPERACAO >= '${d}'`;
  };
  return `${parte('I', 'APAPLINSUMO_TMP', 'APAPLINSUMO', null)}
UNION ALL
${parte('P', 'APPLANTIO_TMP', 'APPLANTIO', 'QT_AREA')}
UNION ALL
${parte('A', 'APATIVPROD_TMP', 'APATIVPROD', 'QT_AREA_EXEC')}
UNION ALL
${parte('M', 'APATIVMEC_TMP', 'APATIVMEC', null)}
ORDER BY 1, 4 DESC, 3`;
}

const numOuNulo = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Junta, por unidade, os dados das páginas novas (chaves curtas, todas com `eq` = coordenador):
 *   ap   [{ os, s, ab, enc, eq, opn, t tipo, b boletim, d dia, tl talhão, ha, la lançado, por, it itens (insumo),
 *           pt planejado do talhão na ordem (null = fora da ordem), xt total apontado no talhão }]
 *   nec  [{ os, eq, ab, opn, c item, nm, pl planejado, co consumido }]
 *   dose [{ b, d, os, eq, tl, c, nm, pg programada, re real, ha, q total, ju justificativa (Observação do boletim) }]
 *   col  [{ t, b, d, os, eq, opn, st, m mensagem do PIMS, la, por, tl talhão, ha, oss situação da ordem (null = não existe),
 *           oab/oenc abertura e encerramento da ordem, pt planejado no talhão (null = fora da ordem), xt já apontado, dup 1 = nº já usado }]
 */
export function linhasExtras({ apontamentos = [], necessidade = [], dose = [], coletor = [] }) {
  const porUnidade = new Map();
  const de = (unidade) => {
    const u = txt(unidade);
    if (!u) return null;
    if (!porUnidade.has(u)) porUnidade.set(u, { ap: [], nec: [], dose: [], col: [] });
    return porUnidade.get(u);
  };
  for (const r of apontamentos) {
    const x = de(r.unidade);
    if (!x || !txt(r.dia)) continue;
    const a = {
      os: numOuNulo(r.os), s: txt(r.os_sit), ab: txt(r.abertura), enc: txt(r.encerramento), eq: txt(r.equipe), opn: txt(r.operacao_de) ?? '', t: txt(r.tipo), b: numOuNulo(r.boletim),
      d: txt(r.dia), tl: txt(r.talhao), ha: arred(r.ha), la: txt(r.lancado), por: txt(r.por), pt: r.plan_talhao === null || r.plan_talhao === undefined ? null : arred(r.plan_talhao), xt: arred(r.exec_talhao),
    };
    if (a.t === 'I') a.it = Number(r.itens) || 0;
    x.ap.push(a);
  }
  for (const r of necessidade) {
    const x = de(r.unidade);
    if (!x || !txt(r.item)) continue;
    x.nec.push({ os: numOuNulo(r.os), eq: txt(r.equipe), ab: txt(r.abertura), opn: txt(r.operacao_de) ?? '', c: txt(r.item), nm: txt(r.nome) ?? '', pl: arred(r.planejado, 3), co: arred(r.consumido, 3) });
  }
  for (const r of dose) {
    const x = de(r.unidade);
    if (!x) continue;
    const linhaDose = { b: numOuNulo(r.boletim), d: txt(r.dia), os: numOuNulo(r.os), eq: txt(r.equipe), tl: txt(r.talhao), c: txt(r.item), nm: txt(r.nome) ?? '', pg: arred(r.prog, 4), re: arred(r.dose_real, 4), ha: arred(r.ha), q: arred(r.total, 3) };
    const justificativa = txt(r.obs);
    if (justificativa) linhaDose.ju = justificativa.replace(/\s+/g, ' ').slice(0, 300);
    x.dose.push(linhaDose);
  }
  for (const r of coletor) {
    const x = de(r.unidade);
    if (!x) continue;
    const c = { t: txt(r.tipo), b: numOuNulo(r.boletim), d: txt(r.dia), os: txt(r.os), eq: txt(r.equipe), opn: txt(r.operacao_de) ?? '', st: txt(r.st), m: (txt(r.msg) ?? '').slice(0, 600), la: txt(r.lancado), por: txt(r.por) };
    if (txt(r.talhao)) { c.tl = txt(r.talhao); c.ha = arred(r.ha); }
    if (c.os) {
      c.oss = txt(r.os_sit);
      c.oab = txt(r.os_ab);
      c.oenc = txt(r.os_enc);
      if (c.tl) { c.pt = r.plan_talhao === null || r.plan_talhao === undefined ? null : arred(r.plan_talhao); c.xt = arred(r.exec_talhao); }
    }
    if (Number(r.ja_no_pims) > 0) c.dup = 1;
    x.col.push(c);
  }
  return Object.fromEntries(porUnidade);
}

/** Vínculos coordenador ↔ depósito cadastrados na tela (valid_vinculos); sem a tabela → []. */
export async function lerVinculosValidacao({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`${url}/rest/v1/valid_vinculos?select=unidade,deposito`, { headers: cabecalhosSupabase(chave) });
  if (!resp.ok) {
    const texto = await resp.clone().text().catch(() => '');
    if (resp.status === 404 || /PGRST205|42P01/.test(texto)) return [];
    await erroSupabase(resp, chave, 'a leitura de valid_vinculos');
  }
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas : [];
}

/**
 * Depósitos a consultar no SAP: { empresa: { unidade: [códigos] } } a partir dos vínculos. Só o depósito
 * de cada coordenador: a origem de cada produto vem das transferências de estoque (montarSqlEstoqueSap).
 */
export function depositosVinculados(vinculos) {
  const porEmpresa = {};
  for (const v of vinculos) {
    const empresa = SAP_EMPRESA_DA_UNIDADE[txt(v.unidade) ?? ''];
    if (!empresa || !ehCodigoSap(v.deposito)) continue;
    const lista = ((porEmpresa[empresa] ??= {})[v.unidade] ??= []);
    if (!lista.includes(String(v.deposito))) lista.push(String(v.deposito));
  }
  return porEmpresa;
}

/**
 * Consulta o PIMS (e o SAP, para nomes de depósito e saldo dos vinculados) e devolve
 * { geradoEm, linhas, avisos } da validação (não grava nada). Falha do SAP não derruba as ordens: vira aviso.
 */
export async function sincronizarValidacao({ url, token, vinculos = [], fetchImpl = fetch, agora = new Date() }) {
  const desde = inicioSafraValidacao(agora);
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const ordens = [];
    for (let pular = 0; ; pular += VALID_PAGINA) {
      const pagina = objetosDe(await cliente.consultar(montarSqlOrdensValidacao(desde, pular), 'ordens de serviço abertas e fechadas com diferença de área (validação)', 'ordens de serviço'));
      ordens.push(...pagina);
      if (pagina.length < VALID_PAGINA) break;
    }
    const paginar = async (montar, motivo, rotulo) => {
      const todas = [];
      for (let pular = 0; ; pular += VALID_PAGINA) {
        const pagina = objetosDe(await cliente.consultar(montar(pular), motivo, rotulo));
        todas.push(...pagina);
        if (pagina.length < VALID_PAGINA) return todas;
      }
    };
    const talhoes = await paginar((pular) => montarSqlTalhoesValidacao(desde, pular), 'talhões planejados das ordens de serviço (validação)', 'talhões das ordens');
    const apontamentos = await paginar((pular) => montarSqlApontamentosValidacao(desde, pular), 'apontamentos de cada ordem de serviço (validação)', 'apontamentos das ordens');
    const evolucao = objetosDe(await cliente.consultar(SQL_EVOLUCAO_VALIDACAO, 'área apontada por dia nas ordens abertas (validação)', 'evolução das ordens'));
    const coordenadores = objetosDe(await cliente.consultar(montarSqlCoordenadoresValidacao(desde), 'coordenadores com ordem de serviço na safra (validação)', 'coordenadores'));
    const depositos = objetosDe(await cliente.consultar(SQL_DEPOSITOS_PIMS, 'depósitos do PIMS com código do SAP (validação)', 'depósitos'));
    const falhas = objetosDe(await cliente.consultar(montarSqlBoletinsFalha(desde), 'itens de boletim recusados pelo SAP na integração (validação)', 'boletins com falha'));
    const pendentes = objetosDe(await cliente.consultar(montarSqlBoletinsPendentes(desde), 'boletins ainda não enviados ao SAP (validação)', 'boletins pendentes'));
    const logs = {};
    const sapItens = {};
    const apontRecentes = await paginar((pular) => montarSqlApontamentosRecentes(diaAnterior(agora, VALID_DIAS_APONT - 1), pular), 'apontamentos feitos ou lançados nos últimos dias (validação)', 'apontamentos recentes');
    const necessidade = objetosDe(await cliente.consultar(montarSqlNecessidadeValidacao(desde), 'produtos planejados e já consumidos nas ordens abertas (validação)', 'necessidade das ordens'));
    const dose = objetosDe(await cliente.consultar(montarSqlDoseValidacao(diaAnterior(agora, VALID_DIAS_DOSE)), 'aplicações com dose real fora da programada (validação)', 'dose real x programada'));
    const coletor = objetosDe(await cliente.consultar(montarSqlColetorValidacao(desde), 'boletins na tela de validação do PIMS, aguardando a importação (validação)', 'boletins em validação'));

    const avisos = [];
    const depositosSap = {};
    const estoque = {};
    const vinculados = depositosVinculados(vinculos);
    for (const empresa of new Set(Object.values(SAP_EMPRESA_DA_UNIDADE))) {
      const fonte = { nome: 'SAP', source: 'hana', database: empresa, schema: empresa };
      try {
        const mapa = new Map();
        for (const r of objetosDe(await cliente.consultar(SQL_DEPOSITOS_SAP, 'depósitos do SAP (validação)', `depósitos ${empresa}`, fonte))) {
          if (txt(r.codigo)) mapa.set(txt(r.codigo), { nome: txt(r.nome), inativo: txt(r.inativo) === 'Y' });
        }
        depositosSap[empresa] = mapa;
        // boletins desta empresa: o motivo da recusa (log do SAP) e o saldo dos itens nos depósitos de saída
        const daEmpresa = (r) => SAP_EMPRESA_DA_UNIDADE[txt(r.unidade) ?? ''] === empresa;
        const numeros = falhas.filter(daEmpresa).map((r) => String(r.boletim ?? ''));
        if (numeros.some((b) => /^\d{1,18}$/.test(b))) {
          logs[empresa] = new Map(objetosDe(await cliente.consultar(montarSqlLogIntegracaoSap(numeros, desde), 'mensagens do SAP para os boletins recusados (validação)', `log de integração ${empresa}`, fonte))
            .map((r) => [String(r.id_item), { msg: txt(r.msg), n: Number(r.tentativas) || 0, primeira: txt(r.primeira), ultima: txt(r.ultima) }]));
        }
        const doSap = [...falhas, ...pendentes].filter(daEmpresa);
        if (doSap.some((r) => ehCodigoSap(r.material))) {
          const itens = new Map();
          const saldo = new Map();
          for (const r of objetosDe(await cliente.consultar(montarSqlSaldoItensSap(doSap.map((r) => r.material), doSap.map((r) => r.deposito)), 'cadastro e saldo dos itens dos boletins (validação)', `itens ${empresa}`, fonte))) {
            const item = txt(r.item);
            if (!item) continue;
            itens.set(item, { nome: txt(r.nome) ?? '', un: txt(r.unidade) ?? '', inativo: txt(r.congelado) === 'Y' });
            if (txt(r.deposito)) saldo.set(`${item}|${txt(r.deposito)}`, Number(r.saldo) || 0);
          }
          sapItens[empresa] = { itens, saldo };
        }
        const porUnidade = vinculados[empresa];
        if (!porUnidade) continue;
        const res = objetosDe(await cliente.consultar(montarSqlEstoqueSap(Object.values(porUnidade).flat()), 'saldo dos depósitos dos coordenadores e origem de cada produto pelas transferências (validação)', `saldo ${empresa}`, fonte));
        for (const [unidade, codigos] of Object.entries(porUnidade)) {
          const porDeposito = (estoque[unidade] ??= {});
          for (const c of codigos) porDeposito[c] = [];
          for (const r of res) {
            const dep = txt(r.deposito);
            if (dep && porDeposito[dep]) porDeposito[dep].push(itemDoSaldoSap(r));
          }
        }
      } catch (e) {
        const msg = `Saldo do SAP indisponível (${empresa}): ${String(e instanceof Error ? e.message : e).slice(0, 160)}`;
        console.warn(`Validação: ${semChave(msg, token)}`);
        avisos.push(`sap:${empresa}`);
      }
    }
    const geradoEm = agora.toISOString();
    const boletins = linhasBoletins({ falhas, pendentes, logs, sap: sapItens, depositosSap });
    const extras = linhasExtras({ apontamentos: apontRecentes, necessidade, dose, coletor });
    return { geradoEm, linhas: linhasValidacao({ ordens, evolucao, coordenadores, depositos, talhoes, apontamentos, depositosSap, estoque, boletins, extras, avisos }, geradoEm), avisos };
  } finally {
    await cliente.fechar();
  }
}

/** Grava em valid_pims (upsert por unidade e limpeza das rodadas anteriores). 'ok', 'vazio' ou 'sem-tabela'. */
export async function gravarValidacaoSupabase(dados, { url, chave, fetch: fetchImpl = globalThis.fetch }) {
  if (!dados.linhas.length) {
    console.warn('Validação: o PIMS não retornou nenhuma ordem; valid_pims não foi alterada.');
    return 'vazio';
  }
  const enviar = (linhas) => fetchImpl(`${url}/rest/v1/valid_pims?on_conflict=unidade`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  });
  let resp = await enviar(dados.linhas);
  if (!resp.ok && /PGRST204/.test(await resp.clone().text().catch(() => ''))) {
    // banco ainda sem as colunas novas (scripts 0008 e 0009): grava o resto, para as ordens não pararem
    console.warn('Validação: faltam colunas em valid_pims (rode supabase/0008_validacao_boletins.sql e 0009_controle_tecnico.sql); gravando sem os boletins e as páginas novas.');
    resp = await enviar(dados.linhas.map(({ boletins: _b, extras: _e, ...resto }) => resto));
  }
  if (!resp.ok) {
    const texto = await resp.clone().text().catch(() => '');
    if (resp.status === 404 || /PGRST205|42P01/.test(texto)) {
      console.warn('Validação: a tabela valid_pims ainda não existe no Supabase (rode supabase/0007_validacao_pims.sql).');
      return 'sem-tabela';
    }
    await erroSupabase(resp, chave, 'o upsert em valid_pims');
  }
  const limpeza = await fetchImpl(`${url}/rest/v1/valid_pims?gerado_em=lt.${encodeURIComponent(dados.geradoEm)}`, { method: 'DELETE', headers: cabecalhosSupabase(chave) });
  if (!limpeza.ok) await erroSupabase(limpeza, chave, 'a limpeza de valid_pims');
  return 'ok';
}

/** Etapa da validação dentro da rotina: lê os vínculos, consulta, grava e registra só totais. Devolve null ou a mensagem de erro. */
export async function rodarValidacao({ agrovex, supabase, fetchImpl = globalThis.fetch }) {
  try {
    const vinculos = await lerVinculosValidacao({ ...supabase, fetch: fetchImpl });
    const dados = await sincronizarValidacao({ url: agrovex.url, token: agrovex.token, vinculos, fetchImpl });
    const situacao = await gravarValidacaoSupabase(dados, { ...supabase, fetch: fetchImpl });
    const ordens = dados.linhas.reduce((s, l) => s + l.ordens.length, 0);
    const abertas = dados.linhas.reduce((s, l) => s + l.ordens.filter((o) => o.s === 'A').length, 0);
    console.log(`Validação: ${situacao === 'ok' ? 'gravado no Supabase' : situacao}; ${dados.linhas.length} unidades, ${abertas} ordens abertas, ${ordens - abertas} fechadas com diferença, ${vinculos.length} vínculos de depósito${dados.avisos.length ? `; avisos: ${dados.avisos.join(', ')}` : ''}.`);
    return null;
  } catch (e) {
    const msg = semChave(semChave(e instanceof Error ? e.message : String(e), supabase.chave), agrovex.token);
    console.error(`Validação: erro (o plantio dos mapas não foi afetado): ${msg}`);
    return msg;
  }
}

// ---------- boletins de atividades mecanizadas (botão "Buscar direto no PIMS" de Mecanizadas) ----------

/** período máximo de um pedido de boletins (dias) */
export const MEC_MAX_DIAS = 62;
/** linhas por consulta (o servidor de dados corta o resultado em 5.000) e teto do pedido inteiro */
const MEC_PAGINA = 4000;
const MEC_MAX_LINHAS = 40000;

/** As 22 colunas do relatório "atividades mecanizadas" exportado do PIMS, na mesma ordem e com os mesmos nomes. */
export const MEC_CABECALHO = [
  'Unidade Administrativa', 'Categoria Operacional', 'Equipe', 'Boletim', 'Data', 'Equipamento', 'Modelo', 'Implemento', '',
  'Funcionário', '', 'Ano Agrícola', 'Período de Produção', '', 'Centro de Custo', '', 'Operação', '', 'Hr/Km Inicial', 'Hr/Km Final',
  'Total Hr/Km', 'Situação',
];

/** Confere o pedido: unidade do PIMS (ex.: 'T. FLECHAS') e período 'YYYY-MM-DD' de até MEC_MAX_DIAS dias; lança Error legível. */
export function validarPedidoMec(unidade, de, ate) {
  const u = String(unidade ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 .]{1,29}$/.test(u)) throw new Error('Unidade inválida.');
  const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ehData(de) || !ehData(ate)) throw new Error('Período inválido: informe as duas datas.');
  if (de > ate) throw new Error('Período inválido: a data inicial é depois da final.');
  const dias = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias > MEC_MAX_DIAS) throw new Error(`Período muito longo (${dias} dias): o máximo é ${MEC_MAX_DIAS} dias.`);
  return { unidade: u, de, ate, dias };
}

/**
 * Lançamentos dos boletins de atividades mecanizadas de uma unidade no período (de e até inclusive), uma
 * página por vez. Só operações apontadas por horímetro/km (FG_TP_HR = '1'), como no relatório do PIMS (as
 * apontadas por relógio, como pausa e inspeção diária, não aparecem lá). O período de produção vem do
 * lançamento ou, na falta, do talhão.
 */
export function montarSqlMecanizadas(unidade, de, ate, pular = 0, tamanho = MEC_PAGINA) {
  const p = validarPedidoMec(unidade, de, ate);
  return `SELECT u.DA_UNI_ADM AS unidade, co.DE_CATEG_OPERAC AS categoria, e.DE_EQUIPE AS equipe, a.NO_BOLETIM AS boletim,
  CONVERT(varchar(10), a.DT_OPERACAO, 23) AS data, eq.CD_EQUIPTO AS equipamento, mo.DE_MODELO AS modelo,
  im.CD_EQUIPTO AS implemento, mi.DE_MODELO AS implemento_de, f.CD_FUNCIONAR AS funcionario, f.DE_FUNCIONAR AS funcionario_de,
  s.CD_SAFRA AS ano_agricola, ps.CD_PER_SAFRA AS periodo, ps.DE_PER_SAFRA AS periodo_de, cc.CD_CCUSTO AS ccusto, cc.DE_CCUSTO AS ccusto_de,
  o.CD_OPERACAO AS operacao, o.DE_OPERACAO AS operacao_de, lc.QT_INI_HK AS ini, lc.QT_FIM_HK AS fim, lc.QT_TOTAL_HK AS total
FROM ${PIMS}APATIVMEC a
JOIN ${PIMS}APATIVMEC_LC lc ON lc.ID_APATIVMEC = a.ID_APATIVMEC
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = a.ID_UNIDADEADM
JOIN ${PIMS}OPERACAO o ON o.ID_OPERACAO = lc.ID_OPERACAO
LEFT JOIN ${PIMS}EQUIPE e ON e.ID_EQUIPE = a.ID_EQUIPE
LEFT JOIN ${PIMS}EQUIPTO eq ON eq.ID_EQUIPTO = a.ID_EQUIPTO
LEFT JOIN ${PIMS}MODELO mo ON mo.ID_MODELO = eq.ID_MODELO
LEFT JOIN ${PIMS}CATOPERACIONAL co ON co.ID_CATOPERACIONAL = eq.ID_CATOPERACIONAL
LEFT JOIN ${PIMS}EQUIPTO im ON im.ID_EQUIPTO = lc.ID_EQUIPTO_IM
LEFT JOIN ${PIMS}MODELO mi ON mi.ID_MODELO = im.ID_MODELO
LEFT JOIN ${PIMS}FUNCIONAR f ON f.ID_FUNCIONAR = a.ID_FUNCIONAR
LEFT JOIN ${PIMS}UPNIVEL3 up ON up.ID_UPNIVEL3 = lc.ID_UPNIVEL3
LEFT JOIN ${PIMS}PERIODOSAFRA ps ON ps.ID_PERIODOSAFRA = COALESCE(lc.ID_PERIODOSAFRA, up.ID_PERIODOSAFRA)
LEFT JOIN ${PIMS}SAFRA s ON s.ID_SAFRA = COALESCE(lc.ID_SAFRA, ps.ID_SAFRA)
LEFT JOIN ${PIMS}CCUSTO cc ON cc.ID_CCUSTO = lc.ID_CCUSTO
WHERE u.DA_UNI_ADM = '${p.unidade.replace(/'/g, "''")}' AND o.FG_TP_HR = '1'
  AND a.DT_OPERACAO >= '${p.de}' AND a.DT_OPERACAO < DATEADD(day, 1, '${p.ate}')
ORDER BY a.DT_OPERACAO, a.NO_BOLETIM, lc.ID_APATIVMEC_LC
OFFSET ${Math.max(0, Math.floor(pular))} ROWS FETCH NEXT ${Math.max(1, Math.floor(tamanho))} ROWS ONLY`;
}

/** 3491.9 → '3.491,90' (como o PIMS escreve Hr/Km no relatório); sem número → ''. */
export function fmtHrKm(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const [inteiro, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

/**
 * Resultado da consulta → linhas do relatório, com as mesmas 22 colunas, a mesma ordem (categoria,
 * equipamento, data, Hr/Km inicial) e a coluna "Situação" do PIMS: "Início" no primeiro lançamento de cada
 * equipamento; "Correto" quando o Hr/Km inicial continua o final do lançamento anterior; senão "Incorreto".
 */
export function linhasMecanizadas(objs) {
  const t = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const ordenadas = objs.slice().sort((a, b) =>
    comparar(t(a.categoria), t(b.categoria)) || comparar(t(a.equipamento), t(b.equipamento)) || comparar(t(a.data), t(b.data)) ||
    (Number(a.ini) || 0) - (Number(b.ini) || 0) || (Number(a.fim) || 0) - (Number(b.fim) || 0) || (Number(a.boletim) || 0) - (Number(b.boletim) || 0));
  const fimAnterior = new Map();
  return ordenadas.map((r) => {
    const eq = t(r.equipamento);
    const ini = Number(r.ini);
    const situacao = !fimAnterior.has(eq) ? 'Início' : Math.abs(fimAnterior.get(eq) - ini) < 0.011 ? 'Correto' : 'Incorreto';
    fimAnterior.set(eq, Number(r.fim));
    const d = t(r.data);
    return [
      t(r.unidade), t(r.categoria), t(r.equipe), t(r.boletim), /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d,
      eq, t(r.modelo), t(r.implemento), t(r.implemento_de), t(r.funcionario), t(r.funcionario_de), t(r.ano_agricola), t(r.periodo), t(r.periodo_de),
      t(r.ccusto), t(r.ccusto_de), t(r.operacao), t(r.operacao_de), fmtHrKm(r.ini), fmtHrKm(r.fim), fmtHrKm(r.total), situacao,
    ];
  });
}

/**
 * Consulta o PIMS pelo Agrovex: boletins de atividades mecanizadas da unidade no período. Devolve
 * { unidade, de, ate, cabecalho, linhas } no formato do relatório exportado (não grava nada).
 */
export async function boletinsMecanizadas({ url, token, unidade, de, ate, fetchImpl = fetch }) {
  const p = validarPedidoMec(unidade, de, ate);
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const objs = [];
    for (let pular = 0; ; pular += MEC_PAGINA) {
      const res = await cliente.consultar(montarSqlMecanizadas(p.unidade, p.de, p.ate, pular, MEC_PAGINA), 'boletins de atividades mecanizadas (COA WEB)', 'atividades mecanizadas');
      const pagina = objetosDe(res);
      objs.push(...pagina);
      if (pagina.length < MEC_PAGINA) break;
      if (objs.length >= MEC_MAX_LINHAS) throw new Error(`O período tem mais de ${MEC_MAX_LINHAS} lançamentos: escolha um período menor.`);
    }
    return { unidade: p.unidade, de: p.de, ate: p.ate, cabecalho: MEC_CABECALHO, linhas: linhasMecanizadas(objs) };
  } finally {
    await cliente.fechar();
  }
}

// ---------- chuva por PIC (botão "Inserir dados via integração" do Mapa de Chuva) ----------

/** período máximo de um pedido de chuva (dias) */
export const CHUVA_PICS_MAX_DIAS = 366;

/** 'hh:mm' (ou 'hh:mm:ss', como o Postgres devolve a coluna time) → 'hh:mm'; fora do formato → null. */
function horaDoPedido(h) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(h ?? '').trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * Confere as datas do pedido ('YYYY-MM-DD', de ≤ até, no máximo CHUVA_PICS_MAX_DIAS dias) e, se vierem, a
 * hora inicial e a final ('hh:mm', as duas ou nenhuma); lança Error legível. Sem hora devolve { de, ate, dias }.
 */
export function validarPeriodoChuva(de, ate, deHora = null, ateHora = null) {
  const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ehData(de) || !ehData(ate)) throw new Error('Período inválido: informe as duas datas.');
  if (de > ate) throw new Error('Período inválido: a data inicial é depois da final.');
  const dias = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias > CHUVA_PICS_MAX_DIAS) throw new Error(`Período muito longo (${dias} dias): o máximo é ${CHUVA_PICS_MAX_DIAS} dias.`);
  const vazia = (h) => h === null || h === undefined || h === '';
  if (vazia(deHora) && vazia(ateHora)) return { de, ate, dias };
  if (vazia(deHora) || vazia(ateHora)) throw new Error('Período inválido: informe a hora inicial e a final.');
  const h1 = horaDoPedido(deHora);
  const h2 = horaDoPedido(ateHora);
  if (!h1 || !h2) throw new Error('Período inválido: informe as horas no formato hh:mm.');
  if (de === ate && h1 > h2) throw new Error('Período inválido: a hora inicial é depois da final.');
  return { de, ate, dias, deHora: h1, ateHora: h2 };
}

/** Cadastro dos PICs da ZEUS (um por picid; a tabela repete o PIC a cada talhão que ele cobre). */
export const SQL_PICS_ZEUS = `SELECT DISTINCT ON (picid) picid, picname, farm, lat, lon
FROM "DATABASE".stg_zeus_picarea
WHERE picid IS NOT NULL
ORDER BY picid, farm`;

/**
 * PICs de uma fazenda: compara o nome da fazenda do mapa com a fazenda da ZEUS sem acento, caixa e
 * prefixo ("Faz_SM3" = "SM3" = "Fazenda SM3"). Sem coordenada válida o PIC é descartado.
 */
export function picsDaFazendaZeus(res, fazenda) {
  const alvo = unidadeDaFazendaZeus(fazenda);
  const pics = [];
  for (const r of objetosDe(res)) {
    if (!alvo || unidadeDaFazendaZeus(r.farm) !== alvo) continue;
    const id = txt(r.picid);
    const lat = Number(String(r.lat ?? '').replace(',', '.'));
    const lon = Number(String(r.lon ?? '').replace(',', '.'));
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    pics.push({ id, nome: txt(r.picname) ?? `PIC ${id}`, lat, lon });
  }
  return pics.sort((a, b) => comparar(a.nome, b.nome));
}

/** Fazendas que a ZEUS conhece (para a mensagem de "fazenda não encontrada"). */
export function fazendasDaZeus(res) {
  return [...new Set(objetosDe(res).map((r) => unidadeDaFazendaZeus(r.farm)).filter(Boolean))].sort(comparar);
}

/** instante de cada leitura: os 14 últimos dígitos do identificador (picid + aaaammddhhmmss); a coluna data só tem o dia */
const INSTANTE_LEITURA = 'right(c.idprecipitation, 14)';

/**
 * Chuva somada de cada PIC no período (de e até inclusive), com a quantidade de leituras, o último dia lido
 * e a hora da última leitura. Com `deHora` e `ateHora` ('hh:mm'), entram só as leituras entre os dois
 * instantes, inclusive.
 */
export function montarSqlChuvaPics(ids, de, ate, deHora = null, ateHora = null) {
  const lista = ids.filter((i) => /^[A-Za-z0-9_-]+$/.test(String(i))).map((i) => `'${i}'`).join(', ');
  const d = String(de).replace(/[^0-9-]/g, '');
  const a = String(ate).replace(/[^0-9-]/g, '');
  const h1 = horaDoPedido(deHora);
  const h2 = horaDoPedido(ateHora);
  const digitos = (s) => s.replace(/\D/g, '');
  const porHora = h1 && h2 ? ` AND ${INSTANTE_LEITURA} >= '${digitos(d)}${digitos(h1)}00' AND ${INSTANTE_LEITURA} <= '${digitos(a)}${digitos(h2)}59'` : '';
  return `SELECT c.picid, round(sum(c.pluviometria)::numeric, 1) AS mm, count(c.pluviometria) AS leituras,
  to_char(max(c.data), 'YYYY-MM-DD') AS ultimo,
  max(CASE WHEN ${INSTANTE_LEITURA} ~ '^[0-9]{14}$' THEN ${INSTANTE_LEITURA} END) AS leitura
FROM "DATABASE".stg_climatemonitoring2 c
WHERE c.picid IN (${lista}) AND c.data >= DATE '${d}' AND c.data < DATE '${a}' + INTERVAL '1 day'${porHora}
GROUP BY c.picid`;
}

/** Junta o cadastro com a chuva: PIC sem nenhuma leitura no período fica com chuva null (não entra no mapa). */
export function montarChuvaPics(pics, res) {
  const porId = new Map(objetosDe(res).map((r) => [txt(r.picid), r]));
  let ultimoDia = null;
  /** 'aaaammddhhmmss' da leitura mais recente entre os PICs */
  let leitura = null;
  const lista = pics.map((p) => {
    const r = porId.get(p.id);
    const leituras = r ? Number(r.leituras) || 0 : 0;
    const ultimo = r ? txt(r.ultimo) : null;
    if (ultimo && (!ultimoDia || ultimo > ultimoDia)) ultimoDia = ultimo;
    const l = r ? txt(r.leitura) : null;
    if (l && /^\d{14}$/.test(l) && (!leitura || l > leitura)) leitura = l;
    const mm = r && leituras > 0 ? Number(r.mm) : null;
    return { ...p, chuva: mm !== null && Number.isFinite(mm) ? Math.round(mm * 10) / 10 : null, leituras };
  });
  // 'aaaa-mm-ddThh:mm' (hora da fazenda); só vale se for do último dia lido
  const completa = leitura && ultimoDia ? leituraDoDia(leitura, ultimoDia) : null;
  return { pics: lista, ultimoDia, ultimaLeitura: completa ? completa.slice(0, 16) : null };
}

/**
 * Consulta a ZEUS pelo Agrovex: PICs da fazenda e a chuva de cada um no período (com `deHora` e `ateHora`,
 * só entre os dois instantes). Devolve { fazenda, de, ate, [deHora, ateHora,] ultimoDia, ultimaLeitura,
 * pics: [{ id, nome, lat, lon, chuva, leituras }] } (não grava nada).
 */
export async function chuvaPorPicZeus({ url, token, fazenda, de, ate, deHora = null, ateHora = null, fetchImpl = fetch }) {
  const periodo = validarPeriodoChuva(de, ate, deHora, ateHora);
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const cadastro = await cliente.consultar(SQL_PICS_ZEUS, 'cadastro dos PICs da ZEUS (mapa de chuva)', 'PICs da ZEUS', FONTES.zeus);
    const pics = picsDaFazendaZeus(cadastro, fazenda);
    if (!pics.length) {
      const conhecidas = fazendasDaZeus(cadastro);
      throw new Error(`A ZEUS não tem PICs para a fazenda "${String(fazenda).slice(0, 60)}"${conhecidas.length ? ` (fazendas na ZEUS: ${conhecidas.join(', ')})` : ''}.`);
    }
    const chuva = await cliente.consultar(montarSqlChuvaPics(pics.map((p) => p.id), de, ate, periodo.deHora, periodo.ateHora), 'chuva por PIC no período (mapa de chuva)', 'chuva por PIC', FONTES.zeus);
    const horas = periodo.deHora ? { deHora: periodo.deHora, ateHora: periodo.ateHora } : {};
    return { fazenda: unidadeDaFazendaZeus(fazenda), de, ate, ...horas, ...montarChuvaPics(pics, chuva) };
  } finally {
    await cliente.fechar();
  }
}

// ---------- último dia da ZEUS no banco (aviso ao lado de "Inserir dados via integração") ----------

/** Dias para trás em que se procura a última leitura de cada fazenda (fazenda parada há mais que isso some do aviso). */
export const ZEUS_ULTIMO_DIA_JANELA = 45;

/**
 * Última leitura de chuva de cada fazenda da ZEUS no banco. A tabela não guarda quando a carga rodou: a
 * leitura mais recente é o que diz até onde ela chegou. A coluna data vem truncada no dia; a hora da
 * leitura está nos 14 últimos dígitos do identificador (picid + aaaammddhhmmss).
 */
export const SQL_ULTIMO_DIA_ZEUS = `WITH pa AS (SELECT DISTINCT ON (picid) picid, farm FROM "DATABASE".stg_zeus_picarea ORDER BY picid, farm)
SELECT pa.farm AS fazenda, to_char(max(c.data), 'YYYY-MM-DD') AS ultimo,
  max(CASE WHEN right(c.idprecipitation, 14) ~ '^[0-9]{14}$' THEN right(c.idprecipitation, 14) END) AS leitura
FROM "DATABASE".stg_climatemonitoring2 c JOIN pa ON pa.picid = c.picid
WHERE c.data >= CURRENT_DATE - ${ZEUS_ULTIMO_DIA_JANELA} AND c.pluviometria IS NOT NULL
GROUP BY pa.farm
ORDER BY 1`;

/** 'aaaammddhhmmss' do último dia → 'aaaa-mm-ddThh:mm:ss'; de outro dia ou hora impossível → null (fica só o dia). */
function leituraDoDia(leitura, dia) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(leitura ?? ''));
  if (!m || `${m[1]}-${m[2]}-${m[3]}` !== dia || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return null;
  return `${dia}T${m[4]}:${m[5]}:${m[6]}`;
}

/**
 * Linhas de mapas_zeus_situacao: uma por fazenda, com o nome normalizado como no pedido de chuva
 * ("Faz_SM3" → "SM3"). A mesma fazenda escrita de dois jeitos fica com a leitura mais recente.
 */
export function linhasSituacaoZeus(res, agora = new Date()) {
  const conferidoEm = agora.toISOString();
  const porFazenda = new Map();
  for (const r of objetosDe(res)) {
    const fazenda = unidadeDaFazendaZeus(r.fazenda);
    const dia = txt(r.ultimo);
    if (!fazenda || !dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    const nova = { dia, leitura: leituraDoDia(r.leitura, dia) };
    const atual = porFazenda.get(fazenda);
    if (!atual || nova.dia > atual.dia || (nova.dia === atual.dia && (nova.leitura ?? '') > (atual.leitura ?? ''))) porFazenda.set(fazenda, nova);
  }
  return [...porFazenda]
    .sort((a, b) => comparar(a[0], b[0]))
    .map(([fazenda, u]) => ({ fazenda: fazenda.slice(0, 80), ultimo_dia: u.dia, ultima_leitura: u.leitura, conferido_em: conferidoEm }));
}

/** Consulta a ZEUS pelo Agrovex e devolve as linhas de mapas_zeus_situacao (não grava nada). */
export async function ultimoDiaZeus({ url, token, fetchImpl = fetch, agora = new Date() }) {
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const res = await cliente.consultar(SQL_ULTIMO_DIA_ZEUS, 'último dia com leitura de chuva por fazenda (mapa de chuva)', 'último dia da ZEUS', FONTES.zeus);
    return linhasSituacaoZeus(res, agora);
  } finally {
    await cliente.fechar();
  }
}

// ---------- chuva por talhão (módulo chuva/ do COA WEB) ----------
// A mesma regra da visão vw_precipitacao_talhao da ZEUS: a chuva do talhão é a soma do dia de cada
// pluviômetro ligado a ele (stg_zeus_picarea), em média quando há mais de um. A visão não nomeia a Dourado
// nem a Nebraska e é pesada sem filtro, por isso a rotina lê as duas tabelas que ela usa e grava em
// chuva_talhao a chuva diária por pluviômetro e o vínculo talhão → pluviômetros; a tela faz a média.

/** tamanho da janela gravada, em dias (cobre a safra corrente inteira) */
export const CHUVA_TALHAO_DIAS = 400;
/** as fazendas ficam em UTC-4: o "hoje" da janela é o delas, não o do servidor */
const FUSO_FAZENDAS_H = 4;

/** Primeiro dia da janela ('YYYY-MM-DD'): CHUVA_TALHAO_DIAS dias terminando hoje, na data da fazenda. */
export function inicioChuvaTalhao(agora = new Date()) {
  const hoje = new Date(agora.getTime() - FUSO_FAZENDAS_H * 3_600_000);
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - (CHUVA_TALHAO_DIAS - 1))).toISOString().slice(0, 10);
}

/** Vínculo talhão → pluviômetro da ZEUS, com o cadastro do pluviômetro (a tabela repete o PIC a cada talhão). */
export const SQL_VINCULOS_ZEUS = `SELECT DISTINCT farm, talhao, picid, picname, lat, lon
FROM "DATABASE".stg_zeus_picarea
WHERE picid IS NOT NULL`;

/**
 * Chuva diária de cada pluviômetro desde `desde`, uma linha por pluviômetro: `dias` lista os dias com
 * leitura como 'n' (sem chuva) ou 'n:mm', sendo n os dias corridos desde `desde`. Dia fora da lista =
 * pluviômetro sem leitura. `leituras` = quantas leituras o pluviômetro costuma ter por dia; o dia com outra
 * quantidade leva 'xQ' no fim ('12:3.4x20'): a visão da ZEUS pesa a média do talhão pelo número de leituras
 * de cada pluviômetro no dia. `leitura` = instante da leitura mais recente (aaaammddhhmmss).
 */
export function montarSqlChuvaDiariaPics(desde) {
  const d = String(desde).replace(/[^0-9-]/g, '').slice(0, 10);
  return `WITH por_dia AS (
  SELECT c.picid, c.data::date AS dia, sum(c.pluviometria) AS mm, count(*) AS n,
    max(CASE WHEN right(c.idprecipitation, 14) ~ '^[0-9]{14}$' THEN right(c.idprecipitation, 14) END) AS leitura
  FROM "DATABASE".stg_climatemonitoring2 c
  WHERE c.data >= DATE '${d}'
  GROUP BY 1, 2
  HAVING count(c.pluviometria) > 0),
moda AS (SELECT picid, mode() WITHIN GROUP (ORDER BY n) AS n FROM por_dia GROUP BY picid)
SELECT p.picid, max(p.leitura) AS leitura, max(m.n) AS leituras,
  string_agg((p.dia - DATE '${d}')::text
    || CASE WHEN round(p.mm::numeric, 1) > 0 THEN ':' || round(p.mm::numeric, 1)::text ELSE '' END
    || CASE WHEN p.n <> m.n THEN 'x' || p.n::text ELSE '' END, ',' ORDER BY p.dia) AS dias
FROM por_dia p JOIN moda m ON m.picid = p.picid
GROUP BY p.picid
ORDER BY p.picid`;
}

/** 'aaaammddhhmmss' → 'aaaa-mm-ddThh:mm'; fora do padrão → null. */
function instanteDaLeitura(leitura) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(leitura ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31 || Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/** Código do talhão da ZEUS no formato do PIMS: 'TH19 (0)' → '019', 'PIVO 03' → '03PIVO', '2 (1)' → '002'. */
function codigoDoTalhaoZeus(talhao) {
  return normalizarCodigo(String(talhao ?? '').replace(/\s*\(\d+\)\s*$/, ''));
}

/**
 * Linhas de chuva_talhao: uma por fazenda da ZEUS (nome como o do PIMS: 'Faz_SM3' → 'SM3'), com
 * pics [{ id, n, lat, lon, ul última leitura, l leituras por dia, d dias }] em ordem de nome e vinculos { código: [índices em pics] }.
 * Pluviômetro sem fazenda no cadastro fica de fora; coordenada inválida vira null.
 */
export function linhasChuvaTalhao({ vinculos, chuva }, desde, geradoEm) {
  const porPic = new Map(objetosDe(chuva).map((r) => [txt(r.picid), r]));
  const fazendas = new Map();
  for (const r of objetosDe(vinculos)) {
    const unidade = unidadeDaFazendaZeus(r.farm);
    const id = txt(r.picid);
    if (!unidade || !id) continue;
    if (!fazendas.has(unidade)) fazendas.set(unidade, { pics: new Map(), talhoes: new Map() });
    const f = fazendas.get(unidade);
    if (!f.pics.has(id)) {
      const lat = Number(String(r.lat ?? '').replace(',', '.'));
      const lon = Number(String(r.lon ?? '').replace(',', '.'));
      const temLugar = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
      const lido = porPic.get(id);
      f.pics.set(id, {
        id, n: txt(r.picname) ?? `PIC ${id}`, lat: temLugar ? lat : null, lon: temLugar ? lon : null,
        ul: instanteDaLeitura(lido?.leitura), l: Math.max(1, Math.round(Number(lido?.leituras)) || 1),
        d: /^[0-9:.,x]*$/.test(txt(lido?.dias) ?? '') ? txt(lido?.dias) ?? '' : '',
      });
    }
    const codigo = codigoDoTalhaoZeus(r.talhao);
    if (!codigo) continue;
    if (!f.talhoes.has(codigo)) f.talhoes.set(codigo, new Set());
    f.talhoes.get(codigo).add(id);
  }
  return [...fazendas]
    .sort((a, b) => comparar(a[0], b[0]))
    .map(([unidade, f]) => {
      const pics = [...f.pics.values()].sort((a, b) => comparar(a.n, b.n) || comparar(a.id, b.id));
      const indice = new Map(pics.map((p, i) => [p.id, i]));
      const vinc = {};
      for (const codigo of [...f.talhoes.keys()].sort(comparar)) vinc[codigo] = [...f.talhoes.get(codigo)].map((id) => indice.get(id)).sort((a, b) => a - b);
      const ultima = pics.reduce((m, p) => (p.ul && p.ul > m ? p.ul : m), '');
      return { unidade: unidade.slice(0, 80), gerado_em: geradoEm, inicio: desde, dias: CHUVA_TALHAO_DIAS, ultima_leitura: ultima || null, pics, vinculos: vinc };
    });
}

/** Consulta a ZEUS pelo Agrovex e devolve as linhas de chuva_talhao (não grava nada). */
export async function sincronizarChuvaTalhao({ url, token, fetchImpl = fetch, agora = new Date() }) {
  const desde = inicioChuvaTalhao(agora);
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const vinculos = await cliente.consultar(SQL_VINCULOS_ZEUS, 'vínculo talhão × pluviômetro da ZEUS (chuva por talhão)', 'vínculos da ZEUS', FONTES.zeus);
    const chuva = await cliente.consultar(montarSqlChuvaDiariaPics(desde), 'chuva diária por pluviômetro (chuva por talhão)', 'chuva diária por pluviômetro', FONTES.zeus);
    return linhasChuvaTalhao({ vinculos, chuva }, desde, agora.toISOString());
  } finally {
    await cliente.fechar();
  }
}

// ---------- execução pela linha de comando ----------

async function main() {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(raiz, 'scripts', 'plantio.config.json'), 'utf8'));
  const token = process.env.AGROVEX_TOKEN?.trim();
  if (!token) {
    const aviso = 'AGROVEX_TOKEN não definido: plantio.json não foi atualizado.';
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${aviso}` : aviso);
    return;
  }
  const dados = await sincronizar({
    url: process.env.AGROVEX_URL || config.url,
    token,
    safras: config.safras ?? 'auto',
    excluirPrefixos: config.excluirPrefixos ?? [],
  });
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseChave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const gravaNoSupabase = Boolean(supabaseUrl && supabaseChave);
  const log = () => {
    const opcoes = { supabase: gravaNoSupabase, githubActions: Boolean(process.env.GITHUB_ACTIONS) };
    for (const l of linhasDeLog(dados, opcoes)) console.log(l);
  };
  if (gravaNoSupabase) {
    await gravarSupabase(dados, { url: supabaseUrl, chave: supabaseChave, fetch });
    log();
    // Acompanhamento Operacional: depois do plantio dos mapas; um erro nele não desfaz o que já foi gravado
    if (config.acompanhamento !== false) {
      const erro = await rodarAcompanhamento({
        agrovex: { url: process.env.AGROVEX_URL || config.url, token, safras: config.safras ?? 'auto', excluirPrefixos: config.excluirPrefixos ?? [] },
        supabase: { url: supabaseUrl, chave: supabaseChave },
      });
      if (erro) process.exitCode = 1;
    }
    // Validação de apontamentos (ordens de serviço e saldo dos depósitos): um erro nela não desfaz o resto
    if (config.validacao !== false) {
      const erro = await rodarValidacao({
        agrovex: { url: process.env.AGROVEX_URL || config.url, token },
        supabase: { url: supabaseUrl, chave: supabaseChave },
      });
      if (erro) process.exitCode = 1;
    }
    return;
  }
  log();

  const destino = join(raiz, 'public', 'dados', 'plantio.json');
  let antigo = null;
  try {
    antigo = JSON.parse(readFileSync(destino, 'utf8'));
  } catch {
    /* primeiro uso */
  }
  if (mesmosDados(antigo, dados)) {
    console.log(`Sem mudanças no PIMS; public/dados/plantio.json mantido (geradoEm ${antigo.geradoEm}).`);
    return;
  }
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(dados, null, 1) + '\n');
  console.log(`Gravado public/dados/plantio.json (${dados.geradoEm}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`Erro ao sincronizar o plantio: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
}
