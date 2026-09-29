/** Parser do CSV exportado pela estação ZEUS (rede de PICs pluviométricos). */
import type { Pic, ZeusCsvResult } from './types';
import { parseDataBr } from './format';

export class ZeusCsvError extends Error {}

/**
 * Decodifica o buffer do arquivo como UTF-8 (removendo BOM). Se os bytes não formarem
 * UTF-8 válido, decodifica como windows-1252 (alguns exports da ZEUS saem em latin1/cp1252).
 */
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    texto = new TextDecoder('windows-1252').decode(buf);
  }
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/** minúsculas, sem acento, espaços colapsados e sem espaços nas pontas */
function normalizarCabecalho(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarValor(s: string): string {
  return s.trim().toLowerCase();
}

/** "1.234,5" (milhar com ponto, decimal com vírgula) ou "1.234.567" (só milhar) */
const MILHAR_PONTO = /^[+-]?\d{1,3}(\.\d{3})+,\d+$|^[+-]?\d{1,3}(\.\d{3}){2,}$/;
/** "1,234.5" (milhar com vírgula, decimal com ponto) */
const MILHAR_VIRGULA = /^[+-]?\d{1,3}(,\d{3})+\.\d+$/;
/** "1234,5", "1234.5", "1234", ",5" */
const SIMPLES = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * Número do CSV: decimal com vírgula ou ponto ("1234,5", "1234.5") e milhar com ponto ("1.234,5").
 * Um só separador é sempre decimal ("1.234" = 1,234). Vazio → null; texto que não é número → NaN.
 */
export function lerNumeroCsv(raw: string | undefined): number | null {
  const s = (raw ?? '').replace(/\s+/g, '');
  if (s === '') return null;
  let normal: string;
  if (MILHAR_PONTO.test(s)) normal = s.replace(/\./g, '').replace(',', '.');
  else if (MILHAR_VIRGULA.test(s)) normal = s.replace(/,/g, '');
  else if (SIMPLES.test(s)) normal = s.replace(',', '.');
  else return NaN;
  const v = Number(normal);
  return Number.isFinite(v) ? v : NaN;
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

function ehVerdadeiro(raw: string | undefined): boolean {
  const v = normalizarValor(raw ?? '');
  return v === 'sim' || v === 'true' || v === '1';
}

function detectarSeparador(text: string): ',' | ';' {
  const nl = text.indexOf('\n');
  const linhaCabecalho = nl === -1 ? text : text.slice(0, nl);
  const virgulas = (linhaCabecalho.match(/,/g) ?? []).length;
  const pontosEVirgulas = (linhaCabecalho.match(/;/g) ?? []).length;
  return pontosEVirgulas > virgulas ? ';' : ',';
}

/** Parser de CSV simples com suporte a campos entre aspas (separador/quebra de linha literais, "" = aspas escapada). */
function parseCsvRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === sep) {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\r') {
      i += 1;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function isLinhaVazia(row: string[]): boolean {
  return row.every((f) => f.trim() === '');
}

interface ColunasZeus {
  id: number;
  nome: number;
  lat: number;
  lon: number;
  inicio: number;
  fim: number;
  picInativa: number;
  chuva: number;
}

function resolverColunas(headerRow: string[]): ColunasZeus {
  const norm = headerRow.map(normalizarCabecalho);

  const lat = norm.indexOf('lat');
  const lon = norm.indexOf('lon');
  const chuva = norm.findIndex((h) => h.startsWith('precipitacao') || h.startsWith('chuva'));

  if (lat === -1) throw new ZeusCsvError('Coluna "lat" não encontrada no CSV');
  if (lon === -1) throw new ZeusCsvError('Coluna "lon" não encontrada no CSV');
  if (chuva === -1) throw new ZeusCsvError('Coluna "precipitação [mm]" não encontrada no CSV');

  return {
    id: norm.indexOf('id'),
    nome: norm.indexOf('nome'),
    lat,
    lon,
    inicio: norm.findIndex((h) => h.startsWith('inicio do periodo')),
    fim: norm.findIndex((h) => h.startsWith('final do periodo')),
    picInativa: norm.indexOf('pic inativa'),
    chuva,
  };
}

/** Analisa o texto do CSV da ZEUS (já decodificado) e retorna os PICs, o período coberto e avisos. */
export function parseZeusCsv(text: string): ZeusCsvResult {
  const semBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = detectarSeparador(semBom);
  const rows = parseCsvRows(semBom, sep);
  if (rows.length === 0) throw new ZeusCsvError('CSV vazio');

  const cols = resolverColunas(rows[0]);

  const pics: Pic[] = [];
  const avisos: string[] = [];
  let inativos = 0;
  let semChuva = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const linha = i + 1; // número da linha no arquivo (cabeçalho = linha 1)
    if (isLinhaVazia(row)) continue;

    const lat = lerNumeroCsv(row[cols.lat]);
    const lon = lerNumeroCsv(row[cols.lon]);
    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
      avisos.push(`Linha ${linha} ignorada: coordenada inválida`);
      continue;
    }

    const id = cols.id >= 0 ? (row[cols.id] ?? '').trim() : '';
    const nome = cols.nome >= 0 ? (row[cols.nome] ?? '').trim() : '';
    const inicio = cols.inicio >= 0 ? parseDataBr(row[cols.inicio] ?? '') : null;
    const fim = cols.fim >= 0 ? parseDataBr(row[cols.fim] ?? '') : null;
    const inativo = cols.picInativa >= 0 ? ehVerdadeiro(row[cols.picInativa]) : false;
    const brutoChuva = (row[cols.chuva] ?? '').trim();
    let chuva = lerNumeroCsv(brutoChuva);
    if (chuva !== null && Number.isNaN(chuva)) {
      // valor presente mas ilegível: avisa na linha (não é "sem precipitação")
      avisos.push(`Linha ${linha}: precipitação inválida "${brutoChuva}"`);
      chuva = null;
    } else if (chuva === null) {
      semChuva += 1;
    }

    if (inativo) inativos += 1;

    pics.push({
      id,
      nome,
      lat,
      lon,
      chuva,
      inativo,
      inicio,
      fim,
      incluir: !inativo && chuva !== null,
    });
  }

  if (inativos > 0) avisos.push(plural(inativos, 'PIC inativo foi desmarcado', 'PICs inativos foram desmarcados'));
  if (semChuva > 0) avisos.push(plural(semChuva, 'PIC sem precipitação foi desmarcado', 'PICs sem precipitação foram desmarcados'));

  let periodoInicio: Date | null = null;
  let periodoFim: Date | null = null;
  for (const p of pics) {
    if (p.inicio && (!periodoInicio || p.inicio < periodoInicio)) periodoInicio = p.inicio;
    if (p.fim && (!periodoFim || p.fim > periodoFim)) periodoFim = p.fim;
  }

  return { pics, periodoInicio, periodoFim, avisos };
}
