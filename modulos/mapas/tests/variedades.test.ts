// Regras do mapa de variedade (src/lib/variedades.ts). Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import {
  chaveVariedade, COR_SEM_VARIEDADE, corAutomatica, coresDasFeicoes, coresNovas, csvVariedadePorTalhao, feicoesDoMapa, juntarCores,
  limparVariedade, PALETA_VARIEDADES, resumoDoMapaVariedade, resumoVariedades, SEM_VARIEDADE, textoItemVariedade, textosAutomaticosVariedade,
  variedadesSemCor, type FeicaoVariedade,
} from '../src/lib/variedades';
import type { AreaCultura, Plantio, PlantioPimsTalhao, Talhao } from '../src/lib/types';

const geom = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const talhao = (id: string, codigo: string | null, areaHa: number, setor: string | null = 'S1'): Talhao =>
  ({ id, fazendaId: 'f', nome: codigo ?? id, setor, areaHa, geom, atributos: {}, codigo });
const area = (id: string, codigo: string, areaHa: number): AreaCultura => ({ id, safraId: 's', fazendaId: 'f', codigo, areaHa, geom });
const pims = (codigo: string, variedade: string | null): PlantioPimsTalhao =>
  ({ codigo, codigoPims: codigo, setor: null, status: 'plantado', areaPrevista: 1, areaPlantada: 1, inicio: null, fim: null, variedade });
const efetivo = (talhaoId: string, variedade: string | null): Plantio =>
  ({ safraId: 's', talhaoId, dataPlantio: null, origem: 'pims', status: 'plantado', areaPrevista: null, areaPlantada: null, inicio: null, fim: null, variedade });
const feicao = (id: string, variedade: string | null, areaHa: number, nome = id): FeicaoVariedade => ({ id, nome, setor: null, areaHa, variedade });

describe('limparVariedade e chaveVariedade', () => {
  it('tira o prefixo da semente e o sufixo da cultura, como o Operacional', () => {
    expect(limparVariedade('SEMENTE DE SOJA 84KA92 CE')).toBe('84KA92 CE');
    expect(limparVariedade('SEMENTE MILHO  DKB  360 ')).toBe('DKB 360');
    expect(limparVariedade('TMG 2383 SOJA')).toBe('TMG 2383');
  });
  it('vazio e "A DEFINIR" (com ou sem a cultura) viram null', () => {
    for (const v of [null, undefined, '', '   ', 'A DEFINIR', 'A DEFINIR SOJA', 'a definir']) expect(limparVariedade(v)).toBeNull();
  });
  it('a chave junta grafias com maiúsculas/minúsculas e espaços diferentes', () => {
    expect(chaveVariedade(' 84ka92  ce')).toBe('84KA92 CE');
    expect(chaveVariedade('84KA92 CE')).toBe(chaveVariedade('84ka92 ce'));
  });
});

describe('feicoesDoMapa', () => {
  it('sem áreas da cultura: os talhões base, com a variedade do plantio efetivo ou do PIMS pelo código', () => {
    const talhoes = [talhao('t1', '001', 10), talhao('t2', '002', 5), talhao('t3', null, 2)];
    const porCodigo = new Map([['002', pims('002', 'SEMENTE DE SOJA 84KA92 CE')]]);
    const f = feicoesDoMapa(talhoes, [], [efetivo('t1', 'TMG 2383 SOJA'), efetivo('t2', null)], porCodigo);
    expect(f.map((x) => [x.id, x.variedade, x.areaHa])).toEqual([['t1', 'TMG 2383', 10], ['t2', '84KA92 CE', 5], ['t3', null, 2]]);
  });
  it('com áreas da cultura: as áreas, com a variedade do PIMS pelo código e o nome e setor do talhão base', () => {
    const talhoes = [talhao('t1', '01PIVO', 100, 'NORTE')];
    const areas = [area('a1', '01PIVO', 40), area('a2', '099', 3)];
    const f = feicoesDoMapa(talhoes, areas, [], new Map([['01PIVO', pims('01PIVO', 'A DEFINIR SOJA')], ['099', pims('099', 'NEO 790')]]));
    expect(f).toEqual([
      { id: 'a1', nome: '01PIVO', setor: 'NORTE', areaHa: 40, variedade: null },
      { id: 'a2', nome: '099', setor: null, areaHa: 3, variedade: 'NEO 790' },
    ]);
  });
});

describe('cores', () => {
  it('corAutomatica: a primeira da paleta que ninguém usa; esgotada, volta ao começo; nunca o cinza', () => {
    expect(corAutomatica([])).toBe(PALETA_VARIEDADES[0]);
    expect(corAutomatica([PALETA_VARIEDADES[0].toLowerCase(), PALETA_VARIEDADES[2]])).toBe(PALETA_VARIEDADES[1]);
    expect(corAutomatica(PALETA_VARIEDADES)).toBe(PALETA_VARIEDADES[0]);
    expect(PALETA_VARIEDADES).not.toContain(COR_SEM_VARIEDADE);
    expect(new Set(PALETA_VARIEDADES).size).toBe(20);
  });
  it('paleta esgotada: a cor menos usada (na ordem da paleta), sem repetir a mesma cor para todas', () => {
    expect(corAutomatica([...PALETA_VARIEDADES, PALETA_VARIEDADES[0]])).toBe(PALETA_VARIEDADES[1]);
    expect(corAutomatica([...PALETA_VARIEDADES, PALETA_VARIEDADES[0], PALETA_VARIEDADES[1]])).toBe(PALETA_VARIEDADES[2]);
    // 18 cores em uso e 5 variedades novas: as 2 livres e depois o começo da paleta, uma de cada
    const existentes = new Map(PALETA_VARIEDADES.slice(0, 18).map((c, i) => [`V${i}`, c]));
    expect([...coresNovas(['A', 'B', 'C', 'D', 'E'], existentes).values()]).toEqual([
      PALETA_VARIEDADES[18], PALETA_VARIEDADES[19], PALETA_VARIEDADES[0], PALETA_VARIEDADES[1], PALETA_VARIEDADES[2],
    ]);
  });
  it('coresNovas: uma cor diferente para cada variedade nova, contando as que acabou de dar', () => {
    const existentes = new Map([['A', PALETA_VARIEDADES[0]]]);
    expect([...coresNovas(['B', 'C'], existentes)]).toEqual([['B', PALETA_VARIEDADES[1]], ['C', PALETA_VARIEDADES[2]]]);
  });
  it('variedadesSemCor: chaves sem cor, da maior área para a menor, sem "Sem variedade"', () => {
    const f = [feicao('1', 'B', 1), feicao('2', 'C', 5), feicao('3', null, 9), feicao('4', 'A', 7), feicao('5', 'b', 3)];
    expect(variedadesSemCor(f, new Map([['A', '#000000']]))).toEqual(['C', 'B']);
  });
  it('juntarCores: as cores do mapa salvo prevalecem sobre o cadastro (mapa reaberto depois de a cor mudar)', () => {
    const cadastro = new Map([['A', '#111111'], ['B', '#222222']]);
    expect([...juntarCores(cadastro, { A: '#999999' })]).toEqual([['A', '#999999'], ['B', '#222222']]);
    expect([...juntarCores(cadastro, null)]).toEqual([...cadastro]);
  });
});

describe('resumoVariedades', () => {
  it('soma por variedade, ordena pela área, "Sem variedade" por último em cinza, e calcula o %', () => {
    const f = [feicao('1', 'TMG 2383', 30), feicao('2', '84KA92 CE', 50), feicao('3', null, 20), feicao('4', '84ka92 ce', 0)];
    const r = resumoVariedades(f, new Map([['TMG 2383', '#1F77B4'], ['84KA92 CE', '#FF7F0E']]));
    expect(r.totalHa).toBe(100);
    expect(r.itens.map((i) => [i.chave, i.nome, i.cor, i.areaHa, i.pct, i.talhoes])).toEqual([
      ['84KA92 CE', '84KA92 CE', '#FF7F0E', 50, 50, 2],
      ['TMG 2383', 'TMG 2383', '#1F77B4', 30, 30, 1],
      ['', SEM_VARIEDADE, COR_SEM_VARIEDADE, 20, 20, 1],
    ]);
    expect([...coresDasFeicoes(f, r)]).toEqual([['1', '#1F77B4'], ['2', '#FF7F0E'], ['3', COR_SEM_VARIEDADE], ['4', '#FF7F0E']]);
  });
  it('texto da legenda com milhar e % (fração abaixo de 1%)', () => {
    expect(textoItemVariedade({ chave: 'X', nome: '84KA92 CE', cor: '#000000', areaHa: 1234.4, pct: 32.4, talhoes: 3 })).toBe('84KA92 CE — 1.234 ha (32%)');
    expect(textoItemVariedade({ chave: 'Y', nome: 'NEO 790', cor: '#000000', areaHa: 12.34, pct: 0.42, talhoes: 1 })).toBe('NEO 790 — 12,3 ha (0,4%)');
  });
});

describe('textos, resumo salvo e CSV', () => {
  it('textos automáticos: título de variedades, fonte PIMS, sem período', () => {
    const t = textosAutomaticosVariedade({ fazenda: 'Globo', safra: { id: 's', nome: 'SOJA 26/27', cultura: 'SOJA', anoSafra: '26/27', inicio: '', fim: '', nomePims: null }, setores: ['S2', 'S1'], hoje: new Date(2026, 9, 15) });
    expect(t).toEqual({ titulo: 'MAPA DE VARIEDADES', fazenda: 'GLOBO', safra: 'SOJA 26/27', periodo: '', fonte: 'PIMS', talhoes: 'TODOS', setor: 'S2, S1', observacao: '', data: '15/10/2026' });
  });
  it('resumo do mapa salvo: campos de chuva zerados e as variedades junto', () => {
    const r = { totalHa: 5, itens: [] };
    expect(resumoDoMapaVariedade(r)).toEqual({ geral: { media: 0, min: 0, max: 0, areaHa: 5 }, plantado: null, talhoes: [], variedades: r });
  });
  it('CSV dos talhões: ordem pelo nome (numérica), ";" e vírgula decimal', () => {
    const csv = csvVariedadePorTalhao([feicao('b', null, 2.5, '010'), feicao('a', 'TMG; 2383', 10, '002')]);
    expect(csv).toBe('Talhão;Setor;Variedade;Área (ha)\r\n002;;"TMG; 2383";10,00\r\n010;;Sem variedade;2,50');
  });
});
