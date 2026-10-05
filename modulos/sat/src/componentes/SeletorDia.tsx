/**
 * O que o mapa mostra: ao vivo (hoje, seguindo o passo mais novo), hoje (à mão) ou um dos 29
 * dias anteriores.
 */
import { DIAS_NO_MAPA, diasDoMapa } from '../logic/passosMapa'
import { chaveData, diaDaChave } from '../logic/tempo'

export { DIAS_NO_MAPA }

/** `'ao-vivo'`, `'hoje'` (à mão) ou 00:00 local do dia passado. */
export type ModoDia = 'ao-vivo' | 'hoje' | number

interface Props {
  modo: ModoDia
  agora: number
  aoMudar: (modo: ModoDia) => void
}

export default function SeletorDia({ modo, agora, aoMudar }: Props) {
  const { hoje, ontem, primeiro } = diasDoMapa(agora)

  const escolher = (valor: string) => {
    const d = diaDaChave(valor)
    if (d == null || d < primeiro || d > hoje) return
    aoMudar(d === hoje ? 'hoje' : d)
  }
  const botao = (rotulo: string, alvo: ModoDia) => (
    <button type="button" className={`gnss-chip${modo === alvo ? ' ativo' : ''}`} aria-pressed={modo === alvo} onClick={() => aoMudar(alvo)}>
      {rotulo}
    </button>
  )

  return (
    <div className="gnss-seletor-dia" role="group" aria-label="Dia do mapa">
      {botao('Ao vivo', 'ao-vivo')}
      {botao('Hoje', 'hoje')}
      {botao('Ontem', ontem)}
      <input
        type="date"
        aria-label="Escolher o dia"
        value={chaveData(typeof modo === 'number' ? modo : hoje)}
        min={chaveData(primeiro)}
        max={chaveData(hoje)}
        onChange={(e) => escolher(e.target.value)}
      />
    </div>
  )
}
