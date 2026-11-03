/**
 * Mapa de dias sem chuva: a chuva diária de cada talhão no período filtrado (stg_field_data da ZEUS, pedida ao
 * servidor só no clique de Atualizar) vira, por talhão, quantos dias se passaram desde a última chuva até o dia de
 * referência (o último dia do período que a ZEUS tem). Puro: sem tela, para os testes.
 */
import { ETAPA_BUSCANDO_CHUVA, ETAPA_PEDINDO_CHUVA, type PassosChuva, type SituacaoPedidoChuva } from './chuvaZeus';
import { normalizarCodigo } from './codigoTalhao';
import { mensagemDeErro } from './erros';
import { fmtData, fmtPeriodo, parseIsoData } from './format';
import { aguardarPedido } from './pedidoPlantio';
import type { LayoutTextos, ResumoChuva, Talhao } from './types';

/** chuva a partir desta (mm no dia) conta como dia de chuva; abaixo, o dia segue seco (a mesma regra da Chuva por talhão) */
export const SECA_CHUVA_MIN = 1;
export const TITULO_SECA = 'Dias sem chuva (dias)';
export const TITULO_MAPA_SECA = 'MAPA DE DIAS SEM CHUVA';

export interface ClasseSeca {
  /** dias a partir dos quais o talhão cai nesta classe (até o min da seguinte, exclusive) */
  min: number;
  cor: string;
  texto: string;
}

/** A escala do mapa (a de referência do COA): cinza, amarelo, laranja claro, laranja e vermelho. */
export const CLASSES_SECA: readonly ClasseSeca[] = [
  { min: 0, cor: '#CCCCCC', texto: 'Menos de 4' },
  { min: 4, cor: '#F0F000', texto: '4 a 6' },
  { min: 6, cor: '#F7B300', texto: '6 a 8' },
  { min: 8, cor: '#FF8C00', texto: '8 a 10' },
  { min: 10, cor: '#E31A1C', texto: '10 ou mais' },
];
/** talhão sem nenhum dado da ZEUS no período */
export const COR_SEM_DADO = '#FFFFFF';
export const TEXTO_SEM_DADO = 'Sem dado da ZEUS';

/** Resposta do servidor (coluna dados do pedido de tipo 'talhoes'), como gravada. */
export interface DadosSeca {
  tipo: 'talhoes';
  fazenda: string;
  unidade: string;
  /** 'yyyy-mm-dd', inclusive */
  de: string;
  ate: string;
  /** faixas dos dias (n desde `de`) que a ZEUS tem na unidade: '0-12,15' */
  lidos: string;
  /** último dia da unidade na tabela da ZEUS (mesmo fora do período); null = nenhum */
  ultimoDia: string | null;
  /** código normalizado → 'n:mm,…' (só os dias com chuva); '' = talhão sem chuva no período */
  talhoes: Record<string, string>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o formato da resposta do servidor; lança Error se não for o esperado. */
export function lerDadosSeca(bruto: unknown): DadosSeca {
  const o = bruto as Partial<DadosSeca> | null;
  if (!o || typeof o !== 'object' || o.tipo !== 'talhoes' || !ISO.test(String(o.de)) || !ISO.test(String(o.ate)) || !o.talhoes || typeof o.talhoes !== 'object') {
    throw new Error('O servidor devolveu uma resposta que não foi possível ler. Se o servidor acabou de ser atualizado, tente de novo em alguns minutos.');
  }
  const talhoes: Record<string, string> = {};
  for (const [codigo, dias] of Object.entries(o.talhoes)) {
    if (typeof dias === 'string' && /^[0-9:.,]*$/.test(dias)) talhoes[codigo] = dias;
  }
  return {
    tipo: 'talhoes',
    fazenda: String(o.fazenda ?? ''),
    unidade: String(o.unidade ?? ''),
    de: String(o.de),
    ate: String(o.ate),
    lidos: typeof o.lidos === 'string' ? o.lidos : '',
    ultimoDia: typeof o.ultimoDia === 'string' && ISO.test(o.ultimoDia) ? o.ultimoDia : null,
    talhoes,
  };
}

/** '0-3,7' → [0, 1, 2, 3, 7] */
export function diasDasFaixas(faixas: string): number[] {
  const dias = new Set<number>();
  for (const parte of String(faixas ?? '').split(',')) {
    const m = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(parte);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    for (let n = a; n <= b && n - a <= 400; n++) dias.add(n);
  }
  return [...dias].sort((x, y) => x - y);
}

/** '2:0.74,4:17.68' → Map { 2 → 0.74, 4 → 17.68 } */
export function chuvaDosDias(texto: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const parte of String(texto ?? '').split(',')) {
    const [n, mm] = parte.split(':');
    const dia = Number(n);
    const v = Number(mm);
    if (n !== '' && Number.isInteger(dia) && dia >= 0 && Number.isFinite(v)) m.set(dia, (m.get(dia) ?? 0) + v);
  }
  return m;
}

/**
 * Família do talhão (código normalizado), para achar a chuva de um pedaço quando a ZEUS só tem o talhão inteiro, ou o
 * contrário: '019A' e '019' → '19'; '02PIVO' e '2PIVA' → '2PIVO'; os outros ficam como estão.
 */
export function familiaDoTalhao(codigo: string): string {
  const c = codigo.trim().toUpperCase();
  let m = /^0*(\d+)[A-Z]?$/.exec(c);
  if (m) return m[1] || '0';
  m = /^0*(\d+)PIV(?:O|[A-Z])$/.exec(c);
  return m ? `${m[1] || '0'}PIVO` : c;
}

const inteiro = (codigo: string) => /^\d+$/.test(codigo) || /^\d+PIVO$/.test(codigo);

/** Talhão do mapa → como a chuva dele foi achada na ZEUS. */
export type OrigemSeca = 'talhao' | 'inteiro' | 'pedacos';

export interface SecaTalhao {
  /** dias sem chuva no dia de referência; null = sem dado da ZEUS */
  dias: number | null;
  /** sem chuva em todo o período: `dias` é o mínimo (o período inteiro), pode ser mais */
  minimo: boolean;
  /** 'yyyy-mm-dd' da última chuva no período; null = nenhuma */
  ultimaChuva: string | null;
  /** mm da última chuva */
  mmUltima: number | null;
  /** chuva no período até o dia de referência (mm, uma casa) */
  total: number | null;
  origem: OrigemSeca | null;
}

export interface ResultadoSeca {
  /** dia de referência ('yyyy-mm-dd'): o último dia do período que a ZEUS tem; null = nenhum */
  referencia: string | null;
  /** id do talhão do mapa → resultado */
  porTalhao: Map<string, SecaTalhao>;
  /** dias do período (até a referência) que faltam na ZEUS */
  diasSemLeitura: number;
}

function somarDias(iso: string, n: number): string {
  const d = parseIsoData(iso) as Date;
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, '0')}-${String(r.getDate()).padStart(2, '0')}`;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Código do talhão do mapa: o normalizado do cadastro, ou o do nome. */
function codigoDoTalhao(t: Pick<Talhao, 'codigo' | 'nome'>): string {
  return t.codigo || normalizarCodigo(t.nome);
}

/**
 * Chuva de cada talhão do mapa a partir da resposta: o próprio código; senão o talhão inteiro da família ('019' para o
 * '019A'); senão a média, dia a dia, dos pedaços que a ZEUS tem ('019A' e '019B' para o '019'). null = nada na ZEUS.
 */
export function chuvaDoTalhao(dados: Pick<DadosSeca, 'talhoes'>, codigo: string, familias?: Map<string, string[]>): { serie: Map<number, number>; origem: OrigemSeca } | null {
  if (!codigo) return null;
  if (codigo in dados.talhoes) return { serie: chuvaDosDias(dados.talhoes[codigo]), origem: 'talhao' };
  const grupos = familias ?? agruparFamilias(dados);
  const parentes = grupos.get(familiaDoTalhao(codigo)) ?? [];
  if (!parentes.length) return null;
  const todo = parentes.find(inteiro);
  if (todo) return { serie: chuvaDosDias(dados.talhoes[todo]), origem: 'inteiro' };
  const soma = new Map<number, number>();
  for (const p of parentes) for (const [dia, mm] of chuvaDosDias(dados.talhoes[p])) soma.set(dia, (soma.get(dia) ?? 0) + mm);
  return { serie: new Map([...soma].map(([dia, mm]) => [dia, mm / parentes.length])), origem: 'pedacos' };
}

function agruparFamilias(dados: Pick<DadosSeca, 'talhoes'>): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const c of Object.keys(dados.talhoes).sort()) {
    const f = familiaDoTalhao(c);
    grupos.set(f, [...(grupos.get(f) ?? []), c]);
  }
  return grupos;
}

/**
 * Dias sem chuva de cada talhão no dia de referência = último dia do período que a ZEUS tem (dia que falta na tabela
 * não é dia seco: a referência nunca passa do que já chegou). Dias = referência − dia da última chuva (≥ 1 mm). Sem
 * chuva no período inteiro: o período até a referência, marcado como mínimo.
 */
export function calcularSeca(dados: DadosSeca, talhoes: readonly Pick<Talhao, 'id' | 'codigo' | 'nome'>[]): ResultadoSeca {
  const lidos = diasDasFaixas(dados.lidos);
  const ref = lidos.length ? lidos[lidos.length - 1] : null;
  const porTalhao = new Map<string, SecaTalhao>();
  const vazio: SecaTalhao = { dias: null, minimo: false, ultimaChuva: null, mmUltima: null, total: null, origem: null };
  const familias = agruparFamilias(dados);
  for (const t of talhoes) {
    const achada = ref === null ? null : chuvaDoTalhao(dados, codigoDoTalhao(t), familias);
    if (!achada || ref === null) {
      porTalhao.set(t.id, vazio);
      continue;
    }
    let ultima: number | null = null;
    let total = 0;
    for (const [dia, mm] of achada.serie) {
      if (dia > ref) continue;
      total += mm;
      if (mm >= SECA_CHUVA_MIN && (ultima === null || dia > ultima)) ultima = dia;
    }
    porTalhao.set(t.id, {
      dias: ultima === null ? ref + 1 : ref - ultima,
      minimo: ultima === null,
      ultimaChuva: ultima === null ? null : somarDias(dados.de, ultima),
      mmUltima: ultima === null ? null : r1(achada.serie.get(ultima) ?? 0),
      total: r1(total),
      origem: achada.origem,
    });
  }
  return { referencia: ref === null ? null : somarDias(dados.de, ref), porTalhao, diasSemLeitura: ref === null ? 0 : ref + 1 - lidos.length };
}

/** Índice da classe (CLASSES_SECA) de um número de dias. */
export function classeDaSeca(dias: number): number {
  let i = 0;
  for (let k = 0; k < CLASSES_SECA.length; k++) if (dias >= CLASSES_SECA[k].min) i = k;
  return i;
}

export function corDaSeca(s: SecaTalhao): string {
  return s.dias === null ? COR_SEM_DADO : CLASSES_SECA[classeDaSeca(s.dias)].cor;
}

/** "12 d", "≥ 30 d" (sem chuva no período inteiro) ou '' (sem dado). */
export function textoDiasSeca(s: SecaTalhao): string {
  if (s.dias === null) return '';
  return `${s.minimo ? '≥ ' : ''}${s.dias} d`;
}

/** Resumo do mapa (legenda, painel e mapa salvo). */
export interface ResumoSeca {
  de: string;
  ate: string;
  referencia: string | null;
  /** talhões por classe, na ordem de CLASSES_SECA */
  classes: number[];
  semDado: number;
  /** média dos dias dos talhões com dado (uma casa); null = nenhum */
  media: number | null;
  maior: number | null;
  talhoes: number;
  /** a resposta do servidor, para reabrir o mapa salvo sem pedir de novo */
  dados?: DadosSeca;
}

export function resumoDaSeca(r: ResultadoSeca, dados: DadosSeca): ResumoSeca {
  const classes = CLASSES_SECA.map(() => 0);
  let semDado = 0;
  let soma = 0;
  let n = 0;
  let maior: number | null = null;
  for (const s of r.porTalhao.values()) {
    if (s.dias === null) {
      semDado++;
      continue;
    }
    classes[classeDaSeca(s.dias)]++;
    soma += s.dias;
    n++;
    if (maior === null || s.dias > maior) maior = s.dias;
  }
  return { de: dados.de, ate: dados.ate, referencia: r.referencia, classes, semDado, media: n ? r1(soma / n) : null, maior, talhoes: r.porTalhao.size, dados };
}

/** Itens da legenda: título e as cinco classes (com quantos talhões), mais "Sem dado" quando houver. */
export function itensLegendaSeca(r: ResumoSeca): { texto: string; cor: string }[] {
  const qtd = (n: number) => (n ? ` · ${n} ${n === 1 ? 'talhão' : 'talhões'}` : '');
  const itens = CLASSES_SECA.map((c, i) => ({ texto: `${c.texto}${qtd(r.classes[i] ?? 0)}`, cor: c.cor }));
  if (r.semDado) itens.push({ texto: `${TEXTO_SEM_DADO}${qtd(r.semDado)}`, cor: COR_SEM_DADO });
  return itens;
}

const fmtIso = (iso: string | null) => {
  const d = parseIsoData(iso);
  return d ? fmtData(d) : '';
};

/** Textos automáticos do layout. */
export function textosAutomaticosSeca(e: { fazenda: string; de: string | null; ate: string | null; setores: string[] | null; hoje: Date }): LayoutTextos {
  return {
    titulo: TITULO_MAPA_SECA,
    fazenda: e.fazenda.toUpperCase(),
    safra: '',
    periodo: e.de && e.ate ? fmtPeriodo(parseIsoData(e.de), parseIsoData(e.ate)) : '',
    fonte: 'ZEUS',
    talhoes: 'TODOS',
    setor: e.setores && e.setores.length ? e.setores.join(', ') : 'TODOS',
    observacao: '',
    data: fmtData(e.hoje),
  };
}

/** Pares do painel do mapa de dias sem chuva. */
export function paresPainelSeca(r: ResumoSeca, t: LayoutTextos): { rotulo: string; valor: string }[] {
  return [
    { rotulo: 'Período', valor: t.periodo },
    { rotulo: 'Dias contados até', valor: r.referencia ? `${fmtIso(r.referencia)}${r.referencia < r.ate ? ' (último dia na ZEUS)' : ''}` : 'sem dado' },
    { rotulo: 'Fonte', valor: t.fonte },
    { rotulo: 'Talhões', valor: t.talhoes },
    { rotulo: 'Setor', valor: t.setor },
    { rotulo: 'Média', valor: r.media === null ? '' : `${String(r.media).replace('.', ',')} dias sem chuva` },
    { rotulo: 'Maior', valor: r.maior === null ? '' : `${r.maior} dias sem chuva` },
    { rotulo: 'Data', valor: t.data },
    { rotulo: 'Observação', valor: t.observacao },
  ];
}

/** Resumo gravado no mapa salvo (a coluna resumo não aceita nulo): chuva zerada, dias sem chuva junto. */
export function resumoDoMapaSeca(r: ResumoSeca): ResumoChuva {
  return { geral: { media: r.media ?? 0, min: 0, max: r.maior ?? 0, areaHa: 0 }, plantado: null, talhoes: [], seca: r };
}

/** CSV para o Excel em português: Talhão;Setor;Dias sem chuva;Última chuva;mm da última chuva;Chuva no período (mm). */
export function csvSecaPorTalhao(talhoes: readonly Pick<Talhao, 'id' | 'nome' | 'setor'>[], r: ResultadoSeca): string {
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const num = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
  const linhas = [...talhoes]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map((t) => {
      const s = r.porTalhao.get(t.id);
      const dias = !s || s.dias === null ? TEXTO_SEM_DADO : `${s.minimo ? '>= ' : ''}${s.dias}`;
      return [esc(t.nome), esc(t.setor ?? ''), dias, fmtIso(s?.ultimaChuva ?? null), num(s?.mmUltima ?? null), num(s?.total ?? null)].join(';');
    });
  return ['Talhão;Setor;Dias sem chuva;Última chuva;mm da última chuva;Chuva no período (mm)', ...linhas].join('\r\n');
}

export type FimSeca = { tipo: 'ok'; dados: DadosSeca } | { tipo: 'erro'; texto: string };

/**
 * Fluxo do botão Atualizar: grava o pedido (tipo 'talhoes'), espera o servidor responder e confere a resposta. Nunca
 * rejeita: devolve os dados ou o texto do erro.
 */
export async function buscarSecaZeus({ pedir, situacao, aoEtapa, opcoes }: PassosChuva): Promise<FimSeca> {
  aoEtapa?.(ETAPA_PEDINDO_CHUVA);
  let id: number;
  try {
    id = await pedir();
  } catch (e) {
    return { tipo: 'erro', texto: mensagemDeErro(e) };
  }
  aoEtapa?.(ETAPA_BUSCANDO_CHUVA);
  let ultima: SituacaoPedidoChuva | null = null;
  const fim = await aguardarPedido(async () => (ultima = await situacao(id)), opcoes);
  if (fim.tipo === 'erro') return { tipo: 'erro', texto: `O servidor não conseguiu buscar a chuva dos talhões: ${fim.mensagem}` };
  if (fim.tipo === 'tempo') return { tipo: 'erro', texto: 'O servidor não respondeu em 2 minutos. Tente de novo em instantes.' };
  try {
    return { tipo: 'ok', dados: lerDadosSeca((ultima as SituacaoPedidoChuva | null)?.dados) };
  } catch (e) {
    return { tipo: 'erro', texto: mensagemDeErro(e) };
  }
}

/**
 * Aviso depois de Atualizar: null = a ZEUS tem o período até o fim. Sem nenhum dia no período, o texto diz até quando
 * a tabela vai (e o mapa não sai); com o fim faltando, diz até quando os dias foram contados.
 */
export function avisoDaSeca(dados: DadosSeca, r: ResultadoSeca): { tipo: 'erro' | 'alerta'; texto: string } | null {
  const ultimo = dados.ultimoDia ? ` A tabela da ZEUS desta fazenda vai até ${fmtIso(dados.ultimoDia)} (ela é carregada em lotes).` : '';
  if (!r.referencia) return { tipo: 'erro', texto: `A ZEUS ainda não tem chuva por talhão desta fazenda entre ${fmtIso(dados.de)} e ${fmtIso(dados.ate)}.${ultimo}` };
  const partes: string[] = [];
  if (r.referencia < dados.ate) partes.push(`A ZEUS tem chuva por talhão até ${fmtIso(r.referencia)}: os dias sem chuva foram contados até esse dia.`);
  if (r.diasSemLeitura) partes.push(`${r.diasSemLeitura} ${r.diasSemLeitura === 1 ? 'dia do período falta' : 'dias do período faltam'} na tabela da ZEUS (contam como sem leitura, não como chuva).`);
  return partes.length ? { tipo: 'alerta', texto: partes.join(' ') } : null;
}
