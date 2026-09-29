import { Link } from 'react-router-dom';
import { usePerfil } from '../usePerfil';
import { resumoContagem } from '../../lib/situacaoPlantio';
import type { PlantioPimsTalhao, StatusPlantio } from '../../lib/types';

interface Props {
  safraId: string;
  fazendaId: string;
  nomeSafra: string;
  totalTalhoes: number;
  contagem: Record<StatusPlantio, number>;
  /** plantio.json casado com esta fazenda e safra; null = só plantio manual */
  geradoEm: string | null;
  /** o mapa pinta as áreas da cultura em vez dos talhões base */
  usaAreas: boolean;
  semPoligono: PlantioPimsTalhao[];
  /** com áreas da cultura: plantados/plantando no PIMS com talhão base mas sem área da cultura (não aparecem pintados) */
  semArea: PlantioPimsTalhao[];
}

/** Resumo do plantio da safra no editor: "X plantados · Y plantando · Z a plantar (PIMS dd/MM HH:mm)". */
export default function SecaoPlantioPims(p: Props) {
  // os links abrem os cadastros da safra: só para admin
  const admin = usePerfil() === 'admin';
  const link = admin && (
    <>
      {' · '}
      <Link to={`/safras/${p.safraId}/plantio/${p.fazendaId}`}>{p.geradoEm ? 'ver plantio' : 'marcar plantio'}</Link>
    </>
  );
  if (!p.geradoEm && !p.usaAreas) {
    return (
      <p className="suave">
        {p.contagem.plantado} de {p.totalTalhoes} talhões plantados na {p.nomeSafra}
        {link}
      </p>
    );
  }
  return (
    <div className="pilha" style={{ gap: 4 }}>
      <p className="suave" style={{ margin: 0 }}>
        <strong>{resumoContagem(p.contagem, p.geradoEm)}</strong>
        {link}
      </p>
      <small className="suave">
        {p.usaAreas
          ? 'O mapa pinta as áreas da cultura, e a chuva média na área plantada considera as áreas plantadas ou em plantio.'
          : 'A chuva média na área plantada considera os talhões plantados ou em plantio.'}
        {!p.geradoEm && ' Sem plantio do PIMS para esta fazenda/safra: vale o plantio marcado manualmente.'}
      </small>
      {p.usaAreas && p.semArea.length > 0 && (
        <small className="suave" style={{ color: '#8A5A00' }}>
          {p.semArea.length} talhão(ões) plantado(s)/plantando no PIMS sem área da cultura (não aparecem pintados):{' '}
          {p.semArea.slice(0, 8).map((t) => t.codigoPims).join(', ')}
          {p.semArea.length > 8 ? '…' : ''}.{admin && (
            <>
              {' '}
              <Link to={`/safras/${p.safraId}/areas/${p.fazendaId}`}>Áreas da cultura</Link>
            </>
          )}
        </small>
      )}
      {p.semPoligono.length > 0 && (
        <small className="suave">
          {p.semPoligono.length} talhão(ões) do PIMS sem polígono: {p.semPoligono.slice(0, 8).map((t) => t.codigoPims).join(', ')}
          {p.semPoligono.length > 8 ? '…' : ''}
        </small>
      )}
    </div>
  );
}
