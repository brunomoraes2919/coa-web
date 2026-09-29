/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' permite publicar no GitHub Pages em qualquer caminho (/usuario.github.io/repo/)
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // pacote inicial ~510 kB (React + Supabase + proj4); as telas pesadas são carregadas sob demanda
  build: { chunkSizeWarningLimit: 600 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
