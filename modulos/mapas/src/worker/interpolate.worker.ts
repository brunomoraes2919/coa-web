/** Roda a interpolação fora da thread da interface. */
import { mensagemErroInterpolacao } from '../lib/erros';
import { runPipeline, type PipelineInput } from '../lib/pipeline';

interface Pedido {
  id: number;
  inp: PipelineInput;
}

const escopo = self as unknown as {
  onmessage: ((e: MessageEvent<Pedido>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

escopo.onmessage = (e) => {
  const { id, inp } = e.data;
  try {
    let ultimo = -1;
    const out = runPipeline(inp, (f) => {
      const pct = Math.floor(f * 100);
      if (pct !== ultimo) {
        ultimo = pct;
        escopo.postMessage({ id, tipo: 'progresso', f });
      }
    });
    escopo.postMessage({ id, tipo: 'ok', out }, [out.grid.values.buffer]);
  } catch (err) {
    // erros do pipeline já vêm em português; os inesperados (em inglês) são traduzidos e o detalhe fica no console
    if (!(err instanceof Error && err.name === 'ErroPipeline')) console.error('Erro inesperado na interpolação', err);
    escopo.postMessage({ id, tipo: 'erro', mensagem: mensagemErroInterpolacao(err) });
  }
};
