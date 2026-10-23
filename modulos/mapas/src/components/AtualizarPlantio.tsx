import { useEffect, useRef, useState } from 'react';
import { repo } from '../data';
import { atualizarPlantio, lembretePlantio, textoPlantioPims, type AvisoAtualizacao } from '../lib/pedidoPlantio';
import Aviso, { mensagemDeErro } from './Aviso';
import { recarregarPlantioPims, usePlantioPims } from './usePlantioPims';

/** O aviso de sucesso some sozinho depois disso. */
const SUCESSO_MS = 8000;

function podeAtualizar(): boolean {
  try {
    return repo().podeAtualizarPlantio;
  } catch {
    // Supabase mal configurado: a própria tela já mostra o erro ao carregar os dados
    return false;
  }
}

/**
 * Topo das telas Novo mapa e Safras: data do plantio do PIMS e o botão "Atualizar plantio", que pede ao
 * servidor do COA WEB para buscar o plantio no PIMS agora (mapa feito logo depois do apontamento do plantio). Desde
 * 23/10/2026 não há mais rotina de cada hora: o plantio só muda quando alguém clica em Atualizar, e por isso toda vez que
 * a tela abre aparece o lembrete com a data do plantio e o "Atualizar agora". Ao terminar, todas as telas abertas passam a usar o plantio
 * novo (recarregarPlantioPims). Só no COA WEB (Supabase): no modo local não aparece.
 */
export default function AtualizarPlantio() {
  const arquivo = usePlantioPims();
  /** texto da etapa em andamento; null = parado */
  const [etapa, setEtapa] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoAtualizacao | null>(null);
  /** o lembrete de atualizar: aparece toda vez que a tela abre; some no × ou depois de atualizar */
  const [lembrete, setLembrete] = useState(true);
  /** trava contra o segundo clique antes de a tela re-renderizar com o botão desabilitado */
  const rodando = useRef(false);

  useEffect(() => {
    if (aviso?.tipo !== 'sucesso') return;
    const t = setTimeout(() => setAviso(null), SUCESSO_MS);
    return () => clearTimeout(t);
  }, [aviso]);

  if (!podeAtualizar()) return null;
  const textoDoLembrete = lembretePlantio(arquivo === undefined ? undefined : (arquivo?.geradoEm ?? null));

  const atualizar = async () => {
    if (rodando.current) return;
    rodando.current = true;
    setAviso(null);
    try {
      const r = repo();
      const fim = await atualizarPlantio({
        pedir: () => r.pedirAtualizacaoPlantio(),
        situacao: (id) => r.situacaoPedidoPlantio(id),
        recarregar: recarregarPlantioPims,
        aoEtapa: setEtapa,
      });
      setAviso(fim);
      if (fim.tipo === 'sucesso') setLembrete(false);
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDeErro(e) });
    } finally {
      rodando.current = false;
      setEtapa(null);
    }
  };

  return (
    <>
      <div className="atualizar-plantio">
        <span className="suave" aria-live="polite">
          {etapa ?? textoPlantioPims(arquivo === undefined ? undefined : (arquivo?.geradoEm ?? null))}
        </span>
        <button
          type="button"
          className="botao botao-pequeno"
          disabled={etapa !== null}
          title="Busca agora no PIMS o plantio de todas as fazendas (os dados só mudam quando alguém clica em Atualizar)"
          onClick={() => void atualizar()}
        >
          ↻ Atualizar plantio
        </button>
      </div>
      {aviso && (
        <Aviso tipo={aviso.tipo} onFechar={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}
      {lembrete && !aviso && etapa === null && textoDoLembrete && (
        <Aviso tipo={textoDoLembrete.recente ? 'info' : 'alerta'} onFechar={() => setLembrete(false)}>
          {textoDoLembrete.texto}{' '}
          <button type="button" className="botao botao-pequeno" onClick={() => void atualizar()}>
            ↻ Atualizar agora
          </button>
        </Aviso>
      )}
    </>
  );
}
