/* =====================================================================
   Acompanhamento Operacional — aba "Relatórios"
   Consolidado da operação até a data, numa página: leitura automática, indicadores, safra atual ×
   anteriores na mesma data do ano, hectares por dia × meta × chuva, acumulado, talhões (ou a tabela
   por fazenda, em "Todas"), equipes e variedades. Exporta em PNG (uma imagem) ou PDF (A4 em pé).
   Lógica sem DOM em relatorio-logica.js (RelatorioLogica); núcleo do app.js em window.AcompNucleo.
===================================================================== */
(function () {
  'use strict';

  var L = window.RelatorioLogica;
  var COR_SAFRA = ['#0C5A50', '#eb6834', '#a8327a', '#8c5a2b']; // as mesmas da aba Safras (atual, 1, 2 e 3 anos antes)
  var COR_CHUVA = '#2a78d6', TXT_CHUVA = '#1c5cab';
  var N = null;   // núcleo (helpers e dados do app.js)
  var R = null;   // último relatório montado
  var jsPdfCarregando = null;

  function $(id) { return document.getElementById(id); }
  function op(o) { return o === 'PLANTIO' ? 'plantio' : 'colheita'; }
  function feito(o) { return o === 'PLANTIO' ? 'plantado' : 'colhido'; }
  function dataCurta(d) { return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : '—'; }
  function dataLonga(d) { return d ? d.toLocaleDateString('pt-BR') : '—'; }
  function halo(k) { return { textBorderColor: '#FFFFFF', textBorderWidth: 4.5 * k }; }

  // ------------------------------------------------------------------
  // Dados
  // ------------------------------------------------------------------
  function chuvaDe(u) {
    var c = {};
    (N.dados().chuva || []).forEach(function (x) { if (x.u === u) c[x.d] = (c[x.d] || 0) + x.a; });
    return c;
  }
  function montar() {
    var e = N.estado(), todas = e.u === N.TODAS, us = N.unidadesDaSafra(e.s), unidades = todas ? us : [e.u];
    var m = N.calcula(unidades, e.s, e.o), hoje = N.hoje();
    var chuvaU = todas ? {} : chuvaDe(e.u);
    var linhas = todas ? us.map(function (u) { return L.linhaFazenda(u, N.calcula([u], e.s, e.o), chuvaDe(u), hoje); }) : [];
    var rel = L.consolidar(m, chuvaU, hoje, todas ? { todas: true, linhas: linhas } : { fazenda: N.titulo(e.u) });
    rel.u = e.u; rel.chuvaU = chuvaU; rel.frases = L.frases(rel);
    rel.temChuva = !todas && rel.corr.temChuva;
    rel.serie = m.serie.map(function (x) { return { d: x.d, a: x.a, meta: x.meta, chuva: chuvaU[N.paraIso(x.d)] || 0 }; });
    rel.temMetaNaSerie = rel.serie.some(function (x) { return x.meta !== null; });
    rel.geradoEm = N.dados().geradoEm ? new Date(N.dados().geradoEm) : null;
    return rel;
  }

  // ------------------------------------------------------------------
  // Textos dos blocos (tela e exportação usam os mesmos)
  // ------------------------------------------------------------------
  function tituloRelatorio(rel) { return rel.todas ? 'Todas as fazendas' : N.titulo(rel.u); }
  function subtitulo(rel) {
    var m = rel.m, s = 'Situação em ' + dataLonga(m.ult || rel.hoje);
    if (rel.geradoEm) s += ' · dados do PIMS de ' + rel.geradoEm.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (rel.temChuva) s += ' · chuva ZEUS';
    return s;
  }
  /** Os 6 indicadores: [rótulo, valor, unidade, complemento, tom] (tom: 'bom' | 'atencao' | 'ruim' | null). */
  function indicadores(rel) {
    var m = rel.m, ant = rel.anterior, c = rel.corr, k = [];
    k.push(['Área ' + (rel.o === 'PLANTIO' ? 'plantada' : 'colhida'), N.fmtN(m.exec), 'ha', N.fmtPct(m.pct) + ' de ' + N.fmtN(m.areaTotal) + ' ha' + (m.restante > 0 ? ' · faltam ' + N.fmtN(m.restante) : ''), null]);
    k.push(['Dias decorridos', m.diasDec === null ? '—' : String(m.diasDec), '', m.ini ? 'início ' + dataCurta(m.ini) + ' · último ' + dataCurta(m.ult) : 'sem apontamentos', null]);
    k.push(['Ritmo · 7 dias', m.media7 ? N.fmtN(m.media7) : '—', m.media7 ? 'ha/dia' : '',
      rel.difMeta !== null ? 'meta ' + N.fmtN(m.metaHoje) + ' · ' + (rel.difMeta >= 0 ? '+' : '') + N.fmtPct(rel.difMeta) : rel.metaParcial ? 'meta em ' + m.planos.length + ' de ' + m.unidades.length + ' fazendas' : (m.media ? 'média geral ' + N.fmtN(m.media) + ' ha/dia' : 'sem apontamentos'),
      rel.difMeta === null ? null : rel.difMeta >= 0 ? 'bom' : rel.difMeta > -0.1 ? 'atencao' : 'ruim']);
    k.push(['Previsão de término', rel.concluida ? 'Concluído' : m.previsao ? dataCurta(m.previsao) : '—', '',
      rel.concluida ? 'em ' + dataCurta(m.ult) : rel.difPrevisao !== null ? (rel.difPrevisao < 0 ? Math.abs(rel.difPrevisao) + ' dias antes do planejado (' + dataCurta(m.termino) + ')' : rel.difPrevisao === 0 ? 'na data planejada' : rel.difPrevisao + ' dias depois do planejado (' + dataCurta(m.termino) + ')') : m.previsao ? 'pelo ritmo dos últimos 7 dias' : 'sem ritmo para projetar',
      rel.concluida ? 'bom' : rel.difPrevisao === null ? null : rel.difPrevisao <= 0 ? 'bom' : rel.difPrevisao <= 3 ? 'atencao' : 'ruim']);
    if (ant) k.push(['× ' + N.nomeSafra(ant.nome) + ' na data', ant.difAtual === null ? '—' : ant.difAtual >= 1 ? N.fmtN(ant.difAtual + 1, 1) + '×' : (ant.difAtual >= 0 ? '+' : '') + N.fmtPct(ant.difAtual), '', N.fmtN(ant.ateData) + ' ha há ' + ant.anos + (ant.anos === 1 ? ' ano' : ' anos'), ant.difAtual === null ? null : ant.difAtual >= 0 ? 'bom' : 'ruim']);
    else k.push(['Necessário p/ meta', m.necessario ? N.fmtN(m.necessario) : '—', m.necessario ? 'ha/dia' : '', m.termino ? 'até ' + dataCurta(m.termino) : 'cadastre a data de término', null]);
    if (rel.temChuva) k.push(['Chuva no período', N.fmtN(c.mm), 'mm', c.diasChuva + ' dias com chuva · ' + c.parados + ' ' + (c.parados === 1 ? 'parado' : 'parados'), null]);
    else k.push(['Talhões ' + feito(rel.o) + 's', m.porClasse[3].n + ' / ' + m.talhoes.length, '', (m.porClasse[1].n + m.porClasse[2].n) + ' em andamento · ' + m.porClasse[0].n + ' não iniciados', null]);
    return k;
  }
  /** Linhas da tabela "esta safra × anteriores": [{ cor, nome, selo, celulas: [texto…], dif }]. */
  function tabelaComparativo(rel) {
    var temChuva = rel.comparativo.some(function (x) { return x.chuva && x.chuva.tem; });
    var cab = ['Safra', feito(rel.o).replace(/^./, function (c) { return c.toUpperCase(); }) + ' até ' + dataCurta(rel.m.ult), '% da área', 'Início', 'Fim', 'Duração', 'Área total', 'Média'];
    if (temChuva) cab.push('Chuva');
    var linhas = rel.comparativo.map(function (x, i) {
      var cel = [N.fmtN(x.ateData) + ' ha', N.fmtPct(x.pctNaData), dataCurta(x.ini), x.emAndamento ? 'em andamento' : dataCurta(x.fim), x.duracao === null ? '—' : x.duracao + ' dias' + (x.emAndamento ? '*' : ''), N.fmtN(x.total) + ' ha', x.media ? N.fmtN(x.media) + ' ha/dia' : '—'];
      if (temChuva) cel.push(x.chuva.tem ? N.fmtN(x.chuva.mm) + ' mm · ' + x.chuva.dias + ' d' : '—');
      return { cor: COR_SAFRA[Math.min(x.anos, 3)], nome: N.nomeSafra(x.nome), atual: x.atual, selo: x.atual ? 'atual' : x.anos + (x.anos === 1 ? ' ano antes' : ' anos antes'), celulas: cel, dif: x.difAtual };
    });
    return { cab: cab, linhas: linhas, nota: rel.comparativo[0].emAndamento ? '* safra em andamento: do início ao último apontamento.' : '' };
  }
  function textoDif(dif) { return dif === null || dif === undefined ? '' : dif >= 1 ? 'atual ' + N.fmtN(dif + 1, 1) + '×' : 'atual ' + (dif >= 0 ? '+' : '') + N.fmtPct(dif); }
  /** Tabela por fazenda (relatório geral). */
  function tabelaFazendas(rel) {
    var temChuva = rel.linhas.some(function (l) { return l.chuvaMm !== null; }), temAnt = rel.linhas.some(function (l) { return l.anterior; });
    var cab = ['Fazenda', '% ' + feito(rel.o), feito(rel.o).replace(/^./, function (c) { return c.toUpperCase(); }), 'Área total', 'Ritmo 7 dias', 'Meta', 'Previsão'];
    if (temAnt) cab.push('× ano anterior');
    if (temChuva) cab.push('Chuva');
    var linhas = rel.linhas.slice().sort(function (a, b) { return b.pct - a.pct; }).map(function (l) {
      var prev = l.concluida ? 'concluído' : l.previsao ? dataCurta(l.previsao) + (l.difPrevisao !== null ? (l.difPrevisao < 0 ? ' (' + l.difPrevisao + ' d)' : l.difPrevisao > 0 ? ' (+' + l.difPrevisao + ' d)' : ' (no prazo)') : '') : '—';
      var cel = [N.fmtPct(l.pct), N.fmtN(l.exec) + ' ha', N.fmtN(l.areaTotal) + ' ha', l.media7 ? N.fmtN(l.media7) + ' ha/dia' : '—', l.metaHoje ? N.fmtN(l.metaHoje) + ' ha/dia' : '—', prev];
      if (temAnt) cel.push(!l.anterior ? '—' : !l.anterior.ateData ? 'não tinha começado' : N.fmtN(l.anterior.ateData) + ' ha' + (l.anterior.dif !== null ? ' · ' + textoDif(l.anterior.dif) : ''));
      if (temChuva) cel.push(l.chuvaMm !== null ? N.fmtN(l.chuvaMm) + ' mm · ' + l.diasChuva + ' d' : '—');
      return { cor: N.COR_FAZENDA[l.u] || N.COR.fraco, nome: l.nome, pct: l.pct, celulas: cel, tom: l.concluida ? 'bom' : l.difPrevisao === null ? null : l.difPrevisao <= 0 ? 'bom' : l.difPrevisao <= 3 ? 'atencao' : 'ruim' };
    });
    return { cab: cab, linhas: linhas };
  }
  function listaSituacao(rel) {
    var rot = N.rotulosClasse(rel.o), m = rel.m;
    return [3, 2, 1, 0].map(function (k) { return { cor: N.COR.s[k], borda: k === 0, nome: rot[k], valor: m.porClasse[k].n + ' ' + (m.porClasse[k].n === 1 ? 'talhão' : 'talhões') + ' · ' + N.fmtN(m.porClasse[k].ha) + ' ha' }; });
  }
  function listaEquipes(rel) { return rel.m.equipes.filter(function (e) { return e.total > 0; }).slice(0, 8); }
  function listaVariedades(rel) { return rel.m.variedades.filter(function (v) { return v.prev > 0; }); }
  function rodapeTexto(rel) {
    var s = 'Fonte: PIMS (apontamentos)' + (rel.temMeta ? ', metas cadastradas no COA WEB' : '') + (rel.temChuva ? ' e ZEUS (chuva: média diária dos pluviômetros da fazenda)' : '') + '.';
    s += ' Ritmo = média dos dias com operação nos últimos 7 dias; previsão = o que falta nesse ritmo.';
    return s;
  }

  // ------------------------------------------------------------------
  // Gráficos (as mesmas opções servem para a página e para a exportação; k = escala)
  // ------------------------------------------------------------------
  /** Hectares por dia (barras), meta do dia (tracejada) e, ao fundo, a chuva do dia (mancha azul, eixo da direita). */
  function opcoesDiario(rel, k, largura) {
    k = k || 1;
    var s = rel.serie, temChuva = rel.temChuva, temMeta = rel.temMetaNaSerie;
    var maxMm = Math.max(10, Math.max.apply(null, s.map(function (x) { return x.chuva; })));
    var topoMm = Math.ceil(maxMm * 1.25 / 10) * 10;
    var espaco = ((largura || 1100) - 90 * k) / Math.max(1, s.length) / k;
    var series = [];
    if (temChuva) series.push({ name: 'Chuva (mm)', type: 'line', yAxisIndex: 1, data: s.map(function (x) { return Math.round(x.chuva * 10) / 10; }), symbol: 'none', silent: true, z: 5, smooth: 0.25,
      lineStyle: { color: 'rgba(42,120,214,.7)', width: 1.1 * k },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(42,120,214,.28)' }, { offset: 1, color: 'rgba(42,120,214,.08)' }] } } });
    series.push({ name: 'Realizado', type: 'bar', yAxisIndex: 0, data: s.map(function (x) { return Math.round(x.a); }), barMaxWidth: 26 * k, barCategoryGap: '26%', z: 3,
      itemStyle: { color: N.COR.teal, borderRadius: [3 * k, 3 * k, 0, 0] },
      label: Object.assign({ show: espaco >= 9, position: 'top', fontSize: Math.max(9, Math.min(11, espaco * 0.7)) * k, fontWeight: 600, color: N.COR.texto, formatter: function (p) { return p.value ? N.fmtN(p.value) : ''; } }, halo(k)),
      labelLayout: { hideOverlap: true } });
    if (temMeta) series.push({ name: 'Meta', type: 'line', yAxisIndex: 0, step: 'middle', silent: true, data: s.map(function (x) { return x.meta; }), symbol: 'none', lineStyle: { color: N.COR.dourado, width: 2 * k, type: [6 * k, 4 * k] }, z: 6 });
    return N.opt({
      grid: { left: 6 * k, right: temChuva ? 8 * k : 10 * k, top: 22 * k, bottom: 4 * k, containLabel: true },
      tooltip: N.tt({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(12,90,80,.05)' } }, formatter: function (ps) {
        var x = s[ps[0].dataIndex];
        return '<b>' + x.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + '</b><br>' + N.titulo(op(rel.o)) + ': <b>' + N.fmtN(x.a) + ' ha</b>' +
          (x.meta !== null ? '<br>Meta: ' + N.fmtN(x.meta) + ' ha' : '') + (temChuva ? '<br><span style="color:' + COR_CHUVA + '">Chuva: ' + (x.chuva ? N.fmtN(x.chuva, 1) + ' mm' : 'sem chuva') + '</span>' : '');
      } }),
      xAxis: Object.assign({}, N.eixoX, { type: 'category', data: s.map(function (x) { return x.d.getDate() === 1 || x === s[0] ? N.fmtData(x.d, true) : String(x.d.getDate()); }), axisLabel: { color: N.COR.suave, fontSize: 11 * k, hideOverlap: true }, axisLine: { lineStyle: { color: N.COR.linha, width: k } } }),
      yAxis: [
        Object.assign({}, N.eixoY, { type: 'value', axisLabel: { color: N.COR.fraco, fontSize: 11 * k, formatter: function (v) { return N.fmtN(v); } }, splitLine: { lineStyle: { color: N.COR.grade, width: k } } }),
        { type: 'value', show: temChuva, position: 'right', min: 0, max: topoMm, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
          axisLabel: Object.assign({ color: TXT_CHUVA, fontSize: 10.5 * k, formatter: function (v) { return v ? v + ' mm' : ''; } }, halo(k)) }
      ],
      series: series
    });
  }
  function legendaDiario(rel) {
    var it = [{ nome: 'ha ' + feito(rel.o) + 's no dia', cor: N.COR.teal }];
    if (rel.temMetaNaSerie) it.push({ nome: 'meta do dia', cor: N.COR.dourado, tipo: 'tracejada' });
    if (rel.temChuva) it.push({ nome: 'chuva do dia (mm, eixo da direita)', cor: 'rgba(42,120,214,.45)' });
    return it;
  }
  function legendaAcum(rel) {
    var m = rel.m, it = [{ nome: 'Realizado', cor: N.COR.teal }];
    if (m.planos.length) it.push({ nome: 'Planejado pelas metas', cor: N.COR.dourado, tipo: 'tracejada' });
    if (m.ritmo && m.restante > 0) it.push({ nome: 'Projeção pelo ritmo', cor: '#9AA79F', tipo: 'tracejada' });
    (m.comparativos || []).forEach(function (c, i) { it.push({ nome: N.nomeSafra(c.nome), cor: N.COR_COMPARATIVO[i] || N.COR_COMPARATIVO[1], tipo: 'linha' }); });
    return it;
  }
  /** % feito por talhão, do mais adiantado ao não iniciado (cor pela faixa de execução). */
  function talhoesOrdenados(rel) { return rel.m.talhoes.slice().sort(function (a, b) { return b.perc - a.perc || b.base - a.base || (a.t < b.t ? -1 : 1); }); }
  function opcoesTalhoes(rel, k, largura) {
    k = k || 1;
    var l = talhoesOrdenados(rel), espaco = ((largura || 500) - 50 * k) / Math.max(1, l.length) / k;
    return N.opt({
      grid: { left: 4 * k, right: 8 * k, top: 14 * k, bottom: 4 * k, containLabel: true },
      tooltip: N.tt({ trigger: 'item', formatter: function (p) { var x = l[p.dataIndex]; return '<b>Talhão ' + N.esc(x.t) + '</b><br>' + N.fmtPct(x.perc) + ' ' + feito(rel.o) + ' · ' + N.fmtN(x.efetivo) + ' de ' + N.fmtN(x.base) + ' ha' + (x.variedade ? '<br>' + N.esc(x.variedade) : ''); } }),
      xAxis: Object.assign({}, N.eixoX, { type: 'category', data: l.map(function (x) { return x.t; }), axisLabel: { color: N.COR.suave, fontSize: Math.max(8, Math.min(10.5, espaco * 0.8)) * k, interval: espaco >= 11 ? 0 : 'auto', rotate: espaco < 18 ? 90 : 0, hideOverlap: true } }),
      yAxis: Object.assign({}, N.eixoY, { type: 'value', max: 100, axisLabel: { color: N.COR.fraco, fontSize: 11 * k, formatter: '{value}%' }, splitLine: { lineStyle: { color: N.COR.grade, width: k } } }),
      series: [{ type: 'bar', barMaxWidth: 22 * k, barCategoryGap: '22%', data: l.map(function (x) { return { value: Math.max(1.5, Math.round(x.perc * 100)), itemStyle: { color: N.COR.s[x.k], borderRadius: [2 * k, 2 * k, 0, 0] } }; }) }]
    });
  }

  // ------------------------------------------------------------------
  // Página
  // ------------------------------------------------------------------
  function htmlLegenda(itens) {
    return itens.map(function (i) { return '<li><i class="' + (i.tipo || '') + '" style="' + (i.tipo === 'tracejada' ? 'border-color:' : 'background:') + i.cor + '"></i>' + N.esc(i.nome) + '</li>'; }).join('');
  }
  function htmlFrase(f) { return '<p>' + L.trechos(f).map(function (t) { return t.b ? '<b>' + N.esc(t.t) + '</b>' : N.esc(t.t); }).join('') + '</p>'; }
  function htmlTabela(t, classe) {
    return '<table class="rl-tabela ' + (classe || '') + '"><thead><tr>' + t.cab.map(function (c, i) { return '<th' + (i ? '' : ' class="e"') + '>' + N.esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.linhas.map(function (l) {
        return '<tr' + (l.atual ? ' class="atual"' : '') + '><td class="e"><i class="rl-cor" style="background:' + l.cor + '"></i><b>' + N.esc(l.nome) + '</b>' + (l.selo ? ' <small>' + N.esc(l.selo) + '</small>' : '') + '</td>' +
          l.celulas.map(function (c, i) { return '<td>' + (i === 0 && l.dif !== null && l.dif !== undefined ? '<b>' + N.esc(c) + '</b><small class="rl-dif ' + (l.dif >= 0 ? 'ok' : 'ruim') + '">' + textoDif(l.dif) + '</small>' : (i === 0 && l.atual ? '<b>' + N.esc(c) + '</b>' : N.esc(c))) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  function render(nucleo) {
    N = nucleo;
    var e = N.estado(), rel = R = montar(), m = rel.m;
    N.aplicarFundo($('rl-cab'), e.s);
    $('rl-eyebrow').textContent = 'Relatório consolidado · ' + N.titulo(op(e.o)) + ' · ' + N.nomeSafra(e.s);
    $('rl-titulo').textContent = tituloRelatorio(rel);
    $('rl-sub').textContent = subtitulo(rel);
    $('rl-pct').textContent = N.fmtPct(m.pct);
    $('rl-pct-rot').textContent = 'da área ' + (e.o === 'PLANTIO' ? 'plantada' : 'colhida') + ' · ' + N.fmtN(m.exec) + ' de ' + N.fmtN(m.areaTotal) + ' ha';

    $('rl-leitura-sub').textContent = 'gerada pelos dados' + (rel.geradoEm ? ' · PIMS de ' + rel.geradoEm.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
    $('rl-frases').innerHTML = rel.frases.map(htmlFrase).join('');
    var semDados = rel.semDados;
    $('rl-resto').hidden = semDados;
    if (semDados) return;

    $('rl-kpis').innerHTML = indicadores(rel).map(function (k) {
      return '<div class="kpi"><span class="kpi-rotulo">' + N.esc(k[0]) + '</span><span class="kpi-valor">' + N.esc(k[1]) + (k[2] ? '<small>' + k[2] + '</small>' : '') + '</span><span class="kpi-sub' + (k[4] ? ' tom-' + k[4] : '') + '">' + N.esc(k[3]) + '</span></div>';
    }).join('');

    var tc = tabelaComparativo(rel);
    $('rl-comp-sub').textContent = 'mesma data do ano (' + dataCurta(m.ult) + ') e safra inteira' + (tc.nota ? ' · ' + tc.nota : '');
    $('rl-comp').innerHTML = htmlTabela(tc);

    $('rl-diario-t').textContent = 'Hectares por dia' + (rel.temMetaNaSerie ? ' × meta' : '') + (rel.temChuva ? ' × chuva' : '');
    $('rl-leg-diario').innerHTML = htmlLegenda(legendaDiario(rel));
    N.chart($('rl-g-diario')).setOption(opcoesDiario(rel, 1, $('rl-g-diario').clientWidth), true);
    $('rl-leg-acum').innerHTML = htmlLegenda(legendaAcum(rel));
    N.chart($('rl-g-acum')).setOption(N.opcoesAcumulado(m, 1), true);

    $('rl-c-talhoes').hidden = rel.todas;
    $('rl-c-fazendas').hidden = !rel.todas;
    if (rel.todas) {
      $('rl-fazendas').innerHTML = htmlTabela(tabelaFazendas(rel), 'rl-por-fazenda'); // (a classe "fazendas" é do mapa do Painel)
    } else {
      $('rl-tal-t').textContent = '% ' + feito(rel.o) + ' por talhão';
      $('rl-tal-sub').textContent = m.talhoes.length + ' talhões, do mais adiantado ao não iniciado';
      if (m.talhoes.length) N.chart($('rl-g-talhoes')).setOption(opcoesTalhoes(rel, 1, $('rl-g-talhoes').clientWidth), true);
      else N.vazio($('rl-g-talhoes'), 'Nenhum talhão cadastrado nesta safra.');
    }

    $('rl-situacao').innerHTML = '<ul class="rl-lista">' + listaSituacao(rel).map(function (i) { return '<li><span><i class="rl-cor" style="background:' + i.cor + (i.borda ? ';box-shadow:inset 0 0 0 1px #C9D3CB' : '') + '"></i>' + N.esc(i.nome) + '</span><b>' + N.esc(i.valor) + '</b></li>'; }).join('') + '</ul>' +
      '<p class="rodape-cartao">Dano ' + N.fmtN(m.dano) + ' ha · Replantio ' + N.fmtN(m.replantio) + ' ha</p>';
    var eq = listaEquipes(rel);
    $('rl-equipes').innerHTML = eq.length ? '<ul class="rl-lista">' + eq.map(function (x) { return '<li><span>' + N.esc(x.nome) + '</span><b>' + N.fmtN(x.ult7) + ' ha <small>· total ' + N.fmtN(x.total) + '</small></b></li>'; }).join('') + '</ul>' : '<div class="vazio">Sem apontamentos</div>';
    var vs = listaVariedades(rel);
    $('rl-variedades').innerHTML = vs.length ? '<ul class="rl-lista barras">' + vs.map(function (v) { return '<li><div><span>' + N.esc(v.v) + '</span><b>' + N.fmtN(v.exec) + ' / ' + N.fmtN(v.prev) + ' ha</b></div><div class="rl-barra"><i style="width:' + Math.min(100, v.exec / v.prev * 100).toFixed(1) + '%"></i></div></li>'; }).join('') + '</ul>' : '<div class="vazio">Sem variedades cadastradas</div>';
    $('rl-nota').textContent = rodapeTexto(rel);
  }

  // ------------------------------------------------------------------
  // Exportar: PNG (uma imagem) ou PDF (A4 em pé, quantas páginas forem precisas)
  // ------------------------------------------------------------------
  var LARG = 1240, ALT_A4 = Math.round(1240 * 297 / 210), M = 36, G = 14, ESC = 1.5, KEXP = 1.15, ESC_PNG = 2.4;

  /** Texto com trechos em negrito, quebrando em maxW. Com `medir`, só calcula. Devolve a linha de base da última linha. */
  function escreverRico(c, trs, x, y, maxW, px, entre, medir) {
    var itens = [];
    trs.forEach(function (t, i) {
      var cola = i > 0 && !/^\s/.test(t.t) && !/\s$/.test(trs[i - 1].t);
      t.t.split(/\s+/).forEach(function (w, j) { if (w) itens.push({ w: w, b: t.b, cola: cola && j === 0 }); });
    });
    var cx = x; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    itens.forEach(function (it) {
      c.font = N.fonteCv(px, it.b ? 700 : 400);
      var ww = c.measureText(it.w).width, sp = c.measureText(' ').width;
      if (it.cola && cx > x) cx -= sp;
      if (cx > x && cx + ww > x + maxW) { cx = x; y += entre; }
      if (!medir) { c.fillStyle = it.b ? N.COR.teal : N.COR.texto; c.fillText(it.w, cx, y); }
      cx += ww + sp;
    });
    return y;
  }
  function cabecalho(c, W, h, rel, imgs, compacto) {
    N.faixaMarca(c, W, h, imgs);
    if (c.letterSpacing !== undefined) c.letterSpacing = '3px';
    N.escrever(c, ('Relatório consolidado · ' + op(rel.o) + ' · ' + N.nomeSafra(rel.s)).toUpperCase(), 44, compacto ? 34 : 46, 14, 700, '#F0B24A', W * 0.6);
    if (c.letterSpacing !== undefined) c.letterSpacing = '0px';
    N.escrever(c, tituloRelatorio(rel), 44, compacto ? 70 : 96, compacto ? 28 : 40, 700, '#FFFFFF', W * 0.6);
    if (!compacto) N.escrever(c, subtitulo(rel), 44, 130, 15.5, 500, '#D7E8E2', W * 0.62);
    N.escrever(c, N.fmtPct(rel.m.pct), W - 44, compacto ? 62 : 86, compacto ? 40 : 56, 700, '#FFFFFF', 220, 'right');
    N.escrever(c, 'da área ' + (rel.o === 'PLANTIO' ? 'plantada' : 'colhida') + ' · ' + N.fmtN(rel.m.exec) + ' de ' + N.fmtN(rel.m.areaTotal) + ' ha', W - 44, compacto ? 84 : 112, 13, 500, '#D7E8E2', 360, 'right');
  }
  function rodape(c, W, y, rel) {
    N.escrever(c, rodapeTexto(rel), 40, y, 11.5, 500, N.COR.suave, W - 380);
    N.escrever(c, 'gerado em ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · COA WEB', W - 40, y, 11.5, 500, N.COR.fraco, 320, 'right');
  }
  function tituloCartao(c, r, t, sub) {
    N.escrever(c, t, r.x + 18, r.y + 28, 15, 700, N.COR.escuro, r.w * 0.6);
    if (sub) N.escrever(c, sub, r.x + 18 + c.measureText(t).width + 10, r.y + 28, 12, 500, N.COR.fraco, r.w * 0.38);
  }
  /** Tabela genérica no canvas: cabeçalho em caixa alta, 1ª coluna à esquerda com bolinha de cor, demais à direita. */
  function tabelaCanvas(c, r, t, altLinha) {
    var x0 = r.x + 18, w = r.w - 36, n = t.cab.length, w1 = w * 0.22, wo = (w - w1) / (n - 1), y = r.y + 54, lh = altLinha || 34;
    t.cab.forEach(function (h, i) { N.escrever(c, h.toUpperCase(), i ? x0 + w1 + wo * i : x0, y, 10, 600, N.COR.fraco, i ? wo - 6 : w1 - 6, i ? 'right' : 'left'); });
    c.fillStyle = N.COR.linha; c.fillRect(x0, y + 8, w, 1);
    y += 8;
    t.linhas.forEach(function (l) {
      if (l.atual) { c.fillStyle = '#F0F6F3'; c.fillRect(x0 - 8, y, w + 16, lh); }
      var yb = y + lh / 2 + 5;
      c.fillStyle = l.cor; N.rr(c, x0, yb - 11, 10, 10, 3); c.fill();
      var wn = N.escrever(c, l.nome, x0 + 16, yb, 13, 700, N.COR.texto, w1 - 20);
      if (l.selo) N.escrever(c, l.selo, x0 + 16 + wn + 6, yb, 10.5, 600, N.COR.fraco, w1 - wn - 24);
      l.celulas.forEach(function (cel, i) {
        var xr = x0 + w1 + wo * (i + 1), forte = i === 0 && (l.atual || (l.dif !== null && l.dif !== undefined));
        var dif = i === 0 && l.dif !== null && l.dif !== undefined ? textoDif(l.dif) : '';
        if (dif) { var wd = N.escrever(c, dif, xr, yb, 10.5, 600, l.dif >= 0 ? '#1E7B4F' : '#B3261E', wo * 0.5, 'right'); N.escrever(c, cel, xr - wd - 6, yb, 12.5, 700, N.COR.texto, wo - wd - 12, 'right'); }
        else N.escrever(c, cel, xr, yb, 12.5, forte ? 700 : 500, N.COR.texto, wo - 6, 'right');
      });
      c.fillStyle = N.COR.grade; c.fillRect(x0, y + lh, w, 1);
      y += lh;
    });
    return y;
  }
  function listaCanvas(c, r, titulo, itens, barras) {
    N.caixa(c, r, 12);
    tituloCartao(c, r, titulo);
    var x0 = r.x + 18, w = r.w - 36, y = r.y + 54, lh = barras ? 36 : 28;
    if (!itens.length) { N.escrever(c, 'Sem dados', x0, y + 10, 13, 500, N.COR.fraco, w); return; }
    itens.forEach(function (it) {
      var yb = y + 14;
      if (it.cor) { c.fillStyle = it.cor; N.rr(c, x0, yb - 10, 10, 10, 3); c.fill(); if (it.borda) { c.strokeStyle = '#C9D3CB'; c.lineWidth = 1; c.stroke(); } }
      N.escrever(c, it.nome, x0 + (it.cor ? 16 : 0), yb, 12.5, 500, N.COR.texto, w * 0.55);
      N.escrever(c, it.valor, x0 + w, yb, 12.5, 700, N.COR.texto, w * 0.45, 'right');
      if (it.sub) { var wv = c.measureText(it.valor).width; N.escrever(c, it.sub, x0 + w - wv - 6, yb, 10.5, 500, N.COR.fraco, w * 0.3, 'right'); }
      if (barras) { N.rr(c, x0, yb + 8, w, 5, 2.5); c.fillStyle = '#E3E8E4'; c.fill(); if (it.fr > 0) { N.rr(c, x0, yb + 8, Math.max(5, w * Math.min(1, it.fr)), 5, 2.5); c.fillStyle = N.COR.teal; c.fill(); } }
      c.fillStyle = N.COR.grade; c.fillRect(x0, y + lh - 1, w, 1);
      y += lh;
    });
  }
  function legendaCv(c, itens, x, y) {
    N.legendaCartao(c, itens.map(function (i) { return [i.cor, i.nome, i.tipo === 'tracejada' ? 'tracejada' : i.tipo === 'linha' ? 'linha' : undefined]; }), x, y);
  }

  /** Blocos do relatório, de cima para baixo: cada um sabe a própria altura e se desenha num retângulo. */
  function blocos(rel, cMedida) {
    var W = LARG - 2 * M, b = [], m = rel.m;
    // leitura
    var frases = rel.frases.map(L.trechos), alturaLeitura = 50;
    frases.forEach(function (f) { alturaLeitura += escreverRico(cMedida, f, 0, 0, W - 36, 13.5, 20, true) + 20 + 8; });
    b.push({ h: alturaLeitura + 4, desenhar: function (c, r) {
      N.caixa(c, r, 12); tituloCartao(c, r, 'Leitura da operação', 'gerada pelos dados');
      var y = r.y + 54;
      frases.forEach(function (f) { y = escreverRico(c, f, r.x + 18, y, r.w - 36, 13.5, 20) + 28; });
    } });
    if (rel.semDados) return b;
    // indicadores
    var ks = indicadores(rel);
    b.push({ h: 92, desenhar: function (c, r) {
      var g = 10, w = (r.w - g * (ks.length - 1)) / ks.length;
      ks.forEach(function (k, i) {
        var q = { x: r.x + i * (w + g), y: r.y, w: w, h: r.h };
        N.caixa(c, q, 10);
        N.escrever(c, k[0].toUpperCase(), q.x + 14, q.y + 24, 9.5, 600, N.COR.fraco, w - 28);
        var wv = N.escrever(c, k[1], q.x + 14, q.y + 54, 24, 650, N.COR.texto, w - 28 - (k[2] ? 40 : 0));
        if (k[2]) N.escrever(c, k[2], q.x + 14 + wv + 4, q.y + 54, 11.5, 600, N.COR.suave, 40);
        N.escrever(c, k[3], q.x + 14, q.y + 76, 11, 500, k[4] === 'bom' ? '#1E7B4F' : k[4] === 'ruim' ? '#B3261E' : k[4] === 'atencao' ? '#B7791F' : N.COR.suave, w - 28);
      });
    } });
    // esta safra × anteriores
    var tc = tabelaComparativo(rel);
    b.push({ h: 62 + tc.linhas.length * 34 + (tc.nota ? 26 : 16), desenhar: function (c, r) {
      N.caixa(c, r, 12); tituloCartao(c, r, 'Esta safra × anteriores', 'mesma data do ano (' + dataCurta(m.ult) + ') e safra inteira');
      var y = tabelaCanvas(c, r, tc);
      if (tc.nota) N.escrever(c, tc.nota, r.x + 18, y + 18, 11, 500, N.COR.fraco, r.w - 36);
    } });
    // hectares por dia
    b.push({ h: 300, desenhar: async function (c, r) {
      N.caixa(c, r, 12); tituloCartao(c, r, 'Hectares por dia' + (rel.temMetaNaSerie ? ' × meta' : '') + (rel.temChuva ? ' × chuva' : ''), 'safra atual');
      legendaCv(c, legendaDiario(rel), r.x + 18, r.y + 52);
      var a = { x: r.x + 8, y: r.y + 60, w: r.w - 16, h: r.h - 68 };
      var img = await N.grafico(a.w, a.h, opcoesDiario(rel, KEXP, a.w), ESC);
      if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
    } });
    // acumulado + talhões (ou acumulado inteiro, em Todas)
    b.push({ h: 300, desenhar: async function (c, r) {
      var wA = rel.todas ? r.w : (r.w - G) * 0.56, rA = { x: r.x, y: r.y, w: wA, h: r.h };
      N.caixa(c, rA, 12); tituloCartao(c, rA, 'Acumulado pela data do ano');
      legendaCv(c, legendaAcum(rel), rA.x + 18, rA.y + 52);
      var a = { x: rA.x + 8, y: rA.y + 60, w: rA.w - 16, h: rA.h - 68 };
      var img = await N.grafico(a.w, a.h, N.opcoesAcumulado(m, KEXP), ESC);
      if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
      if (rel.todas) return;
      var rT = { x: r.x + wA + G, y: r.y, w: r.w - wA - G, h: r.h };
      N.caixa(c, rT, 12); tituloCartao(c, rT, '% ' + feito(rel.o) + ' por talhão', m.talhoes.length + ' talhões');
      var a2 = { x: rT.x + 8, y: rT.y + 44, w: rT.w - 16, h: rT.h - 52 };
      if (!m.talhoes.length) { N.escrever(c, 'Nenhum talhão cadastrado nesta safra.', a2.x + a2.w / 2, a2.y + a2.h / 2, 13, 500, N.COR.fraco, a2.w, 'center'); return; }
      var img2 = await N.grafico(a2.w, a2.h, opcoesTalhoes(rel, KEXP, a2.w), ESC);
      if (img2) c.drawImage(img2, a2.x, a2.y, a2.w, a2.h);
    } });
    // tabela por fazenda (Todas)
    if (rel.todas) {
      var tf = tabelaFazendas(rel);
      b.push({ h: 62 + tf.linhas.length * 34 + 16, desenhar: function (c, r) { N.caixa(c, r, 12); tituloCartao(c, r, 'Fazendas', 'da mais adiantada à mais atrasada'); tabelaCanvas(c, r, tf); } });
    }
    // situação, equipes e variedades
    var sit = listaSituacao(rel), eq = listaEquipes(rel).map(function (e) { return { nome: e.nome, valor: N.fmtN(e.ult7) + ' ha', sub: 'total ' + N.fmtN(e.total) }; });
    var vs = listaVariedades(rel), maxV = 9, vsL = vs.slice(0, maxV).map(function (v) { return { nome: v.v, valor: N.fmtN(v.exec) + ' / ' + N.fmtN(v.prev) + ' ha', fr: v.exec / v.prev }; });
    if (vs.length > maxV) vsL.push({ nome: '+ ' + (vs.length - maxV) + ' variedades', valor: '', fr: 0 });
    var hTrio = 62 + Math.max(sit.length * 28 + 24, eq.length * 28, vsL.length * 36, 60);
    b.push({ h: hTrio, desenhar: function (c, r) {
      var w = (r.w - 2 * G) / 3;
      listaCanvas(c, { x: r.x, y: r.y, w: w, h: r.h }, 'Situação dos talhões', sit);
      N.escrever(c, 'Dano ' + N.fmtN(m.dano) + ' ha · Replantio ' + N.fmtN(m.replantio) + ' ha', r.x + 18, r.y + r.h - 16, 11, 500, N.COR.fraco, w - 36);
      listaCanvas(c, { x: r.x + w + G, y: r.y, w: w, h: r.h }, 'Equipes · últimos 7 dias', eq);
      listaCanvas(c, { x: r.x + 2 * (w + G), y: r.y, w: w, h: r.h }, 'Variedades · ' + feito(rel.o) + ' / previsto', vsL, true);
    } });
    return b;
  }
  async function imagens(rel) {
    var r = await Promise.all([N.talvezImagem(N.fundoCultura(rel.s)), N.talvezImagem('assets/logo_coa_branco.png')]);
    return { cultura: r[0], coa: r[1] };
  }
  function novoCanvas(w, h) {
    var cv = document.createElement('canvas'); cv.width = Math.round(w * ESC); cv.height = Math.round(h * ESC);
    var c = cv.getContext('2d'); c.scale(ESC, ESC); c.fillStyle = '#F1F2F1'; c.fillRect(0, 0, w, h);
    return { cv: cv, c: c };
  }
  var exp = { formato: 'png', blob: null, url: null, gerando: 0, tam: null, paginas: 1 };

  /** Uma imagem só, com todos os blocos empilhados. */
  async function gerarPng() {
    var rel = R, imgs = await imagens(rel), medida = document.createElement('canvas').getContext('2d');
    var bs = blocos(rel, medida), hCab = 160, H = hCab + G + bs.reduce(function (s, b) { return s + b.h + G; }, 0) + 44;
    ESC = N.escalaExport(LARG, H, ESC_PNG);
    var t = novoCanvas(LARG, H), c = t.c, y = hCab + G;
    cabecalho(c, LARG, hCab, rel, imgs, false);
    for (var i = 0; i < bs.length; i++) { await bs[i].desenhar(c, { x: M, y: y, w: LARG - 2 * M, h: bs[i].h }); y += bs[i].h + G; }
    rodape(c, LARG, y + 18, rel);
    exp.tam = { w: t.cv.width, h: t.cv.height }; exp.paginas = 1;
    return new Promise(function (ok) { t.cv.toBlob(ok, 'image/png'); });
  }
  /** PDF A4 em pé: os blocos fluem pelas páginas (um bloco não é cortado ao meio). */
  async function gerarPdf() {
    var jsPDF = await carregarJsPdf(), rel = R, imgs = await imagens(rel), escAntes = ESC;
    ESC = 2.2;
    try {
      var medida = document.createElement('canvas').getContext('2d'), bs = blocos(rel, medida), paginas = [], hCab = 160, hRod = 44;
      var pag = null, y = 0;
      function nova(compacto) { var cab = compacto ? 96 : hCab; pag = novoCanvas(LARG, ALT_A4); cabecalho(pag.c, LARG, cab, rel, imgs, compacto); y = cab + G; paginas.push(pag); }
      nova(false);
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i];
        if (y + b.h > ALT_A4 - hRod && y > hCab + G + 1) { rodape(pag.c, LARG, ALT_A4 - 18, rel); nova(true); }
        await b.desenhar(pag.c, { x: M, y: y, w: LARG - 2 * M, h: Math.min(b.h, ALT_A4 - hRod - y) });
        y += b.h + G;
      }
      rodape(pag.c, LARG, ALT_A4 - 18, rel);
      var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      paginas.forEach(function (p, k) { if (k) pdf.addPage('a4', 'portrait'); pdf.addImage(p.cv.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST'); });
      pdf.setProperties({ title: 'Relatório consolidado - ' + tituloRelatorio(rel), creator: 'COA WEB · Acompanhamento Operacional' });
      exp.paginas = paginas.length;
      return pdf.output('blob');
    } finally { ESC = escAntes; }
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
    return ['relatorio', s(R.o), s(R.s), s(R.todas ? 'todas' : R.u), N.paraIso(N.hoje())].join('-') + '.' + ext;
  }
  async function atualizarExport() {
    var n = ++exp.gerando, st = $('rl-exp-status');
    st.textContent = exp.formato === 'pdf' ? 'Gerando o PDF…' : 'Gerando a imagem…';
    $('rl-exp-baixar').disabled = true;
    try {
      var blob = exp.formato === 'pdf' ? await gerarPdf() : await gerarPng();
      if (n !== exp.gerando) return;
      if (exp.url) URL.revokeObjectURL(exp.url);
      exp.blob = blob; exp.url = URL.createObjectURL(blob);
      $('rl-exp-previa').hidden = exp.formato === 'pdf';
      if (exp.formato === 'png') $('rl-exp-previa').src = exp.url;
      st.textContent = (exp.formato === 'pdf' ? 'PDF A4 em pé · ' + exp.paginas + (exp.paginas === 1 ? ' página' : ' páginas') : 'PNG · ' + exp.tam.w + ' × ' + exp.tam.h + ' px') + ' · ' + Math.round(blob.size / 1024) + ' KB' + (exp.formato === 'png' ? N.AVISO_WHATSAPP : '');
      $('rl-exp-baixar').disabled = false;
    } catch (e) {
      if (n === exp.gerando) st.textContent = 'Não foi possível gerar: ' + (e && e.message ? e.message : e);
    }
  }
  function abrirExportar() {
    if (!R) return;
    document.querySelectorAll('#dlg-relatorio input[name="rl-fmt"]').forEach(function (r) { r.checked = r.value === exp.formato; });
    $('dlg-relatorio').showModal();
    atualizarExport();
  }
  function baixar() {
    if (!exp.blob) return;
    var a = document.createElement('a'); a.href = exp.url; a.download = nomeArquivo(exp.formato);
    document.body.appendChild(a); a.click(); a.remove();
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('rl-exportar').addEventListener('click', abrirExportar);
    $('rl-exp-fechar').addEventListener('click', function () { $('dlg-relatorio').close(); });
    $('rl-exp-baixar').addEventListener('click', baixar);
    document.querySelectorAll('#dlg-relatorio input[name="rl-fmt"]').forEach(function (r) {
      r.addEventListener('change', function () { exp.formato = this.value; atualizarExport(); });
    });
  });

  window.AcompRelatorio = { render: render, exportar: abrirExportar };
})();
