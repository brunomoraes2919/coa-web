import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCsvBuffer, lerNumeroCsv, parseZeusCsv, ZeusCsvError } from '../src/lib/zeusCsv';

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const d = (dia: number, mes: number, ano: number, h = 0, min = 0) => new Date(ano, mes - 1, dia, h, min);

describe('parseZeusCsv (fixture sintética)', () => {
  const texto = readFileSync('tests/fixtures/zeus-exemplo.csv', 'utf8');
  const r = parseZeusCsv(texto);

  it('lê os 5 PICs da fixture', () => {
    expect(r.pics).toHaveLength(5);
  });

  it('converte número com vírgula decimal e nome com vírgula entre aspas', () => {
    const p0 = r.pics[0];
    expect(p0.id).toBe('1001');
    expect(p0.nome).toBe('PIC 01 (TH1,2) FAZENDA');
    expect(p0.lat).toBeCloseTo(-13.741234, 6);
    expect(p0.lon).toBeCloseTo(-57.135678, 6);
    expect(p0.chuva).toBeCloseTo(2.3, 6);
  });

  it('marca inativo e incluir corretamente', () => {
    const [p0, p1, p2, p3, p4] = r.pics;
    expect(p0.inativo).toBe(false);
    expect(p0.incluir).toBe(true);

    expect(p1.inativo).toBe(true);
    expect(p1.chuva).toBeCloseTo(5.1, 6);
    expect(p1.incluir).toBe(false); // inativo

    expect(p2.chuva).toBeNull();
    expect(p2.inativo).toBe(false);
    expect(p2.incluir).toBe(false); // sem chuva

    expect(p3.chuva).toBeCloseTo(10, 6);
    expect(p3.incluir).toBe(true);

    expect(p4.chuva).toBe(0);
    expect(p4.incluir).toBe(true); // chuva 0 não é "sem chuva"
  });

  it('calcula período pelo menor início e maior fim', () => {
    expect(r.periodoInicio?.getTime()).toBe(d(19, 8, 2025).getTime());
    expect(r.periodoFim?.getTime()).toBe(d(21, 8, 2025).getTime());
  });

  it('gera os 2 avisos agregados (1 inativo, 1 sem precipitação) e ignora a linha em branco', () => {
    expect(r.avisos).toEqual(['1 PIC inativo foi desmarcado', '1 PIC sem precipitação foi desmarcado']);
  });
});

const CABECALHO = 'id,nome,lat,lon,início do periodo [GMT-3],final do periodo [GMT-3],Pic Inativa,precipitação [mm]';
const linhaCsv = (id: number, inativa: string, chuva: string) => `${id},"PIC ${id}","-13,5","-57,5",20/08/2025 00:00,20/08/2025 00:00,${inativa},${chuva}`;

describe('parseZeusCsv (avisos no plural)', () => {
  it('usa o plural com 2 ou mais PICs', () => {
    const texto = [CABECALHO, linhaCsv(1, 'Sim', '"1,0"'), linhaCsv(2, 'Sim', '"2,0"'), linhaCsv(3, 'Não', ''), linhaCsv(4, 'Não', '')].join('\r\n');
    expect(parseZeusCsv(texto).avisos).toEqual(['2 PICs inativos foram desmarcados', '2 PICs sem precipitação foram desmarcados']);
  });
});

describe('parseZeusCsv (formatos de número da precipitação)', () => {
  it('aceita "1.234,5" (milhar com ponto e decimal com vírgula), "1234,5" e "1234.5"', () => {
    const texto = [CABECALHO, linhaCsv(1, 'Não', '"1.234,5"'), linhaCsv(2, 'Não', '"1234,5"'), linhaCsv(3, 'Não', '1234.5'), linhaCsv(4, 'Não', '"2.001.234,25"')].join('\r\n');
    const r = parseZeusCsv(texto);
    expect(r.pics.map((p) => p.chuva)).toEqual([1234.5, 1234.5, 1234.5, 2001234.25]);
    expect(r.pics.every((p) => p.incluir)).toBe(true);
    expect(r.avisos).toEqual([]);
  });

  it('valor não vazio que não pode ser lido gera aviso por linha (não vira "sem precipitação" em silêncio)', () => {
    const texto = [CABECALHO, linhaCsv(1, 'Não', '"1,0"'), linhaCsv(2, 'Não', 'abc'), linhaCsv(3, 'Não', '"1,2,3"'), linhaCsv(4, 'Não', '')].join('\r\n');
    const r = parseZeusCsv(texto);
    expect(r.pics).toHaveLength(4);
    expect(r.pics[1].chuva).toBeNull();
    expect(r.pics[1].incluir).toBe(false);
    expect(r.avisos).toEqual([
      'Linha 3: precipitação inválida "abc"',
      'Linha 4: precipitação inválida "1,2,3"',
      '1 PIC sem precipitação foi desmarcado',
    ]);
  });
});

describe('lerNumeroCsv', () => {
  it('um só separador é decimal; milhar só com ponto + vírgula decimal (ou vários pontos)', () => {
    expect(lerNumeroCsv(' -13,741234 ')).toBeCloseTo(-13.741234, 9);
    expect(lerNumeroCsv('1.234')).toBeCloseTo(1.234, 9);
    expect(lerNumeroCsv('1,234.5')).toBe(1234.5);
    expect(lerNumeroCsv('1.234.567')).toBe(1234567);
    expect(lerNumeroCsv('0')).toBe(0);
    expect(lerNumeroCsv('')).toBeNull();
    expect(lerNumeroCsv(undefined)).toBeNull();
    for (const invalido of ['-', 'abc', '1,2,3', '1.23.4', '12a', '1.234,5,6']) expect(lerNumeroCsv(invalido)).toBeNaN();
  });
});

describe('parseZeusCsv (separador ;)', () => {
  it('detecta separador ; pelo cabeçalho', () => {
    const texto = [
      'id;nome;lat;lon;início do periodo [GMT-3];final do periodo [GMT-3];Pic Inativa;precipitação [mm]',
      '2001;PIC X;-13,5;-57,5;20/08/2025 00:00;20/08/2025 00:00;Não;4,2',
    ].join('\r\n');
    const r = parseZeusCsv(texto);
    expect(r.pics).toHaveLength(1);
    expect(r.pics[0].lat).toBeCloseTo(-13.5, 6);
    expect(r.pics[0].lon).toBeCloseTo(-57.5, 6);
    expect(r.pics[0].chuva).toBeCloseTo(4.2, 6);
  });
});

describe('parseZeusCsv (coordenada inválida)', () => {
  it('ignora a linha e avisa, mantendo as demais', () => {
    const texto = [
      'id,nome,lat,lon,início do periodo [GMT-3],final do periodo [GMT-3],Pic Inativa,precipitação [mm]',
      '3001,"PIC A","-13,5","-57,5",20/08/2025 00:00,20/08/2025 00:00,Não,"1,2"',
      '3002,"PIC B",abc,"-57,5",20/08/2025 00:00,20/08/2025 00:00,Não,"3,3"',
    ].join('\r\n');
    const r = parseZeusCsv(texto);
    expect(r.pics).toHaveLength(1);
    expect(r.pics[0].id).toBe('3001');
    expect(r.avisos).toContain('Linha 3 ignorada: coordenada inválida');
  });
});

describe('parseZeusCsv (coluna obrigatória faltando)', () => {
  it('lança ZeusCsvError com o nome da coluna de precipitação quando ela não existe', () => {
    const texto = [
      'id,nome,lat,lon,início do periodo [GMT-3],final do periodo [GMT-3],Pic Inativa',
      '4001,PIC A,"-13,5","-57,5",20/08/2025 00:00,20/08/2025 00:00,Não',
    ].join('\r\n');
    expect(() => parseZeusCsv(texto)).toThrow(ZeusCsvError);
    expect(() => parseZeusCsv(texto)).toThrow('Coluna "precipitação [mm]" não encontrada no CSV');
  });

  it('lança ZeusCsvError quando falta a coluna lat', () => {
    const texto = [
      'id,nome,lon,precipitação [mm]',
      '4001,PIC A,"-57,5","1,0"',
    ].join('\r\n');
    expect(() => parseZeusCsv(texto)).toThrow(ZeusCsvError);
  });
});

describe('decodeCsvBuffer', () => {
  it('remove o BOM UTF-8 e decodifica normalmente', () => {
    const texto = 'id,nome\r\n1,Teste ção';
    const utf8 = new TextEncoder().encode(texto);
    const comBom = new Uint8Array(utf8.length + 3);
    comBom.set([0xef, 0xbb, 0xbf], 0);
    comBom.set(utf8, 3);
    const resultado = decodeCsvBuffer(comBom.buffer);
    expect(resultado.charCodeAt(0)).not.toBe(0xfeff);
    expect(resultado).toBe(texto);
  });

  it('decodifica como windows-1252 quando os bytes não são UTF-8 válido (ex.: "ç" e "ã" em latin1)', () => {
    const bytes = new Uint8Array([
      ...Array.from('precipita').map((c) => c.charCodeAt(0)),
      0xe7, // ç em windows-1252
      0xe3, // ã em windows-1252
      ...Array.from('o').map((c) => c.charCodeAt(0)),
    ]);
    const texto = decodeCsvBuffer(bytes.buffer);
    expect(texto).toBe('precipitação');
    expect(texto).toContain('ç');
  });
});

describe('parseZeusCsv (CSV real da ZEUS)', () => {
  const caminho = 'dados-teste/guapirama-fev-2025.csv';
  it.skipIf(!existsSync(caminho))('lê os 39 PICs de guapirama-fev-2025.csv', () => {
    const buf = readFileSync(caminho);
    const texto = decodeCsvBuffer(toArrayBuffer(buf));
    const r = parseZeusCsv(texto);
    expect(r.pics).toHaveLength(39);
    for (const p of r.pics) {
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.lon)).toBe(true);
    }
    expect(r.periodoInicio).not.toBeNull();
    expect(r.periodoFim).not.toBeNull();
  });
});
