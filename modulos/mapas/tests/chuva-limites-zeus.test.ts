import { describe, expect, it } from 'vitest';
import { atualizarLimitesZeus } from '../scripts/atender-pedidos.mjs';
import {
  areaHaDaGeometria, geometriaDoWkt, linhasLimitesZeus, montarSqlLimitesZeus, montarSqlTalhoesComChuva, SQL_UNIDADES_LIMITES_ZEUS,
} from '../scripts/sincronizar-plantio.mjs';

// Todos os dados daqui são FICTÍCIOS.
const URL_SB = 'https://proj.supabase.co';
const CHAVE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const TOKEN = 'token-agrovex-secreto';
const AGORA = new Date('2026-10-08T15:20:00Z');
const GERADO = AGORA.toISOString();

// quadrado de ~1,1 km de lado, com um ponto colado no anterior (a ~0,2 m) que a simplificação tira
const QUADRADO = 'MULTIPOLYGON (((-55.01 -13.01, -55.0 -13.01, -55.0000015 -13.0100012, -55.0 -13.0, -55.01 -13.0, -55.01 -13.01)))';
const DOIS = 'MULTIPOLYGON (((-55.01 -13.01, -55.0 -13.01, -55.0 -13.0, -55.01 -13.01)), ((-54.5 -12.5, -54.49 -12.5, -54.49 -12.49, -54.5 -12.49, -54.5 -12.5), (-54.497 -12.497, -54.495 -12.497, -54.495 -12.495, -54.497 -12.497)))';

describe('limites dos talhões da ZEUS (servidor)', () => {
  it('lê o WKT da ZEUS como MultiPolygon, com seis casas e sem os pontos colados', () => {
    expect(geometriaDoWkt(QUADRADO)).toEqual({
      type: 'MultiPolygon',
      coordinates: [[[[-55.01, -13.01], [-55, -13.01], [-55, -13], [-55.01, -13], [-55.01, -13.01]]]],
    });
    const dois = geometriaDoWkt(DOIS);
    expect(dois?.coordinates).toHaveLength(2);
    // o segundo polígono tem um buraco
    expect(dois?.coordinates[1]).toHaveLength(2);
    expect(geometriaDoWkt('POLYGON ((-55.01 -13.01, -55.0 -13.01, -55.0 -13.0, -55.01 -13.01))')?.coordinates).toHaveLength(1);
    // coordenada com altitude: fica só lon e lat
    expect(geometriaDoWkt('POLYGON Z ((-55.01 -13.01 300, -55.0 -13.01 300, -55.0 -13.0 300, -55.01 -13.01 300))')?.coordinates[0][0][0]).toEqual([-55.01, -13.01]);
  });

  it('texto que não é polígono (ou com coordenada impossível) não vira geometria', () => {
    for (const ruim of [null, '', 'POINT (-55 -13)', 'MULTIPOLYGON EMPTY', 'MULTIPOLYGON (((a b, c d, e f, a b)))', 'MULTIPOLYGON (((-255 -13, -55 -13, -55 -12, -255 -13)))', 'MULTIPOLYGON (((-55 -13, -55 -13)))']) {
      expect(geometriaDoWkt(ruim)).toBeNull();
    }
  });

  it('a área sai em hectares', () => {
    const ha = areaHaDaGeometria(geometriaDoWkt(QUADRADO)!);
    expect(ha).toBeGreaterThan(119);
    expect(ha).toBeLessThan(121); // ~1.085 m × ~1.106 m
    // o buraco desconta
    const comBuraco = geometriaDoWkt(DOIS)!;
    expect(areaHaDaGeometria({ type: 'MultiPolygon', coordinates: [comBuraco.coordinates[1]] })).toBeLessThan(areaHaDaGeometria({ type: 'MultiPolygon', coordinates: [[comBuraco.coordinates[1][0]]] }));
  });

  it('as consultas leem a tabela de talhões da ZEUS no Athena, paginadas, e os talhões que têm chuva', () => {
    expect(SQL_UNIDADES_LIMITES_ZEUS).toContain('soils_database_database.stg_fields');
    const sql = montarSqlLimitesZeus("Fazenda Teste's", 50, 50);
    expect(sql).toContain("businessunitname = 'Fazenda Teste''s'");
    expect(sql).toContain('ORDER BY idfield');
    expect(sql).toContain('OFFSET 50 LIMIT 50');
    expect(montarSqlTalhoesComChuva('2024-09-01')).toContain('"DATABASE".stg_field_data');
    expect(montarSqlTalhoesComChuva('2024-09-01')).toContain("data >= DATE '2024-09-01'");
  });

  it('uma linha por fazenda, só com os talhões que têm chuva; nome repetido fica com o cadastro mais novo', () => {
    const campos = new Map([
      ['Fazenda Teste', [
        { idfield: 10, fieldname: '001', fieldgeom: QUADRADO },
        // o mesmo talhão cadastrado de novo: vale o de id maior
        { idfield: 99, fieldname: '001', fieldgeom: DOIS },
        { idfield: 11, fieldname: '2a', fieldgeom: QUADRADO },
        // sem chuva na tabela da ZEUS: fica de fora
        { idfield: 12, fieldname: '050', fieldgeom: QUADRADO },
        // geometria estragada: fica de fora
        { idfield: 13, fieldname: '003', fieldgeom: 'MULTIPOLYGON EMPTY' },
      ]],
      // fazenda sem chuva por talhão: não gera linha
      ['Fazenda Sem Chuva', [{ idfield: 1, fieldname: '001', fieldgeom: QUADRADO }]],
    ]);
    const comChuva = { columns: ['unidade', 'fieldname'], rows: [['TESTE', '001'], ['TESTE', '002A'], ['TESTE', '003'], ['OUTRA', '001']] };
    const linhas = linhasLimitesZeus(campos, comChuva, GERADO);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ unidade: 'TESTE', gerado_em: GERADO });
    expect(linhas[0].talhoes.map((t) => [t.codigo, t.id])).toEqual([['001', 99], ['002A', 11]]);
    expect(linhas[0].talhoes[0].geom.coordinates).toHaveLength(2);
    expect(linhas[0].talhoes[1].area_ha).toBeGreaterThan(119);
  });
});

interface Chamada { url: string; init?: RequestInit }

function servidores(situacao: unknown[], consultas: unknown[], statusGet = 200) {
  const chamadas: Chamada[] = [];
  let n = 0;
  const impl = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.startsWith(URL_SB)) {
      if (!init?.method || init.method === 'GET') {
        return statusGet === 200
          ? new Response(JSON.stringify(situacao), { status: 200 })
          : new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: statusGet });
      }
      return new Response(null, { status: 204 });
    }
    const corpo = init?.body ? JSON.parse(String(init.body)) : null;
    if (init?.method === 'DELETE' || !corpo?.id) return new Response('', { status: 202 });
    if (corpo.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers: { 'mcp-session-id': 's1' } });
    }
    const dados = consultas[n++];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: { content: [{ type: 'text', text: JSON.stringify({ status: 'success', ...(dados as object) }) }] } }), { status: 200 });
  };
  return { impl, chamadas };
}

// a ordem das consultas: talhões com chuva (ZEUS), fazendas com limite (Athena) e os limites da única fazenda que tem chuva
const CONSULTAS = [
  { columns: ['unidade', 'fieldname'], rows: [['TESTE', '001'], ['TESTE', '002']] },
  { columns: ['businessunitname', 'n'], rows: [['Fazenda Teste', 2], ['Fazenda Sem Chuva', 9]] },
  { columns: ['idfield', 'fieldname', 'fieldgeom'], rows: [[10, '001', QUADRADO], [11, '002', QUADRADO]] },
];
const opcoes = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({
  supabase: { url: URL_SB, chave: CHAVE },
  agrovex: { url: 'https://agrovex.test/mcp', token: TOKEN },
  fetch: impl,
  agora: () => AGORA,
});
const foiAoAgrovex = (chamadas: Chamada[]) => chamadas.some((c) => c.url.includes('agrovex'));

describe('atualizarLimitesZeus (tabela chuva_limites_zeus)', () => {
  it('gravado há menos de um dia: não consulta de novo (os limites quase não mudam)', async () => {
    const { impl, chamadas } = servidores([{ gerado_em: '2026-10-08T03:00:00.000Z' }], []);
    expect(await atualizarLimitesZeus(opcoes(impl))).toBe('recente');
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/chuva_limites_zeus?select=gerado_em&order=gerado_em.desc&limit=1`);
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('sem a tabela (script 0016 não aplicado): não é erro e não consulta', async () => {
    const { impl, chamadas } = servidores([], [], 404);
    expect(await atualizarLimitesZeus(opcoes(impl))).toBe('sem-tabela');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('fora do minuto de tentativa: espera o próximo', async () => {
    const { impl, chamadas } = servidores([], CONSULTAS);
    expect(await atualizarLimitesZeus({ ...opcoes(impl), agora: () => new Date('2026-10-08T15:22:30Z') })).toBe('fora-do-passo');
    expect(foiAoAgrovex(chamadas)).toBe(false);
  });

  it('gravação antiga: lê só as fazendas que têm chuva por talhão e grava uma por pedido', async () => {
    const { impl, chamadas } = servidores([{ gerado_em: '2026-10-07T10:00:00.000Z' }], CONSULTAS);
    expect(await atualizarLimitesZeus(opcoes(impl))).toBe('ok');
    const consultas = chamadas.filter((c) => c.url.includes('agrovex') && String(c.init?.body).includes('execute_query')).map((c) => JSON.parse(String(c.init?.body)).params.arguments);
    expect(consultas.map((c) => c.source)).toEqual(['zeus', 'athena', 'athena']);
    expect(consultas[2].sql).toContain("businessunitname = 'Fazenda Teste'");
    const posts = chamadas.filter((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB));
    expect(posts.map((c) => c.url)).toEqual([`${URL_SB}/rest/v1/chuva_limites_zeus?on_conflict=unidade`]);
    const corpo = JSON.parse(String(posts[0].init?.body));
    expect(corpo).toHaveLength(1);
    expect(corpo[0].unidade).toBe('TESTE');
    expect(corpo[0].talhoes.map((t: { codigo: string }) => t.codigo)).toEqual(['001', '002']);
    const limpeza = chamadas.find((c) => c.init?.method === 'DELETE' && c.url.startsWith(URL_SB));
    expect(limpeza?.url).toBe(`${URL_SB}/rest/v1/chuva_limites_zeus?gerado_em=lt.${encodeURIComponent(GERADO)}`);
  });

  it('nenhuma fazenda com limite e chuva: não grava nada', async () => {
    const { impl, chamadas } = servidores([], [CONSULTAS[0], { columns: ['businessunitname', 'n'], rows: [['Fazenda Sem Chuva', 9]] }]);
    expect(await atualizarLimitesZeus(opcoes(impl))).toBe('vazio');
    expect(chamadas.some((c) => c.init?.method === 'POST' && c.url.startsWith(URL_SB))).toBe(false);
  });
});
