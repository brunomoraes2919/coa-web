import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { extensaoImagem } from '../lib/historico';
import { carregarPlantioPims } from '../lib/plantioPims';
import type { AreaCultura, CorVariedade, Fazenda, MapaSalvo, Plantio, PopulacaoVariedade, Safra, Talhao, VariedadePims } from '../lib/types';
import { rowParaRegistroCar, rowParaVariedadePims, type VariedadeRow } from './supabaseLinhas';
import type { BackupJson, Repositorio } from './repo';
import { completarFazenda, completarPlantio, completarSafra, completarTalhao, reviverPics } from './supabaseLinhas';

/**
 * Repositório local (IndexedDB via idb). Stores: fazendas, talhoes (índice fazendaId), safras,
 * plantios (chave composta [safraId, talhaoId], índices safraId e talhaoId), mapas, arquivos
 * (blobs da imagem/miniatura, chaveados pelo path "mapas/<id>.jpg" — ".png" nos mapas antigos — e
 * "mapas/<id>-thumb.png") e, desde a versão 2 do banco, areasCultura (índices safraFazenda
 * [safraId, fazendaId], safraId e fazendaId). Registros antigos não têm os campos novos (plantio do
 * PIMS, coaFazendaId): são completados na leitura. Sem login no modo local: o usuário é admin.
 */

interface ArquivoRegistro {
  path: string;
  blob: Blob;
}

interface CoaChuvaDB extends DBSchema {
  fazendas: { key: string; value: Fazenda };
  talhoes: { key: string; value: Talhao; indexes: { fazendaId: string } };
  safras: { key: string; value: Safra };
  plantios: {
    key: [string, string];
    value: Plantio;
    indexes: { safraId: string; talhaoId: string };
  };
  mapas: { key: string; value: MapaSalvo };
  arquivos: { key: string; value: ArquivoRegistro };
  areasCultura: {
    key: string;
    value: AreaCultura;
    indexes: { safraFazenda: [string, string]; safraId: string; fazendaId: string };
  };
  coresVariedade: { key: string; value: CorVariedade };
  nomesVariedade: { key: string; value: { chave: string; nome: string; em: string } };
  populacao: { key: [string, string, string]; value: PopulacaoVariedade & { unidade: string; safra: string } };
}

const VERSAO_DB = 5;

const ERRO_BLOQUEADO =
  'O banco local está aberto em outra aba com uma versão anterior do app. Feche as outras abas do Mapa de Chuva COA e recarregue esta página.';

/**
 * Abre o banco. `blocking`: outra aba (versão mais nova do app) quer atualizar o banco → esta conexão
 * fecha para não travá-la. `blocked`: uma aba antiga segura o banco → rejeita com mensagem em português
 * (a página precisa ser recarregada depois de fechar as outras abas).
 */
function abrirDb(dbName: string): Promise<IDBPDatabase<CoaChuvaDB>> {
  return new Promise((resolve, reject) => {
    let bloqueado = false;
    openDB<CoaChuvaDB>(dbName, VERSAO_DB, {
      upgrade: atualizarEsquema,
      blocked() {
        bloqueado = true;
        reject(new Error(ERRO_BLOQUEADO));
      },
      blocking(_versaoAtual, _versaoNova, evento) {
        (evento.target as IDBDatabase).close();
      },
    }).then(
      (db) => {
        // Se a aba antiga fechou depois do aviso, a promessa já foi rejeitada: não segura a conexão.
        if (bloqueado) db.close();
        else resolve(db);
      },
      reject,
    );
  });
}

function atualizarEsquema(db: IDBPDatabase<CoaChuvaDB>, versaoAntiga: number): void {
  if (versaoAntiga < 1) {
    db.createObjectStore('fazendas', { keyPath: 'id' });
    const talhoes = db.createObjectStore('talhoes', { keyPath: 'id' });
    talhoes.createIndex('fazendaId', 'fazendaId');
    db.createObjectStore('safras', { keyPath: 'id' });
    const plantios = db.createObjectStore('plantios', { keyPath: ['safraId', 'talhaoId'] });
    plantios.createIndex('safraId', 'safraId');
    plantios.createIndex('talhaoId', 'talhaoId');
    db.createObjectStore('mapas', { keyPath: 'id' });
    db.createObjectStore('arquivos', { keyPath: 'path' });
  }
  if (versaoAntiga < 2) {
    // v2 (plantio do PIMS): só cria o store novo; os registros antigos são completados na leitura.
    const areas = db.createObjectStore('areasCultura', { keyPath: 'id' });
    areas.createIndex('safraFazenda', ['safraId', 'fazendaId']);
    areas.createIndex('safraId', 'safraId');
    areas.createIndex('fazendaId', 'fazendaId');
  }
  if (versaoAntiga < 3) {
    // v3 (mapa de variedade): cor fixa de cada variedade
    db.createObjectStore('coresVariedade', { keyPath: 'variedade' });
  }
  if (versaoAntiga < 4) {
    // v4 (nome comercial das variedades): o nome digitado, pela chave da variedade
    db.createObjectStore('nomesVariedade', { keyPath: 'chave' });
  }
  if (versaoAntiga < 5) {
    // v5 (sementes por metro e população): por fazenda (unidade do PIMS), safra e variedade
    db.createObjectStore('populacao', { keyPath: ['unidade', 'safra', 'variedade'] });
  }
}

/**
 * Cadastro de variedades do modo local: public/dados/variedades.json (gravado por `npm run plantio`, só nesta
 * máquina). Sem o arquivo, lista vazia.
 */
async function lerVariedadesLocais(): Promise<VariedadePims[]> {
  try {
    const r = await fetch('./dados/variedades.json', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = (await r.json()) as { atualizadoEm?: string; linhas?: VariedadeRow[] };
    return (j.linhas ?? []).map((l) => rowParaVariedadePims({ ...l, visto_em: l.visto_em ?? j.atualizadoEm ?? new Date(0).toISOString(), nome_comercial: null, comercial_em: null }));
  } catch {
    return [];
  }
}

/** URL utilizável no <img>: object URL no navegador; data: URL quando createObjectURL não existe (Node). */
async function blobParaUrl(blob: Blob): Promise<string> {
  if (typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  const buffer = await blob.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const tipo = blob.type || 'application/octet-stream';
  return `data:${tipo};base64,${base64}`;
}

export function criarLocalRepo(dbName = 'coa-chuva'): Repositorio {
  const dbPromise = abrirDb(dbName);
  // O erro (ex.: banco bloqueado por outra aba) aparece em cada chamada; evita "unhandled rejection" antes delas.
  dbPromise.catch(() => undefined);

  /** Remove os plantios dos talhões informados e os próprios talhões. */
  async function excluirTalhoesEPlantios(db: IDBPDatabase<CoaChuvaDB>, talhaoIds: string[]): Promise<void> {
    if (talhaoIds.length === 0) return;
    const tx = db.transaction(['talhoes', 'plantios'], 'readwrite');
    for (const talhaoId of talhaoIds) {
      const plantiosDoTalhao = await tx.objectStore('plantios').index('talhaoId').getAllKeys(talhaoId);
      for (const chave of plantiosDoTalhao) await tx.objectStore('plantios').delete(chave);
      await tx.objectStore('talhoes').delete(talhaoId);
    }
    await tx.done;
  }

  /** Remove um mapa e os arquivos (imagem/miniatura) associados a ele. */
  async function removerMapaEArquivos(db: IDBPDatabase<CoaChuvaDB>, mapa: MapaSalvo): Promise<void> {
    const tx = db.transaction(['mapas', 'arquivos'], 'readwrite');
    if (mapa.pngPath) await tx.objectStore('arquivos').delete(mapa.pngPath);
    if (mapa.thumbPath) await tx.objectStore('arquivos').delete(mapa.thumbPath);
    await tx.objectStore('mapas').delete(mapa.id);
    await tx.done;
  }

  return {
    modo: 'local',

    async acesso() {
      return { perfil: 'admin', adminSemRestricao: true, super: true };
    },

    async listarFazendasCoa() {
      return [];
    },

    async lerPlantioPims() {
      return carregarPlantioPims();
    },

    // quem atende os pedidos é o servidor do COA WEB (Supabase)
    podeAtualizarPlantio: false,

    async pedirAtualizacaoPlantio() {
      throw new Error('Atualizar o plantio só funciona no COA WEB.');
    },

    async situacaoPedidoPlantio() {
      return null;
    },

    podeBuscarChuva: false,

    async pedirChuvaZeus() {
      throw new Error('Inserir dados via integração só funciona no COA WEB.');
    },

    async situacaoPedidoChuva() {
      return null;
    },

    async situacaoZeus() {
      return [];
    },

    podeBuscarCar: false,

    async obterCar(fazendaId) {
      // teste local: public/dados/car/<NOME>.json (fora do repositório), gravado por quem desenvolve
      const db = await dbPromise;
      const f = await db.get('fazendas', fazendaId);
      if (!f) return null;
      const arquivo = f.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, '_');
      try {
        const r = await fetch(`./dados/car/${encodeURIComponent(arquivo)}.json`, { cache: 'no-store' });
        if (!r.ok) return null;
        const j = (await r.json()) as { atualizadoEm?: string; dados?: unknown; fontes?: unknown };
        return rowParaRegistroCar({ fazenda_id: fazendaId, atualizado_em: j.atualizadoEm ?? new Date().toISOString(), dados: j.dados, fontes: j.fontes });
      } catch {
        return null;
      }
    },

    async pedirBuscaCar() {
      throw new Error('Buscar nas bases só funciona no COA WEB (quem consulta as bases é o servidor).');
    },

    async situacaoPedidoCar() {
      return null;
    },

    async listarFazendas() {
      const db = await dbPromise;
      const fazendas = (await db.getAll('fazendas')).map(completarFazenda);
      return fazendas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },

    async obterTalhoes(fazendaId) {
      const db = await dbPromise;
      return (await db.getAllFromIndex('talhoes', 'fazendaId', fazendaId)).map(completarTalhao);
    },

    async salvarFazenda(f, talhoes) {
      const db = await dbPromise;
      const antigos = await db.getAllFromIndex('talhoes', 'fazendaId', f.id);
      await excluirTalhoesEPlantios(db, antigos.map((t) => t.id));
      await db.put('fazendas', completarFazenda(f));
      const tx = db.transaction('talhoes', 'readwrite');
      for (const t of talhoes) await tx.store.put({ ...t, fazendaId: f.id });
      await tx.done;
    },

    async atualizarFazenda(f, talhoes) {
      const db = await dbPromise;
      await db.put('fazendas', completarFazenda(f));
      const tx = db.transaction('talhoes', 'readwrite');
      for (const t of talhoes) {
        const existente = await tx.store.get(t.id);
        if (existente) {
          await tx.store.put({ ...existente, nome: t.nome, setor: t.setor });
        } else {
          await tx.store.put(t);
        }
      }
      await tx.done;
    },

    async upsertTalhoes(fazendaId, talhoes) {
      const db = await dbPromise;
      const tx = db.transaction('talhoes', 'readwrite');
      for (const t of talhoes) await tx.store.put({ ...t, fazendaId });
      await tx.done;
    },

    async excluirFazenda(id) {
      const db = await dbPromise;
      const talhoes = await db.getAllFromIndex('talhoes', 'fazendaId', id);
      await excluirTalhoesEPlantios(db, talhoes.map((t) => t.id));
      const areas = await db.getAllKeysFromIndex('areasCultura', 'fazendaId', id);
      if (areas.length) {
        const tx = db.transaction('areasCultura', 'readwrite');
        for (const chave of areas) await tx.store.delete(chave);
        await tx.done;
      }
      const mapas = (await db.getAll('mapas')).filter((m) => m.fazendaId === id);
      for (const mapa of mapas) await removerMapaEArquivos(db, mapa);
      await db.delete('fazendas', id);
    },

    async listarSafras() {
      const db = await dbPromise;
      return (await db.getAll('safras')).map(completarSafra);
    },

    async salvarSafra(s) {
      const db = await dbPromise;
      await db.put('safras', s);
    },

    async excluirSafra(id) {
      const db = await dbPromise;
      const chaves = await db.getAllKeysFromIndex('plantios', 'safraId', id);
      const areas = await db.getAllKeysFromIndex('areasCultura', 'safraId', id);
      const tx = db.transaction(['safras', 'plantios', 'mapas', 'areasCultura'], 'readwrite');
      await tx.objectStore('safras').delete(id);
      for (const chave of chaves) await tx.objectStore('plantios').delete(chave);
      for (const chave of areas) await tx.objectStore('areasCultura').delete(chave);
      // Espelha o "on delete set null" da FK mapas.safra_id do Supabase.
      let cursor = await tx.objectStore('mapas').openCursor();
      while (cursor) {
        if (cursor.value.safraId === id) await cursor.update({ ...cursor.value, safraId: null });
        cursor = await cursor.continue();
      }
      await tx.done;
    },

    async listarPlantios(safraId) {
      const db = await dbPromise;
      return (await db.getAllFromIndex('plantios', 'safraId', safraId)).map(completarPlantio);
    },

    async salvarPlantios(safraId, fazendaId, plantios) {
      const db = await dbPromise;
      const talhoesFazenda = await db.getAllFromIndex('talhoes', 'fazendaId', fazendaId);
      const idsTalhoesFazenda = new Set(talhoesFazenda.map((t) => t.id));
      const existentes = await db.getAllFromIndex('plantios', 'safraId', safraId);
      const tx = db.transaction('plantios', 'readwrite');
      for (const p of existentes) {
        if (idsTalhoesFazenda.has(p.talhaoId)) await tx.store.delete([p.safraId, p.talhaoId]);
      }
      for (const p of plantios) await tx.store.put(completarPlantio({ ...p, safraId }));
      await tx.done;
    },

    async listarAreasCultura(safraId, fazendaId) {
      const db = await dbPromise;
      return db.getAllFromIndex('areasCultura', 'safraFazenda', [safraId, fazendaId]);
    },

    async salvarAreasCultura(safraId, fazendaId, areas) {
      const db = await dbPromise;
      const tx = db.transaction('areasCultura', 'readwrite');
      const antigas = await tx.store.index('safraFazenda').getAllKeys([safraId, fazendaId]);
      for (const chave of antigas) await tx.store.delete(chave);
      for (const a of areas) await tx.store.put({ ...a, safraId, fazendaId });
      await tx.done;
    },

    async listarMapas(tipo = 'chuva') {
      const db = await dbPromise;
      const mapas = await db.getAll('mapas');
      return mapas.filter((m) => (m.tipo ?? 'chuva') === tipo).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    },

    async obterMapa(id) {
      const db = await dbPromise;
      return (await db.get('mapas', id)) ?? null;
    },

    async salvarMapa(m, imagem, thumb) {
      const db = await dbPromise;
      const pngPath = `mapas/${m.id}.${extensaoImagem(imagem.type)}`;
      const thumbPath = `mapas/${m.id}-thumb.${extensaoImagem(thumb.type)}`;
      const salvo: MapaSalvo = { ...m, pngPath, thumbPath };
      const tx = db.transaction(['mapas', 'arquivos'], 'readwrite');
      const anterior = await tx.objectStore('mapas').get(m.id);
      await tx.objectStore('arquivos').put({ path: pngPath, blob: imagem });
      await tx.objectStore('arquivos').put({ path: thumbPath, blob: thumb });
      await tx.objectStore('mapas').put(salvo);
      // arquivo que o mapa deixou de usar (ex.: "<id>.png" de antes do JPEG)
      for (const p of [anterior?.pngPath, anterior?.thumbPath]) {
        if (p && p !== pngPath && p !== thumbPath) await tx.objectStore('arquivos').delete(p);
      }
      await tx.done;
      return salvo;
    },

    async urlArquivo(path) {
      const db = await dbPromise;
      const registro = await db.get('arquivos', path);
      if (!registro) throw new Error(`Arquivo não encontrado: ${path}`);
      return blobParaUrl(registro.blob);
    },

    async excluirMapa(m) {
      const db = await dbPromise;
      await removerMapaEArquivos(db, m);
    },

    async listarCoresVariedade() {
      const db = await dbPromise;
      return (await db.getAll('coresVariedade')).sort((a, b) => a.variedade.localeCompare(b.variedade));
    },

    async criarCorVariedade(variedade, cor) {
      const db = await dbPromise;
      const tx = db.transaction('coresVariedade', 'readwrite');
      const atual = await tx.store.get(variedade);
      const salvo = atual ?? { variedade, cor, criadoEm: new Date().toISOString() };
      if (!atual) await tx.store.put(salvo);
      await tx.done;
      return salvo;
    },

    async trocarCorVariedade(variedade, cor) {
      const db = await dbPromise;
      const atual = await db.get('coresVariedade', variedade);
      if (!atual) throw new Error('Variedade não encontrada no cadastro de cores.');
      await db.put('coresVariedade', { ...atual, cor });
    },

    async excluirCorVariedade(variedade) {
      const db = await dbPromise;
      await db.delete('coresVariedade', variedade);
    },

    async listarVariedadesPims() {
      const db = await dbPromise;
      const [lista, nomes] = await Promise.all([lerVariedadesLocais(), db.getAll('nomesVariedade')]);
      const porChave = new Map(nomes.map((n) => [n.chave, n]));
      return lista.map((v) => {
        const n = porChave.get(v.chave);
        return n ? { ...v, nomeComercial: n.nome, comercialEm: n.em } : v;
      });
    },

    async salvarNomeComercial(chave, nome) {
      const db = await dbPromise;
      const valor = nome && nome.trim() ? nome.trim() : null;
      if (valor) await db.put('nomesVariedade', { chave, nome: valor, em: new Date().toISOString() });
      else await db.delete('nomesVariedade', chave);
    },

    async listarPopulacao(unidade, safra) {
      const db = await dbPromise;
      return (await db.getAll('populacao'))
        .filter((l) => l.unidade === unidade && l.safra === safra)
        .map(({ variedade, sementesMetro, populacao }) => ({ variedade, sementesMetro, populacao }));
    },

    async salvarPopulacao(unidade, safra, linhas) {
      const db = await dbPromise;
      for (const l of linhas) {
        if (l.sementesMetro === null && l.populacao === null) await db.delete('populacao', [unidade, safra, l.variedade]);
        else await db.put('populacao', { unidade, safra, variedade: l.variedade, sementesMetro: l.sementesMetro, populacao: l.populacao });
      }
    },

    async exportarBackup() {
      const db = await dbPromise;
      const [fazendas, talhoes, safras, plantios, mapas, areasCultura] = await Promise.all([
        db.getAll('fazendas'),
        db.getAll('talhoes'),
        db.getAll('safras'),
        db.getAll('plantios'),
        db.getAll('mapas'),
        db.getAll('areasCultura'),
      ]);
      return {
        versao: 1,
        fazendas: fazendas.map(completarFazenda),
        talhoes: talhoes.map(completarTalhao),
        safras: safras.map(completarSafra),
        plantios: plantios.map(completarPlantio),
        mapas,
        areasCultura,
      };
    },

    async importarBackup(b: BackupJson) {
      const db = await dbPromise;
      const tx = db.transaction(['fazendas', 'talhoes', 'safras', 'plantios', 'mapas', 'areasCultura'], 'readwrite');
      for (const f of b.fazendas) await tx.objectStore('fazendas').put(completarFazenda(f));
      for (const t of b.talhoes) await tx.objectStore('talhoes').put(completarTalhao(t));
      for (const s of b.safras) await tx.objectStore('safras').put(completarSafra(s));
      for (const p of b.plantios) await tx.objectStore('plantios').put(completarPlantio(p));
      for (const a of b.areasCultura ?? []) await tx.objectStore('areasCultura').put(a);
      for (const m of b.mapas) {
        // O backup não leva as imagens: só um mapa que já existe aqui continua apontando para os seus arquivos.
        const atual = await tx.objectStore('mapas').get(m.id);
        // Revive datas dos PICs (caso o backup tenha vindo de um arquivo JSON.parse) antes de gravar.
        await tx.objectStore('mapas').put({
          ...m,
          pics: reviverPics(m.pics),
          pngPath: atual?.pngPath ?? null,
          thumbPath: atual?.thumbPath ?? null,
        });
      }
      await tx.done;
    },
  };
}
