/* Previsão do Tempo — contas do módulo, sem tela: onde cada ponto do limite da fazenda cai sobre o
   mapa do Windy, que vista enquadra uma fazenda, o endereço do widget e a leitura dos avisos dele.
   Serve ao navegador (window.PrevisaoLogica) e aos testes (node --test "modulos/previsao/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PrevisaoLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* O widget do Windy é um mapa Leaflet comum (Web Mercator, quadros de 256 px) que só aceita estes zooms. */
  const ZOOM_MIN = 3;
  const ZOOM_MAX = 11;
  const LAT_MAX = 85.06;
  const ORIGEM_WINDY = 'https://embed.windy.com';

  const finito = (n) => typeof n === 'number' && Number.isFinite(n);

  /** Posição no "mundo" do Web Mercator, em pixels, para o zoom dado. */
  function noMundo(lat, lon, zoom) {
    const lado = 256 * Math.pow(2, zoom);
    const rad = (Math.max(-LAT_MAX, Math.min(LAT_MAX, lat)) * Math.PI) / 180;
    return {
      x: ((lon + 180) / 360) * lado,
      y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * lado,
    };
  }

  /** Latitude de uma altura `y` do mundo (o inverso de `noMundo`). */
  function latitudeDoMundo(y, zoom) {
    const n = Math.PI * (1 - (2 * y) / (256 * Math.pow(2, zoom)));
    return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  }

  /** Pixel da tela onde cai um ponto, com o mapa centrado em `vista` e ocupando a tela inteira. */
  function paraTela(ponto, vista, tela) {
    const p = noMundo(ponto.lat, ponto.lon, vista.zoom);
    const c = noMundo(vista.lat, vista.lon, vista.zoom);
    return { x: p.x - c.x + tela.largura / 2, y: p.y - c.y + tela.altura / 2 };
  }

  /** Anéis (listas de [lon, lat]) de um Polygon ou MultiPolygon do GeoJSON; qualquer outra coisa não tem anel. */
  function aneis(geom) {
    if (!geom || typeof geom !== 'object' || !Array.isArray(geom.coordinates)) return [];
    if (geom.type === 'Polygon') return geom.coordinates.filter(Array.isArray);
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.reduce((todos, poligono) => (Array.isArray(poligono) ? todos.concat(poligono.filter(Array.isArray)) : todos), []);
    }
    return [];
  }

  /** Caixa (oeste, leste, sul, norte) que envolve as geometrias; `null` sem nenhum vértice válido. */
  function caixaDasGeometrias(geometrias) {
    let oeste = Infinity, leste = -Infinity, sul = Infinity, norte = -Infinity;
    (geometrias || []).forEach((geom) => {
      aneis(geom).forEach((anel) => {
        anel.forEach((v) => {
          if (!Array.isArray(v) || !finito(v[0]) || !finito(v[1])) return;
          oeste = Math.min(oeste, v[0]);
          leste = Math.max(leste, v[0]);
          sul = Math.min(sul, v[1]);
          norte = Math.max(norte, v[1]);
        });
      });
    });
    return finito(oeste) && finito(sul) ? { oeste, leste, sul, norte } : null;
  }

  /** Uma caixa só em volta de várias; as vazias (`null`) ficam de fora. */
  function juntarCaixas(caixas) {
    const validas = (caixas || []).filter(Boolean);
    if (!validas.length) return null;
    return {
      oeste: Math.min.apply(null, validas.map((c) => c.oeste)),
      leste: Math.max.apply(null, validas.map((c) => c.leste)),
      sul: Math.min.apply(null, validas.map((c) => c.sul)),
      norte: Math.max.apply(null, validas.map((c) => c.norte)),
    };
  }

  /** Talhões (`mapas_talhoes`: fazenda_id + geom) agrupados por fazenda, com a caixa de cada uma.
      Linha sem polígono fica de fora; fazenda sem nenhum não aparece. */
  function limitesPorFazenda(linhas) {
    const por = {};
    (linhas || []).forEach((linha) => {
      if (!linha || !aneis(linha.geom).length) return;
      (por[linha.fazenda_id] = por[linha.fazenda_id] || { geometrias: [], caixa: null }).geometrias.push(linha.geom);
    });
    Object.keys(por).forEach((id) => {
      por[id].caixa = caixaDasGeometrias(por[id].geometrias);
      if (!por[id].caixa) delete por[id];
    });
    return por;
  }

  /** Vista (centro + zoom) que mostra a caixa inteira: o maior zoom do Windy em que ela cabe com a margem. */
  function vistaQueCabe(caixa, tela, margem) {
    const folga = Math.min(finito(margem) ? margem : 60, tela.largura / 4, tela.altura / 4);
    let zoom = ZOOM_MAX;
    for (; zoom > ZOOM_MIN; zoom--) {
      const a = noMundo(caixa.norte, caixa.oeste, zoom);
      const b = noMundo(caixa.sul, caixa.leste, zoom);
      if (b.x - a.x <= tela.largura - 2 * folga && b.y - a.y <= tela.altura - 2 * folga) break;
    }
    const meioY = (noMundo(caixa.norte, 0, zoom).y + noMundo(caixa.sul, 0, zoom).y) / 2;
    return { lat: latitudeDoMundo(meioY, zoom), lon: (caixa.oeste + caixa.leste) / 2, zoom };
  }

  const grau = (n) => String(+n.toFixed(4));

  /** Endereço do widget do Windy. `embedMake` faz o widget avisar a página de fora (postMessage
      `updateValues`) onde o mapa está depois de cada movimento — é o que deixa desenhar os limites por cima. */
  function urlWindy(o) {
    const q = new URLSearchParams({
      lat: grau(o.lat), lon: grau(o.lon), detailLat: grau(o.lat), detailLon: grau(o.lon),
      zoom: String(o.zoom), level: 'surface', overlay: o.camada, product: o.modelo,
      menu: '', message: 'true', marker: '', calendar: 'now', pressure: '', type: 'map',
      location: 'coordinates', detail: '', metricWind: 'km/h', metricTemp: '°C', metricRain: 'mm',
      radarRange: '-1', embedMake: 'true',
    });
    return ORIGEM_WINDY + '/embed2.html?' + q.toString();
  }

  /** Aviso de posição do widget ({ type:'updateValues', payload }) → { lat, lon, zoom, camada, modelo };
      `null` para qualquer outra mensagem. O conteúdo vem de outra origem: nada é aceito sem conferir. */
  function lerPosicaoWindy(dado) {
    if (!dado || typeof dado !== 'object' || dado.type !== 'updateValues') return null;
    const p = dado.payload;
    if (!p || typeof p !== 'object' || !p.coordinates || typeof p.coordinates !== 'object') return null;
    const lat = p.coordinates.lat, lon = p.coordinates.lon, zoom = p.zoom;
    if (!finito(lat) || !finito(lon) || !finito(zoom)) return null;
    if (Math.abs(lat) > 90 || zoom < 0 || zoom > 22) return null;
    return {
      lat, lon, zoom,
      camada: typeof p.overlay === 'string' ? p.overlay : null,
      modelo: typeof p.product === 'string' ? p.product : null,
    };
  }

  const pixel = (n) => String(+n.toFixed(1));

  /** Atributo `d` de um <path> com os anéis da geometria em pixels da tela. Vértice a menos de meio
      pixel do anterior é pulado (de longe a fazenda tem poucos pixels e milhares de vértices), e anel
      que sobra com menos de 3 pontos não é desenhado. */
  function caminhoSvg(geom, vista, tela) {
    const centro = noMundo(vista.lat, vista.lon, vista.zoom);
    const dx = tela.largura / 2 - centro.x, dy = tela.altura / 2 - centro.y;
    let d = '';
    aneis(geom).forEach((anel) => {
      const pontos = [];
      anel.forEach((v) => {
        if (!Array.isArray(v) || !finito(v[0]) || !finito(v[1])) return;
        const m = noMundo(v[1], v[0], vista.zoom);
        const x = m.x + dx, y = m.y + dy;
        const ultimo = pontos[pontos.length - 1];
        if (ultimo && Math.abs(x - ultimo[0]) < 0.5 && Math.abs(y - ultimo[1]) < 0.5) return;
        pontos.push([x, y]);
      });
      // o GeoJSON repete o primeiro vértice no fim: o `Z` já fecha o anel
      if (pontos.length > 1) {
        const a = pontos[0], z = pontos[pontos.length - 1];
        if (Math.abs(a[0] - z[0]) < 0.5 && Math.abs(a[1] - z[1]) < 0.5) pontos.pop();
      }
      if (pontos.length < 3) return;
      d += 'M' + pontos.map((p) => pixel(p[0]) + ' ' + pixel(p[1])).join('L') + 'Z';
    });
    return d;
  }

  return {
    ZOOM_MIN, ZOOM_MAX, ORIGEM_WINDY,
    paraTela, caixaDasGeometrias, juntarCaixas, limitesPorFazenda, vistaQueCabe, urlWindy, lerPosicaoWindy, caminhoSvg,
  };
});
