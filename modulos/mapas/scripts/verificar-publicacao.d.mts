// Tipos do script scripts/verificar-publicacao.mjs (usado pelos testes).

/** Problemas no conteúdo de um arquivo da saída (nome só para a mensagem; nunca mostra o token). */
export function problemasNoConteudo(nome: string, texto: string): string[];

/** Confere a pasta publicada: index.html, sem dados/, só a chave anon. */
export function verificarPublicacao(saida: string): { problemas: string[]; total: number };
