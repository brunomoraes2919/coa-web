/**
 * Botão "Inserir dados via integração" do Mapa de Chuva: em vez do CSV exportado da ZEUS, o navegador
 * grava um pedido (fazenda e período) em mapas_chuva_pedidos; o servidor do COA WEB, que confere os
 * pedidos a cada ~30 s, busca na ZEUS a chuva de cada PIC da fazenda no período e grava a resposta no
 * próprio pedido. Aqui ficam a validação do período, a espera pela resposta e a conversão da resposta
 * nos mesmos PICs que o CSV daria. Puro (repositório e `dormir` são injetados).
 */

import { mensagemDeErro } from './erros';
import { fmtData, fmtPeriodo, fmtPeriodoHora, isoData, parseIsoData } from './format';
import { aguardarPedido, type OpcoesAguardar, type SituacaoPedidoPlantio } from './pedidoPlantio';
import type { Pic } from './types';

/** período máximo de um pedido (o mesmo limite do servidor e da tabela) */
export const CHUVA_MAX_DIAS = 366;

export interface PedidoChuva {
  /** nome da fazenda do mapa (o servidor acha a fazenda da ZEUS pelo nome) */
  fazenda: string;
  /** 'yyyy-mm-dd', inclusive */
  de: string;
  /** 'yyyy-mm-dd', inclusive */
  ate: string;
  /** 'hh:mm': só com a opção de informar a hora (as duas ou nenhuma); sem elas, dias inteiros */
  deHora?: string;
  ateHora?: string;
}

export interface PicIntegracao {
  id: string;
  nome: string;
  lat: number;
  lon: number;
  /** mm no período; null = nenhuma leitura no período */
  chuva: number | null;
  leituras: number;
}

/** Resposta do servidor (coluna dados do pedido). */
export interface DadosChuvaZeus {
  fazenda: string;
  de: string;
  ate: string;
  /** 'hh:mm' do pedido com hora (ausentes = dias inteiros) */
  deHora?: string;
  ateHora?: string;
  /** último dia com leitura dentro do período (null = nenhuma leitura) */
  ultimoDia: string | null;
  /** 'yyyy-mm-ddThh:mm' da última leitura do período (hora da fazenda); ausente em respostas antigas */
  ultimaLeitura?: string | null;
  pics: PicIntegracao[];
}

export interface SituacaoPedidoChuva extends SituacaoPedidoPlantio {
  /** resposta do servidor quando resultado = 'ok' */
  dados: unknown;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Mensagem de erro do período (null = pode pedir). `hoje` em 'yyyy-mm-dd'. `deHora` e `ateHora` ('hh:mm')
 * só com a opção de informar a hora: undefined = dias inteiros.
 */
export function validarPeriodo(de: string, ate: string, hoje: string = isoData(new Date()), deHora?: string, ateHora?: string): string | null {
  const d = ISO.test(de) ? parseIsoData(de) : null;
  const a = ISO.test(ate) ? parseIsoData(ate) : null;
  if (!d || !a) return 'Informe as duas datas do período.';
  if (de > ate) return 'A data inicial é depois da final.';
  if (ate > hoje) return 'O período não pode passar de hoje.';
  const dias = Math.round((a.getTime() - d.getTime()) / 86_400_000) + 1;
  if (dias > CHUVA_MAX_DIAS) return `Período muito longo (${dias} dias): o máximo é ${CHUVA_MAX_DIAS} dias.`;
  if (deHora === undefined && ateHora === undefined) return null;
  if (!HORA.test(deHora ?? '') || !HORA.test(ateHora ?? '')) return 'Informe a hora inicial e a final.';
  if (de === ate && (deHora as string) > (ateHora as string)) return 'A hora inicial é depois da final.';
  return null;
}

const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Confere o formato da resposta do servidor; lança Error se não for o esperado. */
export function lerDadosChuva(bruto: unknown): DadosChuvaZeus {
  const o = bruto as Partial<DadosChuvaZeus> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.pics) || typeof o.de !== 'string' || typeof o.ate !== 'string') {
    throw new Error('O servidor devolveu uma resposta que não foi possível ler.');
  }
  const pics: PicIntegracao[] = [];
  for (const p of o.pics as unknown[]) {
    const x = p as Partial<PicIntegracao> | null;
    if (!x || !ehNumero(x.lat) || !ehNumero(x.lon)) continue;
    pics.push({
      id: String(x.id ?? ''),
      nome: String(x.nome ?? '').trim() || `PIC ${String(x.id ?? '')}`,
      lat: x.lat,
      lon: x.lon,
      chuva: ehNumero(x.chuva) && x.chuva >= 0 ? x.chuva : null,
      leituras: ehNumero(x.leituras) ? x.leituras : 0,
    });
  }
  const dados: DadosChuvaZeus = { fazenda: String(o.fazenda ?? ''), de: o.de, ate: o.ate, ultimoDia: typeof o.ultimoDia === 'string' ? o.ultimoDia : null, pics };
  if (typeof o.deHora === 'string' && typeof o.ateHora === 'string' && HORA.test(o.deHora) && HORA.test(o.ateHora)) {
    dados.deHora = o.deHora;
    dados.ateHora = o.ateHora;
  }
  if (typeof o.ultimaLeitura === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.ultimaLeitura)) dados.ultimaLeitura = o.ultimaLeitura.slice(0, 16);
  return dados;
}

export interface ResultadoIntegracao {
  /** nome mostrado no lugar do nome do arquivo CSV (e salvo com o mapa) */
  nome: string;
  pics: Pic[];
  inicio: Date | null;
  fim: Date | null;
  /** o período veio com hora (opção de informar a hora): o mapa mostra data e hora */
  comHora: boolean;
  avisos: string[];
}

/** 'yyyy-mm-dd' + 'hh:mm' → Date local */
function dataComHora(dia: string, hora: string): Date | null {
  const d = parseIsoData(dia);
  const m = HORA.test(hora) ? hora.split(':').map(Number) : null;
  return d && m ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), m[0], m[1]) : null;
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

/**
 * Resposta do servidor → os mesmos PICs que o CSV daria (período nas datas do pedido; PIC sem leitura
 * fica desmarcado). Nenhum PIC com leitura → Error (não há o que interpolar).
 */
export function picsDaIntegracao(dados: DadosChuvaZeus): ResultadoIntegracao {
  const comHora = Boolean(dados.deHora && dados.ateHora);
  const inicio = comHora ? dataComHora(dados.de, dados.deHora as string) : parseIsoData(dados.de);
  const fim = comHora ? dataComHora(dados.ate, dados.ateHora as string) : parseIsoData(dados.ate);
  const pics: Pic[] = dados.pics.map((p) => ({
    id: p.id,
    nome: p.nome,
    lat: p.lat,
    lon: p.lon,
    chuva: p.chuva,
    inativo: false,
    inicio,
    fim,
    incluir: p.chuva !== null,
  }));
  const periodo = comHora ? fmtPeriodoHora(inicio, fim) : fmtPeriodo(inicio, fim);
  if (!pics.length) throw new Error('A ZEUS não devolveu nenhum PIC para esta fazenda.');
  const semLeitura = pics.filter((p) => p.chuva === null).length;
  if (semLeitura === pics.length) {
    throw new Error(`Nenhum PIC desta fazenda tem leitura na ZEUS em ${periodo}. Os dados do dia podem ainda não ter chegado: tente um período anterior.`);
  }
  const avisos: string[] = [];
  if (semLeitura > 0) avisos.push(plural(semLeitura, 'PIC sem leitura no período foi desmarcado', 'PICs sem leitura no período foram desmarcados'));
  const ultimo = parseIsoData(dados.ultimoDia);
  if (comHora) {
    // com hora, o que conta é o instante da última leitura
    const lida = dados.ultimaLeitura ?? null;
    if (lida && lida < `${dados.ate}T${dados.ateHora}`) {
      avisos.push(`A ZEUS só tem leituras até ${fmtData(parseIsoData(lida) as Date)} ${lida.slice(11, 16)}: o que choveu depois disso ainda não entrou no total.`);
    }
  } else if (ultimo && fim && dados.ultimoDia! < dados.ate) {
    avisos.push(`A ZEUS só tem leituras até ${fmtData(ultimo)}: a chuva de ${fmtData(new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + 1))} em diante ainda não entrou no total.`);
  }
  return { nome: `Integração ZEUS · ${periodo}`, pics, inicio, fim, comHora, avisos };
}

export const ETAPA_PEDINDO_CHUVA = 'Pedindo ao servidor…';
export const ETAPA_BUSCANDO_CHUVA = 'Buscando na ZEUS… (até 1 minuto)';

export interface PassosChuva {
  /** grava o pedido; devolve o id (repo().pedirChuvaZeus) */
  pedir(): Promise<number>;
  /** repo().situacaoPedidoChuva */
  situacao(id: number): Promise<SituacaoPedidoChuva | null>;
  /** texto da etapa em andamento, para a tela */
  aoEtapa?(texto: string): void;
  opcoes?: OpcoesAguardar;
}

export type FimChuva = { tipo: 'ok'; resultado: ResultadoIntegracao } | { tipo: 'erro'; texto: string };

/**
 * Fluxo do botão: grava o pedido, espera o servidor responder e converte a resposta em PICs. Nunca
 * rejeita: devolve os PICs ou o texto do erro.
 */
export async function buscarChuvaZeus({ pedir, situacao, aoEtapa, opcoes }: PassosChuva): Promise<FimChuva> {
  aoEtapa?.(ETAPA_PEDINDO_CHUVA);
  let id: number;
  try {
    id = await pedir();
  } catch (e) {
    return { tipo: 'erro', texto: mensagemDeErro(e) };
  }
  aoEtapa?.(ETAPA_BUSCANDO_CHUVA);
  let ultima: SituacaoPedidoChuva | null = null;
  const fim = await aguardarPedido(async () => (ultima = await situacao(id)), opcoes);
  if (fim.tipo === 'erro') return { tipo: 'erro', texto: `O servidor não conseguiu buscar a chuva: ${fim.mensagem}` };
  if (fim.tipo === 'tempo') return { tipo: 'erro', texto: 'O servidor não respondeu em 2 minutos. Tente de novo em instantes.' };
  try {
    return { tipo: 'ok', resultado: picsDaIntegracao(lerDadosChuva((ultima as SituacaoPedidoChuva | null)?.dados)) };
  } catch (e) {
    return { tipo: 'erro', texto: mensagemDeErro(e) };
  }
}
