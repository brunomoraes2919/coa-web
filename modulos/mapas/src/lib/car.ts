/**
 * Regras do Mapa de CAR e Matrícula, sem tela: categoria de cada tema declarado no CAR e o quadro de áreas por CAR e
 * por matrícula.
 *
 * As interseções são contadas numa grade (rasterização por linha de varredura, células de ~5 a 15 m conforme o
 * tamanho da fazenda): cada uso é pintado uma vez numa máscara de bits e a área de cada uso dentro de um CAR ou
 * matrícula é a soma das células do polígono que têm o bit. Interseção exata de polígonos detalhados levava minutos;
 * assim leva uma fração de segundo, com erro bem menor que o das próprias bases. A área total de cada CAR ou
 * matrícula é a geodésica do polígono (@turf/area).
 *
 * Áreas de cada CAR ou matrícula (P):
 *   agrícola         = P ∩ talhões que não são eucalipto (os talhões do cadastro de Fazendas)
 *   eucalipto        = P ∩ talhões que o PIMS marca como eucalipto (ocupação do período mais recente)
 *   pecuária (est.)  = P ∩ área consolidada declarada no CAR, fora dos talhões (não há base com os pastos)
 *   reserva legal    = P ∩ reserva legal declarada (averbada, aprovada ou proposta)
 *   APP              = P ∩ APPs declaradas
 *   vegetação nativa = P ∩ remanescente de vegetação nativa declarado
 */
import areaTurf from '@turf/area';
import type { Feature, MultiPolygon, Position } from 'geojson';
import { normalizarCodigo } from './codigoTalhao';
import type { DadosCar, LayoutTextos, Talhao } from './types';

export const TITULO_MAPA_CAR = 'MAPA DE CAR E MATRÍCULA';

export type CategoriaTema = 'reserva_legal' | 'app' | 'vegetacao_nativa' | 'area_consolidada' | 'hidrografia' | 'servidao' | 'uso_restrito';

/** Categoria do mapa para um tema do SICAR (nome da camada da consulta pública); desconhecido → null. */
export function categoriaDoTema(tema: string): CategoriaTema | null {
  const t = String(tema ?? '').toLowerCase();
  if (t.startsWith('arl_')) return 'reserva_legal';
  if (t.startsWith('app_')) return 'app';
  if (t === 'vegetacao_nativa') return 'vegetacao_nativa';
  if (t === 'area_consolidada' || t === 'area_pousio') return 'area_consolidada';
  if (/^(rio_|nascente|lago_natural|vereda|banhado|reservatorio_)/.test(t)) return 'hidrografia';
  if (t.startsWith('area_servidao')) return 'servidao';
  if (/^(area_uso_restrito|area_topo_morro|borda_chapada|area_declividade|area_altitude)/.test(t)) return 'uso_restrito';
  return null;
}

type Multi = Position[][][];

/** Os polígonos (coordenadas MultiPolygon) de uma geometria; linha, ponto ou nada → []. */
export function poligonosDaGeometria(g: Feature['geometry'] | null | undefined): Multi {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap((x) => poligonosDaGeometria(x));
  return [];
}

/** Área geodésica (ha) de uma coleção de polígonos. */
export function areaHa(m: Multi): number {
  if (!m.length) return 0;
  return areaTurf({ type: 'MultiPolygon', coordinates: m } as MultiPolygon) / 10_000;
}

// ---------------------------------------------------------------- grade (rasterização)

export interface Grade {
  x0: number;
  y1: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
  /** área (ha) de uma célula em cada linha (muda com a latitude) */
  haPorLinha: Float64Array;
}

const M_POR_GRAU_LAT = 110_574;

/**
 * Grade sobre o retângulo [x0, y0, x1, y1] (lon/lat) com no máximo `maxCelulas` células e lado de pelo menos
 * `minM` metros.
 */
export function gradeDe([x0, y0, x1, y1]: number[], maxCelulas = 4_000_000, minM = 5): Grade {
  const lat = ((y0 + y1) / 2) * (Math.PI / 180);
  const mLon = 111_320 * Math.cos(lat);
  const largM = Math.max((x1 - x0) * mLon, 1);
  const altM = Math.max((y1 - y0) * M_POR_GRAU_LAT, 1);
  const lado = Math.max(minM, Math.sqrt((largM * altM) / maxCelulas));
  const dx = lado / mLon;
  const dy = lado / M_POR_GRAU_LAT;
  const w = Math.max(1, Math.ceil((x1 - x0) / dx));
  const h = Math.max(1, Math.ceil((y1 - y0) / dy));
  const haPorLinha = new Float64Array(h);
  for (let r = 0; r < h; r++) {
    const latR = (y1 - (r + 0.5) * dy) * (Math.PI / 180);
    haPorLinha[r] = (dx * 111_320 * Math.cos(latR) * dy * M_POR_GRAU_LAT) / 10_000;
  }
  return { x0, y1, dx, dy, w, h, haPorLinha };
}

/**
 * Trechos de células (centro dentro do polígono, par-ímpar sobre todos os anéis) de uma coleção de polígonos:
 * chama `cb(linha, colunaInicial, colunaFinal)` para cada trecho.
 */
export function varrer(m: Multi, g: Grade, cb: (r: number, c0: number, c1: number) => void): void {
  const cruzamentos = new Map<number, number[]>();
  for (const poly of m)
    for (const anel of poly)
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const [xa, ya] = anel[j];
        const [xb, yb] = anel[i];
        if (ya === yb) continue;
        const rIni = Math.max(0, Math.ceil((g.y1 - Math.max(ya, yb)) / g.dy - 0.5));
        const rFim = Math.min(g.h - 1, Math.floor((g.y1 - Math.min(ya, yb)) / g.dy - 0.5));
        for (let r = rIni; r <= rFim; r++) {
          const yc = g.y1 - (r + 0.5) * g.dy;
          if (ya > yc === yb > yc) continue;
          const x = xa + ((yc - ya) * (xb - xa)) / (yb - ya);
          let l = cruzamentos.get(r);
          if (!l) cruzamentos.set(r, (l = []));
          l.push(x);
        }
      }
  for (const [r, xs] of cruzamentos) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.dx - 0.5));
      const c1 = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.x0) / g.dx - 0.5));
      if (c1 >= c0) cb(r, c0, c1);
    }
  }
}

/** Pinta o bit `bit` da máscara nas células de cada polígono (cada feição é varrida sozinha: a união é o OU). */
function pintar(partes: Multi[], g: Grade, mascara: Uint8Array, bit: number): void {
  for (const m of partes)
    varrer(m, g, (r, c0, c1) => {
      const base = r * g.w;
      for (let c = c0; c <= c1; c++) mascara[base + c] |= bit;
    });
}

// ---------------------------------------------------------------- CARs válidos

/** Situação do CAR no SICAR que fica fora do mapa: cancelado (o registro antigo de um imóvel que foi refeito). */
export const STATUS_CAR_FORA = new Set(['CA']);

/**
 * O que o mapa e o quadro usam: os CARs que não estão cancelados e os temas só desses CARs. Devolve também quantos
 * cancelados ficaram de fora (para o aviso na tela).
 */
export function dadosValidos(dados: DadosCar): { dados: DadosCar; cancelados: number } {
  const validos = dados.car.features.filter((f) => !STATUS_CAR_FORA.has(String(f.properties?.status ?? '').toUpperCase()));
  const codigos = new Set(validos.map((f) => String(f.properties?.cod_imovel ?? '')));
  return {
    cancelados: dados.car.features.length - validos.length,
    dados: {
      ...dados,
      car: { ...dados.car, features: validos },
      temas: { ...dados.temas, features: dados.temas.features.filter((f) => codigos.has(String(f.properties?.cod_imovel ?? ''))) },
    },
  };
}

// ---------------------------------------------------------------- talhões e uso

/** Códigos (normalizados) dos talhões de eucalipto segundo o PIMS. */
export function codigosEucalipto(dados: Pick<DadosCar, 'eucalipto'>): Set<string> {
  return new Set(dados.eucalipto.map((e) => normalizarCodigo(e.talhao)).filter(Boolean));
}

/** Uso de um talhão no mapa: eucalipto quando o código bate com o PIMS; senão, agrícola. */
export function usoDoTalhao(t: Pick<Talhao, 'codigo' | 'nome'>, eucalipto: ReadonlySet<string>): 'agricola' | 'eucalipto' {
  const c = normalizarCodigo(t.codigo ?? t.nome ?? '');
  return c && eucalipto.has(c) ? 'eucalipto' : 'agricola';
}

// ---------------------------------------------------------------- quadro de áreas

export interface LinhaQuadroCar {
  tipo: 'car' | 'matricula';
  /** código do CAR ou número da matrícula (ou o código da parcela, sem matrícula) */
  id: string;
  /** rótulo curto do mapa: "CAR 1", "Mat. 12.345" */
  rotulo: string;
  /** área do polígono (ha, geodésica) */
  areaHa: number;
  /** área declarada no CAR (ha); null nas matrículas */
  areaDeclaradaHa: number | null;
  agricolaHa: number;
  eucaliptoHa: number;
  pecuariaHa: number;
  reservaLegalHa: number;
  appHa: number;
  vegetacaoNativaHa: number;
  /** status no SICAR (AT, PE, …) ou no SIGEF (CERTIFICADA, REGISTRADA) */
  status: string | null;
  /** índice da feição em dados.car / dados.matriculas */
  indice: number;
}

export interface QuadroCar {
  linhas: LinhaQuadroCar[];
  /** área dos talhões (agrícola + eucalipto), e a parte fora de todos os CARs / de todas as matrículas */
  talhoesHa: number;
  talhoesForaDeCarHa: number;
  talhoesForaDeMatriculaHa: number;
  /** eucalipto do PIMS cujo talhão não está desenhado no cadastro de Fazendas (não entra no recorte) */
  eucaliptoSemDesenhoHa: number;
}

/**
 * "12.345" → "Mat. 12.345"; lista ("340, 345, 351") → "Mat. 340 +2" (o SIGEF junta as matrículas de uma
 * certificação num campo só); sem número → "Parcela <código curto>".
 */
export function rotuloMatricula(matricula: unknown, parcela: unknown, i: number): string {
  const lista = String(matricula ?? '').split(/\s*[,;/]\s*|\s+e\s+/).map((s) => s.trim()).filter(Boolean);
  if (lista.length) return lista.length > 1 ? `Mat. ${lista[0]} +${lista.length - 1}` : `Mat. ${lista[0]}`;
  const p = String(parcela ?? '').trim();
  return p ? `Parcela ${p.slice(0, 8)}` : `Parcela ${i + 1}`;
}

const BIT = { agricola: 1, eucalipto: 2, reservaLegal: 4, app: 8, vegetacaoNativa: 16, consolidada: 32, car: 64, matricula: 128 } as const;

/** Retângulo de todas as feições que entram na conta. */
function retanguloDe(partes: Multi[]): number[] | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of partes)
    for (const poly of m)
      for (const [x, y] of poly[0] ?? []) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

/**
 * Quadro de áreas: um CAR por linha (do maior para o menor, rotulados CAR 1, CAR 2…), depois as matrículas (da
 * maior para a menor). `opcoes.maxCelulas` controla a resolução da grade (testes usam menos).
 */
export function quadroDoCar(dados: DadosCar, talhoes: Talhao[], opcoes: { maxCelulas?: number } = {}): QuadroCar {
  const euc = codigosEucalipto(dados);
  const geomTalhao = (t: Talhao) => poligonosDaGeometria(t.geom as Feature['geometry']);
  const talAgr = talhoes.filter((t) => usoDoTalhao(t, euc) === 'agricola').map(geomTalhao);
  const talEuc = talhoes.filter((t) => usoDoTalhao(t, euc) === 'eucalipto').map(geomTalhao);
  const doTema = (cat: CategoriaTema) => dados.temas.features.filter((f) => categoriaDoTema(String(f.properties?.tema ?? '')) === cat).map((f) => poligonosDaGeometria(f.geometry));
  const cars = dados.car.features.map((f) => poligonosDaGeometria(f.geometry));
  const mats = dados.matriculas.features.map((f) => poligonosDaGeometria(f.geometry));
  const camadas: [Multi[], number][] = [
    [talAgr, BIT.agricola],
    [talEuc, BIT.eucalipto],
    [doTema('reserva_legal'), BIT.reservaLegal],
    [doTema('app'), BIT.app],
    [doTema('vegetacao_nativa'), BIT.vegetacaoNativa],
    [doTema('area_consolidada'), BIT.consolidada],
    [cars, BIT.car],
    [mats, BIT.matricula],
  ];
  const desenhados = new Set(talhoes.map((t) => normalizarCodigo(t.codigo ?? t.nome ?? '')));
  const eucaliptoSemDesenhoHa = dados.eucalipto.filter((e) => !desenhados.has(normalizarCodigo(e.talhao))).reduce((s, e) => s + e.areaHa, 0);
  const ret = retanguloDe(camadas.flatMap(([p]) => p));
  if (!ret) return { linhas: [], talhoesHa: 0, talhoesForaDeCarHa: 0, talhoesForaDeMatriculaHa: 0, eucaliptoSemDesenhoHa };
  const g = gradeDe(ret, opcoes.maxCelulas);
  const mascara = new Uint8Array(g.w * g.h);
  for (const [partes, bit] of camadas) pintar(partes, g, mascara, bit);

  const contar = (m: Multi) => {
    const s = { agricola: 0, eucalipto: 0, pecuaria: 0, reservaLegal: 0, app: 0, vegetacaoNativa: 0 };
    varrer(m, g, (r, c0, c1) => {
      const ha = g.haPorLinha[r];
      const base = r * g.w;
      for (let c = c0; c <= c1; c++) {
        const f = mascara[base + c];
        if (f & BIT.agricola) s.agricola += ha;
        if (f & BIT.eucalipto) s.eucalipto += ha;
        if (f & BIT.consolidada && !(f & (BIT.agricola | BIT.eucalipto))) s.pecuaria += ha;
        if (f & BIT.reservaLegal) s.reservaLegal += ha;
        if (f & BIT.app) s.app += ha;
        if (f & BIT.vegetacaoNativa) s.vegetacaoNativa += ha;
      }
    });
    return s;
  };
  const linha = (tipo: 'car' | 'matricula', f: Feature, m: Multi, indice: number): Omit<LinhaQuadroCar, 'rotulo'> => {
    const s = contar(m);
    const props = f.properties ?? {};
    return {
      tipo,
      id: String(tipo === 'car' ? (props.cod_imovel ?? '') : props.matricula || props.parcela || ''),
      areaHa: areaHa(m),
      areaDeclaradaHa: tipo === 'car' && props.area !== null && props.area !== undefined && Number.isFinite(Number(props.area)) ? Number(props.area) : null,
      agricolaHa: s.agricola,
      eucaliptoHa: s.eucalipto,
      pecuariaHa: s.pecuaria,
      reservaLegalHa: s.reservaLegal,
      appHa: s.app,
      vegetacaoNativaHa: s.vegetacaoNativa,
      status: props.status !== null && props.status !== undefined ? String(props.status) : null,
      indice,
    };
  };
  const linhasCar = dados.car.features
    .map((f, i) => linha('car', f, cars[i], i))
    .sort((a, b) => b.areaHa - a.areaHa)
    .map((l, i) => ({ ...l, rotulo: `CAR ${i + 1}` }));
  const linhasMat = dados.matriculas.features
    .map((f, i) => ({ ...linha('matricula', f, mats[i], i), rotulo: rotuloMatricula(f.properties?.matricula, f.properties?.parcela, i) }))
    .sort((a, b) => b.areaHa - a.areaHa);

  let talhoesHa = 0;
  let foraCar = 0;
  let foraMat = 0;
  for (let r = 0; r < g.h; r++) {
    const ha = g.haPorLinha[r];
    const base = r * g.w;
    for (let c = 0; c < g.w; c++) {
      const f = mascara[base + c];
      if (!(f & (BIT.agricola | BIT.eucalipto))) continue;
      talhoesHa += ha;
      if (!(f & BIT.car)) foraCar += ha;
      if (!(f & BIT.matricula)) foraMat += ha;
    }
  }
  return { linhas: [...linhasCar, ...linhasMat], talhoesHa, talhoesForaDeCarHa: foraCar, talhoesForaDeMatriculaHa: foraMat, eucaliptoSemDesenhoHa };
}

/** "1.234" (sem casa a partir de 100 ha), "12,3", "0" e "—" quando não há valor. */
export function fmtHa(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) < 0.05) return '0';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(v) < 100 ? 1 : 0 });
}

/** CSV (Excel em português) do quadro de áreas. */
export function csvQuadroCar(q: QuadroCar): string {
  const n = (v: number | null) => (v === null ? '' : v.toFixed(2).replace('.', ','));
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cab = 'Tipo;Rótulo;Código ou matrícula;Situação;Área (ha);Área declarada no CAR (ha);Agrícola (ha);Eucalipto (ha);Pecuária estimada (ha);Reserva legal (ha);APP (ha);Vegetação nativa (ha)';
  const linhas = q.linhas.map((l) =>
    [l.tipo === 'car' ? 'CAR' : 'Matrícula', esc(l.rotulo), esc(l.id), esc(l.status ?? ''), n(l.areaHa), n(l.areaDeclaradaHa), n(l.agricolaHa), n(l.eucaliptoHa), n(l.pecuariaHa), n(l.reservaLegalHa), n(l.appHa), n(l.vegetacaoNativaHa)].join(';'),
  );
  return [cab, ...linhas].join('\r\n');
}

/** Bases que entram no rodapé "Bases" do painel (as que responderam na última busca). */
export function textoBasesCar(fontes: Partial<Record<string, { ok: boolean }>>): string {
  const ok = (k: string) => fontes[k]?.ok === true;
  const nomes = [ok('sicar') || ok('temas') ? 'SICAR' : '', ok('sigef') ? 'SIGEF' : '', ok('ibge') ? 'IBGE' : '', ok('osm') ? 'OpenStreetMap' : '', ok('pims') ? 'PIMS' : ''].filter(Boolean);
  return nomes.join(' · ');
}

/** Textos automáticos do Mapa de CAR e Matrícula (sem safra nem período). */
export function textosAutomaticosCar(e: { fazenda: string; fontes: Partial<Record<string, { ok: boolean }>>; hoje: Date }): LayoutTextos {
  const d = e.hoje;
  const dois = (n: number) => String(n).padStart(2, '0');
  return {
    titulo: TITULO_MAPA_CAR,
    fazenda: e.fazenda.toUpperCase(),
    safra: '',
    periodo: '',
    fonte: textoBasesCar(e.fontes),
    talhoes: 'TODOS',
    setor: 'TODOS',
    observacao: '',
    data: `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`,
  };
}
