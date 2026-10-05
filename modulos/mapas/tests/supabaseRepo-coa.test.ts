import { describe, expect, it, vi } from 'vitest';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { BUCKET, fazendaParaRow, mapaParaRow, TABELAS, type PlantioPimsRow } from '../src/data/supabaseLinhas';
import type { PlantioPimsTalhao } from '../src/lib/types';
import { area, fazenda, mapa, plantio, safra, talhao, uuid } from './helpers/dominio';
import { BancoFalso } from './helpers/supabaseFalso';

const jpeg = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const png = () => new Blob(['png'], { type: 'image/png' });

describe('supabaseRepo: tabelas e bucket do Supabase do COA WEB', () => {
  it('TABELAS: nomes mapas_* do módulo', () => {
    expect(TABELAS).toEqual({
      fazendas: 'mapas_fazendas',
      talhoes: 'mapas_talhoes',
      safras: 'mapas_safras',
      plantios: 'mapas_plantios',
      areasCultura: 'mapas_areas_cultura',
      mapas: 'mapas_chuva',
      plantioPims: 'mapas_plantio_pims',
      pedidosPlantio: 'mapas_plantio_pedidos',
      pedidosChuva: 'mapas_chuva_pedidos',
    });
  });

  it('usa só as tabelas mapas_* e o bucket mapas-chuva; fazendas e perfis do COA WEB só onde lê o COA WEB', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    const repo = criarSupabaseRepo(banco.cliente());
    const [f, s] = [fazenda(0), safra(0)];
    const t = talhao(1, f.id);

    await repo.salvarFazenda(f, [t]);
    await repo.atualizarFazenda(f, [t]);
    await repo.upsertTalhoes(f.id, [t]);
    await repo.listarFazendas();
    await repo.obterTalhoes(f.id);
    await repo.salvarSafra(s);
    await repo.listarSafras();
    await repo.salvarPlantios(s.id, f.id, [plantio(s.id, t.id)]);
    await repo.listarPlantios(s.id);
    await repo.salvarAreasCultura(s.id, f.id, [area(1, s.id, f.id)]);
    await repo.listarAreasCultura(s.id, f.id);
    const salvo = await repo.salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), jpeg(), png());
    await repo.listarMapas();
    await repo.obterMapa(salvo.id);
    await repo.urlArquivo(salvo.pngPath!);
    await repo.lerPlantioPims();
    await repo.situacaoPedidoPlantio(await repo.pedirAtualizacaoPlantio());
    await repo.situacaoPedidoChuva(await repo.pedirChuvaZeus({ fazenda: 'SM3', de: '2026-10-01', ate: '2026-10-01' }));
    await repo.importarBackup(await repo.exportarBackup());
    await repo.excluirMapa(salvo);
    await repo.excluirSafra(s.id);
    await repo.excluirFazenda(f.id);

    expect([...banco.tabelasUsadas].sort()).toEqual(Object.values(TABELAS).sort());
    expect([...banco.buckets]).toEqual([BUCKET]);
    expect(BUCKET).toBe('mapas-chuva');
    expect(banco.requisicoes.filter((r) => r.op === 'select').length).toBeGreaterThan(0);

    await repo.listarFazendasCoa();
    await repo.perfil();
    expect([...banco.tabelasUsadas].filter((n) => !n.startsWith('mapas_')).sort()).toEqual(['fazendas', 'perfis']);
  });
});

describe('supabaseRepo: perfil do usuário no COA WEB', () => {
  const comPerfil = (sessao: string | null, perfis: { id: string; perfil: unknown }[]) => {
    const banco = new BancoFalso();
    banco.sessao = sessao ? { user: { id: sessao } } : null;
    banco.inserir('perfis', perfis.map((p) => ({ ...p, nome: 'X', email: 'x@y' })));
    return criarSupabaseRepo(banco.cliente());
  };

  it('sem sessão → null (nem consulta perfis)', async () => {
    const banco = new BancoFalso();
    expect(await criarSupabaseRepo(banco.cliente()).perfil()).toBeNull();
    expect(banco.tabelasUsadas.has('perfis')).toBe(false);
  });

  it('sessão sem linha em perfis → null', async () => {
    expect(await comPerfil('u1', [{ id: 'outro', perfil: 'admin' }]).perfil()).toBeNull();
  });

  it("perfis.perfil = 'admin' → 'admin'; 'colaborador' → 'colaborador'", async () => {
    expect(await comPerfil('u1', [{ id: 'u1', perfil: 'admin' }, { id: 'u2', perfil: 'colaborador' }]).perfil()).toBe('admin');
    expect(await comPerfil('u2', [{ id: 'u1', perfil: 'admin' }, { id: 'u2', perfil: 'colaborador' }]).perfil()).toBe('colaborador');
  });

  it("valor desconhecido (ou nulo) → 'colaborador'", async () => {
    expect(await comPerfil('u1', [{ id: 'u1', perfil: 'gestor' }]).perfil()).toBe('colaborador');
    expect(await comPerfil('u1', [{ id: 'u1', perfil: null }]).perfil()).toBe('colaborador');
  });

  it('erro do servidor → exceção com contexto', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    banco.falhar = (r) => (r.tabela === 'perfis' ? 'falha simulada' : null);
    await expect(criarSupabaseRepo(banco.cliente()).perfil()).rejects.toThrow('falha simulada');
  });
});

describe('supabaseRepo: listarFazendasCoa', () => {
  it('lê id e nome de fazendas (COA WEB), por nome, com id numérico', async () => {
    const banco = new BancoFalso();
    banco.inserir('fazendas', [
      { id: 2, nome: 'Siriema', cidade: 'X' },
      { id: '10', nome: 'Dourado', cidade: 'Y' },
      { id: 5, nome: 'Globo', cidade: 'Z' },
    ]);
    expect(await criarSupabaseRepo(banco.cliente()).listarFazendasCoa()).toEqual([
      { id: 10, nome: 'Dourado' },
      { id: 5, nome: 'Globo' },
      { id: 2, nome: 'Siriema' },
    ]);
  });
});

describe('supabaseRepo: lerPlantioPims (tabela mapas_plantio_pims)', () => {
  const t = (codigo: string): PlantioPimsTalhao => ({ codigo, codigoPims: codigo, setor: null, status: 'plantado', areaPrevista: 1, areaPlantada: 1, inicio: null, fim: null, variedade: null });
  const linha = (safra: string, unidade: string, geradoEm: string, talhoes: unknown[] = [t('001')]): PlantioPimsRow => ({
    safra,
    unidade,
    gerado_em: geradoEm,
    talhoes: talhoes as PlantioPimsTalhao[],
  });

  it('sem linhas → null', async () => {
    expect(await criarSupabaseRepo(new BancoFalso().cliente()).lerPlantioPims()).toBeNull();
  });

  it('monta o arquivo a partir das linhas visíveis (todas as páginas)', async () => {
    const banco = new BancoFalso(400);
    banco.inserir(TABELAS.plantioPims, [
      linha('SOJA 26/27', 'SIRIEMA', '2026-09-28T10:00:00+00:00'),
      linha('MILHO 26/27', 'GLOBO', '2026-09-28T09:00:00+00:00'),
      linha('SOJA 26/27', 'DOURADO', '2026-09-28T11:30:00+00:00', [t('002'), { codigo: 3, status: 'plantado' }]),
      ...Array.from({ length: 1200 }, (_, i) => linha('FEIJAO 26/27', `U${String(i).padStart(4, '0')}`, '2026-09-28T08:00:00+00:00')),
    ]);
    const arq = await criarSupabaseRepo(banco.cliente()).lerPlantioPims();
    expect(arq).toMatchObject({ versao: 1, fonte: 'PIMS', geradoEm: '2026-09-28T11:30:00.000Z' });
    expect(arq!.safras.map((s) => s.nome)).toEqual(['FEIJAO 26/27', 'MILHO 26/27', 'SOJA 26/27']);
    expect(arq!.safras[0].unidades).toHaveLength(1200);
    expect(arq!.safras[2].unidades.map((u) => [u.unidade, u.talhoes.map((x) => x.codigo)])).toEqual([
      ['DOURADO', ['002']],
      ['SIRIEMA', ['001']],
    ]);
  });

  it('erro do servidor → exceção com contexto', async () => {
    const banco = new BancoFalso();
    banco.falhar = () => 'falha simulada';
    await expect(criarSupabaseRepo(banco.cliente()).lerPlantioPims()).rejects.toThrow(/plantio do PIMS: falha simulada/);
  });
});

describe('supabaseRepo: salvarMapa (histórico em JPEG)', () => {
  it('grava <id>.jpg e <id>-thumb.png no bucket mapas-chuva, com o contentType de cada blob', async () => {
    const banco = new BancoFalso();
    const salvo = await criarSupabaseRepo(banco.cliente()).salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), jpeg(), png());
    expect(salvo.pngPath).toBe(`${uuid('map', 1)}.jpg`);
    expect(salvo.thumbPath).toBe(`${uuid('map', 1)}-thumb.png`);
    expect(banco.envios).toEqual([
      { bucket: 'mapas-chuva', path: `${uuid('map', 1)}.jpg`, contentType: 'image/jpeg', upsert: true },
      { bucket: 'mapas-chuva', path: `${uuid('map', 1)}-thumb.png`, contentType: 'image/png', upsert: true },
    ]);
    expect(banco.tabelas[TABELAS.mapas][0]).toMatchObject({ png_path: salvo.pngPath, thumb_path: salvo.thumbPath });
  });

  it('blob PNG (ou sem tipo) continua <id>.png com image/png', async () => {
    const banco = new BancoFalso();
    const salvo = await criarSupabaseRepo(banco.cliente()).salvarMapa(mapa(1), new Blob(['x']), new Blob(['y']));
    expect([salvo.pngPath, salvo.thumbPath]).toEqual([`${uuid('map', 1)}.png`, `${uuid('map', 1)}-thumb.png`]);
    expect(banco.envios.map((e) => e.contentType)).toEqual(['image/png', 'image/png']);
  });

  it('regravar um mapa antigo (.png) como JPEG remove o PNG antigo depois de atualizar a linha', async () => {
    const banco = new BancoFalso();
    const antigo = mapa(1);
    banco.inserir(TABELAS.mapas, [mapaParaRow(antigo)]);
    banco.arquivos.set(antigo.pngPath!, png());
    banco.arquivos.set(antigo.thumbPath!, png());

    const salvo = await criarSupabaseRepo(banco.cliente()).salvarMapa({ ...antigo, pngPath: null, thumbPath: null }, jpeg(), png());

    expect([...banco.arquivos.keys()].sort()).toEqual([`${uuid('map', 1)}-thumb.png`, `${uuid('map', 1)}.jpg`]);
    const ops = banco.requisicoes.map((r) => `${r.tabela}:${r.op}`);
    expect(ops.indexOf(`${TABELAS.mapas}:upsert`)).toBeLessThan(ops.indexOf('storage:mapas-chuva:remove'));
    const remocoes = banco.requisicoes.filter((r) => r.op === 'remove');
    expect(remocoes.map((r) => r.paths)).toEqual([[antigo.pngPath]]); // a miniatura (mesmo caminho) fica
    expect(salvo.pngPath).toBe(`${uuid('map', 1)}.jpg`);
  });

  it('regravar com o mesmo caminho não remove nada', async () => {
    const banco = new BancoFalso();
    const repo = criarSupabaseRepo(banco.cliente());
    const salvo = await repo.salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), jpeg(), png());
    await repo.salvarMapa({ ...salvo, titulo: 'De novo' }, jpeg(), png());
    expect(banco.requisicoes.filter((r) => r.op === 'remove')).toEqual([]);
    expect(banco.arquivos.has(salvo.pngPath!)).toBe(true);
  });

  it('falha ao remover o arquivo antigo não falha o salvamento', async () => {
    const banco = new BancoFalso();
    const antigo = mapa(1);
    banco.inserir(TABELAS.mapas, [mapaParaRow(antigo)]);
    banco.falhar = (r) => (r.op === 'remove' ? 'sem permissão' : null);
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const salvo = await criarSupabaseRepo(banco.cliente()).salvarMapa(antigo, jpeg(), png());
    expect(aviso).toHaveBeenCalledOnce();
    aviso.mockRestore();
    expect(salvo.pngPath).toBe(`${uuid('map', 1)}.jpg`);
    expect(banco.tabelas[TABELAS.mapas][0]).toMatchObject({ png_path: salvo.pngPath });
  });

  it('falha ao ler os arquivos antigos avisa no console (e o salvamento continua)', async () => {
    const banco = new BancoFalso();
    banco.inserir(TABELAS.mapas, [mapaParaRow(mapa(1))]);
    banco.falhar = (r) => (r.tabela === TABELAS.mapas && r.op === 'select' ? 'sem acesso' : null);
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const salvo = await criarSupabaseRepo(banco.cliente()).salvarMapa(mapa(1), jpeg(), png());
    expect(aviso).toHaveBeenCalledOnce();
    expect(String(aviso.mock.calls[0][0])).toMatch(/arquivos antigos do mapa/);
    aviso.mockRestore();
    expect(salvo.pngPath).toBe(`${uuid('map', 1)}.jpg`);
    expect(banco.requisicoes.filter((r) => r.op === 'remove')).toEqual([]);
  });

  it('mapa novo (sem linha no banco) não avisa nada', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await criarSupabaseRepo(new BancoFalso().cliente()).salvarMapa(mapa(1, { pngPath: null, thumbPath: null }), jpeg(), png());
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('supabaseRepo: importarBackup e o vínculo com o COA WEB', () => {
  const backup = (fazendas: ReturnType<typeof fazenda>[]) => ({ versao: 1 as const, fazendas, talhoes: [], safras: [], plantios: [], mapas: [] });
  const vinculos = (banco: BancoFalso) => Object.fromEntries(banco.tabelas[TABELAS.fazendas].map((l) => [l.id, l.coa_fazenda_id]));

  it('fazenda do backup sem vínculo (null ou campo ausente) não apaga o vínculo que já existe no banco', async () => {
    const banco = new BancoFalso();
    const [a, b, c, d] = [fazenda(1), fazenda(2), fazenda(3), fazenda(4)];
    banco.inserir(TABELAS.fazendas, [fazendaParaRow({ ...a, coaFazendaId: 42 }), fazendaParaRow({ ...b, coaFazendaId: 5 }), fazendaParaRow({ ...d, coaFazendaId: 9 })]);
    const { coaFazendaId: _, ...dAntigo } = { ...d, nome: 'Backup antigo' }; // backup de antes do campo
    await criarSupabaseRepo(banco.cliente()).importarBackup(backup([a, { ...b, coaFazendaId: 7 }, c, dAntigo as typeof d]));
    expect(vinculos(banco)).toEqual({ [a.id]: 42, [b.id]: 7, [c.id]: null, [d.id]: 9 });
    expect(banco.tabelas[TABELAS.fazendas].find((l) => l.id === d.id)?.nome).toBe('Backup antigo'); // o resto é atualizado
  });

  it('lê os vínculos atuais em blocos de ids (backup grande)', async () => {
    const banco = new BancoFalso();
    const muitas = Array.from({ length: 450 }, (_, i) => fazenda(i));
    banco.inserir(TABELAS.fazendas, muitas.map((f, i) => fazendaParaRow({ ...f, coaFazendaId: i })));
    await criarSupabaseRepo(banco.cliente()).importarBackup(backup(muitas));
    expect(banco.tabelas[TABELAS.fazendas].map((l) => l.coa_fazenda_id)).toEqual(muitas.map((_, i) => i));
    const leituras = banco.requisicoes.filter((r) => r.tabela === TABELAS.fazendas && r.op === 'select');
    expect(Math.max(...leituras.flatMap((r) => r.listasIn))).toBeLessThanOrEqual(200);
  });
});
