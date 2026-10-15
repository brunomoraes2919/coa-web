/**
 * Regras do mapa de variedade, sem tela: limpeza do nome que vem do PIMS, a variedade de cada feição pintada
 * (talhão base, ou área da cultura quando a safra tem áreas), a cor fixa por variedade, o resumo da legenda,
 * os textos automáticos e o CSV dos talhões.
 */
import { normalizarCodigo } from './codigoTalhao';
import { fmtData } from './format';
import type { AreaCultura, ItemVariedade, LayoutTextos, Plantio, PlantioPimsTalhao, ResumoChuva, ResumoVariedades, Safra, Talhao } from './types';

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

/** Resumo da legenda: área e % por variedade, da maior para a menor, com "Sem variedade" (cinza) por último. */
export function resumoVariedades(feicoes: FeicaoVariedade[], cores: ReadonlyMap<string, string>): ResumoVariedades {
  const grupos = new Map<string, ItemVariedade>();
  let totalHa = 0;
  for (const f of feicoes) {
    totalHa += f.areaHa;
    const chave = f.variedade ? chaveVariedade(f.variedade) : '';
    const g = grupos.get(chave) ?? {
      chave,
      nome: f.variedade ?? SEM_VARIEDADE,
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

/** CSV para o Excel em português: Talhão;Setor;Variedade;Área (ha), pela ordem do nome do talhão. */
export function csvVariedadePorTalhao(feicoes: FeicaoVariedade[]): string {
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = [...feicoes]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map((f) => [esc(f.nome), esc(f.setor ?? ''), esc(f.variedade ?? SEM_VARIEDADE), f.areaHa.toFixed(2).replace('.', ',')].join(';'));
  return ['Talhão;Setor;Variedade;Área (ha)', ...linhas].join('\r\n');
}
