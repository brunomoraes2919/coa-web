/** Regras de gravação no histórico de mapas (sem interface). */
import type { MapaSalvo } from './types';

/**
 * Resolução da cópia guardada no histórico: um A3 em 150 dpi tem ≈ 1 MB em JPEG (≈ 4 MB em PNG; o
 * plano gratuito do Supabase tem 1 GB de storage). Para outra resolução ou para o PNG, abra o mapa e
 * baixe o PNG no dpi desejado.
 */
export const DPI_HISTORICO = 150;

/** Qualidade do JPEG da cópia do histórico (0 a 1). */
export const QUALIDADE_JPEG_HISTORICO = 0.9;

/** Tipo aceito para os arquivos do histórico pelo tipo do blob: JPEG, ou PNG em qualquer outro caso (inclusive vazio). */
export function tipoImagem(tipoBlob: string): 'image/jpeg' | 'image/png' {
  return /^image\/jpe?g$/i.test(tipoBlob.trim()) ? 'image/jpeg' : 'image/png';
}

/** Extensão do arquivo pelo tipo do blob: 'jpg' (JPEG) ou 'png'. */
export function extensaoImagem(tipoBlob: string): 'jpg' | 'png' {
  return tipoImagem(tipoBlob) === 'image/jpeg' ? 'jpg' : 'png';
}

export type ModoSalvar = 'atualizar' | 'novo';

/**
 * Id e data de criação do registro a gravar. "atualizar" regrava o mapa aberto (mesmo id e mesma data
 * de criação); "novo" cria outro registro no histórico sem mexer no aberto. Sem mapa aberto, é sempre novo.
 */
export function identidadeMapa(
  modo: ModoSalvar,
  aberto: Pick<MapaSalvo, 'id' | 'criadoEm'> | null,
  agora: Date,
  novoId: () => string,
): { id: string; criadoEm: string } {
  if (modo === 'atualizar' && aberto) return { id: aberto.id, criadoEm: aberto.criadoEm };
  return { id: novoId(), criadoEm: agora.toISOString() };
}

/** Texto do botão de download no cartão do histórico, pelo arquivo guardado (mapas antigos estão em PNG). */
export function rotuloBaixarHistorico(path: string | null | undefined): string {
  const formato = /\.jpe?g$/i.test(path ?? '') ? 'JPEG' : 'PNG';
  return `Baixar ${formato} (${DPI_HISTORICO} dpi)`;
}

/** lado maior da miniatura do histórico, em pixels */
export const LADO_MINIATURA = 480;

/** Tamanho da miniatura (px) para uma folha de `pagina` mm: o lado maior tem `lado` px (paisagem ou retrato). */
export function tamanhoMiniatura(pagina: { w: number; h: number }, lado = LADO_MINIATURA): { w: number; h: number } {
  const k = lado / Math.max(pagina.w, pagina.h);
  return { w: Math.round(pagina.w * k), h: Math.round(pagina.h * k) };
}
