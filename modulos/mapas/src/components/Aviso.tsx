import type { ReactNode } from 'react';

export type TipoAviso = 'info' | 'sucesso' | 'alerta' | 'erro';

interface Props {
  tipo?: TipoAviso;
  titulo?: string;
  children?: ReactNode;
  onFechar?: () => void;
}

const ICONE: Record<TipoAviso, string> = { info: 'i', sucesso: '✓', alerta: '!', erro: '×' };

export default function Aviso({ tipo = 'info', titulo, children, onFechar }: Props) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <span className="aviso-icone" aria-hidden="true">
        {ICONE[tipo]}
      </span>
      <div className="aviso-corpo">
        {titulo && <strong>{titulo}</strong>}
        {children}
      </div>
      {onFechar && (
        <button type="button" className="aviso-fechar" aria-label="Fechar aviso" onClick={onFechar}>
          ×
        </button>
      )}
    </div>
  );
}

/** A tradução dos erros fica em lib/erros.ts (também usada pelo worker da interpolação). */
export { mensagemDeErro } from '../lib/erros';
