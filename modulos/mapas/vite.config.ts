/// <reference types="vitest/config" />
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build do COA WEB (`vite build --mode coa-web`): o repositório é público, então os dados da Locks
 * de public/dados/ (cadastro padrão e plantio.json) não vão para a saída.
 */
function semDadosLocks(): Plugin {
  let saida = '';
  return {
    name: 'coa-web-sem-dados',
    apply: 'build',
    configResolved(c) {
      saida = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(saida, 'dados'), { recursive: true, force: true });
    },
  };
}

// base './' permite publicar em qualquer caminho (mapas/ do COA WEB, GitHub Pages...)
export default defineConfig(({ mode }) => {
  const coaWeb = mode === 'coa-web';
  return {
    base: './',
    plugins: coaWeb ? [react(), semDadosLocks()] : [react()],
    worker: { format: 'es' },
    build: {
      // pacote inicial ~510 kB (React + Supabase + proj4); as telas pesadas são carregadas sob demanda
      chunkSizeWarningLimit: 600,
      // modo coa-web: grava direto em mapas/ na raiz do COA WEB (servido sem build pela Vercel/Pages)
      ...(coaWeb ? { outDir: '../../mapas', emptyOutDir: true } : {}),
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
