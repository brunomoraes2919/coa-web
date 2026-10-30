/* =====================================================================
   Aderência de utilização da plataforma — módulo do COA WEB (só administradores)
   Lê a função aderencia_dados (supabase/0031_aderencia.sql e 0032_aderencia_historico.sql: o histórico de sessões do
   Supabase, os eventos de uso gravados por assets/uso.js, os mapas salvos e os pedidos de atualização) e monta o
   painel com aderencia/logica.js. Acessos, dias e horas de uso têm histórico; relatórios, telas e módulos só existem
   desde o começo do rastreio.
   O período escolhido é lido de novo do banco a cada troca e a cada clique em Atualizar; perfil, unidade e busca
   só redesenham. Junto vem o período anterior (do mesmo tamanho, até 200 dias), para comparar os números do topo.
   A unidade não tem campo no cabeçalho (a fazenda do COA WEB é a da barra do rodapé): escolhe-se na tabela Unidades.
   Em localhost, com ?teste no endereço, lê dados fictícios (modulos/aderencia/dados-ficticios.json).
===================================================================== */
(function () {
  'use strict';

  const L = window.AderenciaLogica;
  const CFG = window.ADERENCIA_CONFIG || {};
  const PARAMS = new URLSearchParams(location.search);
  const EMBED = PARAMS.get('embed') === '1';
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const TESTE = LOCAL && PARAMS.has('teste');
  /** Até quantos dias de período o painel compara com o período anterior (o banco entrega no máximo 400). */
  const MAX_DIAS_COMPARAR = 200;
  const MAX_DIAS = 400;

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = (v, casas) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 });
  const fmtPct = (v, casas) => fmtN((v || 0) * 100, casas) + '%';
  const fmtData = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');
  const fmtDataCurta = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—');
  const fmtH = (h) => fmtN(h) + ' h';
  const ehData = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const SEMANA_LONGA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const SEMANA_LETRA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const SITUACAO = {
    ativo: ['Ativo', 'Acessou nos últimos 7 dias'],
    esfriando: ['Esfriando', 'Último acesso entre 8 e 30 dias atrás'],
    inativo: ['Inativo', 'Mais de 30 dias sem acessar'],
    nunca: ['Nunca acessou', 'Cadastrado, mas nunca entrou no COA WEB'],
  };
  const METRICAS = {
    ativos: { nome: 'usuários ativos', valor: (d) => d.ativos, fmt: (v) => fmtN(v) },
    acessos: { nome: 'acessos', valor: (d) => d.acessos, fmt: (v) => fmtN(v) },
    relatorios: { nome: 'relatórios', valor: (d) => d.relatorios, fmt: (v) => fmtN(v) },
    horas: { nome: 'horas de uso', valor: (d) => d.horas, fmt: (v) => fmtN(v) + ' h' },
  };

  const estado = { periodo: '30', fazenda: null, perfil: 'todos', metrica: 'ativos', ordem: { chave: 'acessos', desc: true }, busca: '' };
  let fonte = null;
  let dados = null;  // o que veio do banco: cobre o período, o anterior e os 14 últimos dias
  let faixa = null;  // { de, ate } que `dados` cobre
  let hoje = L.hojeCuiaba();
  let r = null;      // L.montar do período
  let rAnt = null;   // L.montar do período anterior (null quando não dá para comparar)
  let rAntRastreio = false; // o período anterior inteiro já estava no rastreio (relatórios comparáveis)
  let lendo = false;

  /* ------------------------------ dados ------------------------------ */
  function fonteSupabase() {
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { autoRefreshToken: !EMBED, persistSession: true } });
    return {
      pronto: async function () {
        const s = await sb.auth.getSession();
        if (!s.data || !s.data.session) throw new Error(EMBED ? 'Sua sessão expirou. Entre de novo no COA WEB.' : 'Entre no COA WEB para ver a Aderência de utilização.');
      },
      ler: async function (de, ate) {
        const res = await sb.rpc('aderencia_dados', { p_de: de, p_ate: ate });
        if (!res.error) return res.data || {};
        const codigo = res.error.code || '', msg = res.error.message || '';
        if (codigo === 'PGRST202' || codigo === '42883') throw new Error('O banco ainda não tem a função da Aderência (rode supabase/0031_aderencia.sql).');
        if (codigo === '42501') throw new Error('Só administradores veem a Aderência de utilização.');
        if (codigo === '22023') throw new Error(msg);
        throw new Error('Não foi possível ler o uso da plataforma' + (codigo ? ' (código ' + codigo + ')' : '') + '. Tente de novo em instantes.');
      },
    };
  }
  /** Dados fictícios, só em localhost: o arquivo traz o "hoje" dele, para as datas fecharem. */
  function fonteTeste() {
    let cache = null;
    const baixar = async () => {
      if (cache) return cache;
      const resp = await fetch('../modulos/aderencia/dados-ficticios.json', { cache: 'no-store' });
      if (!resp.ok) throw new Error('Não achei os dados fictícios (modulos/aderencia/dados-ficticios.json).');
      cache = await resp.json();
      return cache;
    };
    return {
      pronto: async function () { const d = await baixar(); if (ehData(d.hoje)) hoje = d.hoje; },
      ler: baixar,
    };
  }

  const rastreioDia = () => (dados && dados.rastreio_desde ? L.hojeCuiaba(new Date(dados.rastreio_desde)) : null);
  /** Desde quando há histórico de acessos (a renovação de sessão mais antiga guardada, ou o rastreio). */
  const historicoDia = () => {
    const h = dados && dados.historico_desde ? L.hojeCuiaba(new Date(dados.historico_desde)) : null;
    const rd = rastreioDia();
    return h && rd ? (h < rd ? h : rd) : h || rd;
  };

  /** O período escolhido ({ de, ate }), ou null quando as datas escolhidas à mão ainda não estão completas. */
  function periodoAtual() {
    if (estado.periodo !== 'custom') return L.periodo(estado.periodo, hoje, rastreioDia());
    let de = $('dt-de').value, ate = $('dt-ate').value;
    if (!ehData(de) || !ehData(ate)) return null;
    if (de > ate) { const t = de; de = ate; ate = t; }
    if (ate > hoje) ate = hoje;
    if (de > ate) de = ate;
    return { de, ate };
  }
  /** Do que o banco precisa entregar: o período, o anterior (para comparar) e os 14 dias que terminam no fim do período. */
  function faixaNecessaria(p) {
    let de = p.de;
    const quatorze = L.somarDias(p.ate, -13);
    if (quatorze < de) de = quatorze;
    if (L.diasEntre(p.de, p.ate).length <= MAX_DIAS_COMPARAR) {
      const ant = L.periodoAnterior(p.de, p.ate);
      if (ant.de < de) de = ant.de;
    }
    return { de, ate: p.ate };
  }

  async function carregar() {
    const p = periodoAtual();
    if (!p) return;
    if (L.diasEntre(p.de, p.ate).length > MAX_DIAS) { avisar('Escolha um período de até ' + MAX_DIAS + ' dias.', 'erro'); return; }
    if (lendo) return;
    lendo = true;
    $('btn-atualizar').disabled = true;
    mostrarCarregando(true);
    try {
      const f = faixaNecessaria(p);
      dados = await fonte.ler(f.de, f.ate);
      faixa = f;
      avisar('');
      desenhar();
    } catch (e) {
      if (!dados) { erroInicial(e); return; }
      avisar(e && e.message ? e.message : 'Não foi possível ler o uso da plataforma.', 'erro');
    } finally {
      lendo = false;
      $('btn-atualizar').disabled = false;
      mostrarCarregando(false);
    }
  }

  /* ------------------------------ avisos ------------------------------ */
  function avisar(texto, tipo) {
    const el = $('aviso');
    el.hidden = !texto;
    el.textContent = texto || '';
    el.classList.toggle('erro', tipo === 'erro');
  }
  function mostrarCarregando(sim) {
    if (!dados) return; // na primeira leitura o "carregando" já está na tela
    $('carregando').classList.toggle('fora', !sim);
  }
  function erroInicial(e) {
    $('carregando').classList.remove('fora');
    $('carregando').classList.add('erro');
    $('carregando-texto').textContent = e && e.message ? e.message : 'Não foi possível abrir a Aderência de utilização.';
  }

  /* ------------------------------ desenho ------------------------------ */
  const nomeFazenda = (id) => { const f = ((dados && dados.fazendas) || []).find((x) => Number(x.id) === Number(id)); return f ? f.nome : 'Unidade ' + id; };
  const diasAtras = (dia) => (dia ? L.diasEntre(dia, hoje).length - 1 : null);
  function quando(dia) {
    const n = diasAtras(dia);
    if (n === null) return '';
    return n <= 0 ? 'hoje' : n === 1 ? 'ontem' : 'há ' + n + ' dias';
  }
  const vazio = (texto) => '<p class="vazio">' + esc(texto) + '</p>';
  const barraCel = (frac, rotulo) => '<span class="barra-cel"><i><b style="width:' + Math.max(0, Math.min(100, (frac || 0) * 100)).toFixed(1) + '%"></b></i><span>' + esc(rotulo) + '</span></span>';
  const num = (v, texto) => '<td class="n' + (v ? '' : ' fraco') + '">' + esc(texto === undefined ? fmtN(v) : texto) + '</td>';
  const perfilTexto = (u) => (u.perfil === 'admin' ? (u.super ? 'Administrador+' : 'Administrador') : 'Colaborador');
  const situacaoHtml = (s) => '<span class="situacao ' + s + '" data-dica="' + esc(SITUACAO[s][1]) + '">' + esc(SITUACAO[s][0]) + '</span>';

  function desenhar() {
    const p = periodoAtual();
    if (!p || !dados) return;
    const filtro = { de: p.de, ate: p.ate, fazenda: estado.fazenda, perfil: estado.perfil };
    r = L.montar(dados, filtro, hoje);
    const ant = L.periodoAnterior(p.de, p.ate);
    const rd = rastreioDia(), hd = historicoDia();
    // só compara quando o período anterior inteiro tem histórico (antes disso ele sempre daria zero); relatórios,
    // só quando ele já estava no rastreio (variacaoHtml)
    rAnt = faixa && ant.de >= faixa.de && hd && hd <= ant.de ? L.montar(dados, Object.assign({}, filtro, ant), hoje) : null;
    rAntRastreio = !!(rAnt && rd && rd <= ant.de);

    $('conteudo').hidden = false;
    $('campo-unidade').hidden = estado.fazenda === null;
    $('nome-unidade').textContent = estado.fazenda === null ? '' : nomeFazenda(estado.fazenda);
    $('atualizado').innerHTML = dados.gerado_em ? 'Lido às <b>' + esc(new Date(dados.gerado_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit' })) + '</b>' : '';
    desenharExplica(p, rd, hd);
    desenharKpis();
    desenharSerie();
    desenharUltimosDias();
    desenharUsuarios();
    desenharUnidades();
    desenharModulos();
    desenharRelatorios();
    desenharTelas();
    desenharCalor();
    desenharAtencao();
  }

  function desenharExplica(p, rd, hd) {
    const n = r.dias.length;
    let t = '<b>' + esc(fmtData(p.de)) + ' a ' + esc(fmtData(p.ate)) + '</b> (' + n + (n === 1 ? ' dia' : ' dias') + ')';
    if (estado.fazenda !== null) t += ' · usuários liberados na <b>' + esc(nomeFazenda(estado.fazenda)) + '</b> (e os administradores que veem todas)';
    if (estado.perfil !== 'todos') t += ' · ' + (estado.perfil === 'admin' ? 'só administradores' : 'só colaboradores');
    t += '. <b>Usuário ativo</b> é quem usou a plataforma ao menos uma vez no período; <b>acesso</b> é cada vez que a pessoa usou (horas seguidas de uso contam como um); <b>horas de uso</b> são as horas do relógio com a plataforma aberta.';
    t += ' Acessos, dias e horas vêm do histórico de sessões' + (hd ? ' (desde ' + esc(fmtData(hd)) + ')' : '') + ' e do rastreio da plataforma.';
    if (!rd) t += ' <b>Relatórios, telas e módulos</b> começam a contar quando os usuários abrirem o COA WEB depois desta versão.';
    else if (rd > p.de) t += ' <b>Relatórios, telas e módulos</b> só existem desde <b>' + esc(fmtData(rd)) + '</b>, quando o rastreio começou (os arquivos baixados antes disso não deixaram registro).';
    if (hd && hd > p.de) t += ' Antes de ' + esc(fmtData(hd)) + ' não há registro de acessos.';
    if (rd && rd > p.de) t += ' Atenção: o botão Sair apaga as sessões guardadas no Supabase (em todos os aparelhos da pessoa); para quem saiu antes de ' + esc(fmtData(rd)) + ', o histórico de antes dessa data fica incompleto (contam só login, pedidos, mapas e cadastros).';
    $('explica').innerHTML = t;
  }

  /* ---- números do topo ---- */
  function variacaoHtml(chave, modo) {
    if (!rAnt || ((chave === 'relatorios' || chave === 'pedidos') && !rAntRastreio)) return '';
    const atual = r.kpis[chave], antes = rAnt.kpis[chave];
    const v = L.variacao(atual, antes);
    if (!v) return '';
    const dias = r.dias.length;
    const base = ' vs. ' + dias + (dias === 1 ? ' dia antes' : ' dias antes');
    if (Math.abs(v.dif) < 1e-9) return '<span class="kpi-var igual">igual' + esc(base) + '</span>';
    const sobe = v.dif > 0;
    let texto;
    if (modo === 'pp') texto = (sobe ? '+' : '−') + fmtN(Math.abs(v.dif) * 100, 0) + ' p.p.';
    else if (v.pct === null) texto = '+' + fmtN(v.dif, modo === 'decimal' ? 1 : 0);
    else texto = (sobe ? '▲ ' : '▼ ') + fmtPct(Math.abs(v.pct), 0);
    return '<span class="kpi-var ' + (sobe ? 'sobe' : 'desce') + '">' + esc(texto + base) + '</span>';
  }
  function desenharKpis() {
    const k = r.kpis;
    const conhecidos = r.dispositivos.computador + r.dispositivos.celular + r.dispositivos.tablet;
    const movel = r.dispositivos.celular + r.dispositivos.tablet;
    const rd = rastreioDia();
    const relDesde = !rd ? 'contados a partir desta versão' : rd > r.de ? 'contados desde ' + fmtDataCurta(rd) : 'arquivos baixados';
    const cartao = (rotulo, valor, sub, varHtml, dica) =>
      '<div class="kpi"' + (dica ? ' data-dica="' + esc(dica) + '"' : '') + '><span class="kpi-rotulo">' + esc(rotulo) + '</span><span class="kpi-valor">' + esc(valor) + '</span>' +
      (sub ? '<span class="kpi-sub">' + esc(sub) + '</span>' : '') + (varHtml || '') + '</div>';
    $('kpis').innerHTML = [
      cartao('Usuários ativos', fmtN(k.ativos), 'de ' + fmtN(k.cadastrados) + ' cadastrados', variacaoHtml('ativos'), 'Usaram a plataforma ao menos uma vez no período'),
      cartao('Adesão', fmtPct(k.adesao), 'dos cadastrados usaram', variacaoHtml('adesao', 'pp')),
      cartao('Acessos', fmtN(k.acessos), k.ativos ? fmtN(k.acessos / k.ativos, 1) + ' por usuário ativo' : '', variacaoHtml('acessos'), 'Cada vez que alguém usou a plataforma (horas seguidas de uso contam como um acesso)'),
      cartao('Usuários por dia', fmtN(k.mediaAtivosDia, 1), 'média de pessoas diferentes por dia', variacaoHtml('mediaAtivosDia', 'decimal')),
      cartao('Horas de uso', fmtH(k.horas), k.ativos ? fmtN(k.horas / k.ativos, 1) + ' h por usuário ativo' : '', variacaoHtml('horas'), 'Horas do relógio com a plataforma aberta (abrir às 8h10 e sair às 9h20 conta 2 horas)'),
      cartao('Relatórios gerados', fmtN(k.relatorios), relDesde, variacaoHtml('relatorios'), 'PNG, PDF, planilhas e shapes baixados da plataforma' + (rd ? ' (registrados desde ' + fmtData(rd) + ')' : '')),
      cartao('Mapas salvos', fmtN(k.mapasSalvos), 'mapas de chuva e de variedade', variacaoHtml('mapasSalvos')),
      cartao('Pedidos de atualização', fmtN(k.pedidos), 'plantio, chuva, validação, boletins e CAR', variacaoHtml('pedidos'), 'Botões Atualizar, Buscar no PIMS e Buscar nas bases. Antes do rastreio, o banco guardava os pedidos só por 7 a 30 dias' + (rd ? '; desde ' + fmtData(rd) + ' todos ficam registrados' : '') + '.'),
      cartao('Pelo celular', conhecidos ? fmtPct(movel / conhecidos) : '—', fmtN(movel) + ' de ' + fmtN(conhecidos) + ' acessos', '', 'Acessos pelo celular ou tablet (pelo aparelho da sessão)'),
      cartao('Precisam de atenção', fmtN(k.nunca + k.semAcesso30), fmtN(k.nunca) + (k.nunca === 1 ? ' nunca entrou · ' : ' nunca entraram · ') + fmtN(k.semAcesso30) + ' há 30+ dias', '', 'Veja a lista em "Precisa de atenção", no fim da página. Ativos na última semana: ' + fmtN(k.ativos7) + ' de ' + fmtN(k.cadastrados)),
    ].join('');
  }

  /* ---- uso por dia ---- */
  function escala(max, inteiro) {
    if (!(max > 0)) return { topo: inteiro ? 4 : 1, passo: inteiro ? 1 : 0.25 };
    const bruto = max / 4;
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    let passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((x) => x >= bruto);
    if (inteiro) passo = Math.max(1, Math.ceil(passo));
    return { topo: Math.ceil(max / passo - 1e-9) * passo, passo };
  }
  /** Barra com as pontas de cima arredondadas (4 px) e a base reta, apoiada no eixo. */
  function caminhoBarra(x, y, w, base) {
    const h = base - y;
    if (h <= 0) return '';
    const rr = Math.min(4, w / 2, h);
    return 'M' + x + ',' + base + 'V' + (y + rr) + 'Q' + x + ',' + y + ' ' + (x + rr) + ',' + y + 'H' + (x + w - rr) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + rr) + 'V' + base + 'Z';
  }
  function desenharSerie() {
    const el = $('grafico-dias');
    const s = r.serie, met = METRICAS[estado.metrica];
    const valores = s.map(met.valor);
    const max = Math.max(0, ...valores);
    const W = Math.max(260, el.clientWidth - 36), H = 220;
    const m = { t: 10, r: 6, b: 24, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, base = m.t + ih;
    const esc_ = escala(max, true);
    const y = (v) => m.t + ih - (v / esc_.topo) * ih;
    const slot = iw / s.length;
    const gap = slot >= 6 ? Math.min(8, Math.max(2, slot * 0.22)) : slot >= 3 ? 1 : 0;
    const bw = Math.max(1, slot - gap);
    let g = '<g class="grade">';
    for (let v = 0; v <= esc_.topo + 1e-9; v += esc_.passo) {
      const yy = y(v).toFixed(1);
      g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (m.l - 6) + '" y="' + yy + '" dy="0.32em" text-anchor="end">' + esc(met.fmt(v)) + '</text>';
    }
    g += '</g>';
    // dias sem registro: antes do rastreio (relatórios) ou antes do histórico de sessões (o resto)
    const limite = estado.metrica === 'relatorios' ? (rastreioDia() || L.somarDias(hoje, 1)) : historicoDia();
    const nSem = limite ? s.filter((d) => d.dia < limite).length : 0;
    if (nSem) {
      const largura = nSem * slot;
      g += '<rect class="sem-registro" x="' + m.l + '" y="' + m.t + '" width="' + largura.toFixed(1) + '" height="' + ih + '"/>';
      if (largura >= 70) g += '<text class="sem-registro-texto" x="' + (m.l + largura / 2).toFixed(1) + '" y="' + (m.t + 16) + '" text-anchor="middle">' + esc(largura >= 150 && nSem < s.length ? 'sem registro antes de ' + fmtDataCurta(limite) : 'sem registro') + '</text>';
    }
    const passoRotulo = Math.max(1, Math.ceil(48 / slot));
    let barras = '', rotulos = '<g class="eixo">';
    s.forEach((d, i) => {
      const x = m.l + i * slot + gap / 2;
      const v = valores[i];
      const linhas = [SEMANA_LONGA[d.semana] + ', ' + fmtData(d.dia), fmtN(d.ativos) + (d.ativos === 1 ? ' usuário ativo' : ' usuários ativos'), fmtN(d.acessos) + (d.acessos === 1 ? ' acesso' : ' acessos'), fmtH(d.horas) + ' de uso'];
      linhas.push(i < nSem && estado.metrica === 'relatorios' ? 'Relatórios: sem registro (antes do rastreio)' : fmtN(d.relatorios) + (d.relatorios === 1 ? ' relatório' : ' relatórios'));
      if (d.mapas) linhas.push(fmtN(d.mapas) + (d.mapas === 1 ? ' mapa salvo' : ' mapas salvos'));
      barras += '<rect class="alvo" x="' + (m.l + i * slot).toFixed(1) + '" y="' + m.t + '" width="' + slot.toFixed(1) + '" height="' + ih + '" data-dica="' + esc(linhas.join('\n')) + '"/>';
      barras += '<path class="barra-dia' + (d.semana === 0 || d.semana === 6 ? ' fim-de-semana' : '') + '" d="' + caminhoBarra(+x.toFixed(1), +y(v).toFixed(1), +bw.toFixed(1), base) + '"/>';
      if ((s.length - 1 - i) % passoRotulo === 0) rotulos += '<text x="' + (m.l + i * slot + slot / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(fmtDataCurta(d.dia)) + '</text>';
    });
    rotulos += '</g>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc('Uso por dia: ' + met.nome) + '">' + g + barras + rotulos + '</svg>' +
      '<div class="legenda-mini"><span><i style="background:var(--verde-teal)"></i>Dias úteis</span><span><i style="background:#7FAFA4"></i>Sábado e domingo</span></div>';
    // subtítulo: média e pico
    // a média só conta os dias com registro (a faixa "sem registro" fica de fora)
    const comRegistro = valores.slice(nSem);
    const media = comRegistro.reduce((a, b) => a + b, 0) / (comRegistro.length || 1);
    const iPico = valores.indexOf(max);
    $('serie-sub').textContent = max > 0
      ? 'Média de ' + fmtN(media, 1) + ' ' + met.nome + ' por dia' + (nSem ? ' (desde ' + fmtDataCurta(s[nSem] ? s[nSem].dia : limite) + ')' : '') + ' · pico de ' + fmtN(max) + ' em ' + fmtDataCurta(s[iPico].dia) + ' (' + SEMANA[s[iPico].semana] + ')'
      : 'Nenhum registro de ' + met.nome + ' no período.';
  }

  /* ---- últimos 14 dias ---- */
  function desenharUltimosDias() {
    const fim = r.ate;
    const dias = L.diasEntre(L.somarDias(fim, -13), fim);
    const porU = L.atividadePorDia(dados, new Set(r.usuarios.map((u) => u.id)));
    const linhas = r.usuarios
      .map((u) => {
        const m = new Map();
        let acessos = 0, horas = 0;
        (porU.get(u.id) || new Map()).forEach((x, d) => { if (d >= dias[0] && d <= fim) { m.set(d, x); acessos += x.acessos; horas += x.horas; } });
        return { u, m, diasUso: m.size, acessos, horas };
      })
      .filter((l) => l.diasUso || (estado.fazenda !== null && !l.u.todasFazendas))
      .sort((a, b) => b.diasUso - a.diasUso || b.horas - a.horas || a.u.nome.localeCompare(b.u.nome, 'pt-BR'));
    if (!linhas.length) { $('ultimos-dias').innerHTML = vazio('Ninguém usou a plataforma nesses 14 dias.'); return; }
    let h = '<table class="tabela grade-dias"><thead><tr><th>Usuário</th>';
    dias.forEach((d) => { const sem = L.diaDaSemana(d); h += '<th class="q" title="' + esc(SEMANA_LONGA[sem] + ', ' + fmtData(d)) + '">' + SEMANA_LETRA[sem] + '<br>' + esc(d.slice(8, 10)) + '</th>'; });
    h += '<th class="n">Dias</th><th class="n">Acessos</th><th class="n">Horas</th></tr></thead><tbody>';
    for (const l of linhas) {
      h += '<tr><td class="nome-usuario"><b>' + esc(l.u.nome) + '</b></td>';
      for (const d of dias) {
        const x = l.m.get(d);
        const nivel = !x ? '' : x.horas >= 4 ? ' n3' : x.horas >= 2 ? ' n2' : ' n1';
        const texto = l.u.nome + '\n' + SEMANA_LONGA[L.diaDaSemana(d)] + ', ' + fmtData(d) + '\n' +
          (!x ? 'Sem uso' : fmtN(x.acessos) + (x.acessos === 1 ? ' acesso' : ' acessos') + ' · ' + fmtH(x.horas) + ' de uso');
        h += '<td class="q"><span class="quadrado' + nivel + '" data-dica="' + esc(texto) + '"></span></td>';
      }
      h += num(l.diasUso) + num(l.acessos) + num(l.horas, fmtH(l.horas)) + '</tr>';
    }
    h += '</tbody></table><div class="legenda-mini"><span><i class="quadrado"></i>Sem uso</span><span><i class="quadrado n1"></i>Até 1 hora</span><span><i class="quadrado n2"></i>2 a 3 horas</span><span><i class="quadrado n3"></i>4 horas ou mais</span></div>';
    $('ultimos-dias').innerHTML = h;
  }

  /** O "?" no título de uma coluna: passar o mouse (ou tocar) mostra a explicação. */
  const ajuda = (texto) => (texto ? ' <span class="ajuda" role="img" aria-label="' + esc(texto) + '" data-dica="' + esc(texto) + '">?</span>' : '');
  /** Datas que entram nas explicações (o rastreio da plataforma começou depois do histórico de sessões). */
  const desdeRastreio = () => { const rd = rastreioDia(); return rd ? ' (registrado desde ' + fmtData(rd) + ')' : ' (registrado a partir desta versão)'; };
  const AJUDA = {
    usuario: 'Nome e e-mail do cadastro. Administrador e Administrador+ aparecem marcados.',
    unidades: 'Unidades liberadas no cadastro da pessoa. "Todas" é o administrador que vê todas.',
    acessos: 'Quantas vezes a pessoa usou a plataforma no período. Horas seguidas de uso contam como um acesso: abrir às 8h e usar até as 10h é 1 acesso; voltar às 14h é mais 1. O número pequeno diz quantos foram pelo celular.',
    pctAcessos: 'A parte da pessoa no total de acessos de todos no período (com os filtros escolhidos). A barra compara com quem mais acessou.',
    diasAtivos: 'Em quantos dias a pessoa usou a plataforma, de quantos podia usar: do começo do período ou do cadastro dela, o que for mais recente. A porcentagem é a frequência.',
    relatorios: 'Arquivos baixados da plataforma: PNG, PDF, planilhas e shapes.',
    mapasSalvos: 'Mapas de chuva e de variedade salvos no módulo Mapas.',
    pedidos: 'Pedidos de atualização feitos pelos botões Atualizar, Buscar no PIMS e Buscar nas bases.',
    horasUso: 'Horas do relógio com a plataforma aberta: abrir às 8h10 e sair às 9h20 conta 2 horas.',
    modulos: 'Módulos que a pessoa abriu no período.',
    ultimoAcesso: 'O último sinal de uso em qualquer data: sessão, login, tela, pedido, mapa ou cadastro.',
    situacao: 'Ativo: usou nos últimos 7 dias. Esfriando: último uso entre 8 e 30 dias. Inativo: mais de 30 dias sem usar. Nunca acessou: cadastrado e nunca entrou.',
  };
  const COLUNAS_USUARIOS = [
    ['nome', 'Usuário', false, 'usuario'], ['fazendas', 'Unidades', false, 'unidades'], ['acessos', 'Acessos', true, 'acessos'], ['pctAcessos', '% dos acessos', true, 'pctAcessos'],
    ['diasAtivos', 'Dias ativos', true, 'diasAtivos'], ['relatorios', 'Relatórios', true, 'relatorios'], ['mapasSalvos', 'Mapas salvos', true, 'mapasSalvos'], ['pedidos', 'Pedidos', true, 'pedidos'],
    ['horasUso', 'Horas de uso', true, 'horasUso'], ['modulos', 'Módulos usados', false, 'modulos'], ['ultimoAcesso', 'Último acesso', true, 'ultimoAcesso'], ['situacao', 'Situação', false, 'situacao'],
  ];
  /** O texto de ajuda de uma coluna (os do rastreio dizem desde quando há registro). */
  const textoAjuda = (k) => AJUDA[k] + (k === 'relatorios' || k === 'modulos' ? desdeRastreio() : '');
  const ORDEM_SITUACAO = { ativo: 0, esfriando: 1, inativo: 2, nunca: 3 };
  function desenharUsuarios() {
    const busca = estado.busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let lista = r.usuarios.filter((u) => !busca || semAcento(u.nome).includes(busca) || semAcento(u.email).includes(busca));
    const { chave, desc } = estado.ordem;
    const valor = (u) => chave === 'nome' ? semAcento(u.nome) : chave === 'situacao' ? ORDEM_SITUACAO[u.situacao] : chave === 'ultimoAcesso' ? (u.ultimoAcesso || '') : u[chave];
    lista = lista.slice().sort((a, b) => {
      const va = valor(a), vb = valor(b);
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
      return (desc ? -c : c) || a.nome.localeCompare(b.nome, 'pt-BR');
    });
    if (!r.usuarios.length) { $('tab-usuarios').innerHTML = vazio('Nenhum usuário neste filtro.'); return; }
    const maxPct = Math.max(0.0001, ...r.usuarios.map((u) => u.pctAcessos));
    let h = '<table class="tabela"><thead><tr>';
    for (const [k, rotulo, numerica, chaveAjuda] of COLUNAS_USUARIOS) {
      const ordenavel = k !== 'fazendas' && k !== 'modulos';
      const sort = chave === k ? (desc ? 'descending' : 'ascending') : 'none';
      h += '<th' + (numerica ? ' class="n' + (ordenavel ? ' ordenavel' : '') + '"' : ordenavel ? ' class="ordenavel"' : '') + (ordenavel ? ' data-ordem="' + k + '" aria-sort="' + sort + '" tabindex="0"' : '') + '>' + esc(rotulo) + ajuda(textoAjuda(chaveAjuda)) + '</th>';
    }
    h += '</tr></thead><tbody>';
    if (!lista.length) h += '<tr><td colspan="' + COLUNAS_USUARIOS.length + '">' + vazio('Nenhum usuário com esse nome ou e-mail.') + '</td></tr>';
    for (const u of lista) {
      const unidades = u.fazendasNomes.length ? u.fazendasNomes : ['—'];
      const unidadesTexto = unidades.length > 2 ? unidades.slice(0, 2).join(', ') + ' +' + (unidades.length - 2) : unidades.join(', ');
      const movel = (u.dispositivos.celular || 0) + (u.dispositivos.tablet || 0);
      h += '<tr>' +
        '<td><span class="nome-usuario"><b>' + esc(u.nome) + '</b>' + (u.perfil === 'admin' ? '<span class="etiqueta">' + esc(perfilTexto(u)) + '</span>' : '') + '</span><small>' + esc(u.email) + '</small></td>' +
        '<td' + (unidades.length > 2 ? ' data-dica="' + esc(unidades.join('\n')) + '"' : '') + '>' + esc(unidadesTexto) + '</td>' +
        '<td class="n' + (u.acessos ? '' : ' fraco') + '">' + esc(fmtN(u.acessos)) + (movel ? '<small>' + esc(fmtN(movel)) + ' pelo celular</small>' : '') + '</td>' +
        '<td class="n">' + barraCel(u.pctAcessos / maxPct, fmtPct(u.pctAcessos, 1)) + '</td>' +
        '<td class="n' + (u.diasAtivos ? '' : ' fraco') + '"' + (u.desdeCadastro ? ' data-dica="' + esc('Cadastrado em ' + fmtData(u.criadoEm) + ': podia usar em ' + fmtN(u.diasPossiveis) + ' dos ' + fmtN(r.dias.length) + ' dias do período') + '"' : '') + '>' +
          esc(fmtN(u.diasAtivos) + ' de ' + fmtN(u.diasPossiveis)) + '<small>' + esc(fmtPct(u.frequencia) + (u.desdeCadastro ? ' desde o cadastro' : ' dos dias')) + '</small></td>' +
        num(u.relatorios) + num(u.mapasSalvos) + num(u.pedidos) + num(u.horasUso, fmtH(u.horasUso)) +
        '<td class="col-modulos"><small>' + esc(u.modulos.length ? u.modulos.map(L.nomeModulo).join(', ') : '—') + '</small></td>' +
        '<td class="n">' + (u.ultimoAcesso ? esc(fmtData(u.ultimoAcesso)) + '<small>' + esc(quando(u.ultimoAcesso)) + '</small>' : '<span class="fraco">Nunca</span>') + '</td>' +
        '<td>' + situacaoHtml(u.situacao) + '</td></tr>';
    }
    h += '</tbody></table>';
    $('tab-usuarios').innerHTML = h;
  }

  /* ---- unidades ---- */
  function desenharUnidades() {
    if (!r.unidades.length) { $('tab-unidades').innerHTML = vazio('Nenhuma unidade com usuários ou uso no período.'); return; }
    const maxAcessos = Math.max(1, ...r.unidades.map((u) => u.acessos));
    const rd = rastreioDia();
    const th = (rotulo, texto, numerica) => '<th' + (numerica ? ' class="n"' : '') + '>' + esc(rotulo) + ajuda(texto) + '</th>';
    let h = '<table class="tabela"><thead><tr>' +
      th('Unidade', 'Clique numa unidade para ver o painel só dela.') +
      th('Liberados', 'Usuários com a unidade no cadastro (os administradores que veem todas não entram).', true) +
      th('Usaram', 'Quantos dos liberados usaram a plataforma no período, e a porcentagem (adesão da unidade).', true) +
      th('Acessos', 'Acessos dos usuários liberados na unidade (quem tem mais de uma unidade conta em cada uma).', true) +
      th('Horas de uso', 'Horas de uso dos usuários liberados na unidade.', true) +
      th('Ações na unidade', 'Módulos, telas e relatórios abertos com esta unidade escolhida na barra do rodapé, de qualquer usuário' + desdeRastreio() + '.', true) +
      th('Relatórios', 'Arquivos baixados com esta unidade escolhida na barra do rodapé' + desdeRastreio() + '.', true) +
      th('Mapas salvos', 'Mapas de chuva e de variedade salvos desta unidade.', true) +
      '</tr></thead><tbody>';
    for (const u of r.unidades) {
      h += '<tr><td><button type="button" class="link-unidade" data-fazenda="' + u.id + '" title="Ver o painel só desta unidade">' + esc(u.nome) + '</button></td>' +
        num(u.liberados) +
        '<td class="n" data-dica="' + esc(fmtN(u.ativos) + ' de ' + fmtN(u.liberados) + ' usuários liberados usaram no período') + '">' + (u.liberados ? barraCel(u.adesao, fmtN(u.ativos) + ' · ' + fmtPct(u.adesao)) : '<span class="fraco">—</span>') + '</td>' +
        '<td class="n">' + barraCel(u.acessos / maxAcessos, fmtN(u.acessos)) + '</td>' +
        num(u.horas, fmtH(u.horas)) + num(u.acoes) + num(u.relatorios) + num(u.mapas) + '</tr>';
    }
    h += '</tbody></table><p class="explica nota">Liberados: usuários com a unidade no cadastro (os administradores que veem todas não entram). Acessos e horas: dos usuários liberados (quem tem mais de uma unidade conta em cada uma). ' +
      'Ações e relatórios: módulos, telas e arquivos com a unidade escolhida na barra do rodapé, de qualquer usuário' + (rd ? ', registrados desde ' + esc(fmtData(rd)) : '') + '.</p>';
    $('tab-unidades').innerHTML = h;
  }

  /* ---- módulos ---- */
  function desenharModulos() {
    if (!r.modulos.length) { $('tab-modulos').innerHTML = vazio('Nenhum módulo aberto no período.'); return; }
    const maxH = Math.max(1, ...r.modulos.map((m) => m.horas));
    const th = (rotulo, texto, numerica) => '<th' + (numerica ? ' class="n"' : '') + '>' + esc(rotulo) + ajuda(texto) + '</th>';
    let h = '<table class="tabela"><thead><tr>' +
      th('Módulo', 'Os módulos da tela inicial' + desdeRastreio() + '.') +
      th('Usuários', 'Quantas pessoas usaram o módulo no período.', true) +
      th('Aberturas', 'Vezes que o módulo foi aberto pela tela inicial.', true) +
      th('Telas', 'Telas abertas dentro do módulo (cada troca de aba conta uma).', true) +
      th('Relatórios', 'Arquivos baixados no módulo; no Mapas, mais os mapas salvos.', true) +
      th('Horas de uso', 'Horas do relógio em que alguém usou o módulo (somando as pessoas).', true) +
      '</tr></thead><tbody>';
    for (const m of r.modulos) {
      h += '<tr><td><b>' + esc(m.nome) + '</b></td>' + num(m.usuarios) + num(m.aberturas) + num(m.telas) + num(m.relatorios + m.mapas, fmtN(m.relatorios + m.mapas)) +
        '<td class="n">' + barraCel(m.horas / maxH, fmtH(m.horas)) + '</td></tr>';
    }
    const rd = rastreioDia();
    h += '</tbody></table><p class="explica nota">Aberturas: vezes que o módulo foi aberto pela tela inicial. Relatórios do Mapas incluem os mapas salvos. Horas: horas do relógio com o módulo em uso' + (rd ? ' (registrado desde ' + esc(fmtData(rd)) + ')' : '') + '.</p>';
    $('tab-modulos').innerHTML = h;
  }

  /* ---- relatórios ---- */
  function tabelaSimples(lista, rotulo, coluna) {
    if (!lista.length) return '';
    const max = Math.max(1, ...lista.map((x) => x.n));
    let h = '<table class="tabela"><thead><tr><th>' + esc(rotulo) + '</th><th class="n">' + esc(coluna || 'Quantidade') + '</th></tr></thead><tbody>';
    for (const x of lista) h += '<tr><td>' + esc(x.nome) + '</td><td class="n">' + barraCel(x.n / max, fmtN(x.n)) + '</td></tr>';
    return h + '</tbody></table>';
  }
  function desenharRelatorios() {
    const rel = r.relatorios, k = r.kpis;
    if (!k.relatorios && !k.mapasSalvos && !k.pedidos) { $('relatorios').innerHTML = vazio('Nenhum relatório baixado, mapa salvo ou pedido de atualização no período.'); return; }
    const bloco = (n, texto) => '<div class="rel-bloco"><b>' + esc(fmtN(n)) + '</b><span>' + esc(texto) + '</span></div>';
    let h = '<div class="rel-blocos">' + bloco(k.relatorios, 'arquivos baixados');
    for (const t of rel.porTipo) h += bloco(t.n, t.nome);
    h += bloco(k.mapasSalvos, 'mapas salvos') + bloco(k.pedidos, 'pedidos de atualização') + '</div>';
    if (rel.porModulo.length) h += '<p class="subtitulo">Arquivos por módulo</p>' + tabelaSimples(rel.porModulo, 'Módulo', 'Arquivos');
    if (rel.top.length) h += '<p class="subtitulo">Os mais baixados</p>' + tabelaSimples(rel.top, 'Relatório (módulo · nome · formato)', 'Vezes');
    if (rel.mapas.length) h += '<p class="subtitulo">Mapas salvos</p>' + tabelaSimples(rel.mapas, 'Tipo de mapa');
    if (rel.pedidos.length) h += '<p class="subtitulo">Pedidos de atualização</p>' + tabelaSimples(rel.pedidos, 'Pedido');
    $('relatorios').innerHTML = h;
  }

  /* ---- telas ---- */
  function desenharTelas() {
    if (!r.telas.length) { $('tab-telas').innerHTML = vazio('Nenhuma tela aberta dentro dos módulos no período.'); return; }
    const max = Math.max(1, ...r.telas.map((t) => t.n));
    let h = '<table class="tabela"><thead><tr><th>Tela</th><th class="n">Aberturas</th><th class="n">Usuários</th></tr></thead><tbody>';
    for (const t of r.telas) h += '<tr><td>' + esc(t.nome) + '</td><td class="n">' + barraCel(t.n / max, fmtN(t.n)) + '</td>' + num(t.usuarios) + '</tr>';
    $('tab-telas').innerHTML = h + '</tbody></table>';
  }

  /* ---- horários (verde claro → escuro: mais atividade) ---- */
  const TONS = ['#F1F4F2', '#D3E8DF', '#A6CFC1', '#6FA898', '#3C8274', '#0C5A50'];
  function desenharCalor() {
    const max = Math.max(0, ...r.calor.map((l) => Math.max(...l)));
    if (!max) { $('calor').innerHTML = vazio('Nenhuma atividade registrada no período.'); return; }
    const ordem = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo
    let h = '<table class="calor"><thead><tr><th></th>';
    for (let hr = 0; hr < 24; hr++) h += '<th>' + (hr % 3 === 0 ? hr + 'h' : '') + '</th>';
    h += '</tr></thead><tbody>';
    for (const d of ordem) {
      h += '<tr><th>' + esc(SEMANA[d]) + '</th>';
      for (let hr = 0; hr < 24; hr++) {
        const v = r.calor[d][hr];
        const nivel = v ? Math.min(5, 1 + Math.floor((v / max) * 4.999)) : 0;
        h += '<td style="background:' + TONS[nivel] + '" data-dica="' + esc(SEMANA_LONGA[d] + ', das ' + hr + 'h às ' + (hr + 1) + 'h\n' + fmtN(v) + (v === 1 ? ' hora de uso' : ' horas de uso') + ' (somando pessoas e dias)') + '"></td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table><div class="legenda-mini legenda-calor"><span>Menos</span>' + TONS.map((c) => '<i style="background:' + c + '"></i>').join('') + '<span>Mais</span></div>';
    $('calor').innerHTML = h;
  }

  /* ---- precisa de atenção ---- */
  function desenharAtencao() {
    if (!r.atencao.length) { $('tab-atencao').innerHTML = vazio('Todos os usuários deste filtro acessaram nos últimos 30 dias.'); return; }
    let h = '<table class="tabela"><thead><tr><th>Usuário</th><th>Unidades</th><th class="n">Cadastrado em</th><th class="n">Último acesso</th><th>Situação</th></tr></thead><tbody>';
    for (const u of r.atencao) {
      h += '<tr><td><span class="nome-usuario"><b>' + esc(u.nome) + '</b></span><small>' + esc(u.email) + '</small></td>' +
        '<td><small>' + esc(u.fazendasNomes.join(', ') || '—') + '</small></td>' +
        '<td class="n">' + esc(fmtData(u.criadoEm)) + '</td>' +
        '<td class="n">' + (u.ultimoAcesso ? esc(fmtData(u.ultimoAcesso)) + '<small>' + esc(quando(u.ultimoAcesso)) + '</small>' : '<span class="fraco">Nunca</span>') + '</td>' +
        '<td>' + situacaoHtml(u.situacao) + '</td></tr>';
    }
    $('tab-atencao').innerHTML = h + '</tbody></table>';
  }

  /* ------------------------------ dica (tooltip) ------------------------------ */
  const dica = $('dica');
  function mostrarDica(alvo, x, y) {
    const linhas = String(alvo.dataset.dica || '').split('\n');
    dica.textContent = '';
    linhas.forEach((t, i) => {
      if (i) dica.appendChild(document.createElement('br'));
      const el = document.createElement(i === 0 && linhas.length > 1 ? 'b' : 'span');
      el.textContent = t;
      dica.appendChild(el);
    });
    dica.hidden = false;
    posicionarDica(x, y);
  }
  function posicionarDica(x, y) {
    const w = dica.offsetWidth, h = dica.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    dica.style.left = Math.max(8, left) + 'px';
    dica.style.top = Math.max(8, top) + 'px';
  }
  document.addEventListener('mouseover', (e) => {
    const alvo = e.target.closest && e.target.closest('[data-dica]');
    if (alvo) mostrarDica(alvo, e.clientX, e.clientY);
    else dica.hidden = true;
  });
  document.addEventListener('mousemove', (e) => { if (!dica.hidden) posicionarDica(e.clientX, e.clientY); });
  document.addEventListener('scroll', () => { dica.hidden = true; }, true);

  /* ------------------------------ eventos ------------------------------ */
  $('sel-periodo').addEventListener('change', (e) => {
    estado.periodo = e.target.value;
    const custom = estado.periodo === 'custom';
    $('campo-de').hidden = !custom;
    $('campo-ate').hidden = !custom;
    if (custom) {
      const p = r ? { de: r.de, ate: r.ate } : L.periodo('30', hoje);
      $('dt-de').value = p.de;
      $('dt-ate').value = p.ate;
      $('dt-ate').max = hoje;
      $('dt-de').max = hoje;
    }
    carregar();
  });
  ['dt-de', 'dt-ate'].forEach((id) => $(id).addEventListener('change', () => carregar()));
  $('sel-perfil').addEventListener('change', (e) => { estado.perfil = e.target.value; desenhar(); });
  $('btn-atualizar').addEventListener('click', () => carregar());
  $('btn-limpar-unidade').addEventListener('click', () => { estado.fazenda = null; desenhar(); });
  $('tab-unidades').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fazenda]');
    if (!b) return;
    estado.fazenda = Number(b.dataset.fazenda);
    desenhar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('metricas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-metrica]');
    if (!b) return;
    estado.metrica = b.dataset.metrica;
    $('metricas').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    desenharSerie();
  });
  $('busca').addEventListener('input', (e) => { estado.busca = e.target.value; desenharUsuarios(); });
  function ordenarPor(th) {
    const k = th.dataset.ordem;
    if (estado.ordem.chave === k) estado.ordem.desc = !estado.ordem.desc;
    else estado.ordem = { chave: k, desc: k !== 'nome' && k !== 'situacao' };
    desenharUsuarios();
    const novo = $('tab-usuarios').querySelector('th[data-ordem="' + k + '"]');
    if (novo) novo.focus();
  }
  // o "?" do título só explica a coluna (tocar nele no celular não ordena)
  $('tab-usuarios').addEventListener('click', (e) => { if (e.target.closest('.ajuda')) return; const th = e.target.closest('th[data-ordem]'); if (th) ordenarPor(th); });
  $('tab-usuarios').addEventListener('keydown', (e) => { const th = e.target.closest('th[data-ordem]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ordenarPor(th); } });
  $('btn-csv').addEventListener('click', () => {
    if (!r) return;
    const blob = new Blob(['﻿' + L.csvUsuarios(r)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aderencia_usuarios_' + r.de + '_a_' + r.ate + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  let espera = null;
  window.addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => { if (r) desenharSerie(); }, 150); });

  /* ------------------------------ início ------------------------------ */
  if (EMBED) document.documentElement.classList.add('embed');
  (async function iniciar() {
    fonte = TESTE ? fonteTeste() : fonteSupabase();
    try {
      await fonte.pronto();
    } catch (e) { erroInicial(e); return; }
    await carregar();
    if (dados) $('carregando').classList.add('fora');
  })();
})();
