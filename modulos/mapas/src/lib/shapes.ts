/** Importação de shapes (.zip shapefile, .shp solto + .dbf/.prj/.cpg, .kml, .geojson/.json) em WGS84. */
import type { Feature, FeatureCollection, Geometry as GeoJsonGeom, MultiPolygon, Polygon } from 'geojson';
import parseShapefile, { type PartesShapefile } from 'shpjs';
import { kml as kmlParaGeoJson } from '@tmcw/togeojson';
import turfArea from '@turf/area';
import type { Geometry } from './types';

export interface FeicaoImportada {
  geom: Geometry;
  props: Record<string, unknown>;
}

export interface ShapeImport {
  feicoes: FeicaoImportada[];
  colunas: string[];
  avisos: string[];
  nomeSugerido: string;
}

export class ShapeError extends Error {
  constructor(mensagem: string, opcoes?: ErrorOptions) {
    super(mensagem, opcoes);
    this.name = 'ShapeError';
  }
}

interface FonteResultado {
  fcs: FeatureCollection[];
  avisos: string[];
}

interface Fonte {
  indice: number;
  nome: string;
  carregar: () => Promise<FonteResultado>;
}

interface GrupoShapefile {
  indice: number;
  nome: string;
  shp?: File;
  dbf?: File;
  prj?: File;
  cpg?: File;
}

function extensao(nome: string): string {
  const m = /\.([^./\\]+)$/.exec(nome);
  return m ? m[1].toLowerCase() : '';
}

function semExtensao(nome: string): string {
  return nome.replace(/\.[^./\\]+$/, '');
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Remove a coordenada Z (mantém [lon, lat]). */
function removerZ(g: Polygon | MultiPolygon): Geometry {
  if (g.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: g.coordinates.map((anel) => anel.map(([x, y]) => [x, y] as [number, number])),
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: g.coordinates.map((poligono) =>
      poligono.map((anel) => anel.map(([x, y]) => [x, y] as [number, number])),
    ),
  };
}

/** Combina os membros poligonais de uma GeometryCollection em UMA geometria: um único membro Polygon
 *  vira Polygon; qualquer outra combinação vira MultiPolygon com todas as partes. */
function combinarPoligonos(membros: (Polygon | MultiPolygon)[]): Geometry {
  if (membros.length === 1 && membros[0].type === 'Polygon') {
    return membros[0];
  }
  const partes: Polygon['coordinates'][] = [];
  for (const m of membros) {
    if (m.type === 'Polygon') partes.push(m.coordinates);
    else partes.push(...m.coordinates);
  }
  return { type: 'MultiPolygon', coordinates: partes };
}

/** Extrai Polygon/MultiPolygon de uma geometria. Uma GeometryCollection vira UMA feição (Polygon ou
 *  MultiPolygon combinando seus membros poligonais); retorna quantas geometrias-folha foram ignoradas. */
function extrairPoligonos(geom: GeoJsonGeom | null | undefined, coletar: (g: Geometry) => void): number {
  if (!geom) return 1;
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
    coletar(removerZ(geom));
    return 0;
  }
  if (geom.type === 'GeometryCollection') {
    const membros: (Polygon | MultiPolygon)[] = [];
    let ignoradas = 0;
    const visitar = (g: GeoJsonGeom): void => {
      if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        membros.push(removerZ(g));
      } else if (g.type === 'GeometryCollection') {
        g.geometries.forEach(visitar);
      } else {
        ignoradas++;
      }
    };
    geom.geometries.forEach(visitar);
    if (membros.length > 0) {
      coletar(combinarPoligonos(membros));
    }
    return ignoradas;
  }
  return 1;
}

function todasCoordenadas(geom: GeoJsonGeom): number[][] {
  switch (geom.type) {
    case 'Point':
      return [geom.coordinates];
    case 'MultiPoint':
    case 'LineString':
      return geom.coordinates;
    case 'Polygon':
      return geom.coordinates.flat();
    case 'MultiPolygon':
      return geom.coordinates.flat(2);
    case 'MultiLineString':
      return geom.coordinates.flat();
    case 'GeometryCollection':
      return geom.geometries.flatMap(todasCoordenadas);
    default:
      return [];
  }
}

function coordsDentroDeWgs84(fc: FeatureCollection): boolean {
  return fc.features.every((f) => {
    if (!f.geometry) return true;
    return todasCoordenadas(f.geometry).every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
  });
}

/**
 * Lista os nomes das entradas de um .zip lendo só o diretório central (sem descompactar nada).
 * Devolve null quando não dá para ler (arquivo truncado, não é zip ou ZIP64); nunca lança.
 */
export function listarNomesZip(buf: ArrayBuffer): string[] | null {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const cabe = (pos: number, n: number) => pos >= 0 && pos + n <= bytes.length;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const totalEntradas = view.getUint16(eocd + 10, true);
  let cd = view.getUint32(eocd + 16, true);
  if (totalEntradas === 0xffff || cd === 0xffffffff) return null; // ZIP64
  const decoder = new TextDecoder();
  const nomes: string[] = [];
  for (let i = 0; i < totalEntradas; i++) {
    if (!cabe(cd, 46) || view.getUint32(cd, true) !== 0x02014b50) return null;
    const nomeLen = view.getUint16(cd + 28, true);
    const extraLen = view.getUint16(cd + 30, true);
    const comentLen = view.getUint16(cd + 32, true);
    if (!cabe(cd + 46, nomeLen)) return null;
    nomes.push(decoder.decode(bytes.subarray(cd + 46, cd + 46 + nomeLen)));
    cd += 46 + nomeLen + extraLen + comentLen;
  }
  return nomes;
}

/** Lê com o shpjs; os erros da biblioteca (em inglês, ou RangeError de zip malformado) viram ShapeError. */
async function lerShapefile(entrada: ArrayBuffer | PartesShapefile, nomeArquivo: string, zip: boolean) {
  try {
    return await parseShapefile(entrada);
  } catch (e) {
    if (zip && e instanceof Error && /no layers/i.test(e.message)) {
      throw new ShapeError(`Nenhum shapefile (.shp) encontrado no arquivo .zip "${nomeArquivo}"`, { cause: e });
    }
    throw new ShapeError(
      zip
        ? `Não foi possível abrir o arquivo .zip "${nomeArquivo}": ele está corrompido ou usa uma compactação não suportada (ex.: ZIP64). Compacte de novo ou envie os arquivos .shp, .dbf, .prj e .cpg soltos.`
        : `Não foi possível ler o shapefile "${nomeArquivo}": os arquivos .shp, .dbf ou .prj estão corrompidos ou em formato não suportado.`,
      { cause: e },
    );
  }
}

function paraFeatureCollection(json: unknown): FeatureCollection {
  if (!json || typeof json !== 'object' || !('type' in json)) {
    throw new ShapeError('Arquivo GeoJSON inválido');
  }
  const tipo = (json as { type: unknown }).type;
  if (tipo === 'FeatureCollection') return json as FeatureCollection;
  if (tipo === 'Feature') return { type: 'FeatureCollection', features: [json as Feature] };
  if (typeof tipo === 'string') {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: json as GeoJsonGeom }],
    };
  }
  throw new ShapeError('Arquivo GeoJSON inválido');
}

async function carregarZip(file: File): Promise<FonteResultado> {
  const buf = await file.arrayBuffer();
  const resultado = await lerShapefile(buf, file.name, true);
  const fcs = (Array.isArray(resultado) ? resultado : [resultado]) as Array<
    FeatureCollection & { fileName?: string }
  >;

  // shpjs não reprojeta uma camada do zip que não tem .prj: as coordenadas cruas voltam como se já
  // fossem lon/lat. Detecta isso pelo diretório do zip (nomes das entradas) e aplica a mesma regra
  // do shapefile solto: aceita com aviso se parecer WGS84, senão lança ShapeError. Se o diretório não
  // puder ser lido, vale só a faixa das coordenadas (com .prj o shpjs sempre devolve graus).
  const nomes = listarNomesZip(buf);
  const nomesZip = nomes ? new Set(nomes.map((n) => n.toLowerCase())) : null;
  const avisos: string[] = [];
  for (const fc of fcs) {
    const base = fc.fileName;
    if (base === undefined) continue;
    const temPrj = nomesZip ? nomesZip.has(`${base.toLowerCase()}.prj`) : coordsDentroDeWgs84(fc);
    if (!temPrj) {
      if (coordsDentroDeWgs84(fc)) {
        avisos.push('Arquivo .prj ausente: assumindo WGS84 (coordenadas geográficas)');
      } else {
        throw new ShapeError('Arquivo .prj ausente: não foi possível identificar o sistema de coordenadas');
      }
    }
  }

  return { fcs, avisos };
}

async function carregarKml(file: File): Promise<FonteResultado> {
  const texto = await file.text();
  const doc = new DOMParser().parseFromString(texto, 'text/xml');
  const fc = kmlParaGeoJson(doc, { skipNullGeometry: true }) as FeatureCollection;
  return { fcs: [fc], avisos: [] };
}

async function carregarGeoJson(file: File): Promise<FonteResultado> {
  const texto = await file.text();
  const fc = paraFeatureCollection(JSON.parse(texto));
  return { fcs: [fc], avisos: [] };
}

async function carregarGrupoShapefile(grupo: GrupoShapefile): Promise<FonteResultado> {
  if (!grupo.shp) {
    // .prj/.cpg soltos sem o shapefile são sobras inofensivas; um .dbf sem .shp indica arquivo esquecido
    return { fcs: [], avisos: grupo.dbf ? [`Arquivos de "${grupo.nome}" ignorados: falta o .shp`] : [] };
  }
  const partes: PartesShapefile = { shp: await grupo.shp.arrayBuffer() };
  if (grupo.dbf) partes.dbf = await grupo.dbf.arrayBuffer();
  if (grupo.cpg) partes.cpg = await grupo.cpg.arrayBuffer();
  const temPrj = !!grupo.prj;
  if (grupo.prj) partes.prj = await grupo.prj.arrayBuffer();

  const resultado = await lerShapefile(partes, `${grupo.nome}.shp`, false);
  const fc = Array.isArray(resultado) ? resultado[0] : resultado;
  const avisos: string[] = [];
  if (!temPrj) {
    if (coordsDentroDeWgs84(fc)) {
      avisos.push('Arquivo .prj ausente: assumindo WGS84 (coordenadas geográficas)');
    } else {
      throw new ShapeError('Arquivo .prj ausente: não foi possível identificar o sistema de coordenadas');
    }
  }
  return { fcs: [fc], avisos };
}

/**
 * Arquivos que acompanham o shapefile (índices espaciais, metadados, estilos) e não são necessários
 * para ler as feições: ignorados sem aviso.
 */
const AUXILIARES_SHAPEFILE = new Set(['shx', 'sbn', 'sbx', 'fbn', 'fbx', 'ain', 'aih', 'atx', 'ixs', 'mxs', 'qix', 'idx', 'qpj', 'qmd', 'cst', 'xml', 'qml', 'sld']);

/** Agrupa e importa shapes de arquivos enviados pelo usuário (zip shapefile, .shp solto, .kml, .geojson/.json). */
export async function importarShape(files: File[]): Promise<ShapeImport> {
  const avisosGlobais: string[] = [];
  const grupos = new Map<string, GrupoShapefile>();
  const fontes: Fonte[] = [];

  files.forEach((file, indice) => {
    const ext = extensao(file.name);
    if (ext === 'zip') {
      fontes.push({ indice, nome: semExtensao(file.name), carregar: () => carregarZip(file) });
    } else if (ext === 'kml') {
      fontes.push({ indice, nome: semExtensao(file.name), carregar: () => carregarKml(file) });
    } else if (ext === 'geojson' || ext === 'json') {
      fontes.push({ indice, nome: semExtensao(file.name), carregar: () => carregarGeoJson(file) });
    } else if (ext === 'shp' || ext === 'dbf' || ext === 'prj' || ext === 'cpg') {
      const chave = semExtensao(file.name).toLowerCase();
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = { indice, nome: semExtensao(file.name) };
        grupos.set(chave, grupo);
      }
      grupo[ext as 'shp' | 'dbf' | 'prj' | 'cpg'] = file;
    } else if (AUXILIARES_SHAPEFILE.has(ext)) {
      // arquivo auxiliar do shapefile: não precisa ser lido
    } else if (ext) {
      avisosGlobais.push(`Arquivo ignorado: ${file.name} (formato não suportado)`);
    }
  });

  for (const grupo of grupos.values()) {
    fontes.push({ indice: grupo.indice, nome: grupo.nome, carregar: () => carregarGrupoShapefile(grupo) });
  }
  fontes.sort((a, b) => a.indice - b.indice);

  const feicoes: FeicaoImportada[] = [];
  const colunas: string[] = [];
  const colunasVistas = new Set<string>();
  let ignoradas = 0;

  for (const fonte of fontes) {
    const { fcs, avisos } = await fonte.carregar();
    avisosGlobais.push(...avisos);
    for (const fc of fcs) {
      for (const feature of fc.features) {
        ignoradas += extrairPoligonos(feature.geometry, (geom) => {
          const props = (feature.properties ?? {}) as Record<string, unknown>;
          feicoes.push({ geom, props });
          for (const chave of Object.keys(props)) {
            if (!colunasVistas.has(chave)) {
              colunasVistas.add(chave);
              colunas.push(chave);
            }
          }
        });
      }
    }
  }

  if (feicoes.length === 0) {
    throw new ShapeError('Nenhum polígono encontrado no arquivo');
  }
  if (ignoradas > 0) {
    avisosGlobais.push(ignoradas === 1 ? '1 feição ignorada (não é polígono)' : `${ignoradas} feições ignoradas (não são polígonos)`);
  }

  return { feicoes, colunas, avisos: avisosGlobais, nomeSugerido: fontes[0]?.nome ?? '' };
}

const PREFERENCIA_NOME = ['nome', 'talhao', 'talhoes', 'name', 'th', 'campo'];

/** Sugere a coluna de rótulo do talhão a partir da lista de colunas e das feições importadas. */
export function sugerirColunaNome(colunas: string[], feicoes: FeicaoImportada[]): string {
  for (const pref of PREFERENCIA_NOME) {
    const achada = colunas.find((c) => normalizar(c) === pref);
    if (achada) return achada;
  }
  for (const coluna of colunas) {
    const valores = feicoes.map((f) => f.props[coluna]);
    const textos = valores.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (textos.length === valores.length && textos.length > 0 && new Set(textos).size === textos.length) {
      return coluna;
    }
  }
  return colunas[0] ?? '';
}

const PREFERENCIA_SETOR = ['setor', 'sector', 'bloco', 'modulo'];

/** Sugere a coluna de setor/bloco, ou null se nenhuma coluna combinar. */
export function sugerirColunaSetor(colunas: string[]): string | null {
  for (const pref of PREFERENCIA_SETOR) {
    const achada = colunas.find((c) => normalizar(c) === pref);
    if (achada) return achada;
  }
  return null;
}

/** Área em hectares (geodésica, via @turf/area). */
export function areaHa(g: Geometry): number {
  return turfArea(g) / 10000;
}
