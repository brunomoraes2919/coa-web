import { useEffect, type RefObject } from 'react'

/** Fecha quando o clique cai fora da caixa do dropdown. */
export function useFecharAoClicarFora(caixa: RefObject<HTMLElement | null>, fechar: () => void) {
  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar()
    }
    document.addEventListener('click', aoClicarFora)
    return () => document.removeEventListener('click', aoClicarFora)
  }, [caixa, fechar])
}
