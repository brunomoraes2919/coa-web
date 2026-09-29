import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { COR_STATUS } from '../lib/situacaoPlantio';
import type { Geometry, StatusPlantio, Talhao } from '../lib/types';
import type { FeicaoImportada } from '../lib/shapes';
import { vincularRotulo } from './rotuloTalhao';

interface Props {
  talhoes: Talhao[] | FeicaoImportada[];
  /** ids dos talhões destacados em laranja (para feições importadas, o índice como string) */
  selecionados?: Set<string>;
  onClickTalhao?(id: string): void;
  /** texto fixo sobre cada talhão (por índice) */
  rotulo?(i: number): string;
  /** altura em px (padrão 420) */
  altura?: number;
  /** situação do plantio por id (talhões não selecionados): plantado laranja, plantando amarelo, a plantar tracejado */
  situacoes?: Map<string, StatusPlantio>;
  /** polígonos desenhados por cima em laranja, sem interação (ex.: prévia das áreas da cultura) */
  sobrepor?: Geometry[];
}

interface PropsFeicao {
  id: string;
  i: number;
}

const URL_SATELITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LARANJA = '#DB8A08';

/** Talhão cadastrado usa o próprio id; feição importada (sem id) usa o índice. */
function idDe(t: Talhao | FeicaoImportada, i: number): string {
  return 'id' in t ? t.id : String(i);
}

function estilo(selecionado: boolean, realce = false, status?: StatusPlantio): L.PathOptions {
  if (!selecionado && status) {
    const cor = COR_STATUS[status];
    return {
      color: status === 'a_plantar' ? '#ffffff' : cor,
      weight: realce ? 3 : status === 'a_plantar' ? 1.5 : 2,
      dashArray: status === 'a_plantar' ? '5 4' : undefined,
      opacity: 1,
      fill: true,
      fillColor: cor,
      fillOpacity: status === 'a_plantar' ? 0 : 0.45,
    };
  }
  return {
    color: selecionado ? LARANJA : '#ffffff',
    weight: realce ? 3 : 1.5,
    opacity: 1,
    fill: true,
    fillColor: LARANJA,
    fillOpacity: selecionado ? 0.45 : 0,
  };
}

interface Caminho {
  id: string;
  caminho: L.Path;
  texto?: string;
}

/** Esconde o rótulo do talhão que ficou pequeno demais na tela para o texto (evita a pilha de nomes). */
function ajustarRotulos(mapa: L.Map | null, caminhos: Caminho[]) {
  if (!mapa) return;
  for (const item of caminhos) {
    const el = item?.caminho.getTooltip()?.getElement();
    if (!item || !el || !item.texto) continue;
    const b = (item.caminho as L.Polygon).getBounds();
    const a = mapa.latLngToContainerPoint(b.getNorthWest());
    const c = mapa.latLngToContainerPoint(b.getSouthEast());
    const cabe = Math.abs(c.x - a.x) >= item.texto.length * 6.5 + 4 && Math.abs(c.y - a.y) >= 14;
    el.style.visibility = cabe ? '' : 'hidden';
  }
}

const ESTILO_SOBREPOR: L.PathOptions = { color: LARANJA, weight: 2, opacity: 1, fill: true, fillColor: LARANJA, fillOpacity: 0.35 };

export default function MapaLeaflet({ talhoes, selecionados, onClickTalhao, rotulo, altura = 420, situacoes, sobrepor }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.GeoJSON | null>(null);
  const caminhosRef = useRef<Caminho[]>([]);
  const rotulosRef = useRef<string | null>(null);
  const sobreporRef = useRef<L.GeoJSON | null>(null);
  // valores mais recentes das props usadas dentro dos handlers do Leaflet
  const atualRef = useRef({ selecionados, onClickTalhao, situacoes });

  useEffect(() => {
    atualRef.current = { selecionados, onClickTalhao, situacoes };
  });

  // cria o mapa uma vez
  useEffect(() => {
    const div = divRef.current;
    if (!div) return;
    const mapa = L.map(div, { zoomControl: true, attributionControl: true }).setView([-13.5, -56], 5);
    L.tileLayer(URL_SATELITE, { attribution: 'Esri', maxZoom: 20, maxNativeZoom: 19 }).addTo(mapa);
    mapaRef.current = mapa;
    mapa.on('zoomend', () => ajustarRotulos(mapa, caminhosRef.current));
    const obs = new ResizeObserver(() => mapa.invalidateSize());
    obs.observe(div);
    return () => {
      obs.disconnect();
      mapa.remove();
      mapaRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // desenha os polígonos quando os dados mudam
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    const lista: readonly (Talhao | FeicaoImportada)[] = talhoes;
    const fc: FeatureCollection<Geometry, PropsFeicao> = {
      type: 'FeatureCollection',
      features: lista.map((t, i) => ({ type: 'Feature', properties: { id: idDe(t, i), i }, geometry: t.geom })),
    };
    const caminhos: Caminho[] = [];
    const clicavel = !!atualRef.current.onClickTalhao;
    const camada = L.geoJSON<PropsFeicao>(fc, {
      interactive: clicavel,
      style: (f) => estilo(!!f && !!atualRef.current.selecionados?.has(f.properties.id), false, f ? atualRef.current.situacoes?.get(f.properties.id) : undefined),
      onEachFeature: (f, layer) => {
        const id = f.properties.id;
        const caminho = layer as L.Path;
        caminhos[f.properties.i] = { id, caminho };
        if (!clicavel) return;
        const sel = () => !!atualRef.current.selecionados?.has(id);
        const st = () => atualRef.current.situacoes?.get(id);
        caminho.on('click', () => atualRef.current.onClickTalhao?.(id));
        caminho.on('mouseover', () => caminho.setStyle(estilo(sel(), true, st())));
        caminho.on('mouseout', () => caminho.setStyle(estilo(sel(), false, st())));
      },
    }).addTo(mapa);
    camadaRef.current = camada;
    caminhosRef.current = caminhos;
    rotulosRef.current = null;
    const limites = camada.getBounds();
    if (limites.isValid()) mapa.fitBounds(limites, { padding: [16, 16] });
    else if (sobreporRef.current?.getBounds().isValid()) mapa.fitBounds(sobreporRef.current.getBounds(), { padding: [16, 16] });
    return () => {
      camada.remove();
      if (camadaRef.current === camada) camadaRef.current = null;
      caminhosRef.current = [];
    };
  }, [talhoes]);

  // camada sobreposta (ex.: áreas da cultura), sempre por cima dos talhões
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !sobrepor?.length) return;
    const fc: FeatureCollection<Geometry> = {
      type: 'FeatureCollection',
      features: sobrepor.map((g) => ({ type: 'Feature', properties: {}, geometry: g })),
    };
    const camada = L.geoJSON(fc, { interactive: false, style: () => ESTILO_SOBREPOR }).addTo(mapa);
    sobreporRef.current = camada;
    if (!camadaRef.current?.getBounds().isValid() && camada.getBounds().isValid()) mapa.fitBounds(camada.getBounds(), { padding: [16, 16] });
    return () => {
      camada.remove();
      if (sobreporRef.current === camada) sobreporRef.current = null;
    };
  }, [sobrepor, talhoes]);

  // atualiza o destaque dos selecionados sem redesenhar
  useEffect(() => {
    for (const item of caminhosRef.current) {
      if (item) item.caminho.setStyle(estilo(!!selecionados?.has(item.id), false, situacoes?.get(item.id)));
    }
  }, [selecionados, situacoes, talhoes]);

  // rótulos: só refaz quando o texto muda (a função pode mudar a cada render)
  useEffect(() => {
    const textos = rotulo ? caminhosRef.current.map((_, i) => rotulo(i)) : [];
    const chave = textos.join('\u0001');
    if (chave === rotulosRef.current) return;
    rotulosRef.current = chave;
    caminhosRef.current.forEach((item, i) => {
      if (!item) return;
      item.caminho.unbindTooltip();
      item.texto = rotulo ? textos[i] : undefined;
      if (item.texto) vincularRotulo(item.caminho, item.texto);
    });
    ajustarRotulos(mapaRef.current, caminhosRef.current);
  });

  return <div ref={divRef} className="mapa-leaflet" style={{ height: altura }} />;
}
