import { useCallback, useEffect, useState } from 'react';
import { fazendaDoCoa, useFazendaCoa } from '../../lib/embed';
import type { Fazenda } from '../../lib/types';

/**
 * Fazenda do topo do COA WEB → pré-seleciona no editor a primeira fazenda de mapa ligada a ela
 * (coaFazendaId), enquanto o editor está limpo: `limpo` (novo mapa, sem CSV carregado) e nenhuma
 * fazenda escolhida à mão. Sem correspondente, nada muda. Retorna a função que registra a escolha
 * manual (a partir dela, o COA WEB não troca mais a fazenda desta tela).
 */
export function usePreSelecaoCoa(fazendas: Fazenda[] | null, fazendaId: string, limpo: boolean, selecionar: (id: string) => void): () => void {
  const coaId = useFazendaCoa()?.id ?? null;
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (manual || !limpo || !fazendas || coaId === null) return;
    const f = fazendaDoCoa(fazendas, coaId);
    if (f && f.id !== fazendaId) selecionar(f.id);
    // `selecionar` muda a cada render do editor; a decisão depende só destes valores
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, limpo, fazendas, coaId, fazendaId]);

  return useCallback(() => setManual(true), []);
}
