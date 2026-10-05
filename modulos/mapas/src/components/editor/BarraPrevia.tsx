interface Props {
  /** cadeado fechado: arraste e roda do mouse não mexem no mapa */
  travado: boolean;
  onTravado(travado: boolean): void;
  /** Centralizar habilitado (o enquadramento não é o automático) */
  podeCentralizar: boolean;
  onCentralizar(): void;
  /** Aproximar (true) ou afastar (false) pelo centro do mapa: no celular não há roda do mouse */
  onZoom(aproximar: boolean): void;
}

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function IconeCadeado({ aberto }: { aberto: boolean }) {
  return (
    <svg {...svg} aria-hidden="true" focusable="false">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={aberto ? 'M8 11V7a4 4 0 0 1 7.75-1.4' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
    </svg>
  );
}

function IconeCentralizar() {
  return (
    <svg {...svg} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function IconeZoom({ mais }: { mais: boolean }) {
  return (
    <svg {...svg} aria-hidden="true" focusable="false">
      <path d={mais ? 'M12 5v14M5 12h14' : 'M5 12h14'} />
    </svg>
  );
}

/** Cadeado (trava arraste e zoom da prévia), aproximar/afastar (com o mapa destravado) e Centralizar (volta ao enquadramento automático). */
export default function BarraPrevia({ travado, onTravado, podeCentralizar, onCentralizar, onZoom }: Props) {
  const dicaCadeado = travado ? 'Destravar para mover e aproximar' : 'Travar o mapa';
  return (
    <div className="previa-ferramentas" role="toolbar" aria-label="Enquadramento da prévia">
      <button
        type="button"
        className={`botao-icone-previa${travado ? '' : ' destravado'}`}
        aria-label={dicaCadeado}
        title={dicaCadeado}
        onClick={() => onTravado(!travado)}
      >
        <IconeCadeado aberto={!travado} />
      </button>
      {!travado && (
        <>
          <button type="button" className="botao-icone-previa" aria-label="Aproximar o mapa" title="Aproximar" onClick={() => onZoom(true)}>
            <IconeZoom mais />
          </button>
          <button type="button" className="botao-icone-previa" aria-label="Afastar o mapa" title="Afastar" onClick={() => onZoom(false)}>
            <IconeZoom mais={false} />
          </button>
        </>
      )}
      <button type="button" className="botao-icone-previa" aria-label="Centralizar o mapa" title="Centralizar o mapa" disabled={!podeCentralizar} onClick={onCentralizar}>
        <IconeCentralizar />
      </button>
    </div>
  );
}
