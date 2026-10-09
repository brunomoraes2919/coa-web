// Atende os pedidos do botão "Atualizar plantio" do módulo MAPAS (tabela mapas_plantio_pedidos).
// Roda no servidor (VM do Google Cloud) a cada ~30 s: sem pedido pendente, sai sem fazer nada; com
// pedido, roda a rotina do PIMS (a mesma de sincronizar-plantio.mjs), grava no Supabase e marca os
// pedidos pendentes como atendidos ('ok' ou 'erro: <mensagem curta>', nunca o texto que veio de fora).
// Na mesma verificação atende os pedidos de "Inserir dados via integração" do Mapa de Chuva (tabela
// mapas_chuva_pedidos): busca na ZEUS a chuva de cada PIC da fazenda no período e grava no pedido.
// E os pedidos de "Buscar direto no PIMS" de Mecanizadas (tabela mec_pims_pedidos): os boletins de
// atividades mecanizadas da unidade no período, no formato do relatório exportado do PIMS.
// Variáveis: AGROVEX_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (as mesmas da rotina horária).
//
// Freios (um usuário não pode fazer o servidor martelar o PIMS, o SAP ou a ZEUS):
//   * toda leitura de pedidos pendentes tem ordem e limite;
//   * "Atualizar plantio" e "Atualizar" da Validação: se a última rodada completa tem menos de 5 min, o
//     pedido é respondido 'ok' com os dados que já estão gravados, sem consultar de novo;
//   * chuva e boletins: por verificação, no máximo um pedido de cada usuário; quem tem mais de 5
//     pendentes recebe "muitos pedidos" nos que passam disso, sem consulta nenhuma;
//   * chuva e boletins: antes de consultar, o servidor confere se quem pediu pode ver a fazenda/unidade
//     (as mesmas regras das políticas de supabase/0018_seguranca_pedidos.sql); na dúvida, não atende.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boletinsMecanizadas, cabecalhosSupabase, chuvaPorPicZeus, conferirUrlAgrovex, gravarSupabase, rodarAcompanhamento, rodarValidacao, semChave, sincronizar, sincronizarChuvaTalhao, sincronizarLimitesZeus, ultimoDiaZeus, validarPedidoMec, validarPeriodoChuva } from './sincronizar-plantio.mjs';

const TABELA = 'mapas_plantio_pedidos';
/** pedidos atendidos há mais que isto são apagados (a tabela não cresce sem fim) */
const GUARDAR_DIAS = 30;
/** pedidos de "Atualizar" lidos por verificação (os demais ficam para a próxima, ~30 s depois) */
const MAX_PENDENTES_LIDOS = 500;
/** rodada completa mais nova que isto: o pedido de "Atualizar" é respondido com os dados já gravados */
export const RECENTE_MINUTOS = 5;

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

// ---------- o que vai para a tela quando um pedido falha ----------
// A coluna `resultado` é lida por quem pediu. Ela leva 'ok' ou 'erro: ' + um texto curto escolhido pelo TIPO
// da falha; o texto que veio de fora (erro do banco de origem, página do Cloudflare, resposta do Supabase)
// fica só no log do servidor, já sem a chave e sem o token.

/** Texto de cada tipo de falha (o que aparece na tela depois de "O servidor não conseguiu …: "). */
export const MENSAGENS_DE_ERRO = Object.freeze({
  fonte: 'A fonte de dados (PIMS, SAP ou ZEUS) está indisponível no momento. Tente de novo em alguns minutos.',
  tempo: 'A consulta à fonte de dados demorou demais e foi interrompida. Tente de novo em alguns minutos.',
  invalido: 'Pedido inválido.',
  interno: 'Erro interno do servidor do COA WEB. Se continuar, avise o administrador.',
});

/** Respostas prontas dos pedidos que o servidor recusa sem consultar nenhuma fonte. */
export const RESULTADOS = Object.freeze({
  semPermissaoUnidade: 'erro: Sem permissão para esta unidade.',
  semPermissaoFazenda: 'erro: Sem permissão para esta fazenda.',
  permissaoIndisponivel: 'erro: Não foi possível conferir a sua permissão agora. Tente de novo em alguns minutos.',
  muitosPedidos: 'erro: Há muitos pedidos seus aguardando. Espere os anteriores terminarem e tente de novo.',
});

/**
 * Tipo de uma falha: 'fonte' e 'invalido' vêm marcados por sincronizar-plantio.mjs (erroDoTipo); prazo
 * estourado ('TimeoutError'/'AbortError' do fetch) é 'tempo'; rede fora do ar ("fetch failed") é 'fonte';
 * todo o resto (inclusive o que ninguém previu, e qualquer coisa que não seja um Error) é 'interno'.
 */
export function tipoDoErro(e) {
  // a marca só vale num Error de verdade: um objeto qualquer (um JSON que veio de fora) não escolhe o tipo
  if (e instanceof Error && (e.tipo === 'fonte' || e.tipo === 'invalido')) return e.tipo;
  const nome = e !== null && typeof e === 'object' ? e.name : undefined;
  if (nome === 'TimeoutError' || nome === 'AbortError') return 'tempo';
  if (e instanceof TypeError && e.message === 'fetch failed') return 'fonte';
  return 'interno';
}

/**
 * O texto que pode ir para a tela. Só o erro 'invalido' leva a própria mensagem (é texto nosso: "Período
 * muito longo (70 dias)…"); os outros tipos levam o texto fixo de MENSAGENS_DE_ERRO.
 */
export function mensagemPublica(e) {
  const tipo = tipoDoErro(e);
  if (tipo !== 'invalido') return MENSAGENS_DE_ERRO[tipo];
  const texto = String(e.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return texto || MENSAGENS_DE_ERRO.invalido;
}

/** O erro inteiro, para o log do servidor: mensagem e detalhe, sem a chave do Supabase e sem o token do Agrovex. */
function detalheParaLog(e, supabase, agrovex) {
  const texto = e instanceof Error ? `${e.message}${typeof e.detalhe === 'string' && e.detalhe ? ` [${e.detalhe}]` : ''}` : String(e);
  return semChave(semChave(texto, supabase?.chave), agrovex?.token);
}

// ---------- última rodada completa (freio dos pedidos de "Atualizar") ----------

/** A tabela ainda não existe (script SQL não aplicado)? */
async function semTabela(resp) {
  if (resp.status !== 404 && resp.status !== 400) return false;
  const corpo = await resp.clone().json().catch(() => null);
  return corpo?.code === 'PGRST205' || corpo?.code === '42P01';
}

/**
 * Carimbo mais recente (ms) de uma tabela: `gerado_em` nas que a rotina regrava inteiras, com o mesmo carimbo
 * em todas as linhas. Devolve 'vazia', 'sem-tabela' ou null quando não deu para saber (erro, rede): quem
 * chama trata null como "não é recente" e roda a rotina, como sempre fez.
 */
async function ultimoCarimbo({ url, chave, fetch: fetchImpl = globalThis.fetch }, tabela, coluna = 'gerado_em') {
  try {
    const resp = await fetchImpl(`${url}/rest/v1/${tabela}?select=${coluna}&order=${coluna}.desc&limit=1`, { headers: cabecalhosSupabase(chave) });
    if (!resp.ok) return (await semTabela(resp)) ? 'sem-tabela' : null;
    const linhas = await resp.json();
    if (!Array.isArray(linhas)) return null;
    if (!linhas.length) return 'vazia';
    const ms = Date.parse(linhas[0]?.[coluna]);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** O carimbo tem menos de RECENTE_MINUTOS? (Um carimbo mais de 1 min no futuro é relógio errado: não vale.) */
function ehRecente(carimbo, momento) {
  if (typeof carimbo !== 'number') return false;
  const idade = momento.getTime() - carimbo;
  return idade > -60_000 && idade < RECENTE_MINUTOS * 60_000;
}

/** Ids dos pedidos pendentes, do mais antigo para o mais novo (no máximo MAX_PENDENTES_LIDOS por verificação). */
export async function pedidosPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA}?select=id&atendido_em=is.null&order=id.asc&limit=${MAX_PENDENTES_LIDOS}`, {
    headers: cabecalhosSupabase(chave),
  });
  if (!resp.ok) await erroRest(resp, chave, 'a leitura dos pedidos');
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas.map((l) => Number(l.id)).filter(Number.isFinite) : [];
}

/** Marca como atendidos os pendentes com id ≤ ateId (os que chegarem durante a rodada ficam para a próxima). */
export async function marcarAtendidos({ url, chave, fetch: fetchImpl = globalThis.fetch }, ateId, resultado, agora = new Date()) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA}?atendido_em=is.null&id=lte.${Number(ateId)}`, {
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
 * marca os pedidos; devolve true. Se o plantio (e o acompanhamento, quando ligado) foi gravado há menos de
 * RECENTE_MINUTOS, não consulta o PIMS de novo: os pedidos são marcados 'ok' e a tela relê o que já está
 * gravado. Um erro da rotina vira 'erro: <texto do tipo da falha>' nos pedidos (e é relançado, para o log).
 */
export async function atenderPedidos({ supabase, agrovex, acompanhamento = false, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const ids = await pedidosPendentes(ctx);
  if (!ids.length) return false;
  const ateId = ids[ids.length - 1];
  const momento = agora();
  let recente = ehRecente(await ultimoCarimbo(ctx, 'mapas_plantio_pims'), momento);
  if (recente && acompanhamento) {
    // o mesmo botão atualiza o Acompanhamento: ele também precisa estar em dia (sem a tabela, não conta)
    const acomp = await ultimoCarimbo(ctx, 'acomp_pims');
    recente = acomp === 'sem-tabela' || ehRecente(acomp, momento);
  }
  if (recente) {
    await marcarAtendidos(ctx, ateId, 'ok', momento);
    console.log(`== ${momento.toISOString()} ${ids.length} pedido(s) de plantio respondido(s) com os dados já gravados (rodada há menos de ${RECENTE_MINUTOS} min).`);
    await limparAntigos(ctx, momento).catch(() => undefined);
    return true;
  }
  try {
    const dados = await sincronizar({ ...agrovex, fetchImpl });
    await gravarSupabase(dados, ctx);
    // o mesmo botão atualiza o Acompanhamento Operacional (erro nele só vai para o log)
    if (acompanhamento) await rodarAcompanhamento({ agrovex, supabase, fetchImpl });
    await marcarAtendidos(ctx, ateId, 'ok', agora());
    console.log(`== ${agora().toISOString()} ${ids.length} pedido(s) atendido(s); plantio geradoEm ${dados.geradoEm}.`);
  } catch (e) {
    await marcarAtendidos(ctx, ateId, `erro: ${mensagemPublica(e)}`, agora()).catch(() => undefined);
    throw e;
  }
  await limparAntigos(ctx, agora()).catch(() => undefined);
  return true;
}

// ---------- fila dos pedidos com parâmetros (chuva e boletins): um por usuário, sem acúmulo ----------

/** pedidos pendentes lidos por verificação nas filas de chuva e de boletins */
const FILA_LIDA = 200;
/** pendentes que um usuário pode ter; os que passam disso são respondidos com "muitos pedidos" */
export const MAX_PENDENTES_POR_USUARIO = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v) => typeof v === 'string' && UUID.test(v);

/**
 * Decide o que fazer com os pendentes de uma fila nesta verificação (função pura):
 *   atender — o pedido mais antigo de cada usuário, do mais antigo para o mais novo, no máximo `porRodada`;
 *   excesso — de quem tem mais de `maxPorUsuario` pendentes, os que passam disso: { pedidoPor, depoisDoId, ids }
 *             (são respondidos com "muitos pedidos", sem consulta nenhuma).
 * Os outros pendentes do usuário ficam para as próximas verificações, um por vez. Pedido sem dono legível
 * (não acontece no banco: a coluna é obrigatória) entra num grupo só, com pedidoPor null.
 */
export function planejarFila(pendentes, { porRodada, maxPorUsuario = MAX_PENDENTES_POR_USUARIO }) {
  const grupos = new Map();
  const ordenados = (Array.isArray(pendentes) ? pendentes : [])
    .filter((p) => Number.isFinite(Number(p?.id)))
    .sort((a, b) => Number(a.id) - Number(b.id));
  for (const p of ordenados) {
    const dono = ehUuid(p.pedido_por) ? p.pedido_por.toLowerCase() : '';
    if (!grupos.has(dono)) grupos.set(dono, []);
    grupos.get(dono).push(p);
  }
  const primeiros = [];
  const excesso = [];
  for (const [dono, lista] of grupos) {
    primeiros.push(lista[0]);
    if (lista.length > maxPorUsuario) {
      excesso.push({ pedidoPor: dono || null, depoisDoId: Number(lista[maxPorUsuario - 1].id), ids: lista.slice(maxPorUsuario).map((p) => Number(p.id)) });
    }
  }
  primeiros.sort((a, b) => Number(a.id) - Number(b.id));
  return { atender: primeiros.slice(0, Math.max(1, Math.floor(porRodada))), excesso };
}

/**
 * Responde "muitos pedidos" ao excesso de cada usuário, num pedido só ao Supabase por usuário: todos os
 * pendentes dele depois do último que pode ficar (mesmo os que não couberam na leitura). Melhor esforço:
 * uma falha aqui só vai para o log, e a verificação seguinte tenta de novo.
 */
async function recusarExcesso({ url, chave, fetch: fetchImpl = globalThis.fetch }, tabela, excesso, quando) {
  for (const x of excesso) {
    const filtro = x.pedidoPor
      ? `pedido_por=eq.${x.pedidoPor}&id=gt.${Number(x.depoisDoId)}`
      : `id=in.(${x.ids.map((i) => Number(i)).filter(Number.isFinite).join(',')})`;
    try {
      const resp = await fetchImpl(`${url}/rest/v1/${tabela}?atendido_em=is.null&${filtro}`, {
        method: 'PATCH',
        headers: { ...cabecalhosSupabase(chave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ atendido_em: quando.toISOString(), resultado: RESULTADOS.muitosPedidos, dados: null }),
      });
      if (!resp.ok) await erroRest(resp, chave, 'a resposta dos pedidos em excesso');
      console.warn(`== ${quando.toISOString()} ${tabela}: um usuário tinha mais de ${MAX_PENDENTES_POR_USUARIO} pedidos pendentes; o excesso foi respondido sem consulta.`);
    } catch (e) {
      console.error(`Erro ao responder os pedidos em excesso de ${tabela}: ${semChave(e instanceof Error ? e.message : String(e), chave)}`);
    }
  }
}

// ---------- quem pediu pode ver esta unidade / fazenda? ----------
// A regra principal é a do banco: as políticas de inserção de mec_pims_pedidos e mapas_chuva_pedidos em
// supabase/0018_seguranca_pedidos.sql. Aqui o servidor confere de novo antes de gastar uma consulta, com as
// MESMAS regras (se uma mudar lá, tem de mudar aqui):
//   boletins  tem_categoria('mecanizadas') e existe fazenda do COA WEB f com tem_acesso_fazenda(f.id) e
//             mec_unidade_da_fazenda(f.nome) = unidade do pedido                       (função mec_pode_pedir)
//   chuva     tem_categoria('mapas') e existe fazenda de mapa f com left(trim(f.nome), 80) = fazenda do
//             pedido e mapas_pode_ver(f.coa_fazenda_id)
// onde (supabase/0002_administrador_mais.sql):
//   admin_ve_tudo()          perfil 'admin' e (super ou todas_fazendas)
//   tem_acesso_fazenda(id)   admin_ve_tudo() ou a fazenda em usuario_fazendas
//   tem_categoria(c)         ADMINISTRADOR+ (tem todas) ou a linha em usuario_categorias
//   mapas_pode_ver(coa_id)   admin_ve_tudo() ou (coa_id não nulo, tem perfil e a fazenda em usuario_fazendas)
// mec_unidade_da_fazenda é, no banco, a cópia de unidadePimsDaFazenda do index.html; a daqui é a outra cópia.
// (mapas_eh_usuario(), que as duas políticas também pedem, já está contido nestas condições.)

/** Mesma limpeza de texto de normalizarTextoMec (index.html). */
function normalizarTextoMec(s) {
  return String(s === null || s === undefined ? '' : s)
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[°ºª]/g, 'O')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Unidade do PIMS (como o relatório escreve) de uma fazenda do COA WEB: a mesma regra de unidadePimsDaFazenda (index.html). */
export function unidadePimsDaFazenda(nomeFazenda) {
  const nome = normalizarTextoMec(nomeFazenda);
  if (nome.includes('NEBRASKA')) return 'NEBRASKA';
  if (nome.includes('GLOBO')) return 'GLOBO';
  if (nome.includes('GUAPIRAMA')) return 'GUAPIRAMA';
  if (nome.includes('SIRIEMA')) return 'SIRIEMA';
  if (nome.includes('DOURADO')) return 'DOURADO';
  if (nome.includes('SM3')) return 'SM3';
  if (nome.includes('TRES FLECHAS') || nome.includes('T. FLECHAS')) return 'T. FLECHAS';
  return null;
}

/** Id numérico de uma linha do banco (bigint vem como número ou texto); o que não for número vira null. */
function idNumerico(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** O nome da fazenda de mapa como a tela o grava no pedido de chuva, e como o banco o compara: sem espaços nas pontas, até 80 caracteres. */
const nomeNoPedido = (s) => String(s === null || s === undefined ? '' : s).trim().slice(0, 80);

/**
 * Quem pediu pode ver o alvo do pedido? Função pura: recebe as linhas já lidas do banco e devolve
 * { permitido, motivo } (o motivo é só para o log do servidor; a tela recebe um texto genérico).
 *   tipo 'mecanizadas' — alvo = unidade do PIMS como está no pedido ('T. FLECHAS'). Precisa da categoria
 *     Mecanizadas e de uma fazenda do COA WEB que ele possa ver cujo nome leve EXATAMENTE a essa unidade
 *     (como no banco: sem ajeitar maiúsculas nem espaços). Unidade que nenhuma fazenda cadastrada tem é
 *     recusada para todos.
 *   tipo 'chuva' — alvo = nome da fazenda de mapa como está no pedido. Precisa da categoria Mapas e de uma
 *     fazenda de mapa com EXATAMENTE esse nome que ele possa ver: quem vê tudo vê qualquer uma; os demais, só
 *     a que está ligada a uma fazenda do COA WEB liberada para ele. Nome que nenhuma fazenda de mapa tem é
 *     recusado para todos.
 * O ADMINISTRADOR+ tem todas as categorias. Sem linha em `perfis`, ou com dado que não dê para ler, é não.
 */
export function decidirPermissao({ tipo, alvo, perfil, fazendasDoUsuario = [], categorias = [], fazendas = [], mapasFazendas = [] }) {
  const nega = (motivo) => ({ permitido: false, motivo });
  const permite = { permitido: true, motivo: 'ok' };
  if (perfil === null || typeof perfil !== 'object') return nega('sem-perfil');
  const admin = perfil.perfil === 'admin';
  const adminMais = admin && perfil.super === true;
  const veTudo = admin && (perfil.super === true || perfil.todas_fazendas === true);
  const temCategoria = (categoria) => adminMais || (Array.isArray(categorias) && categorias.some((c) => c?.categoria === categoria));
  const liberadas = new Set();
  for (const l of Array.isArray(fazendasDoUsuario) ? fazendasDoUsuario : []) {
    const id = idNumerico(l?.fazenda_id);
    if (id !== null) liberadas.add(id);
  }
  const liberada = (v) => {
    const id = idNumerico(v);
    return id !== null && liberadas.has(id);
  };
  const pedido = typeof alvo === 'string' ? alvo : '';

  if (tipo === 'mecanizadas') {
    if (!temCategoria('mecanizadas')) return nega('sem-categoria');
    if (!pedido) return nega('sem-alvo');
    const daUnidade = (Array.isArray(fazendas) ? fazendas : []).filter((f) => unidadePimsDaFazenda(f?.nome) === pedido);
    if (!daUnidade.length) return nega('unidade-desconhecida');
    return veTudo || daUnidade.some((f) => liberada(f?.id)) ? permite : nega('sem-fazenda');
  }

  if (tipo === 'chuva') {
    if (!temCategoria('mapas')) return nega('sem-categoria');
    if (!pedido) return nega('sem-alvo');
    const comEsseNome = (Array.isArray(mapasFazendas) ? mapasFazendas : []).filter((f) => typeof f?.nome === 'string' && nomeNoPedido(f.nome) === pedido);
    if (!comEsseNome.length) return nega('fazenda-desconhecida');
    return veTudo || comEsseNome.some((f) => liberada(f?.coa_fazenda_id)) ? permite : nega('sem-fazenda');
  }

  return nega('tipo-desconhecido');
}

/**
 * Lê do Supabase (chave de serviço) o que decidirPermissao precisa sobre quem fez o pedido. Qualquer falha
 * (rede, coluna ou tabela que falta, resposta fora do formato) LANÇA: quem chama recusa o pedido em vez de
 * atender sem saber. `memo` guarda, dentro de uma verificação, as tabelas que não dependem do usuário.
 */
export async function lerPermissao({ url, chave, fetch: fetchImpl = globalThis.fetch }, tipo, pedidoPor, memo = new Map()) {
  // sem dono legível não há o que consultar: decidirPermissao recusa por falta de perfil
  if (!ehUuid(pedidoPor)) return { perfil: null, fazendasDoUsuario: [], categorias: [], fazendas: [], mapasFazendas: [] };
  const ler = async (caminho, acao) => {
    const resp = await fetchImpl(`${url}/rest/v1/${caminho}`, { headers: cabecalhosSupabase(chave) });
    if (!resp.ok) await erroRest(resp, chave, acao);
    const linhas = await resp.json();
    if (!Array.isArray(linhas)) throw new Error(`Supabase devolveu resposta fora do formato (${acao}).`);
    return linhas;
  };
  const comMemo = async (caminho, acao) => {
    if (!memo.has(caminho)) memo.set(caminho, await ler(caminho, acao));
    return memo.get(caminho);
  };
  const id = pedidoPor.toLowerCase();
  const perfis = await ler(`perfis?select=id,perfil,super,todas_fazendas&id=eq.${id}&limit=1`, 'a leitura do perfil de quem pediu');
  const fazendasDoUsuario = await ler(`usuario_fazendas?select=fazenda_id&usuario_id=eq.${id}&order=fazenda_id.asc&limit=1000`, 'a leitura das fazendas de quem pediu');
  const categorias = await ler(`usuario_categorias?select=categoria&usuario_id=eq.${id}&order=categoria.asc&limit=50`, 'a leitura das categorias de quem pediu');
  const dados = { perfil: perfis[0] ?? null, fazendasDoUsuario, categorias, fazendas: [], mapasFazendas: [] };
  if (tipo === 'mecanizadas') {
    dados.fazendas = await comMemo('fazendas?select=id,nome&order=id.asc&limit=1000', 'a leitura das fazendas do COA WEB');
  } else {
    dados.mapasFazendas = await comMemo('mapas_fazendas?select=id,nome,coa_fazenda_id&order=id.asc&limit=1000', 'a leitura das fazendas de mapa');
  }
  return dados;
}

/**
 * Confere a permissão de um pedido. Devolve null (pode atender) ou o `resultado` da recusa. Falha na
 * conferência também recusa: o pedido não é atendido sem o servidor saber quem pode vê-lo.
 */
async function recusaPorPermissao(ctx, tipo, pedido, alvo, memo, rotulo) {
  let decisao;
  try {
    decisao = decidirPermissao({ tipo, alvo, ...(await lerPermissao(ctx, tipo, pedido.pedido_por, memo)) });
  } catch (e) {
    console.error(`${rotulo} ${pedido.id}: não foi possível conferir a permissão (pedido recusado): ${semChave(e instanceof Error ? e.message : String(e), ctx.chave)}`);
    return RESULTADOS.permissaoIndisponivel;
  }
  if (decisao.permitido) return null;
  console.warn(`${rotulo} ${pedido.id}: recusado, quem pediu não pode ver ${tipo === 'chuva' ? 'a fazenda' : 'a unidade'} (${decisao.motivo}).`);
  return tipo === 'chuva' ? RESULTADOS.semPermissaoFazenda : RESULTADOS.semPermissaoUnidade;
}

// ---------- pedidos de chuva por PIC ("Inserir dados via integração" do Mapa de Chuva) ----------

const TABELA_CHUVA = 'mapas_chuva_pedidos';
/** pedidos de chuva atendidos há mais que isto são apagados (o resultado já foi para o mapa) */
const GUARDAR_CHUVA_DIAS = 7;
/** pedidos atendidos por verificação (os demais ficam para a próxima, ~30 s depois) */
const MAX_CHUVA_POR_RODADA = 5;

/** O banco ainda não tem as colunas de hora do pedido (script 0004_situacao_zeus.sql não aplicado)? */
async function semColunaDeHora(resp) {
  if (resp.status !== 400) return false;
  const corpo = await resp.clone().json().catch(() => null);
  return corpo?.code === '42703';
}

/**
 * Pedidos de chuva pendentes ({ id, pedido_por, fazenda, de, ate, de_hora, ate_hora }), do mais antigo para
 * o mais novo, no máximo FILA_LIDA; sem a tabela → []. Num banco sem as colunas de hora, lê só as datas (os
 * pedidos por data seguem funcionando). Quem decide quais são atendidos nesta verificação é planejarFila.
 */
export async function pedidosChuvaPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const ler = (colunas) => fetchImpl(`${url}/rest/v1/${TABELA_CHUVA}?select=${colunas}&atendido_em=is.null&order=id.asc&limit=${FILA_LIDA}`, {
    headers: cabecalhosSupabase(chave),
  });
  let resp = await ler('id,pedido_por,fazenda,de,ate,de_hora,ate_hora');
  if (!resp.ok && (await semColunaDeHora(resp))) resp = await ler('id,pedido_por,fazenda,de,ate');
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
 * Uma verificação dos pedidos de chuva: de cada usuário, o pedido mais antigo (planejarFila). Para cada um,
 * confere o período, confere se quem pediu pode ver a fazenda e só então consulta a ZEUS (PICs da fazenda e
 * a chuva de cada um no período), gravando a resposta no próprio pedido. Devolve quantos foram respondidos
 * (0 = nada a fazer). Erro de um pedido vira o `resultado` dele e não impede os outros.
 */
export async function atenderPedidosChuva({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const pendentes = await pedidosChuvaPendentes(ctx);
  if (!pendentes.length) return 0;
  const plano = planejarFila(pendentes, { porRodada: MAX_CHUVA_POR_RODADA });
  await recusarExcesso(ctx, TABELA_CHUVA, plano.excesso, agora());
  const memo = new Map();
  for (const p of plano.atender) {
    try {
      // 1. o pedido faz sentido? (sem consultar nada)  2. quem pediu pode ver a fazenda?  3. a ZEUS
      validarPeriodoChuva(p.de, p.ate, p.de_hora ?? null, p.ate_hora ?? null);
      const recusa = await recusaPorPermissao(ctx, 'chuva', p, p.fazenda, memo, 'Pedido de chuva');
      if (recusa) {
        await responderPedidoChuva(ctx, p.id, recusa, null, agora());
        continue;
      }
      const dados = await chuvaPorPicZeus({ url: agrovex.url, token: agrovex.token, fazenda: p.fazenda, de: p.de, ate: p.ate, deHora: p.de_hora ?? null, ateHora: p.ate_hora ?? null, fetchImpl });
      await responderPedidoChuva(ctx, p.id, 'ok', dados, agora());
      console.log(`== ${agora().toISOString()} chuva por PIC: ${dados.fazenda} ${dados.de} a ${dados.ate}, ${dados.pics.length} PICs.`);
    } catch (e) {
      console.error(`Erro no pedido de chuva ${p.id}: ${detalheParaLog(e, supabase, agrovex)}`);
      await responderPedidoChuva(ctx, p.id, `erro: ${mensagemPublica(e)}`, null, agora()).catch(() => undefined);
    }
  }
  const limite = new Date(agora().getTime() - GUARDAR_CHUVA_DIAS * 86_400_000).toISOString();
  await fetchImpl(`${supabase.url}/rest/v1/${TABELA_CHUVA}?atendido_em=lt.${encodeURIComponent(limite)}`, {
    method: 'DELETE',
    headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
  }).catch(() => undefined);
  return plano.atender.length;
}

// ---------- pedidos de boletins de atividades mecanizadas ("Buscar direto no PIMS" de Mecanizadas) ----------

const TABELA_MEC = 'mec_pims_pedidos';
const GUARDAR_MEC_DIAS = 3;
const MAX_MEC_POR_RODADA = 2;

/**
 * Pedidos de boletins pendentes ({ id, pedido_por, unidade, de, ate }), do mais antigo para o mais novo, no
 * máximo FILA_LIDA; sem a tabela → []. Quem decide quais são atendidos nesta verificação é planejarFila.
 */
export async function pedidosMecPendentes({ url, chave, fetch: fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`${url}/rest/v1/${TABELA_MEC}?select=id,pedido_por,unidade,de,ate&atendido_em=is.null&order=id.asc&limit=${FILA_LIDA}`, {
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
 * Uma verificação dos pedidos de boletins: de cada usuário, o pedido mais antigo (planejarFila). Para cada
 * um, confere a unidade e o período, confere se quem pediu pode ver a unidade e só então consulta o PIMS
 * (lançamentos da unidade no período, no formato do relatório exportado), gravando a resposta no próprio
 * pedido. Devolve quantos foram respondidos. Erro de um pedido vira o `resultado` dele e não impede os outros.
 */
export async function atenderPedidosMec({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const pendentes = await pedidosMecPendentes(ctx);
  if (!pendentes.length) return 0;
  const plano = planejarFila(pendentes, { porRodada: MAX_MEC_POR_RODADA });
  await recusarExcesso(ctx, TABELA_MEC, plano.excesso, agora());
  const memo = new Map();
  for (const p of plano.atender) {
    try {
      // 1. o pedido faz sentido? (sem consultar nada)  2. quem pediu pode ver a unidade?  3. o PIMS
      validarPedidoMec(p.unidade, p.de, p.ate);
      const recusa = await recusaPorPermissao(ctx, 'mecanizadas', p, p.unidade, memo, 'Pedido de boletins');
      if (recusa) {
        await responderPedidoMec(ctx, p.id, recusa, null, agora());
        continue;
      }
      const dados = await boletinsMecanizadas({ url: agrovex.url, token: agrovex.token, unidade: p.unidade, de: p.de, ate: p.ate, fetchImpl });
      await responderPedidoMec(ctx, p.id, 'ok', dados, agora());
      console.log(`== ${agora().toISOString()} boletins mecanizadas: ${dados.unidade} ${dados.de} a ${dados.ate}, ${dados.linhas.length} linhas.`);
    } catch (e) {
      console.error(`Erro no pedido de boletins ${p.id}: ${detalheParaLog(e, supabase, agrovex)}`);
      await responderPedidoMec(ctx, p.id, `erro: ${mensagemPublica(e)}`, null, agora()).catch(() => undefined);
    }
  }
  // a resposta é grande (o relatório inteiro) e já foi para a tela: não fica guardada
  const limite = new Date(agora().getTime() - GUARDAR_MEC_DIAS * 86_400_000).toISOString();
  await fetchImpl(`${supabase.url}/rest/v1/${TABELA_MEC}?atendido_em=lt.${encodeURIComponent(limite)}`, {
    method: 'DELETE',
    headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
  }).catch(() => undefined);
  return plano.atender.length;
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

// ---------- limites dos talhões da ZEUS (tabela chuva_limites_zeus, opção "Talhões da ZEUS" da Chuva por talhão) ----------

const TABELA_LIMITES_ZEUS = 'chuva_limites_zeus';
/** os limites quase não mudam: uma leitura do datalake por dia basta */
export const LIMITES_ZEUS_HORAS = 24;

/**
 * Mantém chuva_limites_zeus em dia: o contorno dos talhões da ZEUS (datalake) das fazendas que têm chuva por
 * talhão. Só consulta quando a última gravação tem mais de 24 h. Devolve 'recente', 'fora-do-passo',
 * 'sem-tabela' (script 0016 não aplicado), 'vazio' ou 'ok'.
 */
export async function atualizarLimitesZeus({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const resp = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_LIMITES_ZEUS}?select=gerado_em&order=gerado_em.desc&limit=1`, {
    headers: cabecalhosSupabase(supabase.chave),
  });
  if (!resp.ok) {
    if (await semTabela(resp)) return 'sem-tabela';
    await erroRest(resp, supabase.chave, 'a leitura dos limites da ZEUS');
  }
  const linhas = await resp.json();
  const momento = agora();
  const ultima = Array.isArray(linhas) && linhas[0]?.gerado_em ? Date.parse(linhas[0].gerado_em) : NaN;
  if (Number.isFinite(ultima) && momento.getTime() - ultima < LIMITES_ZEUS_HORAS * 3_600_000) return 'recente';
  if (momento.getUTCMinutes() % SITUACAO_ZEUS_PASSO_MIN !== 0) return 'fora-do-passo';
  const novas = await sincronizarLimitesZeus({ url: agrovex.url, token: agrovex.token, fetchImpl, agora: momento });
  if (!novas.length) return 'vazio';
  // uma fazenda por pedido: cada linha leva o contorno de todos os talhões
  for (const linha of novas) {
    const gravar = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_LIMITES_ZEUS}?on_conflict=unidade`, {
      method: 'POST',
      headers: { ...cabecalhosSupabase(supabase.chave), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([linha]),
    });
    if (!gravar.ok) await erroRest(gravar, supabase.chave, 'a gravação dos limites da ZEUS');
  }
  const limpeza = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_LIMITES_ZEUS}?gerado_em=lt.${encodeURIComponent(novas[0].gerado_em)}`, {
    method: 'DELETE',
    headers: { ...cabecalhosSupabase(supabase.chave), Prefer: 'return=minimal' },
  });
  if (!limpeza.ok) await erroRest(limpeza, supabase.chave, 'a limpeza dos limites da ZEUS');
  console.log(`== ${momento.toISOString()} limites da ZEUS: ${novas.length} fazendas, ${novas.reduce((n, l) => n + l.talhoes.length, 0)} talhões.`);
  return 'ok';
}

// ---------- pedidos de "Atualizar" da Validação PIMS (tabela valid_pedidos) ----------

const TABELA_VALID = 'valid_pedidos';
const GUARDAR_VALID_DIAS = 7;

/**
 * Uma verificação dos pedidos de "Atualizar" da Validação PIMS: sem pendentes → false; com pendentes →
 * consulta o PIMS e o SAP, grava valid_pims e marca os pedidos ('ok' ou 'erro: <texto do tipo da falha>').
 * Se valid_pims foi gravada há menos de RECENTE_MINUTOS e nenhum vínculo de depósito mudou depois dela, não
 * consulta de novo: os pedidos são marcados 'ok' e a tela relê o que já está gravado. Sem a tabela (script
 * 0007 não aplicado) → false, sem erro.
 */
export async function atenderPedidosValidacao({ supabase, agrovex, fetch: fetchImpl = globalThis.fetch, agora = () => new Date() }) {
  const ctx = { ...supabase, fetch: fetchImpl };
  const resp = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_VALID}?select=id&atendido_em=is.null&order=id.asc&limit=${MAX_PENDENTES_LIDOS}`, { headers: cabecalhosSupabase(supabase.chave) });
  if (!resp.ok) {
    if (await semTabela(resp)) return false;
    await erroRest(resp, supabase.chave, 'a leitura dos pedidos da validação');
  }
  const linhas = await resp.json();
  const ids = Array.isArray(linhas) ? linhas.map((l) => Number(l.id)).filter(Number.isFinite) : [];
  if (!ids.length) return false;

  const momento = agora();
  const ultima = await ultimoCarimbo(ctx, 'valid_pims');
  let recente = ehRecente(ultima, momento);
  if (recente) {
    // vínculo de depósito salvo depois da rodada ("O saldo entra na próxima atualização"): roda de novo.
    // Sem conseguir saber (null), também roda.
    const vinculo = await ultimoCarimbo(ctx, 'valid_vinculos', 'atualizado_em');
    if (vinculo === null || (typeof vinculo === 'number' && vinculo > ultima)) recente = false;
  }
  let resultado = 'ok';
  if (recente) {
    console.log(`== ${momento.toISOString()} ${ids.length} pedido(s) da validação respondido(s) com os dados já gravados (rodada há menos de ${RECENTE_MINUTOS} min).`);
  } else {
    let erroDaRodada = null;
    const erro = await rodarValidacao({ agrovex, supabase, fetchImpl, aoErro: (e) => { erroDaRodada = e; } });
    // o texto de `erro` já foi para o log; o pedido leva só o texto do tipo da falha
    if (erro) resultado = `erro: ${erroDaRodada === null ? MENSAGENS_DE_ERRO.interno : mensagemPublica(erroDaRodada)}`;
  }
  const marca = await fetchImpl(`${supabase.url}/rest/v1/${TABELA_VALID}?atendido_em=is.null&id=lte.${ids[ids.length - 1]}`, {
    method: 'PATCH',
    headers: { ...cabecalhosSupabase(supabase.chave), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ atendido_em: agora().toISOString(), resultado: resultado.slice(0, 300) }),
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
    // conferido antes de qualquer chamada: o token só sai para o host do Agrovex (o endereço vem de arquivo baixado)
    url: conferirUrlAgrovex(process.env.AGROVEX_URL || config.url),
    token,
    safras: config.safras ?? 'auto',
    excluirPrefixos: config.excluirPrefixos ?? [],
  };
  // primeiro as consultas rápidas (chuva e boletins: quem pediu está esperando na tela); um erro nelas não impede o plantio
  let erroConsulta = null;
  for (const atender of [atenderPedidosChuva, atenderPedidosMec, atenderPedidosValidacao, atualizarSituacaoZeus, atualizarChuvaTalhao, atualizarLimitesZeus]) {
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
    // o texto de um erro pode repetir o que o outro lado devolveu: a chave e o token saem antes de ir para o log
    const msg = semChave(semChave(e instanceof Error ? e.message : String(e), process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()), process.env.AGROVEX_TOKEN?.trim());
    console.error(`Erro ao atender os pedidos: ${msg}`);
    process.exitCode = 1;
  });
}
