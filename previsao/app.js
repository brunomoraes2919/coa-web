/* =====================================================================
   Previsão do Tempo — módulo do COA WEB
   O mapa é o widget gratuito do Windy (iframe de outra origem). Ele avisa esta página onde o mapa
   está (postMessage `updateValues`, ligado por `embedMake` no endereço) e, com isso, os limites das
   fazendas (cadastro do Mapas: mapas_fazendas + mapas_talhoes) são desenhados por cima, num <svg>.
   O aviso só chega quando o Windy termina de redesenhar: depois de arrastar ou dar zoom, os limites
   levam alguns segundos para se ajustar.
   - COA → módulo: { tipo:'coa-fazenda', id, nome }
   - módulo → COA: { tipo:'previsao-fazenda', coaFazenda }
===================================================================== */
(function () {
  'use strict';

  const L = window.PrevisaoLogica;
  const CFG = window.PREVISAO_CONFIG || {};
  const EMBED = new URLSearchParams(location.search).get('embed') === '1';
  const TODAS = 'todas';
  /* códigos de camada e de modelo do Windy (todos conferidos no widget) */
  const CAMADAS = [
    ['rain', 'Chuva e trovoadas'],
    ['rainAccu', 'Chuva acumulada'],
    ['wind', 'Vento'],
    ['gust', 'Rajadas de vento'],
    ['temp', 'Temperatura'],
    ['clouds', 'Nuvens'],
    ['rh', 'Umidade do ar'],
    ['radar', 'Radar'],
  ];
  /* camadas em que o Windy não abre a tabela de previsão (a barra de baixo vira a escolha do período) */
  const SEM_TABELA = ['rainAccu'];
  const MODELOS = [['ecmwf', 'ECMWF'], ['gfs', 'GFS'], ['icon', 'ICON']];
  /* sem fazenda para enquadrar: o Brasil central */
  const VISTA_PADRAO = { lat: -14, lon: -53, zoom: 4 };
  /* tempo para o Windy dar o primeiro aviso de posição antes de os limites serem escondidos */
  const ESPERA_SINAL_MS = 25000;

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const estado = { fazenda: TODAS, camada: 'rain', modelo: 'ecmwf', ponto: false };
  let fazendas = [];       // [{ id, nome, coaId, geometrias, caixa }] — só as que têm limite
  let vista = null;        // onde o mapa do Windy está: a vista pedida ao carregar, depois o último aviso dele
  let comSinal = true;     // falso quando o Windy não avisa a posição: os limites somem (estariam no lugar errado)
  let primeiroAviso = false; // o widget carregado já deu o primeiro aviso de posição
  let vigiaSinal = null;
  let avisoCadastro = '';  // problema ao ler as fazendas: fica na tela enquanto durar
  let coaFazenda;          // fazenda escolhida no COA WEB (id de `fazendas`), quando o módulo está no iframe

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
        if (!s.data || !s.data.session) throw new Error(EMBED ? 'Sua sessão expirou. Entre de novo no COA WEB.' : 'Entre no COA WEB para ver a Previsão do Tempo.');
      },
      // a segurança do banco já entrega só as fazendas liberadas para o usuário
      cadastro: async function () {
        const r = await Promise.all([
          tudo(() => sb.from('mapas_fazendas').select('id,nome,coa_fazenda_id').order('nome'), 1000),
          // páginas pequenas: cada linha traz um polígono inteiro
          tudo(() => sb.from('mapas_talhoes').select('fazenda_id,geom').order('id'), 250),
        ]);
        return { fazendas: r[0], talhoes: r[1] };
      },
    };
  }
  /* servidor local de testes (modulos/previsao/scripts/servidor-local.mjs): fazendas fictícias */
  function fonteLocal() {
    return {
      pronto: async function () {},
      cadastro: async function () {
        const r = await fetch('/api/previsao-teste');
        if (!r.ok) throw new Error('servidor local sem dados de teste');
        return r.json();
      },
    };
  }

  /* ------------------------------ tela ------------------------------ */
  function tela() {
    const m = $('mapa');
    return { largura: m.clientWidth || 1000, altura: m.clientHeight || 600 };
  }
  function fazendaEscolhida() {
    return estado.fazenda === TODAS ? null : fazendas.find((f) => f.id === estado.fazenda) || null;
  }
  function atualizarAviso() {
    const texto = comSinal ? avisoCadastro : 'Os limites das fazendas não puderam ser posicionados: o Windy não informou a posição do mapa.';
    $('aviso').textContent = texto;
    $('aviso').hidden = !texto;
  }

  /* Limites por cima do mapa. Fazenda fora da tela nem é calculada; fazenda pequena demais para ter
     contorno na escala (ou colada nele) ganha um ponto. O nome vai acima da caixa da fazenda. */
  function desenhar() {
    const t = tela();
    const svg = $('limites');
    svg.setAttribute('viewBox', '0 0 ' + t.largura + ' ' + t.altura);
    if (!vista || !comSinal) { svg.innerHTML = ''; return; }
    let html = '';
    fazendas.forEach((f) => {
      const a = L.paraTela({ lat: f.caixa.norte, lon: f.caixa.oeste }, vista, t);
      const b = L.paraTela({ lat: f.caixa.sul, lon: f.caixa.leste }, vista, t);
      if (b.x < 0 || a.x > t.largura || b.y < 0 || a.y > t.altura) return;
      const marca = f.id === estado.fazenda ? ' escolhida' : '';
      const meioX = (a.x + b.x) / 2;
      let topo = a.y;
      const d = b.x - a.x < 8 && b.y - a.y < 8 ? '' : f.geometrias.map((g) => L.caminhoSvg(g, vista, t)).join('');
      if (d) {
        html += '<path class="limite-sombra" d="' + d + '"/><path class="limite' + marca + '" d="' + d + '"/>';
      } else {
        const meioY = (a.y + b.y) / 2;
        html += '<circle class="ponto-fazenda' + marca + '" cx="' + meioX.toFixed(1) + '" cy="' + meioY.toFixed(1) + '" r="4.5"/>';
        topo = meioY - 4.5;
      }
      html += '<text class="nome-fazenda' + marca + '" x="' + meioX.toFixed(1) + '" y="' + (topo - 7).toFixed(1) + '">' + esc(f.nome) + '</text>';
    });
    svg.innerHTML = html;
  }

  /* ------------------------------ Windy ------------------------------ */
  function vistaDaEscolha() {
    const f = fazendaEscolhida();
    const caixa = f ? f.caixa : L.juntarCaixas(fazendas.map((x) => x.caixa));
    return caixa ? L.vistaQueCabe(caixa, tela()) : VISTA_PADRAO;
  }
  /* (Re)carrega o widget na vista dada. Trocar de camada ou de modelo também passa por aqui: o widget
     não aceita essa troca por mensagem. */
  function carregarWindy(v) {
    vista = { lat: v.lat, lon: v.lon, zoom: v.zoom };
    primeiroAviso = false;
    comSinal = true;
    atualizarAviso();
    const url = L.urlWindy({ lat: vista.lat, lon: vista.lon, zoom: vista.zoom, camada: estado.camada, modelo: estado.modelo });
    // replace: a troca não entra no histórico do navegador (o "voltar" não fica preso no mapa)
    try { $('windy').contentWindow.location.replace(url); }
    catch (e) { $('windy').src = url; }
    desenhar();
    clearTimeout(vigiaSinal);
    vigiaSinal = setTimeout(() => {
      if (primeiroAviso) return;
      comSinal = false;
      atualizarAviso();
      desenhar();
    }, ESPERA_SINAL_MS);
  }
  function enviarAoWindy(payload) {
    try { $('windy').contentWindow.postMessage({ type: 'updateEmbed', payload: payload }, L.ORIGEM_WINDY); }
    catch (e) { /* widget ainda não carregou: o primeiro aviso de posição reenvia */ }
  }
  /* A tabela de previsão dos próximos dias é do próprio Windy: abre no centro da fazenda escolhida
     (com "Todas as fazendas", no centro do mapa). */
  function aplicarPonto() {
    const f = fazendaEscolhida();
    const p = f ? { lat: (f.caixa.sul + f.caixa.norte) / 2, lon: (f.caixa.oeste + f.caixa.leste) / 2 } : vista || VISTA_PADRAO;
    enviarAoWindy({
      showDetail: estado.ponto, showMarker: false, detailLat: p.lat, detailLon: p.lon,
      pressure: false, hideMessage: true, metricWind: 'km/h', metricTemp: '°C', metricRain: 'mm',
    });
  }
  function marcarPonto() {
    const semTabela = SEM_TABELA.indexOf(estado.camada) >= 0;
    $('btn-ponto').disabled = semTabela;
    $('btn-ponto').title = semTabela ? 'Nesta camada o Windy não mostra a tabela de previsão' : 'Abre a tabela de previsão dos próximos dias no centro da fazenda';
    $('btn-ponto').setAttribute('aria-pressed', estado.ponto && !semTabela ? 'true' : 'false');
  }

  function aoReceberDoWindy(dado) {
    const pos = L.lerPosicaoWindy(dado);
    if (pos) {
      vista = { lat: pos.lat, lon: pos.lon, zoom: pos.zoom };
      comSinal = true;
      atualizarAviso();
      // camada ou modelo trocados no menu do próprio Windy: as caixas da barra acompanham
      if (pos.camada && pos.camada !== estado.camada) { estado.camada = pos.camada; preencherCamadas(); }
      if (pos.modelo && pos.modelo !== estado.modelo) { estado.modelo = pos.modelo; preencherModelos(); }
      if (!primeiroAviso) {
        primeiroAviso = true;
        // o widget recarregado volta sem a tabela: reabre se o botão estava ligado
        if (estado.ponto) aplicarPonto();
      }
      desenhar();
      return;
    }
    // tabela aberta ou fechada dentro do Windy (o "x" dela): o botão acompanha
    if (dado && typeof dado === 'object' && dado.type === 'updateDetail' && dado.payload && typeof dado.payload.showDetail === 'boolean') {
      estado.ponto = dado.payload.showDetail;
      marcarPonto();
    }
  }

  /* ------------------------------ barra ------------------------------ */
  /* Camada ou modelo que não está na lista (escolhido no menu do Windy) aparece com o código dele. */
  function preencher(id, lista, valor) {
    const opcoes = lista.some((o) => o[0] === valor) ? lista : lista.concat([[valor, valor + ' (Windy)']]);
    $(id).innerHTML = opcoes.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === valor ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
  }
  function preencherCamadas() { preencher('sel-camada', CAMADAS, estado.camada); marcarPonto(); }
  function preencherModelos() { preencher('sel-modelo', MODELOS, estado.modelo); }
  function preencherFazendas() {
    preencher('sel-fazenda', [[TODAS, 'Todas as fazendas']].concat(fazendas.map((f) => [f.id, f.nome])), estado.fazenda);
    $('btn-centralizar').disabled = !fazendas.length;
  }
  function escolherFazenda(id) {
    estado.fazenda = id;
    preencherFazendas();
    carregarWindy(vistaDaEscolha());
  }
  function aplicarFazendaCoa() {
    if (coaFazenda === undefined || coaFazenda === null) return;
    const f = fazendas.find((x) => x.coaId === coaFazenda);
    if (f && f.id !== estado.fazenda) escolherFazenda(f.id);
  }

  $('sel-fazenda').addEventListener('change', (ev) => {
    escolherFazenda(ev.target.value);
    const f = fazendaEscolhida();
    // o seletor de fazenda do COA WEB acompanha
    if (EMBED && f && typeof f.coaId === 'number') window.parent.postMessage({ tipo: 'previsao-fazenda', coaFazenda: f.coaId }, location.origin);
  });
  $('sel-camada').addEventListener('change', (ev) => { estado.camada = ev.target.value; preencherCamadas(); carregarWindy(vista || vistaDaEscolha()); });
  $('sel-modelo').addEventListener('change', (ev) => { estado.modelo = ev.target.value; preencherModelos(); carregarWindy(vista || vistaDaEscolha()); });
  $('btn-centralizar').addEventListener('click', () => carregarWindy(vistaDaEscolha()));
  $('btn-ponto').addEventListener('click', () => { estado.ponto = !estado.ponto; marcarPonto(); aplicarPonto(); });

  window.addEventListener('message', (ev) => {
    if (ev.source === $('windy').contentWindow) {
      if (ev.origin === L.ORIGEM_WINDY) aoReceberDoWindy(ev.data);
      return;
    }
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.tipo !== 'coa-fazenda') return;
    coaFazenda = typeof d.id === 'number' ? d.id : null;
    aplicarFazendaCoa();
  });
  // o Windy mantém o centro do mapa quando a janela muda de tamanho: basta redesenhar no tamanho novo
  if (window.ResizeObserver) new ResizeObserver(desenhar).observe($('mapa'));
  else window.addEventListener('resize', desenhar);

  /* ------------------------------ Modo TV ------------------------------
     Tela cheia que passa pelas fazendas sozinha (e pelas camadas, se pedido), com o mapa do Windy ao vivo e
     os limites por cima — como o Modo TV do Acompanhamento. Cada troca recarrega o widget na fazenda.
     URL: ?tv=1&tempo=20&camadas=rain,wind&todas=0&fazendas=<ids separados por vírgula> */
  const PARAMS = new URLSearchParams(location.search);
  const tv = { ativo: false, slots: [], i: 0, tempo: 20, timer: null, relogio: null, pausado: false, wake: null, ocioso: null };
  function tvMontarSlots() {
    const pedidas = (PARAMS.get('fazendas') || '').split(',').map((s) => s.trim()).filter(Boolean);
    let ids = fazendas.map((f) => f.id);
    if (pedidas.length) ids = ids.filter((id) => pedidas.indexOf(id) >= 0);
    const lista = (PARAMS.get('todas') !== '0' && ids.length > 1 ? [TODAS] : []).concat(ids);
    const pedidasCam = (PARAMS.get('camadas') || '').split(',').map((s) => s.trim()).filter((c) => CAMADAS.some((x) => x[0] === c));
    const camadas = pedidasCam.length ? pedidasCam : [estado.camada];
    tv.slots = [];
    lista.forEach((f) => camadas.forEach((c) => tv.slots.push({ fazenda: f, camada: c })));
    if (!tv.slots.length) tv.slots = [{ fazenda: TODAS, camada: estado.camada }];
  }
  function tvRelogio() {
    const d = new Date();
    $('tv-hora').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    $('tv-data').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }
  function tvAgendar() {
    clearTimeout(tv.timer);
    const barra = $('tv-barra-tempo');
    barra.style.transition = 'none'; barra.style.width = '0';
    $('tv-pausa').textContent = tv.pausado ? 'Continuar' : 'Pausar';
    if (tv.pausado || tv.slots.length < 2) return;
    requestAnimationFrame(() => requestAnimationFrame(() => { barra.style.transition = 'width ' + tv.tempo + 's linear'; barra.style.width = '100%'; }));
    tv.timer = setTimeout(() => { tv.i = (tv.i + 1) % tv.slots.length; tvMostrar(); }, tv.tempo * 1000);
  }
  function tvMostrar() {
    if (!tv.ativo) return;
    const s = tv.slots[tv.i] || tv.slots[0];
    estado.fazenda = s.fazenda; estado.camada = s.camada;
    preencherFazendas(); preencherCamadas();
    carregarWindy(vistaDaEscolha());
    const f = fazendaEscolhida();
    $('tv-fazenda').textContent = f ? f.nome : 'Todas as fazendas';
    const cam = CAMADAS.find((c) => c[0] === estado.camada), mod = MODELOS.find((m) => m[0] === estado.modelo);
    $('tv-camada').textContent = cam ? cam[1] : estado.camada;
    $('tv-modelo').textContent = 'Modelo ' + (mod ? mod[1] : estado.modelo) + ' · Windy';
    tvAgendar();
  }
  async function telaCheia() {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { /* sem gesto do usuário */ }
    $('tv-cheia').hidden = !!document.fullscreenElement;
  }
  async function manterTelaLigada() {
    try { if (navigator.wakeLock && !tv.wake) { tv.wake = await navigator.wakeLock.request('screen'); tv.wake.addEventListener('release', () => { tv.wake = null; }); } } catch (e) { /* sem permissão */ }
  }
  function tvMostrarControles() {
    document.documentElement.classList.add('mostrar');
    clearTimeout(tv.ocioso);
    tv.ocioso = setTimeout(() => document.documentElement.classList.remove('mostrar'), 3000);
  }
  function entrarTv() {
    tv.ativo = true; tv.pausado = false;
    tv.tempo = Math.max(8, Number(PARAMS.get('tempo')) || 20);
    tvMontarSlots();
    tv.i = Math.max(0, tv.slots.findIndex((s) => s.fazenda === estado.fazenda && s.camada === estado.camada));
    document.documentElement.classList.add('modo-tv');
    $('tv-barra').hidden = false; $('tv-controles').hidden = false;
    // a tabela de previsão fecha: na TV o que importa é o mapa
    estado.ponto = false; marcarPonto(); aplicarPonto();
    tvRelogio(); clearInterval(tv.relogio); tv.relogio = setInterval(tvRelogio, 15000);
    if (PARAMS.get('tv') !== '1') history.replaceState(null, '', location.pathname + '?' + (EMBED ? 'embed=1&' : '') + 'tv=1' + location.hash);
    manterTelaLigada(); tvMostrarControles(); tvMostrar();
  }
  function sairTv() {
    tv.ativo = false;
    clearTimeout(tv.timer); clearInterval(tv.relogio);
    document.documentElement.classList.remove('modo-tv', 'mostrar');
    $('tv-barra').hidden = true; $('tv-controles').hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (tv.wake) { tv.wake.release().catch(() => {}); tv.wake = null; }
    history.replaceState(null, '', location.pathname + (EMBED ? '?embed=1' : '') + location.hash);
    desenhar();
  }
  $('btn-tv').addEventListener('click', () => { entrarTv(); telaCheia(); });
  $('tv-sair').addEventListener('click', sairTv);
  $('tv-pausa').addEventListener('click', () => { tv.pausado = !tv.pausado; tvAgendar(); });
  $('tv-cheia').addEventListener('click', telaCheia);
  $('tv-anterior').addEventListener('click', () => { tv.i = (tv.i - 1 + tv.slots.length) % tv.slots.length; tvMostrar(); });
  $('tv-proximo').addEventListener('click', () => { tv.i = (tv.i + 1) % tv.slots.length; tvMostrar(); });
  document.addEventListener('mousemove', () => { if (tv.ativo) tvMostrarControles(); });
  document.addEventListener('keydown', (e) => {
    if (!tv.ativo) return;
    if (e.key === 'Escape' && !document.fullscreenElement) sairTv();
    else if (e.key === 'ArrowRight') { tv.i = (tv.i + 1) % tv.slots.length; tvMostrar(); }
    else if (e.key === 'ArrowLeft') { tv.i = (tv.i - 1 + tv.slots.length) % tv.slots.length; tvMostrar(); }
    else if (e.key === ' ') { e.preventDefault(); tv.pausado = !tv.pausado; tvAgendar(); }
    tvMostrarControles();
  });
  document.addEventListener('fullscreenchange', () => { $('tv-cheia').hidden = !!document.fullscreenElement; setTimeout(desenhar, 200); });
  document.addEventListener('visibilitychange', () => { if (tv.ativo && !document.hidden) manterTelaLigada(); });

  /* ------------------------------ início ------------------------------ */
  if (EMBED) document.documentElement.classList.add('embed');
  preencherCamadas();
  preencherModelos();
  preencherFazendas();

  (async function iniciar() {
    const fonte = CFG.modo === 'local' ? fonteLocal() : fonteSupabase();
    try {
      await fonte.pronto();
    } catch (e) {
      $('carregando').classList.add('erro');
      $('carregando-texto').textContent = e && e.message ? e.message : 'Não foi possível abrir a Previsão do Tempo.';
      return;
    }
    let falhou = false;
    try {
      const c = await fonte.cadastro();
      const limites = L.limitesPorFazenda(c.talhoes);
      fazendas = (c.fazendas || []).filter((f) => limites[f.id]).map((f) => ({
        id: String(f.id), nome: String(f.nome || '').replace(/^Fazenda\s+/i, ''), coaId: typeof f.coa_fazenda_id === 'number' ? f.coa_fazenda_id : null,
        geometrias: limites[f.id].geometrias, caixa: limites[f.id].caixa,
      }));
    } catch (e) {
      falhou = true;
      console.warn('PREVISÃO: não foi possível ler os limites das fazendas', e);
    }
    $('carregando').classList.add('fora');
    const daCoa = fazendas.find((f) => f.coaId !== null && f.coaId === coaFazenda);
    estado.fazenda = daCoa ? daCoa.id : TODAS;
    preencherFazendas();
    if (falhou) avisoCadastro = 'Não foi possível ler os limites das fazendas. O mapa abre sem eles.';
    else if (!fazendas.length) avisoCadastro = 'Nenhuma fazenda com limites cadastrados no Mapas para o seu usuário.';
    carregarWindy(vistaDaEscolha());
    // aberto já como painel de TV (?tv=1): entra direto; a tela cheia depende de um clique
    if (PARAMS.get('tv') === '1') entrarTv();
  })();
})();
