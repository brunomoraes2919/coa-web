/**
 * Código do talhão: normalização usada dos dois lados (shape e PIMS) para casar `(unidadePims, codigo)`.
 * A mesma regra está duplicada (em JS) em scripts/gerar-seed.mjs e scripts/sincronizar-plantio.mjs;
 * mantenha as três iguais.
 */
import type { MultiPolygon } from 'geojson';
import type { FeicaoImportada } from './shapes';
import type { Geometry } from './types';

const PREFIXO = /^(?:TALHAO|TH)(?:[\s-]+|(?=\d))/;
const PIVO_ANTES = /^PIVO?\s*-?\s*(\d+)$/;
const PIVO_DEPOIS = /^(\d+)\s*-?\s*PIVO$/;
const NUMERO_SUFIXO = /^(\d+)[\s-]*([A-Z]*)$/;

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Nome para comparação (unidade/safra do PIMS, fazenda do COA WEB): sem acento, maiúsculas, espaços
 * simples e sem espaços nas pontas (`Três Flechas` ↔ `Tres Flechas` → `TRES FLECHAS`). null → ''.
 */
export function nomeComparavel(s: string | null | undefined): string {
  return semAcento(s ?? '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function tresDigitos(numero: string): string {
  return numero.replace(/^0+(?=\d)/, '').padStart(3, '0');
}

/**
 * Maiúsculas sem acento; remove o prefixo `TH`/`TALHAO`/`TALHÃO` (seguido de espaço, hífen ou dígito);
 * `PIVÔ 02`/`PIVO 2`/`PIV2` → `02PIVO`; `^\d+[\s-]*[A-Z]*$` → número com 3 dígitos + sufixo
 * (`39B` → `039B`, `TH 033A` → `033A`, `69` → `069`, `001-A` → `001A`, `19PESQ` → `019PESQ`);
 * demais só perdem os espaços (`P14`, `M1A`, `EXP-CL`). Retorna '' quando vazio.
 */
export function normalizarCodigo(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  let c = semAcento(String(s)).toUpperCase().trim();
  c = c.replace(PREFIXO, '').trim();
  if (c === '') return '';
  const pivo = PIVO_ANTES.exec(c) ?? PIVO_DEPOIS.exec(c);
  if (pivo) {
    return `${pivo[1].replace(/^0+(?=\d)/, '').padStart(2, '0')}PIVO`;
  }
  const numero = NUMERO_SUFIXO.exec(c);
  if (numero) {
    return tresDigitos(numero[1]) + numero[2];
  }
  return c.replace(/\s+/g, '');
}

const PREFERENCIA_CODIGO = ['COD', 'CODIGO', 'TH CODE', 'THCODE', 'TALHAO', 'TALHOES', 'CD_UPNIVEL3', 'NOME'];

function chaveColuna(c: string): string {
  return semAcento(c).toUpperCase().trim();
}

/** Sugere a coluna do código PIMS (ordem: COD, CODIGO, TH CODE, THCODE, TALHAO, TALHÕES, CD_UPNIVEL3, NOME). */
export function sugerirColunaCodigo(colunas: string[]): string | null {
  for (const pref of PREFERENCIA_CODIGO) {
    const achada = colunas.find((c) => chaveColuna(c) === pref);
    if (achada !== undefined) return achada;
  }
  return null;
}

function codigoBrutoDe(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function partes(g: Geometry): MultiPolygon['coordinates'] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

/**
 * Agrupa as feições pelo código normalizado da coluna `campo`: as do mesmo código viram um MultiPolygon
 * com as props da primeira + `codigo`/`codigoBruto` (da primeira). Código vazio nunca é unido.
 * Mantém a ordem da primeira ocorrência; não altera a entrada.
 */
export function unirPorCodigo(feicoes: readonly FeicaoImportada[], campo: string): FeicaoImportada[] {
  const saida: FeicaoImportada[] = [];
  const grupos = new Map<string, { indice: number; geoms: Geometry[] }>();
  for (const f of feicoes) {
    const codigoBruto = codigoBrutoDe(f.props[campo]);
    const codigo = normalizarCodigo(codigoBruto);
    const existente = codigo === '' ? undefined : grupos.get(codigo);
    if (existente) {
      existente.geoms.push(f.geom);
      continue;
    }
    if (codigo !== '') grupos.set(codigo, { indice: saida.length, geoms: [f.geom] });
    saida.push({ geom: f.geom, props: { ...f.props, codigo, codigoBruto } });
  }
  for (const { indice, geoms } of grupos.values()) {
    if (geoms.length > 1) {
      saida[indice] = { ...saida[indice], geom: { type: 'MultiPolygon', coordinates: geoms.flatMap(partes) } };
    }
  }
  return saida;
}
