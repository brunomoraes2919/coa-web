/* =====================================================================
   COA WEB — rastreio do uso da plataforma (módulo Aderência de utilização, só dos administradores)
   Na página principal (index.html) os eventos vão para o gravador que ela define (window.coaUso.definirGravador);
   dentro dos módulos (iframes do mesmo site) eles vão para a página principal por postMessage, e ela grava
   (com o usuário, a fazenda do menu e o módulo aberto). O banco põe o usuário e a hora (supabase/0031_aderencia.sql).
   O que conta:
   - relatorio: todo arquivo baixado. Os downloads da plataforma passam por um <a download>: clicado pelo código
     (click() ou dispatchEvent de um clique) ou pela pessoa.
   - pagina: a tela aberta dentro do módulo (o endereço depois do #, ou o que o módulo avisar), ao abrir e a cada troca.
   - ativo (só na página principal): a cada 5 minutos com a plataforma visível e em foco.
   Nada do que é digitado nas telas é registrado.
   ===================================================================== */
(function () {
  'use strict';
  if (window.coaUso) return;

  var principal = window.parent === window;
  var gravador = null;   // página principal: function (evento)
  var fila = [];         // eventos de antes do gravador (login ainda carregando)
  var ultimo = { chave: '', em: 0 };

  function registrar(tipo, detalhe) {
    var ev = { tipo: tipo, detalhe: detalhe ? String(detalhe).replace(/\s+/g, ' ').trim().slice(0, 160) : null };
    // o mesmo evento em seguida (clique duplo, download repetido pelo navegador) conta uma vez
    var chave = ev.tipo + '|' + ev.detalhe;
    var agora = Date.now();
    if (tipo !== 'ativo' && chave === ultimo.chave && agora - ultimo.em < 3000) return;
    ultimo = { chave: chave, em: agora };
    if (!principal) {
      try { window.parent.postMessage({ tipo: 'coa-uso', evento: ev }, location.origin); } catch (e) { /* fora do COA WEB */ }
      return;
    }
    if (gravador) gravador(ev);
    else if (fila.length < 50) fila.push(ev);
  }

  /** "MAPA_CHUVA_DOURADO_01-10-2026.png" → "PNG · MAPA_CHUVA_DOURADO_01-10-2026" */
  function nomeDoArquivo(a) {
    var nome = String(a.getAttribute('download') || '').trim();
    if (!nome) {
      try { nome = decodeURIComponent((a.href || '').split('?')[0].split('/').pop() || ''); } catch (e) { nome = ''; }
    }
    var m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(nome);
    return m ? m[2].toUpperCase() + ' · ' + m[1] : (nome || 'arquivo');
  }
  function baixou(a) {
    if (a instanceof HTMLAnchorElement && a.hasAttribute('download')) registrar('relatorio', nomeDoArquivo(a));
  }
  var clicar = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try { baixou(this); } catch (e) { /* o rastreio nunca atrapalha o download */ }
    return clicar.apply(this, arguments);
  };
  var despachar = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    try { if (ev && ev.type === 'click' && this instanceof HTMLAnchorElement) baixou(this); } catch (e) { /* idem */ }
    return despachar.apply(this, arguments);
  };
  // clique da própria pessoa num link de download (o clique feito pelo código já foi contado acima)
  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a) baixou(a);
  }, true);

  // telas dos módulos: o endereço depois do # ("saldos", "/variedades/novo"). Os módulos trocam o endereço por
  // history.replaceState/pushState (que não disparam hashchange) ou pelo próprio #; o módulo sem endereço avisa
  // a tela com window.coaUso.tela(nome). A mesma tela seguida conta uma vez.
  var tela = '';
  function trocouTela(t) {
    t = String(t || '').slice(0, 160);
    if (t && t !== tela) registrar('pagina', t);
    tela = t || tela;
  }
  function telaAtual() {
    return location.hash.replace(/^#\/?/, '').split('?')[0];
  }
  if (!principal) {
    trocouTela(telaAtual());
    window.addEventListener('hashchange', function () { trocouTela(telaAtual()); });
    ['pushState', 'replaceState'].forEach(function (nome) {
      var original = history[nome];
      if (typeof original !== 'function') return;
      history[nome] = function () {
        var r = original.apply(this, arguments);
        try { trocouTela(telaAtual()); } catch (e) { /* o rastreio nunca atrapalha a tela */ }
        return r;
      };
    });
  }

  // tempo de uso: um "ativo" a cada 5 minutos com a página visível e em foco (o foco num módulo conta)
  if (principal) {
    setInterval(function () {
      if (gravador && document.visibilityState === 'visible' && document.hasFocus()) registrar('ativo', null);
    }, 5 * 60 * 1000);
  }

  window.coaUso = {
    registrar: registrar,
    /** Módulo sem a tela no endereço: avisa a tela aberta (conta só quando muda). */
    tela: function (nome) { if (!principal) trocouTela(nome); },
    /** Página principal: quem grava (depois do login). Os eventos que esperavam na fila vão junto. */
    definirGravador: function (fn) {
      gravador = typeof fn === 'function' ? fn : null;
      if (gravador) { var f = fila.splice(0); f.forEach(gravador); }
    },
  };
})();
