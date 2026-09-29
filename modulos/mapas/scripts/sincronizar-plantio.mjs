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

async function lerResposta(resp) {
  const texto = await resp.text();
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Agrovex recusou o acesso (HTTP ${resp.status}): verifique o AGROVEX_TOKEN.`);
  }
  if (!resp.ok) throw new Error(`Agrovex respondeu HTTP ${resp.status}: ${texto.slice(0, 300)}`);
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
    throw new Error(`Resposta do Agrovex ilegível: ${t.slice(0, 300)}`);
  }
  if (json?.error) throw new Error(`Agrovex: ${json.error.message ?? JSON.stringify(json.error)}`);
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
  const ini = await lerResposta(respIni);
  protocolo = ini?.result?.protocolVersion ?? PROTOCOLO;
  await lerResposta(await enviar('POST', { jsonrpc: '2.0', method: 'notifications/initialized' }));

  return {
    /** Executa uma SELECT no PIMS e devolve { columns, rows }. */
    async consultar(sql, pergunta, rotulo) {
      const r = await lerResposta(await enviar('POST', {
        jsonrpc: '2.0', id: ++id, method: 'tools/call',
        params: {
          name: 'execute_query',
          arguments: { sql, source: 'sqlserver', database: 'PIMSMCPRD', schema: 'dbo', original_question: pergunta, full: true },
        },
      }));
      const texto = r?.result?.content?.[0]?.text ?? '';
      if (r?.result?.isError) throw new Error(`Consulta ao PIMS falhou (${rotulo}): ${texto}`);
      let dados;
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new Error(`Consulta ao PIMS falhou (${rotulo}): resposta inesperada: ${String(texto).slice(0, 300)}`);
      }
      if (dados?.status !== 'success') {
        const msg = dados?.message ?? dados?.error ?? dados?.detail ?? JSON.stringify(dados);
        throw new Error(`Consulta ao PIMS falhou (${rotulo}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      }
      if (dados.truncated) throw new Error(`Consulta ao PIMS falhou (${rotulo}): resultado truncado (${dados.row_count} linhas).`);
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
    return { versao: 1, geradoEm: agora.toISOString(), fonte: 'PIMS via Agrovex', safras: resultado };
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

function cabecalhosSupabase(chave) {
  const h = { apikey: chave };
  if (ehChaveJwt(chave)) h.Authorization = `Bearer ${chave}`;
  return h;
}

/** Tira a chave do corpo da resposta (caso ela seja ecoada de volta) antes de colocá-lo num erro. */
function semChave(texto, chave) {
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
