/** Registros de domínio para os testes do repositório Supabase (ids com prefixo e número). */
import { IDW_PADRAO, type AreaCultura, type Fazenda, type MapaSalvo, type Plantio, type Safra, type Talhao } from '../../src/lib/types';

export const uuid = (prefixo: string, i: number) => `${prefixo}-${String(i).padStart(6, '0')}`;
export const geom: Talhao['geom'] = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

export const fazenda = (i: number): Fazenda => ({
  id: uuid('faz', i),
  nome: `Fazenda ${i}`,
  campoNome: 'NOME',
  campoSetor: null,
  colunas: ['NOME'],
  criadoEm: '2026-01-01T00:00:00.000Z',
  unidadePims: null,
  campoCodigo: null,
  coaFazendaId: null,
});

export const talhao = (i: number, fazendaId: string): Talhao => ({ id: uuid('tal', i), fazendaId, nome: `T${i}`, setor: null, areaHa: 1, geom, atributos: {}, codigo: null });

export const safra = (i: number): Safra => ({ id: uuid('saf', i), nome: `SOJA ${i}`, cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-03-31', nomePims: null });

export const plantio = (safraId: string, talhaoId: string, parciais: Partial<Plantio> = {}): Plantio => ({
  safraId,
  talhaoId,
  dataPlantio: null,
  origem: 'manual',
  status: 'plantado',
  areaPrevista: null,
  areaPlantada: null,
  inicio: null,
  fim: null,
  variedade: null,
  ...parciais,
});

export const area = (i: number, safraId: string, fazendaId: string): AreaCultura => ({ id: uuid('are', i), safraId, fazendaId, codigo: String(i).padStart(3, '0'), areaHa: 2, geom });

export function mapa(i: number, parciais: Partial<MapaSalvo> = {}): MapaSalvo {
  const estat = { media: 10, min: 5, max: 15, areaHa: 1 };
  return {
    id: uuid('map', i),
    fazendaId: uuid('faz', 0),
    safraId: null,
    titulo: `Mapa ${i}`,
    periodoInicio: '2025-02-01',
    periodoFim: '2025-02-28',
    config: {
      pagina: 'A3',
      textos: { titulo: 'T', fazenda: 'F', safra: '', periodo: '', fonte: 'ZEUS', talhoes: 'TODOS', setor: 'TODOS', observacao: '', data: '01/01/2026' },
      paletaId: 'auto',
      estiloPlantado: 'quadriculado',
      mapaBase: 'nenhum',
      mostrarRotulosTalhoes: true,
      mostrarValoresPics: true,
      mostrarGrade: false,
      legendaCompacta: false,
      extent: null,
      idw: IDW_PADRAO,
    },
    pics: [{ id: 'p', nome: 'PIC', lat: -13, lon: -57, chuva: 1, inativo: false, inicio: new Date('2025-02-01T00:00:00.000Z'), fim: null, incluir: true }],
    resumo: { geral: estat, plantado: null, talhoes: [] },
    pngPath: `${uuid('map', i)}.png`,
    thumbPath: `${uuid('map', i)}-thumb.png`,
    criadoEm: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0').slice(-3)}Z`,
    ...parciais,
  };
}
