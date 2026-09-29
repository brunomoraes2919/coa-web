import { idwGrid, type IdwPoint } from './idw';
import { geomToXY, projetorUtm, utmEpsgFor } from './projection';
import { dilate, gridSpecFromBounds, rasterizeZones } from './raster';
import { statsMascara, statsZonas } from './stats';
import type { AreaStats, Estat, Geometry, Grid, GridSpec, IdwParams, Pic, ResumoChuva, Talhao, TalhaoStats } from './types';

export interface PipelineInput {
  talhoes: Pick<Talhao, 'id' | 'nome' | 'setor' | 'geom'>[];
  pics: Pick<Pic, 'lat' | 'lon' | 'chuva'>[];
  params: IdwParams;
  /** ids dos talhões plantados (estatística "área plantada" quando não há `areas`) */
  plantados: string[];
  /**
   * Áreas da cultura: rasterizadas numa segunda passada (zonas próprias, sobre os mesmos valores) para
   * as estatísticas por área (`resumo.areas`); também entram na máscara. Uma entrada de `talhoes` com
   * o id de uma área (área sem talhão base do mesmo código) recebe as estatísticas da área.
   */
  areas?: { id: string; geom: Geometry }[];
  /** ids das áreas plantadas/plantando: com `areas` não vazio, "área plantada" = união delas */
  plantadosAreas?: string[];
}

export interface PipelineOutput {
  grid: Grid;
  resumo: ResumoChuva;
  /** índices (em `inp.pics`, crescentes) de PICs válidos ignorados por estarem fora da região da grade */
  picsIgnorados: number[];
}

/** Erro esperado da interpolação, com mensagem em português para o usuário. */
export class ErroPipeline extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPipeline';
  }
}

/** Limite de células da grade (~10 bytes por célula na memória do worker). */
const MAX_CELULAS = 60_000_000;
const ERRO_AREA = 'Área grande demais para o tamanho de pixel escolhido: aumente o pixel em Avançado';

function paramsValidos(p: IdwParams): boolean {
  const finitos = [p.potencia, p.vizinhos, p.pixel, p.buffer].every(Number.isFinite);
  return finitos && p.potencia > 0 && Number.isInteger(p.vizinhos) && p.vizinhos >= 1 && p.pixel > 0 && p.buffer >= 0;
}

/** Falha de alocação dos arrays da grade (RangeError) vira mensagem para o usuário. */
function comMemoria<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof RangeError) throw new ErroPipeline(ERRO_AREA);
    throw e;
  }
}

/**
 * Regra do GRASS v.surf.idw sem -n (newpoint em main.c): o ponto só entra se cair numa célula da região,
 * com linha/coluna truncadas em direção a zero como o `(int)` do C — até uma célula fora das bordas
 * norte/oeste ainda conta.
 */
function dentroDaRegiao(s: GridSpec, x: number, y: number): boolean {
  const row = Math.trunc((s.y0 - y) / s.res);
  const col = Math.trunc((x - s.x0) / s.res);
  return row >= 0 && row < s.rows && col >= 0 && col < s.cols;
}

/**
 * Espelho do modelo QGIS: projeta para UTM SIRGAS 2000 (zona do centro dos talhões), rasteriza os talhões,
 * dilata a máscara pelo buffer, interpola com IDW (GRASS v.surf.idw) e resume a chuva por talhão. Com
 * áreas da cultura, elas entram na máscara e são rasterizadas à parte (estatísticas por área e "área
 * plantada" = união das áreas plantadas).
 */
export function runPipeline(inp: PipelineInput, onProgress?: (f: number) => void): PipelineOutput {
  const { params } = inp;
  if (!paramsValidos(params)) throw new ErroPipeline('Parâmetros de interpolação inválidos');
  const validos: { i: number; lon: number; lat: number; chuva: number }[] = [];
  inp.pics.forEach((p, i) => {
    if (p.chuva !== null && Number.isFinite(p.chuva) && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      validos.push({ i, lon: p.lon, lat: p.lat, chuva: p.chuva });
  });
  if (validos.length < 3) throw new ErroPipeline('Mínimo de 3 PICs com precipitação para interpolar');
  if (inp.talhoes.length === 0) throw new ErroPipeline('Nenhum talhão para interpolar');
  onProgress?.(0);

  const areas = inp.areas ?? [];
  const comAreas = areas.length > 0;
  // 1. zona UTM pelo centro do bbox dos talhões (e áreas); projeta os talhões
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const t of [...inp.talhoes, ...areas]) {
    const polys = t.geom.type === 'Polygon' ? [t.geom.coordinates] : t.geom.coordinates;
    for (const poly of polys) for (const ring of poly) for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const epsg = utmEpsgFor((minLon + maxLon) / 2, (minLat + maxLat) / 2);
  const proj = projetorUtm(epsg);
  const talhoesXY = inp.talhoes.map((t) => geomToXY(t.geom, proj.forward));
  // áreas na ordem de rasterização: as plantadas por último, para a união delas ficar exata onde
  // uma área plantada se sobrepõe a outra (na sobreposição a última zona prevalece)
  const setPlantadasAreas = new Set(inp.plantadosAreas ?? []);
  const ordemAreas = areas.map((_, i) => i);
  ordemAreas.sort((i, j) => Number(setPlantadasAreas.has(areas[i].id)) - Number(setPlantadasAreas.has(areas[j].id)) || i - j);
  const areasXY = ordemAreas.map((i) => geomToXY(areas[i].geom, proj.forward));

  // 2. grade = bbox UTM dos talhões (e áreas) expandido pelo buffer
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const mp of [...talhoesXY, ...areasXY]) for (const poly of mp) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const b = params.buffer;
  const spec = gridSpecFromBounds(minX - b, minY - b, maxX + b, maxY + b, params.pixel);

  // PICs em UTM; os fora da região são ignorados, como no GRASS
  const pts: IdwPoint[] = [];
  const picsIgnorados: number[] = [];
  for (const p of validos) {
    const [x, y] = proj.forward(p.lon, p.lat);
    if (dentroDaRegiao(spec, x, y)) pts.push({ x, y, v: p.chuva });
    else picsIgnorados.push(p.i);
  }
  if (pts.length < 3) throw new ErroPipeline('Mínimo de 3 PICs com precipitação dentro da área do mapa para interpolar');

  const celulas = spec.cols * spec.rows;
  if (!Number.isFinite(celulas) || celulas > MAX_CELULAS) throw new ErroPipeline(ERRO_AREA);

  const { zonas, zonasAreas, values } = comMemoria(() => {
    // 3. zonas por talhão e por área (centro da célula); máscara = talhões ∪ áreas dilatados pelo buffer
    const zonas = rasterizeZones(spec, talhoesXY);
    const zonasAreas = comAreas ? rasterizeZones(spec, areasXY) : null;
    const dentro = new Uint8Array(celulas);
    for (let i = 0; i < celulas; i++) dentro[i] = zonas[i] >= 0 || (zonasAreas !== null && zonasAreas[i] >= 0) ? 1 : 0;
    const mask = dilate(dentro, spec, Math.round(b / params.pixel));
    // 4. IDW nas células da máscara
    const values = idwGrid(
      spec, mask, pts, params.potencia, params.vizinhos,
      onProgress ? (f) => onProgress(f * 0.95) : undefined,
    );
    return { zonas, zonasAreas, values };
  });

  // 5. resumo: por talhão, por área, geral (talhões ∪ áreas, sem o buffer) e plantado
  const area = spec.res * spec.res;
  const porZona = statsZonas(values, zonas, inp.talhoes.length, area);
  const porArea: AreaStats[] = [];
  if (zonasAreas) {
    const estat = statsZonas(values, zonasAreas, areasXY.length, area);
    const porIndice: AreaStats[] = new Array(areas.length);
    ordemAreas.forEach((i, z) => (porIndice[i] = { id: areas[i].id, ...estat[z] }));
    porArea.push(...porIndice);
  }
  const estatDaArea = new Map(porArea.map((a) => [a.id, a]));
  const setPlantados = new Set(inp.plantados);
  const ehPlantado = new Uint8Array(inp.talhoes.length);
  inp.talhoes.forEach((t, i) => (ehPlantado[i] = setPlantados.has(t.id) ? 1 : 0));
  const talhoes: TalhaoStats[] = inp.talhoes.map((t, i) => {
    const da = estatDaArea.get(t.id);
    return {
      talhaoId: t.id,
      nome: t.nome,
      setor: t.setor,
      plantado: ehPlantado[i] === 1,
      ...(da ? { media: da.media, min: da.min, max: da.max, areaHa: da.areaHa } : porZona[i]),
    };
  });
  const geral = statsMascara(values, (i) => zonas[i] >= 0 || (zonasAreas !== null && zonasAreas[i] >= 0), area);
  let plantado: Estat | null;
  if (zonasAreas) {
    // zona z (na ordem de rasterização) → área plantada?
    const zonaPlantada = new Uint8Array(areasXY.length);
    ordemAreas.forEach((i, z) => (zonaPlantada[z] = setPlantadasAreas.has(areas[i].id) ? 1 : 0));
    plantado = zonaPlantada.includes(1) ? statsMascara(values, (i) => zonasAreas[i] >= 0 && zonaPlantada[zonasAreas[i]] === 1, area) : null;
  } else {
    plantado = ehPlantado.includes(1) ? statsMascara(values, (i) => zonas[i] >= 0 && ehPlantado[zonas[i]] === 1, area) : null;
  }

  onProgress?.(1);
  const resumo: ResumoChuva = comAreas ? { geral, plantado, talhoes, areas: porArea } : { geral, plantado, talhoes };
  return { grid: { ...spec, epsg, values }, resumo, picsIgnorados };
}
