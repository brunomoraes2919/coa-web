import { describe, expect, it } from 'vitest';
import { erroPedido } from '../src/data/supabasePedidos';

describe('erroPedido (mensagens do botão "Atualizar plantio")', () => {
  const acao = 'pedir a atualização do plantio';

  it('RLS recusou: fala da fazenda liberada no COA WEB, não de "acesso a esta fazenda"', () => {
    expect(erroPedido(acao, { code: '42501', message: 'new row violates row-level security policy' }).message).toBe(
      'Sem permissão para pedir a atualização do plantio: é preciso ter pelo menos uma fazenda liberada no COA WEB.',
    );
  });

  it('tabela ausente: aponta o script 0002', () => {
    expect(erroPedido(acao, { code: 'PGRST205', message: 'Could not find the table' }).message).toContain('0002_pedidos_plantio.sql');
  });

  it('tempo esgotado (AbortSignal.timeout): pede para verificar a internet', () => {
    expect(erroPedido(acao, { code: '20', message: 'AbortError: The operation was aborted.' }).message).toContain('não respondeu a tempo');
  });

  it('outro erro: português com o código, sem a mensagem em inglês', () => {
    const m = erroPedido(acao, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }).message;
    expect(m).toBe('Não foi possível pedir a atualização do plantio (código PGRST116). Tente de novo em instantes.');
    expect(m).not.toMatch(/JSON object/);
  });
});
