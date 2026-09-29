import { describe, expect, it } from 'vitest';
import {
  resumoAreas,
  resumoPlantioFazenda,
  resumoSafra,
  textoContagem,
  textoManuais,
  textoPims,
} from '../src/components/safras/safrasResumo';
import type { AreaCultura, Fazenda, Plantio, PlantioPimsArquivo, PlantioPimsTalhao, Safra, StatusPlantio, Talhao } from '../src/lib/types';

const geom: Talhao['geom'] = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

const talhao = (id: string, codigo: string | null, areaHa = 10): Talhao => ({
  id,
  fazendaId: 'f1',
  nome: id,
  setor: null,
  areaHa,
  geom,
  atributos: {},
  codigo,
});

const area = (id: string, codigo: string, areaHa = 10): AreaCultura => ({ id, safraId: 's1', fazendaId: 'f1', codigo, areaHa, geom });

const pims = (codigo: string, status: StatusPlantio): PlantioPimsTalhao => ({
  codigo,
  codigoPims: codigo,
  setor: null,
  status,
  areaPrevista: 10,
  areaPlantada: status === 'a_plantar' ? 0 : 10,
  inicio: null,
  fim: null,
  variedade: null,
});

const manual = (talhaoId: string, origem: Plantio['origem'] = 'manual'): Plantio => ({
  safraId: 's1',
  talhaoId,
  dataPlantio: null,
  origem,
  status: 'plantado',
  areaPrevista: null,
  areaPlantada: null,
  inicio: null,
  fim: null,
  variedade: null,
});

const safra: Safra = { id: 's1', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '2026-09-01', fim: '2027-08-31', nomePims: null };
const fazenda = (unidadePims: string | null): Fazenda => ({
  id: 'f1',
  nome: 'Siriema',
  campoNome: 'NOME',
  campoSetor: null,
  colunas: [],
  criadoEm: '2026-01-01',
  unidadePims,
  campoCodigo: 'COD',
  coaFazendaId: null,
});

const arquivo = (talhoes: PlantioPimsTalhao[]): PlantioPimsArquivo => ({
  versao: 1,
  geradoEm: '2026-09-28T07:05:00',
  fonte: 'teste',
  safras: [{ nome: 'SOJA 26/27', unidades: [{ unidade: 'SIRIEMA', talhoes }] }],
});

describe('resumoPlantioFazenda', () => {
  it('com PIMS e áreas da cultura: conta as áreas pela situação do PIMS (a plantar sem registro) e dá o % de plantados', () => {
    const arq = arquivo([pims('001', 'plantado'), pims('002', 'plantando'), pims('003', 'a_plantar')]);
    const r = resumoPlantioFazenda({
      arquivo: arq,
      safra,
      fazenda: fazenda('SIRIEMA'),
      talhoes: [talhao('t1', '001')],
      areas: [area('a1', '001'), area('a2', '002'), area('a3', '003'), area('a4', '004')],
      plantios: [],
    });
    expect(r.fonte).toBe('pims');
    expect(r.contagem).toEqual({ plantado: 1, plantando: 1, a_plantar: 2 });
    expect(r.total).toBe(4);
    expect(r.pct).toBe(25);
    expect(r.geradoEm).toBe('2026-09-28T07:05:00');
    expect(r.manuais).toBe(0);
    expect(r.participa).toBe(true);
  });

  it('com PIMS sem áreas: talhões base; manual só nos talhões sem registro do PIMS; sem situação = a plantar', () => {
    const arq = arquivo([pims('001', 'plantado'), pims('002', 'a_plantar')]);
    const r = resumoPlantioFazenda({
      arquivo: arq,
      safra,
      fazenda: fazenda('SIRIEMA'),
      talhoes: [talhao('t1', '001'), talhao('t2', '002'), talhao('t3', '003'), talhao('t4', null)],
      areas: [],
      plantios: [manual('t2'), manual('t3'), manual('outra-fazenda')],
    });
    expect(r.fonte).toBe('pims');
    // t1 plantado (PIMS), t2 a plantar (PIMS prevalece sobre o manual), t3 plantado (manual), t4 sem situação
    expect(r.contagem).toEqual({ plantado: 2, plantando: 0, a_plantar: 2 });
    expect(r.total).toBe(4);
    expect(r.manuais).toBe(1);
  });

  it('sem dados do PIMS (sem unidade, sem arquivo ou safra ausente): fonte manual com os marcados à mão', () => {
    const talhoes = [talhao('t1', '001'), talhao('t2', '002'), talhao('t3', '003')];
    const semUnidade = resumoPlantioFazenda({ arquivo: arquivo([pims('001', 'plantado')]), safra, fazenda: fazenda(null), talhoes, areas: [], plantios: [manual('t1'), manual('t2')] });
    expect(semUnidade.fonte).toBe('manual');
    expect(semUnidade.geradoEm).toBeNull();
    expect(semUnidade.manuais).toBe(2);
    expect(semUnidade.contagem).toEqual({ plantado: 2, plantando: 0, a_plantar: 1 });
    expect(semUnidade.participa).toBe(true);

    const semArquivo = resumoPlantioFazenda({ arquivo: null, safra, fazenda: fazenda('SIRIEMA'), talhoes, areas: [], plantios: [] });
    expect(semArquivo.fonte).toBe('manual');
    expect(semArquivo.manuais).toBe(0);
    expect(semArquivo.participa).toBe(false);
    expect(semArquivo.pct).toBe(0);
  });

  it('ignora plantios gravados com origem PIMS na contagem de marcados manualmente', () => {
    const r = resumoPlantioFazenda({ arquivo: null, safra, fazenda: fazenda(null), talhoes: [talhao('t1', '001')], areas: [], plantios: [manual('t1', 'pims')] });
    expect(r.manuais).toBe(0);
    expect(r.contagem.plantado).toBe(0);
  });

  it('fazenda sem talhões nem áreas: total 0 e % nulo', () => {
    const r = resumoPlantioFazenda({ arquivo: null, safra, fazenda: fazenda(null), talhoes: [], areas: [], plantios: [] });
    expect(r.total).toBe(0);
    expect(r.pct).toBeNull();
  });
});

describe('textos do resumo', () => {
  it('textoPims: "PIMS dd/MM HH:mm" no fuso local; sem data → ""', () => {
    expect(textoPims('2026-09-28T07:05:00')).toBe('PIMS 28/09 07:05');
    expect(textoPims(null)).toBe('');
    expect(textoPims('inválida')).toBe('');
  });

  it('textoContagem: plural/singular', () => {
    expect(textoContagem({ plantado: 15, plantando: 2, a_plantar: 16 })).toBe('15 plantados · 2 plantando · 16 a plantar');
    expect(textoContagem({ plantado: 1, plantando: 0, a_plantar: 0 })).toBe('1 plantado · 0 plantando · 0 a plantar');
  });

  it('textoManuais: singular/plural', () => {
    expect(textoManuais(1)).toBe('1 marcado manualmente');
    expect(textoManuais(3)).toBe('3 marcados manualmente');
  });

  it('resumoAreas: quantidade, hectares e texto', () => {
    expect(resumoAreas([])).toEqual({ quantidade: 0, ha: 0, texto: 'Nenhuma área importada' });
    const uma = resumoAreas([area('a1', '001', 12.34)]);
    expect(uma.texto).toBe('1 área importada (12,3 ha)');
    const varias = resumoAreas([area('a1', '001', 1000), area('a2', '002', 234.56)]);
    expect(varias.quantidade).toBe(2);
    expect(varias.ha).toBeCloseTo(1234.56);
    expect(varias.texto).toBe('2 áreas importadas (1.234,6 ha)');
  });

  it('resumoSafra: soma só as fazendas que participam; % de plantados', () => {
    const base = { fonte: 'pims' as const, pct: null, manuais: 0, geradoEm: null };
    const r = resumoSafra([
      { ...base, contagem: { plantado: 15, plantando: 2, a_plantar: 16 }, total: 33, participa: true },
      { ...base, contagem: { plantado: 2, plantando: 2, a_plantar: 53 }, total: 57, participa: true },
      { ...base, contagem: { plantado: 0, plantando: 0, a_plantar: 200 }, total: 200, participa: false },
    ]);
    expect(r).toEqual({ plantados: 17, plantando: 4, total: 90, pct: (17 / 90) * 100, texto: 'Plantio da safra: 19% (17 de 90 talhões)' });
    expect(resumoSafra([]).texto).toBe('Plantio da safra: sem talhões com plantio');
    expect(resumoSafra([{ ...base, contagem: { plantado: 1, plantando: 0, a_plantar: 0 }, total: 1, participa: true }]).texto).toBe(
      'Plantio da safra: 100% (1 de 1 talhão)',
    );
  });
});
