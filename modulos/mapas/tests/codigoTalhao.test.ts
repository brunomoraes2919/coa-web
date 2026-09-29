import { describe, expect, it } from 'vitest';
import { nomeComparavel, normalizarCodigo, sugerirColunaCodigo, unidadePimsCanonica, unirPorCodigo } from '../src/lib/codigoTalhao';
import type { Polygon } from 'geojson';
import type { Geometry } from '../src/lib/types';

/** Casos do Global Constraints + variações vistas nos shapes e no PIMS. */
const CASOS_NORMALIZACAO: [string | null | undefined, string][] = [
  ['39B', '039B'],
  ['TH 033A', '033A'],
  ['69', '069'],
  ['09A', '009A'],
  ['001', '001'],
  ['013A', '013A'],
  ['PIVÔ 02', '02PIVO'],
  ['PIVO 2', '02PIVO'],
  ['PIV2', '02PIVO'],
  ['02PIVO', '02PIVO'],
  ['pivô 5', '05PIVO'],
  ['P14', 'P14'],
  ['M1A', 'M1A'],
  ['M 4 B', 'M4B'],
  ['19PESQ', '019PESQ'],
  ['08 PESQ', '008PESQ'],
  ['TH008', '008'],
  ['TH 019A', '019A'],
  ['TALHÃO 5', '005'],
  ['talhao 12b', '012B'],
  ['Talhão P14', 'P14'],
  ['EXP-CL', 'EXP-CL'],
  ['001-A', '001A'],
  ['062-A', '062A'],
  ['TH-033A', '033A'],
  ['TH 002-A', '002A'],
  ['01AR', '001AR'],
  ['PIVO-3', '03PIVO'],
  ['  007  ', '007'],
  ['', ''],
  ['   ', ''],
  [null, ''],
  [undefined, ''],
];

describe('normalizarCodigo', () => {
  it.each(CASOS_NORMALIZACAO)('%j → %j', (entrada, esperado) => {
    expect(normalizarCodigo(entrada)).toBe(esperado);
  });

  it('é idempotente', () => {
    for (const [entrada] of CASOS_NORMALIZACAO) {
      const uma = normalizarCodigo(entrada);
      expect(normalizarCodigo(uma)).toBe(uma);
    }
  });

  it('não remove "TH" que faz parte do código', () => {
    expect(normalizarCodigo('THX')).toBe('THX');
  });
});

describe('unidadePimsCanonica (gravada na fazenda; o RLS compara upper(unidade_pims) = upper(unidade))', () => {
  it('maiúsculas, sem acento, sem espaços nas pontas e com espaços simples', () => {
    expect(unidadePimsCanonica('  três   flechas ')).toBe('TRES FLECHAS');
    expect(unidadePimsCanonica('São Miguel')).toBe('SAO MIGUEL');
    expect(unidadePimsCanonica('SIRIEMA')).toBe('SIRIEMA');
    expect(unidadePimsCanonica('sm3')).toBe('SM3');
  });

  it('vazia, só espaços ou null → null (sem vínculo com o PIMS)', () => {
    expect(unidadePimsCanonica('')).toBeNull();
    expect(unidadePimsCanonica('   ')).toBeNull();
    expect(unidadePimsCanonica(null)).toBeNull();
    expect(unidadePimsCanonica(undefined)).toBeNull();
  });

  it('é a mesma forma de nomeComparavel (o app casa a unidade do plantio por ela)', () => {
    for (const u of ['Três Flechas', ' globo ', 'NEBRASKA']) expect(unidadePimsCanonica(u)).toBe(nomeComparavel(u));
  });
});

describe('sugerirColunaCodigo', () => {
  it('segue a ordem de preferência, sem diferenciar maiúsculas nem acentos', () => {
    expect(sugerirColunaCodigo(['UNIDADE', 'TH CODE'])).toBe('TH CODE');
    expect(sugerirColunaCodigo(['NOME', 'TALHAO', 'COD'])).toBe('COD');
    expect(sugerirColunaCodigo(['Name', 'TALHÃO'])).toBe('TALHÃO');
    expect(sugerirColunaCodigo(['codigo', 'thcode'])).toBe('codigo');
    expect(sugerirColunaCodigo(['talhões', 'nome'])).toBe('talhões');
    expect(sugerirColunaCodigo(['nome', 'CD_UPNIVEL3'])).toBe('CD_UPNIVEL3');
    expect(sugerirColunaCodigo(['Nome'])).toBe('Nome');
  });

  it('retorna null quando nenhuma coluna combina', () => {
    expect(sugerirColunaCodigo(['X', 'Y', 'ID'])).toBeNull();
    expect(sugerirColunaCodigo([])).toBeNull();
  });
});

function quadrado(x: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
        [x, 0],
      ],
    ],
  };
}

describe('unirPorCodigo', () => {
  it('une feições com o mesmo código normalizado num MultiPolygon e mantém as vazias separadas', () => {
    const multi: Geometry = { type: 'MultiPolygon', coordinates: [quadrado(10).coordinates, quadrado(20).coordinates] };
    const feicoes = [
      { geom: quadrado(0), props: { COD: '053', UNIDADE: 'G' } },
      { geom: quadrado(1), props: { COD: '' } },
      { geom: quadrado(2), props: { COD: '53', UNIDADE: 'outra' } },
      { geom: quadrado(3), props: { COD: null } },
      { geom: multi, props: { COD: 'TH 053' } },
      { geom: quadrado(4), props: { COD: '072' } },
    ];
    const r = unirPorCodigo(feicoes, 'COD');

    expect(r.map((f) => f.props.codigo)).toEqual(['053', '', '', '072']);
    expect(r[0].props).toEqual({ COD: '053', UNIDADE: 'G', codigo: '053', codigoBruto: '053' });
    expect(r[0].geom.type).toBe('MultiPolygon');
    expect(r[0].geom.coordinates).toEqual([
      quadrado(0).coordinates,
      quadrado(2).coordinates,
      quadrado(10).coordinates,
      quadrado(20).coordinates,
    ]);
    expect(r[1].props.codigoBruto).toBe('');
    expect(r[1].geom).toEqual(quadrado(1));
    expect(r[3].geom).toEqual(quadrado(4));
  });

  it('não altera as feições de entrada', () => {
    const feicoes = [
      { geom: quadrado(0), props: { COD: '1' } },
      { geom: quadrado(1), props: { COD: '001' } },
    ];
    const copia = structuredClone(feicoes);
    unirPorCodigo(feicoes, 'COD');
    expect(feicoes).toEqual(copia);
  });
});
