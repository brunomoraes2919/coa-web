// Nota da seção do plantio do PIMS (SecaoPlantioPims): o mapa de variedade não fala de chuva.
import { describe, expect, it } from 'vitest';
import { notaDoPlantio } from '../src/components/editor/SecaoPlantioPims';

describe('notaDoPlantio', () => {
  it('mapa de chuva: a chuva média na área plantada (com e sem áreas da cultura), como sempre', () => {
    expect(notaDoPlantio(true)).toBe('O mapa pinta as áreas da cultura, e a chuva média na área plantada considera as áreas plantadas ou em plantio.');
    expect(notaDoPlantio(false)).toBe('A chuva média na área plantada considera os talhões plantados ou em plantio.');
  });
  it('mapa de variedade: a variedade do PIMS, sem falar de chuva', () => {
    expect(notaDoPlantio(true, 'variedade')).toBe('O mapa pinta as áreas da cultura, cada uma com a variedade do PIMS de mesmo código.');
    expect(notaDoPlantio(false, 'variedade')).toBe('Cada talhão sai com a variedade do plantio do PIMS.');
  });
});
