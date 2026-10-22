// Mapa de CAR e Matrícula: camadas para exportar em shapefile e camadas desligadas na legenda. Geometrias FICTÍCIAS
// (quadrados perto do equador).
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { quadroDoCar } from '../src/lib/car';
import { camadasParaExportar } from '../src/lib/camadasCar';
import type { DadosCar, Talhao } from '../src/lib/types';
import { camadaVisivel, type CamadaCar } from '../src/render/car';
import { itensLegendaCar } from '../src/render/legendaCar';

const quadrado = (x0: number, y0: number, l: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x0 + l, y0], [x0 + l, y0 + l], [x0, y0 + l], [x0, y0]]],
});
const linha: Geometry = { type: 'LineString', coordinates: [[0, 0], [0.01, 0.01]] };
const feicao = (geometry: Geometry, properties: Record<string, unknown>): Feature => ({ type: 'Feature', geometry, properties });
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

const dados: DadosCar = {
  versao: 1,
  geradoEm: '2026-10-22T00:00:00Z',
  bbox: [],
  ufs: ['MT'],
  car: fc([feicao(quadrado(0, 0, 0.02), { cod_imovel: 'MT-1', status: 'AT', condicao: 'Aguardando análise', municipio: 'Cidade', uf: 'MT', area: '480,5' })]),
  temas: fc([
    feicao(quadrado(0, 0, 0.005), { tema: 'arl_proposta', cod_imovel: 'MT-1' }),
    feicao(quadrado(0.005, 0, 0.005), { tema: 'app_rio_ate_10', cod_imovel: 'MT-1' }),
    feicao(quadrado(0.01, 0, 0.005), { tema: 'vegetacao_nativa', cod_imovel: 'MT-1' }),
    feicao(quadrado(0, 0.01, 0.01), { tema: 'area_consolidada', cod_imovel: 'MT-1' }),
    feicao(quadrado(0.015, 0, 0.002), { tema: 'rio_ate_10', cod_imovel: 'MT-1' }),
  ]),
  matriculas: fc([feicao(quadrado(0, 0, 0.01), { matricula: '12.345', parcela: 'abc', codigo_imovel: '999', status: 'REGISTRADA', situacao: 'CERTIFICADA', municipio: 'Cidade' })]),
  estradas: fc([
    feicao(linha, { fonte: 'ibge', tipo: 'rodovia', nome: 'BR-163', sigla: 'BR-163' }),
    feicao(linha, { fonte: 'osm', tipo: 'estrada', nome: '', classe: 'track' }),
  ]),
  hidrografia: fc([feicao(linha, { fonte: 'osm', tipo: 'rio', nome: 'Córrego Fundo', classe: 'stream' }), feicao(quadrado(0.018, 0, 0.001), { fonte: 'ibge', tipo: 'massa_dagua', nome: 'Lagoa' })]),
  eucalipto: [],
};
const talhoes: Talhao[] = [{ id: 't1', fazendaId: 'f', nome: '001', setor: null, areaHa: 123.456, geom: quadrado(0, 0, 0.01), atributos: {}, codigo: '001' }];
const quadro = quadroDoCar(dados, talhoes);

describe('camadas para exportar', () => {
  const camadas = camadasParaExportar(dados, quadro, talhoes, new Map([['t1', 'agricola']]));
  const por = (id: string) => camadas.find((c) => c.id === id)!;

  it('uma camada por tipo, só as que têm feição, linhas como linha', () => {
    expect(camadas.map((c) => c.id)).toEqual(['car', 'matriculas', 'talhoes', 'reservaLegal', 'app', 'vegetacaoNativa', 'areaConsolidada', 'aguaPoligonos', 'rios', 'rodovias', 'estradas']);
    expect(camadas.filter((c) => c.geometria === 'linha').map((c) => c.id)).toEqual(['rios', 'rodovias', 'estradas']);
  });

  it('atributos da base de origem, rótulo do mapa e área', () => {
    expect(por('car').feicoes[0].props).toMatchObject({ ROTULO: 'CAR 1', COD_IMOVEL: 'MT-1', STATUS: 'AT', UF: 'MT', AREA_DECL: 480.5 });
    expect(por('car').feicoes[0].props.AREA_HA).toBeGreaterThan(400);
    expect(por('matriculas').feicoes[0].props).toMatchObject({ ROTULO: 'Mat. 12.345', MATRICULA: '12.345', COD_IMOVEL: '999', SITUACAO: 'CERTIFICADA' });
    expect(por('talhoes').feicoes[0].props).toEqual({ TALHAO: '001', CODIGO: '001', SETOR: null, USO: 'Agrícola', AREA_HA: 123.46 });
    expect(por('reservaLegal').feicoes[0].props).toMatchObject({ TEMA: 'arl_proposta', COD_IMOVEL: 'MT-1', CAR: 'CAR 1' });
    expect(por('aguaPoligonos').feicoes.map((f) => f.props.FONTE)).toEqual(['SICAR', 'IBGE']);
    expect(por('rios').feicoes[0].props).toEqual({ NOME: 'Córrego Fundo', TIPO: 'rio', CLASSE: 'stream', FONTE: 'OpenStreetMap' });
    expect(por('rodovias').feicoes[0].props).toMatchObject({ NOME: 'BR-163', FONTE: 'IBGE' });
    expect(por('estradas').feicoes[0].props).toEqual({ NOME: null, CLASSE: 'track', FONTE: 'OpenStreetMap' });
  });
});

describe('camadas desligadas', () => {
  const entrada = (ocultas: CamadaCar[]) => ({ dados, quadro, usoTalhao: new Map([['t1', 'agricola' as const]]), ocultas: new Set(ocultas) });

  it('sem nada desligado, todas aparecem', () => {
    expect(camadaVisivel({}, 'car')).toBe(true);
    expect(itensLegendaCar(entrada([])).map((i) => i.amostra)).toEqual(['car', 'matricula', 'agricola', 'reservaLegal', 'app', 'vegetacaoNativa', 'agua', 'rodovia', 'estrada']);
  });

  it('a camada desligada sai da legenda', () => {
    const e = entrada(['matriculas', 'talhoes', 'estradas']);
    expect(camadaVisivel(e, 'matriculas')).toBe(false);
    expect(itensLegendaCar(e).map((i) => i.amostra)).toEqual(['car', 'reservaLegal', 'app', 'vegetacaoNativa', 'agua', 'rodovia']);
  });
});
