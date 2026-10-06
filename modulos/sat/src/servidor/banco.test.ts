// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { criarBanco } from './banco'

function rede(respostas: Record<string, { status?: number; corpo?: unknown }>) {
  const chamadas: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = []
  const fetchFalso = (async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const chave = Object.keys(respostas).find((k) => url.includes(k)) ?? ''
    const r = respostas[chave] ?? {}
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { chamadas, fetchFalso }
}
const AGORA = Date.parse('2026-10-06T11:00:00Z')
const banco = (r: ReturnType<typeof rede>) => criarBanco({ url: 'https://exemplo.supabase.co', chave: 'chave-de-teste', fetch: r.fetchFalso, agora: () => AGORA })

describe('banco', () => {
  it('toda chamada leva a chave de serviço nos dois cabeçalhos', async () => {
    const r = rede({ whatsapp_contatos: { corpo: [] }, whatsapp_contato_fazendas: { corpo: [] } })
    await banco(r).contatos()
    expect(r.chamadas.length).toBeGreaterThan(0)
    for (const c of r.chamadas) {
      expect(c.headers.apikey).toBe('chave-de-teste')
      expect(c.headers.Authorization).toBe('Bearer chave-de-teste')
    }
  })
  it('contatos: junta as fazendas de cada um', async () => {
    const r = rede({
      'whatsapp_contatos?': { corpo: [{ id: 'a', nome: 'João', telefone: '5565999990001', todas_fazendas: false, alerta_janela: true, ativo: true, confirmado_em: '2026-10-01T00:00:00Z', confirmado_por: 'mensagem', jid: null }] },
      'whatsapp_contato_fazendas?': { corpo: [{ contato_id: 'a', fazenda_id: 2 }, { contato_id: 'outro', fazenda_id: 9 }] },
    })
    expect(await banco(r).contatos()).toEqual([{ id: 'a', nome: 'João', telefone: '5565999990001', todasFazendas: false, fazendas: [2], alertaJanela: true, ativo: true, confirmadoEm: '2026-10-01T00:00:00Z', confirmadoPor: 'mensagem', jid: null }])
  })
  it('fazendas: centro dos talhões vira o quadrado; sem talhão fica sem quadrado', async () => {
    const quadrado = { type: 'Polygon', coordinates: [[[-50.4, -12.6], [-50.2, -12.6], [-50.2, -12.4], [-50.4, -12.4], [-50.4, -12.6]]] }
    const r = rede({
      'mapas_fazendas?': { corpo: [{ id: 'f1', nome: 'Exemplo', coa_fazenda_id: 2 }, { id: 'f2', nome: 'Vazia', coa_fazenda_id: null }] },
      'mapas_talhoes?': { corpo: [{ fazenda_id: 'f1', geom: quadrado }] },
    })
    const f = await banco(r).fazendas()
    expect(f[0]).toMatchObject({ id: 'f1', coaId: 2, nome: 'Exemplo', celulaId: '-12.5_-50.5' })
    expect(f[1]).toMatchObject({ id: 'f2', coaId: null, celulaId: null, lat: null })
  })
  it('reservar envio: 201 = pode mandar; 409 (já existe) = não manda', async () => {
    const ok = rede({ whatsapp_envios: { status: 201 } })
    expect(await banco(ok).reservarEnvio('a', '2026-10-06:resumo-07', 'resumo-07')).toBe(true)
    expect(ok.chamadas[0]).toMatchObject({ method: 'POST', body: { contato_id: 'a', chave: '2026-10-06:resumo-07', tipo: 'resumo-07', situacao: 'enviando' } })
    const repetido = rede({ whatsapp_envios: { status: 409, corpo: { code: '23505' } } })
    expect(await banco(repetido).reservarEnvio('a', '2026-10-06:resumo-07', 'resumo-07')).toBe(false)
  })
  it('fechar envio grava a situação; erro vai cortado em 300 caracteres', async () => {
    const r = rede({ whatsapp_envios: { status: 204 } })
    await banco(r).fecharEnvio('a', '2026-10-06:antes', 'falhou', 'x'.repeat(500))
    expect(r.chamadas[0].method).toBe('PATCH')
    expect(r.chamadas[0].url).toContain('contato_id=eq.a')
    expect(r.chamadas[0].url).toContain(`chave=eq.${encodeURIComponent('2026-10-06:antes')}`)
    expect((r.chamadas[0].body as { erro: string }).erro).toHaveLength(300)
  })
  it('confirmar: marca a autorização por mensagem, guarda o jid e reativa', async () => {
    const r = rede({ whatsapp_contatos: { status: 204 } })
    await banco(r).confirmar('a', '556599990001@s.whatsapp.net')
    expect(r.chamadas[0].body).toEqual({ confirmado_em: new Date(AGORA).toISOString(), confirmado_por: 'mensagem', jid: '556599990001@s.whatsapp.net', ativo: true, atualizado_em: new Date(AGORA).toISOString() })
  })
  it('estado: sempre grava o batimento', async () => {
    const r = rede({ whatsapp_estado: { status: 204 } })
    await banco(r).gravarEstado({ conectado: true })
    expect(r.chamadas[0].url).toContain('id=eq.1')
    expect(r.chamadas[0].body).toMatchObject({ conectado: true, batimento_em: new Date(AGORA).toISOString() })
  })
  it('resposta de erro vira Error sem a chave no texto', async () => {
    const r = rede({ whatsapp_contatos: { status: 500, corpo: { message: 'falhou chave-de-teste' } } })
    await expect(banco(r).contatos()).rejects.toThrow(/HTTP 500/)
    await expect(banco(r).contatos()).rejects.not.toThrow(/chave-de-teste/)
  })
})
