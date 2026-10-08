type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
interface Ctx { url: string; chave: string; fetch?: FetchLike }
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
export interface PedidoChuvaPendente { id: number; fazenda: string; de: string; ate: string; /** 'hh:mm:ss' ou null (dias inteiros) */ de_hora?: string | null; ate_hora?: string | null }
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
/** Mantém chuva_talhao em dia (chuva diária por pluviômetro e vínculo talhão → pluviômetros de cada fazenda). */
export function atualizarChuvaTalhao(opcoes: {
  supabase: { url: string; chave: string };
  agrovex: { url: string; token: string };
  fetch?: FetchLike;
  agora?: () => Date;
}): Promise<'recente' | 'fora-do-passo' | 'sem-tabela' | 'vazio' | 'ok'>;
export interface PedidoMecPendente { id: number; unidade: string; de: string; ate: string }
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
