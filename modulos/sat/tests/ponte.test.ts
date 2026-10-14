// @vitest-environment node
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Caminho = { tipo: 'serie' | 'imagem'; inicioMs: number; fimMs: number }

const ponte = createRequire(import.meta.url)('../../../api/gnss.js') as {
  criarHandler: (deps: { fetch: typeof fetch; agora: () => number }) => (req: unknown, res: unknown) => Promise<void>
  lerCaminho: (p: unknown) => Caminho | null
  segundosDeCache: (c: { tipo: 'serie' | 'imagem'; fimMs: number }, agoraMs: number) => number
}

const AGORA = Date.parse('2026-10-05T15:00:00Z')
const DIA = 86_400_000
const SUPABASE_USER = 'https://pkaxbitsqxjxjlwnhjhd.supabase.co/auth/v1/user'
/** A função do banco que diz se quem está logado tem a categoria (o mesmo projeto, pela API REST). */
const SUPABASE_CATEGORIA = SUPABASE_USER.replace('/auth/v1/user', '/rest/v1/rpc/tem_categoria')
const JSON_UTF8 = 'application/json; charset=utf-8'
const LIMITE_CORPO = 2 * 1024 * 1024
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

const base64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** JWT de mentira: só o formato que a ponte confere antes de perguntar ao Supabase (a assinatura não vale nada). */
function jwt(carga: Record<string, unknown> = {}) {
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: 'u1', exp: AGORA / 1000 + 3600, ...carga })}.assinatura`
}

const TOKEN = jwt()

function resFalso() {
  const cabecalhos: Record<string, string> = {}
  return {
    statusCode: 0,
    corpo: undefined as unknown,
    cabecalhos,
    setHeader(n: string, v: string) { cabecalhos[n.toLowerCase()] = v },
    getHeader(n: string) { return cabecalhos[n.toLowerCase()] },
    end(c?: unknown) { this.corpo = c },
  }
}

function reqUrl(url: string, token: string | string[] | null = TOKEN, method = 'GET') {
  return { method, url, headers: token ? { 'x-coa-token': token } : {} }
}

function req(p: string | null, token: string | string[] | null = TOKEN, method = 'GET') {
  return reqUrl(`/api/gnss${p == null ? '' : `?p=${encodeURIComponent(p)}`}`, token, method)
}

type Pedido = [url: string | URL | Request, opcoes?: RequestInit]

/** O que o banco responde à pergunta "tem a categoria?": `true` ou `false`, em JSON. */
const respostaCategoria = (corpo = 'true', status = 200) =>
  () => new Response(corpo, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

/** fetch falso: Supabase aceita o TOKEN e diz que ele tem a categoria; a Trimble devolve `trimble`. */
function fetchFalso(
  trimble: () => Response,
  supabase: () => Response = () => new Response('{}', { status: 200 }),
  categoria: () => Response = respostaCategoria(),
) {
  return vi.fn(async (url: string | URL | Request, _opcoes?: RequestInit) => {
    const u = String(url)
    if (u.includes('/auth/v1/user')) return supabase()
    if (u.includes('/rest/v1/rpc/tem_categoria')) return categoria()
    if (u.startsWith('https://www.gnssplanning.com/api/')) return trimble()
    throw new Error(`pedido inesperado: ${u}`)
  })
}

const chamadasA = (fetch: { mock: { calls: Pedido[] } }, inicio: string) =>
  fetch.mock.calls.filter(([u]) => String(u).startsWith(inicio))

const respostaJson = (corpo = '[{"value":4}]', tipo = 'application/json; charset=utf-8') =>
  () => new Response(corpo, { status: 200, headers: { 'content-type': tipo } })
const respostaPng = (tipo = 'image/png') => () => new Response(PNG, { status: 200, headers: { 'content-type': tipo } })

async function chamar(fetch: unknown, pedido: unknown, agora = AGORA) {
  const res = resFalso()
  await ponte.criarHandler({ fetch: fetch as never, agora: () => agora })(pedido, res)
  return res
}

const SERIE_HOJE = 'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/27/600'
const IMAGEM_ANTIGA = 'overlay/sci/2026-09-25T03:00:00'

afterEach(() => {
  vi.useRealTimers()
})

describe('caminho aceito', () => {
  it('só os dois formatos da Trimble que o módulo usa', () => {
    expect(ponte.lerCaminho(SERIE_HOJE)).toEqual({
      tipo: 'serie',
      inicioMs: Date.parse('2026-10-05T04:00:00Z'),
      fimMs: Date.parse('2026-10-06T07:00:00Z'),
    })
    expect(ponte.lerCaminho(IMAGEM_ANTIGA)).toEqual({
      tipo: 'imagem',
      inicioMs: Date.parse('2026-09-25T03:00:00Z'),
      fimMs: Date.parse('2026-09-25T03:00:00Z'),
    })
    expect(ponte.lerCaminho('overlay/tec/2026-10-05T03:00:00')?.tipo).toBe('imagem')
  })

  it('aceita as janelas de 24 h, 27 h e 168 h e coordenadas de meio grau', () => {
    for (const horas of [24, 27, 168]) {
      expect(ponte.lerCaminho(`ionoindex/-56.5/-14.5/2026-10-05T04:00:00/${horas}/600`)?.fimMs)
        .toBe(Date.parse('2026-10-05T04:00:00Z') + horas * 3_600_000)
    }
    expect(ponte.lerCaminho('ionoindex/-57/-15.0/2026-10-05T04:00:00/24/600')).not.toBeNull()
    expect(ponte.lerCaminho('ionoindex/180/90/2026-10-05T04:00:00/24/600')).not.toBeNull()
    expect(ponte.lerCaminho('ionoindex/-180/-90/2026-10-05T04:00:00/24/600')).not.toBeNull()
  })

  it.each([
    'overlay/xyz/2026-10-05T03:00:00',
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/27',
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/999/600',
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/27/60',
    'ionoindex/-560/-14.5/2026-10-05T04:00:00/27/600',
    'ionoindex/-56.5/-140/2026-10-05T04:00:00/27/600',
    '../segredo',
    'overlay/sci/2026-10-05T03:00:00/../../x',
    'https://outro.site/x',
    '',
  ])('recusa %s', (p) => {
    expect(ponte.lerCaminho(p)).toBeNull()
  })

  it.each([
    // data que não existe ou fora do formato canônico
    'ionoindex/-56.5/-14.5/2026-02-30T04:00:00/27/600',
    'ionoindex/-56.5/-14.5/2026-10-05T24:00:00/27/600',
    'overlay/sci/2026-02-30T00:00:00',
    'overlay/sci/2026-10-05T24:00:00',
    // coordenada fora da grade de meio grau ou fora do globo
    'ionoindex/-56.4/-14.5/2026-10-05T04:00:00/27/600',
    'ionoindex/-56.5/-14.3/2026-10-05T04:00:00/27/600',
    'ionoindex/190/-14.5/2026-10-05T04:00:00/27/600',
    'ionoindex/-56.5/91/2026-10-05T04:00:00/27/600',
    // janela e passo que o módulo não pede
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/25/600',
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/27/900',
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/27/3600',
    // imagem fora do passo de 10 minutos
    'overlay/sci/2026-10-05T03:05:00',
    'overlay/sci/2026-10-05T03:00:01',
    // sobras que o endereço não pode carregar
    'overlay/sci/2026-10-05T03:00:00\n',
    'ionoindex/-56.5/-14.5/2026-10-05T04:00:00/27/600\n',
    'overlay/sci/2026-10-05T03:00:00?x=1',
    'overlay/sci/2026-10-05T03:00:00#a',
    '/overlay/sci/2026-10-05T03:00:00',
  ])('recusa o que o módulo não pede: %j', (p) => {
    expect(ponte.lerCaminho(p)).toBeNull()
  })

  it('recusa o que não é texto', () => {
    expect(ponte.lerCaminho(undefined)).toBeNull()
    expect(ponte.lerCaminho(['overlay/sci/2026-10-05T03:00:00'])).toBeNull()
  })
})

describe('tempo de cache', () => {
  it('dado de mais de 1 h atrás fica um dia; o recente, pouco', () => {
    expect(ponte.segundosDeCache({ tipo: 'imagem', fimMs: AGORA - 2 * 3_600_000 }, AGORA)).toBe(86_400)
    expect(ponte.segundosDeCache({ tipo: 'serie', fimMs: AGORA - 2 * 3_600_000 }, AGORA)).toBe(86_400)
    expect(ponte.segundosDeCache({ tipo: 'serie', fimMs: AGORA + 3_600_000 }, AGORA)).toBe(120)
    expect(ponte.segundosDeCache({ tipo: 'imagem', fimMs: AGORA - 600_000 }, AGORA)).toBe(300)
  })
})

describe('função', () => {
  it('repassa a série com o cache curto e sem mandar o token para a Trimble', async () => {
    const fetch = fetchFalso(respostaJson())
    const res = await chamar(fetch, req(SERIE_HOJE))
    expect(res.statusCode).toBe(200)
    expect(String(res.corpo)).toBe('[{"value":4}]')
    expect(res.cabecalhos['content-type']).toBe(JSON_UTF8)
    expect(res.cabecalhos['cache-control']).toBe('public, max-age=0, s-maxage=120')
    const [chamada] = chamadasA(fetch, 'https://www.gnssplanning.com/')
    expect(String(chamada[0])).toBe(`https://www.gnssplanning.com/api/${SERIE_HOJE}`)
    expect(JSON.stringify(chamada[1] ?? {})).not.toContain(TOKEN)
    expect(chamada[1]?.headers).toEqual({ Accept: '*/*' })
  })

  it('imagem antiga fica um dia no cache', async () => {
    const res = await chamar(fetchFalso(respostaPng()), req(IMAGEM_ANTIGA))
    expect(res.statusCode).toBe(200)
    expect(res.cabecalhos['content-type']).toBe('image/png')
    expect(res.cabecalhos['cache-control']).toBe('public, max-age=0, s-maxage=86400')
    expect([...(res.corpo as Uint8Array)]).toEqual([...PNG])
  })

  it('pede à Trimble sem seguir redirecionamento e com prazo (AbortSignal)', async () => {
    const fetch = fetchFalso(respostaJson())
    await chamar(fetch, req(SERIE_HOJE))
    const [chamada] = chamadasA(fetch, 'https://www.gnssplanning.com/')
    expect(chamada[1]?.redirect).toBe('error')
    expect(chamada[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('confere a sessão no Supabase com a chave anon, o token e prazo (AbortSignal)', async () => {
    const fetch = fetchFalso(respostaJson())
    await chamar(fetch, req(SERIE_HOJE))
    // duas idas ao Supabase: a da sessão (esta) e a da categoria (conferida mais abaixo, em "categoria")
    expect(chamadasA(fetch, 'https://pkaxbitsqxjxjlwnhjhd.supabase.co/')).toHaveLength(2)
    const idas = chamadasA(fetch, SUPABASE_USER)
    expect(idas).toHaveLength(1)
    expect(String(idas[0][0])).toBe(SUPABASE_USER)
    const opcoes = idas[0][1]
    const cabecalhos = opcoes?.headers as Record<string, string>
    expect(cabecalhos.apikey).toMatch(/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(opcoes?.signal).toBeInstanceOf(AbortSignal)
  })

  describe('o que a Trimble devolve', () => {
    it.each([
      ['série', SERIE_HOJE],
      ['imagem', IMAGEM_ANTIGA],
    ])('200 em text/html (%s): 502 sem cache', async (_nome, p) => {
      const fetch = fetchFalso(() => new Response('<html><script>alert(1)</script></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
      const res = await chamar(fetch, req(p))
      expect(res.statusCode).toBe(502)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(String(res.corpo)).not.toContain('script')
    })

    it('content-type de PNG com bytes que não são PNG: 502', async () => {
      const fetch = fetchFalso(() => new Response('<html>não sou imagem</html>', { status: 200, headers: { 'content-type': 'image/png' } }))
      const res = await chamar(fetch, req(IMAGEM_ANTIGA))
      expect(res.statusCode).toBe(502)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
    })

    it('PNG de verdade com content-type de outro tipo: 502', async () => {
      const res = await chamar(fetchFalso(respostaPng('text/plain')), req(IMAGEM_ANTIGA))
      expect(res.statusCode).toBe(502)
    })

    it('content-type JSON com corpo que não começa em [ : 502', async () => {
      for (const corpo of ['{"value":4}', '<html>', 'null', '']) {
        const res = await chamar(fetchFalso(respostaJson(corpo)), req(SERIE_HOJE))
        expect(res.statusCode, `corpo ${JSON.stringify(corpo)}`).toBe(502)
        expect(res.cabecalhos['cache-control']).toBe('no-store')
      }
    })

    it('série: espaços antes do [ não atrapalham', async () => {
      const res = await chamar(fetchFalso(respostaJson(' \r\n\t[1,2]')), req(SERIE_HOJE))
      expect(res.statusCode).toBe(200)
    })

    it.each([
      ['série de hoje', SERIE_HOJE],
      ['série de dia passado', 'ionoindex/-56.5/-14.5/2026-09-25T04:00:00/27/600'],
    ])('%s vazia: 200 com o content-type nosso, mas sem cache (a Vercel não guarda o vazio)', async (_nome, p) => {
      for (const corpo of ['[]', '[ ]\r\n', ' \n[\t\r\n ]  \n']) {
        const res = await chamar(fetchFalso(respostaJson(corpo)), req(p))
        expect(res.statusCode, `corpo ${JSON.stringify(corpo)}`).toBe(200)
        expect(res.cabecalhos['content-type']).toBe(JSON_UTF8)
        expect(res.cabecalhos['cache-control']).toBe('no-store')
        expect(String(res.corpo)).toBe(corpo)
      }
    })

    it('série com itens continua com o cache de antes (120 s hoje, 1 dia no passado)', async () => {
      const hoje = await chamar(fetchFalso(respostaJson('[{"value":4}]')), req(SERIE_HOJE))
      expect(hoje.cabecalhos['cache-control']).toBe('public, max-age=0, s-maxage=120')
      const passada = await chamar(fetchFalso(respostaJson('[0]')), req('ionoindex/-56.5/-14.5/2026-09-25T04:00:00/27/600'))
      expect(passada.cabecalhos['cache-control']).toBe('public, max-age=0, s-maxage=86400')
    })

    it('a resposta sai com o nosso content-type, não com o que veio da Trimble', async () => {
      const serie = await chamar(fetchFalso(respostaJson('[]', 'Application/JSON')), req(SERIE_HOJE))
      expect(serie.statusCode).toBe(200)
      expect(serie.cabecalhos['content-type']).toBe(JSON_UTF8)
      const imagem = await chamar(fetchFalso(respostaPng('image/png; foo=bar')), req(IMAGEM_ANTIGA))
      expect(imagem.statusCode).toBe(200)
      expect(imagem.cabecalhos['content-type']).toBe('image/png')
    })

    it('corpo de até 2 MB passa; um byte a mais: 502', async () => {
      const cabe = '[' + ' '.repeat(LIMITE_CORPO - 2) + ']'
      expect((await chamar(fetchFalso(respostaJson(cabe)), req(SERIE_HOJE))).statusCode).toBe(200)
      const grande = '[' + ' '.repeat(LIMITE_CORPO - 1) + ']'
      const res = await chamar(fetchFalso(respostaJson(grande)), req(SERIE_HOJE))
      expect(res.statusCode).toBe(502)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
    })

    it('content-length declarado acima de 2 MB: 502', async () => {
      const fetch = fetchFalso(() => new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(LIMITE_CORPO + 1) } }))
      const res = await chamar(fetch, req(SERIE_HOJE))
      expect(res.statusCode).toBe(502)
    })

    it('erro da Trimble passa com o mesmo status, sem cache e com texto nosso', async () => {
      for (const status of [403, 406, 429, 500, 503]) {
        const res = await chamar(fetchFalso(() => new Response('<html>segredo da Trimble</html>', { status, headers: { 'content-type': 'text/html' } })), req(SERIE_HOJE))
        expect(res.statusCode).toBe(status)
        expect(res.cabecalhos['cache-control']).toBe('no-store')
        expect(res.cabecalhos['content-type']).toBe('text/plain; charset=utf-8')
        expect(String(res.corpo)).toBe(`A Trimble respondeu ${status}.`)
      }
    })

    it('401 da Trimble vira 502 (não pode parecer sessão vencida do COA WEB)', async () => {
      const res = await chamar(fetchFalso(() => new Response('no', { status: 401 })), req(SERIE_HOJE))
      expect(res.statusCode).toBe(502)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(String(res.corpo)).toBe('A Trimble respondeu 401.')
    })

    it('sucesso que não é 200 (204) também vira 502', async () => {
      const res = await chamar(fetchFalso(() => new Response(null, { status: 204 })), req(SERIE_HOJE))
      expect(res.statusCode).toBe(502)
    })

    it('a Trimble não responde (rede, redirecionamento recusado): 504 sem cache', async () => {
      const fetch = vi.fn(async (url: string | URL | Request, _opcoes?: RequestInit) => {
        if (String(url).includes('/auth/v1/user')) return new Response('{}', { status: 200 })
        if (String(url).includes('/rest/v1/rpc/tem_categoria')) return respostaCategoria()()
        throw new TypeError('fetch failed')
      })
      const res = await chamar(fetch, req(SERIE_HOJE, jwt({ sub: 'u4' })))
      expect(res.statusCode).toBe(504)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
    })
  })

  describe('cabeçalhos de segurança', () => {
    it('em toda resposta: nosniff e Cross-Origin-Resource-Policy', async () => {
      const ok = await chamar(fetchFalso(respostaJson()), req(SERIE_HOJE))
      const caminhoRuim = await chamar(vi.fn(), req('../x'))
      const semToken = await chamar(vi.fn(), req(SERIE_HOJE, null))
      const post = await chamar(vi.fn(), req(SERIE_HOJE, TOKEN, 'POST'))
      const erroDaTrimble = await chamar(fetchFalso(() => new Response('x', { status: 429 })), req(SERIE_HOJE))
      for (const res of [ok, caminhoRuim, semToken, post, erroDaTrimble]) {
        expect(res.cabecalhos['x-content-type-options']).toBe('nosniff')
        expect(res.cabecalhos['cross-origin-resource-policy']).toBe('same-origin')
      }
      expect([ok.statusCode, caminhoRuim.statusCode, semToken.statusCode, post.statusCode, erroDaTrimble.statusCode]).toEqual([200, 400, 401, 405, 429])
    })
  })

  describe('pedido', () => {
    it('caminho fora do formato: 400; método que não é GET: 405', async () => {
      const fetch = vi.fn()
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      const ruim = resFalso()
      await handler(req('../x'), ruim)
      expect(ruim.statusCode).toBe(400)
      const semP = resFalso()
      await handler(req(null), semP)
      expect(semP.statusCode).toBe(400)
      const post = resFalso()
      await handler(req(SERIE_HOJE, TOKEN, 'POST'), post)
      expect(post.statusCode).toBe(405)
      expect(post.cabecalhos['allow']).toBe('GET')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('só um parâmetro p: parâmetro a mais, p repetido ou endereço torto dão 400 sem chamar ninguém', async () => {
      const p = encodeURIComponent(SERIE_HOJE)
      const fetch = vi.fn()
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      for (const url of [`/api/gnss?p=${p}&lixo=1`, `/api/gnss?lixo=1&p=${p}`, `/api/gnss?p=${p}&p=${p}`, `/api/gnss?q=${p}`, '//']) {
        const res = resFalso()
        await handler(reqUrl(url), res)
        expect(res.statusCode, url).toBe(400)
      }
      expect(fetch).not.toHaveBeenCalled()
    })

    it('instante com mais de 32 dias atrás ou mais de 1 dia à frente: 400', async () => {
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
      const imagem = (ms: number) => `overlay/sci/${iso(ms)}`
      const fetch = fetchFalso(respostaPng())
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      const status = async (p: string) => {
        const res = resFalso()
        await handler(req(p), res)
        return res.statusCode
      }
      expect(await status(imagem(AGORA - 32 * DIA))).toBe(200)
      expect(await status(imagem(AGORA - 32 * DIA - 600_000))).toBe(400)
      expect(await status(imagem(AGORA + DIA))).toBe(200)
      expect(await status(imagem(AGORA + DIA + 600_000))).toBe(400)
      expect(await status('ionoindex/-56.5/-14.5/2026-08-01T00:00:00/24/600')).toBe(400)
      expect(await status('ionoindex/-56.5/-14.5/2026-10-07T00:00:00/24/600')).toBe(400)
    })
  })

  describe('sessão', () => {
    it('sem token, ou com token que o Supabase recusa: 401 e a Trimble não é chamada', async () => {
      const fetch = vi.fn(async (url: string | URL | Request, _opcoes?: RequestInit) => {
        if (String(url).includes('/auth/v1/user')) return new Response('{}', { status: 401 })
        throw new Error('a Trimble não devia ser chamada')
      })
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      const semToken = resFalso()
      await handler(req(SERIE_HOJE, null), semToken)
      expect(semToken.statusCode).toBe(401)
      const recusado = resFalso()
      await handler(req(SERIE_HOJE, jwt({ sub: 'u2' })), recusado)
      expect(recusado.statusCode).toBe(401)
      expect(recusado.cabecalhos['cache-control']).toBe('no-store')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it('Supabase respondendo 403 também é 401 nosso', async () => {
      const fetch = fetchFalso(respostaJson(), () => new Response('{}', { status: 403 }))
      expect((await chamar(fetch, req(SERIE_HOJE))).statusCode).toBe(401)
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it.each([
      ['não é JWT', 'a'.repeat(40)],
      ['só duas partes', `${base64url({ alg: 'HS256' })}.${base64url({ sub: 'u1', exp: AGORA / 1000 + 3600 })}`],
      ['quatro partes', `${jwt()}.sobra`],
      ['carga que não é JSON', `${base64url({})}.${'!!!!'.repeat(10)}.assinatura`],
      ['sem sub (como a chave anon pública)', jwt({ sub: undefined, role: 'anon' })],
      ['sub que não é texto', jwt({ sub: 42 })],
      ['sem exp', jwt({ exp: undefined })],
      ['exp que não é número', jwt({ exp: '9999999999' })],
      ['vencido', jwt({ exp: AGORA / 1000 - 1 })],
      ['vence neste instante', jwt({ exp: AGORA / 1000 })],
    ])('token %s: 401 sem chamar ninguém', async (_nome, token) => {
      const fetch = vi.fn()
      const res = await chamar(fetch, req(SERIE_HOJE, token))
      expect(res.statusCode).toBe(401)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('cabeçalho do token repetido (lista): 401 sem chamar ninguém', async () => {
      const fetch = vi.fn()
      const res = await chamar(fetch, req(SERIE_HOJE, [TOKEN, TOKEN]))
      expect(res.statusCode).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('Supabase com erro 500 ou fora do ar: 503 (não 401) e a Trimble não é chamada', async () => {
      const com500 = fetchFalso(respostaJson(), () => new Response('erro', { status: 500 }))
      const a = await chamar(com500, req(SERIE_HOJE))
      expect(a.statusCode).toBe(503)
      expect(a.cabecalhos['cache-control']).toBe('no-store')
      expect(String(a.corpo)).toBe('Não foi possível conferir a sessão.')
      expect(chamadasA(com500, 'https://www.gnssplanning.com/')).toHaveLength(0)

      const caiu = vi.fn(async (_url: string | URL | Request, _opcoes?: RequestInit): Promise<Response> => {
        throw new TypeError('fetch failed')
      })
      const b = await chamar(caiu, req(SERIE_HOJE))
      expect(b.statusCode).toBe(503)
      expect(String(b.corpo)).toBe('Não foi possível conferir a sessão.')
      // a sessão e a categoria são perguntadas juntas: duas idas ao Supabase, nenhuma à Trimble
      expect(caiu).toHaveBeenCalledTimes(2)
      expect(chamadasA(caiu, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it('só o 200 do Supabase vale: 204 e 3xx não passam', async () => {
      for (const status of [204, 302]) {
        const res = await chamar(fetchFalso(respostaJson(), () => new Response(null, { status })), req(SERIE_HOJE))
        expect(res.statusCode, `status ${status}`).toBe(503)
      }
    })

    it('token conferido vale 5 min: o segundo pedido não volta ao Supabase', async () => {
      const fetch = fetchFalso(respostaJson('[]', 'application/json'))
      let agora = AGORA
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => agora })
      const token = jwt({ sub: 'u3' })
      await handler(req(SERIE_HOJE, token), resFalso())
      await handler(req(SERIE_HOJE, token), resFalso())
      const idas = () => chamadasA(fetch, SUPABASE_USER).length
      expect(idas()).toBe(1)
      agora += 5 * 60_000 + 1
      await handler(req(SERIE_HOJE, token), resFalso())
      expect(idas()).toBe(2)
    })

    it('token recusado depois de conferido não fica no cache', async () => {
      let status = 200
      const fetch = fetchFalso(respostaJson(), () => new Response('{}', { status }))
      let agora = AGORA
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => agora })
      const token = jwt({ sub: 'u5' })
      const a = resFalso()
      await handler(req(SERIE_HOJE, token), a)
      expect(a.statusCode).toBe(200)
      agora += 5 * 60_000 + 1
      status = 401
      const b = resFalso()
      await handler(req(SERIE_HOJE, token), b)
      expect(b.statusCode).toBe(401)
      agora += 1
      const c = resFalso()
      await handler(req(SERIE_HOJE, token), c)
      expect(c.statusCode).toBe(401)
      expect(chamadasA(fetch, SUPABASE_USER)).toHaveLength(3)
    })
  })

  describe('categoria', () => {
    const semCategoria = respostaCategoria('false')

    it('pergunta ao banco se quem está logado tem a categoria sat: RPC com a chave anon, o token do usuário e prazo (AbortSignal)', async () => {
      const fetch = fetchFalso(respostaJson())
      const res = await chamar(fetch, req(SERIE_HOJE))
      expect(res.statusCode).toBe(200)
      const idas = chamadasA(fetch, SUPABASE_CATEGORIA)
      expect(idas).toHaveLength(1)
      expect(String(idas[0][0])).toBe(SUPABASE_CATEGORIA)
      const opcoes = idas[0][1]
      expect(opcoes?.method).toBe('POST')
      expect(JSON.parse(String(opcoes?.body))).toEqual({ p_categoria: 'sat' })
      const cabecalhos = opcoes?.headers as Record<string, string>
      expect(cabecalhos.apikey).toMatch(/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/)
      expect(cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`)
      expect(cabecalhos['Content-Type']).toBe('application/json')
      expect(opcoes?.signal).toBeInstanceOf(AbortSignal)
    })

    it('sem a categoria Locks SAT: 403 sem cache, com os cabeçalhos de segurança, e a Trimble não é chamada', async () => {
      const fetch = fetchFalso(respostaJson(), undefined, semCategoria)
      const res = await chamar(fetch, req(SERIE_HOJE, jwt({ sub: 'c1' })))
      expect(res.statusCode).toBe(403)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(res.cabecalhos['content-type']).toBe('text/plain; charset=utf-8')
      expect(res.cabecalhos['x-content-type-options']).toBe('nosniff')
      expect(res.cabecalhos['cross-origin-resource-policy']).toBe('same-origin')
      expect(String(res.corpo)).toBe('Sem acesso ao Locks SAT.')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it('a resposta do banco pode vir com espaço ou quebra de linha em volta', async () => {
      const com = await chamar(fetchFalso(respostaJson(), undefined, respostaCategoria(' true\r\n')), req(SERIE_HOJE, jwt({ sub: 'c2' })))
      expect(com.statusCode).toBe(200)
      const sem = await chamar(fetchFalso(respostaJson(), undefined, respostaCategoria('false\n')), req(SERIE_HOJE, jwt({ sub: 'c3' })))
      expect(sem.statusCode).toBe(403)
    })

    it('o "não" não fica guardado: liberada a categoria, o pedido seguinte já passa', async () => {
      let tem = false
      const fetch = fetchFalso(respostaJson(), undefined, () => respostaCategoria(String(tem))())
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      const token = jwt({ sub: 'c4' })
      const antes = resFalso()
      await handler(req(SERIE_HOJE, token), antes)
      expect(antes.statusCode).toBe(403)
      tem = true
      const depois = resFalso()
      await handler(req(SERIE_HOJE, token), depois)
      expect(depois.statusCode).toBe(200)
      expect(chamadasA(fetch, SUPABASE_CATEGORIA)).toHaveLength(2)
    })

    it('quem tem a categoria vale 5 min (o mesmo cache da sessão): depois o banco é perguntado de novo, e quem a perdeu recebe 403', async () => {
      let tem = true
      const fetch = fetchFalso(respostaJson(), undefined, () => respostaCategoria(String(tem))())
      let agora = AGORA
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => agora })
      const token = jwt({ sub: 'c5' })
      const idas = () => chamadasA(fetch, SUPABASE_CATEGORIA).length
      await handler(req(SERIE_HOJE, token), resFalso())
      tem = false
      agora += 5 * 60_000 - 1
      const dentro = resFalso()
      await handler(req(SERIE_HOJE, token), dentro)
      expect(dentro.statusCode).toBe(200)
      expect(idas()).toBe(1)
      agora += 2
      const fora = resFalso()
      await handler(req(SERIE_HOJE, token), fora)
      expect(fora.statusCode).toBe(403)
      expect(idas()).toBe(2)
      // e o 403 não renova o cache: o pedido seguinte pergunta outra vez (sessão e categoria)
      await handler(req(SERIE_HOJE, token), resFalso())
      expect(idas()).toBe(3)
      expect(chamadasA(fetch, SUPABASE_USER)).toHaveLength(3)
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(2)
    })

    it('o cache é por token: a categoria de um usuário não vale para outro', async () => {
      const comCategoria = jwt({ sub: 'c6' })
      const semEla = jwt({ sub: 'c7' })
      const fetch = vi.fn(async (url: string | URL | Request, opcoes?: RequestInit) => {
        const u = String(url)
        if (u.includes('/auth/v1/user')) return new Response('{}', { status: 200 })
        if (u.includes('/rest/v1/rpc/tem_categoria')) {
          const autorizacao = (opcoes?.headers as Record<string, string>).Authorization
          return respostaCategoria(String(autorizacao === `Bearer ${comCategoria}`))()
        }
        return respostaJson()()
      })
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      const a = resFalso()
      await handler(req(SERIE_HOJE, comCategoria), a)
      const b = resFalso()
      await handler(req(SERIE_HOJE, semEla), b)
      expect([a.statusCode, b.statusCode]).toEqual([200, 403])
    })

    it.each([
      ['erro 500', respostaCategoria('{"message":"erro"}', 500)],
      ['função que o banco não acha (404)', respostaCategoria('{"code":"PGRST202"}', 404)],
      ['sem permissão para chamar a função (403)', respostaCategoria('{"code":"42501"}', 403)],
      ['204 sem corpo', () => new Response(null, { status: 204 })],
      ['corpo vazio', respostaCategoria('')],
      ['null', respostaCategoria('null')],
      ['um objeto', respostaCategoria('{"tem_categoria":true}')],
      ['uma lista', respostaCategoria('[true]')],
      ['texto "true" entre aspas', respostaCategoria('"true"')],
      ['um número', respostaCategoria('1')],
    ])('banco que não responde sim nem não à pergunta da categoria (%s): 503, nunca 200 nem 403', async (_nome, categoria) => {
      const fetch = fetchFalso(respostaJson(), undefined, categoria)
      const res = await chamar(fetch, req(SERIE_HOJE, jwt({ sub: 'c8' })))
      expect(res.statusCode).toBe(503)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(String(res.corpo)).toBe('Não foi possível conferir a categoria.')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it('queda de rede só na pergunta da categoria: 503, a Trimble não é chamada e nada fica no cache', async () => {
      let caiu = true
      const fetch = vi.fn(async (url: string | URL | Request, _opcoes?: RequestInit) => {
        const u = String(url)
        if (u.includes('/auth/v1/user')) return new Response('{}', { status: 200 })
        if (u.includes('/rest/v1/rpc/tem_categoria')) {
          if (caiu) throw new TypeError('fetch failed')
          return respostaCategoria()()
        }
        return respostaJson()()
      })
      const handler = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })
      const token = jwt({ sub: 'c9' })
      const a = resFalso()
      await handler(req(SERIE_HOJE, token), a)
      expect(a.statusCode).toBe(503)
      expect(String(a.corpo)).toBe('Não foi possível conferir a categoria.')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
      caiu = false
      const b = resFalso()
      await handler(req(SERIE_HOJE, token), b)
      expect(b.statusCode).toBe(200)
      expect(chamadasA(fetch, SUPABASE_USER)).toHaveLength(2)
    })

    it('o banco recusa o token na pergunta da categoria (401): é sessão que não vale, 401 nosso', async () => {
      const fetch = fetchFalso(respostaJson(), undefined, respostaCategoria('{"code":"PGRST301"}', 401))
      const res = await chamar(fetch, req(SERIE_HOJE, jwt({ sub: 'c10' })))
      expect(res.statusCode).toBe(401)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it('sessão recusada continua 401, com ou sem a categoria', async () => {
      for (const categoria of [respostaCategoria(), semCategoria, respostaCategoria('erro', 500)]) {
        const fetch = fetchFalso(respostaJson(), () => new Response('{}', { status: 401 }), categoria)
        const res = await chamar(fetch, req(SERIE_HOJE, jwt({ sub: 'c11' })))
        expect(res.statusCode).toBe(401)
        expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
      }
    })

    it('sessão que não pôde ser conferida continua 503, mesmo que o banco diga que não há a categoria', async () => {
      const fetch = fetchFalso(respostaJson(), () => new Response('erro', { status: 500 }), semCategoria)
      const res = await chamar(fetch, req(SERIE_HOJE, jwt({ sub: 'c12' })))
      expect(res.statusCode).toBe(503)
      expect(String(res.corpo)).toBe('Não foi possível conferir a sessão.')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
    })

    it('token fora do formato nem chega a perguntar a categoria', async () => {
      const fetch = vi.fn()
      const res = await chamar(fetch, req(SERIE_HOJE, jwt({ exp: AGORA / 1000 - 1 })))
      expect(res.statusCode).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('prazos', () => {
    /** fetch que nunca responde sozinho: só quando o AbortSignal dispara */
    const pendurado = (_url: string | URL | Request, opcoes?: RequestInit) =>
      new Promise<Response>((_resolve, rejeitar) => {
        opcoes?.signal?.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')))
      })

    it('Supabase sem responder em 3 s: 503', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const fetch = vi.fn(pendurado)
      const res = resFalso()
      const fim = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })(req(SERIE_HOJE), res)
      await vi.advanceTimersByTimeAsync(2999)
      expect(res.statusCode).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await fim
      expect(res.statusCode).toBe(503)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(vi.getTimerCount()).toBe(0)
    })

    it('Trimble sem responder em 6 s: 504', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const fetch = vi.fn((url: string | URL | Request, opcoes?: RequestInit) => {
        if (String(url).includes('/auth/v1/user')) return Promise.resolve(new Response('{}', { status: 200 }))
        if (String(url).includes('/rest/v1/rpc/tem_categoria')) return Promise.resolve(respostaCategoria()())
        return pendurado(url, opcoes)
      })
      const res = resFalso()
      const fim = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })(req(SERIE_HOJE), res)
      await vi.advanceTimersByTimeAsync(5999)
      expect(res.statusCode).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await fim
      expect(res.statusCode).toBe(504)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(vi.getTimerCount()).toBe(0)
    })

    it('pergunta da categoria sem resposta em 3 s, com a sessão já aceita: 503 e a Trimble não é chamada', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const fetch = vi.fn((url: string | URL | Request, opcoes?: RequestInit) =>
        String(url).includes('/auth/v1/user') ? Promise.resolve(new Response('{}', { status: 200 })) : pendurado(url, opcoes))
      const res = resFalso()
      const fim = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })(req(SERIE_HOJE), res)
      await vi.advanceTimersByTimeAsync(2999)
      expect(res.statusCode).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await fim
      expect(res.statusCode).toBe(503)
      expect(res.cabecalhos['cache-control']).toBe('no-store')
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('sessão e categoria são perguntadas ao mesmo tempo, no mesmo prazo de 3 s: as duas demorando 2,9 s não somam', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const depoisDe = (ms: number, resposta: () => Response) => new Promise<Response>((resolver) => { setTimeout(() => resolver(resposta()), ms) })
      const fetch = vi.fn((url: string | URL | Request, _opcoes?: RequestInit) => {
        if (String(url).includes('/auth/v1/user')) return depoisDe(2900, () => new Response('{}', { status: 200 }))
        if (String(url).includes('/rest/v1/rpc/tem_categoria')) return depoisDe(2900, respostaCategoria())
        return Promise.resolve(respostaJson()())
      })
      const res = resFalso()
      const fim = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })(req(SERIE_HOJE), res)
      await vi.advanceTimersByTimeAsync(0)
      // as duas perguntas já saíram, e a Trimble ainda não
      expect(chamadasA(fetch, SUPABASE_USER)).toHaveLength(1)
      expect(chamadasA(fetch, SUPABASE_CATEGORIA)).toHaveLength(1)
      expect(chamadasA(fetch, 'https://www.gnssplanning.com/')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(2900)
      await fim
      expect(res.statusCode).toBe(200)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('no pior caso (Supabase no limite dos 3 s e Trimble sem responder) a resposta sai em 9 s, antes dos 10 s da função', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const depoisDe = (ms: number, resposta: () => Response) => new Promise<Response>((resolver) => { setTimeout(() => resolver(resposta()), ms) })
      const fetch = vi.fn((url: string | URL | Request, opcoes?: RequestInit) => {
        if (String(url).includes('/auth/v1/user')) return depoisDe(2999, () => new Response('{}', { status: 200 }))
        if (String(url).includes('/rest/v1/rpc/tem_categoria')) return depoisDe(2999, respostaCategoria())
        return pendurado(url, opcoes)
      })
      const res = resFalso()
      const fim = ponte.criarHandler({ fetch: fetch as never, agora: () => AGORA })(req(SERIE_HOJE), res)
      await vi.advanceTimersByTimeAsync(2999 + 5999)
      expect(res.statusCode).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await fim
      expect(res.statusCode).toBe(504)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('respondendo a tempo, nenhum relógio fica ligado', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const res = resFalso()
      await ponte.criarHandler({ fetch: fetchFalso(respostaJson()) as never, agora: () => AGORA })(req(SERIE_HOJE), res)
      expect(res.statusCode).toBe(200)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
