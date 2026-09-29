/** Cadastro padrão pequeno (2 unidades, SOJA 26/27) para os testes do seed, em memória. */
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { LeitorSeed } from '../../src/lib/seed';

export const quadrado = (x: number): Polygon => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 0.01, 0], [x + 0.01, 0.01], [x, 0.01], [x, 0]]] });
export const feicao = (x: number, props: Record<string, unknown>): Feature => ({ type: 'Feature', properties: props, geometry: quadrado(x) });
export const colecao = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

export const SEED = {
  versao: 1,
  geradoEm: '2026-09-28T16:49:44.154Z',
  fazendas: [
    { nome: 'Siriema', unidadePims: 'SIRIEMA', campoNome: 'nome', campoCodigo: 'codigo', campoSetor: 'setor', arquivoBase: 'base/SIRIEMA.geojson' },
    { nome: 'Globo', unidadePims: 'GLOBO', campoNome: 'nome', campoCodigo: 'codigo', campoSetor: null, arquivoBase: 'base/GLOBO.geojson' },
  ],
  safras: [
    {
      nome: 'SOJA 26/27',
      nomePims: 'SOJA 26/27',
      cultura: 'SOJA',
      anoSafra: '26/27',
      inicio: '2026-09-01',
      fim: '2027-08-31',
      areasCultura: [
        { unidadePims: 'SIRIEMA', arquivo: 'soja-26-27/SIRIEMA.geojson' },
        { unidadePims: 'NAO EXISTE', arquivo: 'soja-26-27/NAO_EXISTE.geojson' },
      ],
    },
  ],
};

/** Arquivos do cadastro padrão pelo caminho relativo à pasta do seed (o que um LeitorSeed recebe). */
export const ARQUIVOS: Record<string, unknown> = {
  'seed.json': SEED,
  'base/SIRIEMA.geojson': colecao([
    feicao(0, { codigo: '007', codigoBruto: '007', nome: '007', setor: 'SIRIEMA' }),
    feicao(1, { codigo: '039B', codigoBruto: '39B', nome: '39B', setor: 'SÃO MIGUEL' }),
  ]),
  'base/GLOBO.geojson': colecao([
    feicao(2, { codigo: 'P11', codigoBruto: 'P11', nome: 'P11', setor: null }),
    feicao(3, { codigo: '', codigoBruto: '', nome: 'Talhão 1', setor: null }),
  ]),
  'soja-26-27/SIRIEMA.geojson': colecao([
    feicao(0, { codigo: '007', codigoBruto: '007' }),
    feicao(1, { codigo: '018A', codigoBruto: '018A' }),
    feicao(5, { codigo: '', codigoBruto: '' }),
  ]),
  'soja-26-27/NAO_EXISTE.geojson': colecao([feicao(9, { codigo: '001', codigoBruto: '001' })]),
};

/** Leitor em memória: devolve o JSON de cada arquivo; arquivo que não existe → erro. */
export function leitorFalso(arquivos: Record<string, unknown> = ARQUIVOS): LeitorSeed {
  return async (caminho) => {
    if (!(caminho in arquivos)) throw new Error(`Não foi possível ler o cadastro padrão (${caminho}): não encontrado`);
    return JSON.stringify(arquivos[caminho]);
  };
}
