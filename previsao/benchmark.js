/* =====================================================================
   Previsão do Tempo — aba "Benchmark": a previsão de chuva de cada fonte lado a lado (próximos 15 dias), quem
   acerta mais (ranking) e o previsto × medido dos últimos 30 dias. Dados: prev_previsoes, prev_observado e
   prev_metricas, gravados pela rotina da VM; contas em benchmark-logica.js. Créditos exigidos pelas fontes no rodapé.
===================================================================== */
(function () {
  'use strict';

  const B = window.PrevisaoBenchmark;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PERIODOS = [['30d', 'Últimos 30 dias'], ['60d', 'Últimos 60 dias'], ['90d', 'Últimos 90 dias'], ['safra', 'Safra']];
  const fmtMm = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  // eixo dos gráficos: até 2 casas (com 1 casa, uma escala de 0 a 0,1 repetiria o rótulo 0)
  const fmtEixo = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const fmtDia = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const fmtSemana = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  const fmtHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  const RECARGA_MS = 30 * 60 * 1000; // a rotina grava de hora em hora: dados com mais de 30 min são lidos de novo ao voltar à aba
  let ctx = null;
  let dados = null;
  let carregadoEm = 0;
  let erroLeitura = '';
  let periodo = '30d';
  let antecedencia = 1;
  const graficos = {};

  /* celular: a legenda quebra em duas linhas; o desenho desce e o nome do eixo sai (a unidade está no subtítulo e na dica) */
  function moldura(id) {
    const estreito = $(id).clientWidth < 520;
    return { grid: { left: 40, right: 12, top: estreito ? 60 : 32, bottom: 28 }, yAxis: { name: estreito ? '' : 'mm' } };
  }
  function grafico(id) {
    if (!graficos[id]) graficos[id] = window.echarts.init($(id));
    return graficos[id];
  }
  function montarEstrutura() {
    $('benchmark').innerHTML =
      '<p class="bm-aviso" id="bm-aviso" hidden></p>' +
      '<div class="bm-blocos" id="bm-blocos">' +
      '<section class="bm-cartao"><div class="bm-cab"><h2>Próximos 15 dias</h2><span class="bm-sub" id="bm-sub-proximos"></span></div>' +
      '<div class="bm-grafico" id="bm-g-proximos"></div><div class="bm-tabela-rolagem"><table class="bm-tabela" id="bm-t-proximos"></table></div>' +
      '<p class="bm-rodape" id="bm-rodape"></p></section>' +
      '<section class="bm-cartao"><div class="bm-cab"><h2>Quem acerta mais</h2><label class="campo-select"><span>Período</span><select id="bm-periodo"></select></label></div>' +
      '<p class="bm-sub" id="bm-sub-ranking"></p><div class="bm-tabela-rolagem"><table class="bm-tabela" id="bm-t-ranking"></table></div></section>' +
      '<section class="bm-cartao"><div class="bm-cab"><h2>Previsto × medido</h2><label class="campo-select"><span>Antecedência</span><select id="bm-antecedencia"></select></label></div>' +
      '<p class="bm-sub">Últimos 30 dias: colunas = chuva medida pelos pluviômetros; linhas = o que cada fonte previa com essa antecedência.</p>' +
      '<p class="bm-sub" id="bm-vazio-historico" hidden>Ainda não há chuva medida nem previsão com essa antecedência nos últimos 30 dias.</p>' +
      '<div class="bm-grafico" id="bm-g-historico"></div></section>' +
      '</div>';
    $('bm-periodo').innerHTML = PERIODOS.map((p) => '<option value="' + p[0] + '">' + esc(p[1]) + '</option>').join('');
    $('bm-antecedencia').innerHTML = [1, 3, 7].map((k) => '<option value="' + k + '">' + k + (k === 1 ? ' dia antes' : ' dias antes') + '</option>').join('');
    $('bm-periodo').addEventListener('change', (e) => { periodo = e.target.value; desenharRanking(); });
    $('bm-antecedencia').addEventListener('change', (e) => { antecedencia = Number(e.target.value); desenharHistorico(); });
    // cada gráfico se ajusta quando muda de tamanho (janela, celular girado, ou quando volta a aparecer)
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => Object.keys(graficos).forEach((id) => { graficos[id].setOption(moldura(id)); graficos[id].resize(); }));
      ['bm-g-proximos', 'bm-g-historico'].forEach((id) => ro.observe($(id)));
    }
  }
  function aviso(texto) {
    $('bm-aviso').textContent = texto || '';
    $('bm-aviso').hidden = !texto;
  }

  async function abrir(contexto) {
    ctx = contexto;
    if (!$('bm-blocos')) montarEstrutura();
    if (!dados || Date.now() - carregadoEm > RECARGA_MS) {
      try {
        dados = await ctx.carregar(B.hojeMT());
        erroLeitura = '';
      } catch (e) {
        if (!dados) dados = { previsoes: [], observado: [], metricas: [] };
        erroLeitura = 'Não foi possível ler o benchmark: ' + (e && e.message ? e.message : e);
      }
      carregadoEm = Date.now();
    }
    desenhar();
  }
  function atualizar() { if (dados) desenhar(); }

  /* Sem fazenda ligada ao PIMS ou sem nenhuma foto ainda: só o aviso, sem blocos vazios. */
  function desenhar() {
    const unidade = ctx.unidade();
    const temFoto = B.diasDeFoto(dados.previsoes) > 0;
    let texto = erroLeitura;
    if (!texto && unidade === null) texto = 'Esta fazenda não está ligada a uma unidade do PIMS no cadastro do Mapas: não há benchmark para ela.';
    if (!texto && !temFoto) texto = 'Ainda não há fotos da previsão. A primeira sai às 6 h (horário de Mato Grosso) do dia seguinte à publicação; o ranking passa a ter números cerca de 11 dias depois.';
    aviso(texto);
    const semBlocos = unidade === null || !temFoto;
    $('bm-blocos').hidden = semBlocos;
    if (semBlocos) return;
    desenharProximos();
    desenharRanking();
    desenharHistorico();
  }

  function desenharProximos() {
    const r = B.proximosDias(dados.previsoes, ctx.unidade(), B.hojeMT());
    $('bm-sub-proximos').textContent = ctx.nomeFazenda() + ' · mm por dia' + (r.divergentes.length ? ' · em destaque, os dias em que as fontes discordam' : '');
    $('bm-g-proximos').hidden = !r.series.length;
    grafico('bm-g-proximos').setOption({
      animation: false,
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMm(v) + ' mm' },
      legend: { top: 0 },
      grid: moldura('bm-g-proximos').grid,
      xAxis: { type: 'category', data: r.dias.map((d, i) => (i === 0 ? 'Hoje' : fmtSemana(d) + ' ' + fmtDia(d))) },
      yAxis: { type: 'value', name: moldura('bm-g-proximos').yAxis.name, axisLabel: { formatter: fmtEixo } },
      series: r.series.map((s) => ({
        name: s.nome, type: 'bar', data: s.mm, itemStyle: { color: s.cor, borderRadius: [3, 3, 0, 0] },
        markArea: s === r.series[0] && r.divergentes.length ? { silent: true, itemStyle: { color: 'rgba(219,138,8,0.12)' }, data: r.divergentes.map((i) => [{ xAxis: i }, { xAxis: i }]) } : undefined,
      })),
    }, true);
    const cab = '<thead><tr><th>Fonte</th>' + r.dias.map((d, i) => '<th class="' + (r.divergentes.indexOf(i) >= 0 ? 'bm-diverge' : '') + '">' + (i === 0 ? 'Hoje' : fmtDia(d)) + '</th>').join('') + '<th>15 dias</th></tr></thead>';
    const corpo = r.series.map((s) => '<tr><th><i class="bm-cor" style="background:' + esc(s.cor) + '"></i>' + esc(s.nome) + '</th>' +
      s.mm.map((v, i) => '<td class="' + (r.divergentes.indexOf(i) >= 0 ? 'bm-diverge' : '') + '">' + fmtMm(v) + (s.p[i] !== null ? '<small>' + s.p[i] + '%</small>' : '') + '</td>').join('') +
      '<td><b>' + fmtMm(s.total) + '</b></td></tr>').join('');
    $('bm-t-proximos').innerHTML = r.series.length ? cab + '<tbody>' + corpo + '</tbody>' : '<tbody><tr><td>Sem previsão para esta escolha.</td></tr></tbody>';
    $('bm-rodape').innerHTML = r.series.map((s) => esc(s.nome) + ': foto de ' + esc(fmtHora(s.capturadaEm))).join(' · ') +
      '<br>Dados de Visual Crossing (visualcrossing.com) · MET Norway, CC BY 4.0 · ZEUS (Locks). Em "Hoje", a previsão da manhã; o MET Norway começa em amanhã.';
  }

  function desenharRanking() {
    const unidade = ctx.unidade();
    // há métricas, mas nenhuma de "Todas": o usuário não vê todas as fazendas (a RLS não entrega essas linhas)
    if (unidade === B.TODAS && dados.metricas.length && !B.temTodas(dados.metricas)) {
      $('bm-sub-ranking').textContent = 'O ranking de todas as fazendas juntas só aparece para quem vê todas elas. Escolha uma fazenda no seletor.';
      $('bm-t-ranking').innerHTML = '';
      return;
    }
    const linhas = B.ranking(dados.metricas, unidade, periodo);
    const fotos = B.diasDeFoto(dados.previsoes);
    $('bm-sub-ranking').textContent = (linhas.length ? 'Ordem: menor erro médio nas previsões feitas de 1 a 7 dias antes. ' : 'Ainda sem dias avaliados. ') +
      'Com menos de ' + B.MINIMO_PARES + ' dias avaliados aparece "histórico insuficiente". ' + (fotos ? fotos + ' dia(s) de foto até agora.' : '');
    const celula = (v) => (!v ? '<td>—</td>' : v.suficiente ? '<td>' + fmtMm(v.erro) + ' mm<small>' + v.n + ' dias</small></td>' : '<td class="bm-poucos">histórico insuficiente<small>' + v.n + ' dias</small></td>');
    const cab = '<thead><tr><th>#</th><th>Fonte</th><th>Erro médio (1 a 7 dias)</th>' + B.ANTECEDENCIAS.map((k) => '<th>' + k + (k === 1 ? ' dia' : ' dias') + '</th>').join('') + '<th>Acerto chove/não chove</th><th>Tendência</th></tr></thead>';
    const corpo = linhas.map((l, i) => '<tr><td>' + (l.geral && l.geral.suficiente ? i + 1 : '—') + '</td><th><i class="bm-cor" style="background:' + esc(l.cor) + '"></i>' + esc(l.nome) + '</th>' +
      celula(l.geral) + l.porAntecedencia.map((x) => celula(x.valor)).join('') +
      '<td>' + (l.geral && l.geral.suficiente ? fmtMm(l.geral.acerto) + '%' : '—') + '</td>' +
      '<td>' + esc(l.geral && l.geral.suficiente ? B.textoVies(l.geral.vies) : '—') + '</td></tr>').join('');
    $('bm-t-ranking').innerHTML = linhas.length ? cab + '<tbody>' + corpo + '</tbody>' : '';
  }

  function desenharHistorico() {
    const r = B.previstoMedido(dados.previsoes, dados.observado, ctx.unidade(), antecedencia, B.hojeMT());
    const vazio = !r.series.length && r.medido.every((v) => v === null);
    $('bm-vazio-historico').hidden = !vazio;
    $('bm-g-historico').hidden = vazio;
    if (vazio) return;
    grafico('bm-g-historico').setOption({
      animation: false,
      tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMm(v) + ' mm' },
      legend: { top: 0 },
      grid: moldura('bm-g-historico').grid,
      xAxis: { type: 'category', data: r.dias.map(fmtDia) },
      yAxis: { type: 'value', name: moldura('bm-g-historico').yAxis.name, axisLabel: { formatter: fmtEixo } },
      series: [{ name: 'Chuva medida', type: 'bar', data: r.medido, itemStyle: { color: '#9aa7a0' } }].concat(r.series.map((s) => ({
        name: s.nome, type: 'line', data: s.mm, connectNulls: false, symbolSize: 5, lineStyle: { width: 2, color: s.cor }, itemStyle: { color: s.cor },
      }))),
    }, true);
  }

  window.PrevisaoBenchmarkTela = { abrir, atualizar };
})();
