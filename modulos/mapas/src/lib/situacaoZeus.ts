/**
 * Até que dia a ZEUS tem dados no banco: o servidor do COA WEB confere, a cada ~15 min, o último dia com
 * leitura de chuva de cada fazenda e grava em mapas_zeus_situacao. A tela mostra isso ao lado do botão
 * "Inserir dados via integração", para ninguém pedir um período que ainda não chegou. Puro.
 */

import { fmtData, isoData, parseIsoData } from './format';

/** Linha de mapas_zeus_situacao. */
export interface SituacaoZeus {
  /** fazenda da ZEUS, normalizada como no pedido de chuva ('SM3', 'TRES FLECHAS') */
  fazenda: string;
  /** último dia com leitura de chuva, 'yyyy-mm-dd' */
  ultimoDia: string;
  /** hora da última leitura desse dia, 'hh:mm' (hora da fazenda); null = não veio */
  ultimaHora: string | null;
  /** quando o servidor conferiu (ISO) */
  conferidoEm: string;
}

/** O que a tela mostra para a fazenda escolhida (ou para todas, sem fazenda). */
export interface SituacaoDaFazenda {
  ultimoDia: string;
  ultimaHora: string | null;
  conferidoEm: string;
  /** false = sem fazenda escolhida: é o dia mais recente entre todas */
  daFazenda: boolean;
}

/**
 * Nome da fazenda como o servidor casa as fazendas da ZEUS (unidadeDaFazendaZeus em
 * scripts/sincronizar-plantio.mjs): sem acento, caixa nem o prefixo "Fazenda"/"Faz".
 */
export function chaveFazendaZeus(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .replace(/^(FAZENDA|FAZ)(?=[\s._-])[\s._-]*/, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const momento = (l: SituacaoZeus) => `${l.ultimoDia} ${l.ultimaHora ?? ''}`;

/** A situação da fazenda do mapa; sem fazenda escolhida, a leitura mais recente entre todas; desconhecida → null. */
export function situacaoDaFazenda(lista: SituacaoZeus[], fazendaNome: string | null): SituacaoDaFazenda | null {
  if (!lista.length) return null;
  if (fazendaNome === null) {
    const maisNova = lista.reduce((m, l) => (momento(l) > momento(m) ? l : m));
    return { ultimoDia: maisNova.ultimoDia, ultimaHora: maisNova.ultimaHora, conferidoEm: maisNova.conferidoEm, daFazenda: false };
  }
  const chave = chaveFazendaZeus(fazendaNome);
  const linha = lista.find((l) => l.fazenda === chave);
  return linha ? { ultimoDia: linha.ultimoDia, ultimaHora: linha.ultimaHora, conferidoEm: linha.conferidoEm, daFazenda: true } : null;
}

const dois = (n: number) => String(n).padStart(2, '0');

export interface TextoSituacao {
  /** '05/10/2026 às 23:00' (ou só o dia, sem a hora da leitura) */
  dia: string;
  /** 'hoje', 'ontem' ou 'há N dias' */
  quando: string;
  /** 'conferido hoje às 08:17' ou 'conferido em 05/10 às 22:17' */
  conferido: string;
  /** o último dia é anterior a ontem: os dados estão parados */
  atrasado: boolean;
}

/** Os pedaços do aviso "ZEUS no banco até 05/10/2026 às 23:00 (ontem) · conferido hoje às 08:17". */
export function textoSituacao(s: SituacaoDaFazenda, agora: Date = new Date()): TextoSituacao {
  const ultimo = parseIsoData(s.ultimoDia) as Date;
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dias = Math.round((hoje.getTime() - ultimo.getTime()) / 86_400_000);
  const quando = dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
  const c = new Date(s.conferidoEm);
  const hora = `${dois(c.getHours())}:${dois(c.getMinutes())}`;
  const conferido = isoData(c) === isoData(agora) ? `conferido hoje às ${hora}` : `conferido em ${dois(c.getDate())}/${dois(c.getMonth() + 1)} às ${hora}`;
  return { dia: s.ultimaHora ? `${fmtData(ultimo)} às ${s.ultimaHora}` : fmtData(ultimo), quando, conferido, atrasado: dias > 1 };
}

/** a partir desta hora o dia está fechado: as leituras são de hora em hora (a última do dia é às 23:00) */
const HORA_DIA_FECHADO = '23:00';

/**
 * Aviso quando o "até" do período passa do último dia que a ZEUS tem, ou cai num dia ainda pela metade
 * (`ultimaHora` antes das 23:00); null = sem aviso.
 */
export function avisoDoPeriodo(ate: string, ultimoDia: string | null | undefined, ultimaHora?: string | null): string | null {
  const fim = parseIsoData(ate);
  const ultimo = parseIsoData(ultimoDia);
  if (!fim || !ultimo || !ultimoDia) return null;
  if (ate === ultimoDia && ultimaHora && ultimaHora < HORA_DIA_FECHADO) {
    return `A ZEUS só tem leituras de ${fmtData(ultimo)} até as ${ultimaHora}: o total desse dia ainda está incompleto.`;
  }
  if (ate <= ultimoDia) return null;
  const seguinte = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + 1);
  const umDiaSo = isoData(seguinte) === ate;
  return `A ZEUS só tem dados no banco até ${fmtData(ultimo)}: a chuva de ${fmtData(seguinte)}${umDiaSo ? '' : ' em diante'} ainda não chegou e não entra no total.`;
}

/** Data que a janela sugere: ontem, ou o último dia da ZEUS se ele for anterior. */
export function dataSugerida(ontem: string, ultimoDia: string | null | undefined): string {
  return ultimoDia && ultimoDia < ontem ? ultimoDia : ontem;
}
