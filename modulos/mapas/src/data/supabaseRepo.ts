import type { SupabaseClient } from '@supabase/supabase-js';
import type { MapaSalvo } from '../lib/types';
import type { BackupJson, Repositorio } from './repo';
import {
  areaCulturaParaRow,
  fazendaParaRow,
  mapaParaRow,
  plantioParaRow,
  reviverPics,
  rowParaAreaCultura,
  rowParaFazenda,
  rowParaMapa,
  rowParaPlantio,
  rowParaSafra,
  rowParaTalhao,
  safraParaRow,
  talhaoParaRow,
  type AreaCulturaRow,
  type FazendaRow,
  type MapaRow,
  type PlantioRow,
  type SafraRow,
  type TalhaoRow,
} from './supabaseLinhas';

export { reviverPics, serializarPics } from './supabaseLinhas';

/**
 * Repositório Supabase: tabelas em snake_case (fazendas, talhoes, safras, plantios, mapas, areas_cultura);
 * geom/atributos/colunas/config/pics/resumo em colunas jsonb; storage no bucket privado "mapas".
 * A conversão camelCase (domínio) <-> snake_case (linhas do banco) fica em supabaseLinhas.ts.
 */

const BUCKET = 'mapas';
/** Linhas pedidas por resposta. O Supabase devolve no máximo "max rows" (1000 por padrão) sem avisar. */
const PAGINA = 1000;
/** Ids por lista .in(...) ou por remoção no storage (as listas vão na URL/corpo da requisição). */
const BLOCO_IDS = 200;
/** Linhas por upsert (talhões levam a geometria: limita o tamanho de cada requisição). */
const BLOCO_LINHAS = 100;

/** Formato mínimo comum a PostgrestError e StorageError (só usamos .message). */
interface ErroComMensagem {
  message: string;
}

function falha(contexto: string, error: ErroComMensagem): never {
  throw new Error(`${contexto}: ${error.message}`);
}

type RespostaPagina = PromiseLike<{ data: unknown[] | null; error: ErroComMensagem | null; count?: number | null }>;

/**
 * Lê TODAS as linhas de uma consulta, página a página (.range). Sem isso, o que passa do limite de
 * linhas do servidor some em silêncio. A consulta precisa de uma ordem estável (.order por chave
 * única) e de count: 'exact', para continuar mesmo se o servidor limitar a menos de PAGINA linhas.
 */
async function lerTodas<T>(contexto: string, consulta: (de: number, ate: number) => RespostaPagina): Promise<T[]> {
  const linhas: T[] = [];
  for (;;) {
    const de = linhas.length;
    const { data, error, count } = await consulta(de, de + PAGINA - 1);
    if (error) falha(contexto, error);
    const pagina = (data ?? []) as T[];
    for (const l of pagina) linhas.push(l);
    if (pagina.length === 0) break;
    if (typeof count === 'number' ? linhas.length >= count : pagina.length < PAGINA) break;
  }
  return linhas;
}

function emBlocos<T>(lista: T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) blocos.push(lista.slice(i, i + tamanho));
  return blocos;
}

export function criarSupabaseRepo(client: SupabaseClient): Repositorio {
  async function excluirArquivos(paths: (string | null)[]): Promise<void> {
    const validos = paths.filter((p): p is string => Boolean(p));
    for (const bloco of emBlocos(validos, BLOCO_IDS)) {
      const { error } = await client.storage.from(BUCKET).remove(bloco);
      if (error) falha('Não foi possível remover arquivos do storage', error);
    }
  }

  /** Upsert em blocos de BLOCO_LINHAS linhas. */
  async function gravar(contexto: string, tabela: string, linhas: object[]): Promise<void> {
    for (const bloco of emBlocos(linhas, BLOCO_LINHAS)) {
      const { error } = await client.from(tabela).upsert(bloco);
      if (error) falha(contexto, error);
    }
  }

  const lerPlantiosDaSafra = (contexto: string, safraId: string) =>
    lerTodas<PlantioRow>(contexto, (de, ate) =>
      client.from('plantios').select('*', { count: 'exact' }).eq('safra_id', safraId).order('talhao_id').range(de, ate),
    );

  const lerAreas = (contexto: string, safraId: string, fazendaId: string, colunas: string) =>
    lerTodas<AreaCulturaRow>(contexto, (de, ate) =>
      client
        .from('areas_cultura')
        .select(colunas, { count: 'exact' })
        .eq('safra_id', safraId)
        .eq('fazenda_id', fazendaId)
        .order('id')
        .range(de, ate),
    );

  return {
    modo: 'supabase',

    async listarFazendas() {
      const linhas = await lerTodas<FazendaRow>('Não foi possível listar as fazendas', (de, ate) =>
        client.from('fazendas').select('*', { count: 'exact' }).order('id').range(de, ate),
      );
      // Ordena no cliente (paridade com o localRepo, que também ordena por nome em pt-BR).
      return linhas.map(rowParaFazenda).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },

    async obterTalhoes(fazendaId) {
      const linhas = await lerTodas<TalhaoRow>('Não foi possível obter os talhões', (de, ate) =>
        client.from('talhoes').select('*', { count: 'exact' }).eq('fazenda_id', fazendaId).order('id').range(de, ate),
      );
      return linhas.map(rowParaTalhao);
    },

    async salvarFazenda(f, talhoes) {
      const { error: erroFazenda } = await client.from('fazendas').upsert(fazendaParaRow(f));
      if (erroFazenda) falha('Não foi possível salvar a fazenda', erroFazenda);
      const { error: erroExclusao } = await client.from('talhoes').delete().eq('fazenda_id', f.id);
      if (erroExclusao) falha('Não foi possível substituir os talhões', erroExclusao);
      await gravar('Não foi possível salvar os talhões', 'talhoes', talhoes.map(talhaoParaRow));
    },

    async atualizarFazenda(f, talhoes) {
      const { error: erroFazenda } = await client.from('fazendas').upsert(fazendaParaRow(f));
      if (erroFazenda) falha('Não foi possível atualizar a fazenda', erroFazenda);
      for (const t of talhoes) {
        const { error } = await client.from('talhoes').update({ nome: t.nome, setor: t.setor }).eq('id', t.id);
        if (error) falha('Não foi possível atualizar os talhões', error);
      }
    },

    async upsertTalhoes(fazendaId, talhoes) {
      await gravar('Não foi possível gravar os talhões', 'talhoes', talhoes.map((t) => talhaoParaRow({ ...t, fazendaId })));
    },

    async excluirFazenda(id) {
      // Postgres cascateia talhões, plantios (via talhões) e mapas (FK on delete cascade), mas não
      // remove os arquivos do storage: buscamos os paths antes de excluir a linha da fazenda.
      const mapas = await lerTodas<Pick<MapaRow, 'png_path' | 'thumb_path'>>('Não foi possível listar os mapas da fazenda', (de, ate) =>
        client.from('mapas').select('id, png_path, thumb_path', { count: 'exact' }).eq('fazenda_id', id).order('id').range(de, ate),
      );
      await excluirArquivos(mapas.flatMap((m) => [m.png_path, m.thumb_path]));
      const { error } = await client.from('fazendas').delete().eq('id', id);
      if (error) falha('Não foi possível excluir a fazenda', error);
    },

    async listarSafras() {
      const linhas = await lerTodas<SafraRow>('Não foi possível listar as safras', (de, ate) =>
        client.from('safras').select('*', { count: 'exact' }).order('id').range(de, ate),
      );
      return linhas.map(rowParaSafra);
    },

    async salvarSafra(s) {
      const { error } = await client.from('safras').upsert(safraParaRow(s));
      if (error) falha('Não foi possível salvar a safra', error);
    },

    async excluirSafra(id) {
      // Postgres cuida da cascata: plantios (on delete cascade) e mapas.safra_id (on delete set null).
      const { error } = await client.from('safras').delete().eq('id', id);
      if (error) falha('Não foi possível excluir a safra', error);
    },

    async listarPlantios(safraId) {
      return (await lerPlantiosDaSafra('Não foi possível listar os plantios', safraId)).map(rowParaPlantio);
    },

    async salvarPlantios(safraId, fazendaId, plantios) {
      const talhoes = await lerTodas<{ id: string }>('Não foi possível obter os talhões da fazenda', (de, ate) =>
        client.from('talhoes').select('id', { count: 'exact' }).eq('fazenda_id', fazendaId).order('id').range(de, ate),
      );
      const daFazenda = new Set(talhoes.map((t) => t.id));
      // 1º grava os novos; 2º apaga só os que saíram. Uma falha no meio deixa um superconjunto do
      // plantio (nunca a fazenda sem plantio nenhum).
      await gravar('Não foi possível salvar os plantios', 'plantios', plantios.map((p) => plantioParaRow({ ...p, safraId })));
      const ficam = new Set(plantios.map((p) => p.talhaoId));
      const existentes = await lerPlantiosDaSafra('Não foi possível ler os plantios salvos', safraId);
      const saem = existentes.map((p) => p.talhao_id).filter((id) => daFazenda.has(id) && !ficam.has(id));
      for (const bloco of emBlocos(saem, BLOCO_IDS)) {
        const { error } = await client.from('plantios').delete().eq('safra_id', safraId).in('talhao_id', bloco);
        if (error) falha('Não foi possível remover os plantios desmarcados', error);
      }
    },

    async listarAreasCultura(safraId, fazendaId) {
      return (await lerAreas('Não foi possível listar as áreas da cultura', safraId, fazendaId, '*')).map(rowParaAreaCultura);
    },

    async salvarAreasCultura(safraId, fazendaId, areas) {
      // Mesmo cuidado do salvarPlantios: grava as novas antes de apagar as que saíram.
      const linhas = areas.map((a) => areaCulturaParaRow({ ...a, safraId, fazendaId }));
      await gravar('Não foi possível salvar as áreas da cultura', 'areas_cultura', linhas);
      const ficam = new Set(linhas.map((l) => l.id));
      const existentes = await lerAreas('Não foi possível ler as áreas da cultura salvas', safraId, fazendaId, 'id');
      const saem = existentes.map((a) => a.id).filter((id) => !ficam.has(id));
      for (const bloco of emBlocos(saem, BLOCO_IDS)) {
        const { error } = await client.from('areas_cultura').delete().in('id', bloco);
        if (error) falha('Não foi possível remover as áreas da cultura antigas', error);
      }
    },

    async listarMapas() {
      const linhas = await lerTodas<MapaRow>('Não foi possível listar os mapas', (de, ate) =>
        client
          .from('mapas')
          .select('*', { count: 'exact' })
          .order('criado_em', { ascending: false })
          .order('id')
          .range(de, ate),
      );
      return linhas.map(rowParaMapa);
    },

    async obterMapa(id) {
      const { data, error } = await client.from('mapas').select('*').eq('id', id).maybeSingle();
      if (error) falha('Não foi possível ler o mapa', error);
      return data ? rowParaMapa(data as MapaRow) : null;
    },

    async salvarMapa(m, png, thumb) {
      const pngPath = `${m.id}.png`;
      const thumbPath = `${m.id}-thumb.png`;
      const [uploadPng, uploadThumb] = await Promise.all([
        client.storage.from(BUCKET).upload(pngPath, png, { upsert: true, contentType: 'image/png' }),
        client.storage.from(BUCKET).upload(thumbPath, thumb, { upsert: true, contentType: 'image/png' }),
      ]);
      if (uploadPng.error) falha('Não foi possível enviar o PNG do mapa', uploadPng.error);
      if (uploadThumb.error) falha('Não foi possível enviar a miniatura do mapa', uploadThumb.error);
      const salvo: MapaSalvo = { ...m, pngPath, thumbPath };
      const { error } = await client.from('mapas').upsert(mapaParaRow(salvo));
      if (error) falha('Não foi possível salvar o mapa', error);
      return salvo;
    },

    async urlArquivo(path) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) falha('Não foi possível gerar a URL do arquivo', error);
      return data.signedUrl;
    },

    async excluirMapa(m) {
      await excluirArquivos([m.pngPath, m.thumbPath]);
      const { error } = await client.from('mapas').delete().eq('id', m.id);
      if (error) falha('Não foi possível excluir o mapa', error);
    },

    async exportarBackup() {
      const tudo = <T>(tabela: string, ordem: string[]) =>
        lerTodas<T>(`Não foi possível exportar a tabela ${tabela}`, (de, ate) => {
          let q = client.from(tabela).select('*', { count: 'exact' });
          for (const col of ordem) q = q.order(col);
          return q.range(de, ate);
        });
      const [fazendas, talhoes, safras, plantios, mapas, areas] = await Promise.all([
        tudo<FazendaRow>('fazendas', ['id']),
        tudo<TalhaoRow>('talhoes', ['id']),
        tudo<SafraRow>('safras', ['id']),
        tudo<PlantioRow>('plantios', ['safra_id', 'talhao_id']),
        tudo<MapaRow>('mapas', ['id']),
        tudo<AreaCulturaRow>('areas_cultura', ['id']),
      ]);
      return {
        versao: 1,
        fazendas: fazendas.map(rowParaFazenda),
        talhoes: talhoes.map(rowParaTalhao),
        safras: safras.map(rowParaSafra),
        plantios: plantios.map(rowParaPlantio),
        mapas: mapas.map(rowParaMapa),
        areasCultura: areas.map(rowParaAreaCultura),
      };
    },

    async importarBackup(b: BackupJson) {
      // Os mapeadores completam registros de backups antigos (campos novos = null; plantio = manual/plantado).
      await gravar('Não foi possível importar as fazendas', 'fazendas', b.fazendas.map(fazendaParaRow));
      await gravar('Não foi possível importar os talhões', 'talhoes', b.talhoes.map(talhaoParaRow));
      await gravar('Não foi possível importar as safras', 'safras', b.safras.map(safraParaRow));
      await gravar('Não foi possível importar os plantios', 'plantios', b.plantios.map(plantioParaRow));
      await gravar('Não foi possível importar as áreas da cultura', 'areas_cultura', (b.areasCultura ?? []).map(areaCulturaParaRow));
      if (!b.mapas.length) return;
      // O backup não leva os PNGs: só os mapas que já existem aqui continuam apontando para os seus arquivos.
      const arquivos = new Map<string, Pick<MapaRow, 'png_path' | 'thumb_path'>>();
      for (const bloco of emBlocos(b.mapas.map((m) => m.id), BLOCO_IDS)) {
        const linhas = await lerTodas<Pick<MapaRow, 'id' | 'png_path' | 'thumb_path'>>('Não foi possível importar os mapas', (de, ate) =>
          client.from('mapas').select('id, png_path, thumb_path', { count: 'exact' }).in('id', bloco).order('id').range(de, ate),
        );
        for (const l of linhas) arquivos.set(l.id, l);
      }
      // Revive datas dos PICs (caso o backup tenha passado por JSON.stringify/parse) antes de gravar.
      const normalizados = b.mapas.map((m) => ({
        ...m,
        pics: reviverPics(m.pics),
        pngPath: arquivos.get(m.id)?.png_path ?? null,
        thumbPath: arquivos.get(m.id)?.thumb_path ?? null,
      }));
      await gravar('Não foi possível importar os mapas', 'mapas', normalizados.map(mapaParaRow));
    },
  };
}
