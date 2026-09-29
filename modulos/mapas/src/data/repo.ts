import type { AreaCultura, Fazenda, FazendaCoa, MapaSalvo, PerfilUsuario, Plantio, PlantioPimsArquivo, Safra, Talhao } from '../lib/types';

/** Contrato do repositório (implementado por localRepo.ts e supabaseRepo.ts). */

/**
 * Formato do backup exportável/importável (JSON puro, sem as imagens). Backups antigos não têm
 * `areasCultura` nem os campos novos (unidadePims, codigo, nomePims, coaFazendaId, origem/status...):
 * ao importar, eles são completados com null / { origem: 'manual', status: 'plantado' }.
 */
export interface BackupJson {
  versao: 1;
  fazendas: Fazenda[];
  talhoes: Talhao[];
  safras: Safra[];
  plantios: Plantio[];
  mapas: MapaSalvo[];
  /** ausente em backups anteriores ao plantio do PIMS; exportarBackup sempre preenche */
  areasCultura?: AreaCultura[];
}

export interface Repositorio {
  modo: 'local' | 'supabase';

  /**
   * Perfil do usuário logado no COA WEB. Local: 'admin'. Supabase: perfis.perfil do usuário da
   * sessão; sem sessão ou sem linha em perfis → null; valor desconhecido → 'colaborador'.
   */
  perfil(): Promise<PerfilUsuario | null>;
  /** Fazendas do COA WEB visíveis ao usuário (id e nome), por nome. Local: []. */
  listarFazendasCoa(): Promise<FazendaCoa[]>;
  /**
   * Plantio do PIMS. Local: public/dados/plantio.json (sem arquivo, sem rede ou inválido → null).
   * Supabase: as linhas visíveis de mapas_plantio_pims montadas no mesmo formato (sem linhas → null).
   */
  lerPlantioPims(): Promise<PlantioPimsArquivo | null>;

  listarFazendas(): Promise<Fazenda[]>;
  obterTalhoes(fazendaId: string): Promise<Talhao[]>;
  /** Upsert da fazenda; substitui todos os talhões dela pela lista informada. */
  salvarFazenda(f: Fazenda, talhoes: Talhao[]): Promise<void>;
  /** Atualiza nome/campos da fazenda e nome/setor dos talhões (mesmos ids, geometria preservada). */
  atualizarFazenda(f: Fazenda, talhoes: Talhao[]): Promise<void>;
  /**
   * Grava os talhões inteiros (geometria, código, atributos...) da fazenda pelo id: insere os novos e
   * substitui os existentes, SEM apagar os demais talhões da fazenda nem os plantios (usado pelo
   * cadastro padrão, para reimportar sem perder o plantio marcado). fazendaId é forçado nos talhões.
   */
  upsertTalhoes(fazendaId: string, talhoes: Talhao[]): Promise<void>;
  /** Em cascata: talhões, plantios dos talhões, áreas da cultura e mapas da fazenda (inclui arquivos do storage). */
  excluirFazenda(id: string): Promise<void>;

  listarSafras(): Promise<Safra[]>;
  salvarSafra(s: Safra): Promise<void>;
  /** Em cascata: plantios e áreas da cultura da safra; mapas que referenciam a safra ficam com safraId = null. */
  excluirSafra(id: string): Promise<void>;

  listarPlantios(safraId: string): Promise<Plantio[]>;
  /** Substitui os plantios desta safra nos talhões desta fazenda (não mexe em outras fazendas). */
  salvarPlantios(safraId: string, fazendaId: string, plantios: Plantio[]): Promise<void>;

  /** Áreas da cultura (ex.: shape da soja) da safra × fazenda. */
  listarAreasCultura(safraId: string, fazendaId: string): Promise<AreaCultura[]>;
  /** Substitui as áreas da cultura da safra × fazenda (safraId/fazendaId forçados nas áreas). */
  salvarAreasCultura(safraId: string, fazendaId: string, areas: AreaCultura[]): Promise<void>;

  /** Mais recente primeiro. */
  listarMapas(): Promise<MapaSalvo[]>;
  /** Um mapa do histórico pelo id; null se não existir. */
  obterMapa(id: string): Promise<MapaSalvo | null>;
  /**
   * Salva a imagem do histórico (JPEG; mapas antigos têm PNG) e a miniatura PNG — arquivos
   * "<id>.<extensão pelo tipo do blob>" e "<id>-thumb.png" —, define pngPath/thumbPath e retorna o mapa
   * salvo com os paths preenchidos. Se o mapa já existia com outro arquivo (ex.: "<id>.png"), o antigo é
   * removido depois de gravar o registro; se essa remoção falhar, o salvamento vale assim mesmo.
   */
  salvarMapa(m: MapaSalvo, imagem: Blob, thumb: Blob): Promise<MapaSalvo>;
  /** Object URL (local) ou signed URL de 1h (Supabase). */
  urlArquivo(path: string): Promise<string>;
  /** Remove o mapa e os arquivos (imagem e miniatura) associados. */
  excluirMapa(m: MapaSalvo): Promise<void>;

  exportarBackup(): Promise<BackupJson>;
  /**
   * Upsert de tudo (fazendas, talhões, safras, plantios, áreas da cultura, mapas). O backup não leva
   * as imagens: um mapa importado fica com pngPath/thumbPath = null, a não ser que já exista aqui com
   * os próprios arquivos.
   */
  importarBackup(b: BackupJson): Promise<void>;
}
