import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diaMT, horaMT, somarDias, diasEntre, inicioSafraMT, pontosDasFazendas, previsaoZeusPorFazenda, previsaoVisualCrossing,
  previsaoMetNo, observadoPorFazenda, montarSqlPrevisaoZeus, montarSqlObservadoZeus, urlVisualCrossing, urlMetNo, assinaturaDaPrevisao,
  paresDoBenchmark, metricasDoBenchmark, PREV_USER_AGENT, rodarBenchmarkPrevisao,
} from '../scripts/sincronizar-plantio.mjs';
import { servidoresFalsos, URL_SB, URL_AGROVEX, CHAVE, TOKEN } from './helpers/servidoresFalsos';

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
    ] })).toEqual([{ d: '2026-10-14', mm: 2.3, p: 55, tx: null, tn: null }, { d: '2026-10-15', mm: 0, p: null, tx: null, tn: null }]);
    expect(previsaoVisualCrossing(null)).toEqual([]);
  });
  it('Visual Crossing: máxima e mínima com 1 casa; ausente ou inválida vira null', () => {
    expect(previsaoVisualCrossing({ days: [
      { datetime: '2026-10-14', precip: 1, precipprob: 10, tempmax: 33.46, tempmin: 21.04 },
      { datetime: '2026-10-15', precip: 0, precipprob: 0, tempmax: 'x' },
    ] })).toEqual([{ d: '2026-10-14', mm: 1, p: 10, tx: 33.5, tn: 21 }, { d: '2026-10-15', mm: 0, p: 0, tx: null, tn: null }]);
  });
  it('Visual Crossing e MET Norway: endereços (a chave vai codificada; coordenadas com 4 casas)', () => {
    expect(urlVisualCrossing({ lat: -13.05, lon: -56.1 }, 'a b')).toBe(
      'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/-13.05,-56.1?unitGroup=metric&include=days&contentType=json&key=a%20b');
    expect(urlMetNo({ lat: -13.05, lon: -56.1 })).toBe('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=-13.05&lon=-56.1');
  });
  it('MET Norway: blocos de 6 h repartidos pela meia-noite de MT; temperatura do bloco no dia da maioria das horas; só dias com 24 h', () => {
    const temp: Record<string, [number, number]> = { '00': [26, 22], '06': [24, 19], '12': [31, 23], '18': [34, 28] };
    const bloco = (time: string, mm: number, [max, min]: [number, number]) =>
      ({ time, data: { next_6_hours: { details: { precipitation_amount: mm, air_temperature_max: max, air_temperature_min: min } } } });
    const serie = [];
    for (const dia of ['16', '17', '18']) for (const h of ['00', '06', '12', '18']) {
      serie.push(bloco(`2026-10-${dia}T${h}:00:00Z`, dia === '17' && h === '00' ? 12 : 6, dia === '17' && h === '12' ? [36, 23] : temp[h]));
    }
    // 00Z do dia 16 = 20 h do dia 15 em MT: o dia 15 (4 h) e o dia 18 (20 h) ficam de fora. O bloco das 00Z
    // (20 h às 2 h de MT) conta a temperatura no dia anterior, onde estão 4 das 6 horas.
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([
      { d: '2026-10-16', mm: 28, p: null, tx: 34, tn: 19 },
      { d: '2026-10-17', mm: 26, p: null, tx: 36, tn: 19 },
    ]);
  });
  it('MET Norway: no trecho de hora em hora usa o bloco de 1 h (e a temperatura de cada hora), sem somar o de 6 h junto', () => {
    const serie = [];
    for (let h = 0; h < 24; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, 4 + h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { instant: { details: { air_temperature: 20 + (h % 12) } }, next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3 } } } });
    }
    // as 23 primeiras horas usam a hora (20 a 31 °C); a última vira bloco de 6 h (sem máxima e mínima) e conta no dia 17
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 12, p: null, tx: 31, tn: 20 }]);
  });
  it('MET Norway: na passagem de 1 h para 6 h o último horário usa o bloco de 6 h (sem buraco no dia)', () => {
    const serie = [];
    for (let h = 4; h <= 18; h++) {
      const t = new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', '');
      serie.push({ time: t, data: { instant: { details: { air_temperature: 25 } }, next_1_hours: { details: { precipitation_amount: 0.5 } }, next_6_hours: { details: { precipitation_amount: 3, air_temperature_max: 33, air_temperature_min: 27 } } } });
    }
    serie.push({ time: '2026-10-17T00:00:00Z', data: { next_6_hours: { details: { precipitation_amount: 6, air_temperature_max: 26, air_temperature_min: 21 } } } });
    // chuva: 14 h × 0,5 (04Z–17Z) + o bloco das 18Z (3) + 4 h do bloco das 00Z (4 × 1) = 14. Temperatura: horas a 25 °C,
    // bloco das 18Z (33/27) e o das 00Z (26/21), que tem 4 das 6 horas no dia 16 → máxima 33, mínima 21
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 14, p: null, tx: 33, tn: 21 }]);
  });
  it('MET Norway: sem temperatura na resposta, máxima e mínima ficam null e a chuva continua', () => {
    const serie = [0, 6, 12, 18, 24].map((h) => ({ time: new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', ''), data: { next_6_hours: { details: { precipitation_amount: 1.2 } } } }));
    expect(previsaoMetNo({ properties: { timeseries: serie } })).toEqual([{ d: '2026-10-16', mm: 4.8, p: null, tx: null, tn: null }]);
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
      foto('metno', 'GLOBO', '2026-10-01', [['2026-10-02', 4]]), // o MET não tem o dia 3 para a Globo nesta foto...
      foto('metno', 'DOURADO', '2026-10-01', [['2026-10-02', 0], ['2026-10-03', 1]]), // ...mas a foto do dia chega a k = 2: o dia 3 sai para a ZEUS também
    ];
    const pares = paresDoBenchmark(previsoes, [medido('GLOBO', '2026-10-01', 9), medido('GLOBO', '2026-10-02', 2), medido('GLOBO', '2026-10-03', 0)]);
    expect(pares.map((p) => `${p.fonte} ${p.dia} k${p.k}`).sort()).toEqual(['metno 2026-10-02 k1', 'zeus 2026-10-02 k1']);
  });

  it('fonte sem foto num dia (parou, ou ainda não tinha começado) não tira os pares das outras desse dia', () => {
    const previsoes = [
      foto('zeus', 'GLOBO', '2026-10-01', [['2026-10-02', 5]]),
      foto('zeus', 'GLOBO', '2026-10-03', [['2026-10-04', 5]]),
      foto('zeus', 'GLOBO', '2026-10-05', [['2026-10-06', 5]]),
      // o Visual Crossing só tirou a foto do dia 3 (chave instalada no dia 3 e recusada a partir do dia 5)
      foto('visualcrossing', 'GLOBO', '2026-10-03', [['2026-10-04', 3], ['2026-10-17', 0]]),
    ];
    const pares = paresDoBenchmark(previsoes, ['2026-10-02', '2026-10-04', '2026-10-06'].map((d) => medido('GLOBO', d, 4)));
    expect(pares.map((p) => `${p.fonte} ${p.dia}`).sort()).toEqual(['visualcrossing 2026-10-04', 'zeus 2026-10-02', 'zeus 2026-10-04', 'zeus 2026-10-06']);
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

describe('benchmark de previsão: etapa da rotina', () => {
  const PICS = { columns: ['picid', 'picname', 'farm', 'lat', 'lon'], rows: [['10', 'PIC 1', 'Faz. Globo', -13, -56], ['11', 'PIC 2', 'Faz. Globo', -13.2, -56.2]] };
  const ZEUS = { columns: ['picid', 'dia', 'mm', 'prob'], rows: [['10', '2026-10-15', 4, 80], ['11', '2026-10-15', 6, 90], ['10', '2026-10-16', 0, 5], ['11', '2026-10-16', 0, 5]] };
  const ZEUS_GLOBO = [{ d: '2026-10-15', mm: 5, p: 85 }, { d: '2026-10-16', mm: 0, p: 5 }];
  const OBS = { columns: ['picid', 'dia', 'mm'], rows: [['10', '2026-10-14', 2], ['11', '2026-10-14', 4]] };
  const CHAVE_VC = ['chave', 'visual', 'inventada'].join('-');
  const VC = { days: [{ datetime: '2026-10-15', precip: 3.2, precipprob: 70 }, { datetime: '2026-10-16', precip: 0, precipprob: 10 }] };
  // 6 em 6 h: cobre o dia 16 de MT inteiro (16T04Z a 17T04Z)
  const MET = { properties: { timeseries: [0, 6, 12, 18, 24].map((h) => ({ time: new Date(Date.UTC(2026, 9, 16, h)).toISOString().replace('.000', ''), data: { next_6_hours: { details: { precipitation_amount: 1.2 } } } })) } };
  const tabelas = () => ({
    mapas_fazendas: [{ unidade_pims: 'GLOBO' }, { unidade_pims: 'NEBRASKA' }],
    prev_zeus_atualizacoes: [], prev_previsoes: [], prev_observado: [], prev_metricas: [],
  });
  // o fetch da rotina: Supabase e Agrovex falsos, e respostas prontas para as duas fontes de fora
  function montar(opcoes: { vc?: number; met?: number } = {}, extras: Record<string, Record<string, unknown>[]> = {}) {
    const s = servidoresFalsos({ ...tabelas(), ...extras }, [PICS, ZEUS, OBS]);
    const externas: { url: string; ua: string; prazo: boolean }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const ua = String((init?.headers as Record<string, string> | undefined)?.['User-Agent'] ?? '');
      const prazo = init?.signal instanceof AbortSignal;
      if (url.startsWith('https://weather.visualcrossing.com/')) { externas.push({ url, ua, prazo }); return new Response(JSON.stringify(VC), { status: opcoes.vc ?? 200 }); }
      if (url.startsWith('https://api.met.no/')) { externas.push({ url, ua, prazo }); return new Response(JSON.stringify(MET), { status: opcoes.met ?? 200 }); }
      return s.impl(url, init);
    };
    const gravado = (tabela: string) => s.chamadas
      .filter((c) => c.url.startsWith(`${URL_SB}/rest/v1/${tabela}?`) && c.init?.method === 'POST')
      .flatMap((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>[]);
    return { s, fetchImpl, externas, gravado };
  }
  const rodar = (m: ReturnType<typeof montar>, agora: string, chave = CHAVE_VC) =>
    rodarBenchmarkPrevisao({ agrovex: { url: URL_AGROVEX, token: TOKEN }, supabase: { url: URL_SB, chave: CHAVE }, visualCrossingChave: chave, fetchImpl: m.fetchImpl as typeof fetch, agora: new Date(agora) });
  const fontes = (linhas: Record<string, unknown>[]) => linhas.map((f) => String(f.fonte)).sort();
  afterEach(() => vi.restoreAllMocks());

  it('às 6 h de MT tira a foto das três fontes, grava a chuva medida e a mudança da ZEUS', async () => {
    const m = montar();
    expect(await rodar(m, '2026-10-15T10:17:00Z')).toBeNull();
    const fotos = m.gravado('prev_previsoes');
    expect(fontes(fotos)).toEqual(['metno', 'visualcrossing', 'zeus']);
    expect(fotos.every((f) => f.unidade === 'GLOBO' && f.emitida_em === '2026-10-15')).toBe(true);
    expect(fotos.find((f) => f.fonte === 'zeus')?.dias).toEqual(ZEUS_GLOBO);
    expect(fotos.find((f) => f.fonte === 'metno')?.dias).toEqual([{ d: '2026-10-16', mm: 4.8, p: null, tx: null, tn: null }]);
    expect(m.gravado('prev_observado')).toEqual([{ unidade: 'GLOBO', dia: '2026-10-14', mm: 3, pluviometros: 2 }]);
    expect(m.gravado('prev_zeus_atualizacoes')).toHaveLength(1);
    // MET Norway: ponto = média dos pluviômetros, e a identificação exigida
    const met = m.externas.find((e) => e.url.startsWith('https://api.met.no/'));
    expect(met?.url).toBe('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=-13.1&lon=-56.1');
    expect(met?.ua).toBe(PREV_USER_AGENT);
    // toda chamada de fora sai com prazo (a rotina não fica presa esperando uma fonte)
    expect(m.externas.every((e) => e.prazo)).toBe(true);
  });

  it('antes das 6 h de MT (mesmo sendo 9 h em UTC) não tira foto, mas grava a chuva medida', async () => {
    const m = montar();
    expect(await rodar(m, '2026-10-15T09:59:00Z')).toBeNull();
    expect(m.gravado('prev_previsoes')).toEqual([]);
    expect(m.externas).toEqual([]);
    expect(m.gravado('prev_observado')).toHaveLength(1);
  });

  it('rodada seguinte do mesmo dia: busca só o que faltou, não recalcula as métricas e não regrava a ZEUS sem mudança', async () => {
    const m = montar({}, {
      prev_previsoes: [{ fonte: 'zeus', unidade: 'GLOBO', emitida_em: '2026-10-15' }, { fonte: 'metno', unidade: 'GLOBO', emitida_em: '2026-10-15' }],
      prev_metricas: [{ calculado_em: '2026-10-15T10:17:00Z' }],
      prev_zeus_atualizacoes: [{ capturada_em: '2026-10-15T10:17:00Z', assinatura: assinaturaDaPrevisao(new Map([['GLOBO', ZEUS_GLOBO]])) }],
    });
    expect(await rodar(m, '2026-10-15T11:17:00Z')).toBeNull();
    expect(m.externas.map((e) => new URL(e.url).hostname)).toEqual(['weather.visualcrossing.com']);
    expect(fontes(m.gravado('prev_previsoes'))).toEqual(['visualcrossing']);
    expect(m.gravado('prev_zeus_atualizacoes')).toEqual([]);
    // só a leitura das fotos de hoje: sem a leitura da safra inteira para as métricas, e sem limpeza
    expect(m.s.leituras('prev_previsoes')).toHaveLength(1);
    expect(m.s.chamadas.filter((c) => c.url.startsWith(URL_SB) && c.init?.method === 'DELETE')).toEqual([]);
  });

  it('sem chave do Visual Crossing, ou com ela recusada, as outras fontes continuam; chave, token e fazenda fora do log', async () => {
    const logs: string[] = [];
    for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    const semChave = montar();
    expect(await rodar(semChave, '2026-10-15T10:17:00Z', '')).toBeNull();
    expect(fontes(semChave.gravado('prev_previsoes'))).toEqual(['metno', 'zeus']);
    expect(semChave.externas.some((e) => e.url.includes('visualcrossing'))).toBe(false);
    const recusada = montar({ vc: 401 });
    expect(await rodar(recusada, '2026-10-15T10:17:00Z')).toBeNull();
    expect(fontes(recusada.gravado('prev_previsoes'))).toEqual(['metno', 'zeus']);
    const tudo = logs.join('\n');
    expect(tudo).toContain('Visual Crossing: HTTP 401');
    expect(tudo).not.toContain(CHAVE_VC);
    expect(tudo).not.toContain(TOKEN);
    expect(tudo).not.toContain(CHAVE);
    expect(tudo).not.toContain('GLOBO');
  });

  it('métricas no começo da safra: lê 90 dias para trás (não só desde 1º de setembro), grava e só depois limpa as velhas', async () => {
    const m = montar({}, {
      prev_previsoes: [{ fonte: 'zeus', unidade: 'GLOBO', emitida_em: '2027-07-01', dias: [{ d: '2027-07-02', mm: 3, p: null }] }],
      prev_observado: [{ unidade: 'GLOBO', dia: '2027-07-02', mm: 1, pluviometros: 2 }],
    });
    expect(await rodar(m, '2027-09-15T10:17:00Z')).toBeNull();
    // ontem = 14/09; 90 dias até ontem começam em 17/06; as fotos, 14 dias antes disso
    expect(m.s.leituras('prev_previsoes').some((u) => u.includes('emitida_em=gte.2027-06-03'))).toBe(true);
    expect(m.s.leituras('prev_observado').some((u) => u.includes('dia=gte.2027-06-17'))).toBe(true);
    expect(m.gravado('prev_metricas').some((x) => x.periodo === '90d' && x.unidade === 'GLOBO' && x.n === 1)).toBe(true);
    const sb = m.s.chamadas.filter((c) => c.url.startsWith(`${URL_SB}/rest/v1/prev_metricas?`) && c.init?.method && c.init.method !== 'GET');
    expect(sb.map((c) => c.init?.method)).toEqual(['POST', 'DELETE']);
    expect(sb[1].url).toContain('calculado_em=lt.2027-09-15T10%3A17%3A00.000Z');
  });

  it('fonte fora do ar (rede ou prazo estourado) é parada na primeira fazenda: a rodada não espera 30 s por fazenda', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const PICS2 = { columns: PICS.columns, rows: [...PICS.rows, ['20', 'PIC 7', 'Fazenda Nebraska', -14, -57]] };
    const s = servidoresFalsos(tabelas(), [PICS2, ZEUS, OBS]);
    let pedidosMet = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://api.met.no/')) { pedidosMet += 1; throw new TypeError('fetch failed'); }
      if (url.startsWith('https://weather.visualcrossing.com/')) return new Response(JSON.stringify(VC), { status: 200 });
      return s.impl(url, init);
    };
    const r = await rodarBenchmarkPrevisao({ agrovex: { url: URL_AGROVEX, token: TOKEN }, supabase: { url: URL_SB, chave: CHAVE }, visualCrossingChave: CHAVE_VC, fetchImpl: fetchImpl as typeof fetch, agora: new Date('2026-10-15T10:17:00Z') });
    expect(r).toBeNull();
    expect(pedidosMet).toBe(1);
  });

  it('MET Norway com 429 para a fonte na rodada, sem falhar a etapa', async () => {
    const m = montar({ met: 429 });
    expect(await rodar(m, '2026-10-15T10:17:00Z')).toBeNull();
    expect(fontes(m.gravado('prev_previsoes'))).toEqual(['visualcrossing', 'zeus']);
  });

  it('Agrovex fora do ar: a etapa devolve o erro, não lança e não grava nada no Supabase', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = servidoresFalsos(tabelas(), [], { agrovexStatus: 503 });
    const r = await rodarBenchmarkPrevisao({ agrovex: { url: URL_AGROVEX, token: TOKEN }, supabase: { url: URL_SB, chave: CHAVE }, fetchImpl: s.impl as typeof fetch, agora: new Date('2026-10-15T10:17:00Z') });
    expect(typeof r).toBe('string');
    expect(r).not.toContain(TOKEN);
    expect(s.chamadas.filter((c) => c.url.startsWith(URL_SB) && c.init?.method && c.init.method !== 'GET')).toEqual([]);
  });
});
