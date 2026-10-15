/* =====================================================================
   Montagens de Painel — a TV (painel/index.html?tv=1)
   Mostra a montagem que está na TV (tabela painel_tv) dentro da moldura do COA: faixa no topo com a marca, o
   nome da montagem e o relógio; uma etiqueta fina em cima de cada quadro; cada quadro com a própria rotação
   (o próximo site carrega escondido e entra esmaecendo). A cada 60 s confere se a montagem mudou e aplica sem
   recarregar os quadros que não mudaram; a cada 5 min confere se o painel foi publicado de novo e recarrega.
   Ninguém precisa dar F5. Uma cobertura transparente fica por cima dos sites (a TV é para assistir): a tecla I
   (ou o botão) libera mexer nos sites por 2 min, para fechar um aviso de cookies ou entrar num site.
===================================================================== */
(function () {
  'use strict';
  const PARAMS = new URLSearchParams(location.search);
  if (PARAMS.get('tv') !== '1') return; // o editor é o editor.js

  const L = window.PainelLogica;
  const CFG = window.PAINEL_CONFIG || {};
  const fonte = window.PainelFonte.criar();
  // no servidor local, ?conferir=5 encurta a conferência da montagem para testar a troca sem esperar 1 min
  const conferirSeg = Number(PARAMS.get('conferir'));
  const CONFERIR_MS = (CFG.modo === 'local' && conferirSeg >= 5 ? conferirSeg : 60) * 1000;
  const VERSAO_MS = 5 * 60000;
  const FALHAS_PARA_AVISAR = 3;
  const PARADO_MS = 3000;
  const MEXER_MS = 2 * 60000;
  const LOGO = '../acompanhamento/assets/logo_coa_branco.png';
  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;

  let montagem = null; // a montagem na tela (normalizada) ou null
  let marca = null;    // assinatura da TV correspondente ao que está na tela (null = reler na próxima conferência)
  let falhas = 0;
  let desde = null;
  let ocupado = false;
  let wake = null;
  let paradoTimer = null;
  let mexerTimer = null;
  let recarregarTimer = null; // recarga marcada por um aviso (sem login, sem conexão…)
  const quadros = [];

  /* ------------------------------ um quadro ------------------------------ */
  function criarQuadro(numero) {
    const el = document.createElement('section');
    el.className = 'tv-quadro';
    el.hidden = true;
    const etiqueta = document.createElement('div');
    etiqueta.className = 'tv-etiqueta';
    const nome = document.createElement('span');
    nome.className = 'tv-etiqueta-nome';
    const conta = document.createElement('span');
    conta.className = 'tv-etiqueta-conta';
    const barra = document.createElement('i');
    barra.className = 'tv-progresso';
    etiqueta.append(nome, conta, barra);
    const palco = document.createElement('div');
    palco.className = 'tv-palco';
    el.append(etiqueta, palco);
    const q = { dados: null, i: 0, atual: null, proximo: null, timers: [] };

    function limpar() { q.timers.forEach(clearTimeout); q.timers = []; }
    function novoIframe(indice) {
      const s = q.dados.sites[indice];
      const f = document.createElement('iframe');
      f.className = 'tv-site';
      f.title = s.nome;
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', '');
      f.dataset.indice = String(indice);
      f.dataset.carregado = '0';
      f.addEventListener('load', () => { f.dataset.carregado = '1'; });
      f.src = L.enderecoNoNavegador(s);
      palco.appendChild(f);
      return f;
    }
    function progresso(ms) {
      barra.style.transition = 'none';
      barra.style.transform = 'scaleX(0)';
      barra.hidden = !Number.isFinite(ms) || q.dados.sites.length < 2;
      if (barra.hidden) return;
      void barra.offsetWidth; // aplica o zero antes de começar a encher
      barra.style.transition = 'transform ' + ms + 'ms linear';
      barra.style.transform = 'scaleX(1)';
    }
    function exibir(f) {
      f.classList.add('visivel');
      const antigo = q.atual;
      q.atual = f;
      if (antigo && antigo !== f) setTimeout(() => antigo.remove(), L.ESMAECER_MS + 100);
    }
    function agendar() {
      const ms = L.duracaoMs(q.dados, q.i);
      const n = q.dados.sites.length;
      nome.textContent = q.dados.sites[q.i].nome;
      conta.textContent = n > 1 ? (q.i + 1) + '/' + n : '';
      progresso(ms);
      if (!Number.isFinite(ms)) return;
      q.timers.push(setTimeout(preCarregar, L.atrasoPreCarga(ms)));
      q.timers.push(setTimeout(() => trocar(Date.now()), ms));
    }
    function preCarregar() {
      if (!q.proximo) q.proximo = novoIframe(L.proximoIndice(q.dados, q.i));
    }
    function trocar(inicio) {
      preCarregar();
      const f = q.proximo;
      if (f.dataset.carregado !== '1' && Date.now() - inicio < L.ESPERA_MAX_MS) {
        q.timers.push(setTimeout(() => trocar(inicio), 250));
        return;
      }
      q.proximo = null;
      q.i = Number(f.dataset.indice);
      exibir(f);
      agendar();
    }
    function vazio() {
      const caixa = document.createElement('div');
      caixa.className = 'tv-vazio';
      const img = document.createElement('img');
      img.src = LOGO;
      img.alt = '';
      const p = document.createElement('p');
      p.textContent = 'Quadro vazio. Adicione sites em Montagens de Painel, no COA WEB.';
      caixa.append(img, p);
      palco.appendChild(caixa);
      nome.textContent = 'Quadro ' + numero;
      conta.textContent = '';
      barra.hidden = true;
    }
    function comecar(dados) {
      limpar();
      palco.textContent = '';
      q.atual = null;
      q.proximo = null;
      q.dados = dados;
      q.i = 0;
      if (!dados.sites.length) { vazio(); return; }
      exibir(novoIframe(0));
      agendar();
    }
    function parar() {
      limpar();
      palco.textContent = '';
      q.atual = null;
      q.proximo = null;
      q.dados = null;
    }
    return { el, comecar, parar };
  }

  /* ------------------------------ a montagem na tela ------------------------------ */
  function aplicar(nova) {
    const acoes = L.planoDeAtualizacao(montagem, nova);
    const d = L.divisao(nova.divisao);
    const grade = $('tv-grade');
    grade.style.gridTemplateColumns = d.colunas;
    grade.style.gridTemplateRows = d.linhas;
    acoes.forEach((acao, i) => {
      const q = quadros[i];
      if (acao === 'remover') { q.parar(); q.el.hidden = true; return; }
      q.el.hidden = false;
      q.el.style.gridArea = d.areas[i];
      if (acao === 'recomecar') q.comecar(nova.quadros[i]);
    });
    montagem = nova;
    $('tv-nome').textContent = nova.nome;
    document.title = nova.nome + ' · TV do COA';
  }

  /** Tela de aviso no lugar dos quadros (textos e recarga em PainelLogica.avisoDaTv). */
  function aviso(codigo) {
    const a = L.avisoDaTv(codigo);
    quadros.forEach((q) => { q.parar(); q.el.hidden = true; });
    montagem = null;
    $('tv-nome').textContent = '';
    $('tv-grade').hidden = true;
    $('tv-aviso').hidden = false;
    $('tv-aviso-titulo').textContent = a.titulo;
    $('tv-aviso-texto').textContent = a.texto;
    $('tv-aviso-botao').hidden = !a.entrar;
    clearTimeout(recarregarTimer);
    if (a.recarregarMs > 0) recarregarTimer = setTimeout(() => location.reload(), a.recarregarMs);
  }

  async function carregar() {
    const r = await fonte.daTv();
    marca = L.assinaturaDaTv(r);
    if (!r.montagem) {
      aviso('sem-montagem');
      return;
    }
    clearTimeout(recarregarTimer); // a montagem voltou: a recarga marcada por um aviso não precisa mais acontecer
    $('tv-aviso').hidden = true;
    $('tv-grade').hidden = false;
    aplicar(L.normalizarMontagem(r.montagem));
  }

  function conexao(ok) {
    const selo = $('tv-conexao');
    if (ok) { falhas = 0; desde = null; selo.hidden = true; return; }
    falhas++;
    if (!desde) desde = new Date();
    if (falhas >= FALHAS_PARA_AVISAR) { selo.hidden = false; selo.textContent = 'Sem conexão desde ' + L.horaMinuto(desde); }
  }

  async function conferir() {
    if (ocupado) return;
    ocupado = true;
    try {
      const m = await fonte.marcaDaTv();
      if (m !== marca) await carregar();
      conexao(true);
    } catch (e) {
      if (e && e.codigo === 'sem-login') {
        marca = null; // quando alguém entrar de novo, a próxima conferência relê a montagem
        aviso('sessao-terminou');
      } else {
        conexao(false);
      }
    } finally {
      ocupado = false;
    }
  }

  /* ------------------------------ versão publicada ------------------------------ */
  /** Os arquivos da página com versão no endereço ("tv.js?v=..."): a lista muda quando o painel é publicado de novo. */
  function arquivosVersionados(doc) {
    return Array.prototype.map.call(doc.querySelectorAll('script[src*="?v="], link[href*="?v="]'), (e) => e.getAttribute('src') || e.getAttribute('href')).sort();
  }
  const VERSAO = arquivosVersionados(document);
  /** Recarrega só com os arquivos novos já respondendo (publicação pela metade não derruba a TV) e uma vez por versão. */
  async function conferirVersao() {
    if (!VERSAO.length) return;
    try {
      const r = await fetch(location.pathname, { cache: 'no-store' });
      if (!r.ok) return;
      const arqs = arquivosVersionados(new DOMParser().parseFromString(await r.text(), 'text/html'));
      const nova = arqs.join('|');
      let jaVista = null;
      try { jaVista = sessionStorage.getItem('painel.versao'); } catch (e) { jaVista = null; }
      if (!arqs.length || nova === VERSAO.join('|') || nova === jaVista) return;
      await Promise.all(arqs.filter((a) => VERSAO.indexOf(a) < 0).map((a) => fetch(a, { cache: 'reload' }).then((x) => { if (!x.ok) throw new Error(a); })));
      try { sessionStorage.setItem('painel.versao', nova); } catch (e) { /* sem armazenamento: recarrega assim mesmo */ }
      location.reload();
    } catch (e) { /* tenta de novo no próximo ciclo */ }
  }

  /* ------------------------------ relógio, tela cheia, tela acesa ------------------------------ */
  function relogio() {
    const d = new Date();
    $('tv-hora').textContent = L.horaMinuto(d);
    $('tv-data').textContent = L.dataPorExtenso(d);
  }
  function botaoCheia() { $('tv-cheia').hidden = !!document.fullscreenElement; }
  async function telaCheia() {
    try { if (!document.fullscreenElement && raiz.requestFullscreen) await raiz.requestFullscreen(); } catch (e) { /* o navegador pede um clique */ }
    botaoCheia();
  }
  async function manterLigada() {
    try {
      if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    } catch (e) { /* sem permissão: a proteção de tela do sistema também precisa estar desligada (README) */ }
  }
  function mexeu() {
    raiz.classList.add('mostrar');
    raiz.classList.remove('parado');
    clearTimeout(paradoTimer);
    paradoTimer = setTimeout(() => { raiz.classList.remove('mostrar'); raiz.classList.add('parado'); }, PARADO_MS);
  }
  function mexerNosSites(ligar) {
    clearTimeout(mexerTimer);
    raiz.classList.toggle('mexendo', ligar);
    $('tv-mexendo').hidden = !ligar;
    $('tv-mexer').textContent = ligar ? 'Voltar (I)' : 'Mexer nos sites (I)';
    if (ligar) mexerTimer = setTimeout(() => mexerNosSites(false), MEXER_MS);
    mexeu();
  }

  $('tv-cobertura').addEventListener('click', () => { telaCheia(); mexeu(); });
  document.addEventListener('mousemove', mexeu);
  $('tv-cheia').addEventListener('click', telaCheia);
  $('tv-mexer').addEventListener('click', () => mexerNosSites(!raiz.classList.contains('mexendo')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') mexerNosSites(!raiz.classList.contains('mexendo'));
    else if (e.key === 'f' || e.key === 'F') telaCheia();
    mexeu();
  });
  document.addEventListener('fullscreenchange', botaoCheia);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { manterLigada(); conferir(); } });

  /* ------------------------------ início ------------------------------ */
  (async function iniciar() {
    raiz.classList.add('modo-tv');
    $('carregando').classList.remove('claro');
    $('carregando-texto').textContent = 'Abrindo o painel da TV';
    $('tv').hidden = false;
    for (let i = 0; i < L.TOTAL_QUADROS; i++) {
      const q = criarQuadro(i + 1);
      quadros.push(q);
      $('tv-grade').appendChild(q.el);
    }
    relogio();
    setInterval(relogio, 1000);
    botaoCheia();
    try {
      await fonte.pronto();
    } catch (e) {
      $('carregando').classList.add('fora');
      // o aviso marca a recarga: depois do login (na janela à parte) ou da volta da internet, a TV retoma sozinha
      aviso(e.codigo === 'sem-categoria' || e.codigo === 'sem-login' ? e.codigo : 'sem-conexao');
      return;
    }
    try {
      await carregar();
    } catch (e) {
      conexao(false);
      aviso('sem-conexao');
    }
    $('carregando').classList.add('fora');
    setInterval(conferir, CONFERIR_MS);
    setInterval(conferirVersao, VERSAO_MS);
    manterLigada();
    mexeu();
  })();
})();
