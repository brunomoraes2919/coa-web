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

/** único host para onde o token do Agrovex pode ser enviado */
export const AGROVEX_HOST: string;
/** confere o endereço do Agrovex (https, só AGROVEX_HOST) e devolve-o normalizado; qualquer outro lança erro */
export function conferirUrlAgrovex(url: unknown): string;
export function normalizarCodigo(s: string | null | undefined): string;
/** linhas por página das consultas paginadas (o Agrovex corta o resultado em 5.000) */
export const PAGINA_CONSULTA: number;
/** teto de páginas de uma consulta paginada */
export const PAGINAS_MAX: number;
/** sem `pular`, a consulta inteira (sem paginar); com `pular`, a página que começa nessa linha */
export function montarSql(nomeSafra: string, pular?: number | null, tamanho?: number): string;
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
/** prazo (ms) de uma leitura e de uma gravação no Supabase */
export const SUPABASE_LEITURA_MS: number;
export const SUPABASE_GRAVACAO_MS: number;
/** o fetch ao Supabase, com prazo; prazo estourado vira erro com `acao` no texto */
export function chamarSupabase(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
  acao?: string,
): Promise<Response>;
/** o que a linha de comando pede: gravar no Supabase ou, só com --local / PLANTIO_LOCAL=1, o modo local; variável faltando lança erro */
export function modoDeExecucao(
  args?: string[],
  env?: Record<string, string | undefined>,
): { local: boolean; token: string; supabaseUrl: string; supabaseChave: string };

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

export function montarSqlAcompanhamento(safras: string[], pular?: number | null, tamanho?: number): { talhoes: string; plantio: string; colheita: string };
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
export function montarSqlChuva(desde: string, pular?: number | null, tamanho?: number): string;
export function linhasChuva(r: Resultado, geradoEm: string, unidades: string[]): LinhaChuvaScript[];
export function montarSqlHistorico(safras: string[], pular?: number | null, tamanho?: number): string;
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

/** pluviômetro de chuva_talhao: `d` lista os dias com leitura ('n' ou 'n:mm', n = dias desde `inicio`) */
export interface PicChuvaTalhao { id: string; n: string; lat: number | null; lon: number | null; ul: string | null; d: string }
/** chuva de um talhão: primeiro e último dia com registro e os dias com chuva ('n:mm') */
export interface TalhaoChuva { de: number; ate: number; d: string }
export interface CicloChuva { s: string; p: string; de: string; ate: string; t: string[] }
export interface LinhaChuvaTalhao {
  unidade: string; gerado_em: string; inicio: string; dias: number; ultimo_dia: string | null; lidos: string;
  talhoes: Record<string, TalhaoChuva>; ciclos: CicloChuva[];
  ultima_leitura: string | null; pics: PicChuvaTalhao[]; vinculos: Record<string, number[]>;
}
type ResultadoConsulta = { columns: string[]; rows: unknown[][] };
export const CHUVA_TALHAO_SAFRAS_ANTES: number;
/** os vínculos inteiros, sem paginar (= montarSqlVinculosZeus()) */
export const SQL_VINCULOS_ZEUS: string;
export function montarSqlVinculosZeus(pular?: number | null, tamanho?: number): string;
export function inicioChuvaTalhao(agora?: Date): string;
export function diasDaJanelaChuva(desde: string, agora?: Date): number;
export function safrasDaJanelaChuva(desde: string, agora?: Date): string[];
export function montarSqlChuvaTalhoes(desde: string, pular?: number | null, tamanho?: number): string;
export function montarSqlDiasChuvaTalhoes(desde: string): string;
export const CHUVA_CICLOS_PAGINA: number;
export function montarSqlCiclosChuva(safras: string[], pular?: number, tamanho?: number): string;
export interface CicloPims { unidade: string; safra: string; periodo: string; inicio: string; fim: string; talhoes: string[] }
export function ciclosDoPims(linhas: Record<string, unknown>[]): CicloPims[];
export function montarSqlChuvaDiariaPics(desde: string): string;
export function faixasDeDias(texto: string | null | undefined): string;
export function linhasChuvaTalhao(
  dados: { talhoes: ResultadoConsulta; diasComDado: ResultadoConsulta; ciclos: CicloPims[]; vinculos: ResultadoConsulta; chuva: ResultadoConsulta },
  desde: string, dias: number, geradoEm: string,
): LinhaChuvaTalhao[];
export function sincronizarChuvaTalhao(opcoes: { url: string; token: string; fetchImpl?: FetchLike; agora?: Date }): Promise<LinhaChuvaTalhao[]>;

/** limite de um talhão da ZEUS (datalake): GeoJSON MultiPolygon em lon/lat */
export interface GeometriaZeus { type: 'MultiPolygon'; coordinates: number[][][][] }
export interface TalhaoLimiteZeus { codigo: string; nome: string; id: number; area_ha: number; geom: GeometriaZeus }
export interface LinhaLimitesZeus { unidade: string; gerado_em: string; talhoes: TalhaoLimiteZeus[] }
export const LIMITES_ZEUS_PAGINA: number;
export const SQL_UNIDADES_LIMITES_ZEUS: string;
export function montarSqlLimitesZeus(fazenda: string, pular?: number, tamanho?: number): string;
export function montarSqlTalhoesComChuva(desde: string, pular?: number | null, tamanho?: number): string;
export function geometriaDoWkt(wkt: string | null | undefined, tolerancia?: number): GeometriaZeus | null;
export function areaHaDaGeometria(geom: GeometriaZeus): number;
export function linhasLimitesZeus(campos: Map<string, Record<string, unknown>[]>, comChuva: ResultadoConsulta, geradoEm: string): LinhaLimitesZeus[];
export function sincronizarLimitesZeus(opcoes: { url: string; token: string; fetchImpl?: FetchLike; agora?: Date }): Promise<LinhaLimitesZeus[]>;
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
export interface OrdemValidScript { os: number; eq: string; op: number | null; opn: string; s: 'A' | 'F'; ab: string | null; enc: string | null; pl: number; ex: number; nt: number; ult: string | null; ev?: [string, number][]; sa?: 1;
  tl?: [string, number][]; ap?: [string, number | null, string, number, string | null, string | null][] }
export interface LinhaValidScript {
  unidade: string;
  gerado_em: string;
  ordens: OrdemValidScript[];
  coordenadores: { eq: string; ab: number; n: number }[];
  depositos: { c: string; n: string; i?: number }[];
  estoque: Record<string, ItemSaldoScript[]>;
  boletins: BoletimValidScript[];
  extras: Record<string, Record<string, unknown>[]>;
  avisos: string[];
}
export interface ItemSaldoScript { c: string | null; n: string; q: number; u: string; o?: string; on?: string; oq?: number; od?: string }
export function itemDoSaldoSap(r: Record<string, unknown>): ItemSaldoScript;
export interface ItemBoletimScript { c: string; nm: string; q: number; u: string; dp: string | null; s?: number; ant?: number; pr?: string[] }
export interface BoletimValidScript {
  o: string; n: string; d: string | null; os: number | null; eq: string | null; sit: 'F' | 'P'; em: string | null;
  t?: number; p1?: string; ul?: string; m?: string[]; si?: 1; it: ItemBoletimScript[];
}
export function montarSqlBoletinsFalha(desde: string, pular?: number | null, tamanho?: number): string;
export function montarSqlBoletinsPendentes(desde: string, pular?: number | null, tamanho?: number): string;
export function montarSqlLogIntegracaoSap(boletins: unknown[], desde: string, pular?: number | null, tamanho?: number): string;
export function montarSqlSaldoItensSap(itens: unknown[], depositos: unknown[], pular?: number | null, tamanho?: number): string;
export function linhasBoletins(dados: {
  falhas?: Record<string, unknown>[];
  pendentes?: Record<string, unknown>[];
  logs?: Record<string, Map<string, { msg: string | null; n: number; primeira: string | null; ultima: string | null }>>;
  sap?: Record<string, { itens: Map<string, { nome: string; un: string; inativo: boolean }>; saldo: Map<string, number> }>;
  depositosSap?: Record<string, Map<string, { nome: string | null; inativo: boolean }>>;
}): Record<string, BoletimValidScript[]>;
export const VALID_DIAS_APONT: number;
export const VALID_DIAS_DOSE: number;
export const VALID_DOSE_TOLERANCIA: number;
export function diaAnterior(agora: Date, dias: number): string;
export function montarSqlApontamentosRecentes(desdeDia: string, pular?: number, tamanho?: number): string;
export function montarSqlNecessidadeValidacao(desde: string, pular?: number | null, tamanho?: number): string;
export function montarSqlDoseValidacao(desdeDia: string, pular?: number | null, tamanho?: number): string;
export function montarSqlColetorValidacao(desde: string, pular?: number | null, tamanho?: number): string;
export function linhasExtras(dados: {
  apontamentos?: Record<string, unknown>[];
  necessidade?: Record<string, unknown>[];
  dose?: Record<string, unknown>[];
  coletor?: Record<string, unknown>[];
}): Record<string, Record<string, Record<string, unknown>[]>>;
export const VALID_TOLERANCIA_HA: number;
export const SAP_EMPRESA_DA_UNIDADE: Record<string, string>;
/** a evolução inteira, sem paginar (= montarSqlEvolucaoValidacao()) */
export const SQL_EVOLUCAO_VALIDACAO: string;
export function montarSqlEvolucaoValidacao(pular?: number | null, tamanho?: number): string;
export const SQL_DEPOSITOS_PIMS: string;
export const SQL_DEPOSITOS_SAP: string;
export function inicioSafraValidacao(agora?: Date): string;
export function montarSqlOrdensValidacao(desde: string, pular?: number, tamanho?: number): string;
export function montarSqlCoordenadoresValidacao(desde: string): string;
export function montarSqlTalhoesValidacao(desde: string, pular?: number, tamanho?: number): string;
export function montarSqlApontamentosValidacao(desde: string, pular?: number, tamanho?: number): string;
export function montarSqlEstoqueSap(codigos: unknown[], pular?: number | null, tamanho?: number): string;
export function linhasValidacao(
  dados: {
    ordens: Record<string, unknown>[];
    evolucao: Record<string, unknown>[];
    coordenadores: Record<string, unknown>[];
    depositos: Record<string, unknown>[];
    talhoes?: Record<string, unknown>[];
    apontamentos?: Record<string, unknown>[];
    depositosSap?: Record<string, Map<string, { nome: string | null; inativo: boolean }>>;
    estoque?: Record<string, Record<string, ItemSaldoScript[]>>;
    boletins?: Record<string, BoletimValidScript[]>;
    extras?: Record<string, Record<string, Record<string, unknown>[]>>;
    avisos?: string[];
  },
  geradoEm: string,
): LinhaValidScript[];
export function depositosVinculados(vinculos: { unidade: string; deposito: string | null }[]): Record<string, Record<string, string[]>>;
export function lerVinculosValidacao(opcoes: { url: string; chave: string; fetch?: FetchLike }): Promise<{ unidade: string; deposito: string | null }[]>;
export function sincronizarValidacao(opcoes: { url: string; token: string; vinculos?: { unidade: string; deposito: string | null }[]; fetchImpl?: FetchLike; agora?: Date }): Promise<{ geradoEm: string; linhas: LinhaValidScript[]; avisos: string[] }>;
export function gravarValidacaoSupabase(dados: { geradoEm: string; linhas: LinhaValidScript[] }, opcoes: { url: string; chave: string; fetch?: FetchLike }): Promise<'ok' | 'vazio' | 'sem-tabela'>;
export function rodarValidacao(opcoes: { agrovex: { url: string; token: string }; supabase: { url: string; chave: string }; fetchImpl?: FetchLike; /** recebe o erro inteiro (para quem responde a um pedido escolher a mensagem pelo tipo) */ aoErro?: (e: unknown) => void }): Promise<string | null>;
export function rodarAcompanhamento(opcoes: {
  agrovex: { url: string; token: string; safras: 'auto' | string[]; excluirPrefixos?: string[] };
  supabase: { url: string; chave: string };
  fetchImpl?: FetchLike;
  /** recebe o erro inteiro (para quem responde a um pedido escolher a mensagem pelo tipo) */
  aoErro?: (e: unknown) => void;
}): Promise<string | null>;

// benchmark de previsão (aba "Benchmark" da Previsão do Tempo)
export interface PrevDia { d: string; mm: number; p: number | null; tx?: number | null; tn?: number | null }
export interface PrevObservado { unidade: string; dia: string; mm: number; pluviometros: number }
export const PREV_FONTES: string[];
export const PREV_HORA_FOTO: number;
export const PREV_ANTECEDENCIAS: number[];
export const PREV_MINIMO_PARES: number;
export const PREV_USER_AGENT: string;
export function diaMT(instante: string | number | Date): string;
export function horaMT(instante: string | number | Date): number;
export function somarDias(dia: string, n: number): string;
export function diasEntre(a: string, b: string): number;
export function inicioSafraMT(hoje: string): string;
export function pontosDasFazendas(res: { columns: string[]; rows: unknown[][] }, unidades: string[]): {
  pontos: Map<string, { lat: number; lon: number }>;
  fazendaDoPic: Map<string, string>;
};
export function montarSqlPrevisaoZeus(desde: string, pular?: number | null, tamanho?: number): string;
export function previsaoZeusPorFazenda(res: { columns: string[]; rows: unknown[][] }, fazendaDoPic: Map<string, string>): Map<string, PrevDia[]>;
export function urlVisualCrossing(ponto: { lat: number; lon: number }, chave: string): string;
export function previsaoVisualCrossing(json: unknown): PrevDia[];
export function urlMetNo(ponto: { lat: number; lon: number }): string;
export function previsaoMetNo(json: unknown): PrevDia[];
export function montarSqlObservadoZeus(de: string, ate: string): string;
export function observadoPorFazenda(res: { columns: string[]; rows: unknown[][] }, fazendaDoPic: Map<string, string>): PrevObservado[];
export function assinaturaDaPrevisao(porFazenda: Map<string, PrevDia[]>): string;
export interface PrevFoto { fonte: string; unidade: string; emitida_em: string; dias: PrevDia[] }
export interface PrevPar { fonte: string; unidade: string; dia: string; k: number; previsto: number; medido: number }
export interface PrevMetrica { unidade: string; periodo: string; fonte: string; antecedencia: number; n: number; erro_medio: number; vies: number; acerto: number }
export function paresDoBenchmark(previsoes: PrevFoto[], observado: PrevObservado[]): PrevPar[];
export function metricasDoBenchmark(pares: PrevPar[], hoje: string): PrevMetrica[];
export function rodarBenchmarkPrevisao(opcoes: {
  agrovex: { url: string; token: string };
  supabase: { url: string; chave: string };
  visualCrossingChave?: string;
  fetchImpl?: typeof fetch;
  agora?: Date;
}): Promise<string | null>;
