import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { repo } from '../data/index';
import { areaHa, importarShape, ShapeError, sugerirColunaNome, sugerirColunaSetor } from '../lib/shapes';
import type { ShapeImport } from '../lib/shapes';
import type { Fazenda, FazendaCoa, Talhao } from '../lib/types';
import { normalizarCodigo, sugerirColunaCodigo, unidadePimsCanonica, unirPorCodigo } from '../lib/codigoTalhao';
import MapaLeaflet from '../components/MapaLeaflet';
import CamposPims from '../components/CamposPims';
import CampoFazendaCoa from '../components/CampoFazendaCoa';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';

/** Nome do talhão a partir da coluna escolhida; vazio → "Talhão N". */
export function nomeDoTalhao(props: Record<string, unknown>, campo: string, i: number): string {
  const v = String(props[campo] ?? '').trim();
  return v || `Talhão ${i + 1}`;
}

export function setorDoTalhao(props: Record<string, unknown>, campo: string | null): string | null {
  if (!campo) return null;
  const v = String(props[campo] ?? '').trim();
  return v || null;
}

/** Nomes que aparecem mais de uma vez, com a contagem: "TH01 (2×)". */
export function nomesRepetidos(nomes: string[]): string[] {
  const cont = new Map<string, number>();
  for (const n of nomes) cont.set(n, (cont.get(n) ?? 0) + 1);
  return [...cont].filter(([, c]) => c > 1).map(([n, c]) => `${n} (${c}×)`);
}

/** Até 3 valores distintos da coluna, para ajudar a escolher. */
export function exemplosColuna(lista: Record<string, unknown>[], campo: string): string {
  const vistos: string[] = [];
  for (const p of lista) {
    const v = String(p[campo] ?? '').trim();
    if (v && !vistos.includes(v)) vistos.push(v);
    if (vistos.length === 3) break;
  }
  return vistos.join(', ');
}

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ACEITOS = '.zip,.shp,.shx,.dbf,.prj,.cpg,.kml,.geojson,.json';

export default function FazendaNova() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [imp, setImp] = useState<ShapeImport | null>(null);
  const [campoNome, setCampoNome] = useState('');
  const [campoSetor, setCampoSetor] = useState<string | null>(null);
  const [nomeFazenda, setNomeFazenda] = useState('');
  const [campoCodigo, setCampoCodigo] = useState<string | null>(null);
  const [unidadePims, setUnidadePims] = useState<string | null>(null);
  const [coaFazendaId, setCoaFazendaId] = useState<number | null>(null);
  /** fazendas do COA WEB para o vínculo (modo local: vazia → campo escondido) */
  const [fazendasCoa, setFazendasCoa] = useState<FazendaCoa[]>([]);
  const [erroCoa, setErroCoa] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // a lista do COA WEB é só para o vínculo: se falhar, o cadastro segue (sem vínculo, com aviso)
  useEffect(() => {
    let ativo = true;
    repo()
      .listarFazendasCoa()
      .then(
        (lista) => {
          if (ativo) setFazendasCoa(lista);
        },
        (e: unknown) => {
          if (ativo) setErroCoa(`Não foi possível listar as fazendas do COA WEB (ligue esta fazenda depois, na tela dela): ${mensagemDeErro(e)}`);
        },
      );
    return () => {
      ativo = false;
    };
  }, []);

  async function receber(lista: FileList | null) {
    const arquivos = lista ? Array.from(lista) : [];
    if (arquivos.length === 0) return;
    setErro(null);
    setLendo(true);
    try {
      const r = await importarShape(arquivos);
      setImp(r);
      setCampoNome(sugerirColunaNome(r.colunas, r.feicoes));
      setCampoSetor(sugerirColunaSetor(r.colunas));
      setCampoCodigo(sugerirColunaCodigo(r.colunas));
      setNomeFazenda(r.nomeSugerido);
    } catch (e) {
      setImp(null);
      setErro(
        e instanceof ShapeError
          ? e.message
          : e instanceof SyntaxError
            ? 'Não foi possível ler o arquivo: o conteúdo não é um GeoJSON/JSON válido.'
            : `Não foi possível ler o arquivo: ${mensagemDeErro(e)}`,
      );
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

  /** feições do cadastro: com a coluna do código, as do mesmo código viram um MultiPolygon */
  const feicoes = useMemo(() => (imp ? (campoCodigo ? unirPorCodigo(imp.feicoes, campoCodigo) : imp.feicoes) : []), [imp, campoCodigo]);
  const props = useMemo(() => feicoes.map((f) => f.props), [feicoes]);
  const areas = useMemo(() => feicoes.map((f) => areaHa(f.geom)), [feicoes]);
  const areaTotal = useMemo(() => areas.reduce((a, b) => a + b, 0), [areas]);
  const nomes = useMemo(() => props.map((p, i) => nomeDoTalhao(p, campoNome, i)), [props, campoNome]);
  const repetidos = useMemo(() => nomesRepetidos(nomes), [nomes]);

  async function salvar() {
    if (!imp) return;
    const nome = nomeFazenda.trim();
    if (!nome) {
      setErro('Informe o nome da fazenda.');
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const fazenda: Fazenda = {
        id: crypto.randomUUID(),
        nome,
        campoNome,
        campoSetor,
        colunas: imp.colunas,
        criadoEm: new Date().toISOString(),
        unidadePims: unidadePimsCanonica(unidadePims),
        campoCodigo,
        // vínculo com a fazenda do COA WEB; null (sem vínculo): no Supabase, só o admin vê até ser ligada
        coaFazendaId,
      };
      const talhoes: Talhao[] = feicoes.map((f, i) => ({
        id: crypto.randomUUID(),
        fazendaId: fazenda.id,
        nome: nomes[i],
        setor: setorDoTalhao(f.props, campoSetor),
        areaHa: areas[i],
        geom: f.geom,
        atributos: f.props,
        codigo: campoCodigo ? normalizarCodigo(String(f.props[campoCodigo] ?? '')) || null : null,
      }));
      await repo().salvarFazenda(fazenda, talhoes);
      navigate('/fazendas', { state: { msg: `Fazenda "${nome}" cadastrada com ${talhoes.length} talhões.` } });
    } catch (e) {
      setErro(`Não foi possível salvar a fazenda: ${mensagemDeErro(e)}`);
      setSalvando(false);
    }
  }

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <Link to="/fazendas" className="voltar">
            ← Fazendas
          </Link>
          <h1>Cadastrar fazenda</h1>
          <p className="subtitulo">Envie o shape dos talhões, escolha a coluna do nome (e a do código PIMS) e salve.</p>
        </div>
      </div>

      <div className="cartao pilha">
        <h2>1. Arquivo dos talhões</h2>
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
          <strong>Arraste os arquivos aqui ou clique para escolher</strong>
          <span className="suave">
            Shapefile zipado (.zip), arquivos soltos (.shp, .dbf, .prj, .cpg), KML ou GeoJSON
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACEITOS}
          hidden
          onChange={(e) => void receber(e.target.files)}
        />
        {lendo && <Carregando texto="Lendo o arquivo…" />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
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

      {imp && (
        <>
          <div className="grade-lado">
            <div className="cartao fixo">
              <div className="cartao-titulo">
                <h2>Prévia</h2>
                <span className="resumo">
                  {feicoes.length} talhões · {fmtHa(areaTotal)} ha
                  {feicoes.length < imp.feicoes.length ? ` (${imp.feicoes.length} polígonos unidos pelo código)` : ''}
                </span>
              </div>
              <MapaLeaflet talhoes={feicoes} rotulo={(i) => nomes[i]} altura={460} />
            </div>

            <div className="cartao pilha">
              <h2>2. Colunas e nome</h2>
              <label className="campo">
                <span>Coluna com o nome do talhão</span>
                <select value={campoNome} onChange={(e) => setCampoNome(e.target.value)}>
                  {imp.colunas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                      {exemplosColuna(props, c) ? ` — ex.: ${exemplosColuna(props, c)}` : ''}
                    </option>
                  ))}
                </select>
                <small>Exemplos: {exemplosColuna(props, campoNome) || '(coluna vazia)'}</small>
              </label>
              <label className="campo">
                <span>Coluna do setor (opcional)</span>
                <select value={campoSetor ?? ''} onChange={(e) => setCampoSetor(e.target.value || null)}>
                  <option value="">(nenhuma)</option>
                  {imp.colunas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {campoSetor && <small>Exemplos: {exemplosColuna(props, campoSetor) || '(coluna vazia)'}</small>}
              </label>
              <CamposPims
                colunas={imp.colunas}
                exemplos={(c) => exemplosColuna(props, c)}
                campoCodigo={campoCodigo}
                onCampoCodigo={setCampoCodigo}
                unidadePims={unidadePims}
                onUnidadePims={setUnidadePims}
              />
              {repetidos.length > 0 && (
                <Aviso tipo="alerta" titulo="Há talhões com o mesmo nome">
                  {repetidos.slice(0, 12).join(', ')}
                  {repetidos.length > 12 ? ` e mais ${repetidos.length - 12}` : ''}. Confira se a coluna escolhida é a
                  correta.
                </Aviso>
              )}
              <label className="campo">
                <span>Nome da fazenda</span>
                <input
                  type="text"
                  value={nomeFazenda}
                  onChange={(e) => setNomeFazenda(e.target.value)}
                  placeholder="Ex.: Guapirama"
                />
              </label>
              <CampoFazendaCoa fazendas={fazendasCoa} valor={coaFazendaId} onValor={setCoaFazendaId} />
              {erroCoa && (
                <Aviso tipo="alerta" onFechar={() => setErroCoa(null)}>
                  {erroCoa}
                </Aviso>
              )}
              <div className="linha linha-fim">
                <Link to="/fazendas" className="botao">
                  Cancelar
                </Link>
                <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar fazenda'}
                </button>
              </div>
            </div>
          </div>

          <div className="cartao">
            <div className="cartao-titulo">
              <h2>Primeiras feições</h2>
              <span className="suave">
                {Math.min(8, feicoes.length)} de {feicoes.length}
              </span>
            </div>
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>#</th>
                    {imp.colunas.map((c) => (
                      <th key={c} className={c === campoNome ? 'destaque' : undefined}>
                        {c}
                      </th>
                    ))}
                    <th className="num">Área (ha)</th>
                  </tr>
                </thead>
                <tbody>
                  {props.slice(0, 8).map((p, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      {imp.colunas.map((c) => (
                        <td key={c} className={c === campoNome ? 'destaque' : undefined}>
                          {String(p[c] ?? '')}
                        </td>
                      ))}
                      <td className="num">{fmtHa(areas[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
