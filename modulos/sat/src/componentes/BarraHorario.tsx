import { dataCurta, horaDe } from '../logic/tempo'
import Icone from '../ui/Icone'

interface Props {
  passos: number[]
  indice: number
  tocando: boolean
  /** Dia passado: o horário leva a data (dd/mm). */
  comData?: boolean
  /** Ao vivo: a hora leva a marca "AO VIVO" na frente. */
  aoVivo?: boolean
  indisponivel: boolean
  aoMudar: (indice: number) => void
  aoAlternar: () => void
}

export default function BarraHorario({ passos, indice, tocando, comData, aoVivo, indisponivel, aoMudar, aoAlternar }: Props) {
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
        aria-valuetext={aoVivo ? `ao vivo · ${rotulo}` : rotulo}
      />
      <output className="gnss-barra-hora">
        {aoVivo && (
          <>
            <span className="gnss-ao-vivo">AO VIVO</span> ·{' '}
          </>
        )}
        {rotulo}
        {indisponivel && <small> · imagem indisponível</small>}
      </output>
    </div>
  )
}
