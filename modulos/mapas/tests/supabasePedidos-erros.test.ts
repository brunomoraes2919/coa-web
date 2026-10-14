import { readFileSync } from 'node:fs';
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

  it('limite de pedidos pendentes (gatilho pedidos_limitar, P0001): mostra a mensagem do banco, sem código', () => {
    const m = erroPedido(acao, { code: 'P0001', message: 'Você já tem 5 pedidos aguardando o servidor. Espere a resposta antes de pedir de novo.' }).message;
    expect(m).toBe('Não foi possível pedir a atualização do plantio: Você já tem 5 pedidos aguardando o servidor. Espere a resposta antes de pedir de novo.');
    expect(m).not.toMatch(/código|P0001/);
  });

  it('limite de pedidos por hora: idem, na fila da chuva', () => {
    const m = erroPedido('pedir a chuva da ZEUS', { code: 'P0001', message: 'Muitos pedidos na última hora (o limite é 30). Tente de novo mais tarde.' }, '0003_pedidos_chuva.sql').message;
    expect(m).toBe('Não foi possível pedir a chuva da ZEUS: Muitos pedidos na última hora (o limite é 30). Tente de novo mais tarde.');
  });

  it('limite de pedidos sem o código na resposta: vale a mensagem do gatilho', () => {
    expect(erroPedido(acao, { message: 'Você já tem 6 pedidos aguardando o servidor. Espere a resposta antes de pedir de novo.' }).message).toBe(
      'Não foi possível pedir a atualização do plantio: Você já tem 6 pedidos aguardando o servidor. Espere a resposta antes de pedir de novo.',
    );
  });

  it('P0001 sem mensagem: cai no texto genérico com o código', () => {
    expect(erroPedido(acao, { code: 'P0001', message: '' }).message).toBe('Não foi possível pedir a atualização do plantio (código P0001). Tente de novo em instantes.');
  });

  it('as mensagens deste arquivo são as que o gatilho do banco levanta (supabase/0018_seguranca_pedidos.sql)', () => {
    const sql = readFileSync(new URL('../../../supabase/0018_seguranca_pedidos.sql', import.meta.url), 'utf8');
    expect(sql).toContain("raise exception 'Você já tem % pedidos aguardando o servidor. Espere a resposta antes de pedir de novo.'");
    expect(sql).toContain("raise exception 'Muitos pedidos na última hora (o limite é %). Tente de novo mais tarde.'");
  });

  it('outro erro: português com o código, sem a mensagem em inglês', () => {
    const m = erroPedido(acao, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }).message;
    expect(m).toBe('Não foi possível pedir a atualização do plantio (código PGRST116). Tente de novo em instantes.');
    expect(m).not.toMatch(/JSON object/);
  });
});
