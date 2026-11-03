// Mapa de dias sem chuva: a conta dos dias, a escala e a leitura da resposta do servidor.
import { describe, expect, it } from 'vitest';
import {
  avisoDaSeca, buscarSecaZeus, calcularSeca, chuvaDoTalhao, classeDaSeca, CLASSES_SECA, corDaSeca, COR_SEM_DADO, csvSecaPorTalhao, diasDasFaixas,
  familiaDoTalhao, itensLegendaSeca, lerDadosSeca, resumoDaSeca, textoDiasSeca, type DadosSeca,
} from '../src/lib/seca';

const base = (talhoes: Record<string, string>, lidos = '0-9', extra: Partial<DadosSeca> = {}): DadosSeca => ({
  tipo: 'talhoes', fazenda: 'SM3', unidade: 'SM3', de: '2026-09-01', ate: '2026-09-10', lidos, ultimoDia: '2026-10-07', talhoes, ...extra,
});
const t = (id: string, nome: string, codigo: string | null = null, setor: string | null = null) => ({ id, nome, codigo, setor });

describe('dias sem chuva', () => {
  it('conta do dia da última chuva de pelo menos 1 mm até o último dia do período', () => {
    // dia 9 = 10/09 é a referência; chuva de 12 mm no dia 3 (04/09) e 0,5 mm no dia 7 (não conta)
    const r = calcularSeca(base({ '001': '3:12,7:0.5' }), [t('a', '001', '001')]);
    expect(r.referencia).toBe('2026-09-10');
    expect(r.porTalhao.get('a')).toEqual({ dias: 6, minimo: false, ultimaChuva: '2026-09-04', mmUltima: 12, total: 12.5, origem: 'talhao' });
  });

  it('choveu no último dia: zero dias', () => {
    expect(calcularSeca(base({ '001': '9:3' }), [t('a', '001', '001')]).porTalhao.get('a')?.dias).toBe(0);
  });

  it('sem chuva no período inteiro: o período até a referência, marcado como mínimo', () => {
    const s = calcularSeca(base({ '001': '' }), [t('a', '001', '001')]).porTalhao.get('a')!;
    expect(s).toMatchObject({ dias: 10, minimo: true, ultimaChuva: null });
    expect(textoDiasSeca(s)).toBe('≥ 10 d');
  });

  it('a referência é o último dia que a ZEUS tem, nunca o fim pedido (dia que falta não é dia seco)', () => {
    const d = base({ '001': '1:5' }, '0-4');
    const r = calcularSeca(d, [t('a', '001', '001')]);
    expect(r.referencia).toBe('2026-09-05');
    expect(r.porTalhao.get('a')?.dias).toBe(3);
    expect(avisoDaSeca(d, r)).toEqual({ tipo: 'alerta', texto: 'A ZEUS tem chuva por talhão até 05/09/2026: os dias sem chuva foram contados até esse dia.' });
    // buraco no meio: avisa quantos dias faltam
    const buraco = base({ '001': '1:5' }, '0-3,6-9');
    expect(avisoDaSeca(buraco, calcularSeca(buraco, [t('a', '001', '001')]))?.texto).toBe('2 dias do período faltam na tabela da ZEUS (contam como sem leitura, não como chuva).');
  });

  it('nenhum dia no período: sem referência, todos sem dado, e o aviso diz até quando a tabela vai', () => {
    const d = base({}, '');
    const r = calcularSeca(d, [t('a', '001', '001')]);
    expect(r.referencia).toBeNull();
    expect(r.porTalhao.get('a')?.dias).toBeNull();
    expect(avisoDaSeca(d, r)).toEqual({
      tipo: 'erro',
      texto: 'A ZEUS ainda não tem chuva por talhão desta fazenda entre 01/09/2026 e 10/09/2026. A tabela da ZEUS desta fazenda vai até 07/10/2026 (ela é carregada em lotes).',
    });
  });

  it('talhão que a ZEUS não tem fica sem dado (branco no mapa)', () => {
    const s = calcularSeca(base({ '001': '1:5' }), [t('b', '099', '099')]).porTalhao.get('b')!;
    expect(s.dias).toBeNull();
    expect(corDaSeca(s)).toBe(COR_SEM_DADO);
    expect(textoDiasSeca(s)).toBe('');
  });

  it('acha o código pelo nome quando o cadastro não tem código', () => {
    expect(calcularSeca(base({ '019A': '8:2' }), [t('a', 'TH 19A', null)]).porTalhao.get('a')?.dias).toBe(1);
  });
});

describe('talhões divididos', () => {
  it('família: o número sem zeros e sem a letra; pivô com PIVO', () => {
    expect(familiaDoTalhao('019A')).toBe('19');
    expect(familiaDoTalhao('019')).toBe('19');
    expect(familiaDoTalhao('02PIVO')).toBe('2PIVO');
    expect(familiaDoTalhao('2PIVA')).toBe('2PIVO');
    expect(familiaDoTalhao('019PESQ')).toBe('019PESQ');
  });

  it('pedaço sem chuva própria usa a do talhão inteiro', () => {
    expect(chuvaDoTalhao({ talhoes: { '019': '1:4' } }, '019B')).toEqual({ serie: new Map([[1, 4]]), origem: 'inteiro' });
  });

  it('talhão inteiro sem chuva própria usa a média dos pedaços, dia a dia', () => {
    const r = chuvaDoTalhao({ talhoes: { '019A': '1:4,2:1', '019B': '1:2' } }, '019');
    expect(r?.origem).toBe('pedacos');
    expect([...(r?.serie ?? [])]).toEqual([[1, 3], [2, 0.5]]);
    // dia 2 com 0,5 mm de média não conta como chuva
    expect(calcularSeca(base({ '019A': '1:4,2:1', '019B': '1:2' }), [t('x', '019', '019')]).porTalhao.get('x')?.dias).toBe(8);
  });
});

describe('escala e resumo', () => {
  it('as cinco classes da escala: cinza abaixo de 4, depois de 2 em 2 dias, vermelho de 10 em diante', () => {
    expect(CLASSES_SECA.map((c) => c.cor)).toEqual(['#CCCCCC', '#F0F000', '#F7B300', '#FF8C00', '#E31A1C']);
    expect([0, 3, 4, 5, 6, 8, 9, 10, 40].map(classeDaSeca)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
  });

  it('resumo e legenda: talhões por classe, média e maior, e "Sem dado" só quando houver', () => {
    const d = base({ '001': '9:3', '002': '4:3', '003': '' });
    const r = calcularSeca(d, [t('a', '001', '001'), t('b', '002', '002'), t('c', '003', '003'), t('z', '099', '099')]);
    const res = resumoDaSeca(r, d);
    expect(res).toMatchObject({ classes: [1, 1, 0, 0, 1], semDado: 1, media: 5, maior: 10, talhoes: 4, referencia: '2026-09-10' });
    expect(itensLegendaSeca(res).map((i) => i.texto)).toEqual(['Menos de 4 · 1 talhão', '4 a 6 · 1 talhão', '6 a 8', '8 a 10', '10 ou mais · 1 talhão', 'Sem dado da ZEUS · 1 talhão']);
  });

  it('CSV por talhão para o Excel em português', () => {
    const d = base({ '001': '3:12.25' });
    const csv = csvSecaPorTalhao([t('b', '002', '002', 'S1'), t('a', '001', '001', 'S1')], calcularSeca(d, [t('a', '001', '001'), t('b', '002', '002')]));
    expect(csv.split('\r\n')).toEqual([
      'Talhão;Setor;Dias sem chuva;Última chuva;mm da última chuva;Chuva no período (mm)',
      '001;S1;6;04/09/2026;12,3;12,3',
      '002;S1;Sem dado da ZEUS;;;',
    ]);
  });
});

describe('resposta do servidor', () => {
  it('lê as faixas dos dias', () => {
    expect(diasDasFaixas('0-3,7')).toEqual([0, 1, 2, 3, 7]);
    expect(diasDasFaixas('')).toEqual([]);
    expect(diasDasFaixas('x,2')).toEqual([2]);
  });

  it('recusa resposta de outro tipo (ex.: o servidor ainda sem a atualização devolveu os PICs)', () => {
    expect(() => lerDadosSeca({ fazenda: 'SM3', de: '2026-09-01', ate: '2026-09-10', pics: [] })).toThrow('não foi possível ler');
    expect(() => lerDadosSeca(null)).toThrow();
    // texto estranho num talhão fica de fora
    expect(lerDadosSeca({ ...base({ '001': '1:2', '002': '<script>' }) }).talhoes).toEqual({ '001': '1:2' });
  });

  it('fluxo do botão: pede, espera e devolve os dados (ou o texto do erro)', async () => {
    const dormir = async () => undefined;
    const ok = await buscarSecaZeus({
      pedir: async () => 5,
      situacao: async () => ({ atendidoEm: '2026-11-03T10:00:00Z', resultado: 'ok', dados: base({ '001': '' }) }),
      opcoes: { dormir },
    });
    expect(ok.tipo).toBe('ok');
    const erro = await buscarSecaZeus({
      pedir: async () => 5,
      situacao: async () => ({ atendidoEm: '2026-11-03T10:00:00Z', resultado: 'erro: A fazenda deste mapa não tem a unidade do PIMS', dados: null }),
      opcoes: { dormir },
    });
    expect(erro).toEqual({ tipo: 'erro', texto: 'O servidor não conseguiu buscar a chuva dos talhões: A fazenda deste mapa não tem a unidade do PIMS' });
  });
});
