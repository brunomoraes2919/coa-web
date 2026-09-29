import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { repo } from '../data/index';
import { areaHa, importarShape, ShapeError, type ShapeImport } from '../lib/shapes';
import { normalizarCodigo, sugerirColunaCodigo, unirPorCodigo } from '../lib/codigoTalhao';
import type { AreaCultura, Fazenda, Safra, Talhao } from '../lib/types';
import MapaLeaflet from '../components/MapaLeaflet';
import Modal from '../components/Modal';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import { exemplosColuna } from './FazendaNova';

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ACEITOS = '.zip,.shp,.shx,.dbf,.prj,.cpg,.kml,.geojson,.json';

/** Áreas da cultura (ex.: shape da soja 26/27) de uma fazenda numa safra: importar, conferir e salvar. */
export default function AreasCultura() {
  const { safraId = '', fazendaId = '' } = useParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [safra, setSafra] = useState<Safra | null>(null);
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [salvas, setSalvas] = useState<AreaCultura[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [imp, setImp] = useState<ShapeImport | null>(null);
  const [campoCodigo, setCampoCodigo] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [sobre, setSobre] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    (async () => {
      try {
        const r = repo();
        const [ss, fs] = await Promise.all([r.listarSafras(), r.listarFazendas()]);
        const s = ss.find((x) => x.id === safraId) ?? null;
        const f = fs.find((x) => x.id === fazendaId) ?? null;
        const [ts, as] = await Promise.all([
          f ? r.obterTalhoes(f.id) : Promise.resolve([] as Talhao[]),
          s && f ? r.listarAreasCultura(s.id, f.id) : Promise.resolve([] as AreaCultura[]),
        ]);
        if (!ativo) return;
        setSafra(s);
        setFazenda(f);
        setTalhoes(ts);
        setSalvas(as);
      } catch (e) {
        if (ativo) setErro(`Não foi possível carregar: ${mensagemDeErro(e)}`);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [safraId, fazendaId]);

  async function receber(lista: FileList | null) {
    const arquivos = lista ? Array.from(lista) : [];
    if (arquivos.length === 0) return;
    setErro(null);
    setSucesso(null);
    setLendo(true);
    try {
      const r = await importarShape(arquivos);
      setImp(r);
      setCampoCodigo(sugerirColunaCodigo(r.colunas));
    } catch (e) {
      setImp(null);
      setErro(e instanceof ShapeError ? e.message : `Não foi possível ler o arquivo: ${mensagemDeErro(e)}`);
    } finally {
      setLendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setSobre(false);
    void receber(e.dataTransfer.files);
  }

  /** áreas importadas (ainda não salvas): as do mesmo código viram um MultiPolygon */
  const novas = useMemo((): AreaCultura[] | null => {
    if (!imp) return null;
    const feicoes = campoCodigo ? unirPorCodigo(imp.feicoes, campoCodigo) : imp.feicoes;
    return feicoes.map((f) => ({
      id: crypto.randomUUID(),
      safraId,
      fazendaId,
      codigo: campoCodigo ? normalizarCodigo(String(f.props.codigo ?? '')) : '',
      areaHa: areaHa(f.geom),
      geom: f.geom,
    }));
  }, [imp, campoCodigo, safraId, fazendaId]);

  const exibidas = novas ?? salvas;
  const geoms = useMemo(() => exibidas.map((a) => a.geom), [exibidas]);
  const areaTotal = exibidas.reduce((a, x) => a + (x.areaHa || 0), 0);
  const conferencia = useMemo(() => {
    const base = new Set(talhoes.map((t) => normalizarCodigo(t.codigo)).filter(Boolean));
    const semCodigo = exibidas.filter((a) => !a.codigo).length;
    const foraDaBase = [...new Set(exibidas.map((a) => a.codigo).filter((c) => c && !base.has(c)))];
    return { semCodigo, foraDaBase };
  }, [exibidas, talhoes]);
  const props = useMemo(() => imp?.feicoes.map((f) => f.props) ?? [], [imp]);

  async function gravar(lista: AreaCultura[]) {
    setSalvando(true);
    setErro(null);
    try {
      await repo().salvarAreasCultura(safraId, fazendaId, lista);
      setSalvas(lista);
      setImp(null);
      setSucesso(lista.length ? `${lista.length} áreas da cultura salvas (${fmtHa(lista.reduce((a, x) => a + x.areaHa, 0))} ha).` : 'Áreas da cultura removidas.');
    } catch (e) {
      setErro(`Não foi possível salvar: ${mensagemDeErro(e)}`);
    } finally {
      setSalvando(false);
      setConfirmarRemocao(false);
    }
  }

  if (carregando) return <Carregando texto="Carregando áreas da cultura…" />;
  if (!safra || !fazenda) {
    return (
      <div className="pagina">
        <Link to="/safras" className="voltar">
          ← Safras
        </Link>
        <Aviso tipo="erro">{erro ?? (!safra ? 'Safra não encontrada.' : 'Fazenda não encontrada.')}</Aviso>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <Link to="/safras" className="voltar">
            ← Safras
          </Link>
          <h1>
            Áreas da cultura · {fazenda.nome} · {safra.nome}
          </h1>
          <p className="subtitulo">
            Shape da área da {safra.cultura.toLowerCase()} nesta safra. No mapa de chuva, estas áreas são pintadas (plantado, plantando, a
            plantar) no lugar dos talhões base, casadas com o PIMS pelo código.
          </p>
        </div>
      </div>

      {erro && (
        <Aviso tipo="erro" onFechar={() => setErro(null)}>
          {erro}
        </Aviso>
      )}
      {sucesso && (
        <Aviso tipo="sucesso" onFechar={() => setSucesso(null)}>
          {sucesso}
        </Aviso>
      )}

      <div className="cartao pilha">
        <h2>Arquivo das áreas</h2>
        <div
          className={sobre ? 'soltar sobre' : 'soltar'}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setSobre(true);
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={soltar}
        >
          <strong>{salvas.length ? 'Substituir: arraste o novo shape aqui ou clique' : 'Arraste o shape aqui ou clique para escolher'}</strong>
          <span className="suave">Shapefile zipado (.zip), arquivos soltos (.shp, .dbf, .prj, .cpg), KML ou GeoJSON</span>
        </div>
        <input ref={inputRef} type="file" multiple accept={ACEITOS} hidden onChange={(e) => void receber(e.target.files)} />
        {lendo && <Carregando texto="Lendo o arquivo…" />}
        {imp && imp.avisos.length > 0 && (
          <Aviso tipo="alerta" titulo="Avisos da importação">
            <ul>
              {imp.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </Aviso>
        )}
      </div>

      <div className="grade-lado">
        <div className="cartao fixo">
          <div className="cartao-titulo">
            <h2>{novas ? 'Prévia (não salva)' : 'Áreas salvas'}</h2>
            <span className="resumo">
              {exibidas.length} áreas · {fmtHa(areaTotal)} ha
            </span>
          </div>
          <MapaLeaflet talhoes={talhoes} sobrepor={geoms} altura={480} />
          <small className="suave">Em laranja, as áreas da cultura; em branco, o limite base dos talhões.</small>
        </div>

        <div className="cartao pilha">
          {imp && (
            <label className="campo">
              <span>Coluna do código PIMS do talhão</span>
              <select value={campoCodigo ?? ''} onChange={(e) => setCampoCodigo(e.target.value || null)}>
                <option value="">(nenhuma — todas ficam "a plantar")</option>
                {imp.colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                    {exemplosColuna(props, c) ? ` — ex.: ${exemplosColuna(props, c)}` : ''}
                  </option>
                ))}
              </select>
              <small>Áreas com o mesmo código viram uma só (MultiPolygon).</small>
            </label>
          )}
          {exibidas.length > 0 && (conferencia.semCodigo > 0 || conferencia.foraDaBase.length > 0) && (
            <Aviso tipo="alerta" titulo="Conferência dos códigos">
              {conferencia.semCodigo > 0 && <p>{conferencia.semCodigo} área(s) sem código: ficam sempre "a plantar".</p>}
              {conferencia.foraDaBase.length > 0 && (
                <p>
                  Códigos que não existem nos talhões base: {conferencia.foraDaBase.slice(0, 15).join(', ')}
                  {conferencia.foraDaBase.length > 15 ? '…' : ''} (ainda são casados com o PIMS normalmente).
                </p>
              )}
            </Aviso>
          )}
          {exibidas.length === 0 && <p className="suave">Nenhuma área da cultura cadastrada: o mapa pinta os talhões base.</p>}
          <div className="linha linha-fim">
            {salvas.length > 0 && !novas && (
              <button type="button" className="botao botao-perigo" onClick={() => setConfirmarRemocao(true)} disabled={salvando}>
                Remover áreas
              </button>
            )}
            {novas && (
              <button type="button" className="botao" onClick={() => setImp(null)} disabled={salvando}>
                Descartar
              </button>
            )}
            <button type="button" className="botao botao-primario" onClick={() => novas && void gravar(novas)} disabled={!novas || salvando}>
              {salvando ? 'Salvando…' : salvas.length ? 'Salvar (substitui as atuais)' : 'Salvar áreas'}
            </button>
          </div>
        </div>
      </div>

      <Modal
        aberto={confirmarRemocao}
        titulo="Remover áreas da cultura"
        onFechar={() => !salvando && setConfirmarRemocao(false)}
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setConfirmarRemocao(false)} disabled={salvando}>
              Cancelar
            </button>
            <button type="button" className="botao botao-perigo-cheio" onClick={() => void gravar([])} disabled={salvando}>
              {salvando ? 'Removendo…' : 'Remover'}
            </button>
          </>
        }
      >
        <p>
          Remover as {salvas.length} áreas da cultura de <strong>{fazenda.nome}</strong> na {safra.nome}? O mapa volta a pintar os talhões base.
        </p>
      </Modal>
    </div>
  );
}
