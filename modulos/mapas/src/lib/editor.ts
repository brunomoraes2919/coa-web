/** Regras do editor de mapas que não dependem da interface. */
import { fmtData, fmtPeriodo, fmtPeriodoHora, parseIsoData } from './format';
import { projetorUtm, utmEpsgFor } from './projection';
import { ROTULO_STATUS } from './situacaoPlantio';
import { IDW_PADRAO, type LayoutConfig, type LayoutTextos, type MapaSalvo, type Pic, type Safra, type StatusPlantio, type Talhao, type TalhaoStats } from './types';

export interface EntradaTextos {
  fazenda: string;
  safra: Safra | null;
  periodoInicio: Date | null;
  periodoFim: Date | null;
  /** o período veio com hora (integração com a opção de informar a hora): mostra data e hora */
  periodoComHora?: boolean;
  /** null = todos os setores */
  setores: string[] | null;
  hoje: Date;
}

export function textosAutomaticos(e: EntradaTextos): LayoutTextos {
  return {
    titulo: 'MAPA DE PRECIPITAÇÃO',
    fazenda: e.fazenda.toUpperCase(),
    safra: e.safra?.nome ?? '',
    periodo: e.periodoComHora ? fmtPeriodoHora(e.periodoInicio, e.periodoFim) : fmtPeriodo(e.periodoInicio, e.periodoFim),
    fonte: 'ZEUS',
    talhoes: 'TODOS',
    setor: e.setores && e.setores.length ? e.setores.join(', ') : 'TODOS',
    observacao: '',
    data: fmtData(e.hoje),
  };
}

export function layoutPadrao(): LayoutConfig {
  return {
    pagina: 'A3',
    textos: textosAutomaticos({ fazenda: '', safra: null, periodoInicio: null, periodoFim: null, setores: null, hoje: new Date() }),
    paletaId: 'auto',
    estiloPlantado: 'quadriculado',
    destaquePics: 'escuro',
    mapaBase: 'topo',
    mostrarRotulosTalhoes: true,
    mostrarValoresPics: true,
    mostrarGrade: true,
    legendaCompacta: false,
    extent: null,
    orientacao: 'auto',
    quadros: 'auto',
    idw: { ...IDW_PADRAO },
  };
}

/**
 * Aparência (config sem os textos) de um mapa salvo ao reabrir. Mapas salvos antes do layout
 * adaptativo não têm `orientacao`: o enquadramento manual deles foi feito para o quadro antigo, então
 * volta a ser automático.
 */
export function aparenciaDoMapaSalvo(config: LayoutConfig): Omit<LayoutConfig, 'textos'> {
  const { textos: _textos, ...resto } = config;
  return config.orientacao ? resto : { ...resto, extent: null };
}

const dois = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Dia de `d` na hora 'hh:mm' (hora local); hora inválida → null. */
function naHora(d: Date, hora: string): Date | null {
  if (!HORA.test(hora)) return null;
  const [h, min] = hora.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min);
}

/**
 * Horas do período para gravar com o mapa (config.periodoHoras): só quando o período veio com hora (a
 * integração com a opção de informar a hora). Período só por data → undefined (o campo não é gravado).
 */
export function horasDoPeriodo(inicio: Date | null, fim: Date | null, comHora: boolean | undefined): { inicio: string; fim: string } | undefined {
  return comHora && inicio && fim ? { inicio: hhmm(inicio), fim: hhmm(fim) } : undefined;
}

/**
 * Período de um mapa salvo ao reabrir. As colunas do mapa guardam só a data; as horas do período com hora
 * vêm de `config.periodoHoras`. Mapa com hora salvo antes desse campo: as horas são lidas do texto
 * "Período" gravado, e só valem se o período remontado der exatamente aquele texto.
 */
export function periodoDoMapaSalvo(m: Pick<MapaSalvo, 'periodoInicio' | 'periodoFim' | 'config'>): { inicio: Date | null; fim: Date | null; comHora: boolean } {
  const inicio = parseIsoData(m.periodoInicio);
  const fim = parseIsoData(m.periodoFim);
  const soData = { inicio, fim, comHora: false };
  if (!inicio || !fim) return soData;
  const comHoras = (hIni: string, hFim: string) => {
    const [i, f] = [naHora(inicio, hIni), naHora(fim, hFim)];
    return i && f && i <= f ? { inicio: i, fim: f, comHora: true } : null;
  };
  const horas = m.config.periodoHoras;
  if (horas) return (typeof horas.inicio === 'string' && typeof horas.fim === 'string' && comHoras(horas.inicio, horas.fim)) || soData;
  const texto = (m.config.textos?.periodo ?? '').trim();
  const lido = /(\d{2}:\d{2}) a (?:\d{2}\/\d{2}\/\d{4} )?(\d{2}:\d{2})$/.exec(texto);
  const antigo = lido && comHoras(lido[1], lido[2]);
  return antigo && fmtPeriodoHora(antigo.inicio, antigo.fim) === texto ? antigo : soData;
}

/** Retângulo (lon/lat) que envolve os anéis externos dos talhões. */
export function bboxTalhoes(talhoes: Talhao[]): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of talhoes) {
    const polys = t.geom.type === 'Polygon' ? [t.geom.coordinates] : t.geom.coordinates;
    for (const poly of polys)
      for (const [lon, lat] of poly[0]) {
        if (lon < minX) minX = lon;
        if (lon > maxX) maxX = lon;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
      }
  }
  return [minX, minY, maxX, maxY];
}

/** PICs incluídos que ficam a mais de `limiteKm` do retângulo que envolve os talhões. */
export function avisosPicsDistantes(pics: Pic[], talhoes: Talhao[], limiteKm = 20): string[] {
  if (!talhoes.length) return [];
  const [minLon, minLat, maxLon, maxLat] = bboxTalhoes(talhoes);
  const proj = projetorUtm(utmEpsgFor((minLon + maxLon) / 2, (minLat + maxLat) / 2));
  const [x0, y0] = proj.forward(minLon, minLat);
  const [x1, y1] = proj.forward(maxLon, maxLat);
  const distantes = pics.filter((p) => {
    if (!p.incluir) return false;
    const [x, y] = proj.forward(p.lon, p.lat);
    const dx = Math.max(x0 - x, 0, x - x1);
    const dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy) > limiteKm * 1000;
  });
  return distantes.map((p) => `O PIC "${p.nome}" está a mais de ${limiteKm} km da fazenda. Confira se o CSV é desta fazenda.`);
}

export function avisosPeriodoSafra(ini: Date | null, fim: Date | null, safra: Safra | null): string[] {
  if (!safra || !ini || !fim || !safra.inicio || !safra.fim) return [];
  const sIni = parseIsoData(safra.inicio);
  const sFim = parseIsoData(safra.fim);
  if (!sIni || !sFim) return [];
  sFim.setHours(23, 59, 59, 999);
  if (ini >= sIni && fim <= sFim) return [];
  return [`O período do CSV (${fmtPeriodo(ini, fim)}) não está todo dentro da safra ${safra.nome} (${fmtData(sIni)} a ${fmtData(sFim)}).`];
}

const num = (v: number, casas: number) => (Number.isFinite(v) ? v.toFixed(casas).replace('.', ',') : '');

/**
 * CSV para o Excel em português: separador ";" e decimal ",". `situacoes` (talhaoId → situação do plantio)
 * preenche as colunas Situação e % plantado (vazias sem situação).
 */
export function csvChuvaPorTalhao(linhas: TalhaoStats[], situacoes?: Map<string, { status: StatusPlantio; pct: number | null }>): string {
  const cab = 'Talhão;Setor;Plantado;Situação;% plantado;Área (ha);Chuva média (mm);Chuva mínima (mm);Chuva máxima (mm)';
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const corpo = linhas.map((l) => {
    const sit = situacoes?.get(l.talhaoId);
    return [
      esc(l.nome),
      esc(l.setor ?? ''),
      l.plantado ? 'Sim' : 'Não',
      sit ? ROTULO_STATUS[sit.status] : '',
      sit && sit.pct !== null ? String(Math.round(sit.pct)) : '',
      num(l.areaHa, 2),
      num(l.media, 1),
      num(l.min, 1),
      num(l.max, 1),
    ].join(';');
  });
  return [cab, ...corpo].join('\r\n');
}
