/**
 * Botão "Atualizar plantio": o navegador grava um pedido em mapas_plantio_pedidos e o servidor (que
 * confere os pedidos pendentes a cada ~30 s) roda a rotina do PIMS e marca o pedido como atendido,
 * com resultado 'ok' ou 'erro: <mensagem>'. Aqui ficam a espera pela resposta e o fluxo do botão, com
 * os textos. Puro (repositório, releitura e `dormir` são injetados; os testes não esperam de verdade).
 */

import { mensagemDeErro } from './erros';
import { fmtDataHora } from './situacaoPlantio';

/** Situação de um pedido (colunas atendido_em e resultado). */
export interface SituacaoPedidoPlantio {
  /** ISO; null enquanto o servidor não atendeu */
  atendidoEm: string | null;
  /** 'ok' ou 'erro: <mensagem>' (null enquanto pendente) */
  resultado: string | null;
}

export type FimPedidoPlantio = { tipo: 'ok' } | { tipo: 'erro'; mensagem: string } | { tipo: 'tempo' };

export interface OpcoesAguardar {
  /** espera antes de cada leitura (padrão 4 s) */
  intervaloMs?: number;
  /** tempo total de espera; passou disso sem resposta → { tipo: 'tempo' } (padrão 150 s) */
  limiteMs?: number;
  dormir?: (ms: number) => Promise<void>;
}

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mensagem do servidor sem o prefixo "erro: " (vazia → "sem detalhes"). */
function mensagemDoResultado(resultado: string | null): string {
  const msg = (resultado ?? '').replace(/^\s*erro:\s*/i, '').trim();
  return msg || 'sem detalhes';
}

/**
 * Lê a situação do pedido a cada `intervaloMs` (esperando antes de cada leitura) até ele ser atendido
 * ou o tempo acabar; a última leitura é feita no limite. Pedido não encontrado (null) conta como
 * pendente; falha na leitura (rede...) é passageira: fica no console e a leitura é repetida.
 */
export async function aguardarPedido(
  ler: () => Promise<SituacaoPedidoPlantio | null>,
  { intervaloMs = 4000, limiteMs = 150000, dormir = dormirDeVerdade }: OpcoesAguardar = {},
): Promise<FimPedidoPlantio> {
  let esperado = 0;
  while (esperado < limiteMs) {
    const espera = Math.min(intervaloMs, limiteMs - esperado);
    await dormir(espera);
    esperado += espera;
    let s: SituacaoPedidoPlantio | null;
    try {
      s = await ler();
    } catch (e) {
      console.warn('Não foi possível ler a situação do pedido de atualização do plantio (tentando de novo)', e);
      continue;
    }
    if (s?.atendidoEm) return s.resultado?.trim() === 'ok' ? { tipo: 'ok' } : { tipo: 'erro', mensagem: mensagemDoResultado(s.resultado) };
  }
  return { tipo: 'tempo' };
}

/** "Plantio do PIMS: dd/MM HH:mm" (hora local); sem plantio → "sem dados"; carregando (undefined) → "…". */
export function textoPlantioPims(geradoEm: string | null | undefined): string {
  if (geradoEm === undefined) return 'Plantio do PIMS: …';
  return `Plantio do PIMS: ${fmtDataHora(geradoEm, true) || 'sem dados'}`;
}

export const ETAPA_PEDINDO = 'Pedindo ao servidor…';
export const ETAPA_BUSCANDO = 'Buscando no PIMS… (até 1 minuto)';

export interface PassosAtualizacao {
  /** grava o pedido; devolve o id (repo().pedirAtualizacaoPlantio) */
  pedir(): Promise<number>;
  /** repo().situacaoPedidoPlantio */
  situacao(id: number): Promise<SituacaoPedidoPlantio | null>;
  /** relê o plantio e avisa as telas (recarregarPlantioPims) */
  recarregar(): Promise<{ geradoEm: string } | null>;
  /** texto da etapa em andamento, para a tela */
  aoEtapa?(texto: string): void;
  opcoes?: OpcoesAguardar;
}

export interface AvisoAtualizacao {
  tipo: 'sucesso' | 'erro' | 'alerta';
  texto: string;
}

/**
 * Fluxo do botão "Atualizar plantio": grava o pedido, espera o servidor atendê-lo (aguardarPedido) e, se
 * deu certo, relê o plantio (as telas abertas mostram o novo). Nunca rejeita: devolve o aviso final.
 */
export async function atualizarPlantio({ pedir, situacao, recarregar, aoEtapa, opcoes }: PassosAtualizacao): Promise<AvisoAtualizacao> {
  aoEtapa?.(ETAPA_PEDINDO);
  let id: number;
  try {
    id = await pedir();
  } catch (e) {
    return { tipo: 'erro', texto: mensagemDeErro(e) };
  }
  aoEtapa?.(ETAPA_BUSCANDO);
  const fim = await aguardarPedido(() => situacao(id), opcoes);
  if (fim.tipo === 'erro') return { tipo: 'erro', texto: `O servidor não conseguiu atualizar o plantio: ${fim.mensagem}` };
  if (fim.tipo === 'tempo') {
    return { tipo: 'alerta', texto: 'O servidor não respondeu em 2 minutos. O plantio também é atualizado sozinho a cada hora.' };
  }
  try {
    const arquivo = await recarregar();
    return { tipo: 'sucesso', texto: `Plantio atualizado: PIMS ${fmtDataHora(arquivo?.geradoEm, true) || 'sem dados'}` };
  } catch (e) {
    return { tipo: 'erro', texto: `O servidor atualizou o plantio, mas não foi possível carregá-lo: ${mensagemDeErro(e)} Recarregue a página.` };
  }
}
