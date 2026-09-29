import { describe, expect, it } from 'vitest';
import { carregarPlantioEAreas } from '../src/components/editor/usePlantioMapa';
import type { AreaCultura, Plantio } from '../src/lib/types';

const plantio = { safraId: 's', talhaoId: 't', origem: 'manual', status: 'plantado' } as Plantio;
const area = { id: 'a', safraId: 's', fazendaId: 'f', codigo: '001', areaHa: 1 } as AreaCultura;

describe('carregarPlantioEAreas', () => {
  it('carrega plantio e áreas', async () => {
    const r = await carregarPlantioEAreas({ listarPlantios: async () => [plantio], listarAreasCultura: async () => [area] }, 's', 'f');
    expect(r).toEqual({ plantios: [plantio], areas: [area], erro: null });
  });

  it('sem a tabela mapas_areas_cultura (banco sem o script 0001_mapas.sql): mantém o plantio manual e avisa', async () => {
    const r = await carregarPlantioEAreas(
      {
        listarPlantios: async () => [plantio],
        listarAreasCultura: async () => {
          throw new Error('Não foi possível listar as áreas da cultura: relation "public.mapas_areas_cultura" does not exist');
        },
      },
      's',
      'f',
    );
    expect(r.plantios).toEqual([plantio]);
    expect(r.areas).toEqual([]);
    expect(r.erro).toBe('Não foi possível carregar as áreas da cultura: Banco desatualizado: rode o script supabase/coa-web/0001_mapas.sql no Supabase do COA WEB');
  });

  it('falha no plantio: erro do plantio (as áreas ainda valem)', async () => {
    const r = await carregarPlantioEAreas(
      {
        listarPlantios: async () => {
          throw new Error('Failed to fetch');
        },
        listarAreasCultura: async () => [area],
      },
      's',
      'f',
    );
    expect(r.plantios).toEqual([]);
    expect(r.areas).toEqual([area]);
    expect(r.erro).toMatch(/^Não foi possível carregar o plantio: Não foi possível conectar/);
  });
});
