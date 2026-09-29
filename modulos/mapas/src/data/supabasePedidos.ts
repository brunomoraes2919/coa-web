import type { SupabaseClient } from '@supabase/supabase-js';
import type { Repositorio } from './repo';
import { TABELAS } from './supabaseLinhas';

/** tempo máximo de cada chamada (rede travada não pode deixar o botão preso) */
const TEMPO_LIMITE_MS = 15000;

interface ErroSupabase {
  code?: string;
  message?: string;
}

/** Erro do Supabase em português, específico dos pedidos de atualização do plantio. */
export function erroPedido(acao: string, e: ErroSupabase): Error {
  const codigo = e.code ?? '';
  const msg = e.message ?? '';
  if (codigo === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new Error(`Sem permissão para ${acao}: é preciso ter pelo menos uma fazenda liberada no COA WEB.`);
  }
  if (codigo === 'PGRST205' || codigo === '42P01') {
    return new Error(`Não foi possível ${acao}: falta a tabela de pedidos no Supabase (rode supabase/coa-web/0002_pedidos_plantio.sql).`);
  }
  if (/abort|timeout|timed out|failed to fetch|network/i.test(msg) || codigo === '20') {
    return new Error(`Não foi possível ${acao}: o Supabase não respondeu a tempo. Verifique a internet e tente de novo.`);
  }
  return new Error(`Não foi possível ${acao}${codigo ? ` (código ${codigo})` : ''}. Tente de novo em instantes.`);
}

/**
 * Pedidos do botão "Atualizar plantio" no Supabase (tabela mapas_plantio_pedidos). O navegador só grava
 * o pedido e acompanha; quem roda a rotina do PIMS e marca o pedido como atendido é o servidor do COA
 * WEB (scripts/atender-pedidos.mjs, com a chave de serviço). O RLS deixa o usuário do módulo inserir
 * (em nome próprio, pendente) e ler.
 */
export function pedidosPlantioSupabase(
  client: SupabaseClient,
): Pick<Repositorio, 'podeAtualizarPlantio' | 'pedirAtualizacaoPlantio' | 'situacaoPedidoPlantio'> {
  return {
    podeAtualizarPlantio: true,

    async pedirAtualizacaoPlantio() {
      // linha vazia: o banco preenche id, pedido_em e pedido_por (auth.uid())
      const { data, error } = await client
        .from(TABELAS.pedidosPlantio)
        .insert({})
        .select('id')
        .abortSignal(AbortSignal.timeout(TEMPO_LIMITE_MS))
        .single();
      if (error) throw erroPedido('pedir a atualização do plantio', error);
      return Number((data as { id: number | string }).id);
    },

    async situacaoPedidoPlantio(id) {
      const { data, error } = await client
        .from(TABELAS.pedidosPlantio)
        .select('atendido_em, resultado')
        .eq('id', id)
        .abortSignal(AbortSignal.timeout(TEMPO_LIMITE_MS))
        .maybeSingle();
      if (error) throw erroPedido('acompanhar o pedido de atualização do plantio', error);
      if (!data) return null;
      const r = data as { atendido_em: string | null; resultado: string | null };
      return { atendidoEm: r.atendido_em ?? null, resultado: r.resultado ?? null };
    },
  };
}
