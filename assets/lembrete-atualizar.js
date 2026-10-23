/* =====================================================================
   COA WEB — lembrete de atualizar (Operacional, Validação PIMS, Controle Técnico e Chuva por talhão)
   Desde 23/10/2026 os dados do PIMS, do SAP e da ZEUS só mudam quando alguém clica em Atualizar. Para ninguém
   tirar um relatório com dado velho sem perceber, toda vez que a pessoa entra na tela aparece este aviso, com o
   horário dos dados e o botão "Atualizar agora":
   - ao abrir o módulo (o próprio módulo chama mostrar() depois de carregar os dados);
   - a cada nova entrada pelo menu do COA WEB (a página principal manda { tipo: 'coa-entrada' } ao iframe, que já
     estava aberto).
   O "×" esconde só até a próxima entrada. Atualizou com sucesso, o aviso some. Nada do que vem do banco vira HTML.
   Uso:  const lembrete = window.coaLembrete.criar({ depoisDe, fonte, quando, atualizar, detalhe, ativo });
     depoisDe   elemento depois do qual o aviso entra na página
     fonte      'do PIMS', 'do PIMS e do SAP', 'da ZEUS'…
     quando()   ISO de quando os dados da tela foram lidos (ou null)
     atualizar() o mesmo do botão Atualizar da tela; devolve true se deu certo
     detalhe()  opcional: complemento do texto ('de FAZENDA X')
     ativo()    opcional: false = não mostra (modo TV)
   ===================================================================== */
(function () {
  'use strict';
  if (window.coaLembrete) return;

  /** Dados com menos que isto aparecem como recentes (o aviso fica verde, mas aparece do mesmo jeito). */
  var RECENTE_MIN = 10;

  var CSS = [
    '.lembrete-atualizar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 34px 0;padding:10px 12px 10px 14px;',
    'border-radius:8px;border:1px solid #EFD39A;background:#FBF0DB;color:#5C3D00;font-size:13.5px;line-height:1.45;}',
    '.lembrete-atualizar[hidden]{display:none;}',
    '.lembrete-atualizar.recente{border-color:#BFDCCB;background:#E9F4EE;color:#1E4D36;}',
    '.lembrete-atualizar .lembrete-icone{flex:none;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
    '.lembrete-atualizar .lembrete-texto{flex:1 1 260px;min-width:0;}',
    '.lembrete-atualizar .lembrete-texto b{font-weight:600;}',
    '.lembrete-atualizar .lembrete-botao{height:34px;display:inline-flex;align-items:center;gap:7px;padding:0 14px;border-radius:6px;border:0;',
    'background:#0C5A50;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;}',
    '.lembrete-atualizar .lembrete-botao:hover{background:#103632;}',
    '.lembrete-atualizar .lembrete-botao:disabled{opacity:.6;cursor:default;}',
    '.lembrete-atualizar .lembrete-botao svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;}',
    '.lembrete-atualizar .lembrete-botao:disabled svg{animation:lembrete-girar 1s linear infinite;}',
    '@keyframes lembrete-girar{to{transform:rotate(360deg);}}',
    '.lembrete-atualizar .lembrete-fechar{flex:none;width:30px;height:30px;border:0;background:none;color:inherit;font-size:20px;line-height:1;cursor:pointer;border-radius:6px;opacity:.7;}',
    '.lembrete-atualizar .lembrete-fechar:hover{opacity:1;background:rgba(0,0,0,.06);}',
    '@media (max-width:900px){.lembrete-atualizar{margin:10px 14px 0;}}',
    '@media (max-width:640px){.lembrete-atualizar .lembrete-botao{flex:1 1 auto;justify-content:center;}}',
  ].join('');

  function estilo() {
    if (document.getElementById('lembrete-atualizar-css')) return;
    var s = document.createElement('style');
    s.id = 'lembrete-atualizar-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var SVG = 'http://www.w3.org/2000/svg';
  function icone(classe, caminhos) {
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (classe) svg.setAttribute('class', classe);
    caminhos.forEach(function (d) { var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }

  /** 'há 5 min', 'há 3 h', 'há 2 dias' */
  function haQuanto(ms) {
    var min = Math.max(0, Math.round(ms / 60000));
    if (min < 1) return 'agora há pouco';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    var d = Math.round(h / 24);
    return d === 1 ? 'há 1 dia' : 'há ' + d + ' dias';
  }
  function dataHora(t) {
    return t.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
  }

  function criar(op) {
    estilo();
    var el = document.createElement('div');
    el.className = 'lembrete-atualizar';
    el.setAttribute('role', 'status');
    el.hidden = true;
    el.appendChild(icone('lembrete-icone', ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']));
    var texto = document.createElement('div');
    texto.className = 'lembrete-texto';
    el.appendChild(texto);
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'lembrete-botao';
    botao.appendChild(icone('', ['M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2', 'M18.5 2.5v3.6h-3.6M5.5 21.5v-3.6h3.6']));
    var rotulo = document.createElement('span');
    rotulo.textContent = 'Atualizar agora';
    botao.appendChild(rotulo);
    el.appendChild(botao);
    var fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'lembrete-fechar';
    fechar.setAttribute('aria-label', 'Fechar o aviso (ele volta na próxima vez que você entrar)');
    fechar.title = 'Fechar (o aviso volta na próxima vez que você entrar)';
    fechar.textContent = '×';
    el.appendChild(fechar);
    op.depoisDe.insertAdjacentElement('afterend', el);

    function escrever() {
      texto.textContent = '';
      var q = typeof op.quando === 'function' ? op.quando() : null;
      var t = q ? new Date(q) : null;
      var det = typeof op.detalhe === 'function' ? (op.detalhe() || '') : '';
      var b = document.createElement('b');
      if (!t || isNaN(t.getTime())) {
        b.textContent = 'Ainda não há dados ' + op.fonte + (det ? ' ' + det : '') + ' nesta tela.';
        texto.appendChild(b);
        texto.appendChild(document.createTextNode(' Clique em Atualizar para buscar agora.'));
        el.classList.remove('recente');
        return;
      }
      var idade = Date.now() - t.getTime();
      b.textContent = 'Dados ' + op.fonte + (det ? ' ' + det : '') + ' de ' + dataHora(t) + ' (' + haQuanto(idade) + ').';
      texto.appendChild(b);
      texto.appendChild(document.createTextNode(' Os dados só mudam quando alguém clica em Atualizar: antes de tirar um relatório, atualize para ter o dado mais recente.'));
      el.classList.toggle('recente', idade < RECENTE_MIN * 60000);
    }

    function mostrar() {
      if (typeof op.ativo === 'function' && !op.ativo()) { el.hidden = true; return; }
      escrever();
      el.hidden = false;
    }
    function esconder() { el.hidden = true; }
    /** Troca só o texto (outra fazenda ou unidade na tela), se o aviso está à vista. */
    function atualizarTexto() { if (!el.hidden) escrever(); }

    botao.addEventListener('click', function () {
      if (botao.disabled) return;
      botao.disabled = true;
      rotulo.textContent = 'Atualizando…';
      Promise.resolve()
        .then(function () { return op.atualizar(); })
        .then(function (ok) { if (ok) esconder(); else escrever(); })
        .catch(function () { escrever(); })
        .then(function () { botao.disabled = false; rotulo.textContent = 'Atualizar agora'; });
    });
    fechar.addEventListener('click', esconder);
    // nova entrada pelo menu do COA WEB (o iframe já estava aberto): o aviso volta
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || ev.source !== window.parent) return;
      if (ev.data && ev.data.tipo === 'coa-entrada') mostrar();
    });
    return { mostrar: mostrar, esconder: esconder, atualizarTexto: atualizarTexto, elemento: el };
  }

  window.coaLembrete = { criar: criar };
})();
