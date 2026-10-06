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
      antiga: !o.ab || o.ab < inicioSafra(hoje),
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
   * `filtro`: { unidade, equipe, antigas } — unidade/equipe vazias = todas; antigas = incluir as abertas
   * antes da safra atual.
   */
  function abertasPorCoordenador(linhas, hoje, filtro) {
    const f = filtro || {};
    const grupos = new Map();
    let escondidas = 0;
    todasAsOrdens(linhas).forEach(function (bruta) {
      if (bruta.s !== 'A') return;
      if (f.unidade && bruta.unidade !== f.unidade) return;
      if (f.equipe && bruta.eq !== f.equipe) return;
      const o = ordemAberta(bruta, hoje);
      if (o.antiga && !f.antigas) { escondidas += 1; return; }
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
    return { grupos: lista, escondidas: escondidas };
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
   */
  function fechadasComDiferenca(linhas, filtro) {
    const f = filtro || {};
    const faltando = [], sobrando = [];
    todasAsOrdens(linhas).forEach(function (o) {
      if (o.s !== 'F' || o.sa === 1) return;
      if (f.unidade && o.unidade !== f.unidade) return;
      if (f.equipe && o.eq !== f.equipe) return;
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
      if (!porChave.has(chave)) porChave.set(chave, { unidade: unidade, eq: eq, abertas: 0, ordens: 0, deposito: null, origem: null });
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
      x.deposito = v.deposito || null; x.origem = v.deposito_origem || null;
    });
    return Array.from(porChave.values()).sort(function (a, b) {
      return (a.unidade < b.unidade ? -1 : a.unidade > b.unidade ? 1 : 0) || (a.eq < b.eq ? -1 : a.eq > b.eq ? 1 : 0);
    });
  }

  /**
   * Saldo do depósito de um coordenador: os itens do depósito dele e, ao lado, o saldo do mesmo item no
   * depósito de origem. `linha` = a linha de valid_pims da unidade. Sem vínculo → null; vínculo salvo mas
   * saldo ainda não lido pelo servidor → { pendente: true }.
   */
  function saldoDoCoordenador(linha, vinculo) {
    if (!linha || !vinculo || !vinculo.deposito) return null;
    const nomes = new Map((linha.depositos || []).map(function (d) { return [d.c, d.n]; }));
    const estoque = linha.estoque || {};
    const saida = {
      deposito: vinculo.deposito, depositoNome: nomes.get(vinculo.deposito) || '',
      origem: vinculo.deposito_origem || null, origemNome: vinculo.deposito_origem ? (nomes.get(vinculo.deposito_origem) || '') : '',
      pendente: !Object.prototype.hasOwnProperty.call(estoque, vinculo.deposito), itens: [],
    };
    if (saida.pendente) return saida;
    const naOrigem = new Map(((vinculo.deposito_origem && estoque[vinculo.deposito_origem]) || []).map(function (i) { return [i.c, i.q]; }));
    saida.origemLida = !vinculo.deposito_origem || Object.prototype.hasOwnProperty.call(estoque, vinculo.deposito_origem);
    saida.itens = (estoque[vinculo.deposito] || []).map(function (i) {
      return { c: i.c, n: i.n, q: i.q, u: i.u, origem: naOrigem.has(i.c) ? naOrigem.get(i.c) : (vinculo.deposito_origem && saida.origemLida ? 0 : null) };
    });
    return saida;
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
    hojeIso: hojeIso, inicioSafra: inicioSafra, diasEmAberto: diasEmAberto, classificarPrazo: classificarPrazo, ordemAberta: ordemAberta,
    textoFalta: textoFalta, textoDias: textoDias, abertasPorCoordenador: abertasPorCoordenador, resumoAbertas: resumoAbertas,
    fechadasComDiferenca: fechadasComDiferenca, coordenadoresComVinculo: coordenadoresComVinculo, saldoDoCoordenador: saldoDoCoordenador,
    unidadeDaFazenda: unidadeDaFazenda, titulo: titulo,
  };
});
