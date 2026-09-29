import { useEffect, useState } from 'react';
import { repo } from '../data';
import type { PlantioPimsArquivo } from '../lib/types';

/** Releitura do plantio do PIMS no máximo a cada 5 min (a rotina do PIMS o atualiza 1×/h). */
const VALIDADE_MS = 5 * 60 * 1000;
let cache: { quando: number; promessa: Promise<PlantioPimsArquivo | null> } | null = null;

type Ouvinte = (arquivo: PlantioPimsArquivo | null) => void;
/** cada usePlantioPims montado (e quem mais quiser saber do plantio relido pelo botão "Atualizar plantio") */
const ouvintes = new Set<Ouvinte>();

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

/**
 * Avisa `ouvinte` sempre que o plantio for relido por recarregarPlantioPims. Devolve a função que
 * cancela o aviso.
 */
export function ouvirPlantioPims(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Relê o plantio do PIMS agora, sem esperar os 5 min do cache (botão "Atualizar plantio", depois que o
 * servidor atualizou a tabela), e avisa todas as telas abertas (cada usePlantioPims montado re-renderiza
 * com o valor novo). Ao contrário de lerPlantioPims, uma falha rejeita (para a tela mostrar o erro) e não
 * avisa ninguém: as telas ficam com o plantio que tinham, e a próxima leitura tenta de novo.
 */
export async function recarregarPlantioPims(): Promise<PlantioPimsArquivo | null> {
  const leitura = Promise.resolve().then(() => repo().lerPlantioPims());
  // quem pedir o plantio enquanto isso já recebe a leitura nova (com as regras de lerPlantioPims)
  const promessa: Promise<PlantioPimsArquivo | null> = leitura.catch((e: unknown) => {
    console.warn('Não foi possível reler o plantio do PIMS', e);
    if (cache?.promessa === promessa) cache = null;
    return null;
  });
  cache = { quando: Date.now(), promessa };
  const arquivo = await leitura;
  for (const ouvinte of [...ouvintes]) ouvinte(arquivo);
  return arquivo;
}

/** Plantio do PIMS; `undefined` enquanto carrega, `null` se não houver. Atualiza com recarregarPlantioPims. */
export function usePlantioPims(): PlantioPimsArquivo | null | undefined {
  const [arq, setArq] = useState<PlantioPimsArquivo | null | undefined>(undefined);
  useEffect(() => {
    let ativo = true;
    let recarregado = false;
    const sair = ouvirPlantioPims((a) => {
      recarregado = true;
      if (ativo) setArq(a);
    });
    // a leitura inicial não sobrescreve o plantio relido enquanto ela estava em andamento
    lerPlantioPims().then((a) => ativo && !recarregado && setArq(a));
    return () => {
      ativo = false;
      sair();
    };
  }, []);
  return arq;
}
