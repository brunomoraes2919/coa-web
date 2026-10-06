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
  // safras anteriores no gráfico diário: tons claros, sem destaque (1 ano antes, 2 anos antes)
  var COR_COMPARATIVO = ['#7FB5A7', '#B3C2BC'];
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
    return t.replace(/\bSm3\b/, 'SM3').replace(/\bTres\b/, 'Três').replace(/\bSao\b/, 'São');
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
      unidadeDaFazendaCoa: function () { return null; },
      fazendaCoaDaUnidade: function () { return null; }
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
        var talhoes = [], apontamentos = [], historico = [], chuva = [], safras = {}, gerado = null;
        linhas.forEach(function (l) {
          if (!gerado || l.gerado_em > gerado) gerado = l.gerado_em;
          // chuva diária da fazenda (ZEUS), para a aba "Safras"
          if (l.safra === 'CHUVA') { (l.apontamentos || []).forEach(function (a) { chuva.push({ u: l.unidade, d: a.d, a: a.a }); }); return; }
          // linha sem talhão = safra anterior (só o total por dia, para o comparativo do gráfico diário)
          if (!(l.talhoes || []).length) {
            (l.apontamentos || []).forEach(function (a) { historico.push({ u: l.unidade, s: l.safra, op: a.op, d: a.d, a: a.a }); });
            return;
          }
          safras[l.safra] = true;
          l.talhoes.forEach(function (t) { talhoes.push(Object.assign({ u: l.unidade, s: l.safra }, t)); });
          (l.apontamentos || []).forEach(function (a) { apontamentos.push(Object.assign({ u: l.unidade, s: l.safra }, a)); });
        });
        return { geradoEm: gerado, safras: Object.keys(safras).sort(), talhoes: talhoes, apontamentos: apontamentos, historico: historico, chuva: chuva };
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
      unidadeDaFazendaCoa: function (id) { return id === null || id === undefined ? null : (fazendasCoa[id] || null); },
      /** Unidade do PIMS → id da fazenda no COA WEB (para o menu lateral acompanhar a aba escolhida aqui). */
      fazendaCoaDaUnidade: function (u) { var ids = Object.keys(fazendasCoa).filter(function (k) { return fazendasCoa[k] === u; }); return ids.length ? Number(ids[0]) : null; }
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

  // ---- comparativo com as duas safras anteriores (mesma regra de scripts/sincronizar-plantio.mjs) ----
  /** Cultura de um nome de safra, sem o ano ('MILHO SAFRINHA 23/24' e 'MILHO 2ª SAFRA 24/25' → 'MILHO 2 SAFRA'). */
  function culturaDaSafra(nome) {
    var s = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim().replace(/\s*\d{2}\/\d{2}$/, '');
    s = s.replace(/(\d)\s*[ªº°]/g, '$1').replace(/\bSAFRINHA\b/g, '2 SAFRA').replace(/^MILHO\s+SILAGEM\b/, 'SILAGEM');
    if (/\bSAFRA\b/.test(s) && !/\d\s+SAFRA\b/.test(s)) s = s.replace(/\bSAFRA\b/, '1 SAFRA');
    return s.replace(/\s+/g, ' ').trim();
  }
  function anoDaSafra(nome) { var m = /(\d{2})\/\d{2}\s*$/.exec(String(nome || '')); return m ? +m[1] : null; }
  /** Safras de 1 e 2 anos antes, da mesma cultura, que têm dados no comparativo (mais recente primeiro). */
  function safrasAnteriores(s) {
    var c = culturaDaSafra(s), ano = anoDaSafra(s), vistas = {};
    (DADOS.historico || []).forEach(function (h) { vistas[h.s] = true; });
    return Object.keys(vistas).map(function (n) { return { nome: n, anos: ano - anoDaSafra(n) }; })
      .filter(function (x) { return (x.anos === 1 || x.anos === 2) && culturaDaSafra(x.nome) === c; })
      .sort(function (a, b) { return a.anos - b.anos || (a.nome < b.nome ? -1 : 1); });
  }
  /** Mesmo dia e mês, `anos` antes (29/02 vira 28/02). */
  function anosAntes(d, anos) {
    var r = new Date(d.getFullYear() - anos, d.getMonth(), d.getDate());
    if (r.getMonth() !== d.getMonth()) r = new Date(d.getFullYear() - anos, d.getMonth() + 1, 0);
    return r;
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

    // safras anteriores no mesmo período (mesmos dias do ano), só para comparar no gráfico diário
    m.comparativos = safrasAnteriores(s).map(function (c) {
      var pd = {}, tem = false;
      (DADOS.historico || []).forEach(function (h) { if (h.s === c.nome && h.op === o && U[h.u]) { pd[h.d] = (pd[h.d] || 0) + h.a; tem = true; } });
      if (!tem) return null;
      var dias = Object.keys(pd).sort(), acc = [], tot = 0;
      dias.forEach(function (x) { tot += pd[x]; acc.push(tot); });
      return { nome: c.nome, anos: c.anos, porDia: pd,
        /** total da safra anterior do início dela até a data d (inclusive) */
        acumAte: function (d) { var k = paraIso(d), i = -1; for (var j = 0; j < dias.length && dias[j] <= k; j++) i = j; return i < 0 ? 0 : acc[i]; } };
    }).filter(Boolean);
    m.serie = [];
    if (m.ini) for (var t = +m.ini; t <= +m.ult; t += DIA) {
      var d = new Date(t); d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      m.serie.push({ d: d, a: porDia[paraIso(d)] || 0, meta: m.metaDia(d),
        comp: m.comparativos.map(function (c) { return Math.round(c.porDia[paraIso(anosAntes(d, c.anos))] || 0); }) });
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
    m.talhoes.forEach(function (t) {
      // "A DEFINIR" é só o marcador do PIMS para variedade ainda não informada: não entra na lista
      if (!t.variedade || /^A\s*DEFINIR$/i.test(String(t.variedade).trim())) return;
      var v = vr[t.variedade] = vr[t.variedade] || { v: t.variedade, prev: 0, exec: 0 }; v.prev += t.base; v.exec += t.efetivo;
    });
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

  /**
   * Nome de um quadro do mapa pelos setores (PIMS) dos talhões dele: 'SAO MIGUEL I' e 'SAO MIGUEL II' viram
   * 'São Miguel'; com setores diferentes, vale o que tem mais talhões no quadro (ex.: Siriema).
   */
  function nomeDoGrupo(fs) {
    var cont = {};
    fs.forEach(function (f) {
      var st = f.properties.setor; if (!st) return;
      var base = String(st).trim().toUpperCase().replace(/\s+(I{1,3}|IV|V|VI{0,3}|\d+)$/, '');
      cont[base] = (cont[base] || 0) + 1;
    });
    var ks = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; });
    return ks.length ? titulo(ks[0]) : null;
  }

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
        return { fs: g.fs, bbox: g.bbox, fr: fr[i], titulo: nomeDoGrupo(g.fs) || 'Bloco ' + (i + 1) };
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
  function dadosMapa(mp, faz, topo) {
    return mp.features.map(function (f) {
      var x = mp.porId[f.properties.name], cor = corClasse(x ? x.k : -1);
      // com o mapa base, o talhão fica levemente translúcido (o relevo aparece por baixo)
      var op = !topo ? 1 : !x ? 0.55 : x.k === 0 ? 0.82 : 0.93;
      return { name: f.properties.name, talhao: f.properties.talhao, x: x, faz: faz, itemStyle: { areaColor: cor, opacity: op }, emphasis: { itemStyle: { areaColor: cor, opacity: 1 } } };
    });
  }
  var registrados = {};
  function registrar(nome, fs) {
    if (!registrados[nome]) { echarts.registerMap(nome, { type: 'FeatureCollection', features: fs }); registrados[nome] = true; }
    return nome;
  }
  /** layoutSize que faz o mapa (aspecto a = largura/altura) caber no quadro fw × fh. */
  function tamanhoQueCabe(a, fw, fh) { return (a >= 1 ? Math.min(fw, fh * a) : Math.min(fh, fw / a)) * 0.94; }

  // ---- mapa base Esri Topo atrás dos talhões (o "Topográfico claro" do Mapa de Chuva) ----
  // Os tiles viram imagens do próprio gráfico, posicionadas pela projeção do mapa; o Esri responde
  // com Access-Control-Allow-Origin: *, então a imagem exportada continua podendo ser gerada.
  var TOPO = {
    url: function (z, x, y) { return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/' + z + '/' + y + '/' + x; },
    maxZoom: 17, clarear: 0.35, maxTiles: 160, atribuicao: 'Mapa base: Esri, HERE, Garmin, © OpenStreetMap'
  };
  var R_TERRA = 6378137, ORIGEM = Math.PI * R_TERRA, cacheTiles = {};
  function lonLat(mx, my) { return [mx / R_TERRA * 180 / Math.PI, (2 * Math.atan(Math.exp(my / R_TERRA)) - Math.PI / 2) * 180 / Math.PI]; }
  function tile(z, x, y, aoCarregar) {
    var k = z + '/' + x + '/' + y, t = cacheTiles[k];
    if (!t) {
      t = cacheTiles[k] = { img: new Image(), ok: false, erro: false, espera: [] };
      t.img.crossOrigin = 'anonymous';
      var fim = function (ok) { t.ok = ok; t.erro = !ok; t.espera.splice(0).forEach(function (f) { f(); }); };
      t.img.onload = function () { fim(true); };
      t.img.onerror = function () { fim(false); };
      t.img.src = TOPO.url(z, x, y);
    }
    if (!t.ok && !t.erro && aoCarregar) t.espera.push(aoCarregar);
    return t;
  }
  function agendarTopo(g) {
    var st = g && g.__topo;
    if (!st || st.agendado) return;
    st.agendado = true;
    requestAnimationFrame(function () { st.agendado = false; atualizarTopo(g); });
  }
  function atualizarTopo(g) {
    var st = g.__topo;
    if (!st || g.isDisposed()) return;
    var filhos = [], pend = 0, pr = st.pr || window.devicePixelRatio || 1;
    var GW = g.getWidth(), GH = g.getHeight();
    st.quadros.forEach(function (qq) {
      var q = { i: qq.i, x: 0, y: qq.fy * GH, w: GW, h: qq.fh * GH };
      var p0 = g.convertFromPixel({ seriesIndex: q.i }, [q.x, q.y]), p1 = g.convertFromPixel({ seriesIndex: q.i }, [q.x + q.w, q.y + q.h]);
      if (!p0 || !p1) return;
      if (!(q.w > 0 && q.h > 0) || !isFinite(p0[0] + p0[1] + p1[0] + p1[1])) return;
      var a = merc(p0[0], p0[1]), b = merc(p1[0], p1[1]);
      var minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]), minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
      var z = Math.max(3, Math.min(TOPO.maxZoom, Math.round(Math.log(156543.034 * q.w * pr / Math.max(1, maxX - minX)) / Math.LN2))), tam, x0, x1, y0, y1;
      if (!isFinite(z)) return;
      for (;;) {
        tam = 2 * ORIGEM / Math.pow(2, z);
        x0 = Math.floor((minX + ORIGEM) / tam); x1 = Math.floor((maxX + ORIGEM) / tam);
        y0 = Math.floor((ORIGEM - maxY) / tam); y1 = Math.floor((ORIGEM - minY) / tam);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) <= TOPO.maxTiles || z <= 3) break;
        z--;
      }
      // os tiles do quadro são montados num canvas do tamanho do quadro (o recorte fica na borda dele)
      var cv = document.createElement('canvas'), k = Math.max(1, pr);
      cv.width = Math.max(1, Math.round(q.w * k)); cv.height = Math.max(1, Math.round(q.h * k));
      var cx = cv.getContext('2d');
      cx.setTransform(k, 0, 0, k, -q.x * k, -q.y * k);
      for (var tx = x0; tx <= x1; tx++) for (var ty = y0; ty <= y1; ty++) {
        var t = tile(z, tx, ty, function () { agendarTopo(g); });
        if (!t.ok) { if (!t.erro) pend++; continue; }
        var bx0 = tx * tam - ORIGEM, by1 = ORIGEM - ty * tam;
        var c0 = g.convertToPixel({ seriesIndex: q.i }, lonLat(bx0, by1)), c1 = g.convertToPixel({ seriesIndex: q.i }, lonLat(bx0 + tam, by1 - tam));
        // meio pixel a mais em cada lado: sem frestas entre os tiles
        cx.drawImage(t.img, c0[0] - 0.25, c0[1] - 0.25, c1[0] - c0[0] + 0.5, c1[1] - c0[1] + 0.5);
      }
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.fillStyle = 'rgba(255,255,255,' + TOPO.clarear + ')'; cx.fillRect(0, 0, cv.width, cv.height);
      filhos.push({ id: 'topo-q' + qq.i, type: 'image', silent: true, z: 1, style: { image: cv, x: q.x, y: q.y, width: q.w, height: q.h } });
    });
    st.pendentes = pend;
    // cada quadro tem o seu elemento (id próprio): a troca não mexe nos títulos nem na fonte do mapa base
    if (filhos.length) g.setOption({ graphic: filhos });
    if (!pend) st.prontos.splice(0).forEach(function (f) { f(); });
  }
  /** Espera os tiles da vista atual (para exportar a imagem já com o mapa base). */
  function aguardarTopo(g, ms) {
    var st = g && g.__topo;
    if (!st || st.pendentes === 0) return Promise.resolve();
    return new Promise(function (ok) { st.prontos.push(ok); setTimeout(ok, ms || 10000); });
  }

  function desenharMapaFazenda(el, u, m, comp, opcoes) {
    opcoes = opcoes || {};
    var comTopo = opcoes.topo !== false && !(opcoes.estatico && !opcoes.rotulos);
    var mp = comp.mp, W = el.clientWidth, H = el.clientHeight, series = [], graphic = [], quadros = [];
    var y = 0, vao = comp.quadros.length > 1 ? 10 : 0, alturaUtil = H - vao * (comp.quadros.length - 1);
    var dados = dadosMapa(mp, opcoes.faz ? u : null, comTopo), porNome = {};
    dados.forEach(function (d) { porNome[d.name] = d; });
    comp.quadros.forEach(function (q, i) {
      var fh = comp.quadros.length > 1 ? alturaUtil * q.fr : H, topo = q.titulo ? Math.round((opcoes.fonteTitulo || 12) * 1.8) : 0;
      var a = (q.bbox[2] - q.bbox[0]) / Math.max(1, q.bbox[3] - q.bbox[1]);
      var nome = registrar(u + '|' + mp.rotulo + '|' + (comp.quadros.length > 1 ? 'q' + i : 'todo'), q.fs);
      var lat = (Math.atan(Math.exp(((q.bbox[1] + q.bbox[3]) / 2) / 6378137)) * 2 - Math.PI / 2);
      quadros.push({ i: i, fy: y / Math.max(1, H), fh: fh / Math.max(1, H) });
      if (q.titulo) graphic.push({ id: 'titulo' + i, type: 'text', z: 100, left: 4, top: y + 2, style: { text: q.titulo, fontSize: opcoes.fonteTitulo || 12, fontWeight: 600, fill: COR.texto, stroke: '#FFFFFF', lineWidth: 3 } });
      series.push({
        type: 'map', map: nome, roam: !opcoes.estatico && !opcoes.semZoom, selectedMode: false, aspectScale: Math.cos(lat),
        layoutCenter: [W / 2, y + topo + (fh - topo) / 2], layoutSize: tamanhoQueCabe(a, W, fh - topo),
        scaleLimit: { min: 0.8, max: 14 },
        itemStyle: { borderColor: '#FFFFFF', borderWidth: opcoes.estatico ? 0.4 : 0.8 },
        emphasis: { label: { show: !opcoes.estatico, color: '#000', fontWeight: 700, textBorderColor: '#FFFFFF', textBorderWidth: 3 }, itemStyle: { borderColor: COR.escuro, borderWidth: 1.4 } },
        // nome do talhão com um pequeno contorno branco (legível sobre qualquer cor e sobre o mapa base)
        label: { show: !opcoes.estatico || !!opcoes.rotulos, fontSize: opcoes.fonte || (opcoes.grande ? 11 : 9), color: COR.texto, textBorderColor: '#FFFFFF',
          textBorderWidth: Math.max(2, (opcoes.fonte || (opcoes.grande ? 11 : 9)) * 0.28), formatter: function (p) { return p.data ? p.data.talhao : ''; } },
        labelLayout: { hideOverlap: true },
        data: q.fs.map(function (f) { return porNome[f.properties.name]; }),
        cursor: opcoes.aoClicar ? 'pointer' : 'default'
      });
      y += fh + vao;
    });
    // a camada do mapa base de cada quadro já nasce na opção; as atualizações a trocam pelo id
    if (comTopo) quadros.forEach(function (q) { graphic.unshift({ id: 'topo-q' + q.i, type: 'image', silent: true, z: 1, style: { x: 0, y: 0, width: 0, height: 0 } }); });
    if (comTopo) graphic.push({ id: 'topo-fonte', type: 'text', z: 100, right: 4, bottom: 3, silent: true,
      style: { text: TOPO.atribuicao, fontSize: opcoes.fonteAtribuicao || 9, fill: COR.suave, backgroundColor: 'rgba(255,255,255,.75)', padding: [1, 4], borderRadius: 3 } });
    var g = chart(el);
    g.setOption(opt({ tooltip: tt({ trigger: 'item', formatter: tooltipTalhao }), graphic: graphic, series: series }), true);
    g.off('click'); g.off('georoam');
    if (opcoes.aoClicar) g.on('click', opcoes.aoClicar);
    g.__topo = comTopo ? { quadros: quadros, pr: opcoes.pixelRatio, prontos: [], pendentes: 1 } : null;
    if (comTopo) { g.on('georoam', function () { agendarTopo(g); }); atualizarTopo(g); }
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

  /** Foto da máquina da operação: trator 8R no plantio; na colheita, a máquina da cultura. */
  function fotoMaquina(m) {
    if (m.o === 'PLANTIO') return { src: 'assets/trator_8r.webp', alt: 'Trator John Deere 8R' };
    var c = cultura(m.s).normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (c === 'MILHO') return { src: 'assets/colheitadeira_milho.webp', alt: 'Colheitadeira com plataforma de milho' };
    if (c === 'ALGODAO') return { src: 'assets/colhedora_algodao.webp', alt: 'Colhedora de algodão' };
    return { src: 'assets/colheitadeira_soja.webp', alt: 'Colheitadeira com plataforma draper' };
  }
  /** Ilustração em traço da cultura no fundo da faixa (soja, milho, sorgo ou algodão). */
  function fundoCultura(s) {
    var c = cultura(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var f = ({ MILHO: 'milho', SILAGEM: 'milho', SORGO: 'sorgo', MILHETO: 'sorgo', ALGODAO: 'algodao' })[c] || 'soja';
    return 'assets/fundo_' + f + '.webp';
  }
  function aplicarFundo(el, s) { el.style.setProperty('--fundo-cultura', 'url("' + fundoCultura(s) + '")'); }
  /** Mostra a foto só depois que ela carrega (sem foto, a faixa fica limpa). */
  function mostrarMaquina(img, m) {
    var f = fotoMaquina(m);
    if (img.dataset.src === f.src) return;
    img.dataset.src = f.src; img.alt = f.alt; img.hidden = true;
    img.onload = function () { img.hidden = false; };
    img.onerror = function () { img.hidden = true; };
    img.src = f.src;
  }

  function renderDestaque(m) {
    var pl = m.o === 'PLANTIO';
    set('d-eyebrow', (pl ? 'Plantio' : 'Colheita') + ' · ' + nomeSafra(m.s));
    set('d-titulo', estado.u === TODAS ? 'Todas as fazendas' : titulo(estado.u));
    set('d-pct', fmtPct(m.pct, 1));
    set('d-pct-rot', (pl ? 'plantado' : 'colhido') + ' · ' + fmtN(m.exec) + ' de ' + fmtN(m.areaTotal) + ' ha');
    $('d-barra').style.width = (m.pct * 100).toFixed(1) + '%';
    var datas = [['Início', m.ini], ['Último apontamento', m.ult], ['Término planejado', m.termino], ['Previsão de término', m.previsao]];
    $('d-datas').innerHTML = datas.map(function (d) { return '<li><span>' + d[0] + '</span><b>' + (d[1] ? fmtData(d[1]) : '—') + '</b></li>'; }).join('');
    mostrarMaquina($('d-maquina'), m);
    aplicarFundo($('destaque'), m.s);
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
    $('variedades').innerHTML = l.length ? '<table class="tabela' + (l.length > 8 ? ' compacta' : '') + '"><thead><tr><th>Variedade</th><th class="n">' + (m.o === 'PLANTIO' ? 'Plantado' : 'Colhido') + '</th></tr></thead><tbody>' +
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
    legenda('leg-meta', itensLegendaMeta(m));
    if (!m.serie.length) return vazio(el, 'Ainda não há apontamentos de ' + m.o.toLowerCase() + ' nesta safra.');
    chart(el).setOption(opcoesMeta(m, 1), true);
  }

  function itensLegendaMeta(m) {
    return [{ nome: 'Realizado', cor: COR.teal }, { nome: 'Meta diária', cor: COR.dourado, tipo: 'tracejada' }]
      .concat((m.comparativos || []).map(function (c, i) { return { nome: nomeSafra(c.nome), cor: COR_COMPARATIVO[i] || COR_COMPARATIVO[1], tipo: 'linha' }; }));
  }
  /** Gráfico "realizado x meta por dia"; `k` multiplica fontes e traços (TV e imagem exportada). */
  function opcoesMeta(m, k, ultimosDias) {
    var serie = ultimosDias ? m.serie.slice(-ultimosDias) : m.serie;
    var temMeta = serie.some(function (x) { return x.meta !== null; });
    var series = [{
      name: 'Realizado', type: 'bar', data: serie.map(function (x) { return Math.round(x.a); }), barMaxWidth: 26 * k, barCategoryGap: '28%',
      itemStyle: { color: COR.teal, borderRadius: [3 * k, 3 * k, 0, 0] },
      label: { show: serie.length <= 45, position: 'top', fontSize: 10.5 * k, color: COR.suave, textBorderColor: '#FFFFFF', textBorderWidth: 4.5 * k, formatter: function (p) { return p.value ? fmtN(p.value) : ''; } },
      labelLayout: { hideOverlap: true }
    }];
    if (temMeta) series.push({ name: 'Meta', type: 'line', step: 'middle', silent: true, data: serie.map(function (x) { return x.meta; }), symbol: 'none', lineStyle: { color: COR.dourado, width: 2 * k, type: [6 * k, 4 * k] }, z: 5 });
    // safras anteriores no mesmo período: linhas finas e claras, só para comparar
    (m.comparativos || []).forEach(function (c, i) {
      series.push({ name: nomeSafra(c.nome), type: 'line', data: serie.map(function (x) { return x.comp ? x.comp[i] : null; }), symbol: 'none', silent: true, z: 4,
        lineStyle: { color: COR_COMPARATIVO[i] || COR_COMPARATIVO[1], width: 1.6 * k }, emphasis: { disabled: true } });
    });
    return opt({
      grid: { left: 4 * k, right: 8 * k, top: 20 * k, bottom: 4 * k, containLabel: true },
      tooltip: tt({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(12,90,80,.05)' } }, formatter: function (ps) {
        var x = serie[ps[0].dataIndex];
        return '<b>' + x.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + '</b><br>Realizado: <b>' + fmtN(x.a) + ' ha</b>' + (x.meta !== null ? '<br>Meta: ' + fmtN(x.meta) + ' ha' : '') +
          (m.comparativos || []).map(function (c, i) { return '<br><span style="color:#8A988F">' + esc(nomeSafra(c.nome)) + ': ' + fmtN(x.comp[i]) + ' ha</span>'; }).join('');
      } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', data: serie.map(function (x) { return x.d.getDate() === 1 || x === serie[0] ? fmtData(x.d, true) : String(x.d.getDate()); }), axisLabel: { color: COR.suave, fontSize: 11 * k, hideOverlap: true }, axisLine: { lineStyle: { color: COR.linha, width: k } } }),
      yAxis: Object.assign({}, eixoY, { type: 'value', axisLabel: { color: COR.fraco, fontSize: 11 * k, formatter: function (v) { return fmtN(v); } }, splitLine: { lineStyle: { color: COR.grade, width: k } } }),
      series: series
    });
  }

  /**
   * TV de "Todas as fazendas": barras deitadas em hectares, uma por fazenda (da mais adiantada para a
   * mais atrasada): a parte feita e o que falta. O comprimento mostra o tamanho de cada fazenda; ao
   * lado, o % e "feito / total".
   */
  var COR_A_FAZER = '#CBD5CE';
  function opcoesAreaFazendas(m, k) {
    // a primeira categoria fica embaixo no eixo: ordem crescente de % para a mais adiantada ficar no topo
    var faz = m.unidades.map(function (u) { return { nome: titulo(u), x: calcula([u], m.s, m.o) }; }).sort(function (a, b) { return a.x.pct - b.x.pct; });
    var pl = m.o === 'PLANTIO';
    return opt({
      grid: { left: 4 * k, right: 152 * k, top: 6 * k, bottom: 4 * k, containLabel: true },
      tooltip: tt({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(12,90,80,.05)' } }, formatter: function (ps) {
        var x = faz[ps[0].dataIndex].x;
        return '<b>' + esc(faz[ps[0].dataIndex].nome) + '</b> · ' + fmtPct(x.pct) + '<br>' + (pl ? 'Plantado' : 'Colhido') + ': <b>' + fmtN(x.exec) + ' ha</b><br>' +
          (pl ? 'A plantar' : 'A colher') + ': ' + fmtN(x.restante) + ' ha<br>Total: ' + fmtN(x.areaTotal) + ' ha';
      } }),
      xAxis: Object.assign({}, eixoY, { type: 'value', axisLabel: { color: COR.fraco, fontSize: 11 * k, formatter: function (v) { return fmtN(v); } }, splitLine: { lineStyle: { color: COR.grade, width: k } } }),
      yAxis: Object.assign({}, eixoX, { type: 'category', data: faz.map(function (f) { return f.nome; }),
        axisLabel: { color: COR.texto, fontSize: 12 * k, fontWeight: 600 }, axisLine: { lineStyle: { color: COR.linha, width: k } } }),
      series: [
        { name: 'Feito', type: 'bar', stack: 'a', barMaxWidth: 28 * k, barCategoryGap: '32%', itemStyle: { color: COR.teal }, data: faz.map(function (f) { return Math.round(f.x.exec); }) },
        { name: 'A fazer', type: 'bar', stack: 'a', itemStyle: { color: COR_A_FAZER, borderRadius: [0, 4 * k, 4 * k, 0] }, data: faz.map(function (f) { return Math.round(f.x.restante); }),
          label: { show: true, position: 'right', distance: 6 * k, fontSize: 12 * k, color: COR.suave,
            formatter: function (p) { var x = faz[p.dataIndex].x; return '{b|' + fmtPct(x.pct) + '}  ' + fmtN(x.exec) + ' / ' + fmtN(x.areaTotal); },
            rich: { b: { fontWeight: 700, fontSize: 13.5 * k, color: COR.texto } } } }
      ]
    });
  }

  function itensLegendaAcum(m) {
    return [{ nome: 'Realizado', cor: COR.teal }, { nome: 'Planejado pelas metas', cor: COR.dourado, tipo: 'tracejada' }, { nome: 'Projeção pelo ritmo', cor: '#9AA79F', tipo: 'tracejada' }]
      .concat((m.comparativos || []).map(function (c, i) { return { nome: nomeSafra(c.nome), cor: COR_COMPARATIVO[i] || COR_COMPARATIVO[1], tipo: 'linha' }; }));
  }
  function renderAcumulado(m) {
    var el = $('g-acum');
    legenda('leg-acum', itensLegendaAcum(m));
    if (!m.serie.length) return vazio(el, 'Ainda não há apontamentos nesta safra.');
    chart(el).setOption(opcoesAcumulado(m, 1), true);
  }

  /**
   * Gráfico "evolução acumulada" (painel, TV e imagem): realizado, planejado pelas metas, projeção pelo
   * ritmo e, em linhas claras, o acumulado das safras anteriores até o mesmo dia do ano.
   */
  function opcoesAcumulado(m, k) {
    k = k || 1;
    var fim = m.ult;
    if (m.previsao && m.previsao > fim) fim = m.previsao;
    if (m.termino && m.termino > fim) fim = m.termino;
    if (dif(m.ini, fim) > 150) fim = new Date(+m.ini + 150 * DIA);
    var cats = [], real = [], plan = [], proj = [], ar = 0, ap = 0, h = hoje();
    var temMeta = m.planos.length > 0;
    for (var t = +m.ini; t <= +fim; t += DIA) {
      var d = new Date(t); d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var dia = paraIso(d);
      ar += m.porDia[dia] || 0;
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
    // safras anteriores: o acumulado delas até o mesmo dia do ano (linhas claras, só para comparar)
    var comps = (m.comparativos || []).map(function (c, i) {
      return { name: nomeSafra(c.nome), type: 'line', symbol: 'none', silent: true, z: 1, emphasis: { disabled: true },
        lineStyle: { color: COR_COMPARATIVO[i] || COR_COMPARATIVO[1], width: 1.8 * k },
        data: cats.map(function (d) { return Math.round(c.acumAte(anosAntes(d, c.anos))); }) };
    });
    return opt({
      grid: { left: 4 * k, right: 12 * k, top: 22 * k, bottom: 4 * k, containLabel: true },
      tooltip: tt({ trigger: 'axis', formatter: function (ps) {
        var s = '<b>' + cats[ps[0].dataIndex].toLocaleDateString('pt-BR') + '</b>';
        ps.forEach(function (p) { if (p.value !== null && p.value !== undefined) s += '<br>' + p.marker + p.seriesName + ': <b>' + fmtN(p.value) + ' ha</b>'; });
        return s;
      } }),
      xAxis: Object.assign({}, eixoX, { type: 'category', boundaryGap: false, data: cats.map(function (d) { return fmtData(d, true); }), axisLabel: { color: COR.suave, fontSize: 11 * k, hideOverlap: true }, axisLine: { lineStyle: { color: COR.linha, width: k } } }),
      yAxis: Object.assign({}, eixoY, { type: 'value', max: function (v) { return Math.max(v.max, m.areaTotal) * 1.04; }, axisLabel: { color: COR.fraco, fontSize: 11 * k, formatter: function (v) { return fmtN(v); } }, splitLine: { lineStyle: { color: COR.grade, width: k } } }),
      series: [
        { name: 'Realizado', type: 'line', data: real, symbol: 'none', z: 3, lineStyle: { color: COR.teal, width: 2.5 * k }, areaStyle: { color: 'rgba(12,90,80,.09)' },
          markLine: { silent: true, symbol: 'none', data: [{ yAxis: m.areaTotal }], lineStyle: { color: '#B9C4BC', type: 'solid', width: k }, label: { formatter: 'Área total ' + fmtN(m.areaTotal) + ' ha', position: 'insideStartTop', color: COR.suave, fontSize: 11 * k } } },
        { name: 'Planejado', type: 'line', data: plan, symbol: 'none', z: 3, lineStyle: { color: COR.dourado, width: 2 * k, type: [6 * k, 4 * k] } },
        { name: 'Projeção', type: 'line', data: proj, symbol: 'none', z: 3, lineStyle: { color: '#9AA79F', width: 2 * k, type: [2 * k, 4 * k] } }
      ].concat(comps)
    });
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
    requestAnimationFrame(function () { Object.keys(charts).forEach(function (k) { if (charts[k] && !charts[k].isDisposed()) { charts[k].resize(); agendarTopo(charts[k]); } }); });
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
    form.periodos.sort(function (a, b) { return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0; });
    // início do 1º período = 1º boletim de plantio apontado no PIMS (travado); sem boletim ainda, fica editável
    var mIni = calcula([u], s, o).ini;
    form.iniTravado = mIni ? paraIso(mIni) : null;
    if (!form.periodos.length) {
      var ini = form.iniTravado || paraIso(hoje());
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

  var DICA_INICIO = 'A data de início do 1º período é a do primeiro boletim de plantio apontado no PIMS para esta fazenda e safra. Ela é preenchida e atualizada automaticamente e não pode ser alterada aqui.';
  var DICA_INICIO_SEM = 'Ainda não há boletim de plantio apontado no PIMS para esta fazenda e safra. Informe o início previsto; quando o primeiro boletim for apontado, esta data passa a ser a dele automaticamente e fica travada.';
  function desenharPeriodos() {
    if (form.iniTravado && form.periodos.length) form.periodos[0].inicio = form.iniTravado;
    $('m-periodos').innerHTML = form.periodos.map(function (p, i) {
      var trava = i === 0 && !!form.iniTravado, dica = form.iniTravado ? DICA_INICIO : DICA_INICIO_SEM;
      var campo = '<input type="date" data-k="inicio" value="' + esc(p.inicio) + '" aria-label="Início do período ' + (i + 1) + '"' + (trava ? ' readonly class="travado" tabindex="-1"' : '') + '>';
      return '<tr data-i="' + i + '"><td>' + (i === 0
          ? '<div class="campo-ajuda">' + campo + '<button type="button" class="ajuda" aria-label="' + esc(dica) + '" data-dica="' + esc(dica) + '">?</button></div>'
          : campo) + '</td>' +
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
    mostrarMaquina($('tv-maquina'), m);
    aplicarFundo(document.querySelector('.tv-barra'), m.s);
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
      // os dois gráficos lado a lado num cartão largo; um sobre o outro num cartão alto
      var caixaG = document.querySelector('.tv-graficos');
      caixaG.className = 'tv-graficos ' + (caixaG.clientWidth > caixaG.clientHeight * 1.7 ? 'lado' : 'pilha') + (u === TODAS ? ' todas' : '');
      var eg = $('tv-grafico'), ea = $('tv-acum');
      // "Todas": em cima, a área de cada fazenda (feito + a fazer); embaixo, o realizado × meta por dia do conjunto
      var pl = m.o === 'PLANTIO';
      set('tv-t-meta', u === TODAS ? 'Área por fazenda (ha)' : 'Realizado × meta por dia');
      set('tv-t-acum', u === TODAS ? 'Realizado × meta por dia' : 'Evolução acumulada');
      legenda('tv-leg-meta', u === TODAS ? [{ nome: pl ? 'Plantado' : 'Colhido', cor: COR.teal }, { nome: pl ? 'A plantar' : 'A colher', cor: COR_A_FAZER }] : itensLegendaMeta(m));
      legenda('tv-leg-acum', u === TODAS ? itensLegendaMeta(m) : itensLegendaAcum(m));
      if (u === TODAS) {
        chart(eg).setOption(opcoesAreaFazendas(m, k), true);
        if (m.serie.length) chart(ea).setOption(opcoesMeta(m, k, 21), true);
        else vazio(ea, 'Ainda não há apontamentos nesta safra.');
      } else if (m.serie.length) {
        chart(eg).setOption(opcoesMeta(m, k, 21), true);
        chart(ea).setOption(opcoesAcumulado(m, k), true);
      } else { vazio(eg, 'Ainda não há apontamentos nesta safra.'); vazio(ea, 'Ainda não há apontamentos nesta safra.'); }
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
  // Exportar PNG: a mesma página do relatório Power BI (barra lateral, indicadores,
  // medidor, rosca, equipes, variedades, meta × realizado, mapa e barras por talhão).
  //  - paisagem: a página 1920 × 1080 do Power BI, gravada em 4800 × 2700
  //  - vertical: os mesmos blocos empilhados para ler no celular (1080 de largura base → 2700)
  // As medidas abaixo são da página base; o canvas é escalado por `escala` (ver escalaExport).
  // ===========================================================================
  var FORMATOS = {
    paisagem: { base: 1920, escala: 2.5 },
    vertical: { base: 1080, escala: 2.5 }
  };
  /**
   * Escala do PNG: a pedida, limitada pela área máxima de canvas do aparelho (iPhone/iPad: ~16,7 Mpx;
   * acima disso o Safari devolve imagem em branco). Nunca abaixo de 1.
   */
  function escalaExport(w, h, alvo) {
    var ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var limite = ios ? 16e6 : 64e6;
    return Math.max(1, Math.min(alvo, Math.floor(Math.sqrt(limite / (w * h)) * 100) / 100));
  }
  var AVISO_WHATSAPP = ' · no WhatsApp, envie em HD (ou como documento) para manter a nitidez';
  var exp = { formato: FORMATOS[ls('formatoPng')] ? ls('formatoPng') : 'paisagem', blob: null, url: null, arquivo: '', gerando: 0, tam: null };
  var FAMILIA = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';
  var COR_BARRA = '#0F4B45';
  var TXT_PREVISAO = 'Pelo ritmo médio dos últimos 7 dias (sem operação no período, pela média geral).';

  function carregarImagem(src) {
    return new Promise(function (ok, falha) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = falha; i.src = src; });
  }
  function talvezImagem(src) { return carregarImagem(src).catch(function () { return null; }); }
  /** Desenha um gráfico ECharts fora da tela, no tamanho pedido (página base), e devolve a imagem na resolução final. */
  async function imagemGrafico(w, h, desenhar, pr) {
    var el = document.createElement('div');
    el.id = 'exp-' + Math.random().toString(36).slice(2);
    el.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + Math.round(w) + 'px;height:' + Math.round(h) + 'px;';
    document.body.appendChild(el);
    try {
      var g = desenhar(el);
      if (!g) return null;
      if (g.__topo) { g.__topo.pr = pr || 1; atualizarTopo(g); await aguardarTopo(g, 12000); atualizarTopo(g); }
      var zr = g.getZr();
      if (zr.refreshImmediately) zr.refreshImmediately();
      return await carregarImagem(g.getDataURL({ type: 'png', pixelRatio: pr || 1, backgroundColor: '#FFFFFF' }));
    } finally { descartar(el.id); el.remove(); }
  }
  function grafico(w, h, opcoes, pr) {
    return imagemGrafico(w, h, function (el) { var ch = echarts.init(el, null, { renderer: 'canvas' }); charts[el.id] = ch; ch.setOption(opcoes); return ch; }, pr);
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function fonteCv(px, peso) { return (peso || 400) + ' ' + (Math.round(px * 10) / 10) + 'px ' + FAMILIA; }
  /** Escreve cabendo em maxW (reduz a fonte se precisar). Devolve a largura usada. */
  function escrever(c, t, x, y, px, peso, cor, maxW, alinhar) {
    var p = px; t = String(t); c.font = fonteCv(p, peso);
    while (maxW && p > 7 && c.measureText(t).width > maxW) { p -= 0.5; c.font = fonteCv(p, peso); }
    c.fillStyle = cor; c.textAlign = alinhar || 'left'; c.textBaseline = 'alphabetic';
    c.fillText(t, x, y);
    return c.measureText(t).width;
  }
  function quebrar(c, t, maxW) {
    var saida = [], linha = '';
    String(t).split(/\s+/).forEach(function (p) {
      var n = linha ? linha + ' ' + p : p;
      if (linha && c.measureText(n).width > maxW) { saida.push(linha); linha = p; } else linha = n;
    });
    if (linha) saida.push(linha);
    return saida;
  }
  /** Parágrafo com quebra de linha; devolve a linha de base da última linha. */
  function paragrafo(c, t, x, y, maxW, px, peso, cor, alinhar, entre) {
    c.font = fonteCv(px, peso); c.fillStyle = cor; c.textAlign = alinhar || 'left'; c.textBaseline = 'alphabetic';
    var linhas = quebrar(c, t, maxW), a = entre || px * 1.32;
    linhas.forEach(function (l, i) { c.fillText(l, x, y + i * a); });
    return y + (linhas.length - 1) * a;
  }

  // ---- blocos da página (mesmos do relatório) ----
  function caixa(c, r, raio) {
    c.save(); c.shadowColor = 'rgba(16,54,50,.10)'; c.shadowBlur = 10; c.shadowOffsetY = 2;
    rr(c, r.x, r.y, r.w, r.h, raio || 10); c.fillStyle = '#FFFFFF'; c.fill(); c.restore();
  }
  function cartaoNumero(c, r, titulo, valor) {
    caixa(c, r);
    var yt = paragrafo(c, titulo, r.x + r.w / 2, r.y + 30, r.w - 18, 15, 500, COR.texto, 'center');
    // valor sempre na base do cartão (o título pode ter 1 a 3 linhas)
    escrever(c, valor, r.x + r.w / 2, Math.max(yt + 36, r.y + r.h - 16), 30, 600, COR.texto, r.w - 18, 'center');
  }
  /** Título + valor grande em cima; título + valor menor embaixo (como "Área de plantio / Área cadastrada"). */
  function cartaoPar(c, r, a, b, grande) {
    caixa(c, r);
    var cx = r.x + r.w / 2, h2 = r.h / 2;
    escrever(c, a[0], cx, r.y + 28, 14.5, 500, COR.texto, r.w - 14, 'center');
    escrever(c, a[1], cx, r.y + h2 - 6, grande ? 29 : 25, grande ? 700 : 600, COR.texto, r.w - 14, 'center');
    escrever(c, b[0], cx, r.y + h2 + 24, grande ? 12.5 : 14.5, 500, COR.texto, r.w - 14, 'center');
    escrever(c, b[1], cx, r.y + r.h - 12, grande ? 21 : 25, 600, COR.texto, r.w - 14, 'center');
  }
  /** Valor principal à esquerda e dois valores empilhados à direita (como "Produt. em sacas | Talhões abertos / finalizados"). */
  function cartaoGrupo(c, r, principal, a, b) {
    caixa(c, r);
    var we = r.w * 0.44, cx = r.x + we / 2;
    paragrafo(c, principal[0], cx, r.y + 30, we - 12, 14.5, 500, COR.texto, 'center');
    escrever(c, principal[1], cx, r.y + r.h * 0.74, 30, 600, COR.texto, we - 12, 'center');
    var cx2 = r.x + we + (r.w - we) / 2, wd = r.w - we - 10;
    c.strokeStyle = COR.linha; c.lineWidth = 1; c.beginPath(); c.moveTo(r.x + we, r.y + 16); c.lineTo(r.x + we, r.y + r.h - 16); c.stroke();
    escrever(c, a[0], cx2, r.y + 26, 13.5, 500, COR.texto, wd, 'center');
    escrever(c, a[1], cx2, r.y + 54, 22, 600, COR.texto, wd, 'center');
    escrever(c, b[0], cx2, r.y + 82, 13.5, 500, COR.texto, wd, 'center');
    escrever(c, b[1], cx2, r.y + 109, 22, 600, COR.texto, wd, 'center');
  }
  function cartaoMedidor(c, r, titulo, v, max) {
    caixa(c, r);
    var cx = r.x + r.w / 2;
    escrever(c, titulo, cx, r.y + 28, 15, 500, COR.texto, r.w - 16, 'center');
    var cy = r.y + r.h - 20, R = Math.min(r.w * 0.36, r.h - 52), esp = R * 0.32, f = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
    c.lineCap = 'butt'; c.lineWidth = esp;
    c.strokeStyle = '#E3E8E4'; c.beginPath(); c.arc(cx, cy, R - esp / 2, Math.PI, 2 * Math.PI); c.stroke();
    if (f > 0) { c.strokeStyle = COR.teal; c.beginPath(); c.arc(cx, cy, R - esp / 2, Math.PI, Math.PI * (1 + f)); c.stroke(); }
    escrever(c, fmtN(v), cx, cy - 2, 19, 600, COR.texto, (R - esp) * 1.9, 'center');
    escrever(c, '0', cx - R - 8, cy, 12, 500, COR.suave, 40, 'right');
    escrever(c, fmtN(max), cx + R + 8, cy, 12, 500, COR.suave, r.x + r.w - (cx + R + 8) - 4, 'left');
  }
  function cartaoRosca(c, r, m) {
    caixa(c, r);
    escrever(c, 'Percentual realizado', r.x + 16, r.y + 28, 14.5, 600, COR.texto, r.w * 0.6);
    [[COR.dourado, 'À realizar'], [COR.teal, 'Realizado']].forEach(function (l, i) {
      var y = r.y + 54 + i * 22;
      c.fillStyle = l[0]; c.beginPath(); c.arc(r.x + 22, y - 4, 5, 0, 2 * Math.PI); c.fill();
      escrever(c, l[1], r.x + 32, y, 12.5, 500, COR.suave, 110);
    });
    var R = Math.min(r.h * 0.38, r.w * 0.2), cx = r.x + r.w - R - 26, cy = r.y + r.h / 2 + 8, esp = R * 0.36, f = Math.max(0, Math.min(1, m.pct));
    c.lineWidth = esp; c.lineCap = 'butt';
    c.strokeStyle = COR.dourado; c.beginPath(); c.arc(cx, cy, R - esp / 2, 0, 2 * Math.PI); c.stroke();
    if (f > 0) { c.strokeStyle = COR.teal; c.beginPath(); c.arc(cx, cy, R - esp / 2, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * f); c.stroke(); }
    escrever(c, fmtPct(m.pct), cx - R - 16, r.y + r.h - 22, 24, 700, COR.texto, 110, 'right');
  }
  function equipesUltimos7(m) {
    if (!m.ult) return [];
    var lim = +m.ult - 7 * DIA;
    return m.equipes.map(function (e) {
      return { nome: e.nome, v: Object.keys(e.porDia).reduce(function (s, d) { return +iso(d) > lim ? s + e.porDia[d] : s; }, 0) };
    }).filter(function (e) { return e.v > 0; }).sort(function (a, b) { return b.v - a.v; });
  }
  function opcoesColunas(nomes, valores, fonte, w) {
    var larg = (w || 200) / Math.max(1, nomes.length), girar = larg < fonte * 5.2;
    return opt({
      grid: { left: 2, right: 2, top: 24, bottom: 2, containLabel: true },
      xAxis: { type: 'category', data: nomes, axisLine: { lineStyle: { color: COR.linha } }, axisTick: { show: false }, axisLabel: { color: COR.texto, fontSize: fonte, interval: 0, hideOverlap: false, rotate: girar ? 40 : 0, overflow: 'truncate', width: girar ? 76 : larg - 6 } },
      yAxis: { type: 'value', show: false },
      series: [{ type: 'bar', data: valores, barMaxWidth: 46, barCategoryGap: '30%', itemStyle: { color: COR_BARRA },
        label: { show: true, position: 'top', fontSize: fonte, color: COR.texto, formatter: function (p) { return fmtN(p.value); } } }]
    });
  }
  async function cartaoColunas(c, r, titulo, lista, pr) {
    caixa(c, r);
    paragrafo(c, titulo, r.x + 14, r.y + 26, r.w - 28, 14, 500, COR.texto);
    var topo = c.measureText(titulo).width > r.w - 28 ? 50 : 34;
    if (!lista.length) { escrever(c, 'Sem apontamentos', r.x + r.w / 2, r.y + r.h / 2 + 10, 13, 500, COR.fraco, r.w - 20, 'center'); return; }
    var l = lista.slice(0, Math.max(1, Math.floor((r.w - 16) / 38)));
    var img = await grafico(r.w - 16, r.h - topo - 8, opcoesColunas(l.map(function (e) { return e.nome; }), l.map(function (e) { return Math.round(e.v); }), l.length > 4 ? 10.5 : 12, r.w - 16), pr);
    if (img) c.drawImage(img, r.x + 8, r.y + topo, r.w - 16, r.h - topo - 8);
  }
  function variedadesVisiveis(m) { return m.variedades.filter(function (v) { return v.prev > 0; }); }
  /** Tabela de variedades: todas as linhas, mais compactas quando são muitas; em cartão largo, em duas colunas. */
  function cartaoVariedades(c, r, m) {
    caixa(c, r);
    var pl = m.o === 'PLANTIO', l = variedadesVisiveis(m);
    escrever(c, 'Variedades', r.x + 14, r.y + 28, 15, 600, COR.escuro, r.w * 0.5);
    if (!l.length) { escrever(c, 'Sem variedades informadas', r.x + r.w / 2, r.y + r.h / 2 + 10, 13, 500, COR.fraco, r.w - 20, 'center'); return; }
    var util = r.h - 52, cols = r.w >= 440 && l.length * 16 > util ? 2 : 1, porCol = Math.ceil(l.length / cols);
    var lh = Math.max(12, Math.min(23, util / porCol)), px = Math.max(9, Math.min(12.5, lh * 0.58));
    var cw = (r.w - 28 - (cols - 1) * 16) / cols;
    for (var k = 0; k < cols; k++) {
      var x0 = r.x + 14 + k * (cw + 16), x1 = x0 + cw, cQ = x1 - 52;
      escrever(c, pl ? 'Plantado (ha)' : 'Colhido (ha)', cQ, r.y + 28, 12.5, 600, COR.escuro, 100, 'right');
      escrever(c, '%', x1, r.y + 28, 12.5, 600, COR.escuro, 40, 'right');
      c.fillStyle = COR.linha; c.fillRect(x0, r.y + 38, cw, 1);
      l.slice(k * porCol, (k + 1) * porCol).forEach(function (v, i) {
        var y = r.y + 44 + i * lh;
        if (i % 2 === 0) { c.fillStyle = '#F3F6F3'; c.fillRect(x0, y, cw, lh); }
        var yb = y + lh / 2 + px * 0.36;
        escrever(c, v.v, x0 + 6, yb, px, 500, COR.texto, cQ - x0 - 84);
        escrever(c, fmtN(v.exec, 2), cQ, yb, px, 500, COR.texto, 80, 'right');
        escrever(c, fmtPct(v.exec / v.prev), x1 - 4, yb, px, 500, COR.texto, 44, 'right');
      });
    }
  }
  function metaReferencia(m) {
    if (m.metaHoje !== null) return m.metaHoje;
    for (var i = m.serie.length - 1; i >= 0; i--) if (m.serie[i].meta !== null) return m.serie[i].meta;
    return null;
  }
  /** Legenda de cartão: [cor, texto, tipo] com tipo 'linha' (traço), 'tracejada' ou bolinha. */
  function legendaCartao(c, itens, x0, y) {
    itens.reduce(function (x, l) {
      c.fillStyle = l[0]; c.strokeStyle = l[0]; c.lineWidth = 2.5;
      if (l[2] === 'linha' || l[2] === 'tracejada') {
        c.setLineDash(l[2] === 'tracejada' ? [4, 3] : []); c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 13, y - 4); c.stroke(); c.setLineDash([]);
      } else { c.beginPath(); c.arc(x + 5, y - 4, 5, 0, 2 * Math.PI); c.fill(); }
      return x + 16 + escrever(c, l[1], x + (l[2] ? 17 : 14), y, 12.5, 500, COR.suave, 170) + 12;
    }, x0);
  }
  async function cartaoAcumulado(c, r, m, pr) {
    caixa(c, r);
    escrever(c, 'Evolução acumulada (ha)', r.x + 16, r.y + 28, 15, 600, COR.texto, r.w - 32);
    var itens = [[COR.teal, 'Realizado']];
    if (m.planos.length) itens.push([COR.dourado, 'Planejado', 'tracejada']);
    if (m.ritmo && m.restante > 0) itens.push(['#9AA79F', 'Projeção', 'tracejada']);
    (m.comparativos || []).forEach(function (cp, i) { itens.push([COR_COMPARATIVO[i] || COR_COMPARATIVO[1], nomeSafra(cp.nome), 'linha']); });
    var legY = r.y + 50;
    legendaCartao(c, itens, r.x + 16, legY);
    var a = { x: r.x + 8, y: legY + 12, w: r.w - 16, h: r.y + r.h - legY - 20 };
    if (!m.serie.length) { escrever(c, 'Ainda não há apontamentos nesta safra.', a.x + a.w / 2, a.y + a.h / 2, 14, 500, COR.fraco, a.w, 'center'); return; }
    var img = await grafico(a.w, a.h, opcoesAcumulado(m, 0.95), pr);
    if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
  }
  async function cartaoMeta(c, r, m, pr) {
    caixa(c, r);
    escrever(c, 'Meta x Realizado - ha por dia', r.x + 16, r.y + 28, 15, 600, COR.texto, r.w * 0.5);
    var itensMeta = [[COR.teal, 'Área executada dia'], [COR.dourado, 'Meta diária']].concat((m.comparativos || []).map(function (cp, i) { return [COR_COMPARATIVO[i] || COR_COMPARATIVO[1], nomeSafra(cp.nome), 'linha']; }));
    var legY = r.w < 820 ? r.y + 76 : r.y + 50;
    legendaCartao(c, itensMeta, r.x + 16, legY);
    var mr = metaReferencia(m);
    [['Meta diária (ha)', mr !== null ? fmtN(mr) : '—'], ['Média real ha/dia', m.media ? fmtN(m.media) : '—']].forEach(function (p, i) {
      var cx = r.x + r.w - 72 - (1 - i) * 150;
      escrever(c, p[0], cx, r.y + 28, 14, 500, COR.texto, 145, 'center');
      escrever(c, p[1], cx, r.y + 52, 16, 600, COR.texto, 145, 'center');
    });
    var a = { x: r.x + 8, y: legY + 12, w: r.w - 16, h: r.y + r.h - legY - 20 };
    if (!m.serie.length) { escrever(c, 'Ainda não há apontamentos nesta safra.', a.x + a.w / 2, a.y + a.h / 2, 14, 500, COR.fraco, a.w, 'center'); return; }
    var dias = Math.max(14, Math.floor(a.w / 13));
    var o = opcoesMeta(m, 1, m.serie.length > dias ? dias : null);
    o.series[0].itemStyle.color = COR.teal;
    o.series.forEach(function (se) { if (se.name === 'Meta') se.lineStyle = { color: '#F2C200', width: 2.5 }; });
    var img = await grafico(a.w, a.h, o, pr);
    if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
  }
  function legendaHorizontal(c, itens, cx, y, px) {
    c.font = fonteCv(px, 500);
    var larg = itens.reduce(function (s, it) { return s + px + 8 + c.measureText(it.nome).width + 18; }, -18), x = cx - larg / 2;
    itens.forEach(function (it) {
      rr(c, x, y - px + 1, px, px, 3); c.fillStyle = it.cor; c.fill();
      if (it.borda) { c.strokeStyle = '#C9D3CB'; c.lineWidth = 1; c.stroke(); }
      x += px + 8;
      x += escrever(c, it.nome, x, y, px, 500, COR.suave) + 18;
    });
  }
  async function cartaoMapa(c, r, m, u, comp, imgs, pr) {
    caixa(c, r);
    var pl = m.o === 'PLANTIO';
    escrever(c, 'Mapa de evolução de ' + (pl ? 'plantio' : 'colheita'), r.x + r.w / 2, r.y + 30, 16, 600, COR.texto, r.w - 140, 'center');
    var rot = rotulosClasse(m.o);
    legendaHorizontal(c, [3, 2, 1, 0].map(function (k) { return { nome: rot[k], cor: COR.s[k], borda: k === 0 }; }), r.x + r.w / 2, r.y + r.h - 16, 13);
    var a = { x: r.x + 10, y: r.y + 46, w: r.w - 20, h: r.h - 46 - 34 };
    if (!comp) { escrever(c, 'Limites dos talhões indisponíveis', a.x + a.w / 2, a.y + a.h / 2, 15, 500, COR.fraco, a.w, 'center'); return; }
    var img = await imagemGrafico(a.w, a.h, function (el) {
      return desenharMapaFazenda(el, u, m, comp, { semZoom: true, rotulos: true, fonte: 9, fonteTitulo: 13 });
    }, pr);
    if (img) c.drawImage(img, a.x, a.y, a.w, a.h);
    // rosa dos ventos depois do mapa (por cima), inteira dentro do quadro, sobre um fundo branco
    if (imgs.rosa) {
      var rw = 46, rh = rw * imgs.rosa.height / imgs.rosa.width, rx = a.x + a.w - rw - 10, ry = a.y + 8;
      c.save(); c.shadowColor = 'rgba(16,54,50,.12)'; c.shadowBlur = 6;
      rr(c, rx - 6, ry - 6, rw + 12, rh + 12, 8); c.fillStyle = 'rgba(255,255,255,.9)'; c.fill(); c.restore();
      c.drawImage(imgs.rosa, rx, ry, rw, rh);
    }
  }
  /** "Todas": no lugar do mapa, a lista das fazendas com a barra de progresso. */
  function cartaoListaFazendas(c, r, m) {
    caixa(c, r);
    escrever(c, 'Evolução por fazenda', r.x + r.w / 2, r.y + 30, 16, 600, COR.texto, r.w - 40, 'center');
    var lista = m.unidades.map(function (u) { return { u: u, x: calcula([u], m.s, m.o) }; }).sort(function (a, b) { return b.x.pct - a.x.pct; });
    var y0 = r.y + 50, lh = (r.h - 60) / Math.max(1, lista.length), fs = Math.min(1, lh / 70), wb = r.w - 40;
    lista.forEach(function (f, i) {
      var x0 = r.x + 20, y = y0 + i * lh + (lh - 58 * fs) / 2, x = f.x;
      escrever(c, titulo(f.u), x0, y + 18 * fs, 16 * fs, 600, COR.texto, wb * 0.6);
      escrever(c, fmtPct(x.pct, 1), x0 + wb, y + 18 * fs, 17 * fs, 700, COR.teal, 120, 'right');
      var yb = y + 26 * fs;
      rr(c, x0, yb, wb, 9 * fs, 4.5 * fs); c.fillStyle = COR.s[0]; c.fill();
      if (x.pct > 0) { rr(c, x0, yb, Math.max(9 * fs, wb * x.pct), 9 * fs, 4.5 * fs); c.fillStyle = COR_FAZENDA[f.u] || COR.teal; c.fill(); }
      escrever(c, fmtN(x.exec) + ' de ' + fmtN(x.areaTotal) + ' ha  ·  ' + (x.media7 ? fmtN(x.media7) + ' ha/dia' : 'sem ritmo') + (x.previsao ? '  ·  previsão ' + fmtData(x.previsao) : ''), x0, yb + 28 * fs, 12.5 * fs, 500, COR.suave, wb);
    });
  }
  function opcoesTalhoes(lista, w, fonte) {
    var larg = w / Math.max(1, lista.length);
    return opt({
      grid: { left: 2, right: 2, top: 30, bottom: 2, containLabel: true },
      xAxis: { type: 'category', data: lista.map(function (t) { return t.nome; }), axisLine: { lineStyle: { color: COR.linha } }, axisTick: { show: false },
        axisLabel: { color: COR.texto, fontSize: fonte, interval: 0, rotate: larg < fonte * 3 ? 90 : 0, hideOverlap: false } },
      yAxis: { type: 'value', show: false, min: 0, max: 100 },
      series: [{
        type: 'bar', barCategoryGap: '22%',
        data: lista.map(function (t) { return { value: t.barra, real: t.valor, sufixo: t.sufixo, itemStyle: { color: t.cor, borderRadius: [2, 2, 0, 0] } }; }),
        label: { show: true, position: 'top', distance: 4, rotate: larg < fonte * 2.4 ? 90 : 0, align: larg < fonte * 2.4 ? 'left' : 'center', verticalAlign: 'middle',
          fontSize: fonte * 0.95, color: COR.texto, formatter: function (p) { return p.data.real === null ? '' : fmtN(p.data.real) + (p.data.sufixo || ''); } }
      }]
    });
  }
  async function cartaoBarras(c, r, titulo, legenda, lista, pr) {
    caixa(c, r);
    var topo = 8;
    if (titulo) { escrever(c, titulo, r.x + 16, r.y + 26, 15, 600, COR.texto, r.w * 0.5); topo = 32; }
    if (legenda) {
      c.font = fonteCv(13, 500);
      var x = r.x + r.w - 16 - legenda.reduce(function (s, it) { return s + 21 + c.measureText(it.nome).width + 16; }, -16);
      legenda.forEach(function (it) { rr(c, x, r.y + 14, 13, 13, 3); c.fillStyle = it.cor; c.fill(); x += 21; x += escrever(c, it.nome, x, r.y + 26, 13, 500, COR.suave) + 16; });
    }
    if (!lista.length) { escrever(c, 'Sem talhões', r.x + r.w / 2, r.y + r.h / 2, 14, 500, COR.fraco, r.w, 'center'); return; }
    var w = r.w - 16, h = r.h - topo - 6;
    var img = await grafico(w, h, opcoesTalhoes(lista, w, Math.max(9, Math.min(12, w / lista.length / 2.4))), pr);
    if (img) c.drawImage(img, r.x + 8, r.y + topo, w, h);
  }
  /** Talhões em ordem decrescente do % realizado (como o relatório, que ordena pelo valor). */
  function listaTalhoes(m) {
    return m.talhoes.slice().sort(function (a, b) { return b.perc - a.perc || (a.t < b.t ? -1 : 1); }).map(function (t) {
      var v = Math.round(t.perc * 100);
      return { nome: t.t, valor: v > 0 ? v : null, barra: Math.max(1.5, v), cor: t.k === 0 ? '#C9D1CB' : COR.s[t.k] };
    });
  }
  function listaFazendas(m) {
    return m.unidades.map(function (u) { var x = calcula([u], m.s, m.o); return { nome: titulo(u), valor: Math.round(x.pct * 100), sufixo: '%', barra: Math.max(1.5, x.pct * 100), cor: COR_FAZENDA[u] || COR.teal }; })
      .sort(function (a, b) { return b.valor - a.valor; });
  }
  function legendaTalhoes(m) {
    var rot = rotulosClasse(m.o);
    return [3, 2, 1, 0].map(function (k) { return { nome: rot[k], cor: k === 0 ? '#C9D1CB' : COR.s[k] }; });
  }

  // ---- cabeçalho e barra lateral ----
  function faixaMarca(c, W, h, imgs) {
    var gr = c.createLinearGradient(0, 0, W, h * 0.35);
    gr.addColorStop(0, '#0B8C7F'); gr.addColorStop(0.34, '#0B6E62'); gr.addColorStop(0.68, '#094C44'); gr.addColorStop(1, '#06312C');
    c.fillStyle = gr; c.fillRect(0, 0, W, h);
    if (imgs.cultura) {
      // ilustração da cultura em traço, apoiada na base, só à direita e esmaecendo para a esquerda (igual à faixa do painel)
      var sh = h * 1.05, sw = imgs.cultura.width / imgs.cultura.height * sh, ww = W * 0.62;
      var off = document.createElement('canvas'); off.width = Math.round(ww * 2); off.height = Math.round(h * 2);
      var o = off.getContext('2d'); o.scale(2, 2);
      for (var xx = ww - sw; xx > -sw; xx -= sw) o.drawImage(imgs.cultura, xx, h - sh, sw, sh);
      o.globalCompositeOperation = 'destination-in';
      var mg = o.createLinearGradient(0, 0, ww, 0); mg.addColorStop(0, 'rgba(0,0,0,0)'); mg.addColorStop(0.6, 'rgba(0,0,0,1)');
      o.fillStyle = mg; o.fillRect(0, 0, ww, h);
      c.save(); c.globalAlpha = 0.16; c.drawImage(off, W - ww, 0, ww, h); c.restore();
    }
  }
  function cabecalho(c, L, m, imgs) {
    faixaMarca(c, L.W, L.cabH, imgs);
    var pl = m.o === 'PLANTIO', x = L.tituloX, maxW = L.W - x - 280;
    escrever(c, 'ACOMPANHAMENTO OPERACIONAL ' + (pl ? 'PLANTIO' : 'COLHEITA'), x, 72, L.W > 1500 ? 38 : 30, 700, '#FFFFFF', maxW);
    var g = DADOS.geradoEm ? new Date(DADOS.geradoEm) : null;
    escrever(c, 'Atualizado em: ' + (g ? g.toLocaleString('pt-BR').replace(',', '') : '—'), x, 110, 20, 400, '#E3F1EC', maxW);
    if (imgs.coa) { var lh = L.W > 1500 ? 60 : 48, lw = imgs.coa.width / imgs.coa.height * lh; c.drawImage(imgs.coa, L.W - 36 - lw, 30, lw, lh); }
  }
  function linhaDourada(c, x, y, w) { c.fillStyle = COR.dourado; c.fillRect(x, y, w, 3); }
  function desenharLogoLocks(c, img, cx, y, maxW, maxH) {
    if (!img) return;
    var s = Math.min(maxW / img.width, maxH / img.height);
    c.drawImage(img, cx - img.width * s / 2, y, img.width * s, img.height * s);
  }
  function desenharFoto(c, img, cx, y, maxW, maxH) {
    if (!img) return 0;
    var s = Math.min(maxW / img.width, maxH / img.height), w = img.width * s, h = img.height * s;
    c.drawImage(img, cx - w / 2, y + (maxH - h) / 2, w, h);
    return maxH;
  }
  function dataRotulo(c, x, y, rotulo, valor, w, alinhar) {
    escrever(c, rotulo, x, y, 17, 500, COR.teal, w, alinhar);
    escrever(c, valor, x, y + 28, 21, 600, COR.texto, w, alinhar);
  }
  /** Itens do "Resumo do período": situação, ritmo × meta e o comparativo com as safras anteriores. */
  function itensResumo(m) {
    var pl = m.o === 'PLANTIO', itens = [];
    itens.push(['Situação', m.restante > 0 ? fmtPct(m.pct, 1) + ' · faltam ' + fmtN(m.restante) + ' ha' : 'Operação concluída', null]);
    if (m.media7 && m.metaHoje) {
      var r = m.media7 / m.metaHoje - 1;
      itens.push(['Ritmo 7 dias × meta', fmtN(m.media7) + ' × ' + fmtN(m.metaHoje) + ' ha/dia', r >= 0 ? '#1E7B4F' : r > -0.1 ? '#B7791F' : '#B3261E']);
    } else if (m.media7) itens.push(['Ritmo dos últimos 7 dias', fmtN(m.media7) + ' ha/dia', null]);
    var feito = m.apontado;
    (m.comparativos || []).forEach(function (cp) {
      var antes = m.ult ? cp.acumAte(anosAntes(m.ult, cp.anos)) : 0;
      var dif = antes > 0 ? feito / antes - 1 : null;
      itens.push([nomeSafra(cp.nome) + ' até ' + (m.ult ? fmtData(anosAntes(m.ult, cp.anos), true) : '—'),
        fmtN(antes) + ' ha' + (dif === null ? '' : dif >= 2 ? ' (atual ' + fmtN(dif + 1, dif < 9 ? 1 : 0) + '× maior)' : ' (atual ' + (dif >= 0 ? '+' : '') + fmtPct(dif) + ')'), dif === null ? null : dif >= 0 ? '#1E7B4F' : '#B3261E']);
    });
    if (itens.length < 4 && m.equipes.length) itens.push(['Equipes em operação', equipesUltimos7(m).length + ' nos últimos 7 dias', null]);
    return itens.slice(0, 4);
  }
  function blocoObservacao(c, r, m) {
    rr(c, r.x, r.y, r.w, r.h, 10); c.strokeStyle = COR.linha; c.lineWidth = 1.2; c.stroke();
    escrever(c, 'Resumo do período', r.x + 14, r.y + 26, 14.5, 700, COR.escuro, r.w - 28);
    var itens = itensResumo(m), col = r.w > 500 ? 2 : 1, cw = (r.w - 28) / col, porCol = Math.max(1, Math.ceil(itens.length / col));
    var passo = Math.min(40, (r.h - 44) / porCol);
    itens.forEach(function (it, i) {
      var x = r.x + 14 + Math.floor(i / porCol) * cw, y = r.y + 50 + (i % porCol) * passo;
      escrever(c, it[0], x, y, 11.5, 500, COR.fraco, cw - 10);
      escrever(c, it[1], x, y + 17, 14, 650, it[2] || COR.texto, cw - 10);
    });
  }
  /** Safra num selo discreto (no lugar do quadrado preto do relatório original). */
  function seloSafra(c, texto, x, y, alinhar, maxW) {
    c.font = fonteCv(15, 600);
    var w = Math.min(maxW || 999, c.measureText(texto).width + 26), x0 = alinhar === 'center' ? x - w / 2 : x;
    rr(c, x0, y - 20, w, 28, 14); c.fillStyle = '#E4F0EB'; c.fill();
    escrever(c, texto, x0 + w / 2, y - 1, 15, 600, COR.teal, w - 16, 'center');
  }
  function lateral(c, r, m, u, imgs) {
    c.save(); c.shadowColor = 'rgba(16,54,50,.10)'; c.shadowBlur = 12;
    rr(c, r.x, r.y, r.w, r.h + 30, 18); c.fillStyle = '#FFFFFF'; c.fill(); c.restore();
    var cx = r.x + r.w / 2, x = r.x + 22, w = r.w - 40, y = r.y + 40;
    desenharLogoLocks(c, imgs.locks, cx, y, r.w - 44, 64); y += 92;
    linhaDourada(c, r.x + 14, y, r.w - 28); y += 14;
    y += desenharFoto(c, imgs.maquina, cx, y, r.w - 20, 120) + 18;
    if (!imgs.maquina) y += 8;
    escrever(c, 'Unidade:', cx, y + 16, 17, 400, COR.teal, w, 'center');
    escrever(c, u === TODAS ? 'Todas' : titulo(u), cx, y + 54, 32, 700, COR.escuro, w, 'center'); y += 76;
    seloSafra(c, nomeSafra(m.s), cx, y + 14, 'center', w); y += 64;
    [['Início da operação', m.ini], ['Último dia de operação', m.ult], ['Data final planejada', m.termino]].forEach(function (d) {
      dataRotulo(c, x, y, d[0], d[1] ? fmtData(d[1]) : '—', w); y += 74;
    });
    var box = { x: r.x + 8, y: y - 26, w: r.w - 16, h: 138 };
    rr(c, box.x, box.y, box.w, box.h, 10); c.strokeStyle = COR.linha; c.lineWidth = 1.2; c.stroke();
    dataRotulo(c, x, y + 6, 'Previsão de término', m.previsao ? fmtData(m.previsao) : '—', w);
    paragrafo(c, TXT_PREVISAO, box.x + 12, y + 62, box.w - 24, 12, 400, COR.fraco, 'left', 16);
    var yObs = box.y + box.h + 10;
    blocoObservacao(c, { x: r.x + 8, y: yObs, w: r.w - 16, h: r.y + r.h - 44 - yObs }, m);
    escrever(c, 'Fonte: PIMS', r.x + 22, r.y + r.h - 22, 13, 500, COR.suave, w);
    c.save(); c.translate(r.x - 12, r.y + r.h - 18); c.rotate(-Math.PI / 2);
    escrever(c, 'Desenvolvido por Centro de Operações Agrícolas', 0, 0, 11.5, 400, '#5FB8AE', 420);
    c.restore();
  }

  // ---- indicadores do topo ----
  function indicadoresPbi(m) {
    var pl = m.o === 'PLANTIO', op = pl ? 'plantio' : 'colheita';
    var semeada = pl ? null : calcula(m.unidades, m.s, 'PLANTIO').exec;
    var n = function (v, c) { return v === null || v === undefined ? '—' : fmtN(v, c); };
    return {
      area: [['Área de ' + op + ' (ha)', fmtN(m.areaTotal)], pl ? ['Área cadastrada (ha)', fmtN(m.areaCad, 2)] : ['Área semeada (ha)', semeada ? fmtN(semeada, 2) : '—']],
      exec: [['Área executada (ha)', fmtN(m.exec, 2)], ['Área à executar (ha)', fmtN(m.restante, 2)]],
      dec: ['Dias decorridos', n(m.diasDec)],
      plan: ['Dias restantes planejados', m.diasPlan === null ? '—' : fmtN(Math.max(0, m.diasPlan))],
      prev: ['Dias restantes previsto', n(m.diasPrev)],
      talh: [['Talhões ' + (pl ? 'plantados' : 'colhidos'), m.porClasse[3].n + ' / ' + m.talhoes.length], ['Talhões abertos', String(m.porClasse[1].n + m.porClasse[2].n)], ['Não iniciados', String(m.porClasse[0].n)]],
      ritmo: [['Ritmo 7 dias (ha/dia)', m.media7 ? fmtN(m.media7) : '—'], ['Necessário p/ meta', m.necessario ? fmtN(m.necessario) + ' ha/dia' : '—'], ['Média geral', m.media ? fmtN(m.media) + ' ha/dia' : '—']],
      rep: pl ? ['% Replantio', m.exec ? fmtPct(m.replantio / m.exec, 1) : '—'] : ['% Dano', m.areaCad ? fmtPct(m.dano / m.areaCad, 1) : '—']
    };
  }
  function desenharIndicadores(c, K, m) {
    var d = indicadoresPbi(m);
    cartaoPar(c, K.area, d.area[0], d.area[1], true);
    cartaoPar(c, K.exec, d.exec[0], d.exec[1]);
    cartaoNumero(c, K.dec, d.dec[0], d.dec[1]);
    cartaoNumero(c, K.plan, d.plan[0], d.plan[1]);
    cartaoNumero(c, K.prev, d.prev[0], d.prev[1]);
    cartaoMedidor(c, K.gauge, 'Evolução do realizado (ha)', m.exec, m.areaTotal);
    cartaoGrupo(c, K.talh, d.talh[0], d.talh[1], d.talh[2]);
    cartaoGrupo(c, K.ritmo, d.ritmo[0], d.ritmo[1], d.ritmo[2]);
    cartaoNumero(c, K.rep, d.rep[0], d.rep[1]);
  }
  function cartaoDanoReplantio(c, r, m) {
    caixa(c, r);
    [['Área de dano (ha)', fmtN(m.dano, 2)], ['Replantio (ha)', fmtN(m.replantio, 2)]].forEach(function (p, i) {
      var cx = r.x + r.w / 4 + i * r.w / 2;
      escrever(c, p[0], cx, r.y + 26, 14.5, 500, COR.texto, r.w / 2 - 10, 'center');
      escrever(c, p[1], cx, r.y + r.h - 14, 23, 600, COR.texto, r.w / 2 - 10, 'center');
    });
  }

  // ---- arranjos ----
  function aspectoFazenda(comp) {
    if (!comp) return 1.5;
    var bb = comp.mp.features.map(bboxFeature).filter(Boolean).reduce(uniao);
    return (bb[2] - bb[0]) / Math.max(1, bb[3] - bb[1]);
  }
  /**
   * Página 1920 × 1080 do relatório, com o mesmo espaço (G) entre todos os cartões e a barra lateral.
   * As larguras relativas seguem o Power BI. Fazenda alta: o mapa ocupa duas faixas (como a página
   * de Guapirama do Power BI).
   */
  function layoutPaisagem(todas, comp, nVar) {
    var G = 10, LAT = { x: 25, y: 23, w: 239, h: 1057 }, X0 = LAT.x + LAT.w + G, X1 = 1920 - LAT.x;
    /** Distribui larguras relativas entre x0 e x1 com o espaço G entre elas. */
    function faixa(pesos, x0, x1, y, h) {
      var tot = soma(pesos, function (p) { return p; }), livre = x1 - x0 - G * (pesos.length - 1), x = x0;
      return pesos.map(function (p) { var w = livre * p / tot, r = { x: x, y: y, w: w, h: h }; x += w + G; return r; });
    }
    var yK = 129, hK = 121, y2 = yK + hK + G, h2 = 206, y3 = y2 + h2 + G, h3 = 244, y4 = y3 + h3 + G, yFim = 1068;
    var k = faixa([155, 151, 120, 112, 113, 234, 284, 285, 103], X0, X1, yK, hK);
    var L = { W: 1920, H: 1080, cabH: 205, tituloX: X0 + 12, lateral: LAT, G: G,
      kpis: { area: k[0], exec: k[1], dec: k[2], plan: k[3], prev: k[4], gauge: k[5], talh: k[6], ritmo: k[7], rep: k[8] } };
    var a = aspectoFazenda(comp), cabe = function (w, h) { var lw = Math.min(w, h * a); return lw * lw / a; };
    L.alto = !todas && !!comp && cabe(586, 552) > cabe(636, 382) * 1.25;
    var c = faixa(L.alto ? [270, 200, 160, 360, 606] : [270, 230, 160, 280, 656], X0, X1, y2, h2);
    var hDano = 66;
    L.dano = { x: c[0].x, y: y2, w: c[0].w, h: hDano };
    L.donut = { x: c[0].x, y: y2 + hDano + G, w: c[0].w, h: h2 - hDano - G };
    L.eq7 = c[1]; L.eqT = c[2]; L.vari = c[3];
    var fimEsq = c[3].x + c[3].w, larg = X1 - X0;
    L.meta = { x: X0, y: y3, w: fimEsq - X0, h: h3 };
    var hTal = (yFim - y4 - G) / 2;
    if (L.alto) {
      L.mapa = { x: c[4].x, y: y2, w: c[4].w, h: y4 + hTal - y2 };
      L.tal = [{ x: X0, y: y4, w: fimEsq - X0, h: hTal }, { x: X0, y: y4 + hTal + G, w: larg, h: hTal }];
    } else {
      L.mapa = { x: c[4].x, y: y2, w: c[4].w, h: y3 + h3 - y2 };
      L.tal = todas ? [{ x: X0, y: y4, w: larg, h: yFim - y4 }] : [{ x: X0, y: y4, w: larg, h: hTal }, { x: X0, y: y4 + hTal + G, w: larg, h: hTal }];
    }
    // muitas variedades: a faixa do meio cresce (o gráfico diário encolhe); se ainda faltar, o cartão
    // das variedades ocupa o lugar do "Área total por equipe" (duas colunas)
    var extra = Math.max(0, Math.min(90, 52 + (nVar || 0) * 17 - L.vari.h));
    if (extra) {
      [L.eq7, L.eqT, L.vari].forEach(function (r) { r.h += extra; });
      L.donut.h += extra; L.meta.y += extra; L.meta.h -= extra;
    }
    if (52 + (nVar || 0) * 17 > L.vari.h) { L.vari.w += L.vari.x - L.eqT.x; L.vari.x = L.eqT.x; L.eqT = null; }
    // a faixa do gráfico diário também leva a evolução acumulada (com o comparativo das safras anteriores)
    var wDia = (L.meta.w - G) * 0.57;
    L.acum = { x: L.meta.x + wDia + G, y: L.meta.y, w: L.meta.w - wDia - G, h: L.meta.h };
    L.meta.w = wDia;
    return L;
  }
  /** Os mesmos blocos empilhados, 1080 de largura (a altura acompanha o conteúdo). */
  function layoutVertical(m, todas, comp) {
    var W = 1080, M = 28, g = 14, lw = W - 2 * M, y;
    var L = { W: W, cabH: 190, tituloX: M, vertical: true };
    L.id = { x: M, y: 146, w: lw, h: 330 };
    y = L.id.y + L.id.h + g;
    var cw = (lw - 2 * g) / 3, ch = 128;
    var cel = function (i, j) { return { x: M + j * (cw + g), y: y + i * (ch + g), w: cw, h: ch }; };
    L.kpis = { area: cel(0, 0), exec: cel(0, 1), gauge: cel(0, 2), dec: cel(1, 0), plan: cel(1, 1), prev: cel(1, 2), talh: cel(2, 0), ritmo: cel(2, 1), rep: cel(2, 2) };
    y += 3 * (ch + g);
    var hw = (lw - g) / 2;
    L.dano = { x: M, y: y, w: hw, h: 76 };
    L.donut = { x: M, y: y + 76 + g, w: hw, h: 150 };
    L.eq7 = { x: M + hw + g, y: y, w: (hw - g) * 0.55, h: 240 };
    L.eqT = { x: L.eq7.x + L.eq7.w + g, y: y, w: hw - g - L.eq7.w, h: 240 };
    y += 240 + g;
    var nv = Math.max(1, variedadesVisiveis(m).length);
    L.vari = { x: M, y: y, w: lw, h: 60 + Math.ceil(nv / (nv > 10 ? 2 : 1)) * 23 }; y += L.vari.h + g;
    L.meta = { x: M, y: y, w: lw, h: 320 }; y += 320 + g;
    L.acum = { x: M, y: y, w: lw, h: 300 }; y += 300 + g;
    var hm = todas ? 70 + m.unidades.length * 76 : Math.max(460, Math.min(980, (lw - 20) / aspectoFazenda(comp) + 100));
    L.mapa = { x: M, y: y, w: lw, h: hm }; y += hm + g;
    L.tal = [];
    if (todas) { L.tal.push({ x: M, y: y, w: lw, h: 300 }); y += 300 + g; }
    else {
      var nl = Math.max(1, Math.min(5, Math.ceil(m.talhoes.length / 45)));
      for (var i = 0; i < nl; i++) { L.tal.push({ x: M, y: y, w: lw, h: i ? 170 : 196 }); y += (i ? 170 : 196) + g; }
    }
    L.nota = { x: M, y: y, w: lw, h: 170 }; y += 170 + M;
    L.H = y;
    return L;
  }
  function identidadeVertical(c, r, m, u, imgs) {
    caixa(c, r, 14);
    var wl = 300, cx = r.x + wl / 2;
    desenharLogoLocks(c, imgs.locks, cx, r.y + 28, wl - 60, 60);
    linhaDourada(c, r.x + 30, r.y + 106, wl - 60);
    desenharFoto(c, imgs.maquina, cx, r.y + 124, wl - 30, 150);
    c.fillStyle = COR.linha; c.fillRect(r.x + wl, r.y + 24, 1, r.h - 48);
    var x = r.x + wl + 30, w = r.w - wl - 50;
    escrever(c, 'Unidade:', x, r.y + 44, 17, 400, COR.teal, w);
    escrever(c, u === TODAS ? 'Todas as fazendas' : titulo(u), x, r.y + 88, 36, 700, COR.escuro, w * 0.62);
    c.font = fonteCv(15, 600);
    seloSafra(c, nomeSafra(m.s), x + w - Math.min(w * 0.34, c.measureText(nomeSafra(m.s)).width + 26), r.y + 86, 'left', w * 0.34);
    var cw = w / 2;
    [['Início da operação', m.ini], ['Último dia de operação', m.ult], ['Data final planejada', m.termino], ['Previsão de término', m.previsao]].forEach(function (d, i) {
      dataRotulo(c, x + (i % 2) * cw, r.y + 150 + Math.floor(i / 2) * 84, d[0], d[1] ? fmtData(d[1]) : '—', cw - 16);
    });
    paragrafo(c, TXT_PREVISAO, x, r.y + r.h - 34, w, 12.5, 400, COR.fraco, 'left', 17);
  }
  function notaVertical(c, r, m) {
    caixa(c, r, 12);
    blocoObservacao(c, { x: r.x + 8, y: r.y + 8, w: r.w - 16, h: r.h - 44 }, m);
    escrever(c, 'Fonte: PIMS  ·  Desenvolvido por Centro de Operações Agrícolas', r.x + 16, r.y + r.h - 14, 13, 500, COR.suave, r.w - 32);
  }

  async function gerarPng(formato) {
    var F = FORMATOS[formato], todas = estado.u === TODAS, u = estado.u;
    var us = todas ? unidadesDaSafra(estado.s) : [u];
    var m = calcula(us, estado.s, estado.o);
    var mp = !todas && MAPAS ? escolherMapa(u, m.talhoes, m.s) : null;
    var comp = mp ? compor(mp.features) : null;
    if (comp) comp.mp = mp;
    var L = formato === 'vertical' ? layoutVertical(m, todas, comp) : layoutPaisagem(todas, comp, variedadesVisiveis(m).length);
    // quadros empilhados só cabem num espaço mais alto que largo; senão, um quadro só
    if (comp && comp.quadros.length > 1 && L.mapa.w > L.mapa.h * 1.1) {
      comp = { orientacao: comp.orientacao, mp: mp, quadros: [{ fs: mp.features, bbox: mp.features.map(bboxFeature).filter(Boolean).reduce(uniao), fr: 1, titulo: null }] };
    }
    var S = escalaExport(L.W, L.H, F.escala), cv = document.createElement('canvas');
    cv.width = Math.round(L.W * S); cv.height = Math.round(L.H * S);
    var c = cv.getContext('2d'); c.scale(S, S);
    var res = await Promise.all([talvezImagem(fundoCultura(m.s)), talvezImagem('assets/logo_locks.png'), talvezImagem('assets/logo_coa_branco.png'), talvezImagem('assets/rosa.png'), talvezImagem(fotoMaquina(m).src)]);
    var imgs = { cultura: res[0], locks: res[1], coa: res[2], rosa: res[3], maquina: res[4] };

    c.fillStyle = '#F1F2F1'; c.fillRect(0, 0, L.W, L.H);
    cabecalho(c, L, m, imgs);
    if (L.vertical) identidadeVertical(c, L.id, m, u, imgs);
    else lateral(c, L.lateral, m, u, imgs);
    desenharIndicadores(c, L.kpis, m);
    cartaoDanoReplantio(c, L.dano, m);
    cartaoRosca(c, L.donut, m);
    await cartaoColunas(c, L.eq7, 'Área por equipe (ha) - Últimos 7 dias', equipesUltimos7(m), S);
    if (L.eqT) await cartaoColunas(c, L.eqT, 'Área total por equipe (ha)', m.equipes.filter(function (e) { return e.total > 0; }).map(function (e) { return { nome: e.nome, v: e.total }; }), S);
    cartaoVariedades(c, L.vari, m);
    await cartaoMeta(c, L.meta, m, S);
    await cartaoAcumulado(c, L.acum, m, S);
    if (todas) cartaoListaFazendas(c, L.mapa, m);
    else await cartaoMapa(c, L.mapa, m, u, comp, imgs, S);

    var pl = m.o === 'PLANTIO', tituloBarras = todas ? '% realizado por fazenda' : '% ' + (pl ? 'plantado' : 'colhido') + ' por talhão';
    if (todas) await cartaoBarras(c, L.tal[0], tituloBarras, null, listaFazendas(m), S);
    else {
      // divide os talhões entre as faixas na proporção da largura de cada uma
      var lista = listaTalhoes(m), totalW = soma(L.tal, function (r) { return r.w; }), ini = 0;
      for (var i = 0; i < L.tal.length; i++) {
        var fim = i === L.tal.length - 1 ? lista.length : ini + Math.round(lista.length * L.tal[i].w / totalW);
        await cartaoBarras(c, L.tal[i], i ? null : tituloBarras, i ? null : legendaTalhoes(m), lista.slice(ini, fim), S);
        ini = fim;
      }
    }
    if (L.vertical) notaVertical(c, L.nota, m);

    exp.tam = { w: cv.width, h: cv.height };
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
      set('exp-status', exp.tam.w + ' × ' + exp.tam.h + ' px · ' + Math.round(blob.size / 1024) + ' KB' + AVISO_WHATSAPP);
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
    $('safras').hidden = estado.vista !== 'safras';
    $('relatorio').hidden = estado.vista !== 'relatorio';
    document.documentElement.classList.toggle('vista-safras', estado.vista === 'safras');
    if (estado.vista === 'painel') renderPainel();
    else if (estado.vista === 'relatorio') { mostrarAviso(''); window.AcompRelatorio.render(NUCLEO); }
    else if (estado.vista === 'safras') {
      // a análise é por fazenda: sem "Todas"
      if (estado.u === TODAS && us.length) { estado.u = us[0]; desenharTopo(); }
      mostrarAviso('');
      window.AcompSafras.render(NUCLEO);
    }
    else { mostrarAviso(''); carregarForm(estado.u === TODAS ? us[0] : estado.u, estado.s, estado.o); }
    var hash = '#' + [estado.vista, estado.u, estado.s, estado.o].map(encodeURIComponent).join('/');
    if (location.hash !== hash) history.replaceState(null, '', hash);
    avisarPai();
  }

  function avisarPai() {
    if (!EMBED || window.parent === window) return;
    // a fazenda da aba também vai para o COA WEB (o seletor do menu lateral acompanha); em Todas, não muda
    var id = estado.u !== TODAS ? fonte.fazendaCoaDaUnidade(estado.u) : null;
    if (id !== null) coaFazenda = id;
    try { window.parent.postMessage({ tipo: 'acomp-rota', vista: estado.vista, coaFazenda: id }, location.origin); } catch (e) { /* sem pai */ }
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
  $('abas').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; fecharAmpliado(true); estado.u = b.dataset.u; if (estado.vista !== 'safras' && estado.vista !== 'relatorio') estado.vista = 'painel'; render(); window.scrollTo({ top: 0 }); });
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
  $('btn-exportar').addEventListener('click', function () {
    if (estado.vista === 'safras') window.AcompSafras.exportar();
    else if (estado.vista === 'relatorio') window.AcompRelatorio.exportar();
    else abrirExportar();
  });
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
      if (estado.vista === 'safras' || estado.vista === 'relatorio') return render(); // o eixo de dias depende da largura
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
    if (d.tipo === 'acomp-vista' && (d.vista === 'painel' || d.vista === 'metas' || d.vista === 'safras' || d.vista === 'relatorio') && d.vista !== estado.vista) { estado.vista = d.vista; render(); }
  });

  // núcleo compartilhado com as abas "Safras" (safras.js) e "Relatórios" (relatorio.js)
  var NUCLEO = {
    dados: function () { return DADOS; }, estado: function () { return estado; }, TODAS: TODAS, unidadesDaSafra: unidadesDaSafra,
    calcula: calcula, culturaDaSafra: culturaDaSafra, anoDaSafra: anoDaSafra, anosAntes: anosAntes,
    opcoesAcumulado: opcoesAcumulado, rotulosClasse: rotulosClasse, COR_FAZENDA: COR_FAZENDA, COR_COMPARATIVO: COR_COMPARATIVO, paragrafo: paragrafo, fonteCv: fonteCv,
    iso: iso, paraIso: paraIso, dif: dif, hoje: hoje, DIA: DIA, COR: COR,
    fmtN: fmtN, fmtPct: fmtPct, fmtData: fmtData, titulo: titulo, nomeSafra: nomeSafra, esc: esc,
    opt: opt, tt: tt, eixoX: eixoX, eixoY: eixoY, chart: chart, vazio: vazio,
    aplicarFundo: aplicarFundo, fundoCultura: fundoCultura, faixaMarca: faixaMarca,
    escrever: escrever, caixa: caixa, rr: rr, legendaCartao: legendaCartao, grafico: grafico, talvezImagem: talvezImagem,
    escalaExport: escalaExport, AVISO_WHATSAPP: AVISO_WHATSAPP
  };

  // ---- início ----
  if (EMBED) document.documentElement.classList.add('embed');
  if (!window.echarts) { set('carregando-texto', 'Não foi possível carregar a biblioteca de gráficos. Verifique a conexão com a internet.'); return; }
  var h0 = location.hash.slice(1).split('/').map(decodeURIComponent);
  if (h0[0] === 'painel' || h0[0] === 'metas' || h0[0] === 'safras' || h0[0] === 'relatorio') { estado.vista = h0[0]; estado.u = h0[1] || TODAS; estado.s = h0[2] || null; estado.o = h0[3] === 'COLHEITA' ? 'COLHEITA' : 'PLANTIO'; }

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
      $('carregando').classList.add('erro');
      set('carregando-texto', erroLegivel(e));
    }
  })();
})();
