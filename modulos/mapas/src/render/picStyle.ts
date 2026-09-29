import type { DestaquePics } from '../lib/types';
import { COR_VERDE } from './types';

export interface EstiloValorPic {
  /** cor do número */
  texto: string;
  /** cor do contorno do texto; null = sem contorno */
  halo: string | null;
  /** cor de fundo da etiqueta; null = sem etiqueta */
  caixa: string | null;
}

export const COR_VERMELHO_PIC = '#C62828';
export const COR_ESCURO_PIC = '#393939';

/** Cores do valor do PIC conforme o destaque escolhido (padrão: contorno escuro, como no QGIS). */
export function estiloValorPic(destaque: DestaquePics | undefined): EstiloValorPic {
  switch (destaque ?? 'escuro') {
    case 'vermelho':
      return { texto: '#FFFFFF', halo: COR_VERMELHO_PIC, caixa: null };
    case 'verde':
      return { texto: '#FFFFFF', halo: COR_VERDE, caixa: null };
    case 'etiqueta':
      return { texto: '#FFFFFF', halo: null, caixa: 'rgba(38, 38, 38, 0.92)' };
    default:
      return { texto: '#FFFFFF', halo: COR_ESCURO_PIC, caixa: null };
  }
}

export const DESTAQUES_PICS: { id: DestaquePics; nome: string }[] = [
  { id: 'escuro', nome: 'Contorno escuro (padrão)' },
  { id: 'vermelho', nome: 'Contorno vermelho' },
  { id: 'verde', nome: 'Contorno verde COA' },
  { id: 'etiqueta', nome: 'Etiqueta escura' },
];
