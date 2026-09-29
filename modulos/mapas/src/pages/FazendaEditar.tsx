import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { repo } from '../data/index';
import type { Fazenda, Talhao } from '../lib/types';
import { normalizarCodigo } from '../lib/codigoTalhao';
import MapaLeaflet from '../components/MapaLeaflet';
import CamposPims from '../components/CamposPims';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import Modal from '../components/Modal';
import { exemplosColuna, nomeDoTalhao, nomesRepetidos, setorDoTalhao } from './FazendaNova';

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function FazendaEditar() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  /** nomes gravados no repositório (id → nome), atualizados ao salvar */
  const [nomesSalvos, setNomesSalvos] = useState<Map<string, string>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [campoNome, setCampoNome] = useState('');
  const [campoSetor, setCampoSetor] = useState<string | null>(null);
  const [campoCodigo, setCampoCodigo] = useState<string | null>(null);
  const [unidadePims, setUnidadePims] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    (async () => {
      try {
        const r = repo();
        const f = (await r.listarFazendas()).find((x) => x.id === id) ?? null;
        const ts = f ? await r.obterTalhoes(id) : [];
        if (!ativo) return;
        setFazenda(f);
        setTalhoes(ts);
        setNomesSalvos(new Map(ts.map((t) => [t.id, t.nome])));
        if (f) {
          setNome(f.nome);
          setCampoNome(f.campoNome);
          setCampoSetor(f.campoSetor);
          setCampoCodigo(f.campoCodigo);
          setUnidadePims(f.unidadePims);
        }
      } catch (e) {
        if (ativo) setErro(`Não foi possível carregar a fazenda: ${mensagemDeErro(e)}`);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [id]);

  const atributos = useMemo(() => talhoes.map((t) => t.atributos ?? {}), [talhoes]);
  const colunas = useMemo(() => {
    if (fazenda && fazenda.colunas.length > 0) return fazenda.colunas;
    return Object.keys(atributos[0] ?? {});
  }, [fazenda, atributos]);
  const editados = useMemo(
    () =>
      talhoes.map((t, i) => {
        const attrs = t.atributos ?? {};
        // valor vazio na coluna original: mantém o nome salvo ("Talhão N" do cadastro), pois a ordem
        // devolvida pelo repositório pode diferir da ordem da importação
        const vazio = String(attrs[campoNome] ?? '').trim() === '';
        const manter = vazio && campoNome === fazenda?.campoNome;
        // código: da coluna escolhida (sem a coluna nos atributos, mantém o gravado); sem coluna = sem código
        const codigo = !campoCodigo ? null : campoCodigo in attrs ? normalizarCodigo(String(attrs[campoCodigo] ?? '')) || null : t.codigo;
        return {
          ...t,
          nome: manter ? (nomesSalvos.get(t.id) ?? t.nome) : nomeDoTalhao(attrs, campoNome, i),
          setor: setorDoTalhao(attrs, campoSetor),
          codigo,
        };
      }),
    [talhoes, campoNome, campoSetor, campoCodigo, fazenda, nomesSalvos],
  );
  const codigosRepetidos = useMemo(() => nomesRepetidos(editados.flatMap((t) => (t.codigo ? [t.codigo] : []))), [editados]);
  const repetidos = useMemo(() => nomesRepetidos(editados.map((t) => t.nome)), [editados]);
  const areaTotal = useMemo(() => talhoes.reduce((a, t) => a + (t.areaHa || 0), 0), [talhoes]);
  const ordenados = useMemo(
    () => [...editados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
    [editados],
  );

  async function salvar() {
    if (!fazenda) return;
    const n = nome.trim();
    if (!n) {
      setErro('Informe o nome da fazenda.');
      return;
    }
    setErro(null);
    setSucesso(null);
    setSalvando(true);
    try {
      const atualizada: Fazenda = { ...fazenda, nome: n, campoNome, campoSetor, campoCodigo, unidadePims: unidadePims?.trim() || null };
      await repo().atualizarFazenda(atualizada, editados);
      // atualizarFazenda só grava nome/setor dos talhões: o código vai por upsert (mesma geometria, plantios preservados)
      const antes = new Map(talhoes.map((t) => [t.id, t.codigo]));
      const comCodigoNovo = editados.filter((t) => antes.get(t.id) !== t.codigo);
      if (comCodigoNovo.length) {
        await repo().upsertTalhoes(fazenda.id, comCodigoNovo);
        const novo = new Map(comCodigoNovo.map((t) => [t.id, t.codigo]));
        setTalhoes((ts) => ts.map((t) => (novo.has(t.id) ? { ...t, codigo: novo.get(t.id) ?? null } : t)));
      }
      // os nomes vêm sempre de `atributos`; manter `talhoes` evita redesenhar e reenquadrar o mapa
      setFazenda(atualizada);
      setNomesSalvos(new Map(editados.map((t) => [t.id, t.nome])));
      setSucesso('Alterações salvas.');
    } catch (e) {
      setErro(`Não foi possível salvar: ${mensagemDeErro(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!fazenda) return;
    setExcluindo(true);
    try {
      await repo().excluirFazenda(fazenda.id);
      navigate('/fazendas', { state: { msg: `Fazenda "${fazenda.nome}" excluída.` } });
    } catch (e) {
      setErro(`Não foi possível excluir: ${mensagemDeErro(e)}`);
      setExcluindo(false);
      setConfirmarExclusao(false);
    }
  }

  if (carregando) return <Carregando texto="Carregando fazenda…" />;

  if (!fazenda) {
    return (
      <div className="pagina">
        <Link to="/fazendas" className="voltar">
          ← Fazendas
        </Link>
        <Aviso tipo="erro">{erro ?? 'Fazenda não encontrada.'}</Aviso>
      </div>
    );
  }

  const alterado =
    nome.trim() !== fazenda.nome ||
    campoNome !== fazenda.campoNome ||
    campoSetor !== fazenda.campoSetor ||
    campoCodigo !== fazenda.campoCodigo ||
    (unidadePims?.trim() || null) !== fazenda.unidadePims;

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <Link to="/fazendas" className="voltar">
            ← Fazendas
          </Link>
          <h1>{fazenda.nome}</h1>
          <p className="subtitulo">
            {talhoes.length} talhões · {fmtHa(areaTotal)} ha
          </p>
        </div>
        <button type="button" className="botao botao-perigo" onClick={() => setConfirmarExclusao(true)}>
          Excluir fazenda
        </button>
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

      <div className="grade-lado">
        <div className="cartao fixo">
          <MapaLeaflet talhoes={talhoes} rotulo={(i) => editados[i]?.nome ?? ''} altura={480} />
        </div>

        <div className="pilha">
          <div className="cartao pilha">
            <h2>Dados da fazenda</h2>
            <label className="campo">
              <span>Nome da fazenda</span>
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="campo">
              <span>Coluna com o nome do talhão (rótulo)</span>
              <select value={campoNome} onChange={(e) => setCampoNome(e.target.value)}>
                {!colunas.includes(campoNome) && <option value={campoNome}>{campoNome}</option>}
                {colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                    {exemplosColuna(atributos, c) ? ` — ex.: ${exemplosColuna(atributos, c)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Coluna do setor (opcional)</span>
              <select value={campoSetor ?? ''} onChange={(e) => setCampoSetor(e.target.value || null)}>
                <option value="">(nenhuma)</option>
                {colunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <CamposPims
              colunas={colunas}
              exemplos={(c) => exemplosColuna(atributos, c)}
              campoCodigo={campoCodigo}
              onCampoCodigo={setCampoCodigo}
              unidadePims={unidadePims}
              onUnidadePims={setUnidadePims}
            />
            {codigosRepetidos.length > 0 && (
              <Aviso tipo="alerta" titulo="Há talhões com o mesmo código PIMS">
                {codigosRepetidos.slice(0, 12).join(', ')}
                {codigosRepetidos.length > 12 ? ` e mais ${codigosRepetidos.length - 12}` : ''}. Cada um recebe a mesma situação do PIMS. Para
                uni-los num só talhão, cadastre a fazenda de novo com esta coluna do código.
              </Aviso>
            )}
            {repetidos.length > 0 && (
              <Aviso tipo="alerta" titulo="Há talhões com o mesmo nome">
                {repetidos.slice(0, 12).join(', ')}
                {repetidos.length > 12 ? ` e mais ${repetidos.length - 12}` : ''}.
              </Aviso>
            )}
            <div className="linha linha-fim">
              {alterado && <span className="suave">Alterações não salvas</span>}
              <button
                type="button"
                className="botao botao-primario"
                onClick={salvar}
                disabled={salvando || !alterado}
              >
                {salvando ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </div>

          <div className="cartao">
            <div className="cartao-titulo">
              <h2>Talhões</h2>
              <span className="suave">{talhoes.length}</span>
            </div>
            <div className="tabela-rolagem lista-alta">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Talhão</th>
                    <th>Setor</th>
                    <th>Código PIMS</th>
                    <th className="num">Área (ha)</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map((t) => (
                    <tr key={t.id}>
                      <td>{t.nome}</td>
                      <td>{t.setor ?? '—'}</td>
                      <td>{t.codigo ?? '—'}</td>
                      <td className="num">{fmtHa(t.areaHa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal
        aberto={confirmarExclusao}
        titulo="Excluir fazenda"
        onFechar={() => !excluindo && setConfirmarExclusao(false)}
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setConfirmarExclusao(false)} disabled={excluindo}>
              Cancelar
            </button>
            <button type="button" className="botao botao-perigo-cheio" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Excluir'}
            </button>
          </>
        }
      >
        <p>
          Excluir a fazenda <strong>{fazenda.nome}</strong>?
        </p>
        <p className="suave">
          Isso também remove os {talhoes.length} talhões, os plantios marcados nesses talhões e os mapas salvos desta
          fazenda. Não é possível desfazer.
        </p>
      </Modal>
    </div>
  );
}
