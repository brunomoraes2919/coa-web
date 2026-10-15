// Cabeçalhos que a Vercel manda para um caminho, lidos do vercel.json da raiz. Usado pelo teste das regras
// (modulos/painel/testes/vercel.test.mjs) e pelo servidor local do painel (a TV local recebe o mesmo CSP).
// Só entende o que o vercel.json usa: texto fixo, "(.*)", alternativas "(a|b)", grupo opcional "(/.*)?" e
// "(?!...)". Esses padrões do path-to-regexp da Vercel valem igual como expressão regular.
import { readFileSync } from 'node:fs';

const VERCEL = new URL('../../../vercel.json', import.meta.url);

export function lerVercel() {
  return JSON.parse(readFileSync(VERCEL, 'utf8'));
}

/** Regras de "headers" do vercel.json que valem para o caminho (ex.: "/painel/index.html"). */
export function regrasDoCaminho(caminho, vercel = lerVercel()) {
  return vercel.headers.filter((r) => new RegExp('^' + r.source + '$').test(caminho));
}

/** Cabeçalhos do caminho, juntando as regras na ordem (no mesmo nome, vale a última). Nomes em minúsculas. */
export function cabecalhosDoCaminho(caminho, vercel = lerVercel()) {
  const saida = {};
  for (const r of regrasDoCaminho(caminho, vercel)) for (const h of r.headers) saida[h.key.toLowerCase()] = h.value;
  return saida;
}
