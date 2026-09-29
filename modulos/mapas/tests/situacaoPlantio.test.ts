import { describe, expect, it } from 'vitest';
import {
  fmtDataHora,
  fmtDataIso,
  fmtPct,
  ordenarComSituacao,
  pctPlantado,
  resumoContagem,
  resumoPlantioPagina,
  situacaoDoMapa,
  unidadesDoArquivo,
} from '../src/lib/situacaoPlantio';
import type { AreaCultura, Plantio, PlantioPimsArquivo, PlantioPimsTalhao, StatusPlantio, Talhao, TalhaoStats } from '../src/lib/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (id: string, codigo: string | null): Talhao => ({ id, fazendaId: 'f', nome: id.toUpperCase(), setor: null, areaHa: 10, geom, atributos: {}, codigo });
const area = (id: string, codigo: string): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo, areaHa: 5, geom });
const plantio = (talhaoId: string, status: StatusPlantio, origem: 'pims' | 'manual' = 'pims', prev: number | null = 100, plant: number | null = 50): Plantio => ({
  safraId: 's',
  talhaoId,
  dataPlantio: null,
  origem,
  status,
  areaPrevista: prev,
  areaPlantada: plant,
  inicio: null,
  fim: null,
  variedade: null,
});
const pims = (codigo: string, status: StatusPlantio): PlantioPimsTalhao => ({
  codigo,
  codigoPims: codigo,
  setor: null,
  status,
  areaPrevista: 100,
  areaPlantada: status === 'plantado' ? 100 : status === 'plantando' ? 40 : 0,
  inicio: null,
  fim: null,
  variedade: null,
});

describe('formatação', () => {
  it('fmtDataHora: dd/MM/yyyy HH:mm (ou curta dd/MM HH:mm) no fuso local; inválida → ""', () => {
    expect(fmtDataHora('2026-09-28T07:05:00')).toBe('28/09/2026 07:05');
    expect(fmtDataHora('2026-09-28T07:05:00', true)).toBe('28/09 07:05');
    expect(fmtDataHora(null)).toBe('');
    expect(fmtDataHora('xx')).toBe('');
  });

  it('fmtDataIso: yyyy-mm-dd → dd/mm/yyyy; vazio → —', () => {
    expect(fmtDataIso('2026-10-02')).toBe('02/10/2026');
    expect(fmtDataIso(null)).toBe('—');
  });

  it('pctPlantado e fmtPct', () => {
    expect(pctPlantado(208, 228)).toBeCloseTo(91.23, 2);
    expect(pctPlantado(120, 100)).toBe(100);
    expect(pctPlantado(null, 100)).toBeNull();
    expect(pctPlantado(10, 0)).toBeNull();
    expect(fmtPct(91.23)).toBe('91%');
    expect(fmtPct(0.4)).toBe('<1%');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(null)).toBe('—');
  });

  it('resumoContagem: plural/singular e data curta do PIMS', () => {
    expect(resumoContagem({ plantado: 3, plantando: 1, a_plantar: 20 }, '2026-09-28T07:05:00')).toBe('3 plantados · 1 plantando · 20 a plantar (PIMS 28/09 07:05)');
    expect(resumoContagem({ plantado: 1, plantando: 0, a_plantar: 0 }, null)).toBe('1 plantado · 0 plantando · 0 a plantar');
  });
});

describe('situacaoDoMapa', () => {
  const talhoes = [talhao('a', '001'), talhao('b', '002'), talhao('c', '003'), talhao('d', null)];

  it('sem áreas da cultura: situação dos talhões base (PIMS ou manual) e plantados = plantado + plantando', () => {
    const efetivos = [plantio('a', 'plantado'), plantio('b', 'plantando'), plantio('c', 'a_plantar'), plantio('d', 'plantado', 'manual', null, null)];
    const r = situacaoDoMapa(talhoes, [], efetivos);
    expect(r.usaAreas).toBe(false);
    expect([...r.situacoes]).toEqual([
      ['a', 'plantado'],
      ['b', 'plantando'],
      ['c', 'a_plantar'],
      ['d', 'plantado'],
    ]);
    expect([...r.plantadosBase].sort()).toEqual(['a', 'b', 'd']);
    expect(r.contagem).toEqual({ plantado: 2, plantando: 1, a_plantar: 1 });
    expect(r.porTalhao.get('b')).toMatchObject({ status: 'plantando', origem: 'pims', pct: 50 });
    expect(r.porTalhao.get('d')).toMatchObject({ status: 'plantado', origem: 'manual', pct: null });
  });

  it('com áreas da cultura: pinta as áreas pelo código (PIMS; sem registro = a plantar) e o talhão base conta como plantado', () => {
    const areas = [area('x1', '001'), area('x2', '001'), area('y', '002'), area('z', '099'), area('w', '')];
    const mapa = new Map([
      ['001', pims('001', 'plantado')],
      ['002', pims('002', 'plantando')],
    ]);
    // talhão 'c' tem só plantio manual; nenhuma área com o código dele
    const efetivos = [plantio('a', 'plantado'), plantio('b', 'plantando'), plantio('c', 'plantado', 'manual')];
    const r = situacaoDoMapa(talhoes, areas, efetivos, mapa);
    expect(r.usaAreas).toBe(true);
    expect([...r.situacoes]).toEqual([
      ['x1', 'plantado'],
      ['x2', 'plantado'],
      ['y', 'plantando'],
      ['z', 'a_plantar'],
      ['w', 'a_plantar'],
    ]);
    expect(r.contagem).toEqual({ plantado: 2, plantando: 1, a_plantar: 2 });
    expect([...r.plantadosBase].sort()).toEqual(['a', 'b', 'c']);
  });

  it('com áreas: área sem talhão base do mesmo código entra em plantadosBase (se plantada/plantando) e em porTalhao', () => {
    const mapa = new Map([
      ['046', { ...pims('046', 'plantando'), areaPlantada: 25 }],
      ['047', pims('047', 'a_plantar')],
    ]);
    const r = situacaoDoMapa([talhao('a', '001')], [area('x', '046'), area('y', '047'), area('z', '')], [], mapa);
    expect([...r.plantadosBase]).toEqual(['x']);
    expect(r.porTalhao.get('x')).toEqual({ status: 'plantando', origem: 'pims', pct: 25, areaCultura: true });
    expect(r.porTalhao.get('z')).toEqual({ status: 'a_plantar', origem: 'manual', pct: null, areaCultura: true });
    expect(r.porTalhao.has('a')).toBe(false);
  });

  it('plantadosAreas: ids das áreas da cultura plantadas ou plantando (vazio sem áreas)', () => {
    const mapa = new Map([
      ['001', pims('001', 'plantado')],
      ['046', pims('046', 'plantando')],
      ['047', pims('047', 'a_plantar')],
    ]);
    const r = situacaoDoMapa([talhao('a', '001')], [area('x', '001'), area('y', '046'), area('z', '047'), area('w', '')], [], mapa);
    expect([...r.plantadosAreas].sort()).toEqual(['x', 'y']);
    expect(situacaoDoMapa(talhoes, [], [plantio('a', 'plantado')]).plantadosAreas.size).toBe(0);
  });

  it('com áreas: plantio manual do talhão base vale para a área do mesmo código (sem PIMS)', () => {
    const r = situacaoDoMapa([talhao('a', '001')], [area('x', '1')], [plantio('a', 'plantado', 'manual')], null);
    expect(r.situacoes.get('x')).toBe('plantado');
  });

  it('com áreas: talhão base sem plantio próprio conta como plantado se uma área do mesmo código está plantando', () => {
    const r = situacaoDoMapa([talhao('a', '001')], [area('x', '001')], [], new Map([['001', pims('001', 'plantando')]]));
    expect([...r.plantadosBase]).toEqual(['a']);
  });
});

describe('resumoPlantioPagina', () => {
  it('talhões base (PIMS ou marcação manual) + códigos do PIMS que só existem como área da cultura', () => {
    const talhoes = [talhao('a', '001'), talhao('b', '002'), talhao('c', null)];
    const areas = [area('x', '001'), area('y', '023A'), area('y2', '023A'), area('z', '099'), area('w', '')];
    const mapa = new Map([
      ['001', pims('001', 'plantado')],
      ['023A', pims('023A', 'plantando')],
      ['050', pims('050', 'plantado')], // sem polígono: não conta
    ]);
    const r = resumoPlantioPagina(talhoes, areas, mapa, new Set(['c']));
    // a (PIMS plantado, 100 ha) + c (manual, 10 ha) + 023A (só área, plantando, 40 ha, contado uma vez)
    expect(r.contagem).toEqual({ plantado: 2, plantando: 1, a_plantar: 0 });
    expect(r.ha).toBe(150);
  });

  it('sem PIMS: só a marcação manual', () => {
    const r = resumoPlantioPagina([talhao('a', '001'), talhao('b', '002')], [area('x', '046')], null, new Set(['b']));
    expect(r).toEqual({ contagem: { plantado: 1, plantando: 0, a_plantar: 0 }, ha: 10 });
  });
});

describe('ordenarComSituacao', () => {
  const linha = (id: string, nome: string): TalhaoStats => ({ talhaoId: id, nome, setor: null, plantado: false, media: 1, min: 1, max: 1, areaHa: 1 });
  const linhas = [linha('a', 'A'), linha('b', 'B'), linha('c', 'C')];
  const info = new Map([
    ['a', { status: 'a_plantar' as const, origem: 'pims' as const, pct: 0 }],
    ['b', { status: 'plantado' as const, origem: 'pims' as const, pct: 100 }],
  ]);

  it('situação: plantado, plantando, a plantar, sem situação', () => {
    expect(ordenarComSituacao(linhas, 'situacao', true, info).map((l) => l.talhaoId)).toEqual(['b', 'a', 'c']);
    expect(ordenarComSituacao(linhas, 'situacao', false, info).map((l) => l.talhaoId)).toEqual(['c', 'a', 'b']);
  });

  it('% plantado: sem valor por último', () => {
    expect(ordenarComSituacao(linhas, 'pct', false, info).map((l) => l.talhaoId)).toEqual(['b', 'a', 'c']);
  });

  it('demais colunas: mesma ordem de ordenarTalhoes', () => {
    expect(ordenarComSituacao(linhas, 'nome', false, info).map((l) => l.talhaoId)).toEqual(['c', 'b', 'a']);
  });
});

describe('unidadesDoArquivo', () => {
  it('unidades distintas de todas as safras, em ordem alfabética', () => {
    const arq: PlantioPimsArquivo = {
      versao: 1,
      geradoEm: '',
      fonte: '',
      safras: [
        { nome: 'A', unidades: [{ unidade: 'SIRIEMA', talhoes: [] }, { unidade: 'DOURADO', talhoes: [] }] },
        { nome: 'B', unidades: [{ unidade: 'SIRIEMA', talhoes: [] }] },
      ],
    };
    expect(unidadesDoArquivo(arq)).toEqual(['DOURADO', 'SIRIEMA']);
    expect(unidadesDoArquivo(null)).toEqual([]);
  });
});
