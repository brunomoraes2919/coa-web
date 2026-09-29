import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import PreviaLayout from '../components/editor/PreviaLayout';
import TabelaTalhoes from '../components/editor/TabelaTalhoes';
import PainelTextos from '../components/editor/PainelTextos';
import SecaoFazenda from '../components/editor/SecaoFazenda';
import SecaoCsv, { type CsvInfo } from '../components/editor/SecaoCsv';
import { SecaoAparencia, SecaoAvancado } from '../components/editor/SecaoAparencia';
import { useCadastros, useInterpolacao, useLogo } from '../components/editor/hooks';
import { useMapaPlantio, useTalhoesEPlantio } from '../components/editor/usePlantioMapa';
import { usePreSelecaoCoa } from '../components/editor/usePreSelecaoCoa';
import '../components/editor/editor.css';
import { aparenciaDoMapaSalvo, avisosPeriodoSafra, avisosPicsDistantes, layoutPadrao, textosAutomaticos } from '../lib/editor';
import { editarTexto } from '../lib/editorRegras';
import { baixarArquivo, DPI_OPCOES, DPI_PADRAO, gerarCopiaHistorico, gerarPng, nomeArquivoMapa } from '../lib/exportar';
import { DPI_HISTORICO, identidadeMapa, type ModoSalvar } from '../lib/historico';
import { isoData, parseIsoData } from '../lib/format';
import { resolvePalette } from '../lib/palettes';
import { decodeCsvBuffer, parseZeusCsv } from '../lib/zeusCsv';
import type { LayoutConfig, LayoutTextos, MapaSalvo, Pic } from '../lib/types';
import { composicaoDe, extentsDosQuadros, TILES, type RenderInput } from '../render';

type Aparencia = Omit<LayoutConfig, 'textos'>;

export default function NovoMapa() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fazendas, safras, erro: erroCadastros } = useCadastros();
  const [fazendaId, setFazendaId] = useState('');
  const [safraId, setSafraId] = useState('');
  const [setores, setSetores] = useState<string[] | null>(null);
  const [csv, setCsv] = useState<CsvInfo | null>(null);
  const [pics, setPics] = useState<Pic[]>([]);
  const [aparencia, setAparencia] = useState<Aparencia>(() => {
    const { textos: _t, ...resto } = layoutPadrao();
    return resto;
  });
  const [editados, setEditados] = useState<Partial<LayoutTextos>>({});
  const [dpi, setDpi] = useState<number>(DPI_PADRAO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>((location.state as { msg?: string } | null)?.msg ?? null);
  const [avisosRender, setAvisosRender] = useState<string[]>([]);
  const [mapaAtual, setMapaAtual] = useState<MapaSalvo | null>(null);
  /** id do mapa já carregado nesta tela (evita reler do banco o mapa que acabou de ser salvo) */
  const abertoRef = useRef<string | null>(null);
  const logo = useLogo();

  const fazenda = fazendas?.find((f) => f.id === fazendaId) ?? null;
  const safra = safras.find((s) => s.id === safraId) ?? null;
  const plantio = useTalhoesEPlantio(fazendaId, safraId, fazenda, safra);
  const { talhoes, carregando, erro: erroTalhoes } = plantio;
  // máscara da interpolação = talhões base ∪ áreas da cultura (as sem talhão base entram como linhas próprias)
  const { setoresDisponiveis, talhoesUsados, areasUsadas, talhoesInterp, situacao: sitPlantio } = useMapaPlantio(plantio, setores);
  const interp = useInterpolacao(talhoesInterp, pics, aparencia.idw, sitPlantio.plantadosBase, areasUsadas, sitPlantio.plantadosAreas);
  /** último resultado (prévia) e o das entradas atuais (exportar, salvar, PICs fora da área) */
  const { resultado, resultadoAtual, situacao } = interp;

  // Reabrir um mapa salvo (/mapas/:id)
  useEffect(() => {
    if (!id || abertoRef.current === id) return;
    let ativo = true;
    repo()
      .obterMapa(id)
      .then((m) => {
        if (!ativo) return;
        if (!m) return setErro('Mapa não encontrado no histórico.');
        abertoRef.current = m.id;
        setMapaAtual(m);
        setFazendaId(m.fazendaId);
        setSafraId(m.safraId ?? '');
        setSetores(m.config.setores ?? null);
        setPics(m.pics);
        setCsv({ nome: m.config.nomeCsv ?? 'CSV salvo', inicio: parseIsoData(m.periodoInicio), fim: parseIsoData(m.periodoFim), avisos: [] });
        setAparencia(aparenciaDoMapaSalvo(m.config));
        setEditados(m.config.textosEditados ?? m.config.textos);
      })
      .catch((e) => ativo && setErro(`Não foi possível abrir o mapa: ${mensagemDeErro(e)}`));
    return () => {
      ativo = false;
    };
  }, [id]);

  const automaticos = useMemo(
    () =>
      textosAutomaticos({
        fazenda: fazenda?.nome ?? '',
        safra,
        periodoInicio: csv?.inicio ?? null,
        periodoFim: csv?.fim ?? null,
        setores,
        hoje: new Date(),
      }),
    [fazenda, safra, csv, setores],
  );
  const textos: LayoutTextos = { ...automaticos, ...editados };

  const maxChuva = resultado?.resumo.geral.max ?? NaN;
  const paleta = useMemo(() => resolvePalette(aparencia.paletaId, maxChuva), [aparencia.paletaId, maxChuva]);
  const picsIncluidos = useMemo(() => pics.filter((p) => p.incluir && p.chuva !== null), [pics]);
  /** índices (na lista completa de PICs) dos que ficaram fora da área do mapa e não entram no IDW, como no QGIS */
  const foraDaRegiao = useMemo(() => {
    const ign = resultadoAtual?.picsIgnorados ?? [];
    if (!ign.length) return new Set<number>();
    const idx = pics.flatMap((p, i) => (p.incluir && p.chuva !== null ? [i] : []));
    return new Set(ign.map((k) => idx[k]).filter((i) => i !== undefined));
  }, [resultadoAtual, pics]);

  const renderInput: RenderInput | null = useMemo(() => {
    if (!talhoesInterp.length) return null;
    return {
      // extent null = automático: o render enquadra cada quadro no retângulo da composição (paisagem/retrato)
      config: { ...aparencia, extent: aparencia.extent, textos, setores, nomeCsv: csv?.nome, textosEditados: editados },
      palette: paleta,
      grid: resultado?.grid ?? null,
      talhoes: talhoesUsados,
      situacoes: sitPlantio.situacoes,
      areasCultura: areasUsadas,
      plantioGeradoEm: plantio.geradoEm,
      resumo: resultado?.resumo ?? null,
      nomeSafra: safra?.nome ?? '',
      pics: picsIncluidos,
      logo,
      tiles: aparencia.mapaBase === 'nenhum' ? null : TILES[aparencia.mapaBase],
    };
    // textos é derivado de automaticos + editados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aparencia, automaticos, editados, setores, csv, paleta, resultado, talhoesUsados, talhoesInterp, sitPlantio, areasUsadas, plantio.geradoEm, safra, picsIncluidos, logo]);

  /**
   * Base do arraste/zoom da prévia: com um quadro, o enquadramento que o render usa (o manual, ou o
   * automático no retângulo do quadro da composição); com vários quadros não há pan/zoom (null).
   */
  const extentEfetivo = useMemo(() => {
    if (!renderInput) return null;
    const comp = composicaoDe(renderInput);
    return comp.quadros.length === 1 ? extentsDosQuadros(renderInput, comp)[0] : null;
  }, [renderInput]);

  const avisos = useMemo(
    () => [
      ...(csv?.avisos ?? []),
      ...avisosPicsDistantes(pics, talhoesInterp),
      ...avisosPeriodoSafra(csv?.inicio ?? null, csv?.fim ?? null, safra),
      ...(foraDaRegiao.size
        ? [
            `${foraDaRegiao.size === 1 ? '1 PIC está fora' : `${foraDaRegiao.size} PICs estão fora`} da área do mapa e não entra${foraDaRegiao.size === 1 ? '' : 'm'} na interpolação (mesmo comportamento do QGIS).`,
          ]
        : []),
      ...avisosRender,
    ],
    [csv, pics, talhoesInterp, safra, foraDaRegiao, avisosRender],
  );

  const trocarFazenda = (idF: string) => {
    setFazendaId(idF);
    setSetores(null);
    setAparencia((a) => ({ ...a, extent: null }));
  };
  // novo mapa sem CSV: segue a fazenda do topo do COA WEB até o usuário escolher uma à mão
  const escolheuFazenda = usePreSelecaoCoa(fazendas, fazendaId, !id && !csv, trocarFazenda);
  const trocarSetores = (novos: string[] | null) => {
    setSetores(novos);
    setAparencia((a) => ({ ...a, extent: null }));
  };

  const lerCsv = async (arquivo: File) => {
    setErro(null);
    try {
      const r = parseZeusCsv(decodeCsvBuffer(await arquivo.arrayBuffer()));
      setPics(r.pics);
      setCsv({ nome: arquivo.name, inicio: r.periodoInicio, fim: r.periodoFim, avisos: r.avisos });
    } catch (e) {
      setErro(`Não foi possível ler o CSV: ${mensagemDeErro(e)}`);
    }
  };

  const nomeArquivo = nomeArquivoMapa(textos.fazenda || 'fazenda', textos.periodo);

  const baixar = async () => {
    if (!renderInput || !resultadoAtual) return;
    setErro(null);
    setOcupado(`Gerando PNG em ${dpi} dpi…`);
    try {
      const { blob, avisos: av } = await gerarPng(renderInput, dpi);
      setAvisosRender(av);
      baixarArquivo(blob, nomeArquivo);
    } catch (e) {
      setErro(`Falha ao gerar o PNG: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  /** "atualizar" regrava o mapa aberto; "novo" guarda outro registro (o aberto continua no histórico). */
  const salvar = async (modo: ModoSalvar) => {
    // tudo capturado agora: PICs, parâmetros e resumo são da mesma interpolação (atualizada)
    const r = resultadoAtual;
    if (!renderInput || !r || !fazenda) return;
    setErro(null);
    setOcupado('Salvando no histórico…');
    try {
      // a cópia do histórico é sempre JPEG em 150 dpi (≈ 1 MB), com a miniatura PNG tirada do mesmo desenho
      const { imagem, miniatura, avisos: av } = await gerarCopiaHistorico(renderInput, DPI_HISTORICO);
      setAvisosRender(av);
      const m: MapaSalvo = {
        ...identidadeMapa(modo, mapaAtual, new Date(), () => crypto.randomUUID()),
        fazendaId: fazenda.id,
        safraId: safra?.id ?? null,
        titulo: `${fazenda.nome} · ${textos.periodo || 'sem período'}`,
        periodoInicio: csv?.inicio ? isoData(csv.inicio) : null,
        periodoFim: csv?.fim ? isoData(csv.fim) : null,
        config: renderInput.config,
        pics,
        resumo: r.resumo,
        pngPath: null,
        thumbPath: null,
      };
      const salvo = await repo().salvarMapa(m, imagem, miniatura);
      const copia = !!mapaAtual && salvo.id !== mapaAtual.id;
      abertoRef.current = salvo.id;
      setMapaAtual(salvo);
      const msg = copia ? 'Salvo como um novo mapa no histórico (o anterior continua lá).' : mapaAtual ? 'Mapa atualizado no histórico.' : 'Mapa salvo no histórico.';
      setSucesso(msg);
      if (!id) navigate(`/mapas/${salvo.id}`, { replace: true, state: { msg } });
      else if (copia) navigate(`/mapas/${salvo.id}`);
    } catch (e) {
      setErro(`Não foi possível salvar: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  if (!fazendas) return <Carregando texto="Carregando cadastros…" />;

  const progressoTexto =
    interp.progresso !== null ? `Interpolando… ${Math.round(interp.progresso * 100)}%` : situacao === 'pendente' ? 'Interpolando…' : null;
  const pronto = !!renderInput && !!resultadoAtual && !ocupado;
  const aguardando = !!renderInput && situacao === 'pendente';
  const dicaBotoes = pronto
    ? undefined
    : ocupado
      ? 'Aguarde terminar'
      : aguardando
        ? 'Aguarde a interpolação terminar'
        : situacao === 'erro'
          ? 'A interpolação falhou: veja a mensagem acima'
          : 'Escolha a fazenda e carregue o CSV da ZEUS';

  return (
    <div className="pagina pagina-editor">
      <div className="pagina-cabecalho">
        <div>
          <h1>{id ? 'Editar mapa' : 'Novo mapa de chuva'}</h1>
          <p className="subtitulo">CSV da ZEUS → interpolação IDW (mesmo modelo do QGIS) → layout COA em PNG</p>
        </div>
        <div className="linha">
          {aguardando && !ocupado && <span className="suave">Aguarde a interpolação terminar…</span>}
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
              <button
                type="button"
                className="botao"
                disabled={!pronto || !mapaAtual}
                title={dicaBotoes ?? 'Regrava este mapa no histórico (mantém a data de criação)'}
                onClick={() => void salvar('atualizar')}
              >
                Atualizar este mapa
              </button>
              <button
                type="button"
                className="botao"
                disabled={!pronto}
                title={dicaBotoes ?? 'Guarda como outro mapa; este continua no histórico como está'}
                onClick={() => void salvar('novo')}
              >
                Salvar como novo
              </button>
            </>
          ) : (
            <button type="button" className="botao" disabled={!pronto} title={dicaBotoes} onClick={() => void salvar('novo')}>
              Salvar no histórico
            </button>
          )}
          <button type="button" className="botao botao-primario" disabled={!pronto} title={dicaBotoes} onClick={baixar}>
            Baixar PNG
          </button>
        </div>
      </div>

      {[erroCadastros, erroTalhoes, erro, interp.erro].filter(Boolean).map((m, i) => (
        <Aviso key={i} tipo="erro">
          {m}
        </Aviso>
      ))}
      {sucesso && (
        <Aviso tipo="sucesso" onFechar={() => setSucesso(null)}>
          {sucesso}
        </Aviso>
      )}
      {avisos.length > 0 && (
        <Aviso tipo="alerta" titulo="Atenção">
          <ul>
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Aviso>
      )}

      <div className="editor">
        <div className="editor-lado">
          <SecaoFazenda
            fazendas={fazendas}
            safras={safras}
            fazendaId={fazendaId}
            safraId={safraId}
            onFazenda={(idF) => {
              escolheuFazenda();
              trocarFazenda(idF);
            }}
            onSafra={setSafraId}
            carregando={carregando}
            totalTalhoes={talhoes.length}
            plantio={{ ...plantio, contagem: sitPlantio.contagem, usaAreas: areasUsadas.length > 0 }}
            setoresDisponiveis={setoresDisponiveis}
            setores={setores}
            onSetores={trocarSetores}
          />

          <SecaoCsv csv={csv} onArquivo={(f) => void lerCsv(f)} pics={pics} onPics={setPics} foraDaRegiao={foraDaRegiao} />

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
            <SecaoAparencia
              config={aparencia}
              onChange={(p) => setAparencia((a) => ({ ...a, ...p }))}
              paletaAutomatica={aparencia.paletaId === 'auto' && resultado ? paleta.nome : null}
            />
          </section>

          <details className="cartao">
            <summary>
              <strong>Avançado: parâmetros da interpolação</strong>
            </summary>
            <SecaoAvancado idw={aparencia.idw} onChange={(idw) => setAparencia((a) => ({ ...a, idw }))} />
          </details>
        </div>

        <div className="editor-principal">
          <section className="cartao">
            <PreviaLayout
              input={renderInput}
              extent={extentEfetivo}
              onExtentChange={(ext) => setAparencia((a) => ({ ...a, extent: ext }))}
              ocupado={ocupado ?? progressoTexto}
              onAvisos={setAvisosRender}
            />
          </section>
          {resultado && (
            <section className="cartao pilha">
              <h2>Chuva por talhão</h2>
              <TabelaTalhoes
                resumo={resultado.resumo}
                nomeSafra={safra?.nome ?? ''}
                nomeArquivo={nomeArquivo.replace(/\.png$/, '_TALHOES.csv')}
                desatualizado={!resultadoAtual}
                situacoes={sitPlantio.porTalhao}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
