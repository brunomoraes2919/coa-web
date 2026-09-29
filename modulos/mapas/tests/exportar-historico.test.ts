import { afterEach, describe, expect, it, vi } from 'vitest';
import { baixarDeUrl, codificarCopiaHistorico, nomeArquivoMapa } from '../src/lib/exportar';
import { extensaoImagem } from '../src/lib/historico';

interface Codificacao {
  w: number;
  h: number;
  tipo: string | undefined;
  qualidade: number | undefined;
}

/** Canvas falso: registra cada toBlob (tamanho, tipo e qualidade) e devolve um blob do tipo pedido. */
function canvasFalso(w: number, h: number, codificacoes: Codificacao[]) {
  const c = {
    width: w,
    height: h,
    getContext: () => ({ imageSmoothingQuality: 'low', drawImage: () => undefined }),
    toBlob(cb: (b: Blob | null) => void, tipo?: string, qualidade?: number) {
      codificacoes.push({ w: c.width, h: c.height, tipo, qualidade });
      cb(new Blob(['x'], { type: tipo ?? 'image/png' }));
    },
  };
  return c;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('codificarCopiaHistorico', () => {
  it('a cópia do histórico é JPEG qualidade 0,9 do próprio desenho; a miniatura, PNG reduzido dele', async () => {
    const codificacoes: Codificacao[] = [];
    vi.stubGlobal('document', { createElement: () => canvasFalso(1, 1, codificacoes) });
    const pagina = canvasFalso(2480, 1754, codificacoes); // A3 paisagem em 150 dpi

    const { imagem, miniatura } = await codificarCopiaHistorico(pagina as unknown as HTMLCanvasElement);

    expect(imagem.type).toBe('image/jpeg');
    expect(miniatura.type).toBe('image/png');
    expect(codificacoes).toContainEqual({ w: 2480, h: 1754, tipo: 'image/jpeg', qualidade: 0.9 });
    expect(codificacoes).toContainEqual({ w: 480, h: 339, tipo: 'image/png', qualidade: undefined });
    expect(codificacoes).toHaveLength(2);
  });
});

describe('baixarDeUrl (download da cópia do histórico)', () => {
  it('o nome do arquivo pode seguir o tipo do blob baixado', async () => {
    const baixados: string[] = [];
    vi.stubGlobal('fetch', async () => new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }));
    vi.stubGlobal('document', {
      createElement: () => {
        const a = { href: '', download: '', click: () => baixados.push(a.download), remove: () => undefined };
        return a;
      },
      body: { appendChild: () => undefined },
    });

    await baixarDeUrl('https://falso/mapa.jpg', (blob) => nomeArquivoMapa('Siriema', '01/02/2025 a 15/02/2025', extensaoImagem(blob.type)));
    await baixarDeUrl('https://falso/mapa.jpg', 'fixo.png');

    expect(baixados).toEqual(['MAPA_CHUVA_SIRIEMA_01-02-2025_A_15-02-2025.jpg', 'fixo.png']);
  });
});
