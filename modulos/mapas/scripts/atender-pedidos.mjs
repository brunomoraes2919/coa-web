// Atende os pedidos do botão "Atualizar plantio" do módulo MAPAS (tabela mapas_plantio_pedidos).
// Roda no servidor (VM do Google Cloud) a cada ~30 s: sem pedido pendente, sai sem fazer nada; com
// pedido, roda a rotina do PIMS (a mesma de sincronizar-plantio.mjs), grava no Supabase e marca os
// pedidos pendentes como atendidos ('ok' ou a mensagem de erro, sem segredos).
// Na mesma verificação atende os pedidos de "Inserir dados via integração" do Mapa de Chuva (tabela
// mapas_chuva_pedidos): busca na ZEUS a chuva de cada PIC da fazenda no período e grava no pedido.
// Variáveis: AGROVEX_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (as mesmas da rotina horária).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cabecalhosSupabase, chuvaPorPicZeus, gravarSupabase, rodarAcompanhamento, semChave, sincronizar } from './sincronizar-plantio.mjs';

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

/** Pedidos de chuva pendentes ({ id, fazenda, de, ate }), do mais antigo para o mais novo; sem a tabela → []. */
export async function pedidosChuvaPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA_CHUVA}?select=id,fazenda,de,ate&atendido_em=is.null&order=id.asc&limit=${MAX_CHUVA_POR_RODADA}`, {
    headers: cabecalhosSupabase(chave),
  });
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
      const dados = await chuvaPorPicZeus({ url: agrovex.url, token: agrovex.token, fazenda: p.fazenda, de: p.de, ate: p.ate, fetchImpl });
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
  // a chuva primeiro (resposta em segundos; quem pediu está esperando na tela); um erro nela não impede o plantio
  let erroChuva = null;
  try {
    await atenderPedidosChuva({ supabase, agrovex });
  } catch (e) {
    erroChuva = e;
  }
  await atenderPedidos({ supabase, acompanhamento: config.acompanhamento !== false, agrovex });
  if (erroChuva) throw erroChuva;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`Erro ao atender os pedidos: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
