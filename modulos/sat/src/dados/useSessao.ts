import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { clienteSupabase } from './supabase'

export type EstadoSessao = { fase: 'carregando' } | { fase: 'sem' } | { fase: 'com'; usuarioId: string }

const CARREGANDO: EstadoSessao = { fase: 'carregando' }
const SEM: EstadoSessao = { fase: 'sem' }

function deSessao(sessao: Session | null): EstadoSessao {
  return sessao ? { fase: 'com', usuarioId: sessao.user.id } : SEM
}

/** Mesmo estado? Evita novo render a cada renovação de token do mesmo usuário. */
function igual(a: EstadoSessao, b: EstadoSessao): boolean {
  return a.fase === b.fase && (a.fase !== 'com' || (b.fase === 'com' && a.usuarioId === b.usuarioId))
}

/** Há alguém logado no COA WEB? Acompanha login e logout feitos no site. */
export function useSessao(): EstadoSessao {
  const [estado, setEstado] = useState<EstadoSessao>(() => (clienteSupabase() ? CARREGANDO : SEM))
  useEffect(() => {
    const cliente = clienteSupabase()
    if (!cliente) return
    let vivo = true
    const aplicar = (sessao: Session | null) => {
      if (!vivo) return
      const proximo = deSessao(sessao)
      setEstado((atual) => (igual(atual, proximo) ? atual : proximo))
    }
    cliente.auth.getSession().then(
      ({ data }) => aplicar(data.session),
      () => aplicar(null),
    )
    const { data } = cliente.auth.onAuthStateChange((_evento, sessao) => aplicar(sessao))
    return () => {
      vivo = false
      data.subscription.unsubscribe()
    }
  }, [])
  return estado
}
