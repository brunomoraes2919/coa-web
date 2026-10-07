/* =====================================================================
   Validação PIMS — módulo do COA WEB
   Lê o retrato do PIMS/SAP que o servidor grava em valid_pims (ordens de serviço abertas e fechadas com
   diferença de área, coordenadores, depósitos e o saldo dos depósitos vinculados) e os vínculos
   coordenador ↔ depósito (valid_vinculos), que os administradores cadastram aqui.
   - COA → módulo: { tipo:'coa-fazenda', id, nome } e { tipo:'validacao-vista', vista }
   - módulo → COA: { tipo:'validacao-rota', vista, coaFazenda }
   O endereço guarda a tela aberta (#abertas, #fechadas, #depositos).
===================================================================== */
(function () {
  'use strict';

  const L = window.ValidacaoLogica;
  const CFG = window.VALIDACAO_CONFIG || {};
  const PARAMS = new URLSearchParams(location.search);
  const EMBED = PARAMS.get('embed') === '1';
  // Controle Técnico: a mesma tela, só com o recorte do coordenador (o banco entrega só o que é dos depósitos dele)
  const MODO_CONTROLE = PARAMS.get('modo') === 'controle';
  const PREFIXO = MODO_CONTROLE ? 'controle' : 'validacao'; // das mensagens trocadas com o COA WEB
  const VISTAS = MODO_CONTROLE
    ? ['pendencias', 'abertas', 'fechadas', 'apontamentos', 'boletins', 'estoque', 'doses', 'coletor']
    : ['pendencias', 'abertas', 'fechadas', 'apontamentos', 'boletins', 'estoque', 'doses', 'coletor', 'depositos'];
  const TODAS_AS_VISTAS = ['pendencias', 'abertas', 'fechadas', 'apontamentos', 'boletins', 'estoque', 'doses', 'coletor', 'depositos'];
  const TODAS = '';
  /** A fazenda do menu lateral não tem unidade no PIMS: nada a mostrar (em vez de mostrar todas). */
  const SEM_UNIDADE = '\u0001';
  const INTERVALO_MS = 4000;
  const LIMITE_MS = 150000;

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtHa = (v, casas) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas === undefined ? 1 : casas, maximumFractionDigits: casas === undefined ? 1 : casas });
  const fmtQtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fmtPct = (v) => Math.round((v || 0) * 100) + '%';
  const fmtData = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—');
  const fmtDataCurta = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—');
  /** 'YYYY-MM-DD HH:MM' → 'DD/MM HH:MM'. */
  const fmtDataHora = (t) => (t ? t.slice(8, 10) + '/' + t.slice(5, 7) + ' ' + t.slice(11, 16) : '—');

  const vistaDoEndereco = () => { const v = location.hash.replace(/^#/, ''); return VISTAS.indexOf(v) >= 0 ? v : 'pendencias'; };
  // período: por padrão, do primeiro dia do mês até hoje (abertura das ordens abertas; encerramento das fechadas)
  const estado = { vista: vistaDoEndereco(), unidade: TODAS, equipe: TODAS, de: L.inicioDoMes(L.hojeIso()), ate: L.hojeIso(), soAlertas: true };
  let linhas = [];        // valid_pims: uma linha por unidade do PIMS
  let vinculos = [];      // valid_vinculos
  let fazendasCoa = [];   // [{ unidade, coaId }] — de que fazenda do COA WEB é cada unidade
  let admin = false;
  let coaFazenda;         // fazenda escolhida no COA WEB, quando o módulo está no iframe
  let coaFazendaNome = '';
  let semColunaBoletins = false; // o banco ainda não tem a coluna dos boletins (script 0008)
  let equipesControle = [];      // Controle Técnico: equipes do PIMS (coordenadores) que o usuário pode abrir
  let equipeControle = PARAMS.get('eq') || ''; // 'unidade|equipe' aberta
  let fonte = null;
  let atualizando = false;

  /* ------------------------------ dados ------------------------------ */
  function fonteSupabase() {
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { autoRefreshToken: !EMBED, persistSession: true } });
    const conferir = (r, acao) => {
      if (!r.error) return r.data;
      const codigo = r.error.code || '', msg = r.error.message || '';
      if (codigo === 'PGRST205' || codigo === '42P01') throw new Error('O banco ainda não tem as tabelas da Validação PIMS (rode supabase/0007_validacao_pims.sql).');
      if (codigo === '42501' || /row-level security|permission denied/i.test(msg)) throw new Error('Sem permissão para ' + acao + '.');
      throw new Error('Não foi possível ' + acao + (codigo ? ' (código ' + codigo + ')' : '') + '. Tente de novo em instantes.');
    };
    return {
      pronto: async function () {
        const s = await sb.auth.getSession();
        if (!s.data || !s.data.session) throw new Error(EMBED ? 'Sua sessão expirou. Entre de novo no COA WEB.' : 'Entre no COA WEB para ver a Validação PIMS.');
      },
      ler: async function () {
        // a coluna dos boletins entra com o script 0008: sem ela, o resto da tela continua funcionando
        if (MODO_CONTROLE) {
          const eqs = conferir(await sb.rpc('controle_minhas_equipes'), 'ler a sua equipe') || [];
          if (!eqs.length) throw new Error('Nenhuma equipe do PIMS foi vinculada ao seu usuário. Fale com o administrador do COA.');
          const atual = eqs.find((x) => x.unidade + '|' + x.equipe === equipeControle) || eqs[0];
          const linha = conferir(await sb.rpc('controle_dados_equipe', { p_unidade: atual.unidade, p_equipe: atual.equipe }), 'ler os dados da equipe') || {};
          return {
            linhas: [linha], vinculos: atual.deposito ? [{ unidade: atual.unidade, equipe: atual.equipe, deposito: atual.deposito }] : [],
            fazendas: [], admin: false, semBoletins: false, equipesControle: eqs, equipeControle: atual.unidade + '|' + atual.equipe,
          };
        }
        const COLUNAS = 'unidade,gerado_em,ordens,coordenadores,depositos,estoque,avisos';
        let pims = await sb.from('valid_pims').select(COLUNAS + ',boletins,extras').order('unidade');
        const semBoletins = !!pims.error && (pims.error.code === '42703' || /boletins|extras/.test(pims.error.message || ''));
        if (semBoletins) pims = await sb.from('valid_pims').select(COLUNAS).order('unidade');
        const r = await Promise.all([
          pims,
          sb.from('valid_vinculos').select('unidade,equipe,deposito'),
          sb.from('mapas_fazendas').select('unidade_pims,coa_fazenda_id'),
          sb.rpc('mapas_eh_admin'),
        ]);
        return {
          linhas: conferir(r[0], 'ler as ordens') || [],
          vinculos: conferir(r[1], 'ler os depósitos dos coordenadores') || [],
          fazendas: r[2].error ? [] : (r[2].data || []),
          admin: !r[3].error && r[3].data === true,
          semBoletins: semBoletins,
        };
      },
      salvarVinculo: async function (v) {
        if (!v.deposito) {
          conferir(await sb.from('valid_vinculos').delete().eq('unidade', v.unidade).eq('equipe', v.equipe), 'remover o vínculo');
          return;
        }
        conferir(await sb.from('valid_vinculos').upsert({ unidade: v.unidade, equipe: v.equipe, deposito: v.deposito, deposito_origem: null }, { onConflict: 'unidade,equipe' }), 'salvar o vínculo');
      },
      pedirAtualizacao: async function () {
        const r = await sb.from('valid_pedidos').insert({}).select('id').single();
        return conferir(r, 'pedir a atualização').id;
      },
      situacaoPedido: async function (id) {
        const r = await sb.from('valid_pedidos').select('atendido_em,resultado').eq('id', id).maybeSingle();
        return r.error ? null : r.data;
      },
    };
  }
  /* servidor local de testes (modulos/validacao/scripts/servidor-local.mjs) */
  /** No teste local, faz na tela o recorte que em produção é do banco (função controle_dados_equipe). */
  function recorteLocal(d) {
    const eqs = [];
    (d.linhas || []).forEach((l) => (l.coordenadores || []).forEach((c) => {
      const v = (d.vinculos || []).find((x) => x.unidade === l.unidade && x.equipe === c.eq) || {};
      eqs.push({ unidade: l.unidade, equipe: c.eq, deposito: v.deposito || null, deposito_nome: ((l.depositos || []).find((y) => y.c === v.deposito) || {}).n || null });
    }));
    if (!eqs.length) throw new Error('Nenhuma equipe do PIMS foi vinculada ao seu usuário. Fale com o administrador do COA.');
    const atual = eqs.find((x) => x.unidade + '|' + x.equipe === equipeControle) || eqs.find((x) => x.deposito) || eqs[0];
    const l = (d.linhas || []).find((y) => y.unidade === atual.unidade) || { unidade: atual.unidade };
    const dele = (lista) => (lista || []).filter((o) => o.eq === atual.equipe);
    const ex = l.extras || {};
    const linha = {
      unidade: l.unidade, gerado_em: l.gerado_em || null, equipes: [atual.equipe], deposito: atual.deposito, ordens: dele(l.ordens), coordenadores: dele(l.coordenadores),
      depositos: (l.depositos || []).filter((x) => x.c === atual.deposito), estoque: atual.deposito && (l.estoque || {})[atual.deposito] ? { [atual.deposito]: l.estoque[atual.deposito] } : {},
      boletins: dele(l.boletins), extras: { ap: dele(ex.ap), nec: dele(ex.nec), dose: dele(ex.dose), col: dele(ex.col) }, avisos: l.avisos || [],
    };
    return { linhas: [linha], vinculos: atual.deposito ? [{ unidade: atual.unidade, equipe: atual.equipe, deposito: atual.deposito }] : [], fazendas: [], admin: false, equipesControle: eqs, equipeControle: atual.unidade + '|' + atual.equipe };
  }
  function fonteLocal() {
    const api = async (caminho, opcoes) => {
      const r = await fetch(caminho, opcoes);
      if (!r.ok) throw new Error('servidor local: ' + r.status);
      return r.json();
    };
    return {
      pronto: async function () {},
      ler: async () => { const d = await api('/api/validacao-teste'); return MODO_CONTROLE ? recorteLocal(d) : d; },
      salvarVinculo: (v) => api('/api/validacao-teste/vinculo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) }),
      pedirAtualizacao: async () => (await api('/api/validacao-teste/pedido', { method: 'POST' })).id,
      situacaoPedido: async () => ({ atendido_em: new Date().toISOString(), resultado: 'ok' }),
    };
  }

  /* ------------------------------ filtros ------------------------------ */
  const unidades = () => linhas.map((l) => l.unidade);
  const linhaDa = (unidade) => linhas.find((l) => l.unidade === unidade) || null;
  const vinculoDe = (unidade, eq) => vinculos.find((v) => v.unidade === unidade && v.equipe === eq) || null;
  const filtro = () => ({ unidade: estado.unidade, equipe: estado.equipe, de: estado.de, ate: estado.ate });
  const ehData = (t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t || ''));
  /** "de 01/10/2026 a 06/10/2026" / "desde …" / "até …" / "" (sem período). */
  const textoPeriodo = () => (estado.de && estado.ate ? 'de ' + fmtData(estado.de) + ' a ' + fmtData(estado.ate)
    : estado.de ? 'desde ' + fmtData(estado.de) : estado.ate ? 'até ' + fmtData(estado.ate) : '');

  function preencherUnidades() {
    const sel = $('sel-unidade');
    sel.innerHTML = '<option value="">Todas as fazendas</option>' + unidades().map((u) => '<option value="' + esc(u) + '">' + esc(L.titulo(u)) + '</option>').join('');
    if (estado.unidade && estado.unidade !== SEM_UNIDADE && unidades().indexOf(estado.unidade) < 0) estado.unidade = TODAS;
    sel.value = estado.unidade === SEM_UNIDADE ? TODAS : estado.unidade;
  }
  function preencherEquipes() {
    const nomes = new Set();
    linhas.forEach((l) => {
      if (estado.unidade && l.unidade !== estado.unidade) return;
      (l.coordenadores || []).forEach((c) => nomes.add(c.eq));
      (l.ordens || []).forEach((o) => nomes.add(o.eq));
    });
    const lista = Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (estado.equipe && lista.indexOf(estado.equipe) < 0) estado.equipe = TODAS;
    const sel = $('sel-equipe');
    sel.closest('label').hidden = MODO_CONTROLE; // no Controle Técnico a equipe já é a do usuário
    sel.innerHTML = '<option value="">Todos os coordenadores</option>' + lista.map((n) => '<option value="' + esc(n) + '">' + esc(L.titulo(n)) + '</option>').join('');
    sel.value = estado.equipe;
  }

  /* ------------------------------ ordens abertas ------------------------------ */
  function cartaoResumo(rotulo, valor, classe, sub) {
    return '<div class="resumo-item ' + (classe || '') + '"><span class="resumo-rotulo">' + esc(rotulo) + '</span><b class="resumo-valor">' + esc(valor) + '</b>' +
      (sub ? '<span class="resumo-sub">' + esc(sub) + '</span>' : '') + '</div>';
  }

  /** Barrinhas da área apontada por dia, da abertura até hoje (no máximo os últimos 14 dias com espaço). */
  function evolucaoSvg(o, hoje) {
    if (!o.ev.length) return '';
    const mapa = new Map(o.ev);
    const dias = [];
    const ini = new Date(o.ab + 'T00:00:00'), fim = new Date(hoje + 'T00:00:00');
    for (let d = new Date(Math.max(+ini, +fim - 13 * 86400000)); d <= fim; d = new Date(+d + 86400000)) dias.push(L.hojeIso(d));
    const max = Math.max.apply(null, dias.map((d) => mapa.get(d) || 0).concat([1]));
    const w = 6, g = 2, h = 22;
    const barras = dias.map((d, i) => {
      const v = mapa.get(d) || 0, bh = v ? Math.max(2, Math.round((v / max) * h)) : 1;
      return '<rect x="' + i * (w + g) + '" y="' + (h - bh) + '" width="' + w + '" height="' + bh + '" rx="1" class="' + (v ? 'com' : 'sem') + '"><title>' + fmtDataCurta(d) + ': ' + (v ? fmtHa(v) + ' ha' : 'sem apontamento') + '</title></rect>';
    }).join('');
    return '<svg class="evolucao" viewBox="0 0 ' + (dias.length * (w + g) - g) + ' ' + h + '" width="' + (dias.length * (w + g) - g) + '" height="' + h + '" role="img" aria-label="Área apontada por dia">' + barras + '</svg>';
  }

  /* ---- detalhe de uma ordem: abre ao clicar na linha (talhões planejado × apontado e os apontamentos) ---- */
  const abertos = new Set(); // 'unidade|ordem' das linhas abertas: sobrevive ao redesenho dos filtros
  const COLUNAS_ORDEM = 8;
  const chaveOrdem = (o) => o.unidade + '|' + o.os;
  function ordemBruta(chave) {
    const corte = chave.lastIndexOf('|');
    const linha = linhaDa(chave.slice(0, corte));
    return linha ? (linha.ordens || []).find((o) => String(o.os) === chave.slice(corte + 1)) || null : null;
  }
  /** Atributos da linha clicável (a seta fica na primeira célula). */
  function attrsOrdem(o) {
    const k = chaveOrdem(o);
    return ' data-ordem="' + esc(k) + '" tabindex="0" aria-expanded="' + (abertos.has(k) ? 'true' : 'false') + '" title="Clique para ver os apontamentos desta ordem"';
  }
  function detalheHtml(chave) {
    const bruta = ordemBruta(chave);
    const d = L.detalheDaOrdem(bruta);
    let corpo;
    if (d.pendente) corpo = '<p class="det-nota">Os apontamentos desta ordem chegam na próxima atualização do servidor (a cada hora, ou pelo botão Atualizar).</p>';
    else {
      const semArea = bruta && bruta.sa === 1;
      const talhoes = d.talhoes.length
        ? '<div class="det-grade det-talhoes"><div class="det-linha cab"><span>Talhão</span><span class="n">Planejado</span><span class="n">Apontado</span><span class="n">A realizar</span></div>' +
          d.talhoes.map((t) => '<div class="det-linha' + (t.excedeu || t.fora ? ' ruim' : '') + '"><span><b>' + esc(t.t) + '</b>' + (t.fora ? ' <small>fora da ordem</small>' : '') + '</span>' +
            '<span class="n">' + (t.fora ? '—' : fmtHa(t.pl) + ' ha') + '</span><span class="n">' + fmtHa(t.ex) + ' ha</span>' +
            '<span class="n">' + (t.fora || semArea ? '—' : fmtHa(t.falta) + ' ha') + '</span></div>').join('') + '</div>'
        : '<p class="det-nota">A ordem não tem talhões planejados.</p>';
      const apont = d.apontamentos.length
        ? '<div class="det-grade det-apont"><div class="det-linha cab"><span>Data</span><span>Boletim</span><span>Talhão</span><span class="n">Área</span><span class="c-lanc">Alterado em</span><span class="c-por">Por</span></div>' +
          d.apontamentos.map((a) => '<div class="det-linha"><span>' + fmtDataCurta(a.dia) + '</span><span>' + (a.boletim === null ? '—' : esc(a.boletim)) + '</span><span><b>' + esc(a.talhao) + '</b></span>' +
            '<span class="n">' + fmtHa(a.ha) + ' ha</span><span class="c-lanc">' + (a.lancado ? '<i>alterado em </i>' + fmtDataHora(a.lancado) : '—') + '</span><span class="c-por">' + esc(a.por || '—') + '</span></div>').join('') + '</div>'
        : '<p class="det-nota">Nenhum apontamento nesta ordem.</p>';
      corpo = '<div class="det"><div class="det-bloco"><h3>Talhões da ordem</h3>' + talhoes + '</div>' +
        '<div class="det-bloco"><h3>Apontamentos' + (d.apontamentos.length ? ' (' + d.apontamentos.length + ')' : '') + '</h3>' + apont + '</div></div>';
    }
    return '<tr class="detalhe"><td colspan="' + COLUNAS_ORDEM + '">' + corpo + '</td></tr>';
  }
  function alternarDetalhe(tr) {
    const k = tr.dataset.ordem;
    const prox = tr.nextElementSibling;
    if (prox && prox.classList.contains('detalhe')) { prox.remove(); abertos.delete(k); tr.setAttribute('aria-expanded', 'false'); return; }
    tr.insertAdjacentHTML('afterend', detalheHtml(k));
    abertos.add(k);
    tr.setAttribute('aria-expanded', 'true');
  }

  function linhaOrdem(o, hoje) {
    const pct = Math.min(1, o.pct);
    const alerta = o.excedeu
      ? '<span class="selo alerta" title="A área apontada passou da planejada: a área a realizar ficou negativa">Área excedida em ' + fmtHa(-o.aRealizar) + ' ha</span>'
      : '';
    return '<tr class="ordem clicavel ' + o.prazo + (o.excedeu ? ' excedeu' : '') + '"' + attrsOrdem(o) + '>' +
      '<td class="os"><span class="seta" aria-hidden="true"></span><b>' + esc(o.os) + '</b></td>' +
      '<td class="operacao"><span>' + esc(L.titulo(o.opn)) + '</span><small>' + (o.nt === 1 ? '1 talhão' : o.nt + ' talhões') + (o.pronta ? ' · <b class="pronta">pronta para fechar</b>' : '') + '</small></td>' +
      '<td class="n">' + fmtData(o.ab) + '</td>' +
      '<td class="prazo"><span class="selo ' + o.prazo + '">' + esc(L.textoDias(o.dias)) + '</span></td>' +
      '<td class="falta ' + o.prazo + '">' + esc(L.textoFalta(o.falta)) + '</td>' +
      (o.semArea
        ? '<td class="progresso sem-area" colspan="2"><small>Esta operação não aponta área no PIMS (' + fmtHa(o.pl) + ' ha planejados): vale só o prazo.</small></td><td class="n realizar">—</td>'
        : '<td class="progresso"><div class="barra-prog' + (o.excedeu ? ' cheia' : '') + '"><span style="width:' + (pct * 100).toFixed(1) + '%"></span></div>' +
          '<small><b>' + fmtPct(o.pct) + '</b> · ' + fmtHa(o.ex) + ' de ' + fmtHa(o.pl) + ' ha' + (o.ult ? ' · último em ' + fmtDataCurta(o.ult) : ' · sem apontamento') + '</small></td>' +
          '<td class="evo">' + evolucaoSvg(o, hoje) + '</td>' +
          '<td class="n realizar' + (o.excedeu ? ' negativo' : '') + '">' + fmtHa(o.aRealizar) + ' ha' + alerta + '</td>') +
      '</tr>' + (abertos.has(chaveOrdem(o)) ? detalheHtml(chaveOrdem(o)) : '');
  }

  function blocoSaldo(g) {
    const s = L.saldoDoCoordenador(linhaDa(g.unidade), vinculoDe(g.unidade, g.eq));
    // retrato gravado antes de o servidor mandar a origem de cada produto (as ordens ainda vêm sem o detalhe)
    const retratoNovo = ((linhaDa(g.unidade) || {}).ordens || []).some((o) => Array.isArray(o.ap));
    if (!s) {
      return '<div class="saldo sem-vinculo"><b>Depósito no SAP</b><span>Sem depósito vinculado a este coordenador.' +
        (admin ? ' <button type="button" class="link" data-ir="depositos" data-unidade="' + esc(g.unidade) + '">Vincular</button>' : '') + '</span></div>';
    }
    const cab = '<b>Depósito no SAP</b><span class="saldo-dep">' + esc(s.deposito) + ' · ' + esc(L.titulo(s.depositoNome)) + '</span>' +
      (s.origens.length ? '<span class="saldo-origem">recebe de ' + s.origens.map((o) => esc(o.c) + ' · ' + esc(L.titulo(o.n))).join(', ') + '</span>' : '');
    if (s.pendente) return '<div class="saldo"><div class="saldo-cab">' + cab + '</div><p class="saldo-nota">O saldo deste depósito ainda não foi lido. Clique em Atualizar ou aguarde a próxima atualização.</p></div>';
    if (!s.itens.length) return '<div class="saldo"><div class="saldo-cab">' + cab + '</div><p class="saldo-nota">Depósito sem saldo no SAP.</p></div>';
    return '<details class="saldo"' + (s.itens.length <= 20 ? ' open' : '') + '><summary class="saldo-cab">' + cab + '<span class="saldo-qtd">' + s.itens.length + (s.itens.length === 1 ? ' produto com saldo' : ' produtos com saldo') + '</span></summary>' +
      '<div class="tabela-rolagem"><table class="tabela tabela-saldo"><thead><tr><th>Produto</th><th class="n">Saldo no depósito</th>' +
        '<th title="Depósito de onde o produto veio na última transferência de estoque do SAP">Origem</th><th class="n">Saldo na origem</th></tr></thead><tbody>' +
      s.itens.map((i) => '<tr><td><span class="cod">' + esc(i.c) + '</span>' + esc(L.titulo(i.n)) + '</td><td class="n"><b>' + fmtQtd(i.q) + '</b> ' + esc(i.u) + '</td>' +
        (i.origem
          ? '<td class="origem"' + (i.transferidoEm ? ' title="Última transferência em ' + fmtData(i.transferidoEm) + '"' : '') + '>' + esc(i.origem) + '<span class="origem-nome"> · ' + esc(L.titulo(i.origemNome)) + '</span></td>' +
            '<td class="n">' + fmtQtd(i.origemSaldo) + ' ' + esc(i.u) + '</td>'
          : '<td class="origem sem" colspan="2">' + (retratoNovo ? 'sem transferência no SAP' : 'chega na próxima atualização') + '</td>') + '</tr>').join('') +
      '</tbody></table></div></details>';
  }

  function cartaoCoordenador(g, hoje) {
    const selos = [
      g.atraso ? '<span class="selo atraso">' + g.atraso + ' em alerta' + '</span>' : '',
      g.atencao ? '<span class="selo atencao">' + g.atencao + ' em atenção</span>' : '',
      g.ok ? '<span class="selo ok">' + g.ok + ' no prazo</span>' : '',
      g.excedidas ? '<span class="selo alerta">' + g.excedidas + (g.excedidas === 1 ? ' com área excedida' : ' com área excedida') + '</span>' : '',
    ].join('');
    return '<section class="cartao coordenador ' + (g.atraso ? 'atraso' : g.atencao ? 'atencao' : 'ok') + '">' +
      '<header class="cartao-cab"><div><h2>' + esc(L.titulo(g.eq)) + '</h2><p>' + esc(L.titulo(g.unidade)) + ' · ' + (g.ordens.length === 1 ? '1 ordem aberta' : g.ordens.length + ' ordens abertas') +
        ' · ' + fmtHa(g.ex, 0) + ' de ' + fmtHa(g.pl, 0) + ' ha apontados</p></div><div class="selos">' + selos + '</div></header>' +
      '<div class="tabela-rolagem"><table class="tabela tabela-ordens"><thead><tr><th>Ordem</th><th>Operação</th><th class="n">Abertura</th><th>Em aberto</th><th>Prazo de 5 dias</th><th>Evolução da área</th><th>Por dia</th><th class="n">A realizar</th></tr></thead><tbody>' +
      g.ordens.map((o) => linhaOrdem(o, hoje)).join('') + '</tbody></table></div>' +
      blocoSaldo(g) + '</section>';
  }

  function desenharAbertas() {
    const hoje = L.hojeIso();
    const r = L.abertasPorCoordenador(linhas, hoje, filtro());
    const t = L.resumoAbertas(r.grupos);
    $('resumo').innerHTML =
      cartaoResumo('Ordens abertas', t.ordens, '', t.coordenadores === 1 ? '1 coordenador' : t.coordenadores + ' coordenadores') +
      cartaoResumo('No prazo', t.ok, 'ok', 'até 2 dias em aberto') +
      cartaoResumo('Atenção', t.atencao, 'atencao', 'de 3 a 5 dias em aberto') +
      cartaoResumo('Em alerta', t.atraso, 'atraso', 'mais de 5 dias em aberto') +
      cartaoResumo('Área excedida', t.excedidas, t.excedidas ? 'alerta' : '', 'apontado maior que o planejado');
    // quem abriu a ordem fora do período escolhido não some sem aviso: a linha diz quantas ficaram de fora
    $('fora-periodo').hidden = !r.escondidas;
    $('fora-periodo').innerHTML = r.escondidas
      ? 'Fora do período: <b>' + r.escondidas + '</b> ' + (r.escondidas === 1 ? 'ordem aberta' : 'ordens abertas') +
        (r.maisAntiga ? ' (a mais antiga é de ' + fmtData(r.maisAntiga) + ')' : '') + '. <button type="button" class="link" data-periodo="tudo">Mostrar todas</button>'
      : '';
    $('coordenadores').innerHTML = r.grupos.length
      ? r.grupos.map((g) => cartaoCoordenador(g, hoje)).join('')
      : '<p class="vazio">Nenhuma ordem aberta' + (textoPeriodo() ? ' com abertura ' + textoPeriodo() : '') + (estado.equipe ? ' para este coordenador' : '') + '.</p>';
  }

  /* ------------------------------ fechadas com diferença ------------------------------ */
  function tabelaFechadas(lista, vazio) {
    if (!lista.length) return '<p class="vazio">' + esc(vazio) + '</p>';
    return '<table class="tabela tabela-fechadas"><thead><tr><th>Ordem</th><th>Fazenda</th><th>Coordenador</th><th>Operação</th><th class="n">Encerrada em</th><th class="n">Planejado</th><th class="n">Apontado</th><th class="n">Diferença</th></tr></thead><tbody>' +
      lista.map((o) => '<tr class="clicavel"' + attrsOrdem(o) + '><td class="os"><span class="seta" aria-hidden="true"></span><b>' + esc(o.os) + '</b></td><td class="faz">' + esc(L.titulo(o.unidade)) + '</td><td class="eq">' + esc(L.titulo(o.eq)) + '</td><td class="opn">' + esc(L.titulo(o.opn)) + '</td>' +
        '<td class="n enc">' + fmtData(o.enc) + '</td><td class="n pl">' + fmtHa(o.pl) + ' ha</td><td class="n ex">' + fmtHa(o.ex) + ' ha</td>' +
        '<td class="n dif ' + (o.dif < 0 ? 'menos' : 'mais') + '"><b>' + (o.dif > 0 ? '+' : '−') + fmtHa(Math.abs(o.dif)) + ' ha</b>' + (o.pct === null ? '' : '<small>' + fmtPct(o.pct) + ' do planejado</small>') + '</td></tr>' +
        (abertos.has(chaveOrdem(o)) ? detalheHtml(chaveOrdem(o)) : '')).join('') +
      '</tbody></table>';
  }
  function desenharFechadas() {
    const r = L.fechadasComDiferenca(linhas, filtro());
    const safra = L.inicioSafra(L.hojeIso());
    $('explica-fechadas').innerHTML = 'Ordens <b>fechadas</b> ' + (textoPeriodo() || 'nesta safra') + ' em que a área apontada difere da planejada em mais de 1 ha.' +
      (!estado.de || estado.de < safra ? ' O painel guarda as fechadas desde ' + fmtData(safra) + '.' : '');
    $('n-faltando').textContent = r.faltando.length === 1 ? '1 ordem' : r.faltando.length + ' ordens';
    $('n-sobrando').textContent = r.sobrando.length === 1 ? '1 ordem' : r.sobrando.length + ' ordens';
    $('tab-faltando').innerHTML = tabelaFechadas(r.faltando, 'Nenhuma ordem fechada faltando área.');
    $('tab-sobrando').innerHTML = tabelaFechadas(r.sobrando, 'Nenhuma ordem fechada com área a mais.');
    return r.faltando.length + r.sobrando.length;
  }

  /* ------------------------------ boletins com falha de integração ------------------------------ */
  const abertosBol = new Set();  // chaves dos boletins com o detalhe aberto
  let boletinsNaTela = new Map(); // chave → boletim (do último desenho), para abrir o detalhe sem refazer as contas
  const textoHa = (dias) => (dias === null ? '—' : dias === 0 ? 'hoje' : dias === 1 ? 'há 1 dia' : 'há ' + dias + ' dias');
  /** O que há de errado no item, com os números: "precisa de 8.322 KG, tem 1.200 KG". */
  function situacaoItem(i) {
    const pr = i.pr || [];
    if (!pr.length) return '<span class="bom">sem problema</span>';
    return pr.map((p) => {
      if (p === 'sem-estoque') {
        return 'Saldo insuficiente: precisa de <b>' + fmtQtd(i.q) + ' ' + esc(i.u) + '</b>, tem <b>' + fmtQtd(i.s || 0) + ' ' + esc(i.u) + '</b>' +
          (i.ant ? ' (e outros boletins na frente tiram ' + fmtQtd(i.ant) + ' ' + esc(i.u) + ' do mesmo saldo)' : '');
      }
      return esc(L.PROBLEMAS_ITEM[p] || p);
    }).join('<br>');
  }
  function detalheBoletim(b) {
    const causas = b.causas.length
      ? '<ul class="bol-causas">' + b.causas.map((c) => '<li' + (c.tecnica ? ' class="tecnica"' : '') + '><b>' + esc(c.titulo) + '.</b> ' + esc(c.texto) + '</li>').join('') + '</ul>'
      : '';
    const previsto = b.sit === 'P' && b.problemas.length
      ? '<p class="det-nota">Quando o PIMS enviar este boletim, o SAP deve recusar por: <b>' + b.problemas.map(esc).join('; ') + '</b>.</p>' : '';
    const bruto = (b.m || []).length ? '<p class="bol-bruto">Mensagem do SAP: ' + b.m.map((m) => '<code>' + esc(m) + '</code>').join(' ') + '</p>' : '';
    const itens = b.it.length
      ? '<div class="det-grade det-itens"><div class="det-linha cab"><span>Produto</span><span>Depósito</span><span class="n">Quantidade</span><span class="n">Saldo no SAP</span><span>Situação</span></div>' +
        b.it.map((i) => '<div class="det-linha' + ((i.pr || []).length ? ' ruim' : '') + '"><span><small>' + esc(i.c) + '</small> ' + esc(L.titulo(i.nm || '')) + '</span><span>' + esc(i.dp || '—') + '</span>' +
          '<span class="n">' + fmtQtd(i.q) + ' ' + esc(i.u) + '</span><span class="n">' + (typeof i.s === 'number' ? fmtQtd(i.s) + ' ' + esc(i.u) : '—') + '</span><span class="c-sit">' + situacaoItem(i) + '</span></div>').join('') + '</div>'
      : '<p class="det-nota">' + (b.si === 1 ? 'Este boletim não tem nenhum item lançado: não há o que integrar. Confira se o lançamento ficou incompleto.' : 'Sem itens.') + '</p>';
    return '<tr class="detalhe"><td colspan="5"><div class="bol-det">' + causas + previsto + bruto + '<h3>Itens do boletim</h3>' + itens + '</div></td></tr>';
  }
  function tabelaBoletins(lista, vazio) {
    if (!lista.length) return '<p class="vazio">' + esc(vazio) + '</p>';
    return '<table class="tabela tabela-boletins"><thead><tr><th>Boletim</th><th class="n">Data</th><th>Ordem e coordenador</th><th>O que aconteceu</th><th>Desde</th></tr></thead><tbody>' +
      lista.map((b) => {
        const titulos = b.sit === 'F' ? (b.causas.length ? b.causas.map((c) => c.titulo) : ['Recusado pelo SAP']) : (b.problemas.length ? b.problemas : ['Aguardando envio ao SAP']);
        const resumo = b.sit === 'F'
          ? (b.comProblema ? b.comProblema + (b.comProblema === 1 ? ' item com problema na conferência' : ' itens com problema na conferência') : 'conferência de saldo e cadastro sem problema')
          : (b.it.length === 1 ? '1 item' : b.it.length + ' itens') + (b.comProblema ? ' · ' + b.comProblema + ' com problema' : '');
        return '<tr class="clicavel boletim"' + ' data-boletim="' + esc(b.chave) + '" tabindex="0" aria-expanded="' + (abertosBol.has(b.chave) ? 'true' : 'false') + '" title="Clique para ver os itens e o motivo">' +
          '<td class="os"><span class="seta" aria-hidden="true"></span><b>' + esc(b.n) + '</b><small>' + esc(b.tipo) + '</small></td>' +
          '<td class="n dia">' + fmtData(b.d) + '</td>' +
          '<td class="quem">' + (b.os === null ? '<span class="fraco">sem ordem</span>' : 'OS <b>' + esc(b.os) + '</b>') + '<small>' + (b.eq ? esc(L.titulo(b.eq)) : '—') + (estado.unidade ? '' : ' · ' + esc(L.titulo(b.unidade))) + '</small></td>' +
          '<td class="motivo"><b>' + titulos.map(esc).join(' · ') + '</b><small>' + esc(resumo) + '</small></td>' +
          '<td class="desde">' + textoHa(b.dias) + (b.sit === 'F' && b.t ? '<small>' + (b.t === 1 ? '1 tentativa' : b.t + ' tentativas') + (b.ul ? ' · última em ' + fmtDataCurta(b.ul) : '') + '</small>' : b.em ? '<small>lançado em ' + fmtDataHora(b.em) + '</small>' : '') + '</td></tr>' +
          (abertosBol.has(b.chave) ? detalheBoletim(b) : '');
      }).join('') + '</tbody></table>';
  }
  function desenharBoletins(r) {
    boletinsNaTela = new Map([].concat(r.falhas, r.vaoFalhar, r.aguardando).map((b) => [b.chave, b]));
    $('explica-boletins').innerHTML = semColunaBoletins
      ? '<b>Esta aba ainda não foi ativada no banco</b> (falta rodar o script 0008 no Supabase).'
      : 'Boletins lançados desde ' + fmtData(L.inicioSafra(L.hojeIso())) + ' que o SAP recusou ou que ainda não foram integrados. O motivo vem do log de integração do SAP; o saldo e o cadastro dos itens são conferidos a cada atualização. Clique num boletim para ver os itens. O filtro de período não vale nesta aba.';
    $('resumo-boletins').innerHTML =
      cartaoResumo('Recusados pelo SAP', r.falhas.length, r.falhas.length ? 'atraso' : '', 'tentou integrar e voltou com erro') +
      cartaoResumo('Vão falhar', r.vaoFalhar.length, r.vaoFalhar.length ? 'atencao' : '', 'ainda não enviados, com problema previsto') +
      cartaoResumo('Aguardando envio', r.aguardando.length, 'ok', 'ainda não enviados, sem problema previsto');
    const n = (lista) => (lista.length === 1 ? '1 boletim' : lista.length + ' boletins');
    $('n-bol-falhas').textContent = n(r.falhas);
    $('n-bol-vao').textContent = n(r.vaoFalhar);
    $('n-bol-aguardando').textContent = n(r.aguardando);
    $('tab-bol-falhas').innerHTML = tabelaBoletins(r.falhas, 'Nenhum boletim recusado pelo SAP.');
    $('tab-bol-vao').innerHTML = tabelaBoletins(r.vaoFalhar, 'Nenhum boletim pendente com problema previsto.');
    $('tab-bol-aguardando').innerHTML = tabelaBoletins(r.aguardando, 'Nenhum boletim aguardando envio.');
  }
  function alternarBoletim(tr) {
    const k = tr.dataset.boletim;
    const prox = tr.nextElementSibling;
    if (prox && prox.classList.contains('detalhe')) { prox.remove(); abertosBol.delete(k); tr.setAttribute('aria-expanded', 'false'); return; }
    const b = boletinsNaTela.get(k);
    if (!b) return;
    tr.insertAdjacentHTML('afterend', detalheBoletim(b));
    abertosBol.add(k);
    tr.setAttribute('aria-expanded', 'true');
  }

  /* ------------------------------ pendências (por onde começar) ------------------------------ */
  function desenharPendencias() {
    const p = L.pendencias(linhas, vinculos, L.hojeIso(), filtro());
    const cartao = (vista, n, titulo, texto, classe) => (VISTAS.indexOf(vista) < 0 ? ''
      : '<button type="button" class="pend ' + (n ? classe : 'zero') + '" data-ir-vista="' + vista + '"><b>' + n + '</b><span class="pend-titulo">' + esc(titulo) + '</span><span class="pend-texto">' + esc(texto) + '</span></button>');
    $('explica-pendencias').textContent = MODO_CONTROLE
      ? 'O que pede a sua atenção hoje. Toque num quadro para abrir a lista.'
      : 'O que pede ação hoje, na ordem em que costuma dar problema. Clique num quadro para abrir a lista.';
    $('pendencias').innerHTML =
      cartao('boletins', p.recusados, 'Boletins recusados pelo SAP', 'A integração tentou e voltou com erro: corrija o motivo para o boletim passar.', 'ruim') +
      cartao('boletins', p.vaoFalhar, 'Boletins que vão falhar', 'Ainda não foram enviados, mas o saldo ou o cadastro já mostra que o SAP vai recusar.', 'atencao') +
      cartao('apontamentos', p.apontamentos, 'Apontamentos com alerta', 'Lançados nos últimos 3 dias com talhão fora da ordem, área acima do planejado, atraso ou duplicidade.', 'ruim') +
      cartao('abertas', p.excedidas, 'Ordens com área excedida', 'A área apontada passou da planejada: confira o talhão lançado.', 'ruim') +
      cartao('abertas', p.emAlerta, 'Ordens em alerta', 'Abertas há mais de 5 dias, dentro do período escolhido.', 'atencao') +
      cartao('abertas', p.prontas, 'Ordens prontas para fechar', 'Toda a área planejada já foi apontada: é só encerrar no PIMS.', 'ok') +
      cartao('fechadas', p.fechadas, 'Fechadas com diferença', 'Encerradas faltando área ou com área a mais, no período.', 'atencao') +
      cartao('estoque', p.emFalta, 'Produtos em falta para as ordens', 'O que as ordens abertas ainda vão consumir não cabe no saldo do depósito do coordenador.', 'ruim') +
      cartao('doses', p.doses, 'Doses fora do programado sem justificativa', 'Aplicações dos últimos 10 dias com a dose real mais de 10% diferente da receita e sem a Observação preenchida no boletim.', 'atencao') +
      cartao('coletor', p.coletor, 'Boletins em validação com problema', 'Estão na tela de validação do PIMS com erro registrado ou previsto para a importação.', 'atencao');
  }

  /* ------------------------------ apontamentos do dia ------------------------------ */
  function desenharApontamentos() {
    const lista = L.conferirApontamentos(linhas, { unidade: estado.unidade, equipe: estado.equipe, soAlertas: estado.soAlertas });
    $('explica-apontamentos').innerHTML = 'Apontamentos feitos ou lançados nos <b>últimos 3 dias</b>, com a conferência automática de cada um. Corrigir no mesmo dia evita que o erro chegue ao SAP. A última coluna mostra quem mexeu no registro por último (pode ser a própria integração).';
    $('chk-so-alertas').checked = estado.soAlertas;
    if (!lista.length) { $('tab-apontamentos').innerHTML = '<p class="vazio">' + (estado.soAlertas ? 'Nenhum apontamento com alerta nos últimos 3 dias.' : 'Nenhum apontamento nos últimos 3 dias.') + '</p>'; return; }
    $('tab-apontamentos').innerHTML = '<table class="tabela tabela-cartoes tabela-apont"><thead><tr><th>Boletim</th><th>Data</th><th>Ordem e coordenador</th><th>Talhão</th><th class="n">Área</th><th>Conferência</th><th>Última alteração</th></tr></thead><tbody>' +
      lista.map((a) => '<tr class="' + (a.alertas.length ? 'com-alerta' : '') + '">' +
        '<td class="principal"><b>' + (a.b === null ? '—' : esc(a.b)) + '</b> <small>' + esc(a.tipo) + '</small></td>' +
        '<td data-rotulo="Data">' + fmtData(a.d) + '</td>' +
        '<td data-rotulo="Ordem">' + (a.os === null ? '<span class="fraco">sem ordem</span>' : 'OS <b>' + esc(a.os) + '</b>' + (a.s === 'F' ? ' <small class="fraco">(fechada)</small>' : '')) +
          '<small>' + (a.eq ? esc(L.titulo(a.eq)) : '—') + (estado.unidade ? '' : ' · ' + esc(L.titulo(a.unidade))) + ' · ' + esc(L.titulo(a.opn)) + '</small></td>' +
        '<td data-rotulo="Talhão"><b>' + esc(a.tl || '—') + '</b>' + (a.pt !== null && a.pt !== undefined ? '<small>' + fmtHa(a.xt) + ' de ' + fmtHa(a.pt) + ' ha no talhão</small>' : '') + '</td>' +
        '<td class="n" data-rotulo="Área">' + fmtHa(a.ha) + ' ha</td>' +
        '<td class="confere" data-rotulo="Conferência">' + (a.alertas.length ? a.alertas.map((c) => '<span class="alerta-linha">' + esc(L.ALERTAS_APONT[c] || c) + (c === 'atrasado' ? ' (' + a.demora + ' dias depois)' : '') + '</span>').join('') : '<span class="bom">sem alerta</span>') + '</td>' +
        '<td data-rotulo="Última alteração">' + (a.la ? fmtDataHora(a.la) : '—') + '<small>' + esc(a.por || '') + '</small></td></tr>').join('') +
      '</tbody></table>';
  }

  /* ------------------------------ estoque x necessidade ------------------------------ */
  function desenharEstoque() {
    const grupos = L.necessidadePorCoordenador(linhas, vinculos, filtro());
    $('explica-estoque').innerHTML = 'O que as <b>ordens abertas</b> no período ainda vão consumir de cada produto (planejado menos o que já foi lançado), contra o saldo do depósito do coordenador no SAP. ' +
      'O que falta precisa de transferência antes da aplicação; o que está parado pode voltar para a origem.';
    if (!grupos.length) { $('necessidade').innerHTML = '<p class="vazio">Nenhuma ordem aberta com produto a consumir neste período.</p>'; return; }
    $('necessidade').innerHTML = grupos.map((g) => {
      const cab = '<header class="cartao-cab"><div><h2>' + esc(L.titulo(g.eq)) + '</h2><p>' + esc(L.titulo(g.unidade)) + ' · ' +
        (g.deposito ? 'depósito ' + esc(g.deposito) + ' · ' + esc(L.titulo(g.depositoNome)) : 'sem depósito vinculado' + (admin ? ' <button type="button" class="link" data-ir="depositos" data-unidade="' + esc(g.unidade) + '">Vincular</button>' : '')) + '</p></div>' +
        '<div class="selos">' + (g.emFalta ? '<span class="selo atraso">' + g.emFalta + (g.emFalta === 1 ? ' produto em falta' : ' produtos em falta') + '</span>' : (g.deposito && g.itens.length ? '<span class="selo ok">saldo cobre as ordens</span>' : '')) + '</div></header>';
      const nota = g.pendente ? '<p class="saldo-nota">O saldo deste depósito ainda não foi lido: entra na próxima atualização.</p>' : '';
      const itens = g.itens.length
        ? '<div class="tabela-rolagem"><table class="tabela tabela-cartoes tabela-nec"><thead><tr><th>Produto</th><th class="n">Falta consumir</th><th class="n">Saldo no depósito</th><th class="n">Falta transferir</th><th>Origem</th><th>Ordens</th></tr></thead><tbody>' +
          g.itens.map((i) => '<tr class="' + (i.falta > 0 ? 'com-alerta' : '') + '"><td class="principal"><small>' + esc(i.c) + '</small> ' + esc(L.titulo(i.nm)) + '</td>' +
            '<td class="n" data-rotulo="Falta consumir">' + fmtQtd(i.nec) + ' ' + esc(i.u) + '</td>' +
            '<td class="n" data-rotulo="Saldo no depósito">' + (i.saldo === null ? '—' : fmtQtd(i.saldo) + ' ' + esc(i.u)) + '</td>' +
            '<td class="n falta" data-rotulo="Falta transferir">' + (i.falta === null ? '—' : i.falta > 0 ? '<b>' + fmtQtd(i.falta) + ' ' + esc(i.u) + '</b>' : '<span class="bom">nada</span>') + '</td>' +
            '<td data-rotulo="Origem">' + (i.origem ? esc(i.origem) + '<small>' + esc(L.titulo(i.origemNome)) + ' · saldo ' + fmtQtd(i.origemSaldo) + ' ' + esc(i.u) + '</small>' : '<span class="fraco">sem transferência anterior</span>') + '</td>' +
            '<td data-rotulo="Ordens">' + i.ordens.map(esc).join(', ') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="saldo-nota">Nenhum produto a consumir nas ordens abertas do período.</p>';
      const parados = g.parados.length
        ? '<details class="saldo"><summary class="saldo-cab"><b>Parado no depósito</b><span>' + g.parados.length + (g.parados.length === 1 ? ' produto com saldo e sem ordem aberta que o use' : ' produtos com saldo e sem ordem aberta que os use') + '</span></summary>' +
          '<div class="tabela-rolagem"><table class="tabela tabela-saldo"><thead><tr><th>Produto</th><th class="n">Saldo no depósito</th><th>Veio de</th></tr></thead><tbody>' +
          g.parados.map((i) => '<tr><td><span class="cod">' + esc(i.c) + '</span>' + esc(L.titulo(i.nm)) + '</td><td class="n"><b>' + fmtQtd(i.saldo) + '</b> ' + esc(i.u) + '</td><td class="origem">' + (i.origem ? esc(i.origem) + '<span class="origem-nome"> · ' + esc(L.titulo(i.origemNome)) + '</span>' : '—') + '</td></tr>').join('') +
          '</tbody></table></div></details>'
        : '';
      return '<section class="cartao">' + cab + nota + itens + parados + '</section>';
    }).join('');
  }

  /* ------------------------------ dose real x programada ------------------------------ */
  function desenharDoses() {
    const lista = L.dosesFora(linhas, filtro());
    const semJust = lista.filter((d) => !d.justificada).length;
    $('explica-doses').innerHTML = 'Aplicações dos últimos 10 dias (dentro do período escolhido) em que a <b>dose real</b> lançada no boletim ficou mais de 10% diferente da <b>dose programada</b> na ordem. ' +
      'Quando a variação aconteceu de verdade, o coordenador justifica no campo <b>Observação</b> do boletim no PIMS: essas ficam em verde. As demais costumam ser área ou quantidade digitada errada.' +
      (lista.length ? ' <b>' + semJust + '</b> sem justificativa e <b>' + (lista.length - semJust) + '</b> justificada' + (lista.length - semJust === 1 ? '' : 's') + '.' : '');
    if (!lista.length) { $('tab-doses').innerHTML = '<p class="vazio">Nenhuma aplicação com a dose fora do programado neste período.</p>'; return; }
    $('tab-doses').innerHTML = '<table class="tabela tabela-cartoes tabela-doses"><thead><tr><th>Produto</th><th>Boletim</th><th>Ordem e coordenador</th><th>Talhão</th><th class="n">Programada</th><th class="n">Real</th><th class="n">Desvio</th><th class="n">Área</th><th class="n">Consumo</th><th>Justificativa</th></tr></thead><tbody>' +
      lista.map((d) => '<tr class="' + (d.justificada ? 'justificada' : 'com-alerta') + '"><td class="principal"><small>' + esc(d.c || '') + '</small> ' + esc(L.titulo(d.nm)) + '</td>' +
        '<td data-rotulo="Boletim"><b>' + esc(d.b) + '</b><small>' + fmtData(d.d) + '</small></td>' +
        '<td data-rotulo="Ordem">' + (d.os === null ? '<span class="fraco">sem ordem</span>' : 'OS <b>' + esc(d.os) + '</b>') + '<small>' + (d.eq ? esc(L.titulo(d.eq)) : '—') + (estado.unidade ? '' : ' · ' + esc(L.titulo(d.unidade))) + '</small></td>' +
        '<td data-rotulo="Talhão"><b>' + esc(d.tl || '—') + '</b></td>' +
        '<td class="n" data-rotulo="Programada">' + fmtQtd(d.pg) + '</td><td class="n" data-rotulo="Real">' + fmtQtd(d.re) + '</td>' +
        '<td class="n desvio ' + (d.desvio > 0 ? 'mais' : 'menos') + '" data-rotulo="Desvio"><b>' + (d.desvio > 0 ? '+' : '−') + Math.round(Math.abs(d.desvio) * 100) + '%</b></td>' +
        '<td class="n" data-rotulo="Área">' + fmtHa(d.ha) + ' ha</td><td class="n" data-rotulo="Consumo">' + fmtQtd(d.q) + '</td>' +
        '<td class="confere just" data-rotulo="Justificativa">' + (d.justificada ? '<span class="bom">' + esc(d.ju) + '</span>' : '<span class="alerta-linha">sem justificativa</span>') + '</td></tr>').join('') +
      '</tbody></table>';
  }

  /* ------------------------------ boletins em validação no PIMS ------------------------------ */
  function desenharColetor() {
    const lista = L.coletorTravados(linhas, L.hojeIso(), { unidade: estado.unidade, equipe: estado.equipe });
    $('explica-coletor').innerHTML = 'Boletins que <b>já estão no PIMS, na tela de validação</b>, aguardando a importação (lançados desde ' + fmtData(L.inicioSafra(L.hojeIso())) + '). ' +
      'Enquanto não são importados, não contam como apontamento. A lista mostra o erro que o PIMS registrou, quando houve, e os <b>possíveis erros</b> que a conferência prevê para a importação.';
    if (!lista.length) { $('tab-coletor').innerHTML = '<p class="vazio">Nenhum boletim na tela de validação do PIMS.</p>'; return; }
    $('tab-coletor').innerHTML = '<table class="tabela tabela-cartoes tabela-coletor"><thead><tr><th>Boletim</th><th>Data</th><th>Ordem e coordenador</th><th>Talhão</th><th>Situação e possíveis erros</th><th>Parado</th><th>Última alteração</th></tr></thead><tbody>' +
      lista.map((c) => '<tr class="' + (c.comProblema ? 'com-alerta' : '') + '"><td class="principal"><b>' + (c.b === null ? '—' : esc(c.b)) + '</b> <small>' + esc(c.tipo) + '</small></td>' +
        '<td data-rotulo="Data">' + fmtData(c.d) + '</td>' +
        '<td data-rotulo="Ordem">' + (c.os ? 'OS <b>' + esc(c.os) + '</b>' + (c.oss === 'F' ? ' <small class="fraco">(fechada)</small>' : '') : '<span class="fraco">sem ordem</span>') +
          '<small>' + (c.eq ? esc(L.titulo(c.eq)) : '—') + (estado.unidade ? '' : ' · ' + esc(L.titulo(c.unidade))) + (c.opn ? ' · ' + esc(L.titulo(c.opn)) : '') + '</small></td>' +
        '<td data-rotulo="Talhão">' + (c.tl ? '<b>' + esc(c.tl) + '</b><small>' + fmtHa(c.ha) + ' ha' + (c.pt !== null && c.pt !== undefined ? ' · ' + fmtHa(c.xt) + ' de ' + fmtHa(c.pt) + ' ha já apontados' : '') + '</small>' : '—') + '</td>' +
        '<td class="confere" data-rotulo="Situação"><b>' + esc(c.situacao) + '</b>' +
          c.motivos.map((m) => '<span class="alerta-linha">' + esc(m) + '</span>').join('') +
          (c.previstos.length ? '<span class="previsto-rotulo">' + (c.previstos.length === 1 ? 'Possível erro na importação' : 'Possíveis erros na importação') + '</span>' + c.previstos.map((x) => '<span class="alerta-linha">' + esc(x.texto) + '</span>').join('')
            : (c.recusado ? '' : '<span class="bom">nenhum erro previsto</span>')) + '</td>' +
        '<td data-rotulo="Parado">' + textoHa(c.dias) + '</td>' +
        '<td data-rotulo="Última alteração">' + (c.la ? fmtDataHora(c.la) : '—') + '<small>' + esc(c.por || '') + '</small></td></tr>').join('') +
      '</tbody></table>';
  }

  /* ------------------------------ depósitos dos coordenadores ------------------------------ */
  function opcoesDeposito(linha, escolhido) {
    const lista = (linha.depositos || []).filter((d) => !d.i || d.c === escolhido);
    const tem = !escolhido || lista.some((d) => d.c === escolhido);
    return '<option value="">— sem depósito —</option>' +
      (tem ? '' : '<option value="' + esc(escolhido) + '" selected>' + esc(escolhido) + ' · (não está na lista do PIMS)</option>') +
      lista.map((d) => '<option value="' + esc(d.c) + '"' + (d.c === escolhido ? ' selected' : '') + '>' + esc(d.c) + ' · ' + esc(L.titulo(d.n)) + (d.i ? ' (inativo no SAP)' : '') + '</option>').join('');
  }
  function desenharDepositos() {
    $('explica-depositos').innerHTML = admin
      ? 'Escolha o <b>depósito de cada coordenador no SAP</b>. O saldo aparece no painel do coordenador depois da próxima atualização, e a origem de cada produto vem sozinha das transferências de estoque do SAP. ' +
        'O acesso do coordenador ao Controle Técnico é dado na página <b>Usuários</b>: perfil Coordenador e a equipe dele no PIMS.'
      : 'Depósito do SAP de cada coordenador. A origem de cada produto vem das transferências de estoque do SAP. Só administradores alteram estes vínculos.';
    const lista = L.coordenadoresComVinculo(linhas, vinculos, { unidade: estado.unidade }).filter((c) => !estado.equipe || c.eq === estado.equipe);
    if (!lista.length) { $('vinculos').innerHTML = '<p class="vazio">Nenhum coordenador com ordem de serviço' + (estado.unidade ? ' nesta fazenda' : '') + '.</p>'; return; }
    const porUnidade = new Map();
    lista.forEach((c) => { if (!porUnidade.has(c.unidade)) porUnidade.set(c.unidade, []); porUnidade.get(c.unidade).push(c); });
    $('vinculos').innerHTML = Array.from(porUnidade.entries()).map(([unidade, coords]) => {
      const linha = linhaDa(unidade) || { depositos: [] };
      return '<section class="cartao"><header class="cartao-cab"><div><h2>' + esc(L.titulo(unidade)) + '</h2><p>' + (coords.length === 1 ? '1 coordenador' : coords.length + ' coordenadores') +
        ' · ' + (linha.depositos || []).filter((d) => !d.i).length + ' depósitos no SAP</p></div></header>' +
        '<div class="tabela-rolagem"><table class="tabela tabela-vinculos"><thead><tr><th>Coordenador</th><th class="n">Ordens abertas</th><th>Depósito do coordenador</th><th></th></tr></thead><tbody>' +
        coords.map((c) => '<tr data-unidade="' + esc(c.unidade) + '" data-equipe="' + esc(c.eq) + '"><td><b>' + esc(L.titulo(c.eq)) + '</b></td><td class="n">' + c.abertas + '</td>' +
          '<td><select data-campo="deposito" aria-label="Depósito de ' + esc(L.titulo(c.eq)) + '"' + (admin ? '' : ' disabled') + '>' + opcoesDeposito(linha, c.deposito) + '</select></td>' +
          '<td class="situacao" aria-live="polite"></td></tr>').join('') +
        '</tbody></table></div></section>';
    }).join('');
  }

  async function salvarVinculo(tr) {
    const v = {
      unidade: tr.dataset.unidade, equipe: tr.dataset.equipe,
      deposito: tr.querySelector('[data-campo="deposito"]').value || null,
    };
    const sit = tr.querySelector('.situacao');
    sit.className = 'situacao'; sit.textContent = 'Salvando…';
    try {
      await fonte.salvarVinculo(v);
      vinculos = vinculos.filter((x) => !(x.unidade === v.unidade && x.equipe === v.equipe));
      if (v.deposito) vinculos.push(v);
      sit.className = 'situacao ok';
      sit.textContent = v.deposito ? 'Salvo. O saldo entra na próxima atualização.' : 'Vínculo removido.';
    } catch (e) {
      sit.className = 'situacao erro';
      sit.textContent = e && e.message ? e.message : 'Não foi possível salvar.';
    }
  }

  /* ------------------------------ tela ------------------------------ */
  function avisar(texto, tipo) {
    const el = $('aviso');
    el.hidden = !texto; el.textContent = texto || ''; el.className = 'aviso' + (tipo ? ' ' + tipo : '');
  }
  function desenhar() {
    preencherUnidades();
    preencherEquipes();
    document.querySelectorAll('#abas [data-vista]').forEach((b) => { b.hidden = VISTAS.indexOf(b.dataset.vista) < 0; b.setAttribute('aria-selected', String(b.dataset.vista === estado.vista)); });
    TODAS_AS_VISTAS.forEach((v) => { $('vista-' + v).hidden = v !== estado.vista; });
    const hoje = L.hojeIso();
    // os números das abas valem para o filtro escolhido
    $('conta-abertas').textContent = L.resumoAbertas(L.abertasPorCoordenador(linhas, hoje, filtro()).grupos).ordens;
    const f = L.fechadasComDiferenca(linhas, filtro());
    $('conta-fechadas').textContent = f.faltando.length + f.sobrando.length;
    const bol = L.boletinsComProblema(linhas, hoje, filtro());
    $('conta-boletins').textContent = bol.falhas.length + bol.vaoFalhar.length;
    $('conta-apontamentos').textContent = L.conferirApontamentos(linhas, { unidade: estado.unidade, equipe: estado.equipe, soAlertas: true }).length;
    $('conta-estoque').textContent = L.necessidadePorCoordenador(linhas, vinculos, filtro()).reduce((s, g) => s + g.emFalta, 0);
    $('conta-doses').textContent = L.dosesFora(linhas, filtro()).filter((d) => !d.justificada).length;
    $('conta-coletor').textContent = L.coletorTravados(linhas, hoje, { unidade: estado.unidade, equipe: estado.equipe }).filter((c) => c.comProblema).length;
    if (estado.vista === 'pendencias') desenharPendencias();
    else if (estado.vista === 'abertas') desenharAbertas();
    else if (estado.vista === 'fechadas') desenharFechadas();
    else if (estado.vista === 'apontamentos') desenharApontamentos();
    else if (estado.vista === 'boletins') desenharBoletins(bol);
    else if (estado.vista === 'estoque') desenharEstoque();
    else if (estado.vista === 'doses') desenharDoses();
    else if (estado.vista === 'coletor') desenharColetor();
    else desenharDepositos();
    const mais = linhas.reduce((m, l) => (l.gerado_em > m ? l.gerado_em : m), '');
    $('atualizado').innerHTML = mais ? 'PIMS · <b>' + new Date(mais).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</b>' : '';
    const semSap = linhas.some((l) => (l.avisos || []).length);
    if (!linhas.length || (MODO_CONTROLE && !linhas[0].gerado_em)) avisar(MODO_CONTROLE ? 'Ainda não há dados desta equipe. O servidor grava as ordens a cada hora.' : 'Ainda não há dados da validação. O servidor grava as ordens a cada hora; clique em Atualizar para buscar agora.', '');
    else if (estado.unidade === SEM_UNIDADE) avisar('A fazenda escolhida no menu não tem ordens de serviço no PIMS (ou você não tem acesso à unidade dela).', '');
    else if (semSap) avisar('O saldo de alguns depósitos do SAP não pôde ser lido na última atualização. As ordens estão atualizadas.', 'alerta');
    else if (!$('aviso').classList.contains('fixo')) avisar('', '');
  }

  function avisarPai() {
    if (!EMBED || window.parent === window) return;
    const f = fazendasCoa.find((x) => x.unidade === estado.unidade);
    try { window.parent.postMessage({ tipo: PREFIXO + '-rota', vista: estado.vista, coaFazenda: f && !MODO_CONTROLE ? f.coaId : null }, location.origin); } catch (e) { /* fora do COA WEB */ }
  }
  /** A fazenda do menu lateral do COA WEB manda na unidade: pelo cadastro do Mapas e, sem ele, pelo nome. */
  function aplicarFazendaCoa() {
    if (MODO_CONTROLE) { estado.unidade = linhas.length ? linhas[0].unidade : TODAS; return; } // o depósito manda, não a fazenda do menu
    if (coaFazenda === undefined) return;
    const anterior = estado.unidade;
    if (coaFazenda === null) estado.unidade = TODAS;
    else {
      const f = fazendasCoa.find((x) => x.coaId === coaFazenda && unidades().indexOf(x.unidade) >= 0);
      estado.unidade = (f ? f.unidade : L.unidadeDaFazenda(coaFazendaNome, unidades())) || SEM_UNIDADE;
    }
    if (estado.unidade !== anterior) estado.equipe = TODAS;
  }

  async function carregar() {
    const d = await fonte.ler();
    linhas = (d.linhas || []).map((l) => Object.assign({ ordens: [], coordenadores: [], depositos: [], estoque: {}, boletins: [], avisos: [] }, l));
    semColunaBoletins = !!d.semBoletins;
    if (MODO_CONTROLE) {
      equipesControle = d.equipesControle || [];
      equipeControle = d.equipeControle || '';
      const sel = $('sel-deposito');
      sel.innerHTML = equipesControle.map((x) => '<option value="' + esc(x.unidade + '|' + x.equipe) + '">' + esc(L.titulo(x.equipe)) + ' (' + esc(L.titulo(x.unidade)) + ')</option>').join('');
      sel.value = equipeControle;
      sel.closest('label').hidden = equipesControle.length < 2; // só o administrador tem mais de uma para escolher
      const atual = equipesControle.find((x) => x.unidade + '|' + x.equipe === equipeControle);
      $('marca-sub').textContent = atual
        ? L.titulo(atual.equipe) + ' · ' + L.titulo(atual.unidade) + ' · ' + (atual.deposito ? 'depósito ' + atual.deposito + (atual.deposito_nome ? ' · ' + L.titulo(atual.deposito_nome) : '') : 'sem depósito vinculado')
        : 'Suas ordens, apontamentos e estoque';
    }
    vinculos = d.vinculos || [];
    admin = !!d.admin;
    fazendasCoa = (d.fazendas || []).filter((f) => f.unidade_pims && typeof f.coa_fazenda_id === 'number')
      .map((f) => ({ unidade: String(f.unidade_pims).toUpperCase(), coaId: f.coa_fazenda_id }));
  }

  async function atualizar() {
    if (atualizando) return;
    atualizando = true;
    const btn = $('btn-atualizar');
    btn.disabled = true;
    $('aviso').classList.add('fixo');
    avisar('Pedindo ao servidor…', '');
    try {
      const id = await fonte.pedirAtualizacao();
      avisar('Buscando as ordens no PIMS e o saldo no SAP… (até 1 minuto)', '');
      let fim = null;
      for (let esperado = 0; esperado < LIMITE_MS && !fim; esperado += INTERVALO_MS) {
        await new Promise((r) => setTimeout(r, INTERVALO_MS));
        const s = await fonte.situacaoPedido(id);
        if (s && s.atendido_em) fim = s;
      }
      if (!fim) throw new Error('O servidor não respondeu a tempo. As ordens também são atualizadas sozinhas a cada hora.');
      if (String(fim.resultado || '').trim() !== 'ok') throw new Error('O servidor não conseguiu atualizar: ' + (String(fim.resultado || '').replace(/^\s*erro:\s*/i, '').trim() || 'sem detalhes'));
      await carregar();
      $('aviso').classList.remove('fixo');
      avisar('', '');
      desenhar();
    } catch (e) {
      $('aviso').classList.remove('fixo');
      desenhar();
      avisar(e && e.message ? e.message : 'Não foi possível atualizar.', 'erro');
    } finally {
      atualizando = false;
      btn.disabled = false;
    }
  }

  /** Troca de tela: guarda no endereço (o botão voltar do navegador funciona) e avisa o COA WEB. */
  function irPara(vista) {
    estado.vista = VISTAS.indexOf(vista) >= 0 ? vista : 'pendencias';
    if (location.hash.replace(/^#/, '') !== estado.vista) history.replaceState(null, '', '#' + estado.vista);
    desenhar();
    avisarPai();
    window.scrollTo(0, 0);
  }

  /* ------------------------------ eventos ------------------------------ */
  window.addEventListener('hashchange', () => { const v = vistaDoEndereco(); if (v !== estado.vista) irPara(v); });
  $('abas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vista]');
    if (!b) return;
    irPara(b.dataset.vista);
  });
  $('sel-unidade').addEventListener('change', (e) => { estado.unidade = e.target.value; estado.equipe = TODAS; desenhar(); avisarPai(); });
  $('sel-equipe').addEventListener('change', (e) => { estado.equipe = e.target.value; desenhar(); });
  // período: data vazia = sem limite daquele lado; se as datas se cruzarem, a outra acompanha
  function mostrarPeriodo() { $('dt-de').value = estado.de; $('dt-ate').value = estado.ate; }
  $('dt-de').addEventListener('change', (e) => {
    estado.de = ehData(e.target.value) ? e.target.value : '';
    if (estado.de && estado.ate && estado.de > estado.ate) estado.ate = estado.de;
    mostrarPeriodo(); desenhar();
  });
  $('dt-ate').addEventListener('change', (e) => {
    estado.ate = ehData(e.target.value) ? e.target.value : '';
    if (estado.de && estado.ate && estado.ate < estado.de) estado.de = estado.ate;
    mostrarPeriodo(); desenhar();
  });
  $('fora-periodo').addEventListener('click', (e) => {
    if (!e.target.closest('[data-periodo="tudo"]')) return;
    estado.de = ''; estado.ate = L.hojeIso();
    mostrarPeriodo(); desenhar();
  });
  $('btn-atualizar').addEventListener('click', atualizar);
  // clicar (ou Enter/Espaço) numa ordem abre os apontamentos dela logo abaixo
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-ordem], tr[data-boletim]');
    if (!tr || e.target.closest('button, a, select, input, summary')) return;
    if (String(window.getSelection && window.getSelection()) !== '') return; // estava selecionando texto para copiar
    if (tr.dataset.boletim) alternarBoletim(tr); else alternarDetalhe(tr);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches || !e.target.matches('tr[data-ordem], tr[data-boletim]')) return;
    e.preventDefault();
    if (e.target.dataset.boletim) alternarBoletim(e.target); else alternarDetalhe(e.target);
  });
  // quadros das pendências e botões "Vincular" levam à página certa
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir-vista]');
    if (b) irPara(b.dataset.irVista);
  });
  $('necessidade').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir="depositos"]');
    if (b) irPara('depositos');
  });
  $('chk-so-alertas').addEventListener('change', (e) => { estado.soAlertas = e.target.checked; desenhar(); });
  $('sel-deposito').addEventListener('change', async (e) => {
    equipeControle = e.target.value;
    $('carregando').classList.remove('fora');
    try { await carregar(); aplicarFazendaCoa(); estado.equipe = TODAS; desenhar(); } catch (err) { avisar(err && err.message ? err.message : 'Não foi possível abrir a equipe.', 'erro'); }
    $('carregando').classList.add('fora');
  });
  $('coordenadores').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir="depositos"]');
    if (!b) return;
    estado.unidade = b.dataset.unidade || estado.unidade;
    irPara('depositos');
  });
  $('vinculos').addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-equipe]');
    if (tr && e.target.matches('select[data-campo]')) salvarVinculo(tr);
  });
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.source !== window.parent) return;
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.tipo === PREFIXO + '-vista') { if (VISTAS.indexOf(d.vista) >= 0 && d.vista !== estado.vista) irPara(d.vista); return; }
    if (d.tipo !== 'coa-fazenda' || MODO_CONTROLE) return;
    coaFazenda = typeof d.id === 'number' ? d.id : null;
    coaFazendaNome = typeof d.nome === 'string' ? d.nome : '';
    if (!linhas.length) return;
    aplicarFazendaCoa();
    desenhar();
  });

  /* ------------------------------ início ------------------------------ */
  if (EMBED) document.documentElement.classList.add('embed');
  if (MODO_CONTROLE) {
    document.documentElement.classList.add('modo-controle');
    document.title = 'Controle Técnico · COA';
    $('marca-titulo').textContent = 'Controle Técnico';
    $('marca-sub').textContent = 'Suas ordens, apontamentos e estoque';
    $('btn-atualizar').hidden = true; // a carga é a do servidor, de hora em hora
  }
  (async function iniciar() {
    fonte = CFG.modo === 'local' ? fonteLocal() : fonteSupabase();
    try {
      await fonte.pronto();
      await carregar();
    } catch (e) {
      $('carregando').classList.add('erro');
      $('carregando-texto').textContent = e && e.message ? e.message : (MODO_CONTROLE ? 'Não foi possível abrir o Controle Técnico.' : 'Não foi possível abrir a Validação PIMS.');
      return;
    }
    $('carregando').classList.add('fora');
    aplicarFazendaCoa();
    // ?unidade=…&equipe=… abre já filtrado (atalho para um coordenador)
    if (PARAMS.get('unidade') && unidades().indexOf(PARAMS.get('unidade')) >= 0) estado.unidade = PARAMS.get('unidade');
    if (PARAMS.get('equipe')) estado.equipe = PARAMS.get('equipe');
    // ?abrir=UNIDADE|ordem (várias separadas por vírgula) já abre os apontamentos dessas ordens
    if (PARAMS.get('abrir')) PARAMS.get('abrir').split(',').forEach((k) => { if (/^[FP]\|/.test(k)) abertosBol.add(k); else if (ordemBruta(k)) abertos.add(k); });
    if (PARAMS.has('de')) estado.de = ehData(PARAMS.get('de')) ? PARAMS.get('de') : '';
    if (PARAMS.has('ate')) estado.ate = ehData(PARAMS.get('ate')) ? PARAMS.get('ate') : '';
    mostrarPeriodo();
    desenhar();
    avisarPai();
  })();
})();
