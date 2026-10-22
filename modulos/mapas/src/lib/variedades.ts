/**
 * Regras do mapa de variedade, sem tela: limpeza do nome que vem do PIMS, a variedade de cada feição pintada
 * (talhão base, ou área da cultura quando a safra tem áreas), a cor fixa por variedade, o resumo da legenda,
 * os textos automáticos e o CSV dos talhões.
 */
import { normalizarCodigo } from './codigoTalhao';
import { fmtData } from './format';
import type { AreaCultura, Fazenda, ItemVariedade, LayoutTextos, Plantio, PlantioPimsTalhao, PopulacaoVariedade, ResumoChuva, ResumoVariedades, Safra, Talhao, VariedadePims } from './types';

export const SEM_VARIEDADE = 'Sem variedade';
export const COR_SEM_VARIEDADE = '#B5B5B5';
export const TITULO_VARIEDADES = 'Variedades';
export const TITULO_MAPA_VARIEDADE = 'MAPA DE VARIEDADES';

/**
 * 20 cores bem diferentes entre si (Tableau 20 sem os cinzas, que ficam para "Sem variedade"): as 10 primeiras
 * fortes, as outras 10 claras. A variedade nova pega a primeira que nenhuma outra usa.
 */
export const PALETA_VARIEDADES: readonly string[] = [
  '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#17BECF', '#BCBD22', '#393B79',
  '#AEC7E8', '#FFBB78', '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94', '#F7B6D2', '#9EDAE5', '#DBDB8D', '#637939',
];

/**
 * Mesma limpeza do Operacional (scripts/sincronizar-plantio.mjs → limparVariedade): tira "SEMENTE [DE] <cultura>"
 * do começo e a cultura do fim. Vazio e "A DEFINIR" (marcador do PIMS para variedade não informada) → null.
 */
export function limparVariedade(v: string | null | undefined): string | null {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const limpo = t
    .replace(/^SEMENTE\s+(DE\s+)?(SOJA|MILHO|ALGODAO|SORGO|MILHETO)\s+/i, '')
    .replace(/\s+(SOJA|MILHO|ALGODAO)$/i, '')
    .trim();
  if (!limpo || /^A\s*DEFINIR$/i.test(limpo)) return null;
  return limpo;
}

/** Chave da cor: maiúsculas, um espaço só. */
export function chaveVariedade(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Uma feição pintada no mapa de variedade: talhão base, ou área da cultura quando a safra tem áreas. */
export interface FeicaoVariedade {
  /** id do talhão base ou da área da cultura (o mesmo id que o desenho pinta) */
  id: string;
  /** rótulo do talhão (nome do shape; na área da cultura, o do talhão base de mesmo código, ou o código) */
  nome: string;
  setor: string | null;
  areaHa: number;
  /** variedade limpa; null = sem variedade */
  variedade: string | null;
}

/**
 * Variedade de cada feição. Sem áreas da cultura: os talhões base, pela variedade do plantio efetivo (o PIMS
 * prevalece sobre o manual) ou do PIMS pelo código. Com áreas: as áreas, pela variedade do PIMS de mesmo código
 * (ou a do talhão base), com o nome e o setor do talhão base — a mesma regra de `situacaoDoMapa`.
 */
export function feicoesDoMapa(
  talhoes: Talhao[],
  areas: AreaCultura[],
  efetivos: Plantio[],
  pims: Map<string, PlantioPimsTalhao> | null,
): FeicaoVariedade[] {
  const doEfetivo = new Map(efetivos.map((p) => [p.talhaoId, p.variedade]));
  if (areas.length === 0) {
    return talhoes.map((t) => {
      const codigo = normalizarCodigo(t.codigo);
      const bruta = doEfetivo.get(t.id) ?? (codigo ? pims?.get(codigo)?.variedade : null) ?? null;
      return { id: t.id, nome: t.nome, setor: t.setor, areaHa: t.areaHa, variedade: limparVariedade(bruta) };
    });
  }
  const basePorCodigo = new Map<string, Talhao>();
  for (const t of talhoes) {
    const codigo = normalizarCodigo(t.codigo);
    if (codigo && !basePorCodigo.has(codigo)) basePorCodigo.set(codigo, t);
  }
  return areas.map((a) => {
    const codigo = normalizarCodigo(a.codigo);
    const base = codigo ? basePorCodigo.get(codigo) : undefined;
    const bruta = (codigo ? pims?.get(codigo)?.variedade : null) ?? (base ? doEfetivo.get(base.id) : null) ?? null;
    return { id: a.id, nome: base?.nome ?? a.codigo, setor: base?.setor ?? null, areaHa: a.areaHa, variedade: limparVariedade(bruta) };
  });
}

/** Cores do cadastro com as de um mapa salvo por cima (o mapa reaberto mostra as cores do dia em que foi salvo). */
export function juntarCores(cadastro: ReadonlyMap<string, string>, fixas: Record<string, string> | null | undefined): Map<string, string> {
  const out = new Map(cadastro);
  for (const [k, cor] of Object.entries(fixas ?? {})) out.set(k, cor);
  return out;
}

/** Chaves das variedades das feições sem cor, da maior área para a menor ("Sem variedade" fica de fora). */
export function variedadesSemCor(feicoes: FeicaoVariedade[], cores: ReadonlyMap<string, string>): string[] {
  const area = new Map<string, number>();
  for (const f of feicoes) {
    if (!f.variedade) continue;
    const k = chaveVariedade(f.variedade);
    if (!cores.has(k)) area.set(k, (area.get(k) ?? 0) + f.areaHa);
  }
  return [...area].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([k]) => k);
}

/**
 * A primeira cor da paleta que nenhuma variedade usa; esgotada a paleta, volta ao começo: a cor menos usada,
 * na ordem da paleta (a 21ª variedade fica com a 1ª cor, a 22ª com a 2ª, e assim por diante).
 */
export function corAutomatica(usadas: Iterable<string>): string {
  const vezes = new Map(PALETA_VARIEDADES.map((c) => [c, 0]));
  for (const c of usadas) {
    const k = c.toUpperCase();
    const n = vezes.get(k);
    if (n !== undefined) vezes.set(k, n + 1);
  }
  let escolhida = PALETA_VARIEDADES[0];
  for (const c of PALETA_VARIEDADES) if (vezes.get(c)! < vezes.get(escolhida)!) escolhida = c;
  return escolhida;
}

/** Cores para as variedades novas, uma depois da outra (a cor que acabou de dar conta como usada). */
export function coresNovas(novas: string[], existentes: ReadonlyMap<string, string>): Map<string, string> {
  const usadas = [...existentes.values()];
  const out = new Map<string, string>();
  for (const k of novas) {
    const cor = corAutomatica(usadas);
    out.set(k, cor);
    usadas.push(cor);
  }
  return out;
}

// ---------------------------------------------------------------- nome comercial (Mapas → Cadastros → Variedades)

/** "Bônus (80I82 IPRO)": o nome comercial com o nome do PIMS entre parênteses; sem nome comercial, só o do PIMS. */
export function nomeExibido(nomePims: string, comercial: string | null | undefined): string {
  const c = (comercial ?? '').trim();
  return c ? `${c} (${nomePims})` : nomePims;
}

/** chave da variedade → nome comercial (só as que têm). */
export function comerciaisDe(lista: readonly VariedadePims[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of lista) if (v.nomeComercial && v.nomeComercial.trim()) out.set(v.chave, v.nomeComercial.trim());
  return out;
}

/** Em uso nas safras atuais e sem nome comercial: as que a tela Variedades e o mapa pedem para cadastrar. */
export function emUsoSemNome(lista: readonly VariedadePims[]): VariedadePims[] {
  return lista.filter((v) => v.emUso && !(v.nomeComercial ?? '').trim()).sort((a, b) => b.talhoes - a.talhoes || a.chave.localeCompare(b.chave, 'pt-BR'));
}

/**
 * Chaves das variedades novas sem nome comercial: as que a rotina viu pela primeira vez mais de um dia depois da
 * primeira leitura do cadastro (na primeira leitura todas entram juntas; essas não contam como novas).
 */
export function novasSemNome(lista: readonly VariedadePims[]): Set<string> {
  const tempos = lista.map((v) => Date.parse(v.vistoEm)).filter(Number.isFinite);
  if (!tempos.length) return new Set();
  const corte = Math.min(...tempos) + 86_400_000;
  return new Set(lista.filter((v) => !(v.nomeComercial ?? '').trim() && Date.parse(v.vistoEm) > corte).map((v) => v.chave));
}

/** Variedades do mapa (pela legenda) sem nome comercial, da maior área para a menor. */
export function semNomeNoMapa(resumo: ResumoVariedades, comerciais: ReadonlyMap<string, string>): string[] {
  return resumo.itens.filter((i) => i.chave && !comerciais.has(i.chave)).map((i) => i.nome);
}

/**
 * Resumo da legenda: área e % por variedade, da maior para a menor, com "Sem variedade" (cinza) por último. Com
 * `comerciais`, o nome de cada variedade sai como "Nome comercial (nome do PIMS)" (nomeExibido).
 */
export function resumoVariedades(
  feicoes: FeicaoVariedade[],
  cores: ReadonlyMap<string, string>,
  comerciais?: ReadonlyMap<string, string>,
  populacao?: ReadonlyMap<string, PopulacaoVariedade>,
): ResumoVariedades {
  const grupos = new Map<string, ItemVariedade>();
  let totalHa = 0;
  for (const f of feicoes) {
    totalHa += f.areaHa;
    const chave = f.variedade ? chaveVariedade(f.variedade) : '';
    const g = grupos.get(chave) ?? {
      chave,
      nome: f.variedade ? nomeExibido(f.variedade, comerciais?.get(chave)) : SEM_VARIEDADE,
      nomePims: f.variedade || SEM_VARIEDADE,
      comercial: (f.variedade && comerciais?.get(chave)) || '',
      sementesMetro: (chave ? populacao?.get(chave)?.sementesMetro : null) ?? null,
      populacao: (chave ? populacao?.get(chave)?.populacao : null) ?? null,
      cor: chave ? (cores.get(chave) ?? COR_SEM_VARIEDADE) : COR_SEM_VARIEDADE,
      areaHa: 0,
      pct: 0,
      talhoes: 0,
    };
    g.areaHa += f.areaHa;
    g.talhoes += 1;
    grupos.set(chave, g);
  }
  const itens = [...grupos.values()]
    .map((g) => ({ ...g, pct: totalHa > 0 ? (100 * g.areaHa) / totalHa : 0 }))
    .sort((a, b) => Number(a.chave === '') - Number(b.chave === '') || b.areaHa - a.areaHa || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { totalHa, itens };
}

/** Cor de cada feição (id → cor), para o desenho. */
export function coresDasFeicoes(feicoes: FeicaoVariedade[], resumo: ResumoVariedades): Map<string, string> {
  const porChave = new Map(resumo.itens.map((i) => [i.chave, i.cor]));
  return new Map(feicoes.map((f) => [f.id, porChave.get(f.variedade ? chaveVariedade(f.variedade) : '') ?? COR_SEM_VARIEDADE]));
}

/**
 * As duas colunas de nome da tabela de variedades (legenda do mapa e tela): nome comercial ('' = sem) e nome do
 * PIMS. Resumo gravado antes do nome comercial (sem `nomePims`): o nome mostrado vai na coluna do PIMS.
 */
export function colunasNomeVariedade(i: ItemVariedade): { comercial: string; pims: string } {
  return { comercial: (i.comercial ?? '').trim(), pims: i.nomePims ?? i.nome };
}

// ---------------------------------------------------------------- sementes por metro e população

/**
 * Unidade e safra do PIMS de uma fazenda e safra do Mapas, como o Operacional grava (acomp_pims): unidade do
 * PIMS e nome da safra no PIMS (ou o próprio nome), em maiúsculas. null = fazenda sem vínculo com o PIMS.
 */
export function chavesPimsDoMapa(fazenda: Pick<Fazenda, 'unidadePims'> | null, safra: Pick<Safra, 'nome' | 'nomePims'> | null): { unidade: string; safra: string } | null {
  const unidade = (fazenda?.unidadePims ?? '').trim().toUpperCase();
  const nomeSafra = (safra?.nomePims || safra?.nome || '').trim().toUpperCase();
  return unidade && nomeSafra ? { unidade, safra: nomeSafra } : null;
}

/** chave da variedade → valores (só as linhas com algum valor). */
export function populacaoPorChave(linhas: readonly PopulacaoVariedade[]): Map<string, PopulacaoVariedade> {
  const out = new Map<string, PopulacaoVariedade>();
  for (const l of linhas) if (l.sementesMetro !== null || l.populacao !== null) out.set(chaveVariedade(l.variedade), l);
  return out;
}

/**
 * Número digitado em português: "12,2" → 12.2; "244.000" ou "244000" → 244000; vazio → null; texto que não é
 * número → NaN. Ponto seguido de 3 dígitos é milhar ("244.000"); com 1 ou 2, decimal ("12.2").
 */
export function lerNumeroBr(texto: string | null | undefined): number | null {
  let t = String(texto ?? '').replace(/\s+/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(,\d+)?$/.test(t)) t = t.replace(',', '.');
  else if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** O que pode ser digitado nos campos de sementes e população: só algarismos, vírgula e ponto (o resto some). */
export function soNumeroDigitado(texto: string): string {
  return texto.replace(/[^\d.,]/g, '');
}

/** População abaixo disto foi digitada em mil plantas ("244" = 244.000 plantas por hectare). */
const POPULACAO_EM_MIL = 1000;

/**
 * Confere os dois campos com os limites do banco: sementes/m entre 0 e 100; população de 1.000 a 2.000.000 plantas
 * por hectare. População digitada em mil plantas ("244" ou "244,5") vale vezes mil.
 */
export function validarPopulacao(sementes: string, populacao: string): { sementesMetro: number | null; populacao: number | null; erro: null } | { erro: string; campo: 'sementes' | 'populacao' } {
  const s = lerNumeroBr(sementes);
  const lida = lerNumeroBr(populacao);
  const p = lida !== null && !Number.isNaN(lida) && lida > 0 && lida < POPULACAO_EM_MIL ? lida * 1000 : lida;
  if (s !== null && (Number.isNaN(s) || s <= 0 || s >= 100)) return { erro: 'Sementes por metro: use um número entre 0 e 100, como 12,2.', campo: 'sementes' };
  if (p !== null && (Number.isNaN(p) || p < 1000 || p > 2_000_000)) return { erro: 'População: use plantas por hectare, entre 1.000 e 2.000.000, como 244.000.', campo: 'populacao' };
  return { sementesMetro: s === null ? null : Math.round(s * 100) / 100, populacao: p === null ? null : Math.round(p), erro: null };
}

/** "12,2" (uma casa, ou duas quando há); '' sem valor. */
export function fmtSementes(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** "244.000"; '' sem valor. */
export function fmtPopulacao(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : Math.round(v).toLocaleString('pt-BR');
}

/** Algum item do resumo com sementes por metro ou população (a tabela do mapa ganha as duas colunas). */
export function temPopulacao(resumo: ResumoVariedades): boolean {
  return resumo.itens.some((i) => (i.sementesMetro ?? null) !== null || (i.populacao ?? null) !== null);
}

/** "24,3" (uma casa) ou "0,4"; o % das tabelas de variedades. */
export function fmtPctVariedade(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/** "1.234" (sem casa acima de 100 ha) ou "12,3". */
export function fmtAreaHa(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: v < 100 ? 1 : 0 });
}

/** "84KA92 CE — 1.234 ha (32%)"; abaixo de 1%, uma casa ("0,4%"). */
export function textoItemVariedade(i: ItemVariedade): string {
  const pct = i.pct > 0 && i.pct < 1 ? i.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : String(Math.round(i.pct));
  return `${i.nome} — ${fmtAreaHa(i.areaHa)} ha (${pct}%)`;
}

export interface EntradaTextosVariedade {
  fazenda: string;
  safra: Safra | null;
  /** null = todos os setores */
  setores: string[] | null;
  hoje: Date;
}

/** Textos automáticos do mapa de variedade (sem período; fonte PIMS). */
export function textosAutomaticosVariedade(e: EntradaTextosVariedade): LayoutTextos {
  return {
    titulo: TITULO_MAPA_VARIEDADE,
    fazenda: e.fazenda.toUpperCase(),
    safra: e.safra?.nome ?? '',
    periodo: '',
    fonte: 'PIMS',
    talhoes: 'TODOS',
    setor: e.setores && e.setores.length ? e.setores.join(', ') : 'TODOS',
    observacao: '',
    data: fmtData(e.hoje),
  };
}

/** Resumo gravado no mapa de variedade salvo (a coluna resumo não aceita nulo): chuva zerada, variedades junto. */
export function resumoDoMapaVariedade(r: ResumoVariedades): ResumoChuva {
  return { geral: { media: 0, min: 0, max: 0, areaHa: r.totalHa }, plantado: null, talhoes: [], variedades: r };
}

/**
 * CSV para o Excel em português: Talhão;Setor;Variedade;Nome comercial;Área (ha), pela ordem do nome do talhão
 * (o nome comercial vem do cadastro de Variedades; vazio quando a variedade não tem).
 */
export function csvVariedadePorTalhao(feicoes: FeicaoVariedade[], comerciais?: ReadonlyMap<string, string>): string {
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = [...feicoes]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map((f) => [
      esc(f.nome), esc(f.setor ?? ''), esc(f.variedade ?? SEM_VARIEDADE),
      esc((f.variedade && comerciais?.get(chaveVariedade(f.variedade))) || ''), f.areaHa.toFixed(2).replace('.', ','),
    ].join(';'));
  return ['Talhão;Setor;Variedade;Nome comercial;Área (ha)', ...linhas].join('\r\n');
}
