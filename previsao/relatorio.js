/* =====================================================================
   Previsão do Tempo — relatório em PDF por fazenda (botão "Relatório (PDF)" da barra): capa e uma página por
   fazenda com a máxima e a mínima em cima, a chuva da ZEUS embaixo e a faixa com os números de cada dia.
   Contas em relatorio-logica.js; gráficos com ECharts desenhados fora da tela; PDF com jsPDF 2.5.1, carregado só
   no clique (como no relatório do Operacional). Todo texto do PDF passa por paraPdf (fonte padrão do jsPDF).
===================================================================== */
(function () {
  'use strict';

  const R = window.PrevisaoRelatorioLogica;
  const COR = { max: '#db8a08', min: '#5470c6', chuva: '#0f9484', texto: '#17251F', suave: '#5B6B62', marca: '#0C5A50', escuro: '#103632', faixa: '#F1F4F1' };
  const A4 = { largura: 297, altura: 210, margem: 12 };
  const GRAFICO = { largura: 1600, altura: 640 };
  // coluna dos nomes da faixa de números (mm); o gráfico começa no mesmo ponto para cada dia ficar em cima da sua coluna
  const ROTULO_MM = 32;
  // nomes das duas séries da faixa entre as temperaturas (ficam fora da legenda)
  const FAIXA_BASE = 'faixa-base';
  const FAIXA = 'faixa';
  let jsPdfCarregando = null;

  function carregarJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfCarregando) jsPdfCarregando = new Promise(function (ok, falha) {
      const s = document.createElement('script');
      // versão fixa conferida pelo navegador (SRI): arquivo diferente do esperado não roda
      s.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
      s.crossOrigin = 'anonymous';
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function () { ok(window.jspdf.jsPDF); };
      s.onerror = function () { jsPdfCarregando = null; falha(new Error('Não foi possível carregar o gerador de PDF. Verifique a conexão.')); };
      document.head.appendChild(s);
    });
    return jsPdfCarregando;
  }
  /** Imagem do próprio site (logos) como data URL; null se não abrir (o PDF sai sem ela). */
  async function imagem(caminho) {
    try {
      const r = await fetch(caminho);
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(blob); });
    } catch (e) {
      return null;
    }
  }

  const fmtDia = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const fmtSemana = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  const fmtNum = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
  const fmtHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const nomeFonte = (id) => (id === 'metno' ? 'MET Norway (CC BY 4.0)' : id === 'visualcrossing' ? 'Visual Crossing' : '');
  const texto = (pdf, t, x, y, opcoes) => pdf.text(R.paraPdf(t), x, y, opcoes);

  /** Gráfico de uma fazenda como PNG: temperatura em cima e chuva embaixo, com as mesmas datas (um painel só se faltar um). */
  function grafico(f) {
    const temTemp = f.tx.some((v) => v !== null) || f.tn.some((v) => v !== null);
    const temChuva = f.mm.some((v) => v !== null);
    const paineis = [temTemp ? 'temp' : null, temChuva ? 'chuva' : null].filter(Boolean);
    const datas = f.dias.map((d) => fmtSemana(d) + ' ' + fmtDia(d));
    const eixo = { fontSize: 20, color: COR.suave };
    const grid = [], xAxis = [], yAxis = [], series = [];
    paineis.forEach((p, i) => {
      const dois = paineis.length === 2;
      const esquerda = Math.round(GRAFICO.largura * ROTULO_MM / (A4.largura - 2 * A4.margem));
      grid.push({ left: esquerda, right: 0, top: dois ? (i === 0 ? 60 : 345) : 60, height: dois ? 240 : 525 });
      // embaixo, só o dia da semana (todos os dias); a data está na faixa de números logo abaixo
      xAxis.push({ type: 'category', gridIndex: i, data: datas, axisLabel: Object.assign({ show: i === paineis.length - 1, interval: 0, formatter: (v) => v.split(' ')[0] }, eixo), axisTick: { alignWithLabel: true } });
      if (p === 'temp') {
        yAxis.push({ type: 'value', gridIndex: i, scale: true, name: '°C', nameTextStyle: eixo, axisLabel: eixo });
        // faixa em degradê entre a mínima e a máxima (como no modelo): uma base invisível na mínima e, empilhada nela,
        // a altura da faixa, com a área pintada do laranja da máxima (em cima) ao azul da mínima (embaixo)
        const faixa = { type: 'line', xAxisIndex: i, yAxisIndex: i, stack: 'faixa', symbol: 'none', silent: true, lineStyle: { opacity: 0 } };
        series.push(Object.assign({ name: FAIXA_BASE, data: f.tn }, faixa));
        series.push(Object.assign({
          name: FAIXA, data: R.faixaDeTemperatura(f.tx, f.tn),
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(219,138,8,0.42)' }, { offset: 1, color: 'rgba(84,112,198,0.30)' }] } },
        }, faixa));
        series.push({ name: 'Máxima (°C)', type: 'line', xAxisIndex: i, yAxisIndex: i, data: f.tx, symbolSize: 10, lineStyle: { width: 4, color: COR.max }, itemStyle: { color: COR.max } });
        series.push({ name: 'Mínima (°C)', type: 'line', xAxisIndex: i, yAxisIndex: i, data: f.tn, symbolSize: 10, lineStyle: { width: 4, color: COR.min }, itemStyle: { color: COR.min } });
      } else {
        yAxis.push({ type: 'value', gridIndex: i, min: 0, name: 'mm', nameTextStyle: eixo, axisLabel: eixo });
        series.push({ name: 'Chuva (mm) — ZEUS', type: 'bar', xAxisIndex: i, yAxisIndex: i, data: f.mm, barMaxWidth: 52, itemStyle: { color: COR.chuva, borderRadius: [4, 4, 0, 0] } });
      }
    });
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + GRAFICO.largura + 'px;height:' + GRAFICO.altura + 'px;';
    document.body.appendChild(div);
    const c = window.echarts.init(div, null, { renderer: 'canvas', width: GRAFICO.largura, height: GRAFICO.altura });
    try {
      c.setOption({ animation: false, backgroundColor: '#fff', legend: { top: 0, data: series.map((s) => s.name).filter((n) => n !== FAIXA_BASE && n !== FAIXA), textStyle: { fontSize: 20, color: COR.texto } }, grid, xAxis, yAxis, series });
      return c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    } finally {
      c.dispose();
      div.remove();
    }
  }

  function rodape(pdf, n) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(COR.suave);
    texto(pdf, 'COA WEB · Previsão do Tempo · relatório por fazenda', A4.margem, A4.altura - 7);
    texto(pdf, String(n), A4.largura - A4.margem, A4.altura - 7, { align: 'right' });
  }

  function capa(pdf, rel, info) {
    const m = A4.margem;
    // os logos do COA e da Locks são brancos (feitos para fundo escuro): faixa verde-escura no topo da capa
    pdf.setFillColor(COR.escuro);
    pdf.rect(0, 0, A4.largura, 38, 'F');
    if (info.logoCoa) pdf.addImage(info.logoCoa, 'PNG', m, 7, 92, 92 * 234 / 900);
    if (info.logoLocks) pdf.addImage(info.logoLocks, 'PNG', A4.largura - m - 80, 15.5, 80, 80 * 70 / 900);
    pdf.setTextColor(COR.marca);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(30);
    texto(pdf, 'Previsão do Tempo — Fazendas', m, 82);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(14);
    pdf.setTextColor(COR.texto);
    texto(pdf, 'Emitido em ' + info.hojeTexto + ' · previsão da foto de ' + fmtHora(rel.fotoMaisRecente), m, 94);
    const temp = rel.fontesTemperatura.map(nomeFonte).join(' e ') || 'indisponível nesta emissão';
    const linhas = [
      'Fazendas: ' + rel.fazendas.map((f) => f.nome).join(', ') + '.',
      'Chuva: ZEUS (Locks), média dos pluviômetros de cada fazenda, com a probabilidade de chuva.',
      'Temperatura máxima e mínima: ' + temp + '.',
      'Dados de Visual Crossing (visualcrossing.com) e de MET Norway (api.met.no), CC BY 4.0, quando usados.',
      'Gerado por ' + info.usuario + ' em ' + info.agoraTexto + '.',
    ];
    pdf.setFontSize(11);
    pdf.setTextColor(COR.suave);
    let y = 112;
    linhas.forEach((t) => {
      pdf.splitTextToSize(R.paraPdf(t), A4.largura - 2 * m).forEach((l) => { pdf.text(l, m, y); y += 6; });
      y += 2;
    });
    rodape(pdf, 1);
  }

  /** Faixa de números: uma coluna por dia (data, chuva, probabilidade, máxima, mínima) e o total de chuva. */
  function faixa(pdf, f, topo) {
    const m = A4.margem;
    const largura = A4.largura - 2 * m;
    const rotulo = ROTULO_MM;
    const coluna = (largura - rotulo) / f.dias.length;
    const altura = 6.4;
    const linhas = [
      ['Dia', f.dias.map(fmtDia)],
      ['Chuva (mm)', f.mm.map(fmtNum)],
      ['Prob. de chuva (%)', f.p.map((v) => (v === null ? '—' : String(v)))],
      ['Máxima (°C)', f.tx.map(fmtNum)],
      ['Mínima (°C)', f.tn.map(fmtNum)],
    ];
    pdf.setFontSize(8.5);
    linhas.forEach(([nome, valores], i) => {
      const y = topo + i * altura;
      if (i % 2 === 0) { pdf.setFillColor(COR.faixa); pdf.rect(m, y - 4.4, largura, altura, 'F'); }
      pdf.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      pdf.setTextColor(i === 0 ? COR.suave : COR.texto);
      texto(pdf, nome, m + 1.5, y);
      valores.forEach((v, j) => texto(pdf, v, m + rotulo + coluna * (j + 0.5), y, { align: 'center' }));
    });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(COR.texto);
    texto(pdf, 'Chuva prevista no período (ZEUS): ' + (f.total === null ? '—' : fmtNum(f.total) + ' mm'), m, topo + linhas.length * altura + 4);
  }

  function paginaDaFazenda(pdf, f, n) {
    const m = A4.margem;
    const largura = A4.largura - 2 * m;
    pdf.setTextColor(COR.marca);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    texto(pdf, f.nome, m, 18);
    pdf.setFont('helvetica', 'normal');
    if (f.semDados) {
      pdf.setFontSize(12);
      pdf.setTextColor(COR.texto);
      texto(pdf, 'Sem previsão recente para esta fazenda (nenhuma foto nos últimos ' + R.FOTOS_DIAS + ' dias).', m, 34);
      rodape(pdf, n);
      return;
    }
    const chuva = f.fotos.chuva ? 'chuva: ZEUS (Locks), foto de ' + fmtHora(f.fotos.chuva) : 'chuva da ZEUS indisponível';
    const temp = f.fonteTemperatura
      ? 'temperatura: ' + nomeFonte(f.fonteTemperatura) + ', foto de ' + fmtHora(f.fotos.temperatura) +
        (f.fotos.temperaturaAnterior ? '; os dias que faltam nela vêm da foto de ' + fmtHora(f.fotos.temperaturaAnterior) : '')
      : 'temperatura indisponível';
    pdf.setFontSize(9.5);
    pdf.setTextColor(COR.suave);
    texto(pdf, fmtDia(f.dias[0]) + ' a ' + fmtDia(f.dias[f.dias.length - 1]) + ' · ' + chuva, m, 25);
    texto(pdf, temp, m, 29.5);
    const topo = 33;
    const alturaGrafico = largura * GRAFICO.altura / GRAFICO.largura;
    pdf.addImage(grafico(f), 'PNG', m, topo, largura, alturaGrafico, undefined, 'FAST');
    faixa(pdf, f, topo + alturaGrafico + 7);
    rodape(pdf, n);
  }

  /** Gera e baixa o PDF de todas as fazendas que o usuário vê. */
  async function gerar(ctx) {
    const hoje = ctx.hoje();
    const r = await Promise.all([
      carregarJsPdf(),
      ctx.carregar(hoje),
      ctx.usuario().catch(() => ''),
      imagem('../assets/logo-coa-relatorio.png'),
      imagem('../assets/locks-agtech-lab.png'),
    ]);
    const rel = R.montarRelatorio(r[1], ctx.fazendas(), hoje);
    if (!rel.fazendas.length) throw new Error('nenhuma fazenda com unidade do PIMS para o seu usuário.');
    const JsPdf = r[0];
    const pdf = new JsPdf({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    capa(pdf, rel, {
      logoCoa: r[3],
      logoLocks: r[4],
      usuario: r[2] || 'usuário do COA WEB',
      hojeTexto: fmtDia(hoje) + '/' + hoje.slice(0, 4),
      agoraTexto: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    rel.fazendas.forEach((f, i) => { pdf.addPage('a4', 'landscape'); paginaDaFazenda(pdf, f, i + 2); });
    pdf.setProperties({ title: R.paraPdf('Previsão do Tempo — Fazendas — ' + fmtDia(hoje)), creator: 'COA WEB' });
    pdf.save(R.nomeArquivo(hoje));
  }

  window.PrevisaoRelatorio = { gerar };
})();
