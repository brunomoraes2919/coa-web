/* =====================================================================
   Montagens de Painel — editor (no COA WEB: painel/index.html?embed=1)
   Lista as montagens, cria, duplica, apaga, põe uma na TV e edita o nome, a divisão e os sites de cada quadro
   (ordem, tempo, recarga). Salva sozinho 800 ms depois da última mudança. A TV (tv.js, ?tv=1) lê do banco a
   montagem que está na TV e confere a cada minuto se ela mudou.
===================================================================== */
(function () {
  'use strict';
  const PARAMS = new URLSearchParams(location.search);
  if (PARAMS.get('tv') === '1') return; // a página da TV é o tv.js

  const L = window.PainelLogica;
  const fonte = window.PainelFonte.criar();
  const ESPERA_SALVAR_MS = 800;
  const $ = (id) => document.getElementById(id);
  // ícones fixos (nunca dado do banco)
  const ICONE_ALCA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
  const ICONE_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const OPCOES_TEMPO = L.TEMPOS.map((s) => [s, L.rotuloTempo(s)]);
  const OPCOES_RECARGA = L.RECARGAS.map((s) => [s, L.rotuloTempo(s)]);

  const estado = { montagens: [], tvId: null, sel: null, quadro: 0 };
  const salvar = { timer: null, ocupado: false, denovo: false, pendentes: new Set() };
  let arrasto = null; // índice do site sendo arrastado no quadro aberto

  const atual = () => estado.montagens.find((m) => m.id === estado.sel) || null;
  const nomeDe = (id) => { const m = estado.montagens.find((x) => x.id === id); return m ? m.nome.trim() : ''; };

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function botao(classe, texto, titulo) {
    const b = el('button', classe, texto);
    b.type = 'button';
    if (titulo) b.title = titulo;
    return b;
  }
  function seletor(opcoes, valor, rotulo) {
    const s = el('select', 'campo-tempo');
    s.setAttribute('aria-label', rotulo);
    opcoes.forEach(([v, t]) => { const o = el('option', '', t); o.value = String(v); o.selected = v === valor; s.appendChild(o); });
    return s;
  }

  /* ------------------------------ situação (canto da barra) ------------------------------ */
  function situacao(texto, erro, tentar) {
    $('situacao-texto').textContent = texto;
    $('situacao').classList.toggle('erro', !!erro);
    $('btn-tentar').hidden = !tentar;
  }

  /* ------------------------------ lista ------------------------------ */
  function desenharLista() {
    const ul = $('montagens');
    ul.textContent = '';
    L.ordenarMontagens(estado.montagens, estado.tvId).forEach((m) => {
      const li = el('li', 'item' + (m.id === estado.sel ? ' sel' : ''));
      const abrir = botao('item-abrir');
      abrir.setAttribute('aria-current', m.id === estado.sel ? 'true' : 'false');
      abrir.appendChild(el('span', 'item-nome', m.nome.trim() || 'Sem nome'));
      abrir.appendChild(el('span', 'item-resumo', L.resumoMontagem(m)));
      if (m.id === estado.tvId) abrir.appendChild(el('span', 'selo-tv', 'Na TV hoje'));
      abrir.addEventListener('click', () => selecionar(m.id));
      li.appendChild(abrir);
      if (m.id !== estado.tvId) {
        const por = botao('item-por', 'Pôr na TV', 'Mostrar esta montagem na TV do COA');
        por.addEventListener('click', () => porNaTv(m.id));
        li.appendChild(por);
      }
      ul.appendChild(li);
    });
  }

  /* ------------------------------ montagem aberta ------------------------------ */
  function desenharMontagem() {
    const m = atual();
    $('comecar').hidden = !!m;
    $('lista').hidden = !m;
    $('area').hidden = !m;
    if (!m) return;
    if (document.activeElement !== $('nome-montagem')) $('nome-montagem').value = m.nome;
    const naTv = m.id === estado.tvId;
    $('selo-tv').hidden = !naTv;
    $('btn-por-tv').hidden = naTv;
    $('btn-apagar').title = naTv ? 'Ponha outra montagem na TV antes de apagar esta' : 'Apagar esta montagem';
    desenharDivisoes(m);
    desenharPrevia(m);
    desenharQuadro(m);
  }

  function miniatura(d) {
    const g = el('span', 'mini');
    g.setAttribute('aria-hidden', 'true');
    g.style.gridTemplateColumns = d.colunas;
    g.style.gridTemplateRows = d.linhas;
    d.areas.forEach((a) => { const i = el('i'); i.style.gridArea = a; g.appendChild(i); });
    return g;
  }

  function desenharDivisoes(m) {
    const caixa = $('divisoes');
    caixa.textContent = '';
    L.DIVISOES.forEach((d) => {
      const b = botao('divisao-btn');
      b.setAttribute('aria-pressed', String(d.codigo === m.divisao));
      b.appendChild(miniatura(d));
      b.appendChild(el('span', '', d.nome));
      b.addEventListener('click', () => {
        if (m.divisao === d.codigo) return;
        m.divisao = d.codigo;
        if (estado.quadro >= d.areas.length) estado.quadro = 0;
        mudouTudo(m);
      });
      caixa.appendChild(b);
    });
  }

  function desenharPrevia(m) {
    const d = L.divisao(m.divisao);
    $('previa-nome').textContent = m.nome.trim() || 'Sem nome';
    $('previa-hora').textContent = L.horaMinuto(new Date());
    const g = $('previa-grade');
    g.textContent = '';
    g.style.gridTemplateColumns = d.colunas;
    g.style.gridTemplateRows = d.linhas;
    d.areas.forEach((area, i) => {
      const q = m.quadros[i];
      const t = L.textoDoQuadro(q);
      const b = botao('previa-quadro' + (q.sites.length ? '' : ' vazio'));
      b.style.gridArea = area;
      b.setAttribute('aria-pressed', String(i === estado.quadro));
      b.setAttribute('aria-label', 'Quadro ' + (i + 1) + ': ' + t.titulo + ', ' + t.detalhe);
      b.appendChild(el('span', 'previa-numero', 'Quadro ' + (i + 1)));
      b.appendChild(el('span', 'previa-titulo', t.titulo));
      b.appendChild(el('span', 'previa-detalhe', t.detalhe));
      b.addEventListener('click', () => { estado.quadro = i; mostrarFormEndereco(false); desenharPrevia(m); desenharQuadro(m); });
      g.appendChild(b);
    });
    const guardados = L.textoGuardados(m);
    $('guardados').hidden = !guardados;
    $('guardados').textContent = guardados;
  }

  /* ------------------------------ quadro aberto ------------------------------ */
  function desenharQuadro(m) {
    const q = m.quadros[estado.quadro];
    const n = q.sites.length;
    const conteudo = $('quadro-conteudo');
    conteudo.textContent = '';
    const topo = el('div', 'quadro-topo');
    const titulo = el('h2', 'quadro-titulo', 'Quadro ' + (estado.quadro + 1));
    titulo.appendChild(el('span', 'quadro-modo', n === 0 ? 'vazio' : n === 1 ? 'site fixo' : 'rotação · ' + n + ' sites'));
    topo.appendChild(titulo);
    const padrao = el('label', 'quadro-padrao');
    padrao.appendChild(el('span', '', 'Tempo padrão do quadro'));
    const selPadrao = seletor(OPCOES_TEMPO, q.padrao, 'Tempo padrão do quadro');
    selPadrao.title = 'Tempo que cada site novo recebe neste quadro';
    selPadrao.addEventListener('change', () => { q.padrao = Number(selPadrao.value); agendarSalvar(m.id); });
    padrao.appendChild(selPadrao);
    topo.appendChild(padrao);
    conteudo.appendChild(topo);
    if (!n) {
      conteudo.appendChild(el('p', 'quadro-vazio', 'Este quadro está vazio. Adicione uma página do COA WEB ou o endereço de um site.'));
    } else {
      const ul = el('ul', 'sites');
      q.sites.forEach((s, i) => ul.appendChild(linhaDoSite(m, q, s, i)));
      conteudo.appendChild(ul);
    }
    if (n === 1) {
      const fixo = el('label', 'linha-fixo');
      fixo.appendChild(el('span', '', 'Site fixo · recarregar a cada'));
      const selR = seletor(OPCOES_RECARGA, q.recarregar, 'Recarregar o site fixo a cada');
      selR.addEventListener('change', () => { q.recarregar = Number(selR.value); mudouPrevia(m); });
      fixo.appendChild(selR);
      conteudo.appendChild(fixo);
    }
    conteudo.appendChild(acoesDoQuadro(m, q));
  }

  function linhaDoSite(m, q, s, i) {
    const li = el('li', 'site');
    const alca = botao('site-alca', undefined, 'Arraste para mudar a ordem (ou use as setas ↑ ↓)');
    alca.innerHTML = ICONE_ALCA;
    alca.draggable = true;
    alca.setAttribute('aria-label', 'Mudar a ordem de ' + s.nome);
    alca.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); mover(m, q, i, i - 1, true); }
      else if (e.key === 'ArrowDown' && i < q.sites.length - 1) { e.preventDefault(); mover(m, q, i, i + 1, true); }
    });
    alca.addEventListener('dragstart', (e) => {
      arrasto = i;
      li.classList.add('arrastando');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.setDragImage(li, 24, 20);
    });
    alca.addEventListener('dragend', () => { arrasto = null; li.classList.remove('arrastando'); });
    li.addEventListener('dragover', (e) => { if (arrasto === null) return; e.preventDefault(); li.classList.add('alvo'); });
    li.addEventListener('dragleave', () => li.classList.remove('alvo'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('alvo');
      if (arrasto !== null && arrasto !== i) mover(m, q, arrasto, i, false);
      arrasto = null;
    });
    li.appendChild(alca);

    const info = el('div', 'site-info');
    const nome = el('input', 'site-nome');
    nome.type = 'text';
    nome.value = s.nome;
    nome.maxLength = 80;
    nome.setAttribute('aria-label', 'Nome do site no quadro');
    nome.addEventListener('input', () => { s.nome = nome.value; mudouPrevia(m); });
    nome.addEventListener('blur', () => {
      if (s.nome.trim()) return;
      s.nome = s.origem === 'coa' ? 'COA WEB' : L.nomeDoHost(s.url);
      nome.value = s.nome;
      mudouPrevia(m);
    });
    info.appendChild(nome);
    info.appendChild(el('span', 'site-origem', s.origem === 'coa' ? 'COA WEB · ' + s.url.split(/[/?#]/)[0] : L.nomeDoHost(s.url)));
    li.appendChild(info);

    if (q.sites.length > 1) {
      const tempo = seletor(OPCOES_TEMPO, s.segundos, 'Tempo de ' + s.nome + ' na rotação');
      tempo.addEventListener('change', () => { s.segundos = Number(tempo.value); mudouPrevia(m); });
      li.appendChild(tempo);
    }
    const selo = el('span', 'selo ' + (s.conferencia === 'abre' ? 'ok' : 'incerto'), s.conferencia === 'abre' ? 'Abre no painel' : 'Não conferido');
    if (s.conferencia !== 'abre') selo.title = 'Confira na TV se ele aparece';
    li.appendChild(selo);
    const remover = botao('site-remover', undefined, 'Tirar do quadro');
    remover.innerHTML = ICONE_X;
    remover.setAttribute('aria-label', 'Tirar ' + s.nome + ' do quadro');
    remover.addEventListener('click', () => { q.sites.splice(i, 1); mudouTudo(m); });
    li.appendChild(remover);
    return li;
  }

  function mover(m, q, de, para, focar) {
    const [s] = q.sites.splice(de, 1);
    q.sites.splice(para, 0, s);
    mudouTudo(m);
    if (focar) {
      const alca = document.querySelectorAll('#quadro-conteudo .site-alca')[para];
      if (alca) alca.focus();
    }
  }

  /* ------------------------------ mudanças e salvamento ------------------------------ */
  function mudouTudo(m) { desenharLista(); desenharMontagem(); agendarSalvar(m.id); }
  function mudouPrevia(m) { desenharLista(); desenharPrevia(m); agendarSalvar(m.id); }

  function agendarSalvar(id) {
    salvar.pendentes.add(id);
    clearTimeout(salvar.timer);
    situacao('Salvando…');
    salvar.timer = setTimeout(gravar, ESPERA_SALVAR_MS);
  }

  async function gravar() {
    clearTimeout(salvar.timer);
    if (salvar.ocupado) { salvar.denovo = true; return; }
    salvar.ocupado = true;
    let erro = null;
    let erroDeNome = false;
    let tocouTv = false;
    for (const id of Array.from(salvar.pendentes)) {
      const m = estado.montagens.find((x) => x.id === id);
      salvar.pendentes.delete(id);
      if (!m) continue;
      if (!m.nome.trim()) { salvar.pendentes.add(id); erro = 'Dê um nome à montagem para salvar.'; erroDeNome = true; continue; }
      if (L.nomeRepetido(m.nome, estado.montagens, m.id)) { salvar.pendentes.add(id); erro = 'Já existe uma montagem com esse nome.'; erroDeNome = true; continue; }
      try {
        const linha = await fonte.salvar(id, L.paraGravar(m));
        if (linha && linha.atualizado_em) m.atualizadoEm = linha.atualizado_em;
        if (id === estado.tvId) tocouTv = true;
      } catch (e) {
        salvar.pendentes.add(id);
        erroDeNome = e.codigo === 'nome-repetido';
        erro = erroDeNome ? e.message : 'Não salvou: ' + (e.message || 'sem conexão');
      }
    }
    salvar.ocupado = false;
    $('aviso-nome').hidden = !erroDeNome;
    $('aviso-nome').textContent = erroDeNome ? erro : '';
    if (erro) situacao(erro, true, !erroDeNome);
    else if (!salvar.pendentes.size) situacao(tocouTv ? 'Salvo · a TV atualiza em até 1 min' : 'Salvo');
    if (salvar.denovo) { salvar.denovo = false; gravar(); }
  }

  /* ------------------------------ ações ------------------------------ */
  function selecionar(id) {
    if (id === estado.sel) return;
    estado.sel = id;
    estado.quadro = 0;
    $('aviso-nome').hidden = true;
    mostrarFormEndereco(false);
    desenharLista();
    desenharMontagem();
  }

  async function criar(base) {
    const dados = base
      ? { nome: L.nomeDaCopia(base.nome.trim() || 'Sem nome', estado.montagens), divisao: base.divisao, quadros: L.paraGravar(base).quadros }
      : L.paraGravar(L.normalizarMontagem({ nome: L.nomeLivre('Nova montagem', estado.montagens), divisao: '4' }));
    situacao(base ? 'Duplicando…' : 'Criando…');
    try {
      const m = L.normalizarMontagem(await fonte.criar(dados));
      estado.montagens.push(m);
      estado.sel = m.id;
      estado.quadro = 0;
      if (!estado.tvId) await porNaTv(m.id, true);
      desenharLista();
      desenharMontagem();
      situacao(base ? 'Cópia criada' : estado.tvId === m.id ? 'Montagem criada e posta na TV' : 'Montagem criada');
      if (!base) { $('nome-montagem').focus(); $('nome-montagem').select(); }
    } catch (e) {
      situacao(e.message || 'Não foi possível criar a montagem.', true);
    }
  }

  async function porNaTv(id, quieto) {
    try {
      if (salvar.pendentes.has(id)) await gravar(); // a TV pega a versão salva
      await fonte.porNaTv(id);
      estado.tvId = id;
      desenharLista();
      desenharMontagem();
      if (!quieto) situacao('"' + nomeDe(id) + '" vai para a TV em até 1 min');
    } catch (e) {
      situacao('Não foi possível pôr na TV: ' + (e.message || 'sem conexão'), true);
    }
  }

  function pedirApagar() {
    const m = atual();
    if (!m) return;
    if (m.id === estado.tvId) { situacao('Ponha outra montagem na TV antes de apagar esta.', true); return; }
    $('dlg-apagar-nome').textContent = m.nome.trim() || 'Sem nome';
    $('dlg-apagar').showModal();
  }

  async function apagar() {
    const m = atual();
    $('dlg-apagar').close();
    if (!m) return;
    try {
      await fonte.apagar(m.id);
      salvar.pendentes.delete(m.id);
      estado.montagens = estado.montagens.filter((x) => x.id !== m.id);
      const proxima = L.ordenarMontagens(estado.montagens, estado.tvId)[0];
      estado.sel = proxima ? proxima.id : null;
      estado.quadro = 0;
      desenharLista();
      desenharMontagem();
      situacao('Montagem apagada');
    } catch (e) {
      situacao(e.message || 'Não foi possível apagar.', true);
    }
  }

  /* ------------------------------ adicionar sites ------------------------------ */
  const ICONE_COA = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M12 4v13M2.5 10.5H12M8 20.5h8"/></svg>';
  const ICONE_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  let fazendasDoAtalho = null; // lidas uma vez, na primeira abertura do diálogo
  let alvoDoAtalho = null;     // { m, q } do quadro que abriu o diálogo

  function acoesDoQuadro(m, q) {
    const acoes = el('div', 'quadro-acoes');
    const cheio = q.sites.length >= L.MAX_SITES;
    const bCoa = botao('botao', undefined, 'Acompanhamento ou Previsão do Tempo em Modo TV');
    bCoa.innerHTML = ICONE_COA;
    bCoa.appendChild(document.createTextNode('Do COA WEB'));
    bCoa.disabled = cheio;
    bCoa.addEventListener('click', () => abrirAtalho(m, q));
    const bEnd = botao('botao', undefined, 'Endereço https de um site');
    bEnd.innerHTML = ICONE_LINK;
    bEnd.appendChild(document.createTextNode('Endereço'));
    bEnd.disabled = cheio;
    bEnd.addEventListener('click', () => mostrarFormEndereco(true));
    acoes.append(bCoa, bEnd);
    if (cheio) acoes.appendChild(el('span', 'quadro-limite', 'Limite de ' + L.MAX_SITES + ' sites por quadro.'));
    return acoes;
  }

  function resultadoEndereco(texto, erro) {
    $('end-resultado').textContent = texto;
    $('end-resultado').classList.toggle('erro', !!erro);
  }

  function mostrarFormEndereco(abrir) {
    $('form-endereco').hidden = !abrir;
    resultadoEndereco('', false);
    $('end-adicionar').disabled = false;
    if (abrir) {
      $('end-url').value = '';
      $('end-nome').value = '';
      $('end-nome').placeholder = 'Nome do site';
      $('end-url').focus();
    }
  }

  $('end-url').addEventListener('input', () => {
    const lido = L.lerEndereco($('end-url').value, location.origin);
    $('end-nome').placeholder = lido.ok ? (lido.origem === 'coa' ? 'COA WEB' : L.nomeDoHost(lido.url)) : 'Nome do site';
  });
  $('end-cancelar').addEventListener('click', () => mostrarFormEndereco(false));
  $('form-endereco').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = atual();
    if (!m) return;
    const q = m.quadros[estado.quadro];
    if (q.sites.length >= L.MAX_SITES) { resultadoEndereco('Limite de ' + L.MAX_SITES + ' sites por quadro.', true); return; }
    const lido = L.lerEndereco($('end-url').value, location.origin);
    if (!lido.ok) { resultadoEndereco(lido.motivo, true); return; }
    let conferencia = 'abre';
    if (lido.origem === 'externo') {
      resultadoEndereco('Conferindo se o site abre dentro do painel…', false);
      $('end-adicionar').disabled = true;
      let r;
      try { r = await fonte.conferirSite(lido.url); } catch (err) { r = { resultado: 'incerto', motivo: err.message }; }
      $('end-adicionar').disabled = false;
      if (r.resultado === 'bloqueado') { resultadoEndereco('Este site não deixa ser exibido dentro de outra página, então não aparece na TV. Sites com login, como John Deere e ZEUS, costumam bloquear.', true); return; }
      if (r.resultado === 'invalido' || r.resultado === 'sem-acesso') { resultadoEndereco(r.motivo || 'Endereço não aceito.', true); return; }
      conferencia = r.resultado === 'abre' ? 'abre' : 'incerto';
    }
    // vai para o quadro que estava aberto quando o botão foi clicado, mesmo que a tela tenha mudado na conferência
    q.sites.push(L.normalizarSite({ nome: $('end-nome').value, url: lido.url, segundos: q.padrao, conferencia }));
    mostrarFormEndereco(false);
    if (atual() === m) mudouTudo(m); else agendarSalvar(m.id);
    situacao(conferencia === 'abre' ? 'Site adicionado' : 'Site adicionado sem conferência: confira na TV se ele aparece');
  });

  /* atalhos do COA WEB */
  L.CAMADAS_PREVISAO.forEach(([v, t]) => { const o = el('option', '', t); o.value = v; $('atalho-camada').appendChild(o); });
  L.TEMPOS_INTERNOS.forEach((s) => { const o = el('option', '', s + ' s'); o.value = String(s); o.selected = s === 20; $('atalho-tempo').appendChild(o); });

  function moduloDoAtalho() {
    return document.querySelector('#form-atalho input[name="modulo"]:checked').value;
  }
  function desenharFazendasDoAtalho() {
    const caixa = $('atalho-fazendas');
    caixa.textContent = '';
    const modulo = moduloDoAtalho();
    $('campo-camada').hidden = modulo !== 'previsao';
    (fazendasDoAtalho || []).filter((f) => modulo === 'previsao' || f.unidade).forEach((f) => {
      const l = el('label', 'opcao-linha');
      const c = el('input');
      c.type = 'checkbox';
      c.value = f.id;
      c.disabled = $('atalho-todas').checked;
      l.append(c, document.createTextNode(' ' + f.nome));
      caixa.appendChild(l);
    });
  }
  function escolhaDoAtalho() {
    const ids = $('atalho-todas').checked ? [] : Array.from(document.querySelectorAll('#atalho-fazendas input:checked')).map((c) => c.value);
    const op = { fazendas: (fazendasDoAtalho || []).filter((f) => ids.indexOf(f.id) >= 0), tempo: Number($('atalho-tempo').value), camada: $('atalho-camada').value };
    return moduloDoAtalho() === 'previsao' ? L.atalhoPrevisao(op) : L.atalhoAcompanhamento(op);
  }
  function atualizarAtalho() { $('atalho-nome').textContent = escolhaDoAtalho().nome; }

  async function abrirAtalho(m, q) {
    alvoDoAtalho = { m, q };
    if (!fazendasDoAtalho) {
      try { fazendasDoAtalho = L.fazendasDoCadastro(await fonte.fazendas()); } catch (e) { fazendasDoAtalho = []; }
    }
    $('atalho-aviso').hidden = fazendasDoAtalho.length > 0;
    $('atalho-aviso').textContent = 'Não foi possível ler as fazendas: o atalho entra com todas.';
    desenharFazendasDoAtalho();
    atualizarAtalho();
    $('dlg-atalho').showModal();
  }

  // trocar de página volta para "Todas as fazendas" (a lista muda: o Acompanhamento só tem as fazendas com unidade do PIMS)
  document.querySelectorAll('#form-atalho input[name="modulo"]').forEach((r) => r.addEventListener('change', () => { $('atalho-todas').checked = true; desenharFazendasDoAtalho(); atualizarAtalho(); }));
  $('atalho-todas').addEventListener('change', () => {
    document.querySelectorAll('#atalho-fazendas input').forEach((c) => { c.disabled = $('atalho-todas').checked; if (c.disabled) c.checked = false; });
    atualizarAtalho();
  });
  $('atalho-fazendas').addEventListener('change', atualizarAtalho);
  $('atalho-camada').addEventListener('change', atualizarAtalho);
  $('atalho-tempo').addEventListener('change', atualizarAtalho);
  $('atalho-cancelar').addEventListener('click', () => $('dlg-atalho').close());
  $('form-atalho').addEventListener('submit', (e) => {
    e.preventDefault();
    const alvo = alvoDoAtalho;
    $('dlg-atalho').close();
    if (!alvo || alvo.q.sites.length >= L.MAX_SITES) return;
    alvo.q.sites.push(L.normalizarSite(Object.assign(escolhaDoAtalho(), { segundos: alvo.q.padrao })));
    if (atual() === alvo.m) mudouTudo(alvo.m); else agendarSalvar(alvo.m.id);
    situacao('Página do COA WEB adicionada');
  });

  /* ------------------------------ eventos ------------------------------ */
  $('nome-montagem').addEventListener('input', (e) => {
    const m = atual();
    if (!m) return;
    m.nome = e.target.value.slice(0, 60);
    $('aviso-nome').hidden = true;
    mudouPrevia(m);
  });
  $('btn-nova').addEventListener('click', () => criar(null));
  $('btn-comecar').addEventListener('click', () => criar(null));
  $('btn-duplicar').addEventListener('click', () => { const m = atual(); if (m) criar(m); });
  $('btn-apagar').addEventListener('click', pedirApagar);
  $('btn-apagar-sim').addEventListener('click', apagar);
  $('btn-apagar-nao').addEventListener('click', () => $('dlg-apagar').close());
  $('btn-por-tv').addEventListener('click', () => { const m = atual(); if (m) porNaTv(m.id); });
  $('btn-tv').addEventListener('click', () => window.open('index.html?tv=1', '_blank', 'noopener'));
  $('btn-tentar').addEventListener('click', gravar);
  setInterval(() => { if (atual()) $('previa-hora').textContent = L.horaMinuto(new Date()); }, 30000);
  // saiu da aba ou do módulo com mudança na fila: grava na hora
  document.addEventListener('visibilitychange', () => { if (document.hidden && salvar.pendentes.size) gravar(); });
  window.addEventListener('pagehide', () => { if (salvar.pendentes.size) gravar(); });

  /* ------------------------------ início ------------------------------ */
  (async function iniciar() {
    $('editor').hidden = false;
    try {
      await fonte.pronto();
      const r = await fonte.listar();
      estado.montagens = (r.montagens || []).map(L.normalizarMontagem);
      estado.tvId = r.tvId || null;
      const primeira = L.ordenarMontagens(estado.montagens, estado.tvId)[0];
      estado.sel = primeira ? primeira.id : null;
    } catch (e) {
      $('carregando').classList.add('erro');
      $('carregando-texto').textContent = e && e.message ? e.message : 'Não foi possível abrir as montagens.';
      return;
    }
    $('carregando').classList.add('fora');
    desenharLista();
    desenharMontagem();
  })();
})();
