import { describe, expect, it } from 'vitest';
import { DPI_HISTORICO, identidadeMapa, LADO_MINIATURA, rotuloBaixarHistorico, tamanhoMiniatura } from '../src/lib/historico';

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
  it('é sempre guardada em 150 dpi (≈ 4 MB por mapa A3), qualquer que seja o dpi escolhido para baixar', () => {
    expect(DPI_HISTORICO).toBe(150);
  });

  it('o botão do cartão diz a resolução guardada', () => {
    expect(rotuloBaixarHistorico()).toBe('Baixar PNG (150 dpi)');
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
