import { useCallback, useEffect, useRef, useState } from 'react';
import { repo } from '../../data';
import { buscarChuvaZeus, validarPeriodo, type ResultadoIntegracao } from '../../lib/chuvaZeus';
import { isoData } from '../../lib/format';
import { avisoDoPeriodo, dataSugerida, situacaoDaFazenda, textoSituacao, type SituacaoZeus } from '../../lib/situacaoZeus';
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
  /** opção de informar também a hora inicial e a final (padrão: só as datas, dias inteiros) */
  const [comHora, setComHora] = useState(false);
  const [deHora, setDeHora] = useState('00:00');
  const [ateHora, setAteHora] = useState('23:59');
  /** texto da etapa em andamento; null = parado */
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** busca em andamento que ainda vale (fechar a janela descarta a resposta) */
  const busca = useRef(0);
  /** último dia de cada fazenda da ZEUS no banco (vazio = o servidor ainda não gravou: sem aviso) */
  const [situacoes, setSituacoes] = useState<SituacaoZeus[]>([]);
  /** quem mexeu nas datas fica com as que escolheu; senão a janela sugere o último dia com dados */
  const mexeuNasDatas = useRef(false);

  const lerSituacao = useCallback(() => {
    if (!podeBuscar()) return;
    let vivo = true;
    void repo()
      .situacaoZeus()
      .then((l) => vivo && setSituacoes(l))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);
  useEffect(() => lerSituacao(), [lerSituacao]);

  if (!podeBuscar()) return null;

  const hoje = isoData(new Date());
  const situacao = situacaoDaFazenda(situacoes, fazendaNome);
  const texto = situacao ? textoSituacao(situacao) : null;
  const linhaSituacao = texto && (
    <>
      ZEUS no banco até <strong>{texto.dia}</strong> ({texto.quando}) · {texto.conferido}
    </>
  );
  // com hora, pedir até um instante que a ZEUS já tem não merece aviso, mesmo com o dia pela metade
  const horaJaChegou = comHora && !!situacao?.ultimaHora && ate === situacao.ultimoDia && ateHora <= situacao.ultimaHora;
  const avisoPeriodo = horaJaChegou ? null : avisoDoPeriodo(ate, situacao?.ultimoDia, situacao?.ultimaHora);
  const fechar = () => {
    busca.current += 1;
    setEtapa(null);
    setErro(null);
    setAberto(false);
  };

  const buscar = async () => {
    if (etapa !== null || !fazendaNome) return;
    const invalido = comHora ? validarPeriodo(de, ate, hoje, deHora, ateHora) : validarPeriodo(de, ate, hoje);
    if (invalido) {
      setErro(invalido);
      return;
    }
    setErro(null);
    const esta = ++busca.current;
    try {
      const r = repo();
      const fim = await buscarChuvaZeus({
        pedir: () => r.pedirChuvaZeus(comHora ? { fazenda: fazendaNome, de, ate, deHora, ateHora } : { fazenda: fazendaNome, de, ate }),
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
            if (!mexeuNasDatas.current) {
              const sugerida = dataSugerida(ontem(), situacao?.ultimoDia);
              setDe(sugerida);
              setAte(sugerida);
            }
            setAberto(true);
            lerSituacao(); // a carga da ZEUS pode ter chegado desde que a página abriu
          }}
        >
          Inserir dados via integração
        </button>
        {linhaSituacao && (
          <span
            className={`integracao-situacao suave${texto?.atrasado ? ' atrasado' : ''}`}
            title="Última leitura de chuva desta fazenda no banco da ZEUS. Pedir um período depois dela traz o total incompleto."
          >
            {linhaSituacao}
          </span>
        )}
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
              <input
                type="date"
                value={de}
                max={hoje}
                disabled={etapa !== null}
                onChange={(e) => {
                  mexeuNasDatas.current = true;
                  setDe(e.target.value);
                }}
              />
            </label>
            {comHora && (
              <label className="campo">
                <span>Hora inicial</span>
                <input type="time" value={deHora} disabled={etapa !== null} onChange={(e) => setDeHora(e.target.value)} />
              </label>
            )}
            <label className="campo">
              <span>Até</span>
              <input
                type="date"
                value={ate}
                max={hoje}
                disabled={etapa !== null}
                onChange={(e) => {
                  mexeuNasDatas.current = true;
                  setAte(e.target.value);
                }}
              />
            </label>
            {comHora && (
              <label className="campo">
                <span>Hora final</span>
                <input type="time" value={ateHora} disabled={etapa !== null} onChange={(e) => setAteHora(e.target.value)} />
              </label>
            )}
          </div>
          <label className="integracao-opcao">
            <input type="checkbox" checked={comHora} disabled={etapa !== null} onChange={(e) => setComHora(e.target.checked)} />
            <span>Informar também a hora inicial e a final</span>
          </label>
          <p className="suave">
            {comHora
              ? 'Entram as leituras entre a data e hora inicial e a data e hora final, as duas inclusive. As leituras da ZEUS são de hora em hora.'
              : 'As duas datas entram no total, com o dia inteiro. Para a chuva de um dia só, repita a mesma data.'}
          </p>
          {linhaSituacao && <p className={`integracao-situacao suave${texto?.atrasado ? ' atrasado' : ''}`}>{linhaSituacao}</p>}
          {avisoPeriodo && <p className="integracao-aviso">{avisoPeriodo}</p>}
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
