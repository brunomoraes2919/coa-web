import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import AtualizarPlantio from '../components/AtualizarPlantio';
import Carregando from '../components/Carregando';
import PreviaLayout from '../components/editor/PreviaLayout';
import PainelTextos from '../components/editor/PainelTextos';
import SecaoFazenda from '../components/editor/SecaoFazenda';
import TabelaVariedades from '../components/editor/TabelaVariedades';
import { SecaoAparencia } from '../components/editor/SecaoAparencia';
import { useCadastros, useLogo } from '../components/editor/hooks';
import { useCoresVariedade } from '../components/editor/useCoresVariedade';
import { useMapaPlantio, useTalhoesEPlantio } from '../components/editor/usePlantioMapa';
import { usePreSelecaoCoa } from '../components/editor/usePreSelecaoCoa';
import '../components/editor/editor.css';
import { aparenciaDoMapaSalvo, layoutPadrao } from '../lib/editor';
import { editarTexto } from '../lib/editorRegras';
import { fazendasDoCoa } from '../lib/embed';
import { baixarArquivo, DPI_OPCOES, DPI_PADRAO, gerarCopiaHistorico, gerarPng, nomeArquivoMapa } from '../lib/exportar';
import { DPI_HISTORICO, identidadeMapa, type ModoSalvar } from '../lib/historico';
import type { LayoutConfig, LayoutTextos, MapaSalvo, Palette } from '../lib/types';
import { coresDasFeicoes, feicoesDoMapa, resumoDoMapaVariedade, resumoVariedades, textosAutomaticosVariedade } from '../lib/variedades';
import { composicaoDe, extentsDosQuadros, TILES, type RenderInput } from '../render';

type Aparencia = Omit<LayoutConfig, 'textos'>;
/** o mapa de variedade não usa escala de cores de chuva */
const PALETA_VAZIA: Palette = { id: 'variedade', nome: 'Variedade', classes: [] };
const SEM_SITUACAO = new Map();

/** Novo mapa de variedade (e mapa de variedade salvo, em /variedades/:id). */
export default function NovoMapaVariedade() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fazendas, safras, erro: erroCadastros } = useCadastros();
  const [fazendaId, setFazendaId] = useState('');
  const [safraId, setSafraId] = useState('');
  const [setores, setSetores] = useState<string[] | null>(null);
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
  const logo = useLogo();

  const fazenda = fazendas?.find((f) => f.id === fazendaId) ?? null;
  const safra = safras.find((s) => s.id === safraId) ?? null;
  const plantio = useTalhoesEPlantio(fazendaId, safraId, fazenda, safra);
  const { talhoes, carregando, erro: erroTalhoes } = plantio;
  const { setoresDisponiveis, talhoesUsados, areasUsadas, situacao: sitPlantio } = useMapaPlantio(plantio, setores);

  // Reabrir um mapa de variedade salvo (/variedades/:id); um de chuva vai para /mapas/:id
  useEffect(() => {
    if (!id || abertoRef.current === id) return;
    let ativo = true;
    repo()
      .obterMapa(id)
      .then((m) => {
        if (!ativo) return;
        if (!m) return setErro('Mapa não encontrado no histórico.');
        if (m.tipo !== 'variedade') return navigate(`/mapas/${m.id}`, { replace: true });
        abertoRef.current = m.id;
        setMapaAtual(m);
        setFazendaId(m.fazendaId);
        setSafraId(m.safraId ?? '');
        setSetores(m.config.setores ?? null);
        setAparencia(aparenciaDoMapaSalvo(m.config));
        setEditados(m.config.textosEditados ?? m.config.textos);
      })
      .catch((e) => ativo && setErro(`Não foi possível abrir o mapa: ${mensagemDeErro(e)}`));
    return () => {
      ativo = false;
    };
  }, [id, navigate]);

  const feicoes = useMemo(() => feicoesDoMapa(talhoesUsados, areasUsadas, plantio.efetivos, plantio.pims), [talhoesUsados, areasUsadas, plantio.efetivos, plantio.pims]);
  const fixas = mapaAtual?.config.coresVariedade ?? null;
  const { cores, aviso: avisoCores } = useCoresVariedade(feicoes, fixas);
  const resumo = useMemo(() => (cores ? resumoVariedades(feicoes, cores) : null), [feicoes, cores]);

  const automaticos = useMemo(
    () => textosAutomaticosVariedade({ fazenda: fazenda?.nome ?? '', safra, setores, hoje: new Date() }),
    [fazenda, safra, setores],
  );
  const textos: LayoutTextos = { ...automaticos, ...editados };

  const renderInput: RenderInput | null = useMemo(() => {
    // mapa de variedade = fazenda e safra (sem safra não há plantio do PIMS: tudo sairia "Sem variedade")
    if (!safraId || !talhoesUsados.length || !resumo) return null;
    const usadas = Object.fromEntries(resumo.itens.filter((i) => i.chave).map((i) => [i.chave, i.cor]));
    return {
      config: { ...aparencia, textos, setores, textosEditados: editados, coresVariedade: usadas },
      palette: PALETA_VAZIA,
      grid: null,
      talhoes: talhoesUsados,
      situacoes: SEM_SITUACAO,
      areasCultura: areasUsadas,
      plantioGeradoEm: plantio.geradoEm,
      resumo: null,
      nomeSafra: safra?.nome ?? '',
      pics: [],
      logo,
      tiles: aparencia.mapaBase === 'nenhum' ? null : TILES[aparencia.mapaBase],
      variedades: { cores: coresDasFeicoes(feicoes, resumo), resumo },
    };
    // textos é derivado de automaticos + editados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aparencia, automaticos, editados, setores, safraId, talhoesUsados, areasUsadas, plantio.geradoEm, safra, logo, feicoes, resumo]);

  const extentEfetivo = useMemo(() => {
    if (!renderInput) return null;
    const comp = composicaoDe(renderInput);
    return comp.quadros.length === 1 ? extentsDosQuadros(renderInput, comp)[0] : null;
  }, [renderInput]);

  const trocarFazenda = (idF: string) => {
    setFazendaId(idF);
    setSetores(null);
    setAparencia((a) => ({ ...a, extent: null }));
  };
  const coa = usePreSelecaoCoa(fazendas, fazendaId, !id, trocarFazenda);
  const trocarSetores = (novos: string[] | null) => {
    setSetores(novos);
    setAparencia((a) => ({ ...a, extent: null }));
  };

  const nomeArquivo = nomeArquivoMapa(textos.fazenda || 'fazenda', textos.safra, 'png', 'MAPA_VARIEDADE');

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

  const salvar = async (modo: ModoSalvar) => {
    if (!renderInput || !resumo || !fazenda) return;
    setErro(null);
    setOcupado('Salvando no histórico…');
    try {
      const { imagem, miniatura, avisos } = await gerarCopiaHistorico(renderInput, DPI_HISTORICO);
      setAvisosRender(avisos);
      const m: MapaSalvo = {
        ...identidadeMapa(modo, mapaAtual, new Date(), () => crypto.randomUUID()),
        tipo: 'variedade',
        fazendaId: fazenda.id,
        safraId: safra?.id ?? null,
        titulo: `${fazenda.nome} · ${textos.safra || 'sem safra'}`,
        periodoInicio: null,
        periodoFim: null,
        config: renderInput.config,
        pics: [],
        resumo: resumoDoMapaVariedade(resumo),
        pngPath: null,
        thumbPath: null,
      };
      const salvo = await repo().salvarMapa(m, imagem, miniatura);
      const copia = !!mapaAtual && salvo.id !== mapaAtual.id;
      abertoRef.current = salvo.id;
      setMapaAtual(salvo);
      const msg = copia ? 'Salvo como um novo mapa no histórico (o anterior continua lá).' : mapaAtual ? 'Mapa atualizado no histórico.' : 'Mapa salvo no histórico.';
      setSucesso(msg);
      if (!id) navigate(`/variedades/${salvo.id}`, { replace: true, state: { msg } });
      else if (copia) navigate(`/variedades/${salvo.id}`);
    } catch (e) {
      setErro(`Não foi possível salvar: ${mensagemDeErro(e)}`);
    } finally {
      setOcupado(null);
    }
  };

  if (!fazendas) return <Carregando texto="Carregando cadastros…" />;

  const pronto = !!renderInput && !ocupado;
  const dicaBotoes = pronto ? undefined : ocupado ? 'Aguarde terminar' : 'Escolha a fazenda e a safra';
  const avisos = [...(avisoCores ? [avisoCores] : []), ...avisosRender];

  return (
    <div className="pagina pagina-editor">
      <AtualizarPlantio />
      <div className="pagina-cabecalho">
        <div>
          <h1>{id ? 'Editar mapa de variedade' : 'Novo mapa de variedade'}</h1>
          <p className="subtitulo">Plantio do PIMS → cada talhão na cor da sua variedade → layout COA em PNG</p>
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

      {[erroCadastros, erroTalhoes, erro].filter(Boolean).map((m, i) => (
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
            fazendas={fazendasDoCoa(fazendas, coa, fazendaId)}
            coa={coa}
            safras={safras}
            fazendaId={fazendaId}
            safraId={safraId}
            onFazenda={trocarFazenda}
            onSafra={setSafraId}
            carregando={carregando}
            totalTalhoes={talhoes.length}
            plantio={{ ...plantio, contagem: sitPlantio.contagem, usaAreas: areasUsadas.length > 0 }}
            setoresDisponiveis={setoresDisponiveis}
            setores={setores}
            onSetores={trocarSetores}
            modo="variedade"
          />

          <section className="cartao pilha">
            <h2>2. Variedades</h2>
            {fazendaId && safraId && resumo ? (
              <TabelaVariedades resumo={resumo} feicoes={feicoes} nomeArquivo={nomeArquivo.replace(/\.png$/, '_TALHOES.csv')} geradoEm={plantio.geradoEm} />
            ) : (
              <p className="suave">{fazendaId && safraId ? 'Lendo as cores das variedades…' : 'Escolha a fazenda e a safra.'}</p>
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
              ocupado={ocupado}
              onAvisos={setAvisosRender}
              vazio="Escolha a fazenda e a safra para ver o mapa."
            />
          </section>
        </div>
      </div>
    </div>
  );
}
