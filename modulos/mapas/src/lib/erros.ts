/**
 * Mensagens de erro para o usuário, em português. Erros técnicos conhecidos (do navegador, do
 * Supabase ou do JavaScript, que chegam em inglês) são traduzidos; as mensagens do próprio app, já
 * em português, passam como estão. Puro: usado pela interface e pelo worker da interpolação.
 */

/** Supabase do COA WEB sem o script do módulo (tabelas mapas_* ou colunas inexistentes). */
const BANCO_DESATUALIZADO = 'Banco desatualizado: rode o script supabase/coa-web/0001_mapas.sql no Supabase do COA WEB';
/** Códigos do Postgres/PostgREST para tabela ou coluna inexistente. */
const CODIGOS_BANCO_DESATUALIZADO = new Set(['42P01', 'PGRST204', 'PGRST205']);

const TRADUCOES: [RegExp, string][] = [
  [/relation "[^"]*" does not exist|could not find the .* in the schema cache/i, BANCO_DESATUALIZADO],
  [/failed to fetch|networkerror|load failed|network request failed/i, 'Não foi possível conectar ao servidor. Verifique a internet e as configurações.'],
  [/jwt expired|invalid jwt/i, 'Sua sessão expirou. Faça login de novo.'],
  [
    /row-level security|permission denied/i,
    'Sem permissão para acessar estes dados. Entre de novo com o seu e-mail; se continuar, peça a um administrador do COA WEB acesso a esta fazenda.',
  ],
  [
    /payload too large|exceeded the maximum allowed size/i,
    'Arquivo grande demais para o Storage do Supabase. Confira o limite de tamanho de arquivo do projeto (Storage → Settings).',
  ],
  [/object not found/i, 'Arquivo não encontrado no Storage do Supabase.'],
];

const MEMORIA = 'Memória insuficiente no navegador para esta operação. Feche outras abas ou use uma resolução menor e tente de novo.';
/** RangeError de alocação (V8: "Array buffer allocation failed", "Invalid typed array length"; Firefox/Safari: "out of memory"). */
const FALTA_MEMORIA = /allocation failed|invalid (typed )?array length|out of memory/i;

/** Tradução de um erro técnico conhecido; null se não houver. */
function traduzir(msg: string): string | null {
  if (FALTA_MEMORIA.test(msg)) return MEMORIA;
  for (const [padrao, texto] of TRADUCOES) if (padrao.test(msg)) return texto;
  return null;
}

function textoDoErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  // PostgrestError e afins: objeto simples com message
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
}

/** Converte um erro qualquer em uma mensagem legível em português. */
export function mensagemDeErro(e: unknown): string {
  const codigo = (e as { code?: unknown } | null)?.code;
  if (typeof codigo === 'string' && CODIGOS_BANCO_DESATUALIZADO.has(codigo)) return BANCO_DESATUALIZADO;
  const msg = textoDoErro(e);
  if (!msg) return 'Ocorreu um erro inesperado.';
  return traduzir(msg) ?? msg;
}

const FALHA_INTERPOLACAO = 'Falha inesperada no cálculo da interpolação. Recarregue a página e tente de novo.';

/**
 * Mensagem que o worker devolve quando a interpolação falha: os erros esperados do pipeline
 * (ErroPipeline, já em português) passam como estão; os inesperados passam pela mesma tradução e,
 * se não forem conhecidos, viram uma mensagem genérica (o detalhe técnico fica no console).
 */
export function mensagemErroInterpolacao(e: unknown): string {
  if (e instanceof Error && e.name === 'ErroPipeline') return e.message;
  return traduzir(textoDoErro(e)) ?? FALHA_INTERPOLACAO;
}
