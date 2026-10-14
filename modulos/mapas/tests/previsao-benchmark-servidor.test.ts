import { describe, expect, it } from 'vitest';
import {
  diaMT, horaMT, somarDias, diasEntre, inicioSafraMT, pontosDasFazendas, previsaoZeusPorFazenda, previsaoVisualCrossing,
  previsaoMetNo, observadoPorFazenda, montarSqlPrevisaoZeus, montarSqlObservadoZeus, urlVisualCrossing, urlMetNo, assinaturaDaPrevisao,
  paresDoBenchmark, metricasDoBenchmark,
} from '../scripts/sincronizar-plantio.mjs';

// Todos os dados daqui são FICTÍCIOS.
const res = (columns: string[], rows: unknown[][]) => ({ columns, rows });

describe('benchmark de previsão: dia e hora de Mato Grosso', () => {
  it('UTC−4 fixo, inclusive perto da meia-noite UTC', () => {
    expect(diaMT('2026-10-15T03:59:00Z')).toBe('2026-10-14');
    expect(horaMT('2026-10-15T03:59:00Z')).toBe(23);
    expect(diaMT('2026-10-15T04:00:00Z')).toBe('2026-10-15');
    expect(horaMT('2026-10-15T10:17:00Z')).toBe(6);
    expect(horaMT(new Date('2026-10-15T09:59:00Z'))).toBe(5);
  });
  it('soma e diferença de dias, e início da safra (setembro)', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(diasEntre('2026-10-14', '2026-10-27')).toBe(13);
    expect(inicioSafraMT('2026-10-14')).toBe('2026-09-01');
    expect(inicioSafraMT('2027-08-31')).toBe('2026-09-01');
    expect(inicioSafraMT('2026-09-01')).toBe('2026-09-01');
  });
});

describe('benchmark de previsão: fazendas e pontos', () => {
  const PICS = res(['picid', 'picname', 'farm', 'lat', 'lon'], [
    ['10', 'PIC 1', 'Faz. Globo', -13.00001, -56.00004],
    ['11', 'PIC 2', 'Faz. Globo', -13.10001, -56.20004],
    ['12', 'PIC 3', 'Faz. Globo', null, null],
    ['20', 'PIC 9', 'Semi Confinamento', -14, -55],
    ['30', 'PIC 5', 'Fazenda Dourado', -15, -57],
  ]);
  it('ponto = média das coordenadas com 4 casas; fazenda fora do cadastro fica de fora', () => {
    const { pontos, fazendaDoPic } = pontosDasFazendas(PICS, ['GLOBO', 'NEBRASKA']);
    expect([...pontos.keys()]).toEqual(['GLOBO']);
    expect(pontos.get('GLOBO')).toEqual({ lat: -13.05, lon: -56.1 });
    // o pluviômetro sem coordenada não entra no ponto, mas a previsão dele conta para a fazenda
    expect(fazendaDoPic.get('12')).toBe('GLOBO');
    expect(fazendaDoPic.has('20')).toBe(false);
    expect(fazendaDoPic.has('30')).toBe(false);
  });
});

describe('benchmark de previsão: conversão de cada fonte', () => {
  const doPic = new Map([['10', 'GLOBO'], ['11', 'GLOBO']]);
  it('ZEUS: média dos pluviômetros por dia; probabilidade só de quem tem', () => {
    const z = previsaoZeusPorFazenda(res(['picid', 'dia', 'mm', 'prob'], [
      ['10', '2026-10-14', 4, 80], ['11', '2026-10-14', 6, null], ['10', '2026-10-15', 0, 10], ['99', '2026-10-15', 50, 99],
    ]), doPic);
    expect(z.get('GLOBO')).toEqual([{ d: '2026-10-14', mm: 5, p: 80 }, { d: '2026-10-15', mm: 0, p: 10 }]);
    expect(z.size).toBe(1);
  });
  it('SQL da ZEUS: só de hoje em diante, paginável', () => {
    expect(montarSqlPrevisaoZeus('2026-10-14')).toContain(`day::date >= DATE '2026-10-14'`);
    expect(montarSqlPrevisaoZeus('2026-10-14', 0, 4000)).toMatch(/ORDER BY 1, 2\s+OFFSET 0 LIMIT 4000$/);
  });
  it('Visual Crossing: mm com 1 casa e probabilidade inteira; dia inválido sai', () => {
    expect(previsaoVisualCrossing({ days: [
      { datetime: '2026-10-14', precip: 2.34, precipprob: 55.4 },
      { datetime: '2026-10-15', precip: 0, precipprob: null },
      { datetime: 'amanhã', precip: 3 },
      { datetime: '2026-10-17', precip: 'x' },
    ] })).toEqual([{ d: '2026-10-14', mm: 2.3, p: 55 }, { d: '2026-10-15', mm: 0, p: null }]);
    expect(previsaoVisualCrossing(null)).toEqual([]);
  });
  it('Visual Crossing e MET Norway: endereços (a chave vai codificada; coordenadas com 4 casas)', () => {
    expect(urlVisualCrossing({ lat: -13.05, lon: -56.1 }, 'a b')).toBe(
      'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/-13.05,-56.1?unitGroup=metric&include=days&contentType=json&key=a%20b');
    expect(urlMetNo({ lat: -13.05, lon: -56.1 })).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-13.05&lon=-56.1');
  });
  it('MET Norway: blocos de 6 h repartidos pela meia-noite de MT; só dias com 24 h', () => {
    const bloco = (time: string, mm: number) => ({ time, data: { next_6_hours: { details: { precipitation_amount: mm } } } });
    const serie = [];
    for (const dia of ['16', '17', '18']) for (const h of ['00', '06', '12', '18']) {
      serie.push(bloco(`2026-10-${dia}T${h}:00:00Z`, dia === '17' && h === '00' ? 12 : 6));
    }
    // 00Z do dia 16 = 20 h do dia 15 em MT: o dia 15 (4 h) e o dia 18 (20 h) ficam de fora
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 28, p: null }, { d: '2026-10-17', mm: 26, p: null }]);
  });
  it('MET Norway: no trecho de hora em hora usa o bloco de 1 h e não soma o de 6 h junto', () => {
    const serie = [];
    for (let h = 0; h < 24; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, 4 + h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3 } } } });
    }
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 12, p: null }]);
  });
  it('MET Norway: na passagem de 1 h para 6 h o último horário usa o bloco de 6 h (sem buraco no dia)', () => {
    const serie = [];
    // de hora em hora das 04Z às 18Z do dia 16 (meia-noite de MT às 14 h de MT), depois de 6 em 6 h
    for (let h = 4; h <= 18; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3 } } } });
    }
    serie.push({ time: '2026-10-17T00:00:00Z', data: { next_6_hours: { details: { precipitation_amount: 6 } } } });
    // 14 h × 0,5 (04Z–17Z) + o bloco das 18Z inteiro (3) + 4 h do bloco das 00Z (4 × 1) = 14; o dia 17 fica incompleto
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 14, p: null }]);
  });
  it('chuva medida: média dos pluviômetros que leram; quem não leu não conta como zero', () => {
    const obs = observadoPorFazenda(res(['picid', 'dia', 'mm'], [['10', '2026-10-13', 1], ['11', '2026-10-13', 3], ['99', '2026-10-13', 80]]), doPic);
    expect(obs).toEqual([{ unidade: 'GLOBO', dia: '2026-10-13', mm: 2, pluviometros: 2 }]);
    expect(montarSqlObservadoZeus('2026-10-12', '2026-10-13')).toContain('SELECT DISTINCT idprecipitation');
  });
  it('assinatura muda quando um valor muda e não depende da ordem do mapa', () => {
    const a = new Map([['GLOBO', [{ d: '2026-10-14', mm: 5, p: 80 }]], ['DOURADO', [{ d: '2026-10-14', mm: 1, p: null }]]]);
    const b = new Map([['DOURADO', [{ d: '2026-10-14', mm: 1, p: null }]], ['GLOBO', [{ d: '2026-10-14', mm: 5, p: 80 }]]]);
    const c = new Map([['GLOBO', [{ d: '2026-10-14', mm: 5.1, p: 80 }]], ['DOURADO', [{ d: '2026-10-14', mm: 1, p: null }]]]);
    expect(assinaturaDaPrevisao(a)).toBe(assinaturaDaPrevisao(b));
    expect(assinaturaDaPrevisao(a)).not.toBe(assinaturaDaPrevisao(c));
    expect(assinaturaDaPrevisao(a)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('benchmark de previsão: pares e métricas', () => {
  const foto = (fonte: string, unidade: string, emitida_em: string, dias: [string, number][]) =>
    ({ fonte, unidade, emitida_em, dias: dias.map(([d, mm]) => ({ d, mm, p: null })) });
  const medido = (unidade: string, dia: string, mm: number) => ({ unidade, dia, mm, pluviometros: 3 });

  it('comparação justa: dia em que uma fonte faltou sai para todas; D0 nunca entra', () => {
    const previsoes = [
      foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-01', 9], ['2026-10-02', 5], ['2026-10-03', 1]]),
      foto('metno', 'GLOBO', '2026-10-01', [['2026-10-02', 4]]), // o MET não tem o dia 3 nesta foto...
      foto('metno', 'GLOBO', '2026-10-02', [['2026-10-04', 1]]), // ...mas alcança k = 2 em outra: o dia 3 (k = 2) sai para a ZEUS também
    ];
    const pares = paresDoBenchmark(previsoes, [medido('GLOBO', '2026-10-01', 9), medido('GLOBO', '2026-10-02', 2), medido('GLOBO', '2026-10-03', 0)]);
    expect(pares.map((p) => `${p.fonte} ${p.dia} k${p.k}`).sort()).toEqual(['metno 2026-10-02 k1', 'zeus 2026-10-02 k1']);
  });

  it('antecedência que uma fonte nunca alcança não tira as outras', () => {
    const previsoes = [
      foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-10', 2], ['2026-10-14', 3]]), // k = 9 e k = 13
      foto('metno', 'GLOBO', '2026-10-01', [['2026-10-10', 1]]), // o MET chega só a k = 9
    ];
    const pares = paresDoBenchmark(previsoes, [medido('GLOBO', '2026-10-14', 2), medido('GLOBO', '2026-10-10', 1)]);
    // k = 9: as duas fontes; k = 13: só a ZEUS alcança, e o par dela fica
    expect(pares.map((p) => `${p.fonte} k${p.k}`).sort()).toEqual(['metno k9', 'zeus k13', 'zeus k9']);
  });

  it('dia sem chuva medida (sem pluviômetro lido) não entra', () => {
    const pares = paresDoBenchmark([foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-02', 5]])], [{ unidade: 'GLOBO', dia: '2026-10-02', mm: 0, pluviometros: 0 }]);
    expect(pares).toEqual([]);
  });

  it('erro médio, viés e acerto conferidos à mão; TODAS junta as fazendas', () => {
    const pares = [
      { fonte: 'zeus', unidade: 'GLOBO', dia: '2026-10-10', k: 1, previsto: 0, medido: 0 },
      { fonte: 'zeus', unidade: 'GLOBO', dia: '2026-10-11', k: 1, previsto: 5, medido: 2 },
      { fonte: 'zeus', unidade: 'GLOBO', dia: '2026-10-12', k: 1, previsto: 12, medido: 20 },
      { fonte: 'zeus', unidade: 'DOURADO', dia: '2026-10-12', k: 1, previsto: 0, medido: 4 },
    ];
    const m = metricasDoBenchmark(pares, '2026-10-14');
    const de = (unidade: string, periodo: string, antecedencia: number) => m.find((x) => x.unidade === unidade && x.periodo === periodo && x.fonte === 'zeus' && x.antecedencia === antecedencia);
    // GLOBO: |0−0|, |5−2|, |12−20| → 11/3 = 3,7; (0 + 3 − 8)/3 = −1,7; os três acertam chuva/sem chuva
    expect(de('GLOBO', '30d', 1)).toEqual({ unidade: 'GLOBO', periodo: '30d', fonte: 'zeus', antecedencia: 1, n: 3, erro_medio: 3.7, vies: -1.7, acerto: 100 });
    // a média de 1 a 7 junta os mesmos pares
    expect(de('GLOBO', '30d', 0)?.n).toBe(3);
    // TODAS: os 4 pares; DOURADO errou (0 previsto, 4 medido) → acerto 75
    expect(de('TODAS', 'safra', 1)).toMatchObject({ n: 4, erro_medio: 3.8, acerto: 75 });
    // sem par na antecedência 3: não há linha
    expect(de('GLOBO', '30d', 3)).toBeUndefined();
  });

  it('janelas de período contam até ontem', () => {
    const p = (dia: string) => ({ fonte: 'zeus', unidade: 'GLOBO', dia, k: 1, previsto: 1, medido: 1 });
    const m = metricasDoBenchmark([p('2026-09-13'), p('2026-09-14'), p('2026-10-13'), p('2026-10-14')], '2026-10-14');
    const n = (periodo: string) => m.find((x) => x.unidade === 'GLOBO' && x.periodo === periodo && x.antecedencia === 1)?.n;
    expect(n('30d')).toBe(2); // 14/09 a 13/10, 30 dias (o dia de hoje não conta)
    expect(n('60d')).toBe(3); // 15/08 a 13/10
    expect(n('safra')).toBe(3); // desde 01/09
  });
});
