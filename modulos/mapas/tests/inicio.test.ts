// Tela inicial do módulo: contagem do histórico e textos do rodapé dos cards. Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import { resumoHistorico, textoHistorico, textoVariedades } from '../src/lib/inicio';
import { tituloDaRota } from '../src/lib/embed';
import type { MapaSalvo, VariedadePims } from '../src/lib/types';

const mapa = (id: string, criadoEm: string, tipo?: 'chuva' | 'variedade') => ({ id, criadoEm, tipo }) as unknown as MapaSalvo;
const variedade = (chave: string, emUso: boolean, nomeComercial: string | null) => ({ chave, emUso, nomeComercial }) as unknown as VariedadePims;

describe('tela inicial do Mapas', () => {
  it('conta os mapas por tipo e acha o mais recente (mapa sem tipo = chuva)', () => {
    const l = [mapa('a', '2026-10-01T10:00:00Z'), mapa('b', '2026-10-20T12:00:00Z', 'chuva'), mapa('c', '2026-10-15T08:00:00Z', 'variedade')];
    expect(resumoHistorico(l, 'chuva')).toEqual({ total: 2, ultimo: '2026-10-20T12:00:00Z' });
    expect(resumoHistorico(l, 'variedade')).toEqual({ total: 1, ultimo: '2026-10-15T08:00:00Z' });
    expect(resumoHistorico([], 'chuva')).toEqual({ total: 0, ultimo: null });
  });
  it('texto do rodapé do histórico', () => {
    expect(textoHistorico({ total: 0, ultimo: null })).toBe('Nenhum salvo ainda');
    expect(textoHistorico({ total: 1, ultimo: '2026-10-20T15:00:00' })).toBe('1 salvo · último em 20/10');
    expect(textoHistorico({ total: 12, ultimo: '2026-03-05T15:00:00' })).toBe('12 salvos · último em 05/03');
  });
  it('texto do rodapé das variedades: só as em uso contam', () => {
    expect(textoVariedades([])).toBe('Cadastro ainda não lido do PIMS');
    expect(textoVariedades([variedade('A', true, 'X'), variedade('B', true, null), variedade('C', false, null)])).toBe('2 em uso · 1 sem nome comercial');
    expect(textoVariedades([variedade('A', true, 'X')])).toBe('1 em uso · todas com nome comercial');
  });
  it('título do COA WEB para a tela inicial', () => {
    expect(tituloDaRota('/inicio')).toBe('Mapas');
  });
});
