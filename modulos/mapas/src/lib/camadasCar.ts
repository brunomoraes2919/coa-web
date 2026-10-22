/**
 * Camadas do Mapa de CAR e Matrícula para exportar em shapefile, cada uma separada: limite do CAR, matrículas,
 * talhões, os temas do CAR (reserva legal, APP, vegetação nativa, área consolidada, água e outros), rios e
 * córregos, rodovias e estradas. Cada camada leva os atributos da base de onde veio e a área (ha) dos polígonos.
 * Só entram as camadas com alguma feição.
 */
import type { Feature } from 'geojson';
import { ehRodovia } from '../render/car';
import { areaHa, categoriaDoTema, poligonosDaGeometria, type CategoriaTema, type QuadroCar } from './car';
import { ha2, type FeicaoExportada, type GeometriaShp, type ValorAtributo } from './exportarLimites';
import type { DadosCar, Talhao } from './types';

export interface CamadaExportavel {
  id: string;
  /** nome na tela */
  nome: string;
  /** nome dos arquivos (.shp, .dbf…) dentro do zip */
  arquivo: string;
  geometria: GeometriaShp;
  feicoes: FeicaoExportada[];
}

/** Texto do atributo; vazio vira nulo. */
const txt = (v: unknown): ValorAtributo => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
/** Número do atributo (vem como texto de algumas bases); o que não é número vira nulo. */
const num = (v: unknown): ValorAtributo => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
};
const FONTE: Record<string, string> = { ibge: 'IBGE', osm: 'OpenStreetMap', sicar: 'SICAR' };
const fonte = (f: Feature) => txt(FONTE[String(f.properties?.fonte ?? '')] ?? f.properties?.fonte);
const areaDe = (f: Feature) => ha2(areaHa(poligonosDaGeometria(f.geometry)));
const ehPoligono = (f: Feature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon';
const ehLinha = (f: Feature) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString';

/** Temas do CAR que viram uma camada cada (os de servidão e uso restrito vão juntos em "Outros temas do CAR"). */
const TEMAS: { cats: CategoriaTema[]; id: string; nome: string; arquivo: string }[] = [
  { cats: ['reserva_legal'], id: 'reservaLegal', nome: 'Reserva legal', arquivo: 'RESERVA_LEGAL' },
  { cats: ['app'], id: 'app', nome: 'APP', arquivo: 'APP' },
  { cats: ['vegetacao_nativa'], id: 'vegetacaoNativa', nome: 'Vegetação nativa', arquivo: 'VEGETACAO_NATIVA' },
  { cats: ['area_consolidada'], id: 'areaConsolidada', nome: 'Área consolidada (CAR)', arquivo: 'AREA_CONSOLIDADA' },
  { cats: ['servidao', 'uso_restrito'], id: 'outrosTemas', nome: 'Outros temas do CAR', arquivo: 'OUTROS_TEMAS_CAR' },
];

export function camadasParaExportar(
  dados: DadosCar,
  quadro: QuadroCar,
  talhoes: readonly Talhao[],
  usoTalhao: ReadonlyMap<string, 'agricola' | 'eucalipto'>,
): CamadaExportavel[] {
  const rotuloCar = new Map(quadro.linhas.filter((l) => l.tipo === 'car').map((l) => [l.indice, l] as const));
  const rotuloMat = new Map(quadro.linhas.filter((l) => l.tipo === 'matricula').map((l) => [l.indice, l] as const));
  // rótulo "CAR 1" pelo código do imóvel, para os temas dizerem de qual CAR são
  const carPorCodigo = new Map(dados.car.features.map((f, i) => [String(f.properties?.cod_imovel ?? ''), rotuloCar.get(i)?.rotulo ?? null] as const));
  const temaComCat = dados.temas.features.map((f) => ({ f, cat: categoriaDoTema(String(f.properties?.tema ?? '')) }));
  const deTema = (f: Feature): FeicaoExportada => ({
    geom: f.geometry,
    props: {
      TEMA: txt(f.properties?.tema),
      COD_IMOVEL: txt(f.properties?.cod_imovel),
      CAR: carPorCodigo.get(String(f.properties?.cod_imovel ?? '')) ?? null,
      AREA_HA: areaDe(f),
    },
  });

  const camadas: CamadaExportavel[] = [
    {
      id: 'car',
      nome: 'Limite do CAR (SICAR)',
      arquivo: 'CAR_SICAR',
      geometria: 'poligono',
      feicoes: dados.car.features.map((f, i) => ({
        geom: f.geometry,
        props: {
          ROTULO: rotuloCar.get(i)?.rotulo ?? null,
          COD_IMOVEL: txt(f.properties?.cod_imovel),
          STATUS: txt(f.properties?.status),
          CONDICAO: txt(f.properties?.condicao),
          MUNICIPIO: txt(f.properties?.municipio),
          UF: txt(f.properties?.uf),
          AREA_DECL: num(f.properties?.area),
          AREA_HA: ha2(rotuloCar.get(i)?.areaHa ?? areaHa(poligonosDaGeometria(f.geometry))),
        },
      })),
    },
    {
      id: 'matriculas',
      nome: 'Matrículas (SIGEF)',
      arquivo: 'MATRICULAS_SIGEF',
      geometria: 'poligono',
      feicoes: dados.matriculas.features.map((f, i) => ({
        geom: f.geometry,
        props: {
          ROTULO: rotuloMat.get(i)?.rotulo ?? null,
          MATRICULA: txt(f.properties?.matricula),
          PARCELA: txt(f.properties?.parcela),
          COD_IMOVEL: txt(f.properties?.codigo_imovel),
          STATUS: txt(f.properties?.status),
          SITUACAO: txt(f.properties?.situacao),
          MUNICIPIO: txt(f.properties?.municipio),
          AREA_HA: ha2(rotuloMat.get(i)?.areaHa ?? areaHa(poligonosDaGeometria(f.geometry))),
        },
      })),
    },
    {
      id: 'talhoes',
      nome: 'Talhões',
      arquivo: 'TALHOES',
      geometria: 'poligono',
      feicoes: talhoes.map((t) => ({
        geom: t.geom,
        props: { TALHAO: t.nome, CODIGO: t.codigo, SETOR: t.setor, USO: usoTalhao.get(t.id) === 'eucalipto' ? 'Eucalipto' : 'Agrícola', AREA_HA: ha2(t.areaHa) },
      })),
    },
    ...TEMAS.map((t) => ({
      id: t.id,
      nome: t.nome,
      arquivo: t.arquivo,
      geometria: 'poligono' as const,
      feicoes: temaComCat.filter((x) => x.cat && t.cats.includes(x.cat)).map((x) => deTema(x.f)),
    })),
    {
      // água declarada no CAR (rios, lagos, nascentes) e os polígonos de água do IBGE/OpenStreetMap
      id: 'aguaPoligonos',
      nome: 'Rios e lagos (polígonos)',
      arquivo: 'AGUA_POLIGONOS',
      geometria: 'poligono',
      feicoes: [
        ...temaComCat.filter((x) => x.cat === 'hidrografia').map((x) => ({ geom: x.f.geometry, props: { NOME: null, TIPO: txt(x.f.properties?.tema), FONTE: 'SICAR', AREA_HA: areaDe(x.f) } })),
        ...dados.hidrografia.features.filter(ehPoligono).map((f) => ({ geom: f.geometry, props: { NOME: txt(f.properties?.nome), TIPO: txt(f.properties?.tipo), FONTE: fonte(f), AREA_HA: areaDe(f) } })),
      ],
    },
    {
      id: 'rios',
      nome: 'Rios e córregos (linhas)',
      arquivo: 'RIOS_CORREGOS',
      geometria: 'linha',
      feicoes: dados.hidrografia.features.filter(ehLinha).map((f) => ({
        geom: f.geometry,
        props: { NOME: txt(f.properties?.nome), TIPO: txt(f.properties?.tipo), CLASSE: txt(f.properties?.classe), FONTE: fonte(f) },
      })),
    },
    {
      id: 'rodovias',
      nome: 'Rodovias',
      arquivo: 'RODOVIAS',
      geometria: 'linha',
      feicoes: dados.estradas.features.filter((f) => ehLinha(f) && ehRodovia(f)).map((f) => ({
        geom: f.geometry,
        props: { NOME: txt(f.properties?.nome), SIGLA: txt(f.properties?.sigla), CLASSE: txt(f.properties?.classe), FONTE: fonte(f) },
      })),
    },
    {
      id: 'estradas',
      nome: 'Estradas e carreadores',
      arquivo: 'ESTRADAS_CARREADORES',
      geometria: 'linha',
      feicoes: dados.estradas.features.filter((f) => ehLinha(f) && !ehRodovia(f)).map((f) => ({
        geom: f.geometry,
        props: { NOME: txt(f.properties?.nome), CLASSE: txt(f.properties?.classe), FONTE: fonte(f) },
      })),
    },
  ];
  return camadas.filter((c) => c.feicoes.length > 0);
}
