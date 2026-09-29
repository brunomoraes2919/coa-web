import { describe, expect, it } from 'vitest';
import {
  decidirInterpolacao,
  entradaInterpolacao,
  ESTADO_INICIAL,
  reduzirInterpolacao,
  resultadoAtualizado,
  situacaoInterpolacao,
  type AcaoInterpolacao,
  type EstadoInterpolacao,
} from '../src/lib/interpolacaoEstado';
import type { PipelineOutput } from '../src/lib/pipeline';
import { IDW_PADRAO, type Pic, type Talhao } from '../src/lib/types';

const talhao = (id: string, nome = id.toUpperCase()): Talhao => ({
  id,
  fazendaId: 'f',
  nome,
  setor: null,
  areaHa: 1,
  atributos: {},
  codigo: null,
  geom: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});
const pic = (nome: string, chuva: number | null, incluir = true): Pic => ({
  id: nome,
  nome,
  lat: -13,
  lon: -57 + chuva! / 1000,
  chuva,
  inativo: false,
  inicio: null,
  fim: null,
  incluir,
});
/** Resultado falso: só a identidade importa aqui. */
const resultado = (nome: string) => ({ nome }) as unknown as PipelineOutput;

const aplicar = (e: EstadoInterpolacao, ...acoes: AcaoInterpolacao[]) => acoes.reduce(reduzirInterpolacao, e);
/** Faz o que o hook faz com a decisão (limpar/cancelar despacham na hora; agendar espera o debounce). */
function mudarEntradas(e: EstadoInterpolacao, chave: string) {
  const d = decidirInterpolacao(e, chave);
  if (d === 'limpar') return { d, e: aplicar(e, { tipo: 'limpar' }) };
  if (d === 'cancelar') return { d, e: aplicar(e, { tipo: 'cancelar' }) };
  return { d, e };
}
const concluido = (chave: string, r: PipelineOutput) =>
  aplicar(ESTADO_INICIAL, { tipo: 'iniciar', chave }, { tipo: 'concluir', chave, resultado: r });

describe('entradaInterpolacao', () => {
  const talhoes = [talhao('a'), talhao('b')];
  const pics = [pic('P1', 10), pic('P2', 20), pic('P3', 30), pic('P4', null, false)];

  it('não interpola sem talhões ou sem PIC com chuva marcado', () => {
    expect(entradaInterpolacao([], pics, IDW_PADRAO, [])).toBeNull();
    expect(entradaInterpolacao(talhoes, pics.map((p) => ({ ...p, incluir: false })), IDW_PADRAO, [])).toBeNull();
    expect(entradaInterpolacao(talhoes, [pic('X', null, true)], IDW_PADRAO, [])).toBeNull();
  });

  it('só manda os PICs marcados e com chuva para o pipeline', () => {
    const e = entradaInterpolacao(talhoes, pics, IDW_PADRAO, ['b'])!;
    expect(e.inp.pics.map((p) => p.chuva)).toEqual([10, 20, 30]);
    expect(e.inp.params).toEqual(IDW_PADRAO);
    expect(e.inp.plantados).toEqual(['b']);
  });

  it('áreas da cultura: manda id + geometria e as plantadas (ordenadas); sem áreas, nada novo na entrada', () => {
    const geom = talhoes[0].geom;
    const areas = [
      { id: 'x', safraId: 's', fazendaId: 'f', codigo: '001A', areaHa: 1, geom },
      { id: 'y', safraId: 's', fazendaId: 'f', codigo: '002', areaHa: 1, geom },
    ];
    const e = entradaInterpolacao(talhoes, pics, IDW_PADRAO, [], areas, new Set(['y', 'x']))!;
    expect(e.inp.areas).toEqual([
      { id: 'x', geom },
      { id: 'y', geom },
    ]);
    expect(e.inp.plantadosAreas).toEqual(['x', 'y']);
    const sem = entradaInterpolacao(talhoes, pics, IDW_PADRAO, [])!;
    expect(sem.inp.areas).toBeUndefined();
    expect(sem.inp.plantadosAreas).toBeUndefined();
    // a chave muda com as áreas e com as plantadas
    expect(e.chave).not.toBe(sem.chave);
    expect(entradaInterpolacao(talhoes, pics, IDW_PADRAO, [], areas, ['x'])!.chave).not.toBe(e.chave);
  });

  it('mesma chave para as mesmas entradas, mesmo com objetos novos e plantados em outra ordem', () => {
    const a = entradaInterpolacao(talhoes, pics, { ...IDW_PADRAO }, new Set(['a', 'b']))!;
    const b = entradaInterpolacao(talhoes.map((t) => ({ ...t })), pics.map((p) => ({ ...p })), { ...IDW_PADRAO }, new Set(['b', 'a']))!;
    expect(b.chave).toBe(a.chave);
  });

  it('chave muda quando PICs, parâmetros, plantio ou talhões mudam', () => {
    const base = entradaInterpolacao(talhoes, pics, IDW_PADRAO, [])!.chave;
    const variantes = [
      entradaInterpolacao(talhoes, pics.map((p, i) => (i === 0 ? { ...p, incluir: false } : p)), IDW_PADRAO, []),
      entradaInterpolacao(talhoes, pics.map((p, i) => (i === 0 ? { ...p, chuva: 11 } : p)), IDW_PADRAO, []),
      entradaInterpolacao(talhoes, pics, { ...IDW_PADRAO, vizinhos: 8 }, []),
      entradaInterpolacao(talhoes, pics, IDW_PADRAO, ['a']),
      entradaInterpolacao([talhoes[0]], pics, IDW_PADRAO, []),
      // renomear um talhão muda o resumo (nome na tabela "Chuva por talhão")
      entradaInterpolacao([talhao('a', 'OUTRO NOME'), talhoes[1]], pics, IDW_PADRAO, []),
    ];
    for (const v of variantes) expect(v!.chave).not.toBe(base);
  });
});

describe('interpolação após as entradas ficarem vazias (achado 1)', () => {
  it('volta a interpolar ao desmarcar todos os PICs e remarcar os mesmos', () => {
    let e = concluido('K', resultado('R'));
    expect(decidirInterpolacao(e, 'K')).toBe('manter');
    expect(situacaoInterpolacao(e, 'K')).toBe('atualizado');

    ({ e } = mudarEntradas(e, '')); // "Desmarcar todos"
    expect(e.resultado).toBeNull();
    expect(situacaoInterpolacao(e, '')).toBe('vazio');

    const { d } = mudarEntradas(e, 'K'); // "Marcar todos": exatamente as mesmas entradas
    expect(d).toBe('agendar');
  });

  it('volta a interpolar ao trocar para "Escolha…" durante a execução e voltar à mesma fazenda', () => {
    let e = aplicar(ESTADO_INICIAL, { tipo: 'iniciar', chave: 'K' });
    ({ e } = mudarEntradas(e, ''));
    expect(e.progresso).toBeNull();
    expect(decidirInterpolacao(e, 'K')).toBe('agendar');
  });

  it('ignora o resultado de uma execução que chegou depois de limpar', () => {
    let e = aplicar(ESTADO_INICIAL, { tipo: 'iniciar', chave: 'K' });
    ({ e } = mudarEntradas(e, ''));
    e = aplicar(e, { tipo: 'concluir', chave: 'K', resultado: resultado('R') });
    expect(e.resultado).toBeNull();
    expect(situacaoInterpolacao(e, '')).toBe('vazio');
  });

  it('limpar ou cancelar sem nada a fazer não cria estado novo (sem render à toa)', () => {
    expect(reduzirInterpolacao(ESTADO_INICIAL, { tipo: 'limpar' })).toBe(ESTADO_INICIAL);
    const e = concluido('K', resultado('R'));
    expect(reduzirInterpolacao(e, { tipo: 'cancelar' })).toBe(e);
  });
});

describe('resultado só vale para as entradas que o geraram (achado 2)', () => {
  it('fica desatualizado durante o debounce e a execução, e volta a valer ao concluir', () => {
    const r1 = resultado('R1');
    const r2 = resultado('R2');
    let e = concluido('K1', r1);
    expect(resultadoAtualizado(e, 'K1')).toBe(r1);

    // usuário desmarca um PIC: chave nova, debounce ainda não disparou
    let d: string;
    ({ d, e } = mudarEntradas(e, 'K2'));
    expect(d).toBe('agendar');
    expect(resultadoAtualizado(e, 'K2')).toBeNull();
    expect(situacaoInterpolacao(e, 'K2')).toBe('pendente');

    e = aplicar(e, { tipo: 'iniciar', chave: 'K2' }, { tipo: 'progresso', chave: 'K2', f: 0.5 });
    expect(e.progresso).toBe(0.5);
    expect(resultadoAtualizado(e, 'K2')).toBeNull();
    expect(e.resultado).toBe(r1); // a prévia continua mostrando o anterior enquanto calcula

    e = aplicar(e, { tipo: 'concluir', chave: 'K2', resultado: r2 });
    expect(resultadoAtualizado(e, 'K2')).toBe(r2);
    expect(situacaoInterpolacao(e, 'K2')).toBe('atualizado');
    expect(e.progresso).toBeNull();
  });

  it('não aceita o resultado nem o progresso de uma execução substituída', () => {
    let e = aplicar(ESTADO_INICIAL, { tipo: 'iniciar', chave: 'K1' }, { tipo: 'iniciar', chave: 'K2' });
    e = aplicar(e, { tipo: 'progresso', chave: 'K1', f: 0.9 });
    expect(e.progresso).toBe(0);
    e = aplicar(e, { tipo: 'concluir', chave: 'K1', resultado: resultado('R1') });
    expect(resultadoAtualizado(e, 'K2')).toBeNull();
    expect(resultadoAtualizado(e, 'K1')).toBeNull();
    expect(situacaoInterpolacao(e, 'K2')).toBe('pendente');
  });

  it('voltar às entradas do último resultado cancela a execução em andamento e reaproveita o resultado', () => {
    const r1 = resultado('R1');
    let e = aplicar(concluido('K1', r1), { tipo: 'iniciar', chave: 'K2' });
    expect(resultadoAtualizado(e, 'K1')).toBeNull(); // algo rodando: ainda não
    let d: string;
    ({ d, e } = mudarEntradas(e, 'K1'));
    expect(d).toBe('cancelar');
    expect(e.progresso).toBeNull();
    expect(resultadoAtualizado(e, 'K1')).toBe(r1);
    expect(decidirInterpolacao(e, 'K1')).toBe('manter');
  });

  it('erro zera o progresso, vale só para as entradas que falharam e não repete sozinho', () => {
    let e = aplicar(concluido('K0', resultado('R0')), { tipo: 'iniciar', chave: 'K' });
    e = aplicar(e, { tipo: 'falhar', chave: 'K', erro: 'Mínimo de 3 PICs com precipitação para interpolar' });
    expect(e.progresso).toBeNull();
    expect(resultadoAtualizado(e, 'K')).toBeNull();
    expect(situacaoInterpolacao(e, 'K')).toBe('erro');
    expect(decidirInterpolacao(e, 'K')).toBe('manter');
    // outras entradas: o erro não se aplica e uma nova execução é agendada
    expect(situacaoInterpolacao(e, 'K2')).toBe('pendente');
    expect(decidirInterpolacao(e, 'K2')).toBe('agendar');
    e = aplicar(e, { tipo: 'iniciar', chave: 'K2' });
    expect(e.erro).toBeNull();
  });
});

describe('decisão reavaliada a cada mudança de estado (corrida da prévia presa em "Interpolando…")', () => {
  it('é idempotente: depois de cada transição, decidir de novo para a mesma chave não reagenda nada', () => {
    let e = aplicar(ESTADO_INICIAL, { tipo: 'iniciar', chave: 'C' });
    expect(decidirInterpolacao(e, 'C')).toBe('manter');
    e = aplicar(e, { tipo: 'progresso', chave: 'C', f: 0.5 });
    expect(decidirInterpolacao(e, 'C')).toBe('manter');
    expect(decidirInterpolacao(aplicar(e, { tipo: 'concluir', chave: 'C', resultado: resultado('C') }), 'C')).toBe('manter');
    expect(decidirInterpolacao(aplicar(e, { tipo: 'falhar', chave: 'C', erro: 'x' }), 'C')).toBe('manter');
  });

  it('limpar/cancelar sem nada a fazer não mudam o estado (reavaliar não entra em laço de renderização)', () => {
    expect(reduzirInterpolacao(ESTADO_INICIAL, { tipo: 'limpar' })).toBe(ESTADO_INICIAL);
    const pronto = concluido('C', resultado('C'));
    expect(reduzirInterpolacao(pronto, { tipo: 'cancelar' })).toBe(pronto);
  });

  it('se outra execução (D) começar sem a chave mudar (C), a nova decisão corrige: cancela D, e depois reagenda C', () => {
    // o timer de D disparou antes do efeito da troca para C: C tinha resultado, D ficou rodando
    const rodandoD = aplicar(concluido('C', resultado('C')), { tipo: 'iniciar', chave: 'D' });
    expect(situacaoInterpolacao(rodandoD, 'C')).toBe('pendente');
    expect(decidirInterpolacao(rodandoD, 'C')).toBe('cancelar');
    expect(situacaoInterpolacao(aplicar(rodandoD, { tipo: 'cancelar' }), 'C')).toBe('atualizado');
    // e se D terminar antes, C precisa ser interpolado de novo (sem isso a prévia ficaria presa)
    const concluiuD = aplicar(rodandoD, { tipo: 'concluir', chave: 'D', resultado: resultado('D') });
    expect(situacaoInterpolacao(concluiuD, 'C')).toBe('pendente');
    expect(decidirInterpolacao(concluiuD, 'C')).toBe('agendar');
  });
});
