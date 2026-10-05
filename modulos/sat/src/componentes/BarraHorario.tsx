import { dataCurta, horaDe } from '../logic/tempo'
import Icone from '../ui/Icone'

interface Props {
  passos: number[]
  indice: number
  tocando: boolean
  /** Dia passado: o horário leva a data (dd/mm). */
  comData?: boolean
  indisponivel: boolean
  aoMudar: (indice: number) => void
  aoAlternar: () => void
}

export default function BarraHorario({ passos, indice, tocando, comData, indisponivel, aoMudar, aoAlternar }: Props) {
  const passo = passos[indice]
  const rotulo = comData ? `${dataCurta(passo)} · ${horaDe(passo)}` : horaDe(passo)
  return (
    <div className="gnss-barra-horario">
      <button
        type="button"
        className="gnss-btn icone"
        onClick={aoAlternar}
        aria-label={tocando ? 'Pausar a animação do dia' : 'Reproduzir o dia'}
      >
        <Icone nome={tocando ? 'pausa' : 'play'} tamanho={16} />
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, passos.length - 1)}
        step={1}
        value={indice}
        onChange={(e) => aoMudar(Number(e.target.value))}
        aria-label="Horário do mapa"
        aria-valuetext={rotulo}
      />
      <output className="gnss-barra-hora">
        {rotulo}
        {indisponivel && <small> · imagem indisponível</small>}
      </output>
    </div>
  )
}
