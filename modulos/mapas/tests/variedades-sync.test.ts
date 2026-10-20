import { describe, expect, it, vi } from 'vitest';
import {
  chaveDaVariedade,
  gravarVariedadesSupabase,
  linhasVariedades,
  montarSqlVariedades,
  nomeDaVariedade,
  type FetchLike,
} from '../scripts/sincronizar-plantio.mjs';
import { chaveVariedade, limparVariedade } from '../src/lib/variedades';

const URL_SB = 'https://exemplo.supabase.co';
const CHAVE = 'chave-de-teste';
const COLS = ['id', 'codigo', 'abreviada', 'descricao', 'grupo', 'ativo', 'talhoes'];

function supabaseFalso(respostas: Response[]) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = async (url, init) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return respostas.shift() ?? new Response(null, { status: 500 });
  };
  return { impl, chamadas };
}

describe('nomeDaVariedade e chaveDaVariedade', () => {
  it('limpa como o plantio do PIMS e dá a mesma chave do mapa de variedade', () => {
    for (const d of ['SEMENTE DE SOJA 80I82 IPRO', 'SEMENTE SOJA  NEO761', 'TMG 22206E', 'SEMENTE MILHO AG8480 PRO4']) {
      const nome = nomeDaVariedade(d);
      expect(nome).not.toBeNull();
      expect(chaveDaVariedade(nome!)).toBe(chaveVariedade(limparVariedade(d)!));
    }
    expect(nomeDaVariedade('SEMENTE DE SOJA 80I82 IPRO')).toBe('80I82 IPRO');
  });

  it('"A DEFINIR…" e vazio não são variedade', () => {
    expect(nomeDaVariedade('A DEFINIR SOJA')).toBeNull();
    expect(nomeDaVariedade('A DEFINIR (ABERT. / CORREC.)')).toBeNull();
    expect(nomeDaVariedade('  ')).toBeNull();
    expect(nomeDaVariedade(null)).toBeNull();
  });
});

describe('montarSqlVariedades', () => {
  it('conta os talhões das safras pedidas e pagina pelo ID da variedade', () => {
    const sql = montarSqlVariedades(["SOJA 26/27", "MILHO D'AGUA 26/27"], 0, 4000);
    expect(sql).toContain("ps.DE_PER_SAFRA IN ('SOJA 26/27','MILHO D''AGUA 26/27')");
    expect(sql).toContain('CONVERT(varchar(30), v.ID_VARIEDADE) AS id');
    expect(sql).toContain('LEFT JOIN PIMSMCPRD.dbo.GRPMATURACAO g');
    expect(sql).toMatch(/ORDER BY v\.ID_VARIEDADE\nOFFSET 0 ROWS FETCH NEXT 4000 ROWS ONLY$/);
    expect(sql).not.toContain('--');
  });

  it('sem safra, nenhuma variedade fica em uso (IN com texto vazio, SQL válido)', () => {
    expect(montarSqlVariedades([])).toContain("IN ('')");
  });
});

describe('linhasVariedades', () => {
  const res = {
    columns: COLS,
    rows: [
      ['9001', 255, '80I82IPRO', 'SEMENTE SOJA 80I82 IPRO', 'SOJA MÉDIO', 'S', 67],
      ['9002', 999, '80I82 TSI', 'SEMENTE DE SOJA 80I82 IPRO', 'SOJA PRECOCE', 'N', 0],
      ['9003', 403, '23311 I2X', 'SEMENTE SOJA 23311 I2X', 'SOJA MÉDIO', 'S', 0],
      ['9004', 9999, 'AD. SOJA', 'A DEFINIR SOJA', 'A DEFINIR', 'S', 12],
    ],
  };
  const linhas = linhasVariedades(res, '2026-10-20T15:00:00.000Z');

  it('uma linha por nome limpo, com os códigos do PIMS juntos (o em uso primeiro)', () => {
    expect(linhas.map((l) => l.chave)).toEqual(['23311 I2X', '80I82 IPRO']);
    const v = linhas[1];
    expect(v.nome_pims).toBe('80I82 IPRO');
    expect(v.pims.map((p) => p.codigo)).toEqual([255, 999]);
    expect(v.talhoes).toBe(67);
    expect(v.em_uso).toBe(true);
    expect(v.ativo).toBe(true);
    expect(v.grupo).toBe('SOJA MÉDIO');
    expect(v.atualizado_em).toBe('2026-10-20T15:00:00.000Z');
  });

  it('não manda o nome comercial nem a data da primeira vez (o banco guarda)', () => {
    for (const l of linhas) {
      expect(l).not.toHaveProperty('nome_comercial');
      expect(l).not.toHaveProperty('visto_em');
    }
    expect(linhas[0].em_uso).toBe(false);
  });
});

describe('gravarVariedadesSupabase', () => {
  const dados = { linhas: linhasVariedades({ columns: COLS, rows: [['1', 1, 'X', 'SEMENTE SOJA X1', 'SOJA', 'S', 2]] }, '2026-10-20T15:00:00.000Z') };

  it('faz upsert pela chave, sem apagar nada', async () => {
    const { impl, chamadas } = supabaseFalso([new Response(null, { status: 201 })]);
    expect(await gravarVariedadesSupabase(dados, { url: URL_SB, chave: CHAVE, fetch: impl })).toBe('ok');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_SB}/rest/v1/mapas_variedades?on_conflict=chave`);
    expect(new Headers(chamadas[0].init.headers).get('Prefer')).toContain('merge-duplicates');
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual(dados.linhas);
  });

  it('sem a tabela (0027 não rodado) só avisa', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { impl } = supabaseFalso([new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 })]);
    expect(await gravarVariedadesSupabase(dados, { url: URL_SB, chave: CHAVE, fetch: impl })).toBe('sem-tabela');
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('lista vazia não chama o Supabase', async () => {
    const { impl, chamadas } = supabaseFalso([]);
    expect(await gravarVariedadesSupabase({ linhas: [] }, { url: URL_SB, chave: CHAVE, fetch: impl })).toBe('vazio');
    expect(chamadas).toHaveLength(0);
  });
});
