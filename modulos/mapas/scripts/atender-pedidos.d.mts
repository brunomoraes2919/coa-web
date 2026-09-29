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
