import { describe, expect, it } from 'vitest';
import { aparenciaDoMapaSalvo, avisosPeriodoSafra, avisosPicsDistantes, csvChuvaPorTalhao, layoutPadrao, textosAutomaticos } from '../src/lib/editor';
import type { Pic, Safra, Talhao } from '../src/lib/types';

const talhao = (id: string, lon: number, lat: number, d = 0.01): Talhao => ({
  id,
  fazendaId: 'f',
  nome: id.toUpperCase(),
  setor: null,
  areaHa: 100,
  atributos: {},
  codigo: null,
  geom: { type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] },
});
const pic = (nome: string, lon: number, lat: number): Pic => ({
  id: nome,
  nome,
  lon,
  lat,
  chuva: 10,
  inativo: false,
  inicio: null,
  fim: null,
  incluir: true,
});
const safra: Safra = { id: 's', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-03-31', nomePims: null };

describe('textosAutomaticos', () => {
  it('preenche a partir da fazenda, safra e período do CSV', () => {
    const t = textosAutomaticos({
      fazenda: 'Guapirama',
      safra,
      periodoInicio: new Date(2026, 9, 1),
      periodoFim: new Date(2026, 9, 15),
      setores: null,
      hoje: new Date(2026, 9, 16),
    });
    expect(t).toEqual({
      titulo: 'MAPA DE PRECIPITAÇÃO',
      fazenda: 'GUAPIRAMA',
      safra: 'SOJA 26/27',
      periodo: '01 a 15/10/2026',
      fonte: 'ZEUS',
      talhoes: 'TODOS',
      setor: 'TODOS',
      observacao: '',
      data: '16/10/2026',
    });
  });
  it('lista os setores escolhidos', () => {
    const t = textosAutomaticos({ fazenda: 'x', safra: null, periodoInicio: null, periodoFim: null, setores: ['A', 'B'], hoje: new Date(2026, 0, 1) });
    expect(t.setor).toBe('A, B');
    expect(t.safra).toBe('');
  });
});

describe('avisos', () => {
  it('avisa sobre PIC a mais de 20 km da fazenda', () => {
    const talhoes = [talhao('a', -57.2, -13.8)];
    const pics = [pic('perto', -57.195, -13.795), pic('longe', -57.6, -13.8)];
    const av = avisosPicsDistantes(pics, talhoes, 20);
    expect(av).toHaveLength(1);
    expect(av[0]).toContain('longe');
  });
  it('avisa quando o período do CSV sai do período da safra', () => {
    expect(avisosPeriodoSafra(new Date(2026, 9, 1), new Date(2026, 9, 15), safra)).toEqual([]);
    expect(avisosPeriodoSafra(new Date(2026, 7, 25), new Date(2026, 8, 5), safra)[0]).toContain('SOJA 26/27');
    expect(avisosPeriodoSafra(null, null, safra)).toEqual([]);
  });
});

describe('csvChuvaPorTalhao', () => {
  it('gera CSV com ponto e vírgula e vírgula decimal (Excel pt-BR)', () => {
    const csv = csvChuvaPorTalhao([
      { talhaoId: 'a', nome: 'TH 1', setor: null, plantado: true, areaHa: 105.76, media: 12.345, min: 10, max: 15.5 },
      { talhaoId: 'b', nome: 'TH 2', setor: 'S1', plantado: false, areaHa: 0, media: NaN, min: NaN, max: NaN },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Talhão;Setor;Plantado;Situação;% plantado;Área (ha);Chuva média (mm);Chuva mínima (mm);Chuva máxima (mm)',
      'TH 1;;Sim;;;105,76;12,3;10,0;15,5',
      'TH 2;S1;Não;;;0,00;;;',
    ]);
  });

  it('colunas Situação e % plantado a partir da situação do plantio', () => {
    const situacoes = new Map([
      ['a', { status: 'plantando' as const, pct: 91.23 }],
      ['b', { status: 'a_plantar' as const, pct: null }],
    ]);
    const csv = csvChuvaPorTalhao(
      [
        { talhaoId: 'a', nome: '007', setor: null, plantado: true, areaHa: 1, media: 1, min: 1, max: 1 },
        { talhaoId: 'b', nome: '008', setor: null, plantado: false, areaHa: 1, media: 1, min: 1, max: 1 },
      ],
      situacoes,
    );
    expect(csv.split('\r\n').slice(1)).toEqual(['007;;Sim;Plantando;91;1,00;1,0;1,0;1,0', '008;;Não;A plantar;;1,00;1,0;1,0;1,0']);
  });
});

describe('layoutPadrao', () => {
  it('usa os padrões do modelo QGIS', () => {
    const l = layoutPadrao();
    expect(l.pagina).toBe('A3');
    expect(l.idw).toEqual({ potencia: 4, vizinhos: 12, pixel: 5, buffer: 10 });
    expect(l.paletaId).toBe('auto');
    expect(l.estiloPlantado).toBe('quadriculado');
    expect(l.extent).toBeNull();
  });
});

describe('aparenciaDoMapaSalvo', () => {
  const extent = { cx: 1, cy: 2, mPorMm: 3 };
  it('mapa salvo antes do layout adaptativo (sem orientação): enquadramento automático', () => {
    const { textos: _t, ...resto } = { ...layoutPadrao(), extent };
    delete (resto as { orientacao?: unknown }).orientacao;
    const a = aparenciaDoMapaSalvo({ ...resto, textos: _t });
    expect(a.extent).toBeNull();
    expect('textos' in a).toBe(false);
  });
  it('mapa novo (com orientação): mantém o enquadramento manual', () => {
    const a = aparenciaDoMapaSalvo({ ...layoutPadrao(), extent, orientacao: 'paisagem' });
    expect(a.extent).toEqual(extent);
    expect(a.orientacao).toBe('paisagem');
  });
});
