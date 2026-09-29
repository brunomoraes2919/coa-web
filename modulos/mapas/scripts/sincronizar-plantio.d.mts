// Tipos do script scripts/sincronizar-plantio.mjs (usado pelos testes; o app lê o JSON gerado
// com os tipos PlantioPimsArquivo/PlantioPimsTalhao de src/lib/types.ts).

export type StatusPimsScript = 'plantado' | 'plantando' | 'a_plantar';

export interface TalhaoPimsScript {
  codigo: string;
  codigoPims: string;
  setor: string | null;
  status: StatusPimsScript;
  areaPrevista: number;
  areaPlantada: number;
  inicio: string | null;
  fim: string | null;
  variedade: string | null;
}

export interface PlantioPimsScript {
  versao: 1;
  geradoEm: string;
  fonte: string;
  safras: { nome: string; unidades: { unidade: string; talhoes: TalhaoPimsScript[] }[] }[];
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function normalizarCodigo(s: string | null | undefined): string;
export function montarSql(nomeSafra: string): string;
export function classificar(t: {
  areaPrevista: number | null;
  areaPlantada: number | null;
  plantioEncerrado: string | null;
}): StatusPimsScript;
export function safrasPadrao(hoje?: Date): string[];
export function filtrarSafras(nomes: string[], padroes: string[], excluirPrefixos?: string[]): string[];
export function sincronizar(opcoes: {
  url: string;
  token: string;
  safras: 'auto' | string[];
  excluirPrefixos?: string[];
  fetchImpl?: FetchLike;
  agora?: Date;
}): Promise<PlantioPimsScript>;
export function mesmosDados(antigo: PlantioPimsScript | null, novo: PlantioPimsScript): boolean;
export function resumo(dados: PlantioPimsScript): string[];
