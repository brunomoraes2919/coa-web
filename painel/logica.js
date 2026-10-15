/* Montagens de Painel — contas do módulo, sem tela: as divisões da TV, os tempos, os endereços aceitos, a leitura
   e a limpeza de uma montagem vinda do banco, os nomes, os atalhos do COA WEB, a data por extenso e a agenda da
   rotação da TV. Serve ao navegador (window.PainelLogica) e aos testes
   (node --test "modulos/painel/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PainelLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* As 7 divisões da tela. `areas` diz onde cada quadro fica na grade (grid-area: linha / coluna / linha-fim /
     coluna-fim), na ordem de leitura; quantas áreas = quantos quadros aparecem. */
  const DIVISOES = [
    { codigo: '4', nome: '4 · grade 2×2', colunas: '1fr 1fr', linhas: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'] },
    { codigo: '3a', nome: '3 · destaque + 2', colunas: '2fr 1fr', linhas: '1fr 1fr', areas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
    { codigo: '3b', nome: '3 · três colunas', colunas: '1fr 1fr 1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '1 / 3 / 2 / 4'] },
    { codigo: '3c', nome: '3 · 2 em cima + 1 embaixo', colunas: '1fr 1fr', linhas: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'] },
    { codigo: '2a', nome: '2 · lado a lado', colunas: '1fr 1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3'] },
    { codigo: '2b', nome: '2 · destaque + lateral', colunas: '2fr 1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3'] },
    { codigo: '1', nome: 'Tela cheia', colunas: '1fr', linhas: '1fr', areas: ['1 / 1 / 2 / 2'] },
  ];
  const TOTAL_QUADROS = 4;     // toda montagem guarda 4 quadros; a divisão decide quantos aparecem
  const MAX_SITES = 12;        // sites por quadro
  const TEMPOS = [15, 30, 45, 60, 120, 180, 300, 600, 900, 1800]; // segundos de um site na rotação
  const RECARGAS = [0, 300, 900, 1800, 3600];                      // recarga de site fixo (0 = não recarrega)
  const TEMPO_PADRAO = 60;
  const TEMPOS_INTERNOS = [10, 15, 20, 30, 60];                    // troca entre fazendas no Modo TV dos módulos
  const MAX_NOME_MONTAGEM = 60;
  const MAX_NOME_SITE = 80;
  const MAX_ENDERECO = 2000;
  /* camadas do Modo TV da Previsão do Tempo (as mesmas de previsao/app.js) */
  const CAMADAS_PREVISAO = [
    ['rain', 'Chuva e trovoadas'], ['rainAccu', 'Chuva acumulada'], ['wind', 'Vento'], ['gust', 'Rajadas de vento'],
    ['temp', 'Temperatura'], ['clouds', 'Nuvens'], ['rh', 'Umidade do ar'], ['radar', 'Radar'],
  ];

  const texto = (v) => String(v === null || v === undefined ? '' : v);

  function divisao(codigo) {
    return DIVISOES.find((d) => d.codigo === texto(codigo)) || DIVISOES[0];
  }

  /** O valor da lista mais perto de `valor` (empate: o menor); `padrao` quando não é número. */
  function tempoMaisProximo(valor, lista, padrao) {
    const n = Number(valor);
    if (valor === null || valor === undefined || valor === '' || !Number.isFinite(n)) return padrao;
    let melhor = lista[0];
    for (const x of lista) if (Math.abs(x - n) < Math.abs(melhor - n)) melhor = x;
    return melhor;
  }

  function rotuloTempo(s) {
    if (!s) return 'Não recarrega';
    if (s < 60) return s + ' s';
    if (s < 3600) return s / 60 + ' min';
    return s / 3600 + ' h';
  }

  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  function nomeDoHost(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (e) { return ''; }
  }

  /**
   * Endereço digitado → { ok: true, url, origem } ou { ok: false, motivo }.
   * origem 'coa' = página do próprio COA WEB, guardada como caminho a partir da raiz do site
   * ("acompanhamento/index.html?tv=1"); 'externo' = https de outro site. `origemAtual` (location.origin)
   * transforma o endereço completo do COA WEB em caminho. O próprio painel nunca entra num quadro.
   */
  function lerEndereco(entrada, origemAtual) {
    const t = texto(entrada).trim();
    if (!t) return { ok: false, motivo: 'Escreva o endereço do site.' };
    if (t.length > MAX_ENDERECO) return { ok: false, motivo: 'Endereço longo demais.' };
    if (/^http:\/\//i.test(t)) return { ok: false, motivo: 'Só endereços https abrem no painel.' };
    if (/^https:\/\//i.test(t)) {
      let u;
      try { u = new URL(t); } catch (e) { return { ok: false, motivo: 'Endereço inválido.' }; }
      if (u.username || u.password) return { ok: false, motivo: 'Endereço com usuário e senha não é aceito.' };
      if (origemAtual && u.origin === origemAtual) {
        const caminho = (u.pathname + u.search + u.hash).replace(/^\/+/, '');
        if (!/^[a-z0-9_-]+\//i.test(caminho)) return { ok: false, motivo: 'Use o endereço de um módulo do COA WEB, como o do Acompanhamento.' };
        return lerEndereco(caminho);
      }
      if (u.hostname.indexOf('.') < 0) return { ok: false, motivo: 'Endereço inválido.' };
      return { ok: true, url: u.href, origem: 'externo' };
    }
    if (/^[a-z0-9_-]+\/[^\s\\]*$/i.test(t)) {
      if (t.indexOf('..') >= 0) return { ok: false, motivo: 'Endereço inválido.' };
      if (/^painel\//i.test(t)) return { ok: false, motivo: 'O próprio painel não pode entrar num quadro.' };
      return { ok: true, url: t, origem: 'coa' };
    }
    // "rainviewer.com/map.html", sem o https://
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(t)) return lerEndereco('https://' + t, origemAtual);
    return { ok: false, motivo: 'Endereço inválido.' };
  }

  /** Endereço que vai no iframe: o caminho do COA WEB é sempre a partir da raiz do site (a TV está em /painel/). */
  function enderecoNoNavegador(site) {
    return site.origem === 'coa' ? '/' + texto(site.url).replace(/^\/+/, '') : site.url;
  }

  let contador = 0;
  function novoId() {
    contador = (contador + 1) % 1296;
    return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + contador.toString(36);
  }

  /** Site limpo, ou null se o endereço não é aceito. `ids` evita id repetido dentro do mesmo quadro. */
  function normalizarSite(s, ids) {
    if (!s || typeof s !== 'object') return null;
    const e = lerEndereco(s.url);
    if (!e.ok) return null;
    const usados = ids || new Set();
    let id = typeof s.id === 'string' && /^[a-z0-9]{1,24}$/i.test(s.id) ? s.id : '';
    if (!id || usados.has(id)) id = novoId();
    usados.add(id);
    const nome = texto(s.nome).trim().slice(0, MAX_NOME_SITE);
    return {
      id,
      nome: nome || (e.origem === 'coa' ? 'COA WEB' : nomeDoHost(e.url)),
      url: e.url,
      origem: e.origem,
      segundos: tempoMaisProximo(s.segundos, TEMPOS, TEMPO_PADRAO),
      conferencia: e.origem === 'coa' || s.conferencia === 'abre' ? 'abre' : 'incerto',
    };
  }

  function normalizarQuadro(q) {
    const o = q && typeof q === 'object' ? q : {};
    const ids = new Set();
    const sites = (Array.isArray(o.sites) ? o.sites : []).map((s) => normalizarSite(s, ids)).filter(Boolean).slice(0, MAX_SITES);
    return { padrao: tempoMaisProximo(o.padrao, TEMPOS, TEMPO_PADRAO), recarregar: tempoMaisProximo(o.recarregar, RECARGAS, 0), sites };
  }

  /** Montagem vinda do banco (ou de qualquer lugar) → sempre válida: nome, divisão conhecida, 4 quadros limpos. */
  function normalizarMontagem(m) {
    const o = m && typeof m === 'object' ? m : {};
    const lista = Array.isArray(o.quadros) ? o.quadros : [];
    const quadros = [];
    for (let i = 0; i < TOTAL_QUADROS; i++) quadros.push(normalizarQuadro(lista[i]));
    const nome = texto(o.nome).trim().slice(0, MAX_NOME_MONTAGEM);
    return {
      id: o.id === null || o.id === undefined ? null : String(o.id),
      nome: nome || 'Sem nome',
      divisao: divisao(o.divisao).codigo,
      quadros,
      atualizadoEm: o.atualizado_em || o.atualizadoEm || null,
    };
  }

  /** O que vai para o banco: as colunas nome, divisao e quadros. */
  function paraGravar(m) {
    const n = normalizarMontagem(m);
    return { nome: n.nome, divisao: n.divisao, quadros: n.quadros };
  }

  function quadrosVisiveis(m) { return m.quadros.slice(0, divisao(m.divisao).areas.length); }

  function resumoMontagem(m) {
    const qs = quadrosVisiveis(m);
    const sites = qs.reduce((t, q) => t + q.sites.length, 0);
    return plural(qs.length, 'quadro', 'quadros') + ' · ' + plural(sites, 'site', 'sites');
  }

  /** Quadros com sites que a divisão atual deixa de fora (continuam guardados). */
  function textoGuardados(m) {
    const n = divisao(m.divisao).areas.length;
    const partes = [];
    for (let i = n; i < TOTAL_QUADROS; i++) {
      const k = m.quadros[i].sites.length;
      if (k) partes.push('Quadro ' + (i + 1) + ' (' + plural(k, 'site', 'sites') + ')');
    }
    return partes.length ? 'Guardados fora da tela: ' + partes.join(', ') : '';
  }

  /** O que a prévia do editor escreve dentro de um quadro. */
  function textoDoQuadro(q) {
    const n = q.sites.length;
    if (!n) return { titulo: 'Vazio', detalhe: 'clique para adicionar' };
    if (n === 1) return { titulo: q.sites[0].nome, detalhe: q.recarregar ? 'fixo · recarrega a cada ' + rotuloTempo(q.recarregar) : 'fixo' };
    return { titulo: q.sites[0].nome, detalhe: rotuloTempo(q.sites[0].segundos) + ' · +' + (n - 1) + ' em rotação' };
  }

  const chaveNome = (t) => texto(t).trim().toLocaleLowerCase('pt-BR');

  function nomeRepetido(nome, montagens, idProprio) {
    const k = chaveNome(nome);
    return montagens.some((m) => m.id !== idProprio && chaveNome(m.nome) === k);
  }

  function nomeLivre(base, montagens) {
    if (!nomeRepetido(base, montagens, null)) return base;
    for (let k = 2; ; k++) if (!nomeRepetido(base + ' ' + k, montagens, null)) return base + ' ' + k;
  }

  function nomeDaCopia(nome, montagens) {
    for (let k = 1; ; k++) {
      const sufixo = k === 1 ? ' (cópia)' : ' (cópia ' + k + ')';
      const n = texto(nome).slice(0, MAX_NOME_MONTAGEM - sufixo.length).trim() + sufixo;
      if (!nomeRepetido(n, montagens, null)) return n;
    }
  }

  /** A da TV primeiro; as outras por nome. Não mexe na lista recebida. */
  function ordenarMontagens(lista, idTv) {
    return lista.slice().sort((a, b) => (b.id === idTv) - (a.id === idTv) || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  /** Linhas de mapas_fazendas → [{ id, nome, unidade }] para os atalhos (Acompanhamento usa a unidade; Previsão, o id). */
  function fazendasDoCadastro(linhas) {
    return (Array.isArray(linhas) ? linhas : [])
      .map((f) => ({ id: String(f.id), nome: texto(f.nome).replace(/^Fazenda\s+/i, '').trim(), unidade: f.unidade_pims ? String(f.unidade_pims).trim().toUpperCase() : null }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  function nomeDasFazendas(fz) {
    if (!fz.length) return 'todas as fazendas';
    return fz.length === 1 ? fz[0].nome : fz.length + ' fazendas';
  }

  /** Modo TV do Acompanhamento (acompanhamento/app.js: ?tv=1&tempo=&fazendas=<unidades>&todas=0). */
  function atalhoAcompanhamento(op) {
    const fz = (op && Array.isArray(op.fazendas) ? op.fazendas : []).filter((f) => f && f.unidade);
    const t = tempoMaisProximo(op && op.tempo, TEMPOS_INTERNOS, 20);
    const url = 'acompanhamento/index.html?tv=1&tempo=' + t + (fz.length ? '&todas=0&fazendas=' + fz.map((f) => encodeURIComponent(f.unidade)).join(',') : '');
    return { nome: 'Acompanhamento · ' + nomeDasFazendas(fz), url, origem: 'coa', conferencia: 'abre' };
  }

  /** Modo TV da Previsão do Tempo (previsao/app.js: ?tv=1&tempo=&camadas=&fazendas=<ids>&todas=0). */
  function atalhoPrevisao(op) {
    const fz = (op && Array.isArray(op.fazendas) ? op.fazendas : []).filter((f) => f && f.id !== null && f.id !== undefined);
    const camada = CAMADAS_PREVISAO.find((c) => c[0] === (op && op.camada)) || CAMADAS_PREVISAO[0];
    const t = tempoMaisProximo(op && op.tempo, TEMPOS_INTERNOS, 20);
    const url = 'previsao/index.html?tv=1&tempo=' + t + '&camadas=' + camada[0] + (fz.length ? '&todas=0&fazendas=' + fz.map((f) => encodeURIComponent(String(f.id))).join(',') : '');
    return { nome: 'Previsão · ' + camada[1] + ' · ' + nomeDasFazendas(fz), url, origem: 'coa', conferencia: 'abre' };
  }

  function dataPorExtenso(d) {
    const t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function horaMinuto(d) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  return {
    DIVISOES, TOTAL_QUADROS, MAX_SITES, TEMPOS, RECARGAS, TEMPO_PADRAO, TEMPOS_INTERNOS, CAMADAS_PREVISAO,
    divisao, tempoMaisProximo, rotuloTempo, plural, nomeDoHost, lerEndereco, enderecoNoNavegador,
    novoId, normalizarSite, normalizarQuadro, normalizarMontagem, paraGravar,
    quadrosVisiveis, resumoMontagem, textoGuardados, textoDoQuadro,
    nomeRepetido, nomeLivre, nomeDaCopia, ordenarMontagens,
    fazendasDoCadastro, atalhoAcompanhamento, atalhoPrevisao, dataPorExtenso, horaMinuto,
  };
});
