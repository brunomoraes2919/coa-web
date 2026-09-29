/** Estilos das situações do plantio no layout (plantado, plantando, a plantar) e itens da legenda. */
import { fmtDataHora } from '../lib/situacaoPlantio';
import type { StatusPlantio } from '../lib/types';
import { COR_AMARELO, COR_A_PLANTAR, COR_LARANJA, type RenderInput } from './types';

export interface EstiloSituacao {
  /** 'padrao' = estilo escolhido em Aparência; 'hachura' = diagonal na cor `cor`; null = sem preenchimento */
  preenchimento: 'padrao' | 'hachura' | null;
  /** cor da hachura */
  cor: string;
  contorno: string;
  larguraMm: number;
  /** [traço, espaço] em mm; null = contínuo */
  tracejadoMm: [number, number] | null;
}

export const ESTILO_SITUACAO: Record<StatusPlantio, EstiloSituacao> = {
  plantado: { preenchimento: 'padrao', cor: '#000000', contorno: COR_LARANJA, larguraMm: 0.7, tracejadoMm: null },
  plantando: { preenchimento: 'hachura', cor: COR_AMARELO, contorno: COR_AMARELO, larguraMm: 0.7, tracejadoMm: null },
  a_plantar: { preenchimento: null, cor: COR_A_PLANTAR, contorno: COR_A_PLANTAR, larguraMm: 0.45, tracejadoMm: [1.6, 1] },
};

const ORDEM: readonly StatusPlantio[] = ['plantado', 'plantando', 'a_plantar'];

/** Situação de um talhão base ou área da cultura; aceita o antigo `plantados` (compatibilidade). */
export function situacaoDe(inp: RenderInput, id: string): StatusPlantio | undefined {
  return inp.situacoes?.get(id) ?? (inp.plantados?.has(id) ? 'plantado' : undefined);
}

export const usaAreasCultura = (inp: RenderInput): boolean => (inp.areasCultura?.length ?? 0) > 0;

/** Situação efetiva de cada feição pintada: áreas da cultura (sem situação = a plantar) ou talhões base com situação. */
export function situacoesPintadas(inp: RenderInput): StatusPlantio[] {
  if (usaAreasCultura(inp)) return inp.areasCultura.map((a) => situacaoDe(inp, a.id) ?? 'a_plantar');
  return inp.talhoes.map((t) => situacaoDe(inp, t.id)).filter((s): s is StatusPlantio => !!s);
}

export interface LegendaSituacao {
  itens: { status: StatusPlantio; texto: string }[];
  /** linha pequena "Plantio: PIMS dd/MM/yyyy HH:mm"; null = sem PIMS */
  nota: string | null;
}

/**
 * Entradas da legenda só para as situações presentes no mapa. Sem PIMS e sem áreas da cultura
 * (só plantio manual) mantém o texto antigo "Área plantada – <safra>".
 */
export function itensLegendaSituacao(inp: RenderInput): LegendaSituacao {
  const presentes = new Set(situacoesPintadas(inp));
  if (!presentes.size) return { itens: [], nota: null };
  const safra = inp.nomeSafra.trim();
  const dataPims = fmtDataHora(inp.plantioGeradoEm);
  const modoAntigo = !dataPims && !usaAreasCultura(inp) && presentes.size === 1 && presentes.has('plantado');
  const rotulo: Record<StatusPlantio, string> = {
    plantado: modoAntigo ? (safra ? `Área plantada – ${safra}` : 'Área plantada') : safra ? `Plantado – ${safra}` : 'Plantado',
    plantando: 'Plantando',
    a_plantar: 'A plantar',
  };
  return {
    itens: ORDEM.filter((s) => presentes.has(s)).map((status) => ({ status, texto: rotulo[status] })),
    nota: dataPims ? `Plantio: PIMS ${dataPims}` : null,
  };
}
