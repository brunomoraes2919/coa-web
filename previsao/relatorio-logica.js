/* Previsão do Tempo — contas do relatório em PDF por fazenda, sem tela: período, chuva da ZEUS, temperatura do
   Visual Crossing (ou do MET Norway), fotos usadas e total. Dados: prev_previsoes (foto diária da rotina da VM).
   Serve ao navegador (window.PrevisaoRelatorioLogica) e aos testes (node --test "modulos/previsao/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PrevisaoRelatorioLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIAS_MAX = 15; // hoje até hoje + 14
  const FOTOS_DIAS = 3; // fotos de hoje, ontem e anteontem

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  function somarDias(dia, n) {
    const d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** As fotos de uma fonte para uma fazenda nos últimos FOTOS_DIAS dias, da mais recente para a mais antiga. */
  function fotosRecentes(previsoes, fonte, unidade, hoje) {
    const desde = somarDias(hoje, -(FOTOS_DIAS - 1));
    return previsoes
      .filter((l) => l.fonte === fonte && l.unidade === unidade && l.emitida_em >= desde && l.emitida_em <= hoje)
      .sort((a, b) => (a.emitida_em < b.emitida_em ? 1 : a.emitida_em > b.emitida_em ? -1 : 0));
  }
  const diasDa = (foto) => (foto && Array.isArray(foto.dias) ? foto.dias : []);
  const temTemperatura = (foto) => diasDa(foto).some((x) => num(x.tx) !== null || num(x.tn) !== null);
  function valor(foto, d, campo) {
    const x = diasDa(foto).find((y) => y.d === d);
    return x ? num(x[campo]) : null;
  }

  /**
   * Uma fazenda: chuva da ZEUS (foto mais recente), temperatura do Visual Crossing (ou do MET Norway), de hoje ao último
   * dia com dado. Na temperatura, o dia que falta na foto mais recente vem da foto anterior da mesma fonte: a foto da
   * manhã do MET Norway começa em amanhã, e o hoje sai da foto de ontem (a página diz de qual foto veio).
   */
  function fazendaDoRelatorio(previsoes, fazenda, hoje) {
    const zeus = fotosRecentes(previsoes, 'zeus', fazenda.unidade, hoje)[0] || null;
    const vcs = fotosRecentes(previsoes, 'visualcrossing', fazenda.unidade, hoje);
    const mets = fotosRecentes(previsoes, 'metno', fazenda.unidade, hoje);
    const temps = temTemperatura(vcs[0]) ? vcs : temTemperatura(mets[0]) ? mets : [];
    const temp = temps[0] || null;
    function grau(d, campo) {
      for (let i = 0; i < temps.length; i++) {
        const v = valor(temps[i], d, campo);
        if (v !== null) return { v, foto: temps[i] };
      }
      return { v: null, foto: null };
    }
    const todos = Array.from({ length: DIAS_MAX }, (_, i) => somarDias(hoje, i));
    let ultimo = -1;
    todos.forEach((d, i) => {
      if (valor(zeus, d, 'mm') !== null || grau(d, 'tx').v !== null || grau(d, 'tn').v !== null) ultimo = i;
    });
    const dias = todos.slice(0, ultimo + 1);
    const mm = dias.map((d) => valor(zeus, d, 'mm'));
    const tx = dias.map((d) => grau(d, 'tx'));
    const tn = dias.map((d) => grau(d, 'tn'));
    const anteriores = tx.concat(tn).filter((g) => g.foto && g.foto !== temp).map((g) => g.foto.capturada_em).sort();
    const comChuva = mm.filter((v) => v !== null);
    return {
      nome: fazenda.nome,
      unidade: fazenda.unidade,
      dias,
      mm,
      p: dias.map((d) => valor(zeus, d, 'p')),
      tx: tx.map((g) => g.v),
      tn: tn.map((g) => g.v),
      fonteTemperatura: temp ? temp.fonte : null,
      fotos: {
        chuva: zeus ? zeus.capturada_em : null,
        temperatura: temp ? temp.capturada_em : null,
        temperaturaAnterior: anteriores.length ? anteriores[anteriores.length - 1] : null,
      },
      total: comChuva.length ? Math.round(comChuva.reduce((s, v) => s + v, 0) * 10) / 10 : null,
      semDados: !dias.length,
    };
  }

  /** O relatório: fazendas com unidade do PIMS, em ordem alfabética, a foto mais recente usada e as fontes de temperatura. */
  function montarRelatorio(previsoes, fazendas, hoje) {
    const lista = fazendas.filter((f) => f.unidade).slice()
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
      .map((f) => fazendaDoRelatorio(previsoes, f, hoje));
    const fotos = [];
    lista.forEach((f) => { if (f.fotos.chuva) fotos.push(f.fotos.chuva); if (f.fotos.temperatura) fotos.push(f.fotos.temperatura); });
    fotos.sort();
    const fontesTemperatura = [];
    lista.forEach((f) => { if (f.fonteTemperatura && fontesTemperatura.indexOf(f.fonteTemperatura) < 0) fontesTemperatura.push(f.fonteTemperatura); });
    return { fazendas: lista, fotoMaisRecente: fotos.length ? fotos[fotos.length - 1] : null, fontesTemperatura };
  }

  /** Altura da faixa colorida entre a mínima e a máxima de cada dia (gráfico do PDF); sem um dos dois, sem faixa. */
  function faixaDeTemperatura(tx, tn) {
    return tx.map((max, i) => (max === null || tn[i] === null ? null : Math.round((max - tn[i]) * 10) / 10));
  }

  /* As fontes padrão do jsPDF só têm o conjunto WinAnsi: Latin-1 e estes sinais. O resto vira '?' (ou o equivalente). */
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const TROCAS = { '≥': '>=', '≤': '<=' };
  function paraPdf(texto) {
    return Array.from(String(texto).normalize('NFC'))
      .map((c) => (c.charCodeAt(0) <= 0xff || WINANSI_EXTRA.indexOf(c) >= 0 ? c : TROCAS[c] || '?'))
      .join('');
  }
  const nomeArquivo = (hoje) => 'previsao-fazendas-' + hoje + '.pdf';

  return { DIAS_MAX, FOTOS_DIAS, somarDias, montarRelatorio, faixaDeTemperatura, paraPdf, nomeArquivo };
});
