import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useFecharAoClicarFora } from '../ui/useFecharAoClicarFora'
import Icone from '../ui/Icone'
import { AJUDA, FONTE_AJUDA, type TemaAjuda } from './ajudaTextos'

/** folga mínima, em px, entre o balão e as bordas do documento */
const MARGEM = 8
/** deslocamento horizontal que o gnss.css soma à posição do balão */
const DESVIO = '--gnss-ajuda-desvio'

export default function AjudaGnss({ tema }: { tema: TemaAjuda }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLSpanElement>(null)
  const balao = useRef<HTMLDivElement>(null)
  const fechar = useCallback(() => setAberto(false), [])
  useFecharAoClicarFora(caixa, fechar)
  const t = AJUDA[tema]

  // O balão abre centrado no "?"; perto de uma borda ele passaria do documento.
  // Mede onde ele cairia sem desvio e o empurra de volta para dentro.
  useLayoutEffect(() => {
    if (!aberto) return
    function prender() {
      const el = balao.current
      if (!el) return
      el.style.setProperty(DESVIO, '0px')
      const { left, right } = el.getBoundingClientRect()
      const sobraDireita = document.documentElement.clientWidth - MARGEM - right
      el.style.setProperty(DESVIO, `${Math.max(MARGEM - left, Math.min(0, sobraDireita))}px`)
    }
    prender()
    window.addEventListener('resize', prender)
    return () => window.removeEventListener('resize', prender)
  }, [aberto])

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
        <div className="gnss-ajuda-caixa" ref={balao} role="dialog" aria-label={t.titulo}>
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
