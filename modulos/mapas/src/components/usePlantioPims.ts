import { useEffect, useState } from 'react';
import { repo } from '../data';
import type { PlantioPimsArquivo } from '../lib/types';

/** Releitura do plantio do PIMS no máximo a cada 5 min (a rotina do PIMS o atualiza 1×/h). */
const VALIDADE_MS = 5 * 60 * 1000;
let cache: { quando: number; promessa: Promise<PlantioPimsArquivo | null> } | null = null;

/**
 * Plantio do PIMS compartilhado entre as telas, lido pelo repositório (local: plantio.json; Supabase:
 * tabela mapas_plantio_pims). Sem dados → null. Falha na leitura (rede, banco sem a tabela...) também
 * vira null — as telas seguem com o plantio manual — e não fica no cache: a próxima chamada tenta de novo.
 */
export function lerPlantioPims(): Promise<PlantioPimsArquivo | null> {
  if (cache && Date.now() - cache.quando <= VALIDADE_MS) return cache.promessa;
  const promessa: Promise<PlantioPimsArquivo | null> = Promise.resolve()
    .then(() => repo().lerPlantioPims())
    .catch((e: unknown) => {
      console.warn('Não foi possível ler o plantio do PIMS', e);
      if (cache?.promessa === promessa) cache = null;
      return null;
    });
  cache = { quando: Date.now(), promessa };
  return promessa;
}

/** Plantio do PIMS; `undefined` enquanto carrega, `null` se não houver. */
export function usePlantioPims(): PlantioPimsArquivo | null | undefined {
  const [arq, setArq] = useState<PlantioPimsArquivo | null | undefined>(undefined);
  useEffect(() => {
    let ativo = true;
    lerPlantioPims().then((a) => ativo && setArq(a));
    return () => {
      ativo = false;
    };
  }, []);
  return arq;
}
