/**
 * Contornos das fazendas para o Mapa — os talhões do cadastro, um download por sessão
 * (`limitesDaSessao`). Falhou? O mapa fica só com as bolinhas.
 */
import { useEffect, useState } from 'react'
import { limitesDaSessao } from '../dados/cadastro'
import { clienteSupabase } from '../dados/supabase'
import type { LimiteFazenda } from '../logic/limites'

type Limites = Record<string, LimiteFazenda>

function limitesPadrao(): Promise<Limites> {
  const cliente = clienteSupabase()
  if (!cliente) return Promise.resolve({})
  return limitesDaSessao({ cliente, armazenamento: window.localStorage, agora: Date.now })
}

/** `carregar` tem de ser uma referência estável: é dependência do efeito, e uma função nova a cada render pediria de novo. */
export function useLimitesFazendas(carregar: () => Promise<Limites> = limitesPadrao): Limites {
  const [limites, setLimites] = useState<Limites>({})
  useEffect(() => {
    let vivo = true
    carregar().then(
      (l) => {
        if (vivo) setLimites(l)
      },
      () => {
        /* sem contorno: ficam as bolinhas */
      },
    )
    return () => {
      vivo = false
    }
  }, [carregar])
  return limites
}
