// Atende os pedidos do botão "Atualizar plantio" do módulo MAPAS (tabela mapas_plantio_pedidos).
// Roda no servidor (VM do Google Cloud) a cada ~30 s: sem pedido pendente, sai sem fazer nada; com
// pedido, roda a rotina do PIMS (a mesma de sincronizar-plantio.mjs), grava no Supabase e marca os
// pedidos pendentes como atendidos ('ok' ou a mensagem de erro, sem segredos).
// Na mesma verificação atende os pedidos de "Inserir dados via integração" do Mapa de Chuva (tabela
// mapas_chuva_pedidos): busca na ZEUS a chuva de cada PIC da fazenda no período e grava no pedido.
// E os pedidos de "Buscar direto no PIMS" de Mecanizadas (tabela mec_pims_pedidos): os boletins de
// atividades mecanizadas da unidade no período, no formato do relatório exportado do PIMS.
// Variáveis: AGROVEX_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (as mesmas da rotina horária).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boletinsMecanizadas, cabecalhosSupabase, chuvaPorPicZeus, gravarSupabase, rodarAcompanhamento, rodarValidacao, semChave, sincronizar, sincronizarChuvaTalhao, ultimoDiaZeus } from './sincronizar-plantio.mjs';

const TABELA = 'mapas_plantio_pedidos';
/** pedidos atendidos há mais que isto são apagados (a tabela não cresce sem fim) */
const GUARDAR_DIAS = 30;

async function erroRest(resp, chave, acao) {
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

/** Ids dos pedidos pendentes, do mais antigo para o mais novo. */
export async function pedidosPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA}?select=id&atendido_em=is.null&order=id.asc`, {
    headers: cabecalhosSupabase(chave),
  });
  if (!resp.ok) await erroRest(resp, chave, 'a leitura dos pedidos');
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas.map((l) => Number(l.id)).filter(Number.isFinite) : [];
}

/** Marca como atendidos os pendentes com id ≤ ateId (os que chegarem durante a rodada ficam para a próxima). */
export async function marcarAtendidos({ url, chave, fetch: fetchImpl = globalThis.fetch }, ateId, resultado, agora = new Date()) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA}?atendido_em=is.null&id=lte.${ateId}`, {
    method: 'PATCH',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ atendido_em: agora.toISOString(), resultado: String(resultado).slice(0, 300) }),
  });
  if (!resp.ok) await erroRest(resp, chave, 'a marcação dos pedidos');
}

/** Apaga os pedidos atendidos há mais de GUARDAR_DIAS dias (melhor esforço). */
export async function limparAntigos({ url, chave, fetch: fetchImpl = globalThis.fetch }, agora = new Date()) {
  const limite = new Date(agora.getTime() - GUARDAR_DIAS * 86_400_000).toISOString();
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA}?atendido_em=lt.${encodeURIComponent(limite)}`, {
    method: 'DELETE',
    headers: { ...cabecalhosSupabase(chave), Prefer: 'return=minimal' },
  });
  if (!resp.ok) await erroRest(resp, chave, 'a limpeza dos pedidos');
}

/**
 * Uma verificação: sem pendentes → false (não faz nada); com pendentes → roda a rotina do PIMS, grava e
 * marca os pedidos; devolve true. Um erro da rotina vira o `resultado` dos pedidos (e é relançado).
 */
export async function atenderPedidos({ supabase, agrovex, acompanhamento = false, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const ids = await pedidosPendentes(ctx);
  if (!ids.length) return false;
  const ateId = ids[ids.length - 1];
  try {
    const dados = await sincronizar({ ...agrovex, fetchImpl });
    await gravarSupabase(dados, ctx);
    // o mesmo botão atualiza o Acompanhamento Operacional (erro nele só vai para o log)
    if (acompanhamento) await rodarAcompanhamento({ agrovex, supabase, fetchImpl });
    await marcarAtendidos(ctx, ateId, 'ok', agora());
    console.log(`== ${agora().toISOString()} ${ids.length} pedido(s) atendido(s); plantio geradoEm ${dados.geradoEm}.`);
  } catch (e) {
    const msg = semChave(semChave(e instanceof Error ? e.message : String(e), supabase.chave), agrovex.token);
    await marcarAtendidos(ctx, ateId, `erro: ${msg}`, agora()).catch(() => undefined);
    throw e;
  }
  await limparAntigos(ctx, agora()).catch(() => undefined);
  return true;
}

// ---------- pedidos de chuva por PIC ("Inserir dados via integração" do Mapa de Chuva) ----------

const TABELA_CHUVA = 'mapas_chuva_pedidos';
/** pedidos de chuva atendidos há mais que isto são apagados (o resultado já foi para o mapa) */
const GUARDAR_CHUVA_DIAS = 7;
/** pedidos atendidos por verificação (os demais ficam para a próxima, ~30 s depois) */
const MAX_CHUVA_POR_RODADA = 5;

/** A tabela ainda não existe (script 0003_pedidos_chuva.sql não aplicado)? */
async function semTabela(resp) {
  if (resp.status !== 404 && resp.status !== 400) return false;
  const corpo = await resp.clone().json().catch(() => null);
  return corpo?.code === 'PGRST205' || corpo?.code === '42P01';
}

/** O banco ainda não tem as colunas de hora do pedido (script 0004_situacao_zeus.sql não aplicado)? */
async function semColunaDeHora(resp) {
  if (resp.status !== 400) return false;
  const corpo = await resp.clone().json().catch(() => null);
  return corpo?.code === '42703';
}

/**
 * Pedidos de chuva pendentes ({ id, fazenda, de, ate, de_hora, ate_hora }), do mais antigo para o mais
 * novo; sem a tabela → []. Num banco sem as colunas de hora, lê só as datas (os pedidos por data seguem
 * funcionando).
 */
export async function pedidosChuvaPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const ler = (colunas) => fetchImpl(`${url}/rest/v1/${TABELA_CHUVA}?select=${colunas}&atendido_em=is.null&order=id.asc&limit=${MAX_CHUVA_POR_RODADA}`, {
    headers: cabecalhosSupabase(chave),
  });
  let resp = await ler('id,fazenda,de,ate,de_hora,ate_hora');
  if (!resp.ok && (await semColunaDeHora(resp))) resp = await ler('id,fazenda,de,ate');
  if (!resp.ok) {
    if (await semTabela(resp)) return [];
    await erroRest(resp, chave, 'a leitura dos pedidos de chuva');
  }
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas.filter((l) => Number.isFinite(Number(l?.id))) : [];
}

/** Grava a resposta de um pedido de chuva: 'ok' com os dados, ou 'erro: ...' sem dados. */
export async function responderPedidoChuva({ url, chave, fetch: fetchImpl = globalThis.fetch }, id, resultado, dados, agora = new Date()) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA_CHUVA}?atendido_em=is.null&id=eq.${Number(id)}`, {
    method: 'PATCH',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ atendido_em: agora.toISOString(), resultado: String(resultado).slice(0, 400), dados: dados ?? null }),
  });
  if (!resp.ok) await erroRest(resp, chave, 'a resposta do pedido de chuva');
}

/**
 * Uma verificação dos pedidos de chuva: para cada pendente, consulta a ZEUS (PICs da fazenda e a chuva de
 * cada um no período) e grava a resposta no próprio pedido. Devolve quantos foram atendidos (0 = nada a fazer).
 * Erro de um pedido vira o `resultado` dele e não impede os outros.
 */
export async function atenderPedidosChuva({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const pedidos = await pedidosChuvaPendentes(ctx);
  for (const p of pedidos) {
    try {
      const dados = await chuvaPorPicZeus({ url: agrovex.url, token: agrovex.token, fazenda: p.fazenda, de: p.de, ate: p.ate, deHora: p.de_hora ?? null, ateHora: p.ate_hora ?? null, fetchImpl });
      await responderPedidoChuva(ctx, p.id, 'ok', dados, agora());
      console.log(`== ${agora().toISOString()} chuva por PIC: ${dados.fazenda} ${dados.de} a ${dados.ate}, ${dados.pics.length} PICs.`);
    } catch (e) {
      const msg = semChave(semChave(e instanceof Error ? e.message : String(e), supabase.chave), agrovex.token);
      console.error(`Erro no pedido de chuva ${p.id}: ${msg}`);
      await responderPedidoChuva(ctx, p.id, `erro: ${msg}`, null, agora()).catch(() => undefined);
    }
  }
  if (pedidos.length) {
    const limite = new Date(agora().getTime() - GUARDAR_CHUVA_DIAS * 86_400_000).toISOString();
    await fetchImpl(`${supabase.url}/rest/v1/${TABELA_CHUVA}?atendido_em=lt.${encodeURIComponent(limite)}`, {
      method: 'DELETE',
      headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
    }).catch(() => undefined);
  }
  return pedidos.length;
}

// ---------- pedidos de boletins de atividades mecanizadas ("Buscar direto no PIMS" de Mecanizadas) ----------

const TABELA_MEC = 'mec_pims_pedidos';
const GUARDAR_MEC_DIAS = 3;
const MAX_MEC_POR_RODADA = 2;

/** Pedidos de boletins pendentes ({ id, unidade, de, ate }), do mais antigo para o mais novo; sem a tabela → []. */
export async function pedidosMecPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA_MEC}?select=id,unidade,de,ate&atendido_em=is.null&order=id.asc&limit=${MAX_MEC_POR_RODADA}`, {
    headers: cabecalhosSupabase(chave),
  });
  if (!resp.ok) {
    if (await semTabela(resp)) return [];
    await erroRest(resp, chave, 'a leitura dos pedidos de boletins');
  }
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas.filter((l) => Number.isFinite(Number(l?.id))) : [];
}

/** Grava a resposta de um pedido de boletins: 'ok' com os dados, ou 'erro: ...' sem dados. */
export async function responderPedidoMec({ url, chave, fetch: fetchImpl = globalThis.fetch }, id, resultado, dados, agora = new Date()) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA_MEC}?atendido_em=is.null&id=eq.${Number(id)}`, {
    method: 'PATCH',
    headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ atendido_em: agora.toISOString(), resultado: String(resultado).slice(0, 400), dados: dados ?? null }),
  });
  if (!resp.ok) await erroRest(resp, chave, 'a resposta do pedido de boletins');
}

/**
 * Uma verificação dos pedidos de boletins: para cada pendente, consulta o PIMS (lançamentos da unidade no
 * período, no formato do relatório exportado) e grava a resposta no próprio pedido. Devolve quantos foram
 * atendidos. Erro de um pedido vira o `resultado` dele e não impede os outros.
 */
export async function atenderPedidosMec({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const pedidos = await pedidosMecPendentes(ctx);
  for (const p of pedidos) {
    try {
      const dados = await boletinsMecanizadas({ url: agrovex.url, token: agrovex.token, unidade: p.unidade, de: p.de, ate: p.ate, fetchImpl });
      await responderPedidoMec(ctx, p.id, 'ok', dados, agora());
      console.log(`== ${agora().toISOString()} boletins mecanizadas: ${dados.unidade} ${dados.de} a ${dados.ate}, ${dados.linhas.length} linhas.`);
    } catch (e) {
      const msg = semChave(semChave(e instanceof Error ? e.message : String(e), supabase.chave), agrovex.token);
      console.error(`Erro no pedido de boletins ${p.id}: ${msg}`);
      await responderPedidoMec(ctx, p.id, `erro: ${msg}`, null, agora()).catch(() => undefined);
    }
  }
  if (pedidos.length) {
    // a resposta é grande (o relatório inteiro) e já foi para a tela: não fica guardada
    const limite = new Date(agora().getTime() - GUARDAR_MEC_DIAS * 86_400_000).toISOString();
    await fetchImpl(`${supabase.url}/rest/v1/${TABELA_MEC}?atendido_em=lt.${encodeURIComponent(limite)}`, {
      method: 'DELETE',
      headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
    }).catch(() => undefined);
  }
  return pedidos.length;
}

// ---------- último dia da ZEUS no banco (aviso ao lado de "Inserir dados via integração") ----------

const TABELA_SITUACAO_ZEUS = 'mapas_zeus_situacao';
/** a conferência vale por este tempo; depois, a próxima verificação consulta a ZEUS de novo */
export const SITUACAO_ZEUS_MINUTOS = 15;
/** só tenta nos minutos múltiplos deste: com o Agrovex fora do ar, não vira uma consulta a cada 30 s */
const SITUACAO_ZEUS_PASSO_MIN = 5;

/**
 * Mantém mapas_zeus_situacao em dia: o último dia com leitura de chuva de cada fazenda da ZEUS, para a tela
 * avisar até onde dá para puxar antes de alguém pedir um período que ainda não chegou. Roda junto da
 * verificação dos pedidos, mas só consulta a ZEUS quando a última conferência tem mais de 15 min.
 * Devolve 'recente', 'fora-do-passo', 'sem-tabela' (script 0004 não aplicado), 'vazio' ou 'ok'.
 */
export async function atualizarSituacaoZeus({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const resp = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_SITUACAO_ZEUS}?select=conferido_em&order=conferido_em.desc&limit=1`, {
    headers: cabecalhosSupabase(supabase.chave),
  });
  if (!resp.ok) {
    if (await semTabela(resp)) return 'sem-tabela';
    await erroRest(resp, supabase.chave, 'a leitura da situação da ZEUS');
  }
  const linhas = await resp.json();
  const momento = agora();
  const ultima = Array.isArray(linhas) && linhas[0]?.conferido_em ? Date.parse(linhas[0].conferido_em) : NaN;
  if (Number.isFinite(ultima) && momento.getTime() - ultima < SITUACAO_ZEUS_MINUTOS * 60_000) return 'recente';
  if (momento.getUTCMinutes() % SITUACAO_ZEUS_PASSO_MIN !== 0) return 'fora-do-passo';
  const novas = await ultimoDiaZeus({ url: agrovex.url, token: agrovex.token, fetchImpl, agora: momento });
  if (!novas.length) return 'vazio';
  const gravar = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_SITUACAO_ZEUS}?on_conflict=fazenda`, {
    method: 'POST',
    headers: { ...cabecalhosSupabase(supabase.chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(novas),
  });
  if (!gravar.ok) await erroRest(gravar, supabase.chave, 'a gravação da situação da ZEUS');
  console.log(`== ${momento.toISOString()} situação da ZEUS: ${novas.length} fazendas, dados até ${novas.reduce((m, l) => (l.ultimo_dia > m ? l.ultimo_dia : m), '')}.`);
  return 'ok';
}

// ---------- chuva por talhão (tabela chuva_talhao, módulo chuva/ do COA WEB) ----------

const TABELA_CHUVA_TALHAO = 'chuva_talhao';
/** a gravação vale por este tempo; depois, a próxima verificação consulta a ZEUS de novo */
export const CHUVA_TALHAO_MINUTOS = 30;

/**
 * Mantém chuva_talhao em dia: a chuva diária de cada talhão (stg_field_data da ZEUS), os ciclos do PIMS e a
 * chuva medida nos pluviômetros de cada fazenda. Roda junto da verificação dos pedidos, mas só consulta quando
 * a última gravação tem mais de 30 min. Devolve 'recente', 'fora-do-passo', 'sem-tabela' (script 0013 não
 * aplicado), 'sem-coluna' (script 0014 não aplicado), 'vazio' ou 'ok'.
 */
export async function atualizarChuvaTalhao({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const resp = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_CHUVA_TALHAO}?select=gerado_em&order=gerado_em.desc&limit=1`, {
    headers: cabecalhosSupabase(supabase.chave),
  });
  if (!resp.ok) {
    if (await semTabela(resp)) return 'sem-tabela';
    await erroRest(resp, supabase.chave, 'a leitura da chuva por talhão');
  }
  const linhas = await resp.json();
  const momento = agora();
  const ultima = Array.isArray(linhas) && linhas[0]?.gerado_em ? Date.parse(linhas[0].gerado_em) : NaN;
  if (Number.isFinite(ultima) && momento.getTime() - ultima < CHUVA_TALHAO_MINUTOS * 60_000) return 'recente';
  if (momento.getUTCMinutes() % SITUACAO_ZEUS_PASSO_MIN !== 0) return 'fora-do-passo';
  const novas = await sincronizarChuvaTalhao({ url: agrovex.url, token: agrovex.token, fetchImpl, agora: momento });
  if (!novas.length) return 'vazio';
  // uma fazenda por pedido: cada linha leva a chuva de todos os talhões e passa de 300 KB nas maiores
  for (const linha of novas) {
    const gravar = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_CHUVA_TALHAO}?on_conflict=unidade`, {
      method: 'POST',
      headers: { ...cabecalhosSupabase(supabase.chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([linha]),
    });
    if (gravar.ok) continue;
    const texto = await gravar.clone().text().catch(() => '');
    if (/PGRST204/.test(texto)) {
      console.warn('Chuva por talhão: faltam colunas em chuva_talhao (rode supabase/0014_chuva_talhao_field_data.sql no Supabase).');
      return 'sem-coluna';
    }
    await erroRest(gravar, supabase.chave, 'a gravação da chuva por talhão');
  }
  const limpeza = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_CHUVA_TALHAO}?gerado_em=lt.${encodeURIComponent(novas[0].gerado_em)}`, {
    method: 'DELETE',
    headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
  });
  if (!limpeza.ok) await erroRest(limpeza, supabase.chave, 'a limpeza da chuva por talhão');
  console.log(`== ${momento.toISOString()} chuva por talhão: ${novas.length} fazendas, ${novas.reduce((n, l) => n + Object.keys(l.talhoes).length, 0)} talhões, ${novas.reduce((n, l) => n + l.pics.length, 0)} pluviômetros.`);
  return 'ok';
}

// ---------- pedidos de "Atualizar" da Validação PIMS (tabela valid_pedidos) ----------

const TABELA_VALID = 'valid_pedidos';
const GUARDAR_VALID_DIAS = 7;

/**
 * Uma verificação dos pedidos de "Atualizar" da Validação PIMS: sem pendentes → false; com pendentes →
 * consulta o PIMS e o SAP, grava valid_pims e marca os pedidos ('ok' ou 'erro: ...'). Sem a tabela
 * (script 0007 não aplicado) → false, sem erro.
 */
export async function atenderPedidosValidacao({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const resp = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_VALID}?select=id&atendido_em=is.null&order=id.asc`, { headers: cabecalhosSupabase(supabase.chave) });
  if (!resp.ok) {
    if (await semTabela(resp)) return false;
    await erroRest(resp, supabase.chave, 'a leitura dos pedidos da validação');
  }
  const linhas = await resp.json();
  const ids = Array.isArray(linhas) ? linhas.map((l) => Number(l.id)).filter(Number.isFinite) : [];
  if (!ids.length) return false;
  const erro = await rodarValidacao({ agrovex, supabase, fetchImpl });
  const marca = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_VALID}?atendido_em=is.null&id=lte.${ids[ids.length - 1]}`, {
    method: 'PATCH',
    headers: { ...cabecalhosSupabase(supabase.chave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ atendido_em: agora().toISOString(), resultado: (erro ? `erro: ${erro}` : 'ok').slice(0, 300) }),
  });
  if (!marca.ok) await erroRest(marca, supabase.chave, 'a marcação dos pedidos da validação');
  const limite = new Date(agora().getTime() - GUARDAR_VALID_DIAS * 86_400_000).toISOString();
  await fetchImpl(`${ctx.url}/rest/v1/${TABELA_VALID}?atendido_em=lt.${encodeURIComponent(limite)}`, {
    method: 'DELETE',
    headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
  }).catch(() => undefined);
  return true;
}

async function main() {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(raiz, 'scripts', 'plantio.config.json'), 'utf8'));
  const token = process.env.AGROVEX_TOKEN?.trim();
  const url = process.env.SUPABASE_URL?.trim();
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!token || !url || !chave) throw new Error('Faltam AGROVEX_TOKEN, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.');
  const supabase = { url, chave };
  const agrovex = {
    url: process.env.AGROVEX_URL || config.url,
    token,
    safras: config.safras ?? 'auto',
    excluirPrefixos: config.excluirPrefixos ?? [],
  };
  // primeiro as consultas rápidas (chuva e boletins: quem pediu está esperando na tela); um erro nelas não impede o plantio
  let erroConsulta = null;
  for (const atender of [atenderPedidosChuva, atenderPedidosMec, atenderPedidosValidacao, atualizarSituacaoZeus, atualizarChuvaTalhao]) {
    try {
      await atender({ supabase, agrovex });
    } catch (e) {
      erroConsulta = erroConsulta ?? e;
    }
  }
  await atenderPedidos({ supabase, acompanhamento: config.acompanhamento !== false, agrovex });
  if (erroConsulta) throw erroConsulta;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`Erro ao atender os pedidos: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
