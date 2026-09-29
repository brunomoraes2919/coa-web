interface Props {
  texto?: string;
  /** sem o espaçamento de bloco (para usar dentro de uma linha) */
  inline?: boolean;
}

export default function Carregando({ texto = 'Carregando…', inline = false }: Props) {
  return (
    <div className={inline ? 'carregando inline' : 'carregando'} role="status" aria-live="polite">
      <span className="giro" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}
