/* =====================================================================
   Chuva por talhão — módulo do COA WEB (categoria própria)
   Mapa da fazenda pintado pela chuva de cada talhão, com a tabela ao lado: clicar no talhão destaca a linha
   e aproxima o mapa; clicar na linha aproxima o talhão. A chuva de cada talhão vem pronta da ZEUS (tabela
   stg_field_data, a base do relatório Power BI), gravada pelo servidor em chuva_talhao junto com os ciclos
   do PIMS; os limites vêm do cadastro do Mapas (mapas_talhoes e mapas_areas_cultura).
   - COA → módulo: { tipo:'coa-fazenda', id, nome } e { tipo:'chuva-vista', vista }
   - módulo → COA: { tipo:'chuva-rota', vista }
===================================================================== */
(function () {
  'use strict';

  const L = window.ChuvaLogica;
  const CFG = window.CHUVA_CONFIG || {};
  const PARAMS = new URLSearchParams(location.search);
  const EMBED = PARAMS.get('embed') === '1';
  const NS = 'http://www.w3.org/2000/svg';
  /* no "Dia a dia", no máximo estes dias (os mais recentes do período) */
  const MAX_DIAS_GRADE = 45;
  /* o gráfico do talhão mostra pelo menos estes dias, para a chuva do período ter contexto */
  const DIAS_GRAFICO = 30;

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, um, varios) => (n === 1 ? um : varios);

  const estado = {
    vista: ['mapa', 'diario', 'pics'].indexOf(PARAMS.get('vista')) >= 0 ? PARAMS.get('vista') : 'mapa',
    fazenda: null, periodo: PARAMS.get('periodo') || '7',
    de: PARAMS.get('de'), ate: PARAMS.get('ate'), limites: 'auto', modo: PARAMS.get('modo') === 'seca' ? 'seca' : 'chuva', pics: true, sel: null,
    ordem: { col: 'codigo', desc: false }, busca: '',
  };
  let fonte = null;
  let fazendas = [];   // [{ id, nome, unidade, coaId }]
  let safras = [];     // [{ id, nome, inicio }]
  const cache = {};    // dados de cada fazenda já lida
  let atual = null;    // fazenda na tela: { f, dados, faz, talhoes, proj, caixa, per, linhas, limites }
  let coaFazenda;      // fazenda escolhida no COA WEB (quando o módulo está no iframe)
  let pedido = 0;      // só a leitura mais recente desenha a tela
  let fazendaDoCiclo = null; // de qual fazenda é o ciclo escolhido no Período
  let grafico = null;

  /* ------------------------------ dados ------------------------------ */
  function fonteSupabase() {
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { autoRefreshToken: !EMBED, persistSession: true } });
    async function tudo(criar, passo) {
      let saida = [];
      for (let de = 0; ; de += passo) {
        const r = await criar().range(de, de + passo - 1);
        if (r.error) throw r.error;
        saida = saida.concat(r.data || []);
        if (!r.data || r.data.length < passo) return saida;
      }
    }
    return {
      pronto: async function () {
        const s = await sb.auth.getSession();
        if (!s.data || !s.data.session) throw new Error(EMBED ? 'Sua sessão expirou. Entre de novo no COA WEB.' : 'Entre no COA WEB para ver a Chuva por talhão.');
      },
      // a segurança do banco já entrega só as fazendas liberadas para o usuário
      cadastro: async function () {
        const r = await Promise.all([
          tudo(() => sb.from('mapas_fazendas').select('id,nome,unidade_pims,coa_fazenda_id').order('nome'), 1000),
          tudo(() => sb.from('mapas_safras').select('id,nome,inicio').order('inicio', { ascending: false }), 1000),
        ]);
        return { fazendas: r[0], safras: r[1] };
      },
      fazenda: async function (f) {
        // páginas pequenas: cada linha traz um polígono inteiro
        const colunas = 'unidade,gerado_em,inicio,dias,ultima_leitura,pics,vinculos';
        const chuva = (cols) => (f.unidade ? sb.from('chuva_talhao').select(cols).eq('unidade', f.unidade).limit(1) : Promise.resolve({ data: [] }));
        const r = await Promise.all([
          tudo(() => sb.from('mapas_talhoes').select('codigo,nome,area_ha,geom').eq('fazenda_id', f.id).order('id'), 200),
          tudo(() => sb.from('mapas_areas_cultura').select('safra_id,codigo,area_ha,geom').eq('fazenda_id', f.id).order('id'), 200),
          chuva(colunas + ',ultimo_dia,lidos,talhoes,ciclos'),
        ]);
        let c = r[2];
        const texto = (e) => (e ? (e.code || '') + ' ' + (e.message || '') : '');
        // sem as colunas da chuva por talhão (script 0014 ainda não aplicado): lê o que existe e avisa
        const semColunas = /42703|PGRST204|column .* does not exist/i.test(texto(c.error));
        if (semColunas) c = await chuva(colunas);
        const semTabela = /PGRST205|42P01|could not find the table/i.test(texto(c.error));
        if (c.error && !semTabela) throw c.error;
        return { talhoes: r[0], areas: r[1], chuva: (c.data && c.data[0]) || null, semTabela: semTabela, semColunas: semColunas };
      },
    };
  }
  /* servidor local de testes (modulos/chuva/scripts/servidor-local.mjs): fazenda fictícia */
  function fonteLocal() {
    const ler = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error('servidor local sem dados de teste'); return r.json(); };
    return {
      pronto: async function () {},
      cadastro: function () { return ler('/api/chuva-teste'); },
      fazenda: function (f) { return ler('/api/chuva-teste/fazenda?id=' + encodeURIComponent(f.id)); },
    };
  }

  /* ------------------------------ limites da fazenda ------------------------------ */
  function safrasDaFazenda(dados) {
    const tem = {};
    (dados.areas || []).forEach((a) => { tem[a.safra_id] = true; });
    return safras.filter((s) => tem[s.id]);
  }
  /** Qual conjunto de limites desenhar: 'base' (todos os talhões) ou o id de uma safra com áreas. */
  function limitesEscolhidos(dados) {
    const comArea = safrasDaFazenda(dados);
    if (estado.limites !== 'auto' && (estado.limites === 'base' || comArea.some((s) => s.id === estado.limites))) return estado.limites;
    return comArea.length ? comArea[0].id : 'base';
  }
  /** Talhões a desenhar: um por código (pedaços do mesmo talhão viram um só), com centro, caixa e caminho. */
  function montarTalhoes(dados, qual) {
    const origem = qual === 'base' ? dados.talhoes || [] : (dados.areas || []).filter((a) => a.safra_id === qual);
    const porCodigo = new Map();
    let semCodigo = 0;
    origem.forEach((t) => {
      const codigo = String(t.codigo || '').trim();
      const chave = codigo || '\u0000' + (++semCodigo);
      const pols = L.poligonos(t.geom);
      if (!pols.length) return;
      if (!porCodigo.has(chave)) porCodigo.set(chave, { codigo: codigo, nome: codigo || 'Sem código ' + semCodigo, area: 0, pols: [] });
      const x = porCodigo.get(chave);
      x.area += Number(t.area_ha) || 0;
      x.pols = x.pols.concat(pols);
    });
    const lista = Array.from(porCodigo.values()).map((x) => {
      const geom = { type: 'MultiPolygon', coordinates: x.pols };
      return { codigo: x.codigo, nome: x.nome, area: x.area, geom: geom, centro: L.centroGeom(geom), caixaGeo: L.caixaGeom(geom) };
    }).filter((t) => t.caixaGeo);
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
    return lista;
  }

  /* ------------------------------ mapa: vista, zoom e arrasto ------------------------------ */
  const svg = $('mapa');
  let vb = null;         // vista atual { x, y, w, h } em metros
  let animacao = null;
  let limiteVista = null; // { min, max } em metros por pixel
  function tela() {
    const r = $('mapa-caixa').getBoundingClientRect();
    return { largura: Math.max(60, r.width), altura: Math.max(60, r.height) };
  }
  function aplicarVista() {
    if (!vb) return;
    svg.setAttribute('viewBox', vb.x.toFixed(1) + ' ' + vb.y.toFixed(1) + ' ' + vb.w.toFixed(1) + ' ' + vb.h.toFixed(1));
    const mpp = vb.w / tela().largura;
    $('g-rotulos').setAttribute('font-size', (11.5 * mpp).toFixed(2));
    // o rótulo só aparece quando cabe no talhão (o escolhido aparece sempre)
    (atual ? atual.talhoes : []).forEach((t, i) => {
      if (!t.rotulo) return;
      const cabe = i === estado.sel || (t.cx.w / mpp >= 40 && t.cx.h / mpp >= 30);
      if (cabe !== t.rotuloVisivel) { t.rotuloVisivel = cabe; t.rotulo.style.display = cabe ? '' : 'none'; }
    });
  }
  /* a legenda fica por cima do rodapé do mapa: a fazenda é enquadrada acima dela */
  function vistaDaFazenda() { return L.vistaQueEnquadra(atual.caixa, tela(), 0.05, 1, Math.min(96, tela().altura * 0.22)); }
  let chegada = null;
  function pararAnimacao() {
    if (animacao) { cancelAnimationFrame(animacao); animacao = null; }
    if (chegada) { clearTimeout(chegada); chegada = null; }
  }
  function irPara(alvo, animado) {
    pararAnimacao();
    const semMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animado || !vb || semMovimento) { vb = alvo; aplicarVista(); return; }
    const de = vb, t0 = performance.now(), dur = 480;
    const passo = (agora) => {
      const k = Math.min(1, (agora - t0) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      vb = { x: de.x + (alvo.x - de.x) * e, y: de.y + (alvo.y - de.y) * e, w: de.w + (alvo.w - de.w) * e, h: de.h + (alvo.h - de.h) * e };
      aplicarVista();
      animacao = k < 1 ? requestAnimationFrame(passo) : null;
      if (k >= 1) pararAnimacao();
    };
    animacao = requestAnimationFrame(passo);
    // com a página em segundo plano o navegador não anima: o mapa chega ao destino do mesmo jeito
    chegada = setTimeout(() => { pararAnimacao(); vb = alvo; aplicarVista(); }, dur + 120);
  }
  /** Aproxima (fator < 1) ou afasta em torno de um ponto da tela (px dentro do mapa). */
  function zoom(fator, px, py, animado) {
    if (!vb) return;
    const t = tela();
    const mpp = vb.w / t.largura;
    const novo = Math.min(limiteVista.max, Math.max(limiteVista.min, mpp * fator));
    const k = novo / mpp;
    const fx = px === undefined ? 0.5 : px / t.largura, fy = py === undefined ? 0.5 : py / t.altura;
    irPara({ x: vb.x + vb.w * fx * (1 - k), y: vb.y + vb.h * fy * (1 - k), w: vb.w * k, h: vb.h * k }, !!animado);
  }
  function aproximarTalhao(i) {
    const t = atual.talhoes[i];
    const v = L.vistaQueEnquadra(t.cx, tela(), 0.75, 250);
    const mpp = Math.min(limiteVista.max, Math.max(limiteVista.min, v.w / tela().largura));
    const k = mpp / (v.w / tela().largura);
    irPara({ x: v.x + v.w * (1 - k) / 2, y: v.y + v.h * (1 - k) / 2, w: v.w * k, h: v.h * k }, true);
  }

  const ponteiros = new Map();
  let gesto = null; // { alvo, moveu, x, y } do toque/clique em andamento
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button > 0) return;
    pararAnimacao();
    esconderDica();
    const alvo = ev.target.closest ? ev.target.closest('[data-i],[data-p]') : null;
    ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ponteiros.size === 1) gesto = { alvo: alvo, moveu: false, x: ev.clientX, y: ev.clientY };
    else if (gesto) gesto.moveu = true;
    try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ponteiro já solto */ }
  });
  svg.addEventListener('pointermove', (ev) => {
    const p = ponteiros.get(ev.pointerId);
    if (!p) { mostrarDica(ev); return; }
    if (!vb) return;
    const mpp = vb.w / tela().largura;
    if (ponteiros.size === 1) {
      if (gesto && !gesto.moveu && Math.hypot(ev.clientX - gesto.x, ev.clientY - gesto.y) < 6) return;
      if (gesto) gesto.moveu = true;
      svg.classList.add('arrastando');
      vb = { x: vb.x - (ev.clientX - p.x) * mpp, y: vb.y - (ev.clientY - p.y) * mpp, w: vb.w, h: vb.h };
      aplicarVista();
    } else if (ponteiros.size === 2) {
      // pinça: a distância entre os dois dedos muda a escala, em torno do meio deles
      const outro = Array.from(ponteiros.entries()).filter((e) => e[0] !== ev.pointerId)[0][1];
      const antes = Math.hypot(p.x - outro.x, p.y - outro.y), depois = Math.hypot(ev.clientX - outro.x, ev.clientY - outro.y);
      const r = svg.getBoundingClientRect();
      if (antes > 0 && depois > 0) zoom(antes / depois, (ev.clientX + outro.x) / 2 - r.left, (ev.clientY + outro.y) / 2 - r.top, false);
    }
    p.x = ev.clientX; p.y = ev.clientY;
  });
  function soltar(ev) {
    if (!ponteiros.has(ev.pointerId)) return;
    ponteiros.delete(ev.pointerId);
    svg.classList.remove('arrastando');
    if (ponteiros.size || !gesto) return;
    const g = gesto;
    gesto = null;
    if (g.moveu || ev.type === 'pointercancel' || !g.alvo) return;
    if (g.alvo.hasAttribute('data-i')) {
      const i = Number(g.alvo.getAttribute('data-i'));
      selecionar(i === estado.sel ? null : i, 'mapa');
    }
  }
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', soltar);
  svg.addEventListener('pointerleave', esconderDica);
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    zoom(ev.deltaY > 0 ? 1.22 : 1 / 1.22, ev.clientX - r.left, ev.clientY - r.top, false);
  }, { passive: false });
  $('btn-mais').addEventListener('click', () => zoom(1 / 1.6, undefined, undefined, true));
  $('btn-menos').addEventListener('click', () => zoom(1.6, undefined, undefined, true));
  $('btn-fazenda').addEventListener('click', () => { if (atual) irPara(vistaDaFazenda(), true); });
  if (window.ResizeObserver) {
    let larguraAntes = 0;
    new ResizeObserver(() => {
      if (!vb || !atual) return;
      const t = tela();
      if (!larguraAntes) { larguraAntes = t.largura; }
      // mantém o centro e a escala; a proporção acompanha a caixa
      const mpp = vb.w / larguraAntes, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
      larguraAntes = t.largura;
      limiteVista = limitesDeZoom();
      vb = { x: cx - (mpp * t.largura) / 2, y: cy - (mpp * t.altura) / 2, w: mpp * t.largura, h: mpp * t.altura };
      aplicarVista();
    }).observe($('mapa-caixa'));
  }
  function limitesDeZoom() {
    const cheia = vistaDaFazenda().w / tela().largura;
    return { min: Math.min(cheia, 0.35), max: cheia * 2.2 };
  }

  /* ------------------------------ mapa: dica ao passar o mouse ------------------------------ */
  function mostrarDica(ev) {
    if (!atual || ev.pointerType === 'touch') return;
    const alvo = ev.target.closest ? ev.target.closest('[data-i],[data-p]') : null;
    if (!alvo) { esconderDica(); return; }
    let html;
    if (alvo.hasAttribute('data-i')) {
      const l = atual.linhas[Number(alvo.getAttribute('data-i'))];
      html = '<b>Talhão ' + esc(l.nome) + '</b>' +
        (l.semDado ? 'Sem dado: o talhão não está na tabela de chuva por talhão da ZEUS.'
          : 'Chuva no período: <span class="num">' + (l.total === null ? 'sem dado' : L.fmtMm(l.total) + ' mm') + '</span><br>' +
            (l.ultima ? 'Última chuva: <span class="num">' + L.fmtDia(L.somarDias(atual.faz.inicio, l.ultima.i)) + ' · ' + L.fmtMm(l.ultima.mm) + ' mm</span> (' + textoDiasSem(l.diasSem) + ')' : 'Sem chuva de 1 mm ou mais na janela')) +
        (l.foraDoCiclo ? '<br><i>Fora do ciclo escolhido</i>' : '');
    } else {
      const p = atual.pics[Number(alvo.getAttribute('data-p'))];
      html = '<b>' + esc(p.nome) + '</b>' + (p.nomeZeus && p.nomeZeus !== p.nome ? esc(p.nomeZeus) + '<br>' : '') +
        'Chuva medida no período: <span class="num">' + (p.total === null ? 'sem leitura' : L.fmtMm(p.total) + ' mm') + '</span><br>' +
        'Última leitura: <span class="num">' + esc(L.fmtLeitura(p.ul)) + '</span>';
    }
    const dica = $('dica');
    dica.innerHTML = html;
    dica.hidden = false;
    const caixa = $('mapa-caixa').getBoundingClientRect();
    const x = ev.clientX - caixa.left, y = ev.clientY - caixa.top;
    dica.style.left = Math.max(6, Math.min(caixa.width - dica.offsetWidth - 6, x + 14)) + 'px';
    dica.style.top = Math.max(6, Math.min(caixa.height - dica.offsetHeight - 6, y + 14)) + 'px';
  }
  function esconderDica() { $('dica').hidden = true; }

  /* ------------------------------ mapa: desenho ------------------------------ */
  function textoDiasSem(n) {
    if (n === null || n === undefined) return 'sem chuva na janela';
    if (n === 0) return 'no último dia com dado';
    return n + ' ' + plural(n, 'dia', 'dias') + ' sem chuva';
  }
  function corDaLinha(l) {
    if (l.semDado || l.foraDoCiclo) return L.COR_SEM_DADO;
    if (estado.modo === 'seca') {
      // sem chuva na janela inteira: a classe mais seca
      return L.CORES_SECA[l.diasSem === null ? L.CORES_SECA.length - 1 : L.classeDe(l.diasSem, L.LIMITES_SECA)];
    }
    return atual.escala.cor(l.total);
  }
  function valorDoRotulo(l) {
    if (l.semDado || l.foraDoCiclo) return '';
    if (estado.modo === 'seca') return l.diasSem === null ? '—' : l.diasSem + ' d';
    return l.total === null ? '—' : L.fmtMm(l.total, l.total >= 100 ? 0 : 1);
  }
  function desenharMapa() {
    const gt = $('g-talhoes'), gr = $('g-rotulos'), gp = $('g-pics');
    gt.textContent = ''; gr.textContent = ''; gp.textContent = '';
    atual.talhoes.forEach((t, i) => {
      const l = atual.linhas[i];
      const cor = corDaLinha(l);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', t.d);
      path.setAttribute('fill', cor);
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('class', 'talhao' + (l.semDado || l.foraDoCiclo ? ' apagado' : '') + (i === estado.sel ? ' sel' : ''));
      path.setAttribute('data-i', i);
      gt.appendChild(path);
      t.path = path;
      const c = atual.proj(t.centro.lon, t.centro.lat);
      const texto = document.createElementNS(NS, 'text');
      texto.setAttribute('x', c[0].toFixed(1));
      texto.setAttribute('y', c[1].toFixed(1));
      texto.setAttribute('fill', L.tintaSobre(cor));
      texto.innerHTML = '<tspan class="cod" x="' + c[0].toFixed(1) + '" dy="-0.2em">' + esc(t.nome) + '</tspan>' +
        '<tspan class="val" x="' + c[0].toFixed(1) + '" dy="1.15em">' + esc(valorDoRotulo(l)) + '</tspan>';
      gr.appendChild(texto);
      t.rotulo = texto;
      t.rotuloVisivel = true;
    });
    if (estado.sel !== null && atual.talhoes[estado.sel]) gt.appendChild(atual.talhoes[estado.sel].path);
    atual.pics.forEach((p) => {
      if (p.lat === null || p.lon === null) return;
      const c = atual.proj(p.lon, p.lat);
      const d = 'M' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + 'h.01';
      const aro = document.createElementNS(NS, 'path');
      aro.setAttribute('d', d); aro.setAttribute('class', 'pic-aro');
      const ponto = document.createElementNS(NS, 'path');
      ponto.setAttribute('d', d); ponto.setAttribute('class', 'pic ' + p.situacao); ponto.setAttribute('data-p', p.i);
      gp.appendChild(aro); gp.appendChild(ponto);
      p.ponto = ponto;
    });
    gp.setAttribute('class', estado.pics ? '' : 'fora');
    desenharLigacoes();
    desenharLegenda();
    aplicarVista();
  }
  /** Mostra ou esconde os pluviômetros (a chuva do talhão não vem de um pluviômetro: não há ligação a desenhar). */
  function desenharLigacoes() {
    $('g-linhas').textContent = '';
    $('g-pics').setAttribute('class', estado.pics ? '' : 'fora');
  }
  function faixasHtml(cores, rotulos) {
    return '<div class="legenda-faixas">' + cores.map((c, i) => '<span><i style="background:' + c + '"></i>' + esc(rotulos[i]) + '</span>').join('') + '</div>';
  }
  function desenharLegenda() {
    const seca = estado.modo === 'seca';
    const semDado = atual.linhas.some((l) => l.semDado && !l.foraDoCiclo);
    const fora = atual.linhas.some((l) => l.foraDoCiclo);
    $('legenda').innerHTML =
      '<div class="legenda-titulo">' + (seca ? 'Dias sem chuva (1 mm ou mais)' : atual.escala.titulo) + '</div>' +
      (seca ? faixasHtml(L.CORES_SECA, L.rotulosClasses(L.LIMITES_SECA, true)) : faixasHtml(atual.escala.cores, atual.escala.rotulos)) +
      '<div class="legenda-nota">' +
        (semDado || fora ? '<span><i class="cinza"></i>' + [semDado ? 'sem dado na ZEUS' : '', fora ? 'fora do ciclo' : ''].filter(Boolean).join(' ou ') + '</span>' : '') +
        (estado.pics && atual.pics.length ? '<span><i class="bola"></i>pluviômetro (chuva medida)</span>' : '') +
      '</div>';
  }

  /* ------------------------------ resumo ------------------------------ */
  function desenharResumo() {
    const r = L.resumoDaFazenda(atual.linhas);
    const indice = (l) => (l ? atual.linhas.indexOf(l) : -1);
    const item = (rotulo, valor, sub, i) => {
      const tag = i >= 0 ? 'button' : 'div';
      return '<' + tag + ' class="resumo-item"' + (i >= 0 ? ' type="button" data-i="' + i + '" title="Ver este talhão no mapa"' : '') + '>' +
        '<span class="resumo-rotulo">' + rotulo + '</span><span class="resumo-valor">' + valor + '</span><span class="resumo-sub">' + sub + '</span></' + tag + '>';
    };
    const mm = (v) => (v === null || v === undefined ? '—' : L.fmtMm(v) + '<small>mm</small>');
    $('resumo').innerHTML =
      item('Média da fazenda', mm(r.media), 'ponderada pela área · ' + r.comValor + ' ' + plural(r.comValor, 'talhão', 'talhões'), -1) +
      item('Maior chuva', mm(r.maior ? r.maior.total : null), r.maior ? 'Talhão ' + esc(r.maior.nome) : 'sem leitura', indice(r.maior)) +
      item('Menor chuva', mm(r.menor ? r.menor.total : null), r.menor ? 'Talhão ' + esc(r.menor.nome) : 'sem leitura', indice(r.menor)) +
      item('Sem chuva no período', r.semChuva + '<small>de ' + r.comValor + '</small>', plural(r.semChuva, 'talhão', 'talhões') + ' com menos de 1 mm', -1) +
      item('Mais tempo sem chuva', r.maisSeco ? r.maisSeco.diasSem + '<small>' + plural(r.maisSeco.diasSem, 'dia', 'dias') + '</small>' : '—',
        r.maisSeco ? 'Talhão ' + esc(r.maisSeco.nome) + ' · última em ' + L.fmtDia(L.somarDias(atual.faz.inicio, r.maisSeco.ultima.i)) : 'sem chuva registrada', indice(r.maisSeco));
  }
  $('resumo').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-i]');
    if (b) selecionar(Number(b.getAttribute('data-i')), 'resumo');
  });

  /* ------------------------------ tabela por talhão ------------------------------ */
  const COLUNAS = [
    ['codigo', 'Talhão', ''], ['total', 'Chuva (mm)', 'n'], ['diasChuva', 'Dias c/ chuva', 'n col-opc'],
    ['ultima', 'Última chuva', ''], ['diasSem', 'Dias sem chuva', 'n'],
  ];
  function desenharTabela() {
    const busca = L.semAcento(estado.busca);
    // com um ciclo escolhido, a tabela traz só os talhões dele
    const doPeriodo = atual.linhas.filter((l) => !l.foraDoCiclo);
    const filtradas = doPeriodo.filter((l) => !busca || L.semAcento(l.nome).indexOf(busca) >= 0);
    const linhas = L.ordenar(filtradas, estado.ordem.col, estado.ordem.desc);
    const maior = Math.max.apply(null, [1].concat(doPeriodo.map((l) => l.total || 0)));
    const semDado = doPeriodo.filter((l) => l.semDado).length;
    const fora = atual.linhas.length - doPeriodo.length;
    $('tabela-conta').textContent = (busca ? linhas.length + ' de ' : '') + doPeriodo.length + ' ' + plural(doPeriodo.length, 'talhão', 'talhões') +
      (fora ? ' no ciclo · ' + fora + ' fora dele' : '') + (semDado ? ' · ' + semDado + ' sem dado na ZEUS' : '');
    if (!linhas.length) { $('tab-talhoes').innerHTML = '<p class="vazio">Nenhum talhão com esse nome.</p>'; return; }
    const cab = COLUNAS.map((c) => {
      const ord = estado.ordem.col === c[0];
      return '<th class="' + c[2] + '"' + (ord ? ' aria-sort="' + (estado.ordem.desc ? 'descending' : 'ascending') + '"' : '') + '>' +
        (c[0] ? '<button type="button" data-col="' + c[0] + '">' + c[1] + '<span class="seta">' + (ord && estado.ordem.desc ? '▼' : '▲') + '</span></button>' : c[1]) + '</th>';
    }).join('');
    const corpo = linhas.map((l) => {
      const i = atual.linhas.indexOf(l);
      return '<tr data-i="' + i + '"' + (i === estado.sel ? ' class="sel"' : '') + '>' +
        '<td><span class="cod">' + esc(l.nome) + '</span></td>' +
        '<td class="n">' + (l.total === null ? '<span class="fraco">sem dado</span>'
          : '<div class="chuva-cel"><span class="barra-mm"><i style="width:' + Math.round((l.total / maior) * 100) + '%"></i></span><b>' + L.fmtMm(l.total) + '</b></div>') + '</td>' +
        '<td class="n col-opc">' + (l.total === null ? '<span class="fraco">—</span>' : l.diasChuva) + '</td>' +
        '<td class="junto">' + (l.ultima ? L.fmtDia(L.somarDias(atual.faz.inicio, l.ultima.i)) + ' <span class="peq">· ' + L.fmtMm(l.ultima.mm) + ' mm</span>' : '<span class="fraco">—</span>') + '</td>' +
        '<td class="n junto">' + (l.diasSem === null ? '<span class="fraco">—</span>' : l.diasSem + ' ' + plural(l.diasSem, 'dia', 'dias')) + '</td></tr>';
    }).join('');
    $('tab-talhoes').innerHTML = '<table class="tabela"><thead><tr>' + cab + '</tr></thead><tbody>' + corpo + '</tbody></table>';
  }
  $('tab-talhoes').addEventListener('click', (ev) => {
    const col = ev.target.closest('button[data-col]');
    if (col) {
      const c = col.getAttribute('data-col');
      // números começam do maior; o código, em ordem
      estado.ordem = { col: c, desc: estado.ordem.col === c ? !estado.ordem.desc : c !== 'codigo' };
      desenharTabela();
      return;
    }
    const tr = ev.target.closest('tr[data-i]');
    if (!tr) return;
    const i = Number(tr.getAttribute('data-i'));
    selecionar(i === estado.sel ? null : i, 'tabela');
  });
  $('busca').addEventListener('input', () => { estado.busca = $('busca').value; desenharTabela(); });

  /* ------------------------------ talhão escolhido ------------------------------ */
  function selecionar(i, origem) {
    if (!atual) return;
    const antes = estado.sel;
    estado.sel = i === null || !atual.talhoes[i] ? null : i;
    if (estado.vista !== 'mapa') mostrarVista('mapa');
    if (antes !== null && atual.talhoes[antes] && atual.talhoes[antes].path) atual.talhoes[antes].path.classList.remove('sel');
    if (estado.sel !== null) {
      const t = atual.talhoes[estado.sel];
      t.path.classList.add('sel');
      $('g-talhoes').appendChild(t.path); // por cima dos vizinhos
    }
    desenharLigacoes();
    desenharDetalhe();
    document.querySelectorAll('#tab-talhoes tr.sel').forEach((tr) => tr.classList.remove('sel'));
    if (estado.sel !== null) {
      let tr = document.querySelector('#tab-talhoes tr[data-i="' + estado.sel + '"]');
      // a linha pode estar escondida pela busca: a busca é limpa para ela aparecer
      if (!tr && estado.busca) { estado.busca = ''; $('busca').value = ''; desenharTabela(); tr = document.querySelector('#tab-talhoes tr[data-i="' + estado.sel + '"]'); }
      if (tr) {
        tr.classList.add('sel');
        rolarAte(tr); // o detalhe abre em cima da lista e pode esconder a linha
      }
      aproximarTalhao(estado.sel);
    } else irPara(vistaDaFazenda(), true);
  }
  /** Rola só a lista da tabela (não a página) até a linha ficar à vista. */
  function rolarAte(tr) {
    const caixa = $('tab-talhoes');
    const topoCab = 36;
    const cima = tr.offsetTop - topoCab, baixo = tr.offsetTop + tr.offsetHeight;
    if (cima < caixa.scrollTop) caixa.scrollTop = cima;
    else if (baixo > caixa.scrollTop + caixa.clientHeight) caixa.scrollTop = baixo - caixa.clientHeight + 8;
  }
  function desenharDetalhe() {
    const caixa = $('detalhe');
    if (grafico) { grafico.dispose(); grafico = null; }
    if (estado.sel === null || !atual.linhas[estado.sel]) { caixa.hidden = true; caixa.innerHTML = ''; return; }
    const l = atual.linhas[estado.sel], per = atual.per, faz = atual.faz;
    const de = Math.max(0, Math.min(per.i0, per.i1 - (DIAS_GRAFICO - 1)));
    const contexto = de < per.i0;
    caixa.hidden = false;
    caixa.innerHTML =
      '<div class="detalhe-cab"><div><h2>Talhão ' + esc(l.nome) + '</h2>' +
        '<p>' + [l.area ? L.fmtMm(l.area, 0) + ' ha' : '', l.semDado ? 'sem dado: o talhão não está na tabela de chuva por talhão da ZEUS' : 'chuva por talhão da ZEUS',
          l.foraDoCiclo ? 'fora do ciclo escolhido' : ''].filter(Boolean).join(' · ') + '</p></div>' +
        '<button type="button" class="detalhe-fechar" id="detalhe-fechar" title="Fechar e ver a fazenda inteira" aria-label="Fechar">×</button></div>' +
      '<div class="detalhe-nums">' +
        '<div><span>Chuva no período</span><b>' + (l.total === null ? '—' : L.fmtMm(l.total)) + ' <small>mm</small></b></div>' +
        '<div><span>Dias com chuva</span><b>' + (l.total === null ? '—' : l.diasChuva) + ' <small>de ' + per.dias + '</small></b></div>' +
        '<div><span>Maior chuva do período</span><b>' + (l.maior ? L.fmtMm(l.maior.mm) + ' <small>mm em ' + L.fmtDia(L.somarDias(faz.inicio, l.maior.i)) + '</small>' : '—') + '</b></div>' +
        '<div><span>Última chuva</span><b>' + (l.ultima ? L.fmtDia(L.somarDias(faz.inicio, l.ultima.i)) + ' <small>' + textoDiasSem(l.diasSem) + '</small>' : '—') + '</b></div>' +
      '</div>' +
      '<div class="detalhe-graf" id="detalhe-graf" role="img" aria-label="Chuva dia a dia do talhão"></div>' +
      (contexto ? '<div class="detalhe-leg"><span><i style="background:var(--azul-chuva)"></i>período escolhido</span><span><i style="background:#C5D3E0"></i>dias anteriores</span></div>' : '');
    $('detalhe-fechar').addEventListener('click', () => selecionar(null, 'detalhe'));
    if (!window.echarts || !l.serie) { $('detalhe-graf').hidden = true; return; }
    const dias = [], valores = [];
    for (let d = de; d <= per.i1; d++) {
      const v = l.serie[d];
      dias.push(L.somarDias(faz.inicio, d));
      valores.push(v === null || v === undefined ? null : { value: Math.round(v * 100) / 100, itemStyle: { color: d >= per.i0 ? '#2E8FD8' : '#C5D3E0' } });
    }
    grafico = window.echarts.init($('detalhe-graf'));
    grafico.setOption({
      animation: false,
      grid: { left: 34, right: 8, top: 10, bottom: 22 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, textStyle: { fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 12, color: '#17251F' },
        formatter: (ps) => { const p = ps[0]; return L.fmtDia(p.axisValue, true) + '<br><b>' + (p.value === null || p.value === undefined ? 'sem dado' : L.fmtMm(p.value, 2) + ' mm') + '</b>'; },
      },
      xAxis: {
        type: 'category', data: dias, axisTick: { show: false }, axisLine: { lineStyle: { color: '#DCE3DC' } },
        axisLabel: { color: '#5B6B62', fontSize: 10.5, formatter: (v) => L.fmtDia(v), hideOverlap: true },
      },
      yAxis: {
        type: 'value', min: 0, minInterval: 1, splitNumber: 3, axisLabel: { color: '#8A988F', fontSize: 10.5 },
        splitLine: { lineStyle: { color: '#EBF0EB' } },
      },
      series: [{ type: 'bar', data: valores, barMaxWidth: 16, barMinHeight: 0, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    });
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && estado.sel !== null && estado.vista === 'mapa') selecionar(null, 'tecla'); });
  window.addEventListener('resize', () => { if (grafico) grafico.resize(); });

  /* ------------------------------ dia a dia ------------------------------ */
  function desenharDiario() {
    const per = atual.per, faz = atual.faz;
    const de = Math.max(per.i0, per.i1 - (MAX_DIAS_GRADE - 1));
    const cortado = de > per.i0;
    $('explica-diario').innerHTML = 'Chuva de cada talhão em cada dia, em mm, com as faixas de cor do relatório Power BI. Dia em branco não teve chuva; dia listrado não tem dado na tabela da ZEUS. ' +
      'Clique no talhão para vê-lo no mapa.' + (cortado ? ' <b>O período tem ' + per.dias + ' dias: aparecem os ' + MAX_DIAS_GRADE + ' mais recentes.</b>' : '');
    $('legenda-diario').innerHTML = '<div class="legenda-titulo">Chuva no dia (mm)</div>' + faixasHtml(L.FAIXAS_DIA.map((f) => f.cor), L.FAIXAS_DIA.map((f) => f.rotulo));
    let cab = '<th class="linha-cab">Talhão</th>';
    for (let d = de; d <= per.i1; d++) {
      const iso = L.somarDias(faz.inicio, d);
      const sem = new Date(iso + 'T12:00:00Z').getUTCDay();
      // o mês aparece no primeiro dia da grade e em todo dia 1º
      const comMes = d === de || iso.slice(8) === '01';
      cab += '<th' + (sem === 0 || sem === 6 ? ' class="fds"' : '') + ' title="' + L.fmtDia(iso, true) + '">' + (comMes ? L.fmtDia(iso) : iso.slice(8)) +
        '<small>' + ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][sem] + '</small></th>';
    }
    cab += '<th class="total">Total</th>';
    const corpo = L.ordenar(atual.linhas.filter((l) => !l.foraDoCiclo), 'codigo', false).map((l) => {
      let tds = '', total = 0, lidos = 0;
      for (let d = de; d <= per.i1; d++) {
        const v = l.serie ? l.serie[d] : null;
        const iso = L.somarDias(faz.inicio, d);
        if (v === null || v === undefined) { tds += '<td class="sem" title="' + esc(l.nome) + ' · ' + L.fmtDia(iso) + ': sem dado"></td>'; continue; }
        lidos++; total += v;
        if (v <= 0) { tds += '<td></td>'; continue; }
        const cor = L.corDoDia(v);
        tds += '<td style="background:' + cor + ';color:' + L.tintaSobre(cor) + '" title="' + esc(l.nome) + ' · ' + L.fmtDia(iso) + ': ' + L.fmtMm(v, 2) + ' mm">' + L.fmtMm(v, v >= 10 ? 0 : 1) + '</td>';
      }
      return '<tr><th class="linha-cab" data-i="' + atual.linhas.indexOf(l) + '" title="Ver no mapa">' + esc(l.nome) + '</th>' +
        tds + '<td class="total">' + (lidos ? L.fmtMm(total) : '—') + '</td></tr>';
    }).join('');
    $('tab-diario').innerHTML = '<table class="grade"><thead><tr>' + cab + '</tr></thead><tbody>' + corpo + '</tbody></table>';
    // começa mostrando os dias mais recentes
    const caixa = $('tab-diario');
    caixa.scrollLeft = caixa.scrollWidth;
  }
  $('tab-diario').addEventListener('click', (ev) => {
    const th = ev.target.closest('th[data-i]');
    if (th) selecionar(Number(th.getAttribute('data-i')), 'diario');
  });

  /* ------------------------------ pluviômetros ------------------------------ */
  function desenharPics() {
    const pics = atual.pics.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
    const comProblema = pics.filter((p) => p.situacao !== 'ok').length;
    $('conta-pics').textContent = comProblema ? String(comProblema) : '';
    $('explica-pics').innerHTML = 'Chuva <b>medida</b> em cada pluviômetro da ZEUS no período, para comparar: a chuva dos talhões vem de outra tabela da ZEUS, já distribuída por talhão. ' +
      '<b>Atrasado</b> = a última leitura está mais de ' + L.ATRASO_HORAS + ' horas atrás da mais recente da fazenda (' + esc(L.fmtLeitura(atual.faz.ultimaLeitura)) + ').';
    if (!pics.length) { $('tab-pics').innerHTML = '<p class="vazio">A ZEUS não tem pluviômetros para esta fazenda.</p>'; return; }
    const texto = { ok: 'Em dia', atrasado: 'Atrasado', 'sem-leitura': 'Sem leitura' };
    const lista = (cods) => cods.slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).map(esc).join(', ');
    $('tab-pics').innerHTML = '<table class="tabela"><thead><tr><th>Pluviômetro</th><th class="n">Chuva (mm)</th><th class="n">Dias c/ chuva</th><th>Última leitura</th><th>Situação</th>' +
      '<th class="n">Dias sem leitura</th><th>Talhões ligados no cadastro da ZEUS</th></tr></thead><tbody>' +
      pics.map((p) => '<tr><td><span class="cod">' + esc(p.nome) + '</span>' + (p.nomeZeus && p.nomeZeus !== p.nome ? '<span class="pic-da-linha">' + esc(p.nomeZeus) + '</span>' : '') + '</td>' +
        '<td class="n">' + (p.total === null ? '<span class="fraco">—</span>' : '<b>' + L.fmtMm(p.total) + '</b>') + '</td>' +
        '<td class="n">' + (p.total === null ? '<span class="fraco">—</span>' : p.diasChuva) + '</td>' +
        '<td>' + esc(L.fmtLeitura(p.ul)) + '</td>' +
        '<td><span class="situacao ' + p.situacao + '">' + texto[p.situacao] + (p.situacao === 'atrasado' ? ' ' + p.atrasoH + ' h' : '') + '</span></td>' +
        '<td class="n">' + (p.semLeitura ? p.semLeitura + ' de ' + atual.per.dias : '<span class="fraco">0</span>') + '</td>' +
        '<td class="lista-talhoes">' + (p.talhoes.length ? '<b>' + p.talhoes.length + '</b>: ' + lista(p.talhoes) : '<span class="fraco">nenhum</span>') + '</td></tr>').join('') +
      '</tbody></table>';
  }

  /* ------------------------------ telas e filtros ------------------------------ */
  function mostrarVista(v) {
    if (v !== estado.vista && EMBED && window.parent !== window) {
      // o menu do COA WEB acompanha a tela escolhida nas abas
      try { window.parent.postMessage({ tipo: 'chuva-rota', vista: v }, location.origin); } catch (e) { /* fora do COA WEB */ }
    }
    estado.vista = v;
    document.querySelectorAll('#abas button').forEach((b) => b.setAttribute('aria-selected', b.getAttribute('data-vista') === v ? 'true' : 'false'));
    ['mapa', 'diario', 'pics'].forEach((x) => { $('vista-' + x).hidden = x !== v || !atual; });
    if (!atual || !atual.linhas) return;
    if (v === 'diario') desenharDiario();
    if (v === 'pics') desenharPics();
    if (v === 'mapa') {
      // o mapa foi montado com a tela escondida (sem tamanho): enquadra agora
      if (atual.semMedida && atual.caixa) { atual.semMedida = false; limiteVista = limitesDeZoom(); vb = vistaDaFazenda(); }
      aplicarVista();
      if (grafico) grafico.resize();
    }
  }
  $('abas').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-vista]'); if (b) mostrarVista(b.getAttribute('data-vista')); });

  function avisar(texto) { $('aviso').textContent = texto || ''; $('aviso').hidden = !texto; }

  function preencherFiltros() {
    $('sel-fazenda').innerHTML = fazendas.map((f) => '<option value="' + esc(f.id) + '"' + (f.id === estado.fazenda ? ' selected' : '') + '>' + esc(f.nome) + '</option>').join('');
  }
  /** Opções do campo Período da fazenda na tela (as safras e os ciclos mudam de uma fazenda para outra). */
  function preencherPeriodos() {
    const grupos = L.opcoesDePeriodo(atual.faz);
    if (!grupos.some((g) => g.itens.some((i) => i[0] === estado.periodo))) estado.periodo = '7';
    $('sel-periodo').innerHTML = grupos.map((g) => '<optgroup label="' + esc(g.grupo) + '">' +
      g.itens.map((i) => '<option value="' + esc(i[0]) + '"' + (i[0] === estado.periodo ? ' selected' : '') + '>' + esc(i[1]) + '</option>').join('') + '</optgroup>').join('');
  }
  function preencherLimites() {
    const dados = atual ? atual.dados : null;
    const comArea = dados ? safrasDaFazenda(dados) : [];
    const qual = dados ? limitesEscolhidos(dados) : 'base';
    $('sel-limites').innerHTML = comArea.map((s) => '<option value="' + esc(s.id) + '"' + (s.id === qual ? ' selected' : '') + '>' + esc(s.nome) + '</option>').join('') +
      '<option value="base"' + (qual === 'base' ? ' selected' : '') + '>Todos os talhões</option>';
  }
  function marcarDatas() {
    const livre = estado.periodo === 'livre';
    $('dt-de').parentElement.hidden = !livre;
    $('dt-ate').parentElement.hidden = !livre;
    if (!atual || !atual.faz) return;
    ['dt-de', 'dt-ate'].forEach((id) => { $(id).min = atual.faz.inicio; $(id).max = atual.faz.hoje; });
    // o ano aparece nas duas datas quando o período atravessa a virada do ano
    $('periodo-texto').textContent = L.fmtDia(atual.per.de, atual.per.de.slice(0, 4) !== atual.per.ate.slice(0, 4)) + ' a ' + L.fmtDia(atual.per.ate, true) +
      ' · ' + atual.per.dias + ' ' + plural(atual.per.dias, 'dia', 'dias');
    $('dt-de').value = atual.per.de;
    $('dt-ate').value = atual.per.ate;
  }
  $('sel-fazenda').addEventListener('change', () => { estado.fazenda = $('sel-fazenda').value; estado.sel = null; carregarFazenda(); });
  $('sel-periodo').addEventListener('change', () => {
    estado.periodo = $('sel-periodo').value;
    if (estado.periodo === 'livre' && atual && atual.per) { estado.de = atual.per.de; estado.ate = atual.per.ate; }
    recalcular();
  });
  ['dt-de', 'dt-ate'].forEach((id) => $(id).addEventListener('change', () => {
    if (!$('dt-de').value || !$('dt-ate').value) return;
    estado.de = $('dt-de').value; estado.ate = $('dt-ate').value;
    recalcular();
  }));
  $('sel-limites').addEventListener('change', () => { estado.limites = $('sel-limites').value; estado.sel = null; montarFazenda(); });
  document.querySelectorAll('.segmentado button').forEach((b) => b.addEventListener('click', () => {
    estado.modo = b.getAttribute('data-modo');
    document.querySelectorAll('.segmentado button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    if (atual && atual.faz) { desenharMapa(); if (estado.modo === 'seca' && estado.ordem.col === 'codigo') { estado.ordem = { col: 'diasSem', desc: true }; desenharTabela(); } }
  }));
  $('chk-pics').addEventListener('change', () => { estado.pics = $('chk-pics').checked; if (atual && atual.faz) { desenharLigacoes(); desenharLegenda(); } });

  /* ------------------------------ fazenda na tela ------------------------------ */
  function atualizado() {
    const el = $('atualizado');
    if (!atual || !atual.faz) { el.textContent = ''; return; }
    const faz = atual.faz;
    const gerado = faz.geradoEm ? new Date(faz.geradoEm) : null;
    const hora = gerado && !isNaN(gerado) ? gerado.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : null;
    el.classList.toggle('velho', diasDeAtraso() > 2);
    el.innerHTML = (faz.temTalhoes ? 'Chuva por talhão até <b>' + esc(L.fmtDia(faz.hoje, true)) + '</b>' : 'Sem chuva por talhão') +
      (hora ? '<br>conferido em ' + esc(hora) : '');
  }
  /** Há quantos dias a tabela de chuva por talhão da ZEUS não recebe dado (pela data em que o servidor conferiu). */
  function diasDeAtraso() {
    const faz = atual && atual.faz;
    const gerado = faz && faz.geradoEm ? new Date(faz.geradoEm) : null;
    if (!faz || !faz.temTalhoes || !gerado || isNaN(gerado)) return 0;
    return Math.max(0, L.difDias(faz.hoje, new Date(gerado.getTime() - 4 * 3600000).toISOString().slice(0, 10)));
  }
  /** Refaz as contas do período e redesenha tudo (os limites e a vista do mapa ficam como estão). */
  function recalcular() {
    if (!atual || !atual.faz) return;
    atual.per = L.periodo(estado.periodo, atual.faz, estado.de, estado.ate);
    atual.linhas = L.linhasDosTalhoes(atual.talhoes, atual.faz, atual.per);
    atual.escala = L.escalaDoPeriodo(atual.per.dias, atual.linhas.filter((l) => !l.foraDoCiclo).map((l) => l.total));
    atual.pics = L.picsNoPeriodo(atual.faz, atual.per);
    marcarDatas();
    desenharResumo();
    desenharMapa();
    desenharTabela();
    desenharDetalhe();
    const comProblema = atual.pics.filter((p) => p.situacao !== 'ok').length;
    $('conta-pics').textContent = comProblema ? String(comProblema) : '';
    if (estado.vista === 'diario') desenharDiario();
    if (estado.vista === 'pics') desenharPics();
  }
  /** Monta os limites escolhidos da fazenda já lida e enquadra o mapa. */
  function montarFazenda() {
    const dados = atual.dados;
    const qual = limitesEscolhidos(dados);
    atual.talhoes = montarTalhoes(dados, qual);
    preencherLimites();
    $('mapa-vazio').hidden = true;
    if (!atual.talhoes.length) {
      atual.linhas = null;
      ['g-talhoes', 'g-rotulos', 'g-pics', 'g-linhas'].forEach((g) => { $(g).textContent = ''; });
      $('legenda').innerHTML = ''; $('resumo').innerHTML = ''; $('tab-talhoes').innerHTML = ''; $('tabela-conta').textContent = '';
      $('mapa-vazio').textContent = 'Esta fazenda ainda não tem limites de talhão cadastrados no módulo Mapas.';
      $('mapa-vazio').hidden = false;
      return;
    }
    const caixaGeo = L.juntarCaixas(atual.talhoes.map((t) => t.caixaGeo));
    atual.proj = L.projetor(caixaGeo);
    atual.caixa = L.caixaProjetada(caixaGeo, atual.proj);
    atual.talhoes.forEach((t) => { t.cx = L.caixaProjetada(t.caixaGeo, atual.proj); t.d = L.caminhoSvg(t.geom, atual.proj); });
    atual.semMedida = $('vista-mapa').hidden;
    limiteVista = limitesDeZoom();
    vb = vistaDaFazenda();
    recalcular();
    const alvo = PARAMS.get('talhao');
    if (alvo && !montarFazenda.usouParametro) {
      montarFazenda.usouParametro = true;
      const i = atual.talhoes.findIndex((t) => t.nome === alvo);
      if (i >= 0) selecionar(i, 'endereco');
    }
  }
  async function carregarFazenda() {
    const f = fazendas.find((x) => x.id === estado.fazenda);
    if (!f) return;
    const meu = ++pedido;
    $('carregando').classList.remove('fora');
    try {
      if (!cache[f.id]) cache[f.id] = await fonte.fazenda(f);
      if (meu !== pedido) return;
      const dados = cache[f.id];
      atual = { f: f, dados: dados, faz: null };
      atual.faz = L.prepararFazenda(dados.chuva || { unidade: f.unidade, inicio: new Date().toISOString().slice(0, 10), dias: 1, pics: [], vinculos: {} });
      const atraso = diasDeAtraso();
      if (dados.semTabela) avisar('A chuva por talhão ainda não foi ativada no banco: falta rodar o script supabase/0013_chuva_talhao.sql no Supabase.');
      else if (dados.semColunas) avisar('A chuva por talhão está sendo trocada para a tabela do Power BI: falta rodar o script supabase/0014_chuva_talhao_field_data.sql no Supabase.');
      else if (!atual.faz.temTalhoes) avisar('A tabela de chuva por talhão da ZEUS (stg_field_data) não tem dados de ' + f.nome + ', ou a primeira carga ainda não chegou (o servidor confere a cada 30 minutos).');
      else if (atraso > 2) avisar('A tabela de chuva por talhão da ZEUS (stg_field_data, a mesma do Power BI) não recebe dados desde ' + L.fmtDia(atual.faz.hoje, true) + ' (' + atraso + ' dias). Todos os períodos terminam nesse dia.');
      else avisar('');
      // o ciclo é da fazenda: ao trocar de fazenda, o período volta para os últimos 7 dias
      if (/^ciclo:/.test(estado.periodo) && fazendaDoCiclo !== f.id) estado.periodo = '7';
      fazendaDoCiclo = f.id;
      preencherPeriodos();
      atualizado();
      mostrarVista(estado.vista);
      montarFazenda();
      mostrarVista(estado.vista);
    } catch (e) {
      if (meu !== pedido) return;
      atual = null;
      mostrarVista(estado.vista);
      avisar('Não foi possível ler os dados da fazenda: ' + (e && e.message ? e.message : 'erro desconhecido') + '.');
    } finally {
      if (meu === pedido) $('carregando').classList.add('fora');
    }
  }
  /** Fazenda do cadastro do Mapas que corresponde à escolhida no COA WEB (pelo vínculo ou pelo nome). */
  function fazendaDoCoa(c) {
    if (!c) return null;
    return fazendas.find((f) => f.coaId !== null && f.coaId !== undefined && String(f.coaId) === String(c.id)) ||
      fazendas.find((f) => f.unidade && L.unidadeDaFazenda(c.nome, [f.unidade])) ||
      fazendas.find((f) => L.unidadeDaFazenda(c.nome, [L.semAcento(f.nome)])) || null;
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || !ev.data) return;
    if (ev.data.tipo === 'chuva-vista' && ['mapa', 'diario', 'pics'].indexOf(ev.data.vista) >= 0) { mostrarVista(ev.data.vista); return; }
    if (ev.data.tipo !== 'coa-fazenda') return;
    coaFazenda = { id: ev.data.id, nome: ev.data.nome };
    if (!fazendas.length) return;
    const f = fazendaDoCoa(coaFazenda);
    if (f && f.id !== estado.fazenda) { estado.fazenda = f.id; estado.sel = null; $('sel-fazenda').value = f.id; carregarFazenda(); }
  });

  if (EMBED) document.documentElement.classList.add('embed');
  document.querySelectorAll('.segmentado button').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-modo') === estado.modo ? 'true' : 'false'));
  (async function iniciar() {
    try {
      fonte = CFG.modo === 'local' ? fonteLocal() : fonteSupabase();
      await fonte.pronto();
      const c = await fonte.cadastro();
      fazendas = (c.fazendas || []).map((f) => ({ id: String(f.id), nome: f.nome, unidade: f.unidade_pims ? L.semAcento(f.unidade_pims) : null, coaId: f.coa_fazenda_id }));
      safras = (c.safras || []).map((s) => ({ id: String(s.id), nome: s.nome, inicio: s.inicio }));
      if (!fazendas.length) throw new Error('Nenhuma fazenda do módulo Mapas está liberada para o seu usuário.');
      const pedida = L.semAcento(PARAMS.get('fazenda') || '');
      const inicial = fazendaDoCoa(coaFazenda) || fazendas.find((f) => pedida && (f.unidade === pedida || L.semAcento(f.nome) === pedida)) || fazendas[0];
      estado.fazenda = inicial.id;
      preencherFiltros();
      marcarDatas();
      await carregarFazenda();
    } catch (e) {
      $('carregando').classList.add('erro');
      $('carregando-texto').textContent = e && e.message ? e.message : 'Não foi possível abrir a Chuva por talhão.';
      return;
    }
    $('carregando').classList.add('fora');
  })();
})();
