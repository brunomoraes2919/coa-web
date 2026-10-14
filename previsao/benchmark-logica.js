/* Previsão do Tempo — contas da aba "Benchmark", sem tela: os próximos 15 dias de cada fonte, o ranking de acerto e
   o previsto × medido. Os dados vêm de prev_previsoes, prev_observado e prev_metricas (rotina da VM).
   Serve ao navegador (window.PrevisaoBenchmark) e aos testes (node --test "modulos/previsao/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PrevisaoBenchmark = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* a ordem e as cores das fontes em toda a aba */
  const FONTES = [
    { id: 'zeus', nome: 'ZEUS (Locks)', cor: '#0f9484' }, // verde-azulado mais claro que o da marca: o #0c5a50 reprova no validador de paleta
    { id: 'visualcrossing', nome: 'Visual Crossing', cor: '#db8a08' },
    { id: 'metno', nome: 'MET Norway', cor: '#5470c6' },
  ];
  const ANTECEDENCIAS = [1, 3, 7, 13];
  const MINIMO_PARES = 10;
  const TODAS = 'TODAS';
  const DIAS = 15;

  const arred1 = (x) => Math.round(x * 10) / 10;
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  function somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  /** Hoje em Mato Grosso (UTC−4), independente do fuso do aparelho. */
  function hojeMT(agora) {
    return new Date((agora ? agora.getTime() : Date.now()) - 4 * 3600000).toISOString().slice(0, 10);
  }
  function media(valores) {
    const ok = valores.filter((v) => v !== null);
    return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
  }
  function valorDoDia(linha, dia, campo) {
    const x = (Array.isArray(linha.dias) ? linha.dias : []).find((y) => y.d === dia);
    return x ? num(x[campo]) : null;
  }
  const daUnidade = (unidade) => (l) => unidade === TODAS || l.unidade === unidade;

  /** A foto mais recente de cada fonte × fazenda. */
  function fotosMaisRecentes(linhas) {
    const m = new Map();
    linhas.forEach((l) => {
      const k = l.fonte + '|' + l.unidade;
      const a = m.get(k);
      if (!a || l.emitida_em > a.emitida_em) m.set(k, l);
    });
    return Array.from(m.values());
  }

  /** Dia de divergência: uma fonte prevê 10 mm ou mais e outra menos de 1 mm. */
  function divergente(valores) {
    const ok = valores.filter((v) => v !== null);
    return ok.some((v) => v >= 10) && ok.some((v) => v < 1);
  }

  /** Bloco 1: os 15 dias a partir de hoje, por fonte (em "Todas", média das fazendas que a fonte tem no dia). */
  function proximosDias(linhas, unidade, hoje) {
    const dias = Array.from({ length: DIAS }, (_, i) => somarDias(hoje, i));
    const fotos = fotosMaisRecentes(linhas).filter(daUnidade(unidade));
    const series = FONTES.map((f) => {
      const minhas = fotos.filter((l) => l.fonte === f.id);
      const mm = dias.map((d) => { const v = media(minhas.map((l) => valorDoDia(l, d, 'mm'))); return v === null ? null : arred1(v); });
      const p = dias.map((d) => { const v = media(minhas.map((l) => valorDoDia(l, d, 'p'))); return v === null ? null : Math.round(v); });
      const comValor = mm.filter((v) => v !== null);
      const capturadas = minhas.map((l) => l.capturada_em).filter(Boolean).sort();
      return {
        fonte: f.id, nome: f.nome, cor: f.cor, mm, p,
        total: comValor.length ? arred1(comValor.reduce((s, v) => s + v, 0)) : null,
        capturadaEm: capturadas.length ? capturadas[capturadas.length - 1] : null,
      };
    }).filter((s) => s.mm.some((v) => v !== null));
    const divergentes = dias.map((_, i) => i).filter((i) => divergente(series.map((s) => s.mm[i])));
    return { dias, series, divergentes };
  }

  /** Bloco 2: o ranking de um período; ordem pelo erro de 1 a 7 dias, com quem não tem pares suficientes no fim. */
  function ranking(metricas, unidade, periodo) {
    const minhas = metricas.filter((m) => m.unidade === unidade && m.periodo === periodo);
    const linhas = FONTES.map((f) => {
      const daFonte = minhas.filter((m) => m.fonte === f.id);
      if (!daFonte.length) return null;
      const de = (k) => {
        const m = daFonte.find((x) => Number(x.antecedencia) === k);
        return m ? { n: Number(m.n), erro: num(m.erro_medio), vies: num(m.vies), acerto: num(m.acerto), suficiente: Number(m.n) >= MINIMO_PARES } : null;
      };
      return { fonte: f.id, nome: f.nome, cor: f.cor, geral: de(0), porAntecedencia: ANTECEDENCIAS.map((k) => ({ k, valor: de(k) })) };
    }).filter(Boolean);
    return linhas.sort((a, b) => {
      const sa = !!(a.geral && a.geral.suficiente), sb = !!(b.geral && b.geral.suficiente);
      if (sa !== sb) return sa ? -1 : 1;
      return sa ? a.geral.erro - b.geral.erro : 0;
    });
  }

  const virgula = (v) => String(v).replace('.', ',');
  /** Viés em palavras: positivo = prevê chuva demais. */
  function textoVies(v) {
    if (v === null || v === undefined) return '—';
    if (v > 0.5) return 'prevê chuva demais (+' + virgula(v) + ' mm)';
    if (v < -0.5) return 'prevê chuva de menos (' + virgula(v) + ' mm)';
    return 'sem tendência';
  }
  /** Há linhas de "Todas as fazendas" (o usuário vê todas)? */
  function temTodas(metricas) {
    return metricas.some((m) => m.unidade === TODAS);
  }

  /** Bloco 3: chuva medida × previsão feita k dias antes, nos 30 dias até ontem. */
  function previstoMedido(linhas, observado, unidade, k, hoje) {
    const ontem = somarDias(hoje, -1);
    const dias = Array.from({ length: 30 }, (_, i) => somarDias(ontem, i - 29));
    const sel = daUnidade(unidade);
    const medido = dias.map((d) => { const v = media(observado.filter((o) => sel(o) && o.dia === d && Number(o.pluviometros) > 0).map((o) => num(o.mm))); return v === null ? null : arred1(v); });
    const series = FONTES.map((f) => ({
      fonte: f.id, nome: f.nome, cor: f.cor,
      mm: dias.map((d) => {
        const emitida = somarDias(d, -k);
        const v = media(linhas.filter((l) => sel(l) && l.fonte === f.id && l.emitida_em === emitida).map((l) => valorDoDia(l, d, 'mm')));
        return v === null ? null : arred1(v);
      }),
    })).filter((s) => s.mm.some((v) => v !== null));
    return { dias, medido, series };
  }

  /** Quantos dias de foto existem nas linhas carregadas. */
  function diasDeFoto(linhas) {
    return new Set(linhas.map((l) => l.emitida_em)).size;
  }

  return { FONTES, ANTECEDENCIAS, MINIMO_PARES, TODAS, hojeMT, somarDias, proximosDias, divergente, ranking, textoVies, temTodas, previstoMedido, diasDeFoto };
});
