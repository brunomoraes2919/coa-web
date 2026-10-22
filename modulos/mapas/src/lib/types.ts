import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

/** Contratos compartilhados por todo o app. Não redefina estes tipos em outros arquivos. */

export type Geometry = Polygon | MultiPolygon;

export interface Pic {
  id: string;
  nome: string;
  lat: number;
  lon: number;
  /** mm no período; null = célula vazia no CSV */
  chuva: number | null;
  /** coluna "Pic Inativa" = "Sim" */
  inativo: boolean;
  inicio: Date | null;
  fim: Date | null;
  /** padrão: !inativo && chuva !== null */
  incluir: boolean;
  /** chuva que veio do CSV, guardada quando o usuário edita o valor à mão (ausente = não editado) */
  chuvaOriginal?: number | null;
}

export interface ZeusCsvResult {
  pics: Pic[];
  periodoInicio: Date | null;
  periodoFim: Date | null;
  avisos: string[];
}

export interface Fazenda {
  id: string;
  nome: string;
  /** coluna do shape usada como nome (rótulo) do talhão */
  campoNome: string;
  campoSetor: string | null;
  /** colunas de atributos disponíveis no shape */
  colunas: string[];
  criadoEm: string;
  /** unidade (fazenda) no PIMS, ex.: 'SIRIEMA', 'GUAPIRAMA'; null = sem vínculo com o PIMS */
  unidadePims: string | null;
  /** coluna do shape com o código do talhão no PIMS (CD_UPNIVEL3) */
  campoCodigo: string | null;
  /**
   * fazenda do COA WEB (fazendas.id) que define quem vê esta fazenda de mapa; null = sem vínculo
   * (no Supabase, só o admin vê). Registros antigos (IndexedDB/backup) sem o campo são lidos como null.
   */
  coaFazendaId: number | null;
}

/** Perfil do usuário no COA WEB (tabela perfis). */
export type PerfilUsuario = 'admin' | 'colaborador';

/** O que o módulo sabe do usuário logado: sai de uma só leitura da linha dele em perfis. */
export interface AcessoUsuario {
  perfil: PerfilUsuario;
  /**
   * Administrador sem restrição de fazendas (vê todas) ou ADMINISTRADOR+: a mesma conta de admin_ve_tudo()
   * no banco. Só ele cria, altera e exclui fazendas de mapa; o administrador restrito grava talhões, áreas
   * da cultura e plantio só nas fazendas que vê. Colaborador: sempre false.
   */
  adminSemRestricao: boolean;
  /** ADMINISTRADOR+ (perfil admin com super): o único que usa o Mapa de CAR e Matrícula. Local: true. */
  super: boolean;
}

// ---------------------------------------------------------------- Mapa de CAR e Matrícula

/** Bases consultadas pelo servidor para o Mapa de CAR e Matrícula. */
export type NomeFonteCar = 'sicar' | 'temas' | 'sigef' | 'ibge' | 'osm' | 'pims';

/** Situação de uma base na última busca: respondeu? quantas feições? motivo curto da falha. */
export interface FonteCar {
  ok: boolean;
  n: number;
  erro?: string;
  /** respondeu, mas com ressalva (ex.: bateu no máximo de feições e alguma pode ter ficado de fora) */
  aviso?: string;
}

/**
 * O que o servidor gravou em mapas_car (supabase/0030) para uma fazenda: as camadas em GeoJSON (lon/lat) e os
 * talhões de eucalipto do PIMS. `car` = perímetro de cada CAR que cobre os talhões (cod_imovel, area, status…);
 * `temas` = temas declarados nesses CARs (properties.tema = nome da camada do SICAR); `matriculas` = parcelas
 * certificadas do SIGEF (matricula, parcela, status…); `estradas` e `hidrografia` = linhas e polígonos do IBGE e
 * do OpenStreetMap (properties.fonte = 'ibge' | 'osm').
 */
export interface DadosCar {
  versao: 1;
  geradoEm: string;
  bbox: number[];
  ufs: string[];
  car: FeatureCollection;
  temas: FeatureCollection;
  matriculas: FeatureCollection;
  estradas: FeatureCollection;
  hidrografia: FeatureCollection;
  eucalipto: { talhao: string; areaHa: number }[];
}

/** Uma linha de mapas_car. */
export interface RegistroCar {
  fazendaId: string;
  atualizadoEm: string;
  dados: DadosCar;
  fontes: Partial<Record<NomeFonteCar, FonteCar>>;
}

/** Fazenda do COA WEB (tabela fazendas), só leitura. */
export interface FazendaCoa {
  id: number;
  nome: string;
}

/**
 * Lê um arquivo do cadastro padrão pelo caminho relativo à pasta do seed (ex.: 'seed.json',
 * 'base/SM3.geojson') e devolve o texto; arquivo que falta → Error em português com o caminho.
 */
export type LeitorSeed = (caminho: string) => Promise<string>;

/** Resultado de carregarSeed (cadastro padrão). */
export interface ResultadoSeed {
  /** unidades do cadastro padrão gravadas */
  fazendas: number;
  talhoes: number;
  areas: number;
  /** unidades que ficaram ligadas a uma fazenda do COA WEB (ligadas agora ou que já estavam) */
  ligadas: number;
  /** nomes (como aparecem na tela) das unidades sem fazenda do COA WEB: só administradores veem */
  semVinculo: string[];
}

/** Fazenda escolhida no topo do menu do COA WEB (#sb-fazenda); id null = nenhuma/todas. */
export interface FazendaCoaSelecionada {
  id: number | null;
  nome: string | null;
}

/** COA WEB → módulo (postMessage, mesma origem): a fazenda do topo do menu mudou. */
export interface MensagemCoaFazenda extends FazendaCoaSelecionada {
  tipo: 'coa-fazenda';
}

/** Módulo → COA WEB (postMessage, mesma origem): rota aberta no módulo e o título do topo. */
export interface MensagemMapasRota {
  tipo: 'mapas-rota';
  rota: string;
  titulo: string;
}

export interface Talhao {
  id: string;
  fazendaId: string;
  nome: string;
  setor: string | null;
  areaHa: number;
  /** GeoJSON em WGS84 (lon, lat) */
  geom: Geometry;
  atributos: Record<string, unknown>;
  /** código do talhão normalizado (normalizarCodigo, src/lib/codigoTalhao.ts); null = sem código */
  codigo: string | null;
}

/** Ex.: nome "SOJA 26/27", cultura "SOJA", anoSafra "26/27"; datas ISO yyyy-mm-dd */
export interface Safra {
  id: string;
  nome: string;
  cultura: string;
  anoSafra: string;
  inicio: string;
  fim: string;
  /** nome da safra no PIMS (PERIODOSAFRA.DE_PER_SAFRA); null = usa o próprio nome */
  nomePims: string | null;
}

/** Polígono da área da cultura (ex.: shape da soja 26/27) de uma fazenda numa safra. */
export interface AreaCultura {
  id: string;
  safraId: string;
  fazendaId: string;
  /** código normalizado do talhão ('' quando o shape não tem código) */
  codigo: string;
  areaHa: number;
  /** GeoJSON em WGS84 (lon, lat) */
  geom: Geometry;
}

export type StatusPlantio = 'plantado' | 'plantando' | 'a_plantar';

/**
 * Situação do talhão na safra. Registros antigos (sem os campos novos) são lidos como
 * { origem: 'manual', status: 'plantado', areaPrevista/areaPlantada/inicio/fim/variedade: null }.
 */
export interface Plantio {
  safraId: string;
  talhaoId: string;
  dataPlantio: string | null;
  origem: 'manual' | 'pims';
  status: StatusPlantio;
  /** ha */
  areaPrevista: number | null;
  /** ha */
  areaPlantada: number | null;
  /** ISO yyyy-mm-dd */
  inicio: string | null;
  /** ISO yyyy-mm-dd */
  fim: string | null;
  variedade: string | null;
}

/** Um talhão × safra do PIMS (public/dados/plantio.json). `codigo` já normalizado. */
export interface PlantioPimsTalhao {
  codigo: string;
  codigoPims: string;
  setor: string | null;
  status: StatusPlantio;
  areaPrevista: number;
  areaPlantada: number;
  /** ISO yyyy-mm-dd */
  inicio: string | null;
  /** ISO yyyy-mm-dd */
  fim: string | null;
  variedade: string | null;
}

/** Uma linha de mapas_plantio_pims (Supabase): o plantio do PIMS de uma safra × unidade. */
export interface LinhaPlantioPims {
  /** nome da safra no PIMS, ex.: 'SOJA 26/27' */
  safra: string;
  /** unidade (fazenda) no PIMS, ex.: 'SIRIEMA' */
  unidade: string;
  /** ISO com hora */
  geradoEm: string;
  talhoes: PlantioPimsTalhao[];
}

/**
 * Plantio do PIMS no formato do public/dados/plantio.json gerado por scripts/sincronizar-plantio.mjs
 * (modo local); no Supabase, montado a partir das linhas de mapas_plantio_pims (montarPlantioPims).
 */
export interface PlantioPimsArquivo {
  versao: 1;
  /** ISO com hora */
  geradoEm: string;
  fonte: string;
  safras: { nome: string; unidades: { unidade: string; talhoes: PlantioPimsTalhao[] }[] }[];
}

export interface IdwParams {
  potencia: number;
  vizinhos: number;
  /** tamanho do pixel em metros */
  pixel: number;
  /** buffer da máscara em metros */
  buffer: number;
}

/** Mesmos valores do modelo MAPA_CHUVA_V3_ATUAL.model3 (grass7:v.surf.idw + native:buffer) */
export const IDW_PADRAO: IdwParams = { potencia: 4, vizinhos: 12, pixel: 5, buffer: 10 };

/** x0 = minX, y0 = maxY (canto superior esquerdo), em metros UTM. Linha 0 = norte. */
export interface GridSpec {
  x0: number;
  y0: number;
  res: number;
  cols: number;
  rows: number;
}

export interface Grid extends GridSpec {
  epsg: number;
  /** NaN = sem dado */
  values: Float32Array;
}

export interface Estat {
  media: number;
  min: number;
  max: number;
  areaHa: number;
}

export interface TalhaoStats extends Estat {
  talhaoId: string;
  nome: string;
  setor: string | null;
  plantado: boolean;
}

/** Chuva numa área da cultura (segunda rasterização do pipeline, zonas próprias). */
export interface AreaStats extends Estat {
  /** id da área da cultura */
  id: string;
}

export interface ResumoChuva {
  geral: Estat;
  plantado: Estat | null;
  talhoes: TalhaoStats[];
  /** por área da cultura; ausente quando o mapa não usa áreas da cultura (e em mapas antigos) */
  areas?: AreaStats[];
  /**
   * Média da chuva dos PICs interpolados (dentro da região) com chuva > 0 (par "Média dos PICs com chuva"
   * do painel); null = nenhum PIC choveu; ausente em mapas salvos antes deste campo.
   */
  mediaPicsComChuva?: number | null;
  /** só nos mapas de variedade salvos (tipo 'variedade'): o resumo das variedades; os campos de chuva ficam zerados */
  variedades?: ResumoVariedades;
}

/**
 * Um valor v (arredondado a uma casa decimal) cai na primeira classe com v < max: o limite de cima é
 * exclusivo. Acima da última classe, fica na última (ver classify em palettes.ts).
 */
export interface PaletteClass {
  max: number;
  color: string;
  label: string;
}

export interface Palette {
  id: string;
  nome: string;
  classes: PaletteClass[];
}

export type EstiloPlantado = 'quadriculado' | 'diagonal' | 'pontilhado' | 'contorno';
/** Destaque do valor de chuva escrito ao lado de cada PIC */
export type DestaquePics = 'escuro' | 'vermelho' | 'verde' | 'etiqueta';
/** 'topoCompleto' (topográfico da Esri sem o véu branco) só é oferecido no Mapa de CAR e Matrícula. */
export type MapaBase = 'topo' | 'topoCompleto' | 'satelite' | 'nenhum';

/** Tipo do mapa salvo: 'chuva' (padrão; mapas antigos não têm o campo) ou 'variedade'. */
export type TipoMapa = 'chuva' | 'variedade';

/** Uma variedade no mapa de variedade (legenda, tabela e mapa salvo). */
export interface ItemVariedade {
  /** chave da cor (nome limpo em maiúsculas); '' = "Sem variedade" */
  chave: string;
  /** nome mostrado (limpo): "Nome comercial (nome do PIMS)", ou só o do PIMS */
  nome: string;
  /** nome do PIMS (limpo) ou "Sem variedade"; ausente nos resumos gravados antes do nome comercial */
  nomePims?: string;
  /** nome comercial do cadastro de Variedades; '' = sem nome comercial */
  comercial?: string;
  /** sementes por metro linear (cadastro "Sementes e população" do mapa de variedade); null/ausente = sem */
  sementesMetro?: number | null;
  /** população em plantas por hectare (mesmo cadastro); null/ausente = sem */
  populacao?: number | null;
  cor: string;
  areaHa: number;
  /** % da área total pintada */
  pct: number;
  /** nº de feições (talhões ou áreas da cultura) */
  talhoes: number;
}

/** Resumo do mapa de variedade: da maior área para a menor, com "Sem variedade" por último. */
export interface ResumoVariedades {
  totalHa: number;
  itens: ItemVariedade[];
}

/**
 * Sementes por metro e população de uma variedade numa fazenda e safra (acomp_variedade_populacao, supabase/0028).
 * `variedade` = chave da variedade (nome do PIMS limpo e em maiúsculas).
 */
export interface PopulacaoVariedade {
  variedade: string;
  sementesMetro: number | null;
  populacao: number | null;
}

/** Um código do cadastro VARIEDADE do PIMS dentro de uma variedade (códigos com o mesmo nome limpo ficam juntos). */
export interface CodigoVariedadePims {
  codigo: number | null;
  abreviada: string | null;
  descricao: string | null;
  grupo: string | null;
  ativo: boolean;
  talhoes: number;
}

/** Variedade do cadastro do PIMS com o nome comercial (mapas_variedades; gravada pela rotina da VM). */
export interface VariedadePims {
  /** chave (nome limpo em maiúsculas): a mesma do cadastro de cores e dos mapas */
  chave: string;
  /** nome limpo do PIMS ('80I82 IPRO') */
  nomePims: string;
  /** grupo de maturação do PIMS */
  grupo: string | null;
  /** algum talhão das safras atuais usa a variedade */
  emUso: boolean;
  talhoes: number;
  ativo: boolean;
  codigos: CodigoVariedadePims[];
  /** primeira vez que a rotina viu a variedade */
  vistoEm: string;
  nomeComercial: string | null;
  comercialEm: string | null;
}

/** Linha do cadastro de cores (mapas_variedade_cores): a cor fixa de uma variedade. */
export interface CorVariedade {
  /** chave (nome limpo em maiúsculas) */
  variedade: string;
  cor: string;
  criadoEm: string;
}

export interface LayoutTextos {
  titulo: string;
  fazenda: string;
  safra: string;
  periodo: string;
  fonte: string;
  talhoes: string;
  setor: string;
  observacao: string;
  data: string;
}

/** Centro em Web Mercator (m) e metros Mercator por mm de papel (A3). */
export interface MapExtent {
  cx: number;
  cy: number;
  mPorMm: number;
}

export interface LayoutConfig {
  pagina: 'A3' | 'A4';
  textos: LayoutTextos;
  /** 'auto' ou id de PALETTES */
  paletaId: string;
  estiloPlantado: EstiloPlantado;
  /** padrão 'escuro' (mapas antigos podem não ter o campo) */
  destaquePics?: DestaquePics;
  mapaBase: MapaBase;
  mostrarRotulosTalhoes: boolean;
  mostrarValoresPics: boolean;
  mostrarGrade: boolean;
  legendaCompacta: boolean;
  /** null = enquadrar a fazenda automaticamente */
  extent: MapExtent | null;
  idw: IdwParams;
  /** setores usados no mapa; null/ausente = todos */
  setores?: string[] | null;
  /** nome do arquivo CSV da ZEUS que gerou o mapa */
  nomeCsv?: string;
  /**
   * horas ('hh:mm') do início e do fim do período, só quando a chuva veio da integração com a opção de
   * informar a hora. O mapa salvo guarda o período só como data (periodoInicio/periodoFim): é daqui que
   * as horas voltam ao reabrir. Ausente = período só por data (e em mapas salvos antes deste campo).
   */
  periodoHoras?: { inicio: string; fim: string };
  /** campos de texto que o usuário alterou (os demais são preenchidos automaticamente) */
  textosEditados?: Partial<LayoutTextos>;
  /** orientação da folha; 'auto' (padrão; mapas antigos não têm o campo) decide pela forma dos talhões */
  orientacao?: 'auto' | 'paisagem' | 'retrato';
  /** 'auto' (padrão) = quadros separados quando compensa; 1 = quadro único; 'setor' = um quadro por setor */
  quadros?: 'auto' | 1 | 'setor';
  /** mapa de variedade: cores usadas (chave da variedade → cor), guardadas com o mapa salvo */
  coresVariedade?: Record<string, string>;
}

export interface MapaSalvo {
  id: string;
  fazendaId: string;
  safraId: string | null;
  titulo: string;
  /** ISO */
  periodoInicio: string | null;
  periodoFim: string | null;
  config: LayoutConfig;
  pics: Pic[];
  resumo: ResumoChuva;
  pngPath: string | null;
  thumbPath: string | null;
  criadoEm: string;
  /** 'variedade' nos mapas de variedade; ausente = chuva */
  tipo?: TipoMapa;
}
