// Conferência dos códigos das áreas da cultura (página "Áreas da cultura"). Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import { conferirAreas } from '../src/lib/conferenciaAreas';
import type { AreaCultura, PlantioPimsTalhao, Talhao } from '../src/lib/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (codigo: string): Talhao => ({ id: `t${codigo}`, fazendaId: 'f', nome: codigo, setor: null, areaHa: 1, geom, atributos: {}, codigo });
const area = (codigo: string): AreaCultura => ({ id: `a${codigo}`, safraId: 's', fazendaId: 'f', codigo, areaHa: 1, geom });
const pims = (...codigos: string[]) =>
  new Map<string, PlantioPimsTalhao>(
    codigos.map((c) => [c, { codigo: c, codigoPims: c, setor: null, status: 'plantado', areaPrevista: 1, areaPlantada: 1, inicio: null, fim: null, variedade: null }]),
  );

describe('conferirAreas', () => {
  const talhoes = [talhao('024'), talhao('068')];

  it('divisão que não está no shape da fazenda mas está no PIMS: só nota (casada normalmente), não alerta', () => {
    const r = conferirAreas([area('024'), area('068'), area('068A'), area('024A')], talhoes, pims('024', '068', '068A', '024A'));
    expect(r).toEqual({ semCodigo: 0, foraDoPims: [], soForaDaBase: ['068A', '024A'] });
  });

  it('código que não existe no PIMS da safra: alerta (fica "a plantar" e "Sem variedade"), mesmo se estiver no shape da fazenda', () => {
    const r = conferirAreas([area('024'), area('068'), area('099X')], talhoes, pims('024'));
    expect(r).toEqual({ semCodigo: 0, foraDoPims: ['068', '099X'], soForaDaBase: [] });
  });

  it('sem plantio do PIMS para a safra: não acusa o PIMS (null) e lista os que não estão no shape da fazenda', () => {
    const r = conferirAreas([area('024'), area('068A'), area('')], talhoes, null);
    expect(r).toEqual({ semCodigo: 1, foraDoPims: null, soForaDaBase: ['068A'] });
  });

  it('código repetido em várias áreas aparece uma vez', () => {
    const r = conferirAreas([area('068A'), area('068A'), area('077')], talhoes, pims('068A'));
    expect(r).toEqual({ semCodigo: 0, foraDoPims: ['077'], soForaDaBase: ['068A'] });
  });
});
