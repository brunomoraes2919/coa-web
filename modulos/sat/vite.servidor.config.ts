import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Empacota o serviço da VM num arquivo só. As bibliotecas ficam de fora: a VM as instala com `npm ci`. */
const RAIZ = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: RAIZ,
  build: {
    ssr: resolve(RAIZ, 'src/servidor/principal.ts'),
    target: 'node20',
    outDir: resolve(RAIZ, 'servidor'),
    emptyOutDir: false,
    // A pasta `servidor/` já tem arquivos próprios; o `public/` do navegador não vai junto.
    copyPublicDir: false,
    minify: false,
    rollupOptions: {
      external: ['baileys', 'qrcode-terminal', /^node:/],
      output: { format: 'es', entryFileNames: 'locks-sat-whatsapp.mjs' },
    },
  },
});
