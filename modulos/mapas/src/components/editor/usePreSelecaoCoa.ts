import { useEffect } from 'react';
import { fazendaDoCoa, useFazendaCoa } from '../../lib/embed';
import type { Fazenda, FazendaCoaSelecionada } from '../../lib/types';

/**
 * Fazenda a escolher quando a fazenda do COA WEB é `coaId`: a primeira fazenda de mapa ligada a ela
 * (coaFazendaId), ou '' quando nenhuma está ligada. null = nada muda (sem fazenda do COA WEB, ou o
 * editor já está nela).
 */
export function alvoPreSelecaoCoa(fazendas: Fazenda[], coaId: number | null, fazendaAtualId: string): string | null {
  if (coaId === null) return null;
  const alvo = fazendaDoCoa(fazendas, coaId)?.id ?? '';
  return alvo === fazendaAtualId ? null : alvo;
}

/**
 * Novo mapa (`novo`) segue sempre a fazenda do topo do COA WEB: ao carregar os cadastros e a cada troca
 * dela, seleciona a primeira fazenda de mapa ligada (ou nenhuma), mesmo com CSV carregado ou depois de
 * uma escolha à mão (a lista do editor só tem as fazendas ligadas a ela). Mapa salvo nunca troca sozinho.
 * Retorna a fazenda do COA WEB (null enquanto nada chegou ou fora do iframe).
 */
export function usePreSelecaoCoa(
  fazendas: Fazenda[] | null,
  fazendaId: string,
  novo: boolean,
  selecionar: (id: string) => void,
): FazendaCoaSelecionada | null {
  const coa = useFazendaCoa();
  const coaId = coa?.id ?? null;
  const carregou = fazendas !== null;

  useEffect(() => {
    if (!novo || !fazendas) return;
    const alvo = alvoPreSelecaoCoa(fazendas, coaId, fazendaId);
    if (alvo !== null) selecionar(alvo);
    // só ao carregar os cadastros e quando a fazenda do COA WEB muda: uma escolha à mão entre as
    // fazendas ligadas a ela continua valendo; `selecionar` muda a cada render do editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novo, carregou, coaId]);

  return coa;
}
