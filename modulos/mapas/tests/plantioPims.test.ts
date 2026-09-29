import { describe, expect, it } from 'vitest';
import { carregarPlantioPims, casarPlantio, combinarPlantios, montarPlantioPims } from '../src/lib/plantioPims';
import type { AreaCultura, Fazenda, LinhaPlantioPims, Plantio, PlantioPimsArquivo, PlantioPimsTalhao, Safra, Talhao } from '../src/lib/types';

const geom: Talhao['geom'] = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

function pims(parciais: Partial<PlantioPimsTalhao> = {}): PlantioPimsTalhao {
  return {
    codigo: '001',
    codigoPims: '001',
    setor: 'SIRIEMA',
    status: 'plantado',
    areaPrevista: 97,
    areaPlantada: 97,
    inicio: '2026-09-24',
    fim: '2026-09-24',
    variedade: 'SOJA X',
    ...parciais,
  };
}

function arquivo(talhoes: PlantioPimsTalhao[], unidade = 'SIRIEMA', safra = 'SOJA 26/27'): PlantioPimsArquivo {
  return {
    versao: 1,
    geradoEm: '2026-09-28T10:00:00.000Z',
    fonte: 'PIMS via Agrovex',
    safras: [
      { nome: 'MILHO 2ª SAFRA 26/27', unidades: [{ unidade, talhoes: [pims({ codigo: '001', status: 'a_plantar' })] }] },
      { nome: safra, unidades: [{ unidade: 'OUTRA', talhoes: [] }, { unidade, talhoes }] },
    ],
  };
}

const fazenda: Fazenda = {
  id: 'faz-1',
  nome: 'Siriema',
  campoNome: 'nome',
  campoSetor: null,
  colunas: [],
  criadoEm: '2026-01-01T00:00:00.000Z',
  unidadePims: 'SIRIEMA',
  campoCodigo: 'codigo',
  coaFazendaId: null,
};

const safra: Safra = { id: 'saf-1', nome: 'Soja 2026/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-08-31', nomePims: 'SOJA 26/27' };

const talhao = (id: string, codigo: string | null): Talhao => ({ id, fazendaId: 'faz-1', nome: id, setor: null, areaHa: 1, geom, atributos: {}, codigo });
const area = (id: string, codigo: string): AreaCultura => ({ id, safraId: 'saf-1', fazendaId: 'faz-1', codigo, areaHa: 1, geom });

function manual(talhaoId: string, parciais: Partial<Plantio> = {}): Plantio {
  return {
    safraId: 'saf-1',
    talhaoId,
    dataPlantio: '2026-09-20',
    origem: 'manual',
    status: 'plantado',
    areaPrevista: null,
    areaPlantada: null,
    inicio: null,
    fim: null,
    variedade: null,
    ...parciais,
  };
}

describe('carregarPlantioPims', () => {
  it('busca ./dados/plantio.json sem cache e devolve o arquivo', async () => {
    const arq = arquivo([pims()]);
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const fetchFalso = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify(arq), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await carregarPlantioPims(fetchFalso)).toEqual(arq);
    expect(chamadas).toEqual([{ url: './dados/plantio.json', init: { cache: 'no-cache' } }]);
  });

  it('404, erro de rede, JSON inválido ou formato desconhecido → null', async () => {
    const resp = (corpo: string, status = 200) => (async () => new Response(corpo, { status })) as unknown as typeof fetch;
    expect(await carregarPlantioPims(resp('não achei', 404))).toBeNull();
    expect(await carregarPlantioPims((async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch)).toBeNull();
    expect(await carregarPlantioPims(resp('{ quebrado'))).toBeNull();
    expect(await carregarPlantioPims(resp(JSON.stringify({ versao: 2, safras: [] })))).toBeNull();
    expect(await carregarPlantioPims(resp(JSON.stringify({ versao: 1 })))).toBeNull();
  });

  it('estrutura interna malformada (unidades/talhões) → null, sem lançar', async () => {
    const resp = (corpo: unknown) => (async () => new Response(JSON.stringify(corpo), { status: 200 })) as unknown as typeof fetch;
    const base = { versao: 1, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS' };
    const malformados: unknown[] = [
      { ...base, safras: [null] },
      { ...base, safras: [{ nome: 'SOJA 26/27' }] },
      { ...base, safras: [{ nome: 'SOJA 26/27', unidades: {} }] },
      { ...base, safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'SIRIEMA' }] }] },
      { ...base, safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'SIRIEMA', talhoes: [null] }] }] },
      { ...base, safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'SIRIEMA', talhoes: [{ codigo: 1, status: 'plantado' }] }] }] },
      { ...base, safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'SIRIEMA', talhoes: [{ codigo: '001', status: 'colhido' }] }] }] },
      { ...base, safras: [{ nome: 7, unidades: [] }] },
    ];
    for (const m of malformados) await expect(carregarPlantioPims(resp(m))).resolves.toBeNull();
    const valido = arquivo([pims()]);
    expect(await carregarPlantioPims(resp(valido))).toEqual(valido);
  });
});

describe('montarPlantioPims (linhas de mapas_plantio_pims → mesmo formato do plantio.json)', () => {
  const linha = (safra: string, unidade: string, geradoEm: string, talhoes: unknown[] = [pims()]): LinhaPlantioPims => ({
    safra,
    unidade,
    geradoEm,
    talhoes: talhoes as PlantioPimsTalhao[],
  });

  it('sem linhas → null', () => {
    expect(montarPlantioPims([])).toBeNull();
  });

  it('agrupa por safra; safras e unidades em ordem alfabética; versão 1 e fonte do PIMS', () => {
    const arq = montarPlantioPims([
      linha('SOJA 26/27', 'SIRIEMA', '2026-09-28T10:00:00.000Z', [pims({ codigo: '001' })]),
      linha('MILHO 2ª SAFRA 26/27', 'GLOBO', '2026-09-28T10:00:00.000Z', [pims({ codigo: '010' })]),
      linha('SOJA 26/27', 'DOURADO', '2026-09-28T10:00:00.000Z', [pims({ codigo: '002' }), pims({ codigo: '003' })]),
      linha('SOJA 26/27', 'GUAPIRAMA', '2026-09-28T10:00:00.000Z', []),
    ]);
    expect(arq).toEqual({
      versao: 1,
      geradoEm: '2026-09-28T10:00:00.000Z',
      fonte: 'PIMS via Agrovex',
      safras: [
        { nome: 'MILHO 2ª SAFRA 26/27', unidades: [{ unidade: 'GLOBO', talhoes: [pims({ codigo: '010' })] }] },
        {
          nome: 'SOJA 26/27',
          unidades: [
            { unidade: 'DOURADO', talhoes: [pims({ codigo: '002' }), pims({ codigo: '003' })] },
            { unidade: 'GUAPIRAMA', talhoes: [] },
            { unidade: 'SIRIEMA', talhoes: [pims({ codigo: '001' })] },
          ],
        },
      ],
    });
  });

  it('geradoEm = a maior data das linhas (em ISO), mesmo com fusos diferentes', () => {
    const arq = montarPlantioPims([
      linha('SOJA 26/27', 'A', '2026-09-28T10:00:00+00:00'),
      linha('SOJA 26/27', 'B', '2026-09-28T08:30:00-03:00'), // 11:30 UTC
      linha('SOJA 26/27', 'C', '2026-09-28T11:00:00.000Z'),
    ]);
    expect(arq?.geradoEm).toBe('2026-09-28T11:30:00.000Z');
  });

  it('descarta talhões inválidos (mesma validação do plantio.json) e mantém os válidos', () => {
    const arq = montarPlantioPims([
      linha('SOJA 26/27', 'SIRIEMA', '2026-09-28T10:00:00.000Z', [
        pims({ codigo: '001' }),
        null,
        { codigo: 7, status: 'plantado' },
        { codigo: '002', status: 'colhido' },
        'x',
        pims({ codigo: '003', status: 'a_plantar' }),
      ]),
      { safra: 'SOJA 26/27', unidade: 'GLOBO', geradoEm: '2026-09-28T10:00:00.000Z', talhoes: null as unknown as PlantioPimsTalhao[] },
    ]);
    expect(arq!.safras[0].unidades).toEqual([
      { unidade: 'GLOBO', talhoes: [] },
      { unidade: 'SIRIEMA', talhoes: [pims({ codigo: '001' }), pims({ codigo: '003', status: 'a_plantar' })] },
    ]);
  });

  it('o arquivo montado casa com a fazenda como o plantio.json', () => {
    const arq = montarPlantioPims([linha('SOJA 26/27', 'SIRIEMA', '2026-09-28T10:00:00.000Z', [pims({ codigo: '39B', status: 'plantando' })])]);
    expect(casarPlantio(arq!, safra, fazenda, [talhao('t1', '039B')], [])?.porCodigo.get('039B')?.status).toBe('plantando');
  });
});

describe('casarPlantio', () => {
  it('acha a safra pelo nomePims e a unidade da fazenda; indexa por código normalizado', () => {
    const arq = arquivo([pims({ codigo: '001' }), pims({ codigo: '39B', codigoPims: '39B', status: 'plantando', areaPlantada: 10 })]);
    const r = casarPlantio(arq, safra, fazenda, [talhao('t1', '001'), talhao('t2', '039B')], []);
    expect(r).not.toBeNull();
    expect(r!.geradoEm).toBe('2026-09-28T10:00:00.000Z');
    expect([...r!.porCodigo.keys()].sort()).toEqual(['001', '039B']);
    expect(r!.porCodigo.get('039B')?.status).toBe('plantando');
    expect(r!.semPoligono).toEqual([]);
  });

  it('sem nomePims usa o nome da safra; comparação ignora caixa, acento e espaços nas pontas', () => {
    const arq = arquivo([pims()], 'SAO MIGUEL');
    const r = casarPlantio(arq, { ...safra, nome: ' soja 26/27 ', nomePims: null }, { ...fazenda, unidadePims: 'São Miguel' }, [talhao('t1', '001')], []);
    expect(r?.porCodigo.get('001')?.codigoPims).toBe('001');
  });

  it('unidade errada, fazenda sem unidadePims ou safra ausente no arquivo → null', () => {
    const arq = arquivo([pims()]);
    expect(casarPlantio(arq, safra, { ...fazenda, unidadePims: 'GUAPIRAMA' }, [], [])).toBeNull();
    expect(casarPlantio(arq, safra, { ...fazenda, unidadePims: null }, [], [])).toBeNull();
    expect(casarPlantio(arq, { ...safra, nomePims: 'SOJA 27/28' }, fazenda, [], [])).toBeNull();
  });

  it('semPoligono: plantados/plantando sem código em talhões nem em áreas da cultura (a plantar não avisa)', () => {
    const arq = arquivo([
      pims({ codigo: '001' }),
      pims({ codigo: '002', status: 'plantando' }),
      pims({ codigo: '003' }),
      pims({ codigo: '004', status: 'a_plantar' }),
      pims({ codigo: '02PIVO', codigoPims: 'PIVO 02' }),
    ]);
    const r = casarPlantio(arq, safra, fazenda, [talhao('t1', '001'), talhao('t9', null), talhao('tp', 'PIVÔ 2')], [area('a3', '003')]);
    expect(r!.semPoligono.map((t) => t.codigo)).toEqual(['002']);
  });

  it('código repetido no PIMS: fica o primeiro', () => {
    const arq = arquivo([pims({ codigo: '9999', setor: 'A' }), pims({ codigo: '9999', setor: 'B' })]);
    expect(casarPlantio(arq, safra, fazenda, [], [])!.porCodigo.get('9999')?.setor).toBe('A');
  });
});

describe('combinarPlantios', () => {
  const talhoes = [talhao('t1', '001'), talhao('t2', '002'), talhao('t3', '003'), talhao('t4', null)];

  it('PIMS prevalece; o manual fica só nos talhões sem registro no PIMS', () => {
    const porCodigo = new Map<string, PlantioPimsTalhao>([
      ['001', pims({ codigo: '001', status: 'plantado', inicio: '2026-09-20', fim: '2026-09-24' })],
      ['002', pims({ codigo: '002', status: 'plantando', areaPlantada: 40, areaPrevista: 100, inicio: '2026-09-25', fim: '2026-09-26' })],
      ['003', pims({ codigo: '003', status: 'a_plantar', areaPlantada: 0, inicio: null, fim: null, variedade: null })],
    ]);
    const manuais = [manual('t1', { dataPlantio: '2026-09-01' }), manual('t4'), manual('outra-fazenda')];

    const r = combinarPlantios(porCodigo, manuais, talhoes, 'saf-1');

    expect(r).toEqual([
      { safraId: 'saf-1', talhaoId: 't1', dataPlantio: '2026-09-24', origem: 'pims', status: 'plantado', areaPrevista: 97, areaPlantada: 97, inicio: '2026-09-20', fim: '2026-09-24', variedade: 'SOJA X' },
      { safraId: 'saf-1', talhaoId: 't2', dataPlantio: '2026-09-25', origem: 'pims', status: 'plantando', areaPrevista: 100, areaPlantada: 40, inicio: '2026-09-25', fim: '2026-09-26', variedade: 'SOJA X' },
      { safraId: 'saf-1', talhaoId: 't3', dataPlantio: null, origem: 'pims', status: 'a_plantar', areaPrevista: 97, areaPlantada: 0, inicio: null, fim: null, variedade: null },
      manual('t4'),
    ]);
  });

  it('sem PIMS devolve os manuais dos talhões informados; plantio antigo sem os campos novos vira manual/plantado', () => {
    const antigo = { safraId: 'saf-1', talhaoId: 't2', dataPlantio: '2026-10-01' } as unknown as Plantio;
    expect(combinarPlantios(null, [antigo, manual('fora')], talhoes, 'saf-1')).toEqual([
      { safraId: 'saf-1', talhaoId: 't2', dataPlantio: '2026-10-01', origem: 'manual', status: 'plantado', areaPrevista: null, areaPlantada: null, inicio: null, fim: null, variedade: null },
    ]);
  });

  it('usa o safraId informado em todos os registros, mesmo sem plantio manual', () => {
    const porCodigo = new Map([['001', pims()]]);
    const r = combinarPlantios(porCodigo, [], talhoes, 'saf-9');
    expect(r).toHaveLength(1);
    expect(r[0].safraId).toBe('saf-9');
    // o safraId informado vale também para os manuais que ficam
    expect(combinarPlantios(porCodigo, [manual('t4')], talhoes, 'saf-9').map((p) => p.safraId)).toEqual(['saf-9', 'saf-9']);
  });
});
