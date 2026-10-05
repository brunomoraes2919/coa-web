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

/** Confere as datas do pedido ('YYYY-MM-DD', de ≤ até, no máximo CHUVA_PICS_MAX_DIAS dias); lança Error legível. */
export function validarPeriodoChuva(de, ate) {
  const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ehData(de) || !ehData(ate)) throw new Error('Período inválido: informe as duas datas.');
  if (de > ate) throw new Error('Período inválido: a data inicial é depois da final.');
  const dias = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias > CHUVA_PICS_MAX_DIAS) throw new Error(`Período muito longo (${dias} dias): o máximo é ${CHUVA_PICS_MAX_DIAS} dias.`);
  return { de, ate, dias };
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

/** Chuva somada de cada PIC no período (de e até inclusive), com a quantidade de leituras e o último dia lido. */
export function montarSqlChuvaPics(ids, de, ate) {
  const lista = ids.filter((i) => /^[A-Za-z0-9_-]+$/.test(String(i))).map((i) => `'${i}'`).join(', ');
  const d = String(de).replace(/[^0-9-]/g, '');
  const a = String(ate).replace(/[^0-9-]/g, '');
  return `SELECT c.picid, round(sum(c.pluviometria)::numeric, 1) AS mm, count(c.pluviometria) AS leituras,
  to_char(max(c.data), 'YYYY-MM-DD') AS ultimo
FROM "DATABASE".stg_climatemonitoring2 c
WHERE c.picid IN (${lista}) AND c.data >= DATE '${d}' AND c.data < DATE '${a}' + INTERVAL '1 day'
GROUP BY c.picid`;
}

/** Junta o cadastro com a chuva: PIC sem nenhuma leitura no período fica com chuva null (não entra no mapa). */
export function montarChuvaPics(pics, res) {
  const porId = new Map(objetosDe(res).map((r) => [txt(r.picid), r]));
  let ultimoDia = null;
  const lista = pics.map((p) => {
    const r = porId.get(p.id);
    const leituras = r ? Number(r.leituras) || 0 : 0;
    const ultimo = r ? txt(r.ultimo) : null;
    if (ultimo && (!ultimoDia || ultimo > ultimoDia)) ultimoDia = ultimo;
    const mm = r && leituras > 0 ? Number(r.mm) : null;
    return { ...p, chuva: mm !== null && Number.isFinite(mm) ? Math.round(mm * 10) / 10 : null, leituras };
  });
  return { pics: lista, ultimoDia };
}

/**
 * Consulta a ZEUS pelo Agrovex: PICs da fazenda e a chuva de cada um no período. Devolve
 * { fazenda, de, ate, ultimoDia, pics: [{ id, nome, lat, lon, chuva, leituras }] } (não grava nada).
 */
export async function chuvaPorPicZeus({ url, token, fazenda, de, ate, fetchImpl = fetch }) {
  validarPeriodoChuva(de, ate);
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const cadastro = await cliente.consultar(SQL_PICS_ZEUS, 'cadastro dos PICs da ZEUS (mapa de chuva)', 'PICs da ZEUS', FONTES.zeus);
    const pics = picsDaFazendaZeus(cadastro, fazenda);
    if (!pics.length) {
      const conhecidas = fazendasDaZeus(cadastro);
      throw new Error(`A ZEUS não tem PICs para a fazenda "${String(fazenda).slice(0, 60)}"${conhecidas.length ? ` (fazendas na ZEUS: ${conhecidas.join(', ')})` : ''}.`);
    }
    const chuva = await cliente.consultar(montarSqlChuvaPics(pics.map((p) => p.id), de, ate), 'chuva por PIC no período (mapa de chuva)', 'chuva por PIC', FONTES.zeus);
    return { fazenda: unidadeDaFazendaZeus(fazenda), de, ate, ...montarChuvaPics(pics, chuva) };
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
