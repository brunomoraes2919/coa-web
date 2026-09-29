import { useEffect, useRef, useState } from 'react';
import { repo } from '../../data';
import type { Fazenda, Safra, Talhao } from '../../lib/types';
import { mensagemDeErro } from '../Aviso';
import { lerPlantioPims, ouvirPlantioPims } from '../usePlantioPims';
import { resumoAreas, resumoPlantioFazenda, type ResumoAreas, type ResumoPlantioFazenda } from './safrasResumo';

export interface LinhaResumo {
  plantio: ResumoPlantioFazenda;
  areas: ResumoAreas;
}

export const chaveLinha = (safraId: string, fazendaId: string) => `${safraId}|${fazendaId}`;

export interface ResumosSafras {
  /** chaveLinha(safra, fazenda) → resumo; null enquanto carrega pela primeira vez */
  linhas: Map<string, LinhaResumo> | null;
  erro: string | null;
}

/**
 * Plantio (PIMS + manual) e áreas da cultura de cada safra × fazenda para a tela Safras. Os talhões de
 * cada fazenda ficam em cache enquanto a tela está aberta; ao salvar/excluir uma safra o resumo é
 * refeito sem voltar ao estado "carregando" — e também quando o botão "Atualizar plantio" relê o plantio.
 */
export function useResumoSafras(safras: Safra[] | null, fazendas: Fazenda[]): ResumosSafras {
  const [linhas, setLinhas] = useState<Map<string, LinhaResumo> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const talhoesCache = useRef(new Map<string, Promise<Talhao[]>>());
  /** muda a cada releitura do plantio do PIMS (recarregarPlantioPims) */
  const [recarga, setRecarga] = useState(0);
  useEffect(() => ouvirPlantioPims(() => setRecarga((n) => n + 1)), []);

  useEffect(() => {
    if (safras === null) return;
    let ativo = true;
    const r = repo();
    const talhoesDe = (fazendaId: string) => {
      let p = talhoesCache.current.get(fazendaId);
      if (!p) {
        p = r.obterTalhoes(fazendaId);
        talhoesCache.current.set(fazendaId, p);
        p.catch(() => talhoesCache.current.delete(fazendaId));
      }
      return p;
    };
    (async () => {
      try {
        const [arquivo, talhoes] = await Promise.all([lerPlantioPims(), Promise.all(fazendas.map((f) => talhoesDe(f.id)))]);
        const porSafra = await Promise.all(
          safras.map(async (s) => {
            const [plantios, areas] = await Promise.all([
              r.listarPlantios(s.id),
              Promise.all(fazendas.map((f) => r.listarAreasCultura(s.id, f.id))),
            ]);
            return { plantios, areas };
          }),
        );
        if (!ativo) return;
        const m = new Map<string, LinhaResumo>();
        safras.forEach((safra, i) => {
          const { plantios, areas } = porSafra[i];
          fazendas.forEach((fazenda, j) => {
            m.set(chaveLinha(safra.id, fazenda.id), {
              plantio: resumoPlantioFazenda({ arquivo, safra, fazenda, talhoes: talhoes[j], areas: areas[j], plantios }),
              areas: resumoAreas(areas[j]),
            });
          });
        });
        setLinhas(m);
        setErro(null);
      } catch (e) {
        if (!ativo) return;
        setErro(`Não foi possível carregar o plantio e as áreas das safras: ${mensagemDeErro(e)}`);
        setLinhas((l) => l ?? new Map());
      }
    })();
    return () => {
      ativo = false;
    };
  }, [safras, fazendas, recarga]);

  return { linhas, erro };
}
