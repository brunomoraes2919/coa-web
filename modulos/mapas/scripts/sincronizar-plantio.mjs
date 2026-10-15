// Sincroniza o status de plantio do PIMS (via Agrovex MCP) e, depois dele, o Acompanhamento Operacional e a
// Validação PIMS. É o programa da rotina de hora em hora do servidor (VM) e a biblioteca de atender-pedidos.mjs.
// No servidor: AGROVEX_TOKEN, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente; grava em mapas_plantio_pims
// (upsert + limpeza das linhas que sumiram do PIMS). Faltando qualquer uma das três, termina com erro (código 1).
// No computador de quem desenvolve: AGROVEX_TOKEN=... node scripts/sincronizar-plantio.mjs --local   (ou
// npm run plantio) grava public/dados/plantio.json e não toca no Supabase. O modo local só vale quando pedido
// (--local ou PLANTIO_LOCAL=1): no servidor, uma variável apagada por engano não pode virar "modo local" em silêncio.
// Configuração: scripts/plantio.config.json  { "safras": "auto" | ["SOJA 26/27", ...], "url": "..." }
// Sem dependências: só o Node (18 ou superior, pelo fetch nativo e pelo AbortSignal.timeout; o package.json do
// módulo pede 20.19 por causa das ferramentas de build). O token e a chave de serviço nunca são gravados nem
// impressos; gravando no Supabase o log só traz totais, sem nomes de fazenda (linhasDeLog).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USER_AGENT = 'mapa-chuva-coa/1.0'; // o Cloudflare do Agrovex bloqueia user-agents genéricos (erro 1010)
const PROTOCOLO = '2025-06-18';
const TEMPO_LIMITE_MS = 120_000;
/** Lista de safras do PIMS (PERIODOSAFRA): cadastro, só cresce quando se cadastra safra nova; lida numa consulta só. */
const SQL_SAFRAS = 'SELECT DE_PER_SAFRA FROM PIMSMCPRD.dbo.PERIODOSAFRA';
/** Bases do Agrovex usadas aqui: PIMS (SQL Server), ZEUS (clima, PostgreSQL) e os talhões da ZEUS (datalake, Athena). */
const FONTES = {
  pims: { nome: 'PIMS', source: 'sqlserver', database: 'PIMSMCPRD', schema: 'dbo' },
  zeus: { nome: 'ZEUS', source: 'zeus', database: 'LKS_DATABASE_ZEUS', schema: 'DATABASE' },
  solos: { nome: 'datalake', source: 'athena', database: 'soils_database_database' },
};

/** Único host para onde o token do Agrovex pode ser enviado (o endereço vem do plantio.config.json baixado do repositório ou de AGROVEX_URL). */
export const AGROVEX_HOST = 'mcp.agrovex.com.br';

/**
 * Confere o endereço do Agrovex ANTES de qualquer chamada: só https, só o host AGROVEX_HOST (porta padrão),
 * sem usuário nem senha embutidos. Devolve o endereço normalizado; qualquer outra coisa lança erro. A
 * mensagem mostra no máximo o protocolo e o host recebidos (um endereço errado pode trazer segredo no resto).
 */
export function conferirUrlAgrovex(url) {
  let u = null;
  try {
    u = new URL(String(url ?? '').trim());
  } catch {
    u = null;
  }
  if (u && u.protocol === 'https:' && u.hostname === AGROVEX_HOST && u.port === '' && u.username === '' && u.password === '') return u.href;
  const recebido = u ? ` (recebido: ${`${u.protocol}//${u.hostname}`.slice(0, 80)})` : '';
  throw new Error(`Endereço do Agrovex não permitido${recebido}: o token só é enviado para https://${AGROVEX_HOST}. Confira "url" em plantio.config.json e a variável AGROVEX_URL.`);
}

/**
 * Erro com o tipo da falha: 'fonte' (o servidor de dados recusou, caiu ou devolveu algo inesperado) ou
 * 'invalido' (o pedido não pode ser atendido como veio; a mensagem é texto nosso e pode ir para a tela).
 * Quem grava a resposta de um pedido escolhe o texto pelo tipo (atender-pedidos.mjs): o que vem de fora
 * (erro do banco, HTML do Cloudflare…) fica só no log do servidor. `detalhe` também é só para o log.
 */
function erroDoTipo(tipo, mensagem, detalhe) {
  const e = new Error(mensagem);
  e.tipo = tipo;
  if (detalhe) e.detalhe = detalhe;
  return e;
}

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

// ---------- paginação ----------
// O Agrovex corta toda consulta em 5.000 linhas, e a rotina trata o corte como falha (resultado truncado).
// Por isso a consulta cujo resultado pode crescer é lida em páginas: o SQL ganha um ORDER BY sem empates (a
// chave da linha; numa consulta agrupada, as colunas do GROUP BY) e, no fim, a cláusula da página. Sem ordem
// total a paginação repete ou pula linhas, porque cada página é uma consulta nova.
// As funções montarSql… recebem `pular` e `tamanho`. SEM `pular` devolvem a consulta inteira, com o texto
// exato de antes da paginação (quem chama sem paginar recebe tudo ou o erro de truncado, nunca um pedaço em
// silêncio); é também a consulta de reserva de consultarPaginas.

/** linhas por página (menos que o corte de 5.000 do Agrovex) */
export const PAGINA_CONSULTA = 4000;
/** teto de páginas de uma consulta (100.000 linhas): passar disso é fonte que não termina, não é dado */
export const PAGINAS_MAX = 25;

/** Cláusula da página no SQL Server (PIMS): só vale depois de um ORDER BY. */
const paginaSql = (pular, tamanho) => `OFFSET ${Math.max(0, Math.floor(pular))} ROWS FETCH NEXT ${Math.max(1, Math.floor(tamanho))} ROWS ONLY`;
/** Cláusula da página no PostgreSQL (ZEUS): a mesma forma que o Athena já usa em montarSqlLimitesZeus. */
const paginaSqlZeus = (pular, tamanho) => `OFFSET ${Math.max(0, Math.floor(pular))} LIMIT ${Math.max(1, Math.floor(tamanho))}`;
/** Cláusula da página no HANA (SAP): LIMIT antes de OFFSET. */
const paginaSqlSap = (pular, tamanho) => `LIMIT ${Math.max(1, Math.floor(tamanho))} OFFSET ${Math.max(0, Math.floor(pular))}`;

/**
 * Fim de uma consulta que pode ser paginada. Sem `pular`: só o ORDER BY que a consulta sempre teve
 * (`ordemDeSempre`; vazio = nunca teve), e o SQL fica idêntico ao de antes. Com `pular`: o ORDER BY sem
 * empates (`ordemTotal`, que começa pela ordem de sempre) e a cláusula da página.
 */
function fimDaConsulta(pular, tamanho, ordemDeSempre, ordemTotal, clausula = paginaSql) {
  if (pular === null || pular === undefined) return ordemDeSempre ? `\nORDER BY ${ordemDeSempre}` : '';
  return `\nORDER BY ${ordemTotal}\n${clausula(pular, tamanho)}`;
}

/**
 * Lê uma consulta inteira, página por página: `montar(pular, tamanho)` devolve o SQL da página que começa na
 * linha `pular`. Para na primeira página que vier com menos de `tamanho` linhas e devolve { columns, rows }
 * como se fosse uma consulta só. Passando de PAGINAS_MAX páginas, lança erro (a rotina não fica presa).
 * `reserva` (as consultas que passaram a ser paginadas em 10/2026): se a fonte RECUSAR a primeira página (erro
 * da consulta, não queda de rede nem prazo), avisa no log e roda a consulta inteira de sempre, `montar(null)`.
 * O ORDER BY novo e a cláusula da página não puderam ser conferidos em cada fonte antes de publicar: com a
 * reserva, uma recusa deixa a rotina como era (inteira, ou erro de truncado acima de 5.000 linhas) em vez de
 * parar a etapa. Aviso "em páginas foi recusada" no log = corrigir a consulta; sem aviso por algumas semanas,
 * a reserva pode sair.
 */
async function consultarPaginas(cliente, montar, pergunta, rotulo, { fonte = FONTES.pims, tamanho = PAGINA_CONSULTA, reserva = false } = {}) {
  let columns = [];
  const rows = [];
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    let r;
    try {
      r = await cliente.consultar(montar(pagina * tamanho, tamanho), pergunta, rotulo, fonte);
    } catch (e) {
      if (!reserva || pagina !== 0 || !(e instanceof Error) || e.recusada !== true) throw e;
      console.warn(`Consulta ao ${fonte.nome} em páginas foi recusada (${rotulo}); usando a consulta inteira, sem paginação. Motivo: ${cliente.semToken(e.message).slice(0, 300)}`);
      return cliente.consultar(montar(null, tamanho), pergunta, rotulo, fonte);
    }
    if (pagina === 0) columns = r.columns;
    for (const linha of r.rows) rows.push(linha);
    if (r.rows.length < tamanho) return { columns, rows };
  }
  throw erroDoTipo('fonte', `Consulta ao ${fonte.nome} falhou (${rotulo}): mais de ${PAGINAS_MAX} páginas de ${tamanho} linhas (teto de segurança da paginação).`);
}

/**
 * SQL validada no Agrovex (28/09/2026); o status é calculado em JS por classificar(). Sem comentários '--' (o
 * validador recusa). Uma linha por talhão (UPNIVEL3): a ordem de sempre (unidade, código) e, para não haver
 * empate entre páginas, a chave do talhão.
 */
export function montarSql(nomeSafra, pular = null, tamanho = PAGINA_CONSULTA) {
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
WHERE ps.DE_PER_SAFRA = ${safra}${fimDaConsulta(pular, tamanho, 'unidade, codigo', 'unidade, codigo, up.ID_UPNIVEL3, up.ID_PERIODOSAFRA')}`;
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
    throw erroDoTipo('fonte', `O servidor de dados do PIMS bloqueou o acesso deste servidor (erro ${cloudflare[1]}); o token não foi recusado.`);
  }
  if (resp.status === 403 && /cloudflare|<html/i.test(texto)) {
    throw erroDoTipo('fonte', 'O servidor de dados do PIMS barrou este servidor com uma página de verificação (HTTP 403); o token não foi recusado.');
  }
  if (resp.status === 401 || resp.status === 403) {
    // o corpo do Agrovex é curto ({"error": ...}) e não traz o token; mesmo assim ele é tirado da mensagem
    const corpo = token ? texto.split(token).join('[REDACTED]') : texto;
    throw erroDoTipo('fonte', `O servidor de dados do PIMS recusou o acesso (HTTP ${resp.status}): verifique o token de acesso do servidor. Resposta: ${corpo.replace(/\s+/g, ' ').slice(0, 150)}`);
  }
  if (!resp.ok) throw erroDoTipo('fonte', `O servidor de dados do PIMS respondeu HTTP ${resp.status}: ${texto.slice(0, 300)}`);
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
    throw erroDoTipo('fonte', `Resposta ilegível do servidor de dados do PIMS: ${t.slice(0, 300)}`);
  }
  if (json?.error) throw erroDoTipo('fonte', `Servidor de dados do PIMS: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json;
}

async function abrirSessao(url, token, fetchImpl) {
  // Na rede de verdade o token só sai para o host permitido, venha o endereço de onde vier. Com um fetch
  // injetado (os testes) nada sai da máquina, e o endereço fica como veio.
  if (fetchImpl === globalThis.fetch) url = conferirUrlAgrovex(url);
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
      // `recusada`: a fonte respondeu que a consulta falhou (não é rede, prazo nem corte); consultarPaginas usa isso
      const recusada = (mensagem) => Object.assign(erroDoTipo('fonte', mensagem), { recusada: true });
      if (r?.result?.isError) throw recusada(`Consulta ao ${nome} falhou (${rotulo}): ${texto}`);
      let dados;
      try {
        dados = JSON.parse(texto);
      } catch {
        throw erroDoTipo('fonte', `Consulta ao ${nome} falhou (${rotulo}): resposta inesperada: ${String(texto).slice(0, 300)}`);
      }
      if (dados?.status !== 'success') {
        const msg = dados?.message ?? dados?.error ?? dados?.detail ?? JSON.stringify(dados);
        throw recusada(`Consulta ao ${nome} falhou (${rotulo}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      }
      if (dados.truncated) throw erroDoTipo('fonte', `Consulta ao ${nome} falhou (${rotulo}): resultado truncado (${dados.row_count} linhas).`);
      return { columns: dados.columns ?? [], rows: dados.rows ?? [] };
    },
    /** Tira o token de um texto que vai para o log (o que a fonte devolve pode repetir o que recebeu). */
    semToken(texto) {
      return token ? String(texto).split(token).join('[REDACTED]') : String(texto);
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
    if (!idx.has(c)) throw erroDoTipo('fonte', `Consulta ao PIMS falhou (${rotulo}): coluna "${c}" ausente no resultado.`);
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
      if (!nomes.length) throw erroDoTipo('fonte', `Nenhuma safra do PIMS termina em ${safrasPadrao(agora).join(' ou ')}.`);
    } else {
      nomes = [...new Set(safras.map((s) => String(s).trim()).filter(Boolean))];
    }
    const resultado = [];
    for (const nome of nomes) {
      const r = await consultarPaginas(cliente, (pular, tamanho) => montarSql(nome, pular, tamanho), `status de plantio por talhão ${nome}`, nome, { reserva: true });
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

/** prazo de uma leitura (GET) no Supabase */
export const SUPABASE_LEITURA_MS = 60_000;
/** prazo de uma gravação (POST, PATCH, DELETE) no Supabase: folgado, porque algumas linhas passam de 300 KB */
export const SUPABASE_GRAVACAO_MS = 120_000;

/**
 * Toda chamada ao Supabase passa por aqui: é o fetch de sempre, com prazo. Sem ele, uma chamada pendurada só
 * era encerrada pelo systemd (20 ou 30 minutos depois), segurando a trava das duas rotinas. Prazo estourado
 * vira um erro com o que estava sendo feito (`acao`); a mensagem é texto nosso, sem a chave (que só vai nos
 * cabeçalhos). Qualquer outro erro passa como veio.
 */
export async function chamarSupabase(fetchImpl, url, init = {}, acao = 'a chamada') {
  const prazo = !init.method || init.method === 'GET' ? SUPABASE_LEITURA_MS : SUPABASE_GRAVACAO_MS;
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(prazo) });
  } catch (e) {
    const nome = e !== null && typeof e === 'object' ? e.name : undefined;
    if (nome !== 'TimeoutError' && nome !== 'AbortError') throw e;
    throw new Error(`O Supabase não respondeu em ${prazo / 1000} s (${acao}): a chamada foi interrompida.`, { cause: e });
  }
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
  const respUpsert = await chamarSupabase(fetchImpl, `${url}/rest/v1/mapas_plantio_pims?on_conflict=safra,unidade`, {
    method: 'POST',
    headers: {
      ...cabecalhosSupabase(chave),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(linhas),
  }, 'o upsert em mapas_plantio_pims');
  if (!respUpsert.ok) await erroSupabase(respUpsert, chave, 'o upsert em mapas_plantio_pims');

  const respLimpeza = await chamarSupabase(
    fetchImpl,
    `${url}/rest/v1/mapas_plantio_pims?gerado_em=lt.${encodeURIComponent(arquivo.geradoEm)}`,
    { method: 'DELETE', headers: cabecalhosSupabase(chave) },
    'a limpeza de mapas_plantio_pims',
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
 * A rotina hoje roda na VM, não no Actions: `githubActions` ficou só nesta função (o programa não o passa mais).
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

/**
 * SELECTs do acompanhamento (validadas no Agrovex em 28/09/2026). ID_UPNIVEL3 vai como texto: o bigint perde precisão no JSON.
 * Com `pular`, as três saem paginadas (os apontamentos crescem ao longo da safra). A ordem de cada uma não tem
 * empate: talhões pela chave do talhão; plantio pela chave do boletim (APPLANTIO); colheita por tudo o que
 * define a linha devolvida (ordem de serviço, unidade, boletim, talhão, instante, área e último lançamento):
 * duas linhas da APATIVPROD iguais em tudo isso são a mesma linha no resultado, e trocar uma pela outra não muda nada.
 */
export function montarSqlAcompanhamento(safras, pular = null, tamanho = PAGINA_CONSULTA) {
  const em = listaSql(safras);
  const fim = (ordemTotal) => fimDaConsulta(pular, tamanho, '', ordemTotal);
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
WHERE ps.DE_PER_SAFRA IN (${em}) AND up.QT_AREA_PROD > 0.1${fim('up.ID_UPNIVEL3, up.ID_PERIODOSAFRA')}`,
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
WHERE os.FG_SITUACAO IN ('A','F') AND ps.DE_PER_SAFRA IN (${em})${fim('a.ID_APPLANTIO, a.ID_UNIDADEADM')}`,
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
WHERE os.FG_SITUACAO IN ('A','F') AND o.CD_OPERACAO IN (16, 114) AND ps.DE_PER_SAFRA IN (${em})${fim('a.ID_APORDSERVICO, a.ID_UNIDADEADM, a.NO_BOLETIM, a.ID_UPNIVEL3, a.DT_OPERACAO, a.QT_AREA_EXEC, a.LAST_UPDATE')}`,
  };
}

/** 'SEMENTE DE SOJA 84KA92 CE' -> '84KA92 CE' (mesma limpeza do relatório Power BI). */
export function limparVariedade(v) {
  const t = txt(v);
  if (!t) return null;
  return t.replace(/^SEMENTE\s+(DE\s+)?(SOJA|MILHO|ALGODAO|SORGO|MILHETO)\s+/i, '').replace(/\s+(SOJA|MILHO|ALGODAO)$/i, '').trim() || null;
}

/** 'JOAO DA SILVA SOUZA' -> 'Joao' ("Equipe ..." -> 'Terceiro', como no Power BI). */
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

/**
 * Hectares por dia × unidade × safra × operação das safras anteriores (só o total do dia, sem talhão).
 * Com `pular`, paginada. A ordem (unidade, safra, operação, dia) não tem empate: são as colunas dos dois
 * GROUP BY mais a operação, que distingue as duas metades do UNION.
 */
export function montarSqlHistorico(safras, pular = null, tamanho = PAGINA_CONSULTA) {
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
GROUP BY u.DE_UNI_ADM, ps.DE_PER_SAFRA, CONVERT(varchar(10), a.DT_OPERACAO, 120)${fimDaConsulta(pular, tamanho, '', '1, 2, 3, 4')}`;
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
 * Com `pular`, paginada (uma linha por fazenda × dia com chuva, numa janela de mais de três anos: cresce com
 * o tempo e com o número de fazendas). A ordem de sempre (fazenda, dia) não tem empate: são as colunas do GROUP BY.
 */
export function montarSqlChuva(desde, pular = null, tamanho = PAGINA_CONSULTA) {
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
HAVING avg(p.mm) >= 0.2${fimDaConsulta(pular, tamanho, '1, 2', '1, 2', paginaSqlZeus)}`;
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
    // as quatro consultas do PIMS são lidas em páginas: os apontamentos crescem ao longo da safra
    const sql = (qual) => (pular, tamanho) => montarSqlAcompanhamento(nomes, pular, tamanho)[qual];
    const talhoes = await consultarPaginas(cliente, sql('talhoes'), 'talhões do acompanhamento operacional', 'talhões do acompanhamento', { reserva: true });
    const plantio = await consultarPaginas(cliente, sql('plantio'), 'apontamentos de plantio do acompanhamento operacional', 'plantio do acompanhamento', { reserva: true });
    const colheita = await consultarPaginas(cliente, sql('colheita'), 'apontamentos de colheita do acompanhamento operacional', 'colheita do acompanhamento', { reserva: true });
    const linhas = linhasAcompanhamento({ talhoes, plantio, colheita }, geradoEm);
    const anteriores = safrasAnteriores(nomes, todas).filter((s) => !nomes.includes(s));
    if (anteriores.length && linhas.length) {
      const hist = await consultarPaginas(cliente, (pular, tamanho) => montarSqlHistorico(anteriores, pular, tamanho), 'hectares por dia das safras anteriores (comparativo)', 'safras anteriores', { reserva: true });
      linhas.push(...linhasHistorico(hist, geradoEm, nomes));
    }
    // chuva por fazenda (ZEUS): se falhar, o acompanhamento segue sem as gotas
    let chuva = 0;
    const unidades = [...new Set(linhas.filter((l) => l.talhoes.length).map((l) => l.unidade))];
    if (unidades.length) {
      try {
        const res = await consultarPaginas(cliente, (pular, tamanho) => montarSqlChuva(inicioChuva(agora), pular, tamanho), 'chuva diária por fazenda (acompanhamento operacional)', 'chuva', { fonte: FONTES.zeus, reserva: true });
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
  const resp = await chamarSupabase(fetchImpl, `${url}/rest/v1/acomp_pims?on_conflict=safra,unidade`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(dados.linhas),
  }, 'o upsert em acomp_pims');
  if (!resp.ok) {
    const texto = await resp.clone().text().catch(() => '');
    if (resp.status === 404 || /PGRST205|42P01/.test(texto)) {
      console.warn('Acompanhamento: a tabela acomp_pims ainda não existe no Supabase (rode modulos/acompanhamento/supabase/0001_acompanhamento.sql).');
      return 'sem-tabela';
    }
    await erroSupabase(resp, chave, 'o upsert em acomp_pims');
  }
  const limpeza = await chamarSupabase(fetchImpl, `${url}/rest/v1/acomp_pims?gerado_em=lt.${encodeURIComponent(dados.geradoEm)}`, {
    method: 'DELETE',
    headers: cabecalhosSupabase(chave),
  }, 'a limpeza de acomp_pims');
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
 * plantio dos mapas (já gravado); é devolvido para quem chamou decidir o código de saída. `aoErro`
 * (opcional) recebe o erro inteiro: quem responde a um pedido escolhe por ele a mensagem que vai para a
 * tela, sem repassar o texto de fora (como em rodarValidacao).
 */
export async function rodarAcompanhamento({ agrovex, supabase, fetchImpl = globalThis.fetch, aoErro }) {
  try {
    const dados = await sincronizarAcompanhamento({ ...agrovex, fetchImpl });
    const situacao = await gravarAcompanhamentoSupabase(dados, { ...supabase, fetch: fetchImpl });
    console.log(logAcompanhamento(dados, situacao === 'ok' ? 'gravado no Supabase' : situacao));
    return null;
  } catch (e) {
    const msg = semChave(semChave(e instanceof Error ? e.message : String(e), supabase.chave), agrovex.token);
    console.error(`Acompanhamento: erro (o plantio dos mapas não foi afetado): ${msg}`);
    if (typeof aoErro === 'function') aoErro(e);
    return msg;
  }
}

// ---------- validação de apontamentos (módulo validacao/ do COA WEB) ----------
// Ordens de serviço do PIMS (abertas e fechadas com diferença de área), coordenadores (a Equipe da
// ordem), depósitos e, para os depósitos que o usuário vinculou aos coordenadores, o saldo do SAP.

/** Diferença de área (ha) acima da qual uma ordem FECHADA entra na lista "faltando / sobrando área". */
export const VALID_TOLERANCIA_HA = 1;
const VALID_PAGINA = PAGINA_CONSULTA;

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

/**
 * Empresa do SAP de uma unidade do PIMS, ou null. Só vale chave própria da tabela: um nome que venha do
 * banco igual a uma propriedade herdada de todo objeto ('constructor', '__proto__', 'toString'…) não acha nada.
 */
function empresaDa(unidade) {
  const u = txt(unidade) ?? '';
  return Object.hasOwn(SAP_EMPRESA_DA_UNIDADE, u) ? SAP_EMPRESA_DA_UNIDADE[u] : null;
}

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

/**
 * Evolução das ordens ABERTAS: hectares apontados por dia em cada ordem. Com `pular`, paginada (ordens abertas
 * × dias com apontamento). A ordem de sempre (unidade, ordem, dia) não tem empate: são as colunas do GROUP BY.
 */
export function montarSqlEvolucaoValidacao(pular = null, tamanho = VALID_PAGINA) {
  return `SELECT u.DE_UNI_ADM AS unidade, os.NO_BOLETIM AS os, CONVERT(varchar(10), x.dia, 23) AS dia, SUM(x.ha) AS ha
FROM ${PIMS}APORDSERVICO os
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = os.ID_UNIDADEADM
JOIN (${SQL_EXEC_VALIDACAO}) x ON x.ID_APORDSERVICO = os.ID_APORDSERVICO
WHERE os.FG_SITUACAO = 'A'
GROUP BY u.DE_UNI_ADM, os.NO_BOLETIM, CONVERT(varchar(10), x.dia, 23)${fimDaConsulta(pular, tamanho, '1, 2, 3', '1, 2, 3')}`;
}

/** A evolução inteira, sem paginar (a rotina usa montarSqlEvolucaoValidacao, em páginas). */
export const SQL_EVOLUCAO_VALIDACAO = montarSqlEvolucaoValidacao();

/**
 * Coordenadores: as Equipes que tiveram ordem aberta ou fechada desde `desde` (ou têm ordem em aberto).
 * Uma linha por unidade × equipe: é cadastro (as equipes de cada unidade), lido numa consulta só.
 */
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

/** Depósitos de cada unidade no PIMS que têm código no SAP (CD_INT_ERP = WhsCode). Cadastro: lido numa consulta só. */
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
 * Com `pular`, paginada (cresce a cada depósito vinculado na tela): depois da ordem de sempre (depósito, nome)
 * vem o código do item, e depósito + item é a chave do saldo (OITW), sem empate.
 */
export function montarSqlEstoqueSap(codigos, pular = null, tamanho = PAGINA_CONSULTA) {
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
WHERE t."WhsCode" IN (${lista}) AND t."OnHand" <> 0${fimDaConsulta(pular, tamanho, '1, 3', '1, 3, 2', paginaSqlSap)}`;
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
    const empresa = empresaDa(l.unidade);
    const sap = empresa ? depositosSap[empresa]?.get(c) : undefined;
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

/**
 * Itens que o SAP recusou (documento -1 na fila), com a unidade, a ordem e o coordenador de cada boletim.
 * Com `pular`, paginada. A fila não tem chave conhecida aqui: depois da ordem de sempre (unidade, boletim,
 * item) vêm as outras colunas devolvidas, então só empatam linhas idênticas (trocar uma pela outra não muda nada).
 */
export function montarSqlBoletinsFalha(desde, pular = null, tamanho = VALID_PAGINA) {
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
WHERE e.DT_CONSUMO >= '${d}' AND LTRIM(RTRIM(e.NO_DOC_ERP)) = '-1' AND e.FG_STATUS <> '12'${fimDaConsulta(pular, tamanho, '1, 3, 5', '1, 3, 5, 2, 4, 6, 7, 8, 9, 10, 11, 12')}`;
}

/**
 * Boletins ainda não enviados ao SAP (FG_STATUS_EAI = '0'), um por item; boletim sem item vem com o item nulo.
 * Com `pular`, paginada. Depois da ordem de sempre (unidade, dia, boletim) vêm a origem e a chave do item (colunas
 * 2 e 5), que já não empatam, e as demais colunas devolvidas (para os boletins sem item).
 */
export function montarSqlBoletinsPendentes(desde, pular = null, tamanho = VALID_PAGINA) {
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
${parte('T', 'APTRATSEMENT', 'ID_APTRATSEMENT', 'APTRATSEMENT_IN', 'ID_APTRATSEMENT_IN', 'QT_TOTAL', false)}${fimDaConsulta(pular, tamanho, '1, 4, 3', '1, 4, 3, 2, 5, 6, 7, 8, 9, 10, 11, 12')}`;
}

const listaSap = (valores, teste) => [...new Set(valores.map((v) => String(v ?? '')).filter(teste))].map((v) => `'${v}'`).join(', ');

/**
 * Última mensagem do SAP para cada item dos boletins pedidos, com quantas tentativas houve e de quando a quando.
 * Com `pular`, paginada pelo item do boletim (coluna 1): a consulta devolve uma linha por item, sem empate.
 */
export function montarSqlLogIntegracaoSap(boletins, desde, pular = null, tamanho = PAGINA_CONSULTA) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  const lista = listaSap(boletins, (b) => /^\d{1,18}$/.test(b));
  if (!lista) throw new Error('Nenhum boletim válido para consultar o log de integração.');
  return `SELECT l."U_ID_BOLETIM_DE" AS id_item, l."U_Message" AS msg, t.n AS tentativas, t.primeira, t.ultima
FROM "@GA_PIMS_LOG" l
JOIN (SELECT MAX("Code") AS codigo, COUNT(*) AS n, TO_VARCHAR(MIN("U_Date"), 'YYYY-MM-DD') AS primeira, TO_VARCHAR(MAX("U_Date"), 'YYYY-MM-DD') AS ultima
  FROM "@GA_PIMS_LOG" WHERE "U_NO_BOLETIM" IN (${lista}) AND "U_Date" >= '${d}' GROUP BY "U_ID_BOLETIM_DE") t ON t.codigo = l."Code"${fimDaConsulta(pular, tamanho, '', '1', paginaSqlSap)}`;
}

/**
 * Cadastro e saldo, no SAP, dos itens dos boletins nos depósitos de onde eles vão sair. Com `pular`, paginada
 * (itens × depósitos dos boletins) por item e depósito (colunas 1 e 5): é a chave do saldo (OITW), sem empate.
 */
export function montarSqlSaldoItensSap(itens, depositos, pular = null, tamanho = PAGINA_CONSULTA) {
  const listaItens = listaSap(itens, ehCodigoSap);
  if (!listaItens) throw new Error('Nenhum item válido para consultar o saldo.');
  const listaDeps = listaSap(depositos, ehCodigoSap) || "''";
  return `SELECT i."ItemCode" AS item, i."ItemName" AS nome, i."InvntryUom" AS unidade, i."frozenFor" AS congelado, w."WhsCode" AS deposito, w."OnHand" AS saldo
FROM OITM i LEFT JOIN OITW w ON w."ItemCode" = i."ItemCode" AND w."WhsCode" IN (${listaDeps})
WHERE i."ItemCode" IN (${listaItens})${fimDaConsulta(pular, tamanho, '', '1, 5', paginaSqlSap)}`;
}

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
    const empresa = empresaDa(unidade);
    const log = empresa ? logs[empresa]?.get(String(r.id_item)) : undefined;
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
    const dados = empresa ? sap[empresa] : undefined;
    for (const item of g.itens.values()) {
      item.q = arred(item.q, 3);
      const cadastro = dados?.itens.get(item.c);
      if (cadastro) {
        item.nm = cadastro.nome || item.nm;
        item.u = item.u || cadastro.un || '';
      }
      const problemas = [];
      if (!item.dp) problemas.push('sem-deposito');
      else if (empresa && depositosSap[empresa]?.get(item.dp)?.inativo) problemas.push('deposito-inativo');
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
 * Com `pular`, paginada. A receita (APORDSERVICO_CO) não tem chave conhecida aqui: depois da ordem de sempre
 * (unidade, ordem, produto) vêm as outras colunas devolvidas, então só empatam linhas idênticas.
 */
export function montarSqlNecessidadeValidacao(desde, pular = null, tamanho = VALID_PAGINA) {
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
WHERE os.FG_SITUACAO = 'A' AND os.DT_ABERTURA >= '${d}'${fimDaConsulta(pular, tamanho, '1, 2, 7', '1, 2, 7, 3, 4, 5, 6, 8, 9')}`;
}

/**
 * Aplicações desde `desdeDia` em que a dose real fugiu da programada além da tolerância, com a Observação do boletim
 * (APAPLINSUMO.DE_OBSERVACAO): é nela que o coordenador justifica, no PIMS, a variação que aconteceu de verdade.
 * Com `pular`, paginada: depois da ordem de sempre vem a chave do item do boletim (APAPLINS_INSLC), que não empata.
 */
export function montarSqlDoseValidacao(desdeDia, pular = null, tamanho = VALID_PAGINA) {
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
WHERE a.DT_OPERACAO >= '${d}' AND l.QT_DOSE_PROG > 0 AND ABS(l.QT_DOSE_REAL - l.QT_DOSE_PROG) / l.QT_DOSE_PROG > ${VALID_DOSE_TOLERANCIA}${fimDaConsulta(pular, tamanho, '1, a.DT_OPERACAO DESC, a.NO_BOLETIM, 8', '1, a.DT_OPERACAO DESC, a.NO_BOLETIM, 8, l.ID_APAPLINS_INSLC')}`;
}

/**
 * Boletins que já estão no PIMS, na tela de validação, aguardando a importação (tabelas *_TMP), com a mensagem que o
 * PIMS registrou e o que a conferência precisa para prever o erro da importação: a ordem (se existe, se está aberta,
 * as datas), o planejado e o já apontado no talhão, e se o número do boletim já existe entre os apontamentos.
 * Com `pular`, paginada. As tabelas *_TMP não têm chave conhecida aqui: depois da ordem de sempre (unidade, dia,
 * boletim) vêm as outras colunas devolvidas, menos a 9 (a mensagem do PIMS, texto livre): só empatam linhas
 * iguais em tudo o mais.
 */
export function montarSqlColetorValidacao(desde, pular = null, tamanho = VALID_PAGINA) {
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
${parte('M', 'APATIVMEC_TMP', 'APATIVMEC', null)}${fimDaConsulta(pular, tamanho, '1, 4 DESC, 3', '1, 4 DESC, 3, 2, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19')}`;
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
  const resp = await chamarSupabase(fetchImpl, `${url}/rest/v1/valid_vinculos?select=unidade,deposito`, { headers: cabecalhosSupabase(chave) }, 'a leitura de valid_vinculos');
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
  // objetos sem protótipo: a unidade e o depósito vêm de uma tabela que a tela grava, e nenhum valor dela
  // ('constructor', '__proto__'…) pode cair numa propriedade herdada
  const porEmpresa = Object.create(null);
  for (const v of vinculos) {
    const unidade = txt(v?.unidade) ?? '';
    const empresa = empresaDa(unidade);
    if (!empresa || !ehCodigoSap(v.deposito)) continue;
    const porUnidade = (porEmpresa[empresa] ??= Object.create(null));
    const lista = (porUnidade[unidade] ??= []);
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
    // Todas as consultas que crescem com a safra são lidas em páginas (consultarPaginas, com teto de páginas).
    // `reserva`: as que passaram a ser paginadas agora; se a fonte recusar a página, vale a consulta inteira de sempre.
    const paginar = async (montar, motivo, rotulo, reserva = false) => objetosDe(await consultarPaginas(cliente, montar, motivo, rotulo, { tamanho: VALID_PAGINA, reserva }));
    const ordens = await paginar((pular, tamanho) => montarSqlOrdensValidacao(desde, pular, tamanho), 'ordens de serviço abertas e fechadas com diferença de área (validação)', 'ordens de serviço');
    const talhoes = await paginar((pular, tamanho) => montarSqlTalhoesValidacao(desde, pular, tamanho), 'talhões planejados das ordens de serviço (validação)', 'talhões das ordens');
    const apontamentos = await paginar((pular, tamanho) => montarSqlApontamentosValidacao(desde, pular, tamanho), 'apontamentos de cada ordem de serviço (validação)', 'apontamentos das ordens');
    const evolucao = await paginar((pular, tamanho) => montarSqlEvolucaoValidacao(pular, tamanho), 'área apontada por dia nas ordens abertas (validação)', 'evolução das ordens', true);
    // cadastros (equipes e depósitos): pequenos e limitados, numa consulta só
    const coordenadores = objetosDe(await cliente.consultar(montarSqlCoordenadoresValidacao(desde), 'coordenadores com ordem de serviço na safra (validação)', 'coordenadores'));
    const depositos = objetosDe(await cliente.consultar(SQL_DEPOSITOS_PIMS, 'depósitos do PIMS com código do SAP (validação)', 'depósitos'));
    const falhas = await paginar((pular, tamanho) => montarSqlBoletinsFalha(desde, pular, tamanho), 'itens de boletim recusados pelo SAP na integração (validação)', 'boletins com falha', true);
    const pendentes = await paginar((pular, tamanho) => montarSqlBoletinsPendentes(desde, pular, tamanho), 'boletins ainda não enviados ao SAP (validação)', 'boletins pendentes', true);
    // sem protótipo, como em depositosVinculados: as chaves são empresas, unidades e códigos de depósito
    const logs = Object.create(null);
    const sapItens = Object.create(null);
    const apontRecentes = await paginar((pular, tamanho) => montarSqlApontamentosRecentes(diaAnterior(agora, VALID_DIAS_APONT - 1), pular, tamanho), 'apontamentos feitos ou lançados nos últimos dias (validação)', 'apontamentos recentes');
    const necessidade = await paginar((pular, tamanho) => montarSqlNecessidadeValidacao(desde, pular, tamanho), 'produtos planejados e já consumidos nas ordens abertas (validação)', 'necessidade das ordens', true);
    const dose = await paginar((pular, tamanho) => montarSqlDoseValidacao(diaAnterior(agora, VALID_DIAS_DOSE), pular, tamanho), 'aplicações com dose real fora da programada (validação)', 'dose real x programada', true);
    const coletor = await paginar((pular, tamanho) => montarSqlColetorValidacao(desde, pular, tamanho), 'boletins na tela de validação do PIMS, aguardando a importação (validação)', 'boletins em validação', true);

    const avisos = [];
    const depositosSap = Object.create(null);
    const estoque = Object.create(null);
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
        const daEmpresa = (r) => empresaDa(r.unidade) === empresa;
        const numeros = falhas.filter(daEmpresa).map((r) => String(r.boletim ?? ''));
        if (numeros.some((b) => /^\d{1,18}$/.test(b))) {
          logs[empresa] = new Map(objetosDe(await consultarPaginas(cliente, (pular, tamanho) => montarSqlLogIntegracaoSap(numeros, desde, pular, tamanho), 'mensagens do SAP para os boletins recusados (validação)', `log de integração ${empresa}`, { fonte, reserva: true }))
            .map((r) => [String(r.id_item), { msg: txt(r.msg), n: Number(r.tentativas) || 0, primeira: txt(r.primeira), ultima: txt(r.ultima) }]));
        }
        const doSap = [...falhas, ...pendentes].filter(daEmpresa);
        if (doSap.some((r) => ehCodigoSap(r.material))) {
          const itens = new Map();
          const saldo = new Map();
          for (const r of objetosDe(await consultarPaginas(cliente, (pular, tamanho) => montarSqlSaldoItensSap(doSap.map((r) => r.material), doSap.map((r) => r.deposito), pular, tamanho), 'cadastro e saldo dos itens dos boletins (validação)', `itens ${empresa}`, { fonte, reserva: true }))) {
            const item = txt(r.item);
            if (!item) continue;
            itens.set(item, { nome: txt(r.nome) ?? '', un: txt(r.unidade) ?? '', inativo: txt(r.congelado) === 'Y' });
            if (txt(r.deposito)) saldo.set(`${item}|${txt(r.deposito)}`, Number(r.saldo) || 0);
          }
          sapItens[empresa] = { itens, saldo };
        }
        const porUnidade = vinculados[empresa];
        if (!porUnidade) continue;
        const res = objetosDe(await consultarPaginas(cliente, (pular, tamanho) => montarSqlEstoqueSap(Object.values(porUnidade).flat(), pular, tamanho), 'saldo dos depósitos dos coordenadores e origem de cada produto pelas transferências (validação)', `saldo ${empresa}`, { fonte, reserva: true }));
        for (const [unidade, codigos] of Object.entries(porUnidade)) {
          const porDeposito = (estoque[unidade] ??= Object.create(null));
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
  const enviar = (linhas) => chamarSupabase(fetchImpl, `${url}/rest/v1/valid_pims?on_conflict=unidade`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  }, 'o upsert em valid_pims');
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
  const limpeza = await chamarSupabase(fetchImpl, `${url}/rest/v1/valid_pims?gerado_em=lt.${encodeURIComponent(dados.geradoEm)}`, { method: 'DELETE', headers: cabecalhosSupabase(chave) }, 'a limpeza de valid_pims');
  if (!limpeza.ok) await erroSupabase(limpeza, chave, 'a limpeza de valid_pims');
  return 'ok';
}

/**
 * Etapa da validação dentro da rotina: lê os vínculos, consulta, grava e registra só totais. Devolve null ou a
 * mensagem de erro (para o log). `aoErro` (opcional) recebe o erro inteiro: quem responde a um pedido escolhe
 * por ele a mensagem que vai para a tela, sem repassar o texto de fora.
 */
export async function rodarValidacao({ agrovex, supabase, fetchImpl = globalThis.fetch, aoErro }) {
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
    if (typeof aoErro === 'function') aoErro(e);
    return msg;
  }
}

// ---------- boletins de atividades mecanizadas (botão "Buscar direto no PIMS" de Mecanizadas) ----------

/**
 * período máximo de um pedido de boletins: dias entre a primeira e a última data (ate − de), a mesma conta do
 * banco (mec_pims_pedidos_periodo: ate - de <= 62). O pedido que o banco aceitou não pode ser recusado aqui.
 */
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

/**
 * Confere o pedido: unidade do PIMS (ex.: 'T. FLECHAS') e período 'YYYY-MM-DD' com até MEC_MAX_DIAS dias entre as
 * duas datas; lança Error legível. `dias` (devolvido e citado na mensagem) conta os dois extremos.
 */
export function validarPedidoMec(unidade, de, ate) {
  const u = String(unidade ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 .]{1,29}$/.test(u)) throw erroDoTipo('invalido', 'Unidade inválida.');
  const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ehData(de) || !ehData(ate)) throw erroDoTipo('invalido', 'Período inválido: informe as duas datas.');
  if (de > ate) throw erroDoTipo('invalido', 'Período inválido: a data inicial é depois da final.');
  const dias = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias - 1 > MEC_MAX_DIAS) throw erroDoTipo('invalido', `Período muito longo (${dias} dias): o máximo é ${MEC_MAX_DIAS} dias.`);
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
      if (objs.length >= MEC_MAX_LINHAS) throw erroDoTipo('invalido', `O período tem mais de ${MEC_MAX_LINHAS} lançamentos: escolha um período menor.`);
    }
    return { unidade: p.unidade, de: p.de, ate: p.ate, cabecalho: MEC_CABECALHO, linhas: linhasMecanizadas(objs) };
  } finally {
    await cliente.fechar();
  }
}

// ---------- chuva por PIC (botão "Inserir dados via integração" do Mapa de Chuva) ----------

/**
 * período máximo de um pedido de chuva: dias entre a primeira e a última data (ate − de), a mesma conta do
 * banco (mapas_chuva_pedidos_periodo: ate - de <= 366). O pedido que o banco aceitou não pode ser recusado aqui.
 */
export const CHUVA_PICS_MAX_DIAS = 366;

/** 'hh:mm' (ou 'hh:mm:ss', como o Postgres devolve a coluna time) → 'hh:mm'; fora do formato → null. */
function horaDoPedido(h) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(h ?? '').trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * Confere as datas do pedido ('YYYY-MM-DD', de ≤ até, no máximo CHUVA_PICS_MAX_DIAS dias entre as duas) e, se
 * vierem, a hora inicial e a final ('hh:mm', as duas ou nenhuma); lança Error legível. Sem hora devolve
 * { de, ate, dias }; `dias` (devolvido e citado na mensagem) conta os dois extremos.
 */
export function validarPeriodoChuva(de, ate, deHora = null, ateHora = null) {
  const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ehData(de) || !ehData(ate)) throw erroDoTipo('invalido', 'Período inválido: informe as duas datas.');
  if (de > ate) throw erroDoTipo('invalido', 'Período inválido: a data inicial é depois da final.');
  const dias = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias - 1 > CHUVA_PICS_MAX_DIAS) throw erroDoTipo('invalido', `Período muito longo (${dias} dias): o máximo é ${CHUVA_PICS_MAX_DIAS} dias.`);
  const vazia = (h) => h === null || h === undefined || h === '';
  if (vazia(deHora) && vazia(ateHora)) return { de, ate, dias };
  if (vazia(deHora) || vazia(ateHora)) throw erroDoTipo('invalido', 'Período inválido: informe a hora inicial e a final.');
  const h1 = horaDoPedido(deHora);
  const h2 = horaDoPedido(ateHora);
  if (!h1 || !h2) throw erroDoTipo('invalido', 'Período inválido: informe as horas no formato hh:mm.');
  if (de === ate && h1 > h2) throw erroDoTipo('invalido', 'Período inválido: a hora inicial é depois da final.');
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
      // A lista das fazendas da ZEUS fica só no log do servidor (`detalhe`): quem pediu vê o nome que ele
      // mesmo mandou (só letras, números e pontuação simples) e o que conferir.
      const conhecidas = fazendasDaZeus(cadastro);
      const nome = String(fazenda ?? '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._\-/()]/gu, '').trim().slice(0, 60);
      throw erroDoTipo(
        'invalido',
        `A ZEUS não tem PICs para a fazenda "${nome}". Confira se o nome da fazenda no cadastro do mapa é o mesmo usado na ZEUS.`,
        conhecidas.length ? `fazendas na ZEUS: ${conhecidas.join(', ')}` : '',
      );
    }
    const chuva = await cliente.consultar(montarSqlChuvaPics(pics.map((p) => p.id), de, ate, periodo.deHora, periodo.ateHora), 'chuva por PIC no período (mapa de chuva)', 'chuva por PIC', FONTES.zeus);
    const horas = periodo.deHora ? { deHora: periodo.deHora, ateHora: periodo.ateHora } : {};
    return { fazenda: unidadeDaFazendaZeus(fazenda), de, ate, ...horas, ...montarChuvaPics(pics, chuva) };
  } finally {
    await cliente.fechar();
  }
}

// ---------- último dia da ZEUS no banco (aviso ao lado de "Inserir dados via integração") ----------

/**
 * Dias para trás em que se procura a última leitura de cada fazenda. Fazenda parada há mais que isso deixa de
 * vir na consulta e some do aviso: atualizarSituacaoZeus (atender-pedidos.mjs) apaga, depois de gravar, as
 * linhas de mapas_zeus_situacao que não vieram na rodada.
 */
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
// A mesma base do relatório Power BI de chuva: a tabela stg_field_data da ZEUS, que já traz a chuva de cada
// talhão (unidade + código do talhão no PIMS + dia), e os ciclos do PIMS (do início do plantio ao fim da
// colheita de cada período de safra). A rotina grava em chuva_talhao a chuva diária de cada talhão, os dias
// que a tabela tem, os ciclos e, como referência, a chuva medida em cada pluviômetro (telemetria da ZEUS).

/** as fazendas ficam em UTC-4: o "hoje" da janela é o delas, não o do servidor */
const FUSO_FAZENDAS_H = 4;
/** quantas safras antes da atual entram na janela */
export const CHUVA_TALHAO_SAFRAS_ANTES = 2;

/** Data de hoje na fazenda ('YYYY-MM-DD'). */
function hojeNaFazenda(agora = new Date()) {
  return new Date(agora.getTime() - FUSO_FAZENDAS_H * 3_600_000).toISOString().slice(0, 10);
}

/** Primeiro dia da janela ('YYYY-MM-DD'): 1º de setembro, duas safras antes da atual (a safra vira em setembro). */
export function inicioChuvaTalhao(agora = new Date()) {
  const hoje = hojeNaFazenda(agora);
  const ano = Number(hoje.slice(0, 4)) - (Number(hoje.slice(5, 7)) >= 9 ? 0 : 1) - CHUVA_TALHAO_SAFRAS_ANTES;
  return `${ano}-09-01`;
}

/** Quantos dias a janela tem, de `desde` até hoje na fazenda (inclusive). */
export function diasDaJanelaChuva(desde, agora = new Date()) {
  return Math.round((Date.parse(`${hojeNaFazenda(agora)}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Safras do PIMS que a janela cobre: ['SAFRA 2024/2025', …, a atual]. */
export function safrasDaJanelaChuva(desde, agora = new Date()) {
  const hoje = hojeNaFazenda(agora);
  const ultimo = Number(hoje.slice(0, 4)) - (Number(hoje.slice(5, 7)) >= 9 ? 0 : 1);
  const lista = [];
  for (let ano = Number(String(desde).slice(0, 4)); ano <= ultimo; ano++) lista.push(`SAFRA ${ano}/${ano + 1}`);
  return lista;
}

const dataSql = (d) => String(d).replace(/[^0-9-]/g, '').slice(0, 10);

/**
 * Chuva diária de cada talhão desde `desde` (stg_field_data, a tabela do Power BI), uma linha por talhão:
 * `de` e `ate` = primeiro e último dia com registro e `dias` = só os dias com chuva, como 'n:mm' (n = dias
 * corridos desde `desde`; mm com duas casas, como no Power BI). Talhão de nome vazio fica de fora.
 * Com `pular`, paginada: a ordem de sempre (unidade, talhão) são as colunas do GROUP BY, sem empate.
 */
export function montarSqlChuvaTalhoes(desde, pular = null, tamanho = PAGINA_CONSULTA) {
  const d = dataSql(desde);
  return `SELECT unidade, fieldname,
  (min(data)::date - DATE '${d}') AS de, (max(data)::date - DATE '${d}') AS ate,
  string_agg((data::date - DATE '${d}')::text || ':' || trim(trailing '.' from trim(trailing '0' from round(pluviometry::numeric, 2)::text)), ',' ORDER BY data)
    FILTER (WHERE round(pluviometry::numeric, 2) > 0) AS dias
FROM "DATABASE".stg_field_data
WHERE data >= DATE '${d}' AND coalesce(fieldname, '') <> ''
GROUP BY unidade, fieldname${fimDaConsulta(pular, tamanho, 'unidade, fieldname', 'unidade, fieldname', paginaSqlZeus)}`;
}

/** Os dias que a stg_field_data tem em cada fazenda (a tabela tem falhas: dia ausente é dia sem dado, não seca). */
export function montarSqlDiasChuvaTalhoes(desde) {
  const d = dataSql(desde);
  return `SELECT unidade, string_agg(n::text, ',' ORDER BY n) AS dias
FROM (SELECT DISTINCT unidade, (data::date - DATE '${d}') AS n FROM "DATABASE".stg_field_data WHERE data >= DATE '${d}') x
GROUP BY unidade
ORDER BY unidade`;
}

/** linhas por página da consulta dos ciclos (o Agrovex corta o resultado em 5.000 linhas) */
export const CHUVA_CICLOS_PAGINA = 4000;

/**
 * Talhões dos ciclos do PIMS, com o filtro do Power BI: safras pedidas, só ALGODAO, SOJA e MILHO e talhões
 * com mais de 1 ha. Uma linha por talhão × período de safra, com o plantio e a colheita do talhão e as datas
 * do período; o início e o fim do ciclo saem em ciclosDoPims. Paginada (ORDER BY estável).
 */
export function montarSqlCiclosChuva(safras, pular = 0, tamanho = CHUVA_CICLOS_PAGINA) {
  return `SELECT u.DE_UNI_ADM AS unidade, sf.DE_SAFRA AS safra, ps.DE_PER_SAFRA AS periodo, up.CD_UPNIVEL3 AS talhao,
  CONVERT(varchar(10), up.DT_PLANT_INI, 120) AS plantio, CONVERT(varchar(10), up.DT_COLH_ENC, 120) AS colheita,
  CONVERT(varchar(10), ps.DT_INI_PER, 120) AS inicio_per, CONVERT(varchar(10), ps.DT_FIM_PER, 120) AS fim_per
FROM ${PIMS}UPNIVEL3 up
JOIN ${PIMS}UPNIVEL2 u2 ON u2.ID_UPNIVEL2 = up.ID_UPNIVEL2
JOIN ${PIMS}UPNIVEL1 u1 ON u1.ID_UPNIVEL1 = u2.ID_UPNIVEL1
JOIN ${PIMS}UNIDADEADM u ON u.ID_UNIDADEADM = u1.ID_UNIDADEADM
JOIN ${PIMS}PERIODOSAFRA ps ON ps.ID_PERIODOSAFRA = up.ID_PERIODOSAFRA
JOIN ${PIMS}SAFRA sf ON sf.ID_SAFRA = ps.ID_SAFRA
JOIN ${PIMS}OCUPACAO oc ON oc.ID_OCUPACAO = ps.ID_OCUPACAO
WHERE sf.DE_SAFRA IN (${listaSql(safras)}) AND up.QT_AREA_PROD > 1
  AND oc.DE_OCUPACAO IN ('ALGODAO', 'SOJA', 'MILHO') AND up.CD_UPNIVEL3 <> '9999'
ORDER BY u.DE_UNI_ADM, sf.DE_SAFRA, ps.DE_PER_SAFRA, up.CD_UPNIVEL3, up.ID_UPNIVEL3
OFFSET ${Math.max(0, Math.floor(pular))} ROWS FETCH NEXT ${Math.max(1, Math.floor(tamanho))} ROWS ONLY`;
}

/**
 * Ciclos a partir das linhas de montarSqlCiclosChuva, com a regra do Power BI: por unidade × safra × período,
 * começa no primeiro plantio (sem plantio em nenhum talhão, no início do período) e termina na última colheita
 * encerrada (sem colheita, no fim do período). Devolve [{ unidade, safra, periodo, inicio, fim, talhoes [códigos] }].
 */
export function ciclosDoPims(linhas) {
  const ciclos = new Map();
  for (const r of linhas) {
    const unidade = chaveNome(r.unidade);
    const safra = txt(r.safra);
    const periodo = txt(r.periodo);
    const codigo = normalizarCodigo(r.talhao);
    if (!unidade || !safra || !periodo || !codigo) continue;
    const chave = `${unidade}\u0000${safra}\u0000${periodo}`;
    if (!ciclos.has(chave)) ciclos.set(chave, { unidade, safra, periodo, plantio: null, colheita: null, inicioPer: null, fimPer: null, talhoes: new Set() });
    const c = ciclos.get(chave);
    const menor = (a, b) => (b && (!a || b < a) ? b : a);
    const maior = (a, b) => (b && (!a || b > a) ? b : a);
    c.plantio = menor(c.plantio, txt(r.plantio));
    c.colheita = maior(c.colheita, txt(r.colheita));
    c.inicioPer = menor(c.inicioPer, txt(r.inicio_per));
    c.fimPer = maior(c.fimPer, txt(r.fim_per));
    c.talhoes.add(codigo);
  }
  return [...ciclos.values()]
    .map((c) => ({ unidade: c.unidade, safra: c.safra, periodo: c.periodo, inicio: c.plantio ?? c.inicioPer, fim: c.colheita ?? c.fimPer, talhoes: [...c.talhoes].sort(comparar) }))
    .filter((c) => c.inicio && c.fim);
}

/**
 * Vínculo talhão → pluviômetro da ZEUS, com o cadastro do pluviômetro (a tabela repete o PIC a cada talhão).
 * Com `pular`, paginada por todas as colunas devolvidas: com o DISTINCT, não há duas linhas iguais.
 */
export function montarSqlVinculosZeus(pular = null, tamanho = PAGINA_CONSULTA) {
  return `SELECT DISTINCT farm, talhao, picid, picname, lat, lon
FROM "DATABASE".stg_zeus_picarea
WHERE picid IS NOT NULL${fimDaConsulta(pular, tamanho, '', '1, 2, 3, 4, 5, 6', paginaSqlZeus)}`;
}

/** Os vínculos inteiros, sem paginar (a rotina usa montarSqlVinculosZeus, em páginas). */
export const SQL_VINCULOS_ZEUS = montarSqlVinculosZeus();

/**
 * Chuva diária medida em cada pluviômetro desde `desde`, uma linha por pluviômetro: `dias` lista os dias com
 * leitura como 'n' (sem chuva) ou 'n:mm', sendo n os dias corridos desde `desde`. Dia fora da lista =
 * pluviômetro sem leitura. `leitura` = instante da leitura mais recente (aaaammddhhmmss).
 */
export function montarSqlChuvaDiariaPics(desde) {
  const d = dataSql(desde);
  return `WITH por_dia AS (
  SELECT c.picid, c.data::date AS dia, sum(c.pluviometria) AS mm,
    max(CASE WHEN right(c.idprecipitation, 14) ~ '^[0-9]{14}$' THEN right(c.idprecipitation, 14) END) AS leitura
  FROM "DATABASE".stg_climatemonitoring2 c
  WHERE c.data >= DATE '${d}' AND c.pluviometria IS NOT NULL
  GROUP BY 1, 2)
SELECT picid, max(leitura) AS leitura,
  string_agg((dia - DATE '${d}')::text || CASE WHEN round(mm::numeric, 1) > 0 THEN ':' || round(mm::numeric, 1)::text ELSE '' END, ',' ORDER BY dia) AS dias
FROM por_dia
GROUP BY picid
ORDER BY picid`;
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

/** '0,1,2,5,6' → '0-2,5-6' (os dias com dado, em faixas). */
export function faixasDeDias(texto) {
  const dias = [...new Set(String(texto ?? '').split(',').filter((x) => /^\d+$/.test(x.trim())).map((x) => Number(x)))].sort((a, b) => a - b);
  const faixas = [];
  for (let i = 0; i < dias.length; i++) {
    let j = i;
    while (j + 1 < dias.length && dias[j + 1] === dias[j] + 1) j++;
    faixas.push(i === j ? String(dias[i]) : `${dias[i]}-${dias[j]}`);
    i = j;
  }
  return faixas.join(',');
}

const somarDiasIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Linhas de chuva_talhao, uma por fazenda (nome como a unidade do PIMS):
 *   talhoes  { código: { de, ate, d } } — a chuva de cada talhão (stg_field_data); d = dias com chuva 'n:mm';
 *   lidos    '0-120,122-742' — os dias que a tabela tem para a fazenda;
 *   ultimo_dia — o último desses dias;
 *   ciclos   [{ s safra, p período, de, ate, t [códigos] }] — de ciclosDoPims, mais recentes primeiro;
 *   pics     [{ id, n, lat, lon, ul última leitura, d dias }] e vinculos { código: [índices em pics] } — a
 *            chuva medida nos pluviômetros e o cadastro da ZEUS, só como referência.
 * Fazenda sem talhão na stg_field_data e sem pluviômetro não gera linha.
 */
export function linhasChuvaTalhao({ talhoes, diasComDado, ciclos, vinculos, chuva }, desde, dias, geradoEm) {
  const fazendas = new Map();
  const fazenda = (unidade) => {
    if (!fazendas.has(unidade)) fazendas.set(unidade, { talhoes: {}, lidos: '', ciclos: [], pics: new Map(), vinc: new Map() });
    return fazendas.get(unidade);
  };
  const ehDia = (n) => Number.isInteger(n) && n >= 0 && n < dias;

  for (const r of objetosDe(talhoes)) {
    const unidade = chaveNome(r.unidade);
    const codigo = normalizarCodigo(r.fieldname);
    const de = Number(r.de);
    const ate = Number(r.ate);
    if (!unidade || !codigo || !ehDia(de) || !ehDia(ate)) continue;
    const d = txt(r.dias) ?? '';
    fazenda(unidade).talhoes[codigo] = { de, ate, d: /^[0-9:.,]*$/.test(d) ? d : '' };
  }
  for (const r of objetosDe(diasComDado)) {
    const unidade = chaveNome(r.unidade);
    if (unidade && fazendas.has(unidade)) fazendas.get(unidade).lidos = faixasDeDias(r.dias);
  }
  for (const c of ciclos) {
    // ciclo de fazenda sem chuva por talhão não tem o que mostrar
    if (!fazendas.has(c.unidade)) continue;
    fazendas.get(c.unidade).ciclos.push({ s: c.safra, p: c.periodo, de: c.inicio, ate: c.fim, t: c.talhoes });
  }

  const porPic = new Map(objetosDe(chuva).map((r) => [txt(r.picid), r]));
  for (const r of objetosDe(vinculos)) {
    const unidade = unidadeDaFazendaZeus(r.farm);
    const id = txt(r.picid);
    if (!unidade || !id) continue;
    const f = fazenda(unidade);
    if (!f.pics.has(id)) {
      const lat = Number(String(r.lat ?? '').replace(',', '.'));
      const lon = Number(String(r.lon ?? '').replace(',', '.'));
      const temLugar = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
      const lido = porPic.get(id);
      const d = txt(lido?.dias) ?? '';
      f.pics.set(id, {
        id, n: txt(r.picname) ?? `PIC ${id}`, lat: temLugar ? lat : null, lon: temLugar ? lon : null,
        ul: instanteDaLeitura(lido?.leitura), d: /^[0-9:.,]*$/.test(d) ? d : '',
      });
    }
    const codigo = codigoDoTalhaoZeus(r.talhao);
    if (!codigo) continue;
    if (!f.vinc.has(codigo)) f.vinc.set(codigo, new Set());
    f.vinc.get(codigo).add(id);
  }

  return [...fazendas]
    .sort((a, b) => comparar(a[0], b[0]))
    .map(([unidade, f]) => {
      const pics = [...f.pics.values()].sort((a, b) => comparar(a.n, b.n) || comparar(a.id, b.id));
      const indice = new Map(pics.map((p, i) => [p.id, i]));
      const vinc = {};
      for (const codigo of [...f.vinc.keys()].sort(comparar)) vinc[codigo] = [...f.vinc.get(codigo)].map((id) => indice.get(id)).sort((a, b) => a - b);
      const ultima = pics.reduce((m, p) => (p.ul && p.ul > m ? p.ul : m), '');
      const ultimoDia = Object.values(f.talhoes).reduce((m, t) => Math.max(m, t.ate), -1);
      return {
        unidade: unidade.slice(0, 80), gerado_em: geradoEm, inicio: desde, dias,
        ultimo_dia: ultimoDia >= 0 ? somarDiasIso(desde, ultimoDia) : null, lidos: f.lidos, talhoes: f.talhoes,
        ciclos: f.ciclos.sort((a, b) => comparar(b.s, a.s) || comparar(a.de, b.de) || comparar(a.p, b.p)),
        ultima_leitura: ultima || null, pics, vinculos: vinc,
      };
    });
}

/** Consulta a ZEUS e o PIMS pelo Agrovex e devolve as linhas de chuva_talhao (não grava nada). */
export async function sincronizarChuvaTalhao({ url, token, fetchImpl = fetch, agora = new Date() }) {
  const desde = inicioChuvaTalhao(agora);
  const dias = diasDaJanelaChuva(desde, agora);
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const talhoes = await consultarPaginas(cliente, (pular, tamanho) => montarSqlChuvaTalhoes(desde, pular, tamanho), 'chuva diária por talhão da ZEUS (stg_field_data)', 'chuva por talhão', { fonte: FONTES.zeus, reserva: true });
    const diasComDado = await cliente.consultar(montarSqlDiasChuvaTalhoes(desde), 'dias com chuva por talhão na ZEUS (stg_field_data)', 'dias da chuva por talhão', FONTES.zeus);
    const safras = safrasDaJanelaChuva(desde, agora);
    const talhoesPims = [];
    for (let pular = 0; ; pular += CHUVA_CICLOS_PAGINA) {
      const pagina = objetosDe(await cliente.consultar(montarSqlCiclosChuva(safras, pular), 'plantio e colheita dos talhões por unidade, safra e período (chuva por talhão)', 'ciclos do PIMS'));
      talhoesPims.push(...pagina);
      if (pagina.length < CHUVA_CICLOS_PAGINA) break;
    }
    const ciclos = ciclosDoPims(talhoesPims);
    const vinculos = await consultarPaginas(cliente, (pular, tamanho) => montarSqlVinculosZeus(pular, tamanho), 'vínculo talhão × pluviômetro da ZEUS (chuva por talhão)', 'vínculos da ZEUS', { fonte: FONTES.zeus, reserva: true });
    const chuva = await cliente.consultar(montarSqlChuvaDiariaPics(desde), 'chuva diária por pluviômetro (chuva por talhão)', 'chuva diária por pluviômetro', FONTES.zeus);
    return linhasChuvaTalhao({ talhoes, diasComDado, ciclos, vinculos, chuva }, desde, dias, agora.toISOString());
  } finally {
    await cliente.fechar();
  }
}

// ---------- limites dos talhões da ZEUS (opção "Talhões da ZEUS" da Chuva por talhão) ----------
// O cadastro de talhões da ZEUS com geometria fica no datalake (soils_database_database.stg_fields, WKT). Os
// nomes são os mesmos da tabela de chuva por talhão: desenhar por eles mostra exatamente os talhões que têm
// valor. Só algumas fazendas estão lá; as outras seguem com os limites do cadastro do Mapas.

/** linhas por página da consulta dos limites (cada linha traz um polígono inteiro em texto) */
export const LIMITES_ZEUS_PAGINA = 50;
/** pontos a menos disto do anterior saem do contorno (graus; ~4 m): o cadastro vem com muito mais detalhe do que a tela mostra */
const LIMITES_ZEUS_TOLERANCIA = 0.00004;

/** Fazendas que têm talhões com geometria no datalake. */
export const SQL_UNIDADES_LIMITES_ZEUS = `SELECT businessunitname, count(*) AS n
FROM soils_database_database.stg_fields
GROUP BY businessunitname
ORDER BY businessunitname`;

/** Talhões de uma fazenda do datalake (nome como está lá: 'Fazenda Guapirama'), paginados. */
export function montarSqlLimitesZeus(fazenda, pular = 0, tamanho = LIMITES_ZEUS_PAGINA) {
  return `SELECT idfield, fieldname, fieldgeom
FROM soils_database_database.stg_fields
WHERE businessunitname = ${listaSql([fazenda])}
ORDER BY idfield
OFFSET ${Math.max(0, Math.floor(pular))} LIMIT ${Math.max(1, Math.floor(tamanho))}`;
}

/**
 * Os talhões que têm chuva na stg_field_data desde `desde` (unidade + nome). Com `pular`, paginada pelas duas
 * colunas devolvidas: com o DISTINCT, não há duas linhas iguais.
 */
export function montarSqlTalhoesComChuva(desde, pular = null, tamanho = PAGINA_CONSULTA) {
  return `SELECT DISTINCT unidade, fieldname
FROM "DATABASE".stg_field_data
WHERE data >= DATE '${dataSql(desde)}' AND coalesce(fieldname, '') <> ''${fimDaConsulta(pular, tamanho, '', '1, 2', paginaSqlZeus)}`;
}

/**
 * WKT de polígono ('POLYGON (...)' ou 'MULTIPOLYGON (...)', com ou sem Z) → GeoJSON MultiPolygon em lon/lat com
 * seis casas, sem os pontos colados no anterior. Qualquer outra coisa (ou coordenada impossível) → null.
 */
export function geometriaDoWkt(wkt, tolerancia = LIMITES_ZEUS_TOLERANCIA) {
  const m = /^\s*(MULTI)?POLYGON\s*(?:Z\s*|M\s*|ZM\s*)?\((.*)\)\s*$/is.exec(String(wkt ?? ''));
  if (!m) return null;
  const corpo = m[1] ? m[2].trim().replace(/^\(/, '').replace(/\)$/, '') : m[2];
  const poligonos = [];
  for (const textoPoligono of corpo.split(/\)\s*\)\s*,\s*\(\s*\(/)) {
    const aneis = [];
    for (const textoAnel of textoPoligono.replace(/^\s*\(+/, '').replace(/\)+\s*$/, '').split(/\)\s*,\s*\(/)) {
      const anel = [];
      for (const ponto of textoAnel.split(',')) {
        const p = ponto.trim().split(/\s+/);
        const lon = Number(p[0]);
        const lat = Number(p[1]);
        if (p.length < 2 || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
        const ultimo = anel[anel.length - 1];
        if (ultimo && Math.abs(lon - ultimo[0]) < tolerancia && Math.abs(lat - ultimo[1]) < tolerancia) continue;
        anel.push([Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
      }
      // o anel fecha no primeiro ponto (o último pode ter sido tirado por estar colado nele)
      const a = anel[0];
      const z = anel[anel.length - 1];
      if (a && (a[0] !== z[0] || a[1] !== z[1])) anel.push([a[0], a[1]]);
      if (anel.length < 4) return null;
      aneis.push(anel);
    }
    if (!aneis.length) return null;
    poligonos.push(aneis);
  }
  return poligonos.length ? { type: 'MultiPolygon', coordinates: poligonos } : null;
}

/** Área (ha) de um MultiPolygon em lon/lat: plana em torno da latitude do polígono, com os buracos descontados. */
export function areaHaDaGeometria(geom) {
  let m2 = 0;
  for (const poligono of geom.coordinates) {
    poligono.forEach((anel, i) => {
      const kx = Math.cos((anel[0][1] * Math.PI) / 180) * 111_320;
      const ky = 110_570;
      let soma = 0;
      for (let a = 0, b = anel.length - 1; a < anel.length; b = a++) {
        soma += (anel[b][0] - anel[0][0]) * kx * (anel[a][1] - anel[0][1]) * ky - (anel[a][0] - anel[0][0]) * kx * (anel[b][1] - anel[0][1]) * ky;
      }
      m2 += (i === 0 ? 1 : -1) * Math.abs(soma) / 2;
    });
  }
  return Math.round((m2 / 10_000) * 100) / 100;
}

/**
 * Linhas de chuva_limites_zeus: uma por fazenda que tem limite no datalake E chuva por talhão, só com os
 * talhões que têm chuva: talhoes [{ codigo, nome, id, area_ha, geom }]. `campos` = Map(nome da fazenda no
 * datalake → linhas de montarSqlLimitesZeus). Nome cadastrado mais de uma vez fica com o id maior (o mais novo).
 */
export function linhasLimitesZeus(campos, comChuva, geradoEm) {
  const chuva = new Map();
  for (const r of objetosDe(comChuva)) {
    const unidade = chaveNome(r.unidade);
    const codigo = normalizarCodigo(r.fieldname);
    if (!unidade || !codigo) continue;
    if (!chuva.has(unidade)) chuva.set(unidade, new Set());
    chuva.get(unidade).add(codigo);
  }
  const linhas = [];
  for (const [fazenda, registros] of campos) {
    const unidade = unidadeDaFazendaZeus(fazenda);
    const codigos = chuva.get(unidade);
    if (!codigos) continue;
    const porCodigo = new Map();
    for (const r of registros) {
      const codigo = normalizarCodigo(r.fieldname);
      const id = Number(r.idfield);
      if (!codigo || !codigos.has(codigo) || !Number.isFinite(id)) continue;
      const atual = porCodigo.get(codigo);
      if (atual && atual.id > id) continue;
      const geom = geometriaDoWkt(r.fieldgeom);
      if (!geom) continue;
      porCodigo.set(codigo, { codigo, nome: txt(r.fieldname) ?? codigo, id, area_ha: areaHaDaGeometria(geom), geom });
    }
    if (!porCodigo.size) continue;
    linhas.push({ unidade: unidade.slice(0, 80), gerado_em: geradoEm, talhoes: [...porCodigo.values()].sort((a, b) => comparar(a.codigo, b.codigo)) });
  }
  return linhas.sort((a, b) => comparar(a.unidade, b.unidade));
}

/** Consulta a ZEUS e o datalake pelo Agrovex e devolve as linhas de chuva_limites_zeus (não grava nada). */
export async function sincronizarLimitesZeus({ url, token, fetchImpl = fetch, agora = new Date() }) {
  const cliente = await abrirSessao(url, token, fetchImpl);
  try {
    const comChuva = await consultarPaginas(cliente, (pular, tamanho) => montarSqlTalhoesComChuva(inicioChuvaTalhao(agora), pular, tamanho), 'talhões com chuva na ZEUS (stg_field_data)', 'talhões com chuva', { fonte: FONTES.zeus, reserva: true });
    const unidades = new Set(objetosDe(comChuva).map((r) => chaveNome(r.unidade)).filter(Boolean));
    const fazendas = objetosDe(await cliente.consultar(SQL_UNIDADES_LIMITES_ZEUS, 'fazendas com talhões da ZEUS no datalake (chuva por talhão)', 'fazendas com limite', FONTES.solos));
    const campos = new Map();
    for (const f of fazendas) {
      const nome = txt(f.businessunitname);
      // fazenda sem chuva por talhão não tem o que desenhar
      if (!nome || !unidades.has(unidadeDaFazendaZeus(nome))) continue;
      const registros = [];
      for (let pular = 0; ; pular += LIMITES_ZEUS_PAGINA) {
        const pagina = objetosDe(await cliente.consultar(montarSqlLimitesZeus(nome, pular), 'limites dos talhões da ZEUS no datalake (chuva por talhão)', 'limites da ZEUS', FONTES.solos));
        registros.push(...pagina);
        if (pagina.length < LIMITES_ZEUS_PAGINA) break;
      }
      campos.set(nome, registros);
    }
    return linhasLimitesZeus(campos, comChuva, agora.toISOString());
  } finally {
    await cliente.fechar();
  }
}

// ---------- benchmark de previsão (aba "Benchmark" da Previsão do Tempo) ----------
// Foto diária da previsão de chuva de cada fonte por fazenda, chuva medida pelos pluviômetros da ZEUS e as métricas
// de acerto (especificação: modulos/previsao/docs/2026-10-14-benchmark-previsao-design.md). Tabelas: supabase/0024.

/** Fontes do benchmark, na ordem em que aparecem na tela. */
export const PREV_FONTES = ['zeus', 'visualcrossing', 'metno'];
/** Hora de MT a partir da qual sai a foto do dia. */
export const PREV_HORA_FOTO = 6;
/** Hora de MT a partir da qual a foto da ZEUS sai mesmo com a previsão de uma fazenda incompleta (carga parada). */
export const PREV_HORA_ZEUS_INCOMPLETA = 12;
/** Antecedências do ranking (0 = todos os pares de 1 a 7 dias). A ZEUS chega a D+13. */
export const PREV_ANTECEDENCIAS = [0, 1, 3, 7, 13];
/** Abaixo disso a tela mostra "histórico insuficiente". */
export const PREV_MINIMO_PARES = 10;
/** Identificação exigida pelo MET Norway (nome do serviço e onde nos achar). */
export const PREV_USER_AGENT = 'coa-web-locks/1.0 (https://coa-web-teal.vercel.app)';
const PREV_PRAZO_MS = 30_000;
/** Mato Grosso: UTC−4 o ano inteiro (sem horário de verão). */
const MT_DESLOCAMENTO_MS = -4 * 3_600_000;
const arred1 = (x) => Math.round(x * 10) / 10;

/** Dia (AAAA-MM-DD) em Mato Grosso de um instante. */
export function diaMT(instante) {
  return new Date(new Date(instante).getTime() + MT_DESLOCAMENTO_MS).toISOString().slice(0, 10);
}
/** Hora (0 a 23) em Mato Grosso de um instante. */
export function horaMT(instante) {
  return new Date(new Date(instante).getTime() + MT_DESLOCAMENTO_MS).getUTCHours();
}
/** Dia AAAA-MM-DD mais `n` dias. */
export function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Quantos dias de `a` até `b` (AAAA-MM-DD). */
export function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
/** 1º de setembro do ano-safra de `hoje`. */
export function inicioSafraMT(hoje) {
  const [ano, mes] = String(hoje).split('-').map(Number);
  return `${mes >= 9 ? ano : ano - 1}-09-01`;
}

/**
 * Fazendas do benchmark a partir dos pluviômetros da ZEUS (SQL_PICS_ZEUS): só as que estão no cadastro do Mapas
 * (`unidades`, nomes de unidade do PIMS). `pontos`: média das coordenadas dos pluviômetros, com 4 casas (onde as
 * fontes de fora são consultadas). `fazendaDoPic`: todo pluviômetro da fazenda, com ou sem coordenada.
 */
export function pontosDasFazendas(res, unidades) {
  const conhecidas = new Set(unidades.map((u) => String(u).trim().toUpperCase()));
  const fazendaDoPic = new Map();
  const soma = new Map();
  for (const r of objetosDe(res)) {
    const unidade = unidadeDaFazendaZeus(r.farm);
    if (!conhecidas.has(unidade) || r.picid === null) continue;
    fazendaDoPic.set(String(r.picid), unidade);
    const lat = Number(r.lat), lon = Number(r.lon);
    if (r.lat === null || r.lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const s = soma.get(unidade) ?? { lat: 0, lon: 0, n: 0 };
    s.lat += lat; s.lon += lon; s.n += 1;
    soma.set(unidade, s);
  }
  const quatro = (x) => Math.round(x * 1e4) / 1e4;
  const pontos = new Map([...soma].sort(([a], [b]) => a.localeCompare(b)).map(([u, s]) => [u, { lat: quatro(s.lat / s.n), lon: quatro(s.lon / s.n) }]));
  return { pontos, fazendaDoPic };
}

/**
 * Previsão diária da ZEUS por pluviômetro (stg_short_forecast guarda só a mais recente), de `desde` em diante.
 * Paginável: a ordem (pluviômetro, dia) não empata.
 */
export function montarSqlPrevisaoZeus(desde, pular = null, tamanho = PAGINA_CONSULTA) {
  const d = String(desde).replace(/[^0-9-]/g, '');
  return `SELECT picid::text AS picid, to_char(day::date, 'YYYY-MM-DD') AS dia, forecast AS mm, rainprobability AS prob
FROM "DATABASE".stg_short_forecast
WHERE day::date >= DATE '${d}' AND forecast IS NOT NULL${fimDaConsulta(pular, tamanho, '1, 2', '1, 2', paginaSqlZeus)}`;
}

/** Média dos valores de um dia que não são nulos (ou null). */
function mediaDe(lista) {
  const ok = lista.filter((v) => v !== null && Number.isFinite(v));
  return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
}

/** Previsão da ZEUS por fazenda: média, por dia, dos pluviômetros da fazenda. → Map<unidade, [{ d, mm, p }]> */
export function previsaoZeusPorFazenda(res, fazendaDoPic) {
  const porFazenda = new Map();
  for (const r of objetosDe(res)) {
    const unidade = fazendaDoPic.get(String(r.picid));
    const d = txt(r.dia);
    const mm = Number(r.mm);
    if (!unidade || !d || r.mm === null || !Number.isFinite(mm)) continue;
    const dias = porFazenda.get(unidade) ?? new Map();
    porFazenda.set(unidade, dias);
    const x = dias.get(d) ?? { mm: [], p: [] };
    dias.set(d, x);
    x.mm.push(mm);
    x.p.push(r.prob === null ? null : Number(r.prob));
  }
  return new Map([...porFazenda].sort(([a], [b]) => a.localeCompare(b)).map(([u, dias]) => [u, [...dias]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, x]) => { const p = mediaDe(x.p); return { d, mm: arred1(mediaDe(x.mm)), p: p === null ? null : Math.round(p) }; })]));
}

/** Endereço do Visual Crossing (15 dias, só o resumo diário, unidades métricas). A chave vai no endereço: nunca logar. */
export function urlVisualCrossing({ lat, lon }, chave) {
  return `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}?unitGroup=metric&include=days&contentType=json&key=${encodeURIComponent(chave)}`;
}

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

/**
 * Chuva medida por pluviômetro e dia (`data` da telemetria vem só com o dia), de `de` a `ate`, sem leitura repetida
 * (mesmo idprecipitation). ~150 pluviômetros × 2 dias: cabe numa consulta.
 */
export function montarSqlObservadoZeus(de, ate) {
  const a = String(de).replace(/[^0-9-]/g, '');
  const b = String(ate).replace(/[^0-9-]/g, '');
  return `WITH leituras AS (
  SELECT DISTINCT idprecipitation, picid, data, pluviometria FROM "DATABASE".stg_climatemonitoring2
  WHERE data >= DATE '${a}' AND data < DATE '${b}' + 1 AND pluviometria IS NOT NULL)
SELECT picid::text AS picid, to_char(data::date, 'YYYY-MM-DD') AS dia, round(sum(pluviometria)::numeric, 1) AS mm
FROM leituras
GROUP BY 1, 2
ORDER BY 1, 2`;
}

/** Chuva medida por fazenda: média dos pluviômetros que leram no dia (quem não leu não entra como zero). */
export function observadoPorFazenda(res, fazendaDoPic) {
  const acc = new Map();
  for (const r of objetosDe(res)) {
    const unidade = fazendaDoPic.get(String(r.picid));
    const dia = txt(r.dia);
    const mm = Number(r.mm);
    if (!unidade || !dia || r.mm === null || !Number.isFinite(mm)) continue;
    const chave = `${unidade}|${dia}`;
    const x = acc.get(chave) ?? { unidade, dia, soma: 0, n: 0 };
    x.soma += mm; x.n += 1;
    acc.set(chave, x);
  }
  return [...acc.values()].sort((a, b) => a.unidade.localeCompare(b.unidade) || a.dia.localeCompare(b.dia))
    .map((x) => ({ unidade: x.unidade, dia: x.dia, mm: arred1(x.soma / x.n), pluviometros: x.n }));
}

/** Impressão digital da previsão da ZEUS por fazenda (muda quando qualquer valor muda; não depende da ordem). */
export function assinaturaDaPrevisao(porFazenda) {
  const ordenado = [...porFazenda].sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha1').update(JSON.stringify(ordenado)).digest('hex');
}

/**
 * Pares previsto × medido por fonte, fazenda, dia e antecedência k (dia previsto − dia da foto, de 1 em diante).
 * Comparação justa: um (fazenda, dia, k) só entra se todas as fontes que tiraram a foto do dia dia − k e chegaram
 * a k nela (em qualquer fazenda) têm previsão para ele, e se houve chuva medida (pelo menos um pluviômetro lido) na
 * fazenda naquele dia. O alcance é por dia de foto: uma fonte que parou (ou que ainda não existia) não tira os pares
 * das outras nos dias em que não tirou foto; uma que faltou só numa fazenda tira o par dessa fazenda de todas.
 */
export function paresDoBenchmark(previsoes, observado) {
  const medido = new Map(observado.filter((o) => Number(o.pluviometros) > 0).map((o) => [`${o.unidade}|${o.dia}`, Number(o.mm)]));
  const previsto = new Map();
  const alcance = new Map(); // 'emitida_em' → Map(fonte → maior k da foto daquele dia, entre as fazendas)
  for (const f of previsoes) {
    for (const x of Array.isArray(f.dias) ? f.dias : []) {
      const k = diasEntre(f.emitida_em, x.d);
      const mm = Number(x.mm);
      if (k < 1 || !Number.isFinite(mm)) continue;
      if (!alcance.has(f.emitida_em)) alcance.set(f.emitida_em, new Map());
      const doDia = alcance.get(f.emitida_em);
      doDia.set(f.fonte, Math.max(doDia.get(f.fonte) ?? 0, k));
      const chave = `${f.unidade}|${x.d}|${k}`;
      if (!previsto.has(chave)) previsto.set(chave, new Map());
      previsto.get(chave).set(f.fonte, mm);
    }
  }
  const pares = [];
  for (const [chave, porFonte] of previsto) {
    const [unidade, dia, kTexto] = chave.split('|');
    const k = Number(kTexto);
    const real = medido.get(`${unidade}|${dia}`);
    if (real === undefined) continue;
    const elegiveis = [...(alcance.get(somarDias(dia, -k)) ?? new Map())].filter(([, maximo]) => maximo >= k).map(([fonte]) => fonte);
    if (!elegiveis.every((fonte) => porFonte.has(fonte))) continue;
    for (const [fonte, mm] of porFonte) pares.push({ fonte, unidade, dia, k, previsto: mm, medido: real });
  }
  return pares;
}

/**
 * Métricas por período (30, 60, 90 dias até ontem e a safra), fazenda (e 'TODAS'), fonte e antecedência
 * (0 = todos os pares de 1 a 7). Só sai linha com pelo menos um par; a tela decide o mínimo para mostrar.
 */
export function metricasDoBenchmark(pares, hoje) {
  const ontem = somarDias(hoje, -1);
  const periodos = [['30d', somarDias(ontem, -29)], ['60d', somarDias(ontem, -59)], ['90d', somarDias(ontem, -89)], ['safra', inicioSafraMT(hoje)]];
  const unidades = [...new Set(pares.map((p) => p.unidade))].sort();
  const fontes = PREV_FONTES.filter((f) => pares.some((p) => p.fonte === f));
  const linhas = [];
  for (const [periodo, de] of periodos) {
    const doPeriodo = pares.filter((p) => p.dia >= de && p.dia <= ontem);
    for (const unidade of [...unidades, 'TODAS']) {
      const daUnidade = unidade === 'TODAS' ? doPeriodo : doPeriodo.filter((p) => p.unidade === unidade);
      for (const fonte of fontes) {
        const daFonte = daUnidade.filter((p) => p.fonte === fonte);
        for (const antecedencia of PREV_ANTECEDENCIAS) {
          const sel = daFonte.filter((p) => (antecedencia === 0 ? p.k >= 1 && p.k <= 7 : p.k === antecedencia));
          if (!sel.length) continue;
          const n = sel.length;
          linhas.push({
            unidade, periodo, fonte, antecedencia, n,
            erro_medio: arred1(sel.reduce((s, p) => s + Math.abs(p.previsto - p.medido), 0) / n),
            vies: arred1(sel.reduce((s, p) => s + (p.previsto - p.medido), 0) / n),
            acerto: Math.round((100 * sel.filter((p) => (p.previsto >= 1) === (p.medido >= 1)).length) / n),
          });
        }
      }
    }
  }
  return linhas;
}

/** GET no Supabase que devolve a lista (erro do PostgREST sem a chave). */
async function sbLer({ url, chave }, caminho, acao, fetchImpl) {
  const resp = await chamarSupabase(fetchImpl, `${url}/rest/v1/${caminho}`, { headers: cabecalhosSupabase(chave) }, acao);
  if (!resp.ok) await erroSupabase(resp, chave, acao);
  return resp.json();
}
/** Todas as páginas (1.000 linhas cada) de um GET. A consulta precisa de uma ordem sem empate. */
async function sbLerTudo(supabase, caminho, acao, fetchImpl) {
  const saida = [];
  for (let de = 0; ; de += 1000) {
    const linhas = await sbLer(supabase, `${caminho}&limit=1000&offset=${de}`, acao, fetchImpl);
    saida.push(...linhas);
    if (linhas.length < 1000) return saida;
  }
}
/** Upsert (merge) de linhas numa tabela; lista vazia não faz chamada. */
async function sbUpsert({ url, chave }, tabela, conflito, linhas, fetchImpl) {
  if (!linhas.length) return;
  const acao = `a gravação em ${tabela}`;
  const resp = await chamarSupabase(fetchImpl, `${url}/rest/v1/${tabela}?on_conflict=${conflito}`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  }, acao);
  if (!resp.ok) await erroSupabase(resp, chave, acao);
}

/** GET numa fonte de fora, com prazo e identificação. O erro nunca traz o endereço (o do Visual Crossing tem a chave). */
async function lerFonteExterna(fetchImpl, url, nome) {
  let resp;
  try {
    resp = await fetchImpl(url, { headers: { 'User-Agent': PREV_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(PREV_PRAZO_MS) });
  } catch (e) {
    const prazo = e !== null && typeof e === 'object' && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw Object.assign(new Error(`${nome}: ${prazo ? `sem resposta em ${PREV_PRAZO_MS / 1000} s` : 'falha de rede'}`), { status: 0 });
  }
  if (!resp.ok) throw Object.assign(new Error(`${nome}: HTTP ${resp.status}`), { status: resp.status });
  return resp.json();
}

/**
 * Etapa do benchmark de previsão dentro da rotina de hora em hora. Não lança: devolve null (ok) ou a mensagem de erro
 * já registrada (como rodarAcompanhamento). Em toda rodada: registra a mudança da previsão da ZEUS e grava a chuva
 * medida de anteontem e ontem. A partir das 6 h de MT: a foto de hoje do que ainda falta (fonte × fazenda) e, uma
 * vez por dia, as métricas. Uma fonte que falha não impede as outras (só aviso no log, sem nome de fazenda).
 */
export async function rodarBenchmarkPrevisao({ agrovex, supabase, visualCrossingChave = '', fetchImpl = globalThis.fetch, agora = new Date() }) {
  const limpar = (texto) => {
    let t = semChave(semChave(String(texto), supabase.chave), agrovex.token);
    if (visualCrossingChave) t = semChave(semChave(t, visualCrossingChave), encodeURIComponent(visualCrossingChave));
    return t;
  };
  try {
    const hoje = diaMT(agora);
    const capturada = agora.toISOString();
    const unidades = (await sbLer(supabase, 'mapas_fazendas?select=unidade_pims&unidade_pims=not.is.null', 'a leitura das fazendas', fetchImpl))
      .map((f) => String(f.unidade_pims ?? '').trim().toUpperCase()).filter(Boolean);
    const cliente = await abrirSessao(agrovex.url, agrovex.token, fetchImpl);
    let pontos, zeus, observado;
    try {
      const fazendas = pontosDasFazendas(await cliente.consultar(SQL_PICS_ZEUS, 'pluviômetros da ZEUS e suas fazendas (benchmark de previsão)', 'pluviômetros', FONTES.zeus), unidades);
      pontos = fazendas.pontos;
      zeus = previsaoZeusPorFazenda(await consultarPaginas(cliente, (pular, tamanho) => montarSqlPrevisaoZeus(hoje, pular, tamanho),
        'previsão de chuva da ZEUS por pluviômetro (benchmark de previsão)', 'previsão da ZEUS', { fonte: FONTES.zeus }), fazendas.fazendaDoPic);
      observado = observadoPorFazenda(await cliente.consultar(montarSqlObservadoZeus(somarDias(hoje, -2), somarDias(hoje, -1)),
        'chuva medida pelos pluviômetros da ZEUS (benchmark de previsão)', 'chuva medida', FONTES.zeus), fazendas.fazendaDoPic);
    } finally {
      await cliente.fechar();
    }

    // 1. a ZEUS mudou a previsão? (para saber a hora em que ela publica)
    const assinatura = assinaturaDaPrevisao(zeus);
    const ultima = await sbLer(supabase, 'prev_zeus_atualizacoes?select=assinatura&order=capturada_em.desc&limit=1', 'a leitura das atualizações da ZEUS', fetchImpl);
    if (zeus.size && (!ultima.length || ultima[0].assinatura !== assinatura)) {
      await sbUpsert(supabase, 'prev_zeus_atualizacoes', 'capturada_em', [{ capturada_em: capturada, assinatura }], fetchImpl);
    }
    // 2. chuva medida, em toda rodada (carga atrasada da telemetria entra na rodada seguinte)
    await sbUpsert(supabase, 'prev_observado', 'unidade,dia', observado, fetchImpl);
    if (horaMT(agora) < PREV_HORA_FOTO) return null;

    // 3. a foto de hoje, só do que ainda falta (fonte × fazenda)
    const feitas = new Set((await sbLer(supabase, `prev_previsoes?select=fonte,unidade&emitida_em=eq.${hoje}`, 'a leitura das fotos de hoje', fetchImpl))
      .map((r) => `${r.fonte}|${r.unidade}`));
    const falta = (fonte, unidade) => !feitas.has(`${fonte}|${unidade}`);
    const dentro = (dias) => dias.filter((x) => { const k = diasEntre(hoje, x.d); return k >= 0 && k <= 14; });
    const fotos = [];
    const guardar = (fonte, unidade, dias) => { const d = dentro(dias); if (d.length) fotos.push({ fonte, unidade, emitida_em: hoje, capturada_em: capturada, dias: d }); };
    // a ZEUS recarrega a previsão por volta das 6 h (visto em 15/10/2026: na rodada das 6:17 faltou uma fazenda e outra
    // veio com um dia a menos). No meio da carga, a fazenda sem previsão ou com menos dias que as outras fica para a
    // próxima rodada; a partir das 12 h de MT vai como estiver (carga parada não pode deixar a fazenda sem foto).
    const diasCompletos = Math.max(0, ...[...zeus.values()].map((dias) => dentro(dias).length));
    const aceitaIncompleta = horaMT(agora) >= PREV_HORA_ZEUS_INCOMPLETA;
    let zeusIncompletas = aceitaIncompleta ? 0 : [...pontos.keys()].filter((unidade) => !zeus.has(unidade) && falta('zeus', unidade)).length;
    for (const [unidade, dias] of zeus) {
      if (!falta('zeus', unidade)) continue;
      if (dentro(dias).length < diasCompletos && !aceitaIncompleta) { zeusIncompletas += 1; continue; }
      guardar('zeus', unidade, dias);
    }
    if (zeusIncompletas) console.warn(`Benchmark de previsão: ZEUS incompleta em ${zeusIncompletas} fazenda(s) (carga em andamento?); tenta de novo na próxima rodada.`);
    const externas = [
      ['visualcrossing', 'Visual Crossing', visualCrossingChave ? (p) => urlVisualCrossing(p, visualCrossingChave) : null, previsaoVisualCrossing],
      ['metno', 'MET Norway', urlMetNo, previsaoMetNo],
    ];
    for (const [fonte, nome, endereco, converter] of externas) {
      if (!endereco) { console.warn(`Benchmark de previsão: ${nome} sem chave no ambiente (VISUALCROSSING_KEY); fonte pulada.`); continue; }
      let falhas = 0;
      for (const [unidade, ponto] of pontos) {
        if (!falta(fonte, unidade)) continue;
        try {
          guardar(fonte, unidade, converter(await lerFonteExterna(fetchImpl, endereco(ponto), nome)));
        } catch (e) {
          falhas += 1;
          // recusa de acesso, limite estourado ou fonte fora do ar (rede, prazo: status 0) vale para todas as fazendas:
          // não insiste nesta rodada (a rodada segura a trava que os pedidos das telas esperam)
          if (e && (e.status === 0 || e.status === 401 || e.status === 403 || e.status === 429)) { console.warn(`Benchmark de previsão: ${limpar(e.message)}; fonte parada nesta rodada.`); break; }
        }
      }
      if (falhas) console.warn(`Benchmark de previsão: ${nome} falhou em ${falhas} fazenda(s); tenta de novo na próxima rodada.`);
    }
    await sbUpsert(supabase, 'prev_previsoes', 'fonte,unidade,emitida_em', fotos, fetchImpl);

    // 4. métricas, uma vez por dia (e de novo enquanto não houver nenhuma)
    const conta = await sbLer(supabase, 'prev_metricas?select=calculado_em&order=calculado_em.desc&limit=1', 'a leitura das métricas', fetchImpl);
    let metricas = [];
    if (!conta.length || diaMT(conta[0].calculado_em) !== hoje) {
      // o que vier antes: o início da safra ou os 90 dias até ontem (em setembro, a janela de 90 dias começa na safra passada)
      const desde = [inicioSafraMT(hoje), somarDias(hoje, -90)].sort()[0];
      const previsoes = await sbLerTudo(supabase, `prev_previsoes?select=fonte,unidade,emitida_em,dias&emitida_em=gte.${somarDias(desde, -14)}&order=emitida_em,fonte,unidade`, 'a leitura das fotos', fetchImpl);
      const medidos = await sbLerTudo(supabase, `prev_observado?select=unidade,dia,mm,pluviometros&dia=gte.${desde}&order=dia,unidade`, 'a leitura da chuva medida', fetchImpl);
      metricas = metricasDoBenchmark(paresDoBenchmark(previsoes, medidos), hoje).map((m) => ({ ...m, calculado_em: capturada }));
      if (metricas.length) {
        await sbUpsert(supabase, 'prev_metricas', 'unidade,periodo,fonte,antecedencia', metricas, fetchImpl);
        // combinação que não saiu agora (fonte parada, janela que andou) não fica com número velho
        const resp = await chamarSupabase(fetchImpl, `${supabase.url}/rest/v1/prev_metricas?calculado_em=lt.${encodeURIComponent(capturada)}`,
          { method: 'DELETE', headers: cabecalhosSupabase(supabase.chave) }, 'a limpeza de prev_metricas');
        if (!resp.ok) await erroSupabase(resp, supabase.chave, 'a limpeza de prev_metricas');
      }
    }
    console.log(`Benchmark de previsão: ${fotos.length} foto(s) nova(s), chuva medida de ${observado.length} fazenda×dia, ${metricas.length} métrica(s).`);
    return null;
  } catch (e) {
    const msg = limpar(e instanceof Error ? e.message : String(e));
    console.error(`Benchmark de previsão: erro (o resto da rotina não foi afetado): ${msg}`);
    return msg;
  }
}

// ---------- execução pela linha de comando ----------

/**
 * O que a linha de comando pede, pelos argumentos e pelo ambiente:
 *   { local: false, token, supabaseUrl, supabaseChave } — a rotina do servidor: consulta o PIMS e grava no Supabase;
 *   { local: true, token, … }  — só com --local (ou PLANTIO_LOCAL=1): grava public/dados/plantio.json nesta
 *     máquina e não toca no Supabase, mesmo que as variáveis dele estejam no ambiente.
 * Sem o pedido de modo local, faltar AGROVEX_TOKEN, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY LANÇA erro: antes,
 * sem as variáveis do Supabase a rotina caía no modo local sem avisar, e na VM isso era parar de atualizar o
 * banco em silêncio. A mensagem traz só os nomes das variáveis, nunca os valores.
 */
export function modoDeExecucao(args = [], env = {}) {
  const valor = (nome) => (typeof env[nome] === 'string' ? env[nome].trim() : '');
  const token = valor('AGROVEX_TOKEN');
  if (args.includes('--local') || valor('PLANTIO_LOCAL') === '1') return { local: true, token, supabaseUrl: '', supabaseChave: '' };
  const supabaseUrl = valor('SUPABASE_URL');
  const supabaseChave = valor('SUPABASE_SERVICE_ROLE_KEY');
  const faltam = [['AGROVEX_TOKEN', token], ['SUPABASE_URL', supabaseUrl], ['SUPABASE_SERVICE_ROLE_KEY', supabaseChave]].filter(([, v]) => !v).map(([nome]) => nome);
  if (faltam.length) {
    const nomes = faltam.length === 1 ? faltam[0] : `${faltam.slice(0, -1).join(', ')} e ${faltam[faltam.length - 1]}`;
    throw new Error(
      `${faltam.length === 1 ? 'Falta' : 'Faltam'} ${nomes} no ambiente: nada foi consultado nem gravado. ` +
      'No servidor, confira o arquivo de variáveis da rotina. Para gravar public/dados/plantio.json nesta máquina, sem o Supabase, rode com --local (npm run plantio).',
    );
  }
  return { local: false, token, supabaseUrl, supabaseChave };
}

async function main() {
  // antes de qualquer consulta: sem as variáveis (e sem --local) a rotina termina com erro e código de saída 1
  const modo = modoDeExecucao(process.argv.slice(2), process.env);
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(raiz, 'scripts', 'plantio.config.json'), 'utf8'));
  const token = modo.token;
  if (!token) {
    // só acontece no modo local (sem ele, a falta do token já virou erro acima)
    console.warn('AGROVEX_TOKEN não definido: plantio.json não foi atualizado.');
    return;
  }
  // conferido antes de qualquer chamada: o token só sai para o host do Agrovex (o endereço vem de arquivo baixado)
  const urlAgrovex = conferirUrlAgrovex(process.env.AGROVEX_URL || config.url);
  const dados = await sincronizar({
    url: urlAgrovex,
    token,
    safras: config.safras ?? 'auto',
    excluirPrefixos: config.excluirPrefixos ?? [],
  });
  const log = () => {
    for (const l of linhasDeLog(dados, { supabase: !modo.local })) console.log(l);
  };
  if (!modo.local) {
    const supabase = { url: modo.supabaseUrl, chave: modo.supabaseChave };
    await gravarSupabase(dados, { ...supabase, fetch });
    log();
    // Acompanhamento Operacional: depois do plantio dos mapas; um erro nele não desfaz o que já foi gravado
    if (config.acompanhamento !== false) {
      const erro = await rodarAcompanhamento({
        agrovex: { url: urlAgrovex, token, safras: config.safras ?? 'auto', excluirPrefixos: config.excluirPrefixos ?? [] },
        supabase,
      });
      if (erro) process.exitCode = 1;
    }
    // Validação de apontamentos (ordens de serviço e saldo dos depósitos): um erro nela não desfaz o resto
    if (config.validacao !== false) {
      const erro = await rodarValidacao({
        agrovex: { url: urlAgrovex, token },
        supabase,
      });
      if (erro) process.exitCode = 1;
    }
    // Benchmark de previsão (aba da Previsão do Tempo): um erro nele não desfaz o resto
    if (config.previsao !== false) {
      const erro = await rodarBenchmarkPrevisao({
        agrovex: { url: urlAgrovex, token },
        supabase,
        visualCrossingChave: (process.env.VISUALCROSSING_KEY || '').trim(),
      });
      if (erro) process.exitCode = 1;
    }
    return;
  }
  // modo local (--local): o resumo por unidade e o arquivo public/dados/plantio.json, só nesta máquina
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
    // o texto de um erro pode repetir o que o outro lado devolveu: a chave e o token saem antes de ir para o log
    const msg = semChave(semChave(e instanceof Error ? e.message : String(e), process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()), process.env.AGROVEX_TOKEN?.trim());
    console.error(`Erro ao sincronizar o plantio: ${msg}`);
    process.exitCode = 1;
  });
}
