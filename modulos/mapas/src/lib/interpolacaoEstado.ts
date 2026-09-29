/**
 * Estado da interpolação do editor, sem React: decide quando rodar o worker e se o último
 * resultado ainda corresponde às entradas atuais. O hook useInterpolacao só liga isto ao worker.
 */
import type { PipelineInput, PipelineOutput } from './pipeline';
import type { AreaCultura, IdwParams, Pic, Talhao } from './types';

export interface EntradaInterpolacao {
  inp: PipelineInput;
  /** identifica as entradas: mesma chave = mesmo resultado */
  chave: string;
}

/**
 * Monta a entrada do pipeline; null quando falta talhão ou PIC com chuva para interpolar. Com áreas da
 * cultura, elas vão junto (estatísticas por área) e `plantadosAreas` define a "área plantada".
 */
export function entradaInterpolacao(
  talhoes: Talhao[],
  pics: Pic[],
  idw: IdwParams,
  plantados: Iterable<string>,
  areas: readonly Pick<AreaCultura, 'id' | 'geom'>[] = [],
  plantadosAreas: Iterable<string> = [],
): EntradaInterpolacao | null {
  const incluidos = pics.filter((p) => p.incluir && p.chuva !== null);
  if (!talhoes.length || !incluidos.length) return null;
  const inp: PipelineInput = {
    talhoes: talhoes.map(({ id, nome, setor, geom }) => ({ id, nome, setor, geom })),
    pics: incluidos.map(({ lat, lon, chuva }) => ({ lat, lon, chuva })),
    params: { ...idw },
    plantados: [...plantados].sort(),
  };
  if (areas.length) {
    inp.areas = areas.map(({ id, geom }) => ({ id, geom }));
    inp.plantadosAreas = [...plantadosAreas].sort();
  }
  // nome e setor entram no resumo por talhão; a geometria de um id não muda sem trocar a fazenda
  const chave = JSON.stringify([
    inp.talhoes.map((t) => [t.id, t.nome, t.setor]),
    inp.pics.map((p) => [p.lat, p.lon, p.chuva]),
    [idw.potencia, idw.vizinhos, idw.pixel, idw.buffer],
    inp.plantados,
    inp.areas?.map((a) => a.id) ?? [],
    inp.plantadosAreas ?? [],
  ]);
  return { inp, chave };
}

export interface EstadoInterpolacao {
  /** último resultado concluído (pode estar desatualizado: use resultadoAtualizado para exportar) */
  resultado: PipelineOutput | null;
  /** chave das entradas que geraram `resultado` */
  chaveResultado: string;
  /** entradas em processamento no worker; '' = nada rodando */
  chaveRodando: string;
  /** 0..1 enquanto roda; null parado */
  progresso: number | null;
  erro: string | null;
  /** chave das entradas que geraram `erro` */
  chaveErro: string;
}

export const ESTADO_INICIAL: EstadoInterpolacao = {
  resultado: null,
  chaveResultado: '',
  chaveRodando: '',
  progresso: null,
  erro: null,
  chaveErro: '',
};

export type AcaoInterpolacao =
  | { tipo: 'limpar' }
  | { tipo: 'cancelar' }
  | { tipo: 'iniciar'; chave: string }
  | { tipo: 'progresso'; chave: string; f: number }
  | { tipo: 'concluir'; chave: string; resultado: PipelineOutput }
  | { tipo: 'falhar'; chave: string; erro: string };

const vazio = (e: EstadoInterpolacao) =>
  !e.resultado && !e.chaveResultado && !e.chaveRodando && e.progresso === null && !e.erro && !e.chaveErro;

export function reduzirInterpolacao(e: EstadoInterpolacao, a: AcaoInterpolacao): EstadoInterpolacao {
  switch (a.tipo) {
    case 'limpar':
      // esquece tudo, inclusive as chaves: voltar às mesmas entradas interpola de novo
      return vazio(e) ? e : ESTADO_INICIAL;
    case 'cancelar':
      return e.chaveRodando ? { ...e, chaveRodando: '', progresso: null } : e;
    case 'iniciar':
      return { ...e, chaveRodando: a.chave, progresso: 0, erro: null, chaveErro: '' };
    // respostas de uma execução substituída ou cancelada são ignoradas
    case 'progresso':
      return a.chave === e.chaveRodando ? { ...e, progresso: a.f } : e;
    case 'concluir':
      if (a.chave !== e.chaveRodando) return e;
      return { resultado: a.resultado, chaveResultado: a.chave, chaveRodando: '', progresso: null, erro: null, chaveErro: '' };
    case 'falhar':
      if (a.chave !== e.chaveRodando) return e;
      return { resultado: null, chaveResultado: '', chaveRodando: '', progresso: null, erro: a.erro, chaveErro: a.chave };
  }
}

/**
 * O que o hook faz quando as entradas passam a ter a chave `chave` ('' = nada a interpolar):
 * limpar (cancela e zera tudo), manter, cancelar (o último resultado já vale; para o que estiver
 * rodando) ou agendar (nova execução após o debounce).
 */
export type Decisao = 'limpar' | 'manter' | 'cancelar' | 'agendar';

export function decidirInterpolacao(e: EstadoInterpolacao, chave: string): Decisao {
  if (!chave) return 'limpar';
  if (chave === e.chaveRodando) return 'manter';
  // mesmas entradas do último resultado ou do último erro: nada a recalcular (erro não repete sozinho)
  if (chave === e.chaveResultado || chave === e.chaveErro) return e.chaveRodando ? 'cancelar' : 'manter';
  return 'agendar';
}

/** Resultado que corresponde às entradas atuais, sem nada rodando: o único que pode ser exportado ou salvo. */
export function resultadoAtualizado(e: EstadoInterpolacao, chave: string): PipelineOutput | null {
  return chave !== '' && e.chaveResultado === chave && e.chaveRodando === '' ? e.resultado : null;
}

/** Erro das entradas atuais (o erro de outras entradas não vale mais). */
export function erroAtual(e: EstadoInterpolacao, chave: string): string | null {
  return chave !== '' && e.chaveErro === chave ? e.erro : null;
}

export type Situacao = 'vazio' | 'pendente' | 'atualizado' | 'erro';

export function situacaoInterpolacao(e: EstadoInterpolacao, chave: string): Situacao {
  if (!chave) return 'vazio';
  if (erroAtual(e, chave)) return 'erro';
  return resultadoAtualizado(e, chave) ? 'atualizado' : 'pendente';
}
