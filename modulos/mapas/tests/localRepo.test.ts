import 'fake-indexeddb/auto';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { criarLocalRepo } from '../src/data/localRepo';
import type { Repositorio } from '../src/data/repo';
import { openDB } from 'idb';
import {
  IDW_PADRAO,
  type AreaCultura,
  type Fazenda,
  type LayoutConfig,
  type MapaSalvo,
  type Pic,
  type Plantio,
  type ResumoChuva,
  type Safra,
  type Talhao,
} from '../src/lib/types';

let contadorDb = 0;
function repoNovo(): Repositorio {
  contadorDb += 1;
  return criarLocalRepo(`coa-chuva-teste-${contadorDb}`);
}

const poligono: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

function fazenda(parciais: Partial<Fazenda> = {}): Fazenda {
  return { id: 'faz-1', nome: 'Fazenda Teste', campoNome: 'NOME', campoSetor: null, colunas: ['NOME'], criadoEm: '2026-01-01T00:00:00.000Z', unidadePims: null, campoCodigo: null, ...parciais };
}

function talhao(parciais: Partial<Talhao> = {}): Talhao {
  return { id: 't-1', fazendaId: 'faz-1', nome: 'T1', setor: null, areaHa: 10, geom: poligono, atributos: { origem: 'shape' }, codigo: null, ...parciais };
}

function safra(parciais: Partial<Safra> = {}): Safra {
  return { id: 'safra-1', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-08-01', fim: '2027-07-31', nomePims: null, ...parciais };
}

function plantio(parciais: Partial<Plantio> = {}): Plantio {
  return {
    safraId: 'safra-1',
    talhaoId: 't-1',
    dataPlantio: null,
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

function areaCultura(parciais: Partial<AreaCultura> = {}): AreaCultura {
  return { id: 'a-1', safraId: 'safra-1', fazendaId: 'faz-1', codigo: '001', areaHa: 5, geom: poligono, ...parciais };
}

function pic(parciais: Partial<Pic> = {}): Pic {
  return {
    id: 'pic-1',
    nome: 'PIC 1',
    lat: -13.8,
    lon: -57.2,
    chuva: 120.5,
    inativo: false,
    inicio: new Date('2025-02-01T00:00:00.000Z'),
    fim: new Date('2025-02-28T00:00:00.000Z'),
    incluir: true,
    ...parciais,
  };
}

function resumo(): ResumoChuva {
  const estat = { media: 100, min: 50, max: 150, areaHa: 10 };
  return { geral: estat, plantado: null, talhoes: [] };
}

function layoutConfig(): LayoutConfig {
  return {
    pagina: 'A3',
    textos: { titulo: 'MAPA DE PRECIPITAÇÃO', fazenda: 'Fazenda Teste', safra: 'SOJA 26/27', periodo: '', fonte: 'ZEUS', talhoes: 'TODOS', setor: 'TODOS', observacao: '', data: '01/01/2026' },
    paletaId: 'auto',
    estiloPlantado: 'quadriculado',
    mapaBase: 'nenhum',
    mostrarRotulosTalhoes: true,
    mostrarValoresPics: true,
    mostrarGrade: false,
    legendaCompacta: false,
    extent: null,
    idw: IDW_PADRAO,
  };
}

function mapaSalvo(parciais: Partial<MapaSalvo> = {}): MapaSalvo {
  return {
    id: 'mapa-1',
    fazendaId: 'faz-1',
    safraId: 'safra-1',
    titulo: 'Mapa teste',
    periodoInicio: '2025-02-01',
    periodoFim: '2025-02-28',
    config: layoutConfig(),
    pics: [pic()],
    resumo: resumo(),
    pngPath: null,
    thumbPath: null,
    criadoEm: '2026-01-01T00:00:00.000Z',
    ...parciais,
  };
}

const pngBlob = () => new Blob(['fake-png-bytes'], { type: 'image/png' });
const thumbBlob = () => new Blob(['fake-thumb-bytes'], { type: 'image/png' });

describe('localRepo: fazendas e talhões', () => {
  it('salva e lê uma fazenda com seus talhões', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao(), talhao({ id: 't-2', nome: 'T2' })]);

    const fazendas = await repo.listarFazendas();
    expect(fazendas).toEqual([fazenda()]);

    const talhoes = await repo.obterTalhoes('faz-1');
    expect(talhoes.map((t) => t.id).sort()).toEqual(['t-1', 't-2']);
  });

  it('salvarFazenda substitui todos os talhões anteriores', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao(), talhao({ id: 't-2', nome: 'T2' })]);
    await repo.salvarFazenda(fazenda({ nome: 'Fazenda Teste v2' }), [talhao({ id: 't-3', nome: 'T3' })]);

    const talhoes = await repo.obterTalhoes('faz-1');
    expect(talhoes.map((t) => t.id)).toEqual(['t-3']);
    const [f] = await repo.listarFazendas();
    expect(f.nome).toBe('Fazenda Teste v2');
  });

  it('atualizarFazenda mantém os ids e a geometria, só troca nome/setor', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao({ areaHa: 42, geom: poligono })]);

    await repo.atualizarFazenda(fazenda({ nome: 'Nome novo' }), [talhao({ nome: 'T1 renomeado', setor: 'Setor A' })]);

    const [f] = await repo.listarFazendas();
    expect(f.nome).toBe('Nome novo');
    const [t] = await repo.obterTalhoes('faz-1');
    expect(t.nome).toBe('T1 renomeado');
    expect(t.setor).toBe('Setor A');
    expect(t.areaHa).toBe(42);
    expect(t.geom).toEqual(poligono);
  });

  it('excluirFazenda remove em cascata talhões, plantios e mapas (com arquivos)', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao()]);
    await repo.salvarSafra(safra());
    await repo.salvarPlantios('safra-1', 'faz-1', [plantio()]);
    const salvo = await repo.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());

    await repo.excluirFazenda('faz-1');

    expect(await repo.listarFazendas()).toEqual([]);
    expect(await repo.obterTalhoes('faz-1')).toEqual([]);
    expect(await repo.listarPlantios('safra-1')).toEqual([]);
    expect(await repo.listarMapas()).toEqual([]);
    await expect(repo.urlArquivo(salvo.pngPath!)).rejects.toThrow();
    await expect(repo.urlArquivo(salvo.thumbPath!)).rejects.toThrow();
  });
});

describe('localRepo: safras e plantios', () => {
  it('salvarPlantios substitui só os plantios da fazenda informada, dentro da mesma safra', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao()]);
    await repo.salvarFazenda(fazenda({ id: 'faz-2', nome: 'Fazenda 2' }), [talhao({ id: 't-2', fazendaId: 'faz-2' })]);
    await repo.salvarSafra(safra());

    await repo.salvarPlantios('safra-1', 'faz-1', [plantio({ talhaoId: 't-1' })]);
    await repo.salvarPlantios('safra-1', 'faz-2', [plantio({ talhaoId: 't-2' })]);
    expect((await repo.listarPlantios('safra-1')).map((p) => p.talhaoId).sort()).toEqual(['t-1', 't-2']);

    // Substitui (esvazia) só os plantios da fazenda 1; a fazenda 2 não deve ser afetada.
    await repo.salvarPlantios('safra-1', 'faz-1', []);
    const restantes = await repo.listarPlantios('safra-1');
    expect(restantes.map((p) => p.talhaoId)).toEqual(['t-2']);
  });

  it('excluirSafra apaga a própria safra, remove os plantios e desvincula (safraId=null) os mapas da safra', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao()]);
    await repo.salvarSafra(safra());
    await repo.salvarPlantios('safra-1', 'faz-1', [plantio()]);
    await repo.salvarMapa(mapaSalvo({ safraId: 'safra-1' }), pngBlob(), thumbBlob());

    await repo.excluirSafra('safra-1');

    expect(await repo.listarSafras()).toEqual([]);
    expect(await repo.listarPlantios('safra-1')).toEqual([]);
    const [mapa] = await repo.listarMapas();
    expect(mapa.safraId).toBeNull();
  });
});

describe('localRepo: mapas e arquivos', () => {
  it('salvarMapa define pngPath/thumbPath e urlArquivo lê o blob salvo', async () => {
    const repo = repoNovo();
    const salvo = await repo.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());

    expect(salvo.pngPath).toBe('mapas/mapa-1.png');
    expect(salvo.thumbPath).toBe('mapas/mapa-1-thumb.png');

    const url = await repo.urlArquivo(salvo.pngPath!);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('urlArquivo usa uma data: URL quando createObjectURL não está disponível', async () => {
    const repo = repoNovo();
    const salvo = await repo.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());

    const original = URL.createObjectURL;
    // @ts-expect-error simula um ambiente Node sem suporte a createObjectURL
    URL.createObjectURL = undefined;
    try {
      const url = await repo.urlArquivo(salvo.pngPath!);
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
    } finally {
      URL.createObjectURL = original;
    }
  });

  it('urlArquivo lança erro para um path inexistente', async () => {
    const repo = repoNovo();
    await expect(repo.urlArquivo('mapas/nao-existe.png')).rejects.toThrow('Arquivo não encontrado');
  });

  it('listarMapas retorna o mais recente primeiro', async () => {
    const repo = repoNovo();
    await repo.salvarMapa(mapaSalvo({ id: 'antigo', criadoEm: '2026-01-01T00:00:00.000Z' }), pngBlob(), thumbBlob());
    await repo.salvarMapa(mapaSalvo({ id: 'novo', criadoEm: '2026-06-01T00:00:00.000Z' }), pngBlob(), thumbBlob());

    const mapas = await repo.listarMapas();
    expect(mapas.map((m) => m.id)).toEqual(['novo', 'antigo']);
  });

  it('obterMapa devolve o mapa pelo id, ou null se não existir', async () => {
    const repo = repoNovo();
    await repo.salvarMapa(mapaSalvo({ id: 'a' }), pngBlob(), thumbBlob());
    await repo.salvarMapa(mapaSalvo({ id: 'b', titulo: 'Mapa B' }), pngBlob(), thumbBlob());

    const m = await repo.obterMapa('b');
    expect(m?.titulo).toBe('Mapa B');
    expect(m?.pngPath).toBe('mapas/b.png');
    expect(await repo.obterMapa('nao-existe')).toBeNull();
  });

  it('excluirMapa remove o registro e os arquivos', async () => {
    const repo = repoNovo();
    const salvo = await repo.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());

    await repo.excluirMapa(salvo);

    expect(await repo.listarMapas()).toEqual([]);
    await expect(repo.urlArquivo(salvo.pngPath!)).rejects.toThrow();
  });
});

describe('localRepo: backup', () => {
  it('exportarBackup + importarBackup faz a ida e volta preservando os dados (inclusive datas dos PICs)', async () => {
    const origem = repoNovo();
    await origem.salvarFazenda(fazenda(), [talhao()]);
    await origem.salvarSafra(safra());
    await origem.salvarPlantios('safra-1', 'faz-1', [plantio()]);
    await origem.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());

    const backup = await origem.exportarBackup();
    expect(backup.versao).toBe(1);
    expect(backup.mapas[0].pics[0].inicio).toBeInstanceOf(Date);

    // Simula o ciclo real de um arquivo de backup: vira texto e volta (datas viram string).
    const textoJson = JSON.stringify(backup);
    const lidoDeArquivo = JSON.parse(textoJson);
    expect(typeof lidoDeArquivo.mapas[0].pics[0].inicio).toBe('string');

    const destino = repoNovo();
    await destino.importarBackup(lidoDeArquivo);

    expect(await destino.listarFazendas()).toEqual([fazenda()]);
    expect((await destino.obterTalhoes('faz-1')).map((t) => t.id)).toEqual(['t-1']);
    expect(await destino.listarSafras()).toEqual([safra()]);
    expect(await destino.listarPlantios('safra-1')).toEqual([plantio()]);

    const [mapaImportado] = await destino.listarMapas();
    expect(mapaImportado.id).toBe('mapa-1');
    expect(mapaImportado.pics[0].inicio).toBeInstanceOf(Date);
    expect(mapaImportado.pics[0].inicio?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(mapaImportado.pics[0].fim?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('importarBackup não aponta para PNGs que não vieram no backup (pngPath/thumbPath = null)', async () => {
    const origem = repoNovo();
    await origem.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());
    const backup = JSON.parse(JSON.stringify(await origem.exportarBackup()));
    expect(backup.mapas[0].pngPath).toBe('mapas/mapa-1.png');

    const destino = repoNovo();
    await destino.importarBackup(backup);

    const m = await destino.obterMapa('mapa-1');
    expect(m?.pngPath).toBeNull();
    expect(m?.thumbPath).toBeNull();
  });

  it('importarBackup mantém os arquivos de um mapa que já existe neste navegador', async () => {
    const repo = repoNovo();
    const salvo = await repo.salvarMapa(mapaSalvo(), pngBlob(), thumbBlob());
    const backup = JSON.parse(JSON.stringify(await repo.exportarBackup()));
    backup.mapas[0].titulo = 'Título do backup';

    await repo.importarBackup(backup);

    const m = await repo.obterMapa('mapa-1');
    expect(m?.titulo).toBe('Título do backup');
    expect(m?.pngPath).toBe(salvo.pngPath);
    expect(await repo.urlArquivo(m!.pngPath!)).toBeTruthy();
  });

  it('importarBackup faz upsert (não duplica ao importar duas vezes)', async () => {
    const repo = repoNovo();
    const backup = { versao: 1 as const, fazendas: [fazenda()], talhoes: [talhao()], safras: [safra()], plantios: [plantio()], mapas: [], areasCultura: [areaCultura()] };

    await repo.importarBackup(backup);
    await repo.importarBackup(backup);

    expect(await repo.listarFazendas()).toHaveLength(1);
    expect(await repo.obterTalhoes('faz-1')).toHaveLength(1);
    expect(await repo.listarSafras()).toHaveLength(1);
    expect(await repo.listarAreasCultura('safra-1', 'faz-1')).toHaveLength(1);
  });

  it('exporta e importa as áreas da cultura e os campos novos (PIMS)', async () => {
    const origem = repoNovo();
    await origem.salvarFazenda(fazenda({ unidadePims: 'SIRIEMA', campoCodigo: 'COD' }), [talhao({ codigo: '001' })]);
    await origem.salvarSafra(safra({ nomePims: 'SOJA 26/27' }));
    const p = plantio({ origem: 'pims', status: 'plantando', areaPrevista: 100, areaPlantada: 40, inicio: '2026-09-20', fim: '2026-09-21', variedade: 'V1' });
    await origem.salvarPlantios('safra-1', 'faz-1', [p]);
    await origem.salvarAreasCultura('safra-1', 'faz-1', [areaCultura()]);

    const backup = JSON.parse(JSON.stringify(await origem.exportarBackup()));
    expect(backup.areasCultura).toEqual([areaCultura()]);

    const destino = repoNovo();
    await destino.importarBackup(backup);
    expect(await destino.listarFazendas()).toEqual([fazenda({ unidadePims: 'SIRIEMA', campoCodigo: 'COD' })]);
    expect(await destino.obterTalhoes('faz-1')).toEqual([talhao({ codigo: '001' })]);
    expect(await destino.listarSafras()).toEqual([safra({ nomePims: 'SOJA 26/27' })]);
    expect(await destino.listarPlantios('safra-1')).toEqual([p]);
    expect(await destino.listarAreasCultura('safra-1', 'faz-1')).toEqual([areaCultura()]);
  });

  it('importa backup antigo (sem areasCultura e sem os campos novos) completando com os padrões', async () => {
    const repo = repoNovo();
    const antigo = {
      versao: 1,
      fazendas: [{ id: 'faz-1', nome: 'Fazenda Teste', campoNome: 'NOME', campoSetor: null, colunas: ['NOME'], criadoEm: '2026-01-01T00:00:00.000Z' }],
      talhoes: [{ id: 't-1', fazendaId: 'faz-1', nome: 'T1', setor: null, areaHa: 10, geom: poligono, atributos: { origem: 'shape' } }],
      safras: [{ id: 'safra-1', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-08-01', fim: '2027-07-31' }],
      plantios: [{ safraId: 'safra-1', talhaoId: 't-1', dataPlantio: '2026-10-01' }],
      mapas: [],
    };
    await repo.importarBackup(antigo as never);
    expect(await repo.listarFazendas()).toEqual([fazenda()]);
    expect(await repo.obterTalhoes('faz-1')).toEqual([talhao()]);
    expect(await repo.listarSafras()).toEqual([safra()]);
    expect(await repo.listarPlantios('safra-1')).toEqual([plantio({ dataPlantio: '2026-10-01' })]);
    expect(await repo.listarAreasCultura('safra-1', 'faz-1')).toEqual([]);
  });
});

describe('localRepo: áreas da cultura', () => {
  it('salvarAreasCultura substitui só as da safra × fazenda informada', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao()]);
    await repo.salvarFazenda(fazenda({ id: 'faz-2', nome: 'Fazenda 2' }), []);
    await repo.salvarSafra(safra());
    await repo.salvarSafra(safra({ id: 'safra-2', nome: 'MILHO 26/27' }));

    await repo.salvarAreasCultura('safra-1', 'faz-1', [areaCultura({ id: 'a-1' }), areaCultura({ id: 'a-2', codigo: '002' })]);
    await repo.salvarAreasCultura('safra-1', 'faz-2', [areaCultura({ id: 'b-1', fazendaId: 'faz-2' })]);
    await repo.salvarAreasCultura('safra-2', 'faz-1', [areaCultura({ id: 'c-1', safraId: 'safra-2' })]);

    await repo.salvarAreasCultura('safra-1', 'faz-1', [areaCultura({ id: 'a-3', codigo: '003' })]);

    expect((await repo.listarAreasCultura('safra-1', 'faz-1')).map((a) => a.id)).toEqual(['a-3']);
    expect((await repo.listarAreasCultura('safra-1', 'faz-2')).map((a) => a.id)).toEqual(['b-1']);
    expect((await repo.listarAreasCultura('safra-2', 'faz-1')).map((a) => a.id)).toEqual(['c-1']);
  });

  it('força safraId/fazendaId informados nas áreas gravadas', async () => {
    const repo = repoNovo();
    await repo.salvarAreasCultura('safra-1', 'faz-1', [areaCultura({ safraId: 'x', fazendaId: 'y' })]);
    expect(await repo.listarAreasCultura('safra-1', 'faz-1')).toEqual([areaCultura()]);
  });

  it('excluirSafra e excluirFazenda removem as áreas da cultura em cascata', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), []);
    await repo.salvarFazenda(fazenda({ id: 'faz-2', nome: 'Fazenda 2' }), []);
    await repo.salvarSafra(safra());
    await repo.salvarSafra(safra({ id: 'safra-2' }));
    await repo.salvarAreasCultura('safra-1', 'faz-1', [areaCultura({ id: 'a-1' })]);
    await repo.salvarAreasCultura('safra-2', 'faz-1', [areaCultura({ id: 'a-2' })]);
    await repo.salvarAreasCultura('safra-2', 'faz-2', [areaCultura({ id: 'a-3' })]);

    await repo.excluirSafra('safra-1');
    expect(await repo.listarAreasCultura('safra-1', 'faz-1')).toEqual([]);
    expect(await repo.listarAreasCultura('safra-2', 'faz-1')).toHaveLength(1);

    await repo.excluirFazenda('faz-1');
    expect(await repo.listarAreasCultura('safra-2', 'faz-1')).toEqual([]);
    expect((await repo.listarAreasCultura('safra-2', 'faz-2')).map((a) => a.id)).toEqual(['a-3']);
  });
});

describe('localRepo: upsertTalhoes', () => {
  it('insere os novos e atualiza os existentes pelo id, sem apagar outros talhões nem plantios', async () => {
    const repo = repoNovo();
    await repo.salvarFazenda(fazenda(), [talhao({ id: 't-1' }), talhao({ id: 't-2', nome: 'T2' })]);
    await repo.salvarSafra(safra());
    await repo.salvarPlantios('safra-1', 'faz-1', [plantio({ talhaoId: 't-1' }), plantio({ talhaoId: 't-2' })]);

    await repo.upsertTalhoes('faz-1', [talhao({ id: 't-1', codigo: '001', areaHa: 99 }), talhao({ id: 't-3', nome: 'T3', fazendaId: 'outra' })]);

    const talhoes = await repo.obterTalhoes('faz-1');
    expect(talhoes.map((t) => t.id).sort()).toEqual(['t-1', 't-2', 't-3']);
    expect(talhoes.find((t) => t.id === 't-1')).toMatchObject({ codigo: '001', areaHa: 99 });
    expect(talhoes.find((t) => t.id === 't-3')?.fazendaId).toBe('faz-1');
    expect((await repo.listarPlantios('safra-1')).map((p) => p.talhaoId).sort()).toEqual(['t-1', 't-2']);
  });
});

describe('localRepo: outra aba abrindo o banco', () => {
  it('fecha a conexão quando outra aba precisa atualizar a versão (blocking)', async () => {
    const nome = 'coa-chuva-teste-blocking';
    const repo = criarLocalRepo(nome);
    await repo.listarFazendas();
    const nova = await openDB(nome, 99);
    expect(nova.version).toBe(99);
    nova.close();
  });

  it('versão antiga aberta em outra aba (blocked) → erro em português', async () => {
    const nome = 'coa-chuva-teste-blocked';
    const antiga = await openDB(nome, 1, {
      upgrade(db) {
        db.createObjectStore('fazendas', { keyPath: 'id' });
      },
    });
    try {
      await expect(criarLocalRepo(nome).listarFazendas()).rejects.toThrow(/outra aba/);
    } finally {
      antiga.close();
    }
  });
});

describe('localRepo: atualização do banco v1 (antes do PIMS)', () => {
  it('mantém os dados antigos, completa os campos novos e cria o store areasCultura', async () => {
    const nome = 'coa-chuva-teste-v1';
    const v1 = await openDB(nome, 1, {
      upgrade(db) {
        db.createObjectStore('fazendas', { keyPath: 'id' });
        db.createObjectStore('talhoes', { keyPath: 'id' }).createIndex('fazendaId', 'fazendaId');
        db.createObjectStore('safras', { keyPath: 'id' });
        const plantios = db.createObjectStore('plantios', { keyPath: ['safraId', 'talhaoId'] });
        plantios.createIndex('safraId', 'safraId');
        plantios.createIndex('talhaoId', 'talhaoId');
        db.createObjectStore('mapas', { keyPath: 'id' });
        db.createObjectStore('arquivos', { keyPath: 'path' });
      },
    });
    await v1.put('fazendas', { id: 'faz-1', nome: 'Fazenda Teste', campoNome: 'NOME', campoSetor: null, colunas: ['NOME'], criadoEm: '2026-01-01T00:00:00.000Z' });
    await v1.put('talhoes', { id: 't-1', fazendaId: 'faz-1', nome: 'T1', setor: null, areaHa: 10, geom: poligono, atributos: { origem: 'shape' } });
    await v1.put('safras', { id: 'safra-1', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-08-01', fim: '2027-07-31' });
    await v1.put('plantios', { safraId: 'safra-1', talhaoId: 't-1', dataPlantio: '2026-10-01' });
    await v1.put('mapas', mapaSalvo());
    v1.close();

    const repo = criarLocalRepo(nome);
    expect(await repo.listarFazendas()).toEqual([fazenda()]);
    expect(await repo.obterTalhoes('faz-1')).toEqual([talhao()]);
    expect(await repo.listarSafras()).toEqual([safra()]);
    expect(await repo.listarPlantios('safra-1')).toEqual([plantio({ dataPlantio: '2026-10-01' })]);
    expect(await repo.listarMapas()).toHaveLength(1);

    await repo.salvarAreasCultura('safra-1', 'faz-1', [areaCultura()]);
    expect(await repo.listarAreasCultura('safra-1', 'faz-1')).toEqual([areaCultura()]);
    const backup = await repo.exportarBackup();
    expect(backup.plantios).toEqual([plantio({ dataPlantio: '2026-10-01' })]);
    expect(backup.fazendas).toEqual([fazenda()]);
  });
});
