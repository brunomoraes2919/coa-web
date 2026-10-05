import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { tituloAlerta } from '../logic/alertas'
import type { AlertaGnss } from '../tipos'
import './avisos-gnss.css'

/** 8 s: dá para ler duas linhas sem pressa; o histórico fica em Alertas. */
const DURACAO_MS = 8_000

function AvisoItem({ aviso, aoFechar, aoAbrir }: {
  aviso: AlertaGnss
  aoFechar: (id: string) => void
  aoAbrir: (id: string) => void
}) {
  // Um timer por aviso, montado com ele: chegar um aviso novo não reinicia
  // o relógio dos que já estão na tela.
  useEffect(() => {
    const t = window.setTimeout(() => aoFechar(aviso.id), DURACAO_MS)
    return () => window.clearTimeout(t)
  }, [aviso.id, aoFechar])

  return (
    <div className={`gnss-aviso ${aviso.severidade}`} role="alert">
      <button type="button" className="gnss-aviso-corpo" onClick={() => aoAbrir(aviso.id)}>
        <strong>{tituloAlerta(aviso)}</strong>
        <span>{aviso.texto}</span>
      </button>
      <button type="button" className="gnss-aviso-fechar" aria-label="Fechar aviso" onClick={() => aoFechar(aviso.id)}>
        ×
      </button>
    </div>
  )
}

export default function AvisosGnss({ avisos, aoFechar }: { avisos: AlertaGnss[]; aoFechar: (id: string) => void }) {
  const navegar = useNavigate()
  if (!avisos.length) return null
  return (
    <div className="gnss-avisos" aria-live="assertive">
      {avisos.map((a) => (
        <AvisoItem
          key={a.id}
          aviso={a}
          aoFechar={aoFechar}
          aoAbrir={(id) => {
            aoFechar(id)
            navegar('/alertas')
          }}
        />
      ))}
    </div>
  )
}
