/** Tipos e constantes da renderização do layout (a mesma função gera a prévia e o PNG). */
import type { AreaCultura, Grid, LayoutConfig, MapExtent, Palette, Pic, ResumoChuva, StatusPlantio, Talhao } from '../lib/types';

export interface TileSource {
  url(z: number, x: number, y: number): string;
  maxZoom: number;
  atribuicao: string;
  /** 0..1 = opacidade do véu branco sobre o mapa base */
  clarear: number;
}

export interface RenderInput {
  config: LayoutConfig;
  palette: Palette;
  grid: Grid | null;
  talhoes: Talhao[];
  /**
   * Situação do plantio: id do talhão base OU da área da cultura → status. Com áreas da cultura, elas
   * são pintadas no lugar dos talhões base (área sem situação = a plantar).
   */
  situacoes: Map<string, StatusPlantio>;
  /** áreas da cultura da safra × fazenda ([] = pinta os talhões base) */
  areasCultura: AreaCultura[];
  /** ISO do plantio.json usado (par "Plantio: PIMS dd/MM HH:mm" no painel); null/ausente = sem PIMS */
  plantioGeradoEm?: string | null;
  /** estatísticas da interpolação (pares "Média da fazenda" e "Média dos PICs com chuva"); null/ausente = sem médias */
  resumo?: ResumoChuva | null;
  /** @deprecated use `situacoes`; ids dos talhões base plantados (ainda aceito quando o id não está em `situacoes`) */
  plantados?: Set<string>;
  nomeSafra: string;
  /** só os PICs incluídos */
  pics: Pic[];
  logo: CanvasImageSource | null;
  /** null = sem mapa base */
  tiles: TileSource | null;
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

/** Mapas base Esri (respondem com Access-Control-Allow-Origin: *, o canvas continua exportável). */
export const TILES: Record<'topo' | 'satelite', TileSource> = {
  topo: {
    url: (z, x, y) => `${ESRI}/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 19,
    atribuicao: 'Mapa base: Esri, HERE, Garmin, © OpenStreetMap',
    clarear: 0.35,
  },
  satelite: {
    url: (z, x, y) => `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 19,
    atribuicao: 'Mapa base: Esri, Maxar, Earthstar Geographics',
    clarear: 0,
  },
};

export const PAGINA_MM: Record<'A3' | 'A4', { w: number; h: number }> = {
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
};

/** Posições do desenho em A3 paisagem com um quadro (mm do A3). Com a composição adaptativa, veja `composicaoDe`. */
export const QUADRO_MM = { x: 5, y: 4.4, w: 333, h: 288 };
export const PAINEL_MM = { x: 343.5, y: 4.4, w: 71.4, h: 288 };

export const COR_VERDE = '#0C5A50';
export const COR_LARANJA = '#DB8A08';
export const COR_AMARELO = '#F2C200';
export const COR_A_PLANTAR = '#555555';
/** rótulos dos pares de informação, textos secundários */
export const COR_CINZA = '#5D6D69';
/** separadores finos do painel */
export const COR_SEPARADOR = '#DBE2E0';
/** borda das amostras da legenda */
export const COR_BORDA_AMOSTRA = '#8A8A8A';
export const COR_TEXTO = '#1A1A1A';
/** largura da moldura verde em volta da página (mm do A3) */
export const MOLDURA_MM = 6;
/** fundo branco semitransparente dos elementos sobre o mapa (título, rosa, escala) */
export const FUNDO_85 = 'rgba(255,255,255,0.85)';

/**
 * Quadro do mapa em pixels do canvas e conversões com Web Mercator.
 * `s` = pixels por mm do A3 (no A4 já inclui o fator 297/420).
 * x, y, w, h = parte VISÍVEL do quadro (o retângulo da composição menos o que fica sob a moldura
 * verde); o centro do extent fica no centro do retângulo da composição.
 */
export interface Vista {
  s: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ext: MapExtent;
  /** metros Mercator por pixel */
  mPorPx: number;
  /** latitude do centro do quadro (graus) */
  latCentro: number;
  paraPx(mx: number, my: number): [number, number];
  paraMerc(px: number, py: number): [number, number];
}
