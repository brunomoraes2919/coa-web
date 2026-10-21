import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import PreviaLayout from '../components/editor/PreviaLayout';
import PainelTextos from '../components/editor/PainelTextos';
import { SecaoAparencia } from '../components/editor/SecaoAparencia';
import { useCadastros, useLogo } from '../components/editor/hooks';
import { usePreSelecaoCoa } from '../components/editor/usePreSelecaoCoa';
import '../components/editor/editor.css';
import { codigosEucalipto, csvQuadroCar, dadosValidos, fmtHa, quadroDoCar, textosAutomaticosCar, usoDoTalhao } from '../lib/car';
import { layoutPadrao } from '../lib/editor';
import { editarTexto } from '../lib/editorRegras';
import { fazendasDoCoa } from '../lib/embed';
import { baixarArquivo, DPI_OPCOES, DPI_PADRAO, gerarPng, nomeArquivoMapa } from '../lib/exportar';
import { fmtDataHora } from '../lib/situacaoPlantio';
import type { LayoutConfig, LayoutTextos, NomeFonteCar, Palette, RegistroCar, Talhao } from '../lib/types';
import { autoExtent, composicaoDe, extentsDosQuadros, TILES, type RenderInput } from '../render';

type Aparencia = Omit<LayoutConfig, 'textos'>;
const PALETA_VAZIA: Palette = { id: 'car', nome: 'CAR', classes: [] };
const SEM_SITUACAO = new Map();
const NOME_FONTE: Record<NomeFonteCar, string> = {
  sicar: 'SICAR · limite do CAR',
  temas: 'SICAR · reserva legal, APP, vegetação',
  sigef: 'INCRA SIGEF · matrículas certificadas',
  ibge: 'IBGE · rodovias e rios',
  osm: 'OpenStreetMap · estradas e córregos',
  pims: 'PIMS · talhões de eucalipto',
};
/** espera entre as consultas da situação do pedido e o prazo total (as bases públicas podem levar 2 a 3 min) */
const INTERVALO_MS = 4000;
const PRAZO_MS = 6 * 60_000;

/** Mapa de CAR e Matrícula (só ADMINISTRADOR+): limites do CAR e das matrículas, temas declarados, estradas e áreas. */
export default function MapaCar() {
  const { fazendas, erro: erroCadastros } = useCadastros();
  const [fazendaId, setFazendaId] = useState('');
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [registro, setRegistro] = useState<RegistroCar | null | undefined>(undefined);
  const [lendo, setLendo] = useState(false);
  const [buscando, setBuscando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aparencia, setAparencia] = useState<Aparencia>(() => {
    const { textos: _t, ...resto } = layoutPadrao();
    return { ...resto, quadros: 1, mostrarValoresPics: false, mostrarGrade: false, mapaBase: 'nenhum' };
  });
  const [editados, setEditados] = useState<Partial<LayoutTextos>>({});
  const [dpi, setDpi] = useState<number>(DPI_PADRAO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [avisosRender, setAvisosRender] = useState<string[]>([]);
  const versao = useRef(0);
  const logo = useLogo();
  const fazenda = fazendas?.find((f) => f.id === fazendaId) ?? null;

  const trocarFazenda = (id: string) => {
    setFazendaId(id);
    setAparencia((a) => ({ ...a, extent: null }));
    setEditados({});
    setSucesso(null);
  };
  const coa = usePreSelecaoCoa(fazendas, fazendaId, true, trocarFazenda);

  // talhões e o último resultado da fazenda
  useEffect(() => {
    const v = ++versao.current;
    setTalhoes([]);
    setRegistro(undefined);
    setErro(null);
    if (!fazendaId) return;
    setLendo(true);
    Promise.all([repo().obterTalhoes(fazendaId), repo().obterCar(fazendaId)])
      .then(([t, r]) => {
        if (v !== versao.current) return;
        setTalhoes(t);
        setRegistro(r);
      })
      .catch((e) => v === versao.current && (setErro(mensagemDeErro(e)), setRegistro(null)))
      .finally(() => v === versao.current && setLendo(false));
  }, [fazendaId]);

  const validos = useMemo(() => (registro ? dadosValidos(registro.dados) : null), [registro]);
  const quadro = useMemo(() => (validos ? quadroDoCar(validos.dados, talhoes) : null), [validos, talhoes]);
  const usoTalhao = useMemo(() => {
    const euc = registro ? codigosEucalipto(registro.dados) : new Set<string>();
    return new Map(talhoes.map((t) => [t.id, usoDoTalhao(t, euc)] as const));
  }, [registro, talhoes]);

  const automaticos = useMemo(() => textosAutomaticosCar({ fazenda: fazenda?.nome ?? '', fontes: registro?.fontes ?? {}, hoje: new Date() }), [fazenda, registro]);
  const textos: LayoutTextos = { ...automaticos, ...editados };

  // enquadramento automático: os talhões e os CARs e matrículas que são da fazenda (≥ 10% da área em talhões)
  const extentAuto = useMemo(() => {
    if (!validos || !quadro || !talhoes.length) return null;
    const daFazenda = (tipo: 'car' | 'matricula') =>
      quadro.linhas
        .filter((l) => l.tipo === tipo && l.areaHa > 0 && (l.agricolaHa + l.eucaliptoHa) / l.areaHa >= 0.1)
        .map((l) => (tipo === 'car' ? validos.dados.car : validos.dados.matriculas).features[l.indice])
        .filter((f): f is Feature => !!f && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'));
    const extras = [...daFazenda('car'), ...daFazenda('matricula')].map((f, i) => ({ ...talhoes[0], id: `extra-${i}`, geom: f.geometry as Polygon | MultiPolygon }));
    const comp = composicaoDe({ talhoes, config: { ...aparencia, textos } as LayoutConfig });
    return autoExtent([...talhoes, ...extras], comp.quadros[0]?.rect);
    // textos não mudam a composição
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validos, quadro, talhoes, aparencia.orientacao, aparencia.pagina]);

  const renderInput: RenderInput | null = useMemo(() => {
    if (!validos || !quadro || !talhoes.length) return null;
    return {
      config: { ...aparencia, quadros: 1, extent: aparencia.extent ?? extentAuto, textos },
      palette: PALETA_VAZIA,
      grid: null,
      talhoes,
      situacoes: SEM_SITUACAO,
      areasCultura: [],
      plantioGeradoEm: null,
      resumo: null,
      nomeSafra: '',
      pics: [],
      logo,
      tiles: aparencia.mapaBase === 'nenhum' ? null : TILES[aparencia.mapaBase],
      car: { dados: validos.dados, quadro, usoTalhao },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aparencia, automaticos, editados, talhoes, validos, quadro, usoTalhao, logo, extentAuto]);

  const extentEfetivo = useMemo(() => (renderInput ? extentsDosQuadros(renderInput, composicaoDe(renderInput))[0] : null), [renderInput]);
  const nomeArquivo = nomeArquivoMapa(textos.fazenda || 'fazenda', '', 'png', 'MAPA_CAR_MATRICULA');

  const buscar = async () => {
    if (!fazendaId) return;
    setErro(null);
    setSucesso(null);
    setBuscando('Pedido enviado ao servidor…');
    try {
      const id = await repo().pedirBuscaCar(fazendaId);
      const inicio = Date.now();
      for (;;) {
        await new Promise((ok) => setTimeout(ok, INTERVALO_MS));
        const s = await repo().situacaoPedidoCar(id);
        const seg = Math.round((Date.now() - inicio) / 1000);
        if (s?.atendidoEm) {
          if (s.resultado && s.resultado !== 'ok') throw new Error(s.resultado.replace(/^erro:\s*/, ''));
          break;
        }
        if (Date.now() - inicio > PRAZO_MS) throw new Error('O servidor não terminou a busca em 6 minutos. As bases públicas podem estar lentas: tente de novo mais tarde.');
        setBuscando(`Consultando SICAR, SIGEF, IBGE e OpenStreetMap… ${seg} s`);
      }
      const r = await repo().obterCar(fazendaId);
      setRegistro(r);
      setAparencia((a) => ({ ...a, extent: null }));
      setSucesso('Bases consultadas. O mapa e o quadro de áreas foram atualizados.');
    } catch (e) {
      setErro(`Não foi possível buscar nas bases: ${mensagemDeErro(e)}`);
    } finally {
      setBuscando(null);
    }
  };

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
    if (!quadro) return;
    baixarArquivo(new Blob(['﻿' + csvQuadroCar(quadro)], { type: 'text/csv;charset=utf-8' }), nomeArquivo.replace(/\.png$/, '_AREAS.csv'));
  };

  if (!fazendas) return <Carregando texto="Carregando cadastros…" />;

  const pronto = !!renderInput && !ocupado && !buscando;
  const fontes = registro?.fontes ?? {};
  const comFalha = (Object.keys(NOME_FONTE) as NomeFonteCar[]).filter((k) => fontes[k] && !fontes[k]!.ok);
  const linhasCar = quadro?.linhas.filter((l) => l.tipo === 'car') ?? [];
  const linhasMat = quadro?.linhas.filter((l) => l.tipo === 'matricula') ?? [];
  const temEuc = !!quadro?.linhas.some((l) => l.eucaliptoHa >= 0.05);

  return (
    <div className="pagina pagina-editor">
      <div className="pagina-cabecalho">
        <div>
          <h1>Mapa de CAR e Matrícula</h1>
          <p className="subtitulo">Limites do CAR e das matrículas sobre os talhões, com reserva legal, APP, água e estradas, buscados nas bases públicas.</p>
        </div>
        <div className="linha">
          <label className="linha" title="Resolução do PNG baixado">
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="Resolução do PNG baixado">
              {DPI_OPCOES.map((d) => (
                <option key={d} value={d}>
                  {d} dpi{d === DPI_PADRAO ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="botao botao-primario" disabled={!pronto} onClick={() => void baixar()}>
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
      {comFalha.length > 0 && (
        <Aviso tipo="alerta" titulo={comFalha.length === 1 ? 'Uma base não respondeu na última busca' : `${comFalha.length} bases não responderam na última busca`}>
          <p>
            {comFalha.map((k) => `${NOME_FONTE[k]} (${fontes[k]!.erro ?? 'indisponível'})`).join('; ')}. O mapa sai sem essas camadas; busque de novo mais tarde.
          </p>
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
            <h2>1. Fazenda</h2>
            <label className="campo">
              <span>Fazenda</span>
              <select value={fazendaId} onChange={(e) => trocarFazenda(e.target.value)}>
                <option value="">Escolha…</option>
                {fazendasDoCoa(fazendas, coa, fazendaId).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </label>
            {fazendaId && !lendo && !talhoes.length && <p className="suave">Esta fazenda não tem talhões desenhados. Cadastre o shape em Fazendas e shapes.</p>}
            {lendo && <p className="suave">Lendo os talhões e a última busca…</p>}
          </section>

          <section className="cartao pilha">
            <h2>2. Bases públicas</h2>
            {!fazendaId ? (
              <p className="suave">Escolha a fazenda.</p>
            ) : (
              <>
                <p className="suave">
                  {registro
                    ? `Última busca em ${fmtDataHora(registro.atualizadoEm)}.`
                    : registro === null
                      ? 'Esta fazenda ainda não foi buscada nas bases.'
                      : 'Lendo…'}
                  {validos && validos.cancelados > 0 ? ` ${validos.cancelados} ${validos.cancelados === 1 ? 'CAR cancelado ficou' : 'CARs cancelados ficaram'} de fora.` : ''}
                </p>
                {registro && (
                  <ul className="lista-fontes-car">
                    {(Object.keys(NOME_FONTE) as NomeFonteCar[]).map((k) => {
                      const f = fontes[k];
                      return (
                        <li key={k} className={f ? (f.ok ? 'ok' : 'falha') : 'sem'}>
                          <span>{NOME_FONTE[k]}</span>
                          <b>{!f ? '—' : f.ok ? `${f.n}` : 'falhou'}</b>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="linha">
                  <button type="button" className="botao" disabled={!!buscando || !talhoes.length || !repo().podeBuscarCar} onClick={() => void buscar()} title={repo().podeBuscarCar ? undefined : 'Só funciona no COA WEB'}>
                    {registro ? 'Buscar de novo nas bases' : 'Buscar nas bases'}
                  </button>
                  {buscando && <span className="suave" role="status">{buscando}</span>}
                </div>
              </>
            )}
          </section>

          <section className="cartao pilha">
            <h2>3. Áreas por CAR e matrícula</h2>
            {!quadro ? (
              <p className="suave">{fazendaId ? 'O quadro aparece depois da busca nas bases.' : 'Escolha a fazenda.'}</p>
            ) : (
              <>
                <div className="tabela-rolagem">
                  <table className="tabela tabela-car">
                    <thead>
                      <tr>
                        <th />
                        <th className="num">Área</th>
                        <th className="num">Agríc.</th>
                        {temEuc && <th className="num">Euc.</th>}
                        <th className="num" title="Área consolidada declarada no CAR, fora dos talhões">Pec.*</th>
                        <th className="num">RL</th>
                        <th className="num">APP</th>
                        <th className="num">Veg.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[linhasCar, linhasMat].map((grupo, g) =>
                        grupo.map((l, i) => (
                          <tr key={`${l.tipo}-${l.indice}`} className={g === 1 && i === 0 ? 'inicio-grupo' : undefined}>
                            <td className={`rotulo-${l.tipo}`} title={l.id}>
                              {l.rotulo}
                              {l.status && l.tipo === 'car' && l.status !== 'AT' ? <small> {l.status === 'PE' ? 'pendente' : l.status === 'SU' ? 'suspenso' : l.status}</small> : null}
                            </td>
                            <td className="num">{fmtHa(l.areaHa)}</td>
                            <td className="num">{fmtHa(l.agricolaHa)}</td>
                            {temEuc && <td className="num">{fmtHa(l.eucaliptoHa)}</td>}
                            <td className="num">{fmtHa(l.pecuariaHa)}</td>
                            <td className="num">{fmtHa(l.reservaLegalHa)}</td>
                            <td className="num">{fmtHa(l.appHa)}</td>
                            <td className="num">{fmtHa(l.vegetacaoNativaHa)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
                <ul className="notas-car suave">
                  <li>Áreas em hectares. Talhões: {fmtHa(quadro.talhoesHa)} ha; fora de CAR: {fmtHa(quadro.talhoesForaDeCarHa)} ha; fora de matrícula certificada: {fmtHa(quadro.talhoesForaDeMatriculaHa)} ha.</li>
                  <li>* Pecuária estimada: área consolidada declarada no CAR, fora dos talhões. Nenhuma base tem o desenho dos pastos.</li>
                  <li>Matrículas: só as parcelas certificadas no SIGEF. Matrícula sem georreferenciamento certificado não aparece.</li>
                  {quadro.eucaliptoSemDesenhoHa >= 1 && <li>Eucalipto no PIMS sem talhão desenhado: {fmtHa(quadro.eucaliptoSemDesenhoHa)} ha (fora do recorte por CAR e matrícula).</li>}
                </ul>
                <div>
                  <button type="button" className="botao botao-pequeno" onClick={baixarCsv}>
                    Baixar CSV das áreas
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="cartao pilha">
            <h2>4. Textos do layout</h2>
            <PainelTextos textos={textos} editados={editados} onChange={(campo, valor) => setEditados((e) => editarTexto(e, automaticos, campo, valor))} onRestaurar={() => setEditados({})} />
          </section>

          <section className="cartao pilha">
            <h2>5. Aparência</h2>
            <SecaoAparencia modo="variedade" config={aparencia} onChange={(p) => setAparencia((a) => ({ ...a, ...p, quadros: 1 }))} paletaAutomatica={null} />
          </section>
        </div>

        <div className="editor-principal">
          <section className="cartao">
            <PreviaLayout
              input={renderInput}
              extent={extentEfetivo}
              automatico={aparencia.extent === null}
              onExtentChange={(ext) => setAparencia((a) => ({ ...a, extent: ext }))}
              ocupado={ocupado ?? buscando}
              onAvisos={setAvisosRender}
              vazio={fazendaId ? (registro === null ? 'Busque nas bases para montar o mapa.' : 'Lendo…') : 'Escolha a fazenda.'}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
