import { describe, expect, it } from 'vitest';
import { fmtChuva, fmtData, fmtMilhar, fmtPeriodo, isoData, parseDataBr, parseIsoData } from '../src/lib/format';

const d = (dia: number, mes: number, ano: number) => new Date(ano, mes - 1, dia);

describe('fmtChuva', () => {
  it('usa uma casa decimal com ponto e remove ".0"', () => {
    expect(fmtChuva(317.8)).toBe('317.8');
    expect(fmtChuva(332)).toBe('332');
    expect(fmtChuva(0.04)).toBe('0');
    expect(fmtChuva(1234.56)).toBe('1234.6');
    expect(fmtChuva(24.96)).toBe('25');
  });
});

describe('fmtMilhar', () => {
  it('separa milhar com ponto', () => {
    expect(fmtMilhar(2500)).toBe('2.500');
    expect(fmtMilhar(250)).toBe('250');
    expect(fmtMilhar(10000)).toBe('10.000');
  });
});

describe('datas', () => {
  it('lê data brasileira com e sem hora', () => {
    expect(parseDataBr('20/08/2025 00:00')?.getTime()).toBe(new Date(2025, 7, 20, 0, 0).getTime());
    expect(parseDataBr('20/08/2025 14:35')?.getTime()).toBe(new Date(2025, 7, 20, 14, 35).getTime());
    expect(parseDataBr('01/02/2025')?.getTime()).toBe(d(1, 2, 2025).getTime());
    expect(parseDataBr('')).toBeNull();
    expect(parseDataBr('abc')).toBeNull();
    expect(parseDataBr('32/13/2025')).toBeNull();
  });
  it('formata dd/MM/yyyy', () => {
    expect(fmtData(d(5, 2, 2026))).toBe('05/02/2026');
  });
});

describe('fmtPeriodo', () => {
  it('mesmo dia', () => expect(fmtPeriodo(d(15, 2, 2025), d(15, 2, 2025))).toBe('15/02/2025'));
  it('mesmo mês', () => expect(fmtPeriodo(d(1, 2, 2025), d(15, 2, 2025))).toBe('01 a 15/02/2025'));
  it('mesmo ano', () => expect(fmtPeriodo(d(1, 1, 2025), d(15, 2, 2025))).toBe('01/01 a 15/02/2025'));
  it('anos diferentes', () => expect(fmtPeriodo(d(1, 12, 2024), d(15, 1, 2025))).toBe('01/12/2024 a 15/01/2025'));
  it('nulos', () => {
    expect(fmtPeriodo(null, null)).toBe('');
    expect(fmtPeriodo(d(3, 3, 2025), null)).toBe('03/03/2025');
  });
});

describe('datas ISO (sem fuso)', () => {
  it('lê "yyyy-mm-dd" como data local, sem voltar um dia', () => {
    expect(parseIsoData('2025-02-26')?.getTime()).toBe(d(26, 2, 2025).getTime());
    expect(parseIsoData('2025-02-26T00:00:00.000Z')?.getDate()).toBe(26);
    expect(parseIsoData(null)).toBeNull();
    expect(parseIsoData('xx')).toBeNull();
  });
  it('ida e volta com isoData', () => {
    expect(isoData(parseIsoData('2026-09-01')!)).toBe('2026-09-01');
  });
});
