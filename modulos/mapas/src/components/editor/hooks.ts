import { useEffect, useMemo, useReducer, useState } from 'react';
import { repo } from '../../data';
import {
  decidirInterpolacao,
  entradaInterpolacao,
  erroAtual,
  ESTADO_INICIAL,
  reduzirInterpolacao,
  resultadoAtualizado,
  situacaoInterpolacao,
  type Situacao,
} from '../../lib/interpolacaoEstado';
import type { PipelineOutput } from '../../lib/pipeline';
import type { AreaCultura, Fazenda, IdwParams, Pic, Safra, Talhao } from '../../lib/types';
import { cancelarInterpolacao, interpolar } from '../../worker/client';
import { mensagemDeErro } from '../Aviso';

/** Fazendas e safras cadastradas. */
export function useCadastros() {
  const [fazendas, setFazendas] = useState<Fazenda[] | null>(null);
  const [safras, setSafras] = useState<Safra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    Promise.all([repo().listarFazendas(), repo().listarSafras()])
      .then(([f, s]) => {
        if (!ativo) return;
        setFazendas(f);
        setSafras([...s].sort((a, b) => (b.inicio || '').localeCompare(a.inicio || '')));
      })
      .catch((e) => {
        if (!ativo) return;
        setErro(`Não foi possível carregar os cadastros: ${mensagemDeErro(e)}`);
        setFazendas([]);
      });
    return () => {
      ativo = false;
    };
  }, []);
  return { fazendas, safras, erro };
}

export interface Interpolacao {
  /** último resultado concluído, para a prévia (pode estar desatualizado enquanto recalcula) */
  resultado: PipelineOutput | null;
  /** resultado das entradas atuais, sem nada rodando: o único que pode ser exportado ou salvo */
  resultadoAtual: PipelineOutput | null;
  situacao: Situacao;
  /** 0..1 enquanto o worker roda; null parado */
  progresso: number | null;
  erro: string | null;
}

const DEBOUNCE_MS = 350;
const SEM_AREAS: AreaCultura[] = [];
const SEM_IDS = new Set<string>();

/**
 * Reinterpola (em Web Worker) sempre que talhões, PICs, parâmetros, áreas ou plantio mudam. Com áreas
 * da cultura, a estatística "área plantada" é a união das áreas em `plantadosAreas`; sem áreas, os
 * talhões base em `plantados` (que também marcam as linhas plantadas da tabela).
 */
export function useInterpolacao(
  talhoes: Talhao[],
  pics: Pic[],
  idw: IdwParams,
  plantados: Set<string>,
  areas: AreaCultura[] = SEM_AREAS,
  plantadosAreas: Set<string> = SEM_IDS,
): Interpolacao {
  const [estado, despachar] = useReducer(reduzirInterpolacao, ESTADO_INICIAL);
  const entrada = useMemo(
    () => entradaInterpolacao(talhoes, pics, idw, plantados, areas, plantadosAreas),
    [talhoes, pics, idw, plantados, areas, plantadosAreas],
  );
  const chave = entrada?.chave ?? '';
  const { chaveRodando, chaveResultado, chaveErro } = estado;

  // A decisão é reavaliada também quando o estado muda (não só a chave): se outra execução começar ou
  // terminar sem a chave mudar (timer que dispara no meio de uma troca), a prévia não fica presa em
  // "Interpolando…". Decidir de novo é idempotente (manter não reagenda; limpar/cancelar sem efeito
  // não mudam o estado).
  useEffect(() => {
    const decisao = decidirInterpolacao({ ...ESTADO_INICIAL, chaveRodando, chaveResultado, chaveErro }, chave);
    if (decisao === 'manter') return;
    if (decisao === 'limpar' || decisao === 'cancelar') {
      cancelarInterpolacao();
      despachar({ tipo: decisao });
      return;
    }
    const inp = entrada!.inp;
    const t = window.setTimeout(() => {
      despachar({ tipo: 'iniciar', chave });
      let execucao: Promise<PipelineOutput>;
      try {
        execucao = interpolar(inp, (f) => despachar({ tipo: 'progresso', chave, f }));
      } catch (e) {
        execucao = Promise.reject(e); // nunca deixar a prévia presa em "Interpolando… 0%"
      }
      execucao
        .then((resultado) => despachar({ tipo: 'concluir', chave, resultado }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return; // substituída por outra
          despachar({ tipo: 'falhar', chave, erro: mensagemDeErro(e) });
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [chave, entrada, chaveRodando, chaveResultado, chaveErro]);

  useEffect(() => () => cancelarInterpolacao(), []);

  return {
    resultado: estado.resultado,
    resultadoAtual: resultadoAtualizado(estado, chave),
    situacao: situacaoInterpolacao(estado, chave),
    progresso: estado.progresso,
    erro: erroAtual(estado, chave),
  };
}

/** Logo do COA para o painel do layout. */
export function useLogo(): HTMLImageElement | null {
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = './logo-coa.png';
  }, []);
  return logo;
}
