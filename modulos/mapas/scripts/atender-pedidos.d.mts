type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
interface Ctx { url: string; chave: string; fetch?: FetchLike }
/** rodada completa mais nova que isto: o pedido de "Atualizar" é respondido 'ok' com os dados já gravados */
export const RECENTE_MINUTOS: number;
/** pendentes que um usuário pode ter nas filas de chuva e de boletins; o excesso recebe "muitos pedidos" */
export const MAX_PENDENTES_POR_USUARIO: number;
export type TipoDeErro = 'fonte' | 'tempo' | 'invalido' | 'interno';
/** texto que vai para a tela em cada tipo de falha */
export const MENSAGENS_DE_ERRO: Readonly<Record<TipoDeErro, string>>;
/** `resultado` dos pedidos que o servidor recusa sem consultar nenhuma fonte */
export const RESULTADOS: Readonly<{ semPermissaoUnidade: string; semPermissaoFazenda: string; permissaoIndisponivel: string; muitosPedidos: string }>;
export function tipoDoErro(e: unknown): TipoDeErro;
/** texto que pode ir para a coluna `resultado` (nunca o texto que veio de fora) */
export function mensagemPublica(e: unknown): string;
export interface PedidoNaFila { id: number | string; pedido_por?: string | null }
export interface ExcessoDaFila { pedidoPor: string | null; depoisDoId: number; ids: number[] }
/** de cada usuário, o pedido mais antigo (até `porRodada`); e o excesso de quem tem mais de `maxPorUsuario` pendentes */
export function planejarFila<T extends PedidoNaFila>(pendentes: T[], opcoes: { porRodada: number; maxPorUsuario?: number }): { atender: T[]; excesso: ExcessoDaFila[] };
/** unidade do PIMS de uma fazenda do COA WEB (a mesma regra de unidadePimsDaFazenda do index.html) */
export function unidadePimsDaFazenda(nomeFazenda: unknown): string | null;
export interface DadosDePermissao {
  /** linha de `perfis` de quem pediu (null = não tem) */
  perfil: { perfil?: unknown; super?: unknown; todas_fazendas?: unknown } | null;
  /** linhas de `usuario_fazendas` de quem pediu */
  fazendasDoUsuario?: { fazenda_id?: unknown }[];
  /** linhas de `usuario_categorias` de quem pediu */
  categorias?: { categoria?: unknown }[];
  /** tabela `fazendas` do COA WEB (pedido de boletins) */
  fazendas?: { id?: unknown; nome?: unknown }[];
  /** tabela `mapas_fazendas` (pedido de chuva) */
  mapasFazendas?: { nome?: unknown; coa_fazenda_id?: unknown }[];
}
/** quem pediu pode ver a unidade (boletins) ou a fazenda (chuva)? `motivo` é só para o log */
export function decidirPermissao(dados: DadosDePermissao & { tipo: 'mecanizadas' | 'chuva'; alvo: unknown }): { permitido: boolean; motivo: string };
/** lê do Supabase o que decidirPermissao precisa; qualquer falha lança (quem chama recusa o pedido) */
export function lerPermissao(ctx: Ctx, tipo: 'mecanizadas' | 'chuva', pedidoPor: unknown, memo?: Map<string, unknown[]>): Promise<Required<DadosDePermissao>>;
export function pedidosPendentes(ctx: Ctx): Promise<number[]>;
export function marcarAtendidos(ctx: Ctx, ateId: number, resultado: string, agora?: Date): Promise<void>;
export function limparAntigos(ctx: Ctx, agora?: Date): Promise<void>;
export function atenderPedidos(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string; safras: 'auto' | string[]; excluirPrefixos?: string[] };
  /** também atualiza o Acompanhamento Operacional (acomp_pims) */
  acompanhamento?: boolean;
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<boolean>;
export interface PedidoChuvaPendente { id: number; /** quem pediu (auth.uid() de quem gravou o pedido) */ pedido_por?: string | null; fazenda: string; de: string; ate: string; /** 'hh:mm:ss' ou null (dias inteiros) */ de_hora?: string | null; ate_hora?: string | null }
export function pedidosChuvaPendentes(ctx: Ctx): Promise<PedidoChuvaPendente[]>;
export function responderPedidoChuva(ctx: Ctx, id: number, resultado: string, dados: unknown, agora?: Date): Promise<void>;
export function atenderPedidosChuva(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<number>;
export const SITUACAO_ZEUS_MINUTOS: number;
/** Mantém mapas_zeus_situacao em dia (último dia com leitura de cada fazenda da ZEUS). */
export function atualizarSituacaoZeus(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<'recente' | 'fora-do-passo' | 'sem-tabela' | 'vazio' | 'ok'>;
export const CHUVA_TALHAO_MINUTOS: number;
/** Mantém chuva_talhao em dia (chuva diária por talhão da stg_field_data, ciclos do PIMS e pluviômetros de cada fazenda). */
export function atualizarChuvaTalhao(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<'recente' | 'fora-do-passo' | 'sem-tabela' | 'sem-coluna' | 'vazio' | 'ok'>;
export const LIMITES_ZEUS_HORAS: number;
/** Mantém chuva_limites_zeus em dia (contorno dos talhões da ZEUS no datalake, das fazendas com chuva por talhão). */
export function atualizarLimitesZeus(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<'recente' | 'fora-do-passo' | 'sem-tabela' | 'vazio' | 'ok'>;
export interface PedidoMecPendente { id: number; /** quem pediu (auth.uid() de quem gravou o pedido) */ pedido_por?: string | null; unidade: string; de: string; ate: string }
export function pedidosMecPendentes(ctx: Ctx): Promise<PedidoMecPendente[]>;
export function responderPedidoMec(ctx: Ctx, id: number, resultado: string, dados: unknown, agora?: Date): Promise<void>;
export function atenderPedidosMec(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<number>;
export function atenderPedidosValidacao(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<boolean>;
