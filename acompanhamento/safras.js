/* =====================================================================
   Acompanhamento Operacional — aba "Safras"
   Relatório de uma fazenda: hectares por dia da safra atual e das 3 anteriores
   (mesma cultura), com a chuva do dia (mancha azul, eixo da direita) e o comparativo acumulado pela
   data do ano. Exporta o relatório inteiro em PNG ou PDF.
   Usa o núcleo do app.js (window.AcompNucleo), que chama AcompSafras.render().
===================================================================== */
(function () {
  'use strict';

  // cores fixas por posição da safra (validadas: scripts/validate_palette.js da skill dataviz)
  // atual = verde da marca (destaque); 1, 2 e 3 anos antes = laranja, violeta, magenta
  var COR_SAFRA = ['#0C5A50', '#eb6834', '#4a3aa7', '#e87ba4'];
  var COR_CHUVA = '#2a78d6';
    var CHUVA_MIN = 1;          // mm: dia com chuva (contagem de dias no resumo)
  var MARGEM_DIAS = 4;        // dias antes do 1º início e depois do último fim, no eixo comum
  var MAX_DIAS = 200;

  var N = null;               // núcleo (helpers e dados do app.js)
  var R = null;               // último relatório calculado
  var modoComp = 'ha';        // comparativo em hectares ou % da área
  var jsPdfCarregando = null;

  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------------
  // Dados
  // ------------------------------------------------------------------
  /** Safra atual + até 3 anteriores da mesma cultura que têm dados (mais recente primeiro). */
  function safrasDoRelatorio(s) {
    var c = N.culturaDaSafra(s), ano = N.anoDaSafra(s), vistas = {};
    (N.dados().historico || []).forEach(function (h) { vistas[h.s] = true; });
    var ant = Object.keys(vistas).map(function (n) { return { nome: n, anos: ano - N.anoDaSafra(n) }; })
      .filter(function (x) { return x.anos >= 1 && x.anos <= 3 && N.culturaDaSafra(x.nome) === c; })
      .sort(function (a, b) { return a.anos - b.anos || (a.nome < b.nome ? -1 : 1); });
    // um nome por ano (se o PIMS tiver dois nomes no mesmo ano, fica o primeiro)
    var porAno = {};
    ant.forEach(function (x) { if (!porAno[x.anos]) porAno[x.anos] = x; });
    return [{ nome: s, anos: 0 }].concat([1, 2, 3].map(function (a) { return porAno[a]; }).filter(Boolean));
  }

  /** Mesmo dia e mês, `anos` depois (29/02 vira 28/02). */
  function anosDepois(d, anos) {
    var r = new Date(d.getFullYear() + anos, d.getMonth(), d.getDate());
    if (r.getMonth() !== d.getMonth()) r = new Date(d.getFullYear() + anos, d.getMonth() + 1, 0);
    return r;
  }

  function calcularSafra(u, o, x, chuvaU) {
    var D = N.dados(), pd = {};
    if (x.anos === 0) {
      D.apontamentos.forEach(function (a) { if (a.u === u && a.s === x.nome && a.op === o && !a.rep) pd[a.d] = (pd[a.d] || 0) + a.a; });
    } else {
      (D.historico || []).forEach(function (h) { if (h.u === u && h.s === x.nome && h.op === o) pd[h.d] = (pd[h.d] || 0) + h.a; });
    }
    var dias = Object.keys(pd).filter(function (k) { return pd[k] > 0; }).sort();
    var r = { nome: x.nome, anos: x.anos, cor: COR_SAFRA[x.anos] || COR_SAFRA[3], porDia: pd, dias: dias, total: 0 };
    dias.forEach(function (k) { r.total += pd[k]; });
    if (!dias.length) return r;
    r.ini = N.iso(dias[0]);
    r.ult = N.iso(dias[dias.length - 1]);
    if (x.anos === 0) {
      var m = N.calcula([u], x.nome, o);
      r.areaTotal = m.areaTotal; r.concluida = m.restante === 0; r.pct = m.pct; r.previsao = m.previsao;
    } else r.concluida = true;
    r.fim = r.concluida ? r.ult : null;
    r.diasOp = dias.length;
    r.duracao = N.dif(r.ini, r.fim || N.hoje()) + 1;
    r.media = r.total / r.diasOp;
    r.pico = dias.reduce(function (p, k) { return pd[k] > p.a ? { d: N.iso(k), a: pd[k] } : p; }, { d: null, a: 0 });
    // chuva no período da operação (até hoje, se ainda em andamento)
    var ate = N.paraIso(r.fim || N.hoje()), de = dias[0];
    r.chuva = 0; r.diasChuva = 0;
    Object.keys(chuvaU).forEach(function (k) { if (k >= de && k <= ate) { r.chuva += chuvaU[k]; if (chuvaU[k] >= CHUVA_MIN) r.diasChuva++; } });
    return r;
  }

  function montar(u, s, o) {
    var D = N.dados(), chuvaU = {};
    (D.chuva || []).forEach(function (c) { if (c.u === u) chuvaU[c.d] = (chuvaU[c.d] || 0) + c.a; });
    var safras = safrasDoRelatorio(s).map(function (x) { return calcularSafra(u, o, x, chuvaU); });
    // eixo comum: datas do ano da safra atual (as anteriores são deslocadas `anos` para frente)
    var ini = null, fim = null, h = N.hoje();
    safras.forEach(function (x) {
      if (!x.ini) return;
      var a = anosDepois(x.ini, x.anos), b = anosDepois(x.fim || h, x.anos);
      if (!ini || a < ini) ini = a;
      if (!fim || b > fim) fim = b;
    });
    var eixo = [];
    if (ini) {
      ini = new Date(+ini - MARGEM_DIAS * N.DIA); fim = new Date(+fim + MARGEM_DIAS * N.DIA);
      for (var t = +ini; t <= +fim && eixo.length < MAX_DIAS; t += N.DIA) { var d = new Date(t); eixo.push(new Date(d.getFullYear(), d.getMonth(), d.getDate())); }
    }
    // mesma escala (ha e mm) nos gráficos das safras, para comparar de cima para baixo
    var maxHa = 1, maxMm = 10;
    safras.forEach(function (x) {
      eixo.forEach(function (d) {
        var k = N.paraIso(N.anosAntes(d, x.anos));
        if ((x.porDia[k] || 0) > maxHa) maxHa = x.porDia[k];
        if ((chuvaU[k] || 0) > maxMm) maxMm = chuvaU[k];
      });
    });
    return { u: u, s: s, o: o, safras: safras, eixo: eixo, chuvaU: chuvaU, temChuva: Object.keys(chuvaU).length > 0, maxHa: maxHa, maxMm: maxMm };
  }

  // ------------------------------------------------------------------
  // Textos
  // ------------------------------------------------------------------
  function op(o) { return o === 'PLANTIO' ? 'plantio' : 'colheita'; }
  function dataCurta(d) { return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : '—'; }
  function dataLonga(d) { return d ? d.toLocaleDateString('pt-BR') : '—'; }
  /** "Início 18/09/2025 · Fim 15/11/2025 · 59 dias · 9.844 ha · 167 ha/dia · Pico 612 ha em 02/10 · Chuva 320 mm" */
  function itensResumo(x, o) {
    if (!x.ini) return [['Sem apontamentos de ' + op(o), '']];
    return [
      ['Início', dataLonga(x.ini)],
      [x.fim ? 'Fim' : 'Último dia', dataLonga(x.fim || x.ult) + (x.fim ? '' : ' (em andamento)')],
      ['Duração', N.fmtN(x.duracao) + ' dias'],
      ['Área', N.fmtN(x.total) + ' ha'],
      ['Média', N.fmtN(x.media) + ' ha/dia'],
      ['Pico', N.fmtN(x.pico.a) + ' ha em ' + dataCurta(x.pico.d)],
      ['Chuva', N.fmtN(x.chuva) + ' mm' + (x.diasChuva ? ' em ' + x.diasChuva + ' dias' : '')]
    ];
  }

  // ------------------------------------------------------------------
  // Gráficos (as mesmas opções servem para a página e para a exportação; k = escala)
  // ------------------------------------------------------------------
  /** Rótulos do eixo de datas num intervalo fixo (a cada 7 dias; 3 em períodos curtos), a partir do 1º dia. */
  function passoDatas(n) { return n <= 30 ? 3 : 7; }
  function eixoDatas(cats, k, boundaryGap) {
    var passo = passoDatas(cats.length), mostra = function (i) { return i % passo === 0; };
    return Object.assign({}, N.eixoX, { type: 'category', boundaryGap: boundaryGap, data: cats.map(dataCurta),
      axisTick: { show: true, interval: mostra, lineStyle: { color: N.COR.linha, width: k } },
      axisLabel: { color: N.COR.suave, fontSize: 11 * k, interval: mostra, hideOverlap: false },
      axisLine: { lineStyle: { color: N.COR.linha, width: k } } });
  }

  /**
   * Hectares por dia (barras com o valor na vertical) e, ao fundo, a chuva do dia como uma mancha azul
   * no eixo da direita (mm).
   */
  function opcoesSafra(rel, x, k) {
    k = k || 1;
    var cats = rel.eixo, idxDe = {};
    var datasReais = cats.map(function (d) { return N.anosAntes(d, x.anos); });
    datasReais.forEach(function (d, i) { idxDe[N.paraIso(d)] = i; });
    var ha = datasReais.map(function (d) { var v = x.porDia[N.paraIso(d)]; return v ? Math.round(v) : null; });
    var mm = datasReais.map(function (d) { var v = rel.chuvaU[N.paraIso(d)]; return v ? Math.round(v * 10) / 10 : 0; });
    var maxHa = rel.maxHa, maxMm = rel.maxMm;
    var marcas = [];
    if (x.ini) marcas.push({ xAxis: idxDe[N.paraIso(x.ini)], label: { formatter: 'Início ' + dataCurta(x.ini) } });
    if (x.fim) marcas.push({ xAxis: idxDe[N.paraIso(x.fim)], label: { formatter: 'Fim ' + dataCurta(x.fim) } });
    // o rótulo vertical fica menor quando as barras são muitas
    var fonteRotulo = (cats.length > 90 ? 8.5 : cats.length > 60 ? 9.5 : 10.5) * k;
    return N.opt({
      grid: { left: 48 * k, right: rel.temChuva ? 46 * k : 16 * k, top: 14 * k, bottom: 26 * k },
      tooltip: N.tt({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(12,90,80,.06)' } }, formatter: function (ps) {
        var i = ps[0].dataIndex, d = datasReais[i];
        return '<b>' + d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) + '</b>' +
          '<br>' + N.titulo(op(rel.o)) + ': <b>' + (ha[i] ? N.fmtN(ha[i]) + ' ha' : '—') + '</b>' +
          (rel.temChuva ? '<br><span style="color:' + COR_CHUVA + '">Chuva: ' + (mm[i] ? N.fmtN(mm[i], 1) + ' mm' : 'sem chuva') + '</span>' : '');
      } }),
      xAxis: eixoDatas(cats, k, true),
      yAxis: [
        Object.assign({}, N.eixoY, { type: 'value', max: Math.ceil(maxHa * 1.3),
          axisLabel: { color: N.COR.fraco, fontSize: 11 * k, formatter: function (v) { return v > maxHa * 1.05 ? '' : N.fmtN(v); } }, splitLine: { lineStyle: { color: N.COR.grade, width: k } } }),
        { type: 'value', show: rel.temChuva, position: 'right', min: 0, max: Math.ceil(maxMm * 1.25 / 20) * 20, interval: Math.ceil(maxMm * 1.25 / 20) * 5, splitLine: { show: false },
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: COR_CHUVA, fontSize: 10.5 * k, formatter: function (v) { return v ? v + ' mm' : ''; } } }
      ],
      series: [
        // chuva: mancha azul translúcida por cima das barras (eixo da direita), para ver a chuva nos dias de operação
        { name: 'Chuva (mm)', type: 'line', yAxisIndex: 1, data: mm, symbol: 'none', silent: true, z: 5, smooth: 0.25,
          lineStyle: { color: 'rgba(42,120,214,.85)', width: 2 * k },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(42,120,214,.28)' }, { offset: 1, color: 'rgba(42,120,214,.08)' }] } } },
        { name: N.nomeSafra(x.nome), type: 'bar', yAxisIndex: 0, data: ha, barCategoryGap: '18%', z: 3,
          itemStyle: { color: x.cor, borderRadius: [2 * k, 2 * k, 0, 0] },
          // área do dia em cada barra, na vertical
          label: { show: true, position: 'top', rotate: 90, align: 'left', verticalAlign: 'middle', distance: 4 * k,
            fontSize: fonteRotulo, color: N.COR.texto, textBorderColor: '#fff', textBorderWidth: 2 * k,
            formatter: function (p) { return p.value ? N.fmtN(p.value) : ''; } },
          markLine: x.ini ? { silent: true, symbol: 'none', lineStyle: { color: N.COR.fraco, type: [4 * k, 4 * k], width: k },
            label: { position: 'insideEndTop', color: N.COR.suave, fontSize: 10.5 * k }, data: marcas.concat(x.media ? [{ yAxis: Math.round(x.media), label: { position: 'insideEndTop', formatter: 'média ' + N.fmtN(x.media) + ' ha/dia' }, lineStyle: { color: x.cor, type: [6 * k, 4 * k], width: 1.2 * k } }] : []) } : undefined }
      ]
    });
  }

  function opcoesComparativo(rel, k) {
    k = k || 1;
    var cats = rel.eixo, hoje = N.paraIso(N.hoje());
    var series = rel.safras.filter(function (x) { return x.ini; }).map(function (x) {
      var base = x.anos === 0 && x.areaTotal ? x.areaTotal : x.total, soma = 0, fimD = x.fim || N.hoje(), dados = [];
      var ini = N.paraIso(x.ini), fimIso = N.paraIso(fimD);
      cats.forEach(function (d) {
        var dr = N.paraIso(N.anosAntes(d, x.anos));
        soma += x.porDia[dr] || 0;
        if (dr < ini) dados.push(null);
        else if (x.anos === 0 && dr > hoje) dados.push(null);
        else dados.push(modoComp === 'pct' ? Math.round(Math.min(100, soma / Math.max(1, base) * 1000) / 10) : Math.round(soma));
        void fimIso;
      });
      var atual = x.anos === 0;
      return { name: N.nomeSafra(x.nome), type: 'line', data: dados, symbol: 'none', smooth: false, z: atual ? 5 : 3,
        lineStyle: { color: x.cor, width: (atual ? 3.2 : 2) * k }, itemStyle: { color: x.cor },
        areaStyle: atual ? { color: 'rgba(12,90,80,.07)' } : undefined,
        // rótulo no fim só da safra atual (os finais das anteriores ficam próximos e se sobrepõem; estão nos cartões)
        endLabel: { show: atual, color: N.COR.texto, fontSize: 11 * k, fontWeight: atual ? 700 : 500, distance: 6 * k,
          formatter: function (p) { return N.nomeSafra(x.nome) + '  ' + (modoComp === 'pct' ? N.fmtN(p.value) + '%' : N.fmtN(p.value) + ' ha'); } },
        labelLayout: { moveOverlap: 'shiftY' },
        emphasis: { focus: 'series' } };
    });
    return N.opt({
      grid: { left: 56 * k, right: 150 * k, top: 18 * k, bottom: 28 * k },
      tooltip: N.tt({ trigger: 'axis', formatter: function (ps) {
        var s = '<b>' + ps[0].axisValueLabel + '</b>';
        ps.forEach(function (p) { if (p.value !== null && p.value !== undefined) s += '<br>' + p.marker + p.seriesName + ': <b>' + (modoComp === 'pct' ? N.fmtN(p.value) + '%' : N.fmtN(p.value) + ' ha') + '</b>'; });
        return s;
      } }),
      xAxis: eixoDatas(cats, k, false),
      yAxis: Object.assign({}, N.eixoY, { type: 'value', max: modoComp === 'pct' ? 100 : null,
        axisLabel: { color: N.COR.fraco, fontSize: 11 * k, formatter: function (v) { return modoComp === 'pct' ? v + '%' : N.fmtN(v); } }, splitLine: { lineStyle: { color: N.COR.grade, width: k } } }),
      series: series.concat([{ type: 'line', data: [], silent: true,
        markLine: { silent: true, symbol: 'none', lineStyle: { color: N.COR.fraco, type: [3 * k, 3 * k], width: k },
          label: { formatter: 'hoje', color: N.COR.suave, fontSize: 10.5 * k }, data: cats.some(function (d) { return N.paraIso(d) === hoje; }) ? [{ xAxis: dataCurta(N.hoje()) }] : [] } }])
    });
  }

  // ------------------------------------------------------------------
  // Página
  // ------------------------------------------------------------------
  function render(nucleo) {
    N = nucleo;
    var e = N.estado(), rel = R = montar(e.u, e.s, e.o);
    var atual = rel.safras[0];
    N.aplicarFundo($('rel-cab'), e.s);
    $('rel-eyebrow').textContent = 'Comparativo de safras · ' + N.titulo(op(e.o));
    $('rel-titulo').textContent = N.titulo(e.u);
    $('rel-sub').textContent = rel.safras.map(function (x) { return N.nomeSafra(x.nome); }).join('  ·  ') + (rel.temChuva ? '  ·  chuva: ZEUS' : '');

    var semDados = !atual.ini && rel.safras.every(function (x) { return !x.ini; });
    $('rel-vazio').hidden = !semDados;
    $('rel-conteudo').hidden = semDados;
    if (semDados) { $('rel-vazio').textContent = 'Ainda não há apontamentos de ' + op(e.o) + ' desta fazenda nas safras disponíveis.'; return; }

    // cartões de resumo
    $('rel-cards').innerHTML = rel.safras.map(function (x) {
      var itens = itensResumo(x, e.o);
      return '<article class="rel-card" style="--cor:' + x.cor + '">' +
        '<header><span class="rel-card-safra">' + N.esc(N.nomeSafra(x.nome)) + '</span>' + (x.anos === 0 ? '<span class="rel-selo">atual</span>' : '<span class="rel-selo neutro">' + x.anos + (x.anos === 1 ? ' ano' : ' anos') + ' antes</span>') + '</header>' +
        (x.ini
          ? '<div class="rel-card-periodo">' + dataCurta(x.ini) + ' → ' + (x.fim ? dataCurta(x.fim) : 'em andamento') + '</div>' +
            '<dl>' + itens.slice(2).map(function (it) { return '<div><dt>' + it[0] + '</dt><dd>' + N.esc(it[1]) + '</dd></div>'; }).join('') + '</dl>'
          : '<p class="rel-card-vazio">' + N.esc(itens[0][0]) + '</p>') +
        '</article>';
    }).join('');

    // gráficos por safra
    $('rel-graficos').innerHTML = rel.safras.map(function (x, i) {
      var itens = itensResumo(x, e.o);
      return '<article class="cartao rel-safra" style="--cor:' + x.cor + '">' +
        '<header class="rel-safra-cab"><h2><i></i>' + N.esc(N.nomeSafra(x.nome)) + (x.anos === 0 ? ' <small>safra atual</small>' : '') + '</h2>' +
        '<ul class="rel-resumo">' + (x.ini ? itens.map(function (it) { return '<li><span>' + it[0] + '</span><b>' + N.esc(it[1]) + '</b></li>'; }).join('') : '<li>' + N.esc(itens[0][0]) + '</li>') + '</ul></header>' +
        '<div class="grafico rel-g" id="rel-g' + i + '"></div></article>';
    }).join('');
    rel.safras.forEach(function (x, i) {
      var el = $('rel-g' + i);
      if (!x.ini) return N.vazio(el, 'Sem apontamentos de ' + op(e.o) + ' nesta safra.');
      N.chart(el).setOption(opcoesSafra(rel, x, 1), true);
    });

    // comparativo
    document.querySelectorAll('#rel-modo button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.modo === modoComp)); });
    $('rel-leg').innerHTML = rel.safras.filter(function (x) { return x.ini; }).map(function (x) { return '<li><i class="linha" style="background:' + x.cor + '"></i>' + N.esc(N.nomeSafra(x.nome)) + '</li>'; }).join('');
    N.chart($('rel-comp')).setOption(opcoesComparativo(rel, 1), true);
    $('rel-legenda-chuva').hidden = !rel.temChuva;
  }

  // ------------------------------------------------------------------
  // Exportar (PNG único ou PDF A4 deitado)
  // ------------------------------------------------------------------
  var LARG = 1600, ESC = 1.25;

  function cabecalho(c, W, h, rel, imgs, compacto) {
    N.faixaMarca(c, W, h, imgs);
    var e = N.estado();
    if (c.letterSpacing !== undefined) c.letterSpacing = '3px';
    N.escrever(c, ('Comparativo de safras · ' + op(e.o)).toUpperCase(), 44, compacto ? 34 : 48, 15, 700, '#F0B24A', W * 0.6);
    if (c.letterSpacing !== undefined) c.letterSpacing = '0px';
    N.escrever(c, N.titulo(rel.u), 44, compacto ? 72 : 100, compacto ? 30 : 42, 700, '#FFFFFF', W * 0.6);
    if (!compacto) N.escrever(c, rel.safras.map(function (x) { return N.nomeSafra(x.nome); }).join('  ·  '), 44, 136, 18, 500, '#D7E8E2', W * 0.6);
    if (imgs.coa) { var lh = compacto ? 42 : 56, lw = imgs.coa.width / imgs.coa.height * lh; c.save(); c.globalAlpha = 0.7; c.drawImage(imgs.coa, W - 40 - lw, (h - lh) / 2, lw, lh); c.restore(); }
  }
  function rodape(c, W, y) {
    var g = N.dados().geradoEm ? new Date(N.dados().geradoEm) : null;
    N.escrever(c, 'Fonte: PIMS (apontamentos)' + (R && R.temChuva ? ' e ZEUS (chuva: média diária dos pluviômetros da fazenda)' : '') + (g ? '  ·  dados de ' + g.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''), 40, y, 13, 500, N.COR.suave, W - 360);
    N.escrever(c, 'gerado em ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · COA', W - 40, y, 13, 500, N.COR.fraco, 320, 'right');
  }
  function cartoes(c, r, rel) {
    var n = rel.safras.length, g = 14, w = (r.w - g * (n - 1)) / n;
    rel.safras.forEach(function (x, i) {
      var b = { x: r.x + i * (w + g), y: r.y, w: w, h: r.h };
      N.caixa(c, b, 12);
      c.fillStyle = x.cor; N.rr(c, b.x, b.y, b.w, 6, 3); c.fill();
      N.escrever(c, N.nomeSafra(x.nome), b.x + 18, b.y + 38, 20, 700, N.COR.texto, w * 0.6);
      N.escrever(c, x.anos === 0 ? 'atual' : x.anos + (x.anos === 1 ? ' ano antes' : ' anos antes'), b.x + b.w - 18, b.y + 36, 13, 600, x.anos === 0 ? x.cor : N.COR.fraco, w * 0.35, 'right');
      if (!x.ini) { N.escrever(c, 'Sem apontamentos', b.x + 18, b.y + 76, 15, 500, N.COR.fraco, w - 36); return; }
      N.escrever(c, dataCurta(x.ini) + ' → ' + (x.fim ? dataCurta(x.fim) : 'em andamento'), b.x + 18, b.y + 70, 17, 600, x.cor === '#e87ba4' ? '#B0487A' : x.cor, w - 36);
      itensResumo(x, rel.o).slice(2).forEach(function (it, j) {
        var col = j % 2, lin = Math.floor(j / 2), cx = b.x + 18 + col * (w - 36) / 2, cy = b.y + 102 + lin * 40;
        N.escrever(c, it[0], cx, cy, 12, 500, N.COR.fraco, (w - 36) / 2 - 8);
        N.escrever(c, it[1], cx, cy + 18, 15, 650, N.COR.texto, (w - 36) / 2 - 8);
      });
    });
  }
  async function cartaoSafra(c, r, rel, x) {
    N.caixa(c, r, 12);
    c.fillStyle = x.cor; N.rr(c, r.x + 18, r.y + 20, 12, 12, 3); c.fill();
    N.escrever(c, N.nomeSafra(x.nome) + (x.anos === 0 ? '  (safra atual)' : ''), r.x + 38, r.y + 32, 18, 700, N.COR.texto, 360);
    // resuminho numa linha à direita do título
    var itens = x.ini ? itensResumo(x, rel.o) : [];
    var xx = r.x + 420;
    itens.forEach(function (it) {
      var larg = N.escrever(c, it[0] + ' ', xx, r.y + 32, 13, 500, N.COR.fraco, 200);
      xx += larg;
      xx += N.escrever(c, it[1], xx, r.y + 32, 13, 700, N.COR.texto, 260) + 18;
    });
    var a = { x: r.x + 8, y: r.y + 46, w: r.w - 16, h: r.h - 52 };
    if (!x.ini) { N.escrever(c, 'Sem apontamentos nesta safra.', a.x + a.w / 2, a.y + a.h / 2, 15, 500, N.COR.fraco, a.w, 'center'); return; }
    var img = await N.grafico(a.w, a.h, opcoesSafra(rel, x, 1), ESC);
    if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
  }
  async function cartaoComparativo(c, r, rel) {
    N.caixa(c, r, 12);
    N.escrever(c, 'Comparativo acumulado' + (modoComp === 'pct' ? ' (% da área de cada safra)' : ' (ha)') + ' pela data do ano', r.x + 20, r.y + 34, 19, 700, N.COR.texto, r.w * 0.6);
    var itens = rel.safras.filter(function (x) { return x.ini; }).map(function (x) { return [x.cor, N.nomeSafra(x.nome), 'linha']; });
    N.legendaCartao(c, itens, r.x + 20, r.y + 60);
    var a = { x: r.x + 8, y: r.y + 72, w: r.w - 16, h: r.h - 80 };
    var img = await N.grafico(a.w, a.h, opcoesComparativo(rel, 1), ESC);
    if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
  }
  function legendaChuva(c, x, y, cor) {
    // mancha azul (a mesma do gráfico)
    N.rr(c, x, y - 13, 18, 13, 2); c.fillStyle = 'rgba(42,120,214,.35)'; c.fill();
    c.strokeStyle = 'rgba(42,120,214,.8)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y - 13); c.lineTo(x + 18, y - 13); c.stroke();
    N.escrever(c, 'Chuva do dia (mm, eixo da direita)', x + 26, y, 13, 500, cor || N.COR.suave, 420);
  }
  async function imagens() {
    var r = await Promise.all([N.talvezImagem(N.fundoCultura(R.s)), N.talvezImagem('assets/logo_coa_branco.png')]);
    return { cultura: r[0], coa: r[1] };
  }
  function novoCanvas(w, h) {
    var cv = document.createElement('canvas'); cv.width = Math.round(w * ESC); cv.height = Math.round(h * ESC);
    var c = cv.getContext('2d'); c.scale(ESC, ESC); c.fillStyle = '#F1F2F1'; c.fillRect(0, 0, w, h);
    return { cv: cv, c: c };
  }

  /** Relatório inteiro numa imagem só (1600 de largura base). */
  async function gerarPng() {
    var rel = R, imgs = await imagens(), W = LARG, M = 32, g = 16;
    var hCab = 170, hCards = 236, hSafra = 330, hComp = 470;
    var H = hCab + g + hCards + g + rel.safras.length * (hSafra + g) + hComp + g + 60;
    var t = novoCanvas(W, H), c = t.c, y = hCab + g;
    cabecalho(c, W, hCab, rel, imgs, false);
    if (rel.temChuva) legendaChuva(c, W - 470, 150, '#D7E8E2');
    cartoes(c, { x: M, y: y, w: W - 2 * M, h: hCards }, rel); y += hCards + g;
    for (var i = 0; i < rel.safras.length; i++) { await cartaoSafra(c, { x: M, y: y, w: W - 2 * M, h: hSafra }, rel, rel.safras[i]); y += hSafra + g; }
    await cartaoComparativo(c, { x: M, y: y, w: W - 2 * M, h: hComp }, rel); y += hComp + g;
    rodape(c, W, y + 26);
    return new Promise(function (ok) { t.cv.toBlob(ok, 'image/png'); });
  }

  /** PDF A4 deitado: página 1 = cartões + comparativo; depois 2 gráficos de safra por página. */
  async function gerarPdf() {
    var jsPDF = await carregarJsPdf(), rel = R, imgs = await imagens();
    var W = LARG, H = Math.round(LARG * 210 / 297), M = 32, g = 16, hCab = 110;
    var paginas = [];
    // página 1
    var p = novoCanvas(W, H), c = p.c, y = hCab + g;
    cabecalho(c, W, hCab, rel, imgs, true);
    cartoes(c, { x: M, y: y, w: W - 2 * M, h: 236 }, rel); y += 236 + g;
    await cartaoComparativo(c, { x: M, y: y, w: W - 2 * M, h: H - y - 56 }, rel);
    rodape(c, W, H - 20);
    paginas.push(p.cv);
    // páginas dos gráficos
    for (var i = 0; i < rel.safras.length; i += 2) {
      var q = novoCanvas(W, H), cq = q.c, yy = hCab + g, hS = (H - hCab - 2 * g - 56 - g) / 2;
      cabecalho(cq, W, hCab, rel, imgs, true);
      if (rel.temChuva) legendaChuva(cq, W - 470, hCab - 14, '#D7E8E2');
      for (var j = i; j < Math.min(i + 2, rel.safras.length); j++) { await cartaoSafra(cq, { x: M, y: yy, w: W - 2 * M, h: hS }, rel, rel.safras[j]); yy += hS + g; }
      rodape(cq, W, H - 20);
      paginas.push(q.cv);
    }
    var pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    paginas.forEach(function (cv, k) {
      if (k) pdf.addPage('a4', 'landscape');
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
    });
    pdf.setProperties({ title: 'Comparativo de safras - ' + N.titulo(rel.u), creator: 'COA WEB · Acompanhamento Operacional' });
    return pdf.output('blob');
  }
  function carregarJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfCarregando) jsPdfCarregando = new Promise(function (ok, falha) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function () { ok(window.jspdf.jsPDF); };
      s.onerror = function () { jsPdfCarregando = null; falha(new Error('Não foi possível carregar o gerador de PDF. Verifique a conexão.')); };
      document.head.appendChild(s);
    });
    return jsPdfCarregando;
  }
  function nomeArquivo(ext) {
    var s = function (t) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    return ['comparativo-safras', s(R.o), s(R.s), s(R.u), N.paraIso(N.hoje())].join('-') + '.' + ext;
  }

  var exp = { formato: 'png', blob: null, url: null, gerando: 0 };
  async function atualizarExport() {
    var n = ++exp.gerando, st = $('rel-exp-status');
    st.textContent = exp.formato === 'pdf' ? 'Gerando o PDF…' : 'Gerando a imagem…';
    $('rel-exp-baixar').disabled = true;
    try {
      var blob = exp.formato === 'pdf' ? await gerarPdf() : await gerarPng();
      if (n !== exp.gerando) return;
      if (exp.url) URL.revokeObjectURL(exp.url);
      exp.blob = blob; exp.url = URL.createObjectURL(blob);
      $('rel-exp-previa').hidden = exp.formato === 'pdf';
      if (exp.formato === 'png') $('rel-exp-previa').src = exp.url;
      st.textContent = (exp.formato === 'pdf' ? 'PDF A4 deitado · ' + (1 + Math.ceil(R.safras.length / 2)) + ' páginas' : 'PNG · 2000 px de largura') + ' · ' + Math.round(blob.size / 1024) + ' KB';
      $('rel-exp-baixar').disabled = false;
    } catch (e) {
      if (n === exp.gerando) st.textContent = 'Não foi possível gerar: ' + (e && e.message ? e.message : e);
    }
  }
  function abrirExportar() {
    if (!R) return;
    document.querySelectorAll('#dlg-rel input[name="rel-fmt"]').forEach(function (r) { r.checked = r.value === exp.formato; });
    $('dlg-rel').showModal();
    atualizarExport();
  }
  function baixar() {
    if (!exp.blob) return;
    var a = document.createElement('a'); a.href = exp.url; a.download = nomeArquivo(exp.formato);
    document.body.appendChild(a); a.click(); a.remove();
  }

  // eventos da aba (os elementos existem no index.html)
  document.addEventListener('DOMContentLoaded', function () {
    $('rel-exportar').addEventListener('click', abrirExportar);
    $('rel-exp-fechar').addEventListener('click', function () { $('dlg-rel').close(); });
    $('rel-exp-baixar').addEventListener('click', baixar);
    document.querySelectorAll('#dlg-rel input[name="rel-fmt"]').forEach(function (r) {
      r.addEventListener('change', function () { exp.formato = this.value; atualizarExport(); });
    });
    $('rel-modo').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !R || b.dataset.modo === modoComp) return;
      modoComp = b.dataset.modo;
      document.querySelectorAll('#rel-modo button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.modo === modoComp)); });
      N.chart($('rel-comp')).setOption(opcoesComparativo(R, 1), true);
    });
  });

  window.AcompSafras = { render: render, exportar: abrirExportar };
})();
