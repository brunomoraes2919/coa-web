import { describe, expect, it } from 'vitest';
import { DESTAQUES_PICS, estiloValorPic } from '../src/render/picStyle';

describe('estiloValorPic', () => {
  it('padrão e mapas antigos sem o campo usam contorno escuro', () => {
    expect(estiloValorPic(undefined)).toEqual({ texto: '#FFFFFF', halo: '#393939', caixa: null });
    expect(estiloValorPic('escuro')).toEqual(estiloValorPic(undefined));
  });
  it('vermelho e verde só trocam o contorno', () => {
    expect(estiloValorPic('vermelho').halo).toBe('#C62828');
    expect(estiloValorPic('verde').halo).toBe('#0C5A50');
    expect(estiloValorPic('verde').caixa).toBeNull();
  });
  it('etiqueta usa caixa e nenhum contorno', () => {
    const e = estiloValorPic('etiqueta');
    expect(e.halo).toBeNull();
    expect(e.caixa).toMatch(/^rgba\(/);
  });
  it('lista todas as opções para o seletor', () => {
    expect(DESTAQUES_PICS.map((d) => d.id)).toEqual(['escuro', 'vermelho', 'verde', 'etiqueta']);
  });
});
