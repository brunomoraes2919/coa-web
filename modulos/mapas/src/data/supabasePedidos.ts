import type { SupabaseClient } from '@supabase/supabase-js';
import type { PedidoChuva } from '../lib/chuvaZeus';
import type { Repositorio } from './repo';
import { TABELAS } from './supabaseLinhas';

/** tempo máximo de cada chamada (rede travada não pode deixar o botão preso) */
const TEMPO_LIMITE_MS = 15000;

interface ErroSupabase {
  code?: string;
  message?: string;
}

/** Erro do Supabase em português, específico dos pedidos ao servidor (`script` = o SQL que cria a tabela). */
export function erroPedido(acao: string, e: ErroSupabase, script = '0002_pedidos_plantio.sql'): Error {
  const codigo = e.code ?? '';
  const msg = e.message ?? '';
  if (codigo === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new Error(`Sem permissão para ${acao}: é preciso ter pelo menos uma fazenda liberada no COA WEB.`);
  }
  if (codigo === 'PGRST205' || codigo === '42P01') {
    return new Error(`Não foi possível ${acao}: falta a tabela de pedidos no Supabase (rode supabase/coa-web/${script}).`);
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

const SCRIPT_CHUVA = '0003_pedidos_chuva.sql';

/**
 * Pedidos do botão "Inserir dados via integração" (tabela mapas_chuva_pedidos). O navegador grava o
 * pedido (fazenda e período) e acompanha; quem consulta a ZEUS e grava a resposta (coluna dados) é o
 * servidor do COA WEB (scripts/atender-pedidos.mjs). O RLS deixa cada usuário do módulo inserir e ler
 * só os próprios pedidos.
 */
export function pedidosChuvaSupabase(client: SupabaseClient): Pick<Repositorio, 'podeBuscarChuva' | 'pedirChuvaZeus' | 'situacaoPedidoChuva'> {
  return {
    podeBuscarChuva: true,

    async pedirChuvaZeus({ fazenda, de, ate }: PedidoChuva) {
      const { data, error } = await client
        .from(TABELAS.pedidosChuva)
        .insert({ fazenda: fazenda.trim().slice(0, 80), de, ate })
        .select('id')
        .abortSignal(AbortSignal.timeout(TEMPO_LIMITE_MS))
        .single();
      if (error) throw erroPedido('pedir a chuva da ZEUS', error, SCRIPT_CHUVA);
      return Number((data as { id: number | string }).id);
    },

    async situacaoPedidoChuva(id) {
      const { data, error } = await client
        .from(TABELAS.pedidosChuva)
        .select('atendido_em, resultado, dados')
        .eq('id', id)
        .abortSignal(AbortSignal.timeout(TEMPO_LIMITE_MS))
        .maybeSingle();
      if (error) throw erroPedido('acompanhar o pedido da chuva da ZEUS', error, SCRIPT_CHUVA);
      if (!data) return null;
      const r = data as { atendido_em: string | null; resultado: string | null; dados: unknown };
      return { atendidoEm: r.atendido_em ?? null, resultado: r.resultado ?? null, dados: r.dados ?? null };
    },
  };
}
