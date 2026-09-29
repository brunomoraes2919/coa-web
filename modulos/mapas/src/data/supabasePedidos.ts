import type { SupabaseClient } from '@supabase/supabase-js';
import type { Repositorio } from './repo';
import { TABELAS } from './supabaseLinhas';

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
      const { data, error } = await client.from(TABELAS.pedidosPlantio).insert({}).select('id').single();
      if (error) throw new Error(`Não foi possível pedir a atualização do plantio: ${error.message}`);
      return Number((data as { id: number | string }).id);
    },

    async situacaoPedidoPlantio(id) {
      const { data, error } = await client.from(TABELAS.pedidosPlantio).select('atendido_em, resultado').eq('id', id).maybeSingle();
      if (error) throw new Error(`Não foi possível acompanhar o pedido de atualização do plantio: ${error.message}`);
      if (!data) return null;
      const r = data as { atendido_em: string | null; resultado: string | null };
      return { atendidoEm: r.atendido_em ?? null, resultado: r.resultado ?? null };
    },
  };
}
