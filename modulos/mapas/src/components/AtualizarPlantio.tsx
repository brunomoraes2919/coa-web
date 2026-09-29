import { useEffect, useRef, useState } from 'react';
import { repo } from '../data';
import { atualizarPlantio, textoPlantioPims, type AvisoAtualizacao } from '../lib/pedidoPlantio';
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
 * servidor do COA WEB para buscar o plantio no PIMS agora, sem esperar a rotina de cada hora (mapa feito
 * logo depois do apontamento do plantio). Ao terminar, todas as telas abertas passam a usar o plantio
 * novo (recarregarPlantioPims). Só no COA WEB (Supabase): no modo local não aparece.
 */
export default function AtualizarPlantio() {
  const arquivo = usePlantioPims();
  /** texto da etapa em andamento; null = parado */
  const [etapa, setEtapa] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoAtualizacao | null>(null);
  /** trava contra o segundo clique antes de a tela re-renderizar com o botão desabilitado */
  const rodando = useRef(false);

  useEffect(() => {
    if (aviso?.tipo !== 'sucesso') return;
    const t = setTimeout(() => setAviso(null), SUCESSO_MS);
    return () => clearTimeout(t);
  }, [aviso]);

  if (!podeAtualizar()) return null;

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
          title="Busca agora no PIMS o plantio apontado há pouco, sem esperar a atualização automática de cada hora"
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
    </>
  );
}
