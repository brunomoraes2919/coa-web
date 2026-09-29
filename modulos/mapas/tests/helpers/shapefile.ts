/** Construtores de .zip e .shp mínimos para os testes de importação de shapes. */
import zlib from 'node:zlib';

/** Lê as entradas de um .zip (central directory) para simular upload de .shp/.dbf/.prj/.cpg soltos. */
export function lerEntradasZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD não encontrado no zip de teste');
  const total = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const entradas = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nomeLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const comentLen = buf.readUInt16LE(cd + 32);
    const offsetLocal = buf.readUInt32LE(cd + 42);
    const nome = buf.toString('utf8', cd + 46, cd + 46 + nomeLen);
    const localNomeLen = buf.readUInt16LE(offsetLocal + 26);
    const localExtraLen = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + localNomeLen + localExtraLen;
    const comprimidos = buf.subarray(inicio, inicio + compSize);
    entradas.set(nome, metodo === 8 ? zlib.inflateRawSync(comprimidos) : Buffer.from(comprimidos));
    cd += 46 + nomeLen + extraLen + comentLen;
  }
  return entradas;
}

/** Monta um .shp mínimo (1 polígono, 1 anel) a partir de uma lista de pontos [x, y]. */
export function criarShpPoligono(anel: [number, number][]): Uint8Array {
  const n = anel.length;
  const conteudoLen = 4 + 32 + 4 + 4 + 4 + 16 * n; // shapeType + bbox + numParts + numPoints + parts[1] + pontos
  const total = 100 + 8 + conteudoLen;
  const dv = new DataView(new ArrayBuffer(total));
  const xs = anel.map((p) => p[0]);
  const ys = anel.map((p) => p[1]);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);

  dv.setInt32(0, 9994, false);
  for (let i = 4; i <= 20; i += 4) dv.setInt32(i, 0, false);
  dv.setInt32(24, total / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, 5, true);
  dv.setFloat64(36, xmin, true);
  dv.setFloat64(44, ymin, true);
  dv.setFloat64(52, xmax, true);
  dv.setFloat64(60, ymax, true);
  dv.setFloat64(68, 0, true);
  dv.setFloat64(76, 0, true);
  dv.setFloat64(84, 0, true);
  dv.setFloat64(92, 0, true);

  dv.setInt32(100, 1, false);
  dv.setInt32(104, conteudoLen / 2, false);

  let o = 108;
  dv.setInt32(o, 5, true);
  o += 4;
  dv.setFloat64(o, xmin, true);
  o += 8;
  dv.setFloat64(o, ymin, true);
  o += 8;
  dv.setFloat64(o, xmax, true);
  o += 8;
  dv.setFloat64(o, ymax, true);
  o += 8;
  dv.setInt32(o, 1, true);
  o += 4;
  dv.setInt32(o, n, true);
  o += 4;
  dv.setInt32(o, 0, true);
  o += 4;
  for (const [x, y] of anel) {
    dv.setFloat64(o, x, true);
    o += 8;
    dv.setFloat64(o, y, true);
    o += 8;
  }
  return new Uint8Array(dv.buffer);
}

/** Monta um .zip sem compressão (STORE) a partir de pares [nome, bytes]. */
export function criarZipArmazenado(entradas: [string, Uint8Array][]): Uint8Array {
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let offset = 0;

  for (const [nome, dados] of entradas) {
    const nomeBytes = new TextEncoder().encode(nome);
    const crc = zlib.crc32(dados) >>> 0;

    const local = new DataView(new ArrayBuffer(30 + nomeBytes.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nomeBytes.length, true);
    local.setUint16(28, 0, true);
    const localBytes = new Uint8Array(local.buffer);
    localBytes.set(nomeBytes, 30);
    locais.push(localBytes, dados);

    const central = new DataView(new ArrayBuffer(46 + nomeBytes.length));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0x21, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dados.length, true);
    central.setUint32(24, dados.length, true);
    central.setUint16(28, nomeBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    const centralBytes = new Uint8Array(central.buffer);
    centralBytes.set(nomeBytes, 46);
    centrais.push(centralBytes);

    offset += localBytes.length + dados.length;
  }

  const cdOffset = offset;
  const cdSize = centrais.reduce((s, c) => s + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entradas.length, true);
  eocd.setUint16(10, entradas.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdOffset, true);

  const partes = [...locais, ...centrais, new Uint8Array(eocd.buffer)];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}
