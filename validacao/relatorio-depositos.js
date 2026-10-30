/* =====================================================================
   Validação PIMS — relatório em PDF do saldo dos depósitos (aba Consultar depósitos)
   PDF em vetor (texto nítido e selecionável), A4 em pé, feito com o jsPDF (o mesmo dos relatórios do
   Operacional, carregado só no primeiro clique, com SRI). Primeira página: faixa com o logo, a fazenda, quando
   os saldos foram lidos, três números e o resumo por depósito; depois, cada depósito marcado com a tabela dos
   produtos (código, produto, saldo, unidade), saldo negativo em vermelho, cabeçalho repetido na página seguinte
   e rodapé com "Página x de y".
   Entrada: window.RelatorioDepositos.gerar({ fazenda, lidoEm, busca, umPorPagina, depositos: [{ c, n, inativo,
   negativos, itens: [{ c, n, q, u }] }] }) → baixa o arquivo.
===================================================================== */
(function () {
  'use strict';

  const JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
  const LOGO = '../assets/logo-coa-relatorio.png'; // branco sobre transparente, 900 × 234

  // medidas em mm (A4 em pé) e as cores do COA WEB
  const W = 210, H = 297, M = 14, RODAPE = 14;
  const COR = {
    escuro: [16, 54, 50], teal: [12, 90, 80], dourado: [219, 138, 8], texto: [23, 37, 31], suave: [91, 107, 98],
    fraco: [138, 152, 143], linha: [220, 227, 220], zebra: [246, 248, 246], cab: [236, 241, 237], faixa: [227, 242, 234],
    ruim: [179, 38, 30], ruimFundo: [251, 230, 228], branco: [255, 255, 255],
  };

  let carregando = null;
  function carregarJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!carregando) {
      carregando = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = JSPDF_SRC; s.integrity = JSPDF_SRI; s.crossOrigin = 'anonymous';
        s.onload = () => (window.jspdf && window.jspdf.jsPDF ? ok(window.jspdf.jsPDF) : falha(new Error('o gerador de PDF não abriu')));
        s.onerror = () => { carregando = null; s.remove(); falha(new Error('não foi possível carregar o gerador de PDF; confira a internet e tente de novo')); };
        document.head.appendChild(s);
      });
    }
    return carregando;
  }
  /** O logo como data URL (sem ele, o relatório sai com o nome escrito no lugar). */
  async function carregarLogo() {
    try {
      const r = await fetch(LOGO);
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(blob); });
    } catch (e) { return null; }
  }

  // As fontes padrão do PDF só têm o alfabeto latino básico: aspas curvas, travessão e sinal de menos viram os simples.
  const limpo = (t) => String(t === null || t === undefined ? '' : t)
    .replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
  const fmtQtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fmtInt = (v) => Number(v || 0).toLocaleString('pt-BR');
  const fmtQuando = (d) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
  const plural = (n, um, varios) => fmtInt(n) + ' ' + (n === 1 ? um : varios);
  /** "TRES FLECHAS" → "Tres Flechas" (o mesmo da tela). */
  const titulo = (t) => String(t || '').toLowerCase().replace(/(^|[\s\-.\/(])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(Sm3|Ts|Md|Db)\b/g, (m) => m.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (m) => m.toLowerCase());

  function criarDocumento(jsPDF, dados, logo) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const fazenda = titulo(dados.fazenda);
    const cor = (c) => doc.setTextColor(c[0], c[1], c[2]);
    const fundo = (c) => doc.setFillColor(c[0], c[1], c[2]);
    const traco = (c) => doc.setDrawColor(c[0], c[1], c[2]);
    const fonte = (tam, peso) => { doc.setFont('helvetica', peso || 'normal'); doc.setFontSize(tam); };
    /** Corta o texto para caber na largura (mm), com reticências. */
    const caber = (t, larg) => {
      let s = limpo(t);
      if (doc.getTextWidth(s) <= larg) return s;
      while (s.length > 1 && doc.getTextWidth(s + '...') > larg) s = s.slice(0, -1);
      return s.trimEnd() + '...';
    };
    let y = 0;

    // ---- cabeçalhos ----
    function cabecalhoPrincipal() {
      fundo(COR.escuro); doc.rect(0, 0, W, 34, 'F');
      fundo(COR.dourado); doc.rect(0, 34, W, 1.2, 'F');
      if (logo) doc.addImage(logo, 'PNG', M, 10, 54, 14);
      else { fonte(18, 'bold'); cor(COR.branco); doc.text('COA WEB', M, 20); }
      fonte(7.5, 'bold'); cor(COR.dourado); doc.text('SALDO DOS DEPÓSITOS NO SAP', W - M, 12, { align: 'right' });
      fonte(17, 'bold'); cor(COR.branco); doc.text(caber(fazenda, 110), W - M, 21, { align: 'right' });
      fonte(8.5); doc.setTextColor(200, 222, 212); doc.text('Validação PIMS', W - M, 27.5, { align: 'right' });
      y = 43;
    }
    function cabecalhoSeguinte() {
      fundo(COR.escuro); doc.rect(0, 0, W, 13, 'F');
      fundo(COR.dourado); doc.rect(0, 13, W, 0.8, 'F');
      if (logo) doc.addImage(logo, 'PNG', M, 3.5, 23.1, 6);
      else { fonte(10, 'bold'); cor(COR.branco); doc.text('COA WEB', M, 8.5); }
      fonte(8.5, 'bold'); cor(COR.branco); doc.text(caber('Saldo dos depósitos · ' + fazenda, 120), W - M, 8.3, { align: 'right' });
      y = 21;
    }
    function novaPagina() { doc.addPage(); cabecalhoSeguinte(); }
    const cabe = (altura) => y + altura <= H - RODAPE - 4;

    // ---- primeira página: contexto, números e resumo ----
    cabecalhoPrincipal();
    fonte(8.5); cor(COR.suave);
    const lido = dados.lidoEm ? new Date(dados.lidoEm) : null;
    const contexto = [
      lido && !isNaN(lido) ? 'Saldos lidos no SAP em ' + fmtQuando(lido) : 'Saldos do SAP',
      'relatório gerado em ' + fmtQuando(new Date()),
    ].join('  ·  ');
    doc.text(contexto, M, y); y += 5;
    if (dados.busca) { cor(COR.teal); fonte(8.5, 'bold'); doc.text(caber('Só os produtos com "' + dados.busca + '"', W - 2 * M), M, y); y += 5; }

    const deps = dados.depositos;
    const linhas = deps.reduce((s, d) => s + d.itens.length, 0);
    const negativos = deps.reduce((s, d) => s + d.itens.filter((i) => i.q < 0).length, 0);
    const caixas = [
      ['DEPÓSITOS NO RELATÓRIO', fmtInt(deps.length), COR.escuro],
      ['PRODUTOS COM SALDO', fmtInt(linhas), COR.escuro],
      ['SALDOS NEGATIVOS', fmtInt(negativos), negativos ? COR.ruim : COR.escuro],
    ];
    const gap = 4, lc = (W - 2 * M - 2 * gap) / 3;
    y += 2;
    caixas.forEach((c, k) => {
      const x = M + k * (lc + gap);
      fundo(k === 2 && negativos ? COR.ruimFundo : COR.zebra); traco(COR.linha); doc.setLineWidth(0.25);
      doc.roundedRect(x, y, lc, 19, 2, 2, 'FD');
      fundo(c[2]); doc.rect(x, y + 2, 1.1, 15, 'F');
      fonte(6.8, 'bold'); cor(COR.suave); doc.text(c[0], x + 5, y + 6.5);
      fonte(16, 'bold'); cor(c[2]); doc.text(c[1], x + 5, y + 15);
    });
    y += 27;

    // resumo por depósito (com mais de um)
    if (deps.length > 1) {
      fonte(10.5, 'bold'); cor(COR.escuro); doc.text('Resumo por depósito', M, y); y += 4;
      const xs = { c: M + 2, n: M + 22, p: W - M - 30, ng: W - M - 2 };
      const cabResumo = () => {
        fundo(COR.cab); doc.rect(M, y, W - 2 * M, 6.5, 'F');
        fonte(6.8, 'bold'); cor(COR.suave);
        doc.text('CÓDIGO', xs.c, y + 4.3); doc.text('DEPÓSITO', xs.n, y + 4.3);
        doc.text('PRODUTOS', xs.p, y + 4.3, { align: 'right' }); doc.text('NEGATIVOS', xs.ng, y + 4.3, { align: 'right' });
        y += 6.5;
      };
      cabResumo();
      deps.forEach((d, k) => {
        if (!cabe(5.6)) { novaPagina(); cabResumo(); }
        if (k % 2) { fundo(COR.zebra); doc.rect(M, y, W - 2 * M, 5.6, 'F'); }
        const neg = d.itens.filter((i) => i.q < 0).length;
        fonte(8.2, 'bold'); cor(COR.teal); doc.text(limpo(d.c), xs.c, y + 3.9);
        fonte(8.2); cor(COR.texto); doc.text(caber(titulo(d.n) + (d.inativo ? ' (inativo no SAP)' : ''), xs.p - xs.n - 22), xs.n, y + 3.9);
        doc.text(fmtInt(d.itens.length), xs.p, y + 3.9, { align: 'right' });
        if (neg) { fonte(8.2, 'bold'); cor(COR.ruim); } else cor(COR.fraco);
        doc.text(neg ? fmtInt(neg) : '-', xs.ng, y + 3.9, { align: 'right' });
        y += 5.6;
      });
      traco(COR.linha); doc.setLineWidth(0.25); doc.line(M, y, W - M, y);
      y += 9;
    }

    // ---- um quadro por depósito ----
    const xs = { c: M + 2, n: M + 24, q: W - M - 17, u: W - M - 15 };
    const larguraNome = xs.q - xs.n - 24; // o saldo, alinhado à direita em xs.q, ocupa até uns 20 mm
    function faixaDeposito(d, continua) {
      fundo(COR.faixa); doc.rect(M, y, W - 2 * M, 9.5, 'F');
      fundo(COR.teal); doc.rect(M, y, 1.4, 9.5, 'F');
      fonte(10.5, 'bold'); cor(COR.teal); doc.text(limpo(d.c), M + 4.5, y + 6.3);
      const xNome = M + 6 + doc.getTextWidth(limpo(d.c)) + 3;
      const neg = d.itens.filter((i) => i.q < 0).length;
      const direita = continua ? '(continuação)' : !d.itens.length ? (dados.busca ? 'nenhum da busca' : 'sem saldo')
        : plural(d.itens.length, 'produto', 'produtos') + (neg ? ' · ' + plural(neg, 'negativo', 'negativos') : '');
      fonte(8); const lDir = doc.getTextWidth(direita);
      fonte(10.5, 'bold'); cor(COR.texto);
      doc.text(caber(titulo(d.n) + (d.inativo ? ' (inativo no SAP)' : ''), W - M - 4 - lDir - 6 - xNome), xNome, y + 6.3);
      fonte(8, neg && !continua ? 'bold' : 'normal'); cor(neg && !continua ? COR.ruim : COR.suave);
      doc.text(direita, W - M - 3, y + 6.2, { align: 'right' });
      y += 9.5;
    }
    function cabecalhoTabela() {
      fundo(COR.cab); doc.rect(M, y, W - 2 * M, 6.2, 'F');
      fonte(6.8, 'bold'); cor(COR.suave);
      doc.text('CÓDIGO', xs.c, y + 4.1); doc.text('PRODUTO', xs.n, y + 4.1);
      doc.text('SALDO', xs.q, y + 4.1, { align: 'right' }); doc.text('UN.', xs.u, y + 4.1);
      y += 6.2;
    }
    const ALT = 5.6;
    deps.forEach((d, k) => {
      if ((dados.umPorPagina && (k > 0 || deps.length > 1)) || !cabe(9.5 + 6.2 + ALT * Math.min(3, Math.max(1, d.itens.length)))) novaPagina();
      faixaDeposito(d, false);
      if (!d.itens.length) {
        fonte(8.5, 'italic'); cor(COR.fraco);
        doc.text(dados.busca ? 'Nenhum produto da busca neste depósito.' : 'Nenhum produto com saldo neste depósito.', xs.c, y + 5);
        y += 12;
        return;
      }
      cabecalhoTabela();
      d.itens.forEach((i, n) => {
        if (!cabe(ALT)) { novaPagina(); faixaDeposito(d, true); cabecalhoTabela(); }
        if (i.q < 0) { fundo(COR.ruimFundo); doc.rect(M, y, W - 2 * M, ALT, 'F'); }
        else if (n % 2) { fundo(COR.zebra); doc.rect(M, y, W - 2 * M, ALT, 'F'); }
        fonte(7.8); cor(COR.suave); doc.text(caber(i.c, xs.n - xs.c - 2), xs.c, y + 3.9);
        fonte(8.2); cor(COR.texto); doc.text(caber(titulo(i.n), larguraNome), xs.n, y + 3.9);
        fonte(8.4, 'bold'); cor(i.q < 0 ? COR.ruim : COR.texto); doc.text(fmtQtd(i.q), xs.q, y + 3.9, { align: 'right' });
        fonte(7.8); cor(COR.suave); doc.text(caber(i.u, 13), xs.u, y + 3.9);
        y += ALT;
      });
      traco(COR.linha); doc.setLineWidth(0.25); doc.line(M, y, W - M, y);
      y += 8;
    });

    // ---- rodapé em todas as páginas ----
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      traco(COR.linha); doc.setLineWidth(0.3); doc.line(M, H - RODAPE + 2, W - M, H - RODAPE + 2);
      fonte(7.5); cor(COR.fraco);
      doc.text(caber('COA WEB · Validação PIMS · Saldo dos depósitos · ' + fazenda, 140), M, H - RODAPE + 7);
      doc.text('Página ' + p + ' de ' + total, W - M, H - RODAPE + 7, { align: 'right' });
    }
    doc.setProperties({ title: 'Saldo dos depósitos - ' + limpo(fazenda), subject: 'Validação PIMS', creator: 'COA WEB' });
    return doc;
  }

  function nomeArquivo(fazenda) {
    const s = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const hoje = new Date();
    const dia = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    return 'saldo-depositos_' + s(fazenda) + '_' + dia + '.pdf';
  }

  /** Gera e baixa o PDF; devolve o nome do arquivo. */
  async function gerar(dados) {
    if (!dados || !dados.depositos || !dados.depositos.length) throw new Error('marque pelo menos um depósito');
    const [jsPDF, logo] = await Promise.all([carregarJsPdf(), carregarLogo()]);
    const doc = criarDocumento(jsPDF, dados, logo);
    const nome = nomeArquivo(dados.fazenda);
    // o download passa por um <a download> clicado pelo código: o assets/uso.js conta o relatório (Aderência)
    const url = URL.createObjectURL(doc.output('blob'));
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return nome;
  }

  window.RelatorioDepositos = { gerar: gerar, nomeArquivo: nomeArquivo };
})();
