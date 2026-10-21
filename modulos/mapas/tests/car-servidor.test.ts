// Mapa de CAR e Matrícula, lado do servidor: recorte, leitura das bases públicas e pedidos. Dados e endereços FICTÍCIOS
// (as bases são simuladas por um fetch falso que responde pelo endereço).
import { describe, expect, it } from 'vitest';
import {
  buscarCarMatricula,
  fracaoDosTalhoes,
  lerGmlSigef,
  montarSqlEucalipto,
  pontoNaGeometria,
  pontosDosTalhoes,
  recortarNoRetangulo,
  retanguloDe,
} from '../scripts/sincronizar-plantio.mjs';
import { atenderPedidosCar, planejarCar, RESULTADO_CAR_SO_SUPER, RESULTADO_CAR_VELHO, RESULTADOS } from '../scripts/atender-pedidos.mjs';

const quadrado = (x0: number, y0: number, l: number) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x0 + l, y0], [x0 + l, y0 + l], [x0, y0 + l], [x0, y0]]],
});
// talhão de 0,01° × 0,01° em (-54,70; -17,30)
const TALHAO = quadrado(-54.7, -17.3, 0.01);

describe('geometria sem dependências', () => {
  it('ponto no polígono respeita o furo', () => {
    const comFuro = { type: 'Polygon', coordinates: [quadrado(0, 0, 10).coordinates[0], quadrado(4, 4, 2).coordinates[0]] };
    expect(pontoNaGeometria([1, 1], comFuro)).toBe(true);
    expect(pontoNaGeometria([5, 5], comFuro)).toBe(false);
    expect(pontoNaGeometria([11, 1], comFuro)).toBe(false);
  });

  it('fração dos talhões: o CAR da fazenda pega tudo, o vizinho que só encosta na divisa pega nada', () => {
    const pontos = pontosDosTalhoes([{ geom: TALHAO, ret: retanguloDe([TALHAO]) }], 30);
    expect(pontos.length).toBeGreaterThan(500);
    expect(fracaoDosTalhoes(quadrado(-54.71, -17.31, 0.03), pontos)).toBe(1);
    expect(fracaoDosTalhoes(quadrado(-54.69, -17.3, 0.01), pontos)).toBe(0); // encosta no lado leste
    expect(fracaoDosTalhoes(quadrado(-54.695, -17.3, 0.01), pontos)).toBeCloseTo(0.5, 1); // metade
  });

  it('recorta linhas e polígonos no retângulo', () => {
    const ret = [0, 0, 10, 10];
    const linha = recortarNoRetangulo({ type: 'LineString', coordinates: [[-5, 5], [15, 5]] }, ret);
    expect(linha).toEqual({ type: 'LineString', coordinates: [[0, 5], [10, 5]] });
    // entra, sai e entra de novo: duas partes
    const zigue = recortarNoRetangulo({ type: 'LineString', coordinates: [[5, 5], [5, 15], [8, 15], [8, 5]] }, ret);
    expect(zigue?.type).toBe('MultiLineString');
    expect(recortarNoRetangulo({ type: 'LineString', coordinates: [[20, 20], [30, 30]] }, ret)).toBeNull();
    const lago = recortarNoRetangulo(quadrado(5, 5, 100), ret) as { type: string; coordinates: number[][][][] };
    expect(lago.type).toBe('MultiPolygon');
    const xs = lago.coordinates[0][0].map((p) => p[0]);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.min(...xs)).toBe(5);
  });
});

const GML = (parcelas: { matricula: string; x0: number; y0: number; l: number }[]) => `<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection xmlns:ms="http://www.omsug.ca/osgis2004" xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml">
${parcelas
  .map(
    (p, i) => `<gml:featureMember><ms:certificada_sigef_particular_mt fid="${i}">
<ms:msGeometry><gml:MultiPolygon srsName="EPSG:4674"><gml:polygonMember><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>${p.x0},${p.y0} ${p.x0 + p.l},${p.y0} ${p.x0 + p.l},${p.y0 + p.l} ${p.x0},${p.y0 + p.l} ${p.x0},${p.y0}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon></gml:polygonMember></gml:MultiPolygon></ms:msGeometry>
<ms:parcela_codigo>P${i}</ms:parcela_codigo><ms:registro_matricula>${p.matricula}</ms:registro_matricula><ms:status>CERTIFICADA</ms:status>
</ms:certificada_sigef_particular_mt></gml:featureMember>`,
  )
  .join('\n')}
</wfs:FeatureCollection>`;

describe('leitura do SIGEF (GML do MapServer)', () => {
  it('cada parcela vira MultiPolygon com os campos ms:*', () => {
    const fs = lerGmlSigef(GML([{ matricula: '12.345', x0: 1, y0: 2, l: 1 }]));
    expect(fs).toHaveLength(1);
    expect(fs[0].properties).toMatchObject({ registro_matricula: '12.345', parcela_codigo: 'P0', status: 'CERTIFICADA' });
    expect(fs[0].geometry.type).toBe('MultiPolygon');
    expect((fs[0].geometry.coordinates as number[][][][])[0][0]).toHaveLength(5);
  });
});

describe('SQL do eucalipto', () => {
  it('filtra a unidade (com aspas escapadas) e usa a ocupação do período mais recente', () => {
    const sql = montarSqlEucalipto("sm3'x");
    expect(sql).toContain("u.DE_UNI_ADM = 'SM3''X'");
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY up\.CD_UPNIVEL3 ORDER BY ps\.DT_INI_PER DESC/);
    expect(sql).toContain("n = 1 AND ocupacao = 'EUCALIPTO'");
  });
});

/** fetch falso: responde pelo host/parâmetros de cada base; o Overpass principal cai, o espelho responde. */
function basesFalsas(registro: string[] = []) {
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    registro.push(u.host);
    const tn = u.searchParams.get('typeName') ?? '';
    if (u.host === 'consulta.car.gov.br' && tn === 'consulta_publica:estado') return json({ features: [{ properties: { cod_estado_ibge: 51, nom_estado: 'MATO GROSSO' } }] });
    if (u.host === 'geoserver.car.gov.br') {
      return json({
        features: [
          { properties: { cod_imovel: 'MT-1-AAA', area: 120.5, status_imovel: 'AT', tipo_imovel: 'IRU' }, geometry: quadrado(-54.705, -17.305, 0.02) },
          { properties: { cod_imovel: 'MT-1-VIZ', area: 80, status_imovel: 'AT', tipo_imovel: 'IRU' }, geometry: quadrado(-54.69, -17.3, 0.01) },
        ],
      });
    }
    if (u.host === 'consulta.car.gov.br') {
      expect(u.searchParams.get('CQL_FILTER')).toContain("cod_imovel IN ('MT-1-AAA')");
      return json({ features: tn.includes('consulta_publica:vegetacao_nativa') ? [{ id: 'vegetacao_nativa.7', properties: { cod_imovel: 'MT-1-AAA' }, geometry: quadrado(-54.704, -17.304, 0.002) }] : [] });
    }
    if (u.host === 'acervofundiario.incra.gov.br') {
      return new Response(GML([{ matricula: '4.321', x0: -54.7, y0: -17.3, l: 0.005 }, { matricula: '9.999', x0: -54.5, y0: -17.1, l: 0.01 }]), { status: 200 });
    }
    if (u.host === 'geoservicos.ibge.gov.br') {
      return json({ features: tn.includes('Rodoviario') ? [{ properties: { codtrechorod: 'BR-163' }, geometry: { type: 'LineString', coordinates: [[-56, -17.295], [-53, -17.295]] } }] : [] });
    }
    if (u.host === 'overpass-api.de') throw new TypeError('fetch failed');
    if (u.host === 'maps.mail.ru') {
      expect((init?.headers as Record<string, string>).Accept).toBe('*/*');
      return json({ elements: [{ type: 'way', tags: { highway: 'track' }, geometry: [{ lon: -54.699, lat: -17.299 }, { lon: -54.695, lat: -17.295 }] }] });
    }
    return new Response('não esperado', { status: 500 });
  };
}

describe('busca do CAR e matrícula (bases simuladas)', () => {
  it('fica só com o CAR e a parcela que cobrem os talhões; recorta as linhas; espelho do OSM quando o principal cai', async () => {
    const r = await buscarCarMatricula({ talhoes: [{ geom: TALHAO }], fetchImpl: basesFalsas() as typeof fetch, agora: new Date('2026-10-21T12:00:00Z') });
    expect(r.dados.ufs).toEqual(['MT']);
    expect(r.dados.car.features.map((f) => f.properties.cod_imovel)).toEqual(['MT-1-AAA']);
    expect(r.dados.temas.features).toEqual([expect.objectContaining({ properties: { tema: 'vegetacao_nativa', cod_imovel: 'MT-1-AAA' } })]);
    expect(r.dados.matriculas.features.map((f) => f.properties.matricula)).toEqual(['4.321']);
    const br = r.dados.estradas.features.find((f) => f.properties.fonte === 'ibge')!;
    const xs = (br.geometry.coordinates as number[][]).map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-54.73);
    expect(r.dados.estradas.features.some((f) => f.properties.fonte === 'osm' && f.properties.classe === 'track')).toBe(true);
    expect(r.fontes).toMatchObject({ sicar: { ok: true, n: 1 }, temas: { ok: true }, sigef: { ok: true, n: 1 }, ibge: { ok: true }, osm: { ok: true }, pims: { ok: false } });
  });

  it('uma base fora do ar não derruba as outras', async () => {
    const base = basesFalsas();
    const semSigef = (async (url: string | URL, init?: RequestInit) => (new URL(String(url)).host === 'acervofundiario.incra.gov.br' ? new Response('erro', { status: 503 }) : base(url, init))) as typeof fetch;
    const r = await buscarCarMatricula({ talhoes: [{ geom: TALHAO }], fetchImpl: semSigef });
    expect(r.fontes.sigef).toEqual({ ok: false, n: 0, erro: 'indisponível no momento' });
    expect(r.dados.matriculas.features).toEqual([]);
    expect(r.dados.car.features).toHaveLength(1);
  });

  it('fazenda sem talhão desenhado: erro com texto para a tela', async () => {
    await expect(buscarCarMatricula({ talhoes: [], fetchImpl: basesFalsas() as typeof fetch })).rejects.toMatchObject({ tipo: 'invalido' });
  });
});

describe('pedidos de "Buscar nas bases"', () => {
  it('planeja a fazenda do pedido mais antigo e junta os pedidos dela', () => {
    const p = planejarCar([
      { id: 1, fazenda_id: 'a', pedido_por: 'u1' },
      { id: 2, fazenda_id: 'b', pedido_por: 'u1' },
      { id: 3, fazenda_id: 'a', pedido_por: 'u2' },
    ]);
    expect(p).toEqual({ fazendaId: 'a', pedidos: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 3 })] });
    expect(planejarCar([])).toBeNull();
  });

  const FAZ = '11111111-1111-4111-8111-111111111111';
  const SUPER = '22222222-2222-4222-8222-222222222222';
  const COMUM = '33333333-3333-4333-8333-333333333333';
  function supabaseFalso(estado: { pedidos: { id: number; pedido_por: string; fazenda_id: string; resultado?: string }[]; gravado?: unknown }) {
    const bases = basesFalsas();
    const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host !== 'sb.test') return bases(url, init);
      const caminho = u.pathname.replace('/rest/v1/', '');
      const metodo = init?.method ?? 'GET';
      if (caminho === 'mapas_car_pedidos' && metodo === 'GET') return json(estado.pedidos.filter((p) => !p.resultado));
      if (caminho === 'mapas_car_pedidos' && metodo === 'PATCH') {
        const ids = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(u.search))![1].split(',').map(Number);
        const corpo = JSON.parse(String(init!.body));
        estado.pedidos.filter((p) => ids.includes(p.id)).forEach((p) => (p.resultado = corpo.resultado));
        return new Response(null, { status: 204 });
      }
      if (caminho === 'mapas_car_pedidos' && metodo === 'DELETE') return new Response(null, { status: 204 });
      if (caminho === 'perfis') return json(u.searchParams.get('id') === `eq.${SUPER}` ? [{ perfil: 'admin', super: true }] : [{ perfil: 'admin', super: false }]);
      if (caminho === 'mapas_car' && metodo === 'GET') return json([]);
      if (caminho === 'mapas_car' && metodo === 'POST') {
        estado.gravado = JSON.parse(String(init!.body));
        return new Response(null, { status: 201 });
      }
      if (caminho === 'mapas_fazendas') return json([{ id: FAZ, unidade_pims: null }]);
      if (caminho === 'mapas_talhoes') return json([{ geom: TALHAO }]);
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
  }

  it('só o ADMINISTRADOR+ é atendido; a busca grava em mapas_car e responde ok', async () => {
    const estado: Parameters<typeof supabaseFalso>[0] = {
      pedidos: [
        { id: 1, pedido_por: COMUM, fazenda_id: FAZ },
        { id: 2, pedido_por: SUPER, fazenda_id: FAZ },
      ],
    };
    const n = await atenderPedidosCar({ supabase: { url: 'https://sb.test', chave: 'chave-falsa' }, agrovex: { url: 'https://agrovex.test/mcp', token: 'tk' }, fetch: supabaseFalso(estado), agora: () => new Date('2026-10-21T12:00:00Z') });
    expect(n).toBe(2);
    expect(estado.pedidos.find((p) => p.id === 1)!.resultado).toBe(RESULTADO_CAR_SO_SUPER);
    expect(estado.pedidos.find((p) => p.id === 2)!.resultado).toBe('ok');
    const linha = (estado.gravado as { fazenda_id: string; dados: { car: { features: unknown[] } }; fontes: Record<string, unknown> }[])[0];
    expect(linha.fazenda_id).toBe(FAZ);
    expect(linha.dados.car.features).toHaveLength(1);
    expect(linha.fontes).toHaveProperty('sigef');
  });
});

describe('simplificação (o resultado tem de caber no banco)', () => {
  it('tira os vértices que não mudam o desenho e mantém o anel fechado com 4+ pontos', async () => {
    const { simplificarGeometria } = await import('../scripts/sincronizar-plantio.mjs');
    // lado de 0,01° com 100 vértices quase alinhados (desvio de 1e-6°, bem abaixo da tolerância de 3e-5°)
    const lado = Array.from({ length: 100 }, (_, i) => [i * 0.0001, (i % 2) * 1e-6]);
    const anel = [...lado, [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
    const s = simplificarGeometria({ type: 'Polygon', coordinates: [anel] }) as { coordinates: number[][][] };
    expect(s.coordinates[0].length).toBeLessThan(10);
    expect(s.coordinates[0][0]).toEqual(s.coordinates[0][s.coordinates[0].length - 1]);
    // triângulo pequeno: continua com 4 pontos
    const tri = [[0, 0], [0.00001, 0], [0, 0.00001], [0, 0]];
    expect((simplificarGeometria({ type: 'Polygon', coordinates: [tri] }) as { coordinates: number[][][] }).coordinates[0]).toHaveLength(4);
  });
});

describe('correções da revisão (servidor)', () => {
  it('prazo total: base que não coube no prazo sai como falha, sem travar a busca', async () => {
    const lento = (async (url: string | URL, init?: RequestInit) => {
      const host = new URL(String(url)).host;
      if (host === 'geoserver.car.gov.br') {
        // responde só quando o prazo da chamada estoura
        return await new Promise<Response>((_ok, falha) => init?.signal?.addEventListener('abort', () => falha(Object.assign(new Error('abortou'), { name: 'TimeoutError' }))));
      }
      return basesFalsas()(url, init);
    }) as typeof fetch;
    const t0 = Date.now();
    const r = await buscarCarMatricula({ talhoes: [{ geom: TALHAO }], fetchImpl: lento, prazoMs: 300 });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.fontes.sicar).toMatchObject({ ok: false });
    // sem o limite do CAR não há tema a consultar: falha também (o rodapé não diz "SICAR")
    expect(r.fontes.temas).toEqual({ ok: false, n: 0, erro: 'sem o limite do CAR para consultar' });
    expect(Object.values(r.fontes).filter((f) => f.erro?.startsWith('não houve tempo')).length).toBeGreaterThan(0);
  }, 30_000);

  it('GML do SIGEF: entidades XML convertidas', () => {
    const t = GML([{ matricula: 'S&#227;o 12 &amp; 13', x0: 0, y0: 0, l: 1 }]);
    expect(lerGmlSigef(t)[0].properties.registro_matricula).toBe('São 12 & 13');
  });
});

describe('correções da revisão (pedidos)', () => {
  const FAZ = '11111111-1111-4111-8111-111111111111';
  const SUPER = '22222222-2222-4222-8222-222222222222';
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
  function sb(estado: { pedidos: { id: number; pedido_por: string; fazenda_id: string; pedido_em: string; resultado?: string }[]; perfisFalham?: boolean; ultimo?: unknown[]; basesChamadas?: number }) {
    const bases = basesFalsas();
    return (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host !== 'sb.test') {
        estado.basesChamadas = (estado.basesChamadas ?? 0) + 1;
        return bases(url, init);
      }
      const caminho = u.pathname.replace('/rest/v1/', '');
      const metodo = init?.method ?? 'GET';
      if (caminho === 'mapas_car_pedidos' && metodo === 'GET') return json(estado.pedidos.filter((p) => !p.resultado));
      if (caminho === 'mapas_car_pedidos' && metodo === 'PATCH') {
        const ids = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(u.search))![1].split(',').map(Number);
        const corpo = JSON.parse(String(init!.body));
        estado.pedidos.filter((p) => ids.includes(p.id)).forEach((p) => (p.resultado = corpo.resultado));
        return new Response(null, { status: 204 });
      }
      if (metodo === 'DELETE') return new Response(null, { status: 204 });
      if (caminho === 'perfis') return estado.perfisFalham ? new Response('{"message":"x"}', { status: 500 }) : json([{ perfil: 'admin', super: true }]);
      if (caminho === 'mapas_car' && metodo === 'GET') return json(estado.ultimo ?? []);
      if (caminho === 'mapas_car' && metodo === 'POST') return new Response(null, { status: 201 });
      if (caminho === 'mapas_fazendas') return json([{ id: FAZ, unidade_pims: null }]);
      if (caminho === 'mapas_talhoes') return json([{ geom: TALHAO }]);
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
  }
  const rodar = (estado: Parameters<typeof sb>[0], agora = '2026-10-21T12:00:00Z') =>
    atenderPedidosCar({ supabase: { url: 'https://sb.test', chave: 'k' }, agrovex: { url: 'https://agrovex.test/mcp', token: 'tk' }, fetch: sb(estado), agora: () => new Date(agora) });

  it('pedido pendente há mais de 30 min: respondido com erro, sem buscar de novo', async () => {
    const estado: Parameters<typeof sb>[0] = { pedidos: [{ id: 1, pedido_por: SUPER, fazenda_id: FAZ, pedido_em: '2026-10-21T11:00:00Z' }] };
    await rodar(estado);
    expect(estado.pedidos[0].resultado).toBe(RESULTADO_CAR_VELHO);
    expect(estado.basesChamadas ?? 0).toBe(0);
  });

  it('falha ao ler o perfil: "não foi possível conferir", não "só do ADMINISTRADOR+"', async () => {
    const estado: Parameters<typeof sb>[0] = { perfisFalham: true, pedidos: [{ id: 1, pedido_por: SUPER, fazenda_id: FAZ, pedido_em: '2026-10-21T11:59:00Z' }] };
    await rodar(estado);
    expect(estado.pedidos[0].resultado).toBe(RESULTADOS.permissaoIndisponivel);
  });

  it('resultado recente e completo é reaproveitado; recente com base falha, busca de novo', async () => {
    const completo: Parameters<typeof sb>[0] = { ultimo: [{ atualizado_em: '2026-10-21T11:55:00Z', fontes: { sicar: { ok: true }, osm: { ok: true } } }], pedidos: [{ id: 1, pedido_por: SUPER, fazenda_id: FAZ, pedido_em: '2026-10-21T11:59:00Z' }] };
    await rodar(completo);
    expect(completo.pedidos[0].resultado).toBe('ok');
    expect(completo.basesChamadas ?? 0).toBe(0);
    const comFalha: Parameters<typeof sb>[0] = { ultimo: [{ atualizado_em: '2026-10-21T11:55:00Z', fontes: { sicar: { ok: true }, osm: { ok: false } } }], pedidos: [{ id: 2, pedido_por: SUPER, fazenda_id: FAZ, pedido_em: '2026-10-21T11:59:00Z' }] };
    await rodar(comFalha);
    expect(comFalha.pedidos[0].resultado).toBe('ok');
    expect(comFalha.basesChamadas ?? 0).toBeGreaterThan(0);
  });
});
