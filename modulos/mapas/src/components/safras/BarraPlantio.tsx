import { COR_STATUS, ROTULO_STATUS, STATUS_ORDEM } from '../../lib/situacaoPlantio';
import type { StatusPlantio } from '../../lib/types';

/** a plantar em cinza claro na barra (no mapa é o cinza escuro tracejado) */
const COR_BARRA: Record<StatusPlantio, string> = { ...COR_STATUS, a_plantar: '#E3E7E6' };

/** Barra empilhada plantado / plantando / a plantar. */
export default function BarraPlantio({ contagem }: { contagem: Record<StatusPlantio, number> }) {
  const total = STATUS_ORDEM.reduce((s, k) => s + contagem[k], 0);
  const titulo = STATUS_ORDEM.map((k) => `${ROTULO_STATUS[k]}: ${contagem[k]}`).join(' · ');
  return (
    <div className="barra-plantio" role="img" aria-label={titulo} title={titulo}>
      {total > 0 &&
        STATUS_ORDEM.map((k) =>
          contagem[k] > 0 ? <span key={k} style={{ width: `${(contagem[k] / total) * 100}%`, background: COR_BARRA[k] }} /> : null,
        )}
    </div>
  );
}
