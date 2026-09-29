import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import Modal from '../components/Modal';
import '../components/editor/editor.css';
import { baixarDeUrl, nomeArquivoMapa } from '../lib/exportar';
import { fmtPeriodo, parseIsoData } from '../lib/format';
import { extensaoImagem, rotuloBaixarHistorico } from '../lib/historico';
import type { Fazenda, MapaSalvo, Safra } from '../lib/types';

interface Item {
  mapa: MapaSalvo;
  thumb: string | null;
}

const mm = (v: number) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—');
const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

/** Histórico de mapas gerados. */
export default function Mapas() {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [fazendas, setFazendas] = useState<Fazenda[]>([]);
  const [safras, setSafras] = useState<Safra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<MapaSalvo | null>(null);
  const [filtro, setFiltro] = useState('');
  /** id do mapa cuja imagem está sendo baixada */
  const [baixando, setBaixando] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    /** object URLs das miniaturas (modo local), revogadas ao sair da página */
    const urls: string[] = [];
    const registrar = (url: string | null) => {
      if (!url?.startsWith('blob:')) return url;
      if (!ativo) {
        URL.revokeObjectURL(url); // criada depois de sair da página
        return null;
      }
      urls.push(url);
      return url;
    };
    (async () => {
      try {
        const r = repo();
        const [ms, fs, ss] = await Promise.all([r.listarMapas(), r.listarFazendas(), r.listarSafras()]);
        const lista = await Promise.all(
          ms.map(async (mapa) => {
            const thumb = mapa.thumbPath ? registrar(await r.urlArquivo(mapa.thumbPath).catch(() => null)) : null;
            return { mapa, thumb };
          }),
        );
        if (!ativo) return;
        setFazendas(fs);
        setSafras(ss);
        setItens(lista);
      } catch (e) {
        if (ativo) {
          setErro(`Não foi possível carregar o histórico: ${mensagemDeErro(e)}`);
          setItens([]);
        }
      }
    })();
    return () => {
      ativo = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const baixar = async (m: MapaSalvo) => {
    if (!m.pngPath) return;
    setBaixando(m.id);
    let url: string | null = null;
    try {
      // local: object URL; Supabase: signed URL de outro domínio (o atributo download seria ignorado).
      // A extensão segue o tipo do arquivo guardado: JPEG (mapas novos) ou PNG (mapas antigos).
      url = await repo().urlArquivo(m.pngPath);
      const fazenda = m.config.textos.fazenda || nomeFazenda(m.fazendaId);
      await baixarDeUrl(url, (blob) => nomeArquivoMapa(fazenda, m.config.textos.periodo, extensaoImagem(blob.type)));
    } catch (e) {
      setErro(`Não foi possível baixar a imagem: ${mensagemDeErro(e)}`);
    } finally {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
      setBaixando(null);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    try {
      await repo().excluirMapa(excluir);
      const thumb = itens?.find((i) => i.mapa.id === excluir.id)?.thumb;
      if (thumb?.startsWith('blob:')) URL.revokeObjectURL(thumb);
      setItens((l) => l?.filter((i) => i.mapa.id !== excluir.id) ?? l);
    } catch (e) {
      setErro(`Não foi possível excluir: ${mensagemDeErro(e)}`);
    } finally {
      setExcluir(null);
    }
  };

  const nomeFazenda = (id: string) => fazendas.find((f) => f.id === id)?.nome ?? 'Fazenda removida';
  const nomeSafra = (id: string | null) => (id ? safras.find((s) => s.id === id)?.nome ?? '' : '');
  const visiveis = (itens ?? []).filter(({ mapa }) => {
    const t = filtro.trim().toLowerCase();
    return !t || `${nomeFazenda(mapa.fazendaId)} ${nomeSafra(mapa.safraId)} ${mapa.titulo}`.toLowerCase().includes(t);
  });

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>Mapas de chuva</h1>
          <p className="subtitulo">Histórico dos mapas gerados. Abra um mapa para editar, atualizar ou salvar uma cópia.</p>
        </div>
        <Link to="/mapas/novo" className="botao botao-primario">
          Novo mapa
        </Link>
      </div>
      {erro && (
        <Aviso tipo="erro" onFechar={() => setErro(null)}>
          {erro}
        </Aviso>
      )}
      {!itens ? (
        <Carregando texto="Carregando histórico…" />
      ) : itens.length === 0 ? (
        <div className="cartao vazio">
          <p>Nenhum mapa gerado ainda.</p>
          <p className="suave">
            Comece cadastrando uma <Link to="/fazendas/nova">fazenda</Link>, depois crie um <Link to="/mapas/novo">novo mapa</Link> com o CSV da
            ZEUS.
          </p>
        </div>
      ) : (
        <>
          <input type="search" placeholder="Filtrar por fazenda, safra ou período…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar mapas" />
          <div className="grade-mapas">
            {visiveis.map(({ mapa, thumb }) => (
              <article key={mapa.id} className="cartao mapa-cartao">
                <Link to={`/mapas/${mapa.id}`} aria-label={`Abrir ${mapa.titulo}`}>
                  {thumb ? <img className="miniatura" src={thumb} alt="" /> : <div className="miniatura miniatura-vazia">sem miniatura</div>}
                </Link>
                <div className="mapa-cartao-corpo">
                  <h3>{nomeFazenda(mapa.fazendaId)}</h3>
                  <span className="suave">
                    {fmtPeriodo(parseIsoData(mapa.periodoInicio), parseIsoData(mapa.periodoFim)) || 'sem período'}
                    {nomeSafra(mapa.safraId) ? ` · ${nomeSafra(mapa.safraId)}` : ''}
                  </span>
                  <span className="suave">
                    Média {mm(mapa.resumo.geral.media)} mm
                    {mapa.resumo.plantado ? ` · plantado ${mm(mapa.resumo.plantado.media)} mm` : ''} · criado em {dataCurta(mapa.criadoEm)}
                  </span>
                  <div className="linha">
                    <Link to={`/mapas/${mapa.id}`} className="botao botao-pequeno">
                      Abrir
                    </Link>
                    {mapa.pngPath ? (
                      <button
                        type="button"
                        className="botao botao-pequeno"
                        disabled={baixando === mapa.id}
                        title="Cópia guardada no histórico. Para outra resolução, abra o mapa e baixe o PNG."
                        onClick={() => void baixar(mapa)}
                      >
                        {baixando === mapa.id ? 'Baixando…' : rotuloBaixarHistorico(mapa.pngPath)}
                      </button>
                    ) : null}
                    <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => setExcluir(mapa)}>
                      Excluir
                    </button>
                  </div>
                  {!mapa.pngPath && <span className="suave">Imagem não disponível — abra o mapa para gerar de novo</span>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <Modal
        aberto={!!excluir}
        titulo="Excluir mapa"
        onFechar={() => setExcluir(null)}
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setExcluir(null)}>
              Cancelar
            </button>
            <button type="button" className="botao botao-perigo-cheio" onClick={() => void confirmarExclusao()}>
              Excluir
            </button>
          </>
        }
      >
        <p>Excluir o mapa “{excluir?.titulo}” do histórico? A imagem salva também será apagada.</p>
      </Modal>
    </div>
  );
}
