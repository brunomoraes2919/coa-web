// COA WEB — função do Supabase "sigef-parcelas": busca no INCRA (SIGEF) as parcelas certificadas de um recorte.
//
// Por que existe: o INCRA recusa o servidor do COA no Google Cloud (fora do Brasil), mas responde a quem está no
// Brasil. O servidor do COA (modulos/mapas/scripts/sincronizar-plantio.mjs, sigefDoRecorte) chama esta função com o
// cabeçalho "x-region: sa-east-1", e ela roda em São Paulo e repassa a resposta do INCRA (GML) sem mexer.
//
// Quem pode chamar: só quem tem a chave de serviço do Supabase (a mesma do servidor). A função confere a chave
// pedindo ao próprio Supabase uma leitura que só a chave de serviço faz; usuário logado e chave pública recebem 401.
// Por isso a verificação de JWT da plataforma fica DESLIGADA (a chave nova do Supabase não é JWT).
// Pedido: POST { "uf": "MT", "bbox": [lonMin, latMin, lonMax, latMax] }. Só leitura; nada é gravado.
//
// Publicar: Supabase → Edge Functions → sigef-parcelas (código deste arquivo), com "Verify JWT" desligado.

const INCRA = 'https://acervofundiario.incra.gov.br/i3geo/ogc.php';
const UFS = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']);
/** maior lado do recorte (graus): uma fazenda com margem cabe com folga; recorte maior é recusado */
const MAX_LADO_GRAUS = 1.5;
const PRAZO_MS = 80_000;

const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

/** A chamada traz a chave de serviço? (pergunta ao Auth do próprio projeto, que só responde 200 a ela) */
async function ehChaveDeServico(req: Request): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const apikey = req.headers.get('apikey') ?? '';
  if (!url || !apikey) return false;
  const cabecalhos: Record<string, string> = { apikey };
  const auth = req.headers.get('authorization');
  if (auth) cabecalhos.Authorization = auth;
  try {
    const r = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, { headers: cabecalhos, signal: AbortSignal.timeout(15_000) });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

/** [lonMin, latMin, lonMax, latMax] dentro do Brasil e do tamanho de uma fazenda; senão null. */
function recorte(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const b = v.map(Number);
  if (!b.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = b;
  if (x0 < -75 || x1 > -28 || y0 < -35 || y1 > 6) return null;
  if (!(x1 > x0 && y1 > y0) || x1 - x0 > MAX_LADO_GRAUS || y1 - y0 > MAX_LADO_GRAUS) return null;
  return b;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  if (!(await ehChaveDeServico(req))) return json({ erro: 'Não autorizado.' }, 401);
  let corpo: { uf?: unknown; bbox?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: 'Corpo inválido.' }, 400);
  }
  const uf = String(corpo.uf ?? '').toUpperCase();
  const bbox = recorte(corpo.bbox);
  if (!UFS.has(uf) || !bbox) return json({ erro: 'UF ou recorte inválido.' }, 400);
  const tema = `certificada_sigef_particular_${uf.toLowerCase()}`;
  const url = `${INCRA}?${new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', tema, typeName: tema, BBOX: bbox.join(','), maxFeatures: '3000' })}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'COA-WEB-Mapas/1.0 (Locks COA WEB)' }, signal: AbortSignal.timeout(PRAZO_MS) });
    const texto = await r.text();
    return new Response(texto, {
      status: r.ok ? 200 : 502,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'x-incra-status': String(r.status), 'x-regiao': Deno.env.get('SB_REGION') ?? '' },
    });
  } catch (e) {
    const tempo = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return json({ erro: tempo ? 'O INCRA não respondeu a tempo.' : 'O INCRA não respondeu.' }, 504);
  }
});
