import { COR_STATUS, ROTULO_STATUS } from '../lib/situacaoPlantio';
import type { StatusPlantio } from '../lib/types';

const TEXTO: Record<StatusPlantio, string> = { plantado: '#FFFFFF', plantando: '#3A2E00', a_plantar: '#333333' };

/** Chip colorido da situação do plantio (plantado laranja, plantando amarelo, a plantar cinza tracejado). */
export default function ChipSituacao({ status, titulo }: { status: StatusPlantio; titulo?: string }) {
  const aPlantar = status === 'a_plantar';
  return (
    <span
      title={titulo}
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: '0.8em',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: TEXTO[status],
        background: aPlantar ? 'transparent' : COR_STATUS[status],
        border: `1.5px ${aPlantar ? 'dashed' : 'solid'} ${COR_STATUS[status]}`,
      }}
    >
      {ROTULO_STATUS[status]}
    </span>
  );
}
