import { FUNDOS, ORDEM_FUNDOS, type ChaveFundo } from './fundos'

export default function ControleFundo({ valor, aoMudar }: { valor: ChaveFundo; aoMudar: (c: ChaveFundo) => void }) {
  return (
    <div className="gnss-fundo" role="group" aria-label="Fundo do mapa">
      {ORDEM_FUNDOS.map((c) => (
        <button
          key={c}
          type="button"
          className={`gnss-fundo-opcao${c === valor ? ' ativo' : ''}`}
          aria-pressed={c === valor}
          onClick={() => aoMudar(c)}
        >
          {FUNDOS[c].rotulo}
        </button>
      ))}
    </div>
  )
}
