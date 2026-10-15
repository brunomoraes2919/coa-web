/* Montagens de Painel — de onde vêm e para onde vão os dados: o Supabase do COA WEB ou o servidor local de
   testes (modulos/painel/scripts/servidor-local.mjs, que troca config.js por { modo: 'local' }). O editor e a TV
   só falam com o objeto de PainelFonte.criar():
     pronto()                         confere login e categoria
     listar()                         { montagens: [linha], tvId }
     criar(dados) / salvar(id, dados) linha   (dados = { nome, divisao, quadros })
     apagar(id) / porNaTv(id | null)
     daTv()                           { montagem_id, montagem: linha | null }
     marcaDaTv()                      texto que muda quando a TV precisa reler a montagem
     fazendas()                       linhas de mapas_fazendas (id, nome, unidade_pims)
     conferirSite(url)                { resultado, motivo } (api/conferir-site.js)
   linha = { id, nome, divisao, quadros, atualizado_em }. Os erros têm .codigo: 'sem-login', 'sem-categoria',
   'nome-repetido', 'na-tv' ou 'banco'. */
(function () {
  'use strict';
  const CFG = window.PAINEL_CONFIG || {};
  const L = window.PainelLogica;
  const EMBED = new URLSearchParams(location.search).get('embed') === '1';
  const COLUNAS = 'id,nome,divisao,quadros,atualizado_em';

  function erro(mensagem, codigo) {
    const e = new Error(mensagem);
    e.codigo = codigo;
    return e;
  }

  function fonteSupabase() {
    // dentro da casca (embed) quem renova a sessão é o COA WEB; na TV (aba própria, dias ligada), a própria página
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { autoRefreshToken: !EMBED, persistSession: true } });
    function dados(r) {
      if (!r.error) return r.data;
      if (r.error.code === '23505') throw erro('Já existe uma montagem com esse nome.', 'nome-repetido');
      if (r.error.code === '23503') throw erro('Ponha outra montagem na TV antes de apagar esta.', 'na-tv');
      if (r.error.code === 'PGRST301' || r.status === 401) throw erro('Sua sessão expirou. Entre de novo no COA WEB.', 'sem-login');
      throw erro(r.error.message || 'Não foi possível falar com o banco.', 'banco');
    }
    return {
      pronto: async function () {
        const s = await sb.auth.getSession();
        if (!s.data || !s.data.session) throw erro('Entre no COA WEB neste computador.', 'sem-login');
        const r = await sb.rpc('tem_categoria', { p_categoria: 'painel' });
        if (r.error) throw erro('Não foi possível conferir o acesso.', 'banco');
        if (r.data !== true) throw erro('Este login não tem acesso a Montagens de Painel.', 'sem-categoria');
      },
      listar: async function () {
        const r = await Promise.all([
          sb.from('painel_montagens').select(COLUNAS).order('nome'),
          sb.from('painel_tv').select('montagem_id').eq('id', 1).maybeSingle(),
        ]);
        const tv = dados(r[1]);
        return { montagens: dados(r[0]) || [], tvId: tv ? tv.montagem_id : null };
      },
      criar: async function (d) { return dados(await sb.from('painel_montagens').insert(d).select(COLUNAS).single()); },
      salvar: async function (id, d) { return dados(await sb.from('painel_montagens').update(d).eq('id', id).select(COLUNAS).single()); },
      apagar: async function (id) { dados(await sb.from('painel_montagens').delete().eq('id', id)); },
      porNaTv: async function (id) { dados(await sb.from('painel_tv').update({ montagem_id: id }).eq('id', 1)); },
      daTv: async function () {
        const r = dados(await sb.from('painel_tv').select('montagem_id,montagem:painel_montagens(' + COLUNAS + ')').eq('id', 1).maybeSingle());
        return { montagem_id: r ? r.montagem_id : null, montagem: r && r.montagem ? r.montagem : null };
      },
      marcaDaTv: async function () {
        return L.assinaturaDaTv(dados(await sb.from('painel_tv').select('montagem_id,montagem:painel_montagens(atualizado_em)').eq('id', 1).maybeSingle()));
      },
      fazendas: async function () {
        return dados(await sb.from('mapas_fazendas').select('id,nome,unidade_pims').order('nome')) || [];
      },
      conferirSite: async function (url) {
        const s = await sb.auth.getSession();
        const token = s.data && s.data.session ? s.data.session.access_token : '';
        const r = await fetch('/api/conferir-site?url=' + encodeURIComponent(url), { headers: { 'X-Coa-Token': token }, cache: 'no-store' });
        let corpo = null;
        try { corpo = await r.json(); } catch (e) { /* não veio JSON */ }
        return corpo && corpo.resultado ? corpo : { resultado: 'incerto', motivo: 'Não foi possível conferir agora (' + r.status + ').' };
      },
    };
  }

  /* servidor local de testes: as mesmas respostas, sem login */
  function fonteLocal() {
    async function api(metodo, caminho, corpo) {
      const r = await fetch(caminho, {
        method: metodo,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        cache: 'no-store',
      });
      const t = await r.text();
      let d = null;
      try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
      if (d && d.codigo) throw erro(d.motivo, d.codigo);
      if (!r.ok && !(d && d.resultado)) throw erro((d && d.motivo) || 'O servidor local respondeu ' + r.status + '.', 'banco');
      return d;
    }
    return {
      pronto: async function () {},
      listar: function () { return api('GET', '/api/painel/estado'); },
      criar: function (d) { return api('POST', '/api/painel/montagens', d); },
      salvar: function (id, d) { return api('PUT', '/api/painel/montagens/' + encodeURIComponent(id), d); },
      apagar: function (id) { return api('DELETE', '/api/painel/montagens/' + encodeURIComponent(id)); },
      porNaTv: function (id) { return api('PUT', '/api/painel/tv', { montagem_id: id }); },
      daTv: function () { return api('GET', '/api/painel/tv'); },
      marcaDaTv: async function () { return L.assinaturaDaTv(await api('GET', '/api/painel/tv')); },
      fazendas: function () { return api('GET', '/api/painel/fazendas'); },
      conferirSite: function (url) { return api('GET', '/api/conferir-site?url=' + encodeURIComponent(url)); },
    };
  }

  window.PainelFonte = {
    criar: function () { return CFG.modo === 'local' ? fonteLocal() : fonteSupabase(); },
  };
})();
