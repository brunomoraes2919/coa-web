/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** pasta deste arquivo (modulos/sat): raiz do projeto, qualquer que seja o diretório atual */
const RAIZ = fileURLToPath(new URL('.', import.meta.url));
/** build do COA WEB: sat/ na raiz do repositório (a única pasta que o emptyOutDir pode esvaziar) */
const SAIDA_COA_WEB = resolve(RAIZ, '../../sat');

// base './' permite publicar em qualquer caminho (sat/ do COA WEB, GitHub Pages...)
export default defineConfig(({ mode }) => {
  const coaWeb = mode === 'coa-web';
  return {
    root: RAIZ,
    base: './',
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 600,
      // modo coa-web: grava direto em sat/ na raiz do COA WEB (servido sem build pela Vercel/Pages)
      ...(coaWeb ? { outDir: SAIDA_COA_WEB, emptyOutDir: true } : {}),
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    },
  };
});
