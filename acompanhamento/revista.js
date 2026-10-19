/* =====================================================================
   Acompanhamento Operacional — aba "Revista"
   O relatório consolidado do período de produção (hoje, o plantio) diagramado como revista, em páginas A4
   em pé: capa com foto, abertura com sumário, números, ritmo, mapas, chuva (da fazenda, por talhão e os
   mapas de chuva salvos no Mapas), variedades, equipes, talhão a talhão, próximos dias e contracapa.
   Uma fazenda (a aba escolhida) ou, para administrador, o grupo todo ("Todas"). Exporta só em PDF.
   As páginas são desenhadas em canvas (as mesmas imagens da tela vão para o PDF); contas e textos em
   revista-logica.js (RevistaLogica). O núcleo do app.js (NUCLEO) chega em AcompRevista.render().
===================================================================== */
(function () {
  'use strict';

  var RL = window.RevistaLogica, RLo = window.RelatorioLogica, CL = window.ChuvaLogica;
  var N = null;
  var W = 1240, H = 1754;          // página base (A4 em pé a 150 dpi); desenhada em ESC
  var ESC = 1.6;                   // 1984 × 2806 px por página (~240 dpi no A4)
  var QUALIDADE = 0.9;             // JPEG de cada página
  var MX = 72;                     // margem lateral
  var FONTE = '"IBM Plex Sans", "Segoe UI", Arial, sans-serif';
  var C = {
    verde: '#0C5A50', escuro: '#103632', ouro: '#DB8A08', ouroClaro: '#F2B544', papel: '#FFFFFF', creme: '#F6F4EE',
    texto: '#17251F', suave: '#5B6B62', fraco: '#8A988F', linha: '#DCE3DC', grade: '#EEF2EE', chuva: '#2a78d6', chuvaTxt: '#1c5cab',
    bom: '#1E7B4F', ruim: '#B3261E', atencao: '#B7791F'
  };
  var COR_EQUIPES = ['#0C5A50', '#DB8A08', '#2a78d6', '#a8327a', '#8c5a2b', '#1baf7a', '#4a3aa7', '#e87ba4'];
  /**
   * Foto da capa por safra (nome do PIMS, ex. 'SOJA 26/27') ou cultura (ex. 'SOJA'); sem foto própria, a padrão.
   * Hoje só há a foto real da lavoura de soja (enviada pelo usuário em 19/10/2026), que também serve de padrão.
   */
  var CAPAS = { SOJA: 'assets/capas/soja.webp', padrao: 'assets/capas/soja.webp' };
  var NOME_GRUPO = 'Grupo Locks';

  function $(id) { return document.getElementById(id); }
  function iso(d) { return d ? N.paraIso(d) : null; }
  function dc(s) { return RL.dataCurta(s); }
  function dl(d) { return d ? d.toLocaleDateString('pt-BR') : '—'; }
  function n0(v) { return N.fmtN(v); }
  function pct(v) { return N.fmtPct(v); }
  function plural(n, a, b) { return n === 1 ? a : b; }
  function soma(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += f(a[i]); return s; }
  function semAcento(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }

  // ===========================================================================
  // Texto no canvas
  // ===========================================================================
  function fnt(px, peso) { return (peso || 400) + ' ' + (Math.round(px * 10) / 10) + 'px ' + FONTE; }
  function espaco(c, v) { if ('letterSpacing' in c) c.letterSpacing = (v || 0) + 'px'; }
  /** Escreve numa linha (reduz a fonte até caber em o.max). Devolve a largura. o: { max, al, esp, sombra } */
  function tx(c, t, x, y, px, peso, cor, o) {
    o = o || {}; t = String(t); var p = px;
    c.font = fnt(p, peso); espaco(c, o.esp);
    while (o.max && p > 6 && c.measureText(t).width > o.max) { p -= 0.5; c.font = fnt(p, peso); }
    c.fillStyle = cor; c.textAlign = o.al || 'left'; c.textBaseline = 'alphabetic';
    if (o.sombra) { c.save(); c.shadowColor = o.sombra; c.shadowBlur = 18; c.shadowOffsetY = 2; c.fillText(t, x, y); c.restore(); }
    else c.fillText(t, x, y);
    var w = c.measureText(t).width; espaco(c, 0);
    return w;
  }
  /** Parágrafo com **negrito**, quebrando em maxW. Devolve a linha de base da última linha. Com `medir`, só conta. */
  function rico(c, frase, x, y, maxW, px, entre, cor, corB, medir) {
    var itens = [];
    RLo.trechos(frase).forEach(function (t, i, arr) {
      var cola = i > 0 && !/^\s/.test(t.t) && !/\s$/.test(arr[i - 1].t);
      t.t.split(/\s+/).forEach(function (w, j) { if (w) itens.push({ w: w, b: t.b, cola: cola && j === 0 }); });
    });
    var cx = x; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    itens.forEach(function (it) {
      c.font = fnt(px, it.b ? 700 : 400);
      var ww = c.measureText(it.w).width, sp = c.measureText(' ').width;
      if (it.cola && cx > x) cx -= sp;
      if (cx > x && cx + ww > x + maxW) { cx = x; y += entre; }
      if (!medir) { c.fillStyle = it.b ? (corB || C.verde) : cor; c.fillText(it.w, cx, y); }
      cx += ww + sp;
    });
    return y;
  }
  function linhas(c, t, maxW, px, peso) {
    c.font = fnt(px, peso); var saida = [], l = '';
    String(t).split(/\s+/).forEach(function (p) { var n = l ? l + ' ' + p : p; if (l && c.measureText(n).width > maxW) { saida.push(l); l = p; } else l = n; });
    if (l) saida.push(l);
    return saida;
  }
  function para(c, t, x, y, maxW, px, peso, cor, entre, al) {
    var ls = linhas(c, t, maxW, px, peso), a = entre || px * 1.4;
    c.fillStyle = cor; c.textAlign = al || 'left'; c.textBaseline = 'alphabetic';
    ls.forEach(function (l, i) { c.fillText(l, x, y + i * a); });
    return y + (ls.length - 1) * a;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  /** Imagem cobrindo o retângulo (como object-fit: cover), com foco opcional (0..1). */
  function cobrir(c, img, r, fx, fy) {
    var k = Math.max(r.w / img.width, r.h / img.height), w = img.width * k, h = img.height * k;
    c.drawImage(img, r.x + (r.w - w) * (fx === undefined ? 0.5 : fx), r.y + (r.h - h) * (fy === undefined ? 0.5 : fy), w, h);
  }
  function caber(c, img, r) {
    var k = Math.min(r.w / img.width, r.h / img.height), w = img.width * k, h = img.height * k;
    c.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w: w, h: h };
  }

  // ===========================================================================
  // Moldura das páginas internas
  // ===========================================================================
  function folha(c, P) {
    c.fillStyle = C.papel; c.fillRect(0, 0, W, H);
    var ed = P.ed;
    tx(c, ('Relatório de plantio · ' + ed.safraNome).toUpperCase(), MX, 58, 12.5, 700, C.ouro, { esp: 2.2 });
    tx(c, ed.nome.toUpperCase(), W - MX, 58, 12.5, 600, C.suave, { al: 'right', esp: 2.2 });
    c.fillStyle = C.linha; c.fillRect(MX, 72, W - 2 * MX, 1);
    // rodapé: número da página na borda de fora (par à esquerda, ímpar à direita)
    var par = P.n % 2 === 0, yb = H - 44;
    c.fillStyle = C.verde; c.fillRect(par ? MX : W - MX - 40, yb - 26, 40, 34);
    tx(c, String(P.n).padStart(2, '0'), par ? MX + 20 : W - MX - 20, yb - 3, 15, 700, '#FFFFFF', { al: 'center' });
    tx(c, 'COA · Centro de Operações Agrícolas · Locks', par ? MX + 56 : W - MX - 56, yb - 4, 11.5, 500, C.fraco, { al: par ? 'left' : 'right' });
    tx(c, 'Dados até ' + dl(ed.dataRef), par ? W - MX : MX, yb - 4, 11.5, 500, C.fraco, { al: par ? 'right' : 'left' });
  }
  /**
   * Abertura de seção: número vazado grande, chamada (kicker), manchete e linha fina. Devolve o y livre abaixo.
   */
  function abertura(c, sec, kicker, manchete, fina, y0) {
    var y = y0 || 112;
    c.save(); c.font = fnt(120, 700); espaco(c, -2); c.lineWidth = 2; c.strokeStyle = C.ouro; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.strokeText(sec, MX - 4, y + 100); var wn = c.measureText(sec).width; espaco(c, 0); c.restore();
    var x = MX + wn + 26, mw = W - MX - x;
    tx(c, kicker.toUpperCase(), x, y + 26, 13, 700, C.ouro, { esp: 2.5 });
    var yl = para(c, manchete, x, y + 68, mw, 34, 700, C.escuro, 40);
    if (fina) yl = para(c, fina, x, yl + 34, mw, 16, 400, C.suave, 23);
    return Math.max(y + 128, yl + 20) + 18;
  }
  function subtitulo(c, t, x, y, w, extra) {
    tx(c, t.toUpperCase(), x, y, 12, 700, C.escuro, { esp: 1.8, max: w });
    if (extra) tx(c, extra, x + w, y, 12, 500, C.fraco, { al: 'right', max: w * 0.5 });
    c.fillStyle = C.escuro; c.fillRect(x, y + 9, 28, 2.5);
    return y + 26;
  }
  /** Bloco de número grande: rótulo em cima, complemento embaixo e o valor no meio (do tamanho que couber). */
  function numero(c, r, rotulo, valor, un, comp, tom, claro) {
    c.fillStyle = claro ? C.creme : C.papel; rr(c, r.x, r.y, r.w, r.h, 10); c.fill();
    if (!claro) { c.strokeStyle = C.linha; c.lineWidth = 1; rr(c, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10); c.stroke(); }
    tx(c, rotulo.toUpperCase(), r.x + 18, r.y + 30, 11, 700, C.fraco, { esp: 1.2, max: r.w - 36 });
    var nComp = comp ? Math.min(2, linhas(c, comp, r.w - 36, 12.5, 500).length) : 0;
    var yComp = r.y + r.h - 20 - (nComp - 1) * 17, yValor = comp ? yComp - 30 : r.y + r.h - 22;
    var px = Math.max(20, Math.min(46, yValor - (r.y + 30) - 12));
    var wv = tx(c, valor, r.x + 18, yValor, px, 700, C.escuro, { max: r.w - 36 - (un ? 54 : 0) });
    if (un) tx(c, un, r.x + 18 + wv + 6, yValor, Math.min(16, px * 0.45), 600, C.suave);
    if (comp) para(c, comp, r.x + 18, yComp, r.w - 36, 12.5, 500, tom === 'bom' ? C.bom : tom === 'ruim' ? C.ruim : tom === 'atencao' ? C.atencao : C.suave, 17);
  }
  /** Citação de destaque (pull quote). */
  function citacao(c, t, x, y, w) {
    c.fillStyle = C.ouro; c.fillRect(x, y, 4, 10);
    var yl = rico(c, t, x + 22, y + 26, w - 22, 21, 30, C.escuro, C.verde);
    c.fillStyle = C.ouro; c.fillRect(x, y, 4, yl - y + 12);
    return yl + 18;
  }
  function legenda(c, itens, x, y, maxW, px) {
    px = px || 12.5; var cx = x, cy = y;
    itens.forEach(function (it) {
      c.font = fnt(px, 500);
      var w = 14 + 7 + c.measureText(it.nome).width + 20;
      if (cx > x && cx + w > x + maxW) { cx = x; cy += px + 12; }
      if (it.tipo === 'tracejada') { c.strokeStyle = it.cor; c.lineWidth = 2.5; c.setLineDash([5, 3]); c.beginPath(); c.moveTo(cx, cy - px * 0.35); c.lineTo(cx + 14, cy - px * 0.35); c.stroke(); c.setLineDash([]); }
      else { c.fillStyle = it.cor; rr(c, cx, cy - px * 0.8, 14, 11, 2.5); c.fill(); if (it.borda) { c.strokeStyle = '#C9D3CB'; c.lineWidth = 1; c.stroke(); } }
      tx(c, it.nome, cx + 21, cy, px, 500, C.suave);
      cx += w;
    });
    return cy;
  }
  /** Tabela simples: cols [{ t, w (fração), al }], linhas [[célula…]] (célula = texto ou { t, cor, peso, bola }). */
  function tabela(c, r, cols, ls, o) {
    o = o || {}; var lh = o.lh || 30, x0 = r.x, y = r.y, xs = [], acc = 0;
    cols.forEach(function (k) { xs.push(x0 + acc * r.w); acc += k.w; });
    cols.forEach(function (k, i) {
      var al = k.al || 'left', x = al === 'right' ? xs[i] + k.w * r.w - 8 : xs[i] + (i ? 8 : 0);
      tx(c, k.t.toUpperCase(), x, y + 14, 10, 700, C.fraco, { al: al, esp: 0.8, max: k.w * r.w - 12 });
    });
    y += 24; c.fillStyle = C.escuro; c.fillRect(x0, y - 2, r.w, 1.5);
    ls.forEach(function (l, j) {
      if (o.zebra !== false && j % 2) { c.fillStyle = '#F6F8F6'; c.fillRect(x0, y, r.w, lh); }
      if (o.destaque && o.destaque(j)) { c.fillStyle = '#EEF6F2'; c.fillRect(x0, y, r.w, lh); }
      l.forEach(function (cel, i) {
        var k = cols[i], al = k.al || 'left', x = al === 'right' ? xs[i] + k.w * r.w - 8 : xs[i] + (i ? 8 : 0), v = cel;
        if (v === null || v === undefined) v = '—';
        if (typeof v === 'object') {
          if (v.bola) { c.fillStyle = v.bola; rr(c, x, y + lh / 2 - 6, 12, 12, 3); c.fill(); x += 19; }
          if (v.barra !== undefined) {
            var bw = k.w * r.w - 16 - (v.t ? 46 : 0);
            c.fillStyle = '#E3E8E4'; rr(c, xs[i] + 8, y + lh / 2 - 4, bw, 8, 4); c.fill();
            if (v.barra > 0) { c.fillStyle = v.cor || C.verde; rr(c, xs[i] + 8, y + lh / 2 - 4, Math.max(8, bw * Math.min(1, v.barra)), 8, 4); c.fill(); }
            if (v.t) tx(c, v.t, xs[i] + k.w * r.w - 8, y + lh / 2 + 5, 12.5, 600, C.texto, { al: 'right' });
            return;
          }
          tx(c, v.t, x, y + lh / 2 + 5, o.px || 13, v.peso || 500, v.cor || C.texto, { al: al, max: k.w * r.w - 14 - (v.bola ? 19 : 0) });
        } else tx(c, v, x, y + lh / 2 + 5, o.px || 13, i === 0 ? 600 : 500, C.texto, { al: al, max: k.w * r.w - 14 });
      });
      y += lh;
      c.fillStyle = C.grade; c.fillRect(x0, y - 1, r.w, 1);
    });
    return y;
  }

  // ===========================================================================
  // Gráficos (ECharts fora da tela, na resolução da página)
  // ===========================================================================
  async function grafico(c, r, opcoes) {
    var img = await N.grafico(r.w, r.h, opcoes, ESC);
    if (img) c.drawImage(img, r.x, r.y, r.w, r.h);
  }
  var MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function rotuloDia(d, i) { var p = d.split('-'); return +p[2] === 1 || i === 0 ? +p[2] + ' ' + MES[+p[1] - 1] : String(+p[2]); }
  function diasEntre(de, ate) { var l = []; if (!de || !ate) return l; for (var d = de; d <= ate; d = RL.somarDias(d, 1)) l.push(d); return l; }
  var GRADE = { left: 58, right: 18, top: 30, bottom: 30, containLabel: false };
  function eixos(dias, yFmt) {
    return {
      xAxis: { type: 'category', data: dias.map(rotuloDia), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linha } }, axisLabel: { color: C.suave, fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: C.grade } }, axisLabel: { color: C.fraco, fontSize: 11, formatter: yFmt || function (v) { return n0(v); } } }
    };
  }
  /** Colunas por dia (uma série), com o valor em cima quando cabe. */
  function opColunas(dias, valores, cor, o) {
    o = o || {};
    var espacoBarra = (o.largura || 1000) / Math.max(1, dias.length);
    var series = [{ type: 'bar', data: valores, barMaxWidth: 26, barCategoryGap: '24%', itemStyle: { color: cor, borderRadius: [3, 3, 0, 0] },
      label: { show: espacoBarra >= 16, position: 'top', fontSize: 10.5, fontWeight: 600, color: C.texto, textBorderColor: '#fff', textBorderWidth: 3, formatter: function (p) { return p.value >= (o.casas ? 0.05 : 0.5) ? (o.casas ? N.fmtN(p.value, o.casas) : n0(p.value)) : ''; } },
      labelLayout: { hideOverlap: true } }];
    if (o.meta) series.push({ type: 'line', step: 'middle', data: o.meta, symbol: 'none', silent: true, lineStyle: { color: C.ouro, width: 2, type: [6, 4] }, z: 5 });
    return N.opt(Object.assign({ grid: Object.assign({}, GRADE, o.grade || {}), series: series }, eixos(dias, o.yFmt)));
  }

  // ===========================================================================
  // Mapas (polígonos dos talhões, sem fundo, desenhados direto no canvas)
  // ===========================================================================
  function merc(lon, lat) {
    var R = 6378137, y = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + y / 2))];
  }
  function aneisDe(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }
  /** Prepara as feições (Web Mercator) e a caixa delas: { itens: [{ f, polis: [[[x,y]…]…] }], caixa }. */
  function projetar(features) {
    var cx = [Infinity, Infinity, -Infinity, -Infinity], itens = [];
    (features || []).forEach(function (f) {
      var polis = aneisDe(f.geometry).map(function (p) { return p.map(function (anel) { return anel.map(function (q) { var m = merc(q[0], q[1]); if (m[0] < cx[0]) cx[0] = m[0]; if (m[1] < cx[1]) cx[1] = m[1]; if (m[0] > cx[2]) cx[2] = m[0]; if (m[1] > cx[3]) cx[3] = m[1]; return m; }); }); });
      if (polis.length) itens.push({ f: f, polis: polis });
    });
    return { itens: itens, caixa: cx };
  }
  /** Proporção (largura / altura) do conjunto. */
  function aspecto(pr) { var b = pr.caixa; return b[3] > b[1] ? (b[2] - b[0]) / (b[3] - b[1]) : 1.4; }
  /** Centro do maior anel externo (média ponderada pela área do triângulo em leque). */
  function centro(polis) {
    var melhor = null, aMax = -1;
    polis.forEach(function (p) {
      var a = p[0], area = 0, sx = 0, sy = 0;
      for (var i = 0, j = a.length - 1; i < a.length; j = i++) { var cr = a[j][0] * a[i][1] - a[i][0] * a[j][1]; area += cr; sx += (a[j][0] + a[i][0]) * cr; sy += (a[j][1] + a[i][1]) * cr; }
      if (Math.abs(area) > aMax && area !== 0) { aMax = Math.abs(area); melhor = [sx / (3 * area), sy / (3 * area), Math.sqrt(Math.abs(area) / 2)]; }
    });
    return melhor;
  }
  /**
   * Pinta os talhões no retângulo: cor(f) → cor do talhão (null = cinza claro); rotulo(f) → texto no centro.
   * Devolve a área usada { x, y, w, h }.
   */
  function pintarMapa(c, r, pr, cor, rotulo, o) {
    o = o || {};
    var b = pr.caixa, bw = b[2] - b[0], bh = b[3] - b[1];
    if (!pr.itens.length || !(bw > 0) || !(bh > 0)) { tx(c, 'Sem limites de talhões cadastrados no Mapas para esta fazenda.', r.x + r.w / 2, r.y + r.h / 2, 13, 500, C.fraco, { al: 'center' }); return r; }
    var k = Math.min(r.w / bw, r.h / bh) * 0.96, ox = r.x + (r.w - bw * k) / 2, oy = o.topo ? r.y : r.y + (r.h - bh * k) / 2;
    function px(p) { return [ox + (p[0] - b[0]) * k, oy + (b[3] - p[1]) * k]; }
    c.save();
    pr.itens.forEach(function (it) {
      c.beginPath();
      it.polis.forEach(function (p) { p.forEach(function (anel) { anel.forEach(function (q, i) { var s = px(q); if (i) c.lineTo(s[0], s[1]); else c.moveTo(s[0], s[1]); }); c.closePath(); }); });
      c.fillStyle = cor(it.f) || '#EEF1EE'; c.fill('evenodd');
      c.strokeStyle = o.borda || '#FFFFFF'; c.lineWidth = o.larguraBorda || 1.1; c.lineJoin = 'round'; c.stroke();
    });
    if (rotulo) {
      pr.itens.forEach(function (it) {
        var ct = centro(it.polis); if (!ct) return;
        var tam = ct[2] * k; if (tam < (o.minRotulo || 14)) return;
        var s = px(ct), t = rotulo(it.f); if (!t) return;
        var px0 = Math.max(8, Math.min(o.maxFonte || 13, tam * 0.42)), tinta = CL.tintaSobre(cor(it.f) || '#EEF1EE');
        c.font = fnt(px0, 600); c.textAlign = 'center'; c.textBaseline = 'middle';
        // texto claro sobre cor escura (com contorno escuro) e escuro sobre cor clara (com contorno branco)
        c.lineWidth = 3; c.strokeStyle = tinta === '#FFFFFF' ? 'rgba(10,30,26,.55)' : 'rgba(255,255,255,.92)'; c.strokeText(t, s[0], s[1]);
        c.fillStyle = tinta === '#FFFFFF' ? '#FFFFFF' : C.texto; c.fillText(t, s[0], s[1]);
      });
    }
    c.restore();
    if (o.rosa && P_IMGS.rosa) c.drawImage(P_IMGS.rosa, r.x + r.w - 46, r.y + 4, 38, 38 * P_IMGS.rosa.height / P_IMGS.rosa.width);
    return { x: ox, y: oy, w: bw * k, h: bh * k };
  }
  var P_IMGS = {};

  /**
   * Feições da fazenda (melhor conjunto de limites do Mapas para os talhões da safra) e o talhão de cada uma. Blocos
   * distantes viram quadros empilhados, pela mesma regra do mapa do Painel (compor() do app.js).
   */
  function mapaDa(u, m) {
    var mp = N.escolherMapa(u, m.talhoes, m.s);
    if (!mp) return null;
    var comp = N.compor(mp.features);
    return {
      pr: projetar(mp.features), porId: mp.porId, semPoligono: mp.semPoligono, retrato: comp.orientacao === 'retrato',
      quadros: comp.quadros.length > 1 ? comp.quadros.map(function (q) { return { titulo: q.titulo, fr: q.fr, pr: projetar(q.fs) }; }) : null,
      talhaoDe: function (f) { return mp.porId[f.properties.name] || null; }
    };
  }
  /** Mapa da fazenda no retângulo: um quadro só ou os blocos empilhados, cada um com o nome do setor. */
  function pintarFazenda(c, r, mapa, cor, rotulo, o) {
    if (!mapa.quadros) return pintarMapa(c, r, mapa.pr, cor, rotulo, o);
    var g = 10, tit = 22, livre = r.h - g * (mapa.quadros.length - 1), y = r.y;
    mapa.quadros.forEach(function (q, i) {
      var h = livre * q.fr;
      tx(c, q.titulo || '', r.x, y + 15, 11.5, 700, C.suave, { esp: 0.8, max: r.w });
      pintarMapa(c, { x: r.x, y: y + tit, w: r.w, h: h - tit }, q.pr, cor, rotulo, Object.assign({}, o, { rosa: o && o.rosa && i === 0, topo: false }));
      if (i < mapa.quadros.length - 1) { c.fillStyle = C.grade; c.fillRect(r.x, y + h + g / 2, r.w, 1); }
      y += h + g;
    });
    return r;
  }

  // ===========================================================================
  // Dados da edição
  // ===========================================================================
  function chuvaDe(u) {
    var c = {};
    (N.dados().chuva || []).forEach(function (x) { if (x.u === u) c[x.d] = (c[x.d] || 0) + x.a; });
    return c;
  }
  function chaveFamilia(codigo) { var b = CL.talhaoBase(codigo); return /^\d+$/.test(b) ? b.replace(/^0+(?=\d)/, '') : b; }
  /** Chuva por talhão da fazenda (linha de chuva_talhao) no formato que RevistaLogica.chuvaDosTalhoes usa. */
  function chuvaPorTalhao(linha) {
    if (!linha) return null;
    var faz = CL.prepararFazenda(linha);
    if (!faz.temTalhoes) return null;
    return { faz: faz, inicio: faz.inicio, fim: faz.fim, serieDe: function (codigo) { var f = faz.familias[chaveFamilia(codigo)]; return f ? f.serie : (faz.talhoes[codigo] || null); } };
  }
  /** Previsão mais recente de cada fonte para os próximos dias: { fontes: [{ fonte, nome, emitida, dias: [{ d, mm, p, tx, tn }] }], dias: [...] } */
  var NOME_FONTE = { zeus: 'ZEUS', metno: 'MET Norway', visualcrossing: 'Visual Crossing' };
  function previsaoDe(lista, hojeIso) {
    if (!lista || !lista.length) return null;
    var fontes = lista.map(function (p) {
      return { fonte: p.fonte, nome: NOME_FONTE[p.fonte] || p.fonte, emitida: p.emitida_em, dias: (p.dias || []).filter(function (x) { return x.d >= hojeIso; }).slice(0, 7) };
    }).filter(function (f) { return f.dias.length; }).sort(function (a, b) { return ['zeus', 'metno', 'visualcrossing'].indexOf(a.fonte) - ['zeus', 'metno', 'visualcrossing'].indexOf(b.fonte); });
    if (!fontes.length) return null;
    var dias = {}; fontes.forEach(function (f) { f.dias.forEach(function (x) { dias[x.d] = true; }); });
    dias = Object.keys(dias).sort().slice(0, 7);
    // a soma e a média comparam só os dias que todas as fontes têm (fonte com menos dias não puxa a média para baixo)
    var comuns = dias.filter(function (d) { return fontes.every(function (f) { return f.dias.some(function (x) { return x.d === d; }); }); });
    if (!comuns.length) comuns = dias;
    var tot = fontes.map(function (f) { return soma(f.dias.filter(function (x) { return comuns.indexOf(x.d) >= 0; }), function (x) { return x.mm || 0; }); });
    var media = soma(tot, function (x) { return x; }) / tot.length;
    return { fontes: fontes, dias: dias, totais: tot, resumo: { mm: Math.round(media * 10) / 10, dias: comuns.length, de: comuns[0], ate: comuns[comuns.length - 1] } };
  }

  function nomeFazenda(u) { return 'Fazenda ' + N.titulo(u); }
  /** Tudo que a revista de UMA fazenda usa (no grupo, uma por unidade). */
  function edicaoDaFazenda(u, s, o, extras, hoje) {
    var m = N.calcula([u], s, o), chuvaU = chuvaDe(u);
    var rel = RLo.consolidar(m, chuvaU, hoje, { fazenda: nomeFazenda(u) });
    var tal = RL.talhoesDoPlantio(m), variedades = RL.variedadesDoPlantio(m, tal);
    var cores = RL.coresDasVariedades(variedades.filter(function (v) { return v.v !== RL.SEM_VARIEDADE; }).map(function (v) { return v.v; }), extras.cores);
    cores[RL.SEM_VARIEDADE] = RL.COR_SEM_VARIEDADE;
    var iniIso = iso(m.ini), hojeIso = iso(hoje);
    var chT = chuvaPorTalhao(extras.chuva[semAcento(u)]);
    var chuvaTal = chT ? RL.chuvaDosTalhoes(tal, chT, iniIso) : [];
    var ed = {
      u: u, nome: nomeFazenda(u), m: m, rel: rel, tal: tal, variedades: variedades, cores: cores,
      destaques: RL.destaquesDoRitmo(m), equipes: RL.equipesDoPlantio(m), semanas: RL.semanasDePlantio(tal, iniIso),
      chuvaU: chuvaU, temChuva: Object.keys(chuvaU).length > 0,
      chuvaPeriodo: iniIso ? RL.resumoChuva(RL.serieChuva(chuvaU, iniIso, hojeIso)) : null,
      chT: chT, chuvaTal: chuvaTal, posPlantio: chuvaTal.length ? RL.resumoPosPlantio(chuvaTal) : null,
      mapasSalvos: iniIso ? RL.mapasDoPeriodo(extras.mapas[u] || [], RL.somarDias(iniIso, -15), hojeIso) : [],
      previsao: previsaoDe(extras.previsao[u], hojeIso),
      mapa: mapaDa(u, m)
    };
    ed.textos = RL.editorial({ m: m, rel: rel, nome: ed.nome, destaques: ed.destaques, variedades: variedades, chuva: ed.temChuva ? ed.chuvaPeriodo : null, posPlantio: ed.posPlantio, ateChuvaTalhao: chT ? chT.faz.hoje : null, previsao: ed.previsao ? ed.previsao.resumo : null });
    return ed;
  }
  function edicaoDoGrupo(us, s, o, extras, hoje) {
    var m = N.calcula(us, s, o);
    var porU = us.map(function (u) { return edicaoDaFazenda(u, s, o, extras, hoje); });
    var linhas = us.map(function (u, i) { return RLo.linhaFazenda(u, porU[i].m, porU[i].chuvaU, hoje); });
    var rel = RLo.consolidar(m, {}, hoje, { todas: true, linhas: linhas });
    var tal = RL.talhoesDoPlantio(m), variedades = RL.variedadesDoPlantio(m, tal);
    var cores = RL.coresDasVariedades(variedades.filter(function (v) { return v.v !== RL.SEM_VARIEDADE; }).map(function (v) { return v.v; }), extras.cores);
    cores[RL.SEM_VARIEDADE] = RL.COR_SEM_VARIEDADE;
    var ed = {
      grupo: true, u: N.TODAS, nome: NOME_GRUPO, m: m, rel: rel, tal: tal, variedades: variedades, cores: cores, unidades: porU, linhas: linhas,
      destaques: RL.destaquesDoRitmo(m), equipes: RL.equipesDoPlantio(m)
    };
    var comChuva = porU.filter(function (x) { return x.chuvaPeriodo && x.temChuva; });
    var chuvaMedia = comChuva.length ? { mm: Math.round(soma(comChuva, function (x) { return x.chuvaPeriodo.mm; }) / comChuva.length), dias: Math.round(soma(comChuva, function (x) { return x.chuvaPeriodo.dias; }) / comChuva.length) } : null;
    ed.textos = RL.editorial({ m: m, rel: rel, grupo: true, destaques: ed.destaques, variedades: variedades, chuva: null });
    if (chuvaMedia) ed.textos.splice(2, 0, 'Desde o início do plantio choveu, em média, **' + n0(chuvaMedia.mm) + ' mm** por unidade, em ' + chuvaMedia.dias + ' ' + plural(chuvaMedia.dias, 'dia', 'dias') + ' de chuva.');
    return ed;
  }

  // ===========================================================================
  // Páginas
  // ===========================================================================
  /** A data da capa: o dia dos dados do PIMS (ou hoje). */
  function digitosData(d) { return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), String(d.getFullYear()).slice(2)]; }

  async function pgCapa(c, P) {
    var ed = P.ed, im = P.imgs;
    c.fillStyle = '#20302C'; c.fillRect(0, 0, W, H);
    if (im.capa) cobrir(c, im.capa, { x: 0, y: 0, w: W, h: H }, 0.5, 0.5);
    var g = c.createLinearGradient(0, 0, 0, H * 0.4); g.addColorStop(0, 'rgba(6,22,20,.72)'); g.addColorStop(1, 'rgba(6,22,20,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H * 0.4);
    g = c.createLinearGradient(0, H * 0.74, 0, H); g.addColorStop(0, 'rgba(6,22,20,0)'); g.addColorStop(1, 'rgba(6,22,20,.6)');
    c.fillStyle = g; c.fillRect(0, H * 0.74, W, H * 0.26);
    // marca do grupo no topo
    if (im.locksBranca) { var lh = 50, lw = im.locksBranca.width / im.locksBranca.height * lh; c.drawImage(im.locksBranca, (W - lw) / 2, 62, lw, lh); }
    tx(c, 'RELATÓRIO DE PLANTIO', W / 2, 262, 78, 700, '#FFFFFF', { al: 'center', esp: 2, max: W - 120, sombra: 'rgba(0,0,0,.35)' });
    tx(c, ed.nome.toUpperCase(), W / 2, 338, 40, 700, C.ouroClaro, { al: 'center', esp: 5, max: W - 160, sombra: 'rgba(0,0,0,.4)' });
    tx(c, (ed.safraNome + (ed.grupo ? ' · ' + ed.unidades.length + ' unidades' : '')).toUpperCase(), W / 2, 398, 28, 700, '#FFFFFF', { al: 'center', esp: 5, max: W - 160, sombra: 'rgba(0,0,0,.5)' });
    // a data em números vazados, à direita (como no modelo)
    var dg = digitosData(ed.dataRef);
    c.save(); c.font = fnt(330, 700); espaco(c, -6); c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.96)'; c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 14;
    dg.forEach(function (t, i) { c.strokeText(t, W + 26, 1000 + i * 262); });
    espaco(c, 0); c.restore();
    // a logo oficial do COA (versão branca, a mesma dos relatórios), centralizada no pé da capa
    if (im.coa) {
      var cw = 460, ch = im.coa.height / im.coa.width * cw;
      c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 16; c.shadowOffsetY = 2;
      c.drawImage(im.coa, (W - cw) / 2, H - 56 - ch, cw, ch);
      c.restore();
    }
  }

  async function pgAbertura(c, P) {
    var ed = P.ed, m = ed.m;
    folha(c, P);
    var xE = MX, wE = 690, xS = MX + wE + 56, wS = W - MX - xS;
    tx(c, 'EDITORIAL', xE, 140, 13, 700, C.ouro, { esp: 2.5 });
    var y = para(c, RL.manchete(m, ed.rel.concluida), xE, 196, wE, 44, 700, C.escuro, 52) + 40;
    ed.textos.forEach(function (t, i) {
      if (i === 0) { y = rico(c, t, xE, y, wE, 19, 30, C.texto, C.verde) + 40; return; }
      y = rico(c, t, xE, y, wE, 16.5, 26, C.texto, C.verde) + 34;
    });
    // sumário
    c.fillStyle = C.creme; c.fillRect(xS - 28, 100, wS + 28 + MX, H - 220);
    tx(c, 'NESTA EDIÇÃO', xS, 140, 13, 700, C.ouro, { esp: 2.5 });
    var ys = 196;
    if (!P.sumario.length) para(c, 'As seções da revista (números, ritmo, mapas, chuva, variedades, equipes e talhões) entram assim que o PIMS tiver os primeiros boletins de plantio da safra.', xS, ys - 8, wS, 15, 400, C.suave, 22);
    P.sumario.forEach(function (s) {
      tx(c, s.sec, xS, ys, 30, 700, C.ouro);
      tx(c, String(s.pagina).padStart(2, '0'), xS + wS, ys - 4, 14, 700, C.suave, { al: 'right' });
      var yl = para(c, s.titulo, xS + 52, ys - 8, wS - 90, 16, 700, C.escuro, 21);
      if (s.linha) yl = para(c, s.linha, xS + 52, yl + 21, wS - 90, 12.5, 400, C.suave, 17);
      ys = yl + 38;
    });
    // os três números da edição
    var yN = y + 6, wN = (wE - 2 * 16) / 3;
    [['Área plantada', n0(m.exec), 'ha', 'de ' + n0(m.areaTotal) + ' ha'], ['Concluído', pct(m.pct), '', m.restante > 0 ? 'faltam ' + n0(m.restante) + ' ha' : 'plantio concluído'],
      ['Dias de plantio', m.diasDec === null ? '—' : String(m.diasDec), '', m.ini ? 'desde ' + dc(iso(m.ini)) : 'sem boletins']].forEach(function (k, i) {
      numero(c, { x: xE + i * (wN + 16), y: yN, w: wN, h: 150 }, k[0], k[1], k[2], k[3], null, true);
    });
    // o plantio num olhar: o mapa da situação (fazenda) ou o mosaico das unidades (grupo), no espaço que sobrar
    var yM = yN + 150 + 44, hM = H - 140 - yM - 30;
    if (hM < 240) return;
    var rot = N.rotulosClasse(m.o);
    if (!ed.grupo && ed.mapa) {
      subtitulo(c, 'O plantio num olhar', xE, yM, wE);
      var usado = pintarFazenda(c, { x: xE, y: yM + 30, w: wE, h: hM - 50 }, ed.mapa, function (f) { var t = ed.mapa.talhaoDe(f); return t ? N.COR.s[t.k] : null; }, null, { larguraBorda: 0.8, topo: true });
      legenda(c, [3, 2, 1, 0].map(function (k) { return { nome: rot[k] + ' · ' + m.porClasse[k].n, cor: N.COR.s[k], borda: k === 0 }; }), xE, usado.y + usado.h + 30, wE, 12);
    } else if (ed.grupo) {
      subtitulo(c, 'O plantio num olhar', xE, yM, wE);
      var ls = ed.linhas.slice().sort(function (a, b) { return b.pct - a.pct; }), lh = Math.min(46, (hM - 30) / Math.max(1, ls.length));
      ls.forEach(function (l, i) {
        var yy = yM + 34 + i * lh;
        tx(c, l.nome, xE, yy + lh / 2 + 5, 14, 600, C.texto, { max: 150 });
        c.fillStyle = '#E3E8E4'; rr(c, xE + 160, yy + lh / 2 - 7, wE - 160 - 60, 14, 7); c.fill();
        c.fillStyle = N.COR_FAZENDA[l.u] || C.verde; rr(c, xE + 160, yy + lh / 2 - 7, Math.max(14, (wE - 220) * Math.min(1, l.pct)), 14, 7); c.fill();
        tx(c, pct(l.pct), xE + wE, yy + lh / 2 + 5, 14, 700, C.escuro, { al: 'right' });
      });
    }
  }

  function indicadoresFazenda(ed) {
    var m = ed.m, rel = ed.rel, d = ed.destaques, k = [];
    k.push(['Área plantada', n0(m.exec), 'ha', pct(m.pct) + ' de ' + n0(m.areaTotal) + ' ha', null]);
    k.push(['Faltam', n0(m.restante), 'ha', m.porClasse[0].n + ' ' + plural(m.porClasse[0].n, 'talhão não iniciado', 'talhões não iniciados'), null]);
    k.push(['Dias de plantio', m.diasDec === null ? '—' : String(m.diasDec), '', m.ini ? dc(iso(m.ini)) + ' a ' + dc(iso(m.ult)) + ' · ' + d.diasComOperacao + ' com boletim' : 'sem boletins', null]);
    k.push(['Média por dia', m.media ? n0(m.media) : '—', 'ha', 'nos dias com boletim', null]);
    k.push(['Ritmo · 7 dias', m.media7 ? n0(m.media7) : '—', m.media7 ? 'ha/dia' : '', rel.difMeta !== null ? 'meta ' + n0(m.metaHoje) + ' ha/dia · ' + (rel.difMeta >= 0 ? '+' : '') + pct(rel.difMeta) : 'sem meta cadastrada',
      rel.difMeta === null ? null : rel.difMeta >= 0 ? 'bom' : rel.difMeta > -0.1 ? 'atencao' : 'ruim']);
    k.push(['Previsão de término', rel.concluida ? 'Concluído' : m.previsao ? dc(iso(m.previsao)) : '—', '',
      rel.concluida ? 'em ' + dc(iso(m.ult)) : rel.difPrevisao !== null ? (rel.difPrevisao <= 0 ? (rel.difPrevisao === 0 ? 'na data planejada' : -rel.difPrevisao + ' ' + plural(-rel.difPrevisao, 'dia', 'dias') + ' antes do planejado') : rel.difPrevisao + ' ' + plural(rel.difPrevisao, 'dia', 'dias') + ' depois do planejado') : 'pelo ritmo dos últimos 7 dias',
      rel.concluida ? 'bom' : rel.difPrevisao === null ? null : rel.difPrevisao <= 0 ? 'bom' : rel.difPrevisao <= 3 ? 'atencao' : 'ruim']);
    k.push(['Melhor dia', d.melhorDia ? n0(d.melhorDia.a) : '—', d.melhorDia ? 'ha' : '', d.melhorDia ? 'em ' + dc(d.melhorDia.d) : '—', null]);
    k.push(['Melhor semana', d.melhorSemana ? n0(d.melhorSemana.ha) : '—', d.melhorSemana ? 'ha' : '', d.melhorSemana ? dc(d.melhorSemana.de) + ' a ' + dc(d.melhorSemana.ate) : '—', null]);
    if (ed.grupo) k.push(['Unidades', String(ed.unidades.length), '', ed.linhas.filter(function (l) { return l.concluida; }).length + ' com plantio concluído', null]);
    else k.push(['Chuva no plantio', ed.chuvaPeriodo && ed.temChuva ? n0(ed.chuvaPeriodo.mm) : '—', ed.chuvaPeriodo && ed.temChuva ? 'mm' : '', ed.chuvaPeriodo && ed.temChuva ? ed.chuvaPeriodo.dias + ' ' + plural(ed.chuvaPeriodo.dias, 'dia', 'dias') + ' com chuva · ' + rel.corr.parados + ' ' + plural(rel.corr.parados, 'parado', 'parados') : 'sem dados de chuva', null]);
    k.push(['Talhões plantados', m.porClasse[3].n + ' / ' + m.talhoes.length, '', (m.porClasse[1].n + m.porClasse[2].n) + ' em andamento', null]);
    k.push(['Variedades', String(ed.variedades.filter(function (v) { return v.v !== RL.SEM_VARIEDADE; }).length), '', ed.variedades.length && ed.variedades[0].v !== RL.SEM_VARIEDADE ? 'maior: ' + ed.variedades[0].v : '—', null]);
    k.push(['Equipes', String(ed.equipes.length), '', ed.equipes.length ? 'maior: ' + ed.equipes[0].nome + ' · ' + n0(ed.equipes[0].total) + ' ha' : 'sem boletins', null]);
    return k;
  }
  async function pgNumeros(c, P) {
    var ed = P.ed, rel = ed.rel, m = ed.m;
    folha(c, P);
    var y = abertura(c, P.sec, 'Em números', RL.manchete(m, rel.concluida), 'O plantio ' + (ed.grupo ? 'das unidades' : 'da fazenda') + ' até ' + dl(ed.dataRef) + ', pelos boletins do PIMS e pelas metas cadastradas no COA WEB.');
    var ks = indicadoresFazenda(ed), col = 3, g = 16, wk = (W - 2 * MX - g * (col - 1)) / col, hk = 166;
    ks.forEach(function (k, i) { numero(c, { x: MX + (i % col) * (wk + g), y: y + Math.floor(i / col) * (hk + g), w: wk, h: hk }, k[0], k[1], k[2], k[3], k[4]); });
    y += Math.ceil(ks.length / col) * (hk + g) + 26;
    // esta safra × anteriores
    y = subtitulo(c, 'Esta safra × anteriores', MX, y, W - 2 * MX, 'mesma data do ano (' + dc(iso(m.ult)) + ') e safra inteira');
    var temChuva = rel.comparativo.some(function (x) { return x.chuva && x.chuva.tem; });
    var cols = [{ t: 'Safra', w: 0.18 }, { t: 'Plantado na data', w: 0.14, al: 'right' }, { t: '% da área', w: 0.1, al: 'right' }, { t: 'Início', w: 0.09, al: 'right' }, { t: 'Fim', w: 0.12, al: 'right' },
      { t: 'Duração', w: 0.1, al: 'right' }, { t: 'Área total', w: 0.11, al: 'right' }, { t: 'Média', w: temChuva ? 0.08 : 0.16, al: 'right' }];
    if (temChuva) cols.push({ t: 'Chuva', w: 0.08, al: 'right' });
    var cores = ['#0C5A50', '#eb6834', '#a8327a', '#8c5a2b'];
    var ls = rel.comparativo.map(function (x) {
      var l = [{ t: N.nomeSafra(x.nome) + (x.atual ? ' (atual)' : ''), bola: cores[Math.min(x.anos, 3)], peso: 700 }, n0(x.ateData) + ' ha', pct(x.pctNaData), dc(iso(x.ini)), x.emAndamento ? 'em andamento' : dc(iso(x.fim)),
        x.duracao === null ? '—' : x.duracao + ' d', n0(x.total) + ' ha', x.media ? n0(x.media) + ' ha/d' : '—'];
      if (temChuva) l.push(x.chuva.tem ? n0(x.chuva.mm) + ' mm' : '—');
      return l;
    });
    y = tabela(c, { x: MX, y: y, w: W - 2 * MX }, cols, ls, { lh: 38, destaque: function (j) { return j === 0; } });
    y += 34;
    if (rel.anterior && rel.anterior.difAtual !== null) {
      var a = rel.anterior;
      y = citacao(c, 'Na mesma data do ano, a **' + N.nomeSafra(a.nome) + '** tinha ' + n0(a.ateData) + ' ha plantados: a safra atual está **' + (a.difAtual >= 1 ? N.fmtN(a.difAtual + 1, 1) + '× maior' : pct(Math.abs(a.difAtual)) + (a.difAtual >= 0 ? ' à frente' : ' atrás')) + '**.', MX, y, W - 2 * MX) + 26;
    }
    // situação dos talhões pela área (barra 100%)
    if (y > H - 300) return;
    y = subtitulo(c, 'Situação dos talhões pela área', MX, y, W - 2 * MX, 'dano ' + N.fmtN(m.dano, 1) + ' ha · replantio ' + N.fmtN(m.replantio, 1) + ' ha');
    var rot = N.rotulosClasse(m.o), ww = W - 2 * MX, x = MX, tot = m.areaTotal || 1;
    [3, 2, 1, 0].forEach(function (k) {
      var w = ww * m.porClasse[k].ha / tot; if (w <= 0) return;
      c.fillStyle = N.COR.s[k]; c.fillRect(x, y + 4, Math.max(1, w - 2), 40);
      if (w > 90) tx(c, pct(m.porClasse[k].ha / tot), x + 12, y + 31, 15, 700, k >= 2 ? '#FFFFFF' : C.escuro);
      x += w;
    });
    legenda(c, [3, 2, 1, 0].map(function (k) { return { nome: rot[k] + ' · ' + m.porClasse[k].n + ' ' + plural(m.porClasse[k].n, 'talhão', 'talhões') + ' · ' + n0(m.porClasse[k].ha) + ' ha', cor: N.COR.s[k], borda: k === 0 }; }), MX, y + 76, ww, 12.5);
  }

  async function pgRitmo(c, P) {
    var ed = P.ed, m = ed.m, d = ed.destaques;
    folha(c, P);
    var y = abertura(c, P.sec, 'O ritmo do plantio', d.melhorDia ? 'O melhor dia rendeu ' + n0(d.melhorDia.a) + ' ha; a melhor semana, ' + n0(d.melhorSemana.ha) + ' ha' : 'Sem boletins de plantio',
      'Hectares plantados por dia, com a meta diária cadastrada, e o acumulado comparado ao planejado e às safras anteriores na mesma data do ano.');
    var dias = diasEntre(iso(m.ini), iso(m.ult)), ww = W - 2 * MX;
    y = subtitulo(c, 'Hectares por dia', MX, y, ww);
    var temMeta = m.serie.some(function (x) { return x.meta !== null; });
    legenda(c, [{ nome: 'plantado no dia', cor: C.verde }].concat(temMeta ? [{ nome: 'meta do dia', cor: C.ouro, tipo: 'tracejada' }] : []), MX, y + 6, ww);
    if (dias.length) await grafico(c, { x: MX, y: y + 16, w: ww, h: 460 }, opColunas(dias, dias.map(function (x) { return Math.round((m.porDia[x] || 0)); }), C.verde,
      { largura: ww, meta: temMeta ? m.serie.map(function (x) { return x.meta; }) : null }));
    y += 16 + 460 + 30;
    y = subtitulo(c, 'Acumulado', MX, y, ww);
    var it = [{ nome: 'Realizado', cor: C.verde }];
    if (m.planos.length) it.push({ nome: 'Planejado pelas metas', cor: C.ouro, tipo: 'tracejada' });
    if (m.ritmo && m.restante > 0) it.push({ nome: 'Projeção pelo ritmo', cor: '#9AA79F', tipo: 'tracejada' });
    (m.comparativos || []).forEach(function (cp, i) { it.push({ nome: N.nomeSafra(cp.nome), cor: N.COR_COMPARATIVO[i] || N.COR_COMPARATIVO[1] }); });
    legenda(c, it, MX, y + 6, ww);
    if (m.ini) await grafico(c, { x: MX, y: y + 16, w: ww, h: 460 }, N.opcoesAcumulado(m, 1));
    y += 16 + 460 + 34;
    // destaques
    var cx = [['Melhor dia', d.melhorDia ? n0(d.melhorDia.a) + ' ha' : '—', d.melhorDia ? dc(d.melhorDia.d) : ''],
      ['Melhor semana', d.melhorSemana ? n0(d.melhorSemana.ha) + ' ha' : '—', d.melhorSemana ? dc(d.melhorSemana.de) + ' a ' + dc(d.melhorSemana.ate) : ''],
      ['Maior sequência', d.maiorSequencia ? d.maiorSequencia.dias + ' ' + plural(d.maiorSequencia.dias, 'dia', 'dias') : '—', d.maiorSequencia ? dc(d.maiorSequencia.de) + ' a ' + dc(d.maiorSequencia.ate) : ''],
      ['Dias sem boletim', String(d.diasParados), 'entre o 1º e o último dia']];
    var wc = (ww - 3 * 16) / 4;
    cx.forEach(function (k, i) { numero(c, { x: MX + i * (wc + 16), y: y, w: wc, h: 128 }, k[0], k[1], '', k[2], null, true); });
  }

  /** Mapa do plantio: situação dos talhões e a semana em que cada um começou. */
  async function pgMapa(c, P) {
    var ed = P.ed, m = ed.m, mp = ed.mapa;
    folha(c, P);
    var y = abertura(c, P.sec, 'O mapa do plantio', m.porClasse[3].n + ' de ' + m.talhoes.length + ' talhões plantados', 'À esquerda, a situação de cada talhão pelos boletins; à direita, a semana em que o plantio dele começou.');
    if (!mp) { tx(c, 'A fazenda não tem limites de talhões no módulo Mapas.', W / 2, y + 200, 15, 500, C.fraco, { al: 'center' }); return; }
    var ww = W - 2 * MX, lado = mp.retrato || (!mp.quadros && aspecto(mp.pr) < 1.15); // fazenda "em pé": mapas lado a lado
    var rot = N.rotulosClasse(m.o);
    var porK = function (f) { var t = mp.talhaoDe(f); return t ? N.COR.s[t.k] : null; };
    var porSemana = function (f) { var t = mp.talhaoDe(f); if (!t) return null; var n = ed.semanas.de[t.u + '|' + t.t]; return n ? ed.semanas.classes[n - 1].cor : '#EEF1EE'; };
    var cod = function (f) { return f.properties.talhao; };
    var hDisp = H - 120 - y, r1, r2;
    if (lado) { var wm = (ww - 30) / 2; r1 = { x: MX, y: y + 30, w: wm, h: hDisp - 200 }; r2 = { x: MX + wm + 30, y: y + 30, w: wm, h: hDisp - 200 }; }
    else { var hm = (hDisp - 2 * 110) / 2; r1 = { x: MX, y: y + 30, w: ww, h: hm }; r2 = { x: MX, y: y + 30 + hm + 110, w: ww, h: hm }; }
    subtitulo(c, 'Situação dos talhões', r1.x, r1.y - 8, r1.w);
    pintarFazenda(c, { x: r1.x, y: r1.y + 22, w: r1.w, h: r1.h - 22 }, mp, porK, cod, { rosa: true });
    var yL1 = r1.y + r1.h + 24;
    legenda(c, [3, 2, 1, 0].map(function (k) { return { nome: rot[k] + ' · ' + m.porClasse[k].n, cor: N.COR.s[k], borda: k === 0 }; }), r1.x, yL1, r1.w);
    subtitulo(c, 'Semana do início do plantio', r2.x, r2.y - 8, r2.w);
    pintarFazenda(c, { x: r2.x, y: r2.y + 22, w: r2.w, h: r2.h - 22 }, mp, porSemana, cod, { rosa: true });
    legenda(c, ed.semanas.classes.map(function (s) { return { nome: s.rotulo, cor: s.cor }; }).concat([{ nome: 'não iniciado', cor: '#EEF1EE', borda: true }]), r2.x, r2.y + r2.h + 24, r2.w, 12);
    if (mp.semPoligono.length) tx(c, 'Sem polígono no mapa: ' + mp.semPoligono.map(function (t) { return t.t; }).join(', '), MX, H - 92, 11.5, 500, C.fraco, { max: ww });
  }

  async function pgChuva(c, P) {
    var ed = P.ed, ch = ed.chuvaPeriodo;
    folha(c, P);
    var ww = W - 2 * MX;
    var y = abertura(c, P.sec, 'A chuva e o plantio', ed.temChuva && ch ? n0(ch.mm) + ' mm em ' + ch.dias + ' ' + plural(ch.dias, 'dia', 'dias') + ' de chuva desde o início do plantio' : 'A chuva por talhão no plantio',
      ed.temChuva ? 'Chuva diária da fazenda (média dos pluviômetros da ZEUS) nos 15 dias antes do plantio e durante ele, alinhada aos hectares plantados em cada dia.' : 'A chuva diária dos pluviômetros da fazenda não está disponível; abaixo, a chuva por talhão da ZEUS.');
    if (ed.temChuva) y = await chuvaDaFazenda(c, ed, y, ww);
    await chuvaDosTalhoesPg(c, ed, y, ww);
  }
  /** Chuva diária da fazenda alinhada aos hectares por dia e os quatro números da correlação. Devolve o y livre. */
  async function chuvaDaFazenda(c, ed, y, ww) {
    var m = ed.m, cr = ed.rel.corr, ch = ed.chuvaPeriodo;
    var de = RL.somarDias(iso(m.ini), -15), ate = iso(ed.hoje), dias = diasEntre(de, ate);
    y = subtitulo(c, 'Chuva por dia (mm)', MX, y, ww);
    await grafico(c, { x: MX, y: y, w: ww, h: 230 }, opColunas(dias, dias.map(function (d) { return Math.round((ed.chuvaU[d] || 0) * 10) / 10; }), C.chuva, { largura: ww, casas: 0 }));
    y += 230 + 18;
    y = subtitulo(c, 'Hectares plantados por dia', MX, y, ww);
    await grafico(c, { x: MX, y: y, w: ww, h: 210 }, opColunas(dias, dias.map(function (d) { return Math.round(m.porDia[d] || 0); }), C.verde, { largura: ww }));
    y += 210 + 30;
    // correlação
    var wc = (ww - 3 * 16) / 4;
    [['Chuva no plantio', ch ? n0(ch.mm) + ' mm' : '—', ch ? ch.dias + ' ' + plural(ch.dias, 'dia', 'dias') + ' com 1 mm ou mais' : ''],
      ['Maior chuva', ch && ch.maior ? n0(ch.maior.mm) + ' mm' : '—', ch && ch.maior ? 'em ' + dc(ch.maior.d) : ''],
      ['Média com chuva', cr.comChuva.media !== null ? n0(cr.comChuva.media) + ' ha/dia' : '—', cr.comChuva.dias + ' ' + plural(cr.comChuva.dias, 'dia', 'dias') + ' com mais de 5 mm'],
      ['Média sem chuva', cr.semChuva.media !== null ? n0(cr.semChuva.media) + ' ha/dia' : '—', cr.parados + ' ' + plural(cr.parados, 'dia parado', 'dias parados') + ' pela chuva']].forEach(function (k, i) {
      numero(c, { x: MX + i * (wc + 16), y: y, w: wc, h: 128 }, k[0], k[1], '', k[2], null, true);
    });
    return y + 128 + 34;
  }
  /** Chuva acumulada por talhão (mapa) e a chuva nos dias depois do plantio de cada talhão. */
  async function chuvaDosTalhoesPg(c, ed, y, ww) {
    var m = ed.m;
    if (ed.chT && ed.mapa) {
      var valores = {}; ed.chuvaTal.forEach(function (l) { if (l.periodo !== null) valores[l.u + '|' + l.t] = l.periodo; });
      var lista = Object.keys(valores).map(function (k) { return valores[k]; });
      var fimT = ed.chT.faz.hoje, nDias = RL.difDias(iso(m.ini), fimT) + 1;
      // a mesma régua de cores da Chuva por talhão (oito degraus tirados dos valores)
      var esc = CL.escalaDoPeriodo(Math.max(2, nDias), lista);
      var corDe = function (f) { var t = ed.mapa.talhaoDe(f); if (!t) return null; var v = valores[t.u + '|' + t.t]; return v === undefined ? CL.COR_SEM_DADO : esc.cor(v); };
      var hM = H - 130 - y - 60, wM = ww * 0.62;
      subtitulo(c, 'Chuva acumulada por talhão', MX, y, wM, dc(iso(m.ini)) + ' a ' + dc(fimT) + ' · ZEUS');
      pintarFazenda(c, { x: MX, y: y + 24, w: wM, h: hM }, ed.mapa, corDe, function (f) { var t = ed.mapa.talhaoDe(f); var v = t ? valores[t.u + '|' + t.t] : undefined; return v === undefined ? '' : n0(v); }, { rosa: true, maxFonte: 11 });
      legenda(c, esc.rotulos.map(function (r, i) { return { nome: r + ' mm', cor: esc.cores[i], borda: i === 0 }; }), MX, y + 24 + hM + 26, wM, 11.5);
      // ao lado: depois do plantio
      var xL = MX + wM + 30, wL = ww - wM - 30, pp = ed.posPlantio, yL = y;
      yL = subtitulo(c, 'Depois do plantio', xL, yL, wL);
      yL = para(c, 'A chuva por talhão vem da tabela da ZEUS, carregada em lotes: o último dia com dado é ' + dc(fimT) + '.', xL, yL + 6, wL, 12.5, 500, C.fraco, 18) + 30;
      if (pp && pp.talhoes) {
        yL = rico(c, 'Nos **' + RL.DIAS_POS_PLANTIO + ' dias** seguintes ao início do plantio, os ' + pp.talhoes + ' talhões com a janela completa receberam em média **' + n0(pp.media) + ' mm**.', xL, yL, wL, 14.5, 22, C.texto) + 30;
        if (pp.poucaChuva.length) {
          tx(c, 'MENOS DE ' + RL.POUCA_CHUVA_POS + ' MM NA JANELA', xL, yL, 11, 700, C.atencao, { esp: 1 });
          yL += 10;
          var cabem = Math.max(3, Math.floor((H - 230 - yL) / 26));
          yL = tabela(c, { x: xL, y: yL, w: wL }, [{ t: 'Talhão', w: 0.3 }, { t: 'Plantio', w: 0.3, al: 'right' }, { t: 'mm', w: 0.4, al: 'right' }],
            pp.poucaChuva.slice(0, cabem).map(function (l) { return [l.t, dc(l.ini), N.fmtN(l.depois, 1)]; }), { lh: 26, px: 12.5 });
          if (pp.poucaChuva.length > cabem) { tx(c, '+ ' + (pp.poucaChuva.length - cabem) + ' talhões (lista completa no talhão a talhão)', xL, yL + 18, 11.5, 500, C.fraco, { max: wL }); yL += 18; }
        } else yL = para(c, 'Nenhum talhão teve menos de ' + RL.POUCA_CHUVA_POS + ' mm na janela.', xL, yL, wL, 14, 500, C.bom, 20);
        if (pp.aguardando) para(c, pp.aguardando + ' ' + plural(pp.aguardando, 'talhão plantado', 'talhões plantados') + ' sem os ' + RL.DIAS_POS_PLANTIO + ' dias completos na tabela ainda não ' + plural(pp.aguardando, 'entra', 'entram') + ' na conta.', xL, Math.min(H - 150, yL + 34), wL, 12, 500, C.fraco, 17);
      } else para(c, 'Ainda não há talhão com ' + RL.DIAS_POS_PLANTIO + ' dias de chuva registrada depois do plantio.', xL, yL + 8, wL, 14, 500, C.suave, 20);
    } else {
      para(c, 'A chuva por talhão (tabela da ZEUS) não está disponível para esta fazenda' + (ed.semCategoriaChuva ? ' com o seu acesso (categoria Chuva por talhão).' : '.'), MX, y + 10, ww, 14, 500, C.fraco, 20);
    }
  }

  var MAX_MAPAS = 8;
  /** Galeria dos mapas de chuva salvos no módulo Mapas (até 4 por página; os MAX_MAPAS mais recentes). */
  function pgMapasSalvos(lista, primeira) {
    return async function (c, P) {
      var ed = P.ed;
      folha(c, P);
      var nM = ed.mapasSalvos.length, mostrados = Math.min(nM, MAX_MAPAS);
      var y = primeira ? abertura(c, P.sec, 'Mapas de chuva do período', nM + ' ' + plural(nM, 'mapa salvo', 'mapas salvos') + ' no módulo Mapas' + (nM > mostrados ? ' (os ' + mostrados + ' mais recentes aqui)' : ''),
        'Os mapas de chuva (interpolação dos pluviômetros) salvos para a fazenda com período dentro do plantio, do mais antigo ao mais novo.') : 112;
      var ww = W - 2 * MX, g = 26, n = lista.length, colunas = n === 1 ? 1 : 2, linhasN = Math.ceil(n / colunas);
      var wq = (ww - g * (colunas - 1)) / colunas, hq = (H - 130 - y - g * (linhasN - 1)) / linhasN;
      for (var i = 0; i < n; i++) {
        var mp = lista[i], r = { x: MX + (i % colunas) * (wq + g), y: y + Math.floor(i / colunas) * (hq + g), w: wq, h: hq };
        var img = await P.imagemMapa(mp);
        c.fillStyle = C.creme; rr(c, r.x, r.y, r.w, r.h - 70, 8); c.fill();
        if (img) { var a = caber(c, img, { x: r.x + 8, y: r.y + 8, w: r.w - 16, h: r.h - 86 }); c.strokeStyle = C.linha; c.lineWidth = 1; c.strokeRect(a.x, a.y, a.w, a.h); }
        else tx(c, 'Imagem indisponível', r.x + r.w / 2, r.y + (r.h - 70) / 2, 13, 500, C.fraco, { al: 'center' });
        tx(c, (mp.tipo === 'variedade' ? 'Mapa de variedade' : dc(mp.inicio) + (mp.fim && mp.fim !== mp.inicio ? ' a ' + dc(mp.fim) : '')), r.x, r.y + r.h - 40, 15, 700, C.escuro, { max: r.w });
        var linha = mp.tipo === 'variedade' ? (mp.titulo || '') : (mp.media !== null && mp.media !== undefined ? 'média ' + N.fmtN(mp.media, 1) + ' mm' : '') + (mp.titulo ? (mp.media !== null && mp.media !== undefined ? ' · ' : '') + mp.titulo : '');
        tx(c, linha, r.x, r.y + r.h - 18, 12.5, 500, C.suave, { max: r.w });
      }
    };
  }

  /** Janela de plantio por variedade (barras do 1º ao último dia), desenhada à mão. */
  function janelaVariedades(c, r, vs, cores, de, ate) {
    var dias = Math.max(1, RL.difDias(de, ate) + 1), xl = r.x + 190, wl = r.w - 190 - 70, lh = Math.min(30, (r.h - 30) / Math.max(1, vs.length));
    var x = function (d) { return xl + RL.difDias(de, d) / dias * wl; };
    // grade de semanas
    for (var i = 0; i <= dias; i += 7) { var d = RL.somarDias(de, i), gx = x(d); c.fillStyle = C.grade; c.fillRect(gx, r.y, 1, lh * vs.length); tx(c, dc(d), gx, r.y + lh * vs.length + 18, 11, 500, C.fraco, { al: 'center' }); }
    vs.forEach(function (v, j) {
      var y = r.y + j * lh;
      tx(c, v.v, r.x, y + lh / 2 + 5, 12.5, 600, C.texto, { max: 180 });
      if (!v.ini) { tx(c, 'não iniciada', xl, y + lh / 2 + 5, 11.5, 500, C.fraco); return; }
      var x0 = x(v.ini), x1 = x(RL.somarDias(v.fim, 1));
      c.fillStyle = cores[v.v] || C.verde; rr(c, x0, y + lh * 0.22, Math.max(6, x1 - x0), lh * 0.56, 3); c.fill();
      tx(c, n0(v.exec) + ' ha', r.x + r.w, y + lh / 2 + 5, 12, 600, C.suave, { al: 'right' });
    });
  }
  async function pgVariedades(c, P) {
    var ed = P.ed, m = ed.m, vs = ed.variedades, mp = ed.mapa;
    folha(c, P);
    var nV = vs.filter(function (v) { return v.v !== RL.SEM_VARIEDADE; }).length;
    var y = abertura(c, P.sec, 'Variedades', nV + ' ' + plural(nV, 'variedade', 'variedades') + (vs.length && vs[0].v !== RL.SEM_VARIEDADE ? '; a ' + vs[0].v + ' ocupa ' + pct(vs[0].prev / m.areaTotal) + ' da área' : ''),
      'Cada talhão com a cor da variedade (as mesmas cores do Mapa de variedade do módulo Mapas), a área prevista e plantada de cada uma e a janela em que foi plantada.');
    var ww = W - 2 * MX;
    if (mp) {
      var hM = 560, wM = ww * 0.6;
      var corDe = function (f) { var t = mp.talhaoDe(f); if (!t) return null; var v = RL.limparVariedade(t.variedade) || RL.SEM_VARIEDADE; return ed.cores[v]; };
      pintarFazenda(c, { x: MX, y: y, w: wM, h: hM }, mp, corDe, function (f) { return f.properties.talhao; }, { rosa: true });
      var xL = MX + wM + 30, wL = ww - wM - 30, yL = subtitulo(c, 'Legenda', xL, y + 10, wL);
      vs.slice(0, 16).forEach(function (v) {
        c.fillStyle = ed.cores[v.v]; rr(c, xL, yL - 11, 14, 14, 3); c.fill();
        tx(c, v.v, xL + 22, yL, 13, 600, C.texto, { max: wL - 100 });
        tx(c, pct(v.prev / m.areaTotal), xL + wL, yL, 13, 600, C.suave, { al: 'right' });
        yL += 26;
      });
      if (vs.length > 16) tx(c, '+ ' + (vs.length - 16) + ' variedades', xL, yL, 12, 500, C.fraco);
      y += hM + 30;
    }
    y = subtitulo(c, 'Área por variedade', MX, y, ww);
    var ls = vs.slice(0, 12).map(function (v) {
      return [{ t: v.v, bola: ed.cores[v.v], peso: 700 }, String(v.talhoes), n0(v.prev) + ' ha', n0(v.exec) + ' ha', { barra: v.pct, t: pct(v.pct), cor: ed.cores[v.v] }, v.ini ? dc(v.ini) + ' a ' + dc(v.fim) : 'não iniciada'];
    });
    y = tabela(c, { x: MX, y: y, w: ww }, [{ t: 'Variedade', w: 0.27 }, { t: 'Talhões', w: 0.09, al: 'right' }, { t: 'Prevista', w: 0.12, al: 'right' }, { t: 'Plantada', w: 0.12, al: 'right' }, { t: '% plantado', w: 0.22 }, { t: 'Janela', w: 0.18, al: 'right' }], ls, { lh: 30 });
    y += 30;
    var comIni = vs.filter(function (v) { return v.v !== RL.SEM_VARIEDADE; }).slice(0, 12);
    if (m.ini && comIni.length && y < H - 260) {
      y = subtitulo(c, 'Janela de plantio por variedade', MX, y, ww);
      janelaVariedades(c, { x: MX, y: y + 4, w: ww, h: H - 140 - y }, comIni, ed.cores, iso(m.ini), iso(m.ult));
    }
  }

  async function pgEquipes(c, P) {
    var ed = P.ed, m = ed.m, eq = ed.equipes;
    folha(c, P);
    var y = abertura(c, P.sec, 'Equipes', eq.length ? eq.length + ' ' + plural(eq.length, 'equipe plantou', 'equipes plantaram') + ' ' + n0(soma(eq, function (e) { return e.total; })) + ' ha' : 'Sem boletins de plantio',
      'Área apontada por equipe nos boletins do PIMS: total, dias com boletim, média por dia trabalhado e o melhor dia de cada uma.');
    var ww = W - 2 * MX, dias = diasEntre(iso(m.ini), iso(m.ult));
    var top = eq.slice(0, 7), resto = eq.slice(7);
    var series = top.map(function (e, i) { return { name: e.nome, type: 'bar', stack: 'e', barMaxWidth: 26, itemStyle: { color: COR_EQUIPES[i] }, data: dias.map(function (d) { return Math.round(e.porDia[d] || 0); }) }; });
    if (resto.length) series.push({ name: 'Outras', type: 'bar', stack: 'e', itemStyle: { color: '#B3C2BC' }, data: dias.map(function (d) { return Math.round(soma(resto, function (e) { return e.porDia[d] || 0; })); }) });
    y = subtitulo(c, 'Hectares por dia, por equipe', MX, y, ww);
    legenda(c, top.map(function (e, i) { return { nome: e.nome, cor: COR_EQUIPES[i] }; }).concat(resto.length ? [{ nome: 'Outras', cor: '#B3C2BC' }] : []), MX, y + 6, ww);
    var hG = ed.mapa && !ed.grupo ? 340 : 420;
    if (dias.length) await grafico(c, { x: MX, y: y + 18, w: ww, h: hG }, N.opt(Object.assign({ grid: GRADE, series: series }, eixos(dias))));
    y += 18 + hG + 30;
    y = subtitulo(c, 'Resumo por equipe', MX, y, ww);
    y = tabela(c, { x: MX, y: y, w: ww }, [{ t: 'Equipe', w: 0.26 }, { t: 'Total', w: 0.11, al: 'right' }, { t: 'Dias', w: 0.08, al: 'right' }, { t: 'Média/dia', w: 0.12, al: 'right' }, { t: 'Melhor dia', w: 0.17, al: 'right' }, { t: 'Talhões', w: 0.1, al: 'right' }, { t: 'Últimos 7 dias', w: 0.16, al: 'right' }],
      eq.slice(0, 12).map(function (e, i) { return [{ t: e.nome, bola: i < 7 ? COR_EQUIPES[i] : '#B3C2BC', peso: 700 }, n0(e.total) + ' ha', String(e.dias), n0(e.media) + ' ha', e.melhor ? n0(e.melhor.a) + ' ha · ' + dc(e.melhor.d) : '—', String(e.talhoes), n0(e.ult7) + ' ha']; }), { lh: 32 }) + 30;
    // quem plantou cada talhão (a equipe que mais apontou nele)
    var hM = H - 150 - y - 30;
    if (ed.grupo || !ed.mapa || hM < 260) return;
    var corEq = {}; top.forEach(function (e, i) { corEq[e.nome] = COR_EQUIPES[i]; });
    var porTal = {}; ed.tal.forEach(function (t) { porTal[t.u + '|' + t.t] = t.equipes[0] || null; });
    y = subtitulo(c, 'Equipe que mais plantou em cada talhão', MX, y, ww);
    pintarFazenda(c, { x: MX, y: y, w: ww, h: hM }, ed.mapa, function (f) { var t = ed.mapa.talhaoDe(f); if (!t) return null; var e = porTal[t.u + '|' + t.t]; return e ? (corEq[e] || '#B3C2BC') : '#EEF1EE'; },
      function (f) { return f.properties.talhao; }, { rosa: true, maxFonte: 11 });
    legenda(c, top.map(function (e, i) { return { nome: e.nome, cor: COR_EQUIPES[i] }; }).concat(resto.length ? [{ nome: 'Outras', cor: '#B3C2BC' }] : []).concat([{ nome: 'não iniciado', cor: '#EEF1EE', borda: true }]), MX, y + hM + 22, ww);
  }

  /** Talhão a talhão: uma linha por talhão (várias páginas se precisar). */
  var COLS_TALHAO = [{ t: 'Talhão', w: 0.08 }, { t: 'Setor', w: 0.12 }, { t: 'Área', w: 0.08, al: 'right' }, { t: 'Plantado', w: 0.15 }, { t: 'Início', w: 0.07, al: 'right' }, { t: 'Fim', w: 0.07, al: 'right' },
    { t: 'Variedade', w: 0.16 }, { t: 'Equipe', w: 0.09 }, { t: 'mm antes', w: 0.06, al: 'right' }, { t: 'mm depois', w: 0.06, al: 'right' }, { t: 'mm desde', w: 0.06, al: 'right' }];
  function linhasTalhao(ed) {
    var ch = {}; ed.chuvaTal.forEach(function (l) { ch[l.u + '|' + l.t] = l; });
    return ed.tal.slice().sort(function (a, b) { var x = parseInt(a.t, 10), y = parseInt(b.t, 10); return (isNaN(x) ? 1e9 : x) - (isNaN(y) ? 1e9 : y) || (a.t < b.t ? -1 : 1); }).map(function (t) {
      var l = ch[t.u + '|' + t.t] || {};
      var mm = function (v) { return v === null || v === undefined ? '—' : N.fmtN(v, 0); };
      return [t.t, t.setor ? N.titulo(t.setor) : '—', N.fmtN(t.base, 1), { barra: t.perc, t: pct(t.perc), cor: N.COR.s[Math.max(1, t.k)] }, t.ini ? dc(t.ini) : '—', t.fim && t.perc >= 0.99 ? dc(t.fim) : t.ini ? '…' : '—',
        { t: t.variedade || '—', bola: ed.cores[t.variedade || RL.SEM_VARIEDADE] }, t.equipes[0] || '—', mm(l.antes), { t: mm(l.depois), cor: l.depois !== null && l.depois !== undefined && l.depois < RL.POUCA_CHUVA_POS ? C.atencao : C.texto, peso: 600 }, mm(l.desde)];
    });
  }
  var Y_TALHOES = 318, LH_TALHAO = 29;
  function finaTalhoes(ed) {
    return 'Área do talhão (cadastro menos dano), plantado pelos boletins, início e fim do plantio, variedade, a equipe que mais plantou e a chuva da ZEUS por talhão (mm): 7 dias antes do início, ' +
      RL.DIAS_POS_PLANTIO + ' dias depois e desde o início' + (ed.chT ? ', até ' + dc(ed.chT.faz.hoje) + ' (último dia na tabela).' : '.');
  }
  function pgTalhoes(ls, primeira, lh) {
    return async function (c, P) {
      var ed = P.ed;
      folha(c, P);
      var y = primeira ? Math.max(Y_TALHOES, abertura(c, P.sec, 'Talhão a talhão', ed.tal.length + ' talhões na safra', finaTalhoes(ed))) : 112;
      tabela(c, { x: MX, y: y, w: W - 2 * MX }, COLS_TALHAO, ls, { lh: lh, px: lh < 27 ? 11.5 : 12 });
    };
  }
  /**
   * Linhas por página: o menor número de páginas (com a linha baixando de 29 até 25 px para caber) e, nele, a linha
   * mais alta que couber. A 1ª página tem o título da seção e leva menos linhas.
   */
  function paginarTalhoes(ls) {
    var util = function (y0, lh) { return Math.floor((H - 130 - y0 - 24) / lh); };
    var cap = function (lh, n) { return util(Y_TALHOES, lh) + (n - 1) * util(112, lh); };
    var nPag = 1; while (cap(25, nPag) < ls.length) nPag++;
    var lh = LH_TALHAO; while (lh > 25 && cap(lh, nPag) < ls.length) lh--;
    var grupos = [ls.slice(0, util(Y_TALHOES, lh))];
    for (var k = util(Y_TALHOES, lh); k < ls.length; k += util(112, lh)) grupos.push(ls.slice(k, k + util(112, lh)));
    return { lh: lh, grupos: grupos };
  }

  async function pgPrevisao(c, P) {
    var ed = P.ed, pv = ed.previsao;
    folha(c, P);
    var y = abertura(c, P.sec, 'Os próximos dias', 'Previsão de ' + n0(pv.resumo.mm) + ' mm até ' + dc(pv.resumo.ate) + ' (média das fontes)',
      'A previsão mais recente de cada fonte do módulo Previsão do Tempo para os próximos ' + pv.dias.length + ' dias: chuva (mm), chance de chuva e temperaturas.');
    var ww = W - 2 * MX, cores = { zeus: '#0C5A50', metno: '#2a78d6', visualcrossing: '#DB8A08' };
    var series = pv.fontes.map(function (f) { return { name: f.nome, type: 'bar', barMaxWidth: 30, itemStyle: { color: cores[f.fonte] || C.suave, borderRadius: [3, 3, 0, 0] },
      label: { show: true, position: 'top', fontSize: 11, color: C.texto, formatter: function (p) { return p.value ? N.fmtN(p.value, 1) : ''; } },
      data: pv.dias.map(function (d) { var x = f.dias.filter(function (k) { return k.d === d; })[0]; return x ? Math.round((x.mm || 0) * 10) / 10 : null; }) }; });
    y = subtitulo(c, 'Chuva prevista por dia (mm)', MX, y, ww);
    legenda(c, pv.fontes.map(function (f) { return { nome: f.nome, cor: cores[f.fonte] || C.suave }; }), MX, y + 6, ww);
    var nomesDia = pv.dias.map(function (d) { var x = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); return x.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') + ' ' + dc(d); });
    await grafico(c, { x: MX, y: y + 18, w: ww, h: 520 }, N.opt({ grid: GRADE, series: series,
      xAxis: { type: 'category', data: nomesDia, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linha } }, axisLabel: { color: C.suave, fontSize: 12 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: C.grade } }, axisLabel: { color: C.fraco, fontSize: 11 } } }));
    y += 18 + 520 + 34;
    y = subtitulo(c, 'Dia a dia', MX, y, ww);
    var cols = [{ t: 'Fonte', w: 0.2 }].concat(pv.dias.map(function (d, i) { return { t: nomesDia[i], w: 0.8 / pv.dias.length, al: 'right' }; }));
    var ls = [];
    pv.fontes.forEach(function (f) {
      var dia = function (d) { return f.dias.filter(function (k) { return k.d === d; })[0]; };
      ls.push([{ t: f.nome + ' · mm', bola: cores[f.fonte], peso: 700 }].concat(pv.dias.map(function (d) { var x = dia(d); return x ? N.fmtN(x.mm || 0, 1) : '—'; })));
      if (f.dias.some(function (k) { return k.p !== null && k.p !== undefined; })) ls.push([{ t: '   chance', cor: C.suave }].concat(pv.dias.map(function (d) { var x = dia(d); return x && x.p !== null && x.p !== undefined ? n0(x.p) + '%' : '—'; })));
      if (f.dias.some(function (k) { return k.tx !== undefined && k.tx !== null; })) ls.push([{ t: '   máx / mín', cor: C.suave }].concat(pv.dias.map(function (d) { var x = dia(d); return x && x.tx !== null && x.tx !== undefined ? n0(x.tx) + '° / ' + n0(x.tn) + '°' : '—'; })));
    });
    y = tabela(c, { x: MX, y: y, w: ww }, cols, ls, { lh: 30, px: 12.5 });
    var txt = pv.fontes.map(function (f, i) { return f.nome + ' soma **' + N.fmtN(pv.totais[i], 1) + ' mm**'; }).join(', ');
    citacao(c, 'Até ' + dc(pv.resumo.ate) + ': ' + txt + '. Quando as fontes discordam, vale acompanhar a atualização seguinte antes de decidir a operação.', MX, y + 34, ww);
  }

  // ---------------------------------------------------------------- grupo
  async function pgUnidades(c, P) {
    var ed = P.ed, ls = ed.linhas.slice().sort(function (a, b) { return b.pct - a.pct; });
    folha(c, P);
    var y = abertura(c, P.sec, 'As unidades', 'Mais adiantada: ' + ls[0].nome + ' (' + pct(ls[0].pct) + ')', 'O plantio de cada unidade: área plantada, ritmo dos últimos 7 dias, previsão de término e chuva desde o início do plantio.');
    var ww = W - 2 * MX;
    var cats = ls.map(function (l) { return l.nome; }).reverse();
    var lsr = ls.slice().reverse();
    await grafico(c, { x: MX, y: y, w: ww, h: 520 }, N.opt({
      grid: { left: 8, right: 150, top: 10, bottom: 10, containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: C.grade } }, axisLabel: { color: C.fraco, fontSize: 11, formatter: function (v) { return n0(v); } } },
      yAxis: { type: 'category', data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: C.linha } }, axisLabel: { color: C.texto, fontSize: 14, fontWeight: 600 } },
      series: [{ type: 'bar', stack: 'a', barMaxWidth: 30, itemStyle: { color: C.verde }, data: lsr.map(function (l) { return Math.round(l.exec); }) },
        { type: 'bar', stack: 'a', itemStyle: { color: '#E3E8E4', borderRadius: [0, 4, 4, 0] }, data: lsr.map(function (l) { return Math.round(l.restante); }),
          label: { show: true, position: 'right', fontSize: 13, color: C.texto, formatter: function (p) { var l = lsr[p.dataIndex]; return pct(l.pct) + '  ·  ' + n0(l.exec) + ' / ' + n0(l.areaTotal) + ' ha'; } } }]
    }));
    legenda(c, [{ nome: 'plantado', cor: C.verde }, { nome: 'a plantar', cor: '#E3E8E4', borda: true }], MX, y + 540, ww);
    y += 590;
    y = subtitulo(c, 'Quadro das unidades', MX, y, ww);
    // a chuva da tabela é a mesma das outras páginas: do início do plantio da unidade até hoje
    var chuvaDe = {}; ed.unidades.forEach(function (x) { if (x.temChuva && x.chuvaPeriodo) chuvaDe[x.u] = x.chuvaPeriodo; });
    var cols = [{ t: 'Unidade', w: 0.18 }, { t: '% plantado', w: 0.1, al: 'right' }, { t: 'Plantado', w: 0.11, al: 'right' }, { t: 'Área', w: 0.11, al: 'right' }, { t: 'Ritmo 7d', w: 0.11, al: 'right' },
      { t: 'Meta', w: 0.1, al: 'right' }, { t: 'Previsão', w: 0.14, al: 'right' }, { t: 'Chuva', w: 0.15, al: 'right' }];
    tabela(c, { x: MX, y: y, w: ww }, cols, ls.map(function (l) {
      var prev = l.concluida ? 'concluído' : l.previsao ? dc(iso(l.previsao)) + (l.difPrevisao !== null ? (l.difPrevisao > 0 ? ' (+' + l.difPrevisao + ' d)' : l.difPrevisao < 0 ? ' (' + l.difPrevisao + ' d)' : ' (no prazo)') : '') : '—';
      return [{ t: l.nome, bola: N.COR_FAZENDA[l.u] || C.fraco, peso: 700 }, pct(l.pct), n0(l.exec) + ' ha', n0(l.areaTotal) + ' ha', l.media7 ? n0(l.media7) + ' ha/d' : '—', l.metaHoje ? n0(l.metaHoje) + ' ha/d' : '—',
        { t: prev, cor: l.concluida ? C.bom : l.difPrevisao > 3 ? C.ruim : l.difPrevisao > 0 ? C.atencao : C.texto, peso: 600 }, chuvaDe[l.u] ? n0(chuvaDe[l.u].mm) + ' mm · ' + chuvaDe[l.u].dias + ' d' : '—'];
    }), { lh: 36 });
  }
  async function pgRitmoGrupo(c, P) {
    var ed = P.ed, m = ed.m;
    folha(c, P);
    var y = abertura(c, P.sec, 'O ritmo do grupo', ed.destaques.melhorDia ? 'O melhor dia do grupo somou ' + n0(ed.destaques.melhorDia.a) + ' ha (' + dc(ed.destaques.melhorDia.d) + ')' : 'Sem boletins',
      'Hectares plantados por dia em cada unidade e o acumulado do grupo comparado ao planejado e às safras anteriores.');
    var ww = W - 2 * MX, dias = diasEntre(iso(m.ini), iso(m.ult));
    y = subtitulo(c, 'Hectares por dia, por unidade', MX, y, ww);
    var us = ed.unidades;
    legenda(c, us.map(function (x) { return { nome: N.titulo(x.u), cor: N.COR_FAZENDA[x.u] || C.fraco }; }), MX, y + 6, ww);
    await grafico(c, { x: MX, y: y + 18, w: ww, h: 470 }, N.opt(Object.assign({ grid: GRADE, series: us.map(function (x) {
      return { name: N.titulo(x.u), type: 'bar', stack: 'u', barMaxWidth: 26, itemStyle: { color: N.COR_FAZENDA[x.u] || C.fraco }, data: dias.map(function (d) { return Math.round(x.m.porDia[d] || 0); }) };
    }) }, eixos(dias))));
    y += 18 + 470 + 34;
    y = subtitulo(c, 'Acumulado do grupo', MX, y, ww);
    if (m.ini) await grafico(c, { x: MX, y: y + 10, w: ww, h: H - 150 - y }, N.opcoesAcumulado(m, 1));
  }
  async function pgMosaico(c, P) {
    var ed = P.ed;
    folha(c, P);
    var y = abertura(c, P.sec, 'O mapa das unidades', 'A situação dos talhões em cada unidade', 'Cada unidade na escala que cabe no quadro (as escalas são diferentes entre os quadros).');
    var us = ed.unidades, col = 2, g = 22, ww = W - 2 * MX, wq = (ww - g) / col, lin = Math.ceil(us.length / col), hq = (H - 170 - y - g * (lin - 1)) / lin;
    us.forEach(function (x, i) {
      var r = { x: MX + (i % col) * (wq + g), y: y + Math.floor(i / col) * (hq + g), w: wq, h: hq };
      c.fillStyle = C.creme; rr(c, r.x, r.y, r.w, r.h, 8); c.fill();
      tx(c, N.titulo(x.u), r.x + 16, r.y + 30, 17, 700, C.escuro, { max: r.w - 120 });
      tx(c, pct(x.m.pct), r.x + r.w - 16, r.y + 30, 17, 700, C.verde, { al: 'right' });
      if (x.mapa) pintarFazenda(c, { x: r.x + 14, y: r.y + 44, w: r.w - 28, h: r.h - 54 }, x.mapa, function (f) { var t = x.mapa.talhaoDe(f); return t ? N.COR.s[t.k] : null; }, null, { larguraBorda: 0.6 });
      else tx(c, 'sem limites no Mapas', r.x + r.w / 2, r.y + r.h / 2, 12, 500, C.fraco, { al: 'center' });
    });
    var rot = N.rotulosClasse('PLANTIO');
    legenda(c, [3, 2, 1, 0].map(function (k) { return { nome: rot[k], cor: N.COR.s[k], borda: k === 0 }; }), MX, H - 110, ww);
  }
  async function pgChuvaGrupo(c, P) {
    var ed = P.ed, us = ed.unidades.filter(function (x) { return x.m.ini; });
    folha(c, P);
    var ord = us.slice().sort(function (a, b) { return (b.chuvaPeriodo ? b.chuvaPeriodo.mm : -1) - (a.chuvaPeriodo ? a.chuvaPeriodo.mm : -1); });
    var y = abertura(c, P.sec, 'A chuva nas unidades', ord.length && ord[0].chuvaPeriodo ? 'Mais chuva desde o início do plantio: ' + N.titulo(ord[0].u) + ' (' + n0(ord[0].chuvaPeriodo.mm) + ' mm)' : 'Chuva no período',
      'Chuva da ZEUS (média dos pluviômetros de cada unidade) do início do plantio de cada uma até hoje, e o efeito no ritmo.');
    var ww = W - 2 * MX;
    await grafico(c, { x: MX, y: y, w: ww, h: 380 }, N.opt({
      grid: { left: 58, right: 18, top: 30, bottom: 34, containLabel: false },
      xAxis: { type: 'category', data: ord.map(function (x) { return N.titulo(x.u); }), axisTick: { show: false }, axisLine: { lineStyle: { color: C.linha } }, axisLabel: { color: C.texto, fontSize: 13, fontWeight: 600 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: C.grade } }, axisLabel: { color: C.fraco, fontSize: 11, formatter: '{value} mm' } },
      series: [{ type: 'bar', barMaxWidth: 60, itemStyle: { color: C.chuva, borderRadius: [4, 4, 0, 0] }, data: ord.map(function (x) { return x.chuvaPeriodo ? x.chuvaPeriodo.mm : 0; }),
        label: { show: true, position: 'top', fontSize: 13, fontWeight: 600, color: C.texto, formatter: function (p) { return n0(p.value) + ' mm'; } } }]
    }));
    y += 380 + 34;
    y = subtitulo(c, 'Chuva × ritmo por unidade', MX, y, ww);
    y = tabela(c, { x: MX, y: y, w: ww }, [{ t: 'Unidade', w: 0.17 }, { t: 'Desde', w: 0.09, al: 'right' }, { t: 'Chuva', w: 0.1, al: 'right' }, { t: 'Dias c/ chuva', w: 0.11, al: 'right' }, { t: 'Maior chuva', w: 0.14, al: 'right' },
      { t: 'Média c/ chuva', w: 0.13, al: 'right' }, { t: 'Média s/ chuva', w: 0.13, al: 'right' }, { t: 'Dias parados', w: 0.13, al: 'right' }],
      ord.map(function (x) {
        var ch = x.chuvaPeriodo, cr = x.rel.corr, tem = x.temChuva && ch;
        return [{ t: N.titulo(x.u), bola: N.COR_FAZENDA[x.u] || C.fraco, peso: 700 }, dc(iso(x.m.ini)), tem ? n0(ch.mm) + ' mm' : '—', tem ? String(ch.dias) : '—', tem && ch.maior ? n0(ch.maior.mm) + ' mm · ' + dc(ch.maior.d) : '—',
          tem && cr.comChuva.media !== null ? n0(cr.comChuva.media) + ' ha/d' : '—', tem && cr.semChuva.media !== null ? n0(cr.semChuva.media) + ' ha/d' : '—', tem ? String(cr.parados) : '—'];
      }), { lh: 36 }) + 34;
    // chuva diária de cada unidade, na mesma escala de datas e de mm (do início do plantio do grupo até hoje)
    var comCh = ord.filter(function (x) { return x.temChuva; });
    if (!comCh.length || y > H - 380) return;
    var de = iso(ed.m.ini), dias = diasEntre(de, iso(ed.hoje)), max = 0;
    comCh.forEach(function (x) { dias.forEach(function (d) { max = Math.max(max, x.chuvaU[d] || 0); }); });
    var topo = Math.max(10, Math.ceil(max / 10) * 10);
    y = subtitulo(c, 'Chuva por dia em cada unidade (mm)', MX, y, ww, 'mesma escala em todos os quadros');
    var col = 2, g = 22, wq = (ww - g) / col, lin = Math.ceil(comCh.length / col), hq = Math.min(190, (H - 140 - y - g * (lin - 1)) / lin);
    for (var i = 0; i < comCh.length; i++) {
      var x = comCh[i], r = { x: MX + (i % col) * (wq + g), y: y + Math.floor(i / col) * (hq + g), w: wq, h: hq };
      tx(c, N.titulo(x.u), r.x, r.y + 14, 13, 700, C.escuro);
      var o = opColunas(dias, dias.map(function (d) { return Math.round((x.chuvaU[d] || 0) * 10) / 10; }), C.chuva, { largura: wq, grade: { left: 40, top: 22, bottom: 22 } });
      o.yAxis.max = topo; o.series[0].label.show = false;
      await grafico(c, { x: r.x, y: r.y + 18, w: r.w, h: r.h - 18 }, o);
    }
  }
  /** Uma página por unidade, na edição do grupo. */
  function pgFichaUnidade(x) {
    return async function (c, P) {
      var m = x.m, rel = x.rel;
      folha(c, P);
      var y = abertura(c, P.sec, 'Unidade', x.nome, RL.manchete(m, rel.concluida) + (rel.concluida ? '.' : '; faltam ' + n0(m.restante) + ' ha.'));
      var ww = W - 2 * MX, ks = indicadoresFazenda(x).slice(0, 6), wk = (ww - 2 * 14) / 3;
      ks.forEach(function (k, i) { numero(c, { x: MX + (i % 3) * (wk + 14), y: y + Math.floor(i / 3) * 136, w: wk, h: 122 }, k[0], k[1], k[2], k[3], k[4]); });
      y += 2 * 136 + 20;
      var wM = ww * 0.52, hM = 560;
      if (x.mapa) {
        subtitulo(c, 'Situação dos talhões', MX, y, wM);
        pintarFazenda(c, { x: MX, y: y + 30, w: wM, h: hM - 30 }, x.mapa, function (f) { var t = x.mapa.talhaoDe(f); return t ? N.COR.s[t.k] : null; }, function (f) { return f.properties.talhao; }, { rosa: true, maxFonte: 11, topo: true });
      }
      var xr = MX + wM + 30, wr = ww - wM - 30, yr = y;
      yr = subtitulo(c, 'Variedades', xr, yr, wr);
      x.variedades.slice(0, 9).forEach(function (v) {
        c.fillStyle = x.cores[v.v]; rr(c, xr, yr - 11, 13, 13, 3); c.fill();
        tx(c, v.v, xr + 21, yr, 13, 600, C.texto, { max: wr - 110 });
        tx(c, n0(v.exec) + ' / ' + n0(v.prev) + ' ha', xr + wr, yr, 12.5, 500, C.suave, { al: 'right' });
        yr += 25;
      });
      yr += 14;
      yr = subtitulo(c, 'Equipes', xr, yr, wr);
      x.equipes.slice(0, 6).forEach(function (e) { tx(c, e.nome, xr, yr, 13, 600, C.texto, { max: wr - 110 }); tx(c, n0(e.total) + ' ha', xr + wr, yr, 12.5, 500, C.suave, { al: 'right' }); yr += 25; });
      y += hM + 24;
      var dias = diasEntre(iso(m.ini), iso(m.ult));
      if (dias.length) {
        y = subtitulo(c, 'Hectares por dia' + (x.temChuva ? ' e chuva' : ''), MX, y, ww);
        var hG = H - 150 - y;
        await grafico(c, { x: MX, y: y, w: ww, h: x.temChuva ? hG * 0.58 : hG }, opColunas(dias, dias.map(function (d) { return Math.round(m.porDia[d] || 0); }), C.verde, { largura: ww }));
        if (x.temChuva) await grafico(c, { x: MX, y: y + hG * 0.6, w: ww, h: hG * 0.4 }, opColunas(dias, dias.map(function (d) { return Math.round((x.chuvaU[d] || 0) * 10) / 10; }), C.chuva, { largura: ww, yFmt: function (v) { return v + ' mm'; } }));
      }
    };
  }

  async function pgContracapa(c, P) {
    var ed = P.ed, im = P.imgs;
    c.fillStyle = C.escuro; c.fillRect(0, 0, W, H);
    if (im.cultura) { c.save(); c.globalAlpha = 0.08; cobrir(c, im.cultura, { x: 0, y: H * 0.55, w: W, h: H * 0.45 }, 0.5, 1); c.restore(); }
    if (im.coa) { var lw = 520, lh = im.coa.height / im.coa.width * lw; c.drawImage(im.coa, (W - lw) / 2, 430, lw, lh); }
    tx(c, 'Da chuva de ontem ao plantio de hoje, talhão por talhão.', W / 2, 700, 22, 500, '#D7E8E2', { al: 'center' });
    var fontes = ['PIMS: boletins de plantio, talhões, variedades e equipes.', 'ZEUS: chuva diária dos pluviômetros e chuva por talhão.', 'Módulo Mapas: limites dos talhões, mapas de chuva salvos e cores das variedades.',
      'Previsão do Tempo: ZEUS, MET Norway e Visual Crossing.', 'Metas: cadastradas no Acompanhamento Operacional do COA WEB.'];
    tx(c, 'FONTES', W / 2, 1060, 13, 700, C.ouroClaro, { al: 'center', esp: 3 });
    fontes.forEach(function (f, i) { tx(c, f, W / 2, 1100 + i * 30, 15, 400, '#C9DCD5', { al: 'center' }); });
    tx(c, 'Gerado em ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' pelo COA WEB' + (ed.geradoEm ? ' · dados do PIMS de ' + ed.geradoEm.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''),
      W / 2, 1300, 13, 500, '#9FBDB3', { al: 'center' });
    if (im.locksBranca) { var lh2 = 40, lw2 = im.locksBranca.width / im.locksBranca.height * lh2; c.drawImage(im.locksBranca, (W - lw2) / 2, H - 140, lw2, lh2); }
  }

  // ===========================================================================
  // Montagem: lista de páginas, sumário e numeração
  // ===========================================================================
  function paginasDaFazenda(ed) {
    var ps = [], m = ed.m, sec = 0;
    function secao(titulo, linha, fns) { sec++; var s = String(sec).padStart(2, '0'); fns.forEach(function (f, i) { ps.push({ pintar: f, sec: s, titulo: i ? null : titulo, linha: linha }); }); }
    ps.push({ pintar: pgCapa });
    ps.push({ pintar: pgAbertura });
    if (!m.ini) { ps.push({ pintar: pgContracapa }); return ps; }
    secao('Em números', 'Indicadores e comparação com as safras anteriores', [pgNumeros]);
    secao('O ritmo do plantio', 'Hectares por dia, meta e acumulado', [pgRitmo]);
    if (ed.mapa) secao('O mapa do plantio', 'Situação dos talhões e semana do plantio', [pgMapa]);
    if (ed.temChuva || ed.chT) secao('A chuva e o plantio', 'Chuva diária, efeito no ritmo e chuva por talhão', [pgChuva]);
    if (ed.mapasSalvos.length) {
      var l = ed.mapasSalvos.slice(-MAX_MAPAS), grupos = [];
      for (var i = 0; i < l.length; i += 4) grupos.push(l.slice(i, i + 4));
      secao('Mapas de chuva do período', l.length + ' ' + plural(l.length, 'mapa salvo', 'mapas salvos') + ' no módulo Mapas', grupos.map(function (g, j) { return pgMapasSalvos(g, j === 0); }));
    }
    secao('Variedades', 'Mapa, área e janela de plantio de cada variedade', [pgVariedades]);
    if (ed.equipes.length) secao('Equipes', 'Área, dias e média de cada equipe', [pgEquipes]);
    var pt = paginarTalhoes(linhasTalhao(ed));
    secao('Talhão a talhão', 'Plantio, variedade e chuva de cada talhão', pt.grupos.map(function (g, j) { return pgTalhoes(g, j === 0, pt.lh); }));
    if (ed.previsao) secao('Os próximos dias', 'A previsão do tempo das três fontes', [pgPrevisao]);
    ps.push({ pintar: pgContracapa });
    return ps;
  }
  function paginasDoGrupo(ed) {
    var ps = [], sec = 0;
    function secao(titulo, linha, fns) { sec++; var s = String(sec).padStart(2, '0'); fns.forEach(function (f, i) { ps.push({ pintar: f, sec: s, titulo: i ? null : titulo, linha: linha }); }); }
    ps.push({ pintar: pgCapa });
    ps.push({ pintar: pgAbertura });
    if (!ed.m.ini) { ps.push({ pintar: pgContracapa }); return ps; }
    secao('Em números', 'Indicadores do grupo e comparação com as safras anteriores', [pgNumeros]);
    secao('As unidades', 'Plantado, ritmo, previsão e chuva de cada unidade', [pgUnidades]);
    secao('O ritmo do grupo', 'Hectares por dia por unidade e acumulado', [pgRitmoGrupo]);
    if (ed.unidades.some(function (x) { return x.mapa; })) secao('O mapa das unidades', 'Situação dos talhões em cada unidade', [pgMosaico]);
    if (ed.unidades.some(function (x) { return x.temChuva; })) secao('A chuva nas unidades', 'Chuva desde o início do plantio e efeito no ritmo', [pgChuvaGrupo]);
    secao('Variedades', 'Área e janela de plantio de cada variedade no grupo', [pgVariedades]);
    if (ed.equipes.length) secao('Equipes', 'Área, dias e média de cada equipe', [pgEquipes]);
    secao('Unidade a unidade', 'Uma página por unidade', ed.unidades.filter(function (x) { return x.m.ini || x.m.talhoes.length; }).map(pgFichaUnidade));
    ps.push({ pintar: pgContracapa });
    return ps;
  }

  // ===========================================================================
  // Geração (tela + PDF)
  // ===========================================================================
  var estadoRv = { chave: null, gerando: 0, paginas: [], ed: null, extras: null, pronto: false, baixando: false };
  var imgsCache = null;
  /** Logo da Locks em branco: o fundo branco some, a parte verde vira branca e o detalhe laranja fica. */
  function locksBranca(img) {
    if (!img) return null;
    var cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    var c = cv.getContext('2d'); c.drawImage(img, 0, 0);
    var d = c.getImageData(0, 0, cv.width, cv.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) {
      var r = p[i], g = p[i + 1], b = p[i + 2];
      if (r > 225 && g > 225 && b > 225) { p[i + 3] = 0; continue; }
      // borda antisserrilhada sobre o branco: a opacidade sai da distância ao branco
      var claro = Math.min(r, g, b);
      if (g >= r) { p[i] = 255; p[i + 1] = 255; p[i + 2] = 255; p[i + 3] = Math.round(p[i + 3] * Math.min(1, (255 - claro) / 170)); }
    }
    c.putImageData(d, 0, 0);
    return cv;
  }
  async function imagens(s) {
    var capa = CAPAS[s] || CAPAS[N.culturaDaSafra(s)] || CAPAS.padrao;
    if (!imgsCache) {
      var r = await Promise.all([N.talvezImagem('assets/logo_locks.png'), N.talvezImagem('assets/logo_coa_branco.png'), N.talvezImagem('assets/rosa.png')]);
      imgsCache = { locksBranca: locksBranca(r[0]), coa: r[1], rosa: r[2], capas: {} };
    }
    if (!(capa in imgsCache.capas)) imgsCache.capas[capa] = await N.talvezImagem(capa);
    P_IMGS.rosa = imgsCache.rosa;
    return { capa: imgsCache.capas[capa], locksBranca: imgsCache.locksBranca, coa: imgsCache.coa, rosa: imgsCache.rosa, cultura: await N.talvezImagem(N.fundoCultura(s)) };
  }
  async function fontesProntas() {
    if (!document.fonts || !document.fonts.load) return;
    try { await Promise.all([400, 500, 600, 700].map(function (p) { return document.fonts.load(p + ' 20px "IBM Plex Sans"'); })); } catch (e) { /* segue com a fonte do sistema */ }
  }
  var urlsMapas = {};
  /** Imagem de um mapa salvo (baixada uma vez por sessão; falha não fica guardada, tenta de novo na próxima). */
  function imagemMapa(mp) {
    if (!mp.path) return Promise.resolve(null);
    if (!urlsMapas[mp.path]) {
      urlsMapas[mp.path] = N.imagemMapaSalvo(mp.path).then(function (b) {
        if (!b) return null;
        var url = URL.createObjectURL(b);
        // a imagem já decodificada continua desenhável depois de liberar o endereço
        return N.talvezImagem(url).then(function (img) { URL.revokeObjectURL(url); return img; });
      }).catch(function () { return null; }).then(function (img) { if (!img) delete urlsMapas[mp.path]; return img; });
    }
    return urlsMapas[mp.path];
  }
  function chaveEstado() { var e = N.estado(); return [e.u, e.s, e.o, N.dados().geradoEm].join('|'); }

  function mostrar(estadoTela, texto) {
    estadoRv.pronto = estadoTela === 'pronto';
    $('rv-status').textContent = texto || '';
    $('rv-baixar').disabled = !estadoRv.pronto || estadoRv.baixando;
  }
  function cabecalhoTela(ed, us) {
    N.aplicarFundo($('rv-cab'), N.estado().s);
    $('rv-eyebrow').textContent = 'Revista · Relatório de plantio · ' + N.nomeSafra(N.estado().s);
    $('rv-titulo').textContent = ed ? ed.nome : (N.estado().u === N.TODAS ? NOME_GRUPO : nomeFazenda(N.estado().u));
    var g = N.dados().geradoEm ? new Date(N.dados().geradoEm) : null;
    $('rv-sub').textContent = (ed && ed.grupo ? us.length + ' unidades · ' : '') + 'dados do PIMS de ' + (g ? g.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  }
  function figura(pg, i, total) {
    var fig = document.createElement('figure'); fig.className = 'rv-pagina' + (i === 0 ? ' capa' : '');
    fig.innerHTML = '<img alt="Página ' + (i + 1) + '" src="' + pg.url + '"><figcaption>' + (i === 0 ? 'Capa' : i === total - 1 ? 'Contracapa' : 'Página ' + (i + 1)) + '</figcaption>';
    return fig;
  }
  function liberar(paginas) { paginas.forEach(function (p) { URL.revokeObjectURL(p.url); }); }

  /**
   * Monta a revista da aba escolhida. Cada geração guarda a fazenda, a safra e a operação do começo e para assim
   * que a tela muda (outra geração, outra aba do módulo, outra fazenda, safra ou leitura do PIMS): as páginas
   * prontas só vão para a tela e para o PDF se a geração chegou ao fim com tudo igual.
   */
  async function gerar() {
    var e = N.estado(), n = ++estadoRv.gerando, chave = chaveEstado();
    var u = e.u, s = e.s, o = e.o, us = N.unidadesDaSafra(s);
    function viva() { return n === estadoRv.gerando && N.estado().vista === 'revista' && chaveEstado() === chave; }
    $('rv-aviso').hidden = true;
    if (o !== 'PLANTIO') {
      cabecalhoTela(null, us);
      $('rv-paginas').hidden = true;
      $('rv-aviso').hidden = false; $('rv-aviso').textContent = 'A revista cobre o plantio por enquanto. Escolha "Plantio" no campo Operação.';
      mostrar('vazio', ''); return;
    }
    $('rv-paginas').hidden = false;
    if (estadoRv.chave === chave && estadoRv.paginas.length) {
      // a mesma revista já montada: só volta para a tela
      $('rv-paginas').innerHTML = '';
      estadoRv.paginas.forEach(function (pg, i) { $('rv-paginas').appendChild(figura(pg, i, estadoRv.paginas.length)); });
      cabecalhoTela(estadoRv.ed, us);
      mostrar('pronto', textoPronto()); return;
    }
    $('rv-paginas').innerHTML = '';
    cabecalhoTela(null, us);
    mostrar('gerando', 'Buscando chuva, mapas salvos e previsão…');
    var paginas = [];
    try {
      var hoje = N.hoje();
      // chuva por talhão, mapas salvos, cores e previsão: lidos uma vez por safra e por leitura do PIMS
      var chaveExtras = s + '|' + N.dados().geradoEm;
      if (!estadoRv.extras || estadoRv.extras.chave !== chaveExtras) {
        var ini = N.calcula(us, s, o).ini;
        var lidos = await N.extrasRevista(us, s, ini ? RL.somarDias(N.paraIso(ini), -45) : N.paraIso(hoje));
        lidos.chave = chaveExtras;
        estadoRv.extras = lidos;
      }
      var ex = estadoRv.extras;
      await N.mapasProntos();
      await fontesProntas();
      if (!viva()) return;
      var grupo = u === N.TODAS;
      if (grupo && !ex.admin) {
        // a revista do grupo é só para administrador: os outros veem a da primeira fazenda da lista
        if (us.length) { N.irParaUnidade(us[0]); return; }
      }
      var ed = grupo ? edicaoDoGrupo(us, s, o, ex, hoje) : edicaoDaFazenda(u, s, o, ex, hoje);
      ed.semCategoriaChuva = !Object.keys(ex.chuva).length;
      ed.s = s; ed.safraNome = N.nomeSafra(s); ed.o = o; ed.hoje = hoje;
      ed.geradoEm = N.dados().geradoEm ? new Date(N.dados().geradoEm) : null;
      ed.dataRef = ed.geradoEm ? new Date(ed.geradoEm.getFullYear(), ed.geradoEm.getMonth(), ed.geradoEm.getDate()) : hoje;
      cabecalhoTela(ed, us);
      var imgs = await imagens(s);
      var ps = grupo ? paginasDoGrupo(ed) : paginasDaFazenda(ed);
      var sumario = [];
      ps.forEach(function (p, i) { if (p.titulo) sumario.push({ sec: p.sec, titulo: p.titulo, linha: p.linha, pagina: i + 1 }); });
      for (var i = 0; i < ps.length; i++) {
        if (!viva()) { liberar(paginas); return; }
        mostrar('gerando', 'Montando a página ' + (i + 1) + ' de ' + ps.length + '…');
        var cv = document.createElement('canvas'); cv.width = Math.round(W * ESC); cv.height = Math.round(H * ESC);
        var c = cv.getContext('2d'); c.scale(ESC, ESC);
        await ps[i].pintar(c, { n: i + 1, ed: ed, imgs: imgs, sec: ps[i].sec, sumario: sumario, imagemMapa: imagemMapa });
        var blob = await new Promise(function (ok) { cv.toBlob(ok, 'image/jpeg', QUALIDADE); });
        cv.width = cv.height = 0;
        if (!viva()) { liberar(paginas); return; }
        var pg = { blob: blob, url: URL.createObjectURL(blob) };
        paginas.push(pg);
        $('rv-paginas').appendChild(figura(pg, i, ps.length));
        await new Promise(function (ok) { setTimeout(ok, 0); });
      }
      if (!viva()) { liberar(paginas); return; }
      liberar(estadoRv.paginas);
      estadoRv.paginas = paginas; estadoRv.ed = ed; estadoRv.chave = chave;
      mostrar('pronto', textoPronto());
    } catch (err) {
      liberar(paginas);
      if (viva()) mostrar('erro', 'Não foi possível montar a revista: ' + (err && err.message ? err.message : err));
      console.error('Revista', err);
    }
  }
  function textoPronto() {
    var kb = soma(estadoRv.paginas, function (p) { return p.blob.size; }) / 1024;
    return estadoRv.paginas.length + ' páginas · PDF de cerca de ' + (kb > 1024 ? N.fmtN(kb / 1024, 1) + ' MB' : Math.round(kb) + ' KB');
  }

  var jsPdfCarregando = null;
  function carregarJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfCarregando) jsPdfCarregando = new Promise(function (ok, falha) {
      var sc = document.createElement('script');
      // a mesma versão fixa (com SRI) do Relatório
      sc.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
      sc.crossOrigin = 'anonymous';
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      sc.onload = function () { ok(window.jspdf.jsPDF); };
      sc.onerror = function () { jsPdfCarregando = null; falha(new Error('Não foi possível carregar o gerador de PDF. Verifique a conexão.')); };
      document.head.appendChild(sc);
    });
    return jsPdfCarregando;
  }
  function nomeArquivo(ed) {
    var s = function (t) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    return ['revista-plantio', s(ed.s), s(ed.grupo ? 'grupo' : ed.u), N.paraIso(N.hoje())].join('-') + '.pdf';
  }
  /** PDF das páginas prontas (cópia da lista: uma geração nova no meio não mistura duas revistas). */
  async function baixarPdf() {
    if (!estadoRv.pronto || !estadoRv.paginas.length) return;
    var paginas = estadoRv.paginas.slice(), ed = estadoRv.ed, b = $('rv-baixar');
    estadoRv.baixando = true; b.disabled = true;
    var antes = $('rv-status').textContent;
    $('rv-status').textContent = 'Gerando o PDF…';
    try {
      var jsPDF = await carregarJsPdf();
      var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      for (var i = 0; i < paginas.length; i++) {
        if (i) pdf.addPage('a4', 'portrait');
        var bytes = new Uint8Array(await paginas[i].blob.arrayBuffer());
        pdf.addImage(bytes, 'JPEG', 0, 0, 210, 297, 'p' + i, 'NONE');
      }
      pdf.setProperties({ title: 'Relatório de plantio - ' + ed.nome + ' - ' + ed.safraNome, creator: 'COA WEB · Acompanhamento Operacional' });
      var url = URL.createObjectURL(pdf.output('blob'));
      var a = document.createElement('a'); a.href = url; a.download = nomeArquivo(ed);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      if ($('rv-status').textContent === 'Gerando o PDF…') $('rv-status').textContent = antes;
    } catch (err) { $('rv-status').textContent = 'Não foi possível gerar o PDF: ' + (err && err.message ? err.message : err); }
    finally { estadoRv.baixando = false; b.disabled = !estadoRv.pronto; }
  }

  function render(nucleo) {
    N = nucleo;
    gerar();
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('rv-baixar').addEventListener('click', baixarPdf);
  });

  window.AcompRevista = { render: render };
})();
