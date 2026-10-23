/* Aderência de utilização da plataforma — contas do módulo, sem tela. Recebe o que a função aderencia_dados devolve
   (supabase/0031_aderencia.sql) e monta os números do painel: por usuário, unidade, módulo, dia, relatório, tela,
   horário e dispositivo. Serve ao navegador (window.AderenciaLogica) e aos testes
   (node --test "modulos/aderencia/testes/*.test.mjs"). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AderenciaLogica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Cada evento "ativo" vale 5 minutos de uso (assets/uso.js). */
  const MINUTOS_POR_ATIVO = 5;
  /** Situação do usuário pelo último acesso: até 7 dias, até 30, mais que isso, nunca. */
  const DIAS_ATIVO = 7;
  const DIAS_ESFRIANDO = 30;
  const DIA_MS = 86400000;

  const NOMES_MODULO = {
    algodao: 'Algodão', mecanizadas: 'Mecanizadas', mapas: 'Mapas', acompanhamento: 'Operacional', sat: 'Locks SAT',
    previsao: 'Previsão do Tempo', chuva: 'Chuva por talhão', validacao: 'Validação PIMS', controle: 'Controle Técnico',
    painel: 'Montagens de Painel', aderencia: 'Aderência de utilização', administracao: 'Administração de usuários',
  };
  const NOMES_PEDIDO = { plantio: 'Atualizar plantio', chuva: 'Chuva via integração', boletins: 'Boletins do PIMS', validacao: 'Atualizar validação', car: 'Buscar nas bases (CAR)' };
  const nomeModulo = (m) => (m ? NOMES_MODULO[m] || m : 'Tela inicial');

  // ------------------------------------------------------------------ datas (dias de Cuiabá, 'YYYY-MM-DD')
  const numeroDoDia = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DIA_MS) : null;
  };
  const isoDoNumero = (n) => new Date(n * DIA_MS).toISOString().slice(0, 10);
  function somarDias(iso, dias) { return isoDoNumero(numeroDoDia(iso) + dias); }
  function diasEntre(de, ate) {
    const a = numeroDoDia(de), b = numeroDoDia(ate);
    const out = [];
    if (a === null || b === null) return out;
    for (let n = a; n <= b; n++) out.push(isoDoNumero(n));
    return out;
  }
  /** Data de hoje em Cuiabá ('YYYY-MM-DD'). */
  function hojeCuiaba(agora) {
    const d = new Date((agora || new Date()).getTime() - 4 * 3600000); // Cuiabá: UTC−4, sem horário de verão
    return d.toISOString().slice(0, 10);
  }
  /** Dia da semana (0 = domingo) de um dia 'YYYY-MM-DD'. */
  const diaDaSemana = (iso) => new Date(numeroDoDia(iso) * DIA_MS).getUTCDay();
  /** Data de um carimbo com hora (ISO) em Cuiabá. */
  const diaDoCarimbo = (ts) => (ts ? hojeCuiaba(new Date(ts)) : null);

  /** Períodos prontos do filtro. */
  function periodo(chave, hoje, rastreioDesde) {
    const mes = hoje.slice(0, 8) + '01';
    switch (chave) {
      case '7': return { de: somarDias(hoje, -6), ate: hoje };
      case '90': return { de: somarDias(hoje, -89), ate: hoje };
      case 'mes': return { de: mes, ate: hoje };
      case 'mes-passado': { const fim = somarDias(mes, -1); return { de: fim.slice(0, 8) + '01', ate: fim }; }
      case 'tudo': return { de: rastreioDesde && rastreioDesde < hoje ? rastreioDesde : somarDias(hoje, -29), ate: hoje };
      default: return { de: somarDias(hoje, -29), ate: hoje };
    }
  }
  /** O período anterior, do mesmo tamanho (para comparar). */
  function periodoAnterior(de, ate) {
    const n = numeroDoDia(ate) - numeroDoDia(de) + 1;
    return { de: somarDias(de, -n), ate: somarDias(de, -1) };
  }

  // ------------------------------------------------------------------ leitura do que veio do banco
  /** eventos [[dia, hora, usuário, tipo, módulo, fazenda, detalhe, dispositivo, n, sessões]] → objetos */
  function eventosDe(dados) {
    return (dados.eventos || []).map((e) => ({ dia: e[0], hora: Number(e[1]) || 0, u: e[2], tipo: e[3], modulo: e[4] || null, fazenda: e[5] === null || e[5] === undefined ? null : Number(e[5]), detalhe: e[6] || null, disp: e[7] || null, n: Number(e[8]) || 0 }));
  }
  const pedidosDe = (dados) => (dados.pedidos || []).map((p) => ({ dia: p[0], u: p[1], tipo: p[2], n: Number(p[3]) || 0 }));
  const mapasDe = (dados) => (dados.mapas || []).map((m) => ({ dia: m[0], u: m[1], tipo: m[2] || 'chuva', fazenda: m[3] === null || m[3] === undefined ? null : Number(m[3]), n: Number(m[4]) || 0 }));

  /** O usuário entra no filtro? (perfil e unidade: liberada a ele, ou administrador que vê todas) */
  function usuarioNoFiltro(u, filtro) {
    if (filtro.perfil === 'colaborador' && u.perfil === 'admin') return false;
    if (filtro.perfil === 'admin' && u.perfil !== 'admin') return false;
    if (filtro.fazenda !== null && filtro.fazenda !== undefined && filtro.fazenda !== '') {
      const f = Number(filtro.fazenda);
      if (!u.todas_fazendas && !(u.fazendas || []).map(Number).includes(f)) return false;
    }
    return true;
  }

  /** Situação pelo último acesso: 'ativo' (até 7 dias), 'esfriando' (até 30), 'inativo', 'nunca'. */
  function situacao(ultimoDia, hoje) {
    if (!ultimoDia) return 'nunca';
    const dias = numeroDoDia(hoje) - numeroDoDia(ultimoDia);
    return dias <= DIAS_ATIVO ? 'ativo' : dias <= DIAS_ESFRIANDO ? 'esfriando' : 'inativo';
  }
  const maior = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

  /**
   * Tudo o que o painel mostra, para um período ({ de, ate }) e um filtro ({ fazenda, perfil }).
   * `dados` pode trazer dias fora do período (o período anterior, para comparar): só os de dentro contam.
   */
  function montar(dados, filtro, hoje) {
    const de = filtro.de, ate = filtro.ate;
    const dentro = (dia) => dia >= de && dia <= ate;
    const fazendas = new Map((dados.fazendas || []).map((f) => [Number(f.id), f.nome]));
    const usuariosTodos = (dados.usuarios || []).map((u) => Object.assign({}, u, { fazendas: (u.fazendas || []).map(Number) }));
    const usuarios = usuariosTodos.filter((u) => usuarioNoFiltro(u, filtro));
    const ids = new Set(usuarios.map((u) => u.id));
    const ev = eventosDe(dados).filter((e) => ids.has(e.u) && dentro(e.dia));
    const ped = pedidosDe(dados).filter((p) => ids.has(p.u) && dentro(p.dia));
    const mapas = mapasDe(dados).filter((m) => ids.has(m.u) && dentro(m.dia));
    const dias = diasEntre(de, ate);

    // ---- por usuário
    const porU = new Map(usuarios.map((u) => [u.id, {
      id: u.id, nome: u.nome || u.email || 'Sem nome', email: u.email || '', perfil: u.perfil, super: !!u.super,
      todasFazendas: !!u.todas_fazendas, fazendas: u.fazendas, fazendasNomes: u.todas_fazendas ? ['Todas'] : u.fazendas.map((f) => fazendas.get(f) || String(f)),
      categorias: u.categorias || [], criadoEm: diaDoCarimbo(u.criado_em), ultimoLogin: diaDoCarimbo(u.ultimo_login),
      acessos: 0, entradas: 0, relatorios: 0, telas: 0, minutos: 0, mapasSalvos: 0, pedidos: 0,
      dias: new Set(), modulos: new Set(), ultimoUso: null, dispositivos: {},
    }]));
    for (const e of ev) {
      const x = porU.get(e.u);
      x.dias.add(e.dia);
      x.ultimoUso = maior(x.ultimoUso, e.dia);
      if (e.tipo === 'acesso') { x.acessos += e.n; if (e.disp) x.dispositivos[e.disp] = (x.dispositivos[e.disp] || 0) + e.n; }
      else if (e.tipo === 'entrada') x.entradas += e.n;
      else if (e.tipo === 'relatorio') x.relatorios += e.n;
      else if (e.tipo === 'pagina') x.telas += e.n;
      else if (e.tipo === 'ativo') x.minutos += e.n * MINUTOS_POR_ATIVO;
      if (e.modulo && e.tipo !== 'acesso' && e.tipo !== 'entrada') x.modulos.add(e.modulo);
    }
    for (const m of mapas) { const x = porU.get(m.u); x.mapasSalvos += m.n; x.dias.add(m.dia); x.ultimoUso = maior(x.ultimoUso, m.dia); x.modulos.add('mapas'); }
    for (const p of ped) { const x = porU.get(p.u); x.pedidos += p.n; x.dias.add(p.dia); x.ultimoUso = maior(x.ultimoUso, p.dia); }
    const totalAcessos = [...porU.values()].reduce((s, x) => s + x.acessos, 0);
    const lista = [...porU.values()].map((x) => {
      const ultimoAcesso = maior(x.ultimoUso, x.ultimoLogin);
      return Object.assign(x, {
        diasAtivos: x.dias.size, frequencia: dias.length ? x.dias.size / dias.length : 0,
        pctAcessos: totalAcessos ? x.acessos / totalAcessos : 0, modulos: [...x.modulos].sort(),
        ultimoAcesso: ultimoAcesso, situacao: situacao(ultimoAcesso, hoje), ativoNoPeriodo: x.dias.size > 0, dias: [...x.dias].sort(),
      });
    }).sort((a, b) => b.acessos - a.acessos || b.diasAtivos - a.diasAtivos || a.nome.localeCompare(b.nome, 'pt-BR'));

    // ---- série por dia
    const serie = dias.map((dia) => ({ dia, usuarios: new Set(), acessos: 0, relatorios: 0, minutos: 0, mapas: 0 }));
    const daSerie = new Map(serie.map((s) => [s.dia, s]));
    for (const e of ev) {
      const s = daSerie.get(e.dia);
      if (!s) continue;
      s.usuarios.add(e.u);
      if (e.tipo === 'acesso') s.acessos += e.n;
      else if (e.tipo === 'relatorio') s.relatorios += e.n;
      else if (e.tipo === 'ativo') s.minutos += e.n * MINUTOS_POR_ATIVO;
    }
    for (const m of mapas) { const s = daSerie.get(m.dia); if (s) { s.mapas += m.n; s.usuarios.add(m.u); } }
    for (const p of ped) { const s = daSerie.get(p.dia); if (s) s.usuarios.add(p.u); }
    const serieFinal = serie.map((s) => ({ dia: s.dia, ativos: s.usuarios.size, acessos: s.acessos, relatorios: s.relatorios, minutos: s.minutos, mapas: s.mapas, semana: diaDaSemana(s.dia) }));

    // ---- por módulo (aberturas pela tela inicial, telas, relatórios, tempo e usuários)
    const porM = new Map();
    const mod = (m) => { if (!porM.has(m)) porM.set(m, { modulo: m, nome: nomeModulo(m), aberturas: 0, telas: 0, relatorios: 0, minutos: 0, mapas: 0, usuarios: new Set() }); return porM.get(m); };
    for (const e of ev) {
      if (!e.modulo || e.tipo === 'acesso' || e.tipo === 'entrada') continue;
      const x = mod(e.modulo);
      if (e.tipo === 'modulo') x.aberturas += e.n;
      else if (e.tipo === 'pagina') x.telas += e.n;
      else if (e.tipo === 'relatorio') x.relatorios += e.n;
      else if (e.tipo === 'ativo') x.minutos += e.n * MINUTOS_POR_ATIVO;
      x.usuarios.add(e.u);
    }
    for (const m of mapas) { const x = mod('mapas'); x.mapas += m.n; x.usuarios.add(m.u); }
    const modulos = [...porM.values()].map((x) => Object.assign(x, { usuarios: x.usuarios.size }))
      .sort((a, b) => b.usuarios - a.usuarios || b.minutos - a.minutos || b.aberturas - a.aberturas);

    // ---- por unidade: usuários liberados (e quantos usaram), ações feitas com a fazenda escolhida no menu
    const porF = new Map((dados.fazendas || []).map((f) => [Number(f.id), { id: Number(f.id), nome: f.nome, liberados: 0, ativos: 0, acessos: 0, acoes: 0, relatorios: 0, mapas: 0, minutos: 0, usuariosNaFazenda: new Set() }]));
    for (const x of lista) {
      if (x.todasFazendas) continue;
      for (const f of x.fazendas) {
        const y = porF.get(f);
        if (!y) continue;
        y.liberados += 1;
        if (x.ativoNoPeriodo) y.ativos += 1;
        y.acessos += x.acessos;
      }
    }
    for (const e of ev) {
      const y = e.fazenda === null ? null : porF.get(e.fazenda);
      if (!y || e.tipo === 'acesso' || e.tipo === 'entrada') continue;
      if (e.tipo === 'ativo') y.minutos += e.n * MINUTOS_POR_ATIVO;
      else { y.acoes += e.n; y.usuariosNaFazenda.add(e.u); }
      if (e.tipo === 'relatorio') y.relatorios += e.n;
    }
    for (const m of mapas) { const y = m.fazenda === null ? null : porF.get(m.fazenda); if (y) { y.mapas += m.n; y.usuariosNaFazenda.add(m.u); } }
    const unidades = [...porF.values()]
      .map((y) => Object.assign(y, { adesao: y.liberados ? y.ativos / y.liberados : null, usuariosNaFazenda: y.usuariosNaFazenda.size }))
      .filter((y) => filtro.fazenda === null || filtro.fazenda === undefined || filtro.fazenda === '' || y.id === Number(filtro.fazenda))
      .filter((y) => y.liberados || y.acoes || y.mapas || y.minutos)
      .sort((a, b) => b.acoes + b.mapas - (a.acoes + a.mapas) || b.ativos - a.ativos || a.nome.localeCompare(b.nome, 'pt-BR'));

    // ---- relatórios: por tipo de arquivo, por módulo e os mais gerados
    const porTipo = new Map(), porArquivo = new Map(), relPorModulo = new Map();
    for (const e of ev) {
      if (e.tipo !== 'relatorio') continue;
      const [ext, ...resto] = String(e.detalhe || 'ARQUIVO').split(' · ');
      porTipo.set(ext, (porTipo.get(ext) || 0) + e.n);
      const nome = modeloDoArquivo(resto.join(' · '));
      const k = nomeModulo(e.modulo) + ' · ' + nome + ' (' + ext + ')';
      porArquivo.set(k, (porArquivo.get(k) || 0) + e.n);
      relPorModulo.set(nomeModulo(e.modulo), (relPorModulo.get(nomeModulo(e.modulo)) || 0) + e.n);
    }
    const ordenar = (m) => [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR'));
    const mapasPorTipo = new Map();
    for (const m of mapas) mapasPorTipo.set(m.tipo === 'variedade' ? 'Mapa de variedade' : 'Mapa de chuva', (mapasPorTipo.get(m.tipo === 'variedade' ? 'Mapa de variedade' : 'Mapa de chuva') || 0) + m.n);
    const pedPorTipo = new Map();
    for (const p of ped) pedPorTipo.set(NOMES_PEDIDO[p.tipo] || p.tipo, (pedPorTipo.get(NOMES_PEDIDO[p.tipo] || p.tipo) || 0) + p.n);

    // ---- telas mais abertas
    const porTela = new Map();
    for (const e of ev) {
      if (e.tipo !== 'pagina' || !e.detalhe) continue;
      const k = nomeModulo(e.modulo) + ' › ' + e.detalhe;
      if (!porTela.has(k)) porTela.set(k, { nome: k, n: 0, usuarios: new Set() });
      const t = porTela.get(k);
      t.n += e.n;
      t.usuarios.add(e.u);
    }
    const telas = [...porTela.values()].map((t) => ({ nome: t.nome, n: t.n, usuarios: t.usuarios.size })).sort((a, b) => b.n - a.n).slice(0, 15);

    // ---- horários (dia da semana × hora) e dispositivos
    const calor = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const e of ev) calor[diaDaSemana(e.dia)][e.hora] += e.n;
    const dispositivos = { computador: 0, celular: 0, tablet: 0 };
    for (const e of ev) if (e.tipo === 'acesso' && e.disp && dispositivos[e.disp] !== undefined) dispositivos[e.disp] += e.n;

    // ---- números do topo
    const ativos = lista.filter((x) => x.ativoNoPeriodo);
    const kpis = {
      cadastrados: lista.length,
      ativos: ativos.length,
      adesao: lista.length ? ativos.length / lista.length : 0,
      acessos: totalAcessos,
      entradas: lista.reduce((s, x) => s + x.entradas, 0),
      relatorios: lista.reduce((s, x) => s + x.relatorios, 0),
      mapasSalvos: lista.reduce((s, x) => s + x.mapasSalvos, 0),
      pedidos: lista.reduce((s, x) => s + x.pedidos, 0),
      minutos: lista.reduce((s, x) => s + x.minutos, 0),
      mediaAtivosDia: serieFinal.length ? serieFinal.reduce((s, d) => s + d.ativos, 0) / serieFinal.length : 0,
      ativos7: lista.filter((x) => x.situacao === 'ativo').length,
      nunca: lista.filter((x) => x.situacao === 'nunca').length,
      semAcesso30: lista.filter((x) => x.situacao === 'inativo').length,
    };

    return {
      de, ate, dias, kpis, usuarios: lista, serie: serieFinal, modulos, unidades, telas, calor, dispositivos,
      relatorios: { porTipo: ordenar(porTipo), porModulo: ordenar(relPorModulo), top: ordenar(porArquivo).slice(0, 12), mapas: ordenar(mapasPorTipo), pedidos: ordenar(pedPorTipo) },
      atencao: lista.filter((x) => x.situacao === 'nunca' || x.situacao === 'inativo').sort((a, b) => (a.ultimoAcesso || '').localeCompare(b.ultimoAcesso || '') || a.nome.localeCompare(b.nome, 'pt-BR')),
    };
  }

  /** "MAPA_CHUVA_DOURADO_01-10-2026_a_15-10-2026" → "MAPA CHUVA DOURADO": sem datas e números, para juntar os iguais. */
  function modeloDoArquivo(nome) {
    const limpo = String(nome || '')
      .replace(/\d{1,4}[-_/.]\d{1,2}[-_/.]\d{1,4}/g, ' ')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\b(a|ate|de)\b/gi, ' ')
      .replace(/\d+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return limpo || 'arquivo';
  }

  /** Variação de um número em relação ao período anterior: { dif, pct } (pct null sem base). */
  function variacao(atual, anterior) {
    if (anterior === null || anterior === undefined) return null;
    const dif = atual - anterior;
    return { dif, pct: anterior ? dif / anterior : null };
  }

  /** Linhas do CSV dos usuários (separador ';', como o Excel em português espera). */
  function csvUsuarios(r) {
    const cab = ['Usuário', 'E-mail', 'Perfil', 'Unidades', 'Acessos', '% dos acessos', 'Dias ativos', 'Frequência', 'Relatórios baixados', 'Mapas salvos', 'Pedidos', 'Tempo de uso (h)', 'Módulos', 'Último acesso', 'Situação'];
    const cel = (v) => {
      const t = String(v === null || v === undefined ? '' : v);
      const seguro = /^[=+\-@]/.test(t) ? "'" + t : t; // planilha não executa fórmula vinda de nome
      return /[";\n]/.test(seguro) ? '"' + seguro.replace(/"/g, '""') + '"' : seguro;
    };
    const num = (v, casas) => Number(v || 0).toFixed(casas || 0).replace('.', ',');
    const linhas = r.usuarios.map((x) => [
      x.nome, x.email, x.perfil === 'admin' ? (x.super ? 'Administrador+' : 'Administrador') : 'Colaborador', x.fazendasNomes.join(', '), x.acessos,
      num(x.pctAcessos * 100, 1), x.diasAtivos, num(x.frequencia * 100, 0) + '%', x.relatorios, x.mapasSalvos, x.pedidos, num(x.minutos / 60, 1),
      x.modulos.map(nomeModulo).join(', '), x.ultimoAcesso || '', TEXTO_SITUACAO[x.situacao],
    ]);
    return [cab, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n');
  }
  const TEXTO_SITUACAO = { ativo: 'Ativo', esfriando: 'Esfriando', inativo: 'Sem acesso há mais de 30 dias', nunca: 'Nunca acessou' };

  return {
    MINUTOS_POR_ATIVO, DIAS_ATIVO, DIAS_ESFRIANDO, NOMES_MODULO, TEXTO_SITUACAO,
    hojeCuiaba, somarDias, diasEntre, diaDaSemana, periodo, periodoAnterior, situacao, usuarioNoFiltro,
    montar, modeloDoArquivo, variacao, csvUsuarios, nomeModulo,
  };
});
