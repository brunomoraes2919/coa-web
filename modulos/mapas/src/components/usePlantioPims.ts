import { useEffect, useState } from 'react';
import { carregarPlantioPims } from '../lib/plantioPims';
import type { PlantioPimsArquivo } from '../lib/types';

/** Releitura do plantio.json no máximo a cada 5 min (a rotina do GitHub Actions o atualiza 1×/h). */
const VALIDADE_MS = 5 * 60 * 1000;
let cache: { quando: number; promessa: Promise<PlantioPimsArquivo | null> } | null = null;

/** plantio.json compartilhado entre as telas (sem arquivo, sem rede ou inválido → null). */
export function lerPlantioPims(): Promise<PlantioPimsArquivo | null> {
  if (!cache || Date.now() - cache.quando > VALIDADE_MS) cache = { quando: Date.now(), promessa: carregarPlantioPims() };
  return cache.promessa;
}

/** Arquivo do plantio do PIMS; `undefined` enquanto carrega, `null` se não houver. */
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
