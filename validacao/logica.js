/* Validação PIMS — contas do módulo, sem tela: prazo das ordens de serviço, área a realizar, ordens
   fechadas com diferença de área, agrupamento por coordenador e o saldo do depósito de cada um.
   Serve ao navegador (window.ValidacaoLogica) e aos testes (node --test "modulos/validacao/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ValidacaoLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Toda ordem tem este prazo, em dias corridos a partir da abertura, para ser fechada. */
  const PRAZO_DIAS = 5;
  /** A partir de quantos dias em aberto a ordem fica amarela (até PRAZO_DIAS) — acima do prazo, vermelha. */
  const ATENCAO_DIAS = 3;
  /** Folga (ha) para dizer que a área apontada passou da planejada numa ordem ABERTA. */
  const FOLGA_HA = 0.005;
  const DIA_MS = 86400000;

  const semAcento = (t) => String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  /** 'YYYY-MM-DD' → número do dia (UTC), para contar dias sem depender de fuso nem de horário de verão. */
  function numeroDoDia(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DIA_MS) : null;
  }
  /** Data local de hoje em 'YYYY-MM-DD'. */
  function hojeIso(agora) {
    const d = agora || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** Primeiro dia da safra atual: 1º de agosto (do ano passado, se ainda não chegou agosto). */
  function inicioSafra(hoje) {
    const ano = +hoje.slice(0, 4), mes = +hoje.slice(5, 7);
    return (mes >= 8 ? ano : ano - 1) + '-08-01';
  }

  /** Primeiro dia do mês de `hoje` ('YYYY-MM-01'): o começo do período que a tela abre por padrão. */
  function inicioDoMes(hoje) {
    return String(hoje).slice(0, 8) + '01';
  }
  /**
   * O dia cai no período do filtro? `f.de` e `f.ate` são 'YYYY-MM-DD' (os dois inclusive); vazio = sem
   * limite daquele lado. Sem dia, só entra quando não há data inicial.
   */
  function noPeriodo(dia, f) {
    if (f.de && (!dia || dia < f.de)) return false;
    if (f.ate && dia && dia > f.ate) return false;
    return true;
  }

  /** Dias corridos desde a abertura (0 = aberta hoje); sem data de abertura → null. */
  function diasEmAberto(abertura, hoje) {
    const a = numeroDoDia(abertura), h = numeroDoDia(hoje);
    return a === null || h === null ? null : Math.max(0, h - a);
  }

  /** 'ok' (até 2 dias), 'atencao' (3 a 5 dias) ou 'atraso' (mais de 5 dias); sem data → 'atraso'. */
  function classificarPrazo(dias) {
    if (dias === null || dias === undefined) return 'atraso';
    if (dias > PRAZO_DIAS) return 'atraso';
    if (dias >= ATENCAO_DIAS) return 'atencao';
    return 'ok';
  }

  /**
   * Ordem ABERTA com as contas do painel: dias em aberto, quanto falta para o prazo (negativo = dias de
   * atraso), cor, área a realizar (negativa = apontou mais do que o planejado → alerta) e % apontado.
   */
  function ordemAberta(o, hoje) {
    const dias = diasEmAberto(o.ab, hoje);
    const pl = Number(o.pl) || 0, ex = Number(o.ex) || 0;
    const aRealizar = Math.round((pl - ex) * 100) / 100;
    // operação que não aponta área (tratamento de sementes, apoio…): vale o prazo, não a conta de hectares
    const semArea = o.sa === 1;
    return {
      os: o.os, unidade: o.unidade, eq: o.eq, op: o.op, opn: o.opn, ab: o.ab, ult: o.ult || null, nt: o.nt || 0,
      pl: pl, ex: ex, ev: o.ev || [], semArea: semArea,
      dias: dias, falta: dias === null ? null : PRAZO_DIAS - dias, prazo: classificarPrazo(dias),
      aRealizar: aRealizar, excedeu: !semArea && ex > pl + FOLGA_HA, pct: pl > 0 ? ex / pl : (ex > 0 ? 1 : 0),
    };
  }

  /** "faltam 3 dias" / "vence hoje" / "2 dias acima do prazo" (alerta, sem chamar de atraso). */
  function textoFalta(falta) {
    if (falta === null || falta === undefined) return 'sem data de abertura';
    if (falta > 1) return 'faltam ' + falta + ' dias';
    if (falta === 1) return 'falta 1 dia';
    if (falta === 0) return 'vence hoje';
    return falta === -1 ? '1 dia acima do prazo' : (-falta) + ' dias acima do prazo';
  }
  /** "hoje" / "1 dia" / "12 dias". */
  function textoDias(dias) {
    if (dias === null || dias === undefined) return '—';
    return dias === 0 ? 'hoje' : dias === 1 ? '1 dia' : dias + ' dias';
  }

  /** Todas as ordens das linhas de valid_pims (uma por unidade), com a unidade em cada ordem. */
  function todasAsOrdens(linhas) {
    const saida = [];
    (linhas || []).forEach(function (l) {
      (l.ordens || []).forEach(function (o) { saida.push(Object.assign({ unidade: l.unidade }, o)); });
    });
    return saida;
  }

  /**
   * Ordens abertas agrupadas por coordenador (unidade + equipe), com os totais de cada um. Ordem: quem
   * tem mais ordens atrasadas primeiro; dentro do coordenador, da mais antiga para a mais nova.
   * `filtro`: { unidade, equipe, de, ate } — unidade/equipe vazias = todas; de/ate = período da data de
   * ABERTURA. Devolve também quantas ordens abertas ficaram fora do período (`escondidas`) e a abertura
   * mais antiga entre elas (`maisAntiga`).
   */
  function abertasPorCoordenador(linhas, hoje, filtro) {
    const f = filtro || {};
    const grupos = new Map();
    let escondidas = 0, maisAntiga = null;
    todasAsOrdens(linhas).forEach(function (bruta) {
      if (bruta.s !== 'A') return;
      if (f.unidade && bruta.unidade !== f.unidade) return;
      if (f.equipe && bruta.eq !== f.equipe) return;
      if (!noPeriodo(bruta.ab, f)) {
        escondidas += 1;
        if (bruta.ab && (!maisAntiga || bruta.ab < maisAntiga)) maisAntiga = bruta.ab;
        return;
      }
      const o = ordemAberta(bruta, hoje);
      const chave = o.unidade + '|' + o.eq;
      if (!grupos.has(chave)) grupos.set(chave, { unidade: o.unidade, eq: o.eq, ordens: [], ok: 0, atencao: 0, atraso: 0, excedidas: 0, pl: 0, ex: 0 });
      const g = grupos.get(chave);
      g.ordens.push(o);
      g[o.prazo] += 1;
      if (o.excedeu) g.excedidas += 1;
      if (!o.semArea) { g.pl += o.pl; g.ex += o.ex; }
    });
    const lista = Array.from(grupos.values());
    lista.forEach(function (g) {
      g.ordens.sort(function (a, b) { return (b.dias === null ? 1e9 : b.dias) - (a.dias === null ? 1e9 : a.dias) || a.os - b.os; });
    });
    lista.sort(function (a, b) {
      return b.atraso - a.atraso || b.excedidas - a.excedidas || b.atencao - a.atencao || b.ordens.length - a.ordens.length ||
        (a.unidade < b.unidade ? -1 : a.unidade > b.unidade ? 1 : 0) || (a.eq < b.eq ? -1 : a.eq > b.eq ? 1 : 0);
    });
    return { grupos: lista, escondidas: escondidas, maisAntiga: maisAntiga };
  }

  /** Totais do painel a partir dos grupos de abertasPorCoordenador. */
  function resumoAbertas(grupos) {
    const r = { ordens: 0, ok: 0, atencao: 0, atraso: 0, excedidas: 0, coordenadores: grupos.length };
    grupos.forEach(function (g) {
      r.ordens += g.ordens.length; r.ok += g.ok; r.atencao += g.atencao; r.atraso += g.atraso; r.excedidas += g.excedidas;
    });
    return r;
  }

  /**
   * Ordens FECHADAS com diferença de área (o servidor já manda só as que passam de 1 ha):
   * faltando = fechou sem apontar toda a área planejada; sobrando = apontou mais do que o planejado.
   * Cada uma com `dif` = apontado − planejado. Da maior diferença para a menor.
   * `filtro.de` / `filtro.ate` = período da data de ENCERRAMENTO.
   */
  function fechadasComDiferenca(linhas, filtro) {
    const f = filtro || {};
    const faltando = [], sobrando = [];
    todasAsOrdens(linhas).forEach(function (o) {
      if (o.s !== 'F' || o.sa === 1) return;
      if (f.unidade && o.unidade !== f.unidade) return;
      if (f.equipe && o.eq !== f.equipe) return;
      if (!noPeriodo(o.enc, f)) return;
      const pl = Number(o.pl) || 0, ex = Number(o.ex) || 0;
      const dif = Math.round((ex - pl) * 100) / 100;
      if (dif === 0) return;
      const item = { os: o.os, unidade: o.unidade, eq: o.eq, op: o.op, opn: o.opn, ab: o.ab, enc: o.enc, pl: pl, ex: ex, dif: dif, pct: pl > 0 ? ex / pl : null };
      (dif < 0 ? faltando : sobrando).push(item);
    });
    const porTamanho = function (a, b) { return Math.abs(b.dif) - Math.abs(a.dif) || a.os - b.os; };
    faltando.sort(porTamanho); sobrando.sort(porTamanho);
    return { faltando: faltando, sobrando: sobrando };
  }

  /**
   * Coordenadores de cada unidade para a aba de vínculos: os que o servidor listou (ordens na safra) mais
   * os que só têm ordem aberta antiga, com o vínculo de cada um (`vinculos` = linhas de valid_vinculos).
   */
  function coordenadoresComVinculo(linhas, vinculos, filtro) {
    const f = filtro || {};
    const porChave = new Map();
    const pegar = function (unidade, eq) {
      const chave = unidade + '|' + eq;
      if (!porChave.has(chave)) porChave.set(chave, { unidade: unidade, eq: eq, abertas: 0, ordens: 0, deposito: null });
      return porChave.get(chave);
    };
    (linhas || []).forEach(function (l) {
      if (f.unidade && l.unidade !== f.unidade) return;
      (l.coordenadores || []).forEach(function (c) { const x = pegar(l.unidade, c.eq); x.ordens = c.n || 0; });
      (l.ordens || []).forEach(function (o) { if (o.s === 'A') pegar(l.unidade, o.eq).abertas += 1; });
    });
    (vinculos || []).forEach(function (v) {
      if (f.unidade && v.unidade !== f.unidade) return;
      const x = pegar(v.unidade, v.equipe);
      x.deposito = v.deposito || null;
    });
    return Array.from(porChave.values()).sort(function (a, b) {
      return (a.unidade < b.unidade ? -1 : a.unidade > b.unidade ? 1 : 0) || (a.eq < b.eq ? -1 : a.eq > b.eq ? 1 : 0);
    });
  }

  /**
   * Saldo do depósito de um coordenador: os itens do depósito dele e, em cada um, o depósito de ORIGEM
   * (de onde o item veio na última transferência do SAP) com o saldo do item lá. `origens` = os depósitos
   * de origem distintos, do que abastece mais itens para o que abastece menos. `linha` = a linha de
   * valid_pims da unidade. Sem vínculo → null; vínculo salvo mas saldo ainda não lido → { pendente: true }.
   */
  function saldoDoCoordenador(linha, vinculo) {
    if (!linha || !vinculo || !vinculo.deposito) return null;
    const nomes = new Map((linha.depositos || []).map(function (d) { return [d.c, d.n]; }));
    const estoque = linha.estoque || {};
    const saida = {
      deposito: vinculo.deposito, depositoNome: nomes.get(vinculo.deposito) || '',
      pendente: !Object.prototype.hasOwnProperty.call(estoque, vinculo.deposito), itens: [], origens: [],
    };
    if (saida.pendente) return saida;
    const porOrigem = new Map();
    saida.itens = (estoque[vinculo.deposito] || []).map(function (i) {
      const origem = i.o || null;
      const nome = origem ? (i.on || nomes.get(origem) || '') : '';
      if (origem) {
        if (!porOrigem.has(origem)) porOrigem.set(origem, { c: origem, n: nome, itens: 0 });
        porOrigem.get(origem).itens += 1;
      }
      return { c: i.c, n: i.n, q: i.q, u: i.u, origem: origem, origemNome: nome, origemSaldo: origem ? (Number(i.oq) || 0) : null, transferidoEm: i.od || null };
    });
    saida.origens = Array.from(porOrigem.values()).sort(function (a, b) { return b.itens - a.itens || (a.c < b.c ? -1 : a.c > b.c ? 1 : 0); });
    return saida;
  }

  /**
   * O que a tela mostra ao abrir uma ordem: os talhões (planejado × apontado em cada um) e os apontamentos
   * um a um. `o` = a ordem como veio do servidor (tl = [[talhão, ha planejado]]; ap = [[dia, boletim,
   * talhão, ha, lançado em, por]]). Talhão apontado que não está na ordem vem com `fora: true`.
   * Retrato antigo, sem essas listas → { pendente: true }.
   */
  function detalheDaOrdem(o) {
    if (!o || !Array.isArray(o.tl) || !Array.isArray(o.ap)) return { pendente: true, talhoes: [], apontamentos: [] };
    const r2 = function (v) { return Math.round(v * 100) / 100; };
    const porTalhao = new Map();
    const pegar = function (t) {
      const nome = String(t === null || t === undefined ? '?' : t);
      if (!porTalhao.has(nome)) porTalhao.set(nome, { t: nome, pl: 0, ex: 0, fora: true });
      return porTalhao.get(nome);
    };
    o.tl.forEach(function (l) { const x = pegar(l[0]); x.pl += Number(l[1]) || 0; x.fora = false; });
    const apontamentos = o.ap.map(function (a) {
      pegar(a[2]).ex += Number(a[3]) || 0;
      return { dia: a[0], boletim: a[1], talhao: String(a[2] === null || a[2] === undefined ? '?' : a[2]), ha: Number(a[3]) || 0, lancado: a[4] || null, por: a[5] || null };
    });
    const talhoes = Array.from(porTalhao.values()).map(function (x) {
      const pl = r2(x.pl), ex = r2(x.ex);
      return { t: x.t, pl: pl, ex: ex, falta: r2(pl - ex), fora: x.fora, excedeu: !x.fora && ex > pl + FOLGA_HA };
    });
    talhoes.sort(function (a, b) { return (a.fora ? 1 : 0) - (b.fora ? 1 : 0); }); // os da ordem primeiro, na ordem do PIMS
    return { pendente: false, talhoes: talhoes, apontamentos: apontamentos };
  }

  /** Unidade do PIMS de uma fazenda do COA WEB pelo nome ("Fazenda Três Flechas" → "TRES FLECHAS"); sem igual → null. */
  function unidadeDaFazenda(nomeFazenda, unidades) {
    const alvo = semAcento(nomeFazenda).replace(/^(FAZENDA|FAZ\.?)\s+/, '');
    if (!alvo) return null;
    return (unidades || []).find(function (u) { return semAcento(u) === alvo; }) || null;
  }

  /** "TRES FLECHAS" → "Tres Flechas"; siglas curtas com número ficam como estão ("SM3"). */
  function titulo(t) {
    return String(t || '').toLowerCase().replace(/(^|[\s\-.\/(])([a-zà-ÿ])/g, function (_, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(Sm3|Ts|Md|Db)\b/g, function (m) { return m.toUpperCase(); })
      .replace(/\b(De|Da|Do|Dos|Das|E)\b/g, function (m) { return m.toLowerCase(); });
  }

  return {
    PRAZO_DIAS: PRAZO_DIAS, ATENCAO_DIAS: ATENCAO_DIAS,
    hojeIso: hojeIso, inicioSafra: inicioSafra, inicioDoMes: inicioDoMes, noPeriodo: noPeriodo, diasEmAberto: diasEmAberto, classificarPrazo: classificarPrazo, ordemAberta: ordemAberta,
    textoFalta: textoFalta, textoDias: textoDias, abertasPorCoordenador: abertasPorCoordenador, resumoAbertas: resumoAbertas,
    fechadasComDiferenca: fechadasComDiferenca, coordenadoresComVinculo: coordenadoresComVinculo, saldoDoCoordenador: saldoDoCoordenador,
    detalheDaOrdem: detalheDaOrdem, unidadeDaFazenda: unidadeDaFazenda, titulo: titulo,
  };
});
