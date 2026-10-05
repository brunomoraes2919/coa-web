/**
 * O que o Mapa lembra enquanto a página do módulo está aberta: a tela desmonta ao trocar de rota
 * (Hoje, Alertas) e, sem isto, voltava ao padrão. Não vai para o navegador: some ao recarregar.
 * Sem nenhum import, de propósito: o App usa este arquivo e o Leaflet fica no pacote do mapa.
 */
export interface MemoriaDoMapa {
  camada: 'off' | 'tec' | 'sci'
  /** 00:00 local do dia passado escolhido; `null` = hoje. */
  dia: number | null
  /** Índice do passo escolhido; `null` = acompanhar o último. */
  escolhido: number | null
  /** Ao vivo: hoje, seguindo o passo mais novo. `dia: null` com `aoVivo: false` é o Hoje, escolhido à mão. */
  aoVivo: boolean
}

const PADRAO: MemoriaDoMapa = { camada: 'sci', dia: null, escolhido: null, aoVivo: true }
let memoria: MemoriaDoMapa = { ...PADRAO }

export function lerMemoriaDoMapa(): MemoriaDoMapa {
  return { ...memoria }
}

export function guardarMemoriaDoMapa(parcial: Partial<MemoriaDoMapa>): void {
  memoria = { ...memoria, ...parcial }
}

/** Nos testes e quando outro usuário entra: a vista do mapa é de quem estava logado. */
export function limparMemoriaDoMapa(): void {
  memoria = { ...PADRAO }
}
