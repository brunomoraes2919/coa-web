// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { criarBanco } from './banco'

function rede(respostas: Record<string, { status?: number; corpo?: unknown }>) {
  const chamadas: { url: string; method: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null | undefined }[] = []
  const fetchFalso = (async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined, signal: init.signal })
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
      'whatsapp_contatos?': { corpo: [{ id: 'a', nome: 'João', telefone: '5565999990001', todas_fazendas: false, alerta_janela: true, ativo: true, confirmado_em: '2026-10-01T00:00:00Z', confirmado_por: 'mensagem', jid: null, atualizado_em: '2026-10-02T12:00:00Z' }] },
      'whatsapp_contato_fazendas?': { corpo: [{ contato_id: 'a', fazenda_id: 2 }, { contato_id: 'outro', fazenda_id: 9 }] },
    })
    const resultado = await banco(r).contatos()
    expect(r.chamadas[1].url).toContain('whatsapp_contato_fazendas?select=*&order=contato_id,fazenda_id')
    expect(resultado).toEqual([{ id: 'a', nome: 'João', telefone: '5565999990001', todasFazendas: false, fazendas: [2], alertaJanela: true, ativo: true, confirmadoEm: '2026-10-01T00:00:00Z', confirmadoPor: 'mensagem', jid: null, atualizadoEm: '2026-10-02T12:00:00Z' }])
  })
  it('A4. contatos: atualizado_em vazio (ou ausente) vira null', async () => {
    const linha = { id: 'a', nome: 'João', telefone: '5565999990001', todas_fazendas: false, alerta_janela: true, ativo: true, confirmado_em: null, confirmado_por: null, jid: null }
    const r = rede({
      'whatsapp_contatos?': { corpo: [{ ...linha, atualizado_em: null }, { ...linha, id: 'b' }] },
      'whatsapp_contato_fazendas?': { corpo: [] },
    })
    expect((await banco(r).contatos()).map((c) => c.atualizadoEm)).toEqual([null, null])
  })
  it('fazendas: centro dos talhões vira o quadrado; sem talhão fica sem quadrado', async () => {
    const quadrado = { type: 'Polygon', coordinates: [[[-50.4, -12.6], [-50.2, -12.6], [-50.2, -12.4], [-50.4, -12.4], [-50.4, -12.6]]] }
    const r = rede({
      'mapas_fazendas?': { corpo: [{ id: 'f1', nome: 'Exemplo', coa_fazenda_id: 2 }, { id: 'f2', nome: 'Vazia', coa_fazenda_id: null }] },
      'mapas_talhoes?': { corpo: [{ fazenda_id: 'f1', geom: quadrado }] },
    })
    const f = await banco(r).fazendas()
    expect(r.chamadas[0].url).toContain('order=nome,id')
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
  it('reservar envio: erro do Supabase ou de rede nunca vira "pode mandar"', async () => {
    for (const status of [500, 401]) {
      const r = rede({ whatsapp_envios: { status, corpo: { message: 'erro' } } })
      await expect(banco(r).reservarEnvio('a', '2026-10-06:antes', 'antes')).rejects.toThrow(/HTTP/)
    }
    const semRede = criarBanco({ url: 'https://exemplo.supabase.co', chave: 'chave-de-teste', fetch: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch, agora: () => AGORA })
    await expect(semRede.reservarEnvio('a', '2026-10-06:antes', 'antes')).rejects.toThrow()
  })
  it('toda chamada leva um prazo (signal), para não travar o laço do serviço', async () => {
    const r = rede({ whatsapp_estado: { status: 204 }, whatsapp_envios: { corpo: [] }, whatsapp_contatos: { status: 204 } })
    const b = banco(r)
    await b.gravarEstado({ conectado: true })
    await b.reservarEnvio('a', '2026-10-06:antes', 'antes')
    await b.chavesDoDia('2026-10-06')
    await b.pausar('a')
    await b.limparEnviosAntigos()
    expect(r.chamadas).toHaveLength(5)
    for (const c of r.chamadas) expect(c.signal).toBeInstanceOf(AbortSignal)
  })
  it('chaves do dia: pede só as do dia, em ordem estável, e converte', async () => {
    const r = rede({ whatsapp_envios: { corpo: [{ contato_id: 'a', chave: '2026-10-06:antes', situacao: 'falhou' }] } })
    expect(await banco(r).chavesDoDia('2026-10-06')).toEqual([{ contatoId: 'a', chave: '2026-10-06:antes', situacao: 'falhou' }])
    expect(r.chamadas[0].method).toBe('GET')
    expect(r.chamadas[0].url).toContain('chave=like.2026-10-06:*')
    expect(r.chamadas[0].url).toContain('order=contato_id,chave')
    expect(r.chamadas[0].url).toContain('select=contato_id,chave,situacao')
  })
  it('guardar jid e pausar mexem só no contato indicado', async () => {
    const r = rede({ whatsapp_contatos: { status: 204 } })
    await banco(r).guardarJid('a', '556599990001@s.whatsapp.net')
    await banco(r).pausar('a')
    expect(r.chamadas[0]).toMatchObject({ method: 'PATCH', body: { jid: '556599990001@s.whatsapp.net', atualizado_em: new Date(AGORA).toISOString() } })
    expect(r.chamadas[1]).toMatchObject({ method: 'PATCH', body: { ativo: false, atualizado_em: new Date(AGORA).toISOString() } })
    for (const c of r.chamadas) expect(c.url).toMatch(/whatsapp_contatos\?id=eq\.a$/)
  })
  it('limpar envios antigos: DELETE com filtro de 30 dias antes de agora', async () => {
    const r = rede({ whatsapp_envios: { status: 204 } })
    await banco(r).limparEnviosAntigos()
    const limite = new Date(AGORA - 30 * 24 * 60 * 60_000).toISOString()
    expect(r.chamadas[0].method).toBe('DELETE')
    expect(r.chamadas[0].url).toContain(`criado_em=lt.${encodeURIComponent(limite)}`)
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
  it('estado: erro do serviço vai cortado em 300 caracteres; null limpa o campo', async () => {
    const r = rede({ whatsapp_estado: { status: 204 } })
    await banco(r).gravarEstado({ conectado: false, ultimoErro: 'y'.repeat(500) })
    await banco(r).gravarEstado({ conectado: true, ultimoErro: null })
    expect((r.chamadas[0].body as { ultimo_erro: string }).ultimo_erro).toHaveLength(300)
    expect(r.chamadas[1].body).toHaveProperty('ultimo_erro', null)
  })
  it('resposta que não é JSON vira erro nosso, sem citar o corpo', async () => {
    const fetchRuim = (async () => new Response('<html>segredo-no-corpo', { status: 200 })) as unknown as typeof fetch
    const b = criarBanco({ url: 'https://exemplo.supabase.co', chave: 'chave-de-teste', fetch: fetchRuim, agora: () => AGORA })
    await expect(b.contatos()).rejects.toThrow('Supabase devolveu resposta fora do formato')
  })
  it('resposta de erro vira Error sem a chave no texto', async () => {
    const r = rede({ whatsapp_contatos: { status: 500, corpo: { message: 'falhou chave-de-teste' } } })
    await expect(banco(r).contatos()).rejects.toThrow(/HTTP 500/)
    await expect(banco(r).contatos()).rejects.not.toThrow(/chave-de-teste/)
  })
})
