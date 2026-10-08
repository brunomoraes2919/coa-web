/* =====================================================================
   Chuva por talhão — lógica (sem DOM)
   A chuva do talhão segue a visão vw_precipitacao_talhao da ZEUS: soma do dia de cada pluviômetro ligado
   ao talhão, em média quando há mais de um. O servidor grava a chuva diária por pluviômetro e o vínculo
   talhão → pluviômetros (tabela chuva_talhao); aqui sai a conta por talhão, o período, as classes de cor
   e a geometria do mapa. Usado pelo app.js no navegador e pelos testes em modulos/chuva/testes/.
===================================================================== */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ChuvaLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA = 86400000;
  /** mm: a partir daqui o dia conta como "dia com chuva" (a mesma regra do Mapa de Chuva: 1 mm já é chuva) */
  var CHUVA_MIN = 1;
  /** horas de diferença para a leitura mais recente da fazenda a partir das quais o pluviômetro está atrasado */
  var ATRASO_HORAS = 6;

  // ---------------------------- datas e números ----------------------------
  function utc(iso) { var p = String(iso).slice(0, 10).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function somarDias(iso, n) { return new Date(utc(iso) + n * DIA).toISOString().slice(0, 10); }
  function difDias(a, b) { return Math.round((utc(b) - utc(a)) / DIA); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function fmtMm(v, casas) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var c = casas === undefined ? 1 : casas;
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
  }
  /** '2026-10-07' → '07/10' (com `ano`, '07/10/2026'). */
  function fmtDia(iso, ano) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + (ano ? '/' + p[0] : ''); }
  /** '2026-10-07T23:00' → '07/10 às 23:00'. */
  function fmtLeitura(l) { if (!l) return '—'; return fmtDia(l) + (String(l).length >= 16 ? ' às ' + String(l).slice(11, 16) : ''); }
  function semAcento(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim().replace(/\s+/g, ' '); }

  // ---------------------------- fazenda ----------------------------
  /**
   * Nome curto do pluviômetro: sai o nome da fazenda, o que vem entre parênteses e os separadores.
   * 'PIC_77-GLOBO_PV5' → 'PIC 77 PV5'; 'PIC 14 (TH11,12) GUAPIRAMA' → 'PIC 14'; 'PIC_Dourado-TH1/07' → 'PIC TH1/07'.
   * Com `comParenteses`, o que vem entre parênteses fica (dois pluviômetros podem ter o mesmo número).
   * O nome inteiro da ZEUS continua disponível (nomeZeus).
   */
  function nomeDoPic(nome, unidade, comParenteses) {
    var n = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!comParenteses) n = n.replace(/\([^)]*\)/g, ' ');
    var palavras = semAcento(unidade).split(' ').filter(Boolean);
    if (palavras.length) n = n.replace(new RegExp('(^|[\\s_.-])' + palavras.join('[\\s_.-]+') + '(?=$|[\\s_.-])', 'ig'), '$1');
    n = n.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return n || String(nome || '').trim();
  }

  /**
   * Linha de chuva_talhao pronta para a conta: cada pluviômetro ganha `mm` (um valor por dia da janela;
   * null = dia sem leitura) e `n` (leituras no dia: o peso dele na média do talhão). `ultimoDia` = último dia
   * com alguma leitura (-1 = nenhuma); `fim` = o dia em que os períodos terminam (o último com leitura: a ZEUS
   * chega com atraso, e "até hoje" deixaria o fim do período sempre vazio) e `hoje` = a data desse dia.
   */
  function prepararFazenda(linha) {
    var dias = Math.max(0, Number(linha.dias) || 0);
    var ultimo = -1;
    var pics = (linha.pics || []).map(function (p) {
      var mm = new Array(dias).fill(null), leituras = new Array(dias).fill(0);
      var usual = Number(p.l) > 0 ? Number(p.l) : 1;
      String(p.d || '').split(',').forEach(function (parte) {
        var x = parte.indexOf('x');
        var q = x < 0 ? usual : Number(parte.slice(x + 1));
        if (x >= 0) parte = parte.slice(0, x);
        if (!parte) return;
        var i = parte.indexOf(':');
        var n = Number(i < 0 ? parte : parte.slice(0, i));
        var v = i < 0 ? 0 : Number(parte.slice(i + 1));
        if (!Number.isInteger(n) || n < 0 || n >= dias || !isFinite(v) || !(q > 0)) return;
        mm[n] = v;
        leituras[n] = q;
        if (n > ultimo) ultimo = n;
      });
      return {
        id: String(p.id), nome: nomeDoPic(p.n, linha.unidade), nomeZeus: String(p.n || ''), ul: p.ul || null, mm: mm, n: leituras,
        lat: typeof p.lat === 'number' ? p.lat : null, lon: typeof p.lon === 'number' ? p.lon : null,
      };
    });
    // nome curto repetido na fazenda: esses ficam com o trecho entre parênteses, que é o que os distingue
    var vezes = {};
    pics.forEach(function (p) { vezes[p.nome] = (vezes[p.nome] || 0) + 1; });
    pics.forEach(function (p) { if (vezes[p.nome] > 1) p.nome = nomeDoPic(p.nomeZeus, linha.unidade, true); });
    var fim = ultimo >= 0 ? ultimo : Math.max(0, dias - 1);
    return {
      unidade: linha.unidade, inicio: linha.inicio, dias: dias, fim: fim, hoje: somarDias(linha.inicio, fim),
      geradoEm: linha.gerado_em || null, ultimaLeitura: linha.ultima_leitura || null, ultimoDia: ultimo,
      pics: pics, vinculos: linha.vinculos || {},
    };
  }

  /** Códigos de que `codigo` pode ser subdivisão, do mais próximo ao mais geral: '068A1' → ['068A', '068']. */
  function paisDoCodigo(codigo) {
    var c = String(codigo || '');
    var lista = [];
    if (/PIVO$/.test(c)) return lista;
    for (;;) {
      var m = /^(.*[A-Z])\d+$/.exec(c) || /^(.*\d)[A-Z]+$/.exec(c);
      if (!m || !/\d/.test(m[1])) break;
      c = m[1];
      lista.push(c);
    }
    return lista;
  }

  /** Distância em km entre dois pontos { lat, lon } (plana: as fazendas têm poucos quilômetros). */
  function distKm(a, b) {
    var k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    var dx = (a.lon - b.lon) * k * 111.32, dy = (a.lat - b.lat) * 110.57;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * De quais pluviômetros vem a chuva de um talhão:
   *   'zeus'    — o vínculo do cadastro da ZEUS (o oficial);
   *   'pai'     — subdivisão sem vínculo herda do talhão de origem ('033A' usa o '033');
   *   'proximo' — sem vínculo nem origem, o pluviômetro mais próximo do centro do talhão;
   *   null      — a fazenda não tem pluviômetro com coordenada.
   * 'pai' e 'proximo' são estimativas e aparecem marcadas na tela.
   */
  function vinculoDoTalhao(codigo, centro, faz) {
    var v = faz.vinculos[codigo];
    if (v && v.length) return { tipo: 'zeus', pics: v.slice() };
    var pais = paisDoCodigo(codigo);
    for (var i = 0; i < pais.length; i++) {
      var vp = faz.vinculos[pais[i]];
      if (vp && vp.length) return { tipo: 'pai', pics: vp.slice(), pai: pais[i] };
    }
    var melhor = -1, km = Infinity;
    if (centro) {
      faz.pics.forEach(function (p, idx) {
        if (p.lat === null || p.lon === null) return;
        var d = distKm(centro, p);
        if (d < km) { km = d; melhor = idx; }
      });
    }
    return melhor < 0 ? { tipo: null, pics: [] } : { tipo: 'proximo', pics: [melhor], km: r1(km) };
  }

  /**
   * Chuva diária do talhão na janela inteira: média dos pluviômetros com leitura no dia, pesada pelo número
   * de leituras de cada um (é assim que a visão da ZEUS calcula); nenhum com leitura → null.
   */
  function serieDoTalhao(indices, faz) {
    var serie = new Array(faz.dias).fill(null);
    for (var d = 0; d < faz.dias; d++) {
      var soma = 0, peso = 0;
      for (var j = 0; j < indices.length; j++) {
        var p = faz.pics[indices[j]];
        var v = p ? p.mm[d] : null;
        if (v !== null && v !== undefined) { soma += v * p.n[d]; peso += p.n[d]; }
      }
      if (peso) serie[d] = soma / peso;
    }
    return serie;
  }

  /**
   * Números de um talhão no período [i0, i1] (índices de dia da janela):
   * total (null = nenhum dia com leitura), diasChuva (dias com 1 mm ou mais), maior { i, mm }, semLeitura (dias
   * sem leitura), ultima { i, mm } = último dia com chuva até o fim do período (procura na janela toda) e
   * diasSem = dias corridos desde essa chuva (null = não choveu na janela).
   */
  function resumoDaSerie(serie, i0, i1, ultimoDia) {
    var total = 0, lidos = 0, diasChuva = 0, maior = null;
    for (var d = i0; d <= i1; d++) {
      var v = serie[d];
      if (v === null || v === undefined) continue;
      lidos++;
      total += v;
      if (r1(v) >= CHUVA_MIN) { diasChuva++; if (!maior || v > maior.mm) maior = { i: d, mm: r1(v) }; }
    }
    var ref = Math.min(i1, ultimoDia === undefined || ultimoDia < 0 ? i1 : ultimoDia);
    var ultima = null;
    for (var k = ref; k >= 0; k--) { if (serie[k] !== null && serie[k] !== undefined && r1(serie[k]) >= CHUVA_MIN) { ultima = { i: k, mm: r1(serie[k]) }; break; } }
    return {
      total: lidos ? r1(total) : null, diasChuva: diasChuva, maior: maior, semLeitura: (i1 - i0 + 1) - lidos,
      ultima: ultima, diasSem: ultima ? ref - ultima.i : null,
    };
  }

  // ---------------------------- período ----------------------------
  var PERIODOS = [
    ['1', 'Último dia com leitura'], ['7', 'Últimos 7 dias'], ['15', 'Últimos 15 dias'], ['30', 'Últimos 30 dias'],
    ['mes', 'Mês atual'], ['safra', 'Safra (desde 1º de setembro)'], ['livre', 'Escolher as datas'],
  ];

  /**
   * Período escolhido em índices de dia da janela da fazenda, sempre dentro dela e terminando, no máximo,
   * no último dia com leitura: { i0, i1, de, ate, dias }. Um número ('7') = essa quantidade de dias até o
   * último com leitura; 'livre' usa `de` e `ate` ('YYYY-MM-DD'); trocados, são invertidos.
   */
  function periodo(tipo, faz, de, ate) {
    var fim = faz.fim;
    var i0, i1 = fim;
    if (tipo === 'mes') i0 = difDias(faz.inicio, faz.hoje.slice(0, 8) + '01');
    else if (tipo === 'safra') {
      var ano = +faz.hoje.slice(0, 4) - (+faz.hoje.slice(5, 7) >= 9 ? 0 : 1);
      i0 = difDias(faz.inicio, ano + '-09-01');
    } else if (tipo === 'livre') {
      var a = de ? difDias(faz.inicio, de) : fim, b = ate ? difDias(faz.inicio, ate) : fim;
      i0 = Math.min(a, b); i1 = Math.max(a, b);
    } else i0 = fim - ((parseInt(tipo, 10) || 7) - 1);
    i0 = Math.min(fim, Math.max(0, i0));
    i1 = Math.min(fim, Math.max(i0, i1));
    return { i0: i0, i1: i1, de: somarDias(faz.inicio, i0), ate: somarDias(faz.inicio, i1), dias: i1 - i0 + 1 };
  }

  // ---------------------------- classes de cor ----------------------------
  /* Uma cor só, do claro ao escuro (mais chuva = mais escuro); "sem chuva" fica num tom neutro. */
  var CORES_CHUVA = ['#EFEDE6', '#D3E4F4', '#ABCBEA', '#7FAEDD', '#5490CD', '#3272B5', '#1E5593', '#12396A'];
  /* Dias sem chuva: mais dias = mais escuro (a seca é o que chama atenção). */
  var CORES_SECA = ['#F1F5EF', '#FAEBCB', '#F1D08C', '#E2AD4E', '#C6831F', '#96590B', '#673A04'];
  var LIMITES_SECA = [3, 6, 11, 16, 21, 31];
  var COR_SEM_DADO = '#E4E7E3';

  /** Classes da chuva de um dia (mm), fixas: usadas no "Dia a dia". */
  var LIMITES_DIA = [1, 5, 10, 20, 30, 50, 75];
  var PASSOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  /**
   * Limites das classes de chuva do período (mm), tirados dos próprios valores: a primeira classe é sempre
   * "menos de 1 mm" e as outras seis sobem em passos redondos do menor ao maior valor. Assim a diferença
   * entre os talhões aparece tanto num dia quanto numa safra inteira. Sem nenhum valor → LIMITES_DIA.
   */
  function limitesChuva(valores) {
    var v = (valores || []).filter(function (x) { return x !== null && x !== undefined && isFinite(x) && x >= CHUVA_MIN; });
    if (!v.length) return LIMITES_DIA.slice();
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    var passo = PASSOS[PASSOS.length - 1];
    for (var i = 0; i < PASSOS.length; i++) { if (PASSOS[i] >= (max - min) / 6) { passo = PASSOS[i]; break; } }
    var base = Math.floor(min / passo) * passo;
    var limites = [CHUVA_MIN];
    for (var k = 1; limites.length < 7; k++) { if (base + k * passo > CHUVA_MIN) limites.push(base + k * passo); }
    return limites;
  }
  /** Classe de um valor: 0 = abaixo do primeiro limite … limites.length = do último em diante; sem valor → -1. */
  function classeDe(valor, limites) {
    if (valor === null || valor === undefined || !isFinite(valor)) return -1;
    var c = 0;
    while (c < limites.length && valor >= limites[c]) c++;
    return c;
  }
  /** Textos da legenda: ['< 1', '1 a 10', …, '120 ou mais'] (com `inteiro`, '0 a 2', '3 a 5', …). */
  function rotulosClasses(limites, inteiro) {
    var r = [inteiro ? '0 a ' + (limites[0] - 1) : '< ' + limites[0]];
    for (var i = 0; i < limites.length - 1; i++) r.push(limites[i] + ' a ' + (inteiro ? limites[i + 1] - 1 : limites[i + 1]));
    r.push(limites[limites.length - 1] + ' ou mais');
    return r;
  }
  /** Texto escuro ou claro sobre uma cor de fundo '#rrggbb'. */
  function tintaSobre(cor) {
    var n = parseInt(String(cor).slice(1), 16);
    var l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return l > 0.56 ? '#17251F' : '#FFFFFF';
  }

  // ---------------------------- geometria ----------------------------
  /** Polígonos de um GeoJSON Polygon ou MultiPolygon: [[anelExterno, buraco, …], …]. */
  function poligonos(geom) {
    if (!geom || !geom.coordinates) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }
  function caixaGeom(geom) {
    var c = { oeste: Infinity, leste: -Infinity, sul: Infinity, norte: -Infinity };
    poligonos(geom).forEach(function (pol) {
      (pol[0] || []).forEach(function (p) {
        if (p[0] < c.oeste) c.oeste = p[0];
        if (p[0] > c.leste) c.leste = p[0];
        if (p[1] < c.sul) c.sul = p[1];
        if (p[1] > c.norte) c.norte = p[1];
      });
    });
    return isFinite(c.oeste) ? c : null;
  }
  function juntarCaixas(caixas) {
    var c = null;
    caixas.forEach(function (x) {
      if (!x) return;
      c = c ? { oeste: Math.min(c.oeste, x.oeste), leste: Math.max(c.leste, x.leste), sul: Math.min(c.sul, x.sul), norte: Math.max(c.norte, x.norte) } : x;
    });
    return c;
  }
  /** Centro { lat, lon } do maior polígono da geometria (centroide do anel externo). */
  function centroGeom(geom) {
    var melhor = null;
    poligonos(geom).forEach(function (pol) {
      var a = pol[0] || [], area = 0, cx = 0, cy = 0;
      if (!a.length) return;
      // conta em torno do primeiro ponto: com a coordenada inteira, a subtração perde precisão
      var ox = a[0][0], oy = a[0][1];
      for (var i = 0, j = a.length - 1; i < a.length; j = i++) {
        var xj = a[j][0] - ox, yj = a[j][1] - oy, xi = a[i][0] - ox, yi = a[i][1] - oy;
        var f = xj * yi - xi * yj;
        area += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
      }
      if (!area) return;
      var c = { lon: ox + cx / (3 * area), lat: oy + cy / (3 * area), peso: Math.abs(area) };
      if (!melhor || c.peso > melhor.peso) melhor = c;
    });
    if (melhor) return { lat: melhor.lat, lon: melhor.lon };
    var cx2 = caixaGeom(geom);
    return cx2 ? { lat: (cx2.sul + cx2.norte) / 2, lon: (cx2.oeste + cx2.leste) / 2 } : null;
  }
  /** Projeção plana em metres em torno do centro de uma caixa: devolve f(lon, lat) → [x, y] (y cresce para o sul). */
  function projetor(caixa) {
    var lat0 = (caixa.sul + caixa.norte) / 2, lon0 = (caixa.oeste + caixa.leste) / 2;
    var kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110570;
    return function (lon, lat) { return [(lon - lon0) * kx, (lat0 - lat) * ky]; };
  }
  /**
   * Caminho SVG da geometria na projeção, em metros inteiros. Pontos a menos de `tolerancia` metros do
   * anterior são pulados (os limites vêm com muito mais detalhe do que a tela mostra).
   */
  function caminhoSvg(geom, proj, tolerancia) {
    var tol2 = Math.pow(tolerancia === undefined ? 4 : tolerancia, 2);
    var d = '';
    poligonos(geom).forEach(function (pol) {
      pol.forEach(function (anel) {
        var ux = null, uy = null, n = 0, trecho = '';
        for (var i = 0; i < anel.length; i++) {
          var p = proj(anel[i][0], anel[i][1]);
          if (ux !== null && i < anel.length - 1 && Math.pow(p[0] - ux, 2) + Math.pow(p[1] - uy, 2) < tol2) continue;
          trecho += (n ? 'L' : 'M') + Math.round(p[0]) + ' ' + Math.round(p[1]);
          ux = p[0]; uy = p[1]; n++;
        }
        if (n >= 3) d += trecho + 'Z';
      });
    });
    return d;
  }
  /** Caixa projetada { x, y, w, h } de uma geometria. */
  function caixaProjetada(caixa, proj) {
    var a = proj(caixa.oeste, caixa.norte), b = proj(caixa.leste, caixa.sul);
    return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
  }
  /**
   * Vista { x, y, w, h } com a proporção da tela que enquadra `caixa` com folga (fração de cada lado).
   * `rodape` = pixels de baixo da tela que ficam livres (a legenda fica por cima do mapa ali).
   */
  function vistaQueEnquadra(caixa, tela, folga, minimo, rodape) {
    var f = folga === undefined ? 0.08 : folga;
    var larg = tela.largura || 1, alt = Math.max(40, (tela.altura || 1) - (rodape || 0));
    var w = Math.max(caixa.w, minimo || 1) * (1 + 2 * f), h = Math.max(caixa.h, minimo || 1) * (1 + 2 * f);
    var prop = larg / alt;
    if (w / h > prop) h = w / prop; else w = h * prop;
    var extra = h * ((tela.altura || 1) / alt - 1);
    return { x: caixa.x + caixa.w / 2 - w / 2, y: caixa.y + caixa.h / 2 - h / 2, w: w, h: h + extra };
  }

  // ---------------------------- tabelas ----------------------------
  /**
   * Linhas da tabela por talhão. `talhoes` = [{ codigo, nome, area, centro }]; devolve, na mesma ordem,
   * { codigo, nome, area, vinculo, pics (nomes), estimado, serie, total, diasChuva, maior, ultima, diasSem, semLeitura }.
   */
  function linhasDosTalhoes(talhoes, faz, per) {
    return talhoes.map(function (t) {
      var v = vinculoDoTalhao(t.codigo, t.centro, faz);
      var serie = serieDoTalhao(v.pics, faz);
      var r = resumoDaSerie(serie, per.i0, per.i1, faz.ultimoDia);
      return {
        codigo: t.codigo, nome: t.nome || t.codigo, area: t.area || 0, vinculo: v,
        pics: v.pics.map(function (i) { return faz.pics[i] ? faz.pics[i].nome : ''; }),
        estimado: v.tipo === 'pai' || v.tipo === 'proximo', serie: serie,
        total: r.total, diasChuva: r.diasChuva, maior: r.maior, ultima: r.ultima, diasSem: r.diasSem, semLeitura: r.semLeitura,
      };
    });
  }

  /** Por que o valor de um talhão é estimado (texto da tela); vínculo oficial → ''. */
  function textoDoVinculo(v) {
    if (v.tipo === 'pai') return 'Estimado: sem vínculo na ZEUS, usa o pluviômetro do talhão ' + v.pai;
    if (v.tipo === 'proximo') return 'Estimado: sem vínculo na ZEUS, usa o pluviômetro mais próximo (' + fmtMm(v.km) + ' km)';
    if (!v.tipo) return 'Sem pluviômetro para este talhão';
    return '';
  }

  /** Resumo da fazenda no período: média ponderada pela área, maior, menor, talhões sem chuva e estimados. */
  function resumoDaFazenda(linhas) {
    var com = linhas.filter(function (l) { return l.total !== null; });
    var area = 0, soma = 0, simples = 0;
    com.forEach(function (l) { area += l.area; soma += l.area * l.total; simples += l.total; });
    var ord = com.slice().sort(function (a, b) { return b.total - a.total; });
    var secos = linhas.filter(function (l) { return l.diasSem !== null; }).sort(function (a, b) { return b.diasSem - a.diasSem; });
    return {
      n: linhas.length, comValor: com.length,
      media: com.length ? r1(area > 0 ? soma / area : simples / com.length) : null,
      maior: ord[0] || null, menor: ord[ord.length - 1] || null,
      semChuva: com.filter(function (l) { return l.total < CHUVA_MIN; }).length,
      estimados: linhas.filter(function (l) { return l.estimado; }).length,
      maisSeco: secos[0] || null,
    };
  }

  /**
   * Pluviômetros da fazenda no período: { i, id, nome, total, diasChuva, semLeitura, ul, atrasoH, situacao
   * ('ok' | 'atrasado' | 'sem-leitura'), talhoes (códigos pelo vínculo da ZEUS), estimados (códigos por estimativa) }.
   */
  function picsNoPeriodo(faz, per, linhas) {
    var ref = faz.ultimaLeitura ? Date.parse(faz.ultimaLeitura + ':00Z') : NaN;
    return faz.pics.map(function (p, i) {
      var r = resumoDaSerie(p.mm, per.i0, per.i1, faz.ultimoDia);
      var lido = p.ul ? Date.parse(p.ul + ':00Z') : NaN;
      var atraso = isFinite(ref) && isFinite(lido) ? Math.max(0, Math.round((ref - lido) / 3600000)) : null;
      var meus = (linhas || []).filter(function (l) { return l.vinculo.pics.indexOf(i) >= 0; });
      return {
        i: i, id: p.id, nome: p.nome, nomeZeus: p.nomeZeus, lat: p.lat, lon: p.lon, total: r.total, diasChuva: r.diasChuva, semLeitura: r.semLeitura, ul: p.ul, atrasoH: atraso,
        situacao: !p.ul || r.total === null ? 'sem-leitura' : (atraso !== null && atraso > ATRASO_HORAS ? 'atrasado' : 'ok'),
        talhoes: meus.filter(function (l) { return !l.estimado; }).map(function (l) { return l.codigo; }),
        estimados: meus.filter(function (l) { return l.estimado; }).map(function (l) { return l.codigo; }),
      };
    });
  }

  /** Ordena as linhas por uma coluna ('codigo', 'total', 'diasChuva', 'ultima', 'diasSem', 'area'); sem valor vai para o fim. */
  function ordenar(linhas, coluna, desc) {
    var valor = {
      codigo: function (l) { return l.codigo; },
      total: function (l) { return l.total; },
      diasChuva: function (l) { return l.total === null ? null : l.diasChuva; },
      ultima: function (l) { return l.ultima ? l.ultima.i : null; },
      diasSem: function (l) { return l.diasSem; },
      area: function (l) { return l.area; },
    }[coluna] || function (l) { return l.codigo; };
    return linhas.slice().sort(function (a, b) {
      var x = valor(a), y = valor(b);
      var semX = x === null || x === undefined, semY = y === null || y === undefined;
      var c = 0;
      if (semX !== semY) return semX ? 1 : -1;
      if (!semX) c = typeof x === 'string' ? x.localeCompare(y, 'pt-BR', { numeric: true }) : x - y;
      return (desc ? -c : c) || String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true });
    });
  }

  /** Unidade do PIMS que corresponde ao nome de uma fazenda do COA WEB ("Fazenda Três Flechas" → "TRES FLECHAS"). */
  function unidadeDaFazenda(nomeFazenda, unidades) {
    var alvo = semAcento(nomeFazenda).replace(/^(FAZENDA|FAZ\.?)\s+/, '');
    if (!alvo) return null;
    return (unidades || []).find(function (u) { return semAcento(u) === alvo; }) || null;
  }

  return {
    CHUVA_MIN: CHUVA_MIN, ATRASO_HORAS: ATRASO_HORAS, PERIODOS: PERIODOS, LIMITES_DIA: LIMITES_DIA, CORES_CHUVA: CORES_CHUVA, CORES_SECA: CORES_SECA, LIMITES_SECA: LIMITES_SECA, COR_SEM_DADO: COR_SEM_DADO,
    somarDias: somarDias, difDias: difDias, fmtMm: fmtMm, fmtDia: fmtDia, fmtLeitura: fmtLeitura, semAcento: semAcento,
    nomeDoPic: nomeDoPic, prepararFazenda: prepararFazenda, paisDoCodigo: paisDoCodigo, distKm: distKm, vinculoDoTalhao: vinculoDoTalhao,
    serieDoTalhao: serieDoTalhao, resumoDaSerie: resumoDaSerie, periodo: periodo,
    limitesChuva: limitesChuva, classeDe: classeDe, rotulosClasses: rotulosClasses, tintaSobre: tintaSobre,
    poligonos: poligonos, caixaGeom: caixaGeom, juntarCaixas: juntarCaixas, centroGeom: centroGeom, projetor: projetor, caminhoSvg: caminhoSvg,
    caixaProjetada: caixaProjetada, vistaQueEnquadra: vistaQueEnquadra,
    linhasDosTalhoes: linhasDosTalhoes, textoDoVinculo: textoDoVinculo, resumoDaFazenda: resumoDaFazenda, picsNoPeriodo: picsNoPeriodo, ordenar: ordenar,
    unidadeDaFazenda: unidadeDaFazenda,
  };
});
