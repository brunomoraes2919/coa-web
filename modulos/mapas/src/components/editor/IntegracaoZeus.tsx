import { useRef, useState } from 'react';
import { repo } from '../../data';
import { buscarChuvaZeus, validarPeriodo, type ResultadoIntegracao } from '../../lib/chuvaZeus';
import { isoData } from '../../lib/format';
import Aviso, { mensagemDeErro } from '../Aviso';
import Modal from '../Modal';

interface Props {
  /** nome da fazenda escolhida no passo 1 (null = ainda não escolhida) */
  fazendaNome: string | null;
  /** PICs e período prontos, no mesmo formato do CSV */
  onDados(r: ResultadoIntegracao): void;
}

function podeBuscar(): boolean {
  try {
    return repo().podeBuscarChuva;
  } catch {
    // Supabase mal configurado: a própria tela já mostra o erro ao carregar os dados
    return false;
  }
}

function ontem(): string {
  const d = new Date();
  return isoData(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}

/**
 * Botão "Inserir dados via integração" e a janela do período: busca na ZEUS, pelo servidor do COA WEB, a
 * chuva de cada PIC da fazenda entre as duas datas e entrega os PICs como se viessem do CSV. Só no COA
 * WEB (Supabase): no modo local não aparece.
 */
export default function IntegracaoZeus({ fazendaNome, onDados }: Props) {
  const [aberto, setAberto] = useState(false);
  const [de, setDe] = useState(ontem);
  const [ate, setAte] = useState(ontem);
  /** texto da etapa em andamento; null = parado */
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** busca em andamento que ainda vale (fechar a janela descarta a resposta) */
  const busca = useRef(0);

  if (!podeBuscar()) return null;

  const hoje = isoData(new Date());
  const fechar = () => {
    busca.current += 1;
    setEtapa(null);
    setErro(null);
    setAberto(false);
  };

  const buscar = async () => {
    if (etapa !== null || !fazendaNome) return;
    const invalido = validarPeriodo(de, ate, hoje);
    if (invalido) {
      setErro(invalido);
      return;
    }
    setErro(null);
    const esta = ++busca.current;
    try {
      const r = repo();
      const fim = await buscarChuvaZeus({
        pedir: () => r.pedirChuvaZeus({ fazenda: fazendaNome, de, ate }),
        situacao: (id) => r.situacaoPedidoChuva(id),
        aoEtapa: (t) => busca.current === esta && setEtapa(t),
      });
      if (busca.current !== esta) return; // a janela foi fechada no meio da busca
      if (fim.tipo === 'erro') {
        setErro(fim.texto);
        return;
      }
      onDados(fim.resultado);
      setAberto(false);
    } catch (e) {
      if (busca.current === esta) setErro(mensagemDeErro(e));
    } finally {
      if (busca.current === esta) setEtapa(null);
    }
  };

  return (
    <>
      <div className="integracao-zeus">
        <span className="suave">ou, sem exportar o CSV:</span>
        <button
          type="button"
          className="botao"
          disabled={!fazendaNome}
          title={fazendaNome ? 'Busca na ZEUS a chuva de cada PIC da fazenda no período que você escolher' : 'Escolha a fazenda primeiro (passo 1)'}
          onClick={() => {
            setErro(null);
            setAberto(true);
          }}
        >
          Inserir dados via integração
        </button>
      </div>
      <Modal
        aberto={aberto}
        titulo="Inserir dados via integração"
        onFechar={fechar}
        acoes={
          <>
            <button type="button" className="botao" onClick={fechar}>
              Cancelar
            </button>
            <button type="button" className="botao botao-primario" disabled={etapa !== null} onClick={() => void buscar()}>
              {etapa !== null ? 'Buscando…' : 'Buscar dados'}
            </button>
          </>
        }
      >
        <div className="pilha">
          <p>
            Busca na ZEUS a chuva de cada PIC da fazenda <strong>{fazendaNome}</strong> no período abaixo e carrega os PICs, como no CSV.
          </p>
          <div className="linha integracao-periodo">
            <label className="campo">
              <span>De</span>
              <input type="date" value={de} max={hoje} disabled={etapa !== null} onChange={(e) => setDe(e.target.value)} />
            </label>
            <label className="campo">
              <span>Até</span>
              <input type="date" value={ate} max={hoje} disabled={etapa !== null} onChange={(e) => setAte(e.target.value)} />
            </label>
          </div>
          <p className="suave">As duas datas entram no total. Para a chuva de um dia só, repita a mesma data.</p>
          {etapa !== null && (
            <p className="suave" aria-live="polite">
              {etapa}
            </p>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </div>
      </Modal>
    </>
  );
}
