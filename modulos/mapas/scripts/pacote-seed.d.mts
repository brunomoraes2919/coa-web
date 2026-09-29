// Tipos do script scripts/pacote-seed.mjs (usado pelos testes).

/** Zip da pasta do seed (seed.json na raiz); erro se falta o seed.json ou um arquivo citado nele. */
export function montarPacoteSeed(pasta: string): { zip: Uint8Array; arquivos: string[] };
