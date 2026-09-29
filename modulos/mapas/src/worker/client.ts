import type { PipelineInput, PipelineOutput } from '../lib/pipeline';

type Resposta =
  | { id: number; tipo: 'progresso'; f: number }
  | { id: number; tipo: 'ok'; out: PipelineOutput }
  | { id: number; tipo: 'erro'; mensagem: string };

const ERRO_INICIAR = 'Não foi possível iniciar o cálculo da interpolação neste navegador. Recarregue a página e tente de novo.';
const ERRO_WORKER = 'Falha no cálculo da interpolação. Recarregue a página e tente de novo.';
const ERRO_RESPOSTA = 'Não foi possível receber o resultado da interpolação. Recarregue a página e tente de novo.';

/** Cancela a execução em andamento (rejeita a promessa dela com AbortError). */
let cancelarAtual: (() => void) | null = null;
let seq = 0;

/**
 * Interpola num Web Worker. Uma nova chamada cancela a anterior (a promessa anterior é rejeitada
 * com AbortError). Qualquer falha rejeita com mensagem em português; nunca lança de forma síncrona.
 */
export function interpolar(inp: PipelineInput, onProgress?: (f: number) => void): Promise<PipelineOutput> {
  cancelarInterpolacao();
  const id = ++seq;
  return new Promise<PipelineOutput>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./interpolate.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      console.error('Falha ao criar o worker da interpolação', e);
      reject(new Error(ERRO_INICIAR));
      return;
    }
    let encerrado = false;
    const encerrar = () => {
      encerrado = true;
      worker.terminate();
      if (cancelarAtual === cancelar) cancelarAtual = null;
    };
    const falhar = (mensagem: string) => {
      if (encerrado) return;
      encerrar();
      reject(new Error(mensagem));
    };
    const cancelar = () => {
      if (encerrado) return;
      encerrar();
      reject(new DOMException('Interpolação cancelada', 'AbortError'));
    };
    cancelarAtual = cancelar;

    worker.onmessage = (e: MessageEvent<Resposta>) => {
      const r = e.data;
      if (encerrado || r?.id !== id) return;
      if (r.tipo === 'progresso') onProgress?.(r.f);
      else if (r.tipo === 'ok') {
        encerrar();
        resolve(r.out);
      } else falhar(r.mensagem || ERRO_WORKER); // o worker já manda a mensagem traduzida (mensagemErroInterpolacao)
    };
    worker.onerror = (e) => {
      // a mensagem do navegador pode vir em inglês: fica só no console
      console.error('Erro no worker da interpolação', e.message || e);
      e.preventDefault();
      falhar(ERRO_WORKER);
    };
    worker.onmessageerror = (e) => {
      console.error('Resposta ilegível do worker da interpolação', e);
      falhar(ERRO_RESPOSTA);
    };
    try {
      worker.postMessage({ id, inp });
    } catch (e) {
      console.error('Falha ao enviar os dados para o worker da interpolação', e);
      falhar(ERRO_INICIAR);
    }
  });
}

export function cancelarInterpolacao(): void {
  cancelarAtual?.();
}
