import type { PedidoChuva, SituacaoPedidoChuva } from '../lib/chuvaZeus';
import type { SituacaoZeus } from '../lib/situacaoZeus';
import type { SituacaoPedidoPlantio } from '../lib/pedidoPlantio';
import type { AcessoUsuario, AreaCultura, CorVariedade, Fazenda, FazendaCoa, MapaSalvo, Plantio, PlantioPimsArquivo, PopulacaoVariedade, RegistroCar, Safra, Talhao, TipoMapa, VariedadePims } from '../lib/types';

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
   * Perfil do usuário logado no COA WEB e se ele é administrador sem restrição de fazendas. Local:
   * 'admin' sem restrição. Supabase: a linha do usuário da sessão em perfis (perfil, super e
   * todas_fazendas); sem sessão ou sem linha em perfis → null; perfil desconhecido → 'colaborador'.
   */
  acesso(): Promise<AcessoUsuario | null>;
  /** Fazendas do COA WEB visíveis ao usuário (id e nome), por nome. Local: []. */
  listarFazendasCoa(): Promise<FazendaCoa[]>;
  /**
   * Plantio do PIMS. Local: public/dados/plantio.json (sem arquivo, sem rede ou inválido → null).
   * Supabase: as linhas visíveis de mapas_plantio_pims montadas no mesmo formato (sem linhas → null).
   */
  lerPlantioPims(): Promise<PlantioPimsArquivo | null>;
  /** Se o botão "Atualizar plantio" funciona aqui: só no Supabase (o servidor do COA WEB atende os pedidos). */
  podeAtualizarPlantio: boolean;
  /**
   * Pede ao servidor para atualizar o plantio do PIMS agora (antes da rotina de 1 h): grava um pedido em
   * mapas_plantio_pedidos e devolve o id dele. Local: lança erro (só funciona no COA WEB).
   */
  pedirAtualizacaoPlantio(): Promise<number>;
  /** Situação do pedido (atendido? resultado 'ok' ou 'erro: ...'); não encontrado → null. Local: null. */
  situacaoPedidoPlantio(id: number): Promise<SituacaoPedidoPlantio | null>;
  /** Se o botão "Inserir dados via integração" funciona aqui: só no Supabase (o servidor do COA WEB atende os pedidos). */
  podeBuscarChuva: boolean;
  /**
   * Pede ao servidor a chuva de cada PIC da fazenda no período (ZEUS): grava um pedido em
   * mapas_chuva_pedidos e devolve o id dele. Local: lança erro (só funciona no COA WEB).
   */
  pedirChuvaZeus(pedido: PedidoChuva): Promise<number>;
  /** Situação do pedido de chuva (atendido? resultado e dados); não encontrado → null. Local: null. */
  situacaoPedidoChuva(id: number): Promise<SituacaoPedidoChuva | null>;
  /**
   * Último dia com leitura de chuva de cada fazenda da ZEUS no banco (mapas_zeus_situacao, gravada pelo
   * servidor). É só um aviso na tela: sem a tabela, sem linhas ou com erro devolve [] (nunca lança). Local: [].
   */
  situacaoZeus(): Promise<SituacaoZeus[]>;

  /** Se o botão "Buscar nas bases" do Mapa de CAR e Matrícula funciona aqui: só no Supabase (o servidor busca). */
  podeBuscarCar: boolean;
  /**
   * Último resultado do Mapa de CAR e Matrícula da fazenda (mapas_car, supabase/0030; só ADMINISTRADOR+);
   * null se nunca foi buscado. Local: public/dados/car/<NOME DA FAZENDA>.json, se existir.
   */
  obterCar(fazendaId: string): Promise<RegistroCar | null>;
  /** Pede ao servidor a busca nas bases públicas para a fazenda; devolve o id do pedido. Local: lança erro. */
  pedirBuscaCar(fazendaId: string): Promise<number>;
  /** Situação do pedido de busca (atendido? 'ok' ou 'erro: ...'); não encontrado → null. Local: null. */
  situacaoPedidoCar(id: number): Promise<SituacaoPedidoPlantio | null>;

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

  /** Mais recente primeiro, só do tipo pedido ('chuva' por padrão; mapas antigos sem tipo são de chuva). */
  listarMapas(tipo?: TipoMapa): Promise<MapaSalvo[]>;
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

  /** Cadastro de cores das variedades (mapas_variedade_cores), pela variedade. */
  listarCoresVariedade(): Promise<CorVariedade[]>;
  /**
   * Grava a cor de uma variedade nova (só cria; nunca troca). Se a variedade já tem cor (gravada por outra
   * pessoa no meio tempo), devolve a que está gravada.
   */
  criarCorVariedade(variedade: string, cor: string): Promise<CorVariedade>;
  /** Troca a cor de uma variedade (administrador; no Supabase, a regra de acesso barra os demais). */
  trocarCorVariedade(variedade: string, cor: string): Promise<void>;
  /** Apaga a variedade do cadastro (administrador); se ela aparecer de novo num mapa, ganha cor automática. */
  excluirCorVariedade(variedade: string): Promise<void>;

  /**
   * Cadastro de variedades do PIMS com o nome comercial (mapas_variedades, gravada pela rotina da VM; local:
   * public/dados/variedades.json com os nomes guardados no navegador). Pela chave.
   */
  listarVariedadesPims(): Promise<VariedadePims[]>;
  /** Grava (ou apaga, com null ou vazio) o nome comercial de uma variedade (administrador). */
  salvarNomeComercial(chave: string, nome: string | null): Promise<void>;

  /**
   * Sementes por metro e população das variedades de uma fazenda numa safra (acomp_variedade_populacao,
   * supabase/0028 e 0029; local: no navegador). `unidade` e `safra` como o PIMS (chavesPimsDoMapa).
   */
  listarPopulacao(unidade: string, safra: string): Promise<PopulacaoVariedade[]>;
  /** Grava as linhas com algum valor e apaga as sem nenhum (quem enxerga a fazenda). */
  salvarPopulacao(unidade: string, safra: string, linhas: PopulacaoVariedade[]): Promise<void>;

  exportarBackup(): Promise<BackupJson>;
  /**
   * Upsert de tudo (fazendas, talhões, safras, plantios, áreas da cultura, mapas). O backup não leva
   * as imagens: um mapa importado fica com pngPath/thumbPath = null, a não ser que já exista aqui com
   * os próprios arquivos.
   */
  importarBackup(b: BackupJson): Promise<void>;
}
