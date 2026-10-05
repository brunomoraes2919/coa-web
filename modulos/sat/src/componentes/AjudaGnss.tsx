import { useCallback, useRef, useState } from 'react'
import { useFecharAoClicarFora } from '../ui/useFecharAoClicarFora'
import Icone from '../ui/Icone'
import { AJUDA, FONTE_AJUDA, type TemaAjuda } from './ajudaTextos'

export default function AjudaGnss({ tema }: { tema: TemaAjuda }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLSpanElement>(null)
  const fechar = useCallback(() => setAberto(false), [])
  useFecharAoClicarFora(caixa, fechar)
  const t = AJUDA[tema]

  return (
    <span className="gnss-ajuda" ref={caixa} onKeyDown={(e) => e.key === 'Escape' && fechar()}>
      <button
        type="button"
        className="gnss-ajuda-botao"
        aria-label={`O que é ${t.titulo}?`}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="ajuda" tamanho={16} />
      </button>
      {aberto && (
        <div className="gnss-ajuda-caixa" role="dialog" aria-label={t.titulo}>
          <strong>{t.titulo}</strong>
          <p><b>O que é.</b> {t.oQueE}</p>
          <p><b>Quando acontece.</b> {t.quando}</p>
          <p><b>Na operação com RTK.</b> {t.rtk}</p>
          <p><b>O que fazer.</b> {t.fazer}</p>
          <small>{FONTE_AJUDA}</small>
        </div>
      )}
    </span>
  )
}
