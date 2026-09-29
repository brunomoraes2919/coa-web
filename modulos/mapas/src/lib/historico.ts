/** Regras de gravação no histórico de mapas (sem interface). */
import type { MapaSalvo } from './types';

/**
 * Resolução da cópia guardada no histórico: um A3 em 150 dpi tem ≈ 4 MB (em 300 dpi seriam ~14 MB e
 * em 600 dpi ~39 MB). Para outra resolução, abra o mapa e baixe o PNG no dpi desejado.
 */
export const DPI_HISTORICO = 150;

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

/** Texto do botão de download no cartão do histórico. */
export function rotuloBaixarHistorico(): string {
  return `Baixar PNG (${DPI_HISTORICO} dpi)`;
}

/** lado maior da miniatura do histórico, em pixels */
export const LADO_MINIATURA = 480;

/** Tamanho da miniatura (px) para uma folha de `pagina` mm: o lado maior tem `lado` px (paisagem ou retrato). */
export function tamanhoMiniatura(pagina: { w: number; h: number }, lado = LADO_MINIATURA): { w: number; h: number } {
  const k = lado / Math.max(pagina.w, pagina.h);
  return { w: Math.round(pagina.w * k), h: Math.round(pagina.h * k) };
}
