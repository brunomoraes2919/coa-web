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

export interface LinhaSupabaseScript {
  safra: string;
  unidade: string;
  gerado_em: string;
  talhoes: TalhaoPimsScript[];
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
export function linhasDeLog(
  dados: PlantioPimsScript,
  opcoes?: { supabase?: boolean; githubActions?: boolean },
): string[];
export function linhasSupabase(arquivo: PlantioPimsScript): LinhaSupabaseScript[];
export function gravarSupabase(
  arquivo: PlantioPimsScript,
  opcoes: { url: string; chave: string; fetch: FetchLike },
): Promise<void>;
export function cabecalhosSupabase(chave: string): Record<string, string>;
export function semChave(texto: string, chave: string): string;

// ---- Acompanhamento Operacional (tabela acomp_pims) ----

export interface TalhaoAcompScript {
  setor: string | null;
  id: string | null;
  t: string | null;
  area: number;
  dano: number;
  variedade: string | null;
  enc: string | null;
}

export interface ApontamentoAcompScript {
  op: 'PLANTIO' | 'COLHEITA';
  id: string | null;
  t: string | null;
  d: string;
  a: number;
  eq: string | null;
  e: string;
  rep: boolean;
}

export interface LinhaAcompScript {
  safra: string;
  unidade: string;
  gerado_em: string;
  talhoes: TalhaoAcompScript[];
  apontamentos: ApontamentoAcompScript[];
}

export interface AcompanhamentoScript {
  geradoEm: string;
  safras: string[];
  linhas: LinhaAcompScript[];
}

type Resultado = { columns: string[]; rows: unknown[][] };

export function montarSqlAcompanhamento(safras: string[]): { talhoes: string; plantio: string; colheita: string };
export function limparVariedade(v: string | null | undefined): string | null;
export function primeiroNome(s: string | null | undefined): string;
export function linhasAcompanhamento(
  r: { talhoes: Resultado; plantio: Resultado; colheita: Resultado },
  geradoEm: string,
): LinhaAcompScript[];
export function sincronizarAcompanhamento(opcoes: {
  url: string;
  token: string;
  safras: 'auto' | string[];
  excluirPrefixos?: string[];
  fetchImpl?: FetchLike;
  agora?: Date;
}): Promise<AcompanhamentoScript>;
export function gravarAcompanhamentoSupabase(
  dados: AcompanhamentoScript,
  opcoes: { url: string; chave: string; fetch: FetchLike },
): Promise<'ok' | 'vazio' | 'sem-tabela'>;
export function logAcompanhamento(dados: AcompanhamentoScript, situacao: string): string;
export function rodarAcompanhamento(opcoes: {
  agrovex: { url: string; token: string; safras: 'auto' | string[]; excluirPrefixos?: string[] };
  supabase: { url: string; chave: string };
  fetchImpl?: FetchLike;
}): Promise<string | null>;
