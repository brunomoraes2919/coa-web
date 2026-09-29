import { describe, expect, it } from 'vitest';
import { crc32, definirDpiPng } from '../src/lib/pngDpi';

function chunk(tipo: string, dados: number[]): number[] {
  const t = [...tipo].map((c) => c.charCodeAt(0));
  const len = [(dados.length >>> 24) & 255, (dados.length >>> 16) & 255, (dados.length >>> 8) & 255, dados.length & 255];
  const c = crc32(new Uint8Array([...t, ...dados]));
  return [...len, ...t, ...dados, (c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
}

const ASSINATURA = [137, 80, 78, 71, 13, 10, 26, 10];
const pngMinimo = (extra: number[] = []) =>
  new Uint8Array([...ASSINATURA, ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), ...extra, ...chunk('IEND', [])]);

function lerChunks(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { tipo: string; dados: Uint8Array; crcOk: boolean }[] = [];
  let p = 8;
  while (p < b.length) {
    const len = v.getUint32(p);
    const tipo = String.fromCharCode(...b.slice(p + 4, p + 8));
    const dados = b.slice(p + 8, p + 8 + len);
    const crc = v.getUint32(p + 8 + len);
    out.push({ tipo, dados, crcOk: crc === crc32(b.slice(p + 4, p + 8 + len)) });
    p += 12 + len;
  }
  return out;
}

describe('definirDpiPng', () => {
  it('calcula o CRC32 padrão do PNG', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('insere pHYs com 300 dpi logo após o IHDR', async () => {
    const saida = new Uint8Array(await (await definirDpiPng(new Blob([pngMinimo()]), 300)).arrayBuffer());
    const cs = lerChunks(saida);
    expect(cs.map((c) => c.tipo)).toEqual(['IHDR', 'pHYs', 'IEND']);
    expect(cs.every((c) => c.crcOk)).toBe(true);
    const v = new DataView(cs[1].dados.buffer);
    expect(v.getUint32(0)).toBe(11811); // 300 / 0,0254 ≈ 11811 pixels por metro
    expect(v.getUint32(4)).toBe(11811);
    expect(cs[1].dados[8]).toBe(1); // unidade: metro
  });

  it('substitui um pHYs existente', async () => {
    const antigo = chunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1]);
    const saida = new Uint8Array(await (await definirDpiPng(new Blob([pngMinimo(antigo)]), 150)).arrayBuffer());
    const cs = lerChunks(saida);
    expect(cs.filter((c) => c.tipo === 'pHYs')).toHaveLength(1);
    expect(new DataView(cs[1].dados.buffer).getUint32(0)).toBe(5906);
  });

  it('devolve o arquivo sem mudança se não for PNG', async () => {
    const b = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await definirDpiPng(b, 300)).toBe(b);
  });
});
