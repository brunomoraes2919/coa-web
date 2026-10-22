/**
 * Exporta os limites cadastrados (talhões da fazenda, áreas da cultura, plantio) e as camadas do Mapa de CAR em
 * shapefile e em KML, em WGS84 (lon, lat), com os atributos de cada feição. Shapefile de polígonos ou de linhas
 * (rios, estradas). Sem dependência nova: o shapefile (polígonos, formato da ESRI) é
 * escrito aqui e o zip sai do fflate, carregado só quando o usuário exporta.
 *
 * Shapefile: .zip com .shp, .shx, .dbf (atributos), .prj (WGS84) e .cpg (UTF-8, para os acentos).
 * KML: um Placemark por feição, com os atributos em ExtendedData (o Google Earth mostra ao clicar).
 */
import type { Geometry, Position } from 'geojson';

export type ValorAtributo = string | number | null;

/** Uma feição a exportar: o polígono e os atributos (as chaves viram as colunas, na ordem em que aparecem). */
export interface FeicaoExportada {
  geom: Geometry | null;
  props: Record<string, ValorAtributo>;
}

/** WGS84 no texto que o ArcGIS e o QGIS gravam no .prj. */
export const PRJ_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

type Anel = Position[];

/** Área em ha com 2 casas (o .dbf guarda o número como está escrito). */
export const ha2 = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** Polígonos (anéis com 3+ pontos distintos, fechados) de um Polygon ou MultiPolygon; o resto fica de fora. */
export function poligonosDe(g: Geometry | null): Anel[][] {
  if (!g) return [];
  const polys: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const fechado = (anel: Position[]): Anel => {
    const pts = anel.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    return a[0] === b[0] && a[1] === b[1] ? pts : [...pts, a];
  };
  const out: Anel[][] = [];
  for (const poly of polys) {
    const fora = fechado(poly[0] ?? []);
    // sem o anel de fora, o polígono não existe (os furos sozinhos não servem)
    if (fora.length < 4) continue;
    out.push([fora, ...poly.slice(1).map(fechado).filter((anel) => anel.length >= 4)]);
  }
  return out;
}

/** Linhas (2+ pontos) de um LineString ou MultiLineString; o resto fica de fora. */
export function linhasDe(g: Geometry | null): Anel[] {
  if (!g) return [];
  const linhas: Position[][] = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  return linhas.map((l) => l.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).filter((l) => l.length >= 2);
}

/** Tipo de geometria de um shapefile: polígono (5) ou linha (3). */
export type GeometriaShp = 'poligono' | 'linha';
const TIPO_SHP: Record<GeometriaShp, number> = { poligono: 5, linha: 3 };

/** Área com sinal (fórmula do laço): positiva = anti-horário. */
function areaComSinal(anel: Anel): number {
  let s = 0;
  for (let i = 0; i < anel.length - 1; i++) s += anel[i][0] * anel[i + 1][1] - anel[i + 1][0] * anel[i][1];
  return s / 2;
}

/** No shapefile o anel de fora vai no sentido horário e os furos no anti-horário (o GeoJSON é o contrário). */
function orientarParaShp(anel: Anel, deFora: boolean): Anel {
  const horario = areaComSinal(anel) < 0;
  return horario === deFora ? anel : [...anel].reverse();
}

// ---------------------------------------------------------------- .dbf

interface ColunaDbf {
  chave: string;
  nome: string;
  tipo: 'C' | 'N';
  tamanho: number;
  decimais: number;
}

const codificador = new TextEncoder();

/** Nome de coluna do .dbf: até 10 letras/números/_ sem acento, em maiúsculas, começando por letra, sem repetir. */
export function nomesDeColunaDbf(chaves: string[]): string[] {
  const usados = new Set<string>();
  return chaves.map((c) => {
    let base = c
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    if (!/^[A-Z]/.test(base)) base = `C${base}`;
    base = base.slice(0, 10);
    let nome = base;
    for (let i = 2; usados.has(nome); i++) nome = `${base.slice(0, 10 - String(i).length - 1)}_${i}`;
    usados.add(nome);
    return nome;
  });
}

/** Casas decimais de um número escrito sem expoente; null quando ele só se escreve com expoente. */
function casas(v: number): number | null {
  const t = String(v);
  if (/e/i.test(t)) return null;
  return t.includes('.') ? t.length - t.indexOf('.') - 1 : 0;
}

/** Texto cortado em `max` bytes UTF-8 sem partir uma letra acentuada ao meio. */
function cortarUtf8(texto: string, max: number): Uint8Array {
  const b = codificador.encode(texto);
  if (b.length <= max) return b;
  let fim = max;
  // byte de continuação (10xxxxxx): volta até o começo da letra
  while (fim > 0 && (b[fim] & 0xc0) === 0x80) fim--;
  return b.subarray(0, fim);
}

function colunasDbf(feicoes: FeicaoExportada[]): ColunaDbf[] {
  const chaves: string[] = [];
  for (const f of feicoes) for (const k of Object.keys(f.props)) if (!chaves.includes(k)) chaves.push(k);
  const nomes = nomesDeColunaDbf(chaves);
  return chaves.map((chave, i) => {
    const valores = feicoes.map((f) => f.props[chave]).filter((v): v is string | number => v !== null && v !== undefined && v !== '');
    const numeros = valores.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (numeros && valores.length) {
      const dec = valores.map((v) => casas(v as number));
      if (dec.every((d) => d !== null)) {
        const decimais = Math.min(8, Math.max(0, ...(dec as number[])));
        const tamanho = Math.max(1, ...valores.map((v) => (v as number).toFixed(decimais).length));
        if (tamanho <= 18) return { chave, nome: nomes[i], tipo: 'N', tamanho, decimais };
      }
    }
    const tamanho = Math.min(254, Math.max(1, ...valores.map((v) => codificador.encode(String(v)).length)));
    return { chave, nome: nomes[i], tipo: 'C', tamanho, decimais: 0 };
  });
}

function escreverDbf(feicoes: FeicaoExportada[], hoje: Date): Uint8Array {
  const cols = colunasDbf(feicoes);
  const tamCabecalho = 32 + 32 * cols.length + 1;
  const tamRegistro = 1 + cols.reduce((a, c) => a + c.tamanho, 0);
  const buf = new Uint8Array(tamCabecalho + tamRegistro * feicoes.length + 1);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 0x03);
  dv.setUint8(1, hoje.getFullYear() - 1900);
  dv.setUint8(2, hoje.getMonth() + 1);
  dv.setUint8(3, hoje.getDate());
  dv.setUint32(4, feicoes.length, true);
  dv.setUint16(8, tamCabecalho, true);
  dv.setUint16(10, tamRegistro, true);
  cols.forEach((c, i) => {
    const o = 32 + 32 * i;
    buf.set(codificador.encode(c.nome), o);
    buf[o + 11] = c.tipo.charCodeAt(0);
    buf[o + 16] = c.tamanho;
    buf[o + 17] = c.decimais;
  });
  buf[tamCabecalho - 1] = 0x0d;
  let o = tamCabecalho;
  for (const f of feicoes) {
    buf.fill(0x20, o, o + tamRegistro); // registro ativo + campos em branco
    let x = o + 1;
    for (const c of cols) {
      const v = f.props[c.chave];
      if (v !== null && v !== undefined && v !== '') {
        if (c.tipo === 'N') {
          const t = codificador.encode((v as number).toFixed(c.decimais));
          buf.set(t, x + c.tamanho - t.length); // número alinhado à direita
        } else buf.set(cortarUtf8(String(v), c.tamanho), x);
      }
      x += c.tamanho;
    }
    o += tamRegistro;
  }
  buf[o] = 0x1a;
  return buf;
}

// ---------------------------------------------------------------- .shp e .shx

type Caixa = [number, number, number, number];

function caixaDe(aneis: Anel[]): Caixa {
  const c: Caixa = [Infinity, Infinity, -Infinity, -Infinity];
  for (const a of aneis)
    for (const [x, y] of a) {
      if (x < c[0]) c[0] = x;
      if (y < c[1]) c[1] = y;
      if (x > c[2]) c[2] = x;
      if (y > c[3]) c[3] = y;
    }
  // camada sem nenhum ponto: caixa zerada (o formato não aceita infinito)
  return c.every(Number.isFinite) ? c : [0, 0, 0, 0];
}

function cabecalhoShp(dv: DataView, tamanhoBytes: number, caixa: Caixa, tipo: number): void {
  dv.setInt32(0, 9994, false);
  dv.setInt32(24, tamanhoBytes / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, tipo, true);
  caixa.forEach((v, i) => dv.setFloat64(36 + 8 * i, v, true));
}

/** Polígono e linha têm o mesmo registro (partes + pontos); muda só o tipo. */
function escreverShp(registros: Anel[][], tipo: number): { shp: Uint8Array; shx: Uint8Array } {
  const conteudos = registros.map((aneis) => 44 + 4 * aneis.length + 16 * aneis.reduce((a, r) => a + r.length, 0));
  const total = 100 + conteudos.reduce((a, c) => a + 8 + c, 0);
  const shp = new Uint8Array(total);
  const shx = new Uint8Array(100 + 8 * registros.length);
  const dv = new DataView(shp.buffer);
  const dx = new DataView(shx.buffer);
  const geral = caixaDe(registros.flat());
  cabecalhoShp(dv, total, geral, tipo);
  cabecalhoShp(dx, shx.length, geral, tipo);
  let o = 100;
  registros.forEach((aneis, i) => {
    dx.setInt32(100 + 8 * i, o / 2, false);
    dx.setInt32(104 + 8 * i, conteudos[i] / 2, false);
    dv.setInt32(o, i + 1, false);
    dv.setInt32(o + 4, conteudos[i] / 2, false);
    const c = o + 8;
    dv.setInt32(c, tipo, true);
    caixaDe(aneis).forEach((v, j) => dv.setFloat64(c + 4 + 8 * j, v, true));
    dv.setInt32(c + 36, aneis.length, true);
    dv.setInt32(c + 40, aneis.reduce((a, r) => a + r.length, 0), true);
    let inicio = 0;
    aneis.forEach((anel, j) => {
      dv.setInt32(c + 44 + 4 * j, inicio, true);
      inicio += anel.length;
    });
    let p = c + 44 + 4 * aneis.length;
    for (const anel of aneis)
      for (const [x, y] of anel) {
        dv.setFloat64(p, x, true);
        dv.setFloat64(p + 8, y, true);
        p += 16;
      }
    o = c + conteudos[i];
  });
  return { shp, shx };
}

/**
 * Arquivos do shapefile (nome → conteúdo) das feições com polígono (ou com linha, em `geometria` 'linha'); as
 * outras ficam de fora (`ignoradas`). `base` é o nome dos arquivos dentro do zip.
 */
export function arquivosShapefile(
  feicoes: FeicaoExportada[],
  base: string,
  hoje = new Date(),
  geometria: GeometriaShp = 'poligono',
): { arquivos: Record<string, Uint8Array>; ignoradas: number } {
  const validas: { f: FeicaoExportada; aneis: Anel[] }[] = [];
  for (const f of feicoes) {
    if (geometria === 'linha') {
      const linhas = linhasDe(f.geom);
      if (linhas.length) validas.push({ f, aneis: linhas });
      continue;
    }
    const polys = poligonosDe(f.geom);
    if (polys.length) validas.push({ f, aneis: polys.flatMap((p) => p.map((anel, j) => orientarParaShp(anel, j === 0))) });
  }
  const { shp, shx } = escreverShp(validas.map((v) => v.aneis), TIPO_SHP[geometria]);
  return {
    arquivos: {
      [`${base}.shp`]: shp,
      [`${base}.shx`]: shx,
      [`${base}.dbf`]: escreverDbf(validas.map((v) => v.f), hoje),
      [`${base}.prj`]: codificador.encode(PRJ_WGS84),
      [`${base}.cpg`]: codificador.encode('UTF-8'),
    },
    ignoradas: feicoes.length - validas.length,
  };
}

/** Shapefile zipado (.shp, .shx, .dbf, .prj, .cpg com o mesmo nome do zip). */
export async function shapefileZip(feicoes: FeicaoExportada[], base: string, geometria: GeometriaShp = 'poligono'): Promise<{ blob: Blob; ignoradas: number }> {
  const { arquivos, ignoradas } = arquivosShapefile(feicoes, base, new Date(), geometria);
  return { blob: await zipar(arquivos), ignoradas };
}

/** Várias camadas num zip só: cada uma com o seu shapefile (.shp, .shx, .dbf, .prj, .cpg) com o nome `base`. */
export async function camadasZip(camadas: readonly { base: string; feicoes: FeicaoExportada[]; geometria: GeometriaShp }[]): Promise<Blob> {
  const hoje = new Date();
  const arquivos: Record<string, Uint8Array> = {};
  for (const c of camadas) Object.assign(arquivos, arquivosShapefile(c.feicoes, c.base, hoje, c.geometria).arquivos);
  return zipar(arquivos);
}

async function zipar(arquivos: Record<string, Uint8Array>): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const zip = zipSync(arquivos, { level: 6 });
  return new Blob([zip.slice().buffer], { type: 'application/zip' });
}

// ---------------------------------------------------------------- KML

/** Texto seguro dentro do XML (sem os caracteres de controle que o XML 1.0 não aceita). */
function xml(t: string): string {
  return t
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const coord = (v: number) => String(Math.round(v * 1e8) / 1e8);

function anelKml(anel: Anel): string {
  return `<LinearRing><coordinates>${anel.map(([x, y]) => `${coord(x)},${coord(y)}`).join(' ')}</coordinates></LinearRing>`;
}

function poligonoKml(aneis: Anel[]): string {
  const [fora, ...furos] = aneis;
  return `<Polygon><outerBoundaryIs>${anelKml(fora)}</outerBoundaryIs>${furos.map((f) => `<innerBoundaryIs>${anelKml(f)}</innerBoundaryIs>`).join('')}</Polygon>`;
}

/**
 * KML com um Placemark por feição com polígono (nome = atributo `campoNome`), os atributos em ExtendedData e o
 * contorno em amarelo, que aparece bem sobre a imagem de satélite do Google Earth.
 */
export function kmlDe(feicoes: FeicaoExportada[], titulo: string, campoNome: string): { texto: string; ignoradas: number } {
  const marcas: string[] = [];
  let ignoradas = 0;
  for (const f of feicoes) {
    const polys = poligonosDe(f.geom);
    if (!polys.length) {
      ignoradas++;
      continue;
    }
    const nome = f.props[campoNome];
    const dados = Object.entries(f.props)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(String(v))}</value></Data>`)
      .join('');
    const geom = polys.length === 1 ? poligonoKml(polys[0]) : `<MultiGeometry>${polys.map(poligonoKml).join('')}</MultiGeometry>`;
    marcas.push(
      `<Placemark>${nome !== null && nome !== undefined && nome !== '' ? `<name>${xml(String(nome))}</name>` : ''}<styleUrl>#limite</styleUrl><ExtendedData>${dados}</ExtendedData>${geom}</Placemark>`,
    );
  }
  const texto = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    `<name>${xml(titulo)}</name>`,
    '<Style id="limite"><LineStyle><color>ff00d7ff</color><width>2</width></LineStyle><PolyStyle><color>2600d7ff</color></PolyStyle></Style>',
    ...marcas,
    '</Document>',
    '</kml>',
    '',
  ].join('\n');
  return { texto, ignoradas };
}
