/* =====================================================================
   Acompanhamento Operacional — lógica da aba "Revista" (sem DOM)
   A revista é o relatório consolidado do período de produção (hoje, o plantio) em páginas A4: cruza os
   indicadores do Painel (`calcula()` do app.js) com a chuva da fazenda (ZEUS), a chuva por talhão, os mapas
   de chuva salvos no módulo Mapas, as cores das variedades e a previsão do tempo. Aqui ficam as contas e os
   textos; o desenho das páginas fica em revista.js. Testes em modulos/acompanhamento/testes/ (node --test).
===================================================================== */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RevistaLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA = 86400000;
  /** mm: a partir daqui o dia conta como "dia com chuva" (a mesma regra do Relatório e da Chuva por talhão) */
  var CHUVA_MIN = 1;
  /** dias depois do início do plantio do talhão em que se soma a chuva "pós-plantio" (o próprio dia entra) */
  var DIAS_POS_PLANTIO = 10;
  /** mm: abaixo disso, nos DIAS_POS_PLANTIO dias, o talhão entra na lista "pouca chuva depois do plantio" */
  var POUCA_CHUVA_POS = 10;
  var SEM_VARIEDADE = 'Sem variedade';
  var COR_SEM_VARIEDADE = '#B5B5B5';
  /** As mesmas 20 cores do Mapa de variedade (módulo Mapas): a variedade sem cor cadastrada pega a menos usada. */
  var PALETA_VARIEDADES = [
    '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#17BECF', '#BCBD22', '#393B79',
    '#AEC7E8', '#FFBB78', '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94', '#F7B6D2', '#9EDAE5', '#DBDB8D', '#637939'
  ];
  /** Semanas do plantio no mapa "quando cada talhão foi plantado": verde claro (primeira) ao escuro (última). */
  var CORES_SEMANA = ['#D9F0D3', '#ACDCA2', '#7BC27A', '#4FA35F', '#2E8049', '#165F37', '#0B4228', '#062A19'];

  // ---- datas e números ----
  function utc(s) { var p = String(s).slice(0, 10).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function somarDias(s, n) { return new Date(utc(s) + n * DIA).toISOString().slice(0, 10); }
  function difDias(a, b) { return Math.round((utc(b) - utc(a)) / DIA); }
  function paraIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dataCurta(s) { if (!s) return '—'; var p = String(s).slice(0, 10).split('-'); return p[2] + '/' + p[1]; }
  function fmtN(v, c) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c || 0, maximumFractionDigits: c || 0 });
  }
  function fmtPct(v, c) { return (v === null || v === undefined || !isFinite(v)) ? '—' : fmtN(v * 100, c || 0) + '%'; }
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function soma(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += f(a[i]); return s; }
  function titulo(s) {
    var t = String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
    return t.replace(/\bSm3\b/, 'SM3').replace(/\bTres\b/, 'Três').replace(/\bSao\b/, 'São');
  }

  // ===========================================================================
  // Variedades: mesma limpeza e mesmas cores do Mapa de variedade
  // ===========================================================================
  /** "SEMENTE DE SOJA X SOJA" → "X"; vazio e "A DEFINIR" → null (src/lib/variedades.ts do módulo Mapas). */
  function limparVariedade(v) {
    var t = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    var limpo = t.replace(/^SEMENTE\s+(DE\s+)?(SOJA|MILHO|ALGODAO|SORGO|MILHETO)\s+/i, '').replace(/\s+(SOJA|MILHO|ALGODAO)$/i, '').trim();
    if (!limpo || /^A\s*DEFINIR$/i.test(limpo)) return null;
    return limpo;
  }
  function chaveVariedade(nome) { return String(nome).replace(/\s+/g, ' ').trim().toUpperCase(); }
  /**
   * Cor de cada variedade: a cadastrada no módulo Mapas (Cores das variedades) ou, sem cadastro, a cor da paleta
   * menos usada até ali (sem gravar nada). `cadastro`: [{ chave, cor }]. Devolve { nome: cor }.
   */
  function coresDasVariedades(nomes, cadastro) {
    var porChave = {};
    (cadastro || []).forEach(function (c) { if (c && c.chave && c.cor) porChave[chaveVariedade(c.chave)] = String(c.cor).toUpperCase(); });
    var vezes = {};
    PALETA_VARIEDADES.forEach(function (c) { vezes[c] = 0; });
    var saida = {};
    nomes.forEach(function (n) { var c = porChave[chaveVariedade(n)]; if (c) { saida[n] = c; if (vezes[c] !== undefined) vezes[c]++; } });
    nomes.forEach(function (n) {
      if (saida[n]) return;
      var esc = PALETA_VARIEDADES[0];
      PALETA_VARIEDADES.forEach(function (c) { if (vezes[c] < vezes[esc]) esc = c; });
      saida[n] = esc; vezes[esc]++;
    });
    return saida;
  }

  // ===========================================================================
  // Talhões, ritmo, variedades e equipes (a partir de calcula())
  // ===========================================================================
  /**
   * O plantio de cada talhão pelos boletins (sem replantio): primeiro e último dia, dias com apontamento e
   * equipes (da que mais fez para a que menos fez). `m`: indicadores de calcula() (talhoes, ops).
   */
  function talhoesDoPlantio(m) {
    var por = {};
    (m.ops || []).forEach(function (a) {
      if (!(a.a > 0)) return;
      var k = a.u + '|' + a.t, p = por[k] = por[k] || { ini: a.d, fim: a.d, dias: {}, eq: {} };
      if (a.d < p.ini) p.ini = a.d;
      if (a.d > p.fim) p.fim = a.d;
      p.dias[a.d] = true;
      if (a.e) p.eq[a.e] = (p.eq[a.e] || 0) + a.a;
    });
    return (m.talhoes || []).map(function (t) {
      var p = por[t.u + '|' + t.t];
      return {
        u: t.u, t: t.t, setor: t.setor || null, base: t.base, efetivo: t.efetivo, perc: t.perc, k: t.k,
        variedade: limparVariedade(t.variedade),
        ini: p ? p.ini : null, fim: p ? p.fim : null, diasOp: p ? Object.keys(p.dias).length : 0,
        equipes: p ? Object.keys(p.eq).sort(function (a, b) { return p.eq[b] - p.eq[a]; }) : []
      };
    });
  }

  /**
   * Destaques do ritmo no período (do primeiro ao último dia com boletim): o melhor dia, a melhor sequência de
   * 7 dias corridos, os dias parados (menos de 1 ha) e a maior sequência de dias com operação.
   */
  function destaquesDoRitmo(m) {
    var r = { melhorDia: null, melhorSemana: null, diasParados: 0, diasComOperacao: 0, maiorSequencia: null };
    if (!m.ini || !m.ult) return r;
    var de = paraIso(m.ini), ate = paraIso(m.ult), n = difDias(de, ate) + 1, dias = [];
    for (var i = 0; i < n; i++) { var d = somarDias(de, i); dias.push({ d: d, a: (m.porDia && m.porDia[d]) || 0 }); }
    var seq = null;
    dias.forEach(function (x, i) {
      if (x.a >= 1) {
        r.diasComOperacao++;
        if (!r.melhorDia || x.a > r.melhorDia.a) r.melhorDia = { d: x.d, a: x.a };
        seq = seq && seq.ate === somarDias(x.d, -1) ? { de: seq.de, ate: x.d, dias: seq.dias + 1 } : { de: x.d, ate: x.d, dias: 1 };
        if (!r.maiorSequencia || seq.dias > r.maiorSequencia.dias) r.maiorSequencia = seq;
      } else { r.diasParados++; seq = null; }
      if (i >= 6) {
        var s7 = soma(dias.slice(i - 6, i + 1), function (y) { return y.a; });
        if (!r.melhorSemana || s7 > r.melhorSemana.ha) r.melhorSemana = { de: dias[i - 6].d, ate: x.d, ha: s7 };
      }
    });
    // operação mais curta que uma semana: a "semana" é o período todo
    if (!r.melhorSemana) r.melhorSemana = { de: de, ate: ate, ha: soma(dias, function (y) { return y.a; }) };
    return r;
  }

  /**
   * Variedades do plantio: área prevista e plantada, % plantado, janela (primeiro e último dia de plantio dos
   * talhões dela) e a área plantada por dia. "Sem variedade" agrupa vazio e "A DEFINIR" e vai por último.
   */
  function variedadesDoPlantio(m, tal) {
    var por = {}, porTal = {};
    (tal || []).forEach(function (t) { porTal[t.u + '|' + t.t] = t.variedade || SEM_VARIEDADE; });
    (tal || []).forEach(function (t) {
      var v = t.variedade || SEM_VARIEDADE, x = por[v] = por[v] || { v: v, prev: 0, exec: 0, talhoes: 0, ini: null, fim: null, porDia: {} };
      x.prev += t.base; x.exec += t.efetivo; x.talhoes++;
      if (t.ini && (!x.ini || t.ini < x.ini)) x.ini = t.ini;
      if (t.fim && (!x.fim || t.fim > x.fim)) x.fim = t.fim;
    });
    (m.ops || []).forEach(function (a) {
      var v = porTal[a.u + '|' + a.t]; if (!v || !(a.a > 0)) return;
      por[v].porDia[a.d] = (por[v].porDia[a.d] || 0) + a.a;
    });
    return Object.keys(por).map(function (k) { var x = por[k]; x.pct = x.prev ? Math.min(1, x.exec / x.prev) : 0; return x; })
      .sort(function (a, b) { return (a.v === SEM_VARIEDADE) - (b.v === SEM_VARIEDADE) || b.prev - a.prev || (a.v < b.v ? -1 : 1); });
  }

  /** Equipes: total, dias com operação, média por dia trabalhado, melhor dia, primeiro e último dia, talhões. */
  function equipesDoPlantio(m) {
    var por = {};
    (m.ops || []).forEach(function (a) {
      if (!(a.a > 0)) return;
      var nome = a.e || 'Sem equipe', x = por[nome] = por[nome] || { nome: nome, completo: a.eq || nome, total: 0, porDia: {}, tal: {} };
      x.total += a.a; x.porDia[a.d] = (x.porDia[a.d] || 0) + a.a; x.tal[a.u + '|' + a.t] = true;
    });
    var ult = m.ult ? paraIso(m.ult) : null;
    return Object.keys(por).map(function (k) {
      var x = por[k], dias = Object.keys(x.porDia).sort(), melhor = null;
      dias.forEach(function (d) { if (!melhor || x.porDia[d] > melhor.a) melhor = { d: d, a: x.porDia[d] }; });
      var ult7 = ult ? soma(dias.filter(function (d) { return d > somarDias(ult, -7) && d <= ult; }), function (d) { return x.porDia[d]; }) : 0;
      return { nome: x.nome, completo: x.completo, total: x.total, dias: dias.length, media: dias.length ? x.total / dias.length : 0,
        melhor: melhor, ini: dias[0] || null, fim: dias[dias.length - 1] || null, talhoes: Object.keys(x.tal).length, ult7: ult7, porDia: x.porDia };
    }).sort(function (a, b) { return b.total - a.total || (a.nome < b.nome ? -1 : 1); });
  }

  /**
   * Semana em que cada talhão começou a ser plantado, contada do primeiro dia do plantio da fazenda
   * (semana 1 = os 7 primeiros dias). Devolve { classes: [{ n, de, ate, rotulo, cor, ha, talhoes }], de: { 'u|t': n } }.
   * Mais de 8 semanas: as últimas se juntam na 8ª ("8ª semana em diante").
   */
  function semanasDePlantio(tal, ini) {
    var saida = { classes: [], de: {} };
    if (!ini) return saida;
    var max = 0;
    tal.forEach(function (t) {
      if (!t.ini) return;
      var n = Math.min(CORES_SEMANA.length, Math.floor(difDias(ini, t.ini) / 7) + 1);
      saida.de[t.u + '|' + t.t] = n;
      if (n > max) max = n;
    });
    for (var n = 1; n <= max; n++) {
      var de = somarDias(ini, (n - 1) * 7), ate = somarDias(ini, n * 7 - 1), ultima = n === CORES_SEMANA.length;
      var lista = tal.filter(function (t) { return saida.de[t.u + '|' + t.t] === n; });
      saida.classes.push({ n: n, de: de, ate: ultima ? null : ate, cor: CORES_SEMANA[Math.round((n - 1) * (CORES_SEMANA.length - 1) / Math.max(1, max - 1))],
        rotulo: n + 'ª semana · ' + dataCurta(de) + (ultima ? ' em diante' : ' a ' + dataCurta(ate)),
        ha: soma(lista, function (t) { return t.base; }), talhoes: lista.length });
    }
    return saida;
  }

  // ===========================================================================
  // Chuva por talhão × plantio
  // ===========================================================================
  /**
   * Chuva de cada talhão (ZEUS, tabela da Chuva por talhão) cruzada com o plantio dele:
   *   periodo  — mm do primeiro dia do plantio da fazenda até o último dia com dado;
   *   antes    — mm nos 7 dias antes do início do plantio do talhão;
   *   depois   — mm do dia do início do plantio do talhão até DIAS_POS_PLANTIO - 1 dias depois (null se a janela
   *              ainda não terminou na tabela: o talhão plantado há poucos dias não entra na conta);
   *   desde    — mm do início do plantio do talhão até o último dia com dado.
   * `chuva`: { inicio: 'AAAA-MM-DD' (dia 0 das séries), fim: índice do último dia com dado, serieDe(codigo) → [mm|null] | null }.
   */
  function chuvaDosTalhoes(tal, chuva, iniFazenda) {
    if (!chuva || !chuva.serieDe) return [];
    var ultimo = somarDias(chuva.inicio, chuva.fim);
    function somar(s, de, ate) {
      if (!s || de > ate) return null;
      var i0 = Math.max(0, difDias(chuva.inicio, de)), i1 = Math.min(chuva.fim, difDias(chuva.inicio, ate)), t = 0, lidos = 0;
      for (var i = i0; i <= i1; i++) { if (s[i] !== null && s[i] !== undefined) { t += s[i]; lidos++; } }
      return lidos ? r1(t) : null;
    }
    return tal.map(function (t) {
      var s = chuva.serieDe(t.t), r = { u: t.u, t: t.t, temDado: !!s, periodo: null, antes: null, depois: null, desde: null, ini: t.ini };
      if (!s) return r;
      if (iniFazenda) r.periodo = somar(s, iniFazenda, ultimo);
      if (t.ini) {
        r.antes = somar(s, somarDias(t.ini, -7), somarDias(t.ini, -1));
        var fimJanela = somarDias(t.ini, DIAS_POS_PLANTIO - 1);
        r.depois = fimJanela <= ultimo ? somar(s, t.ini, fimJanela) : null;
        r.desde = somar(s, t.ini, ultimo);
      }
      return r;
    });
  }
  /** Resumo da chuva pós-plantio: talhões com a janela completa, média e os que tiveram menos de POUCA_CHUVA_POS mm. */
  function resumoPosPlantio(linhas) {
    var com = linhas.filter(function (l) { return l.depois !== null; });
    return {
      talhoes: com.length,
      media: com.length ? r1(soma(com, function (l) { return l.depois; }) / com.length) : null,
      poucaChuva: com.filter(function (l) { return l.depois < POUCA_CHUVA_POS; }).sort(function (a, b) { return a.depois - b.depois; }),
      aguardando: linhas.filter(function (l) { return l.temDado && l.ini && l.depois === null; }).length
    };
  }

  // ===========================================================================
  // Chuva da fazenda (média dos pluviômetros, a mesma do Relatório) no período da revista
  // ===========================================================================
  /** Série diária { d, mm } de `de` a `ate` (inclusive) a partir de { 'AAAA-MM-DD': mm }. Dia sem registro = 0. */
  function serieChuva(chuvaU, de, ate) {
    var s = [];
    if (!de || !ate || de > ate) return s;
    for (var d = de; d <= ate; d = somarDias(d, 1)) s.push({ d: d, mm: (chuvaU && chuvaU[d]) || 0 });
    return s;
  }
  /** Total, dias com chuva, maior chuva e a maior sequência de dias sem chuva de uma série { d, mm }. */
  function resumoChuva(serie) {
    var r = { mm: 0, dias: 0, maior: null, maiorSeca: null };
    var seca = null;
    serie.forEach(function (x) {
      r.mm += x.mm;
      if (x.mm >= CHUVA_MIN) { r.dias++; if (!r.maior || x.mm > r.maior.mm) r.maior = { d: x.d, mm: x.mm }; seca = null; }
      else {
        seca = seca ? { de: seca.de, ate: x.d, dias: seca.dias + 1 } : { de: x.d, ate: x.d, dias: 1 };
        if (!r.maiorSeca || seca.dias > r.maiorSeca.dias) r.maiorSeca = seca;
      }
    });
    r.mm = r1(r.mm);
    return r;
  }

  // ===========================================================================
  // Mapas de chuva salvos no módulo Mapas
  // ===========================================================================
  /**
   * Os mapas salvos da fazenda que cruzam o período [de, ate] (datas 'AAAA-MM-DD'), do mais antigo ao mais novo.
   * `mapas`: [{ id, inicio, fim, criadoEm, ... }]; sem `fim`, vale o `inicio`.
   */
  function mapasDoPeriodo(mapas, de, ate) {
    return (mapas || []).filter(function (x) {
      var a = String(x.inicio || '').slice(0, 10), b = String(x.fim || x.inicio || '').slice(0, 10);
      return a && b >= de && a <= ate;
    }).sort(function (x, y) { return x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : (x.criadoEm < y.criadoEm ? -1 : 1); });
  }

  // ===========================================================================
  // Textos
  // ===========================================================================
  /** A manchete da capa interna e do sumário: o número que resume o plantio. */
  function manchete(m, concluida) {
    if (!m.ini) return 'O plantio ainda não começou';
    if (concluida) return 'Plantio concluído: ' + fmtN(m.exec) + ' ha em ' + m.diasDec + ' ' + plural(m.diasDec, 'dia', 'dias');
    return fmtPct(m.pct) + ' da área plantada em ' + m.diasDec + ' ' + plural(m.diasDec, 'dia', 'dias');
  }
  /**
   * O texto da abertura ("editorial"), em parágrafos com **negrito**: a situação, o ritmo, a chuva, a janela das
   * variedades e o que vem pela frente. `e`: { m, rel (RelatorioLogica.consolidar), destaques, variedades,
   * chuva (resumoChuva) | null, posPlantio (resumoPosPlantio) | null, ateChuvaTalhao ('AAAA-MM-DD', último dia da
   * chuva por talhão) | null, previsao: { mm, dias, de, ate } | null, nome }.
   */
  function editorial(e) {
    var m = e.m, rel = e.rel, p = [];
    if (!m.ini) return ['Ainda não há boletins de plantio ' + (e.grupo ? 'nas unidades' : 'nesta unidade') + ' na safra. A revista ganha conteúdo assim que o PIMS registrar os primeiros apontamentos.'];
    var quem = e.grupo ? 'Nas ' + m.unidades.length + ' unidades do grupo' : 'Na ' + e.nome;
    if (rel.concluida) p.push(quem + ', o plantio foi **concluído** em ' + dataCurta(paraIso(m.ult)) + ': **' + fmtN(m.exec) + ' ha** em ' + m.diasDec + ' ' + plural(m.diasDec, 'dia', 'dias') + ', média de ' + fmtN(m.media) + ' ha por dia de operação.');
    else p.push(quem + ', o plantio chegou a **' + fmtPct(m.pct) + '** da área: ' + fmtN(m.exec) + ' de ' + fmtN(m.areaTotal) + ' ha em ' + m.diasDec + ' ' + plural(m.diasDec, 'dia', 'dias') + ' desde ' + dataCurta(paraIso(m.ini)) + '. Faltam **' + fmtN(m.restante) + ' ha**.');
    var d = e.destaques, s = '';
    if (d && d.melhorDia) s = 'O melhor dia foi ' + dataCurta(d.melhorDia.d) + ', com **' + fmtN(d.melhorDia.a) + ' ha**; a melhor semana, de ' + dataCurta(d.melhorSemana.de) + ' a ' + dataCurta(d.melhorSemana.ate) + ', somou ' + fmtN(d.melhorSemana.ha) + ' ha.';
    if (!rel.concluida && m.media7) {
      s += ' No ritmo dos últimos 7 dias (' + fmtN(m.media7) + ' ha/dia), o plantio termina em **' + (m.previsao ? dataCurta(paraIso(m.previsao)) : '—') + '**';
      if (rel.difPrevisao !== null && rel.difPrevisao !== undefined) s += rel.difPrevisao <= 0 ? (rel.difPrevisao === 0 ? ', na data planejada.' : ', ' + (-rel.difPrevisao) + ' ' + plural(-rel.difPrevisao, 'dia', 'dias') + ' antes do planejado.') : ', ' + rel.difPrevisao + ' ' + plural(rel.difPrevisao, 'dia', 'dias') + ' depois do planejado.';
      else s += '.';
    }
    if (s) p.push(s.trim());
    var c = e.chuva;
    if (c) {
      var t = 'Choveu **' + fmtN(c.mm) + ' mm** em ' + c.dias + ' ' + plural(c.dias, 'dia', 'dias') + ' desde o início do plantio';
      if (rel.corr && rel.corr.comChuva && rel.corr.comChuva.dias) t += '; nos dias com mais de 5 mm a média caiu para ' + fmtN(rel.corr.comChuva.media) + ' ha/dia, contra ' + fmtN(rel.corr.semChuva.media) + ' ha/dia nos demais';
      t += '.';
      if (e.posPlantio && e.posPlantio.talhoes) {
        var pp = e.posPlantio;
        t += ' Nos ' + DIAS_POS_PLANTIO + ' dias seguintes ao plantio' + (e.ateChuvaTalhao ? ' (chuva por talhão da ZEUS, que vai até ' + dataCurta(e.ateChuvaTalhao) + ')' : '') + ', os talhões receberam em média ' + fmtN(pp.media) + ' mm' +
          (pp.poucaChuva.length ? '; ' + pp.poucaChuva.length + ' ' + plural(pp.poucaChuva.length, 'talhão teve', 'talhões tiveram') + ' menos de ' + POUCA_CHUVA_POS + ' mm.' : '.');
      }
      p.push(t);
    }
    var vs = (e.variedades || []).filter(function (v) { return v.v !== SEM_VARIEDADE; });
    if (vs.length) p.push(vs.length + ' ' + plural(vs.length, 'variedade', 'variedades') + ' na safra; a **' + vs[0].v + '** é a maior, com ' + fmtN(vs[0].prev) + ' ha (' + fmtPct(vs[0].pct) + ' plantada).');
    if (e.previsao && e.previsao.dias) p.push('Para os próximos dias, a previsão indica **' + fmtN(e.previsao.mm) + ' mm** entre ' + dataCurta(e.previsao.de) + ' e ' + dataCurta(e.previsao.ate) + '.');
    return p;
  }

  return {
    CHUVA_MIN: CHUVA_MIN, DIAS_POS_PLANTIO: DIAS_POS_PLANTIO, POUCA_CHUVA_POS: POUCA_CHUVA_POS,
    SEM_VARIEDADE: SEM_VARIEDADE, COR_SEM_VARIEDADE: COR_SEM_VARIEDADE, PALETA_VARIEDADES: PALETA_VARIEDADES, CORES_SEMANA: CORES_SEMANA,
    somarDias: somarDias, difDias: difDias, dataCurta: dataCurta, titulo: titulo,
    limparVariedade: limparVariedade, chaveVariedade: chaveVariedade, coresDasVariedades: coresDasVariedades,
    talhoesDoPlantio: talhoesDoPlantio, destaquesDoRitmo: destaquesDoRitmo, variedadesDoPlantio: variedadesDoPlantio,
    equipesDoPlantio: equipesDoPlantio, semanasDePlantio: semanasDePlantio,
    chuvaDosTalhoes: chuvaDosTalhoes, resumoPosPlantio: resumoPosPlantio, serieChuva: serieChuva, resumoChuva: resumoChuva,
    mapasDoPeriodo: mapasDoPeriodo, manchete: manchete, editorial: editorial
  };
});
