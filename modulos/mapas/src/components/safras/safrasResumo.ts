/**
 * Resumo da tela Safras (partes puras): plantio de cada fazenda na safra (PIMS prevalece, manual nos
 * talhões sem registro — mesmas regras do mapa, via casarPlantio/combinarPlantios/situacaoDoMapa),
 * textos das células e o resumo da safra.
 */
import { casarPlantio, combinarPlantios } from '../../lib/plantioPims';
import { fmtDataHora, resumoContagem, situacaoDoMapa } from '../../lib/situacaoPlantio';
import type { AreaCultura, Fazenda, Plantio, PlantioPimsArquivo, Safra, StatusPlantio, Talhao } from '../../lib/types';

export interface ResumoPlantioFazenda {
  /** 'pims' = a safra e a unidade da fazenda estão no plantio.json; 'manual' = só o plantio marcado à mão */
  fonte: 'pims' | 'manual';
  /** feições pintadas no mapa (áreas da cultura, se houver, senão talhões base); sem situação = a plantar */
  contagem: Record<StatusPlantio, number>;
  total: number;
  /** % de plantados (0..100) no total; null se total = 0 */
  pct: number | null;
  /** talhões com plantio manual efetivo (sem registro do PIMS) */
  manuais: number;
  /** data/hora do plantio.json quando fonte = 'pims' */
  geradoEm: string | null;
  /** entra no resumo da safra (tem PIMS, plantio manual ou áreas da cultura) */
  participa: boolean;
}

export interface EntradaResumoPlantio {
  arquivo: PlantioPimsArquivo | null;
  safra: Safra;
  fazenda: Fazenda;
  /** talhões base da fazenda */
  talhoes: Talhao[];
  /** áreas da cultura da safra × fazenda */
  areas: AreaCultura[];
  /** plantios gravados da safra (todas as fazendas; os de outros talhões são ignorados) */
  plantios: Plantio[];
}

export function resumoPlantioFazenda({ arquivo, safra, fazenda, talhoes, areas, plantios }: EntradaResumoPlantio): ResumoPlantioFazenda {
  const casado = arquivo ? casarPlantio(arquivo, safra, fazenda, talhoes, areas) : null;
  const pims = casado?.porCodigo ?? null;
  const manuaisGravados = plantios.filter((p) => p.origem !== 'pims');
  const efetivos = combinarPlantios(pims, manuaisGravados, talhoes, safra.id);
  const sit = situacaoDoMapa(talhoes, areas, efetivos, pims);
  const total = sit.usaAreas ? areas.length : talhoes.length;
  const contagem = { ...sit.contagem };
  contagem.a_plantar = Math.max(0, total - contagem.plantado - contagem.plantando);
  const manuais = efetivos.filter((p) => p.origem === 'manual').length;
  return {
    fonte: casado ? 'pims' : 'manual',
    contagem,
    total,
    pct: total > 0 ? (contagem.plantado / total) * 100 : null,
    manuais,
    geradoEm: casado?.geradoEm ?? null,
    participa: casado !== null || manuais > 0 || areas.length > 0,
  };
}

/** "PIMS 28/09 07:05" (fuso do navegador); sem data ou inválida → ''. */
export function textoPims(geradoEm: string | null | undefined): string {
  const data = fmtDataHora(geradoEm, true);
  return data ? `PIMS ${data}` : '';
}

/** "15 plantados · 2 plantando · 16 a plantar" */
export function textoContagem(c: Record<StatusPlantio, number>): string {
  return resumoContagem(c, null);
}

export function textoManuais(n: number): string {
  return `${n} ${n === 1 ? 'marcado manualmente' : 'marcados manualmente'}`;
}

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface ResumoAreas {
  quantidade: number;
  ha: number;
  texto: string;
}

/** "33 áreas importadas (1.234,5 ha)" ou "Nenhuma área importada". */
export function resumoAreas(areas: AreaCultura[]): ResumoAreas {
  const quantidade = areas.length;
  const ha = areas.reduce((s, a) => s + (Number.isFinite(a.areaHa) ? a.areaHa : 0), 0);
  if (quantidade === 0) return { quantidade, ha: 0, texto: 'Nenhuma área importada' };
  const rotulo = quantidade === 1 ? 'área importada' : 'áreas importadas';
  return { quantidade, ha, texto: `${quantidade} ${rotulo} (${fmtHa(ha)} ha)` };
}

export interface ResumoSafra {
  plantados: number;
  plantando: number;
  total: number;
  pct: number | null;
  texto: string;
}

/** Soma as fazendas que participam da safra: "Plantio da safra: 19% (17 de 90 talhões)". */
export function resumoSafra(linhas: ResumoPlantioFazenda[]): ResumoSafra {
  let plantados = 0;
  let plantando = 0;
  let total = 0;
  for (const l of linhas) {
    if (!l.participa) continue;
    plantados += l.contagem.plantado;
    plantando += l.contagem.plantando;
    total += l.total;
  }
  if (total === 0) return { plantados, plantando, total, pct: null, texto: 'Plantio da safra: sem talhões com plantio' };
  const pct = (plantados / total) * 100;
  const pctTexto = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
  return { plantados, plantando, total, pct, texto: `Plantio da safra: ${pctTexto} (${plantados} de ${total} ${total === 1 ? 'talhão' : 'talhões'})` };
}
