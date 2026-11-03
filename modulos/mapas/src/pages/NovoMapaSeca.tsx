import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import PreviaLayout from '../components/editor/PreviaLayout';
import PainelTextos from '../components/editor/PainelTextos';
import { SecaoAparencia } from '../components/editor/SecaoAparencia';
import { useCadastros, useLogo } from '../components/editor/hooks';
import { usePreSelecaoCoa } from '../components/editor/usePreSelecaoCoa';
import '../components/editor/editor.css';
import { validarPeriodo } from '../lib/chuvaZeus';
import { aparenciaDoMapaSalvo, layoutPadrao } from '../lib/editor';
import { editarTexto } from '../lib/editorRegras';
import { fazendasDoCoa } from '../lib/embed';
import { baixarArquivo, DPI_OPCOES, DPI_PADRAO, gerarCopiaHistorico, gerarPng, nomeArquivoMapa } from '../lib/exportar';
import { isoData } from '../lib/format';
import { DPI_HISTORICO, identidadeMapa, type ModoSalvar } from '../lib/historico';
import {
  avisoDaSeca, buscarSecaZeus, calcularSeca, CLASSES_SECA, corDaSeca, COR_SEM_DADO, csvSecaPorTalhao, lerDadosSeca, resumoDaSeca, resumoDoMapaSeca,
  TEXTO_SEM_DADO, textoDiasSeca, textosAutomaticosSeca, type DadosSeca,
} from '../lib/seca';
import type { LayoutConfig, LayoutTextos, MapaSalvo, Palette, Talhao } from '../lib/types';
import { composicaoDe, extentsDosQuadros, TILES, type RenderInput } from '../render';

type Aparencia = Omit<LayoutConfig, 'textos'>;
/** o mapa de dias sem chuva não usa a escala de cores de chuva */
const PALETA_VAZIA: Palette = { id: 'seca', nome: 'Dias sem chuva', classes: [] };
const SEM_SITUACAO = new Map();

function diaAntes(n: number): string {
  const d = new Date();
  return isoData(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
}

function podeBuscar(): boolean {
  try {
    return repo().podeBuscarChuva;
  } catch {
    return false;
  }
}

/** Novo mapa de dias sem chuva (e mapa salvo, em /secas/:id). */
export default function NovoMapaSeca() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fazendas, erro: erroCadastros } = useCadastros();
  const [fazendaId, setFazendaId] = useState('');
  const [de, setDe] = useState(() => diaAntes(30));
  const [ate, setAte] = useState(() => diaAntes(1));
  const [setores, setSetores] = useState<string[] | null>(null);
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [carregandoTalhoes, setCarregandoTalhoes] = useState(false);
  /** resposta do servidor (só muda no clique de Atualizar ou ao abrir um mapa salvo) */
  const [dados, setDados] = useState<DadosSeca | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [aparencia, setAparencia] = useState<Aparencia>(() => {
    const { textos: _t, ...resto } = layoutPadrao();
    return { ...resto, mostrarValoresPics: false };
  });
  const [editados, setEditados] = useState<Partial<LayoutTextos>>({});
  const [dpi, setDpi] = useState<number>(DPI_PADRAO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>((location.state as { msg?: string } | null)?.msg ?? null);
  const [avisosRender, setAvisosRender] = useState<string[]>([]);
  const [mapaAtual, setMapaAtual] = useState<MapaSalvo | null>(null);
  const abertoRef = useRef<string | null>(null);
  /** busca em andamento que ainda vale (trocar de fazenda descarta a resposta) */
  const busca = useRef(0);
  const logo = useLogo();

  const fazenda = fazendas?.find((f) => f.id === fazendaId) ?? null;

  // talhões da fazenda (nunca os da anterior enquanto carrega)
  useEffect(() => {
    let ativo = true;
    setTalhoes([]);
    if (!fazendaId) return;
    setCarregandoTalhoes(true);
    repo()
      .obterTalhoes(fazendaId)
      .then((t) => ativo && setTalhoes(t))
      .catch((e) => ativo && setErro(`Não foi possível carregar os talhões: ${mensagemDeErro(e)}`))
      .finally(() => ativo && setCarregandoTalhoes(false));
    return () => {
      ativo = false;
    };
  }, [fazendaId]);

  // Reabrir um mapa salvo (/secas/:id) com a resposta guardada nele; outro tipo vai para a tela dele
  useEffect(() => {
    if (!id || abertoRef.current === id) return;
    let ativo = true;
    repo()
      .obterMapa(id)
      .then((m) => {
        if (!ativo) return;
        if (!m) return setErro('Mapa não encontrado no histórico.');
        if (m.tipo !== 'seca') return navigate(m.tipo === 'variedade' ? `/variedades/${m.id}` : `/mapas/${m.id}`, { replace: true });
        abertoRef.current = m.id;
        setMapaAtual(m);
        setFazendaId(m.fazendaId);
        setSetores(m.config.setores ?? null);
        setAparencia(aparenciaDoMapaSalvo(m.config));
        setEditados(m.config.textosEditados ?? m.config.textos);
        const s = m.resumo.seca;
        if (s) {
          setDe(s.de);
          setAte(s.ate);
          try {
            if (s.dados) setDados(lerDadosSeca(s.dados));
          } catch {
            setErro('Não foi possível ler os dados guardados neste mapa. Clique em Atualizar para buscar de novo.');
          }
        }
      })
      .catch((e) => ativo && setErro(`Não foi possível abrir o mapa: ${mensagemDeErro(e)}`));
    return () => {
      ativo = false;
    };
  }, [id, navigate]);

  const setoresDisponiveis = useMemo(
    () => [...new Set(talhoes.map((t) => t.setor).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [talhoes],
  );
  const talhoesUsados = useMemo(() => (setores && setores.length ? talhoes.filter((t) => t.setor && setores.includes(t.setor)) : talhoes), [talhoes, setores]);
  const resultado = useMemo(() => (dados ? calcularSeca(dados, talhoesUsados) : null), [dados, talhoesUsados]);
  const resumo = useMemo(() => (dados && resultado ? resumoDaSeca(resultado, dados) : null), [dados, resultado]);
  const aviso = dados && resultado ? avisoDaSeca(dados, resultado) : null;

  const automaticos = useMemo(
    () => textosAutomaticosSeca({ fazenda: fazenda?.nome ?? '', de: dados?.de ?? null, ate: dados?.ate ?? null, setores, hoje: new Date() }),
    [fazenda, dados, setores],
  );
  const textos: LayoutTextos = { ...automaticos, ...editados };

  const renderInput: RenderInput | null = useMemo(() => {
    if (!resultado || !resumo || !resultado.referencia || !talhoesUsados.length) return null;
    const cores = new Map<string, string>();
    const rotulos = new Map<string, string>();
    for (const [idT, s] of resultado.porTalhao) {
      cores.set(idT, corDaSeca(s));
      const t = textoDiasSeca(s);
      if (t) rotulos.set(idT, t);
    }
    return {
      config: { ...aparencia, textos, setores, textosEditados: editados },
      palette: PALETA_VAZIA,
      grid: null,
      talhoes: talhoesUsados,
      situacoes: SEM_SITUACAO,
      areasCultura: [],
      plantioGeradoEm: null,
      resumo: null,
      nomeSafra: '',
      pics: [],
      logo,
      tiles: aparencia.mapaBase === 'nenhum' ? null : TILES[aparencia.mapaBase],
      seca: { cores, rotulos, resumo },
    };
    // textos é derivado de automaticos + editados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aparencia, automaticos, editados, setores, talhoesUsados, resultado, resumo, logo]);

  const extentEfetivo = useMemo(() => {
    if (!renderInput) return null;
    const comp = composicaoDe(renderInput);
    return comp.quadros.length === 1 ? extentsDosQuadros(renderInput, comp)[0] : null;
  }, [renderInput]);

  const trocarFazenda = (idF: string) => {
    busca.current += 1; // a resposta de uma busca da fazenda anterior não vale mais
    setEtapa(null);
    setFazendaId(idF);
    setSetores(null);
    setDados(null);
    setAparencia((a) => ({ ...a, extent: null }));
  };
  const coa = usePreSelecaoCoa(fazendas, fazendaId, !id, trocarFazenda);
  const alternarSetor = (s: string, ativo: boolean) => {
    const atual = setores ?? setoresDisponiveis;
    const novo = ativo ? atual.filter((x) => x !== s) : [...atual, s];
    setSetores(novo.length === setoresDisponiveis.length || novo.length === 0 ? null : novo);
    setAparencia((a) => ({ ...a, extent: null }));
  };

  /** Atualizar: o único momento em que a chuva é buscada (só a fazenda e as datas escolhidas). */
  const atualizar = async () => {
    if (etapa !== null || !fazenda) return;
    const invalido = validarPeriodo(de, ate, isoData(new Date()));
    if (invalido) {
      setErro(invalido);
      return;
    }
    setErro(null);
    setSucesso(null);
    const esta = ++busca.current;
    const r = repo();
    const fim = await buscarSecaZeus({
      pedir: () => r.pedirChuvaZeus({ fazenda: fazenda.nome, de, ate, tipo: 'talhoes' }),
      situacao: (idP) => r.situacaoPedidoChuva(idP),
      aoEtapa: (t) => busca.current === esta && setEtapa(t),
    });
    if (busca.current !== esta) return;
    setEtapa(null);
    if (fim.tipo === 'erro') {
      setErro(fim.texto);
      return;
    }
    setDados(fim.dados);
    setAparencia((a) => ({ ...a, extent: null }));
  };

  const periodoMudou = !!dados && (dados.de !== de || dados.ate !== ate);
  const nomeArquivo = nomeArquivoMapa(textos.fazenda || 'fazenda', textos.periodo, 'png', 'MAPA_DIAS_SEM_CHUVA');

  const baixar = async () => {
    if (!renderInput) return;
    setErro(null);
    setOcupado(`Gerando PNG em ${dpi} dpi…`);
    try {
      const { blob, avisos } = await gerarPng(renderInput, dpi);
      setAvisosRender(avisos);
      baixarArquivo(blob, nomeArquivo);
    } catch (e) {
      setErro(`Falha ao gerar o PNG: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  const baixarCsv = () => {
    if (!resultado) return;
    // BOM: o Excel abre o CSV em UTF-8 com os acentos certos
    baixarArquivo(new Blob(['﻿' + csvSecaPorTalhao(talhoesUsados, resultado)], { type: 'text/csv;charset=utf-8' }), nomeArquivo.replace(/\.png$/, '_TALHOES.csv'));
  };

  const salvar = async (modo: ModoSalvar) => {
    if (!renderInput || !resumo || !fazenda || !dados) return;
    setErro(null);
    setOcupado('Salvando no histórico…');
    try {
      const { imagem, miniatura, avisos } = await gerarCopiaHistorico(renderInput, DPI_HISTORICO);
      setAvisosRender(avisos);
      const m: MapaSalvo = {
        ...identidadeMapa(modo, mapaAtual, new Date(), () => crypto.randomUUID()),
        tipo: 'seca',
        fazendaId: fazenda.id,
        safraId: null,
        titulo: `${fazenda.nome} · ${textos.periodo || 'sem período'}`,
        periodoInicio: dados.de,
        periodoFim: dados.ate,
        config: renderInput.config,
        pics: [],
        resumo: resumoDoMapaSeca(resumo),
        pngPath: null,
        thumbPath: null,
      };
      const salvo = await repo().salvarMapa(m, imagem, miniatura);
      const copia = !!mapaAtual && salvo.id !== mapaAtual.id;
      abertoRef.current = salvo.id;
      setMapaAtual(salvo);
      const msg = copia ? 'Salvo como um novo mapa no histórico (o anterior continua lá).' : mapaAtual ? 'Mapa atualizado no histórico.' : 'Mapa salvo no histórico.';
      setSucesso(msg);
      if (!id) navigate(`/secas/${salvo.id}`, { replace: true, state: { msg } });
      else if (copia) navigate(`/secas/${salvo.id}`);
    } catch (e) {
      setErro(`Não foi possível salvar: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  if (!fazendas) return <Carregando texto="Carregando cadastros…" />;

  const pronto = !!renderInput && !ocupado && etapa === null;
  const dicaBotoes = pronto ? undefined : ocupado || etapa ? 'Aguarde terminar' : 'Escolha a fazenda e o período e clique em Atualizar';
  const lista = fazendasDoCoa(fazendas, coa, fazendaId);
  const vazio = !fazendaId
    ? 'Escolha a fazenda e o período e clique em Atualizar.'
    : !dados
      ? 'Escolha o período e clique em Atualizar para buscar a chuva dos talhões na ZEUS.'
      : 'Sem dado da ZEUS para desenhar o mapa neste período.';

  return (
    <div className="pagina pagina-editor">
      <div className="pagina-cabecalho">
        <div>
          <h1>{id ? 'Editar mapa de dias sem chuva' : 'Novo mapa de dias sem chuva'}</h1>
          <p className="subtitulo">Chuva diária de cada talhão na ZEUS → dias desde a última chuva → layout COA em PNG</p>
        </div>
        <div className="linha">
          <label className="linha" title={`Resolução do PNG baixado (a cópia do histórico é sempre JPEG em ${DPI_HISTORICO} dpi)`}>
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="Resolução do PNG baixado">
              {DPI_OPCOES.map((d) => (
                <option key={d} value={d}>
                  {d} dpi{d === DPI_PADRAO ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          </label>
          {id ? (
            <>
              <button type="button" className="botao" disabled={!pronto || !mapaAtual} title={dicaBotoes ?? 'Regrava este mapa no histórico (mantém a data de criação)'} onClick={() => void salvar('atualizar')}>
                Atualizar este mapa
              </button>
              <button type="button" className="botao" disabled={!pronto} title={dicaBotoes ?? 'Guarda como outro mapa; este continua no histórico como está'} onClick={() => void salvar('novo')}>
                Salvar como novo
              </button>
            </>
          ) : (
            <button type="button" className="botao" disabled={!pronto} title={dicaBotoes} onClick={() => void salvar('novo')}>
              Salvar no histórico
            </button>
          )}
          <button type="button" className="botao botao-primario" disabled={!pronto} title={dicaBotoes} onClick={() => void baixar()}>
            Baixar PNG
          </button>
        </div>
      </div>

      {[erroCadastros, erro].filter(Boolean).map((m, i) => (
        <Aviso key={i} tipo="erro">
          {m}
        </Aviso>
      ))}
      {sucesso && (
        <Aviso tipo="sucesso" onFechar={() => setSucesso(null)}>
          {sucesso}
        </Aviso>
      )}
      {aviso && (
        <Aviso tipo={aviso.tipo} titulo={aviso.tipo === 'erro' ? 'Sem dado no período' : 'Atenção'}>
          {aviso.texto}
        </Aviso>
      )}
      {avisosRender.length > 0 && (
        <Aviso tipo="alerta" titulo="Atenção">
          <ul>
            {avisosRender.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Aviso>
      )}

      <div className="editor">
        <div className="editor-lado">
          <section className="cartao pilha">
            <h2>1. Fazenda e período</h2>
            {lista.length === 0 ? (
              <Aviso tipo="info">Nenhuma fazenda de mapa liberada para você{coa?.nome ? ` em ${coa.nome}` : ''}. Peça a um administrador do COA WEB.</Aviso>
            ) : (
              <label className="campo">
                <span>Fazenda</span>
                <select value={fazendaId} disabled={etapa !== null} onChange={(e) => trocarFazenda(e.target.value)}>
                  <option value="">Escolha…</option>
                  {lista.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {fazenda && !fazenda.unidadePims && (
              <Aviso tipo="alerta">Esta fazenda não tem a unidade do PIMS no cadastro (Fazendas e shapes → Editar): sem ela o servidor não acha os talhões na ZEUS.</Aviso>
            )}
            <div className="linha integracao-periodo">
              <label className="campo">
                <span>De</span>
                <input type="date" value={de} max={ate || undefined} disabled={etapa !== null} onChange={(e) => setDe(e.target.value)} />
              </label>
              <label className="campo">
                <span>Até</span>
                <input type="date" value={ate} max={isoData(new Date())} disabled={etapa !== null} onChange={(e) => setAte(e.target.value)} />
              </label>
              <button
                type="button"
                className="botao botao-primario"
                disabled={!fazenda || etapa !== null || !podeBuscar()}
                title={!podeBuscar() ? 'Só no COA WEB (o servidor busca na ZEUS)' : fazenda ? 'Busca na ZEUS a chuva de cada talhão da fazenda só entre as duas datas' : 'Escolha a fazenda primeiro'}
                onClick={() => void atualizar()}
              >
                {etapa !== null ? 'Buscando…' : 'Atualizar'}
              </button>
            </div>
            {etapa !== null && (
              <p className="suave" aria-live="polite">
                {etapa}
              </p>
            )}
            {periodoMudou && etapa === null && <p className="integracao-aviso">O período mudou: clique em Atualizar para buscar a chuva das novas datas. O mapa ainda mostra o período anterior.</p>}
            <p className="suave">
              Conta os dias desde a última chuva de pelo menos 1 mm até o último dia do período que a ZEUS tem. Talhão sem chuva no período inteiro aparece com “≥” (pode estar há mais tempo sem chuva).
            </p>
            {carregandoTalhoes && <Carregando inline texto="Carregando talhões…" />}
            {setoresDisponiveis.length > 1 && (
              <div className="campo">
                <span>Setores no mapa</span>
                <div className="chips">
                  {setoresDisponiveis.map((s) => {
                    const ativo = !setores || setores.includes(s);
                    return (
                      <button key={s} type="button" className={`chip${ativo ? ' ativo' : ''}`} aria-pressed={ativo} onClick={() => alternarSetor(s, ativo)}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="cartao pilha">
            <h2>2. Dias sem chuva</h2>
            {resumo && resultado?.referencia ? (
              <>
                <table className="tabela tabela-compacta">
                  <thead>
                    <tr>
                      <th>Dias sem chuva</th>
                      <th className="num">Talhões</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CLASSES_SECA.map((c, i) => (
                      <tr key={c.texto}>
                        <td>
                          <span className="amostra-cor" style={{ background: c.cor }} aria-hidden="true" /> {c.texto}
                        </td>
                        <td className="num">{resumo.classes[i] ?? 0}</td>
                      </tr>
                    ))}
                    {resumo.semDado > 0 && (
                      <tr>
                        <td>
                          <span className="amostra-cor" style={{ background: COR_SEM_DADO }} aria-hidden="true" /> {TEXTO_SEM_DADO}
                        </td>
                        <td className="num">{resumo.semDado}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <button type="button" className="botao botao-pequeno" onClick={baixarCsv}>
                  Baixar tabela por talhão (CSV)
                </button>
              </>
            ) : (
              <p className="suave">{dados ? 'Sem dado da ZEUS neste período.' : 'Os dias aparecem aqui depois de Atualizar.'}</p>
            )}
          </section>

          <section className="cartao pilha">
            <h2>3. Textos do layout</h2>
            <PainelTextos
              textos={textos}
              editados={editados}
              onChange={(campo, valor) => setEditados((e) => editarTexto(e, automaticos, campo, valor))}
              onRestaurar={() => setEditados({})}
            />
          </section>

          <section className="cartao pilha">
            <h2>4. Aparência</h2>
            <SecaoAparencia modo="variedade" config={aparencia} onChange={(p) => setAparencia((a) => ({ ...a, ...p }))} paletaAutomatica={null} />
          </section>
        </div>

        <div className="editor-principal">
          <section className="cartao">
            <PreviaLayout
              input={renderInput}
              extent={extentEfetivo}
              automatico={aparencia.extent === null}
              onExtentChange={(ext) => setAparencia((a) => ({ ...a, extent: ext }))}
              ocupado={ocupado ?? etapa}
              onAvisos={setAvisosRender}
              vazio={vazio}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
