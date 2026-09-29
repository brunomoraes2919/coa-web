// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importarShape, listarNomesZip, ShapeError } from '../src/lib/shapes';
import { criarShpPoligono, criarZipArmazenado } from './helpers/shapefile';

const anelGraus: [number, number][] = [
  [-57, -14],
  [-57, -13.99],
  [-56.99, -13.99],
  [-56.99, -14],
  [-57, -14],
];
const PRJ_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const arquivo = (nome: string, dados: Uint8Array | string = 'x') =>
  new File([typeof dados === 'string' ? dados : Uint8Array.from(dados)], nome);

/** Zip válido e cópia com o EOCD adulterado (deslocamento do diretório central). */
function zipCom(deslocamento?: number, entradas?: number): Uint8Array {
  const zip = criarZipArmazenado([
    ['talhao.shp', criarShpPoligono(anelGraus)],
    ['talhao.prj', new TextEncoder().encode(PRJ_WGS84)],
  ]);
  const view = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  if (deslocamento !== undefined) view.setUint32(eocd + 16, deslocamento, true);
  if (entradas !== undefined) {
    view.setUint16(eocd + 8, entradas, true);
    view.setUint16(eocd + 10, entradas, true);
  }
  return zip;
}

describe('importarShape: arquivos auxiliares do shapefile são ignorados em silêncio', () => {
  it('.shx, .sbn, .sbx, .qix, .qmd, .idx, .shp.xml e .cpg órfão não geram aviso', async () => {
    const r = await importarShape([
      arquivo('talhao.shp', criarShpPoligono(anelGraus)),
      arquivo('talhao.prj', PRJ_WGS84),
      arquivo('talhao.shx'),
      arquivo('talhao.sbn'),
      arquivo('talhao.sbx'),
      arquivo('talhao.qix'),
      arquivo('talhao.qmd'),
      arquivo('talhao.idx'),
      arquivo('talhao.shp.xml'),
      arquivo('outro.cpg', 'UTF-8'),
    ]);
    expect(r.feicoes).toHaveLength(1);
    expect(r.avisos).toEqual([]);
  });

  it('continua avisando sobre um formato realmente não suportado e sobre .dbf sem o .shp', async () => {
    const r = await importarShape([arquivo('talhao.shp', criarShpPoligono(anelGraus)), arquivo('talhao.prj', PRJ_WGS84), arquivo('foto.jpg'), arquivo('sobra.dbf')]);
    expect(r.avisos).toEqual(['Arquivo ignorado: foto.jpg (formato não suportado)', 'Arquivos de "sobra" ignorados: falta o .shp']);
  });
});

describe('listarNomesZip (lê só o diretório central, nunca lança RangeError)', () => {
  it('lista as entradas de um zip válido', () => {
    const zip = zipCom();
    expect(listarNomesZip(zip.buffer as ArrayBuffer)).toEqual(['talhao.shp', 'talhao.prj']);
  });

  it('devolve null para zip truncado, ZIP64 ou arquivo que não é zip', () => {
    const truncado = zipCom();
    new DataView(truncado.buffer).setUint32(truncado.length - 22 + 16, truncado.length - 2, true);
    expect(listarNomesZip(truncado.buffer as ArrayBuffer)).toBeNull();
    expect(listarNomesZip(zipCom(0xffffffff, 0xffff).buffer as ArrayBuffer)).toBeNull();
    expect(listarNomesZip(new TextEncoder().encode('não é um zip').buffer as ArrayBuffer)).toBeNull();
    expect(listarNomesZip(new ArrayBuffer(3))).toBeNull();
  });
});

describe('importarShape: .zip inválido vira ShapeError em português', () => {
  it('ZIP64 / diretório central fora do arquivo', async () => {
    const erro = await importarShape([arquivo('fazenda.zip', zipCom(0xffffffff, 0xffff))]).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ShapeError);
    expect((erro as Error).message).toMatch(/Não foi possível abrir o arquivo \.zip "fazenda\.zip"/);
  });

  it('zip sem nenhum .shp', async () => {
    const zip = criarZipArmazenado([['leia-me.txt', new TextEncoder().encode('oi')]]);
    const erro = await importarShape([arquivo('vazio.zip', zip)]).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ShapeError);
    expect((erro as Error).message).toBe('Nenhum shapefile (.shp) encontrado no arquivo .zip "vazio.zip"');
  });
});
