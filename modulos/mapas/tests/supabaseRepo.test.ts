import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import {
  areaCulturaParaRow,
  fazendaParaRow,
  mapaParaRow,
  plantioParaRow,
  rowParaAreaCultura,
  rowParaFazenda,
  rowParaMapa,
  rowParaPlantio,
  rowParaSafra,
  rowParaTalhao,
  safraParaRow,
  talhaoParaRow,
  type FazendaRow,
  type PlantioRow,
  type SafraRow,
  type TalhaoRow,
} from '../src/data/supabaseLinhas';
import { IDW_PADRAO, type AreaCultura, type Fazenda, type MapaSalvo, type Plantio, type Safra, type Talhao } from '../src/lib/types';
import { BancoFalso } from './helpers/supabaseFalso';

const uuid = (prefixo: string, i: number) => `${prefixo}-${String(i).padStart(6, '0')}`;
const geom: Talhao['geom'] = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

const fazenda = (i: number): Fazenda => ({
  id: uuid('faz', i),
  nome: `Fazenda ${i}`,
  campoNome: 'NOME',
  campoSetor: null,
  colunas: ['NOME'],
  criadoEm: '2026-01-01T00:00:00.000Z',
  unidadePims: null,
  campoCodigo: null,
});
const talhao = (i: number, fazendaId: string): Talhao => ({ id: uuid('tal', i), fazendaId, nome: `T${i}`, setor: null, areaHa: 1, geom, atributos: {}, codigo: null });
const safra = (i: number): Safra => ({ id: uuid('saf', i), nome: `SOJA ${i}`, cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-03-31', nomePims: null });
const plantio = (safraId: string, talhaoId: string, parciais: Partial<Plantio> = {}): Plantio => ({
  safraId,
  talhaoId,
  dataPlantio: null,
  origem: 'manual',
  status: 'plantado',
  areaPrevista: null,
  areaPlantada: null,
  inicio: null,
  fim: null,
  variedade: null,
  ...parciais,
});
const area = (i: number, safraId: string, fazendaId: string): AreaCultura => ({ id: uuid('are', i), safraId, fazendaId, codigo: String(i).padStart(3, '0'), areaHa: 2, geom });

function mapa(i: number, parciais: Partial<MapaSalvo> = {}): MapaSalvo {
  const estat = { media: 10, min: 5, max: 15, areaHa: 1 };
  return {
    id: uuid('map', i),
    fazendaId: uuid('faz', 0),
    safraId: null,
    titulo: `Mapa ${i}`,
    periodoInicio: '2025-02-01',
    periodoFim: '2025-02-28',
    config: {
      pagina: 'A3',
      textos: { titulo: 'T', fazenda: 'F', safra: '', periodo: '', fonte: 'ZEUS', talhoes: 'TODOS', setor: 'TODOS', observacao: '', data: '01/01/2026' },
      paletaId: 'auto',
      estiloPlantado: 'quadriculado',
      mapaBase: 'nenhum',
      mostrarRotulosTalhoes: true,
      mostrarValoresPics: true,
      mostrarGrade: false,
      legendaCompacta: false,
      extent: null,
      idw: IDW_PADRAO,
    },
    pics: [{ id: 'p', nome: 'PIC', lat: -13, lon: -57, chuva: 1, inativo: false, inicio: new Date('2025-02-01T00:00:00.000Z'), fim: null, incluir: true }],
    resumo: { geral: estat, plantado: null, talhoes: [] },
    pngPath: `${uuid('map', i)}.png`,
    thumbPath: `${uuid('map', i)}-thumb.png`,
    criadoEm: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0').slice(-3)}Z`,
    ...parciais,
  };
}

/** Banco com 2 fazendas: a 0 com 1500 talhões e a 1 com 1200; 2700 plantios na safra 0. */
function bancoGrande(maxLinhas = 1000) {
  const banco = new BancoFalso(maxLinhas);
  banco.inserir('fazendas', [fazenda(0), fazenda(1)].map(fazendaParaRow));
  const t0 = Array.from({ length: 1500 }, (_, i) => talhao(i, uuid('faz', 0)));
  const t1 = Array.from({ length: 1200 }, (_, i) => talhao(10_000 + i, uuid('faz', 1)));
  banco.inserir('talhoes', [...t0, ...t1].map(talhaoParaRow));
  banco.inserir('safras', [safra(0)].map(safraParaRow));
  banco.inserir(
    'plantios',
    [...t0, ...t1].map((t) => plantioParaRow(plantio(uuid('saf', 0), t.id))),
  );
  return { banco, t0, t1 };
}

describe('supabaseRepo: listagens paginadas (o servidor devolve no máximo 1000 linhas por resposta)', () => {
  it('listarPlantios lê todos os plantios da safra, não só os 1000 primeiros', async () => {
    const { banco } = bancoGrande();
    const repo = criarSupabaseRepo(banco.cliente());
    expect(await repo.listarPlantios(uuid('saf', 0))).toHaveLength(2700);
  });

  it('obterTalhoes, listarFazendas, listarSafras e listarMapas também leem tudo', async () => {
    const { banco } = bancoGrande();
    banco.inserir('fazendas', Array.from({ length: 1100 }, (_, i) => fazendaParaRow(fazenda(100 + i))));
    banco.inserir('safras', Array.from({ length: 1001 }, (_, i) => safraParaRow(safra(100 + i))));
    banco.inserir('mapas', Array.from({ length: 1005 }, (_, i) => mapaParaRow(mapa(i))));
    const repo = criarSupabaseRepo(banco.cliente());

    expect(await repo.obterTalhoes(uuid('faz', 0))).toHaveLength(1500);
    expect(await repo.listarFazendas()).toHaveLength(1102);
    expect(await repo.listarSafras()).toHaveLength(1002);
    const mapas = await repo.listarMapas();
    expect(mapas).toHaveLength(1005);
    // mais recente primeiro
    for (let i = 1; i < mapas.length; i++) expect(mapas[i - 1].criadoEm >= mapas[i].criadoEm).toBe(true);
  });

  it('continua lendo mesmo se o servidor estiver configurado com um limite menor (ex.: 400 linhas)', async () => {
    const { banco } = bancoGrande(400);
    const repo = criarSupabaseRepo(banco.cliente());
    expect(await repo.listarPlantios(uuid('saf', 0))).toHaveLength(2700);
    expect(await repo.obterTalhoes(uuid('faz', 1))).toHaveLength(1200);
  });

  it('exportarBackup traz todas as linhas de todas as tabelas', async () => {
    const { banco } = bancoGrande();
    banco.inserir('mapas', Array.from({ length: 1003 }, (_, i) => mapaParaRow(mapa(i))));
    const b = await criarSupabaseRepo(banco.cliente()).exportarBackup();
    expect(b.fazendas).toHaveLength(2);
    expect(b.talhoes).toHaveLength(2700);
    expect(b.safras).toHaveLength(1);
    expect(b.plantios).toHaveLength(2700);
    expect(b.mapas).toHaveLength(1003);
    expect(b.mapas[0].pics[0].inicio).toBeInstanceOf(Date);
  });
});

describe('supabaseRepo: salvarPlantios', () => {
  it('substitui só os plantios da fazenda, com listas .in(...) de no máximo 200 ids', async () => {
    const { banco, t0, t1 } = bancoGrande();
    const repo = criarSupabaseRepo(banco.cliente());
    const novos = t0.slice(0, 10).map((t) => plantio(uuid('saf', 0), t.id, { dataPlantio: '2026-10-01' }));

    await repo.salvarPlantios(uuid('saf', 0), uuid('faz', 0), novos);

    const todos = await repo.listarPlantios(uuid('saf', 0));
    const daFazenda0 = new Set(t0.map((t) => t.id));
    expect(todos.filter((p) => daFazenda0.has(p.talhaoId)).map((p) => p.talhaoId).sort()).toEqual(novos.map((p) => p.talhaoId).sort());
    expect(todos.filter((p) => !daFazenda0.has(p.talhaoId))).toHaveLength(t1.length); // a outra fazenda não muda
    expect(todos.find((p) => p.talhaoId === novos[0].talhaoId)?.dataPlantio).toBe('2026-10-01');
    for (const r of banco.requisicoes) for (const n of r.listasIn) expect(n).toBeLessThanOrEqual(200);
  });

  it('grava os novos antes de apagar: se a exclusão falhar, sobra um superconjunto (nunca fica vazio)', async () => {
    const { banco, t0 } = bancoGrande();
    const repo = criarSupabaseRepo(banco.cliente());
    const novos = t0.slice(0, 3).map((t) => plantio(uuid('saf', 0), t.id, { dataPlantio: '2026-10-02' }));
    banco.falhar = (r) => (r.tabela === 'plantios' && r.op === 'delete' ? 'falha simulada' : null);

    await expect(repo.salvarPlantios(uuid('saf', 0), uuid('faz', 0), novos)).rejects.toThrow('falha simulada');

    const todos = await repo.listarPlantios(uuid('saf', 0));
    expect(todos).toHaveLength(2700); // nada apagado
    expect(todos.find((p) => p.talhaoId === novos[0].talhaoId)?.dataPlantio).toBe('2026-10-02'); // novos gravados
  });

  it('lista vazia apaga todos os plantios da fazenda (e só dela)', async () => {
    const { banco, t1 } = bancoGrande();
    const repo = criarSupabaseRepo(banco.cliente());
    await repo.salvarPlantios(uuid('saf', 0), uuid('faz', 0), []);
    expect((await repo.listarPlantios(uuid('saf', 0))).map((p) => p.talhaoId).sort()).toEqual(t1.map((t) => t.id).sort());
  });
});

describe('supabaseRepo: obterMapa', () => {
  it('devolve o mapa pelo id (com as datas dos PICs revividas) ou null', async () => {
    const banco = new BancoFalso();
    banco.inserir('mapas', [mapaParaRow(mapa(1)), mapaParaRow(mapa(2))]);
    const repo = criarSupabaseRepo(banco.cliente());
    const m = await repo.obterMapa(uuid('map', 2));
    expect(m?.titulo).toBe('Mapa 2');
    expect(m?.pics[0].inicio).toBeInstanceOf(Date);
    expect(await repo.obterMapa(uuid('map', 9))).toBeNull();
  });
});

describe('supabaseRepo: importarBackup', () => {
  it('não aponta para PNGs que não existem neste projeto (pngPath/thumbPath = null)', async () => {
    const banco = new BancoFalso();
    const repo = criarSupabaseRepo(banco.cliente());
    await repo.importarBackup({ versao: 1, fazendas: [fazenda(0)], talhoes: [], safras: [], plantios: [], mapas: [mapa(1)] });
    const m = await repo.obterMapa(uuid('map', 1));
    expect(m?.pngPath).toBeNull();
    expect(m?.thumbPath).toBeNull();
  });

  it('mantém os arquivos de um mapa que já existe neste projeto', async () => {
    const banco = new BancoFalso();
    const repo = criarSupabaseRepo(banco.cliente());
    const salvo = await repo.salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), new Blob(['png']), new Blob(['mini']));
    await repo.importarBackup({ versao: 1, fazendas: [], talhoes: [], safras: [], plantios: [], mapas: [{ ...salvo, titulo: 'Importado' }] });
    const m = await repo.obterMapa(salvo.id);
    expect(m?.titulo).toBe('Importado');
    expect(m?.pngPath).toBe(salvo.pngPath);
    expect(m?.thumbPath).toBe(salvo.thumbPath);
  });

  it('exporta e importa as áreas da cultura; backup antigo (sem areasCultura) importa normalmente', async () => {
    const origem = new BancoFalso();
    const repoOrigem = criarSupabaseRepo(origem.cliente());
    await repoOrigem.salvarAreasCultura(uuid('saf', 0), uuid('faz', 0), [area(1, uuid('saf', 0), uuid('faz', 0))]);
    const b = await repoOrigem.exportarBackup();
    expect(b.areasCultura).toEqual([area(1, uuid('saf', 0), uuid('faz', 0))]);

    const destino = new BancoFalso();
    const repo = criarSupabaseRepo(destino.cliente());
    await repo.importarBackup(JSON.parse(JSON.stringify(b)));
    expect(await repo.listarAreasCultura(uuid('saf', 0), uuid('faz', 0))).toEqual([area(1, uuid('saf', 0), uuid('faz', 0))]);

    const antigo = { versao: 1, fazendas: [], talhoes: [], safras: [], plantios: [{ safraId: uuid('saf', 0), talhaoId: uuid('tal', 1), dataPlantio: null }], mapas: [] };
    await repo.importarBackup(antigo as never);
    expect(destino.tabelas.plantios[0]).toMatchObject({ origem: 'manual', status: 'plantado' });
  });
});

describe('supabaseRepo: áreas da cultura', () => {
  it('salvarAreasCultura substitui só as da safra × fazenda (grava antes de apagar, listas .in ≤ 200)', async () => {
    const banco = new BancoFalso();
    const repo = criarSupabaseRepo(banco.cliente());
    const [s0, s1, f0, f1] = [uuid('saf', 0), uuid('saf', 1), uuid('faz', 0), uuid('faz', 1)];
    await repo.salvarAreasCultura(s0, f0, Array.from({ length: 1200 }, (_, i) => area(i, 'x', 'y')));
    await repo.salvarAreasCultura(s0, f1, [area(5000, s0, f1)]);
    await repo.salvarAreasCultura(s1, f0, [area(6000, s1, f0)]);
    expect(await repo.listarAreasCultura(s0, f0)).toHaveLength(1200);
    expect((await repo.listarAreasCultura(s0, f0))[0]).toMatchObject({ safraId: s0, fazendaId: f0 });

    banco.requisicoes = [];
    await repo.salvarAreasCultura(s0, f0, [area(7000, s0, f0), area(3, s0, f0)]);

    expect((await repo.listarAreasCultura(s0, f0)).map((a) => a.id).sort()).toEqual([uuid('are', 3), uuid('are', 7000)]);
    expect((await repo.listarAreasCultura(s0, f1)).map((a) => a.id)).toEqual([uuid('are', 5000)]);
    expect((await repo.listarAreasCultura(s1, f0)).map((a) => a.id)).toEqual([uuid('are', 6000)]);
    for (const r of banco.requisicoes) for (const n of r.listasIn) expect(n).toBeLessThanOrEqual(200);
    const ops = banco.requisicoes.filter((r) => r.tabela === 'areas_cultura').map((r) => r.op);
    expect(ops.indexOf('upsert')).toBeLessThan(ops.indexOf('delete'));
  });
});

describe('supabase/migrations/0002_plantio_pims.sql', () => {
  const sql0001 = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
  const sql0002 = readFileSync('supabase/migrations/0002_plantio_pims.sql', 'utf8');

  it('todas as colunas gravadas pelos mapeadores existem nas migrações', () => {
    const f = { ...fazenda(1), unidadePims: 'X', campoCodigo: 'C' };
    const s = safra(1);
    const linhas: [string, object][] = [
      ['fazendas', fazendaParaRow(f)],
      ['talhoes', talhaoParaRow(talhao(1, f.id))],
      ['safras', safraParaRow(s)],
      ['plantios', plantioParaRow(plantio(s.id, 'x'))],
      ['areas_cultura', areaCulturaParaRow(area(1, s.id, f.id))],
    ];
    const sql = sql0001 + sql0002;
    for (const [tabela, linha] of linhas) {
      for (const coluna of Object.keys(linha)) expect(sql, `${tabela}.${coluna}`).toMatch(new RegExp(`\\b${coluna}\\b`));
    }
  });

  it('é idempotente e dá a areas_cultura o mesmo RLS/privilégios das demais tabelas', () => {
    const semComentarios = sql0002.replace(/--.*$/gm, '');
    for (const m of semComentarios.matchAll(/add column\s+(?!if not exists)/gi)) throw new Error(`add column sem "if not exists": ${m[0]}`);
    expect(semComentarios).toMatch(/create table if not exists public\.areas_cultura/);
    expect(semComentarios).toMatch(/alter table public\.areas_cultura enable row level security;/);
    expect(semComentarios).toMatch(/drop policy if exists areas_cultura_authenticated_all on public\.areas_cultura;/);
    expect(semComentarios).toMatch(/revoke all on table public\.areas_cultura from anon;/);
    expect(semComentarios).toMatch(/grant select, insert, update, delete on table public\.areas_cultura to authenticated;/);
    expect(semComentarios).toMatch(/references public\.safras \(id\) on delete cascade/);
    expect(semComentarios).toMatch(/references public\.fazendas \(id\) on delete cascade/);
  });
});

describe('supabaseRepo: upsertTalhoes', () => {
  it('insere e atualiza pelo id sem apagar os demais talhões nem os plantios', async () => {
    const banco = new BancoFalso();
    banco.inserir('fazendas', [fazendaParaRow(fazenda(0))]);
    banco.inserir('talhoes', [talhao(1, uuid('faz', 0)), talhao(2, uuid('faz', 0))].map(talhaoParaRow));
    banco.inserir('plantios', [plantioParaRow(plantio(uuid('saf', 0), uuid('tal', 1)))]);
    const repo = criarSupabaseRepo(banco.cliente());

    await repo.upsertTalhoes(uuid('faz', 0), [{ ...talhao(1, 'outra'), codigo: '001', areaHa: 9 }, talhao(3, 'outra')]);

    const talhoes = await repo.obterTalhoes(uuid('faz', 0));
    expect(talhoes.map((t) => t.id).sort()).toEqual([uuid('tal', 1), uuid('tal', 2), uuid('tal', 3)]);
    expect(talhoes.find((t) => t.id === uuid('tal', 1))).toMatchObject({ codigo: '001', areaHa: 9, fazendaId: uuid('faz', 0) });
    expect(await repo.listarPlantios(uuid('saf', 0))).toHaveLength(1);
  });
});

describe('supabaseLinhas: mapeamento domínio <-> linhas do banco', () => {
  it('fazenda, talhão, safra e plantio fazem a ida e volta', () => {
    const f = fazenda(1);
    expect(fazendaParaRow(f)).toEqual({ id: f.id, nome: f.nome, campo_nome: 'NOME', campo_setor: null, colunas: ['NOME'], criado_em: f.criadoEm, unidade_pims: null, campo_codigo: null });
    expect(rowParaFazenda(fazendaParaRow(f))).toEqual(f);
    const t = { ...talhao(1, f.id), setor: 'S1', atributos: { A: 1 } };
    expect(talhaoParaRow(t)).toMatchObject({ fazenda_id: f.id, area_ha: 1, setor: 'S1' });
    expect(rowParaTalhao(talhaoParaRow(t))).toEqual(t);
    const s = safra(1);
    expect(safraParaRow(s)).toMatchObject({ ano_safra: '26/27' });
    expect(rowParaSafra(safraParaRow(s))).toEqual(s);
    const p = plantio(s.id, t.id, { dataPlantio: '2026-10-01' });
    expect(plantioParaRow(p)).toEqual({
      safra_id: s.id,
      talhao_id: t.id,
      data_plantio: '2026-10-01',
      origem: 'manual',
      status: 'plantado',
      area_prevista: null,
      area_plantada: null,
      inicio: null,
      fim: null,
      variedade: null,
    });
    expect(rowParaPlantio(plantioParaRow(p))).toEqual(p);
  });

  it('campos novos do PIMS: camelCase <-> snake_case', () => {
    const f = { ...fazenda(1), unidadePims: 'SIRIEMA', campoCodigo: 'COD' };
    expect(fazendaParaRow(f)).toMatchObject({ unidade_pims: 'SIRIEMA', campo_codigo: 'COD' });
    expect(rowParaFazenda(fazendaParaRow(f))).toEqual(f);
    const t = { ...talhao(1, f.id), codigo: '039B' };
    expect(talhaoParaRow(t)).toMatchObject({ codigo: '039B' });
    expect(rowParaTalhao(talhaoParaRow(t))).toEqual(t);
    const s = { ...safra(1), nomePims: 'SOJA 26/27' };
    expect(safraParaRow(s)).toMatchObject({ nome_pims: 'SOJA 26/27' });
    expect(rowParaSafra(safraParaRow(s))).toEqual(s);
    const p = plantio(s.id, t.id, { origem: 'pims', status: 'plantando', areaPrevista: 228, areaPlantada: 208.5, inicio: '2026-09-20', fim: '2026-09-27', variedade: 'V' });
    expect(plantioParaRow(p)).toMatchObject({ origem: 'pims', status: 'plantando', area_prevista: 228, area_plantada: 208.5, inicio: '2026-09-20', fim: '2026-09-27', variedade: 'V' });
    expect(rowParaPlantio(plantioParaRow(p))).toEqual(p);
    // numeric do Postgres pode chegar como texto
    expect(rowParaPlantio({ ...plantioParaRow(p), area_prevista: '228.0' as unknown as number }).areaPrevista).toBe(228);
    const a = area(1, s.id, f.id);
    expect(areaCulturaParaRow(a)).toEqual({ id: a.id, safra_id: s.id, fazenda_id: f.id, codigo: '001', area_ha: 2, geom });
    expect(rowParaAreaCultura(areaCulturaParaRow(a))).toEqual(a);
  });

  it('linhas antigas (sem as colunas novas) viram null / plantio manual plantado', () => {
    const f = fazenda(1);
    const { unidade_pims: _u, campo_codigo: _c, ...fazendaAntiga } = fazendaParaRow(f);
    expect(rowParaFazenda(fazendaAntiga as FazendaRow)).toEqual(f);
    const t = talhao(1, f.id);
    const { codigo: _cod, ...talhaoAntigo } = talhaoParaRow(t);
    expect(rowParaTalhao(talhaoAntigo as TalhaoRow)).toEqual(t);
    const s = safra(1);
    const { nome_pims: _n, ...safraAntiga } = safraParaRow(s);
    expect(rowParaSafra(safraAntiga as SafraRow)).toEqual(s);
    const antigo = { safra_id: s.id, talhao_id: t.id, data_plantio: '2026-10-01' } as PlantioRow;
    expect(rowParaPlantio(antigo)).toEqual(plantio(s.id, t.id, { dataPlantio: '2026-10-01' }));
    expect(plantioParaRow({ safraId: s.id, talhaoId: t.id, dataPlantio: null } as Plantio)).toMatchObject({ origem: 'manual', status: 'plantado' });
  });

  it('colunas jsonb nulas viram listas/objetos vazios', () => {
    expect(rowParaFazenda({ ...fazendaParaRow(fazenda(1)), colunas: null as unknown as string[] }).colunas).toEqual([]);
    expect(rowParaTalhao({ ...talhaoParaRow(talhao(1, 'f')), atributos: null as unknown as Record<string, unknown> }).atributos).toEqual({});
  });

  it('mapa: datas dos PICs viram texto ISO no banco e voltam como Date', () => {
    const m = mapa(1);
    const row = mapaParaRow(m);
    expect(row.pics[0].inicio).toBe('2025-02-01T00:00:00.000Z');
    expect(row).toMatchObject({ fazenda_id: m.fazendaId, png_path: m.pngPath, thumb_path: m.thumbPath, periodo_inicio: '2025-02-01' });
    const volta = rowParaMapa(JSON.parse(JSON.stringify(row)));
    expect(volta).toEqual(m);
  });
});
