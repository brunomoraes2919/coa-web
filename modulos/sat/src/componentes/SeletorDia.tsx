/**
 * Dia do mapa: hoje (o padrão, ao vivo) ou um dos 29 dias anteriores.
 */
import { DIAS_NO_MAPA, diasDoMapa } from '../logic/passosMapa'
import { chaveData, diaDaChave } from '../logic/tempo'

export { DIAS_NO_MAPA }

interface Props {
  /** 00:00 local do dia escolhido; `null` = hoje. */
  dia: number | null
  agora: number
  aoMudar: (dia: number | null) => void
}

export default function SeletorDia({ dia, agora, aoMudar }: Props) {
  const { hoje, ontem, primeiro } = diasDoMapa(agora)

  const escolher = (valor: string) => {
    const d = diaDaChave(valor)
    if (d == null || d < primeiro || d > hoje) return
    aoMudar(d === hoje ? null : d)
  }

  return (
    <div className="gnss-seletor-dia" role="group" aria-label="Dia do mapa">
      <button type="button" className={`gnss-chip${dia == null ? ' ativo' : ''}`} aria-pressed={dia == null} onClick={() => aoMudar(null)}>
        Hoje
      </button>
      <button type="button" className={`gnss-chip${dia === ontem ? ' ativo' : ''}`} aria-pressed={dia === ontem} onClick={() => aoMudar(ontem)}>
        Ontem
      </button>
      <input
        type="date"
        aria-label="Escolher o dia"
        value={chaveData(dia ?? hoje)}
        min={chaveData(primeiro)}
        max={chaveData(hoje)}
        onChange={(e) => escolher(e.target.value)}
      />
    </div>
  )
}
