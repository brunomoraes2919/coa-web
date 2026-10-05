import { useSyncExternalStore } from 'react'

/** O elemento `<iframe>` que contém esta janela, se der para chegar nele (mesma origem); senão `null`. */
function quadroDaJanela(): Element | null {
  try {
    return window.frameElement
  } catch {
    return null
  }
}

function temTamanho(): boolean {
  try {
    const quadro = quadroDaJanela()
    // Dentro do COA WEB quem sabe é o iframe: escondido por `display:none` num ancestral, a janela
    // dele guarda o último tamanho (e não dispara `resize`), mas o elemento fica sem caixa.
    if (quadro) return quadro.getClientRects().length > 0
  } catch {
    /* sem como ler o iframe: vale o tamanho da janela */
  }
  return window.innerWidth > 0 && window.innerHeight > 0
}

function assinar(avisar: () => void): () => void {
  window.addEventListener('resize', avisar)
  let observador: ResizeObserver | undefined
  try {
    const quadro = quadroDaJanela()
    // O observador tem de ser o da janela de fora: é ela quem vê o iframe mudar de tamanho (ou sumir).
    const Observador = quadro ? (window.parent as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver : undefined
    if (quadro && Observador) {
      observador = new Observador(() => avisar())
      observador.observe(quadro)
    }
  } catch {
    observador = undefined
  }
  // O observador vive no realm do pai: se o iframe for removido sem o React desmontar (logout no COA
  // WEB), ele ficaria ligado ao documento de fora. `pagehide` da janela do iframe o solta.
  const soltar = () => {
    observador?.disconnect()
    observador = undefined
  }
  window.addEventListener('pagehide', soltar)
  return () => {
    window.removeEventListener('resize', avisar)
    window.removeEventListener('pagehide', soltar)
    soltar()
  }
}

/** O iframe está aparecendo? Escondido pelo COA WEB (outra categoria, ou carregado em segundo
 *  plano), ele fica sem caixa — e volta a ter quando é mostrado. Fora de um iframe, vale o
 *  tamanho da janela. */
export function useVisivel(): boolean {
  return useSyncExternalStore(assinar, temTamanho, () => true)
}
