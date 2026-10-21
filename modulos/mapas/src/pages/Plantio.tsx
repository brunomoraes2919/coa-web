import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { repo } from '../data/index';
import type { AreaCultura, Fazenda, Plantio as PlantioT, PlantioPimsArquivo, PlantioPimsTalhao, Safra, StatusPlantio, Talhao } from '../lib/types';
import { normalizarCodigo } from '../lib/codigoTalhao';
import { casarPlantio } from '../lib/plantioPims';
import { plantadosSemArea } from '../lib/mascaraCultura';
import { linhasDasAreas } from '../lib/plantioAreas';
import { fmtDataHora, resumoContagem, resumoPlantioPagina, ROTULO_STATUS } from '../lib/situacaoPlantio';
import { nomeBaseArquivo } from '../lib/exportar';
import { ha2, type FeicaoExportada } from '../lib/exportarLimites';
import MapaLeaflet from '../components/MapaLeaflet';
import TabelaPlantio from '../components/TabelaPlantio';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import { lerPlantioPims } from '../components/usePlantioPims';
import ExportarLimites from '../components/ExportarLimites';

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** talhaoId → data de plantio ('' = sem data). Presença na tabela = plantado (marcação manual). */
type Marcacoes = Record<string, string>;

function plantioManual(safraId: string, talhaoId: string, data: string): PlantioT {
  return {
    safraId,
    talhaoId,
    dataPlantio: data || null,
    origem: 'manual',
    status: 'plantado',
    areaPrevista: null,
    areaPlantada: null,
    inicio: null,
    fim: null,
    variedade: null,
  };
}

export default function Plantio() {
  const { safraId = '', fazendaId = '' } = useParams();
  const navigate = useNavigate();
  const [safra, setSafra] = useState<Safra | null>(null);
  const [fazenda, setFazenda] = useState<Fazenda | null>(null);
  const [fazendas, setFazendas] = useState<Fazenda[]>([]);
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [areas, setAreas] = useState<AreaCultura[]>([]);
  const [arquivo, setArquivo] = useState<PlantioPimsArquivo | null>(null);
  const [marcados, setMarcados] = useState<Marcacoes>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [dataLote, setDataLote] = useState('');

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    setSucesso(null);
    (async () => {
      try {
        const r = repo();
        const [ss, fs, arq] = await Promise.all([r.listarSafras(), r.listarFazendas(), lerPlantioPims()]);
        const s = ss.find((x) => x.id === safraId) ?? null;
        const f = fs.find((x) => x.id === fazendaId) ?? null;
        const [ts, ps, as] = await Promise.all([
          f ? r.obterTalhoes(f.id) : Promise.resolve([] as Talhao[]),
          s ? r.listarPlantios(s.id) : Promise.resolve([] as PlantioT[]),
          s && f ? r.listarAreasCultura(s.id, f.id) : Promise.resolve([] as AreaCultura[]),
        ]);
        if (!ativo) return;
        const ids = new Set(ts.map((t) => t.id));
        const m: Marcacoes = {};
        for (const p of ps) if (ids.has(p.talhaoId) && p.origem !== 'pims') m[p.talhaoId] = p.dataPlantio ?? '';
        setSafra(s);
        setFazenda(f);
        setFazendas([...fs].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
        setTalhoes([...ts].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })));
        setAreas(as);
        setArquivo(arq);
        setMarcados(m);
        setAlterado(false);
      } catch (e) {
        if (ativo) setErro(`Não foi possível carregar o plantio: ${mensagemDeErro(e)}`);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [safraId, fazendaId]);

  // avisa ao fechar/recarregar a aba com alterações não salvas
  useEffect(() => {
    if (!alterado) return;
    const antes = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [alterado]);

  const casado = useMemo(
    () => (arquivo && safra && fazenda ? casarPlantio(arquivo, safra, fazenda, talhoes, areas) : null),
    [arquivo, safra, fazenda, talhoes, areas],
  );
  const pimsDe = useCallback(
    (t: Talhao): PlantioPimsTalhao | undefined => {
      const codigo = normalizarCodigo(t.codigo);
      return codigo ? casado?.porCodigo.get(codigo) : undefined;
    },
    [casado],
  );
  const semArea = useMemo(() => plantadosSemArea(casado?.porCodigo ?? null, talhoes, areas), [casado, talhoes, areas]);
  /** talhões do shape da fazenda com registro no PIMS (não são marcados à mão) */
  const basePims = useMemo(() => new Set(talhoes.filter((t) => pimsDe(t)).map((t) => t.id)), [talhoes, pimsDe]);

  // com áreas da cultura na safra, o mapa e a lista mostram as áreas (o limite dos mapas de chuva e de variedade);
  // a marcação manual vai para o talhão do shape da fazenda com o mesmo código
  const usaAreas = areas.length > 0;
  const { linhas, baseDe } = useMemo(
    () => (usaAreas ? linhasDasAreas(areas, talhoes) : { linhas: talhoes, baseDe: new Map(talhoes.map((t) => [t.id, t.id])) }),
    [usaAreas, areas, talhoes],
  );
  const linhaPorId = useMemo(() => new Map(linhas.map((l) => [l.id, l])), [linhas]);
  const fundoFazenda = useMemo(() => (usaAreas ? talhoes.map((t) => t.geom) : undefined), [usaAreas, talhoes]);
  /** linha → talhão do shape da fazenda que recebe a marcação manual; null = linha com PIMS ou sem talhão de mesmo código */
  const manualDe = useCallback((l: Talhao | undefined): string | null => (!l || pimsDe(l) ? null : (baseDe.get(l.id) ?? null)), [pimsDe, baseDe]);

  const mudar = useCallback((fn: (m: Marcacoes) => Marcacoes) => {
    setMarcados(fn);
    setAlterado(true);
    setSucesso(null);
  }, []);

  const alternar = useCallback(
    (idLinha: string) => {
      const id = manualDe(linhaPorId.get(idLinha)); // situação do PIMS não é marcada à mão
      if (!id) return;
      mudar((m) => {
        const n = { ...m };
        if (id in n) delete n[id];
        else n[id] = '';
        return n;
      });
    },
    [mudar, manualDe, linhaPorId],
  );

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim());
    if (!q) return linhas;
    return linhas.filter((t) => semAcento(`${t.nome} ${t.setor ?? ''} ${t.codigo ?? ''}`).includes(q));
  }, [linhas, busca]);
  /** talhões do shape da fazenda que recebem a marcação manual das linhas visíveis */
  const manuaisVisiveis = useMemo(() => visiveis.map((l) => manualDe(l)).filter((id): id is string => !!id), [visiveis, manualDe]);

  /** talhões do shape da fazenda marcados à mão (os sem PIMS) */
  const selecionados = useMemo(() => new Set(Object.keys(marcados).filter((id) => !basePims.has(id))), [marcados, basePims]);
  /** marcação manual vista pelas linhas (talhões ou áreas): linha → data */
  const marcadosLinhas = useMemo(() => {
    const out: Marcacoes = {};
    for (const l of linhas) {
      const id = manualDe(l);
      if (id && id in marcados) out[l.id] = marcados[id];
    }
    return out;
  }, [linhas, manualDe, marcados]);
  /** mapa: marcação manual (laranja) nas linhas sem PIMS; situação do PIMS nas demais */
  const selecionadosLinhas = useMemo(() => new Set(Object.keys(marcadosLinhas)), [marcadosLinhas]);
  const situacoes = useMemo(() => {
    const m = new Map<string, StatusPlantio>();
    for (const l of linhas) {
      const p = pimsDe(l);
      if (p) m.set(l.id, p.status);
    }
    return m;
  }, [linhas, pimsDe]);
  // inclui os códigos do PIMS que só existem como área da cultura (subáreas como "023A")
  const { contagem, ha: areaPlantada } = useMemo(
    () => resumoPlantioPagina(talhoes, areas, casado?.porCodigo ?? null, selecionados),
    [talhoes, areas, casado, selecionados],
  );
  const filtrando = busca.trim() !== '';

  /** cada linha da tela (área da cultura ou talhão) com a situação: do PIMS ou da marcação manual (ainda que não salva) */
  function feicoesDoPlantio(): FeicaoExportada[] {
    if (!safra || !fazenda) return [];
    return linhas.map((l) => {
      const p = pimsDe(l);
      const manual = l.id in marcadosLinhas;
      return {
        geom: l.geom,
        props: {
          FAZENDA: fazenda.nome,
          SAFRA: safra.nome,
          TALHAO: l.nome,
          SETOR: l.setor,
          CODIGO: l.codigo,
          AREA_HA: ha2(l.areaHa),
          SITUACAO: p ? ROTULO_STATUS[p.status] : manual ? 'Plantado (manual)' : ROTULO_STATUS.a_plantar,
          VARIEDADE: p?.variedade ?? null,
          AREA_PLANT: p ? ha2(p.areaPlantada) : null,
          INICIO: p?.inicio ?? (manual ? marcadosLinhas[l.id] || null : null),
          FIM: p?.fim ?? null,
        },
      };
    });
  }

  function marcarTodos() {
    mudar((m) => {
      const n = { ...m };
      for (const id of manuaisVisiveis) if (!(id in n)) n[id] = '';
      return n;
    });
  }

  function limpar() {
    mudar((m) => {
      const n = { ...m };
      for (const id of manuaisVisiveis) delete n[id];
      return n;
    });
  }

  function aplicarDataLote() {
    mudar((m) => {
      const n = { ...m };
      for (const id of Object.keys(n)) if (!basePims.has(id)) n[id] = dataLote;
      return n;
    });
  }

  async function salvar() {
    if (!safra || !fazenda) return;
    setSalvando(true);
    setErro(null);
    try {
      const plantios = Object.entries(marcados).map(([talhaoId, data]) => plantioManual(safra.id, talhaoId, data));
      await repo().salvarPlantios(safra.id, fazenda.id, plantios);
      setAlterado(false);
      setSucesso(`Plantio manual salvo: ${selecionados.size} talhões marcados como plantados.`);
    } catch (e) {
      setErro(`Não foi possível salvar o plantio: ${mensagemDeErro(e)}`);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <Carregando texto="Carregando talhões…" />;

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

  const semVinculo = arquivo && !casado;
  const qtdManuais = linhas.filter((l) => manualDe(l)).length;

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <Link to="/safras" className="voltar">
            ← Safras
          </Link>
          <h1>Plantio · {safra.nome}</h1>
          <p className="subtitulo">
            {casado
              ? `Plantio do PIMS de ${fmtDataHora(casado.geradoEm)} (atualizado automaticamente a cada hora). Talhões sem registro no PIMS podem ser marcados à mão.${usaAreas ? ' O mapa e a lista mostram as áreas da cultura desta safra, o mesmo limite dos mapas de chuva e de variedade.' : ''}`
              : 'Clique nos talhões do mapa ou marque na lista os que já foram plantados.'}
          </p>
        </div>
        <label className="campo" style={{ minWidth: 220 }}>
          <span>Fazenda</span>
          <select
            value={fazenda.id}
            onChange={(e) => {
              if (alterado && !window.confirm('Há alterações não salvas. Trocar de fazenda mesmo assim?')) return;
              navigate(`/safras/${safra.id}/plantio/${e.target.value}`);
            }}
          >
            {fazendas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
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
      {semVinculo && (
        <Aviso tipo="info">
          {fazenda.unidadePims ? (
            <>
              A unidade <strong>{fazenda.unidadePims}</strong> ou a safra <strong>{safra.nomePims ?? safra.nome}</strong> não está no plantio do
              PIMS. Confira o "Nome no PIMS" da safra em <Link to="/safras">Safras</Link>.
            </>
          ) : (
            <>
              Esta fazenda não está vinculada a uma unidade do PIMS. Escolha a unidade em{' '}
              <Link to={`/fazendas/${fazenda.id}`}>Fazendas</Link> para trazer o plantio automaticamente.
            </>
          )}
        </Aviso>
      )}
      {casado && casado.semPoligono.length > 0 && (
        <Aviso tipo="alerta" titulo="Talhões do PIMS sem polígono">
          Plantados ou plantando no PIMS, mas sem talhão nem área da cultura com o mesmo código:{' '}
          {casado.semPoligono.map((t) => `${t.codigoPims}${t.setor ? ` (${t.setor})` : ''}`).join(', ')}. Confira a coluna do código da
          fazenda ou importe as áreas da cultura.
        </Aviso>
      )}

      {semArea.length > 0 && (
        <Aviso tipo="alerta" titulo="Plantados no PIMS sem área da cultura">
          Estes talhões estão plantados ou plantando no PIMS, mas não têm área da cultura com o mesmo código, então não aparecem
          pintados no mapa de chuva: {semArea.map((t) => t.codigoPims).join(', ')}. Confira em{' '}
          <Link to={`/safras/${safra.id}/areas/${fazenda.id}`}>Áreas da cultura</Link>.
        </Aviso>
      )}

      <div className="cartao linha" style={{ justifyContent: 'space-between' }}>
        <span className="resumo">
          {casado ? resumoContagem(contagem, casado.geradoEm) : `${selecionados.size} de ${talhoes.length} talhões`} · {fmtHa(areaPlantada)} ha
          plantados
        </span>
        <div className="linha">
          <ExportarLimites
            quantidade={linhas.length}
            nome={nomeBaseArquivo('PLANTIO', fazenda.nome, safra.nome)}
            titulo={`Plantio · ${fazenda.nome} · ${safra.nome}`}
            campoNome="TALHAO"
            montar={feicoesDoPlantio}
          />
          {alterado && <span className="suave">Alterações não salvas</span>}
          <button type="button" className="botao botao-primario" onClick={salvar} disabled={salvando || !alterado}>
            {salvando ? 'Salvando…' : 'Salvar plantio manual'}
          </button>
        </div>
      </div>

      {linhas.length === 0 ? (
        <Aviso tipo="info">Esta fazenda não tem talhões cadastrados.</Aviso>
      ) : (
        <div className="grade-lado">
          <div className="cartao fixo">
            <MapaLeaflet
              talhoes={linhas}
              selecionados={selecionadosLinhas}
              situacoes={situacoes}
              onClickTalhao={alternar}
              rotulo={(i) => linhas[i]?.nome ?? ''}
              altura={560}
              fundo={fundoFazenda}
            />
          </div>

          <div className="cartao pilha">
            <input
              type="search"
              placeholder="Buscar talhão, setor ou código…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar talhão"
            />
            {qtdManuais > 0 && (
              <>
                <div className="linha">
                  <button type="button" className="botao botao-pequeno" onClick={marcarTodos}>
                    {filtrando ? 'Marcar os filtrados' : 'Marcar todos'}
                  </button>
                  <button type="button" className="botao botao-pequeno" onClick={limpar}>
                    {filtrando ? 'Limpar os filtrados' : 'Limpar'}
                  </button>
                  {casado && <span className="suave">(só os talhões sem PIMS)</span>}
                </div>
                <div className="linha">
                  <input
                    type="date"
                    value={dataLote}
                    onChange={(e) => setDataLote(e.target.value)}
                    aria-label="Data de plantio para os marcados"
                    style={{ width: 'auto' }}
                  />
                  <button type="button" className="botao botao-pequeno" onClick={aplicarDataLote} disabled={selecionados.size === 0}>
                    Aplicar data aos marcados
                  </button>
                </div>
              </>
            )}
            <div className="tabela-rolagem lista-alta">
              <TabelaPlantio
                talhoes={visiveis}
                pimsDe={pimsDe}
                marcados={marcadosLinhas}
                onAlternar={alternar}
                onData={(idLinha, v) => {
                  const id = manualDe(linhaPorId.get(idLinha));
                  if (id) mudar((m) => ({ ...m, [id]: v }));
                }}
                busca={busca}
                semManual={(l) => !pimsDe(l) && !baseDe.has(l.id)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
