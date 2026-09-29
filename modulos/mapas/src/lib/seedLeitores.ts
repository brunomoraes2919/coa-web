/**
 * Leitores do cadastro padrão (seed.json + GeoJSONs): pela rede (public/dados/seed/, só no
 * desenvolvimento) ou de um zip escolhido pelo admin (cadastro-padrao-mapas.zip, gerado por
 * `npm run pacote-seed`). Os dois entregam o texto de cada arquivo pelo caminho relativo à pasta do seed.
 */
import type { LeitorSeed } from './types';

/** Pasta do cadastro padrão servida pelo Vite no desenvolvimento (não vai para a publicação). */
export const PASTA_SEED = './dados/seed/';

/** Tempo máximo para baixar cada arquivo do cadastro padrão (o maior tem ~8 MB). */
export const TEMPO_LIMITE_SEED_MS = 60_000;

/**
 * Lê os arquivos por fetch em `pasta`. Desiste depois de `timeoutMs` (cabeçalho + corpo), cancelando o
 * fetch, para a tela não ficar presa se o servidor ou a rede travarem.
 */
export function leitorHttp(
  pasta: string = PASTA_SEED,
  { fetchImpl = (u, i) => fetch(u, i), timeoutMs = TEMPO_LIMITE_SEED_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): LeitorSeed {
  const base = pasta.endsWith('/') ? pasta : `${pasta}/`;
  return async (caminho) => {
    const controle = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const esgotou = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => {
        controle.abort();
        rejeitar(
          new Error(
            `Tempo esgotado ao ler o cadastro padrão (${caminho}) depois de ${Math.round(timeoutMs / 1000)} s. Verifique a internet e tente de novo.`,
          ),
        );
      }, timeoutMs);
    });
    const ler = async (): Promise<string> => {
      let resp: Response;
      try {
        resp = await fetchImpl(base + caminho, { signal: controle.signal });
      } catch (e) {
        throw new Error(`Não foi possível ler o cadastro padrão (${caminho}): ${(e as Error).message}`);
      }
      if (!resp.ok) throw new Error(`Não foi possível ler o cadastro padrão (${caminho}): HTTP ${resp.status}`);
      return resp.text();
    };
    try {
      return await Promise.race([ler(), esgotou]);
    } finally {
      clearTimeout(timer);
    }
  };
}

const SEED_JSON = 'seed.json';

/** '' se o seed.json está na raiz do zip; '<pasta>/' se está numa pasta única; senão, erro em português. */
function prefixoDoSeed(caminhos: string[]): string {
  if (caminhos.includes(SEED_JSON)) return '';
  const pastas = caminhos.filter((c) => /^[^/]+\/seed\.json$/.test(c)).map((c) => c.slice(0, -SEED_JSON.length));
  if (pastas.length === 1) return pastas[0];
  throw new Error(
    pastas.length > 1
      ? `O zip tem mais de uma pasta com seed.json (${pastas.join(', ')}). Use o arquivo gerado por "npm run pacote-seed".`
      : 'O zip não tem o seed.json do cadastro padrão (na raiz ou numa pasta). Escolha o arquivo cadastro-padrao-mapas.zip.',
  );
}

/**
 * Abre o zip do cadastro padrão (fflate.unzipSync, tudo em memória) e lê os arquivos dele. Aceita os
 * arquivos na raiz do zip ou dentro de uma pasta única, e nomes com barra invertida (zip do Windows).
 * O fflate é carregado sob demanda: fica fora do pacote inicial.
 */
export async function leitorDeZip(arquivo: Blob): Promise<LeitorSeed> {
  const { unzipSync, strFromU8 } = await import('fflate');
  let entradas: Record<string, Uint8Array>;
  try {
    entradas = unzipSync(new Uint8Array(await arquivo.arrayBuffer()));
  } catch {
    throw new Error('Não foi possível abrir o zip do cadastro padrão: o arquivo não é um .zip válido. Escolha o arquivo cadastro-padrao-mapas.zip.');
  }
  const arquivos = new Map<string, Uint8Array>();
  for (const [nome, dados] of Object.entries(entradas)) {
    const caminho = nome.replaceAll('\\', '/');
    if (!caminho.endsWith('/')) arquivos.set(caminho, dados); // entradas de pasta não têm conteúdo
  }
  const prefixo = prefixoDoSeed([...arquivos.keys()]);
  return async (caminho) => {
    const dados = arquivos.get(prefixo + caminho);
    if (!dados) throw new Error(`Não foi possível ler o cadastro padrão (${caminho}): o arquivo não está no zip.`);
    return strFromU8(dados);
  };
}
