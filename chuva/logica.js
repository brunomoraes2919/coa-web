/* =====================================================================
   Chuva por talhão — lógica (sem DOM)
   A chuva de cada talhão vem pronta da tabela stg_field_data da ZEUS (a base do relatório Power BI): o
   servidor grava em chuva_talhao a chuva diária de cada talhão, os dias que a tabela tem e os ciclos do PIMS
   (do plantio à colheita). Aqui ficam o período, as somas, as faixas de cor e a geometria do mapa.
   Usado pelo app.js no navegador e pelos testes em modulos/chuva/testes/.
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
  function r2(v) { return Math.round(v * 100) / 100; }
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
   */
  function nomeDoPic(nome, unidade, comParenteses) {
    var n = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!comParenteses) n = n.replace(/\([^)]*\)/g, ' ');
    var palavras = semAcento(unidade).split(' ').filter(Boolean);
    if (palavras.length) n = n.replace(new RegExp('(^|[\\s_.-])' + palavras.join('[\\s_.-]+') + '(?=$|[\\s_.-])', 'ig'), '$1');
    n = n.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return n || String(nome || '').trim();
  }

  /** 'n' ou 'n:mm' separados por vírgula → função chamada com (dia, mm) para cada dia válido da janela. */
  function lerDias(texto, dias, cada) {
    String(texto || '').split(',').forEach(function (parte) {
      if (!parte) return;
      var i = parte.indexOf(':');
      var n = Number(i < 0 ? parte : parte.slice(0, i));
      var v = i < 0 ? 0 : Number(parte.slice(i + 1));
      if (!Number.isInteger(n) || n < 0 || n >= dias || !isFinite(v) || v < 0) return;
      cada(n, v);
    });
  }

  /**
   * Talhão dividido: no PIMS e nos limites o 019 pode virar 019A e 019B, mas continua o mesmo talhão.
   * Devolve o código sem a letra da divisão ('019A' → '019'). Só vale número + UMA letra: '019PESQ', '01PIVO'
   * e 'M1A' são outros talhões e ficam como estão.
   */
  function talhaoBase(codigo) {
    var c = String(codigo === null || codigo === undefined ? '' : codigo).trim().toUpperCase();
    var m = /^(\d+)[A-Z]$/.exec(c);
    return m ? m[1] : c;
  }

  /**
   * A chuva de cada família de talhões ({ base: { serie, de: [códigos] } }): todos os pedaços mostram a do
   * talhão sem letra. Se a tabela da ZEUS não tem o talhão sem letra, vale a média, dia a dia, dos pedaços que
   * ela tem (dia sem dado em todos continua sem dado).
   */
  function chuvaDasFamilias(talhoes, dias) {
    var grupos = {};
    Object.keys(talhoes).forEach(function (codigo) { var b = talhaoBase(codigo); (grupos[b] = grupos[b] || []).push(codigo); });
    var familias = {};
    Object.keys(grupos).forEach(function (b) {
      var codigos = grupos[b].sort();
      var inteiro = codigos.filter(function (c) { return c.trim().toUpperCase() === b; })[0];
      if (inteiro !== undefined || codigos.length === 1) {
        var dono = inteiro !== undefined ? inteiro : codigos[0];
        familias[b] = { serie: talhoes[dono], de: [dono] };
        return;
      }
      var serie = new Array(dias).fill(null);
      for (var d = 0; d < dias; d++) {
        var soma = 0, n = 0;
        codigos.forEach(function (c) { var v = talhoes[c][d]; if (v !== null && v !== undefined) { soma += v; n++; } });
        if (n) serie[d] = r2(soma / n);
      }
      familias[b] = { serie: serie, de: codigos };
    });
    return familias;
  }

  /** Primeiro e último dia ('YYYY-MM-DD') de uma safra do PIMS ('SAFRA 2025/2026' → 01/09/2025 a 31/08/2026). */
  function limitesDaSafra(nome) {
    var m = /(\d{4})\s*\/\s*(\d{4})/.exec(String(nome || ''));
    return m ? { de: m[1] + '-09-01', ate: m[2] + '-08-31' } : null;
  }

  /**
   * Linha de chuva_talhao pronta para a conta:
   *   talhoes { código: série } — um valor por dia da janela (null = dia sem dado na tabela da ZEUS);
   *   familias { código sem a letra da divisão: { serie, de } } — a chuva que vale para o talhão e os pedaços
   *     dele (019, 019A e 019B mostram a mesma; ver chuvaDasFamilias);
   *   fim / hoje — o último dia com chuva por talhão: os períodos terminam nele (a tabela chega com atraso);
   *   ciclos [{ i, safra, periodo, de, ate, talhoes }] — do PIMS, já cortados na safra deles (como no Power BI)
   *     e só os que têm algum dia dentro do que a tabela já tem;
   *   safras [{ ano, nome, de, ate }] — as safras (setembro a agosto) com algum dia com dado;
   *   pics — a chuva medida nos pluviômetros (mm por dia; null = sem leitura), como referência.
   */
  function prepararFazenda(linha) {
    var dias = Math.max(0, Number(linha.dias) || 0);

    // os dias que a tabela da ZEUS tem para a fazenda
    var temDado = new Array(dias).fill(false);
    String(linha.lidos || '').split(',').forEach(function (faixa) {
      if (!faixa) return;
      var p = faixa.split('-');
      var a = Number(p[0]), b = p.length > 1 ? Number(p[1]) : a;
      if (!Number.isInteger(a) || !Number.isInteger(b)) return;
      for (var d = Math.max(0, a); d <= Math.min(dias - 1, b); d++) temDado[d] = true;
    });

    var talhoes = {};
    var fim = -1;
    Object.keys(linha.talhoes || {}).forEach(function (codigo) {
      var t = linha.talhoes[codigo] || {};
      var de = Number(t.de), ate = Number(t.ate);
      if (!Number.isInteger(de) || !Number.isInteger(ate)) return;
      var serie = new Array(dias).fill(null);
      for (var d = Math.max(0, de); d <= Math.min(dias - 1, ate); d++) { if (temDado[d]) { serie[d] = 0; if (d > fim) fim = d; } }
      lerDias(t.d, dias, function (n, v) { if (serie[n] !== null) serie[n] = v; });
      talhoes[codigo] = serie;
    });

    var ultimoPic = -1;
    var pics = (linha.pics || []).map(function (p) {
      var mm = new Array(dias).fill(null);
      lerDias(p.d, dias, function (n, v) { mm[n] = v; if (n > ultimoPic) ultimoPic = n; });
      return {
        id: String(p.id), nome: nomeDoPic(p.n, linha.unidade), nomeZeus: String(p.n || ''), ul: p.ul || null, mm: mm,
        lat: typeof p.lat === 'number' ? p.lat : null, lon: typeof p.lon === 'number' ? p.lon : null,
      };
    });
    // nome curto repetido na fazenda: esses ficam com o trecho entre parênteses, que é o que os distingue
    var vezes = {};
    pics.forEach(function (p) { vezes[p.nome] = (vezes[p.nome] || 0) + 1; });
    pics.forEach(function (p) { if (vezes[p.nome] > 1) p.nome = nomeDoPic(p.nomeZeus, linha.unidade, true); });

    var temTalhoes = fim >= 0;
    if (!temTalhoes) fim = ultimoPic >= 0 ? ultimoPic : Math.max(0, dias - 1);
    var hoje = somarDias(linha.inicio, fim);

    var ciclos = [];
    (linha.ciclos || []).forEach(function (c) {
      var safra = limitesDaSafra(c.s);
      if (!safra || !c.de || !c.ate) return;
      // como no Power BI: a chuva do ciclo é a que cai entre o plantio e a colheita E dentro da safra dele
      var de = c.de > safra.de ? c.de : safra.de, ate = c.ate < safra.ate ? c.ate : safra.ate;
      if (de > ate || de > hoje || ate < linha.inicio) return;
      ciclos.push({ i: ciclos.length, safra: c.s, periodo: c.p, de: de, ate: ate, talhoes: (c.t || []).slice() });
    });

    var safras = [];
    for (var ano = +hoje.slice(0, 4) - (+hoje.slice(5, 7) >= 9 ? 0 : 1); ano >= +String(linha.inicio).slice(0, 4) - 1; ano--) {
      var s = { ano: ano, nome: 'Safra ' + ano + '/' + (ano + 1), de: ano + '-09-01', ate: (ano + 1) + '-08-31' };
      if (s.ate >= linha.inicio && s.de <= hoje) safras.push(s);
    }

    return {
      unidade: linha.unidade, inicio: linha.inicio, dias: dias, fim: fim, hoje: hoje, ultimoDia: fim, temTalhoes: temTalhoes,
      geradoEm: linha.gerado_em || null, ultimaLeitura: linha.ultima_leitura || null,
      talhoes: talhoes, familias: chuvaDasFamilias(talhoes, dias), ciclos: ciclos, safras: safras, pics: pics, vinculos: linha.vinculos || {},
    };
  }

  /**
   * Números de uma série diária no período [i0, i1] (índices de dia da janela):
   * total (null = nenhum dia com dado), diasChuva (dias com 1 mm ou mais), maior { i, mm }, semLeitura (dias
   * sem dado), ultima { i, mm } = último dia com chuva até o fim do período (procura na janela toda) e
   * diasSem = dias corridos desde essa chuva (null = não choveu na janela).
   */
  function resumoDaSerie(serie, i0, i1, ultimoDia) {
    var total = 0, lidos = 0, diasChuva = 0, maior = null;
    for (var d = i0; d <= i1; d++) {
      var v = serie ? serie[d] : null;
      if (v === null || v === undefined) continue;
      lidos++;
      total += v;
      if (v >= CHUVA_MIN) { diasChuva++; if (!maior || v > maior.mm) maior = { i: d, mm: r2(v) }; }
    }
    var ref = Math.min(i1, ultimoDia === undefined || ultimoDia < 0 ? i1 : ultimoDia);
    var ultima = null;
    for (var k = ref; serie && k >= 0; k--) { if (serie[k] !== null && serie[k] !== undefined && serie[k] >= CHUVA_MIN) { ultima = { i: k, mm: r2(serie[k]) }; break; } }
    return {
      total: lidos ? r2(total) : null, diasChuva: diasChuva, maior: maior, semLeitura: (i1 - i0 + 1) - lidos,
      ultima: ultima, diasSem: ultima ? ref - ultima.i : null,
    };
  }

  // ---------------------------- período ----------------------------
  /**
   * Opções do campo Período, em grupos: últimos dias, safras (setembro a agosto), ciclos da cultura no PIMS
   * (do plantio à colheita, como no Power BI) e datas livres. Devolve [{ grupo, itens: [[valor, texto]] }].
   */
  function opcoesDePeriodo(faz) {
    var grupos = [{
      grupo: 'Últimos dias com dado',
      itens: [['1', 'Último dia'], ['7', 'Últimos 7 dias'], ['15', 'Últimos 15 dias'], ['30', 'Últimos 30 dias'], ['mes', 'Mês do último dia']],
    }];
    if (faz.safras.length) grupos.push({ grupo: 'Safra (setembro a agosto)', itens: faz.safras.map(function (s) { return ['safra:' + s.ano, s.nome]; }) });
    if (faz.ciclos.length) {
      grupos.push({
        grupo: 'Ciclo da cultura (plantio à colheita)',
        itens: faz.ciclos.map(function (c) { return ['ciclo:' + c.i, c.periodo + ' · ' + fmtDia(c.de, true) + ' a ' + fmtDia(c.ate, true)]; }),
      });
    }
    grupos.push({ grupo: 'Outro período', itens: [['livre', 'Escolher as datas']] });
    return grupos;
  }

  /**
   * Período escolhido em índices de dia da janela, sempre dentro dela e terminando, no máximo, no último dia
   * com dado: { i0, i1, de, ate, dias, talhoes }. Um número ('7') = essa quantidade de dias até o último com
   * dado; 'safra:2025' = a safra 2025/2026; 'ciclo:n' = o ciclo n da fazenda (aí `talhoes` traz os códigos
   * do ciclo); 'livre' usa `de` e `ate` ('YYYY-MM-DD'). Valor desconhecido cai nos últimos 7 dias.
   */
  function periodo(tipo, faz, de, ate) {
    var fim = faz.fim;
    var i0, i1 = fim, talhoes = null;
    var t = String(tipo || '');
    var faixa = function (a, b) { i0 = difDias(faz.inicio, a); i1 = difDias(faz.inicio, b); };
    if (t === 'mes') i0 = difDias(faz.inicio, faz.hoje.slice(0, 8) + '01');
    else if (t.indexOf('safra:') === 0 && faz.safras.some(function (s) { return String(s.ano) === t.slice(6); })) {
      var s = faz.safras.filter(function (x) { return String(x.ano) === t.slice(6); })[0];
      faixa(s.de, s.ate);
    } else if (t.indexOf('ciclo:') === 0 && faz.ciclos[Number(t.slice(6))]) {
      var c = faz.ciclos[Number(t.slice(6))];
      faixa(c.de, c.ate);
      talhoes = c.talhoes;
    } else if (t === 'livre') {
      var a = de ? difDias(faz.inicio, de) : fim, b = ate ? difDias(faz.inicio, ate) : fim;
      i0 = Math.min(a, b); i1 = Math.max(a, b);
    } else i0 = fim - ((parseInt(t, 10) || 7) - 1);
    i0 = Math.min(fim, Math.max(0, i0));
    i1 = Math.min(fim, Math.max(i0, i1));
    return { i0: i0, i1: i1, de: somarDias(faz.inicio, i0), ate: somarDias(faz.inicio, i1), dias: i1 - i0 + 1, talhoes: talhoes };
  }

  // ---------------------------- faixas de cor ----------------------------
  /* Chuva de UM dia: as faixas e as cores do relatório Power BI (limite de cima incluído na faixa). */
  var FAIXAS_DIA = [
    { ate: 0.5, cor: '#C9E8FF', rotulo: '0,01 a 0,5' }, { ate: 5, cor: '#A8D4F5', rotulo: '0,51 a 5' },
    { ate: 10, cor: '#7EBFEE', rotulo: '5,01 a 10' }, { ate: 20, cor: '#54A8E5', rotulo: '10,01 a 20' },
    { ate: 30, cor: '#2E8FD8', rotulo: '20,01 a 30' }, { ate: 40, cor: '#1677C4', rotulo: '30,01 a 40' },
    { ate: 50, cor: '#0F62AF', rotulo: '40,01 a 50' }, { ate: 60, cor: '#0A4F99', rotulo: '50,01 a 60' },
    { ate: 70, cor: '#073D83', rotulo: '60,01 a 70' }, { ate: 80, cor: '#052D6E', rotulo: '70,01 a 80' },
    { ate: 90, cor: '#031F58', rotulo: '80,01 a 90' }, { ate: 100, cor: '#021443', rotulo: '90,01 a 100' },
    { ate: Infinity, cor: '#010A2E', rotulo: 'Acima de 100' },
  ];
  var COR_SEM_CHUVA = '#FFFFFF';
  var COR_SEM_DADO = '#E4E7E3';
  /* Chuva somada de vários dias: os mesmos azuis, em sete degraus (o primeiro é "menos de 1 mm"). */
  var CORES_PERIODO = [COR_SEM_CHUVA, '#C9E8FF', '#A8D4F5', '#7EBFEE', '#54A8E5', '#2E8FD8', '#0F62AF', '#052D6E'];
  /* Dias sem chuva: mais dias = mais escuro (a seca é o que chama atenção). */
  var CORES_SECA = ['#F1F5EF', '#FAEBCB', '#F1D08C', '#E2AD4E', '#C6831F', '#96590B', '#673A04'];
  var LIMITES_SECA = [3, 6, 11, 16, 21, 31];
  var PASSOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

  /**
   * Limites das classes da chuva somada (mm), tirados dos próprios valores: a primeira classe é sempre
   * "menos de 1 mm" e as outras seis sobem em passos redondos do menor ao maior valor. Assim a diferença
   * entre os talhões aparece tanto numa semana quanto numa safra inteira.
   */
  function limitesChuva(valores) {
    var v = (valores || []).filter(function (x) { return x !== null && x !== undefined && isFinite(x) && x >= CHUVA_MIN; });
    if (!v.length) return [1, 5, 10, 20, 30, 50, 75];
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
  /** Cor da chuva de um dia pelas faixas do Power BI: sem dado, sem chuva (0) ou a faixa do valor. */
  function corDoDia(mm) {
    if (mm === null || mm === undefined || !isFinite(mm)) return COR_SEM_DADO;
    if (mm <= 0) return COR_SEM_CHUVA;
    for (var i = 0; i < FAIXAS_DIA.length; i++) { if (mm <= FAIXAS_DIA[i].ate) return FAIXAS_DIA[i].cor; }
    return FAIXAS_DIA[FAIXAS_DIA.length - 1].cor;
  }
  /**
   * Régua de cores do mapa para o período: um dia só usa as faixas do Power BI; vários dias, sete degraus
   * tirados dos valores. Devolve { titulo, cores, rotulos, cor(valor) }.
   */
  function escalaDoPeriodo(nDias, valores) {
    if (nDias <= 1) {
      return {
        titulo: 'Chuva no dia (mm)', cores: [COR_SEM_CHUVA].concat(FAIXAS_DIA.map(function (f) { return f.cor; })),
        rotulos: ['Sem chuva'].concat(FAIXAS_DIA.map(function (f) { return f.rotulo; })), cor: corDoDia,
      };
    }
    var limites = limitesChuva(valores);
    return {
      titulo: 'Chuva no período (mm)', cores: CORES_PERIODO, rotulos: rotulosClasses(limites),
      cor: function (v) { var c = classeDe(v, limites); return c < 0 ? COR_SEM_DADO : CORES_PERIODO[c]; },
    };
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
  /** Projeção plana em metros em torno do centro de uma caixa: devolve f(lon, lat) → [x, y] (y cresce para o sul). */
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
   * Linhas da tabela por talhão. `talhoes` = [{ codigo, nome, area, centro }] (os limites do mapa); devolve, na
   * mesma ordem, { codigo, nome, area, serie, semDado (o talhão não está na tabela da ZEUS), foraDoCiclo (o
   * período é um ciclo e o talhão não faz parte dele), total, diasChuva, maior, ultima, diasSem, semLeitura }.
   * Talhão dividido (019, 019A, 019B) é um talhão só: os pedaços mostram a mesma chuva e entram no ciclo se
   * algum deles estiver nele. `chuvaDe` = os códigos da tabela de onde veio a chuva, quando não é o do próprio
   * talhão (null = é a dele).
   */
  function linhasDosTalhoes(talhoes, faz, per) {
    var doCiclo = null;
    if (per.talhoes) { doCiclo = {}; per.talhoes.forEach(function (c) { doCiclo[talhaoBase(c)] = true; }); }
    var familias = faz.familias || chuvaDasFamilias(faz.talhoes, faz.dias);
    return talhoes.map(function (t) {
      var base = talhaoBase(t.codigo);
      var familia = familias[base] || null;
      var serie = familia ? familia.serie : null;
      var r = resumoDaSerie(serie, per.i0, per.i1, faz.ultimoDia);
      var dele = !!familia && familia.de.length === 1 && familia.de[0].trim().toUpperCase() === String(t.codigo).trim().toUpperCase();
      return {
        codigo: t.codigo, nome: t.nome || t.codigo, area: t.area || 0, serie: serie, semDado: !serie,
        chuvaDe: familia && !dele ? familia.de.slice() : null,
        foraDoCiclo: !!doCiclo && !doCiclo[base],
        total: r.total, diasChuva: r.diasChuva, maior: r.maior, ultima: r.ultima, diasSem: r.diasSem, semLeitura: r.semLeitura,
      };
    });
  }

  /** Resumo da fazenda no período: média ponderada pela área, maior, menor, talhões sem chuva e sem dado. */
  function resumoDaFazenda(linhas) {
    var validas = linhas.filter(function (l) { return !l.foraDoCiclo; });
    var com = validas.filter(function (l) { return l.total !== null; });
    var area = 0, soma = 0, simples = 0;
    com.forEach(function (l) { area += l.area; soma += l.area * l.total; simples += l.total; });
    var ord = com.slice().sort(function (a, b) { return b.total - a.total; });
    var secos = validas.filter(function (l) { return l.diasSem !== null; }).sort(function (a, b) { return b.diasSem - a.diasSem; });
    return {
      n: validas.length, comValor: com.length,
      media: com.length ? r1(area > 0 ? soma / area : simples / com.length) : null,
      maior: ord[0] || null, menor: ord[ord.length - 1] || null,
      semChuva: com.filter(function (l) { return l.total < CHUVA_MIN; }).length,
      semDado: validas.filter(function (l) { return l.semDado; }).length,
      maisSeco: secos[0] || null,
    };
  }

  /**
   * Pluviômetros da fazenda no período (a chuva MEDIDA, para comparar com a do talhão): { i, id, nome, total,
   * diasChuva, semLeitura, ul, atrasoH, situacao ('ok' | 'atrasado' | 'sem-leitura'), talhoes (códigos ligados a
   * ele no cadastro da ZEUS) }.
   */
  function picsNoPeriodo(faz, per) {
    var ref = faz.ultimaLeitura ? Date.parse(faz.ultimaLeitura + ':00Z') : NaN;
    var ligados = faz.pics.map(function () { return []; });
    Object.keys(faz.vinculos).forEach(function (codigo) {
      (faz.vinculos[codigo] || []).forEach(function (i) { if (ligados[i]) ligados[i].push(codigo); });
    });
    return faz.pics.map(function (p, i) {
      var r = resumoDaSerie(p.mm, per.i0, per.i1, faz.ultimoDia);
      var lido = p.ul ? Date.parse(p.ul + ':00Z') : NaN;
      var atraso = isFinite(ref) && isFinite(lido) ? Math.max(0, Math.round((ref - lido) / 3600000)) : null;
      return {
        i: i, id: p.id, nome: p.nome, nomeZeus: p.nomeZeus, lat: p.lat, lon: p.lon,
        total: r.total === null ? null : r1(r.total), diasChuva: r.diasChuva, semLeitura: r.semLeitura, ul: p.ul, atrasoH: atraso,
        situacao: !p.ul ? 'sem-leitura' : (atraso !== null && atraso > ATRASO_HORAS ? 'atrasado' : 'ok'),
        talhoes: ligados[i],
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
    CHUVA_MIN: CHUVA_MIN, ATRASO_HORAS: ATRASO_HORAS, FAIXAS_DIA: FAIXAS_DIA, COR_SEM_CHUVA: COR_SEM_CHUVA, COR_SEM_DADO: COR_SEM_DADO,
    CORES_PERIODO: CORES_PERIODO, CORES_SECA: CORES_SECA, LIMITES_SECA: LIMITES_SECA,
    somarDias: somarDias, difDias: difDias, fmtMm: fmtMm, fmtDia: fmtDia, fmtLeitura: fmtLeitura, semAcento: semAcento,
    nomeDoPic: nomeDoPic, limitesDaSafra: limitesDaSafra, talhaoBase: talhaoBase, prepararFazenda: prepararFazenda, resumoDaSerie: resumoDaSerie,
    opcoesDePeriodo: opcoesDePeriodo, periodo: periodo,
    limitesChuva: limitesChuva, classeDe: classeDe, rotulosClasses: rotulosClasses, corDoDia: corDoDia, escalaDoPeriodo: escalaDoPeriodo, tintaSobre: tintaSobre,
    poligonos: poligonos, caixaGeom: caixaGeom, juntarCaixas: juntarCaixas, centroGeom: centroGeom, projetor: projetor, caminhoSvg: caminhoSvg,
    caixaProjetada: caixaProjetada, vistaQueEnquadra: vistaQueEnquadra,
    linhasDosTalhoes: linhasDosTalhoes, resumoDaFazenda: resumoDaFazenda, picsNoPeriodo: picsNoPeriodo, ordenar: ordenar,
    unidadeDaFazenda: unidadeDaFazenda,
  };
});
