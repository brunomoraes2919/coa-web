/* =====================================================================
   COA WEB — barra fina do rodapé (Módulo e Unidade), como a do Locks AgTech
   Fica por cima de tudo na casca: na tela inicial só com a Unidade; dentro de um módulo, com os dois. A fazenda
   continua sendo o #sb-fazenda (escondido por CSS): a barra só muda o valor dele e dispara o `change`, e todo o
   resto do site segue lendo de lá. Trocar de módulo faz o mesmo caminho do usuário: volta à tela inicial e clica
   no cartão (conta na Aderência). Carregado depois do script da casca (usa sessao, categoriaAtual, CATEGORIAS,
   podeCategoria). Um MutationObserver acompanha as telas: nenhuma função de entrada precisa chamar a barra.
===================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const barra = $('barra-rodape');
  const botoes = { modulo: $('barra-modulo-btn'), unidade: $('barra-unidade-btn') };
  const listas = { modulo: $('barra-modulo-lista'), unidade: $('barra-unidade-lista') };
  const select = $('sb-fazenda');
  if (!barra || !select) return;

  const visivel = (el) => !!el && getComputedStyle(el).display !== 'none';

  /** Os módulos que esta pessoa pode abrir, na ordem da tela inicial. */
  function modulos() {
    const lista = CATEGORIAS.filter((c) => podeCategoria(c.chave)).map((c) => ({ chave: c.chave, nome: c.nome, card: c.card }));
    if (sessao && sessao.perfil === 'admin') {
      lista.push({ chave: 'aderencia', nome: 'Aderência de utilização', card: 'card-aderencia' });
      lista.push({ chave: 'administracao', nome: 'Administração de usuários', card: 'card-administracao' });
    }
    return lista;
  }
  function fecharListas(devolverFoco) {
    Object.keys(listas).forEach((k) => {
      if (listas[k].hidden) return;
      listas[k].hidden = true;
      botoes[k].setAttribute('aria-expanded', 'false');
      if (devolverFoco) botoes[k].focus();
    });
  }
  /** Atualiza o que a barra mostra conforme a tela aberta. */
  function sincronizar() {
    const naEntrada = !sessao || visivel($('login-screen'));
    const noModulo = visivel($('app-shell'));
    const naInicial = visivel($('categoria-screen'));
    barra.hidden = naEntrada || (!noModulo && !naInicial);
    if (barra.hidden) { fecharListas(false); return; }
    barra.classList.toggle('na-inicial', naInicial);
    barra.classList.toggle('recolhida', noModulo && $('app-shell').classList.contains('recolhida'));
    const atual = modulos().find((m) => m.chave === categoriaAtual);
    $('barra-modulo').hidden = !noModulo || naInicial;
    $('barra-modulo-nome').textContent = atual ? atual.nome : 'Módulos';
    // no Controle Técnico quem manda é o depósito do usuário, não a fazenda; sem fazenda liberada, não há o que escolher
    const semUnidade = !select.options.length || (noModulo && $('app-shell').classList.contains('modo-controle'));
    $('barra-unidade').hidden = semUnidade;
    const o = select.selectedOptions[0];
    $('barra-unidade-nome').textContent = o ? o.textContent : '';
  }
  function item(texto, ativo, icone) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', ativo ? 'true' : 'false');
    if (icone) b.appendChild(icone);
    const s = document.createElement('span');
    s.textContent = texto;
    b.appendChild(s);
    return b;
  }
  function abrir(qual) {
    const lista = listas[qual];
    const jaAberta = !lista.hidden;
    fecharListas(false);
    if (jaAberta) return;
    lista.textContent = '';
    if (qual === 'modulo') {
      modulos().forEach((m) => {
        const card = $(m.card), desenho = card && card.querySelector('svg');
        const b = item(m.nome, m.chave === categoriaAtual, desenho ? desenho.cloneNode(true) : null);
        b.addEventListener('click', () => trocarModulo(m));
        lista.appendChild(b);
      });
    } else {
      [...select.options].forEach((o) => {
        const b = item(o.textContent, o.value === select.value);
        b.addEventListener('click', () => trocarUnidade(o.value));
        lista.appendChild(b);
      });
    }
    lista.hidden = false;
    botoes[qual].setAttribute('aria-expanded', 'true');
    const marcado = lista.querySelector('[aria-checked="true"]') || lista.querySelector('button');
    if (marcado) { marcado.focus(); marcado.scrollIntoView({ block: 'nearest' }); }
  }
  function trocarUnidade(valor) {
    fecharListas(true);
    if (valor === select.value) return;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    sincronizar();
  }
  function trocarModulo(m) {
    fecharListas(false);
    if (m.chave === categoriaAtual && visivel($('app-shell'))) return;
    const card = $(m.card);
    if (!card) return;
    mostrarCategoriaScreen();
    card.click();
    sincronizar();
  }

  botoes.modulo.addEventListener('click', () => abrir('modulo'));
  botoes.unidade.addEventListener('click', () => abrir('unidade'));
  document.addEventListener('click', (e) => { if (!barra.contains(e.target)) fecharListas(false); });
  // clique dentro de um módulo (iframe) não chega ao document: a janela perde o foco
  window.addEventListener('blur', () => fecharListas(false));
  barra.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { fecharListas(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const lista = Object.values(listas).find((l) => !l.hidden);
    if (!lista) return;
    e.preventDefault();
    const itens = [...lista.querySelectorAll('button')];
    const i = itens.indexOf(document.activeElement);
    const prox = itens[(i + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length];
    if (prox) prox.focus();
  });

  // a tela aberta muda por style/class destes três; a lista de fazendas muda dentro do select
  const vigia = new MutationObserver(sincronizar);
  ['login-screen', 'categoria-screen', 'app-shell'].forEach((id) => vigia.observe($(id), { attributes: true, attributeFilter: ['style', 'class'] }));
  vigia.observe(select, { childList: true });
  select.addEventListener('change', sincronizar);
  sincronizar();
})();
