/**
 * Cadastro padrão do COA (seed.json + GeoJSONs, gerados por scripts/gerar-seed.mjs): as unidades com os
 * talhões (limite base), a safra SOJA 26/27 e as áreas da cultura. Lido pela rede (public/dados/seed/,
 * desenvolvimento) ou de um zip escolhido pelo admin (leitores em seedLeitores.ts). Os ids são derivados
 * de chaves estáveis (`seed:fazenda:<UNIDADE>`, `seed:talhao:<UNIDADE>:<CÓDIGO>`, `seed:safra:<NOME PIMS>`,
 * `seed:area:<NOME PIMS>:<UNIDADE>:<CÓDIGO>`; sem código → `#<índice da feição>`), então recarregar
 * o seed faz upsert em vez de duplicar. Cada unidade é ligada à fazenda do COA WEB de mesmo nome.
 */
import turfArea from '@turf/area';
import type { Feature, FeatureCollection } from 'geojson';
import type { Repositorio } from '../data/repo';
import { nomeComparavel, normalizarCodigo, unidadePimsCanonica } from './codigoTalhao';
import { leitorHttp } from './seedLeitores';
import type { AreaCultura, Fazenda, FazendaCoa, Geometry, LeitorSeed, ResultadoSeed, Safra, Talhao } from './types';

export { nomeComparavel } from './codigoTalhao';
export { leitorDeZip, leitorHttp, PASTA_SEED, TEMPO_LIMITE_SEED_MS } from './seedLeitores';
export type { LeitorSeed, ResultadoSeed } from './types';

interface SeedFazenda {
  nome: string;
  unidadePims: string;
  campoNome: string;
  campoCodigo: string | null;
  campoSetor: string | null;
  /** relativo à pasta do seed */
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

/** seed.json */
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

/** Lê e interpreta um JSON do cadastro padrão (ignora o BOM de arquivos salvos no Windows). */
async function lerJson<T>(ler: LeitorSeed, caminho: string): Promise<T> {
  const texto = await ler(caminho);
  try {
    return JSON.parse(texto.replace(/^\uFEFF/, '')) as T;
  } catch {
    throw new Error(`O arquivo ${caminho} do cadastro padrão não é um JSON válido.`);
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
  const unidade = nomeComparavel(sf.unidadePims);
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

/** Nome para ligar à fazenda do COA WEB: comparável e sem o prefixo "Fazenda"/"Faz." ("Fazenda Globo" ↔ "Globo"). */
function chaveCoa(nome: string | null | undefined): string {
  return nomeComparavel(nome).replace(/^FAZ(?:ENDA)?\.?\s+/, '');
}

/**
 * Fazendas do COA WEB por nome comparável. Nome repetido (ambíguo) fica de fora: o vínculo define quem
 * vê a fazenda, então é melhor deixar sem vínculo (o admin escolhe à mão) do que ligar à fazenda errada.
 */
function coaPorNome(lista: FazendaCoa[]): Map<string, number> {
  const ids = new Map<string, number[]>();
  for (const f of lista) {
    const k = chaveCoa(f.nome);
    if (k) ids.set(k, [...(ids.get(k) ?? []), f.id]);
  }
  return new Map([...ids].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
}

interface FazendaGravada {
  id: string;
  talhoes: number;
  /** nome que ficou gravado (o do usuário, se ele renomeou) */
  nome: string;
  coaFazendaId: number | null;
}

/**
 * Grava a fazenda do seed. Existente (mesma unidade PIMS ou, sem unidade, mesmo nome): mantém id e
 * nome. Se ela já tem talhões próprios (nenhum com id do seed), mantém esses talhões e só vincula a
 * unidade PIMS; senão, faz upsert dos talhões do seed preservando nome/setor que o usuário editou.
 * Vínculo com o COA WEB: o que a fazenda já tem prevalece (ajuste manual); sem vínculo, usa `coaId`.
 * Nunca apaga talhões nem plantios.
 */
async function gravarFazenda(repo: Repositorio, sf: SeedFazenda, fc: FeatureCollection, existentes: Fazenda[], coaId: number | null): Promise<FazendaGravada> {
  const unidade = nomeComparavel(sf.unidadePims);
  const existente =
    existentes.find((f) => nomeComparavel(f.unidadePims) === unidade) ??
    existentes.find((f) => !f.unidadePims && (nomeComparavel(f.nome) === nomeComparavel(sf.nome) || nomeComparavel(f.nome) === unidade));
  const id = existente?.id ?? idDeterministico(`seed:fazenda:${unidade}`);
  const coaFazendaId = existente?.coaFazendaId ?? coaId;
  const doSeed = talhoesDoSeed(sf, id, fc);
  const atuais = existente ? await repo.obterTalhoes(id) : [];
  const idsSeed = new Set(doSeed.map((t) => t.id));
  const talhoesDoUsuario = atuais.length > 0 && !atuais.some((t) => idsSeed.has(t.id));

  if (existente && talhoesDoUsuario) {
    await repo.atualizarFazenda({ ...existente, unidadePims: existente.unidadePims ?? unidadePimsCanonica(sf.unidadePims), coaFazendaId }, []);
    return { id, talhoes: 0, nome: existente.nome, coaFazendaId };
  }
  const fazenda: Fazenda = {
    id,
    nome: existente?.nome ?? sf.nome,
    campoNome: sf.campoNome,
    campoSetor: sf.campoSetor,
    colunas: colunasDe(fc),
    criadoEm: existente?.criadoEm ?? new Date().toISOString(),
    unidadePims: unidadePimsCanonica(sf.unidadePims),
    campoCodigo: sf.campoCodigo,
    coaFazendaId,
  };
  await repo.atualizarFazenda(fazenda, []);
  const porId = new Map(atuais.map((t) => [t.id, t]));
  const talhoes = doSeed.map((t) => {
    const atual = porId.get(t.id);
    return atual ? { ...t, nome: atual.nome, setor: atual.setor } : t;
  });
  await repo.upsertTalhoes(id, talhoes);
  return { id, talhoes: talhoes.length, nome: fazenda.nome, coaFazendaId };
}

/** Safra existente com o mesmo nome no PIMS (ou, sem nomePims, com o mesmo nome) é reaproveitada. */
async function gravarSafra(repo: Repositorio, ss: SeedSafra, existentes: Safra[]): Promise<Safra> {
  const nomePims = ss.nomePims ?? ss.nome;
  const k = nomeComparavel(nomePims);
  const existente =
    existentes.find((s) => nomeComparavel(s.nomePims) === k) ?? existentes.find((s) => !s.nomePims && nomeComparavel(s.nome) === k);
  const safra: Safra = existente
    ? { ...existente, nomePims: existente.nomePims ?? nomePims }
    : { id: idDeterministico(`seed:safra:${nomePims}`), nome: ss.nome, cultura: ss.cultura, anoSafra: ss.anoSafra, inicio: ss.inicio, fim: ss.fim, nomePims };
  await repo.salvarSafra(safra);
  return safra;
}

function areasDoSeed(nomePims: string, unidadePims: string, safraId: string, fazendaId: string, fc: FeatureCollection): AreaCultura[] {
  const idPara = geradorDeIds(`seed:area:${nomePims}:${nomeComparavel(unidadePims)}`);
  return feicoesValidas(fc).map(({ f, indice }) => {
    const codigo = normalizarCodigo(texto(f.properties?.codigo));
    return { id: idPara(codigo, indice), safraId, fazendaId, codigo, areaHa: turfArea(f.geometry) / 10000, geom: f.geometry };
  });
}

export interface OpcoesSeed {
  /** andamento para a tela (ex.: "Gravando Dourado (1 de 7)…") */
  aoAvancar?: (texto: string) => void;
}

/**
 * Carrega (ou recarrega) o cadastro padrão sem apagar dados do usuário: upsert das fazendas pela
 * unidade PIMS (mantém o nome renomeado), upsert dos talhões pelo id determinístico (mantém os
 * plantios), upsert da safra pelo nome no PIMS e substituição das áreas da cultura por safra × fazenda.
 * Liga cada unidade à fazenda do COA WEB (`repo.listarFazendasCoa()`) pelo nome comparável, sem trocar
 * um vínculo que a fazenda já tenha; modo local (lista vazia) → tudo sem vínculo. Unidades das áreas
 * da cultura sem fazenda no seed são ignoradas. Lança Error (em português) se faltar arquivo, se um
 * arquivo não for JSON ou se não der para listar as fazendas do COA WEB. O seed.json, os limites base e
 * a lista do COA WEB são lidos antes de gravar; os arquivos das áreas da cultura, depois das fazendas
 * (uma falha ali deixa as fazendas gravadas; importar de novo completa).
 */
export async function carregarSeed(repo: Repositorio, ler: LeitorSeed = leitorHttp(), { aoAvancar }: OpcoesSeed = {}): Promise<ResultadoSeed> {
  aoAvancar?.('Lendo os arquivos do cadastro padrão…');
  const seed = await lerJson<SeedArquivo>(ler, 'seed.json');
  if (!Array.isArray(seed?.fazendas) || !Array.isArray(seed?.safras)) {
    throw new Error('Cadastro padrão inválido: o seed.json não tem a lista de fazendas e de safras.');
  }
  const bases = await Promise.all(seed.fazendas.map((f) => lerJson<FeatureCollection>(ler, f.arquivoBase)));
  const coa = coaPorNome(await repo.listarFazendasCoa());

  const fazendasExistentes = await repo.listarFazendas();
  const idPorUnidade = new Map<string, string>();
  let talhoes = 0;
  let ligadas = 0;
  const semVinculo: string[] = [];
  for (let i = 0; i < seed.fazendas.length; i++) {
    const sf = seed.fazendas[i];
    aoAvancar?.(`Gravando ${sf.nome} (${i + 1} de ${seed.fazendas.length})…`);
    const coaId = coa.get(chaveCoa(sf.nome)) ?? coa.get(chaveCoa(sf.unidadePims)) ?? null;
    const r = await gravarFazenda(repo, sf, bases[i], fazendasExistentes, coaId);
    idPorUnidade.set(nomeComparavel(sf.unidadePims), r.id);
    talhoes += r.talhoes;
    if (r.coaFazendaId !== null) ligadas++;
    else semVinculo.push(r.nome);
  }

  const safrasExistentes = await repo.listarSafras();
  let areas = 0;
  for (const ss of seed.safras) {
    aoAvancar?.(`Gravando as áreas da cultura da ${ss.nome}…`);
    const safra = await gravarSafra(repo, ss, safrasExistentes);
    const nomePims = ss.nomePims ?? ss.nome;
    const comFazenda = ss.areasCultura.filter((a) => idPorUnidade.has(nomeComparavel(a.unidadePims)));
    const colecoes = await Promise.all(comFazenda.map((a) => lerJson<FeatureCollection>(ler, a.arquivo)));
    for (let i = 0; i < comFazenda.length; i++) {
      const fazendaId = idPorUnidade.get(nomeComparavel(comFazenda[i].unidadePims))!;
      const lista = areasDoSeed(nomePims, comFazenda[i].unidadePims, safra.id, fazendaId, colecoes[i]);
      await repo.salvarAreasCultura(safra.id, fazendaId, lista);
      areas += lista.length;
    }
  }
  return { fazendas: seed.fazendas.length, talhoes, areas, ligadas, semVinculo };
}

/** true se já existe alguma fazenda vinculada a uma unidade do PIMS (seed carregado ou cadastro feito). */
export async function seedJaCarregado(repo: Repositorio): Promise<boolean> {
  return (await repo.listarFazendas()).some((f) => Boolean(f.unidadePims));
}
