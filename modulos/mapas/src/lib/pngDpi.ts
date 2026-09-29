/**
 * Grava a resolução (chunk pHYs) no PNG gerado pelo canvas, que sai sem essa informação.
 * Assim o arquivo abre e imprime no tamanho certo (A3 a 300 dpi, por exemplo) em vez de 72/96 dpi.
 */

let tabela: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!tabela) {
    tabela = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = tabela[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ASSINATURA = [137, 80, 78, 71, 13, 10, 26, 10];

function chunkPhys(dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const b = new Uint8Array(21);
  const v = new DataView(b.buffer);
  v.setUint32(0, 9);
  b.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  b[16] = 1; // unidade: metro
  v.setUint32(17, crc32(b.subarray(4, 17)));
  return b;
}

export async function definirDpiPng(png: Blob, dpi: number): Promise<Blob> {
  const b = new Uint8Array(await png.arrayBuffer());
  if (b.length < 33 || ASSINATURA.some((x, i) => b[i] !== x)) return png;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const partes: Uint8Array[] = [b.subarray(0, 8)];
  let p = 8;
  let inserido = false;
  while (p + 12 <= b.length) {
    const len = v.getUint32(p);
    const tipo = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const fim = p + 12 + len;
    if (tipo !== 'pHYs') partes.push(b.subarray(p, fim));
    if (tipo === 'IHDR' && !inserido) {
      partes.push(chunkPhys(dpi));
      inserido = true;
    }
    p = fim;
  }
  return new Blob(partes as BlobPart[], { type: 'image/png' });
}
