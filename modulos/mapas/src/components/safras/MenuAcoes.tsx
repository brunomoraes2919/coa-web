import { useEffect, useId, useRef, useState } from 'react';

export interface AcaoMenu {
  rotulo: string;
  perigo?: boolean;
  onClick: () => void;
}

/** Botão "⋯" com um menu discreto de ações secundárias (fecha com Esc ou clique fora). */
export default function MenuAcoes({ rotulo, acoes }: { rotulo: string; acoes: AcaoMenu[] }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        botao.current?.focus();
      }
    };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', tecla);
    raiz.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  return (
    <div className="menu-acoes" ref={raiz}>
      <button
        ref={botao}
        type="button"
        className="menu-acoes-botao"
        aria-label={rotulo}
        title={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        onClick={() => setAberto((a) => !a)}
      >
        ⋯
      </button>
      {aberto && (
        <div className="menu-acoes-lista" role="menu" id={id}>
          {acoes.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              role="menuitem"
              className={a.perigo ? 'perigo' : undefined}
              onClick={() => {
                setAberto(false);
                a.onClick();
              }}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
