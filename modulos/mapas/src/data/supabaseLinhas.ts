/**
 * Conversão entre o domínio (camelCase, src/lib/types.ts) e as linhas das tabelas do Supabase
 * (snake_case; geom/atributos/colunas/config/pics/resumo em colunas jsonb). Tudo puro.
 * Também completa registros antigos (anteriores ao plantio do PIMS e ao vínculo com o COA WEB) com
 * os campos novos.
 */
import { completarPlantio } from '../lib/plantioPims';
import type { AreaCultura, Fazenda, LinhaPlantioPims, MapaSalvo, Pic, Plantio, PlantioPimsTalhao, Safra, Talhao } from '../lib/types';

export { completarPlantio };

/**
 * Tabelas do módulo no Supabase do COA WEB (supabase/coa-web/0001_mapas.sql). As do COA WEB
 * (fazendas, perfis) são só lidas pelo repositório, pelo nome delas.
 */
export const TABELAS = {
  fazendas: 'mapas_fazendas',
  talhoes: 'mapas_talhoes',
  safras: 'mapas_safras',
  plantios: 'mapas_plantios',
  areasCultura: 'mapas_areas_cultura',
  mapas: 'mapas_chuva',
  plantioPims: 'mapas_plantio_pims',
  /** pedidos do botão "Atualizar plantio" (supabase/coa-web/0002_pedidos_plantio.sql) */
  pedidosPlantio: 'mapas_plantio_pedidos',
  /** pedidos do botão "Inserir dados via integração" (supabase/coa-web/0003_pedidos_chuva.sql) */
  pedidosChuva: 'mapas_chuva_pedidos',
  /** último dia da ZEUS no banco, por fazenda (supabase/coa-web/0004_situacao_zeus.sql) */
  situacaoZeus: 'mapas_zeus_situacao',
} as const;

/** Bucket privado com a imagem e a miniatura dos mapas salvos. */
export const BUCKET = 'mapas-chuva';

// ---------------------------------------------------------------------------------------------
// Compatibilidade: registros gravados antes do plantio do PIMS não têm os campos novos.
// ---------------------------------------------------------------------------------------------

/** Fazenda antiga: unidadePims/campoCodigo/coaFazendaId = null. */
export function completarFazenda(f: Fazenda): Fazenda {
  return { ...f, unidadePims: f.unidadePims ?? null, campoCodigo: f.campoCodigo ?? null, coaFazendaId: numeroOuNull(f.coaFazendaId) };
}

/** Talhão antigo: codigo = null. */
export function completarTalhao(t: Talhao): Talhao {
  return { ...t, codigo: t.codigo ?? null };
}

/** Safra antiga: nomePims = null. */
export function completarSafra(s: Safra): Safra {
  return { ...s, nomePims: s.nomePims ?? null };
}

function numeroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------------------------
// Serialização de Pic (Date -> ISO string em jsonb, e volta). Reaproveitada também para o backup
// JSON (exportarBackup/importarBackup), tanto pelo supabaseRepo quanto pelo localRepo.
// ---------------------------------------------------------------------------------------------

export interface PicSerializado extends Omit<Pic, 'inicio' | 'fim'> {
  inicio: string | null;
  fim: string | null;
}

function dataParaIso(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

/** Converte Date | null -> string ISO | null (para gravar em jsonb ou exportar como JSON puro). */
export function serializarPics(pics: Pic[]): PicSerializado[] {
  return pics.map((p) => ({ ...p, inicio: dataParaIso(p.inicio), fim: dataParaIso(p.fim) }));
}

function isoParaData(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Converte de volta string ISO | Date | null -> Date | null. Aceita entradas já revividas
 * (idempotente), o que permite usá-la tanto ao ler jsonb do Supabase quanto ao importar um
 * backup JSON (onde JSON.parse deixou as datas como string).
 */
export function reviverPics(pics: unknown[]): Pic[] {
  return pics.map((p) => {
    const o = p as Record<string, unknown>;
    const pic: Pic = {
      id: o.id as string,
      nome: o.nome as string,
      lat: o.lat as number,
      lon: o.lon as number,
      chuva: (o.chuva as number | null) ?? null,
      inativo: Boolean(o.inativo),
      inicio: isoParaData(o.inicio),
      fim: isoParaData(o.fim),
      incluir: Boolean(o.incluir),
    };
    // chuva do CSV de um PIC editado à mão (mapas salvos antes disso não têm o campo)
    if (o.chuvaOriginal !== undefined) pic.chuvaOriginal = (o.chuvaOriginal as number | null) ?? null;
    return pic;
  });
}

// ---------------------------------------------------------------------------------------------
// Linhas das tabelas
// ---------------------------------------------------------------------------------------------

export interface FazendaRow {
  id: string;
  nome: string;
  campo_nome: string;
  campo_setor: string | null;
  colunas: string[];
  criado_em: string;
  unidade_pims: string | null;
  campo_codigo: string | null;
  /** fazendas.id do COA WEB (bigint) */
  coa_fazenda_id: number | null;
}

export function fazendaParaRow(f: Fazenda): FazendaRow {
  return {
    id: f.id,
    nome: f.nome,
    campo_nome: f.campoNome,
    campo_setor: f.campoSetor,
    colunas: f.colunas,
    criado_em: f.criadoEm,
    unidade_pims: f.unidadePims ?? null,
    campo_codigo: f.campoCodigo ?? null,
    coa_fazenda_id: f.coaFazendaId ?? null,
  };
}

export function rowParaFazenda(r: FazendaRow): Fazenda {
  return {
    id: r.id,
    nome: r.nome,
    campoNome: r.campo_nome,
    campoSetor: r.campo_setor,
    colunas: r.colunas ?? [],
    criadoEm: r.criado_em,
    unidadePims: r.unidade_pims ?? null,
    campoCodigo: r.campo_codigo ?? null,
    coaFazendaId: numeroOuNull(r.coa_fazenda_id),
  };
}

export interface TalhaoRow {
  id: string;
  fazenda_id: string;
  nome: string;
  setor: string | null;
  area_ha: number;
  geom: Talhao['geom'];
  atributos: Record<string, unknown>;
  codigo: string | null;
}

export function talhaoParaRow(t: Talhao): TalhaoRow {
  return {
    id: t.id,
    fazenda_id: t.fazendaId,
    nome: t.nome,
    setor: t.setor,
    area_ha: t.areaHa,
    geom: t.geom,
    atributos: t.atributos,
    codigo: t.codigo ?? null,
  };
}

export function rowParaTalhao(r: TalhaoRow): Talhao {
  return {
    id: r.id,
    fazendaId: r.fazenda_id,
    nome: r.nome,
    setor: r.setor,
    areaHa: r.area_ha,
    geom: r.geom,
    atributos: r.atributos ?? {},
    codigo: r.codigo ?? null,
  };
}

export interface SafraRow {
  id: string;
  nome: string;
  cultura: string;
  ano_safra: string;
  inicio: string;
  fim: string;
  nome_pims: string | null;
}

export function safraParaRow(s: Safra): SafraRow {
  return { id: s.id, nome: s.nome, cultura: s.cultura, ano_safra: s.anoSafra, inicio: s.inicio, fim: s.fim, nome_pims: s.nomePims ?? null };
}

export function rowParaSafra(r: SafraRow): Safra {
  return { id: r.id, nome: r.nome, cultura: r.cultura, anoSafra: r.ano_safra, inicio: r.inicio, fim: r.fim, nomePims: r.nome_pims ?? null };
}

export interface PlantioRow {
  safra_id: string;
  talhao_id: string;
  data_plantio: string | null;
  origem: 'manual' | 'pims';
  status: Plantio['status'];
  area_prevista: number | null;
  area_plantada: number | null;
  inicio: string | null;
  fim: string | null;
  variedade: string | null;
}

/** Plantio antigo (sem origem/status) é gravado como { origem: 'manual', status: 'plantado' }. */
export function plantioParaRow(p: Plantio): PlantioRow {
  const c = completarPlantio(p);
  return {
    safra_id: c.safraId,
    talhao_id: c.talhaoId,
    data_plantio: c.dataPlantio,
    origem: c.origem,
    status: c.status,
    area_prevista: c.areaPrevista,
    area_plantada: c.areaPlantada,
    inicio: c.inicio,
    fim: c.fim,
    variedade: c.variedade,
  };
}

/** Linha antiga (colunas novas nulas/ausentes) vira plantio manual de talhão plantado. */
export function rowParaPlantio(r: PlantioRow): Plantio {
  return completarPlantio({
    safraId: r.safra_id,
    talhaoId: r.talhao_id,
    dataPlantio: r.data_plantio ?? null,
    origem: r.origem,
    status: r.status,
    areaPrevista: numeroOuNull(r.area_prevista),
    areaPlantada: numeroOuNull(r.area_plantada),
    inicio: r.inicio ?? null,
    fim: r.fim ?? null,
    variedade: r.variedade ?? null,
  });
}

export interface AreaCulturaRow {
  id: string;
  safra_id: string;
  fazenda_id: string;
  codigo: string;
  area_ha: number;
  geom: AreaCultura['geom'];
}

export function areaCulturaParaRow(a: AreaCultura): AreaCulturaRow {
  return { id: a.id, safra_id: a.safraId, fazenda_id: a.fazendaId, codigo: a.codigo, area_ha: a.areaHa, geom: a.geom };
}

export function rowParaAreaCultura(r: AreaCulturaRow): AreaCultura {
  return { id: r.id, safraId: r.safra_id, fazendaId: r.fazenda_id, codigo: r.codigo ?? '', areaHa: Number(r.area_ha), geom: r.geom };
}

export interface MapaRow {
  id: string;
  fazenda_id: string;
  safra_id: string | null;
  titulo: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  config: MapaSalvo['config'];
  pics: PicSerializado[];
  resumo: MapaSalvo['resumo'];
  png_path: string | null;
  thumb_path: string | null;
  criado_em: string;
}

export function mapaParaRow(m: MapaSalvo): MapaRow {
  return {
    id: m.id,
    fazenda_id: m.fazendaId,
    safra_id: m.safraId,
    titulo: m.titulo,
    periodo_inicio: m.periodoInicio,
    periodo_fim: m.periodoFim,
    config: m.config,
    pics: serializarPics(m.pics),
    resumo: m.resumo,
    png_path: m.pngPath,
    thumb_path: m.thumbPath,
    criado_em: m.criadoEm,
  };
}

export function rowParaMapa(r: MapaRow): MapaSalvo {
  return {
    id: r.id,
    fazendaId: r.fazenda_id,
    safraId: r.safra_id,
    titulo: r.titulo,
    periodoInicio: r.periodo_inicio,
    periodoFim: r.periodo_fim,
    config: r.config,
    pics: reviverPics(r.pics ?? []),
    resumo: r.resumo,
    pngPath: r.png_path,
    thumbPath: r.thumb_path,
    criadoEm: r.criado_em,
  };
}

/** Linha de mapas_plantio_pims (gravada pela rotina do PIMS com a chave de serviço; o app só lê). */
export interface PlantioPimsRow {
  safra: string;
  unidade: string;
  gerado_em: string;
  talhoes: PlantioPimsTalhao[];
}

/** talhoes (jsonb) nulo ou que não é lista vira lista vazia; a validação de cada talhão fica em montarPlantioPims. */
export function rowParaLinhaPlantioPims(r: PlantioPimsRow): LinhaPlantioPims {
  return { safra: r.safra, unidade: r.unidade, geradoEm: r.gerado_em, talhoes: Array.isArray(r.talhoes) ? r.talhoes : [] };
}
