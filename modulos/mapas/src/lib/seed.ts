/**
 * Cadastro padrão do COA (public/dados/seed/, gerado por scripts/gerar-seed.mjs): as unidades com os
 * talhões (limite base), a safra SOJA 26/27 e as áreas da cultura. Os ids são derivados de chaves
 * estáveis (`seed:fazenda:<UNIDADE>`, `seed:talhao:<UNIDADE>:<CÓDIGO>`, `seed:safra:<NOME PIMS>`,
 * `seed:area:<NOME PIMS>:<UNIDADE>:<CÓDIGO>`; sem código → `#<índice da feição>`), então recarregar
 * o seed faz upsert em vez de duplicar.
 */
import turfArea from '@turf/area';
import type { Feature, FeatureCollection } from 'geojson';
import type { Repositorio } from '../data/repo';
import { normalizarCodigo } from './codigoTalhao';
import type { AreaCultura, Fazenda, Geometry, Safra, Talhao } from './types';

const PASTA = './dados/seed/';

interface SeedFazenda {
  nome: string;
  unidadePims: string;
  campoNome: string;
  campoCodigo: string | null;
  campoSetor: string | null;
  /** relativo a dados/seed/ */
  arquivoBase: string;
}

interface SeedSafra {
  nome: string;
  nomePims: string | null;
  cultura: string;
  anoSafra: string;
  inicio: string;
  fim: string;
  areasCultura: { unidadePims: string; arquivo: string }[];
}

/** public/dados/seed/seed.json */
interface SeedArquivo {
  versao: 1;
  geradoEm: string;
  fazendas: SeedFazenda[];
  safras: SeedSafra[];
}

/** FNV-1a 32 bits sobre os bytes UTF-8 de `s`. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** UUID com cara de v5 (versão 5, variante RFC 4122) derivado da chave: mesma chave → mesmo id. */
export function idDeterministico(chave: string): string {
  const hex = [0, 1, 2, 3].map((i) => fnv1a(`${i}|${chave}`).toString(16).padStart(8, '0')).join('');
  const variante = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variante}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Nome para comparação: maiúsculas, sem acento, espaços simples. */
function chave(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Tempo máximo para baixar cada arquivo do cadastro padrão (o maior tem ~8 MB). */
export const TEMPO_LIMITE_SEED_MS = 60_000;

/**
 * Baixa e lê um JSON do cadastro padrão. Desiste depois de `timeoutMs` (cabeçalho + corpo), cancelando
 * o fetch, para a tela não ficar presa se o servidor ou a rede travarem.
 */
async function lerJson<T>(fetchImpl: typeof fetch, arquivo: string, timeoutMs: number): Promise<T> {
  const controle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const esgotou = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => {
      controle.abort();
      rejeitar(
        new Error(
          `Tempo esgotado ao ler o cadastro padrão (${arquivo}) depois de ${Math.round(timeoutMs / 1000)} s. Verifique a internet e tente de novo.`,
        ),
      );
    }, timeoutMs);
  });
  const ler = async (): Promise<T> => {
    let resp: Response;
    try {
      resp = await fetchImpl(PASTA + arquivo, { signal: controle.signal });
    } catch (e) {
      throw new Error(`Não foi possível ler o cadastro padrão (${arquivo}): ${(e as Error).message}`);
    }
    if (!resp.ok) throw new Error(`Não foi possível ler o cadastro padrão (${arquivo}): HTTP ${resp.status}`);
    return (await resp.json()) as T;
  };
  try {
    return await Promise.race([ler(), esgotou]);
  } finally {
    clearTimeout(timer);
  }
}

type Feicao = Feature<Geometry, Record<string, unknown>>;

function feicoesValidas(fc: FeatureCollection): { f: Feicao; indice: number }[] {
  return fc.features
    .map((f, indice) => ({ f: f as Feicao, indice }))
    .filter(({ f }) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
}

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Id pela chave do código; código vazio ou repetido no mesmo arquivo → `#<índice>`. */
function geradorDeIds(prefixo: string): (codigo: string, indice: number) => string {
  const usados = new Set<string>();
  return (codigo, indice) => {
    let k = codigo !== '' ? `${prefixo}:${codigo}` : `${prefixo}:#${indice}`;
    if (usados.has(k)) k = `${prefixo}:#${indice}`;
    usados.add(k);
    return idDeterministico(k);
  };
}

function talhoesDoSeed(sf: SeedFazenda, fazendaId: string, fc: FeatureCollection): Talhao[] {
  const unidade = chave(sf.unidadePims);
  const idPara = geradorDeIds(`seed:talhao:${unidade}`);
  return feicoesValidas(fc).map(({ f, indice }) => {
    const props = f.properties ?? {};
    const codigo = normalizarCodigo(texto(sf.campoCodigo ? props[sf.campoCodigo] : ''));
    const nome = texto(props[sf.campoNome]) || texto(props.codigoBruto) || `Talhão ${indice + 1}`;
    return {
      id: idPara(codigo, indice),
      fazendaId,
      nome,
      setor: sf.campoSetor ? texto(props[sf.campoSetor]) || null : null,
      areaHa: turfArea(f.geometry) / 10000,
      geom: f.geometry,
      atributos: { ...props },
      codigo: codigo || null,
    };
  });
}

function colunasDe(fc: FeatureCollection): string[] {
  const colunas = new Set<string>();
  for (const f of fc.features) for (const k of Object.keys(f.properties ?? {})) colunas.add(k);
  return [...colunas];
}

/**
 * Grava a fazenda do seed. Existente (mesma unidade PIMS ou, sem unidade, mesmo nome): mantém id e
 * nome. Se ela já tem talhões próprios (nenhum com id do seed), mantém esses talhões e só vincula a
 * unidade PIMS; senão, faz upsert dos talhões do seed preservando nome/setor que o usuário editou.
 * Nunca apaga talhões nem plantios. Retorna o id da fazenda e quantos talhões foram gravados.
 */
async function gravarFazenda(repo: Repositorio, sf: SeedFazenda, fc: FeatureCollection, existentes: Fazenda[]): Promise<{ id: string; talhoes: number }> {
  const unidade = chave(sf.unidadePims);
  const existente =
    existentes.find((f) => chave(f.unidadePims) === unidade) ??
    existentes.find((f) => !f.unidadePims && (chave(f.nome) === chave(sf.nome) || chave(f.nome) === unidade));
  const id = existente?.id ?? idDeterministico(`seed:fazenda:${unidade}`);
  const doSeed = talhoesDoSeed(sf, id, fc);
  const atuais = existente ? await repo.obterTalhoes(id) : [];
  const idsSeed = new Set(doSeed.map((t) => t.id));
  const talhoesDoUsuario = atuais.length > 0 && !atuais.some((t) => idsSeed.has(t.id));

  if (existente && talhoesDoUsuario) {
    await repo.atualizarFazenda({ ...existente, unidadePims: existente.unidadePims ?? sf.unidadePims }, []);
    return { id, talhoes: 0 };
  }
  const fazenda: Fazenda = {
    id,
    nome: existente?.nome ?? sf.nome,
    campoNome: sf.campoNome,
    campoSetor: sf.campoSetor,
    colunas: colunasDe(fc),
    criadoEm: existente?.criadoEm ?? new Date().toISOString(),
    unidadePims: sf.unidadePims,
    campoCodigo: sf.campoCodigo,
  };
  await repo.atualizarFazenda(fazenda, []);
  const porId = new Map(atuais.map((t) => [t.id, t]));
  const talhoes = doSeed.map((t) => {
    const atual = porId.get(t.id);
    return atual ? { ...t, nome: atual.nome, setor: atual.setor } : t;
  });
  await repo.upsertTalhoes(id, talhoes);
  return { id, talhoes: talhoes.length };
}

/** Safra existente com o mesmo nome no PIMS (ou, sem nomePims, com o mesmo nome) é reaproveitada. */
async function gravarSafra(repo: Repositorio, ss: SeedSafra, existentes: Safra[]): Promise<Safra> {
  const nomePims = ss.nomePims ?? ss.nome;
  const k = chave(nomePims);
  const existente = existentes.find((s) => chave(s.nomePims) === k) ?? existentes.find((s) => !s.nomePims && chave(s.nome) === k);
  const safra: Safra = existente
    ? { ...existente, nomePims: existente.nomePims ?? nomePims }
    : { id: idDeterministico(`seed:safra:${nomePims}`), nome: ss.nome, cultura: ss.cultura, anoSafra: ss.anoSafra, inicio: ss.inicio, fim: ss.fim, nomePims };
  await repo.salvarSafra(safra);
  return safra;
}

function areasDoSeed(nomePims: string, unidadePims: string, safraId: string, fazendaId: string, fc: FeatureCollection): AreaCultura[] {
  const idPara = geradorDeIds(`seed:area:${nomePims}:${chave(unidadePims)}`);
  return feicoesValidas(fc).map(({ f, indice }) => {
    const codigo = normalizarCodigo(texto(f.properties?.codigo));
    return { id: idPara(codigo, indice), safraId, fazendaId, codigo, areaHa: turfArea(f.geometry) / 10000, geom: f.geometry };
  });
}

/**
 * Carrega (ou recarrega) o cadastro padrão sem apagar dados do usuário: upsert das fazendas pela
 * unidade PIMS (mantém o nome renomeado), upsert dos talhões pelo id determinístico (mantém os
 * plantios), upsert da safra pelo nome no PIMS e substituição das áreas da cultura por safra × fazenda.
 * Unidades das áreas da cultura sem fazenda no seed são ignoradas. Lança Error se faltar arquivo ou se
 * um arquivo não chegar em `timeoutMs` (padrão 60 s).
 */
export async function carregarSeed(
  repo: Repositorio,
  fetchImpl: typeof fetch = (u, i) => fetch(u, i),
  { timeoutMs = TEMPO_LIMITE_SEED_MS }: { timeoutMs?: number } = {},
): Promise<{ fazendas: number; talhoes: number; areas: number }> {
  const seed = await lerJson<SeedArquivo>(fetchImpl, 'seed.json', timeoutMs);
  const bases = await Promise.all(seed.fazendas.map((f) => lerJson<FeatureCollection>(fetchImpl, f.arquivoBase, timeoutMs)));

  const fazendasExistentes = await repo.listarFazendas();
  const idPorUnidade = new Map<string, string>();
  let talhoes = 0;
  for (let i = 0; i < seed.fazendas.length; i++) {
    const r = await gravarFazenda(repo, seed.fazendas[i], bases[i], fazendasExistentes);
    idPorUnidade.set(chave(seed.fazendas[i].unidadePims), r.id);
    talhoes += r.talhoes;
  }

  const safrasExistentes = await repo.listarSafras();
  let areas = 0;
  for (const ss of seed.safras) {
    const safra = await gravarSafra(repo, ss, safrasExistentes);
    const nomePims = ss.nomePims ?? ss.nome;
    const comFazenda = ss.areasCultura.filter((a) => idPorUnidade.has(chave(a.unidadePims)));
    const colecoes = await Promise.all(comFazenda.map((a) => lerJson<FeatureCollection>(fetchImpl, a.arquivo, timeoutMs)));
    for (let i = 0; i < comFazenda.length; i++) {
      const fazendaId = idPorUnidade.get(chave(comFazenda[i].unidadePims))!;
      const lista = areasDoSeed(nomePims, comFazenda[i].unidadePims, safra.id, fazendaId, colecoes[i]);
      await repo.salvarAreasCultura(safra.id, fazendaId, lista);
      areas += lista.length;
    }
  }
  return { fazendas: seed.fazendas.length, talhoes, areas };
}

/** true se já existe alguma fazenda vinculada a uma unidade do PIMS (seed carregado ou cadastro feito). */
export async function seedJaCarregado(repo: Repositorio): Promise<boolean> {
  return (await repo.listarFazendas()).some((f) => Boolean(f.unidadePims));
}
