import type { SupabaseClient } from '@supabase/supabase-js';
import { extensaoImagem, tipoImagem } from '../lib/historico';
import { montarPlantioPims } from '../lib/plantioPims';
import type { FazendaCoa, MapaSalvo } from '../lib/types';
import type { BackupJson, Repositorio } from './repo';
import {
  areaCulturaParaRow,
  BUCKET,
  fazendaParaRow,
  mapaParaRow,
  plantioParaRow,
  reviverPics,
  rowParaAreaCultura,
  rowParaFazenda,
  rowParaLinhaPlantioPims,
  rowParaMapa,
  rowParaPlantio,
  rowParaSafra,
  rowParaTalhao,
  safraParaRow,
  TABELAS,
  talhaoParaRow,
  type AreaCulturaRow,
  type FazendaRow,
  type MapaRow,
  type PlantioPimsRow,
  type PlantioRow,
  type SafraRow,
  type TalhaoRow,
} from './supabaseLinhas';

export { reviverPics, serializarPics } from './supabaseLinhas';

/**
 * Repositório Supabase (Supabase do COA WEB): tabelas mapas_* em snake_case (nomes em TABELAS);
 * geom/atributos/colunas/config/pics/resumo em colunas jsonb; imagens no bucket privado "mapas-chuva".
 * Do COA WEB, só lê fazendas (id, nome) e o perfil do usuário (perfis). O RLS filtra o que cada
 * usuário vê. A conversão camelCase (domínio) <-> snake_case (linhas do banco) fica em supabaseLinhas.ts.
 */
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
      client.from(TABELAS.plantios).select('*', { count: 'exact' }).eq('safra_id', safraId).order('talhao_id').range(de, ate),
    );

  const lerAreas = (contexto: string, safraId: string, fazendaId: string, colunas: string) =>
    lerTodas<AreaCulturaRow>(contexto, (de, ate) =>
      client
        .from(TABELAS.areasCultura)
        .select(colunas, { count: 'exact' })
        .eq('safra_id', safraId)
        .eq('fazenda_id', fazendaId)
        .order('id')
        .range(de, ate),
    );

  /**
   * Arquivos que o mapa já tem no banco. Leitura só para a limpeza (melhor esforço): falha → [] com um
   * aviso no console (o arquivo antigo, se houver, fica no storage).
   */
  async function arquivosAtuais(mapaId: string): Promise<string[]> {
    try {
      const { data, error } = await client.from(TABELAS.mapas).select('png_path, thumb_path').eq('id', mapaId).maybeSingle();
      if (error) falha('Não foi possível ler os arquivos do mapa', error);
      if (!data) return [];
      const r = data as Pick<MapaRow, 'png_path' | 'thumb_path'>;
      return [r.png_path, r.thumb_path].filter((p): p is string => Boolean(p));
    } catch (e) {
      console.warn('Não foi possível ler os arquivos antigos do mapa (não serão removidos do storage)', e);
      return [];
    }
  }

  /** Linhas de `tabela` com os ids informados (colunas `id` + `colunas`), em blocos de BLOCO_IDS ids. */
  async function lerPorIds<T extends { id: string }>(contexto: string, tabela: string, colunas: string, ids: string[]): Promise<Map<string, T>> {
    const linhas = new Map<string, T>();
    for (const bloco of emBlocos(ids, BLOCO_IDS)) {
      const pagina = await lerTodas<T>(contexto, (de, ate) =>
        client.from(tabela).select(`id, ${colunas}`, { count: 'exact' }).in('id', bloco).order('id').range(de, ate),
      );
      for (const l of pagina) linhas.set(l.id, l);
    }
    return linhas;
  }

  return {
    modo: 'supabase',

    async perfil() {
      const { data: sessao, error: erroSessao } = await client.auth.getSession();
      if (erroSessao) falha('Não foi possível obter a sessão', erroSessao);
      const uid = sessao.session?.user.id;
      if (!uid) return null;
      const { data, error } = await client.from('perfis').select('perfil').eq('id', uid).maybeSingle();
      if (error) falha('Não foi possível ler o perfil do usuário', error);
      if (!data) return null;
      return (data as { perfil: unknown }).perfil === 'admin' ? 'admin' : 'colaborador';
    },

    async listarFazendasCoa() {
      const linhas = await lerTodas<{ id: number | string; nome: string | null }>('Não foi possível listar as fazendas do COA WEB', (de, ate) =>
        client.from('fazendas').select('id, nome', { count: 'exact' }).order('nome').order('id').range(de, ate),
      );
      return linhas.map((f): FazendaCoa => ({ id: Number(f.id), nome: f.nome ?? '' }));
    },

    async lerPlantioPims() {
      const linhas = await lerTodas<PlantioPimsRow>('Não foi possível ler o plantio do PIMS', (de, ate) =>
        client.from(TABELAS.plantioPims).select('*', { count: 'exact' }).order('safra').order('unidade').range(de, ate),
      );
      return montarPlantioPims(linhas.map(rowParaLinhaPlantioPims));
    },

    async listarFazendas() {
      const linhas = await lerTodas<FazendaRow>('Não foi possível listar as fazendas', (de, ate) =>
        client.from(TABELAS.fazendas).select('*', { count: 'exact' }).order('id').range(de, ate),
      );
      // Ordena no cliente (paridade com o localRepo, que também ordena por nome em pt-BR).
      return linhas.map(rowParaFazenda).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },

    async obterTalhoes(fazendaId) {
      const linhas = await lerTodas<TalhaoRow>('Não foi possível obter os talhões', (de, ate) =>
        client.from(TABELAS.talhoes).select('*', { count: 'exact' }).eq('fazenda_id', fazendaId).order('id').range(de, ate),
      );
      return linhas.map(rowParaTalhao);
    },

    async salvarFazenda(f, talhoes) {
      const { error: erroFazenda } = await client.from(TABELAS.fazendas).upsert(fazendaParaRow(f));
      if (erroFazenda) falha('Não foi possível salvar a fazenda', erroFazenda);
      const { error: erroExclusao } = await client.from(TABELAS.talhoes).delete().eq('fazenda_id', f.id);
      if (erroExclusao) falha('Não foi possível substituir os talhões', erroExclusao);
      await gravar('Não foi possível salvar os talhões', TABELAS.talhoes, talhoes.map(talhaoParaRow));
    },

    async atualizarFazenda(f, talhoes) {
      const { error: erroFazenda } = await client.from(TABELAS.fazendas).upsert(fazendaParaRow(f));
      if (erroFazenda) falha('Não foi possível atualizar a fazenda', erroFazenda);
      for (const t of talhoes) {
        const { error } = await client.from(TABELAS.talhoes).update({ nome: t.nome, setor: t.setor }).eq('id', t.id);
        if (error) falha('Não foi possível atualizar os talhões', error);
      }
    },

    async upsertTalhoes(fazendaId, talhoes) {
      await gravar('Não foi possível gravar os talhões', TABELAS.talhoes, talhoes.map((t) => talhaoParaRow({ ...t, fazendaId })));
    },

    async excluirFazenda(id) {
      // Postgres cascateia talhões, plantios (via talhões), áreas e mapas (FK on delete cascade), mas não
      // remove os arquivos do storage: buscamos os paths antes de excluir a linha da fazenda.
      const mapas = await lerTodas<Pick<MapaRow, 'png_path' | 'thumb_path'>>('Não foi possível listar os mapas da fazenda', (de, ate) =>
        client.from(TABELAS.mapas).select('id, png_path, thumb_path', { count: 'exact' }).eq('fazenda_id', id).order('id').range(de, ate),
      );
      await excluirArquivos(mapas.flatMap((m) => [m.png_path, m.thumb_path]));
      const { error } = await client.from(TABELAS.fazendas).delete().eq('id', id);
      if (error) falha('Não foi possível excluir a fazenda', error);
    },

    async listarSafras() {
      const linhas = await lerTodas<SafraRow>('Não foi possível listar as safras', (de, ate) =>
        client.from(TABELAS.safras).select('*', { count: 'exact' }).order('id').range(de, ate),
      );
      return linhas.map(rowParaSafra);
    },

    async salvarSafra(s) {
      const { error } = await client.from(TABELAS.safras).upsert(safraParaRow(s));
      if (error) falha('Não foi possível salvar a safra', error);
    },

    async excluirSafra(id) {
      // Postgres cuida da cascata: plantios e áreas (on delete cascade) e mapas_chuva.safra_id (on delete set null).
      const { error } = await client.from(TABELAS.safras).delete().eq('id', id);
      if (error) falha('Não foi possível excluir a safra', error);
    },

    async listarPlantios(safraId) {
      return (await lerPlantiosDaSafra('Não foi possível listar os plantios', safraId)).map(rowParaPlantio);
    },

    async salvarPlantios(safraId, fazendaId, plantios) {
      const talhoes = await lerTodas<{ id: string }>('Não foi possível obter os talhões da fazenda', (de, ate) =>
        client.from(TABELAS.talhoes).select('id', { count: 'exact' }).eq('fazenda_id', fazendaId).order('id').range(de, ate),
      );
      const daFazenda = new Set(talhoes.map((t) => t.id));
      // 1º grava os novos; 2º apaga só os que saíram. Uma falha no meio deixa um superconjunto do
      // plantio (nunca a fazenda sem plantio nenhum).
      await gravar('Não foi possível salvar os plantios', TABELAS.plantios, plantios.map((p) => plantioParaRow({ ...p, safraId })));
      const ficam = new Set(plantios.map((p) => p.talhaoId));
      const existentes = await lerPlantiosDaSafra('Não foi possível ler os plantios salvos', safraId);
      const saem = existentes.map((p) => p.talhao_id).filter((id) => daFazenda.has(id) && !ficam.has(id));
      for (const bloco of emBlocos(saem, BLOCO_IDS)) {
        const { error } = await client.from(TABELAS.plantios).delete().eq('safra_id', safraId).in('talhao_id', bloco);
        if (error) falha('Não foi possível remover os plantios desmarcados', error);
      }
    },

    async listarAreasCultura(safraId, fazendaId) {
      return (await lerAreas('Não foi possível listar as áreas da cultura', safraId, fazendaId, '*')).map(rowParaAreaCultura);
    },

    async salvarAreasCultura(safraId, fazendaId, areas) {
      // Mesmo cuidado do salvarPlantios: grava as novas antes de apagar as que saíram.
      const linhas = areas.map((a) => areaCulturaParaRow({ ...a, safraId, fazendaId }));
      await gravar('Não foi possível salvar as áreas da cultura', TABELAS.areasCultura, linhas);
      const ficam = new Set(linhas.map((l) => l.id));
      const existentes = await lerAreas('Não foi possível ler as áreas da cultura salvas', safraId, fazendaId, 'id');
      const saem = existentes.map((a) => a.id).filter((id) => !ficam.has(id));
      for (const bloco of emBlocos(saem, BLOCO_IDS)) {
        const { error } = await client.from(TABELAS.areasCultura).delete().in('id', bloco);
        if (error) falha('Não foi possível remover as áreas da cultura antigas', error);
      }
    },

    async listarMapas() {
      const linhas = await lerTodas<MapaRow>('Não foi possível listar os mapas', (de, ate) =>
        client
          .from(TABELAS.mapas)
          .select('*', { count: 'exact' })
          .order('criado_em', { ascending: false })
          .order('id')
          .range(de, ate),
      );
      return linhas.map(rowParaMapa);
    },

    async obterMapa(id) {
      const { data, error } = await client.from(TABELAS.mapas).select('*').eq('id', id).maybeSingle();
      if (error) falha('Não foi possível ler o mapa', error);
      return data ? rowParaMapa(data as MapaRow) : null;
    },

    async salvarMapa(m, imagem, thumb) {
      // "<id>.jpg" (extensão pelo tipo do blob) e "<id>-thumb.png": o banco exige que comecem pelo id do mapa.
      const pngPath = `${m.id}.${extensaoImagem(imagem.type)}`;
      const thumbPath = `${m.id}-thumb.${extensaoImagem(thumb.type)}`;
      const [anteriores, envioImagem, envioThumb] = await Promise.all([
        arquivosAtuais(m.id),
        client.storage.from(BUCKET).upload(pngPath, imagem, { upsert: true, contentType: tipoImagem(imagem.type) }),
        client.storage.from(BUCKET).upload(thumbPath, thumb, { upsert: true, contentType: tipoImagem(thumb.type) }),
      ]);
      if (envioImagem.error) falha('Não foi possível enviar a imagem do mapa', envioImagem.error);
      if (envioThumb.error) falha('Não foi possível enviar a miniatura do mapa', envioThumb.error);
      const salvo: MapaSalvo = { ...m, pngPath, thumbPath };
      const { error } = await client.from(TABELAS.mapas).upsert(mapaParaRow(salvo));
      if (error) falha('Não foi possível salvar o mapa', error);
      // Arquivo que o mapa deixou de usar (ex.: "<id>.png" de antes do JPEG): remoção de melhor esforço.
      const sobras = anteriores.filter((p) => p !== pngPath && p !== thumbPath);
      if (sobras.length) {
        await excluirArquivos(sobras).catch((e: unknown) => console.warn('Arquivo antigo do mapa não foi removido do storage', e));
      }
      return salvo;
    },

    async urlArquivo(path) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) falha('Não foi possível gerar a URL do arquivo', error);
      return data.signedUrl;
    },

    async excluirMapa(m) {
      await excluirArquivos([m.pngPath, m.thumbPath]);
      const { error } = await client.from(TABELAS.mapas).delete().eq('id', m.id);
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
        tudo<FazendaRow>(TABELAS.fazendas, ['id']),
        tudo<TalhaoRow>(TABELAS.talhoes, ['id']),
        tudo<SafraRow>(TABELAS.safras, ['id']),
        tudo<PlantioRow>(TABELAS.plantios, ['safra_id', 'talhao_id']),
        tudo<MapaRow>(TABELAS.mapas, ['id']),
        tudo<AreaCulturaRow>(TABELAS.areasCultura, ['id']),
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
      // Fazenda do backup sem vínculo com o COA WEB não apaga o vínculo que ela já tem aqui (como o seed).
      const semVinculo = b.fazendas.filter((f) => f.coaFazendaId == null).map((f) => f.id);
      const vinculos = await lerPorIds<Pick<FazendaRow, 'id' | 'coa_fazenda_id'>>(
        'Não foi possível importar as fazendas',
        TABELAS.fazendas,
        'coa_fazenda_id',
        semVinculo,
      );
      const fazendas = b.fazendas.map((f) => fazendaParaRow({ ...f, coaFazendaId: f.coaFazendaId ?? vinculos.get(f.id)?.coa_fazenda_id ?? null }));
      await gravar('Não foi possível importar as fazendas', TABELAS.fazendas, fazendas);
      await gravar('Não foi possível importar os talhões', TABELAS.talhoes, b.talhoes.map(talhaoParaRow));
      await gravar('Não foi possível importar as safras', TABELAS.safras, b.safras.map(safraParaRow));
      await gravar('Não foi possível importar os plantios', TABELAS.plantios, b.plantios.map(plantioParaRow));
      await gravar('Não foi possível importar as áreas da cultura', TABELAS.areasCultura, (b.areasCultura ?? []).map(areaCulturaParaRow));
      if (!b.mapas.length) return;
      // O backup não leva as imagens: só os mapas que já existem aqui continuam apontando para os seus arquivos.
      const arquivos = await lerPorIds<Pick<MapaRow, 'id' | 'png_path' | 'thumb_path'>>(
        'Não foi possível importar os mapas',
        TABELAS.mapas,
        'png_path, thumb_path',
        b.mapas.map((m) => m.id),
      );
      // Revive datas dos PICs (caso o backup tenha passado por JSON.stringify/parse) antes de gravar.
      const normalizados = b.mapas.map((m) => ({
        ...m,
        pics: reviverPics(m.pics),
        pngPath: arquivos.get(m.id)?.png_path ?? null,
        thumbPath: arquivos.get(m.id)?.thumb_path ?? null,
      }));
      await gravar('Não foi possível importar os mapas', TABELAS.mapas, normalizados.map(mapaParaRow));
    },
  };
}
