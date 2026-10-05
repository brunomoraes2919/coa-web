/**
 * Ícones do módulo: só os três que as telas usam (ajuda, play, pausa).
 * Grade 24×24, traço de 1.6, pontas e junções arredondadas, sem preenchimento.
 */
import type { ReactNode } from 'react'

export type NomeIcone = 'ajuda' | 'play' | 'pausa'

const DESENHOS: Record<NomeIcone, ReactNode> = {
  ajuda: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.7 9.5a2.4 2.4 0 0 1 4.7.6c0 1.6-2.3 1.9-2.3 3.4" />
      <path d="M12 16.9h.01" />
    </>
  ),
  play: <path d="M8 5.6v12.8l10.4-6.4z" />,
  pausa: (
    <>
      <path d="M9 5.6v12.8" />
      <path d="M15 5.6v12.8" />
    </>
  ),
}

interface IconeProps {
  nome: NomeIcone
  /** Lado do quadrado em px. Padrão 20 — tamanho de uso em botões e menus. */
  tamanho?: number
  className?: string
}

export default function Icone({ nome, tamanho = 20, className }: IconeProps) {
  return (
    <svg
      className={className}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {DESENHOS[nome]}
    </svg>
  )
}
