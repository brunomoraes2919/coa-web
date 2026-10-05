import { COR_NIVEL, corEscala, LIMITE_FORTE, LIMITE_MEDIA } from '../logic/niveis'

/** Mesma escala das imagens de TEC da Trimble, de baixo (mínimo) para cima (máximo). */
const GRADIENTE = `linear-gradient(to top, ${[0, 0.25, 0.5, 0.75, 1].map((f) => corEscala(f)).join(', ')})`

const FAIXAS = [
  { nivel: 'forte', rotulo: 'Forte', de: LIMITE_FORTE, ate: 100 },
  { nivel: 'media', rotulo: 'Média', de: LIMITE_MEDIA, ate: LIMITE_FORTE - 1 },
  { nivel: 'minima', rotulo: 'Mínima', de: 0, ate: LIMITE_MEDIA - 1 },
] as const

export default function LegendaGnss({ camada }: { camada: 'sci' | 'tec' }) {
  if (camada === 'sci') {
    return (
      <div className="gnss-legenda">
        <strong>Cintilação</strong>
        <ul className="gnss-legenda-faixas">
          {FAIXAS.map((f) => (
            <li key={f.nivel}>
              {f.nivel === 'minima' ? <i className="vazia" /> : <i style={{ background: COR_NIVEL[f.nivel] }} />}
              {f.rotulo} <small>{f.de}–{f.ate}</small>
            </li>
          ))}
        </ul>
        <small className="gnss-legenda-nota">Mínima fica sem cor</small>
      </div>
    )
  }
  return (
    <div className="gnss-legenda">
      <strong>TEC (TECU)</strong>
      <div className="gnss-legenda-corpo">
        <div className="gnss-legenda-barra" style={{ background: GRADIENTE }} />
        <div className="gnss-legenda-rotulos">
          {['120', '60', '0'].map((r) => (
            <span key={r}>{r}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
