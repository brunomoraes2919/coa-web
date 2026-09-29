/* =====================================================================
   Acompanhamento Operacional — módulo do COA WEB
   Dados: Supabase (acomp_pims, acomp_metas, mapas_*) no COA WEB, ou a API
   do servidor local de testes (config.js → modo 'local').
===================================================================== */
(function () {
  'use strict';

  var CFG = window.ACOMP_CONFIG || { modo: 'local' };
  var EMBED = new URLSearchParams(location.search).get('embed') === '1';
  var TODAS = 'TODAS';
  var ORDEM = ['TRES FLECHAS', 'GLOBO', 'SM3', 'DOURADO', 'NEBRASKA', 'GUAPIRAMA', 'SIRIEMA'];
  var DIA = 86400000;
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var RECARREGAR_MIN = 5;

  var COR = {
    teal: '#0C5A50', tealMedio: '#2F7D6B', escuro: '#103632', dourado: '#DB8A08',
    texto: '#17251F', suave: '#5B6B62', fraco: '#8A988F', linha: '#DCE3DC', grade: '#EEF2EE',
    s: ['#E3E8E4', '#A9D8BD', '#4FA37A', '#0C5A50'], fora: '#F3F5F3'
  };
  // cor fixa por fazenda (paleta categórica validada; nunca pela posição no ranking)
  var COR_FAZENDA = { 'TRES FLECHAS': '#2a78d6', GLOBO: '#eb6834', SM3: '#1baf7a', DOURADO: '#eda100', NEBRASKA: '#e87ba4', GUAPIRAMA: '#008300', SIRIEMA: '#4a3aa7' };

  // ===========================================================================
  // Utilidades
  // ===========================================================================
  function $(id) { return document.getElementById(id); }
  function set(id, t) { $(id).textContent = t; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function iso(s) { if (!s) return null; var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function paraIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hoje() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dif(a, b) { return Math.round((b - a) / DIA); }
  function soma(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += f(a[i]); return s; }
  function fmtN(v, c) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c || 0, maximumFractionDigits: c || 0 });
  }
  function fmtPct(v, c) { return (v === null || v === undefined || !isFinite(v)) ? '—' : fmtN(v * 100, c === undefined ? 0 : c) + '%'; }
  function fmtData(d, curta) { if (!d) return '—'; return curta ? d.getDate() + ' ' + MESES[d.getMonth()] : d.toLocaleDateString('pt-BR'); }
  function titulo(s) {
    var t = String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
    return t.replace(/\bSm3\b/, 'SM3').replace(/\bTres\b/, 'Três');
  }
  function cultura(safra) { return String(safra || '').split(/\s+/)[0].toUpperCase(); }
  function nomeSafra(s) { return titulo(s).replace(/(\d)ª/, '$1ª').replace(/\bDe\b/, 'de'); }
  /** Mesma regra de mapa-chuva (src/lib/codigoTalhao.ts): 'TH 033A'→'033A', '19PESQ'→'019PESQ', 'PIVÔ 02'→'02PIVO'. */
  function normalizarCodigo(s) {
    if (s === null || s === undefined) return '';
    var c = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    c = c.replace(/^(?:TALHAO|TH)(?:[\s-]+|(?=\d))/, '').trim();
    if (c === '') return '';
    var pivo = /^PIVO?\s*-?\s*(\d+)$/.exec(c) || /^(\d+)\s*-?\s*PIVO$/.exec(c);
    if (pivo) return pivo[1].replace(/^0+(?=\d)/, '').padStart(2, '0') + 'PIVO';
    var num = /^(\d+)[\s-]*([A-Z]*)$/.exec(c);
    if (num) return num[1].replace(/^0+(?=\d)/, '').padStart(3, '0') + num[2];
    return c.replace(/\s+/g, '');
  }
  function classe(p) { return p === null ? -1 : p <= 0 ? 0 : p <= 0.5 ? 1 : p < 0.99 ? 2 : 3; }
  function corClasse(k) { return k < 0 ? COR.fora : COR.s[k]; }
  function rotulosClasse(o) {
    var feito = o === 'PLANTIO' ? 'Plantado' : 'Colhido';
    return ['Não iniciado', '1 a 50%', '51 a 99%', feito];
  }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem('acomp.' + k); localStorage.setItem('acomp.' + k, v); } catch (e) { return null; } return null; }

  // ===========================================================================
  // Fontes de dados
  // ===========================================================================
  function erroLegivel(e) {
    var m = (e && (e.message || e.msg)) || String(e);
    var codigo = e && e.code;
    if (codigo === 'PGRST205' || /Could not find the table|does not exist/i.test(m)) {
      return 'O banco do Acompanhamento ainda não foi preparado. Peça ao administrador para rodar o script modulos/acompanhamento/supabase/0001_acompanhamento.sql no Supabase.';
    }
    if (/JWT|jwt|token/i.test(m)) return 'Sua sessão expirou. Entre de novo no COA WEB.';
    return m;
  }

  function FonteLocal() {
    async function api(metodo, rota, corpo) {
      var r = await fetch(rota, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.erro || ('HTTP ' + r.status));
      return j;
    }
    return {
      nome: 'local',
      prontoParaUsar: async function () { return true; },
      dados: function () { return api('GET', '/api/dados'); },
      planos: async function () { return (await api('GET', '/api/metas')).planos || []; },
      mapas: function () {
        if (window.MAPAS) return Promise.resolve(window.MAPAS);
        return new Promise(function (ok) {
          var s = document.createElement('script'); s.src = '/mapas.js';
          s.onload = function () { ok(window.MAPAS || {}); };
          s.onerror = function () { ok({}); };
          document.head.appendChild(s);
        });
      },
      salvar: function (p) { return api('PUT', '/api/metas', p); },
      excluir: function (p) { return api('DELETE', '/api/metas?chave=' + encodeURIComponent([p.unidade, p.safra, p.operacao].join('|'))); },
      atualizar: function () { return api('POST', '/api/sincronizar'); },
      unidadeDaFazendaCoa: function () { return null; }
    };
  }

  function FonteSupabase(cfg) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { autoRefreshToken: !EMBED, persistSession: true } });
    var fazendasCoa = {};
    async function tudo(criar) {
      var saida = [], de = 0, passo = 1000;
      for (;;) {
        var r = await criar().range(de, de + passo - 1);
        if (r.error) throw r.error;
        saida = saida.concat(r.data || []);
        if (!r.data || r.data.length < passo) break;
        de += passo;
      }
      return saida;
    }
    function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
    return {
      nome: 'supabase',
      prontoParaUsar: async function () {
        var s = await sb.auth.getSession();
        if (!s.data || !s.data.session) throw new Error(EMBED ? 'Sua sessão expirou. Entre de novo no COA WEB.' : 'Entre no COA WEB para ver o Acompanhamento Operacional.');
        return true;
      },
      dados: async function () {
        var linhas;
        try { linhas = await tudo(function () { return sb.from('acomp_pims').select('safra,unidade,gerado_em,talhoes,apontamentos').order('safra').order('unidade'); }); }
        catch (e) { throw new Error(erroLegivel(e)); }
        // fazenda do COA WEB → unidade do PIMS (para seguir a fazenda escolhida no topo do COA WEB)
        var fz = await sb.from('mapas_fazendas').select('unidade_pims,coa_fazenda_id');
        (fz.data || []).forEach(function (f) { if (f.unidade_pims && f.coa_fazenda_id !== null) fazendasCoa[f.coa_fazenda_id] = String(f.unidade_pims).trim().toUpperCase(); });
        var talhoes = [], apontamentos = [], safras = {}, gerado = null;
        linhas.forEach(function (l) {
          safras[l.safra] = true;
          if (!gerado || l.gerado_em > gerado) gerado = l.gerado_em;
          (l.talhoes || []).forEach(function (t) { talhoes.push(Object.assign({ u: l.unidade, s: l.safra }, t)); });
          (l.apontamentos || []).forEach(function (a) { apontamentos.push(Object.assign({ u: l.unidade, s: l.safra }, a)); });
        });
        return { geradoEm: gerado, safras: Object.keys(safras).sort(), talhoes: talhoes, apontamentos: apontamentos };
      },
      planos: async function () {
        var r = await sb.from('acomp_metas').select('*');
        if (r.error) throw new Error(erroLegivel(r.error));
        return (r.data || []).map(function (p) {
          return { unidade: p.unidade, safra: p.safra, operacao: p.operacao, dataTermino: p.data_termino, periodos: p.periodos || [], observacao: p.observacao, autor: p.autor, atualizadoEm: p.atualizado_em };
        });
      },
      mapas: async function () {
        var res = await Promise.all([
          tudo(function () { return sb.from('mapas_fazendas').select('id,nome,unidade_pims,coa_fazenda_id').order('id'); }),
          tudo(function () { return sb.from('mapas_safras').select('id,nome,nome_pims').order('id'); }),
          tudo(function () { return sb.from('mapas_talhoes').select('id,fazenda_id,codigo,nome,setor,geom').order('id'); }),
          tudo(function () { return sb.from('mapas_areas_cultura').select('id,safra_id,fazenda_id,codigo,geom').order('id'); })
        ]);
        var faz = {}, safras = {}, mapas = {};
        res[0].forEach(function (f) {
          if (!f.unidade_pims) return;
          var u = String(f.unidade_pims).trim().toUpperCase();
          faz[f.id] = { u: u, nome: f.nome };
          if (f.coa_fazenda_id !== null && f.coa_fazenda_id !== undefined) fazendasCoa[f.coa_fazenda_id] = u;
        });
        res[1].forEach(function (s) { safras[s.id] = String(s.nome_pims || s.nome).trim().toUpperCase(); });
        function conjunto(u, rotulo) {
          var l = mapas[u] = mapas[u] || [];
          var c = l.filter(function (x) { return x.rotulo === rotulo; })[0];
          if (!c) { c = { rotulo: rotulo, geo: { type: 'FeatureCollection', features: [] } }; l.push(c); }
          return c;
        }
        res[3].forEach(function (a) {
          var f = faz[a.fazenda_id], s = safras[a.safra_id];
          if (!f || !s || !a.codigo || !a.geom) return;
          conjunto(f.u, s).geo.features.push({ type: 'Feature', properties: { name: f.u + '|' + a.codigo, talhao: a.codigo, setor: null }, geometry: a.geom });
        });
        res[2].forEach(function (t) {
          var f = faz[t.fazenda_id];
          if (!f || !t.codigo || !t.geom) return;
          conjunto(f.u, 'BASE').geo.features.push({ type: 'Feature', properties: { name: f.u + '|' + t.codigo, talhao: t.nome || t.codigo, setor: t.setor }, geometry: t.geom });
        });
        return mapas;
      },
      salvar: async function (p) {
        var linha = { unidade: p.unidade, safra: p.safra, operacao: p.operacao, data_termino: p.dataTermino || null, periodos: p.periodos, observacao: p.observacao || null, autor: p.autor || null };
        var r = await sb.from('acomp_metas').upsert(linha, { onConflict: 'unidade,safra,operacao' });
        if (r.error) throw new Error(/row-level security/i.test(r.error.message) ? 'Você não tem permissão para cadastrar metas desta fazenda.' : erroLegivel(r.error));
      },
      excluir: async function (p) {
        var r = await sb.from('acomp_metas').delete().match({ unidade: p.unidade, safra: p.safra, operacao: p.operacao });
        if (r.error) throw new Error(erroLegivel(r.error));
      },
      atualizar: async function (progresso) {
        var ins = await sb.from('mapas_plantio_pedidos').insert({}).select('id').single();
        if (ins.error) throw new Error(/row-level security/i.test(ins.error.message) ? 'Sua conta não pode pedir atualização do PIMS.' : erroLegivel(ins.error));
        var id = ins.data.id, inicio = Date.now();
        while (Date.now() - inicio < 150000) {
          await espera(3000);
          if (progresso) progresso(Math.round((Date.now() - inicio) / 1000));
          var r = await sb.from('mapas_plantio_pedidos').select('atendido_em,resultado').eq('id', id).single();
          if (r.error) throw new Error(erroLegivel(r.error));
          if (r.data && r.data.atendido_em) {
            if (r.data.resultado && r.data.resultado !== 'ok') throw new Error('O servidor não conseguiu ler o PIMS: ' + r.data.resultado.replace(/^erro:\s*/, ''));
            return true;
          }
        }
        throw new Error('O servidor do PIMS não respondeu em 2 minutos. Os dados são atualizados sozinhos a cada hora.');
      },
      unidadeDaFazendaCoa: function (id) { return id === null || id === undefined ? null : (fazendasCoa[id] || null); }
    };
  }

  var fonte = CFG.modo === 'supabase' ? FonteSupabase(CFG) : FonteLocal();

  // ===========================================================================
  // Estado
  // ===========================================================================
  var DADOS = null, PLANOS = [], MAPAS = null, mapasCarregando = false;
  var estado = { vista: 'painel', u: TODAS, s: null, o: 'PLANTIO' };

  function unidadesDaSafra(s) {
    var us = {};
    DADOS.talhoes.forEach(function (t) { if (t.s === s) us[t.u] = true; });
    return Object.keys(us).sort(function (a, b) {
      var ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
    });
  }
  function planoDe(u, s, o) { return PLANOS.filter(function (p) { return p.unidade === u && p.safra === s && p.operacao === o; })[0] || null; }
  function metaNoDia(plano, d) {
    if (!plano) return null;
    var k = paraIso(d);
    for (var i = 0; i < plano.periodos.length; i++) { var p = plano.periodos[i]; if (p.inicio <= k && k <= p.fim) return Number(p.meta); }
    return null;
  }

  // ===========================================================================
  // Indicadores (equivalentes às medidas do relatório Power BI)
  // ===========================================================================
  function calcula(unidades, s, o) {
    var U = {}; unidades.forEach(function (u) { U[u] = true; });
    var tal = DADOS.talhoes.filter(function (t) { return U[t.u] && t.s === s; });
    var aps = DADOS.apontamentos.filter(function (a) { return a.op === o && U[a.u] && a.s === s; });
    var ops = aps.filter(function (a) { return !a.rep; });
    var m = { unidades: unidades, s: s, o: o, ops: ops };

    var exT = {};
    ops.forEach(function (a) { var k = a.u + '|' + a.t; exT[k] = (exT[k] || 0) + a.a; });
    m.talhoes = tal.map(function (t) {
      var base = Math.max(0, t.area - t.dano), ap = exT[t.u + '|' + t.t] || 0;
      var enc = o === 'PLANTIO' && !!t.enc;
      var perc = enc ? 1 : (base > 0 ? Math.min(1, ap / base) : (ap > 0 ? 1 : 0));
      return { u: t.u, t: t.t, setor: t.setor, variedade: t.variedade, base: base, area: t.area, dano: t.dano, apontado: ap, efetivo: base * perc, perc: perc, enc: enc, k: classe(perc) };
    });
    m.areaCad = soma(tal, function (t) { return t.area; });
    m.dano = soma(tal, function (t) { return t.dano; });
    m.areaTotal = soma(m.talhoes, function (t) { return t.base; });
    m.exec = soma(m.talhoes, function (t) { return t.efetivo; });
    m.apontado = soma(ops, function (a) { return a.a; });
    m.restante = Math.max(0, m.areaTotal - m.exec); if (m.restante < 0.01) m.restante = 0;
    m.pct = m.areaTotal ? m.exec / m.areaTotal : 0;
    m.replantio = soma(aps.filter(function (a) { return a.rep; }), function (a) { return a.a; });
    m.porClasse = [0, 1, 2, 3].map(function (k) {
      var l = m.talhoes.filter(function (t) { return t.k === k; });
      return { k: k, n: l.length, ha: soma(l, function (t) { return t.base; }) };
    });

    var porDia = {};
    ops.forEach(function (a) { porDia[a.d] = (porDia[a.d] || 0) + a.a; });
    var dias = Object.keys(porDia).sort();
    m.porDia = porDia;
    m.ini = dias.length ? iso(dias[0]) : null;
    m.ult = dias.length ? iso(dias[dias.length - 1]) : null;
    m.diasDec = m.ini ? dif(m.ini, m.ult) + 1 : null;
    m.media = dias.length ? m.apontado / dias.length : null;
    m.media7 = null;
    if (m.ult) {
      var lim = +m.ult - 7 * DIA, a7 = 0, n7 = 0;
      dias.forEach(function (d) { var t = +iso(d); if (t > lim && t <= +m.ult) { a7 += porDia[d]; if (porDia[d] > 0) n7++; } });
      m.media7 = n7 ? a7 / n7 : null;
    }
    m.ritmo = m.media7 || m.media;
    var h = hoje();
    if (m.restante === 0 && m.ult) { m.diasPrev = 0; m.previsao = m.ult; }
    else if (m.ritmo) { var nec = Math.ceil(m.restante / m.ritmo); m.diasPrev = nec - 1; m.previsao = new Date(+h + (nec - 1) * DIA); }
    else { m.diasPrev = null; m.previsao = null; }

    var planos = unidades.map(function (u) { return planoDe(u, s, o); }).filter(Boolean);
    m.planos = planos;
    m.metaDia = function (d) { var t = null; planos.forEach(function (p) { var v = metaNoDia(p, d); if (v !== null) t = (t || 0) + v; }); return t; };
    var terminos = planos.map(function (p) { return p.dataTermino; }).filter(Boolean).sort();
    m.termino = terminos.length ? iso(terminos[terminos.length - 1]) : null;
    m.diasPlan = m.restante === 0 && m.ult ? 0 : (m.termino ? dif(h, m.termino) : null);
    m.necessario = m.termino && m.restante > 0 ? m.restante / Math.max(1, dif(h, m.termino) + 1) : null;
    m.metaHoje = m.metaDia(h);

    m.serie = [];
    if (m.ini) for (var t = +m.ini; t <= +m.ult; t += DIA) {
      var d = new Date(t); d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      m.serie.push({ d: d, a: porDia[paraIso(d)] || 0, meta: m.metaDia(d) });
    }

    var eq = {};
    ops.forEach(function (a) { var e = eq[a.e] = eq[a.e] || { nome: a.e, completo: a.eq || a.e, total: 0, porDia: {} }; e.total += a.a; e.porDia[a.d] = (e.porDia[a.d] || 0) + a.a; });
    m.equipes = Object.keys(eq).map(function (k) {
      var e = eq[k], ds = Object.keys(e.porDia).sort().reverse().slice(0, 7);
      e.ult7 = soma(ds, function (x) { return e.porDia[x]; });
      e.dias7 = ds.length;
      return e;
    }).sort(function (a, b) { return b.ult7 - a.ult7 || b.total - a.total; });

    var vr = {};
    m.talhoes.forEach(function (t) { var k = t.variedade || 'Sem variedade'; var v = vr[k] = vr[k] || { v: k, prev: 0, exec: 0 }; v.prev += t.base; v.exec += t.efetivo; });
    m.variedades = Object.keys(vr).map(function (k) { return vr[k]; }).sort(function (a, b) { return b.prev - a.prev; });
    return m;
  }

  // ===========================================================================
  // Composição do mapa (mesma regra do Mapa de Chuva: src/render/composicao.ts)
  //  - altura/largura do conjunto (Web Mercator) > 1,25 → retrato; senão paisagem
  //  - 2 ou 3 grupos distantes viram quadros empilhados se aproveitarem ≥ 1,5× a área
  // ===========================================================================
  var LIMIAR_RETRATO = 1.25, GANHO_MINIMO = 1.5, MARGEM = 0.06;
  var AREA = { paisagem: { w: 1.6, h: 1 }, retrato: { w: 0.78, h: 1 } };

  function merc(lon, lat) {
    var R = 6378137, y = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + y / 2))];
  }
  function bboxFeature(f) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (function passa(c) {
      if (typeof c[0] === 'number') { var p = merc(c[0], c[1]); if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; return; }
      for (var i = 0; i < c.length; i++) passa(c[i]);
    })(f.geometry.coordinates);
    return isFinite(b[0]) ? b : null;
  }
  function uniao(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }
  function tocam(a, b, tol) { return a[0] - tol <= b[2] && b[0] - tol <= a[2] && a[1] - tol <= b[3] && b[1] - tol <= a[3]; }

  function agrupar(features) {
    var gs = [];
    features.forEach(function (f) { var b = bboxFeature(f); if (b) gs.push({ fs: [f], bbox: b }); });
    if (!gs.length) return [];
    var total = gs.reduce(function (acc, g) { return uniao(acc, g.bbox); }, gs[0].bbox);
    var tol = 0.08 * Math.max(total[2] - total[0], total[3] - total[1]);
    var mudou = true;
    while (mudou) {
      mudou = false;
      var prox = [];
      gs.forEach(function (g) {
        var atual = g;
        for (var i = prox.length - 1; i >= 0; i--) {
          if (!tocam(prox[i].bbox, atual.bbox, tol)) continue;
          var o = prox.splice(i, 1)[0];
          atual = { fs: o.fs.concat(atual.fs), bbox: uniao(o.bbox, atual.bbox) };
          mudou = true; i = prox.length;
        }
        prox.push(atual);
      });
      gs = prox;
    }
    // norte → sul
    return gs.sort(function (a, b) { return b.bbox[3] - a.bbox[3]; });
  }
  function areaEnquadrada(bboxes, q) {
    var u = bboxes.reduce(uniao), w = u[2] - u[0], h = u[3] - u[1], util = 1 - 2 * MARGEM;
    var k = Math.min(w > 0 ? q.w * util / w : Infinity, h > 0 ? q.h * util / h : Infinity);
    return soma(bboxes, function (b) { return (b[2] - b[0]) * (b[3] - b[1]) * k * k; });
  }
  function fracoesAltura(hs) {
    var n = hs.length, min = Math.min(0.3, 1 / n), tot = soma(hs, function (x) { return x; });
    var f = hs.map(function (x) { return Math.max(min, tot ? x / tot : 1 / n); });
    var s = soma(f, function (x) { return x; });
    return f.map(function (x) { return x / s; });
  }
  function orientacao(w, h) { return w > 0 && h / w > LIMIAR_RETRATO ? 'retrato' : 'paisagem'; }

  function compor(features) {
    var grupos = agrupar(features);
    if (!grupos.length) return { orientacao: 'paisagem', quadros: [] };
    var todos = grupos.reduce(function (acc, g) { return uniao(acc, g.bbox); }, grupos[0].bbox);
    var unico = { orientacao: orientacao(todos[2] - todos[0], todos[3] - todos[1]), quadros: [{ fs: features, bbox: todos, fr: 1, titulo: null }] };
    if (grupos.length < 2 || grupos.length > 3) return unico;
    var larg = Math.max.apply(null, grupos.map(function (g) { return g.bbox[2] - g.bbox[0]; }));
    var alt = soma(grupos, function (g) { return g.bbox[3] - g.bbox[1]; });
    var om = orientacao(larg, alt), fr = fracoesAltura(grupos.map(function (g) { return g.bbox[3] - g.bbox[1]; }));
    var am = AREA[om], au = AREA[unico.orientacao];
    var apMulti = soma(grupos, function (g, i) { return areaEnquadrada([g.bbox], { w: am.w, h: am.h * fr[grupos.indexOf(g)] }); });
    var apUnico = areaEnquadrada(grupos.map(function (g) { return g.bbox; }), au);
    if (apMulti / (am.w * am.h) < GANHO_MINIMO * apUnico / (au.w * au.h)) return unico;
    return {
      orientacao: om,
      quadros: grupos.map(function (g, i) {
        var setores = {}; g.fs.forEach(function (f) { if (f.properties.setor) setores[f.properties.setor] = true; });
        var ks = Object.keys(setores);
        return { fs: g.fs, bbox: g.bbox, fr: fr[i], titulo: ks.length === 1 ? titulo(ks[0]) : 'Bloco ' + (i + 1) };
      })
    };
  }

  /** Conjunto de limites da fazenda que cobre mais talhões da safra (empate: o da própria safra). */
  function escolherMapa(u, talhoes, safra) {
    var conj = (MAPAS || {})[u] || [];
    var porId = {}; talhoes.forEach(function (t) { porId[u + '|' + normalizarCodigo(t.t)] = t; });
    var melhor = null, n0 = -1;
    conj.forEach(function (c) {
      var n = c.geo.features.filter(function (f) { return porId[f.properties.name]; }).length;
      if (String(c.rotulo).toUpperCase() === String(safra).toUpperCase()) n += 0.5;
      if (n > n0) { n0 = n; melhor = c; }
    });
    if (!melhor) return null;
    var nomes = {}; melhor.geo.features.forEach(function (f) { nomes[f.properties.name] = true; });
    // setor do PIMS nos polígonos sem setor (os quadros de setores distantes ganham o nome do setor)
    var features = melhor.geo.features.map(function (f) {
      var t = porId[f.properties.name];
      if (f.properties.setor || !t || !t.setor) return f;
      return { type: 'Feature', geometry: f.geometry, properties: Object.assign({}, f.properties, { setor: t.setor }) };
    });
    return {
      rotulo: melhor.rotulo, features: features, porId: porId,
      semPoligono: talhoes.filter(function (t) { return !nomes[u + '|' + normalizarCodigo(t.t)]; })
    };
  }

  // ===========================================================================
  // Gráficos
  // ===========================================================================
  var charts = {};
  function chart(el) {
    var id = el.id || (el.id = 'g' + Math.random().toString(36).slice(2));
    if (el.querySelector('.vazio')) el.innerHTML = '';
    if (!charts[id] || charts[id].getDom() !== el) charts[id] = echarts.init(el, null, { renderer: 'canvas' });
    return charts[id];
  }
  function descartar(id) { if (charts[id]) { charts[id].dispose(); delete charts[id]; } }
  function vazio(el, msg) { descartar(el.id); el.innerHTML = '<div class="vazio">' + esc(msg) + '</div>'; }
  function opt(o) { o.animation = false; o.textStyle = { fontFamily: getComputedStyle(document.body).fontFamily }; return o; }
  var tipBase = {
    backgroundColor: '#fff', borderColor: COR.linha, borderWidth: 1, padding: [8, 10], confine: true,
    textStyle: { color: COR.texto, fontSize: 12 }, extraCssText: 'box-shadow:0 6px 18px rgba(16,54,50,.12);border-radius:8px;'
  };
  function tt(o) { return Object.assign({}, tipBase, o); }
  var eixoX = { axisLine: { lineStyle: { color: COR.linha } }, axisTick: { show: false }, axisLabel: { color: COR.suave, fontSize: 11 }, splitLine: { show: false } };
  var eixoY = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: COR.fraco, fontSize: 11, formatter: function (v) { return fmtN(v); } }, splitLine: { lineStyle: { color: COR.grade } } };
  function legenda(id, itens) {
    $(id).innerHTML = itens.map(function (i) { return '<li><i class="' + (i.tipo || '') + '" style="' + (i.tipo === 'tracejada' ? 'border-color:' : 'background:') + i.cor + '"></i>' + esc(i.nome) + '</li>'; }).join('');
  }

  // ---- mapa de uma fazenda (um ou mais quadros) ----
  function tooltipTalhao(p) {
    var d = p.data; if (!d || !d.talhao) return '';
    var cab = (d.faz ? '<b>' + esc(titulo(d.faz)) + '</b> · ' : '') + 'Talhão <b>' + esc(d.talhao) + '</b>';
    if (!d.x) return cab + '<br><span style="color:#8A988F">fora desta safra</span>';
    var x = d.x;
    return cab + (x.setor ? ' <span style="color:#8A988F">· ' + esc(titulo(x.setor)) + '</span>' : '') +
      '<br><b>' + fmtPct(x.perc) + '</b> · ' + fmtN(x.efetivo) + ' de ' + fmtN(x.base) + ' ha' +
      (x.enc ? '<br>Plantio encerrado no PIMS' : '') + (x.variedade ? '<br><span style="color:#5B6B62">' + esc(x.variedade) + '</span>' : '');
  }
  function dadosMapa(mp, faz) {
    return mp.features.map(function (f) {
      var x = mp.porId[f.properties.name], cor = corClasse(x ? x.k : -1);
      return { name: f.properties.name, talhao: f.properties.talhao, x: x, faz: faz, itemStyle: { areaColor: cor }, emphasis: { itemStyle: { areaColor: cor } } };
    });
  }
  var registrados = {};
  function registrar(nome, fs) {
    if (!registrados[nome]) { echarts.registerMap(nome, { type: 'FeatureCollection', features: fs }); registrados[nome] = true; }
    return nome;
  }
  /** layoutSize que faz o mapa (aspecto a = largura/altura) caber no quadro fw × fh. */
  function tamanhoQueCabe(a, fw, fh) { return (a >= 1 ? Math.min(fw, fh * a) : Math.min(fh, fw / a)) * 0.94; }

  function desenharMapaFazenda(el, u, m, comp, opcoes) {
    opcoes = opcoes || {};
    var mp = comp.mp, W = el.clientWidth, H = el.clientHeight, series = [], graphic = [];
    var y = 0, vao = comp.quadros.length > 1 ? 10 : 0, alturaUtil = H - vao * (comp.quadros.length - 1);
    var dados = dadosMapa(mp, opcoes.faz ? u : null), porNome = {};
    dados.forEach(function (d) { porNome[d.name] = d; });
    comp.quadros.forEach(function (q, i) {
      var fh = comp.quadros.length > 1 ? alturaUtil * q.fr : H, topo = q.titulo ? Math.round((opcoes.fonteTitulo || 12) * 1.8) : 0;
      var a = (q.bbox[2] - q.bbox[0]) / Math.max(1, q.bbox[3] - q.bbox[1]);
      var nome = registrar(u + '|' + mp.rotulo + '|' + (comp.quadros.length > 1 ? 'q' + i : 'todo'), q.fs);
      var lat = (Math.atan(Math.exp(((q.bbox[1] + q.bbox[3]) / 2) / 6378137)) * 2 - Math.PI / 2);
      if (q.titulo) graphic.push({ type: 'text', left: 4, top: y + 2, style: { text: q.titulo, fontSize: opcoes.fonteTitulo || 12, fontWeight: 600, fill: COR.suave } });
      series.push({
        type: 'map', map: nome, roam: !opcoes.estatico && !opcoes.semZoom, selectedMode: false, aspectScale: Math.cos(lat),
        layoutCenter: [W / 2, y + topo + (fh - topo) / 2], layoutSize: tamanhoQueCabe(a, W, fh - topo),
        scaleLimit: { min: 0.8, max: 14 },
        itemStyle: { borderColor: '#FFFFFF', borderWidth: opcoes.estatico ? 0.4 : 0.8 },
        emphasis: { label: { show: !opcoes.estatico, color: '#000', fontWeight: 700 }, itemStyle: { borderColor: COR.escuro, borderWidth: 1.4 } },
        label: { show: !opcoes.estatico || !!opcoes.rotulos, fontSize: opcoes.fonte || (opcoes.grande ? 11 : 9), color: COR.texto, formatter: function (p) { return p.data ? p.data.talhao : ''; } },
        labelLayout: { hideOverlap: true },
        data: q.fs.map(function (f) { return porNome[f.properties.name]; }),
        cursor: opcoes.aoClicar ? 'pointer' : 'default'
      });
      y += fh + vao;
    });
    var g = chart(el);
    g.setOption(opt({ tooltip: tt({ trigger: 'item', formatter: tooltipTalhao }), graphic: graphic, series: series }), true);
    g.off('click');
    if (opcoes.aoClicar) g.on('click', opcoes.aoClicar);
    return g;
  }

  // ===========================================================================
  // Painel
  // ===========================================================================
  var mUltimo = null;

  function kpi(rotulo, valor, un, sub, extra) {
    return '<div class="kpi"><span class="kpi-rotulo">' + rotulo + '</span><span class="kpi-valor">' + valor + (un ? '<small>' + un + '</small>' : '') + '</span><span class="kpi-sub">' + (sub || '&nbsp;') + '</span>' + (extra || '') + '</div>';
  }
  function chip(tipo, texto) { return '<span class="chip ' + tipo + '">' + esc(texto) + '</span>'; }

  function renderKpis(m) { $('kpis').innerHTML = htmlKpis(m); }

  function htmlKpis(m) {
    var pl = m.o === 'PLANTIO', feito = pl ? 'plantada' : 'colhida';
    var rot = rotulosClasse(m.o), total = m.talhoes.length || 1;
    var ritmoSub = m.metaHoje !== null && m.media7
      ? (function () { var r = m.media7 / m.metaHoje - 1; return chip(r >= 0 ? 'bom' : r > -0.1 ? 'atencao' : 'ruim', (r >= 0 ? '+' : '') + fmtPct(r) + ' da meta') + ' meta ' + fmtN(m.metaHoje) + ' ha/dia'; })()
      : (m.media ? 'média geral ' + fmtN(m.media) + ' ha/dia' : 'sem apontamentos');
    var necSub = m.termino
      ? (m.necessario ? (m.media7 ? chip(m.necessario <= m.media7 ? 'bom' : m.necessario <= m.media7 * 1.1 ? 'atencao' : 'ruim', m.necessario <= m.media7 ? 'ritmo atual basta' : 'acima do ritmo') + ' ' : '') + 'até ' + fmtData(m.termino, true) : 'operação concluída')
      : 'cadastre a data de término';
    var prevSub = m.previsao
      ? (m.termino && m.restante > 0 ? (function () { var d = dif(m.termino, m.previsao); return d <= 0 ? chip('bom', d === 0 ? 'no prazo' : Math.abs(d) + ' dias antes') : chip(d <= 3 ? 'atencao' : 'ruim', d + ' dias após o planejado'); })() + ' ' : '') + (m.restante > 0 ? 'em ' + fmtN(m.diasPrev + 1) + ' dias' : 'concluído')
      : 'sem ritmo para projetar';
    var barra = '<span class="barra-empilhada">' + [3, 2, 1, 0].map(function (k) { var c = m.porClasse[k]; return c.n ? '<span style="width:' + (c.n / total * 100) + '%;background:' + COR.s[k] + '" title="' + rot[k] + ': ' + c.n + '"></span>' : ''; }).join('') + '</span>';
    return [
      kpi('Área ' + feito, fmtN(m.exec), 'ha', chip('neutro', fmtPct(m.pct, 1)) + ' de ' + fmtN(m.areaTotal) + ' ha'),
      kpi(pl ? 'A plantar' : 'A colher', fmtN(m.restante), 'ha', m.porClasse[0].n + ' talhões não iniciados'),
      kpi('Ritmo · 7 dias', m.media7 ? fmtN(m.media7) : '—', m.media7 ? 'ha/dia' : '', ritmoSub),
      kpi('Necessário p/ meta', m.necessario ? fmtN(m.necessario) : '—', m.necessario ? 'ha/dia' : '', necSub),
      kpi('Previsão de término', m.previsao ? fmtData(m.previsao) : '—', '', prevSub),
      kpi('Talhões ' + (pl ? 'plantados' : 'colhidos'), m.porClasse[3].n + '<small>/ ' + m.talhoes.length + '</small>', '', (m.porClasse[2].n + m.porClasse[1].n) + ' em andamento · ' + m.porClasse[0].n + ' não iniciados', barra)
    ].join('');
  }

  function renderDestaque(m) {
    var pl = m.o === 'PLANTIO', c = cultura(m.s);
    set('d-eyebrow', (pl ? 'Plantio' : 'Colheita') + ' · ' + nomeSafra(m.s));
    set('d-titulo', estado.u === TODAS ? 'Todas as fazendas' : titulo(estado.u));
    $('d-barra').style.width = (m.pct * 100).toFixed(1) + '%';
    var partes = ['<b>' + fmtPct(m.pct, 1) + '</b> ' + (pl ? 'plantado' : 'colhido'), fmtN(m.exec) + ' de ' + fmtN(m.areaTotal) + ' ha'];
    if (m.ini) partes.push('início em ' + fmtData(m.ini, true));
    if (m.ult) partes.push('último apontamento em ' + fmtData(m.ult, true));
    if (m.termino) partes.push('término planejado em ' + fmtData(m.termino, true));
    $('d-resumo').innerHTML = partes.join(' <span aria-hidden="true">·</span> ');
    var colheitadeira = !pl && ({ SOJA: 1, MILHO: 1, SORGO: 1, MILHETO: 1 })[c];
    $('d-maquina').src = colheitadeira ? 'assets/maquina.png' : 'assets/trator_8r.svg';
    $('d-maquina').alt = colheitadeira ? 'Colheitadeira de grãos' : 'Trator 8R com plantadeira';
  }

  function renderSituacao(m) {
    var rot = rotulosClasse(m.o);
    set('sit-sub', m.talhoes.length + ' talhões · ' + fmtN(m.areaTotal) + ' ha');
    $('situacao').innerHTML = '<div class="situacao-lista">' + [3, 2, 1, 0].map(function (k) {
      var c = m.porClasse[k];
      return '<div class="situacao-item"><i style="background:' + COR.s[k] + (k === 0 ? ';box-shadow:inset 0 0 0 1px #C9D3CB' : '') + '"></i><span>' + rot[k] + '</span><span class="v"><b>' + c.n + '</b>' + fmtN(c.ha) + ' ha</span></div>';
    }).join('') + '</div>' +
      '<p class="rodape-cartao">Dano ' + fmtN(m.dano) + ' ha · Replantio ' + fmtN(m.replantio) + ' ha</p>';
    var l = m.variedades.filter(function (v) { return v.prev > 0; });
    $('variedades').innerHTML = l.length ? '<table class="tabela"><thead><tr><th>Variedade</th><th class="n">' + (m.o === 'PLANTIO' ? 'Plantado' : 'Colhido') + '</th></tr></thead><tbody>' +
      l.map(function (v) {
        return '<tr><td>' + esc(v.v) + '<div class="var-barra"><span style="width:' + Math.min(100, v.exec / v.prev * 100).toFixed(1) + '%"></span></div></td><td class="n">' + fmtN(v.exec) + '<br><small style="color:#8A988F">de ' + fmtN(v.prev) + '</small></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="vazio">Sem variedades cadastradas</div>';
  }

  function renderEquipes(m) {
    var l = m.equipes.filter(function (e) { return e.total > 0; }).slice(0, 8);
    if (!l.length) { $('equipes').innerHTML = '<div class="vazio">Sem apontamentos</div>'; return; }
    var max = Math.max.apply(null, l.map(function (e) { return e.ult7; })) || 1;
    $('equipes').innerHTML = '<div class="equipes-lista">' + l.map(function (e) {
      return '<div class="equipe" title="' + esc(e.completo) + ' · total ' + fmtN(e.total) + ' ha"><span class="nome">' + esc(e.nome) + '</span>' +
        '<span class="trilho"><span style="width:' + (e.ult7 / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="v">' + fmtN(e.ult7) + ' <small>ha</small></span></div>';
    }).join('') + '</div>' + (m.equipes.length > 8 ? '<p class="rodape-cartao">+ ' + (m.equipes.length - 8) + ' equipes</p>' : '');
  }

  function renderMeta(m) {
    var el = $('g-meta');
    legenda('leg-meta', [{ nome: 'Realizado', cor: COR.teal }, { nome: 'Meta diária', cor: COR.dourado, tipo: 'tracejada' }]);
    if (!m.serie.length) return vazio(el, 'Ainda não há apontamentos de ' + m.o.toLowerCase() + ' nesta safra.');
    chart(el).setOption(opcoesMeta(m, 1), true);
  }

  /** Gráfico "realizado x meta por dia"; `k` multiplica fontes e traços (TV e imagem exportada). */
  function opcoesMeta(m, k, ultimosDias) {
    var serie = ultimosDias ? m.serie.slice(-ultimosDias) : m.serie;
    var temMeta = serie.some(function (x) { return x.meta !== null; });
    var series = [{
      name: 'Realizado', type: 'bar', data: serie.map(function (x) { return Math.round(x.a); }), barMaxWidth: 26 * k, barCategoryGap: '28%',
      itemStyle: { color: COR.teal, borderRadius: [3 * k, 3 * k, 0, 0] },
      label: { show: serie.length <= 45, position: 'top', fontSize: 10.5 * k, color: COR.suave, formatter: function (p) { return p.value ? fmtN(p.value) : ''; } },
      labelLayout: { hideOverlap: true }
    }];
    if (temMeta) series.push({ name: 'Meta', type: 'line', step: 'middle', data: serie.map(function (x) { return x.meta; }), symbol: 'none', lineStyle: { color: COR.dourado, width: 2 * k, type: [6 * k, 4 * k] }, z: 5 });
    return opt({
      grid: { left: 4 * k, right: 8 * k, top: 20 * k, bottom: 4 * k, containLabel: true },
      tooltip: tt({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(12,90,80,.05)' } }, formatter: function (ps) {
        var x = serie[ps[0].dataIndex];
        return '<b>' + x.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + '</b><br>Realizado: <b>' + fmtN(x.a) + ' ha</b>' + (x.meta !== null ? '<br>Meta: ' + fmtN(x.meta) + ' ha' : '');
      } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', data: serie.map(function (x) { return x.d.getDate() === 1 || x === serie[0] ? fmtData(x.d, true) : String(x.d.getDate()); }), axisLabel: { color: COR.suave, fontSize: 11 * k, hideOverlap: true }, axisLine: { lineStyle: { color: COR.linha, width: k } } }),
      yAxis: Object.assign({}, eixoY, { type: 'value', axisLabel: { color: COR.fraco, fontSize: 11 * k, formatter: function (v) { return fmtN(v); } }, splitLine: { lineStyle: { color: COR.grade, width: k } } }),
      series: series
    });
  }

  function renderAcumulado(m) {
    var el = $('g-acum');
    legenda('leg-acum', [{ nome: 'Realizado', cor: COR.teal }, { nome: 'Planejado pelas metas', cor: COR.dourado, tipo: 'tracejada' }, { nome: 'Projeção pelo ritmo', cor: '#9AA79F', tipo: 'tracejada' }]);
    if (!m.serie.length) return vazio(el, 'Ainda não há apontamentos nesta safra.');
    var fim = m.ult;
    if (m.previsao && m.previsao > fim) fim = m.previsao;
    if (m.termino && m.termino > fim) fim = m.termino;
    if (dif(m.ini, fim) > 150) fim = new Date(+m.ini + 150 * DIA);
    var cats = [], real = [], plan = [], proj = [], ar = 0, ap = 0, h = hoje();
    var temMeta = m.planos.length > 0;
    for (var t = +m.ini; t <= +fim; t += DIA) {
      var d = new Date(t); d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var k = paraIso(d);
      ar += m.porDia[k] || 0;
      ap += m.metaDia(d) || 0;
      cats.push(d);
      real.push(d <= m.ult ? Math.round(Math.min(ar, m.areaTotal)) : null);
      plan.push(temMeta ? Math.round(Math.min(ap, m.areaTotal)) : null);
      proj.push(null);
    }
    // projeção: do último apontamento até a previsão, no ritmo dos últimos 7 dias
    if (m.ritmo && m.restante > 0) {
      var i0 = dif(m.ini, m.ult), base = Math.min(ar, m.exec);
      for (var j = i0; j < cats.length; j++) proj[j] = Math.round(Math.min(m.areaTotal, m.exec + (j - i0) * m.ritmo));
      proj[i0] = Math.round(m.exec);
    }
    chart(el).setOption(opt({
      grid: { left: 4, right: 12, top: 22, bottom: 4, containLabel: true },
      tooltip: tt({ trigger: 'axis', formatter: function (ps) {
        var s = '<b>' + cats[ps[0].dataIndex].toLocaleDateString('pt-BR') + '</b>';
        ps.forEach(function (p) { if (p.value !== null && p.value !== undefined) s += '<br>' + p.marker + p.seriesName + ': <b>' + fmtN(p.value) + ' ha</b>'; });
        return s;
      } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', boundaryGap: false, data: cats.map(function (d) { return fmtData(d, true); }), axisLabel: { color: COR.suave, fontSize: 11, hideOverlap: true } }),
      yAxis: Object.assign({}, eixoY, { type: 'value', max: function (v) { return Math.max(v.max, m.areaTotal) * 1.04; } }),
      series: [
        { name: 'Realizado', type: 'line', data: real, symbol: 'none', lineStyle: { color: COR.teal, width: 2.5 }, areaStyle: { color: 'rgba(12,90,80,.09)' },
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: m.areaTotal }], lineStyle: { color: '#B9C4BC', type: 'solid', width: 1 }, label: { formatter: 'Área total ' + fmtN(m.areaTotal) + ' ha', position: 'insideStartTop', color: COR.suave, fontSize: 11 } } },
        { name: 'Planejado', type: 'line', data: plan, symbol: 'none', lineStyle: { color: COR.dourado, width: 2, type: [6, 4] } },
        { name: 'Projeção', type: 'line', data: proj, symbol: 'none', lineStyle: { color: '#9AA79F', width: 2, type: [2, 4] } }
      ]
    }), true);
  }

  function renderTalhoes(m) {
    var el = $('g-talhao'), rot = rotulosClasse(m.o);
    if (m.unidades.length > 1) return renderPorFazendaDia(m);
    legenda('leg-talhao', [3, 2, 1, 0].map(function (k) { return { nome: rot[k], cor: COR.s[k] }; }));
    set('talhao-titulo', 'Execução por talhão');
    var l = m.talhoes.slice().sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    set('talhao-sub', l.length + ' talhões, em ordem de código');
    if (!l.length) return vazio(el, 'Nenhum talhão cadastrado nesta safra.');
    chart(el).setOption(opt({
      grid: { left: 4, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: tt({ trigger: 'item', formatter: function (p) { var x = l[p.dataIndex]; return tooltipTalhao({ data: { talhao: x.t, x: x } }); } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', data: l.map(function (x) { return x.t; }), axisLabel: { color: COR.suave, fontSize: 10.5, interval: 0, rotate: l.length > 36 ? 90 : 0 } }),
      yAxis: Object.assign({}, eixoY, { type: 'value', max: 100, axisLabel: { color: COR.fraco, fontSize: 11, formatter: '{value}%' } }),
      series: [{
        type: 'bar', barMaxWidth: 22, barCategoryGap: '22%',
        data: l.map(function (x) { return { value: Math.max(1.5, Math.round(x.perc * 100)), itemStyle: { color: COR.s[x.k], borderRadius: [2, 2, 0, 0] } }; })
      }]
    }), true);
  }

  function renderPorFazendaDia(m) {
    var el = $('g-talhao');
    set('talhao-titulo', 'Área por dia e fazenda');
    set('talhao-sub', 'hectares por dia, empilhados por fazenda');
    legenda('leg-talhao', m.unidades.map(function (u) { return { nome: titulo(u), cor: COR_FAZENDA[u] || COR.fraco }; }));
    if (!m.serie.length) return vazio(el, 'Ainda não há apontamentos nesta safra.');
    var por = {};
    m.ops.forEach(function (a) { var f = por[a.u] = por[a.u] || {}; f[a.d] = (f[a.d] || 0) + a.a; });
    chart(el).setOption(opt({
      grid: { left: 4, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: tt({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(12,90,80,.05)' } }, formatter: function (ps) {
        var s = '<b>' + m.serie[ps[0].dataIndex].d.toLocaleDateString('pt-BR') + '</b>', tot = 0;
        ps.slice().reverse().forEach(function (p) { if (p.value) { tot += p.value; s += '<br>' + p.marker + p.seriesName + ': ' + fmtN(p.value) + ' ha'; } });
        return s + '<br><b>Total: ' + fmtN(tot) + ' ha</b>';
      } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', data: m.serie.map(function (x) { return fmtData(x.d, true); }), axisLabel: { color: COR.suave, fontSize: 11, hideOverlap: true } }),
      yAxis: Object.assign({}, eixoY, { type: 'value' }),
      series: m.unidades.filter(function (u) { return por[u]; }).map(function (u) {
        return { name: titulo(u), type: 'bar', stack: 'd', barMaxWidth: 28, itemStyle: { color: COR_FAZENDA[u] || COR.fraco, borderColor: '#fff', borderWidth: 1 },
          data: m.serie.map(function (x) { return Math.round((por[u] || {})[paraIso(x.d)] || 0); }) };
      })
    }), true);
  }

  // ---- mapa: fazenda (adaptativo) ou quadro de fazendas (Todas) ----
  /** Depois de trocar o layout (todas/paisagem/retrato), os gráficos precisam da nova largura. */
  function redimensionarDepois() {
    requestAnimationFrame(function () { Object.keys(charts).forEach(function (k) { if (charts[k] && !charts[k].isDisposed()) charts[k].resize(); }); });
  }

  function renderMapa(m) {
    var grade = $('grade'), rot = rotulosClasse(m.o), classeAntes = grade.className;
    setTimeout(function () { if (grade.className !== classeAntes) redimensionarDepois(); }, 0);
    legenda('legenda-mapa', [3, 2, 1, 0].map(function (k) { return { nome: rot[k], cor: COR.s[k] }; }).concat([{ nome: 'Fora desta safra', cor: COR.fora }]));
    var elMapa = $('g-mapa');
    if (m.unidades.length > 1) {
      grade.className = 'grade todas';
      set('mapa-titulo', 'Fazendas');
      set('mapa-sub', 'clique numa fazenda para abrir o painel dela');
      $('btn-ampliar').hidden = true;
      set('mapa-rodape', '');
      return renderFazendas(m);
    }
    $('btn-ampliar').hidden = false;
    set('mapa-titulo', 'Mapa de evolução');
    if (!MAPAS) {
      grade.className = 'grade paisagem';
      set('mapa-sub', 'carregando os limites dos talhões…');
      return vazio(elMapa, 'Carregando os limites dos talhões…');
    }
    var u = m.unidades[0], mp = escolherMapa(u, m.talhoes, m.s);
    if (!mp) {
      grade.className = 'grade paisagem';
      set('mapa-sub', '');
      set('mapa-rodape', '');
      return vazio(elMapa, 'Não há limites de talhões cadastrados para esta fazenda no módulo Mapas.');
    }
    var comp = compor(mp.features); comp.mp = mp;
    grade.className = 'grade ' + comp.orientacao;
    set('mapa-sub', 'limites: ' + (String(mp.rotulo).toUpperCase() === 'BASE' ? 'talhões da fazenda' : nomeSafra(mp.rotulo)) + (comp.quadros.length > 1 ? ' · ' + comp.quadros.length + ' quadros' : ''));
    set('mapa-rodape', mp.semPoligono.length ? 'Sem polígono no mapa: ' + mp.semPoligono.map(function (t) { return t.t; }).join(', ') : '');
    // altura do quadro segue a forma da fazenda
    var corpo = elMapa.parentNode, W = corpo.clientWidth || 600;
    var alturaDesejada = soma(comp.quadros, function (q) {
      var r = (q.bbox[3] - q.bbox[1]) / Math.max(1, q.bbox[2] - q.bbox[0]);
      return W * r * 1.06 + (q.titulo ? 22 : 0);
    }) + 10 * (comp.quadros.length - 1);
    var ampliado = $('c-mapa').classList.contains('ampliado');
    var lim = comp.orientacao === 'retrato' ? [520, 1150] : [340, 680];
    if (!ampliado) document.documentElement.style.setProperty('--mapa-h', Math.round(Math.max(lim[0], Math.min(lim[1], alturaDesejada))) + 'px');
    requestAnimationFrame(function () { desenharMapaFazenda(elMapa, u, m, comp, { grande: ampliado }); });
  }

  function renderFazendas(m) {
    var el = $('g-mapa');
    Object.keys(charts).forEach(function (k) { if (k.indexOf('mini-') === 0) descartar(k); });
    descartar(el.id);
    var cards = m.unidades.map(function (u) {
      var x = calcula([u], m.s, m.o);
      return { u: u, x: x };
    });
    el.innerHTML = '<div class="fazendas">' + cards.map(function (c) {
      var x = c.x;
      return '<button class="fazenda" data-u="' + esc(c.u) + '">' +
        '<div class="fazenda-cab"><span class="fazenda-nome">' + esc(titulo(c.u)) + '</span><span class="fazenda-pct">' + fmtPct(x.pct) + '</span></div>' +
        '<div class="barra"><span style="width:' + (x.pct * 100).toFixed(1) + '%"></span></div>' +
        '<div class="fazenda-mapa" id="mini-' + c.u.replace(/\W/g, '') + '"></div>' +
        '<div class="fazenda-rodape"><span>' + fmtN(x.exec) + ' / ' + fmtN(x.areaTotal) + ' ha</span></div>' +
        '<div class="fazenda-rodape"><span>' + (x.media7 ? fmtN(x.media7) + ' ha/dia' : 'sem ritmo') + '</span><span>' + (x.previsao ? '→ ' + fmtData(x.previsao, true) : '') + '</span></div>' +
        '</button>';
    }).join('') + '</div>';
    if (!MAPAS) return;
    requestAnimationFrame(function () {
      cards.forEach(function (c) {
        var box = $('mini-' + c.u.replace(/\W/g, ''));
        var mp = escolherMapa(c.u, c.x.talhoes, m.s);
        if (!box || !mp) { if (box) box.innerHTML = '<div class="vazio">sem limites</div>'; return; }
        var comp = compor(mp.features); comp.mp = mp;
        comp.quadros.forEach(function (q) { q.titulo = null; });
        desenharMapaFazenda(box, c.u, c.x, comp, { estatico: true, faz: true });
      });
    });
  }

  function renderPainel() {
    var us = estado.u === TODAS ? unidadesDaSafra(estado.s) : [estado.u];
    var m = calcula(us, estado.s, estado.o);
    mUltimo = m;
    renderDestaque(m);
    renderKpis(m);
    renderMapa(m);
    renderSituacao(m);
    renderEquipes(m);
    requestAnimationFrame(function () {
      renderMeta(m);
      renderAcumulado(m);
      renderTalhoes(m);
      Object.keys(charts).forEach(function (k) { charts[k].resize(); });
    });
    var aviso = '';
    if (!m.talhoes.length) aviso = 'Nenhum talhão de ' + nomeSafra(estado.s) + ' cadastrado no PIMS para esta fazenda.';
    else if (!m.ops.length) aviso = 'Ainda não há apontamentos de ' + estado.o.toLowerCase() + ' de ' + nomeSafra(estado.s) + ' no PIMS.';
    else if (!m.planos.length) aviso = 'Sem metas cadastradas para esta operação. Cadastre na tela Metas para acompanhar o ritmo planejado.';
    mostrarAviso(aviso);
  }

  // ===========================================================================
  // Metas
  // ===========================================================================
  var form = { periodos: [] };

  function opcoes(el, valores, atual, rotulo) {
    el.innerHTML = valores.map(function (v) { return '<option value="' + esc(v) + '"' + (v === atual ? ' selected' : '') + '>' + esc(rotulo ? rotulo(v) : v) + '</option>'; }).join('');
  }
  function formAtual() { return { u: $('m-unidade').value, s: $('m-safra').value, o: $('m-op').value }; }
  function diasPeriodo(p) { return p.inicio && p.fim && p.inicio <= p.fim ? dif(iso(p.inicio), iso(p.fim)) + 1 : 0; }

  function carregarForm(u, s, o) {
    var us = unidadesDaSafra(s);
    if (us.indexOf(u) < 0) u = us[0];
    opcoes($('m-unidade'), us, u, titulo);
    opcoes($('m-safra'), DADOS.safras, s, nomeSafra);
    $('m-op').value = o;
    var p = planoDe(u, s, o);
    form.periodos = p ? p.periodos.map(function (x) { return { inicio: x.inicio, fim: x.fim, meta: x.meta }; }) : [];
    if (!form.periodos.length) {
      var m = calcula([u], s, o), ini = m.ini ? paraIso(m.ini) : paraIso(hoje());
      form.periodos.push({ inicio: ini, fim: paraIso(new Date(+iso(ini) + 29 * DIA)), meta: '' });
    }
    $('m-termino').value = p && p.dataTermino ? String(p.dataTermino).slice(0, 10) : '';
    $('m-autor').value = p && p.autor ? p.autor : (ls('autor') || '');
    $('m-obs').value = p && p.observacao ? p.observacao : '';
    $('m-excluir').hidden = !p;
    set('m-sugestao', '');
    msg('', '');
    desenharPeriodos();
    atualizarContexto();
    listarPlanos();
  }

  function desenharPeriodos() {
    $('m-periodos').innerHTML = form.periodos.map(function (p, i) {
      return '<tr data-i="' + i + '"><td><input type="date" data-k="inicio" value="' + esc(p.inicio) + '" aria-label="Início do período ' + (i + 1) + '"></td>' +
        '<td><input type="date" data-k="fim" value="' + esc(p.fim) + '" aria-label="Fim do período ' + (i + 1) + '"></td>' +
        '<td class="n"><input type="number" data-k="meta" min="0" step="1" value="' + esc(p.meta) + '" placeholder="ha/dia" aria-label="Meta diária do período ' + (i + 1) + '"></td>' +
        '<td class="n" data-dias></td><td class="n" data-area></td>' +
        '<td><button type="button" class="remover" aria-label="Remover período ' + (i + 1) + '" title="Remover período">×</button></td></tr>';
    }).join('');
    atualizarResumo();
  }

  function atualizarResumo() {
    var linhas = $('m-periodos').querySelectorAll('tr'), total = 0;
    form.periodos.forEach(function (p, i) {
      var d = diasPeriodo(p), a = d * (Number(p.meta) || 0); total += a;
      linhas[i].querySelector('[data-dias]').textContent = d ? fmtN(d) : '—';
      linhas[i].querySelector('[data-area]').textContent = a ? fmtN(a) : '—';
    });
    var f = formAtual(), m = calcula([f.u], f.s, f.o);
    var cobre = total >= m.areaTotal - 0.5;
    $('m-resumo').innerHTML = 'Os períodos somam <b>' + fmtN(total) + ' ha</b> para uma área total de <b>' + fmtN(m.areaTotal) + ' ha</b>' +
      (cobre ? '.' : ' · <span class="alerta">cobrem ' + fmtPct(m.areaTotal ? total / m.areaTotal : 0) + ' da área</span>');
    desenharPrevia(m);
  }

  function atualizarContexto() {
    var f = formAtual(), m = calcula([f.u], f.s, f.o);
    $('m-contexto').innerHTML = [
      ['Área total', fmtN(m.areaTotal) + ' ha'], ['Executado', fmtN(m.exec) + ' ha'], ['Restante', fmtN(m.restante) + ' ha'],
      ['Ritmo 7 dias', m.media7 ? fmtN(m.media7) + ' ha/dia' : '—'], ['Previsão pelo ritmo', fmtData(m.previsao)]
    ].map(function (x) { return '<div><div class="r">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>'; }).join('');
  }

  function periodosValidos() {
    return form.periodos.filter(function (p) { return p.inicio && p.fim && Number(p.meta) > 0; }).map(function (p) { return { inicio: p.inicio, fim: p.fim, meta: Number(p.meta) }; });
  }

  function sugerirTermino() {
    var f = formAtual(), m = calcula([f.u], f.s, f.o);
    if (m.restante === 0) return { data: m.ult, texto: 'A operação já foi concluída.' };
    var plano = { periodos: periodosValidos() };
    if (!plano.periodos.length) return { data: null, texto: 'Preencha ao menos um período com meta.' };
    var falta = m.restante, d = hoje(), fimMax = plano.periodos.reduce(function (a, p) { return p.fim > a ? p.fim : a; }, '');
    for (var i = 0; i < 400; i++) {
      falta -= metaNoDia(plano, d) || 0;
      if (falta <= 0) return { data: d, texto: 'Pelas metas, os ' + fmtN(m.restante) + ' ha restantes terminam em ' + fmtData(d) + '.' };
      if (paraIso(d) > fimMax) break;
      d = new Date(+d + DIA);
    }
    return { data: null, texto: 'As metas cadastradas não cobrem os ' + fmtN(m.restante) + ' ha restantes. Faltam ' + fmtN(falta) + ' ha.' };
  }

  function desenharPrevia(m) {
    var el = $('g-previa');
    legenda('leg-previa', [{ nome: 'Realizado', cor: COR.teal }, { nome: 'Planejado pelas metas', cor: COR.dourado, tipo: 'tracejada' }]);
    var per = periodosValidos();
    var ini = m.ini || (per.length ? iso(per.map(function (p) { return p.inicio; }).sort()[0]) : null);
    if (!ini) return vazio(el, 'Sem apontamentos nem metas para comparar.');
    var fimIso = [m.ult ? paraIso(m.ult) : null, $('m-termino').value || null].concat(per.map(function (p) { return p.fim; })).filter(Boolean).sort().pop();
    var fim = iso(fimIso), plano = { periodos: per };
    var cats = [], real = [], plan = [], ar = 0, ap = 0;
    for (var t = +ini; t <= +fim && cats.length < 400; t += DIA) {
      var d = new Date(t); d = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var k = paraIso(d);
      ar += m.porDia[k] || 0; ap += metaNoDia(plano, d) || 0;
      cats.push(fmtData(d, true));
      real.push(m.ult && d <= m.ult ? Math.round(Math.min(ar, m.areaTotal)) : null);
      plan.push(Math.round(Math.min(ap, m.areaTotal)));
    }
    chart(el).setOption(opt({
      grid: { left: 4, right: 12, top: 22, bottom: 4, containLabel: true },
      tooltip: tt({ trigger: 'axis', formatter: function (ps) { var s = '<b>' + cats[ps[0].dataIndex] + '</b>'; ps.forEach(function (p) { if (p.value !== null && p.value !== undefined) s += '<br>' + p.marker + p.seriesName + ': <b>' + fmtN(p.value) + ' ha</b>'; }); return s; } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', boundaryGap: false, data: cats, axisLabel: { color: COR.suave, fontSize: 11, hideOverlap: true } }),
      yAxis: Object.assign({}, eixoY, { type: 'value', max: function (v) { return Math.max(v.max, m.areaTotal) * 1.04; } }),
      series: [
        { name: 'Realizado', type: 'line', data: real, symbol: 'none', lineStyle: { color: COR.teal, width: 2.5 }, areaStyle: { color: 'rgba(12,90,80,.09)' },
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: m.areaTotal }], lineStyle: { color: '#B9C4BC', type: 'solid', width: 1 }, label: { formatter: 'Área total ' + fmtN(m.areaTotal) + ' ha', position: 'insideStartTop', color: COR.suave, fontSize: 11 } } },
        { name: 'Planejado', type: 'line', data: plan, symbol: 'none', lineStyle: { color: COR.dourado, width: 2, type: [6, 4] } }
      ]
    }), true);
  }

  function listarPlanos() {
    var f = formAtual(), h = hoje();
    var l = PLANOS.slice().sort(function (a, b) { return (a.safra + a.unidade + a.operacao) < (b.safra + b.unidade + b.operacao) ? -1 : 1; });
    $('lista-planos').innerHTML = l.length ? l.map(function (p) {
      var ativo = p.unidade === f.u && p.safra === f.s && p.operacao === f.o, mh = metaNoDia(p, h);
      return '<tr class="' + (ativo ? 'ativo' : '') + '" data-u="' + esc(p.unidade) + '" data-s="' + esc(p.safra) + '" data-o="' + esc(p.operacao) + '" tabindex="0">' +
        '<td>' + esc(titulo(p.unidade)) + '</td><td>' + esc(nomeSafra(p.safra)) + '</td><td>' + esc(titulo(p.operacao)) + '</td>' +
        '<td class="n">' + (mh !== null ? fmtN(mh) + ' ha' : '—') + '</td>' +
        '<td>' + (p.dataTermino ? fmtData(iso(p.dataTermino)) : '—') + '</td>' +
        '<td>' + (p.atualizadoEm ? new Date(p.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '') + (p.autor ? '<br><small style="color:#8A988F">' + esc(p.autor) + '</small>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:#8A988F;padding:28px">Nenhuma meta cadastrada ainda.</td></tr>';
  }

  function msg(t, tipo) { var el = $('m-msg'); el.textContent = t; el.className = 'mensagem ' + (tipo || ''); }

  /** Mesmas regras do servidor local (validarPlano). */
  function validarPlano(p) {
    var erros = [];
    if (!p.unidade) erros.push('Escolha a fazenda.');
    if (!p.safra) erros.push('Escolha a safra.');
    p.periodos.forEach(function (x, i) {
      if (!x.inicio || !x.fim) erros.push('Período ' + (i + 1) + ': preencha as datas.');
      else if (x.inicio > x.fim) erros.push('Período ' + (i + 1) + ': o início está depois do fim.');
      if (!(x.meta > 0)) erros.push('Período ' + (i + 1) + ': a meta diária deve ser maior que zero.');
    });
    var ord = p.periodos.slice().sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
    for (var i = 1; i < ord.length; i++) if (ord[i].inicio <= ord[i - 1].fim) erros.push('Há períodos que se sobrepõem.');
    if (!p.periodos.length && !p.dataTermino) erros.push('Cadastre ao menos um período de meta ou a data de término.');
    p.periodos = ord;
    return erros;
  }

  async function salvar(ev) {
    ev.preventDefault();
    var f = formAtual();
    var p = {
      unidade: f.u, safra: f.s, operacao: f.o, dataTermino: $('m-termino').value || null,
      autor: $('m-autor').value.trim(), observacao: $('m-obs').value.trim(),
      periodos: form.periodos.filter(function (x) { return x.inicio || x.fim || x.meta !== ''; }).map(function (x) { return { inicio: x.inicio, fim: x.fim, meta: Number(x.meta) }; })
    };
    var erros = validarPlano(p);
    if (erros.length) return msg(erros.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' '), 'erro');
    if (p.autor) ls('autor', p.autor);
    try {
      await fonte.salvar(p);
      PLANOS = await fonte.planos();
      $('m-excluir').hidden = false;
      listarPlanos();
      msg('Metas salvas.', 'ok');
    } catch (e) { msg(e.message, 'erro'); }
  }

  async function excluir() {
    var f = formAtual();
    if (!confirm('Excluir as metas de ' + titulo(f.u) + ' · ' + nomeSafra(f.s) + ' · ' + titulo(f.o) + '?')) return;
    try {
      await fonte.excluir({ unidade: f.u, safra: f.s, operacao: f.o });
      PLANOS = await fonte.planos();
      carregarForm(f.u, f.s, f.o);
      msg('Metas excluídas.', 'ok');
    } catch (e) { msg(e.message, 'erro'); }
  }

  // ===========================================================================
  // Modo TV: tela única, sem rolagem, girando entre Todas e cada fazenda.
  // Tudo em "em" a partir de uma fonte proporcional à tela (serve de 720p a 4K,
  // ultrawide e TV na vertical). URL: ?tv=1&tempo=20&fazendas=SM3,GLOBO&todas=0
  // ===========================================================================
  var PARAMS = new URLSearchParams(location.search);
  var tv = { ativo: false, lista: [], i: 0, tempo: 20, timer: null, relogio: null, pausado: false, wake: null, ocioso: null };

  function tvEscala() { return parseFloat(getComputedStyle($('tv')).fontSize) / 14; }

  function tvMontarLista() {
    var us = unidadesDaSafra(estado.s);
    var pedidas = (PARAMS.get('fazendas') || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
    if (pedidas.length) us = us.filter(function (u) { return pedidas.indexOf(u) >= 0; });
    tv.lista = (PARAMS.get('todas') !== '0' && us.length > 1 ? [TODAS] : []).concat(us);
  }

  async function telaCheia() {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { /* sem gesto do usuário */ }
    $('tv-cheia').hidden = !!document.fullscreenElement;
  }
  async function manterTelaLigada() {
    try { if (navigator.wakeLock && !tv.wake) { tv.wake = await navigator.wakeLock.request('screen'); tv.wake.addEventListener('release', function () { tv.wake = null; }); } } catch (e) { /* sem permissão */ }
  }

  function entrarTv() {
    if (!DADOS) return;
    fecharAmpliado(true);
    tv.ativo = true; tv.pausado = false;
    tv.tempo = Math.max(8, Number(PARAMS.get('tempo')) || 20);
    document.documentElement.classList.add('modo-tv');
    $('tv').hidden = false;
    tvMontarLista();
    tv.i = Math.max(0, tv.lista.indexOf(estado.u));
    telaCheia();
    manterTelaLigada();
    tvRelogio();
    clearInterval(tv.relogio); tv.relogio = setInterval(tvRelogio, 15000);
    tvMostrar();
  }

  function sairTv() {
    tv.ativo = false;
    clearTimeout(tv.timer); clearInterval(tv.relogio);
    document.documentElement.classList.remove('modo-tv');
    $('tv').hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    if (tv.wake) { tv.wake.release().catch(function () {}); tv.wake = null; }
    Object.keys(charts).forEach(function (c) { if (c.indexOf('tv-') === 0) descartar(c); });
    if (PARAMS.get('tv') === '1') history.replaceState(null, '', location.pathname + (EMBED ? '?embed=1' : '') + location.hash);
    render();
  }

  function tvRelogio() {
    var d = new Date();
    set('tv-hora', d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    set('tv-data', d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }));
  }

  function tvAgendar() {
    clearTimeout(tv.timer);
    var barra = $('tv-tempo');
    barra.style.transition = 'none'; barra.style.width = '0%';
    $('tv-pausa').textContent = tv.pausado ? 'Continuar' : 'Pausar';
    if (tv.pausado || tv.lista.length < 2) return;
    requestAnimationFrame(function () { requestAnimationFrame(function () { barra.style.transition = 'width ' + tv.tempo + 's linear'; barra.style.width = '100%'; }); });
    tv.timer = setTimeout(function () { tv.i = (tv.i + 1) % tv.lista.length; tvMostrar(); }, tv.tempo * 1000);
  }

  function tvMostrar() { tvDesenhar(); tvAgendar(); }

  function tvDesenhar() {
    if (!tv.ativo || !DADOS) return;
    if (!tv.lista.length) tvMontarLista();
    tv.i = tv.lista.length ? tv.i % tv.lista.length : 0;
    var u = tv.lista[tv.i] || TODAS;
    var us = u === TODAS ? unidadesDaSafra(estado.s) : [u];
    var m = calcula(us, estado.s, estado.o), pl = m.o === 'PLANTIO', k = tvEscala();
    set('tv-eyebrow', (pl ? 'Plantio' : 'Colheita') + ' · ' + nomeSafra(estado.s));
    set('tv-fazenda', u === TODAS ? 'Todas as fazendas' : titulo(u));
    set('tv-pct', fmtPct(m.pct, 1));
    set('tv-pct-rot', (pl ? 'plantado' : 'colhido') + ' · ' + fmtN(m.exec) + ' de ' + fmtN(m.areaTotal) + ' ha');
    $('tv-barra-pct').style.width = (m.pct * 100).toFixed(1) + '%';
    var g = DADOS.geradoEm ? new Date(DADOS.geradoEm) : null;
    set('tv-atualizado', g ? 'PIMS · ' + g.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
    $('tv-maquina').src = !pl && ({ SOJA: 1, MILHO: 1, SORGO: 1, MILHETO: 1 })[cultura(m.s)] ? 'assets/maquina.png' : 'assets/trator_8r.svg';
    $('tv-kpis').innerHTML = htmlKpis(m);
    $('tv-paginas').innerHTML = tv.lista.map(function (x, i) {
      return '<button class="' + (i === tv.i ? 'ativo' : '') + '" data-i="' + i + '">' + esc(x === TODAS ? 'Todas' : titulo(x)) + '</button>';
    }).join('');

    var corpo = $('tv-corpo'), elMapa = $('tv-mapa');
    Object.keys(charts).forEach(function (c) { if (c.indexOf('tv-') === 0) descartar(c); });
    elMapa.innerHTML = '';
    var comp = null;
    if (u !== TODAS && MAPAS) { var mp = escolherMapa(u, m.talhoes, m.s); if (mp) { comp = compor(mp.features); comp.mp = mp; } }
    var formaTv = u === TODAS ? 'todas' : 'paisagem';
    if (comp) {
      // na TV, o arranjo é o que desenha o mapa maior nesta tela (faixa larga ou coluna)
      var bb = mp.features.map(bboxFeature).filter(Boolean).reduce(uniao);
      var asp = (bb[2] - bb[0]) / Math.max(1, bb[3] - bb[1]);
      var cw = corpo.clientWidth || innerWidth, ch = corpo.clientHeight || innerHeight * 0.8;
      var cabe = function (w, h) { var lw = Math.min(w, h * asp); return lw * lw / asp; };
      formaTv = cabe(cw, ch * 0.58) >= cabe(cw * 0.45, ch) ? 'paisagem' : 'retrato';
      // quadros empilhados só numa coluna; numa faixa larga, um quadro só
      if (formaTv === 'paisagem' && comp.quadros.length > 1) comp = { orientacao: 'paisagem', mp: mp, quadros: [{ fs: mp.features, bbox: bb, fr: 1, titulo: null }] };
    }
    corpo.className = 'tv-corpo ' + formaTv;
    set('tv-mapa-titulo', u === TODAS ? 'Fazendas' : 'Mapa de evolução');
    legenda('tv-legenda', [3, 2, 1, 0].map(function (c) { return { nome: rotulosClasse(m.o)[c], cor: COR.s[c] }; }));
    $('tv-legenda').hidden = u === TODAS;
    requestAnimationFrame(function () {
      if (!tv.ativo) return;
      if (u === TODAS) tvFazendas(m);
      else if (comp) desenharMapaFazenda(elMapa, u, m, comp, { semZoom: true, rotulos: true, fonte: 8.5 * k, fonteTitulo: 11 * k });
      else vazio(elMapa, MAPAS ? 'Sem limites de talhões para esta fazenda.' : 'Carregando os limites dos talhões…');
      var eg = $('tv-grafico');
      if (m.serie.length) chart(eg).setOption(opcoesMeta(m, k, 21), true);
      else vazio(eg, 'Ainda não há apontamentos nesta safra.');
    });
  }

  function tvFazendas(m) {
    var el = $('tv-mapa');
    var cards = m.unidades.map(function (u) { return { u: u, x: calcula([u], m.s, m.o) }; });
    el.innerHTML = '<div class="tv-fazendas">' + cards.map(function (c) {
      var x = c.x;
      return '<div class="tv-fazenda"><div class="tv-fazenda-cab"><span>' + esc(titulo(c.u)) + '</span><b>' + fmtPct(x.pct) + '</b></div>' +
        '<div class="barra"><span style="width:' + (x.pct * 100).toFixed(1) + '%"></span></div>' +
        '<div class="tv-mini" id="tv-mini-' + c.u.replace(/\W/g, '') + '"></div>' +
        '<div class="tv-fazenda-rod"><span>' + fmtN(x.exec) + ' / ' + fmtN(x.areaTotal) + ' ha</span><span>' + (x.media7 ? fmtN(x.media7) + ' ha/dia' : 'sem ritmo') + '</span></div></div>';
    }).join('') + '</div>';
    // cartões em 1 ou 2 linhas, conforme o espaço (cartões estreitos e altos ficam ruins na TV)
    var linhasTv = cards.length > 4 && el.clientHeight > el.clientWidth * 0.35 ? 2 : 1;
    el.firstChild.style.gridTemplateColumns = 'repeat(' + Math.ceil(cards.length / linhasTv) + ', minmax(0, 1fr))';
    if (!MAPAS) return;
    requestAnimationFrame(function () {
      cards.forEach(function (c) {
        var box = $('tv-mini-' + c.u.replace(/\W/g, '')), mp = escolherMapa(c.u, c.x.talhoes, m.s);
        if (!box || !mp) return;
        var comp = compor(mp.features); comp.mp = mp; comp.quadros.forEach(function (q) { q.titulo = null; });
        desenharMapaFazenda(box, c.u, c.x, comp, { estatico: true, faz: true });
      });
    });
  }

  function tvMostrarControles() {
    var t = $('tv');
    t.classList.add('mostrar');
    clearTimeout(tv.ocioso);
    tv.ocioso = setTimeout(function () { t.classList.remove('mostrar'); }, 3000);
  }

  function abrirTv() {
    // dentro do COA WEB (iframe), a TV abre numa aba própria: tela cheia e link para favoritar na TV
    if (EMBED) { window.open('index.html?tv=1' + location.hash, '_blank', 'noopener'); return; }
    entrarTv();
  }

  // ===========================================================================
  // Exportar PNG: imagem pronta para o WhatsApp (quadrada, paisagem ou celular),
  // desenhada num canvas no tamanho final, com letras grandes.
  // ===========================================================================
  var FORMATOS = {
    quadrado: { w: 1440, h: 1440 },
    paisagem: { w: 1920, h: 1080 },
    vertical: { w: 1080, h: 1920 }
  };
  var exp = { formato: FORMATOS[ls('formatoPng')] ? ls('formatoPng') : 'quadrado', blob: null, url: null, arquivo: '', gerando: 0 };
  var FAMILIA = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function carregarImagem(src) {
    return new Promise(function (ok, falha) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = falha; i.src = src; });
  }
  /** Desenha um gráfico ECharts fora da tela, no tamanho pedido, e devolve a imagem. */
  function imagemGrafico(w, h, desenhar) {
    var el = document.createElement('div');
    el.id = 'exp-' + Math.random().toString(36).slice(2);
    el.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + Math.round(w) + 'px;height:' + Math.round(h) + 'px;';
    document.body.appendChild(el);
    try {
      var g = desenhar(el);
      if (!g) return Promise.resolve(null);
      var zr = g.getZr();
      if (zr.refreshImmediately) zr.refreshImmediately();
      return carregarImagem(g.getDataURL({ type: 'png', pixelRatio: 1, backgroundColor: '#FFFFFF' }));
    } finally { descartar(el.id); el.remove(); }
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function fonteCv(px, peso) { return (peso || 400) + ' ' + Math.round(px) + 'px ' + FAMILIA; }
  /** Escreve cabendo em maxW (reduz a fonte se precisar). Devolve a largura usada. */
  function escrever(c, t, x, y, px, peso, cor, maxW, alinhar) {
    var p = px; c.font = fonteCv(p, peso);
    while (maxW && p > 8 && c.measureText(t).width > maxW) { p -= 1; c.font = fonteCv(p, peso); }
    c.fillStyle = cor; c.textAlign = alinhar || 'left'; c.textBaseline = 'alphabetic';
    c.fillText(t, x, y);
    return c.measureText(t).width;
  }

  /**
   * Retângulos da imagem. Como no painel, a forma da fazenda decide: fazenda alta (retrato) ganha o
   * mapa numa coluna; fazenda larga (paisagem) ganha o mapa numa faixa larga.
   */
  function layoutExport(fmt, forma) {
    var W = fmt.w, H = fmt.h, k = Math.min(W, H) / 1080, M = 52 * k, g = 26 * k;
    var L = { W: W, H: H, k: k, M: M, g: g, cab: { h: 250 * k }, rod: { y: H - 78 * k, h: 78 * k } };
    var y0 = L.cab.h + g, y1 = L.rod.y - g * 0.6, larg = W - 2 * M, alt = y1 - y0;
    if (W > H * 1.3) {                          // imagem paisagem
      if (forma === 'paisagem') {               // mapa largo em cima; indicadores e gráfico embaixo
        L.mapa = { x: M, y: y0, w: larg, h: alt * 0.56 };
        var yb = L.mapa.y + L.mapa.h + g, hb = y1 - yb, colK = (larg - g) * 0.55;
        L.kpis = { x: M, y: yb, w: colK, h: hb, cols: 3 };
        L.graf = { x: M + colK + g, y: yb, w: larg - colK - g, h: hb };
      } else {                                  // mapa em coluna à direita
        var colE = (larg - g) * 0.47;
        L.kpis = { x: M, y: y0, w: colE, h: alt * 0.48, cols: 3 };
        L.graf = { x: M, y: L.kpis.y + L.kpis.h + g, w: colE, h: y1 - (L.kpis.y + L.kpis.h + g) };
        L.mapa = { x: M + colE + g, y: y0, w: larg - colE - g, h: alt };
      }
    } else if (H > W * 1.3) {                   // imagem de celular: tudo empilhado
      L.kpis = { x: M, y: y0, w: larg, h: 470 * k, cols: 2 };
      var resto = y1 - (L.kpis.y + L.kpis.h + g) - g;
      L.mapa = { x: M, y: L.kpis.y + L.kpis.h + g, w: larg, h: resto * 0.64 };
      L.graf = { x: M, y: L.mapa.y + L.mapa.h + g, w: larg, h: resto * 0.36 };
    } else if (forma === 'retrato') {           // quadrada, fazenda alta: indicadores à esquerda, mapa à direita
      var colQ = (larg - g) * 0.46;
      L.kpis = { x: M, y: y0, w: colQ, h: alt, cols: 2 };
      L.mapa = { x: M + colQ + g, y: y0, w: larg - colQ - g, h: alt };
      L.graf = null;
    } else {                                    // quadrada, fazenda larga ou todas: indicadores em cima, mapa embaixo
      L.kpis = { x: M, y: y0, w: larg, h: 300 * k, cols: 3 };
      L.mapa = { x: M, y: L.kpis.y + L.kpis.h + g, w: larg, h: y1 - (L.kpis.y + L.kpis.h + g) };
      L.graf = null;
    }
    return L;
  }

  /** Os 6 indicadores do painel em texto simples (para a imagem). */
  function kpisTexto(m) {
    var pl = m.o === 'PLANTIO', bom = '#1E7B4F', atencao = '#B7791F', ruim = '#B3261E', suave = COR.suave;
    var ritmo = { sub: m.media ? 'média geral ' + fmtN(m.media) + ' ha/dia' : 'sem apontamentos', cor: suave };
    if (m.metaHoje !== null && m.media7) { var r = m.media7 / m.metaHoje - 1; ritmo = { sub: (r >= 0 ? '+' : '') + fmtPct(r) + ' da meta (' + fmtN(m.metaHoje) + ')', cor: r >= 0 ? bom : r > -0.1 ? atencao : ruim }; }
    var nec = { sub: m.termino ? (m.necessario ? 'para terminar em ' + fmtData(m.termino, true) : 'operação concluída') : 'sem data de término', cor: suave };
    if (m.necessario && m.media7) nec.cor = m.necessario <= m.media7 ? bom : m.necessario <= m.media7 * 1.1 ? atencao : ruim;
    var prev = { sub: m.previsao ? (m.restante > 0 ? 'em ' + fmtN(m.diasPrev + 1) + ' dias' : 'concluído') : 'sem ritmo para projetar', cor: suave };
    if (m.previsao && m.termino && m.restante > 0) { var d = dif(m.termino, m.previsao); prev = { sub: d <= 0 ? (d === 0 ? 'no prazo' : Math.abs(d) + ' dias antes do planejado') : d + ' dias após o planejado', cor: d <= 0 ? bom : d <= 3 ? atencao : ruim }; }
    return [
      { rot: 'Área ' + (pl ? 'plantada' : 'colhida'), val: fmtN(m.exec), un: 'ha', sub: fmtPct(m.pct, 1) + ' de ' + fmtN(m.areaTotal) + ' ha', cor: suave },
      { rot: pl ? 'A plantar' : 'A colher', val: fmtN(m.restante), un: 'ha', sub: m.porClasse[0].n + ' talhões não iniciados', cor: suave },
      { rot: 'Ritmo · 7 dias', val: m.media7 ? fmtN(m.media7) : '—', un: m.media7 ? 'ha/dia' : '', sub: ritmo.sub, cor: ritmo.cor },
      { rot: 'Necessário p/ meta', val: m.necessario ? fmtN(m.necessario) : '—', un: m.necessario ? 'ha/dia' : '', sub: nec.sub, cor: nec.cor },
      { rot: 'Previsão de término', val: m.previsao ? fmtData(m.previsao) : '—', un: '', sub: prev.sub, cor: prev.cor },
      { rot: 'Talhões ' + (pl ? 'plantados' : 'colhidos'), val: String(m.porClasse[3].n), un: '/ ' + m.talhoes.length, sub: (m.porClasse[1].n + m.porClasse[2].n) + ' em andamento', cor: suave }
    ];
  }

  function cartao(c, r, k) {
    c.save(); c.shadowColor = 'rgba(16,54,50,.08)'; c.shadowBlur = 18 * k; c.shadowOffsetY = 4 * k;
    rr(c, r.x, r.y, r.w, r.h, 18 * k); c.fillStyle = '#FFFFFF'; c.fill(); c.restore();
    rr(c, r.x, r.y, r.w, r.h, 18 * k); c.strokeStyle = COR.linha; c.lineWidth = Math.max(1, 1.5 * k); c.stroke();
  }
  function larguraLegenda(c, itens, k) {
    c.font = fonteCv(19 * k, 500);
    return itens.reduce(function (s, it) { return s + c.measureText(it.nome).width + 48 * k; }, 0);
  }
  function legendaCanvas(c, itens, xDir, y, k, tracejada) {
    var x = xDir; c.font = fonteCv(19 * k, 500);
    for (var i = itens.length - 1; i >= 0; i--) {
      var it = itens[i], tw = c.measureText(it.nome).width;
      x -= tw; c.fillStyle = COR.suave; c.textAlign = 'left'; c.fillText(it.nome, x, y);
      x -= 26 * k;
      if (it.linha) { c.strokeStyle = it.cor; c.lineWidth = 3 * k; c.setLineDash([7 * k, 5 * k]); c.beginPath(); c.moveTo(x, y - 7 * k); c.lineTo(x + 20 * k, y - 7 * k); c.stroke(); c.setLineDash([]); }
      else { rr(c, x + 2 * k, y - 16 * k, 16 * k, 16 * k, 4 * k); c.fillStyle = it.cor; c.fill(); if (it.borda) { c.strokeStyle = '#C9D3CB'; c.lineWidth = 1; c.stroke(); } }
      x -= 22 * k;
    }
  }

  async function gerarPng(formato) {
    var fmt = FORMATOS[formato], todas = estado.u === TODAS;
    var us = todas ? unidadesDaSafra(estado.s) : [estado.u];
    var m = calcula(us, estado.s, estado.o), pl = m.o === 'PLANTIO';
    var mp = !todas && MAPAS ? escolherMapa(estado.u, m.talhoes, m.s) : null;
    var comp = mp ? compor(mp.features) : null;
    if (comp) comp.mp = mp;
    var L = layoutExport(fmt, todas ? 'todas' : comp ? comp.orientacao : 'paisagem'), k = L.k, M = L.M, W = L.W, H = L.H;
    // quadros empilhados só cabem bem num espaço mais alto que largo; senão, um quadro só
    if (comp && comp.quadros.length > 1 && L.mapa.w > L.mapa.h * 1.2) {
      var bb = mp.features.map(bboxFeature).filter(Boolean).reduce(uniao);
      comp = { orientacao: comp.orientacao, mp: mp, quadros: [{ fs: mp.features, bbox: bb, fr: 1, titulo: null }] };
    }
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var soja = await carregarImagem('assets/soja_header.svg').catch(function () { return null; });
    var logo = await carregarImagem('assets/logo_locks.png').catch(function () { return null; });

    // fundo
    c.fillStyle = '#EEF2EE'; c.fillRect(0, 0, W, H);

    // cabeçalho
    var gr = c.createLinearGradient(0, 0, W, L.cab.h);
    gr.addColorStop(0, '#0E4D45'); gr.addColorStop(0.42, '#0C5A50'); gr.addColorStop(1, '#103632');
    c.fillStyle = gr; c.fillRect(0, 0, W, L.cab.h);
    if (soja) { var sh = L.cab.h * 1.7, sw = soja.width / soja.height * sh; c.drawImage(soja, W - sw + 40 * k, (L.cab.h - sh) / 2, sw, sh); }
    var eyebrow = ((pl ? 'PLANTIO' : 'COLHEITA') + ' · ' + nomeSafra(m.s).toUpperCase());
    if (c.letterSpacing !== undefined) c.letterSpacing = (3 * k) + 'px';
    escrever(c, eyebrow, M, 70 * k, 24 * k, 700, '#F0B24A', W * 0.55);
    if (c.letterSpacing !== undefined) c.letterSpacing = '0px';
    escrever(c, todas ? 'Todas as fazendas' : titulo(estado.u), M, 140 * k, 64 * k, 700, '#FFFFFF', W * 0.58);
    escrever(c, fmtPct(m.pct, 1), W - M, 132 * k, 100 * k, 700, '#FFFFFF', W * 0.36, 'right');
    escrever(c, (pl ? 'plantado' : 'colhido') + ' · ' + fmtN(m.exec) + ' de ' + fmtN(m.areaTotal) + ' ha', W - M, 174 * k, 24 * k, 500, '#D7E8E2', W * 0.4, 'right');
    var partes = [];
    if (m.ini) partes.push('início ' + fmtData(m.ini, true));
    if (m.ult) partes.push('último apontamento ' + fmtData(m.ult, true));
    escrever(c, partes.join('  ·  '), M, 186 * k, 24 * k, 500, '#D7E8E2', W * 0.55);
    var by = L.cab.h - 38 * k, bw = W - 2 * M, bh = 12 * k;
    rr(c, M, by, bw, bh, bh / 2); c.fillStyle = 'rgba(255,255,255,.18)'; c.fill();
    if (m.pct > 0) { var gb = c.createLinearGradient(M, 0, M + bw, 0); gb.addColorStop(0, '#F0B24A'); gb.addColorStop(1, '#DB8A08'); rr(c, M, by, Math.max(bh, bw * m.pct), bh, bh / 2); c.fillStyle = gb; c.fill(); }

    // indicadores
    var ks = kpisTexto(m), cols = L.kpis.cols, linhas = Math.ceil(ks.length / cols), g = 18 * k;
    var tw = (L.kpis.w - g * (cols - 1)) / cols, th = (L.kpis.h - g * (linhas - 1)) / linhas;
    ks.forEach(function (x, i) {
      var r = { x: L.kpis.x + (i % cols) * (tw + g), y: L.kpis.y + Math.floor(i / cols) * (th + g), w: tw, h: th };
      cartao(c, r, k);
      var pad = 22 * k, esc2 = Math.min(1, th / (150 * k));
      if (c.letterSpacing !== undefined) c.letterSpacing = (1.5 * k) + 'px';
      escrever(c, x.rot.toUpperCase(), r.x + pad, r.y + pad + 18 * k * esc2, 18 * k * esc2, 600, COR.fraco, tw - 2 * pad);
      if (c.letterSpacing !== undefined) c.letterSpacing = '0px';
      var vy = r.y + th / 2 + 20 * k * esc2;
      c.font = fonteCv(22 * k * esc2, 600);
      var larguraUn = x.un ? c.measureText(x.un).width + 10 * k : 0;
      var usado = escrever(c, x.val, r.x + pad, vy, 50 * k * esc2, 700, COR.texto, tw - 2 * pad - larguraUn);
      if (x.un) escrever(c, x.un, r.x + pad + usado + 8 * k, vy, 22 * k * esc2, 600, COR.suave, 110 * k);
      escrever(c, x.sub, r.x + pad, r.y + th - pad, 19 * k * esc2, x.cor === COR.suave ? 500 : 650, x.cor, tw - 2 * pad);
    });

    // mapa (ou quadro das fazendas)
    var rm = L.mapa; cartao(c, rm, k);
    escrever(c, todas ? 'Fazendas' : 'Mapa de evolução', rm.x + 24 * k, rm.y + 46 * k, 26 * k, 700, COR.escuro, rm.w * 0.45);
    var dentro = { x: rm.x + 18 * k, y: rm.y + 66 * k, w: rm.w - 36 * k, h: rm.h - 84 * k };
    var itensLeg = [3, 2, 1, 0].map(function (i) { return { nome: rotulosClasse(m.o)[i], cor: COR.s[i], borda: i === 0 }; });
    c.font = fonteCv(26 * k, 700);
    var legEmBaixo = !todas && c.measureText('Mapa de evolução').width + larguraLegenda(c, itensLeg, k) + 70 * k > rm.w;
    if (legEmBaixo) { dentro.y += 42 * k; dentro.h -= 42 * k; }
    if (todas) {
      var lista = m.unidades.map(function (u) { return { u: u, x: calcula([u], m.s, m.o) }; }).sort(function (a, b) { return b.x.pct - a.x.pct; });
      // uma ou duas colunas, para a letra ficar grande
      var colsF = dentro.w > 900 * k && lista.length > 4 ? 2 : 1, linhasF = Math.ceil(lista.length / colsF);
      var cw = (dentro.w - (colsF - 1) * 36 * k) / colsF, lh = dentro.h / Math.max(1, linhasF);
      var fs = Math.min(1.15, lh / (112 * k));
      lista.forEach(function (f, i) {
        var col = Math.floor(i / linhasF), lin = i % linhasF;
        var x0 = dentro.x + col * (cw + 36 * k) + 8 * k, y = dentro.y + lin * lh + (lh - 104 * k * fs) / 2, x = f.x, wb = cw - 16 * k;
        escrever(c, titulo(f.u), x0, y + 32 * k * fs, 28 * k * fs, 700, COR.texto, wb * 0.6);
        escrever(c, fmtPct(x.pct), x0 + wb, y + 34 * k * fs, 34 * k * fs, 700, COR.teal, 170 * k, 'right');
        var yb = y + 50 * k * fs;
        rr(c, x0, yb, wb, 12 * k * fs, 6 * k * fs); c.fillStyle = COR.s[0]; c.fill();
        if (x.pct > 0) { rr(c, x0, yb, Math.max(12 * k * fs, wb * x.pct), 12 * k * fs, 6 * k * fs); c.fillStyle = COR.teal; c.fill(); }
        var info = fmtN(x.exec) + ' de ' + fmtN(x.areaTotal) + ' ha  ·  ' + (x.media7 ? fmtN(x.media7) + ' ha/dia' : 'sem ritmo') + (x.previsao ? '  ·  previsão ' + fmtData(x.previsao, true) : '');
        escrever(c, info, x0, yb + 42 * k * fs, 21 * k * fs, 500, COR.suave, wb);
      });
    } else {
      if (legEmBaixo) {
        var kl = k * Math.min(1, (rm.w - 48 * k) / larguraLegenda(c, itensLeg, k));
        legendaCanvas(c, itensLeg, rm.x + 24 * k + larguraLegenda(c, itensLeg, kl), rm.y + 88 * k, kl);
      }
      else legendaCanvas(c, itensLeg, rm.x + rm.w - 24 * k, rm.y + 44 * k, k);
      if (comp) {
        var img = await imagemGrafico(dentro.w, dentro.h, function (el) {
          return desenharMapaFazenda(el, estado.u, m, comp, { semZoom: true, rotulos: true, fonte: 12 * k, fonteTitulo: 18 * k });
        });
        if (img) c.drawImage(img, dentro.x, dentro.y);
      } else {
        escrever(c, 'Limites dos talhões indisponíveis', dentro.x + dentro.w / 2, dentro.y + dentro.h / 2, 24 * k, 500, COR.fraco, dentro.w, 'center');
      }
    }

    // gráfico diário
    if (L.graf) {
      var rg = L.graf; cartao(c, rg, k);
      escrever(c, 'Realizado × meta por dia', rg.x + 24 * k, rg.y + 46 * k, 26 * k, 700, COR.escuro, rg.w * 0.55);
      legendaCanvas(c, [{ nome: 'Realizado', cor: COR.teal }, { nome: 'Meta', cor: COR.dourado, linha: true }], rg.x + rg.w - 24 * k, rg.y + 44 * k, k);
      var dg = { x: rg.x + 14 * k, y: rg.y + 62 * k, w: rg.w - 28 * k, h: rg.h - 74 * k };
      if (m.serie.length) {
        var ig = await imagemGrafico(dg.w, dg.h, function (el) { var ch = echarts.init(el, null, { renderer: 'canvas' }); charts[el.id] = ch; ch.setOption(opcoesMeta(m, 1.7 * k, 21)); return ch; });
        if (ig) c.drawImage(ig, dg.x, dg.y);
      } else escrever(c, 'Ainda não há apontamentos nesta safra.', dg.x + dg.w / 2, dg.y + dg.h / 2, 22 * k, 500, COR.fraco, dg.w, 'center');
    }

    // rodapé
    var ry = L.rod.y + L.rod.h / 2 + 8 * k, xl = M;
    if (logo) { var lh2 = 34 * k, lw = logo.width / logo.height * lh2; c.drawImage(logo, M, ry - lh2 + 6 * k, lw, lh2); xl = M + lw + 20 * k; }
    var gerado = DADOS.geradoEm ? new Date(DADOS.geradoEm) : null;
    escrever(c, 'Acompanhamento Operacional · COA' + (gerado ? '  ·  PIMS de ' + gerado.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''),
      xl, ry, 19 * k, 500, COR.suave, W - xl - M - 260 * k);
    escrever(c, 'gerado em ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), W - M, ry, 17 * k, 500, COR.fraco, 260 * k, 'right');

    return new Promise(function (ok) { cv.toBlob(ok, 'image/png'); });
  }

  function nomeArquivo() {
    var s = function (t) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    return ['acompanhamento', s(estado.o), s(estado.s), s(estado.u === TODAS ? 'todas' : estado.u), paraIso(hoje())].join('-') + '.png';
  }

  async function atualizarPrevia() {
    var n = ++exp.gerando;
    set('exp-status', 'Gerando a imagem…');
    $('exp-baixar').disabled = true; $('exp-compartilhar').disabled = true;
    try {
      var blob = await gerarPng(exp.formato);
      if (n !== exp.gerando) return;
      if (exp.url) URL.revokeObjectURL(exp.url);
      exp.blob = blob; exp.url = URL.createObjectURL(blob); exp.arquivo = nomeArquivo();
      $('exp-previa').src = exp.url;
      var f = FORMATOS[exp.formato];
      set('exp-status', f.w + ' × ' + f.h + ' px · ' + Math.round(blob.size / 1024) + ' KB');
      $('exp-baixar').disabled = false; $('exp-compartilhar').disabled = false;
      var arq = new File([blob], exp.arquivo, { type: 'image/png' });
      $('exp-compartilhar').hidden = !(navigator.canShare && navigator.canShare({ files: [arq] }));
    } catch (e) {
      if (n === exp.gerando) set('exp-status', 'Não foi possível gerar a imagem: ' + (e && e.message ? e.message : e));
    }
  }

  function abrirExportar() {
    if (!DADOS) return;
    if (estado.vista !== 'painel') { estado.vista = 'painel'; render(); }
    document.querySelectorAll('#dlg-exportar input[name="fmt"]').forEach(function (r) { r.checked = r.value === exp.formato; });
    $('dlg-exportar').showModal();
    atualizarPrevia();
  }
  function baixarPng() {
    if (!exp.blob) return;
    var a = document.createElement('a'); a.href = exp.url; a.download = exp.arquivo;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function compartilharPng() {
    if (!exp.blob) return;
    try {
      await navigator.share({ files: [new File([exp.blob], exp.arquivo, { type: 'image/png' })], title: 'Acompanhamento Operacional' });
    } catch (e) { if (e && e.name !== 'AbortError') set('exp-status', 'Não foi possível compartilhar: ' + e.message); }
  }

  // ===========================================================================
  // Navegação e montagem
  // ===========================================================================
  function mostrarAviso(t, erro) {
    var el = $('aviso');
    el.hidden = !t; el.textContent = t || ''; el.className = 'aviso' + (erro ? ' erro' : '');
  }

  function desenharTopo() {
    var us = unidadesDaSafra(estado.s);
    $('abas').innerHTML = [TODAS].concat(us).map(function (u) {
      var x = calcula(u === TODAS ? us : [u], estado.s, estado.o);
      return '<button role="tab" aria-selected="' + (u === estado.u) + '" data-u="' + esc(u) + '">' + esc(u === TODAS ? 'Todas' : titulo(u)) + '<span class="pct">' + fmtPct(x.pct) + '</span></button>';
    }).join('');
    opcoes($('sel-safra'), DADOS.safras, estado.s, nomeSafra);
    $('sel-op').value = estado.o;
    set('marca-sub', (estado.o === 'PLANTIO' ? 'Plantio' : 'Colheita') + ' · ' + nomeSafra(estado.s));
    document.querySelectorAll('.alternador button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.vista === estado.vista)); });
    var g = DADOS.geradoEm ? new Date(DADOS.geradoEm) : null;
    $('atualizado').innerHTML = g ? 'PIMS · <b>' + g.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</b>' : 'sem dados do PIMS';
  }

  function render() {
    if (!DADOS) return;
    var us = unidadesDaSafra(estado.s);
    if (DADOS.safras.indexOf(estado.s) < 0) estado.s = DADOS.safras.indexOf('SOJA 26/27') >= 0 ? 'SOJA 26/27' : DADOS.safras[0];
    us = unidadesDaSafra(estado.s);
    if (estado.u !== TODAS && us.indexOf(estado.u) < 0) estado.u = TODAS;
    desenharTopo();
    $('painel').hidden = estado.vista !== 'painel';
    $('metas').hidden = estado.vista !== 'metas';
    if (estado.vista === 'painel') renderPainel();
    else { mostrarAviso(''); carregarForm(estado.u === TODAS ? us[0] : estado.u, estado.s, estado.o); }
    var hash = '#' + [estado.vista, estado.u, estado.s, estado.o].map(encodeURIComponent).join('/');
    if (location.hash !== hash) history.replaceState(null, '', hash);
    avisarPai();
  }

  function avisarPai() {
    if (!EMBED || window.parent === window) return;
    try { window.parent.postMessage({ tipo: 'acomp-rota', vista: estado.vista }, location.origin); } catch (e) { /* sem pai */ }
  }

  async function carregarDados() {
    var r = await Promise.all([fonte.dados(), fonte.planos()]);
    DADOS = r[0]; PLANOS = r[1];
    if (!DADOS.safras || !DADOS.safras.length) throw new Error('Ainda não há dados do PIMS no banco. A rotina do servidor grava a cada hora; você também pode clicar em Atualizar.');
  }

  async function carregarMapas() {
    if (MAPAS || mapasCarregando) return;
    mapasCarregando = true;
    try { MAPAS = await fonte.mapas(); } catch (e) { MAPAS = {}; console.warn('Acompanhamento: mapas', e); }
    mapasCarregando = false;
    if (estado.vista === 'painel' && mUltimo) { renderMapa(mUltimo); }
    if (tv.ativo) tvDesenhar();
  }

  async function atualizarAgora() {
    var b = $('btn-sync');
    if (b.disabled) return;
    b.disabled = true; b.classList.add('girando');
    mostrarAviso('Buscando os dados no PIMS…');
    try {
      await fonte.atualizar(function (s) { mostrarAviso('Buscando os dados no PIMS… (' + s + ' s)'); });
      await carregarDados();
      render();
      mostrarAviso('');
    } catch (e) { mostrarAviso(e.message, true); }
    finally { b.disabled = false; b.classList.remove('girando'); }
  }

  // ---- eventos ----
  $('abas').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; fecharAmpliado(true); estado.u = b.dataset.u; estado.vista = 'painel'; render(); window.scrollTo({ top: 0 }); });
  $('sel-safra').addEventListener('change', function () { estado.s = this.value; render(); });
  $('sel-op').addEventListener('change', function () { estado.o = this.value; render(); });
  document.querySelectorAll('.alternador button').forEach(function (b) { b.addEventListener('click', function () { estado.vista = b.dataset.vista; render(); }); });
  $('btn-sync').addEventListener('click', atualizarAgora);
  $('g-mapa').addEventListener('click', function (e) { var b = e.target.closest('.fazenda'); if (!b) return; estado.u = b.dataset.u; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  var fundoModal = null;
  function ampliar() {
    var c = $('c-mapa'), abrir = !c.classList.contains('ampliado');
    if (!abrir) return fecharAmpliado();
    fundoModal = document.createElement('div'); fundoModal.className = 'fundo-modal'; fundoModal.addEventListener('click', function () { fecharAmpliado(); });
    document.body.appendChild(fundoModal);
    c.classList.add('ampliado');
    $('btn-ampliar').textContent = 'Fechar'; $('btn-ampliar').setAttribute('aria-pressed', 'true');
    if (mUltimo) renderMapa(mUltimo);
  }
  function fecharAmpliado(semRedesenhar) {
    var c = $('c-mapa');
    if (!c.classList.contains('ampliado')) return;
    c.classList.remove('ampliado');
    if (fundoModal) { fundoModal.remove(); fundoModal = null; }
    $('btn-ampliar').textContent = 'Ampliar'; $('btn-ampliar').setAttribute('aria-pressed', 'false');
    if (!semRedesenhar && mUltimo) renderMapa(mUltimo);
  }
  $('btn-ampliar').addEventListener('click', ampliar);
  document.addEventListener('keydown', function (e) {
    if (tv.ativo) {
      if (e.key === 'Escape' && !document.fullscreenElement) sairTv();
      else if (e.key === 'ArrowRight' && tv.lista.length) { tv.i = (tv.i + 1) % tv.lista.length; tvMostrar(); }
      else if (e.key === 'ArrowLeft' && tv.lista.length) { tv.i = (tv.i - 1 + tv.lista.length) % tv.lista.length; tvMostrar(); }
      else if (e.key === ' ') { e.preventDefault(); tv.pausado = !tv.pausado; tvAgendar(); }
      tvMostrarControles();
      return;
    }
    if (e.key === 'Escape') fecharAmpliado();
  });

  // exportar e modo TV
  $('btn-exportar').addEventListener('click', abrirExportar);
  $('btn-tv').addEventListener('click', abrirTv);
  document.querySelectorAll('#dlg-exportar input[name="fmt"]').forEach(function (r) {
    r.addEventListener('change', function () { exp.formato = this.value; ls('formatoPng', this.value); atualizarPrevia(); });
  });
  $('exp-baixar').addEventListener('click', baixarPng);
  $('exp-compartilhar').addEventListener('click', compartilharPng);
  $('exp-fechar').addEventListener('click', function () { $('dlg-exportar').close(); });
  $('tv-sair').addEventListener('click', sairTv);
  $('tv-pausa').addEventListener('click', function () { tv.pausado = !tv.pausado; tvAgendar(); });
  $('tv-cheia').addEventListener('click', telaCheia);
  $('tv-paginas').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; tv.i = +b.dataset.i; tvMostrar(); });
  $('tv').addEventListener('mousemove', tvMostrarControles);
  document.addEventListener('fullscreenchange', function () { $('tv-cheia').hidden = !!document.fullscreenElement; if (tv.ativo) setTimeout(tvDesenhar, 200); });
  document.addEventListener('visibilitychange', function () { if (tv.ativo && !document.hidden) manterTelaLigada(); });

  ['m-unidade', 'm-safra', 'm-op'].forEach(function (id) {
    $(id).addEventListener('change', function () { var f = formAtual(); estado.u = f.u; estado.s = f.s; estado.o = f.o; desenharTopo(); carregarForm(f.u, f.s, f.o); });
  });
  $('m-periodos').addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr || !e.target.dataset.k) return;
    form.periodos[+tr.dataset.i][e.target.dataset.k] = e.target.value;
    atualizarResumo();
  });
  $('m-periodos').addEventListener('click', function (e) {
    if (!e.target.classList.contains('remover')) return;
    form.periodos.splice(+e.target.closest('tr').dataset.i, 1);
    desenharPeriodos();
  });
  $('m-add').addEventListener('click', function () {
    var u = form.periodos[form.periodos.length - 1];
    var ini = u && u.fim ? paraIso(new Date(+iso(u.fim) + DIA)) : paraIso(hoje());
    form.periodos.push({ inicio: ini, fim: paraIso(new Date(+iso(ini) + 6 * DIA)), meta: u ? u.meta : '' });
    desenharPeriodos();
  });
  $('m-sugerir').addEventListener('click', function () {
    var r = sugerirTermino();
    if (r.data) $('m-termino').value = paraIso(r.data);
    set('m-sugestao', r.texto);
    atualizarResumo();
  });
  $('m-termino').addEventListener('change', atualizarResumo);
  $('form-meta').addEventListener('submit', salvar);
  $('m-excluir').addEventListener('click', excluir);
  $('m-ver').addEventListener('click', function () { var f = formAtual(); estado.u = f.u; estado.s = f.s; estado.o = f.o; estado.vista = 'painel'; render(); });
  function abrirPlano(tr) { estado.u = tr.dataset.u; estado.s = tr.dataset.s; estado.o = tr.dataset.o; desenharTopo(); carregarForm(estado.u, estado.s, estado.o); }
  $('lista-planos').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-u]'); if (tr) abrirPlano(tr); });
  $('lista-planos').addEventListener('keydown', function (e) { var tr = e.target.closest('tr[data-u]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirPlano(tr); } });

  var tRes = null;
  window.addEventListener('resize', function () {
    clearTimeout(tRes);
    tRes = setTimeout(function () {
      if (tv.ativo) return tvDesenhar();
      if (estado.vista === 'painel' && mUltimo) renderMapa(mUltimo);
      Object.keys(charts).forEach(function (k) { charts[k].resize(); });
    }, 150);
  });

  // fazenda escolhida no topo do COA WEB → abre a fazenda correspondente (guardada até os dados chegarem)
  var coaFazenda;
  function aplicarFazendaCoa() {
    if (coaFazenda === undefined || !DADOS) return;
    var u = fonte.unidadeDaFazendaCoa(coaFazenda);
    var alvo = u && unidadesDaSafra(estado.s).indexOf(u) >= 0 ? u : TODAS;
    if (alvo !== estado.u) { estado.u = alvo; render(); }
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.tipo === 'coa-fazenda') { coaFazenda = typeof d.id === 'number' ? d.id : null; aplicarFazendaCoa(); }
    if (d.tipo === 'acomp-vista' && (d.vista === 'painel' || d.vista === 'metas') && d.vista !== estado.vista) { estado.vista = d.vista; render(); }
  });

  // ---- início ----
  if (EMBED) document.documentElement.classList.add('embed');
  if (!window.echarts) { set('carregando-texto', 'Não foi possível carregar a biblioteca de gráficos. Verifique a conexão com a internet.'); return; }
  var h0 = location.hash.slice(1).split('/').map(decodeURIComponent);
  if (h0[0] === 'painel' || h0[0] === 'metas') { estado.vista = h0[0]; estado.u = h0[1] || TODAS; estado.s = h0[2] || null; estado.o = h0[3] === 'COLHEITA' ? 'COLHEITA' : 'PLANTIO'; }

  (async function iniciar() {
    try {
      await fonte.prontoParaUsar();
      await carregarDados();
      if (!estado.s) estado.s = DADOS.safras.indexOf('SOJA 26/27') >= 0 ? 'SOJA 26/27' : DADOS.safras[0];
      $('carregando').classList.add('fora');
      render();
      aplicarFazendaCoa();
      carregarMapas();
      setInterval(function () {
        if (tv.ativo) { carregarDados().then(function () { tvMontarLista(); }).catch(function () { /* tenta de novo no próximo ciclo */ }); return; }
        if (estado.vista !== 'painel' || document.hidden) return;
        carregarDados().then(render).catch(function (e) { mostrarAviso(e.message, true); });
      }, RECARREGAR_MIN * 60000);
      if (PARAMS.get('tv') === '1') entrarTv();
    } catch (e) {
      $('carregando').querySelector('.spinner').hidden = true;
      set('carregando-texto', erroLegivel(e));
    }
  })();
})();
