import { describe, expect, it } from 'vitest';
import { criarSupabaseRepo } from '../src/data/supabaseRepo';
import { BancoFalso } from './helpers/supabaseFalso';
import { avisoDoPeriodo, chaveFazendaZeus, dataSugerida, situacaoDaFazenda, textoSituacao, type SituacaoZeus } from '../src/lib/situacaoZeus';

const LISTA: SituacaoZeus[] = [
  { fazenda: 'GLOBO', ultimoDia: '2026-10-04', ultimaHora: '07:00', conferidoEm: '2026-10-06T11:17:00.000Z' },
  { fazenda: 'SM3', ultimoDia: '2026-10-05', ultimaHora: '23:45', conferidoEm: '2026-10-06T11:17:00.000Z' },
  { fazenda: 'TRES FLECHAS', ultimoDia: '2026-10-05', ultimaHora: '23:00', conferidoEm: '2026-10-06T11:17:00.000Z' },
];
/** 06/10/2026 08:30 no horário local */
const AGORA = new Date(2026, 9, 6, 8, 30, 0);

describe('situação da ZEUS no banco (último dia com leitura)', () => {
  it('casa a fazenda do mapa com a da ZEUS sem prefixo, acento nem caixa (a mesma regra do servidor)', () => {
    expect(chaveFazendaZeus('Fazenda Três Flechas')).toBe('TRES FLECHAS');
    expect(chaveFazendaZeus('Faz_SM3')).toBe('SM3');
    expect(chaveFazendaZeus('Faz. Globo')).toBe('GLOBO');
    expect(chaveFazendaZeus('  dourado ')).toBe('DOURADO');
    expect(chaveFazendaZeus(null)).toBe('');
  });

  it('com a fazenda escolhida, vale o último dia dela', () => {
    expect(situacaoDaFazenda(LISTA, 'Fazenda Globo')).toEqual({ ultimoDia: '2026-10-04', ultimaHora: '07:00', conferidoEm: '2026-10-06T11:17:00.000Z', daFazenda: true });
    expect(situacaoDaFazenda(LISTA, 'SM3')?.ultimoDia).toBe('2026-10-05');
  });

  it('sem fazenda escolhida, mostra a leitura mais recente entre todas', () => {
    expect(situacaoDaFazenda(LISTA, null)).toEqual({ ultimoDia: '2026-10-05', ultimaHora: '23:45', conferidoEm: '2026-10-06T11:17:00.000Z', daFazenda: false });
  });

  it('fazenda que a ZEUS não conhece, ou lista vazia: nada a mostrar', () => {
    expect(situacaoDaFazenda(LISTA, 'Fazenda Nova')).toBeNull();
    expect(situacaoDaFazenda([], 'SM3')).toBeNull();
    expect(situacaoDaFazenda([], null)).toBeNull();
  });

  it('o texto diz até que dia há dados e quando isso foi conferido', () => {
    const conferido = new Date(2026, 9, 6, 8, 17, 0).toISOString();
    expect(textoSituacao({ ultimoDia: '2026-10-05', ultimaHora: '23:00', conferidoEm: conferido, daFazenda: true }, AGORA)).toEqual({
      dia: '05/10/2026 às 23:00',
      quando: 'ontem',
      conferido: 'conferido hoje às 08:17',
      atrasado: false,
    });
    expect(textoSituacao({ ultimoDia: '2026-10-06', ultimaHora: '07:00', conferidoEm: conferido, daFazenda: true }, AGORA).quando).toBe('hoje');
  });

  it('sem a hora da leitura (identificador fora do padrão), mostra só o dia', () => {
    const conferido = new Date(2026, 9, 6, 8, 17, 0).toISOString();
    expect(textoSituacao({ ultimoDia: '2026-10-05', ultimaHora: null, conferidoEm: conferido, daFazenda: true }, AGORA).dia).toBe('05/10/2026');
  });

  it('dados parados há mais de um dia ficam marcados como atrasados', () => {
    const conferido = new Date(2026, 9, 5, 22, 17, 0).toISOString();
    expect(textoSituacao({ ultimoDia: '2026-10-03', ultimaHora: '23:00', conferidoEm: conferido, daFazenda: true }, AGORA)).toEqual({
      dia: '03/10/2026 às 23:00',
      quando: 'há 3 dias',
      conferido: 'conferido em 05/10 às 22:17',
      atrasado: true,
    });
  });

  it('avisa quando o período pedido passa do último dia que a ZEUS tem', () => {
    expect(avisoDoPeriodo('2026-10-05', '2026-10-05')).toBeNull();
    expect(avisoDoPeriodo('2026-10-04', '2026-10-05')).toBeNull();
    expect(avisoDoPeriodo('2026-10-06', '2026-10-05')).toBe('A ZEUS só tem dados no banco até 05/10/2026: a chuva de 06/10/2026 ainda não chegou e não entra no total.');
    expect(avisoDoPeriodo('2026-10-08', '2026-10-05')).toBe('A ZEUS só tem dados no banco até 05/10/2026: a chuva de 06/10/2026 em diante ainda não chegou e não entra no total.');
    expect(avisoDoPeriodo('2026-10-06', null)).toBeNull();
    expect(avisoDoPeriodo('', '2026-10-05')).toBeNull();
  });

  it('avisa quando o último dia pedido ainda está pela metade na ZEUS', () => {
    expect(avisoDoPeriodo('2026-10-06', '2026-10-06', '07:00')).toBe('A ZEUS só tem leituras de 06/10/2026 até as 07:00: o total desse dia ainda está incompleto.');
    // dia fechado (a última leitura do dia é às 23:00, ou 23:45 nos PICs de 15 em 15 min) ou período que termina antes
    expect(avisoDoPeriodo('2026-10-05', '2026-10-05', '23:00')).toBeNull();
    expect(avisoDoPeriodo('2026-10-05', '2026-10-05', '23:45')).toBeNull();
    expect(avisoDoPeriodo('2026-10-05', '2026-10-06', '07:00')).toBeNull();
    expect(avisoDoPeriodo('2026-10-06', '2026-10-06', null)).toBeNull();
  });

  it('a data sugerida na janela é ontem, ou o último dia da ZEUS se ele for anterior', () => {
    expect(dataSugerida('2026-10-05', '2026-10-05')).toBe('2026-10-05');
    expect(dataSugerida('2026-10-05', '2026-10-03')).toBe('2026-10-03');
    expect(dataSugerida('2026-10-05', '2026-10-06')).toBe('2026-10-05');
    expect(dataSugerida('2026-10-05', null)).toBe('2026-10-05');
  });
});

describe('repositório: situação da ZEUS (mapas_zeus_situacao)', () => {
  it('lê as linhas gravadas pelo servidor, com a hora da última leitura', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    banco.tabelas.mapas_zeus_situacao.push(
      { fazenda: 'SM3', ultimo_dia: '2026-10-05', ultima_leitura: '2026-10-05T23:45:00', conferido_em: '2026-10-06T11:17:00+00:00' },
      { fazenda: 'GLOBO', ultimo_dia: '2026-10-05', ultima_leitura: null, conferido_em: '2026-10-06T11:17:00+00:00' },
      // hora de outro dia: fica só o dia
      { fazenda: 'DOURADO', ultimo_dia: '2026-10-05', ultima_leitura: '2026-10-04T23:00:00', conferido_em: '2026-10-06T11:17:00+00:00' },
      { fazenda: 'QUEBRADA', ultimo_dia: null, conferido_em: '2026-10-06T11:17:00+00:00' },
    );
    expect(await criarSupabaseRepo(banco.cliente()).situacaoZeus()).toEqual([
      { fazenda: 'SM3', ultimoDia: '2026-10-05', ultimaHora: '23:45', conferidoEm: '2026-10-06T11:17:00+00:00' },
      { fazenda: 'GLOBO', ultimoDia: '2026-10-05', ultimaHora: null, conferidoEm: '2026-10-06T11:17:00+00:00' },
      { fazenda: 'DOURADO', ultimoDia: '2026-10-05', ultimaHora: null, conferidoEm: '2026-10-06T11:17:00+00:00' },
    ]);
  });

  it('sem a tabela (script 0004 não aplicado) é só não mostrar o aviso: devolve [] sem lançar', async () => {
    const banco = new BancoFalso();
    banco.sessao = { user: { id: 'u1' } };
    delete (banco.tabelas as Record<string, unknown>).mapas_zeus_situacao;
    expect(await criarSupabaseRepo(banco.cliente()).situacaoZeus()).toEqual([]);
  });
});
