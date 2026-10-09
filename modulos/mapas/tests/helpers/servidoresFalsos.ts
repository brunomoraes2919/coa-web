// Supabase e Agrovex falsos para os testes do servidor (scripts/atender-pedidos.mjs): o Supabase responde
// por TABELA (com os filtros `coluna=eq.valor` da consulta), e o Agrovex (MCP) devolve uma consulta por vez.
// Nada aqui tem cara de chave de verdade: a "chave" e o "token" são textos inventados.

export interface Chamada { url: string; init?: RequestInit }

export const URL_SB = 'https://proj.supabase.co';
export const URL_AGROVEX = 'https://agrovex.test/mcp';
export const CHAVE = ['chave', 'de', 'servico', 'inventada', 'para', 'teste'].join('-');
export const TOKEN = ['token', 'do', 'agrovex', 'inventado'].join('-');

/** linhas de uma tabela, ou a resposta de erro que o Supabase daria para ela */
export type TabelaFalsa = Record<string, unknown>[] | { status: number; corpo: unknown };
/** resultado de uma consulta ao Agrovex: { columns, rows } ou { erro } (a ferramenta devolve isError com esse texto) */
export type ConsultaFalsa = { columns: string[]; rows: unknown[][] } | { erro: string };

const json = (corpo: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** aplica os filtros `coluna=eq.valor` e o `limit` da consulta (o resto — select, order, is.null — não muda as linhas aqui) */
function filtrar(linhas: Record<string, unknown>[], url: string): Record<string, unknown>[] {
  const consulta = new URL(url).searchParams;
  let saida = linhas;
  for (const [coluna, valor] of consulta) {
    if (!valor.startsWith('eq.')) continue;
    saida = saida.filter((l) => String(l[coluna]).toLowerCase() === valor.slice(3).toLowerCase());
  }
  const limite = Number(consulta.get('limit'));
  return Number.isFinite(limite) && limite > 0 ? saida.slice(0, limite) : saida;
}

/**
 * `tabelas`: o que cada tabela do Supabase devolve num GET (tabela que não está aqui = não existe no banco).
 * `consultas`: o que o Agrovex devolve a cada execute_query, na ordem. `agrovexStatus`: o Agrovex responde
 * esse HTTP (com `agrovexCorpo`) a tudo, em vez de atender.
 */
export function servidoresFalsos(
  tabelas: Record<string, TabelaFalsa>,
  consultas: ConsultaFalsa[] = [],
  opcoes: { agrovexStatus?: number; agrovexCorpo?: string } = {},
) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      if (init?.method && init.method !== 'GET') return new Response(null, { status: 204 });
      const tabela = /\/rest\/v1\/([a-z_]+)/.exec(url)?.[1] ?? '';
      const t = tabelas[tabela];
      if (t === undefined) return json({ code: 'PGRST205', message: `Could not find the table 'public.${tabela}'` }, 404);
      return Array.isArray(t) ? json(filtrar(t, url), 200) : json(t.corpo, t.status);
    }
    if (opcoes.agrovexStatus) return new Response(opcoes.agrovexCorpo ?? '{"error":"Unauthorized"}', { status: opcoes.agrovexStatus });
    const corpo = init?.body ? (JSON.parse(String(init.body)) as { id?: number; method?: string }) : null;
    if (init?.method === 'DELETE' || !corpo?.id) return new Response('', { status: 202 });
    if (corpo.method === 'initialize') {
      return json({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }, 200, { 'mcp-session-id': 's1' });
    }
    const dados = consultas[n++];
    if (dados && 'erro' in dados) return json({ jsonrpc: '2.0', id: corpo.id, result: { isError: true, content: [{ type: 'text', text: dados.erro }] } }, 200);
    return json({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...dados }) }] } }, 200);
  };
  return {
    impl,
    chamadas,
    /** chamadas feitas ao Agrovex (qualquer uma: abrir a sessão já conta) */
    aoAgrovex: () => chamadas.filter((c) => !c.url.startsWith(URL_SB)),
    /** argumentos de cada execute_query feita */
    consultasFeitas: () => chamadas
      .filter((c) => !c.url.startsWith(URL_SB) && String(c.init?.body).includes('execute_query'))
      .map((c) => (JSON.parse(String(c.init?.body)) as { params: { arguments: { sql: string; source: string } } }).params.arguments),
    /** GETs feitos a uma tabela do Supabase */
    leituras: (tabela: string) => chamadas.filter((c) => c.url.startsWith(`${URL_SB}/rest/v1/${tabela}?`) && (!c.init?.method || c.init.method === 'GET')).map((c) => c.url),
    /** PATCHs feitos a uma tabela do Supabase: o endereço (com o filtro) e o corpo gravado */
    respostas: (tabela: string) => chamadas
      .filter((c) => c.url.startsWith(`${URL_SB}/rest/v1/${tabela}?`) && c.init?.method === 'PATCH')
      .map((c) => ({ url: c.url, corpo: JSON.parse(String(c.init?.body)) as { atendido_em: string; resultado: string; dados?: unknown } })),
  };
}

/** Usuários inventados (uuid) para os testes de permissão. */
export const USUARIO = {
  colaborador: '11111111-1111-4111-8111-111111111111',
  outroColaborador: '22222222-2222-4222-8222-222222222222',
  adminRestrito: '33333333-3333-4333-8333-333333333333',
  adminQueVeTudo: '44444444-4444-4444-8444-444444444444',
  adminMais: '55555555-5555-4555-8555-555555555555',
  semPerfil: '66666666-6666-4666-8666-666666666666',
} as const;

/**
 * Um banco pequeno com os cinco tipos de usuário. Fazendas do COA WEB: 1 Globo, 2 Três Flechas, 3 SM3.
 * Fazendas de mapa: "Globo" (→ 1), "Fazenda SM3" (→ 3) e "Nebraska" (sem vínculo: só quem vê tudo).
 * Repare que `todas_fazendas` nasce true para todo mundo (é o padrão da coluna): só vale para administrador.
 */
export function bancoDePermissoes(): Record<string, Record<string, unknown>[]> {
  return {
    perfis: [
      { id: USUARIO.colaborador, perfil: 'colaborador', super: false, todas_fazendas: true },
      { id: USUARIO.outroColaborador, perfil: 'colaborador', super: false, todas_fazendas: true },
      { id: USUARIO.adminRestrito, perfil: 'admin', super: false, todas_fazendas: false },
      { id: USUARIO.adminQueVeTudo, perfil: 'admin', super: false, todas_fazendas: true },
      { id: USUARIO.adminMais, perfil: 'admin', super: true, todas_fazendas: false },
    ],
    usuario_fazendas: [
      { usuario_id: USUARIO.colaborador, fazenda_id: 1 },
      { usuario_id: USUARIO.outroColaborador, fazenda_id: 3 },
      { usuario_id: USUARIO.adminRestrito, fazenda_id: 2 },
    ],
    usuario_categorias: [
      { usuario_id: USUARIO.colaborador, categoria: 'mecanizadas' },
      { usuario_id: USUARIO.colaborador, categoria: 'mapas' },
      // outroColaborador: tem Mapas, não tem Mecanizadas
      { usuario_id: USUARIO.outroColaborador, categoria: 'mapas' },
      { usuario_id: USUARIO.adminRestrito, categoria: 'mecanizadas' },
      { usuario_id: USUARIO.adminRestrito, categoria: 'mapas' },
      { usuario_id: USUARIO.adminQueVeTudo, categoria: 'mecanizadas' },
      { usuario_id: USUARIO.adminQueVeTudo, categoria: 'mapas' },
      // adminMais (ADMINISTRADOR+): nenhuma linha — ele tem todas as categorias
    ],
    fazendas: [
      { id: 1, nome: 'Fazenda Globo' },
      { id: 2, nome: 'Faz. Três Flechas' },
      { id: 3, nome: 'SM3' },
    ],
    mapas_fazendas: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', nome: 'Globo', coa_fazenda_id: 1 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000003', nome: 'Fazenda SM3', coa_fazenda_id: 3 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000009', nome: 'Nebraska', coa_fazenda_id: null },
    ],
  };
}
