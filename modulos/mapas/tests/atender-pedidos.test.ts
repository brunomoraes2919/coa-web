import { describe, expect, it } from 'vitest';
import { atenderPedidos, limparAntigos, marcarAtendidos, MENSAGENS_DE_ERRO, pedidosPendentes } from '../scripts/atender-pedidos.mjs';

const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';

interface Chamada { url: string; init?: RequestInit }

/** fetch falso: pedidos pendentes vêm de `pendentes`; o Agrovex responde `agrovex` (status). */
function fetchFalso(pendentes: number[], agrovex = 401) {
  const chamadas: Chamada[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB) && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(pendentes.map((id) => ({ id }))), { status: 200 });
    }
    if (url.startsWith(URL_SB)) return new Response(null, { status: 204 });
    return new Response('{"error":"Unauthorized"}', { status: agrovex });
  };
  return { impl, chamadas };
}

describe('pedidos de "Atualizar plantio"', () => {
  it('lê os pendentes em ordem e com limite, com a chave só nos cabeçalhos', async () => {
    const { impl, chamadas } = fetchFalso([3, 5]);
    expect(await pedidosPendentes({ url: URL_SB, chave: CHAVE, fetch: impl })).toEqual([3, 5]);
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_plantio_pedidos?select=id&atendido_em=is.null&order=id.asc&limit=500`);
    const h = chamadas[0].init?.headers as Record<string, string>;
    expect(h.apikey).toBe(CHAVE);
    expect(h.Authorization).toBe(`Bearer ${CHAVE}`);
  });

  it('marca como atendidos só os pendentes até o id visto', async () => {
    const { impl, chamadas } = fetchFalso([]);
    await marcarAtendidos({ url: URL_SB, chave: CHAVE, fetch: impl }, 5, 'ok', new Date('2026-09-29T10:00:00Z'));
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_plantio_pedidos?atendido_em=is.null&id=lte.5`);
    expect(chamadas[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(chamadas[0].init?.body))).toEqual({ atendido_em: '2026-09-29T10:00:00.000Z', resultado: 'ok' });
  });

  it('limpa os atendidos há mais de 30 dias', async () => {
    const { impl, chamadas } = fetchFalso([]);
    await limparAntigos({ url: URL_SB, chave: CHAVE, fetch: impl }, new Date('2026-09-29T00:00:00Z'));
    expect(chamadas[0].init?.method).toBe('DELETE');
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_plantio_pedidos?atendido_em=lt.${encodeURIComponent('2026-08-30T00:00:00.000Z')}`);
  });

  it('sem pedido pendente não chama o Agrovex nem grava nada', async () => {
    const { impl, chamadas } = fetchFalso([]);
    const r = await atenderPedidos({
      supabase: { url: URL_SB, chave: CHAVE },
      agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN, safras: ['SOJA 26/27'] },
      fetch: impl,
    });
    expect(r).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it('erro da rotina vira o texto do tipo da falha nos pedidos (sem o texto de fora, o token nem a chave) e é relançado', async () => {
    const { impl, chamadas } = fetchFalso([7, 8], 401);
    await expect(
      atenderPedidos({
        supabase: { url: URL_SB, chave: CHAVE },
        agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN, safras: ['SOJA 26/27'] },
        fetch: impl,
      }),
    ).rejects.toThrow(/O servidor de dados do PIMS recusou o acesso/);
    const patch = chamadas.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toContain('id=lte.8');
    const corpo = JSON.parse(String(patch?.init?.body));
    // o detalhe ("recusou o acesso (HTTP 401)… Resposta: …") fica só no erro relançado, que vai para o log
    expect(corpo.resultado).toBe(`erro: ${MENSAGENS_DE_ERRO.fonte}`);
    expect(corpo.resultado).not.toContain('Unauthorized');
    expect(corpo.resultado).not.toContain(TOKEN);
    expect(corpo.resultado).not.toContain(CHAVE);
  });
});
