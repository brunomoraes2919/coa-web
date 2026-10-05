import { describe, expect, it } from 'vitest';
import { dpiPermitido, limitesDoAparelho, pixelParaCaber, tipoDeAparelho } from '../src/lib/aparelho';
import { runPipeline, type PipelineInput } from '../src/lib/pipeline';
import { IDW_PADRAO } from '../src/lib/types';

const A3 = { w: 420, h: 297 };

describe('limites do aparelho (gerar o mapa no celular)', () => {
  it('reconhece iPhone, iPad que se diz Mac, Android e computador', () => {
    expect(tipoDeAparelho({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('ios');
    expect(tipoDeAparelho({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(tipoDeAparelho({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe('computador');
    expect(tipoDeAparelho({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) Chrome/126 Mobile Safari/537.36' })).toBe('movel');
    expect(tipoDeAparelho({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet)', userAgentData: { mobile: false } })).toBe('movel');
    expect(tipoDeAparelho({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36' })).toBe('computador');
    expect(tipoDeAparelho(undefined)).toBe('computador');
  });

  it('no computador nada é limitado; no celular há teto de imagem e de grade', () => {
    expect(limitesDoAparelho('computador')).toEqual({ tipo: 'computador', maxPixelsCanvas: Infinity, maxCelulas: null });
    expect(limitesDoAparelho('ios').maxPixelsCanvas).toBeLessThanOrEqual(16_777_216);
    expect(limitesDoAparelho('movel').maxCelulas).toBe(12_000_000);
  });

  it('dpi: A3 em 300 dpi não cabe no iPhone (17,4 Mpx) e desce para 280; no Android cabe; 600 nunca cabe no celular', () => {
    const ios = limitesDoAparelho('ios').maxPixelsCanvas;
    const movel = limitesDoAparelho('movel').maxPixelsCanvas;
    expect(dpiPermitido(300, A3, Infinity)).toBe(300);
    expect(dpiPermitido(600, A3, Infinity)).toBe(600);
    expect(dpiPermitido(300, A3, ios)).toBe(280);
    expect(dpiPermitido(150, A3, ios)).toBe(150);
    expect(dpiPermitido(300, A3, movel)).toBe(300);
    expect(dpiPermitido(600, A3, movel)).toBe(450);
    // a folha no dpi permitido cabe mesmo no limite
    const pxMm = dpiPermitido(600, A3, ios) / 25.4;
    expect(A3.w * pxMm * A3.h * pxMm).toBeLessThanOrEqual(ios);
    // A4 (metade da área) aguenta mais
    expect(dpiPermitido(300, { w: 297, h: 210 }, ios)).toBe(300);
  });

  it('pixel: só aumenta quando a grade não cabe, e passa a caber', () => {
    expect(pixelParaCaber(5, 6_000_000, 8_000_000)).toBe(5);
    expect(pixelParaCaber(5, 46_000_000, 8_000_000)).toBe(12);
    expect(46_000_000 * (5 / 12) ** 2).toBeLessThanOrEqual(8_000_000);
  });
});

describe('pipeline com limite de células (celular)', () => {
  // quadrado de ~2 km × 2 km perto de SM3, com 4 PICs
  const lado = 0.018;
  const [lon0, lat0] = [-54.74, -17.38];
  const inp: PipelineInput = {
    talhoes: [{ id: 't1', nome: '001', setor: null, geom: { type: 'Polygon', coordinates: [[[lon0, lat0], [lon0 + lado, lat0], [lon0 + lado, lat0 + lado], [lon0, lat0 + lado], [lon0, lat0]]] } }],
    pics: [
      { lat: lat0 + 0.002, lon: lon0 + 0.002, chuva: 10 },
      { lat: lat0 + 0.016, lon: lon0 + 0.002, chuva: 20 },
      { lat: lat0 + 0.002, lon: lon0 + 0.016, chuva: 30 },
      { lat: lat0 + 0.016, lon: lon0 + 0.016, chuva: 40 },
    ],
    params: { ...IDW_PADRAO },
    plantados: [],
  };

  it('sem limite usa o pixel pedido; com limite apertado usa um pixel maior e o resultado continua coerente', () => {
    const normal = runPipeline(inp);
    expect(normal.pixelUsado).toBe(IDW_PADRAO.pixel);
    const celulas = normal.grid.cols * normal.grid.rows;

    const folgado = runPipeline({ ...inp, maxCelulas: celulas * 2 });
    expect(folgado.pixelUsado).toBe(IDW_PADRAO.pixel);

    const apertado = runPipeline({ ...inp, maxCelulas: Math.floor(celulas / 6) });
    expect(apertado.pixelUsado).toBeGreaterThan(IDW_PADRAO.pixel);
    expect(apertado.grid.res).toBe(apertado.pixelUsado);
    expect(apertado.grid.cols * apertado.grid.rows).toBeLessThanOrEqual(Math.floor(celulas / 6));
    // a chuva média do talhão quase não muda com o pixel maior
    expect(Math.abs(apertado.resumo.geral.media - normal.resumo.geral.media)).toBeLessThan(0.3);
    expect(Math.abs(apertado.resumo.geral.areaHa - normal.resumo.geral.areaHa) / normal.resumo.geral.areaHa).toBeLessThan(0.02);
  });
});
