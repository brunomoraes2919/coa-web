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
  const VISTAS = ['abertas', 'fechadas', 'depositos'];
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

  const vistaDoEndereco = () => { const v = location.hash.replace(/^#/, ''); return VISTAS.indexOf(v) >= 0 ? v : 'abertas'; };
  const estado = { vista: vistaDoEndereco(), unidade: TODAS, equipe: TODAS, antigas: false };
  let linhas = [];        // valid_pims: uma linha por unidade do PIMS
  let vinculos = [];      // valid_vinculos
  let fazendasCoa = [];   // [{ unidade, coaId }] — de que fazenda do COA WEB é cada unidade
  let admin = false;
  let coaFazenda;         // fazenda escolhida no COA WEB, quando o módulo está no iframe
  let coaFazendaNome = '';
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
        const r = await Promise.all([
          sb.from('valid_pims').select('unidade,gerado_em,ordens,coordenadores,depositos,estoque,avisos').order('unidade'),
          sb.from('valid_vinculos').select('unidade,equipe,deposito,deposito_origem'),
          sb.from('mapas_fazendas').select('unidade_pims,coa_fazenda_id'),
          sb.rpc('mapas_eh_admin'),
        ]);
        return {
          linhas: conferir(r[0], 'ler as ordens') || [],
          vinculos: conferir(r[1], 'ler os depósitos dos coordenadores') || [],
          fazendas: r[2].error ? [] : (r[2].data || []),
          admin: !r[3].error && r[3].data === true,
        };
      },
      salvarVinculo: async function (v) {
        if (!v.deposito && !v.deposito_origem) {
          conferir(await sb.from('valid_vinculos').delete().eq('unidade', v.unidade).eq('equipe', v.equipe), 'remover o vínculo');
          return;
        }
        conferir(await sb.from('valid_vinculos').upsert({ unidade: v.unidade, equipe: v.equipe, deposito: v.deposito || null, deposito_origem: v.deposito_origem || null }, { onConflict: 'unidade,equipe' }), 'salvar o vínculo');
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
  function fonteLocal() {
    const api = async (caminho, opcoes) => {
      const r = await fetch(caminho, opcoes);
      if (!r.ok) throw new Error('servidor local: ' + r.status);
      return r.json();
    };
    return {
      pronto: async function () {},
      ler: () => api('/api/validacao-teste'),
      salvarVinculo: (v) => api('/api/validacao-teste/vinculo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) }),
      pedirAtualizacao: async () => (await api('/api/validacao-teste/pedido', { method: 'POST' })).id,
      situacaoPedido: async () => ({ atendido_em: new Date().toISOString(), resultado: 'ok' }),
    };
  }

  /* ------------------------------ filtros ------------------------------ */
  const unidades = () => linhas.map((l) => l.unidade);
  const linhaDa = (unidade) => linhas.find((l) => l.unidade === unidade) || null;
  const vinculoDe = (unidade, eq) => vinculos.find((v) => v.unidade === unidade && v.equipe === eq) || null;
  const filtro = () => ({ unidade: estado.unidade, equipe: estado.equipe, antigas: estado.antigas });

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

  function linhaOrdem(o, hoje) {
    const pct = Math.min(1, o.pct);
    const alerta = o.excedeu
      ? '<span class="selo alerta" title="A área apontada passou da planejada: a área a realizar ficou negativa">Área excedida em ' + fmtHa(-o.aRealizar) + ' ha</span>'
      : '';
    return '<tr class="ordem ' + o.prazo + (o.excedeu ? ' excedeu' : '') + '">' +
      '<td class="os"><b>' + esc(o.os) + '</b></td>' +
      '<td class="operacao"><span>' + esc(L.titulo(o.opn)) + '</span><small>' + (o.nt === 1 ? '1 talhão' : o.nt + ' talhões') + '</small></td>' +
      '<td class="n">' + fmtData(o.ab) + '</td>' +
      '<td class="prazo"><span class="selo ' + o.prazo + '">' + esc(L.textoDias(o.dias)) + '</span></td>' +
      '<td class="falta ' + o.prazo + '">' + esc(L.textoFalta(o.falta)) + '</td>' +
      (o.semArea
        ? '<td class="progresso sem-area" colspan="2"><small>Esta operação não aponta área no PIMS (' + fmtHa(o.pl) + ' ha planejados): vale só o prazo.</small></td><td class="n realizar">—</td>'
        : '<td class="progresso"><div class="barra-prog' + (o.excedeu ? ' cheia' : '') + '"><span style="width:' + (pct * 100).toFixed(1) + '%"></span></div>' +
          '<small><b>' + fmtPct(o.pct) + '</b> · ' + fmtHa(o.ex) + ' de ' + fmtHa(o.pl) + ' ha' + (o.ult ? ' · último em ' + fmtDataCurta(o.ult) : ' · sem apontamento') + '</small></td>' +
          '<td class="evo">' + evolucaoSvg(o, hoje) + '</td>' +
          '<td class="n realizar' + (o.excedeu ? ' negativo' : '') + '">' + fmtHa(o.aRealizar) + ' ha' + alerta + '</td>') +
      '</tr>';
  }

  function blocoSaldo(g) {
    const s = L.saldoDoCoordenador(linhaDa(g.unidade), vinculoDe(g.unidade, g.eq));
    if (!s) {
      return '<div class="saldo vazio"><b>Depósito no SAP</b><span>Sem depósito vinculado a este coordenador.' +
        (admin ? ' <button type="button" class="link" data-ir="depositos" data-unidade="' + esc(g.unidade) + '">Vincular</button>' : '') + '</span></div>';
    }
    const cab = '<b>Depósito no SAP</b><span class="saldo-dep">' + esc(s.deposito) + ' · ' + esc(L.titulo(s.depositoNome)) + '</span>' +
      (s.origem ? '<span class="saldo-origem">origem: ' + esc(s.origem) + ' · ' + esc(L.titulo(s.origemNome)) + '</span>' : '');
    if (s.pendente) return '<div class="saldo"><div class="saldo-cab">' + cab + '</div><p class="saldo-nota">O saldo deste depósito ainda não foi lido. Clique em Atualizar ou aguarde a próxima atualização.</p></div>';
    if (!s.itens.length) return '<div class="saldo"><div class="saldo-cab">' + cab + '</div><p class="saldo-nota">Depósito sem saldo no SAP.</p></div>';
    return '<details class="saldo"' + (s.itens.length <= 20 ? ' open' : '') + '><summary class="saldo-cab">' + cab + '<span class="saldo-qtd">' + s.itens.length + (s.itens.length === 1 ? ' produto com saldo' : ' produtos com saldo') + '</span></summary>' +
      '<div class="tabela-rolagem"><table class="tabela tabela-saldo"><thead><tr><th>Produto</th><th class="n">Saldo no depósito</th>' + (s.origem ? '<th class="n">Saldo na origem</th>' : '') + '</tr></thead><tbody>' +
      s.itens.map((i) => '<tr><td><span class="cod">' + esc(i.c) + '</span>' + esc(L.titulo(i.n)) + '</td><td class="n"><b>' + fmtQtd(i.q) + '</b> ' + esc(i.u) + '</td>' +
        (s.origem ? '<td class="n">' + (i.origem === null ? '—' : fmtQtd(i.origem) + ' ' + esc(i.u)) + '</td>' : '') + '</tr>').join('') +
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
    // as ordens abertas antes da safra atual ficam fora até o usuário pedir
    const semFiltroAntigas = L.abertasPorCoordenador(linhas, hoje, Object.assign({}, filtro(), { antigas: false }));
    const antigas = semFiltroAntigas.escondidas;
    $('chave-antigas').hidden = !antigas;
    $('txt-antigas').textContent = 'Mostrar também as ' + antigas + ' abertas antes de ' + fmtData(L.inicioSafra(hoje));
    $('chk-antigas').checked = estado.antigas;
    $('coordenadores').innerHTML = r.grupos.length
      ? r.grupos.map((g) => cartaoCoordenador(g, hoje)).join('')
      : '<p class="vazio">Nenhuma ordem aberta' + (estado.unidade || estado.equipe ? ' com este filtro' : '') + (antigas && !estado.antigas ? ' nesta safra' : '') + '.</p>';
  }

  /* ------------------------------ fechadas com diferença ------------------------------ */
  function tabelaFechadas(lista, vazio) {
    if (!lista.length) return '<p class="vazio">' + esc(vazio) + '</p>';
    return '<table class="tabela tabela-fechadas"><thead><tr><th>Ordem</th><th>Fazenda</th><th>Coordenador</th><th>Operação</th><th class="n">Encerrada em</th><th class="n">Planejado</th><th class="n">Apontado</th><th class="n">Diferença</th></tr></thead><tbody>' +
      lista.map((o) => '<tr><td class="os"><b>' + esc(o.os) + '</b></td><td class="faz">' + esc(L.titulo(o.unidade)) + '</td><td class="eq">' + esc(L.titulo(o.eq)) + '</td><td class="opn">' + esc(L.titulo(o.opn)) + '</td>' +
        '<td class="n enc">' + fmtData(o.enc) + '</td><td class="n pl">' + fmtHa(o.pl) + ' ha</td><td class="n ex">' + fmtHa(o.ex) + ' ha</td>' +
        '<td class="n dif ' + (o.dif < 0 ? 'menos' : 'mais') + '"><b>' + (o.dif > 0 ? '+' : '−') + fmtHa(Math.abs(o.dif)) + ' ha</b>' + (o.pct === null ? '' : '<small>' + fmtPct(o.pct) + ' do planejado</small>') + '</td></tr>').join('') +
      '</tbody></table>';
  }
  function desenharFechadas() {
    const r = L.fechadasComDiferenca(linhas, filtro());
    $('n-faltando').textContent = r.faltando.length === 1 ? '1 ordem' : r.faltando.length + ' ordens';
    $('n-sobrando').textContent = r.sobrando.length === 1 ? '1 ordem' : r.sobrando.length + ' ordens';
    $('tab-faltando').innerHTML = tabelaFechadas(r.faltando, 'Nenhuma ordem fechada faltando área.');
    $('tab-sobrando').innerHTML = tabelaFechadas(r.sobrando, 'Nenhuma ordem fechada com área a mais.');
    return r.faltando.length + r.sobrando.length;
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
      ? 'Escolha, para cada coordenador, o <b>depósito dele no SAP</b> e o <b>depósito de origem</b> dos produtos. O saldo do depósito aparece no painel do coordenador depois da próxima atualização.'
      : 'Depósito do SAP de cada coordenador e o depósito de origem dos produtos. Só administradores alteram estes vínculos.';
    const lista = L.coordenadoresComVinculo(linhas, vinculos, { unidade: estado.unidade }).filter((c) => !estado.equipe || c.eq === estado.equipe);
    if (!lista.length) { $('vinculos').innerHTML = '<p class="vazio">Nenhum coordenador com ordem de serviço' + (estado.unidade ? ' nesta fazenda' : '') + '.</p>'; return; }
    const porUnidade = new Map();
    lista.forEach((c) => { if (!porUnidade.has(c.unidade)) porUnidade.set(c.unidade, []); porUnidade.get(c.unidade).push(c); });
    $('vinculos').innerHTML = Array.from(porUnidade.entries()).map(([unidade, coords]) => {
      const linha = linhaDa(unidade) || { depositos: [] };
      return '<section class="cartao"><header class="cartao-cab"><div><h2>' + esc(L.titulo(unidade)) + '</h2><p>' + (coords.length === 1 ? '1 coordenador' : coords.length + ' coordenadores') +
        ' · ' + (linha.depositos || []).filter((d) => !d.i).length + ' depósitos no SAP</p></div></header>' +
        '<div class="tabela-rolagem"><table class="tabela tabela-vinculos"><thead><tr><th>Coordenador</th><th class="n">Ordens abertas</th><th>Depósito do coordenador</th><th>Depósito de origem</th><th></th></tr></thead><tbody>' +
        coords.map((c) => '<tr data-unidade="' + esc(c.unidade) + '" data-equipe="' + esc(c.eq) + '"><td><b>' + esc(L.titulo(c.eq)) + '</b></td><td class="n">' + c.abertas + '</td>' +
          '<td><select data-campo="deposito" aria-label="Depósito de ' + esc(L.titulo(c.eq)) + '"' + (admin ? '' : ' disabled') + '>' + opcoesDeposito(linha, c.deposito) + '</select></td>' +
          '<td><select data-campo="deposito_origem" aria-label="Depósito de origem de ' + esc(L.titulo(c.eq)) + '"' + (admin ? '' : ' disabled') + '>' + opcoesDeposito(linha, c.origem) + '</select></td>' +
          '<td class="situacao" aria-live="polite"></td></tr>').join('') +
        '</tbody></table></div></section>';
    }).join('');
  }

  async function salvarVinculo(tr) {
    const v = {
      unidade: tr.dataset.unidade, equipe: tr.dataset.equipe,
      deposito: tr.querySelector('[data-campo="deposito"]').value || null,
      deposito_origem: tr.querySelector('[data-campo="deposito_origem"]').value || null,
    };
    const sit = tr.querySelector('.situacao');
    sit.className = 'situacao'; sit.textContent = 'Salvando…';
    try {
      await fonte.salvarVinculo(v);
      vinculos = vinculos.filter((x) => !(x.unidade === v.unidade && x.equipe === v.equipe));
      if (v.deposito || v.deposito_origem) vinculos.push(v);
      sit.className = 'situacao ok';
      sit.textContent = v.deposito || v.deposito_origem ? 'Salvo. O saldo entra na próxima atualização.' : 'Vínculo removido.';
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
    document.querySelectorAll('#abas [data-vista]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === estado.vista)));
    ['abertas', 'fechadas', 'depositos'].forEach((v) => { $('vista-' + v).hidden = v !== estado.vista; });
    const hoje = L.hojeIso();
    // os números das abas valem para o filtro escolhido
    $('conta-abertas').textContent = L.resumoAbertas(L.abertasPorCoordenador(linhas, hoje, filtro()).grupos).ordens;
    const f = L.fechadasComDiferenca(linhas, filtro());
    $('conta-fechadas').textContent = f.faltando.length + f.sobrando.length;
    if (estado.vista === 'abertas') desenharAbertas();
    else if (estado.vista === 'fechadas') desenharFechadas();
    else desenharDepositos();
    const mais = linhas.reduce((m, l) => (l.gerado_em > m ? l.gerado_em : m), '');
    $('atualizado').innerHTML = mais ? 'PIMS · <b>' + new Date(mais).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</b>' : '';
    const semSap = linhas.some((l) => (l.avisos || []).length);
    if (!linhas.length) avisar('Ainda não há dados da validação. O servidor grava as ordens a cada hora; clique em Atualizar para buscar agora.', '');
    else if (estado.unidade === SEM_UNIDADE) avisar('A fazenda escolhida no menu não tem ordens de serviço no PIMS (ou você não tem acesso à unidade dela).', '');
    else if (semSap) avisar('O saldo de alguns depósitos do SAP não pôde ser lido na última atualização. As ordens estão atualizadas.', 'alerta');
    else if (!$('aviso').classList.contains('fixo')) avisar('', '');
  }

  function avisarPai() {
    if (!EMBED || window.parent === window) return;
    const f = fazendasCoa.find((x) => x.unidade === estado.unidade);
    try { window.parent.postMessage({ tipo: 'validacao-rota', vista: estado.vista, coaFazenda: f ? f.coaId : null }, location.origin); } catch (e) { /* fora do COA WEB */ }
  }
  /** A fazenda do menu lateral do COA WEB manda na unidade: pelo cadastro do Mapas e, sem ele, pelo nome. */
  function aplicarFazendaCoa() {
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
    linhas = (d.linhas || []).map((l) => Object.assign({ ordens: [], coordenadores: [], depositos: [], estoque: {}, avisos: [] }, l));
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
    estado.vista = VISTAS.indexOf(vista) >= 0 ? vista : 'abertas';
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
  $('chk-antigas').addEventListener('change', (e) => { estado.antigas = e.target.checked; desenhar(); });
  $('btn-atualizar').addEventListener('click', atualizar);
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
    if (d.tipo === 'validacao-vista') { if (VISTAS.indexOf(d.vista) >= 0 && d.vista !== estado.vista) irPara(d.vista); return; }
    if (d.tipo !== 'coa-fazenda') return;
    coaFazenda = typeof d.id === 'number' ? d.id : null;
    coaFazendaNome = typeof d.nome === 'string' ? d.nome : '';
    if (!linhas.length) return;
    aplicarFazendaCoa();
    desenhar();
  });

  /* ------------------------------ início ------------------------------ */
  if (EMBED) document.documentElement.classList.add('embed');
  (async function iniciar() {
    fonte = CFG.modo === 'local' ? fonteLocal() : fonteSupabase();
    try {
      await fonte.pronto();
      await carregar();
    } catch (e) {
      $('carregando').classList.add('erro');
      $('carregando-texto').textContent = e && e.message ? e.message : 'Não foi possível abrir a Validação PIMS.';
      return;
    }
    $('carregando').classList.add('fora');
    aplicarFazendaCoa();
    // ?unidade=…&equipe=… abre já filtrado (atalho para um coordenador)
    if (PARAMS.get('unidade') && unidades().indexOf(PARAMS.get('unidade')) >= 0) estado.unidade = PARAMS.get('unidade');
    if (PARAMS.get('equipe')) estado.equipe = PARAMS.get('equipe');
    if (PARAMS.get('antigas') === '1') estado.antigas = true;
    desenhar();
    avisarPai();
  })();
})();
