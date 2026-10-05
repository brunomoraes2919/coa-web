/**
 * Fundos do mapa (serviços Esri): Satélite com nomes por cima, Topográfico, Claro e Escuro.
 * A escolha fica guardada no navegador.
 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'

export type ChaveFundo = 'satelite' | 'topo' | 'claro' | 'escuro'

export interface Fundo {
  rotulo: string
  url: string
  /** Último nível que o serviço tem no mundo todo (os fundos Canvas param no 16). */
  maxNativeZoom?: number
  /** Camada de nomes e divisas por cima (só no satélite). */
  rotulos?: string
}

export const FUNDOS: Record<ChaveFundo, Fundo> = {
  satelite: {
    rotulo: 'Satélite',
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    rotulos: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
  },
  topo: { rotulo: 'Topográfico', url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}` },
  claro: { rotulo: 'Claro', url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
  escuro: { rotulo: 'Escuro', url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
}

export const ORDEM_FUNDOS: ChaveFundo[] = ['satelite', 'topo', 'claro', 'escuro']
export const FUNDO_PADRAO: ChaveFundo = 'satelite'
export const CHAVE_FUNDO = 'locks_sat_fundo_v1'

export function lerFundo(armazenamento?: Pick<Storage, 'getItem'>): ChaveFundo {
  try {
    const valor = (armazenamento ?? window.localStorage).getItem(CHAVE_FUNDO)
    return ORDEM_FUNDOS.includes(valor as ChaveFundo) ? (valor as ChaveFundo) : FUNDO_PADRAO
  } catch {
    return FUNDO_PADRAO
  }
}

export function gravarFundo(chave: ChaveFundo, armazenamento?: Pick<Storage, 'setItem'>): void {
  try {
    ;(armazenamento ?? window.localStorage).setItem(CHAVE_FUNDO, chave)
  } catch {
    /* navegador sem armazenamento: a escolha vale só nesta visita */
  }
}
