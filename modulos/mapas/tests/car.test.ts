// Mapa de CAR e Matrícula: categorias dos temas e quadro de áreas. Geometrias FICTÍCIAS (quadrados perto do
// equador, onde 0,01° ≈ 1,113 km, então 0,01° × 0,01° ≈ 123,9 ha).
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { areaHa, categoriaDoTema, csvQuadroCar, dadosValidos, fmtHa, gradeDe, quadroDoCar, rotuloMatricula, usoDoTalhao, varrer } from '../src/lib/car';
import type { DadosCar, Talhao } from '../src/lib/types';

const quadrado = (x0: number, y0: number, lx: number, ly = lx): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x0 + lx, y0], [x0 + lx, y0 + ly], [x0, y0 + ly], [x0, y0]]],
});
const feicao = (geometry: Polygon, properties: Record<string, unknown>): Feature => ({ type: 'Feature', geometry, properties });
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const talhao = (id: string, codigo: string, geom: Polygon): Talhao => ({ id, fazendaId: 'f', nome: codigo, setor: null, areaHa: 0, geom, atributos: {}, codigo });
const HA = areaHa([quadrado(0, 0, 0.01).coordinates]);
/** a grade erra um pouco nas bordas: 1% do quadrado de referência */
const perto = (v: number, alvo: number) => expect(Math.abs(v - alvo)).toBeLessThan(HA * 0.01);

describe('categorias dos temas do SICAR', () => {
  it('reserva legal, APP, vegetação nativa, consolidada, hidrografia e o resto', () => {
    expect(categoriaDoTema('arl_proposta')).toBe('reserva_legal');
    expect(categoriaDoTema('app_rio_ate_10')).toBe('app');
    expect(categoriaDoTema('app_nascente_olho_dagua')).toBe('app');
    expect(categoriaDoTema('vegetacao_nativa')).toBe('vegetacao_nativa');
    expect(categoriaDoTema('area_pousio')).toBe('area_consolidada');
    expect(categoriaDoTema('rio_10_a_50')).toBe('hidrografia');
    expect(categoriaDoTema('reservatorio_artificial_decorrente_barramento')).toBe('hidrografia');
    expect(categoriaDoTema('area_servidao_administrativa_total')).toBe('servidao');
    expect(categoriaDoTema('area_topo_morro')).toBe('uso_restrito');
    expect(categoriaDoTema('qualquer')).toBeNull();
  });
});

describe('quadro de áreas por CAR e matrícula', () => {
  // CAR grande: 0..0,02 × 0..0,01 (2 quadrados); vizinho 0,02..0,03
  // talhões: agrícola 0..0,01; eucalipto 0,01..0,015 (meio quadrado)
  // temas do CAR grande: RL 0,015..0,02 (meio); consolidada 0..0,02 (tudo); APP 0,0..0,0025 × faixa
  const dados: DadosCar = {
    versao: 1,
    geradoEm: '2026-10-21T00:00:00Z',
    bbox: [],
    ufs: ['MT'],
    car: fc([
      feicao(quadrado(0.02, 0, 0.01), { cod_imovel: 'MT-VIZ', area: 120, status: 'AT' }),
      feicao(quadrado(0, 0, 0.02, 0.01), { cod_imovel: 'MT-FAZ', area: 250, status: 'AT' }),
    ]),
    temas: fc([
      feicao(quadrado(0.015, 0, 0.005, 0.01), { tema: 'arl_aprovada_nao_averbada', cod_imovel: 'MT-FAZ' }),
      feicao(quadrado(0, 0, 0.02, 0.01), { tema: 'area_consolidada', cod_imovel: 'MT-FAZ' }),
      feicao(quadrado(0, 0, 0.0025, 0.01), { tema: 'app_rio_ate_10', cod_imovel: 'MT-FAZ' }),
    ]),
    matriculas: fc([feicao(quadrado(0, 0, 0.01), { matricula: '12.345', status: 'REGISTRADA' }), feicao(quadrado(0.01, 0, 0.01), { matricula: '', parcela: 'abcdef123456' })]),
    estradas: fc([]),
    hidrografia: fc([]),
    eucalipto: [{ talhao: '002', areaHa: 60 }, { talhao: '099', areaHa: 30 }],
  };
  const talhoes = [talhao('t1', '001', quadrado(0, 0, 0.01)), talhao('t2', '002', quadrado(0.01, 0, 0.005, 0.01))];

  it('CAR maior primeiro (CAR 1), com agrícola, eucalipto, pecuária estimada, reserva legal e APP', () => {
    const q = quadroDoCar(dados, talhoes);
    const [car1, car2] = q.linhas.filter((l) => l.tipo === 'car');
    expect(car1).toMatchObject({ rotulo: 'CAR 1', id: 'MT-FAZ', areaDeclaradaHa: 250, status: 'AT' });
    perto(car1.areaHa, 2 * HA);
    perto(car1.agricolaHa, HA);
    perto(car1.eucaliptoHa, HA / 2);
    // consolidada (2 quadrados) menos talhões (1,5 quadrado) = meio quadrado de pecuária estimada
    perto(car1.pecuariaHa, HA / 2);
    perto(car1.reservaLegalHa, HA / 2);
    perto(car1.appHa, HA / 4);
    expect(car2).toMatchObject({ rotulo: 'CAR 2', id: 'MT-VIZ', agricolaHa: 0, eucaliptoHa: 0 });
  });

  it('matrículas pelo número; parcela sem número pelo código; talhões fora e eucalipto sem desenho', () => {
    const q = quadroDoCar(dados, talhoes);
    const mats = q.linhas.filter((l) => l.tipo === 'matricula');
    expect(mats.map((m) => m.rotulo).sort()).toEqual(['Mat. 12.345', 'Parcela abcdef12']);
    expect(mats.find((m) => m.rotulo === 'Mat. 12.345')!.agricolaHa).toBeCloseTo(HA, 0);
    perto(q.talhoesHa, 1.5 * HA);
    perto(q.talhoesForaDeCarHa, 0);
    expect(q.eucaliptoSemDesenhoHa).toBe(30); // talhão 099 do PIMS não está no cadastro
  });

  it('sem CAR encontrado: todos os talhões ficam fora de CAR', () => {
    const q = quadroDoCar({ ...dados, car: fc([]), matriculas: fc([]) }, talhoes);
    expect(q.linhas).toEqual([]);
    perto(q.talhoesForaDeCarHa, 1.5 * HA);
  });

  it('CAR cancelado fica fora, com os temas dele', () => {
    const comCancelado: DadosCar = {
      ...dados,
      car: fc([...dados.car.features, feicao(quadrado(0, 0, 1), { cod_imovel: 'MT-VELHO', area: 12000, status: 'CA' })]),
      temas: fc([...dados.temas.features, feicao(quadrado(0, 0, 1), { tema: 'vegetacao_nativa', cod_imovel: 'MT-VELHO' })]),
    };
    const v = dadosValidos(comCancelado);
    expect(v.cancelados).toBe(1);
    expect(v.dados.car.features.map((f) => f.properties?.cod_imovel)).toEqual(['MT-VIZ', 'MT-FAZ']);
    expect(v.dados.temas.features.some((f) => f.properties?.cod_imovel === 'MT-VELHO')).toBe(false);
  });

  it('CSV: texto das bases que começa com = + - @ não vira fórmula no Excel', () => {
    const comFormula: DadosCar = { ...dados, matriculas: fc([feicao(quadrado(0, 0, 0.01), { matricula: '=HYPERLINK("x")' })]) };
    const csv = csvQuadroCar(quadroDoCar(comFormula, talhoes));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('CSV com vírgula decimal e o código completo', () => {
    const csv = csvQuadroCar(quadroDoCar(dados, talhoes));
    const [cab, l1] = csv.split('\r\n');
    expect(cab.startsWith('Tipo;Rótulo;Código ou matrícula;Situação;Área (ha)')).toBe(true);
    expect(l1).toMatch(/^CAR;CAR 1;MT-FAZ;AT;\d+,\d{2};250,00;/);
  });
});

describe('grade', () => {
  it('varre o polígono com furo pelo centro das células (par-ímpar)', () => {
    const g = gradeDe([0, 0, 0.1, 0.1], 10_000, 0);
    const contar = (m: number[][][][]) => {
      let n = 0;
      varrer(m, g, (_r, c0, c1) => (n += c1 - c0 + 1));
      return n;
    };
    const cheio = contar([quadrado(0, 0, 0.1).coordinates]);
    const comFuro = contar([[quadrado(0, 0, 0.1).coordinates[0], quadrado(0.04, 0.04, 0.02).coordinates[0]]]);
    expect(comFuro / cheio).toBeCloseTo(0.96, 2);
  });
});

describe('ajudas', () => {
  it('uso do talhão pelo código normalizado do PIMS', () => {
    const euc = new Set(['038']);
    expect(usoDoTalhao({ codigo: '038', nome: 'TH 038' }, euc)).toBe('eucalipto');
    expect(usoDoTalhao({ codigo: '039', nome: 'TH 039' }, euc)).toBe('agricola');
  });
  it('rótulo da matrícula e formato das áreas', () => {
    expect(rotuloMatricula('7.890', null, 0)).toBe('Mat. 7.890');
    expect(rotuloMatricula('340, 345, 351', null, 0)).toBe('Mat. 340 +2');
    expect(rotuloMatricula('282; 397', null, 0)).toBe('Mat. 282 +1');
    expect(rotuloMatricula('', '', 2)).toBe('Parcela 3');
    expect(fmtHa(1234.4)).toBe('1.234');
    expect(fmtHa(12.34)).toBe('12,3');
    expect(fmtHa(0.01)).toBe('0');
    expect(fmtHa(null)).toBe('—');
  });
});
