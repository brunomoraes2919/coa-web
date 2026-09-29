import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  aberto: boolean;
  titulo: string;
  children?: ReactNode;
  /** botões do rodapé */
  acoes?: ReactNode;
  onFechar: () => void;
}

export default function Modal({ aberto, titulo, children, acoes, onFechar }: Props) {
  const idTitulo = useId();
  const caixaRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);

  useEffect(() => {
    fecharRef.current = onFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    caixaRef.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharRef.current();
    };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, [aberto]);

  if (!aberto) return null;

  return createPortal(
    <div
      className="modal-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1} ref={caixaRef}>
        <div className="modal-cabecalho">
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" className="modal-fechar" aria-label="Fechar" onClick={onFechar}>
            ×
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {acoes && <div className="modal-acoes">{acoes}</div>}
      </div>
    </div>,
    document.body,
  );
}
