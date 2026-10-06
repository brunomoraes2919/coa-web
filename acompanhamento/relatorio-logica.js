/* =====================================================================
   Acompanhamento Operacional — lógica da aba "Relatórios" (sem DOM)
   Cruza os indicadores do Painel (`calcula()` do app.js) com a chuva da fazenda e as safras anteriores:
   correlação chuva × operação, comparativo na mesma data do ano, linhas por fazenda e as frases da
   "leitura da operação". Usado pelo relatorio.js no navegador e pelos testes em
   modulos/acompanhamento/testes/ (node --test).
===================================================================== */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RelatorioLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA = 86400000;
  var CHUVA_MIN = 1;    // mm: a partir daqui o dia conta como "dia com chuva"
  var CHUVA_FORTE = 5;  // mm: a partir daqui o dia entra na média "com chuva" e, sem operação, conta como parado

  // ---- datas e números (os mesmos formatos do app.js, sem depender dele) ----
  function iso(s) { if (!s) return null; var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function paraIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dif(a, b) { return Math.round((b - a) / DIA); }
  /** Mesmo dia e mês, `anos` antes (29/02 vira 28/02). */
  function anosAntes(d, anos) {
    var r = new Date(d.getFullYear() - anos, d.getMonth(), d.getDate());
    if (r.getMonth() !== d.getMonth()) r = new Date(d.getFullYear() - anos, d.getMonth() + 1, 0);
    return r;
  }
  function fmtN(v, c) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c || 0, maximumFractionDigits: c || 0 });
  }
  function fmtPct(v, c) { return (v === null || v === undefined || !isFinite(v)) ? '—' : fmtN(v * 100, c || 0) + '%'; }
  function dataCurta(d) { return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : '—'; }
  function titulo(s) {
    var t = String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
    return t.replace(/\bSm3\b/, 'SM3').replace(/\bTres\b/, 'Três').replace(/\bSao\b/, 'São');
  }
  function nomeSafra(s) { return titulo(s).replace(/(\d)ª/, '$1ª').replace(/\bDe\b/, 'de'); }
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function op(o) { return o === 'PLANTIO' ? 'plantio' : 'colheita'; }
  function feito(o) { return o === 'PLANTIO' ? 'plantado' : 'colhido'; }

  /** Chuva (mm) e dias com chuva num intervalo de datas ISO (inclusive). */
  function chuvaNoPeriodo(chuvaU, de, ate) {
    var mm = 0, dias = 0, tem = false;
    Object.keys(chuvaU || {}).forEach(function (k) {
      tem = true;
      if (k < de || k > ate) return;
      mm += chuvaU[k];
      if (chuvaU[k] >= CHUVA_MIN) dias++;
    });
    return { mm: Math.round(mm * 10) / 10, dias: dias, tem: tem };
  }

  // ===========================================================================
  // Chuva × operação (período do primeiro ao último apontamento)
  // ===========================================================================
  function correlacaoChuva(m, chuvaU) {
    var r = { temChuva: !!(chuvaU && Object.keys(chuvaU).length), mm: 0, diasChuva: 0, diasPeriodo: 0,
      comChuva: { dias: 0, ha: 0, media: null }, semChuva: { dias: 0, ha: 0, media: null }, parados: 0 };
    if (!m.ini || !m.ult) return r;
    for (var t = +m.ini; t <= +m.ult; t += DIA) {
      var k = paraIso(new Date(t)), ha = m.porDia[k] || 0, mm = (chuvaU && chuvaU[k]) || 0;
      r.diasPeriodo++;
      r.mm += mm;
      if (mm >= CHUVA_MIN) r.diasChuva++;
      if (mm >= CHUVA_FORTE) { r.comChuva.dias++; r.comChuva.ha += ha; if (ha < 1) r.parados++; }
      else { r.semChuva.dias++; r.semChuva.ha += ha; }
    }
    r.mm = Math.round(r.mm * 10) / 10;
    if (r.comChuva.dias) r.comChuva.media = r.comChuva.ha / r.comChuva.dias;
    if (r.semChuva.dias) r.semChuva.media = r.semChuva.ha / r.semChuva.dias;
    return r;
  }

  // ===========================================================================
  // Safra atual × anteriores: mesma data do ano e safra inteira
  // ===========================================================================
  function comparativoSafras(m, chuvaU, hoje) {
    var linhas = [];
    var concluida = m.restante === 0 && !!m.ult;
    var atual = { nome: m.s, anos: 0, atual: true, ateData: m.apontado, total: m.areaTotal, pctNaData: m.areaTotal ? m.apontado / m.areaTotal : null,
      ini: m.ini, fim: concluida ? m.ult : null, ult: m.ult, emAndamento: !concluida && !!m.ini,
      // em andamento: do início ao último apontamento (o mesmo "dias decorridos" do Painel)
      duracao: m.ini ? dif(m.ini, m.ult) + 1 : null, diasOp: Object.keys(m.porDia || {}).filter(function (k) { return m.porDia[k] >= 1; }).length,
      media: m.media, chuva: m.ini ? chuvaNoPeriodo(chuvaU, paraIso(m.ini), paraIso(concluida ? m.ult : hoje)) : { mm: 0, dias: 0, tem: false }, difAtual: null };
    linhas.push(atual);
    (m.comparativos || []).forEach(function (c) {
      var dias = Object.keys(c.porDia).filter(function (k) { return c.porDia[k] >= 1; }).sort();
      if (!dias.length) return;
      var total = 0; Object.keys(c.porDia).forEach(function (k) { total += c.porDia[k]; });
      var ini = iso(dias[0]), fim = iso(dias[dias.length - 1]);
      var ateData = m.ult ? c.acumAte(anosAntes(m.ult, c.anos)) : 0;
      linhas.push({ nome: c.nome, anos: c.anos, atual: false, ateData: ateData, total: total, pctNaData: total ? ateData / total : null,
        ini: ini, fim: fim, ult: fim, emAndamento: false, duracao: dif(ini, fim) + 1, diasOp: dias.length, media: total / dias.length,
        chuva: chuvaNoPeriodo(chuvaU, dias[0], dias[dias.length - 1]),
        difAtual: ateData > 0 ? m.apontado / ateData - 1 : null });
    });
    return linhas;
  }

  // ===========================================================================
  // Uma fazenda na tabela do relatório geral ("Todas as fazendas")
  // ===========================================================================
  function linhaFazenda(u, m, chuvaU, hoje) {
    var comp = comparativoSafras(m, chuvaU, hoje), ant = comp[1] || null, corr = correlacaoChuva(m, chuvaU);
    return { u: u, nome: titulo(u), pct: m.pct, exec: m.exec, areaTotal: m.areaTotal, restante: m.restante,
      ini: m.ini, ult: m.ult, media7: m.media7, metaHoje: m.metaHoje, previsao: m.previsao, termino: m.termino,
      difPrevisao: m.previsao && m.termino && m.restante > 0 ? dif(m.termino, m.previsao) : null,
      concluida: m.restante === 0 && !!m.ult,
      anterior: ant ? { nome: ant.nome, ateData: ant.ateData, dif: ant.difAtual } : null,
      chuvaMm: corr.temChuva ? corr.mm : null, diasChuva: corr.temChuva ? corr.diasChuva : null };
  }

  // ===========================================================================
  // Consolidado: tudo que a tela e a exportação precisam, calculado uma vez
  // ===========================================================================
  /**
   * @param m        indicadores de `calcula()` (uma fazenda ou todas)
   * @param chuvaU   chuva por dia (ISO → mm) da fazenda; no geral, vazio
   * @param hoje     Date (meia-noite)
   * @param opcoes   { fazenda: 'Globo' } ou { todas: true, linhas: [linhaFazenda…] }
   */
  function consolidar(m, chuvaU, hoje, opcoes) {
    opcoes = opcoes || {};
    var concluida = m.restante === 0 && !!m.ult;
    var r = {
      m: m, o: m.o, s: m.s, hoje: hoje,
      todas: !!opcoes.todas, fazenda: opcoes.fazenda || null, linhas: opcoes.linhas || [],
      concluida: concluida, semDados: !m.ini,
      temMeta: !!(m.planos && m.planos.length) && m.metaHoje !== null && m.metaHoje !== undefined,
      corr: correlacaoChuva(m, chuvaU),
      comparativo: comparativoSafras(m, chuvaU, hoje)
    };
    // no geral, a meta e o término somados só valem se todas as fazendas têm meta cadastrada
    r.metaParcial = r.todas && (m.planos || []).length > 0 && (m.planos || []).length < m.unidades.length;
    r.difMeta = r.temMeta && !r.metaParcial && m.media7 && m.metaHoje ? m.media7 / m.metaHoje - 1 : null;
    r.difPrevisao = m.previsao && m.termino && !concluida && !r.metaParcial ? dif(m.termino, m.previsao) : null;
    r.anterior = r.comparativo[1] || null;
    return r;
  }

  // ===========================================================================
  // Leitura da operação: frases em português; **negrito** marca o que importa
  // ===========================================================================
  function frases(r) {
    var m = r.m, o = op(r.o), quem = r.todas ? 'nas ' + m.unidades.length + ' fazendas' : 'da **' + (r.fazenda || titulo(m.unidades[0])) + '**';
    if (r.semDados) return ['Ainda não há apontamentos de ' + o + ' ' + (r.todas ? 'nas fazendas' : 'desta fazenda') + ' na ' + nomeSafra(r.s) + '.'];
    var f = [];

    // 1. situação
    if (r.concluida) {
      f.push('O ' + o + ' ' + quem + ' está **concluído**: ' + fmtN(m.exec) + ' ha em ' + m.diasDec + ' dias, de ' + dataCurta(m.ini) + ' a ' + dataCurta(m.ult) +
        ' (média de ' + fmtN(m.media) + ' ha/dia).');
    } else {
      f.push('O ' + o + ' ' + quem + ' está **' + fmtPct(m.pct) + ' concluído**: ' + fmtN(m.exec) + ' ha dos ' + fmtN(m.areaTotal) + ' ha, em ' + m.diasDec +
        ' dias desde ' + dataCurta(m.ini) + '. Último apontamento em ' + dataCurta(m.ult) + '; faltam ' + fmtN(m.restante) + ' ha.');
    }

    // 2. ritmo, meta e previsão
    if (!r.concluida) {
      var s = '';
      if (m.media7) {
        s = 'Ritmo dos últimos 7 dias: **' + fmtN(m.media7) + ' ha/dia**';
        if (r.difMeta !== null) s += ', ' + fmtPct(Math.abs(r.difMeta)) + ' ' + (r.difMeta >= 0 ? 'acima' : 'abaixo') + ' da meta de ' + fmtN(m.metaHoje) + ' ha/dia';
        else if (r.metaParcial) s += ' (média geral ' + fmtN(m.media) + ' ha/dia; meta cadastrada em ' + m.planos.length + ' das ' + m.unidades.length + ' fazendas)';
        else if (m.media) s += ' (média geral ' + fmtN(m.media) + ' ha/dia' + (r.temMeta ? '' : '; sem meta cadastrada') + ')';
        s += '.';
        if (m.previsao) {
          s += ' Mantido esse ritmo, o ' + o + ' termina em **' + dataCurta(m.previsao) + '**';
          if (r.difPrevisao !== null) {
            s += r.difPrevisao < 0 ? ', ' + (-r.difPrevisao) + ' ' + plural(-r.difPrevisao, 'dia', 'dias') + ' antes da data planejada (' + dataCurta(m.termino) + ').'
              : r.difPrevisao === 0 ? ', na data planejada.'
              : ', ' + r.difPrevisao + ' ' + plural(r.difPrevisao, 'dia', 'dias') + ' depois da data planejada (' + dataCurta(m.termino) + ').';
          } else s += '.';
          if (m.necessario && m.termino && !r.metaParcial) s += ' Para cumprir o prazo ' + (m.necessario <= (m.media7 || 0) ? 'bastariam' : 'seriam precisos') + ' ' + fmtN(m.necessario) + ' ha/dia.';
        }
      } else s = 'Sem apontamentos nos últimos 7 dias' + (m.media ? ' (média geral ' + fmtN(m.media) + ' ha/dia)' : '') + (r.temMeta ? '; meta de ' + fmtN(m.metaHoje) + ' ha/dia.' : '; sem meta cadastrada.');
      f.push(s);
    }

    // 3. safras anteriores na mesma data
    var ants = r.comparativo.filter(function (x) { return !x.atual; });
    if (ants.length) {
      var partes = ants.map(function (a) {
        if (!a.ateData) return 'a **' + nomeSafra(a.nome) + '** ainda não tinha começado (começou em ' + dataCurta(a.ini) + ')';
        var dif = a.difAtual === null ? '' : a.difAtual >= 1 ? ' (a atual está ' + fmtN(a.difAtual + 1, 1) + '× maior)' : ' (a atual está ' + fmtPct(Math.abs(a.difAtual)) + ' ' + (a.difAtual >= 0 ? 'à frente' : 'atrás') + ')';
        return 'a **' + nomeSafra(a.nome) + '** tinha ' + fmtN(a.ateData) + ' ha ' + feito(r.o) + 's' + dif;
      });
      var s3 = 'Na mesma data do ano, ' + partes.join(' e ') + '.';
      s3 += ' ' + ants.map(function (a, i) { return (i ? 'a ' : 'A ') + nomeSafra(a.nome) + ' levou ' + a.duracao + ' dias para ' + fmtN(a.total) + ' ha (' + dataCurta(a.ini) + ' a ' + dataCurta(a.fim) + ')'; }).join('; ') + '.';
      f.push(s3);
    }

    // 4. chuva
    var c = r.corr;
    if (c.temChuva && !r.todas) {
      var s4 = 'Chuva no período: **' + fmtN(c.mm) + ' mm em ' + c.diasChuva + ' ' + plural(c.diasChuva, 'dia', 'dias') + '**.';
      if (c.comChuva.dias) {
        s4 += ' Nos ' + c.comChuva.dias + ' ' + plural(c.comChuva.dias, 'dia', 'dias') + ' com mais de ' + CHUVA_FORTE + ' mm a média foi de ' + fmtN(c.comChuva.media) + ' ha/dia; nos demais ' + c.semChuva.dias + ', ' + fmtN(c.semChuva.media) + ' ha/dia.';
        s4 += c.parados ? ' ' + c.parados + ' ' + plural(c.parados, 'dia parado', 'dias parados') + ' pela chuva.' : ' Nenhum dia parado pela chuva.';
      } else if (c.diasChuva === 0) s4 = 'Sem chuva registrada no período da operação.';
      f.push(s4);
    }

    // 5. talhões, equipes e variedades — ou, no geral, as fazendas
    if (r.todas && r.linhas.length) {
      var ordem = r.linhas.slice().sort(function (a, b) { return b.pct - a.pct; });
      var s5 = 'Fazenda mais adiantada: **' + ordem[0].nome + ' (' + fmtPct(ordem[0].pct) + ')**; mais atrasada: ' + ordem[ordem.length - 1].nome + ' (' + fmtPct(ordem[ordem.length - 1].pct) + ').';
      var concl = ordem.filter(function (l) { return l.concluida; });
      if (concl.length) s5 += ' ' + plural(concl.length, 'Já concluiu', 'Já concluíram') + ': ' + concl.map(function (l) { return l.nome; }).join(', ') + '.';
      var atras = ordem.filter(function (l) { return l.difPrevisao !== null && l.difPrevisao > 0; });
      if (atras.length) s5 += ' Com previsão depois do planejado: ' + atras.map(function (l) { return l.nome + ' (+' + l.difPrevisao + ' d)'; }).join(', ') + '.';
      f.push(s5);
    } else {
      var pc = m.porClasse, s6 = 'Talhões: **' + pc[3].n + ' de ' + m.talhoes.length + ' ' + feito(r.o) + 's**';
      var andamento = pc[1].n + pc[2].n;
      if (andamento) s6 += ', ' + andamento + ' em andamento';
      if (pc[0].n) s6 += (andamento ? ' e ' : ', ') + pc[0].n + ' não ' + plural(pc[0].n, 'iniciado', 'iniciados') + ' (' + fmtN(pc[0].ha) + ' ha)';
      s6 += '.';
      var eq = (m.equipes || []).filter(function (e) { return e.ult7 > 0; }).slice(0, 4);
      if (eq.length) s6 += ' Equipes nos últimos 7 dias: ' + eq.map(function (e) { return e.nome + ' ' + fmtN(e.ult7) + ' ha'; }).join(', ') + '.';
      var vs = (m.variedades || []).filter(function (v) { return v.prev > 0; });
      if (vs.length) s6 += ' ' + vs.length + ' ' + plural(vs.length, 'variedade', 'variedades') + (vs.length > 1 ? '; a ' + vs[0].v + ' é a maior, com ' + fmtN(vs[0].prev) + ' ha' : ' (' + vs[0].v + ')') + '.';
      if (r.o === 'PLANTIO' && m.exec && m.replantio) s6 += ' Replantio: ' + fmtPct(m.replantio / m.exec, 1) + '.';
      f.push(s6);
    }
    return f;
  }

  /** Divide uma frase com **negrito** em trechos [{ t, b }] (para a tela e para o canvas). */
  function trechos(frase) {
    var saida = [], re = /\*\*(.+?)\*\*/g, i = 0, m;
    while ((m = re.exec(frase))) {
      if (m.index > i) saida.push({ t: frase.slice(i, m.index), b: false });
      saida.push({ t: m[1], b: true });
      i = m.index + m[0].length;
    }
    if (i < frase.length) saida.push({ t: frase.slice(i), b: false });
    return saida;
  }

  return { CHUVA_MIN: CHUVA_MIN, CHUVA_FORTE: CHUVA_FORTE, correlacaoChuva: correlacaoChuva, comparativoSafras: comparativoSafras, linhaFazenda: linhaFazenda, consolidar: consolidar, frases: frases, trechos: trechos, chuvaNoPeriodo: chuvaNoPeriodo };
});
