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

/** Apontamento de uma safra anterior: só o total do dia (comparativo do gráfico diário). */
export interface ApontamentoHistScript {
  op: 'PLANTIO' | 'COLHEITA';
  d: string;
  a: number;
}

export interface LinhaHistScript {
  safra: string;
  unidade: string;
  gerado_em: string;
  talhoes: [];
  apontamentos: ApontamentoHistScript[];
}

/** Chuva diária de uma fazenda (ZEUS): safra 'CHUVA', `a` = mm do dia. */
export interface LinhaChuvaScript {
  safra: 'CHUVA';
  unidade: string;
  gerado_em: string;
  talhoes: [];
  apontamentos: { op: 'CHUVA'; d: string; a: number }[];
}

export interface AcompanhamentoScript {
  geradoEm: string;
  safras: string[];
  anteriores?: string[];
  chuva?: number;
  linhas: (LinhaAcompScript | LinhaHistScript | LinhaChuvaScript)[];
}

type Resultado = { columns: string[]; rows: unknown[][] };

export function montarSqlAcompanhamento(safras: string[]): { talhoes: string; plantio: string; colheita: string };
export function limparVariedade(v: string | null | undefined): string | null;
export function primeiroNome(s: string | null | undefined): string;
export function linhasAcompanhamento(
  r: { talhoes: Resultado; plantio: Resultado; colheita: Resultado },
  geradoEm: string,
): LinhaAcompScript[];
export function culturaDaSafra(nome: string): string;
export function safrasAnteriores(atuais: string[], todas: string[], anos?: number): string[];
export function unidadeDaFazendaZeus(nome: string): string;
export function inicioChuva(agora?: Date, anos?: number): string;
export function montarSqlChuva(desde: string): string;
export function linhasChuva(r: Resultado, geradoEm: string, unidades: string[]): LinhaChuvaScript[];
export function montarSqlHistorico(safras: string[]): string;
export function linhasHistorico(r: Resultado, geradoEm: string, atuais?: string[]): LinhaHistScript[];
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
export interface PicZeusScript { id: string; nome: string; lat: number; lon: number }
export interface PicChuvaScript extends PicZeusScript { chuva: number | null; leituras: number }
export interface ChuvaPicsScript {
  fazenda: string;
  de: string;
  ate: string;
  /** 'hh:mm'; só no pedido com hora */
  deHora?: string;
  ateHora?: string;
  ultimoDia: string | null;
  /** 'aaaa-mm-ddThh:mm' da última leitura do período (hora da fazenda) */
  ultimaLeitura: string | null;
  pics: PicChuvaScript[];
}
export const CHUVA_PICS_MAX_DIAS: number;
export const SQL_PICS_ZEUS: string;
export function validarPeriodoChuva(de: unknown, ate: unknown, deHora?: unknown, ateHora?: unknown): { de: string; ate: string; dias: number; deHora?: string; ateHora?: string };
export function picsDaFazendaZeus(r: Resultado, fazenda: string): PicZeusScript[];
export function fazendasDaZeus(r: Resultado): string[];
export function montarSqlChuvaPics(ids: string[], de: string, ate: string, deHora?: string | null, ateHora?: string | null): string;
export function montarChuvaPics(pics: PicZeusScript[], r: Resultado): { pics: PicChuvaScript[]; ultimoDia: string | null; ultimaLeitura: string | null };
export const ZEUS_ULTIMO_DIA_JANELA: number;
export const SQL_ULTIMO_DIA_ZEUS: string;
/** linha de mapas_zeus_situacao (supabase/coa-web/0004_situacao_zeus.sql) */
export interface LinhaSituacaoZeus { fazenda: string; ultimo_dia: string; /** 'aaaa-mm-ddThh:mm:ss' (hora da fazenda) */ ultima_leitura: string | null; conferido_em: string }
export function linhasSituacaoZeus(res: { columns: string[]; rows: unknown[][] }, agora?: Date): LinhaSituacaoZeus[];
export function ultimoDiaZeus(opcoes: { url: string; token: string; fetchImpl?: FetchLike; agora?: Date }): Promise<LinhaSituacaoZeus[]>;
export function chuvaPorPicZeus(opcoes: {
  url: string;
  token: string;
  fazenda: string;
  de: string;
  ate: string;
  deHora?: string | null;
  ateHora?: string | null;
  fetchImpl?: FetchLike;
}): Promise<ChuvaPicsScript>;
export interface BoletinsMecScript { unidade: string; de: string; ate: string; cabecalho: string[]; linhas: string[][] }
export const MEC_MAX_DIAS: number;
export const MEC_CABECALHO: string[];
export function validarPedidoMec(unidade: unknown, de: unknown, ate: unknown): { unidade: string; de: string; ate: string; dias: number };
export function montarSqlMecanizadas(unidade: string, de: string, ate: string, pular?: number, tamanho?: number): string;
export function fmtHrKm(v: unknown): string;
export function linhasMecanizadas(objs: Record<string, unknown>[]): string[][];
export function boletinsMecanizadas(opcoes: { url: string; token: string; unidade: string; de: string; ate: string; fetchImpl?: FetchLike }): Promise<BoletinsMecScript>;
export function rodarAcompanhamento(opcoes: {
  agrovex: { url: string; token: string; safras: 'auto' | string[]; excluirPrefixos?: string[] };
  supabase: { url: string; chave: string };
  fetchImpl?: FetchLike;
}): Promise<string | null>;
