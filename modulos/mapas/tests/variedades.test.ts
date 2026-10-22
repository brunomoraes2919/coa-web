// Regras do mapa de variedade (src/lib/variedades.ts). Dados FICTÍCIOS.
import { describe, expect, it } from 'vitest';
import {
  chaveVariedade, COR_SEM_VARIEDADE, corAutomatica, coresDasFeicoes, coresNovas, csvVariedadePorTalhao, feicoesDoMapa, juntarCores,
  limparVariedade, PALETA_VARIEDADES, resumoDoMapaVariedade, resumoVariedades, SEM_VARIEDADE, textoItemVariedade, textosAutomaticosVariedade,
  variedadesSemCor, type FeicaoVariedade,
  comerciaisDe, emUsoSemNome, nomeExibido, novasSemNome, semNomeNoMapa,
} from '../src/lib/variedades';
import type { AreaCultura, Plantio, PlantioPimsTalhao, Talhao, VariedadePims } from '../src/lib/types';

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
    expect(csv).toBe('Talhão;Setor;Variedade;Nome comercial;Área (ha)\r\n002;;"TMG; 2383";;10,00\r\n010;;Sem variedade;;2,50');
  });
  it('CSV dos talhões: o nome comercial em coluna própria', () => {
    const csv = csvVariedadePorTalhao([feicao('a', 'TMG 2383', 10, '002')], new Map([['TMG 2383', 'Bônus']]));
    expect(csv.split('\r\n')[1]).toBe('002;;TMG 2383;Bônus;10,00');
  });
});

describe('nome comercial', () => {
  const variedade = (chave: string, emUso: boolean, nomeComercial: string | null, vistoEm = '2026-10-20T10:00:00Z', talhoes = 1): VariedadePims => ({
    chave, nomePims: chave, grupo: null, emUso, talhoes, ativo: true, codigos: [], vistoEm, nomeComercial, comercialEm: null,
  });

  it('nomeExibido: "Nome comercial (nome do PIMS)"; sem nome comercial, só o do PIMS', () => {
    expect(nomeExibido('80I82 IPRO', 'Bônus')).toBe('Bônus (80I82 IPRO)');
    expect(nomeExibido('80I82 IPRO', '  ')).toBe('80I82 IPRO');
    expect(nomeExibido('80I82 IPRO', null)).toBe('80I82 IPRO');
  });

  it('resumo da legenda com o nome comercial; a cor continua pela chave do PIMS', () => {
    const f = [feicao('a', 'TMG 2383', 10), feicao('b', '84KA92 CE', 5)];
    const r = resumoVariedades(f, new Map([['TMG 2383', '#1F77B4'], ['84KA92 CE', '#FF7F0E']]), new Map([['TMG 2383', 'Bônus']]));
    expect(r.itens.map((i) => [i.chave, i.nome, i.cor])).toEqual([['TMG 2383', 'Bônus (TMG 2383)', '#1F77B4'], ['84KA92 CE', '84KA92 CE', '#FF7F0E']]);
    expect(semNomeNoMapa(r, new Map([['TMG 2383', 'Bônus']]))).toEqual(['84KA92 CE']);
  });

  it('comerciaisDe e emUsoSemNome: só as em uso sem nome, das mais usadas para as menos', () => {
    const l = [variedade('A', true, null, undefined, 2), variedade('B', true, 'Bê'), variedade('C', false, null), variedade('D', true, ' ', undefined, 9)];
    expect([...comerciaisDe(l)]).toEqual([['B', 'Bê']]);
    expect(emUsoSemNome(l).map((v) => v.chave)).toEqual(['D', 'A']);
  });

  it('novasSemNome: só as que chegaram depois da primeira leitura do cadastro', () => {
    const l = [variedade('A', false, null, '2026-10-20T10:00:00Z'), variedade('B', false, null, '2026-10-20T11:00:00Z'), variedade('C', false, null, '2026-10-25T09:00:00Z'), variedade('D', false, 'Dê', '2026-10-26T09:00:00Z')];
    expect([...novasSemNome(l)]).toEqual(['C']);
    expect([...novasSemNome([])]).toEqual([]);
  });
});

describe('sementes por metro e população', () => {
  it('lê números digitados em português', async () => {
    const { lerNumeroBr, soNumeroDigitado } = await import('../src/lib/variedades');
    expect(soNumeroDigitado('12,2')).toBe('12,2');
    expect(soNumeroDigitado('244.000')).toBe('244.000');
    expect(soNumeroDigitado('12a,2 kg')).toBe('12,2');
    expect(soNumeroDigitado('abc')).toBe('');
    expect(soNumeroDigitado('-5 %')).toBe('5');
    expect(lerNumeroBr('12,2')).toBe(12.2);
    expect(lerNumeroBr('12.2')).toBe(12.2);
    expect(lerNumeroBr('244.000')).toBe(244000);
    expect(lerNumeroBr('244000')).toBe(244000);
    expect(lerNumeroBr('  ')).toBeNull();
    expect(lerNumeroBr('doze')).toBeNaN();
  });
  it('confere os limites do banco e diz qual campo está errado', async () => {
    const { validarPopulacao } = await import('../src/lib/variedades');
    expect(validarPopulacao('17,8', '355.000')).toEqual({ sementesMetro: 17.8, populacao: 355000, erro: null });
    expect(validarPopulacao('', '')).toEqual({ sementesMetro: null, populacao: null, erro: null });
    expect(validarPopulacao('150', '')).toMatchObject({ campo: 'sementes' });
    expect(validarPopulacao('12', '244')).toMatchObject({ campo: 'populacao' });
  });
  it('unidade e safra do PIMS como o Operacional grava (nome da safra no PIMS, ou o próprio nome)', async () => {
    const { chavesPimsDoMapa } = await import('../src/lib/variedades');
    expect(chavesPimsDoMapa({ unidadePims: ' sm3 ' }, { nome: 'Soja 26/27', nomePims: null })).toEqual({ unidade: 'SM3', safra: 'SOJA 26/27' });
    expect(chavesPimsDoMapa({ unidadePims: 'SM3' }, { nome: 'Soja', nomePims: 'SOJA 26/27' })).toEqual({ unidade: 'SM3', safra: 'SOJA 26/27' });
    expect(chavesPimsDoMapa({ unidadePims: null }, { nome: 'SOJA 26/27', nomePims: null })).toBeNull();
    expect(chavesPimsDoMapa({ unidadePims: 'SM3' }, null)).toBeNull();
  });
  it('o resumo da legenda leva os valores pela chave da variedade; "Sem variedade" fica sem', async () => {
    const { populacaoPorChave, temPopulacao } = await import('../src/lib/variedades');
    const f = [
      { id: 'a', nome: '001', setor: null, areaHa: 10, variedade: '80I82 IPRO' },
      { id: 'b', nome: '002', setor: null, areaHa: 5, variedade: null },
    ];
    const pop = populacaoPorChave([{ variedade: '80I82 IPRO', sementesMetro: 12.2, populacao: 244000 }]);
    const r = resumoVariedades(f as never, new Map([['80I82 IPRO', '#1F77B4']]), undefined, pop);
    expect(r.itens.map((i) => [i.chave, i.sementesMetro, i.populacao])).toEqual([['80I82 IPRO', 12.2, 244000], ['', null, null]]);
    expect(temPopulacao(r)).toBe(true);
    expect(temPopulacao(resumoVariedades(f as never, new Map()))).toBe(false);
  });
});
