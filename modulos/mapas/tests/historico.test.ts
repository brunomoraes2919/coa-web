import { describe, expect, it } from 'vitest';
import {
  DPI_HISTORICO,
  extensaoImagem,
  identidadeMapa,
  LADO_MINIATURA,
  QUALIDADE_JPEG_HISTORICO,
  rotuloBaixarHistorico,
  tamanhoMiniatura,
  tipoImagem,
} from '../src/lib/historico';

const aberto = { id: 'mapa-antigo', criadoEm: '2026-01-10T12:00:00.000Z' };
const agora = new Date('2026-09-28T15:00:00.000Z');
const novoId = () => 'mapa-novo';

describe('identidadeMapa (editar um mapa reaberto não apaga o histórico)', () => {
  it('"atualizar" regrava o mapa aberto: mesmo id e mesma data de criação', () => {
    expect(identidadeMapa('atualizar', aberto, agora, novoId)).toEqual(aberto);
  });

  it('"novo" cria outro registro: id novo e criado agora (o aberto continua no histórico)', () => {
    expect(identidadeMapa('novo', aberto, agora, novoId)).toEqual({ id: 'mapa-novo', criadoEm: '2026-09-28T15:00:00.000Z' });
  });

  it('sem mapa aberto (Novo mapa), sempre cria um registro novo', () => {
    expect(identidadeMapa('atualizar', null, agora, novoId)).toEqual({ id: 'mapa-novo', criadoEm: '2026-09-28T15:00:00.000Z' });
    expect(identidadeMapa('novo', null, agora, novoId)).toEqual({ id: 'mapa-novo', criadoEm: '2026-09-28T15:00:00.000Z' });
  });
});

describe('cópia do histórico', () => {
  it('é sempre guardada em JPEG de 150 dpi, qualidade 0,9 (≈ 1 MB por mapa A3), qualquer que seja o dpi escolhido para baixar', () => {
    expect(DPI_HISTORICO).toBe(150);
    expect(QUALIDADE_JPEG_HISTORICO).toBe(0.9);
  });

  it('o botão do cartão diz o formato (pelo arquivo guardado) e a resolução', () => {
    expect(rotuloBaixarHistorico('mapas/abc.jpg')).toBe('Baixar JPEG (150 dpi)');
    expect(rotuloBaixarHistorico('abc.JPEG')).toBe('Baixar JPEG (150 dpi)');
    // mapas antigos, guardados em PNG
    expect(rotuloBaixarHistorico('abc.png')).toBe('Baixar PNG (150 dpi)');
    expect(rotuloBaixarHistorico(null)).toBe('Baixar PNG (150 dpi)');
  });

  it('extensão e tipo do arquivo seguem o tipo do blob (JPEG ou, nos demais casos, PNG)', () => {
    expect(extensaoImagem('image/jpeg')).toBe('jpg');
    expect(extensaoImagem('image/png')).toBe('png');
    expect(extensaoImagem('')).toBe('png');
    expect(tipoImagem('image/jpeg')).toBe('image/jpeg');
    expect(tipoImagem('image/png')).toBe('image/png');
    expect(tipoImagem('')).toBe('image/png');
  });
});

describe('miniatura do histórico pela orientação', () => {
  it('o lado maior tem 480 px: paisagem 480 de largura, retrato 480 de altura', () => {
    expect(tamanhoMiniatura({ w: 420, h: 297 })).toEqual({ w: 480, h: 339 });
    expect(tamanhoMiniatura({ w: 297, h: 420 })).toEqual({ w: 339, h: 480 });
    expect(tamanhoMiniatura({ w: 210, h: 297 })).toEqual({ w: 339, h: 480 });
    expect(LADO_MINIATURA).toBe(480);
  });
});
