import { useSyncExternalStore } from 'react';
import type { Fazenda, FazendaCoaSelecionada, MensagemMapasRota } from './types';

/**
 * Modo embutido: o COA WEB mostra o módulo num iframe da mesma origem
 * (`mapas/index.html?embed=1#/<rota>`). As mensagens vão e vêm por postMessage, sempre com
 * `targetOrigin = location.origin` e aceitando só `event.origin === location.origin` vindas do pai:
 * - COA WEB → módulo: `{ tipo: 'coa-fazenda', id, nome }` (fazenda do topo do menu);
 * - módulo → COA WEB: `{ tipo: 'mapas-rota', rota, titulo }` (destaca o botão e troca o título).
 */

/** `?embed=1` na URL (o hash da rota não conta). Sem `location` (testes em node), false. */
export function emEmbed(loc?: Pick<Location, 'search'>): boolean {
  const l = loc ?? (typeof location !== 'undefined' ? location : undefined);
  if (!l) return false;
  return new URLSearchParams(l.search).get('embed') === '1';
}

/** Título do topo do COA WEB para a rota do módulo. */
export function tituloDaRota(rota: string): string {
  const r = rota.length > 1 ? rota.replace(/\/+$/, '') : rota;
  const em = (base: string) => r === base || r.startsWith(`${base}/`);
  if (r === '/mapas/novo') return 'Novo mapa de chuva';
  if (r === '/mapas') return 'Mapas salvos';
  if (r.startsWith('/mapas/')) return 'Mapa salvo';
  if (em('/fazendas')) return 'Fazendas e shapes';
  if (em('/safras')) return 'Safras e plantio';
  return 'Mapas';
}

/** Avisa o COA WEB da rota aberta. Só em embed e dentro de um iframe (parent !== window). */
export function avisarRota(rota: string): void {
  if (typeof window === 'undefined' || !emEmbed(window.location)) return;
  const pai = window.parent;
  if (!pai || pai === window) return;
  const msg: MensagemMapasRota = { tipo: 'mapas-rota', rota, titulo: tituloDaRota(rota) };
  pai.postMessage(msg, window.location.origin);
}

/** `{ tipo: 'coa-fazenda', id: number | null, nome: string | null }`; qualquer outro formato → null. */
function lerMensagemFazenda(dados: unknown): FazendaCoaSelecionada | null {
  if (!dados || typeof dados !== 'object') return null;
  const d = dados as Record<string, unknown>;
  if (d.tipo !== 'coa-fazenda') return null;
  const idValido = d.id === null || (typeof d.id === 'number' && Number.isFinite(d.id));
  const nomeValido = d.nome === null || typeof d.nome === 'string';
  if (!idValido || !nomeValido) return null;
  return { id: d.id as number | null, nome: d.nome as string | null };
}

/**
 * Escuta a fazenda do topo do COA WEB. Ignora mensagens de outra origem, que não venham da janela
 * pai (o COA WEB) ou de formato inválido. Retorna a função que para de escutar.
 */
export function ouvirFazendaCoa(cb: (f: FazendaCoaSelecionada) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const aoReceber = (ev: Event) => {
    const { origin, source, data } = ev as MessageEvent;
    if (origin !== window.location.origin || source !== window.parent) return;
    const f = lerMensagemFazenda(data);
    if (f) cb(f);
  };
  window.addEventListener('message', aoReceber);
  return () => window.removeEventListener('message', aoReceber);
}

// ---- Última fazenda recebida: guardada desde a abertura da página (antes de o editor montar) ----

let ultima: FazendaCoaSelecionada | null = null;
let escutando = false;
const inscritos = new Set<() => void>();

/** Começa a guardar a fazenda enviada pelo COA WEB (só em embed; chamar de novo não faz nada). */
export function iniciarEscutaFazendaCoa(): void {
  if (escutando || !emEmbed()) return;
  escutando = true;
  ouvirFazendaCoa((f) => {
    ultima = f;
    inscritos.forEach((avisar) => avisar());
  });
}

/** Última fazenda recebida do COA WEB; null se nada chegou (ou fora de embed). */
export function ultimaFazendaCoa(): FazendaCoaSelecionada | null {
  return ultima;
}

function inscrever(avisar: () => void): () => void {
  iniciarEscutaFazendaCoa();
  inscritos.add(avisar);
  return () => {
    inscritos.delete(avisar);
  };
}

/** Fazenda do topo do COA WEB (última recebida); null enquanto nada chegou. */
export function useFazendaCoa(): FazendaCoaSelecionada | null {
  return useSyncExternalStore(inscrever, ultimaFazendaCoa, () => null);
}

/** Primeira fazenda de mapa ligada à fazenda do COA WEB (coaFazendaId); sem correspondente, null. */
export function fazendaDoCoa(fazendas: Fazenda[], coaId: number): Fazenda | null {
  return fazendas.find((f) => f.coaFazendaId === coaId) ?? null;
}

/**
 * Fazendas da lista "Fazenda" do editor: sem fazenda do COA WEB (fora do iframe, ou "todas"), a lista
 * inteira; com ela, só as fazendas de mapa ligadas a ela (coaFazendaId), mais a já escolhida quando não
 * está entre elas (um mapa salvo de outra fazenda continua mostrando a sua). Mantém a ordem original.
 */
export function fazendasDoCoa(
  fazendas: Fazenda[],
  coa: { id: number | null; nome: string | null } | null,
  fazendaAtualId: string,
): Fazenda[] {
  if (!coa || coa.id === null) return fazendas;
  return fazendas.filter((f) => f.coaFazendaId === coa.id || (fazendaAtualId !== '' && f.id === fazendaAtualId));
}
