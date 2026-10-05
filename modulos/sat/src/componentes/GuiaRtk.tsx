import { useCallback, useRef, useState } from 'react'
import { useFecharAoClicarFora } from '../ui/useFecharAoClicarFora'
import Icone from '../ui/Icone'
import { COR_NIVEL } from '../logic/niveis'
import { GUIA_RTK } from './ajudaTextos'

/** Botão do cabeçalho que abre o guia de como a ionosfera mexe com o RTK. */
export default function GuiaRtk() {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLSpanElement>(null)
  const fechar = useCallback(() => setAberto(false), [])
  useFecharAoClicarFora(caixa, fechar)

  return (
    <span className="gnss-guia-rtk-caixa" ref={caixa} onKeyDown={(e) => e.key === 'Escape' && fechar()}>
      <button
        type="button"
        className="gnss-btn gnss-guia-rtk-botao"
        aria-expanded={aberto}
        aria-haspopup="dialog"
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="ajuda" tamanho={16} />
        Como isso afeta o RTK
      </button>
      {aberto && (
        <div className="gnss-guia-rtk" role="dialog" aria-label={GUIA_RTK.titulo}>
          <strong>{GUIA_RTK.titulo}</strong>
          <table className="gnss-guia-rtk-tabela">
            <thead>
              <tr>
                <th scope="col">Nível</th>
                <th scope="col">Efeito no RTK</th>
                <th scope="col">O que fazer</th>
              </tr>
            </thead>
            <tbody>
              {GUIA_RTK.niveis.map((n) => (
                <tr key={n.nivel}>
                  <td>
                    <i className="gnss-bolinha" style={{ background: COR_NIVEL[n.nivel] }} />
                    {n.rotulo}
                  </td>
                  <td>{n.efeito}</td>
                  <td>{n.fazer}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <b>{GUIA_RTK.tituloSensiveis}</b>
          <ul>
            {GUIA_RTK.sensiveis.map((s) => <li key={s}>{s}</li>)}
          </ul>
          <p>{GUIA_RTK.notaFrequencia}</p>
          <small>{GUIA_RTK.ressalva}</small>
        </div>
      )}
    </span>
  )
}
