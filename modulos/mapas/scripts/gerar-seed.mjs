#!/usr/bin/env node
/**
 * Gera o cadastro pré-carregado (public/dados/seed/) a partir dos shapes em dados-fonte/ (fora do git):
 *   dados-fonte/base/<ARQ>.zip        → seed/base/<UNIDADE>.geojson        { codigo, codigoBruto, nome, setor }
 *   dados-fonte/soja-26-27/<ARQ>.zip  → seed/soja-26-27/<UNIDADE>.geojson  { codigo, codigoBruto }
 *   seed/seed.json                    (fazendas + safra SOJA 26/27)
 * Feições com o mesmo código normalizado viram um MultiPolygon. Coordenadas WGS84 com 7 casas.
 * Uso: npm run seed
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import shp from 'shpjs';
import turfArea from '@turf/area';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// Normalização do código — cópia fiel de src/lib/codigoTalhao.ts (o teste confere que são iguais).
const PREFIXO = /^(?:TALHAO|TH)(?:[\s-]+|(?=\d))/;
const PIVO_ANTES = /^PIVO?\s*-?\s*(\d+)$/;
const PIVO_DEPOIS = /^(\d+)\s*-?\s*PIVO$/;
const NUMERO_SUFIXO = /^(\d+)[\s-]*([A-Z]*)$/;

/** @param {string | null | undefined} s */
export function normalizarCodigo(s) {
  if (s === null || s === undefined) return '';
  let c = String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
  c = c.replace(PREFIXO, '').trim();
  if (c === '') return '';
  const pivo = PIVO_ANTES.exec(c) ?? PIVO_DEPOIS.exec(c);
  if (pivo) return `${pivo[1].replace(/^0+(?=\d)/, '').padStart(2, '0')}PIVO`;
  const numero = NUMERO_SUFIXO.exec(c);
  if (numero) return numero[1].replace(/^0+(?=\d)/, '').padStart(3, '0') + numero[2];
  return c.replace(/\s+/g, '');
}

/** @param {unknown} v */
const codigoBrutoDe = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** @param {{ type: string, coordinates: any }} g */
const partes = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/**
 * Une Features (Polygon/MultiPolygon) pelo código normalizado da coluna `campo`; mantém as props da
 * primeira + `codigo`/`codigoBruto`. Código vazio nunca é unido. Ordem da primeira ocorrência.
 * @param {any[]} features @param {string} campo
 */
export function unirFeaturesPorCodigo(features, campo) {
  const saida = [];
  const grupos = new Map();
  for (const f of features) {
    const codigoBruto = codigoBrutoDe(f.properties?.[campo]);
    const codigo = normalizarCodigo(codigoBruto);
    const existente = codigo === '' ? undefined : grupos.get(codigo);
    if (existente) {
      existente.geoms.push(f.geometry);
      continue;
    }
    if (codigo !== '') grupos.set(codigo, { indice: saida.length, geoms: [f.geometry] });
    saida.push({ type: 'Feature', properties: { ...f.properties, codigo, codigoBruto }, geometry: f.geometry });
  }
  for (const { indice, geoms } of grupos.values()) {
    if (geoms.length > 1) {
      saida[indice] = { ...saida[indice], geometry: { type: 'MultiPolygon', coordinates: geoms.flatMap(partes) } };
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------------------------
// Fontes

/**
 * base: arquivos em dados-fonte/base (coluna do código, setor, e filtro da camada quando o zip tem várias);
 * soja: arquivo em dados-fonte/soja-26-27 e coluna do código (null = sem área de soja).
 */
const FAZENDAS = [
  { nome: 'Dourado', unidadePims: 'DOURADO', base: [{ arquivo: 'DOURADO.zip', coluna: 'TH CODE', camada: /(^|\/)WGS 84\//i }], soja: { arquivo: 'DOURADO.zip', coluna: 'TALHAO' } },
  { nome: 'Globo', unidadePims: 'GLOBO', base: [{ arquivo: 'GLOBO.zip', coluna: 'COD' }], soja: { arquivo: 'GLOBO.zip', coluna: 'TALHÃO' } },
  { nome: 'Guapirama', unidadePims: 'GUAPIRAMA', base: [{ arquivo: 'GUAPIRAMA.zip', coluna: 'COD' }], soja: { arquivo: 'GUAPIRAMA.zip', coluna: 'TALHÃO' } },
  { nome: 'Nebraska', unidadePims: 'NEBRASKA', base: [{ arquivo: 'NEBRASKA.zip', coluna: 'COD' }], soja: { arquivo: 'NEBRASKA.zip', coluna: 'TALHAO' } },
  {
    nome: 'Siriema',
    unidadePims: 'SIRIEMA',
    base: [
      { arquivo: 'SIRIEMA.zip', coluna: 'COD', setor: 'SIRIEMA' },
      { arquivo: 'SIRIEMA_SAO_MIGUEL.zip', coluna: 'COD', setor: 'SÃO MIGUEL' },
    ],
    soja: { arquivo: 'SIRIEMA.zip', coluna: 'TALHAO' },
  },
  { nome: 'SM3', unidadePims: 'SM3', base: [{ arquivo: 'SM3.zip', coluna: 'COD' }], soja: { arquivo: 'SM3.zip', coluna: 'TALHAO' } },
  { nome: 'Três Flechas', unidadePims: 'TRES FLECHAS', base: [{ arquivo: 'TRES_FLECHAS.zip', coluna: 'COD' }], soja: { arquivo: 'TRES_FLECHAS.zip', coluna: 'TALHAO' } },
];

const SAFRA = { nome: 'SOJA 26/27', nomePims: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-08-31' };
const PASTA_SOJA = 'soja-26-27';

/** @param {string} unidade */
const nomeArquivo = (unidade) => `${unidade.replace(/\s+/g, '_')}.geojson`;

/** Nomes das entradas de um .zip (diretório central). @param {Uint8Array} bytes */
function listarNomesZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const total = view.getUint16(eocd + 10, true);
  let cd = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const nomes = [];
  for (let i = 0; i < total && cd + 46 <= bytes.length && view.getUint32(cd, true) === 0x02014b50; i++) {
    const n = view.getUint16(cd + 28, true);
    nomes.push(decoder.decode(bytes.subarray(cd + 46, cd + 46 + n)));
    cd += 46 + n + view.getUint16(cd + 30, true) + view.getUint16(cd + 32, true);
  }
  return nomes;
}

/** @param {number} v */
const arred = (v) => Math.round(v * 1e7) / 1e7;
/** Arredonda e remove vértices consecutivos repetidos (mantém o anel se ficar com menos de 4). @param {number[][]} anel */
function anelArred(anel) {
  const pts = anel.map(([x, y]) => [arred(x), arred(y)]);
  const sem = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  return sem.length >= 4 ? sem : pts;
}

/** Polygon/MultiPolygon (ou GeometryCollection de polígonos) sem Z e com 7 casas; null se não for polígono. */
function poligono(g) {
  if (!g) return null;
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(anelArred) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(anelArred)) };
  if (g.type === 'GeometryCollection') {
    const membros = g.geometries.map(poligono).filter(Boolean);
    if (membros.length === 0) return null;
    if (membros.length === 1) return membros[0];
    return { type: 'MultiPolygon', coordinates: membros.flatMap(partes) };
  }
  return null;
}

function dentroDeWgs84(g) {
  return partes(g).flat(2).every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

/**
 * Lê a camada de um .zip (shpjs reprojeta pelo .prj). Retorna as features poligonais e contadores.
 * @param {string} caminho @param {RegExp | undefined} camada
 */
async function lerZip(caminho, camada) {
  const bytes = new Uint8Array(readFileSync(caminho));
  const resultado = await shp(bytes);
  let camadas = Array.isArray(resultado) ? resultado : [resultado];
  if (camada) camadas = camadas.filter((c) => camada.test(c.fileName ?? ''));
  if (camadas.length !== 1) {
    throw new Error(`${caminho}: esperava 1 camada, encontrei ${camadas.length} (${camadas.map((c) => c.fileName).join(', ')})`);
  }
  const [fc] = camadas;
  const nomes = listarNomesZip(bytes).map((n) => n.toLowerCase());
  const semPrj = !nomes.includes(`${fc.fileName ?? ''}.prj`.toLowerCase());
  const features = [];
  let semGeometria = 0;
  for (const f of fc.features) {
    const geometry = poligono(f.geometry);
    if (!geometry) {
      semGeometria++;
      continue;
    }
    if (!dentroDeWgs84(geometry)) {
      throw new Error(`${caminho}: coordenadas fora de WGS84 (falta o .prj?)`);
    }
    features.push({ type: 'Feature', properties: f.properties ?? {}, geometry });
  }
  return { features, lidas: fc.features.length, semGeometria, semPrj };
}

/** FeatureCollection compacto: uma feição por linha. */
function escreverGeoJson(caminho, features) {
  mkdirSync(dirname(caminho), { recursive: true });
  const linhas = features.map((f) => JSON.stringify(f));
  writeFileSync(caminho, `{"type":"FeatureCollection","features":[\n${linhas.join(',\n')}\n]}\n`);
  return statSync(caminho).size;
}

/** Contadores de união: códigos que juntaram mais de uma feição. */
function duplicados(features, campo) {
  const cont = new Map();
  for (const f of features) {
    const c = normalizarCodigo(codigoBrutoDe(f.properties?.[campo]));
    if (c) cont.set(c, (cont.get(c) ?? 0) + 1);
  }
  return [...cont].filter(([, n]) => n > 1).map(([c, n]) => `${c}×${n}`);
}

const CAMPO = '__codigoFonte';

async function gerarBase(origem, destino, faz) {
  const todas = [];
  let lidas = 0;
  let semGeometria = 0;
  let semPrj = false;
  for (const fonte of faz.base) {
    const r = await lerZip(join(origem, 'base', fonte.arquivo), fonte.camada);
    lidas += r.lidas;
    semGeometria += r.semGeometria;
    semPrj ||= r.semPrj;
    for (const f of r.features) {
      todas.push({ ...f, properties: { [CAMPO]: f.properties[fonte.coluna], setor: fonte.setor ?? null } });
    }
  }
  let semCodigo = 0;
  const unidas = unirFeaturesPorCodigo(todas, CAMPO).map((f) => {
    const { codigo, codigoBruto, setor } = f.properties;
    const nome = codigoBruto !== '' ? codigoBruto : `Talhão ${++semCodigo}`;
    return { type: 'Feature', properties: { codigo, codigoBruto, nome, setor }, geometry: f.geometry };
  });
  const arquivo = `base/${nomeArquivo(faz.unidadePims)}`;
  const bytes = escreverGeoJson(join(destino, arquivo), unidas);
  return resumo(arquivo, lidas, unidas, semGeometria, semPrj, duplicados(todas, CAMPO), bytes);
}

async function gerarSoja(origem, destino, faz) {
  const r = await lerZip(join(origem, PASTA_SOJA, faz.soja.arquivo), faz.soja.camada);
  const unidas = unirFeaturesPorCodigo(r.features, faz.soja.coluna).map((f) => ({
    type: 'Feature',
    properties: { codigo: f.properties.codigo, codigoBruto: f.properties.codigoBruto },
    geometry: f.geometry,
  }));
  const arquivo = `${PASTA_SOJA}/${nomeArquivo(faz.unidadePims)}`;
  const bytes = escreverGeoJson(join(destino, arquivo), unidas);
  return resumo(arquivo, r.lidas, unidas, r.semGeometria, r.semPrj, duplicados(r.features, faz.soja.coluna), bytes);
}

function resumo(arquivo, lidas, unidas, semGeometria, semPrj, codigosUnidos, bytes) {
  return {
    arquivo,
    lidas,
    escritas: unidas.length,
    vazios: unidas.filter((f) => f.properties.codigo === '').length,
    unidos: codigosUnidos.length,
    codigosUnidos,
    semGeometria,
    semPrj,
    areaHa: unidas.reduce((s, f) => s + turfArea(f.geometry) / 10000, 0),
    bytes,
  };
}

function imprimirResumo(itens, destino) {
  const kb = (b) => `${(b / 1024).toFixed(0)} kB`;
  console.log('Seed gerado em', destino);
  for (const r of itens) {
    const partesTexto = [
      `${r.arquivo.padEnd(30)} lidas ${String(r.lidas).padStart(3)}`,
      `escritas ${String(r.escritas).padStart(3)}`,
      `vazios ${r.vazios}`,
      `unidos ${r.unidos}${r.unidos ? ` (${r.codigosUnidos.join(', ')})` : ''}`,
      `sem geometria ${r.semGeometria}`,
      `sem .prj ${r.semPrj ? 'SIM' : 'não'}`,
      `${r.areaHa.toFixed(1)} ha`,
      kb(r.bytes),
    ];
    console.log(partesTexto.join(' | '));
  }
  const total = itens.reduce((s, r) => s + r.bytes, 0) + statSync(join(destino, 'seed.json')).size;
  console.log(`Total: ${itens.reduce((s, r) => s + r.escritas, 0)} feições, ${kb(total)}`);
}

/**
 * Gera todo o seed em `destino` (apaga antes as pastas base/ e soja-26-27/ de lá).
 * @param {{ origem?: string, destino?: string, agora?: Date, silencioso?: boolean }} [opcoes]
 */
export async function gerarSeed(opcoes = {}) {
  const origem = opcoes.origem ?? join(RAIZ, 'dados-fonte');
  const destino = opcoes.destino ?? join(RAIZ, 'public', 'dados', 'seed');
  const agora = opcoes.agora ?? new Date();
  for (const pasta of ['base', PASTA_SOJA]) rmSync(join(destino, pasta), { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });

  const itens = [];
  for (const faz of FAZENDAS) itens.push(await gerarBase(origem, destino, faz));
  for (const faz of FAZENDAS.filter((f) => f.soja)) itens.push(await gerarSoja(origem, destino, faz));

  const seed = {
    versao: 1,
    geradoEm: agora.toISOString(),
    fazendas: FAZENDAS.map((f) => ({
      nome: f.nome,
      unidadePims: f.unidadePims,
      campoNome: 'nome',
      campoCodigo: 'codigo',
      campoSetor: f.base.some((b) => b.setor) ? 'setor' : null,
      arquivoBase: `base/${nomeArquivo(f.unidadePims)}`,
    })),
    safras: [
      {
        ...SAFRA,
        areasCultura: FAZENDAS.filter((f) => f.soja).map((f) => ({
          unidadePims: f.unidadePims,
          arquivo: `${PASTA_SOJA}/${nomeArquivo(f.unidadePims)}`,
        })),
      },
    ],
  };
  writeFileSync(join(destino, 'seed.json'), `${JSON.stringify(seed, null, 2)}\n`);
  if (!opcoes.silencioso) imprimirResumo(itens, destino);
  return itens;
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (executadoDireto) {
  try {
    readdirSync(join(RAIZ, 'dados-fonte'));
  } catch {
    console.error('Pasta dados-fonte/ não encontrada (os shapes originais ficam fora do git).');
    process.exit(1);
  }
  gerarSeed().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
