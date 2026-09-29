// Atende os pedidos do botão "Atualizar plantio" do módulo MAPAS (tabela mapas_plantio_pedidos).
// Roda no servidor (VM do Google Cloud) a cada ~30 s: sem pedido pendente, sai sem fazer nada; com
// pedido, roda a rotina do PIMS (a mesma de sincronizar-plantio.mjs), grava no Supabase e marca os
// pedidos pendentes como atendidos ('ok' ou a mensagem de erro, sem segredos).
// Variáveis: AGROVEX_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (as mesmas da rotina horária).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cabecalhosSupabase, gravarSupabase, semChave, sincronizar } from './sincronizar-plantio.mjs';

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
export async function atenderPedidos({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const ids = await pedidosPendentes(ctx);
  if (!ids.length) return false;
  const ateId = ids[ids.length - 1];
  try {
    const dados = await sincronizar({ ...agrovex, fetchImpl });
    await gravarSupabase(dados, ctx);
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

async function main() {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(raiz, 'scripts', 'plantio.config.json'), 'utf8'));
  const token = process.env.AGROVEX_TOKEN?.trim();
  const url = process.env.SUPABASE_URL?.trim();
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!token || !url || !chave) throw new Error('Faltam AGROVEX_TOKEN, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.');
  await atenderPedidos({
    supabase: { url, chave },
    agrovex: {
      url: process.env.AGROVEX_URL || config.url,
      token,
      safras: config.safras ?? 'auto',
      excluirPrefixos: config.excluirPrefixos ?? [],
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`Erro ao atender os pedidos de plantio: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
